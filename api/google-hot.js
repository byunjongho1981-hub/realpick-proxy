/**
 * /api/google-hot.js
 * Google Custom Search API + Google Trends RSS
 * → Naver 쇼핑 교차 검증 → 점수화
 *
 * 필요 환경변수:
 *   GOOGLE_API_KEY  — Google Cloud Console Custom Search API 키
 *   GOOGLE_CX       — Custom Search Engine ID (cx)
 *   NAVER_CLIENT_ID
 *   NAVER_CLIENT_SECRET
 */

var https = require('https');

var TIMEOUT = 8000;
var CACHE   = {data:null, ts:0, TTL:10*60*1000};

// ── 쇼핑 제외 키워드
var EXCLUDE_KW = [
  '사망','사고','범죄','폭행','살인','화재','지진','태풍','코로나','확진',
  '정치','선거','국회','대통령','논란','의혹','수사','체포','전쟁','폭발'
];

function isExcluded(kw){
  return EXCLUDE_KW.some(function(w){return kw.indexOf(w)>-1;});
}

// ── 환경변수 확인
function checkEnv(){
  var miss=[];
  if(!process.env.GOOGLE_API_KEY)        miss.push('GOOGLE_API_KEY');
  if(!process.env.GOOGLE_CX)             miss.push('GOOGLE_CX');
  if(!process.env.NAVER_CLIENT_ID)       miss.push('NAVER_CLIENT_ID');
  if(!process.env.NAVER_CLIENT_SECRET)   miss.push('NAVER_CLIENT_SECRET');
  if(miss.length) throw new Error('환경변수 누락: '+miss.join(', '));
}

// ── HTTP GET 유틸
function httpGet(hostname, path){
  return new Promise(function(resolve, reject){
    var t=setTimeout(function(){reject(new Error('timeout'));}, TIMEOUT);
    https.get({hostname:hostname, path:path, headers:{'User-Agent':'Mozilla/5.0'}}, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{resolve(JSON.parse(raw));}catch(e){resolve({_raw:raw});}
      });
    }).on('error',function(e){clearTimeout(t);reject(e);});
  });
}

// ── 1. Google Trends RSS (실시간 급상승)
function fetchTrendsRSS(){
  return new Promise(function(resolve){
    var t=setTimeout(function(){resolve([]);}, TIMEOUT);
    https.get({
      hostname:'trends.google.com',
      path:'/trending/rss?geo=KR',
      headers:{'User-Agent':'Mozilla/5.0'}
    }, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{
          var items=[], re=/<title><!\[CDATA\[([^\]]+)\]\]><\/title>|<ht:title>([^<]+)<\/ht:title>/g;
          var traRe=/<ht:approx_traffic>([^<]+)<\/ht:approx_traffic>/g;
          var traffics=[], tm;
          while((tm=traRe.exec(raw))!==null) traffics.push(tm[1]);
          var m, idx=0;
          while((m=re.exec(raw))!==null){
            var title=(m[1]||m[2]||'').trim();
            if(title&&title!=='Google 트렌드'&&title!=='Google Trends'){
              if(!isExcluded(title)) items.push({keyword:title, traffic:traffics[idx]||'0'});
              idx++;
            }
          }
          resolve(items.slice(0,25));
        }catch(e){resolve([]);}
      });
    }).on('error',function(){clearTimeout(t);resolve([]);});
  });
}

// ── 2. Google Custom Search API — 쇼핑 관련성 확인
function googleSearch(keyword){
  var q = encodeURIComponent(keyword+' 구매 추천 가격');
  var path = '/customsearch/v1?key='+process.env.GOOGLE_API_KEY
    +'&cx='+process.env.GOOGLE_CX
    +'&q='+q
    +'&num=5'
    +'&lr=lang_ko'
    +'&gl=kr';
  return httpGet('www.googleapis.com', path).then(function(d){
    if(!d||!Array.isArray(d.items)) return {count:0, snippets:[], links:[]};
    return {
      count:     d.searchInformation ? Number(d.searchInformation.totalResults||0) : 0,
      snippets:  d.items.map(function(i){return i.snippet||'';}),
      links:     d.items.map(function(i){return {title:i.title||'', link:i.link||'', snippet:i.snippet||''};}),
      formatted: d.searchInformation ? d.searchInformation.formattedTotalResults : '0'
    };
  }).catch(function(){return {count:0, snippets:[], links:[]};});
}

// ── 3. Naver 쇼핑 교차 검증
function naverShopCheck(keyword){
  return new Promise(function(resolve){
    var qs='query='+encodeURIComponent(keyword)+'&display=10&sort=sim';
    var t=setTimeout(function(){resolve(null);}, TIMEOUT);
    var req=https.request({
      hostname:'openapi.naver.com', path:'/v1/search/shop.json?'+qs, method:'GET',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
      }
    }, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{
          var d=JSON.parse(raw);
          var items=(d.items||[]).filter(function(i){return Number(i.lprice||i.price||0)>0;});
          resolve({
            total:     Number(d.total||0),
            itemCount: items.length,
            minPrice:  items.length?Math.min.apply(null,items.map(function(i){return Number(i.lprice||i.price||0);})):0,
            maxPrice:  items.length?Math.max.apply(null,items.map(function(i){return Number(i.lprice||i.price||0);})):0,
            topItems:  items.slice(0,3).map(function(i){
              return {
                title: String(i.title||'').replace(/<[^>]+>/g,''),
                link:  i.link||'',
                price: Number(i.lprice||i.price||0),
                image: i.image||'',
                mall:  i.mallName||''
              };
            })
          });
        }catch(e){resolve(null);}
      });
    });
    req.on('error',function(){clearTimeout(t);resolve(null);});
    req.end();
  });
}

// ── 트래픽 파싱
function parseTraffic(t){
  if(!t) return 0;
  var s=String(t).replace(/[,+\s]/g,'');
  if(s.indexOf('만')>-1) return parseFloat(s)*10000;
  if(/[Kk]/.test(s)) return parseFloat(s)*1000;
  if(/[Mm]/.test(s)) return parseFloat(s)*1000000;
  return parseInt(s)||0;
}

// ── 종합 점수
function hotScore(trend, google, shop){
  var trafficScore  = Math.min(parseTraffic(trend.traffic)/100000, 1)*30;  // 최대 30점
  var googleScore   = google ? Math.min(google.count/10000000, 1)*30 : 0;  // 최대 30점
  var shopScore     = shop   ? Math.min(shop.total/500000, 1)*20    : 0;   // 최대 20점
  var itemScore     = shop   ? Math.min(shop.itemCount/10, 1)*10    : 0;   // 최대 10점
  var priceScore    = (shop&&shop.minPrice>0) ? 10 : 0;                    // 최대 10점
  return Math.round(trafficScore+googleScore+shopScore+itemScore+priceScore);
}

module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();

  try{checkEnv();}catch(e){return res.status(500).json({error:e.message});}

  // 캐시
  if(CACHE.data&&(Date.now()-CACHE.ts<CACHE.TTL)){
    return res.status(200).json(Object.assign({},CACHE.data,{fromCache:true,cacheAge:Math.round((Date.now()-CACHE.ts)/1000)+'초 전'}));
  }

  try{
    // 1. Google Trends RSS
    var trends = await fetchTrendsRSS();

    // 디버그: RSS 실패 시 원본 확인용
    if(!trends.length){
      var debugRaw = await new Promise(function(resolve){
        var t=setTimeout(function(){resolve('timeout');},TIMEOUT);
        https.get({
          hostname:'trends.google.com',
          path:'/trending/rss?geo=KR',
          headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        },function(res){
          var raw='', statusCode=res.statusCode;
          res.on('data',function(c){raw+=c;});
          res.on('end',function(){clearTimeout(t);resolve({status:statusCode,body:raw.slice(0,500)});});
        }).on('error',function(e){clearTimeout(t);resolve('error:'+e.message);});
      });
      return res.status(200).json({items:[],total:0,message:'Trends 데이터 없음',debug:debugRaw,updatedAt:new Date().toISOString()});
    }

    var targets = trends.slice(0,15);

    // 2. Google Search + Naver 병렬 (동시 3개)
    var results=[], i=0;
    while(i<targets.length){
      var batch=targets.slice(i,i+3);
      var batchRes=await Promise.allSettled(batch.map(async function(t){
        var google = await googleSearch(t.keyword);
        var shop   = await naverShopCheck(t.keyword);
        return {trend:t, google:google, shop:shop};
      }));
      batchRes.forEach(function(r){
        if(r.status!=='fulfilled') return;
        var v=r.value, score=hotScore(v.trend, v.google, v.shop);
        results.push({
          keyword:  v.trend.keyword,
          traffic:  v.trend.traffic,
          score:    score,
          grade:    score>=70?'A':score>=50?'B':'C',
          label:    score>=70?'🔥 핫':score>=50?'📈 상승':'🆕 신규',
          google:   v.google,
          shop:     v.shop
        });
      });
      i+=3;
    }

    // 3. 쇼핑 데이터 있는 것만, 점수순
    results = results
      .filter(function(r){return r.shop&&r.shop.itemCount>0;})
      .sort(function(a,b){return b.score-a.score;})
      .slice(0,20);

    var data={
      items:results, total:results.length,
      trendCount:trends.length,
      updatedAt:new Date().toISOString(),
      fromCache:false
    };
    CACHE.data=data; CACHE.ts=Date.now();
    return res.status(200).json(data);

  }catch(e){
    console.error('[google-hot]',e.message);
    return res.status(500).json({error:'오류 발생', detail:e.message});
  }
};
