var CFG = require('./_trend-config');

// ── 유틸 ─────────────────────────────────────────────────────
function safeNum(v){ var n=Number(v); return isNaN(n)?0:n; }
function norm(v, max){ return Math.min(Math.max(safeNum(v)/Math.max(max,1)*100,0),100); }
function clamp(v){ return Math.min(Math.max(safeNum(v),0),100); }

// ── 지속성 점수 (7일 CSV) ────────────────────────────────────
function calcPersistence(kw7d){
  if(!kw7d) return 0;
  var baseScore = kw7d.exists ? 40 : 0;
  var riseScore = 0;
  if(kw7d.searchVolume > 0)  riseScore += norm(kw7d.searchVolume, 200) * 0.4;
  if(kw7d.increaseRate > 0)  riseScore += norm(kw7d.increaseRate, 500) * 0.2;
  return clamp(baseScore + riseScore);
}

// ── 최근 상승 점수 (24시간 CSV) ──────────────────────────────
function calcRecentRise(kw24h, kw7d){
  if(!kw24h || !kw24h.exists) return kw7d&&kw7d.exists ? 20 : 0;
  var base = 50;
  if(kw24h.increaseRate > 0) base += norm(kw24h.increaseRate, 500) * 0.3;
  if(kw24h.searchVolume > 0) base += norm(kw24h.searchVolume, 200) * 0.2;
  if(kw7d && kw7d.exists)    base += 20;
  return clamp(base);
}

// ── 구매 의도 점수 (네이버 검색 API) ─────────────────────────
function calcBuyIntent(naverData){
  if(!naverData) return 30;
  var score = 0;
  if(naverData.shoppingExists)    score += 25;
  if(naverData.blogCount > 0)     score += norm(naverData.blogCount, 50000) * 0.2;
  if(naverData.buyIntentHits > 0) score += norm(naverData.buyIntentHits, 10) * 0.4;
  if(naverData.newsCount > naverData.blogCount * 2) score -= 15;
  return clamp(score);
}

// ── 데이터랩 추세 점수 ───────────────────────────────────────
function calcDatalabTrend(datalabData){
  if(!datalabData) return 30;
  var score = 30;
  if(datalabData.surgeRate > 50)       score += 40;
  else if(datalabData.surgeRate > 20)  score += 25;
  else if(datalabData.surgeRate > 0)   score += 10;
  else if(datalabData.surgeRate < -10) score -= 20;
  if(datalabData.accel > 20)           score += 15;
  if(datalabData.durability > 60)      score += 10;
  return clamp(score);
}

// ── 쇼핑인사이트 점수 ────────────────────────────────────────
function calcShoppingInterest(insightData){
  if(!insightData) return 30;
  var score = 30;
  if(insightData.clickSurge > 30)         score += 35;
  else if(insightData.clickSurge > 10)    score += 20;
  if(insightData.clickAccel > 10)         score += 15;
  if(insightData.shopTrend === 'hot')     score += 20;
  if(insightData.shopTrend === 'falling') score -= 20;
  return clamp(score);
}

// ── 유튜브 확산성 점수 ───────────────────────────────────────
function calcYoutubeViral(ytData){
  if(!ytData) return 30;
  var score = 0;
  if(ytData.recentCount > 20)          score += 30;
  else if(ytData.recentCount > 5)      score += 15;
  else if(ytData.recentCount > 0)      score += 5;
  if(ytData.avgViralScore > 1000)      score += 30;
  else if(ytData.avgViralScore > 100)  score += 15;
  if(ytData.hasShorts)                 score += 20;
  if(ytData.avgViralScore < 10)        score -= 10;
  return clamp(score);
}

// ── 제품 전환 적합성 점수 (규칙 기반 + Groq 보조) ──────────
function calcProductFit(kwType, groqFit){
  var typeScore = {
    product_direct:  80, general_product: 70, problem: 65,
    situation:       55, action:          50, unknown: 40,
    brand:           30, news_event:      10,
  };
  var base = typeScore[kwType] || 40;
  if(groqFit && typeof groqFit.score === 'number'){
    base = Math.round((base + safeNum(groqFit.score)) / 2);
  }
  return clamp(base);
}

// ── 종합 설명 신뢰 보정 점수 ─────────────────────────────────
// ★ 버그2 수정: scores 파라미터를 별도 전달받음 (미계산 상태에서 접근 금지)
function calcTrustBonus(candidate, computedScores, geminiBonus){
  var score = 50;
  // 후보 속성 기반 가점/감점
  if(candidate.isGeneralNoun)      score += 15;
  if(candidate.isProblemSolving)   score += 15;
  if(candidate.isShortsCompatible) score += 10;
  if(candidate.isBlogCompatible)   score += 10;
  if(candidate.isSeasonalFit)      score += 5;
  if(candidate.isBrandDependent)   score -= 20;
  if(candidate.isTemporaryTrend)   score -= 20;
  if(candidate.hasMedicalRisk)     score -= 30;
  if(candidate.isHardToConvert)    score -= 15;
  if(candidate.shopWeakVsSearch)   score -= 10;
  // 이미 계산된 점수 기반 보정 (외부에서 전달)
  if(computedScores){
    if(safeNum(computedScores.buyIntent) >= 70)       score += 5;
    if(safeNum(computedScores.shoppingInterest) >= 70) score += 5;
  }
  // Gemini 보조 보정
  if(geminiBonus && typeof geminiBonus.adjustment === 'number'){
    score += safeNum(geminiBonus.adjustment);
  }
  return clamp(score);
}

// ── 보조 가점/감점 ────────────────────────────────────────────
function applyBonusPenalty(candidate){
  var bonus = 0, penalty = 0;
  if(candidate.isProblemSolving)   bonus   += 3;
  if(candidate.isGeneralNoun)      bonus   += 2;
  if(candidate.isShortsCompatible) bonus   += 2;
  if(candidate.isBlogCompatible)   bonus   += 2;
  if(candidate.isSeasonalFit)      bonus   += 1;
  if(candidate.isBrandDependent)   penalty += 5;
  if(candidate.isTemporaryTrend)   penalty += 8;
  if(candidate.hasMedicalRisk)     penalty += 10;
  if(candidate.isHardToConvert)    penalty += 5;
  if(candidate.shopWeakVsSearch)   penalty += 3;
  return { bonus:bonus, penalty:penalty };
}

// ── 최종 점수 계산 ────────────────────────────────────────────
function calcFinalScore(candidate){
  var W = CFG.WEIGHTS;
  var s = candidate.scores;
  var raw =
    W.persistence      * safeNum(s.persistence)      +
    W.recentRise       * safeNum(s.recentRise)        +
    W.buyIntent        * safeNum(s.buyIntent)          +
    W.datalabTrend     * safeNum(s.datalabTrend)      +
    W.shoppingInterest * safeNum(s.shoppingInterest)  +
    W.youtubeViral     * safeNum(s.youtubeViral)      +
    W.productFit       * safeNum(s.productFit)        +
    W.trustBonus       * safeNum(s.trustBonus);
  var bp = applyBonusPenalty(candidate);
  return clamp(Math.round(raw + bp.bonus - bp.penalty));
}

// ── 그룹 분류 ────────────────────────────────────────────────
function classifyGroup(candidate){
  var s     = candidate.scores;
  var has7d = candidate.kw7d  && candidate.kw7d.exists;
  var h24h  = candidate.kw24h && candidate.kw24h.exists;
  if(has7d && h24h &&
     safeNum(s.buyIntent)>=50 &&
     safeNum(s.datalabTrend)>=45 &&
     safeNum(s.shoppingInterest)>=45) return CFG.GROUP.A;
  if(has7d && safeNum(s.shoppingInterest)>=40 && safeNum(s.buyIntent)>=40) return CFG.GROUP.B;
  return CFG.GROUP.C;
}

// ── 전체 채점 (★ 순서 중요: productFit → 나머지 → trustBonus) ─
function scoreCandidate(candidate){
  // 1차: productFit은 groqFit만 필요 (scores 불필요)
  var productFit = calcProductFit(candidate.kwType, candidate.groqFit);

  // 2차: 나머지 6개 점수 계산
  var partialScores = {
    persistence:      calcPersistence(candidate.kw7d),
    recentRise:       calcRecentRise(candidate.kw24h, candidate.kw7d),
    buyIntent:        calcBuyIntent(candidate.naverData),
    datalabTrend:     calcDatalabTrend(candidate.datalabData),
    shoppingInterest: calcShoppingInterest(candidate.insightData),
    youtubeViral:     calcYoutubeViral(candidate.ytData),
    productFit:       productFit,
  };

  // 3차: trustBonus — 이미 계산된 partialScores 전달 (버그2 수정)
  partialScores.trustBonus = calcTrustBonus(candidate, partialScores, candidate.geminiBonus);

  candidate.scores     = partialScores;
  candidate.finalScore = calcFinalScore(candidate);
  candidate.group      = classifyGroup(candidate);
  return candidate;
}

module.exports = {
  scoreCandidate,
  calcPersistence, calcRecentRise, calcBuyIntent,
  calcDatalabTrend, calcShoppingInterest,
  calcYoutubeViral, calcProductFit, calcTrustBonus,
  calcFinalScore, classifyGroup,
};
