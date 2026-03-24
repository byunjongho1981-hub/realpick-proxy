var CFG     = require('./_trend-config');
var SCORE   = require('./_trend-score');
var NAVER   = require('./_trend-naver');
var YOUTUBE = require('./_trend-youtube');
var GROQ    = require('./_trend-groq');
var GEMINI  = require('./_trend-gemini');

function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }
function safeNum(v){ return isNaN(Number(v))?0:Number(v); }

// ════════════════════════════════════════════════════════════
// STEP 1: CSV 키워드 전처리 + 교차 비교
// ════════════════════════════════════════════════════════════
function buildKeywordMap(kw7d, kw24h){
  var map = {};
  // 7일 키워드 등록
  (kw7d||[]).forEach(function(item){
    var kw = (item.keyword||'').trim();
    if(!kw) return;
    map[kw] = {
      keyword: kw,
      kw7d:  { exists:true, searchVolume:safeNum(item.searchVolume), increaseRate:safeNum(item.increaseRate) },
      kw24h: { exists:false, searchVolume:0, increaseRate:0 },
    };
  });
  // 24시간 키워드 교차
  (kw24h||[]).forEach(function(item){
    var kw = (item.keyword||'').trim();
    if(!kw) return;
    if(map[kw]){
      map[kw].kw24h = { exists:true, searchVolume:safeNum(item.searchVolume), increaseRate:safeNum(item.increaseRate) };
    } else {
      map[kw] = {
        keyword: kw,
        kw7d:  { exists:false, searchVolume:0, increaseRate:0 },
        kw24h: { exists:true, searchVolume:safeNum(item.searchVolume), increaseRate:safeNum(item.increaseRate) },
      };
    }
  });
  return Object.values(map);
}

// ════════════════════════════════════════════════════════════
// STEP 2: 노이즈 제거 + 유형 분류 (Groq + 규칙 기반)
// ════════════════════════════════════════════════════════════
async function classifyAndFilter(keywordItems){
  var kwList = keywordItems.map(function(i){ return i.keyword; });
  // Groq 분류 시도
  var classified = await GROQ.classifyKeywords(kwList).catch(function(){
    // 폴백: 규칙 기반
    return kwList.map(function(kw){
      return { kw:kw, normalized:kw, type:GROQ.ruleBasedClassify(kw), isNoise:CFG.NOISE_PATTERNS.some(function(p){return p.test(kw);}) };
    });
  });
  // classified를 map으로 변환
  var classMap = {};
  (classified||[]).forEach(function(c){ classMap[c.kw] = c; });

  return keywordItems
    .map(function(item){
      var cls = classMap[item.keyword] || { kw:item.keyword, normalized:item.keyword, type:GROQ.ruleBasedClassify(item.keyword), isNoise:false };
      return Object.assign({}, item, { normalized:cls.normalized, kwType:cls.type, isNoise:cls.isNoise });
    })
    .filter(function(item){
      // 노이즈 및 news_event 제거
      if(item.isNoise) return false;
      if(item.kwType === CFG.KW_TYPE.NEWS_EVENT) return false;
      return true;
    });
}

// ════════════════════════════════════════════════════════════
// STEP 3: 문제/상황 → 제품 후보 변환
// ════════════════════════════════════════════════════════════
async function expandToProducts(filteredItems){
  var candidates = [];
  for(var i=0; i<filteredItems.length; i++){
    var item = filteredItems[i];
    var productNames;
    if(item.kwType === CFG.KW_TYPE.PROBLEM || item.kwType === CFG.KW_TYPE.SITUATION){
      productNames = await GROQ.mapKeywordToProducts(item.keyword, item.kwType).catch(function(){
        return GROQ.ruleBasedProductMapping(item.keyword);
      });
      await sleep(100);
    } else if(item.kwType === CFG.KW_TYPE.NEWS_EVENT || item.kwType === CFG.KW_TYPE.BRAND){
      continue;
    } else {
      productNames = [item.normalized || item.keyword];
    }
    productNames.forEach(function(pname){
      candidates.push({
        originalKeyword: item.keyword,
        productName:     pname,
        normalized:      item.normalized,
        kwType:          item.kwType,
        kw7d:            item.kw7d,
        kw24h:           item.kw24h,
        // 후처리에서 채워질 필드
        naverData: null, datalabData:null, insightData:null, ytData:null,
        groqFit:null, geminiBonus:null,
        isGeneralNoun:      !/[A-Za-z0-9]/.test(pname) && pname.length <= 10,
        isProblemSolving:   item.kwType===CFG.KW_TYPE.PROBLEM||item.kwType===CFG.KW_TYPE.SITUATION,
        isBrandDependent:   item.kwType===CFG.KW_TYPE.BRAND,
        isTemporaryTrend:   false,
        hasMedicalRisk:     /의약품|처방|진단|치료|수술/.test(pname),
        isHardToConvert:    item.kwType===CFG.KW_TYPE.ACTION||item.kwType===CFG.KW_TYPE.UNKNOWN,
        shopWeakVsSearch:   false,
        isShortsCompatible: false,
        isBlogCompatible:   false,
        isSeasonalFit:      false,
        scores: {}, finalScore:0, group:CFG.GROUP.C,
      });
    });
    if(i%5===0) await sleep(50);
  }
  // 중복 productName 제거
  var seen = {};
  return candidates.filter(function(c){
    if(seen[c.productName]) return false;
    seen[c.productName] = true;
    return true;
  });
}

// ════════════════════════════════════════════════════════════
// STEP 4: 외부 API 데이터 수집 (네이버 + YouTube)
// ════════════════════════════════════════════════════════════
async function collectExternalData(candidates, period, apiStatus){
  var productNames = candidates.map(function(c){ return c.productName; });

  // 네이버 배치 수집 (레이트 리밋 준수)
  var naverBatch = {};
  try{
    naverBatch = await NAVER.fetchNaverBatch(productNames, period);
    apiStatus.naver = '✅ '+productNames.length+'개 수집';
  }catch(e){
    console.error('[naver-batch]', e.message);
    apiStatus.naver = '❌ 실패: '+e.message;
  }
  await sleep(500);

  // YouTube 배치 수집
  var ytBatch = {};
  try{
    ytBatch = await YOUTUBE.fetchYouTubeBatch(productNames.slice(0,10));
    apiStatus.youtube = '✅ '+Object.keys(ytBatch).length+'개 수집';
  }catch(e){
    console.error('[youtube-batch]', e.message);
    apiStatus.youtube = '❌ 실패: '+e.message;
  }

  // 후보에 데이터 주입
  candidates.forEach(function(c){
    var nd = naverBatch[c.productName] || {};
    c.naverData   = nd.search  || null;
    c.datalabData = nd.datalab || null;
    c.insightData = nd.insight || null;
    c.ytData      = ytBatch[c.productName] || null;
    // YouTube 호환성 반영
    if(c.ytData){
      c.isShortsCompatible = c.ytData.isShortsCompatible;
      c.isBlogCompatible   = c.ytData.isBlogCompatible;
    }
    // 쇼핑 약세 여부
    if(c.naverData && c.datalabData){
      c.shopWeakVsSearch = !c.naverData.shoppingExists && (c.datalabData.surgeRate||0) > 20;
    }
  });
  return candidates;
}

// ════════════════════════════════════════════════════════════
// STEP 5: Groq/Gemini 보조 분석
// ════════════════════════════════════════════════════════════
async function enrichWithAI(candidates, apiStatus){
  // Groq: 제품 전환 적합성 (상위 10개만)
  for(var i=0; i<Math.min(candidates.length,10); i++){
    var c = candidates[i];
    try{
      c.groqFit = await GROQ.calcProductFitGroq(c.productName, c.kwType);
      await sleep(150);
    }catch(e){ c.groqFit = null; }
  }
  apiStatus.groq = '✅ Groq 보조 분석 완료';

  // Gemini: 신뢰 보정 (상위 10개만)
  for(var j=0; j<Math.min(candidates.length,10); j++){
    var c2 = candidates[j];
    try{
      c2.geminiBonus = await GEMINI.calcTrustBonusGemini(c2);
      await sleep(200);
    }catch(e){ c2.geminiBonus = null; }
  }
  apiStatus.gemini = '✅ Gemini 신뢰 보정 완료';

  return candidates;
}

// ════════════════════════════════════════════════════════════
// STEP 6: 점수 계산 + 정렬 + 그룹 분류
// ════════════════════════════════════════════════════════════
function scoreSortGroup(candidates){
  // 1차 채점
  candidates = candidates.map(function(c){ return SCORE.scoreCandidate(c); });
  // 점수순 정렬
  candidates.sort(function(a,b){ return b.finalScore-a.finalScore; });
  return candidates;
}

// ════════════════════════════════════════════════════════════
// STEP 7: 결과 설명 생성 (Groq 한줄 + Gemini 종합)
// ════════════════════════════════════════════════════════════
async function generateDescriptions(candidates){
  var top10 = candidates.slice(0,10);
  // Groq 이유 설명
  for(var i=0; i<top10.length; i++){
    try{
      var desc = await GROQ.generateReasonSummary(top10[i]);
      top10[i].groqReason = desc.reason || '';
      top10[i].shortsIdea = desc.shorts  || '';
      top10[i].blogIdea   = desc.blog    || '';
      await sleep(150);
    }catch(e){
      top10[i].groqReason = '';
      top10[i].shortsIdea = '';
      top10[i].blogIdea   = '';
    }
  }
  // Gemini 종합 설명 (상위 5개)
  for(var j=0; j<Math.min(top10.length,5); j++){
    try{
      top10[j].geminiExplanation = await GEMINI.explainWhyNow(top10[j]);
      await sleep(200);
    }catch(e){ top10[j].geminiExplanation = ''; }
  }
  // Gemini 전체 요약
  var summary = null;
  try{ summary = await GEMINI.mergeAndSummarizeSignals(top10); }catch(e){}
  // Gemini 최종 가이드
  var guide = '';
  try{ guide = await GEMINI.generateFinalNarrative(top10, summary); }catch(e){}

  return { candidates: top10, summary, guide };
}

// ════════════════════════════════════════════════════════════
// 핸들러
// ════════════════════════════════════════════════════════════
module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({error:'POST만 허용'});

  // 환경변수 확인
  if(!process.env.NAVER_CLIENT_ID||!process.env.NAVER_CLIENT_SECRET){
    return res.status(500).json({error:'NAVER 환경변수 누락'});
  }

  var body = '';
  req.on('data',function(c){body+=c;});
  req.on('end', async function(){
    try{
      var payload  = JSON.parse(body);
      var kw7d     = payload.kw7d   || [];   // [{keyword, searchVolume, increaseRate}]
      var kw24h    = payload.kw24h  || [];
      var period   = payload.period || 'week';
      var filters  = payload.filters || {};

      if(!kw7d.length && !kw24h.length){
        return res.status(400).json({error:'키워드 데이터가 없습니다'});
      }

      var apiStatus = {};

      // ── PIPELINE ──────────────────────────────────────────
      // STEP 1: 교차 맵
      var merged = buildKeywordMap(kw7d, kw24h);
      console.log('[trend-analyze] STEP1 merged:', merged.length);

      // STEP 2: 분류 + 노이즈 제거
      var filtered = await classifyAndFilter(merged);
      console.log('[trend-analyze] STEP2 filtered:', filtered.length);
      if(!filtered.length) return res.status(200).json({ candidates:[], apiStatus, error:'유효 키워드 없음' });

      // STEP 3: 제품 후보 확장
      var candidates = await expandToProducts(filtered);
      console.log('[trend-analyze] STEP3 candidates:', candidates.length);
      if(!candidates.length) return res.status(200).json({ candidates:[], apiStatus, error:'제품 후보 없음' });

      // STEP 4: 외부 API 수집 (상위 15개만 — 시간 절약)
      candidates = candidates.slice(0,15);
      candidates = await collectExternalData(candidates, period, apiStatus);

      // STEP 5: AI 보조 분석
      candidates = await enrichWithAI(candidates, apiStatus);

      // STEP 6: 점수 + 정렬 + 그룹
      candidates = scoreSortGroup(candidates);

      // 필터 적용
      if(filters.minFinalScore)    candidates = candidates.filter(function(c){return c.finalScore>=safeNum(filters.minFinalScore);});
      if(filters.minBuyIntent)     candidates = candidates.filter(function(c){return (c.scores.buyIntent||0)>=safeNum(filters.minBuyIntent);});
      if(filters.minShopping)      candidates = candidates.filter(function(c){return (c.scores.shoppingInterest||0)>=safeNum(filters.minShopping);});
      if(filters.minYoutube)       candidates = candidates.filter(function(c){return (c.scores.youtubeViral||0)>=safeNum(filters.minYoutube);});
      if(filters.shortsOnly)       candidates = candidates.filter(function(c){return c.isShortsCompatible;});
      if(filters.blogOnly)         candidates = candidates.filter(function(c){return c.isBlogCompatible;});
      if(filters.noBrand)          candidates = candidates.filter(function(c){return !c.isBrandDependent;});
      if(filters.generalNounOnly)  candidates = candidates.filter(function(c){return c.isGeneralNoun;});

      // STEP 7: 설명 생성
      var result = await generateDescriptions(candidates);

      // 그룹별 분류
      var groups = {
        [CFG.GROUP.A]: result.candidates.filter(function(c){return c.group===CFG.GROUP.A;}),
        [CFG.GROUP.B]: result.candidates.filter(function(c){return c.group===CFG.GROUP.B;}),
        [CFG.GROUP.C]: result.candidates.filter(function(c){return c.group===CFG.GROUP.C;}),
      };

      return res.status(200).json({
        candidates:  result.candidates,
        groups:      groups,
        summary:     result.summary,
        guide:       result.guide,
        apiStatus:   apiStatus,
        total:       result.candidates.length,
        updatedAt:   new Date().toISOString(),
      });

    }catch(e){
      console.error('[trend-analyze]', e.message, e.stack);
      return res.status(500).json({ error:'분석 중 오류', detail:e.message });
    }
  });
};
