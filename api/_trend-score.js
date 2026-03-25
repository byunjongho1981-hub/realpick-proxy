var CFG = require('./_trend-config');

function safeNum(v){ var n=Number(v); return isNaN(n)?0:n; }
function norm(v,max){ return Math.min(Math.max(safeNum(v)/Math.max(max,1)*100,0),100); }
function clamp(v){ return Math.min(Math.max(safeNum(v),0),100); }

// ── ★ 전체검색 의도 점수 (가중치 20%) ────────────────────────
function calcSearchIntent(searchIntentData){
  if(!searchIntentData) return 30;
  return clamp(safeNum(searchIntentData.score)||30);
}

// ── 지속성 (CSV 7일) ─────────────────────────────────────────
function calcPersistence(kw7d){
  if(!kw7d) return 0;
  var s=kw7d.exists?40:0;
  if(kw7d.searchVolume>0) s+=norm(kw7d.searchVolume,200)*0.4;
  if(kw7d.increaseRate>0) s+=norm(kw7d.increaseRate,500)*0.2;
  return clamp(s);
}

// ── 최근 상승 (CSV 24h) ──────────────────────────────────────
function calcRecentRise(kw24h,kw7d){
  if(!kw24h||!kw24h.exists) return kw7d&&kw7d.exists?20:0;
  var base=50;
  if(kw24h.increaseRate>0) base+=norm(kw24h.increaseRate,500)*0.3;
  if(kw24h.searchVolume>0) base+=norm(kw24h.searchVolume,200)*0.2;
  if(kw7d&&kw7d.exists)    base+=20;
  return clamp(base);
}

// ── 구매 의도 (네이버 검색 API) ──────────────────────────────
function calcBuyIntent(naverData){
  if(!naverData) return 30;
  var s=0;
  if(naverData.shoppingExists)    s+=25;
  if(naverData.blogCount>0)       s+=norm(naverData.blogCount,50000)*0.2;
  if(naverData.buyIntentHits>0)   s+=norm(naverData.buyIntentHits,10)*0.4;
  if(naverData.newsCount>naverData.blogCount*2) s-=15;
  return clamp(s);
}

// ── 데이터랩 추세 ─────────────────────────────────────────────
function calcDatalabTrend(datalabData){
  if(!datalabData) return 30;
  var s=30;
  if(datalabData.surgeRate>50)      s+=40;
  else if(datalabData.surgeRate>20) s+=25;
  else if(datalabData.surgeRate>0)  s+=10;
  else if(datalabData.surgeRate<-10)s-=20;
  if(datalabData.accel>20)          s+=15;
  if(datalabData.durability>60)     s+=10;
  return clamp(s);
}

// ── 쇼핑인사이트 (가중치 22%) ────────────────────────────────
function calcShoppingInterest(insightData){
  if(!insightData) return 30;
  var s=30;
  if(insightData.clickSurge>30)        s+=35;
  else if(insightData.clickSurge>10)   s+=20;
  if(insightData.clickAccel>10)        s+=15;
  if(insightData.shopTrend==='hot')    s+=20;
  if(insightData.shopTrend==='falling')s-=20;
  return clamp(s);
}

// ── 유튜브 확산성 ─────────────────────────────────────────────
function calcYoutubeViral(ytData){
  if(!ytData) return 30;
  var s=0;
  if(ytData.recentCount>20)       s+=30;
  else if(ytData.recentCount>5)   s+=15;
  else if(ytData.recentCount>0)   s+=5;
  if(ytData.avgViralScore>1000)   s+=30;
  else if(ytData.avgViralScore>100)s+=15;
  if(ytData.hasShorts)            s+=20;
  if(ytData.avgViralScore<10)     s-=10;
  return clamp(s);
}

// ── 제품 전환 적합성 ──────────────────────────────────────────
function calcProductFit(kwType,groqFit){
  var typeScore={product_direct:80,general_product:70,problem:65,situation:55,action:50,unknown:40,brand:30,news_event:10};
  var base=typeScore[kwType]||40;
  if(groqFit&&typeof groqFit.score==='number') base=Math.round((base+safeNum(groqFit.score))/2);
  return clamp(base);
}

// ── 신뢰 보정 (bonus/penalty — 가중치 없음) ──────────────────
function calcTrustBonus(candidate,computedScores,geminiBonus){
  var s=50;
  if(candidate.isGeneralNoun)      s+=15;
  if(candidate.isProblemSolving)   s+=15;
  if(candidate.isShortsCompatible) s+=10;
  if(candidate.isBlogCompatible)   s+=10;
  if(candidate.isSeasonalFit)      s+=5;
  if(candidate.isBrandDependent)   s-=20;
  if(candidate.isTemporaryTrend)   s-=20;
  if(candidate.hasMedicalRisk)     s-=30;
  if(candidate.isHardToConvert)    s-=15;
  if(candidate.shopWeakVsSearch)   s-=10;
  if(computedScores){
    if(safeNum(computedScores.buyIntent)>=70)        s+=5;
    if(safeNum(computedScores.shoppingInterest)>=70) s+=5;
    if(safeNum(computedScores.searchIntent)>=70)     s+=5;  // ★
  }
  if(geminiBonus&&typeof geminiBonus.adjustment==='number') s+=safeNum(geminiBonus.adjustment);
  return clamp(s);
}

// ── bonus/penalty ─────────────────────────────────────────────
function applyBonusPenalty(candidate){
  var bonus=0,penalty=0;
  if(candidate.isProblemSolving)   bonus+=3;
  if(candidate.isGeneralNoun)      bonus+=2;
  if(candidate.isShortsCompatible) bonus+=2;
  if(candidate.isBlogCompatible)   bonus+=2;
  if(candidate.isSeasonalFit)      bonus+=1;
  if(candidate.isBrandDependent)   penalty+=5;
  if(candidate.isTemporaryTrend)   penalty+=8;
  if(candidate.hasMedicalRisk)     penalty+=10;
  if(candidate.isHardToConvert)    penalty+=5;
  if(candidate.shopWeakVsSearch)   penalty+=3;
  return {bonus,penalty};
}

// ── 최종 점수 (설계서 v2 가중치) ─────────────────────────────
function calcFinalScore(candidate){
  var W=CFG.WEIGHTS, s=candidate.scores;
  var raw=
    W.shoppingInterest * safeNum(s.shoppingInterest) +
    W.searchIntent     * safeNum(s.searchIntent)     +
    W.buyIntent        * safeNum(s.buyIntent)         +
    W.datalabTrend     * safeNum(s.datalabTrend)     +
    W.youtubeViral     * safeNum(s.youtubeViral)      +
    W.persistence      * safeNum(s.persistence)       +
    W.recentRise       * safeNum(s.recentRise)        +
    W.productFit       * safeNum(s.productFit);
  // trustBonus: ±직접 가감 (최대 ±5점)
  var trustAdj=Math.max(-5,Math.min(5,Math.round((safeNum(s.trustBonus)-50)/10)));
  var bp=applyBonusPenalty(candidate);
  return clamp(Math.round(raw+bp.bonus-bp.penalty+trustAdj));
}

// ── 그룹 분류 (searchIntent 포함) ────────────────────────────
function classifyGroup(candidate){
  var s=candidate.scores;
  var h24=candidate.kw24h&&candidate.kw24h.exists;
  var h7d=candidate.kw7d &&candidate.kw7d.exists;
  // 카테고리 모드에서는 CSV 없으므로 shoppingInterest+searchIntent 기준
  var shopStrong   = safeNum(s.shoppingInterest)>=50;
  var intentStrong = safeNum(s.searchIntent)>=55;
  var buyStrong    = safeNum(s.buyIntent)>=45;
  var dlStrong     = safeNum(s.datalabTrend)>=45;

  // GROUP A: 최우선 트렌드
  if(shopStrong&&intentStrong&&buyStrong&&(dlStrong||(h7d&&h24))) return CFG.GROUP.A;
  // GROUP B: 안정형
  if((shopStrong||intentStrong)&&buyStrong) return CFG.GROUP.B;
  return CFG.GROUP.C;
}

// ── 전체 채점 ─────────────────────────────────────────────────
function scoreCandidate(candidate){
  var productFit=calcProductFit(candidate.kwType,candidate.groqFit);
  var partial={
    persistence:      calcPersistence(candidate.kw7d),
    recentRise:       calcRecentRise(candidate.kw24h,candidate.kw7d),
    searchIntent:     calcSearchIntent(candidate.searchIntentData),  // ★
    buyIntent:        calcBuyIntent(candidate.naverData),
    datalabTrend:     calcDatalabTrend(candidate.datalabData),
    shoppingInterest: calcShoppingInterest(candidate.insightData),
    youtubeViral:     calcYoutubeViral(candidate.ytData),
    productFit:       productFit,
  };
  partial.trustBonus=calcTrustBonus(candidate,partial,candidate.geminiBonus);
  // searchIntentType도 저장 (프론트 표시용)
  if(candidate.searchIntentData) candidate.searchIntentType=candidate.searchIntentData.type;
  candidate.scores     = partial;
  candidate.finalScore = calcFinalScore(candidate);
  candidate.group      = classifyGroup(candidate);
  return candidate;
}

module.exports = {
  scoreCandidate,
  calcSearchIntent,
  calcPersistence,calcRecentRise,calcBuyIntent,
  calcDatalabTrend,calcShoppingInterest,
  calcYoutubeViral,calcProductFit,calcTrustBonus,
  calcFinalScore,classifyGroup,
};
