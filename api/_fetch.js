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

// ── 날짜 헬퍼 ────────────────────────────────────────────────
function fmtDate(d){
  var pad=function(n){return String(n).padStart(2,'0');};
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}
function agoDate(n){
  var d=new Date(); d.setDate(d.getDate()-n); return d;
}

// ── 배치 쇼핑 검색 ────────────────────────────────────────────
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

// ── 검색어트렌드 (기존 유지) ─────────────────────────────────
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
      if(d.errorCode){
        console.error('[velocity error]', keyword, d.errorCode, d.errorMessage);
        return null;
      }
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
    .catch(function(e){
      console.error('[velocity catch]', keyword, e.message);
      return null;
    });
}

// ── 쇼핑인사이트 클릭트렌드 ──────────────────────────────────
function fetchShoppingInsight(keyword, period){
  var totalDays = period==='today'?4 : period==='month'?60 : 14;
  var timeUnit  = period==='month'?'week':'date';
  var body={
    startDate: fmtDate(agoDate(totalDays+1)),
    endDate:   fmtDate(agoDate(1)),
    timeUnit:  timeUnit,
    category:  [{name: keyword, param: [keyword]}],
    device:    '',
    gender:    '',
    ages:      []
  };
  return httpPost('/v1/datalab/shopping/categories', body)
    .then(function(d){
      if(d.errorCode){
        console.error('[insight error]', keyword, d.errorCode, d.errorMessage);
        return null;
      }
      // ★ 디버그 로그
      var pts=((d.results||[])[0]||{}).data||[];
      console.log('[insight]', keyword, 'pts:', pts.length, 'results:', (d.results||[]).length, 'raw:', JSON.stringify(d).slice(0,200));
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
    .catch(function(e){
      console.error('[insight catch]', keyword, e.message);
      return null;
    });
}

module.exports = {
  shopSearch:           shopSearch,
  batchShopSearch:      batchShopSearch,
  fetchVelocity:        fetchVelocity,
  fetchShoppingInsight: fetchShoppingInsight,  // ★ 신규 export
  cleanText:            cleanText
};
