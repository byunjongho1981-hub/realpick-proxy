var CFG = require('./_config');

var COMMERCIAL_KW = ['추천','선물','구매','최저가','할인','세트','묶음','증정','인기'];
var REVIEW_KW     = ['후기','리뷰','사용후기','솔직','평점','별점'];

function calcSurgeScore(v){
  if(!v) return 0;
  if(v.surgeRate>=50) return 20;
  if(v.surgeRate>=20) return 10;
  if(v.surgeRate>=0)  return 5;
  return 0;
}

function calcCommercialScore(kw, result, intent){
  var s=0, kwLow=kw.toLowerCase();
  if(result.items.length>=10) s+=8; else if(result.items.length>=1) s+=4;
  var priced=result.items.filter(function(i){return i.price>0;});
  if(priced.length>=5) s+=6; else if(priced.length>=1) s+=3;
  if(REVIEW_KW.some(function(w){return kwLow.indexOf(w)>-1;})) s+=3;
  if(COMMERCIAL_KW.some(function(w){return kwLow.indexOf(w)>-1;})) s+=5;
  if(intent==='buy'||intent==='season') s+=5;
  var label, type;
  if(s>=20){label='🔥 핫딜형'; type='hot';}
  else if(s>=10){label='💰 판매형'; type='sell';}
  else{label='📊 정보형'; type='info';}
  return {score:s, bonus:s>=20?20:s>=10?10:0, label:label, type:type};
}

function calcScore(result, maxTotal, velocity, commercial){
  var items=result.items, tc=result.totalCount;
  if(!items.length) return {totalScore:0, breakdown:{}, grade:'C', confidence:'low', surgeScore:0, commercialBonus:0};
  var searchScore=maxTotal>0?Math.round((Math.min(tc,maxTotal)/maxTotal)*40):0;
  var malls={};
  items.forEach(function(i){malls[i.mall]=true;});
  var mallCount=Object.keys(malls).length, mallScore=Math.round(Math.min(mallCount/10,1)*30);
  var prices=items.map(function(i){return i.price;}).filter(function(p){return p>0;}), priceScore=0;
  if(prices.length>1){
    var minP=Math.min.apply(null,prices), maxP=Math.max.apply(null,prices), range=maxP-minP;
    priceScore=range>0?Math.round(Math.min(range/(maxP*0.5),1)*20):5;
  }
  var countScore=Math.round(Math.min(items.length/40,1)*10);
  var surgeScore=calcSurgeScore(velocity);
  var commercialBonus=commercial?commercial.bonus:0;
  var total=Math.min(140, searchScore+mallScore+priceScore+countScore+surgeScore+commercialBonus);
  var grade=total>=CFG.GRADE_A?'A':total>=CFG.GRADE_B?'B':'C';
  var confidence=mallCount>=5?'high':mallCount>=2?'medium':'low';
  return {
    totalScore:total,
    breakdown:{shopping:searchScore, blog:mallScore, news:priceScore, trend:countScore, surge:surgeScore, commercial:commercialBonus},
    grade:grade, confidence:confidence, surgeScore:surgeScore, commercialBonus:commercialBonus
  };
}

function judgeT(tc){
  if(tc===0)     return {status:'new',     changeRate:null, source:'count'};
  if(tc>=500000) return {status:'rising',  changeRate:null, source:'count'};
  if(tc>=10000)  return {status:'stable',  changeRate:null, source:'count'};
  return               {status:'falling', changeRate:null, source:'count'};
}

function velocityAction(v, base){
  if(!v) return base;
  if(v.surgeRate>=30&&v.durability<50)  return 'shorts';
  if(v.surgeRate>=15&&v.durability>=60) return 'blog';
  if(v.surgeRate>=20&&v.accel>=20)      return 'shorts';
  return base;
}

function velocityLabel(v){
  if(!v) return null;
  return {
    surge:      (v.surgeRate>=30?'🚀 급등':v.surgeRate>=10?'📈 상승':v.surgeRate<=-10?'📉 하락':'➡️ 보합')+'('+v.surgeRate+'%)',
    accel:      (v.accel>=20?'⚡ 가속':v.accel>=5?'↗ 증가':v.accel<=-10?'↘ 둔화':'– 유지')+'('+v.accel+'%)',
    durability: (v.durability>=70?'💪 높음':v.durability>=45?'보통':'⚠️ 낮음')+'('+v.durability+'%)'
  };
}

module.exports = {calcScore:calcScore, calcCommercialScore:calcCommercialScore, judgeT:judgeT, velocityAction:velocityAction, velocityLabel:velocityLabel};
