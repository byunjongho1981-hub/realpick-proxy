var https = require('https');

function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }

function fmtDate(d){
  var p=function(n){return String(n).padStart(2,'0');};
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}

// ── 카테고리별 대표 검색 쿼리 ─────────────────────────────────
var CAT_QUERY = {
  '50000000': ['여성의류','남성의류','봄옷'],
  '50000001': ['여성가방','모자','신발'],
  '50000002': ['스킨케어','선크림','화장품'],
  '50000003': ['무선이어폰','스마트폰 액세서리','노트북'],
  '50000004': ['수납','인테리어소품','조명'],
  '50000005': ['건강식품','다이어트식품','간식'],
  '50000006': ['운동용품','요가','러닝'],
  '50000007': ['생활용품','청소용품','주방'],
  '50000009': ['유아용품','아기','육아'],
  '50000010': ['강아지용품','고양이용품','반려동물'],
  '50000011': ['차량용품','자동차 액세서리','세차'],
};

// ── 노이즈 필터 (브랜드명, 단음절, 숫자 등) ──────────────────
var NOISE = /^(외|개|등|및|세트|증정|무료|배송|특가|할인|신상|베스트|추천|인기|정품|공식|브랜드|상품|제품|스타일|디자인|여성|남성|아동|유아|한국|국내|해외|\d+)$/;
var NOISE_PATTERNS = [
  /^\d/,           // 숫자 시작
  /[%\/\(\)]/,     // 특수문자
  /^.{1}$/,        // 1글자
];

function isNoise(w){
  if(NOISE.test(w)) return true;
  for(var i=0;i<NOISE_PATTERNS.length;i++) if(NOISE_PATTERNS[i].test(w)) return true;
  return false;
}

// ── 네이버 쇼핑 검색 API ─────────────────────────────────────
function searchShop(query){
  return new Promise(function(resolve){
    var qs='query='+encodeURIComponent(query)+'&display=100&sort=sim';
    var done=false;
    var t=setTimeout(function(){if(!done){done=true;resolve([]);}},6000);
    var req=https.request({
      hostname:'openapi.naver.com',
      path:'/v1/search/shop.json?'+qs,
      method:'GET',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      }
    },function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        if(done)return; done=true; clearTimeout(t);
        try{
          var d=JSON.parse(raw);
          resolve(d.items||[]);
        }catch(e){ resolve([]); }
      });
    });
    req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve([]);}});
    req.setTimeout(5500,function(){req.destroy();});
    req.end();
  });
}

// ── 상품 타이틀에서 키워드 빈도 추출 ────────────────────────
function extractKeywords(items, topN){
  var freq={};
  items.forEach(function(item){
    // HTML 태그 제거 후 토큰화
    var title=(item.title||'').replace(/<[^>]+>/g,'').replace(/[+\[\]]/g,' ');
    var tokens=title.split(/\s+/);
    // 2~5글자 토큰, 2-gram 조합
    for(var i=0;i<tokens.length;i++){
      var w=tokens[i].trim();
      if(w.length>=2 && w.length<=8 && !isNoise(w)){
        freq[w]=(freq[w]||0)+1;
      }
      // 2-gram: "니트 가디건" 같은 복합어
      if(i+1<tokens.length){
        var w2=tokens[i].trim()+' '+tokens[i+1].trim();
        if(w2.length>=4 && w2.length<=12 && !isNoise(tokens[i].trim()) && !isNoise(tokens[i+1].trim())){
          freq[w2]=(freq[w2]||0)+0.5;
        }
      }
    }
  });
  return Object.keys(freq)
    .sort(function(a,b){return freq[b]-freq[a];})
    .slice(0,topN);
}

// ── 쇼핑인사이트 surge 계산 ──────────────────────────────────
function fetchSurge(catId, kw, startDate, endDate, timeUnit){
  return new Promise(function(resolve){
    var buf=Buffer.from(JSON.stringify({
      startDate:startDate, endDate:endDate, timeUnit:timeUnit,
      category:catId,
      keyword:[{name:kw, param:[kw]}],
      device:'', gender:'', ages:[],
    }),'utf8');
    var done=false;
    var t=setTimeout(function(){if(!done){done=true;resolve(null);}},6000);
    var req=https.request({
      hostname:'openapi.naver.com',
      path:'/v1/datalab/shopping/category/keywords',
      method:'POST',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
        'Content-Type':          'application/json',
        'Content-Length':        buf.length,
      }
    },function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        if(done)return; done=true; clearTimeout(t);
        try{
          var d=JSON.parse(raw);
          if(d.errorCode){ resolve(null); return; }
          resolve(d);
        }catch(e){ resolve(null); }
      });
    });
    req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve(null);}});
    req.setTimeout(5500,function(){req.destroy();});
    req.write(buf); req.end();
  });
}

module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST')    return res.status(405).json({error:'POST only'});

  var body='';
  req.on('data',function(c){body+=c;});
  req.on('end', async function(){
    try{
      var p       = JSON.parse(body);
      var catId   = p.catId  || '50000000';
      var period  = p.period || 'week';
      var queries = CAT_QUERY[catId] || ['인기상품'];

      var totalDays = period==='month'?60:14;
      var end   = new Date();
      var start = new Date(); start.setDate(end.getDate()-(totalDays+1));
      var timeUnit = period==='month'?'week':'date';

      // ① 쇼핑 검색으로 상품 수집
      var allItems=[];
      for(var i=0;i<queries.length;i++){
        var items=await searchShop(queries[i]);
        allItems=allItems.concat(items);
        console.log('[v3] query:"'+queries[i]+'" items:'+items.length);
        await sleep(100);
      }
      console.log('[v3] 총 상품:'+allItems.length);

      // ② 타이틀에서 키워드 추출 (상위 40개)
      var seeds=extractKeywords(allItems, 40);
      console.log('[v3] seeds top5:'+seeds.slice(0,5).join(' / '));

      if(!seeds.length) return res.status(200).json({items:[]});

      // ③ surge 계산
      var results=[];
      for(var j=0;j<seeds.length;j++){
        var kw=seeds[j];
        var data=await fetchSurge(catId, kw, fmtDate(start), fmtDate(end), timeUnit);

        if(data&&data.results&&data.results[0]){
          var r   = data.results[0];
          var pts = (r.data||[]).map(function(d){return parseFloat(d.ratio)||0;});
          if(pts.length>=2){
            var h   = Math.floor(pts.length/2);
            var avg = function(a){return a.reduce(function(s,v){return s+v;},0)/(a.length||1);};
            var pa  = avg(pts.slice(0,h));
            var ca  = avg(pts.slice(h));
            var cur = avg(pts.slice(-3));
            var surge = pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?50:0);
            // ratio 0인 키워드 제외 (인기 없는 키워드)
            if(cur>0){
              results.push({
                keyword:      kw,
                currentRatio: Math.round(cur*100)/100,
                surge:        surge,
                shopTrend:    surge>=30?'hot':surge>=10?'rising':surge>=-10?'stable':'falling',
              });
            }
          }
        }
        await sleep(150);
      }

      // ④ surge 우선, ratio 보조 정렬
      results.sort(function(a,b){
        if(b.surge!==a.surge) return b.surge-a.surge;
        return b.currentRatio-a.currentRatio;
      });

      var top20=results.slice(0,20);
      console.log('[v3] 완료 결과:'+results.length+'개 top1:'+(top20[0]&&top20[0].keyword));
      return res.status(200).json({items:top20});

    }catch(e){
      console.error('[v3]',e.message);
      return res.status(500).json({error:e.message});
    }
  });
};
