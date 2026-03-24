// ============================================================
// FILE: _fetch.js
// 수정: fetchShoppingInsight → 키워드별 API로 교체
// ============================================================
var https = require('https');
var CFG   = require('./_config');

function httpGet(path, params){
  return new Promise(function(resolve, reject){
    var qs = Object.keys(params).map(function(k){
      return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);
    }).join('&');
    var t = setTimeout(function(){reject(new Error('timeout'));}, CFG.TIMEOUT);
    var req = https.request({
      hostname:'openapi.naver.com', path:path+'?'+qs, method:'GET',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
      }
    }, function(res){
      var raw='';
      res.on('data', function(c){raw+=c;});
      res.on('end',  function(){clearTimeout(t); try{resolve(JSON.parse(raw));}catch(e){resolve({});}});
    });
    req.on('error', function(e){clearTimeout(t); reject(e);});
    req.end();
  });
}

function httpPost(path, body){
  return new Promise(function(resolve, reject){
    var buf = Buffer.from(JSON.stringify(body), 'utf8');
    var t = setTimeout(function(){reject(new Error('timeout'));}, CFG.TIMEOUT);
    var req = https.request({
      hostname:'openapi.naver.com', path:path, method:'POST',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
        'Content-Type':          'application/json',
        'Content-Length':        buf.length
      }
    }, function(res){
      var raw='';
      res.on('data', function(c){raw+=c;});
      res.on('end',  function(){clearTimeout(t); try{resolve(JSON.parse(raw));}catch(e){resolve({});}});
    });
    req.on('error', function(e){clearTimeout(t); reject(e);});
    req.write(buf); req.end();
  });
}

function cleanText(t){
  return String(t||'').replace(/<[^>]+>/g,'').replace(/[^\w가-힣\s]/g,' ').replace(/\s+/g,' ').trim();
}
function isClean(t){
  if(t.length<2) return false;
  if(/\[광고\]|\[협찬\]|쿠폰|특가|이벤트/.test(t)) return false;
  return true;
}
function safeNum(v){ var n=Number(v); return isNaN(n)?0:n; }
function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }

function fmtDate(d){
  var pad=function(n){return String(n).padStart(2,'0');};
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}
function agoDate(n){
  var d=new Date(); d.setDate(d.getDate()-n); return d;
}

async function batchShopSearch(keywords){
  var BATCH=10, results=[];
  for(var i=0; i<keywords.length; i+=BATCH){
    var chunk=keywords.slice(i,i+BATCH);
    var settled=await Promise.allSettled(chunk.map(function(kw){return shopSearch(kw,null);}));
    settled.forEach(function(r,j){
      results.push({
        kw: chunk[j],
        result: r.status==='fulfilled' ? r.value : {items:[],totalCount:0}
      });
    });
    if(i+BATCH<keywords.length) await sleep(200);
  }
  return results;
}

function shopSearch(keyword, catId){
  var p={query:keyword, display:40, sort:'sim'};
  if(catId&&catId!=='all') p.category=catId;
  return httpGet('/v1/search/shop.json', p).then(function(data){
    if(!data||!Array.isArray(data.items)) return {items:[],totalCount:0};
    var items=[];
    data.items.forEach(function(item){
      var title=cleanText(item.title||''), price=safeNum(item.lprice||item.price);
      if(isClean(title)) items.push({title:title, link:item.link||'', price:price, mall:item.mallName||''});
    });
    return {items:items, totalCount:safeNum(data.total)};
  }).catch(function(){return {items:[],totalCount:0};});
}

function fetchVelocity(keyword, period){
  var totalDays = period==='today'?4 : period==='month'?60 : 14;
  var timeUnit  = period==='month'?'week':'date';
  var body={
    startDate: fmtDate(agoDate(totalDays+1)),
    endDate:   fmtDate(agoDate(1)),
    timeUnit:  timeUnit,
    keywordGroups:[{groupName:keyword, keywords:[keyword]}]
  };
  return httpPost('/v1/datalab/search', body)
    .then(function(d){
      if(d.errorCode){ console.error('[velocity error]', keyword, d.errorCode, d.errorMessage); return null; }
      var pts=((d.results||[])[0]||{}).data||[];
      if(pts.length<4) return null;
      var h=Math.floor(pts.length/2), prev=pts.slice(0,h), curr=pts.slice(h);
      var avg=function(a){return a.reduce(function(s,p){return s+safeNum(p.ratio);},0)/(a.length||1);};
      var pa=avg(prev), ca=avg(curr);
      var surge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
      var eh=curr.slice(0,Math.floor(curr.length/2)), rh=curr.slice(Math.floor(curr.length/2));
      var accel=avg(eh)>0?Math.round(((avg(rh)-avg(eh))/avg(eh))*100):0;
      var all=avg(pts), dur=Math.round((pts.filter(function(p){return safeNum(p.ratio)>=all;}).length/pts.length)*100);
      return {surgeRate:surge, accel:accel, durability:dur};
    })
    .catch(function(e){ console.error('[velocity catch]', keyword, e.message); return null; });
}

// ★ 수정: /categories → /category/keywords (키워드별 개별 트렌드)
var _kwCatMap = null;
function getKwCatMap(){
  if(_kwCatMap) return _kwCatMap;
  _kwCatMap = {};
  try {
    var CFG2 = require('./_config');
    Object.keys(CFG2.CAT_SEEDS||{}).forEach(function(catId){
      (CFG2.CAT_SEEDS[catId]||[]).forEach(function(kw){
        if(!_kwCatMap[kw]) _kwCatMap[kw] = catId;
      });
    });
  } catch(e) {}
  return _kwCatMap;
}

function fetchShoppingInsight(keyword, period){
  var totalDays = period==='today'?4 : period==='month'?60 : 14;
  var timeUnit  = period==='month'?'week':'date';

  var kwMap = getKwCatMap();
  var catId = kwMap[keyword] || '50000003';

  // ★ 핵심 수정: category/keywords API → 키워드 단위 클릭트렌드 수집
  var body={
    startDate: fmtDate(agoDate(totalDays+1)),
    endDate:   fmtDate(agoDate(1)),
    timeUnit:  timeUnit,
    category:  catId,
    keyword:   [{name: keyword, param: [keyword]}],
    device:    '',
    gender:    '',
    ages:      []
  };

  return httpPost('/v1/datalab/shopping/category/keywords', body)
    .then(function(d){
      if(d.errorCode){
        console.error('[insight error]', keyword, catId, d.errorCode, d.errorMessage);
        return null;
      }
      var pts=((d.results||[])[0]||{}).data||[];
      if(pts.length<4) return null;
      var h=Math.floor(pts.length/2), prev=pts.slice(0,h), curr=pts.slice(h);
      var avg=function(a){return a.reduce(function(s,p){return s+safeNum(p.ratio);},0)/(a.length||1);};
      var pa=avg(prev), ca=avg(curr);
      var clickSurge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
      var last3=pts.slice(-3), prev3=pts.slice(Math.max(0,pts.length-6),-3);
      var l3=avg(last3), p3=avg(prev3);
      var clickAccel=p3>0?Math.round(((l3-p3)/p3)*100):(l3>0?50:0);
      var all=avg(pts);
      var clickDurability=Math.round((pts.filter(function(p){return safeNum(p.ratio)>=all;}).length/pts.length)*100);
      var currentRatio=Math.round(ca*10)/10;
      return {
        clickSurge:      clickSurge,
        clickAccel:      clickAccel,
        clickDurability: clickDurability,
        currentRatio:    currentRatio,
        shopTrend: clickSurge>=30?'hot':clickSurge>=10?'rising':clickSurge>=-10?'stable':'falling'
      };
    })
    .catch(function(e){ console.error('[insight catch]', keyword, e.message); return null; });
}

module.exports = {
  shopSearch:           shopSearch,
  batchShopSearch:      batchShopSearch,
  fetchVelocity:        fetchVelocity,
  fetchShoppingInsight: fetchShoppingInsight,
  cleanText:            cleanText
};


// ============================================================
// FILE: _score.js
// 수정: 떡상 예측 — 가속도/선점 비중 대폭 상향
// 주의: trend.html SCORE_MAX에 accel:25, earlyBird:20 추가 필요
// ============================================================
var CFG = require('./_config');
var COMMERCIAL_KW = ['추천','선물','구매','최저가','할인','세트','묶음','증정','인기'];
var REVIEW_KW     = ['후기','리뷰','사용후기','솔직','평점','별점'];

// ★ 수정: surge 가중치 상향 (max 20 → 30)
function calcSurgeScore(v){
  if(!v) return 0;
  if(v.surgeRate>=100) return 30;
  if(v.surgeRate>=50)  return 25;
  if(v.surgeRate>=30)  return 18;
  if(v.surgeRate>=20)  return 12;
  if(v.surgeRate>=10)  return 7;
  if(v.surgeRate>=0)   return 3;
  return 0;
}

// ★ 신규: 가속도 점수 (max 25) — 떡상의 핵심 지표
function calcAccelScore(v){
  if(!v) return 0;
  if(v.accel>=50)  return 25;
  if(v.accel>=30)  return 20;
  if(v.accel>=20)  return 15;
  if(v.accel>=10)  return 8;
  if(v.accel>=5)   return 4;
  return 0;
}

// ★ 신규: 선점 보너스 — 경쟁 적고 상승 중인 키워드 (max 20)
function calcEarlyBirdBonus(result, velocity){
  if(!velocity) return 0;
  var tc    = result.totalCount;
  var surge = velocity.surgeRate || 0;
  var accel = velocity.accel || 0;
  if(tc < 5000  && surge >= 20)             return 20; // 완전 선점
  if(tc < 20000 && surge >= 30)             return 15; // 선점 기회
  if(tc < 50000 && accel >= 20)             return 10; // 가속 초기
  if(tc < 100000 && surge >= 20 && accel >= 10) return 8; // 관심 증가 중
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
  return {score:s, bonus:s>=20?15:s>=10?8:0, label:label, type:type};
}

// ★ 수정: insight 가중치 상향 (max 15 → 20)
function calcShoppingInsightScore(si){
  if(!si) return { score:0, label:null, detail:'' };
  var s = 0;
  var cs = si.clickSurge || 0;
  // surge 비중 올림
  var surgeScore = cs>=100?10 : cs>=50?8 : cs>=30?6 : cs>=15?4 : cs>=5?2 : cs>=-10?1 : 0;
  s += surgeScore;
  var ca = si.clickAccel || 0;
  var accelScore = ca>=50?6 : ca>=30?5 : ca>=15?3 : ca>=5?2 : ca>0?1 : 0;
  s += accelScore;
  var cd = si.clickDurability || 0;
  var durScore = cd>=70?2 : cd>=50?1 : 0;
  s += durScore;
  var cr = si.currentRatio || 0;
  var ratioScore = cr>=80?2 : cr>=50?1 : 0;
  s += ratioScore;
  var label =
    si.shopTrend==='hot'    ? '🔥 쇼핑 급상승' :
    si.shopTrend==='rising' ? '📈 쇼핑 상승중' :
    si.shopTrend==='stable' ? '➡️ 쇼핑 안정'  : '📉 쇼핑 하락';
  var detail = '클릭변화 '+(cs>=0?'+':'')+cs+'% | 가속 '+(ca>=0?'+':'')+ca+'% | 지속 '+cd+'%';
  return { score: Math.min(20, s), label: label, detail: detail,
           surgeScore:surgeScore, accelScore:accelScore, durScore:durScore, ratioScore:ratioScore };
}

function calcScore(result, maxTotal, velocity, commercial, shoppingInsight){
  var items=result.items, tc=result.totalCount;
  if(!items.length) return {totalScore:0, breakdown:{}, grade:'C', confidence:'low', surgeScore:0, commercialBonus:0, insightScore:0};

  // ★ 수정: searchScore 비중 낮춤 (40 → 15) — 이미 뜬 제품 불이익
  var searchScore = maxTotal>0 ? Math.round((Math.min(tc,maxTotal)/maxTotal)*15) : 0;

  var malls={};
  items.forEach(function(i){malls[i.mall]=true;});
  var mallCount=Object.keys(malls).length, mallScore=Math.round(Math.min(mallCount/10,1)*20);

  var prices=items.map(function(i){return i.price;}).filter(function(p){return p>0;}), priceScore=0;
  if(prices.length>1){
    var minP=Math.min.apply(null,prices), maxP=Math.max.apply(null,prices), range=maxP-minP;
    priceScore=range>0?Math.round(Math.min(range/(maxP*0.5),1)*10):3;
  }

  var countScore      = Math.round(Math.min(items.length/40,1)*5);
  var surgeScore      = calcSurgeScore(velocity);
  var accelScore      = calcAccelScore(velocity);        // ★ 신규
  var earlyBird       = calcEarlyBirdBonus(result, velocity); // ★ 신규
  var commercialBonus = commercial ? commercial.bonus : 0;
  var siResult        = calcShoppingInsightScore(shoppingInsight);
  var insightScore    = siResult.score;

  // max: 15+20+10+5+30+25+20+15+20 = 160
  var total      = searchScore+mallScore+priceScore+countScore+surgeScore+accelScore+earlyBird+commercialBonus+insightScore;
  var normalized = Math.min(100, Math.round((total/160)*100));

  var grade      = normalized>=CFG.GRADE_A?'A':normalized>=CFG.GRADE_B?'B':'C';
  var confidence = mallCount>=5?'high':mallCount>=2?'medium':'low';

  return {
    totalScore: normalized,
    rawScore:   total,
    breakdown:{
      shopping:   searchScore,
      blog:       mallScore,
      news:       priceScore,
      trend:      countScore,
      surge:      surgeScore,
      accel:      accelScore,   // ★
      earlyBird:  earlyBird,    // ★
      commercial: commercialBonus,
      insight:    insightScore
    },
    insightLabel:    siResult.label,
    insightDetail:   siResult.detail,
    grade:           grade,
    confidence:      confidence,
    surgeScore:      surgeScore,
    commercialBonus: commercialBonus,
    insightScore:    insightScore
  };
}

// ★ 수정: judgeT 기준값 현실화 (500000 → 50000)
function judgeT(tc){
  if(tc===0)     return {status:'new',     changeRate:null, source:'count'};
  if(tc>=50000)  return {status:'rising',  changeRate:null, source:'count'};
  if(tc>=3000)   return {status:'stable',  changeRate:null, source:'count'};
  return               {status:'falling', changeRate:null, source:'count'};
}

function judgeTWithInsight(tc, shoppingInsight){
  var base = judgeT(tc);
  if(!shoppingInsight) return base;
  if(shoppingInsight.shopTrend==='hot')    return {status:'rising',  changeRate:shoppingInsight.clickSurge, source:'insight'};
  if(shoppingInsight.shopTrend==='rising') return {status:'rising',  changeRate:shoppingInsight.clickSurge, source:'insight'};
  if(shoppingInsight.shopTrend==='falling'&&base.status!=='rising') return {status:'falling', changeRate:shoppingInsight.clickSurge, source:'insight'};
  return base;
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

module.exports = {
  calcScore:                calcScore,
  calcCommercialScore:      calcCommercialScore,
  calcShoppingInsightScore: calcShoppingInsightScore,
  judgeT:                   judgeT,
  judgeTWithInsight:        judgeTWithInsight,
  velocityAction:           velocityAction,
  velocityLabel:            velocityLabel
};


// ============================================================
// FILE: auto-discover.js
// 수정: discoverAll에 period 파라미터 추가
// ============================================================
var CFG     = require('./_config');
var FETCH   = require('./_fetch');
var SCORE   = require('./_score');
var ANALYZE = require('./_analyze');

var TTL = 5*60*1000;
var CACHE_ALL = {};
var CACHE_CAT = {};

function getCacheAll(period){ var c=CACHE_ALL[period]; return c&&c.data&&(Date.now()-c.ts<TTL)?c.data:null; }
function setCacheAll(period,d){ CACHE_ALL[period]={data:d,ts:Date.now()}; }
function getCacheCat(catId,period){ var k=catId+'_'+period; var c=CACHE_CAT[k]; return c&&c.data&&(Date.now()-c.ts<TTL)?c.data:null; }
function setCacheCat(catId,period,d){ var k=catId+'_'+period; CACHE_CAT[k]={data:d,ts:Date.now()}; }

function checkEnv(){
  var miss=[];
  if(!process.env.NAVER_CLIENT_ID)     miss.push('NAVER_CLIENT_ID');
  if(!process.env.NAVER_CLIENT_SECRET) miss.push('NAVER_CLIENT_SECRET');
  if(miss.length) throw new Error('환경변수 누락: '+miss.join(', '));
}

function buildCandidate(kw, result, maxTotal, intentOverride, velocity, shoppingInsight){
  var intent     = intentOverride||ANALYZE.detectIntent(kw);
  var commercial = SCORE.calcCommercialScore(kw, result, intent);
  var score      = SCORE.calcScore(result, maxTotal, velocity, commercial, shoppingInsight||null);
  var trend      = SCORE.judgeTWithInsight(result.totalCount, shoppingInsight||null);
  var base       = ANALYZE.makeSummary(kw, score, trend, intent);
  var action     = velocity?SCORE.velocityAction(velocity, base.action):base.action;
  var samples    = [];
  for(var i=0;i<Math.min(3,result.items.length);i++) samples.push({title:result.items[i].title, link:result.items[i].link, source:'shopping'});
  return {
    id:kw, name:kw, keywords:[kw], sources:['shopping'],
    count:result.items.length, totalCount:result.totalCount,
    intent:intent, intentLabel:ANALYZE.INTENT_LABEL[intent]||'–',
    commercial:commercial,
    velocity:velocity||null, velocityLabel:SCORE.velocityLabel(velocity),
    shoppingInsight: shoppingInsight||null,
    insightLabel:    score.insightLabel||null,
    insightDetail:   score.insightDetail||null,
    reason:ANALYZE.buildReason(kw, score, trend, velocity, intent),
    score:score, trend:trend,
    summary:base.summary, action:action,
    sampleItems:samples
  };
}

async function discoverCategory(catId, period){
  var kws=CFG.CAT_SEEDS[catId]||CFG.CAT_SEEDS['50000003'];
  var valid=await FETCH.batchShopSearch(kws);
  var withItems = valid.filter(function(v){return v.result.items.length>0;});
  var noItems   = valid.filter(function(v){return v.result.items.length===0;});
  valid = withItems.concat(noItems);
  if(!valid.length) return {candidates:[], apiStatus:{search:'결과 없음'}};
  var maxTotal=valid.reduce(function(m,v){return Math.max(m,v.result.totalCount);},0)||40;
  var vMap={}, siMap={};
  var top10 = valid.slice(0,20)
    .sort(function(a,b){return b.result.totalCount-a.result.totalCount;})
    .slice(0,10);
  for(var vi=0; vi<top10.length; vi++){
    var v = top10[vi];
    var res2 = await Promise.all([
      FETCH.fetchVelocity(v.kw, period),
      FETCH.fetchShoppingInsight(v.kw, period)
    ]);
    vMap[v.kw]  = res2[0];
    siMap[v.kw] = res2[1];
    if(vi < top10.length-1) await new Promise(function(r){setTimeout(r,200);});
  }
  var candidates=valid.map(function(v){
    return buildCandidate(v.kw, v.result, maxTotal, null, vMap[v.kw]||null, siMap[v.kw]||null);
  }).filter(function(c){return c.score.totalScore>0;});
  candidates.sort(function(a,b){return b.score.totalScore-a.score.totalScore;});
  return {candidates:candidates.slice(0,10), apiStatus:{search:withItems.length+'/'+kws.length+' 성공'}};
}

// ★ 수정: period 파라미터 추가
async function discoverAll(period){
  var tasks=[];
  CFG.CAT_ORDER.forEach(function(catId){
    var seeds=(CFG.CAT_SEEDS[catId]||[]).slice(0,3);
    seeds.forEach(function(kw){ tasks.push({catId:catId, kw:kw}); });
  });
  var BATCH=10, pool=[], completed=[], failed=[];
  for(var i=0;i<tasks.length;i+=BATCH){
    var chunk=tasks.slice(i,i+BATCH);
    var settled=await Promise.allSettled(chunk.map(function(t){return FETCH.shopSearch(t.kw,null);}));
    settled.forEach(function(r,j){
      var t=chunk[j];
      var result=r.status==='fulfilled'?r.value:{items:[],totalCount:0};
      if(result.items.length>0){
        pool.push({catId:t.catId, kw:t.kw, result:result});
        if(completed.indexOf(CFG.CAT_NAMES[t.catId]||t.catId)<0) completed.push(CFG.CAT_NAMES[t.catId]||t.catId);
      } else {
        if(failed.indexOf(CFG.CAT_NAMES[t.catId]||t.catId)<0) failed.push(CFG.CAT_NAMES[t.catId]||t.catId);
      }
    });
    if(i+BATCH<tasks.length) await new Promise(function(r){setTimeout(r,200);});
  }
  if(!pool.length) return {candidates:[], apiStatus:{completed:'0', failed:'전체 실패'}, processLog:{completed:[], failed:[]}};
  var maxTotal=pool.reduce(function(m,v){return Math.max(m,v.result.totalCount);},0)||40;
  var vMap={}, siMap={};
  var top10pool = pool.slice().sort(function(a,b){return b.result.totalCount-a.result.totalCount;}).slice(0,10);
  for(var pi=0; pi<top10pool.length; pi++){
    var pv = top10pool[pi];
    // ★ 수정: 하드코딩 'week' → period
    var pres = await Promise.all([
      FETCH.fetchVelocity(pv.kw, period),
      FETCH.fetchShoppingInsight(pv.kw, period)
    ]);
    vMap[pv.kw]  = pres[0];
    siMap[pv.kw] = pres[1];
    if(pi < top10pool.length-1) await new Promise(function(r){setTimeout(r,200);});
  }
  var candidates=pool.map(function(v){
    var c=buildCandidate(v.kw, v.result, maxTotal, null, vMap[v.kw]||null, siMap[v.kw]||null);
    c.category=CFG.CAT_NAMES[v.catId]||v.catId;
    return c;
  });
  candidates.sort(function(a,b){return b.score.totalScore-a.score.totalScore;});
  return {
    candidates:candidates.slice(0,10),
    apiStatus:{completed:completed.length+'/'+CFG.CAT_ORDER.length+' 카테고리', failed:failed.length?failed.join(', '):'없음'},
    processLog:{completed:completed, failed:failed}
  };
}

async function discoverSeed(seedKw, period){
  var STOP=new Set(['이','가','을','를','의','에','는','은','도','와','과','세트','상품','제품','판매']);
  var list=ANALYZE.expandIntentKeywords(seedKw);
  var r1=await FETCH.shopSearch(seedKw, null).catch(function(){return {items:[],totalCount:0};});
  var freq={};
  (r1.items||[]).forEach(function(i){
    FETCH.cleanText(i.title||'').split(/\s+/).filter(function(w){return w.length>1&&!STOP.has(w)&&w!==seedKw;})
      .forEach(function(w){freq[w]=(freq[w]||0)+1;});
  });
  Object.entries(freq).sort(function(a,b){return b[1]-a[1];}).slice(0,3).forEach(function(e){list.push({kw:e[0],intent:'none'});});
  var seen={}, unique=[];
  list.forEach(function(item){if(!seen[item.kw]){seen[item.kw]=true;unique.push(item);}});
  unique=unique.slice(0,12);
  var res=await Promise.allSettled(unique.map(function(item){return FETCH.shopSearch(item.kw,null);}));
  var valid=[];
  for(var i=0;i<unique.length;i++){
    var r=res[i].status==='fulfilled'?res[i].value:{items:[],totalCount:0};
    if(r.items.length>0) valid.push({kw:unique[i].kw, intent:unique[i].intent, result:r});
  }
  if(!valid.length) return {candidates:[], apiStatus:{search:'결과 없음'}};
  var maxTotal=valid.reduce(function(m,v){return Math.max(m,v.result.totalCount);},0)||40;
  var vMap={}, siMap={};
  var top10seed = valid.slice().sort(function(a,b){return b.result.totalCount-a.result.totalCount;}).slice(0,10);
  for(var si2=0; si2<top10seed.length; si2++){
    var sv = top10seed[si2];
    var sres = await Promise.all([
      FETCH.fetchVelocity(sv.kw, period),
      FETCH.fetchShoppingInsight(sv.kw, period)
    ]);
    vMap[sv.kw]  = sres[0];
    siMap[sv.kw] = sres[1];
    if(si2 < top10seed.length-1) await new Promise(function(r){setTimeout(r,200);});
  }
  var candidates=valid.map(function(v){
    return buildCandidate(v.kw, v.result, maxTotal, v.intent, vMap[v.kw]||null, siMap[v.kw]||null);
  });
  candidates.sort(function(a,b){return b.score.totalScore-a.score.totalScore;});
  return {candidates:candidates.slice(0,10), apiStatus:{search:valid.length+'/'+unique.length+' 성공'}};
}

module.exports=async function(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();
  try{checkEnv();}catch(e){return res.status(500).json({error:e.message});}
  var mode=req.query.mode||'category', period=req.query.period||'week';
  try{
    if(mode==='category'){
      var catId=req.query.categoryId||'50000003';
      if(catId==='all'){
        var cached=getCacheAll(period);
        if(cached){cached.fromCache=true;cached.cacheAge=Math.round((Date.now()-CACHE_ALL[period].ts)/1000)+'초 전';return res.status(200).json(cached);}
        // ★ 수정: period 전달
        var ar=await discoverAll(period);
        var result={candidates:ar.candidates, clusters:ANALYZE.clusterCandidates(ar.candidates), mode:mode, categoryId:'all', categoryName:'전체', period:period, total:ar.candidates.length, apiStatus:ar.apiStatus, processLog:ar.processLog, updatedAt:new Date().toISOString(), fromCache:false};
        setCacheAll(period, result);
        return res.status(200).json(result);
      }
      var cachedCat=getCacheCat(catId,period);
      if(cachedCat){cachedCat.fromCache=true;cachedCat.cacheAge=Math.round((Date.now()-CACHE_CAT[catId+'_'+period].ts)/1000)+'초 전';return res.status(200).json(cachedCat);}
      var cr=await discoverCategory(catId, period);
      var catResult={candidates:cr.candidates, clusters:ANALYZE.clusterCandidates(cr.candidates), mode:mode, categoryId:catId, categoryName:CFG.CAT_NAMES[catId]||catId, period:period, total:cr.candidates.length, apiStatus:cr.apiStatus, updatedAt:new Date().toISOString(), fromCache:false};
      setCacheCat(catId, period, catResult);
      return res.status(200).json(catResult);
    }
    if(mode==='seed'){
      var seedKw=String(req.query.keyword||'').trim().slice(0,30);
      if(!seedKw) return res.status(400).json({error:'키워드를 입력해주세요'});
      var sr=await discoverSeed(seedKw, period);
      return res.status(200).json({candidates:sr.candidates, clusters:ANALYZE.clusterCandidates(sr.candidates), mode:mode, seedKeyword:seedKw, period:period, total:sr.candidates.length, apiStatus:sr.apiStatus, updatedAt:new Date().toISOString()});
    }
    return res.status(400).json({error:'알 수 없는 mode'});
  }catch(e){
    console.error('[auto-discover]',e.message);
    return res.status(500).json({error:'탐색 중 오류가 발생했습니다.', detail:e.message});
  }
};
