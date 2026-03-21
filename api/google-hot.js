var https = require('https');

var TIMEOUT = 8000;
var CACHE   = {data:null, ts:0, TTL:10*60*1000};

var CATS = [
  {id:'50000003', name:'디지털/가전'},
  {id:'50000002', name:'화장품/미용'},
  {id:'50000008', name:'생활/건강'},
  {id:'50000007', name:'스포츠/레저'},
  {id:'50000006', name:'식품'},
  {id:'50000004', name:'가구/인테리어'},
  {id:'50000012', name:'반려동물'}
];

function post(path, body){
  return new Promise(function(resolve){
    var buf = Buffer.from(body);
    var t   = setTimeout(function(){resolve(null);}, TIMEOUT);
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
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{resolve(JSON.parse(raw));}catch(e){resolve(null);}
      });
    });
    req.on('error',function(){clearTimeout(t);resolve(null);});
    req.write(buf);
    req.end();
  });
}

function get(path){
  return new Promise(function(resolve){
    var t = setTimeout(function(){resolve(null);}, TIMEOUT);
    var req = https.request({
      hostname:'openapi.naver.com', path:path, method:'GET',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
      }
    }, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{resolve(JSON.parse(raw));}catch(e){resolve(null);}
      });
    });
    req.on('error',function(){clearTimeout(t);resolve(null);});
    req.end();
  });
}

function pad(n){return String(n).padStart(2,'0');}
function fmt(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function ago(n){var d=new Date();d.setDate(d.getDate()-n);return d;}

async function getCatKeywords(cat){
  var body = JSON.stringify({
    startDate: fmt(ago(7)),
    endDate:   fmt(new Date()),
    timeUnit:  'date',
    category:  cat.id,
    keyword:   [{name:'trend', param:[]}],
    device:'', gender:'', ages:[]
  });
  var d = await post('/v1/datalab/shopping/category/keywords', body);
  if(!d||!Array.isArray(d.results)) return [];
  return d.results.map(function(r){
    var pts    = r.data||[];
    var recent = pts.slice(-3).reduce(function(s,p){return s+Number(p.ratio||0);},0)/3;
    var old    = pts.slice(0,4).reduce(function(s,p){return s+Number(p.ratio||0);},0)/4;
    var surge  = old>0 ? Math.round(((recent-old)/old)*100) : 0;
    return {keyword:r.title||'', ratio:recent, surge:surge, category:cat.name};
  }).filter(function(k){return k.keyword&&k.ratio>0;});
}

async function shopCheck(kw){
  var d = await get('/v1/search/shop.json?query='+encodeURIComponent(kw)+'&display=5&sort=sim');
  if(!d||!Array.isArray(d.items)) return null;
  var items = d.items.filter(function(i){return Number(i.lprice||0)>0;});
  return {
    total:     Number(d.total||0),
    itemCount: items.length,
    minPrice:  items.length ? Math.min.apply(null,items.map(function(i){return Number(i.lprice||0);})) : 0,
    topItems:  items.slice(0,3).map(function(i){return {
      title: (i.title||'').replace(/<[^>]+>/g,''),
      link:  i.link||'', price:Number(i.lprice||0), image:i.image||'', mall:i.mallName||''
    };})
  };
}

module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();

  if(!process.env.NAVER_CLIENT_ID||!process.env.NAVER_CLIENT_SECRET)
    return res.status(500).json({error:'NAVER 환경변수 누락'});

  if(CACHE.data&&(Date.now()-CACHE.ts<CACHE.TTL))
    return res.status(200).json(Object.assign({},CACHE.data,{fromCache:true,cacheAge:Math.round((Date.now()-CACHE.ts)/1000)+'초 전'}));

  try{
    // 1. 카테고리별 인기 키워드 수집
    var catRes = await Promise.allSettled(CATS.map(getCatKeywords));
    var pool = [];
    catRes.forEach(function(r){
      if(r.status!=='fulfilled'||!r.value.length) return;
      r.value.sort(function(a,b){return b.surge-a.surge;}).slice(0,3).forEach(function(k){pool.push(k);});
    });

    if(!pool.length) return res.status(200).json({items:[],total:0,message:'데이터 없음',updatedAt:new Date().toISOString()});

    // 2. 쇼핑 교차검증
    var results = [];
    for(var i=0;i<pool.length;i+=3){
      var batch = pool.slice(i,i+3);
      var bRes  = await Promise.allSettled(batch.map(function(k){
        return shopCheck(k.keyword).then(function(shop){return {k:k,shop:shop};});
      }));
      bRes.forEach(function(r){
        if(r.status!=='fulfilled'||!r.value.shop) return;
        var v=r.value, k=v.k, shop=v.shop;
        if(!shop.itemCount) return;
        var score = Math.round(
          Math.min(k.ratio/100,1)*30 +
          (k.surge>=50?30:k.surge>=20?20:k.surge>=0?10:0) +
          Math.min(shop.total/500000,1)*25 +
          (shop.minPrice>0?15:0)
        );
        results.push({
          keyword:  k.keyword,
          category: k.category,
          surge:    k.surge,
          traffic:  k.surge>0?'+'+k.surge+'%':'–',
          score:    score,
          grade:    score>=70?'A':score>=50?'B':'C',
          label:    score>=70?'🔥 핫':score>=50?'📈 상승':'🆕 신규',
          shop:     shop
        });
      });
    }

    results.sort(function(a,b){return b.score-a.score;});
    results = results.slice(0,20);

    var data = {items:results, total:results.length, trendCount:pool.length, updatedAt:new Date().toISOString(), fromCache:false};
    CACHE.data=data; CACHE.ts=Date.now();
    return res.status(200).json(data);

  }catch(e){
    console.error('[google-hot]',e.message);
    return res.status(500).json({error:'오류', detail:e.message});
  }
};
