/**
 * /api/google-hot.js
 * Naver Datalab 쇼핑인사이트 기반 "지금 뜨는 제품"
 * Google Trends RSS 대신 Naver 카테고리별 인기 키워드 사용
 */

var https = require('https');

var TIMEOUT = 8000;
var CACHE   = {data:null, ts:0, TTL:10*60*1000};

// 카테고리별 쇼핑인사이트 인기 키워드 조회
function fetchShoppingKeywords(catId, catName){
  return new Promise(function(resolve){
    var now  = new Date();
    var pad  = function(n){return String(n).padStart(2,'0');};
    var fmt  = function(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
    var ago  = function(n){var d=new Date(now);d.setDate(d.getDate()-n);return d;};

    var body = JSON.stringify({
      startDate: fmt(ago(7)),
      endDate:   fmt(now),
      timeUnit:  'date',
      category:  catId,
      keyword:   [{name:'인기', param:[]}],
      device:    '',
      gender:    '',
      ages:      []
    });

    var t = setTimeout(function(){resolve({catName:catName, keywords:[]});}, TIMEOUT);
    var req = https.request({
      hostname:'openapi.naver.com',
      path:'/v1/datalab/shopping/category/keywords',
      method:'POST',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
        'Content-Type':          'application/json',
        'Content-Length':        Buffer.byteLength(body)
      }
    }, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{
          var d = JSON.parse(raw);
          var keywords = (d.results||[]).map(function(r){
            var pts = r.data||[];
            var recent  = pts.slice(-3);
            var earlier = pts.slice(-7,-3);
            var avg = function(a){return a.reduce(function(s,p){return s+Number(p.ratio||0);},0)/(a.length||1);};
            var surgeRate = avg(earlier)>0 ? Math.round(((avg(recent)-avg(earlier))/avg(earlier))*100) : 0;
            return {
              keyword:   r.title||'',
              ratio:     avg(recent),
              surgeRate: surgeRate,
              points:    pts
            };
          });
          resolve({catName:catName, keywords:keywords});
        }catch(e){resolve({catName:catName, keywords:[]});}
      });
    });
    req.on('error',function(){clearTimeout(t);resolve({catName:catName, keywords:[]});});
    req.write(body);
    req.end();
  });
}

// Naver 쇼핑 교차 검증
function naverShopCheck(keyword){
  return new Promise(function(resolve){
    var qs='query='+encodeURIComponent(keyword)+'&display=5&sort=sim';
    var t=setTimeout(function(){resolve(null);},TIMEOUT);
    var req=https.request({
      hostname:'openapi.naver.com', path:'/v1/search/shop.json?'+qs, method:'GET',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
      }
    },function(res){
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

function hotScore(ratio, surgeRate, shop){
  var ratioScore  = Math.min(ratio/100, 1)*30;
  var surgeScore  = surgeRate>=50?30:surgeRate>=20?20:surgeRate>=0?10:0;
  var shopScore   = shop ? Math.min(shop.total/500000,1)*25 : 0;
  var priceScore  = (shop&&shop.minPrice>0) ? 15 : 0;
  return Math.round(ratioScore+surgeScore+shopScore+priceScore);
}

module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();

  if(!process.env.NAVER_CLIENT_ID||!process.env.NAVER_CLIENT_SECRET){
    return res.status(500).json({error:'NAVER 환경변수 누락'});
  }

  // 캐시
  if(CACHE.data&&(Date.now()-CACHE.ts<CACHE.TTL)){
    return res.status(200).json(Object.assign({},CACHE.data,{fromCache:true,cacheAge:Math.round((Date.now()-CACHE.ts)/1000)+'초 전'}));
  }

  try{
    // 1. 주요 카테고리 쇼핑인사이트 수집
    var CATS = [
      {id:'50000003', name:'디지털/가전'},
      {id:'50000002', name:'화장품/미용'},
      {id:'50000008', name:'생활/건강'},
      {id:'50000007', name:'스포츠/레저'},
      {id:'50000006', name:'식품'}
    ];

    var catResults = await Promise.allSettled(
      CATS.map(function(c){return fetchShoppingKeywords(c.id, c.name);})
    );

    // 2. 키워드 풀 구성 — 카테고리별 상위 급상승 3개
    var pool = [];
    catResults.forEach(function(r){
      if(r.status!=='fulfilled') return;
      var kws = r.value.keywords
        .filter(function(k){return k.keyword&&k.ratio>0;})
        .sort(function(a,b){return b.surgeRate-a.surgeRate;})
        .slice(0,3);
      kws.forEach(function(k){
        pool.push({keyword:k.keyword, ratio:k.ratio, surgeRate:k.surgeRate, category:r.value.catName});
      });
    });

    // 풀이 비면 CAT_SEEDS 폴백
    if(!pool.length){
      var FALLBACK = ['무선이어폰','로봇청소기','선크림','마사지건','단백질쉐이크','요가매트','에어프라이어','스마트워치'];
      FALLBACK.forEach(function(kw){pool.push({keyword:kw, ratio:50, surgeRate:0, category:'일반'});});
    }

    // 3. Naver 쇼핑 교차 검증 (동시 3개)
    var results = [];
    for(var i=0;i<pool.length;i+=3){
      var batch = pool.slice(i,i+3);
      var batchRes = await Promise.allSettled(batch.map(function(item){
        return naverShopCheck(item.keyword).then(function(shop){
          return {item:item, shop:shop};
        });
      }));
      batchRes.forEach(function(r){
        if(r.status!=='fulfilled') return;
        var v=r.value, score=hotScore(v.item.ratio, v.item.surgeRate, v.shop);
        results.push({
          keyword:  v.item.keyword,
          category: v.item.category,
          ratio:    v.item.ratio,
          surgeRate:v.item.surgeRate,
          traffic:  v.item.surgeRate>0?'+'+v.item.surgeRate+'%':'–',
          score:    score,
          grade:    score>=70?'A':score>=50?'B':'C',
          label:    score>=70?'🔥 핫':score>=50?'📈 상승':'🆕 신규',
          shop:     v.shop
        });
      });
    }

    results = results
      .filter(function(r){return r.shop&&r.shop.itemCount>0;})
      .sort(function(a,b){return b.score-a.score;})
      .slice(0,20);

    var data={
      items:results, total:results.length,
      trendCount:pool.length,
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
