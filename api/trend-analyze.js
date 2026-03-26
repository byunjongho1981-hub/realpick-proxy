var CFG     = require('./_trend-config');
var SCORE   = require('./_trend-score');
var NAVER   = require('./_trend-naver');
var YOUTUBE = require('./_trend-youtube');
var GROQ    = require('./_trend-groq');
var GEMINI  = require('./_trend-gemini');

function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }
function safeNum(v){ return isNaN(Number(v))?0:Number(v); }

// ── STEP 1: 키워드 맵 ────────────────────────────────────────
function buildKeywordMap(kw7d, kw24h){
  var map={};
  (kw7d||[]).forEach(function(item){
    var kw=(item.keyword||'').trim(); if(!kw) return;
    map[kw]={keyword:kw,_catId:item._catId||null,
      kw7d:{exists:true,searchVolume:safeNum(item.searchVolume),increaseRate:safeNum(item.increaseRate)},
      kw24h:{exists:false,searchVolume:0,increaseRate:0}};
  });
  (kw24h||[]).forEach(function(item){
    var kw=(item.keyword||'').trim(); if(!kw) return;
    if(map[kw]) map[kw].kw24h={exists:true,searchVolume:safeNum(item.searchVolume),increaseRate:safeNum(item.increaseRate)};
    else map[kw]={keyword:kw,_catId:null,
      kw7d:{exists:false,searchVolume:0,increaseRate:0},
      kw24h:{exists:true,searchVolume:safeNum(item.searchVolume),increaseRate:safeNum(item.increaseRate)}};
  });
  return Object.values(map);
}

// ── STEP 2: 분류 + 필터 ──────────────────────────────────────
async function classifyAndFilter(keywordItems){
  var kwList=keywordItems.map(function(i){return i.keyword;});
  var classified;
  try{ classified=await GROQ.classifyKeywords(kwList); }
  catch(e){
    classified=kwList.map(function(kw){
      return {kw:kw,normalized:kw,type:GROQ.ruleBasedClassify(kw),
        isNoise:CFG.NOISE_PATTERNS.some(function(p){return p.test(kw);})};
    });
  }
  var classMap={};
  (classified||[]).forEach(function(c){classMap[c.kw]=c;});
  var passed=[],excluded=[];
  keywordItems.forEach(function(item){
    var cls=classMap[item.keyword]||{kw:item.keyword,normalized:item.keyword,
      type:GROQ.ruleBasedClassify(item.keyword),
      isNoise:CFG.NOISE_PATTERNS.some(function(p){return p.test(item.keyword);})};
    var enriched=Object.assign({},item,{normalized:cls.normalized,kwType:cls.type,isNoise:cls.isNoise});
    // [7] news_event+noise만 제외, 브랜드/고가제품 유지
    if(cls.isNoise||cls.type===CFG.KW_TYPE.NEWS_EVENT) excluded.push(item.keyword);
    else passed.push(enriched);
  });
  var excludeReasons={};
  if(excluded.length){
    try{ excludeReasons=await GROQ.generateExcludeReason(excluded); }
    catch(e){ console.warn('[exclude-reason]',e.message); }
  }
  return {passed,excludeReasons,excluded};
}

// ── STEP 3: 제품 후보 확장 ───────────────────────────────────
async function expandToProducts(filteredItems){
  var candidates=[];
  for(var i=0;i<filteredItems.length;i++){
    var item=filteredItems[i];
    if(item.kwType===CFG.KW_TYPE.NEWS_EVENT) continue;
    var productNames;
    if(item.kwType===CFG.KW_TYPE.PROBLEM||item.kwType===CFG.KW_TYPE.SITUATION){
      try{ productNames=await GROQ.mapKeywordToProducts(item.keyword,item.kwType); }
      catch(e){ productNames=GROQ.ruleBasedProductMapping(item.keyword); }
      await sleep(100);
    } else { productNames=[item.normalized||item.keyword]; }
    productNames.forEach(function(pname){
      if(!pname||!pname.trim()) return;
      candidates.push({
        originalKeyword:item.keyword, productName:pname.trim(),
        normalized:item.normalized, kwType:item.kwType,
        catId:item._catId||null,
        kw7d:item.kw7d, kw24h:item.kw24h,
        naverData:null, datalabData:null, insightData:null,
        ytData:null, searchIntentData:null,
        groqFit:null, geminiBonus:null,
        isGeneralNoun:!/[A-Za-z0-9]/.test(pname)&&pname.length<=10,
        isProblemSolving:item.kwType===CFG.KW_TYPE.PROBLEM||item.kwType===CFG.KW_TYPE.SITUATION,
        isBrandDependent:item.kwType===CFG.KW_TYPE.BRAND,
        isTemporaryTrend:false,
        hasMedicalRisk:/의약품|처방|진단|치료|수술/.test(pname),
        isHardToConvert:item.kwType===CFG.KW_TYPE.ACTION||item.kwType===CFG.KW_TYPE.UNKNOWN,
        shopWeakVsSearch:false, isShortsCompatible:false, isBlogCompatible:false,
        hasVisualHook:false, hasUsageScene:false, isSeasonalFit:false,
        scores:{}, finalScore:0, group:CFG.GROUP.C,
      });
    });
    if(i%5===0) await sleep(50);
  }
  var seen={};
  return candidates.filter(function(c){
    if(seen[c.productName]) return false;
    seen[c.productName]=true; return true;
  });
}

// ── STEP 4: 외부 데이터 수집 ─────────────────────────────────
async function collectExternalData(candidates, period, apiStatus, scope, preInsightMap){
  var productNames=candidates.map(function(c){return c.productName;});
  console.log('[STEP4] 수집 시작 키워드:', productNames.length+'개');

  // catId 맵
  var catIdMap={};
  candidates.forEach(function(c){ if(c.catId) catIdMap[c.productName]=c.catId; });

  // pre-fetch insight 주입
  if(preInsightMap){
    candidates.forEach(function(c){
      if(!c.insightData&&preInsightMap[c.originalKeyword])
        c.insightData=preInsightMap[c.originalKeyword];
    });
  }

  // 네이버 배치 수집
  var naverBatch={};
  try{
    naverBatch=await NAVER.fetchNaverBatch(productNames,period,scope||'all',catIdMap);
  }catch(e){
    console.error('[STEP4] fetchNaverBatch 오류:',e.message);
    apiStatus.naver='❌ '+e.message;
  }

  // 집계
  var searchOk=0,dlOk=0,insightOk=0;
  productNames.forEach(function(p){
    var nd=naverBatch[p]||{};
    if(nd.search  &&!nd.search._fallback)  searchOk++;
    if(nd.datalab &&!nd.datalab._fallback) dlOk++;
    if(nd.insight &&!nd.insight._fallback) insightOk++;
  });
  console.log('[STEP4] 검색:'+searchOk+' 데이터랩:'+dlOk+' 인사이트:'+insightOk+'/'+productNames.length);

  apiStatus.naver_search  =searchOk>0  ?'✅ 검색 '+searchOk+'/'+productNames.length  :'⚠️ 검색 fallback';
  apiStatus.naver_datalab =dlOk>0      ?'✅ 데이터랩 '+dlOk+'/'+productNames.length  :'⚠️ 데이터랩 fallback';
  apiStatus.naver_insight =insightOk>0 ?'✅ 인사이트 '+insightOk+'/'+productNames.length:'⚠️ 인사이트 fallback';
  apiStatus.naver='검색'+searchOk+' 데이터랩'+dlOk+' 인사이트'+insightOk+'/'+productNames.length;

  // candidates에 주입
  candidates.forEach(function(c){
    var nd=naverBatch[c.productName]||{};
    c.naverData   = nd.search  || c.naverData  || null;
    c.datalabData = nd.datalab || c.datalabData || null;
    if(!c.insightData) c.insightData=nd.insight||null;
    if(c.naverData&&c.datalabData)
      c.shopWeakVsSearch=!c.naverData.shoppingExists&&safeNum(c.datalabData.surgeRate)>20;
  });

  // YouTube
  var ytBatch={};
  try{
    ytBatch=await YOUTUBE.fetchYouTubeBatch(productNames.slice(0,10));
    apiStatus.youtube='✅ YouTube '+Object.keys(ytBatch).length+'개';
    console.log('[STEP4] YouTube:'+Object.keys(ytBatch).length+'개');
  }catch(e){
    console.error('[STEP4] YouTube 오류:',e.message);
    apiStatus.youtube='⚠️ YouTube fallback';
  }

  candidates.forEach(function(c){
    c.ytData=ytBatch[c.productName]||null;
    if(c.ytData){
      c.isShortsCompatible=!!c.ytData.isShortsCompatible;
      c.isBlogCompatible  =!!c.ytData.isBlogCompatible;
      c.hasVisualHook     =!!c.ytData.hasVisualHook;
      c.hasUsageScene     =!!c.ytData.hasUsageScene;
    }
  });

  return candidates;
}

// ── STEP 5: 검색 의도 분석 ───────────────────────────────────
async function enrichSearchIntent(candidates, apiStatus){
  for(var i=0;i<candidates.length;i++){
    var c=candidates[i];
    var suggestions=[];
    try{ suggestions=await NAVER.fetchNaverSuggestions(c.productName); }catch(e){}
    c.searchIntentData=NAVER.calcSearchIntentFromData(c.productName,c.naverData,suggestions);
    if(i<candidates.length-1) await sleep(80);
  }
  apiStatus.searchIntent='✅ 검색의도 분석 완료';
  return candidates;
}

// ── STEP 6: Groq ─────────────────────────────────────────────
async function enrichWithGroq(candidates, apiStatus){
  for(var i=0;i<Math.min(candidates.length,10);i++){
    try{
      candidates[i].groqFit=await GROQ.calcProductFitGroq(candidates[i].productName,candidates[i].kwType);
      await sleep(150);
    }catch(e){ candidates[i].groqFit=null; }
  }
  apiStatus.groq='✅ Groq 분석 완료';
  return candidates;
}

// ── STEP 7: 점수 산정 ────────────────────────────────────────
function scoreSortGroup(candidates){
  candidates=candidates.map(function(c){return SCORE.scoreCandidate(c);});
  candidates.sort(function(a,b){return b.finalScore-a.finalScore;});
  return candidates;
}

// ── STEP 8: Gemini 보정 ──────────────────────────────────────
async function enrichWithGemini(candidates, apiStatus){
  for(var j=0;j<Math.min(candidates.length,10);j++){
    var c=candidates[j];
    try{
      c.geminiBonus=await GEMINI.calcTrustBonusGemini(c);
      if(c.geminiBonus&&typeof c.geminiBonus.adjustment==='number'){
        var adj=safeNum(c.geminiBonus.adjustment);
        c.scores.trustBonus=Math.min(100,Math.max(0,safeNum(c.scores.trustBonus)+adj));
        c.finalScore=Math.min(100,Math.max(0,safeNum(c.finalScore)+Math.round(adj*CFG.WEIGHTS.productFit)));
      }
      await sleep(200);
    }catch(e){ c.geminiBonus=null; }
  }
  candidates.sort(function(a,b){return b.finalScore-a.finalScore;});
  apiStatus.gemini='✅ Gemini 보정 완료';
  return candidates;
}

// ── STEP 9: 설명 생성 ────────────────────────────────────────
async function generateDescriptions(candidates, groups){
  var top10=candidates.slice(0,10);
  for(var i=0;i<top10.length;i++){
    try{
      var desc=await GROQ.generateReasonSummary(top10[i]);
      top10[i].groqReason=desc.reason||'';
      top10[i].shortsIdea=desc.shorts||'';
      top10[i].blogIdea  =desc.blog||'';
      await sleep(150);
    }catch(e){
      top10[i].groqReason=top10[i].productName+' 상승 트렌드 확인됨';
      top10[i].shortsIdea=top10[i].productName+' 사용 전후 비교 쇼츠';
      top10[i].blogIdea  =top10[i].productName+' 추천 TOP5 + 가격비교';
    }
  }
  for(var j=0;j<Math.min(top10.length,5);j++){
    try{ top10[j].geminiExplanation=await GEMINI.explainWhyNow(top10[j]); await sleep(200); }
    catch(e){ top10[j].geminiExplanation=''; }
  }
  var summary=null;
  try{ summary=await GEMINI.mergeAndSummarizeSignals(top10); }catch(e){}
  var guide='';
  try{ guide=await GEMINI.generateFinalNarrative(top10,summary); }
  catch(e){ guide='TOP 후보 제품으로 쇼츠 영상을 먼저 제작하고\n블로그 리뷰로 검색 트래픽을 확보하세요.'; }
  var structuredRecs=null;
  try{ structuredRecs=await GEMINI.generateStructuredRecommendations(top10,groups); }
  catch(e){ console.warn('[structured-recs]',e.message); }
  return {candidates:top10,summary,guide,structuredRecs};
}

// ════════════════════════════════════════════════════════════
// 핸들러
// ════════════════════════════════════════════════════════════
module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST')    return res.status(405).json({error:'POST만 허용'});
  if(!process.env.NAVER_CLIENT_ID||!process.env.NAVER_CLIENT_SECRET)
    return res.status(500).json({error:'NAVER 환경변수 누락'});

  var body='';
  req.on('data',function(c){body+=c;});
  req.on('end', async function(){
    try{
      var payload    = JSON.parse(body);
      var mode       = payload.mode    || 'csv';
      var scope      = payload.scope   || 'all';
      var period     = payload.period  || 'week';
      var filters    = payload.filters || {};
      var maxCount   = safeNum(payload.maxCount)||10;
      var apiStatus  = {};

      var kw7d=[], kw24h=[];
      var preInsightMap=null;

      // ── 카테고리 모드 ─────────────────────────────────────
      if(mode==='category'){
        var catIds=payload.categories||[];
        if(!catIds.length) return res.status(400).json({error:'카테고리를 선택하세요'});
        apiStatus.mode='카테고리 탐색 ('+catIds.length+'개)';

        var catKwData=[];
        try{
          catKwData=await NAVER.fetchCategoryTopKeywords(catIds,period);
          await sleep(1000); // Rate Limit 해제 대기
          apiStatus.categoryFetch='✅ '+catKwData.length+'개 수집';
        }catch(e){
          console.error('[cat-keywords]',e.message);
          apiStatus.categoryFetch='❌ '+e.message;
        }
        if(!catKwData.length) return res.status(200).json({candidates:[],apiStatus,error:'카테고리 키워드 수집 실패'});

        preInsightMap={};
        catKwData.forEach(function(item){ preInsightMap[item.keyword]=item.insightData; });

        kw7d=catKwData.map(function(item){
          return {
            keyword:     item.keyword,
            searchVolume:item.insightData?Math.max(0,Math.round(item.insightData.currentRatio*10)):50,
            increaseRate:item.trendScore||0,
            _catId:      item.catId,
          };
        });

      // ── CSV 모드 ──────────────────────────────────────────
      } else {
        kw7d =payload.kw7d ||[];
        kw24h=payload.kw24h||[];
        if(!kw7d.length&&!kw24h.length)
          return res.status(400).json({error:'키워드 데이터가 없습니다'});
      }

      // ── 공통 파이프라인 ───────────────────────────────────
      var merged     = buildKeywordMap(kw7d,kw24h);
      var stepResult = await classifyAndFilter(merged);
      var filtered   = stepResult.passed;
      var excludeReasons = stepResult.excludeReasons;
      var excluded       = stepResult.excluded;

      if(!filtered.length)
        return res.status(200).json({candidates:[],apiStatus,excluded,excludeReasons,error:'유효 키워드 없음'});

      var candidates = await expandToProducts(filtered);
      if(!candidates.length)
        return res.status(200).json({candidates:[],apiStatus,excluded,excludeReasons,error:'제품 후보 없음'});

      candidates = candidates.slice(0,10);
      candidates = await collectExternalData(candidates,period,apiStatus,scope,preInsightMap);
      candidates = await enrichSearchIntent(candidates,apiStatus);
      candidates = await enrichWithGroq(candidates,apiStatus);
      candidates = scoreSortGroup(candidates);
      candidates = await enrichWithGemini(candidates,apiStatus);

      // 필터 적용
      if(safeNum(filters.minFinalScore)>0) candidates=candidates.filter(function(c){return c.finalScore>=safeNum(filters.minFinalScore);});
      if(safeNum(filters.minBuyIntent)>0)  candidates=candidates.filter(function(c){return safeNum(c.scores.buyIntent)>=safeNum(filters.minBuyIntent);});
      if(safeNum(filters.minShopping)>0)   candidates=candidates.filter(function(c){return safeNum(c.scores.shoppingInterest)>=safeNum(filters.minShopping);});
      if(safeNum(filters.minYoutube)>0)    candidates=candidates.filter(function(c){return safeNum(c.scores.youtubeViral)>=safeNum(filters.minYoutube);});
      if(filters.shortsOnly)               candidates=candidates.filter(function(c){return c.isShortsCompatible;});
      if(filters.blogOnly)                 candidates=candidates.filter(function(c){return c.isBlogCompatible;});
      if(filters.noBrand)                  candidates=candidates.filter(function(c){return !c.isBrandDependent;});
      if(filters.generalNounOnly)          candidates=candidates.filter(function(c){return c.isGeneralNoun;});
      candidates=candidates.slice(0,Math.max(maxCount,5));

      var groups={};
      groups[CFG.GROUP.A]=candidates.filter(function(c){return c.group===CFG.GROUP.A;});
      groups[CFG.GROUP.B]=candidates.filter(function(c){return c.group===CFG.GROUP.B;});
      groups[CFG.GROUP.C]=candidates.filter(function(c){return c.group===CFG.GROUP.C;});

      var result=await generateDescriptions(candidates,groups);

      // 표1 데이터
      var table1Data=result.candidates.map(function(c,i){
        var sc=c.scores||{};
        return {
          rank:i+1, productName:c.productName, originalKeyword:c.originalKeyword,
          has7d:c.kw7d&&c.kw7d.exists, has24h:c.kw24h&&c.kw24h.exists,
          searchIntent:     Math.round(sc.searchIntent||0),
          searchIntentType: c.searchIntentType||'–',
          shoppingInterest: Math.round(sc.shoppingInterest||0),
          buyIntent:        Math.round(sc.buyIntent||0),
          datalabTrend:     Math.round(sc.datalabTrend||0),
          youtubeViral:     Math.round(sc.youtubeViral||0),
          persistence:      Math.round(sc.persistence||0),
          recentRise:       Math.round(sc.recentRise||0),
          productFit:       Math.round(sc.productFit||0),
          trustBonus:       Math.round(sc.trustBonus||0),
          finalScore:       Math.round(c.finalScore||0),
          group:c.group, verdict:c.groqReason||'–',
        };
      });

      // 실행 우선순위
      var actionPriority=result.candidates.map(function(c,i){
        return {
          rank:i+1, productName:c.productName,
          whyNow:c.groqReason||(c.geminiExplanation||'').slice(0,60)||'상승 트렌드 확인',
          shortsReady:c.isShortsCompatible, blogReady:c.isBlogCompatible,
          hasVisualHook:c.hasVisualHook, hasUsageScene:c.hasUsageScene,
          action:c.group===CFG.GROUP.A?'즉시 쇼츠 제작 + 블로그 작성':
                 c.group===CFG.GROUP.B?'블로그 리뷰 + 비교 포스팅':'소규모 테스트 후 판단',
        };
      });

      return res.status(200).json({
        candidates:     result.candidates,
        table1Data:     table1Data,
        groups:         groups,
        actionPriority: actionPriority,
        structuredRecs: result.structuredRecs,
        excluded:       excluded,
        excludeReasons: excludeReasons,
        summary:        result.summary,
        guide:          result.guide,
        apiStatus:      apiStatus,
        mode:           mode,
        scope:          scope,
        total:          result.candidates.length,
        updatedAt:      new Date().toISOString(),
      });

    }catch(e){
      console.error('[trend-analyze fatal]',e.message,e.stack);
      return res.status(500).json({error:'분석 중 오류',detail:e.message});
    }
  });
};
