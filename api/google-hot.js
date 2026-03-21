/**
 * /api/google-hot.js
 * Google Trends RSS + Naver 교차 검증으로 "지금 뜨는 제품" 추출
 *
 * 흐름:
 * 1. Google Trends 실시간 급상승 검색어 (RSS) 수집
 * 2. 쇼핑 관련 키워드만 필터링
 * 3. Naver 쇼핑 API로 교차 검증 (실제 판매 가능 여부)
 * 4. 점수화 후 TOP N 반환
 */

var https  = require('https');
var http   = require('http');
var SCORE  = require('./_score');

var TIMEOUT = 8000;
var CACHE   = {data:null, ts:0, TTL:10*60*1000}; // 10분 캐시

// ── 쇼핑 관련 키워드 필터
var SHOPPING_KW = [
  '추천','구매','할인','세일','신상','출시','발매','가격','리뷰','후기',
  '신제품','언박싱','핫딜','쿠폰','무료배송','최저가','인기','베스트',
  '사용법','비교','순위','제품','상품','브랜드'
];
var EXCLUDE_KW = [
  '사망','사고','범죄','폭행','살인','화재','지진','태풍','코로나','확진',
  '정치','선거','국회','대통령','논란','의혹','수사','체포'
];

function isShoppingRelated(keyword){
  var kw = keyword.toLowerCase();
  if(EXCLUDE_KW.some(function(w){return kw.indexOf(w)>-1;})) return false;
  // 쇼핑 키워드 포함이거나 브랜드/제품명 패턴
  if(SHOPPING_KW.some(function(w){return kw.indexOf(w)>-1;})) return true;
  // 영문 포함 → 제품명 가능성
  if(/[a-zA-Z]/.test(keyword)&&keyword.length>=2) return true;
  // 숫자 포함 → 모델명 가능성
  if(/\d/.test(keyword)&&keyword.length>=2) return true;
  return false;
}

// ── Google Trends 실시간 RSS (한국)
function fetchGoogleTrends(){
  return new Promise(function(resolve){
    var t = setTimeout(function(){resolve([]);}, TIMEOUT);
    var url = 'https://trends.google.com/trending/rss?geo=KR';
    https.get(url, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{
          var items=[], re=/<title><!\[CDATA\[([^\]]+)\]\]><\/title>|<title>([^<]+)<\/title>/g, m;
          var approxRe = /<ht:approx_traffic>([^<]+)<\/ht:approx_traffic>/g;
          var traffics=[], tm;
          while((tm=approxRe.exec(raw))!==null) traffics.push(tm[1]);
          var idx=0;
          while((m=re.exec(raw))!==null){
            var title=(m[1]||m[2]||'').trim();
            if(title&&title!=='Google 트렌드'&&title!=='Google Trends'){
              items.push({keyword:title, traffic:traffics[idx]||'0'});
              idx++;
            }
          }
          resolve(items.slice(0,30));
        }catch(e){resolve([]);}
      });
    }).on('error',function(){clearTimeout(t);resolve([]);});
  });
}

// ── Naver 쇼핑으로 교차 검증
function naverShopCheck(keyword){
  return new Promise(function(resolve){
    var qs='query='+encodeURIComponent(keyword)+'&display=10&sort=sim';
    var t=setTimeout(function(){resolve(null);},TIMEOUT);
    var req=https.request({
      hostname:'openapi.naver.com', path:'/v1/search/shop.json?'+qs, method:'GET',
      headers:{'X-Naver-Client-Id':process.env.NAVER_CLIENT_ID,'X-Naver-Client-Secret':process.env.NAVER_CLIENT_SECRET}
    },function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{
          var d=JSON.parse(raw);
          var items=(d.items||[]).filter(function(i){return Number(i.lprice||i.price||0)>0;});
          resolve({
            total:Number(d.total||0),
            itemCount:items.length,
            minPrice:items.length?Math.min.apply(null,items.map(function(i){return Number(i.lprice||i.price||0);})):0,
            maxPrice:items.length?Math.max.apply(null,items.map(function(i){return Number(i.lprice||i.price||0);})):0,
            topItems:items.slice(0,3).map(function(i){
              return {
                title:String(i.title||'').replace(/<[^>]+>/g,''),
                link:i.link||'',
                price:Number(i.lprice||i.price||0),
                image:i.image||'',
                mall:i.mallName||''
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

// ── 트래픽 문자열 → 숫자
function parseTraffic(t){
  if(!t) return 0;
  var s=String(t).replace(/[,+\s]/g,'');
  if(s.indexOf('만')>-1) return parseFloat(s)*10000;
  if(s.indexOf('K')>-1||s.indexOf('k')>-1) return parseFloat(s)*1000;
  if(s.indexOf('M')>-1||s.indexOf('m')>-1) return parseFloat(s)*1000000;
  return parseInt(s)||0;
}

// ── 종합 점수
function hotScore(trend, shop){
  if(!shop) return 0;
  var traffic   = Math.min(parseTraffic(trend.traffic)/100000, 1)*40;  // 최대 40점
  var shopScore = Math.min(shop.total/500000, 1)*30;                    // 최대 30점
  var itemScore = Math.min(shop.itemCount/10, 1)*20;                    // 최대 20점
  var priceScore= shop.minPrice>0 ? 10 : 0;                            // 가격 존재 10점
  return Math.round(traffic+shopScore+itemScore+priceScore);
}

module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();

  if(!process.env.NAVER_CLIENT_ID||!process.env.NAVER_CLIENT_SECRET){
    return res.status(500).json({error:'NAVER 환경변수 누락'});
  }

  // 캐시 확인
  if(CACHE.data&&(Date.now()-CACHE.ts<CACHE.TTL)){
    return res.status(200).json(Object.assign({},CACHE.data,{fromCache:true,cacheAge:Math.round((Date.now()-CACHE.ts)/1000)+'초 전'}));
  }

  try{
    // 1. Google Trends 수집
    var trends = await fetchGoogleTrends();
    if(!trends.length) return res.status(200).json({items:[],total:0,message:'Google Trends 데이터 없음',updatedAt:new Date().toISOString()});

    // 2. 쇼핑 관련 필터링
    var filtered = trends.filter(function(t){return isShoppingRelated(t.keyword);}).slice(0,15);
    if(!filtered.length) filtered = trends.slice(0,10); // fallback

    // 3. Naver 교차 검증 (동시 5개 제한)
    var results=[], i=0;
    while(i<filtered.length){
      var batch=filtered.slice(i,i+5);
      var batchRes=await Promise.allSettled(batch.map(function(t){return naverShopCheck(t.keyword);}));
      batchRes.forEach(function(r,j){
        var trend=batch[j], shop=r.status==='fulfilled'?r.value:null;
        var score=hotScore(trend, shop);
        results.push({
          keyword:    trend.keyword,
          traffic:    trend.traffic,
          score:      score,
          shop:       shop,
          grade:      score>=70?'A':score>=50?'B':'C',
          label:      score>=70?'🔥 핫':score>=50?'📈 상승':'🆕 신규'
        });
      });
      i+=5;
    }

    // 4. 점수순 정렬, 쇼핑 데이터 없는 것 제외
    results = results
      .filter(function(r){return r.shop&&r.shop.itemCount>0;})
      .sort(function(a,b){return b.score-a.score;})
      .slice(0,20);

    var data={
      items:results, total:results.length,
      googleTrendCount:trends.length,
      filteredCount:filtered.length,
      updatedAt:new Date().toISOString(),
      fromCache:false
    };
    CACHE.data=data; CACHE.ts=Date.now();
    return res.status(200).json(data);

  }catch(e){
    console.error('[google-hot]',e.message);
    return res.status(500).json({error:'오류 발생',detail:e.message});
  }
};
