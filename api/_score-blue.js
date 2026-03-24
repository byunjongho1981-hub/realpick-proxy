// 단계 판정: 태동기 / 성장기 / 성숙기 / 쇠퇴기
function detectPhase(data){
  var searchSurge = data.searchSurge || 0;
  var blogCount   = data.blogCount   || 0;
  var cafeCount   = data.cafeCount   || 0;
  var newsCount   = data.newsCount   || 0;
  var ytSurge     = data.ytSurge     || 0;
  var snsSurge    = data.snsSurge    || 0;

  // 태동기: 카페/SNS 반응 있으나 블로그·뉴스 적음
  if(cafeCount < 500 && blogCount < 2000 && (snsSurge > 0 || cafeCount > 50)){
    return { phase:'태동기', emoji:'🌱', peakHours:48, urgency:'극히 빠름' };
  }
  // 성장기: 검색량 급증, 블로그 증가 시작
  if(searchSurge >= 30 && blogCount < 10000 && ytSurge >= 20){
    return { phase:'성장기', emoji:'🚀', peakHours:72, urgency:'빠름' };
  }
  // 성숙기: 뉴스 언급, 블로그 많음
  if(newsCount > 100 || blogCount > 20000){
    return { phase:'성숙기', emoji:'📈', peakHours:120, urgency:'보통' };
  }
  // 쇠퇴기
  if(searchSurge < -10){
    return { phase:'쇠퇴기', emoji:'📉', peakHours:null, urgency:'패스' };
  }
  return { phase:'성장기', emoji:'🚀', peakHours:72, urgency:'빠름' };
}

// 블루오션 스코어
// BO = (검색증가×0.3 + 유튜브×0.2 + 쿠팡순위×0.2 + SNS×0.2 + 해외×0.1)
//       ÷ (blogCount×0.01 + 1)
// 5이상 → 극강 블루오션 / 2~5 → 블루오션 / 1~2 → 경쟁시작 / 1미만 → 레드오션
function calcBlueOcean(data){
  var searchSurge   = Math.max(0, data.searchSurge   || 0);
  var ytSurge       = Math.max(0, data.ytSurge       || 0);
  var coupangSurge  = Math.max(0, data.coupangSurge  || 0);
  var snsSurge      = Math.max(0, data.snsSurge      || 0);
  var overseasScore = data.hasOverseas ? 50 : 0;
  var blogCount     = Math.max(0, data.blogCount     || 0);

  var norm = function(v, max){ return Math.min(v / max * 100, 100); };
  var s = searchSurge          * 0.30
        + norm(ytSurge, 200)   * 0.20
        + norm(coupangSurge, 50) * 0.20
        + norm(snsSurge, 100)  * 0.20
        + norm(overseasScore, 100) * 0.10;

  var supply = blogCount * 0.01 + 1;
  var bo = Math.round((s / supply) * 10) / 10;

  var label, emoji;
  if(bo >= 5)      { label='극강 블루오션'; emoji='🔥'; }
  else if(bo >= 2) { label='블루오션';     emoji='✅'; }
  else if(bo >= 1) { label='경쟁 시작';   emoji='⚠️'; }
  else             { label='레드오션';    emoji='❌'; }

  return { score:bo, label:label, emoji:emoji };
}

module.exports = { detectPhase, calcBlueOcean };
