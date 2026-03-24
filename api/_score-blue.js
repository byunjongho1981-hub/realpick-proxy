// velocity 없어도 다른 신호로 블루오션 계산 가능하도록 개편

function detectPhase(data){
  var searchSurge = data.searchSurge || 0;
  var blogCount   = data.blogCount   || 0;
  var cafeCount   = data.cafeCount   || 0;
  var newsCount   = data.newsCount   || 0;
  var ytSurge     = data.ytSurge     || 0;
  var snsSurge    = data.snsSurge    || 0;

  if(cafeCount < 500 && blogCount < 2000 && (snsSurge > 0 || cafeCount > 50)){
    return { phase:'태동기', emoji:'🌱', peakHours:48, urgency:'극히 빠름' };
  }
  if(searchSurge >= 30 && blogCount < 10000 && ytSurge >= 20){
    return { phase:'성장기', emoji:'🚀', peakHours:72, urgency:'빠름' };
  }
  if(newsCount > 100 || blogCount > 20000){
    return { phase:'성숙기', emoji:'📈', peakHours:120, urgency:'보통' };
  }
  if(searchSurge < -10){
    return { phase:'쇠퇴기', emoji:'📉', peakHours:null, urgency:'패스' };
  }
  return { phase:'성장기', emoji:'🚀', peakHours:72, urgency:'빠름' };
}

function calcBlueOcean(data){
  var searchSurge  = data.searchSurge  || 0;
  var ytScore      = data.ytScore      || 0;
  var coupangSurge = data.coupangSurge || 0;
  var snsScore     = data.snsScore     || 0;
  var overseasScore= data.hasOverseas  ? 100 : 0;
  var blogCount    = Math.max(0, data.blogCount || 0);

  // 각 항목 0~100 정규화
  var norm = function(v, max){ return Math.min(Math.max(v,0) / max * 100, 100); };

  var searchNorm  = norm(searchSurge,  100); // surgeRate 100% = 만점
  var coupangNorm = norm(coupangSurge, 30);  // 30단계 급등 = 만점

  // 가중합 (합계 최대 100)
  var raw = searchNorm   * 0.25
          + ytScore      * 0.25
          + coupangNorm  * 0.20
          + snsScore     * 0.20
          + overseasScore* 0.10;

  // 공급량으로 나누기 (블로그 많을수록 레드오션)
  var supply = blogCount * 0.005 + 1; // 기존 0.01 → 0.005 (완화)
  var bo = Math.round((raw / supply) * 10) / 10;

  var label, emoji;
  if(bo >= 5)      { label='극강 블루오션'; emoji='🔥'; }
  else if(bo >= 2) { label='블루오션';     emoji='✅'; }
  else if(bo >= 1) { label='경쟁 시작';   emoji='⚠️'; }
  else             { label='레드오션';    emoji='❌'; }

  return { score:bo, label:label, emoji:emoji };
}

module.exports = { detectPhase, calcBlueOcean };
