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

// ── 배치 쇼핑 검색 ───────────────────────────────────────────
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

// ── 카테고리 실시간 인기 키워드 추출 ★ 신규 ─────────────────
// 프로브 키워드로 쇼핑 검색 → 상품 제목 파싱 → 빈도 높은 키워드 반환
var KW_STOP = new Set([
  '이','가','을','를','의','에','는','은','도','와','과','로','으로',
  '세트','상품','제품','판매','구매','무료','배송','할인','특가','행사',
  '브랜드','정품','국내','해외','직구','공식','정식','당일','빠른',
  '남성','여성','아동','남자','여자','유아','어린이','성인',
  '블랙','화이트','그레이','네이비','베이지','핑크','그린','레드','블루',
  'black','white','gray','navy','red','blue','pink','green',
  'cm','mm','ml','kg','g','l','호','개','세','번','가지','단계',
  '최신','신상','인기','추천','best','new','hot','sale',
  '2023','2024','2025','1개','2개','3개','4개','5개'
]);

async function fetchCategoryTopKeywords(catId, probeSeeds){
  // 프로브: 카테고리당 대표 시드 5개만 사용 (API 절약)
  var probes = (probeSeeds||[]).slice(0,5);
  if(!probes.length) return [];

  try{
    var batchResult = await batchShopSearch(probes);
    var freq = {};

    batchResult.forEach(function(r){
      (r.result.items||[]).forEach(function(item){
        cleanText(item.title||'').split(/\s+/).forEach(function(w){
          w = w.replace(/[^가-힣a-zA-Z0-9]/g,'').trim();
          // 2~8자, 한글 또는 영문 포함, 불용어 제외
          if(w.length<2 || w.length>8) return;
          if(!/[가-힣a-zA-Z]/.test(w)) return;
          if(KW_STOP.has(w)) return;
          if(/^\d+$/.test(w)) return;
          freq[w] = (freq[w]||0) + 1;
        });
      });
    });

    // 빈도 3회 이상만 유효 키워드로 처리
    var keywords = Object.keys(freq)
      .filter(function(w){ return freq[w] >= 3; })
      .sort(function(a,b){ return freq[b]-freq[a]; })
      .slice(0, 25);

    return keywords;
  }catch(e){
    console.error('[dynamic-keywords]', catId, e.message);
    return [];
  }
}

// ── 검색어트렌드 ─────────────────────────────────────────────
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

// ── 쇼핑인사이트 키워드별 클릭트렌드 ────────────────────────
var _kwCatMap = null;
function getKwCatMap(){
  if(_kwCatMap) return _kwCatMap;
  _kwCatMap = {};
  try{
    var CFG2 = require('./_config');
    Object.keys(CFG2.CAT_SEEDS||{}).forEach(function(catId){
      (CFG2.CAT_SEEDS[catId]||[]).forEach(function(kw){
        if(!_kwCatMap[kw]) _kwCatMap[kw] = catId;
      });
    });
  }catch(e){}
  return _kwCatMap;
}

function fetchShoppingInsight(keyword, period){
  var totalDays = period==='today'?4 : period==='month'?60 : 14;
  var timeUnit  = period==='month'?'week':'date';
  var kwMap = getKwCatMap();
  var catId = kwMap[keyword] || '50000003';

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
      if(d.errorCode){ console.error('[insight error]', keyword, catId, d.errorCode, d.errorMessage); return null; }
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
  shopSearch,
  batchShopSearch,
  fetchVelocity,
  fetchShoppingInsight,
  fetchCategoryTopKeywords,
  cleanText
};
