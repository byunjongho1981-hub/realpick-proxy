var CFG     = require('./_trend-config');
var SCORE   = require('./_trend-score');
var NAVER   = require('./_trend-naver');
var YOUTUBE = require('./_trend-youtube');
var GROQ    = require('./_trend-groq');
var GEMINI  = require('./_trend-gemini');

function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }
function safeNum(v){ return isNaN(Number(v))?0:Number(v); }

// ════════════════════════════════════════════════════════════
// STEP 1: CSV 교차 맵 구성
// ════════════════════════════════════════════════════════════
function buildKeywordMap(kw7d, kw24h){
  var map = {};
  (kw7d||[]).forEach(function(item){
    var kw = (item.keyword||'').trim();
    if(!kw) return;
    map[kw] = {
      keyword: kw,
      kw7d:  { exists:true, searchVolume:safeNum(item.searchVolume), increaseRate:safeNum(item.increaseRate) },
      kw24h: { exists:false, searchVolume:0, increaseRate:0 },
    };
  });
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
// STEP 2: 키워드 분류 + 노이즈 제거 (Groq + 규칙 기반 폴백)
// ════════════════════════════════════════════════════════════
async function classifyAndFilter(keywordItems){
  var kwList = keywordItems.map(function(i){ return i.keyword; });
  var classified;
  try{
    classified = await GROQ.classifyKeywords(kwList);
  }catch(e){
    console.warn('[classify-fallback]', e.message);
    classified = kwList.map(function(kw){
      return {
        kw:       kw,
        normalized: kw,
        type:     GROQ.ruleBasedClassify(kw),
        isNoise:  CFG.NOISE_PATTERNS.some(function(p){return p.test(kw);}),
      };
    });
  }
  var classMap = {};
  (classified||[]).forEach(function(c){ classMap[c.kw] = c; });

  return keywordItems
    .map(function(item){
      var cls = classMap[item.keyword] || {
        kw:       item.keyword,
        normalized: item.keyword,
        type:     GROQ.ruleBasedClassify(item.keyword),
        isNoise:  CFG.NOISE_PATTERNS.some(function(p){return p.test(item.keyword);}),
      };
      return Object.assign({}, item, { normalized:cls.normalized, kwType:cls.type, isNoise:cls.isNoise });
    })
    .filter(function(item){
      return !item.isNoise && item.kwType !== CFG.KW_TYPE.NEWS_EVENT;
    });
}

// ════════════════════════════════════════════════════════════
// STEP 3: 문제/상황 → 제품 후보 확장
// ════════════════════════════════════════════════════════════
async function expandToProducts(filteredItems){
  var candidates = [];
  for(var i=0; i<filteredItems.length; i++){
    var item = filteredItems[i];
    // 브랜드·뉴스 제외
    if(item.kwType === CFG.KW_TYPE.BRAND || item.kwType === CFG.KW_TYPE.NEWS_EVENT) continue;

    var productNames;
    if(item.kwType === CFG.KW_TYPE.PROBLEM || item.kwType === CFG.KW_TYPE.SITUATION){
      try{
        productNames = await GROQ.mapKeywordToProducts(item.keyword, item.kwType);
      }catch(e){
        productNames = GROQ.ruleBasedProductMapping(item.keyword);
      }
      await sleep(100);
    } else {
      productNames = [item.normalized || item.keyword];
    }

    productNames.forEach(function(pname){
      if(!pname || !pname.trim()) return;
      candidates.push({
        originalKeyword: item.keyword,
        productName:     pname.trim(),
        normalized:      item.normalized,
        kwType:          item.kwType,
        kw7d:            item.kw7d,
        kw24h:           item.kw24h,
        naverData:       null, datalabData:null, insightData:null, ytData:null,
        groqFit:         null, geminiBonus:null,
        isGeneralNoun:      !/[A-Za-z0-9]/.test(pname) && pname.length <= 10,
        isProblemSolving:   item.kwType===CFG.KW_TYPE.PROBLEM || item.kwType===CFG.KW_TYPE.SITUATION,
        isBrandDependent:   item.kwType===CFG.KW_TYPE.BRAND,
        isTemporaryTrend:   false,
        hasMedicalRisk:     /의약품|처방|진단|치료|수술/.test(pname),
        isHardToConvert:    item.kwType===CFG.KW_TYPE.ACTION || item.kwType===CFG.KW_TYPE.UNKNOWN,
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
// STEP 4: 외부 API 데이터 수집
// ════════════════════════════════════════════════════════════
async function collectExternalData(candidates, period, apiStatus){
  var productNames = candidates.map(function(c){ return c.productName; });

  // 네이버 배치 (레이트 리밋 준수)
  var naverBatch = {};
  try{
    naverBatch = await NAVER.fetchNaverBatch(productNames, period);
    apiStatus.naver = '✅ '+productNames.length+'개 수집';
  }catch(e){
    console.error('[naver-batch]', e.message);
    apiStatus.naver = '❌ 실패: '+e.message;
  }
  await sleep(500);

  // YouTube 배치 (상위 10개)
  var ytBatch = {};
  try{
    ytBatch = await YOUTUBE.fetchYouTubeBatch(productNames.slice(0,10));
    apiStatus.youtube = '✅ '+Object.keys(ytBatch).length+'개 수집';
  }catch(e){
    console.error('[youtube-batch]', e.message);
    apiStatus.youtube = '❌ 실패: '+e.message;
  }

  // 데이터 주입
  candidates.forEach(function(c){
    var nd = naverBatch[c.productName] || {};
    c.naverData   = nd.search  || null;
    c.datalabData = nd.datalab || null;
    c.insightData = nd.insight || null;
    c.ytData      = ytBatch[c.productName] || null;
    if(c.ytData){
      c.isShortsCompatible = !!c.ytData.isShortsCompatible;
      c.isBlogCompatible   = !!c.ytData.isBlogCompatible;
    }
    // 쇼핑 약세 여부
    if(c.naverData && c.datalabData){
      c.shopWeakVsSearch = !c.naverData.shoppingExists && safeNum(c.datalabData.surgeRate) > 20;
    }
  });
  return candidates;
}

// ════════════════════════════════════════════════════════════
// STEP 5: Groq 보조 분석 (제품 전환 적합성)
// ★ 버그2 수정: Gemini는 점수 계산(STEP6) 이후에 호출
// ════════════════════════════════════════════════════════════
async function enrichWithGroq(candidates, apiStatus){
  for(var i=0; i<Math.min(candidates.length,10); i++){
    var c = candidates[i];
    try{
      c.groqFit = await GROQ.calcProductFitGroq(c.productName, c.kwType);
      await sleep(150);
    }catch(e){ c.groqFit = null; }
  }
  apiStatus.groq = '✅ Groq 제품적합성 분석 완료';
  return candidates;
}

// ════════════════════════════════════════════════════════════
// STEP 6: 점수 계산 + 정렬 + 그룹 분류
// ════════════════════════════════════════════════════════════
function scoreSortGroup(candidates){
  candidates = candidates.map(function(c){ return SCORE.scoreCandidate(c); });
  candidates.sort(function(a,b){ return b.finalScore-a.finalScore; });
  return candidates;
}

// ════════════════════════════════════════════════════════════
// STEP 7: Gemini 신뢰 보정 (★ 점수 계산 후 실행)
// ════════════════════════════════════════════════════════════
async function enrichWithGemini(candidates, apiStatus){
  for(var j=0; j<Math.min(candidates.length,10); j++){
    var c = candidates[j];
    try{
      c.geminiBonus = await GEMINI.calcTrustBonusGemini(c);
      // Gemini 보정을 trustBonus에 반영 후 최종점수 재계산
      if(c.geminiBonus && typeof c.geminiBonus.adjustment === 'number'){
        var adj = safeNum(c.geminiBonus.adjustment);
        c.scores.trustBonus = Math.min(100, Math.max(0, safeNum(c.scores.trustBonus) + adj));
        // 최종점수도 보정
        c.finalScore = Math.min(100, Math.max(0, safeNum(c.finalScore) + Math.round(adj * CFG.WEIGHTS.trustBonus)));
      }
      await sleep(200);
    }catch(e){ c.geminiBonus = null; }
  }
  // Gemini 보정 후 재정렬
  candidates.sort(function(a,b){ return b.finalScore-a.finalScore; });
  apiStatus.gemini = '✅ Gemini 신뢰 보정 완료';
  return candidates;
}

// ════════════════════════════════════════════════════════════
// STEP 8: 결과 설명 생성 (Groq 한줄 + Gemini 종합)
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
      top10[i].groqReason = top10[i].productName+'의 상승 트렌드가 확인됨. 즉시 콘텐츠 제작 권장.';
      top10[i].shortsIdea = top10[i].productName+' 사용 전후 비교 쇼츠';
      top10[i].blogIdea   = top10[i].productName+' 추천 TOP5 + 가격비교';
    }
  }

  // Gemini: 상위 5개 "왜 지금인지" 설명
  for(var j=0; j<Math.min(top10.length,5); j++){
    try{
      top10[j].geminiExplanation = await GEMINI.explainWhyNow(top10[j]);
      await sleep(200);
    }catch(e){ top10[j].geminiExplanation = ''; }
  }

  // Gemini: 전체 요약
  var summary = null;
  try{ summary = await GEMINI.mergeAndSummarizeSignals(top10); }catch(e){}

  // Gemini: 실행 가이드
  var guide = '';
  try{ guide = await GEMINI.generateFinalNarrative(top10, summary); }catch(e){
    guide = 'TOP 후보 제품으로 쇼츠 영상을 먼저 제작하고\n블로그 리뷰로 검색 트래픽을 확보하세요.\n쿠팡 파트너스 링크를 삽입하여 제휴 수익을 창출하세요.';
  }

  return { candidates:top10, summary:summary, guide:guide };
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

  if(!process.env.NAVER_CLIENT_ID||!process.env.NAVER_CLIENT_SECRET){
    return res.status(500).json({error:'NAVER 환경변수 누락'});
  }

  var body='';
  req.on('data',function(c){body+=c;});
  req.on('end', async function(){
    try{
      var payload  = JSON.parse(body);
      var kw7d     = payload.kw7d   || [];
      var kw24h    = payload.kw24h  || [];
      var period   = payload.period || 'week';
      var filters  = payload.filters || {};
      var maxCount = safeNum(payload.maxCount) || 10;

      if(!kw7d.length && !kw24h.length){
        return res.status(400).json({error:'키워드 데이터가 없습니다'});
      }

      var apiStatus = {};

      // ── PIPELINE ──────────────────────────────────────────
      // STEP1: 교차 맵
      var merged = buildKeywordMap(kw7d, kw24h);
      console.log('[STEP1] merged:', merged.length);

      // STEP2: 분류 + 노이즈 제거
      var filtered = await classifyAndFilter(merged);
      console.log('[STEP2] filtered:', filtered.length);
      if(!filtered.length) return res.status(200).json({candidates:[],apiStatus:apiStatus,error:'유효 키워드 없음'});

      // STEP3: 제품 후보 확장
      var candidates = await expandToProducts(filtered);
      console.log('[STEP3] candidates:', candidates.length);
      if(!candidates.length) return res.status(200).json({candidates:[],apiStatus:apiStatus,error:'제품 후보 없음'});

      // STEP4: 외부 API 수집 (최대 15개)
      candidates = candidates.slice(0,15);
      candidates = await collectExternalData(candidates, period, apiStatus);
      console.log('[STEP4] external data collected');

      // STEP5: Groq 제품 적합성
      candidates = await enrichWithGroq(candidates, apiStatus);
      console.log('[STEP5] Groq enriched');

      // STEP6: 점수 계산 + 정렬 (★ Gemini 전에 실행)
      candidates = scoreSortGroup(candidates);
      console.log('[STEP6] scored');

      // STEP7: Gemini 신뢰 보정 (★ 점수 계산 후 실행)
      candidates = await enrichWithGemini(candidates, apiStatus);
      console.log('[STEP7] Gemini enriched');

      // 필터 적용
      if(safeNum(filters.minFinalScore)>0)  candidates=candidates.filter(function(c){return c.finalScore>=safeNum(filters.minFinalScore);});
      if(safeNum(filters.minBuyIntent)>0)   candidates=candidates.filter(function(c){return safeNum(c.scores.buyIntent)>=safeNum(filters.minBuyIntent);});
      if(safeNum(filters.minShopping)>0)    candidates=candidates.filter(function(c){return safeNum(c.scores.shoppingInterest)>=safeNum(filters.minShopping);});
      if(safeNum(filters.minYoutube)>0)     candidates=candidates.filter(function(c){return safeNum(c.scores.youtubeViral)>=safeNum(filters.minYoutube);});
      if(filters.shortsOnly)                candidates=candidates.filter(function(c){return c.isShortsCompatible;});
      if(filters.blogOnly)                  candidates=candidates.filter(function(c){return c.isBlogCompatible;});
      if(filters.noBrand)                   candidates=candidates.filter(function(c){return !c.isBrandDependent;});
      if(filters.generalNounOnly)           candidates=candidates.filter(function(c){return c.isGeneralNoun;});
      candidates = candidates.slice(0, Math.max(maxCount,5));

      // STEP8: 설명 생성
      var result = await generateDescriptions(candidates);
      console.log('[STEP8] descriptions generated');

      // 그룹별 분류
      var groups = {};
      groups[CFG.GROUP.A] = result.candidates.filter(function(c){return c.group===CFG.GROUP.A;});
      groups[CFG.GROUP.B] = result.candidates.filter(function(c){return c.group===CFG.GROUP.B;});
      groups[CFG.GROUP.C] = result.candidates.filter(function(c){return c.group===CFG.GROUP.C;});

      return res.status(200).json({
        candidates: result.candidates,
        groups:     groups,
        summary:    result.summary,
        guide:      result.guide,
        apiStatus:  apiStatus,
        total:      result.candidates.length,
        updatedAt:  new Date().toISOString(),
      });

    }catch(e){
      console.error('[trend-analyze]', e.message, e.stack);
      return res.status(500).json({error:'분석 중 오류', detail:e.message});
    }
  });
};
