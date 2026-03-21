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
function cleanText(t){
  return String(t||'').replace(/<[^>]+>/g,'').replace(/[^\w가-힣\s]/g,' ').replace(/\s+/g,' ').trim();
}
function isClean(t){
  if(t.length<2) return false;
  if(/\[광고\]|\[협찬\]|쿠폰|특가|이벤트/.test(t)) return false;
  return true;
}
function safeNum(v){ var n=Number(v); return isNaN(n)?0:n; }
function shopSearch(keyword, catId){
  var p = {query:keyword, display:40, sort:'sim'};
  if(catId&&catId!=='all') p.category = catId;
  return httpGet('/v1/search/shop.json', p).then(function(data){
    if(!data||!Array.isArray(data.items)) return {items:[], totalCount:0};
    var items = [];
    data.items.forEach(function(item){
      var title = cleanText(item.title||''), price = safeNum(item.lprice||item.price);
      if(isClean(title)) items.push({title:title, link:item.link||'', price:price, mall:item.mallName||''});
    });
    return {items:items, totalCount:safeNum(data.total)};
  }).catch(function(){ return {items:[], totalCount:0}; });
}

// ★ period별 날짜 범위 분리
// today : 최근 4일 (2일 vs 2일 비교)
// week  : 최근 14일 (7일 vs 7일 비교)
// month : 최근 60일 (30일 vs 30일 비교)
function fetchVelocity(keyword, period){
  var now=new Date();
  var pad=function(n){return String(n).padStart(2,'0');};
  var fmt=function(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
  var ago=function(n){var d=new Date(now);d.setDate(d.getDate()-n);return d;};

  var totalDays = period==='today' ? 4 : period==='month' ? 60 : 14;
  var startDate = fmt(ago(totalDays));
  var endDate   = fmt(now);
  var timeUnit  = period==='month' ? 'week' : 'date';

  var body=JSON.stringify({
    startDate:startDate, endDate:endDate, timeUnit:timeUnit,
    keywordGroups:[{groupName:keyword, keywords:[keyword]}]
  });
  return new Promise(function(resolve){
    var t=setTimeout(function(){resolve(null);}, CFG.TIMEOUT);
    var req=https.request({
      hostname:'openapi.naver.com', path:'/v1/datalab/search', method:'POST',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
        'Content-Type':'application/json',
        'Content-Length':Buffer.byteLength(body)
      }
    }, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{
          var pts=((JSON.parse(raw).results||[])[0]||{}).data||[];
          if(pts.length<4) return resolve(null);
          var h=Math.floor(pts.length/2), prev=pts.slice(0,h), curr=pts.slice(h);
          var avg=function(a){return a.reduce(function(s,p){return s+Number(p.ratio||0);},0)/(a.length||1);};
          var pa=avg(prev), ca=avg(curr);
          var surge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
          var eh=curr.slice(0,Math.floor(curr.length/2)), rh=curr.slice(Math.floor(curr.length/2));
          var accel=avg(eh)>0?Math.round(((avg(rh)-avg(eh))/avg(eh))*100):0;
          var all=avg(pts), dur=Math.round((pts.filter(function(p){return Number(p.ratio||0)>=all;}).length/pts.length)*100);
          resolve({surgeRate:surge, accel:accel, durability:dur});
        }catch(e){resolve(null);}
      });
    });
    req.on('error',function(){clearTimeout(t);resolve(null);});
    req.write(body); req.end();
  });
}
module.exports = {shopSearch:shopSearch, fetchVelocity:fetchVelocity, cleanText:cleanText};
