var CFG     = require('./_trend-config');
var SCORE   = require('./_trend-score');
var NAVER   = require('./_trend-naver');
var YOUTUBE = require('./_trend-youtube');
var GROQ    = require('./_trend-groq');
var GEMINI  = require('./_trend-gemini');

function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }
function safeNum(v){ return isNaN(Number(v))?0:Number(v); }

// STEP 1
function buildKeywordMap(kw7d, kw24h){
  var map = {};
  (kw7d||[]).forEach(function(item){
    var kw=(item.keyword||'').trim(); if(!kw) return;
    map[kw]={ keyword:kw, kw7d:{exists:true,searchVolume:safeNum(item.searchVolume),increaseRate:safeNum(item.increaseRate)}, kw24h:{exists:false,searchVolume:0,increaseRate:0} };
  });
  (kw24h||[]).forEach(function(item){
    var kw=(item.keyword||'').trim(); if(!kw) return;
    if(map[kw]){ map[kw].kw24h={exists:true,searchVolume:safeNum(item.searchVolume),increaseRate:safeNum(item.increaseRate)}; }
    else{ map[kw]={ keyword:kw, kw7d:{exists:false,searchVolume:0,increaseRate:0}, kw24h:{exists:true,searchVolume:safeNum(item.searchVolume),increaseRate:safeNum(item.increaseRate)} }; }
  });
  return Object.values(map);
}

// STEP 2
async function classifyAndFilter(keywordItems){
  var kwList=keywordItems.map(function(i){return i.keyword;});
  var classified;
  try{ classified=await GROQ.classifyKeywords(kwList); }
  catch(e){
    classified=kwList.map(function(kw){
      return {kw:kw,normalized:kw,type:GROQ.ruleBasedClassify(kw),isNoise:CFG.NOISE_PATTERNS.some(function(p){return p.test(kw);})};
    });
  }
  var classMap={};
  (classified||[]).forEach(function(c){classMap[c.kw]=c;});
  var passed=[], excluded=[];
  keywordItems.forEach(function(item){
    var cls=classMap[item.keyword]||{kw:item.keyword,normalized:item.keyword,type:GROQ.ruleBasedClassify(item.keyword),isNoise:CFG.NOISE_PATTERNS.some(function(p){return p.test(item.keyword);})};
    var enriched=Object.assign({},item,{normalized:cls.normalized,kwType:cls.type,isNoise:cls.isNoise});
    if(cls.isNoise||cls.type===CFG.KW_TYPE.NEWS_EVENT||cls.type===CFG.KW_TYPE.BRAND) excluded.push(item.keyword);
    else passed.push(enriched);
  });
  var excludeReasons={};
  if(excluded.length){
    try{ excludeReasons=await GROQ.generateExcludeReason(excluded); }catch(e){ console.warn('[exclude-reason]',e.message); }
  }
  return {passed:passed,excludeReasons:excludeReasons,excluded:excluded};
}

// STEP 3
async function expandToProducts(filteredItems){
  var candidates=[];
  for(var i=0;i<filteredItems.length;i++){
    var item=filteredItems[i];
    if(item.kwType===CFG.KW_TYPE.BRAND||item.kwType===CFG.KW_TYPE.NEWS_EVENT) continue;
    var productNames;
    if(item.kwType===CFG.KW_TYPE.PROBLEM||item.kwType===CFG.KW_TYPE.SITUATION){
      try{ productNames=await GROQ.mapKeywordToProducts(item.keyword,item.kwType); }
      catch(e){ productNames=GROQ.ruleBasedProductMapping(item.keyword); }
      await sleep(100);
    } else { productNames=[item.normalized||item.keyword]; }
    productNames.forEach(function(pname){
      if(!pname||!pname.trim()) return;
      candidates.push({
        originalKeyword:item.keyword, productName:pname.trim(), normalized:item.normalized,
        kwType:item.kwType, kw7d:item.kw7d, kw24h:item.kw24h,
        naverData:null,datalabData:null,insightData:null,ytData:null,groqFit:null,geminiBonus:null,
        isGeneralNoun:!/[A-Za-z0-9]/.test(pname)&&pname.length<=10,
        isProblemSolving:item.kwType===CFG.KW_TYPE.PROBLEM||item.kwType===CFG.KW_TYPE.SITUATION,
        isBrandDependent:item.kwType===CFG.KW_TYPE.BRAND,
        isTemporaryTrend:false, hasMedicalRisk:/의약품|처방|진단|치료|수술/.test(pname),
        isHardToConvert:item.kwType===CFG.KW_TYPE.ACTION||item.kwType===CFG.KW_TYPE.UNKNOWN,
        shopWeakVsSearch:false, isShortsCompatible:false, isBlogCompatible:false,
        hasVisualHook:false, hasUsageScene:false, isSeasonalFit:false,
        scores:{}, finalScore:0, group:CFG.GROUP.C,
      });
    });
    if(i%5===0) await sleep(50);
  }
  var seen={};
  return candidates.filter(function(c){ if(seen[c.productName]) return false; seen[c.productName]=true; return true; });
}

// STEP 4
async function collectExternalData(candidates, period, apiStatus){
  var productNames=candidates.map(function(c){return c.productName;});
  var naverBatch={};
  try{ naverBatch=await NAVER.fetchNaverBatch(productNames,period); apiStatus.naver='✅ '+productNames.length+'개 수집'; }
  catch(e){ console.error('[naver-batch]',e.message); apiStatus.naver='❌ '+e.message; }
  await sleep(500);
  var ytBatch={};
  try{ ytBatch=await YOUTUBE.fetchYouTubeBatch(productNames.slice(0,10)); apiStatus.youtube='✅ '+Object.keys(ytBatch).length+'개 수집'; }
  catch(e){ console.error('[youtube-batch]',e.message); apiStatus.youtube='❌ '+e.message; }
  candidates.forEach(function(c){
    var nd=naverBatch[c.productName]||{};
    c.naverData=nd.search||null; c.datalabData=nd.datalab||null; c.insightData=nd.insight||null;
    c.ytData=ytBatch[c.productName]||null;
    if(c.ytData){ c.isShortsCompatible=!!c.ytData.isShortsCompatible; c.isBlogCompatible=!!c.ytData.isBlogCompatible; c.hasVisualHook=!!c.ytData.hasVisualHook; c.hasUsageScene=!!c.ytData.hasUsageScene; }
    if(c.naverData&&c.datalabData) c.shopWeakVsSearch=!c.naverData.shoppingExists&&safeNum(c.datalabData.surgeRate)>20;
  });
  return candidates;
}

// STEP 5: Groq
async function enrichWithGroq(candidates, apiStatus){
  for(var i=0;i<Math.min(candidates.length,10);i++){
    try{ candidates[i].groqFit=await GROQ.calcProductFitGroq(candidates[i].productName,candidates[i].kwType); await sleep(150); }
    catch(e){ candidates[i].groqFit=null; }
  }
  apiStatus.groq='✅ Groq 분석 완료';
  return candidates;
}

// STEP 6: 점수
function scoreSortGroup(candidates){
  candidates=candidates.map(function(c){return SCORE.scoreCandidate(c);});
  candidates.sort(function(a,b){return b.finalScore-a.finalScore;});
  return candidates;
}

// STEP 7: Gemini 보정
async function enrichWithGemini(candidates, apiStatus){
  for(var j=0;j<Math.min(candidates.length,10);j++){
    var c=candidates[j];
    try{
      c.geminiBonus=await GEMINI.calcTrustBonusGemini(c);
      if(c.geminiBonus&&typeof c.geminiBonus.adjustment==='number'){
        var adj=safeNum(c.geminiBonus.adjustment);
        c.scores.trustBonus=Math.min(100,Math.max(0,safeNum(c.scores.trustBonus)+adj));
        c.finalScore=Math.min(100,Math.max(0,safeNum(c.finalScore)+Math.round(adj*CFG.WEIGHTS.trustBonus)));
      }
      await sleep(200);
    }catch(e){ c.geminiBonus=null; }
  }
  candidates.sort(function(a,b){return b.finalScore-a.finalScore;});
  apiStatus.gemini='✅ Gemini 보정 완료';
  return candidates;
}

// STEP 8: 설명 생성
async function generateDescriptions(candidates, groups){
  var top10=candidates.slice(0,10);
  for(var i=0;i<top10.length;i++){
    try{
      var desc=await GROQ.generateReasonSummary(top10[i]);
      top10[i].groqReason=desc.reason||''; top10[i].shortsIdea=desc.shorts||''; top10[i].blogIdea=desc.blog||'';
      await sleep(150);
    }catch(e){
      top10[i].groqReason=top10[i].productName+'의 상승 트렌드 확인됨. 즉시 선점 필요.';
      top10[i].shortsIdea=top10[i].productName+' 사용 전후 비교 쇼츠';
      top10[i].blogIdea=top10[i].productName+' 추천 TOP5 + 가격비교';
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
  catch(e){ guide='TOP 후보 제품으로 쇼츠 영상을 먼저 제작하고\n블로그 리뷰로 검색 트래픽을 확보하세요.\n쿠팡 파트너스 링크로 제휴 수익을 창출하세요.'; }

  // ★ [10] generateStructuredRecommendations
  var structuredRecs=null;
  try{ structuredRecs=await GEMINI.generateStructuredRecommendations(top10,groups); }catch(e){ console.warn('[structured-recs]',e.message); }

  return {candidates:top10,summary:summary,guide:guide,structuredRecs:structuredRecs};
}

// ── 핸들러 ───────────────────────────────────────────────────
module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({error:'POST만 허용'});
  if(!process.env.NAVER_CLIENT_ID||!process.env.NAVER_CLIENT_SECRET)
    return res.status(500).json({error:'NAVER 환경변수 누락'});

  var body='';
  req.on('data',function(c){body+=c;});
  req.on('end', async function(){
    try{
      var payload=JSON.parse(body);
      var kw7d=payload.kw7d||[], kw24h=payload.kw24h||[];
      var period=payload.period||'week', filters=payload.filters||{};
      var maxCount=safeNum(payload.maxCount)||10;

      if(!kw7d.length&&!kw24h.length) return res.status(400).json({error:'키워드 데이터가 없습니다'});

      var apiStatus={};

      var merged=buildKeywordMap(kw7d,kw24h);
      var stepResult=await classifyAndFilter(merged);
      var filtered=stepResult.passed, excludeReasons=stepResult.excludeReasons, excluded=stepResult.excluded;

      if(!filtered.length) return res.status(200).json({candidates:[],apiStatus:apiStatus,excluded:excluded,excludeReasons:excludeReasons,error:'유효 키워드 없음'});

      var candidates=await expandToProducts(filtered);
      if(!candidates.length) return res.status(200).json({candidates:[],apiStatus:apiStatus,excluded:excluded,excludeReasons:excludeReasons,error:'제품 후보 없음'});

      candidates=candidates.slice(0,15);
      candidates=await collectExternalData(candidates,period,apiStatus);
      candidates=await enrichWithGroq(candidates,apiStatus);
      candidates=scoreSortGroup(candidates);
      candidates=await enrichWithGemini(candidates,apiStatus);

      // 필터
      if(safeNum(filters.minFinalScore)>0) candidates=candidates.filter(function(c){return c.finalScore>=safeNum(filters.minFinalScore);});
      if(safeNum(filters.minBuyIntent)>0)  candidates=candidates.filter(function(c){return safeNum(c.scores.buyIntent)>=safeNum(filters.minBuyIntent);});
      if(safeNum(filters.minShopping)>0)   candidates=candidates.filter(function(c){return safeNum(c.scores.shoppingInterest)>=safeNum(filters.minShopping);});
      if(safeNum(filters.minYoutube)>0)    candidates=candidates.filter(function(c){return safeNum(c.scores.youtubeViral)>=safeNum(filters.minYoutube);});
      if(filters.shortsOnly)               candidates=candidates.filter(function(c){return c.isShortsCompatible;});
      if(filters.blogOnly)                 candidates=candidates.filter(function(c){return c.isBlogCompatible;});
      if(filters.noBrand)                  candidates=candidates.filter(function(c){return !c.isBrandDependent;});
      if(filters.generalNounOnly)          candidates=candidates.filter(function(c){return c.isGeneralNoun;});
      if(filters.noNewsEvent)              candidates=candidates.filter(function(c){return c.kwType!==CFG.KW_TYPE.NEWS_EVENT;});
      candidates=candidates.slice(0,Math.max(maxCount,5));

      var groups={};
      groups[CFG.GROUP.A]=candidates.filter(function(c){return c.group===CFG.GROUP.A;});
      groups[CFG.GROUP.B]=candidates.filter(function(c){return c.group===CFG.GROUP.B;});
      groups[CFG.GROUP.C]=candidates.filter(function(c){return c.group===CFG.GROUP.C;});

      var result=await generateDescriptions(candidates,groups);

      // ★ [13] 표1 데이터: 누락된 3개 컬럼 포함한 table1Data 생성
      var table1Data=result.candidates.map(function(c,i){
        var sc=c.scores||{};
        return {
          rank:                i+1,
          productName:         c.productName,
          originalKeyword:     c.originalKeyword,
          has7d:               c.kw7d&&c.kw7d.exists,
          has24h:              c.kw24h&&c.kw24h.exists,
          persistence:         Math.round(sc.persistence||0),
          recentRise:          Math.round(sc.recentRise||0),
          buyIntent:           Math.round(sc.buyIntent||0),
          datalabTrend:        Math.round(sc.datalabTrend||0),       // ★ 누락 컬럼 1
          shoppingInterest:    Math.round(sc.shoppingInterest||0),
          youtubeViral:        Math.round(sc.youtubeViral||0),
          productFit:          Math.round(sc.productFit||0),          // ★ 누락 컬럼 2
          trustBonus:          Math.round(sc.trustBonus||0),          // ★ 누락 컬럼 3
          finalScore:          Math.round(c.finalScore||0),
          group:               c.group,
          verdict:             c.groqReason||'–',
        };
      });

      // 실행 우선순위 (표3)
      var actionPriority=result.candidates.map(function(c,i){
        return {
          rank:i+1, productName:c.productName,
          whyNow:c.groqReason||(c.geminiExplanation||'').slice(0,60)||'상승 트렌드 확인',
          shortsReady:c.isShortsCompatible, blogReady:c.isBlogCompatible,
          hasVisualHook:c.hasVisualHook, hasUsageScene:c.hasUsageScene,
          action:c.group===CFG.GROUP.A?'즉시 쇼츠 제작 + 블로그 작성':c.group===CFG.GROUP.B?'블로그 리뷰 + 비교 포스팅':'소규모 테스트 후 판단',
        };
      });

      return res.status(200).json({
        candidates:       result.candidates,
        table1Data:       table1Data,          // ★ 표1 전체 컬럼
        groups:           groups,
        actionPriority:   actionPriority,
        structuredRecs:   result.structuredRecs,  // ★ generateStructuredRecommendations
        excluded:         excluded,
        excludeReasons:   excludeReasons,
        summary:          result.summary,
        guide:            result.guide,
        apiStatus:        apiStatus,
        total:            result.candidates.length,
        updatedAt:        new Date().toISOString(),
      });
    }catch(e){
      console.error('[trend-analyze]',e.message,e.stack);
      return res.status(500).json({error:'분석 중 오류',detail:e.message});
    }
  });
};
