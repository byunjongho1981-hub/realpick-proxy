var https = require('https');
var CFG   = require('./_trend-config');

function safeNum(v){ return isNaN(Number(v))?0:Number(v); }
function safeRatio(v){ if(v===null||v===undefined||v==='') return 0; var n=parseFloat(String(v).replace(/[^0-9.-]/g,'')); return isNaN(n)?0:n; }
function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }
function fmtDate(d){ var p=function(n){return String(n).padStart(2,'0');}; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function agoDate(n){ var d=new Date(); d.setDate(d.getDate()-n); return d; }
function stripHtml(s){ return (s||'').replace(/<[^>]+>/g,''); }

// ── 공통 GET ─────────────────────────────────────────────────
function naverGet(path, params){
  return new Promise(function(resolve){
    try{
      var qs=Object.keys(params).map(function(k){
        return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);
      }).join('&');
      var done=false;
      var t=setTimeout(function(){if(!done){done=true;resolve(null);}},5000);
      var req=https.request({
        hostname:'openapi.naver.com', path:path+'?'+qs, method:'GET',
        headers:{'X-Naver-Client-Id':process.env.NAVER_CLIENT_ID,'X-Naver-Client-Secret':process.env.NAVER_CLIENT_SECRET}
      },function(res){
        var raw='';
        res.on('data',function(c){raw+=c;});
        res.on('end',function(){
          if(done)return; done=true; clearTimeout(t);
          try{ var d=JSON.parse(raw); if(d.errorCode){console.error('[naverGet]',path,d.errorCode,d.errorMessage);resolve(null);return;} resolve(d); }
          catch(e){resolve(null);}
        });
      });
      req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve(null);}});
      req.setTimeout(4500,function(){req.destroy();});
      req.end();
    }catch(e){resolve(null);}
  });
}

// ── 공통 POST ────────────────────────────────────────────────
function naverPost(path, body){
  return new Promise(function(resolve){
    try{
      var buf=Buffer.from(JSON.stringify(body),'utf8');
      var done=false;
      var t=setTimeout(function(){if(!done){done=true;resolve(null);}},5000);
      var req=https.request({
        hostname:'openapi.naver.com', path:path, method:'POST',
        headers:{'X-Naver-Client-Id':process.env.NAVER_CLIENT_ID,'X-Naver-Client-Secret':process.env.NAVER_CLIENT_SECRET,'Content-Type':'application/json','Content-Length':buf.length}
      },function(res){
        var raw='';
        res.on('data',function(c){raw+=c;});
        res.on('end',function(){
          if(done)return; done=true; clearTimeout(t);
          try{ var d=JSON.parse(raw); if(d.errorCode){console.error('[naverPost]',path,d.errorCode,d.errorMessage);resolve(null);return;} resolve(d); }
          catch(e){resolve(null);}
        });
      });
      req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve(null);}});
      req.setTimeout(4500,function(){req.destroy();});
      req.write(buf); req.end();
    }catch(e){resolve(null);}
  });
}

// ── 키워드 변형 ───────────────────────────────────────────────
function expandKeyword(kw){
  return [kw, kw+' 추천', kw+' 후기', kw+' 비교'];
}

// ── 동의어 맵 (검색 API 텍스트 분석용) ───────────────────────
var synonymMap={
  '트위드자켓':['트위드자켓','트위드코트','트위드블레이저'],'원피스':['원피스','드레스','미니원피스','맥시원피스'],
  '트렌치코트':['트렌치코트','트렌치','봄코트','롱코트'],'바람막이':['바람막이','윈드브레이커','방풍자켓'],
  '스웨이드자켓':['스웨이드자켓','스웨이드코트','무스탕'],'가죽자켓':['가죽자켓','레더자켓','바이커자켓'],
  '여성가디건':['여성가디건','니트가디건','롱가디건'],'블라우스':['블라우스','셔츠블라우스','여성셔츠'],
  '후드집업':['후드집업','집업후드','후드자켓'],'경량패딩':['경량패딩','경량점퍼','초경량패딩'],
  '청바지':['청바지','데님팬츠','진바지','스키니진'],'니트':['니트','니트스웨터','울니트'],
  '맨투맨':['맨투맨','스웨트셔츠','크루넥'],'와이드팬츠':['와이드팬츠','통바지','와이드슬랙스'],
  '슬랙스':['슬랙스','정장바지','드레스팬츠'],'레깅스':['레깅스','요가바지','운동바지','타이츠'],
  '크로스백':['크로스백','크로스바디백','숄더크로스백'],'미니백':['미니백','미니숄더백','미니크로스백'],
  '캔버스백':['캔버스백','에코백','천가방'],'버킷햇':['버킷햇','벙거지','버킷모자'],
  '선글라스':['선글라스','썬글라스','UV차단선글라스'],'슬리퍼':['슬리퍼','실내슬리퍼','쪼리','플립플랍'],
  '스니커즈':['스니커즈','운동화','캐주얼신발'],'숄더백':['숄더백','숄더핸드백','토트숄더백'],
  '토트백':['토트백','대용량토트백','쇼핑백'],'볼캡':['볼캡','야구모자','캡모자'],
  '선크림':['선크림','썬크림','자외선차단제','선스크린'],'썬크림':['썬크림','선크림','자외선차단제'],
  '토너패드':['토너패드','스킨패드','코튼패드'],'수분크림':['수분크림','보습크림','모이스처라이저'],
  '쿠션팩트':['쿠션팩트','쿠션파운데이션','에어쿠션'],'클렌징오일':['클렌징오일','메이크업클렌저','더블클렌징'],
  '마스크팩':['마스크팩','시트마스크','페이스팩','수면팩'],'레티놀크림':['레티놀크림','레티놀세럼','안티에이징크림'],
  '무선이어폰':['무선이어폰','블루투스이어폰','에어팟','TWS이어폰'],
  '보조배터리':['보조배터리','파워뱅크','휴대용충전기','충전배터리'],
  '스마트워치':['스마트워치','애플워치','갤럭시워치','스마트밴드'],
  '블루투스스피커':['블루투스스피커','무선스피커','포터블스피커'],
  'USB허브':['USB허브','USB멀티포트','C타입허브'],
  '기계식키보드':['기계식키보드','게이밍키보드','무선키보드'],
  '수납박스':['수납박스','수납함','정리함','수납바구니'],
  '옷걸이행거':['옷걸이행거','행거','이동식행거'],
  '러그':['러그','카펫','거실매트'],'화분':['화분','인테리어화분','다육화분'],
  '캔들':['캔들','향초','소이캔들','아로마캔들'],
  '단백질쉐이크':['단백질쉐이크','프로틴쉐이크','단백질보충제','WPI프로틴'],
  '홍삼':['홍삼','홍삼정','홍삼농축액'],'유산균':['유산균','프로바이오틱스','장유산균'],
  '콜라겐':['콜라겐','저분자콜라겐','콜라겐펩타이드'],
  '비타민D':['비타민D','비타민D3','비타민D+K2'],'오메가3':['오메가3','EPA DHA','피쉬오일'],
  '요가매트':['요가매트','운동매트','필라테스매트'],
  '폼롤러':['폼롤러','마사지롤러','근막롤러','근막이완'],
  '러닝화':['러닝화','조깅화','마라톤화'],'덤벨':['덤벨','아령','가변덤벨'],
  '등산화':['등산화','트레킹화','하이킹화'],
  '가습기':['가습기','초음파가습기','기화식가습기','무선가습기'],
  '무선청소기':['무선청소기','핸디청소기','스틱청소기','코드리스청소기'],
  '전기장판':['전기장판','전기매트','온열매트'],
  '텀블러':['텀블러','보온텀블러','스탠리텀블러','보냉텀블러'],
  '강아지간식':['강아지간식','강아지트릿','반려견간식'],
  '고양이사료':['고양이사료','고양이캔','습식사료'],
  '블랙박스':['블랙박스','차량용블랙박스','전후방블랙박스'],
  '차량용충전기':['차량용충전기','시거잭충전기','차량USB충전기'],
};

// ── 데이터랩 동의어 그룹 ─────────────────────────────────────
function buildSynonymGroup(kw){
  var synonyms={
    '트위드자켓':['트위드자켓','트위드코트','트위드블레이저'],'원피스':['원피스','드레스','미니원피스','맥시원피스'],
    '트렌치코트':['트렌치코트','트렌치','봄코트','롱코트'],'바람막이':['바람막이','윈드브레이커','방풍자켓'],
    '가죽자켓':['가죽자켓','레더자켓','바이커자켓'],'여성가디건':['여성가디건','니트가디건','롱가디건'],
    '블라우스':['블라우스','셔츠블라우스','여성셔츠'],'후드집업':['후드집업','집업후드','후드자켓'],
    '경량패딩':['경량패딩','경량점퍼','초경량패딩'],'청바지':['청바지','데님팬츠','진바지'],
    '니트':['니트','니트스웨터','울니트'],'맨투맨':['맨투맨','스웨트셔츠','크루넥'],
    '와이드팬츠':['와이드팬츠','통바지','와이드슬랙스'],'슬랙스':['슬랙스','정장바지','드레스팬츠'],
    '레깅스':['레깅스','요가바지','운동바지','타이츠'],
    '크로스백':['크로스백','크로스바디백','숄더크로스백'],'숄더백':['숄더백','숄더핸드백','토트숄더백'],
    '토트백':['토트백','대용량토트백','쇼핑백'],'선글라스':['선글라스','썬글라스','UV차단선글라스'],
    '슬리퍼':['슬리퍼','실내슬리퍼','쪼리','플립플랍'],'스니커즈':['스니커즈','운동화','캐주얼신발'],
    '선크림':['선크림','썬크림','자외선차단제','선스크린'],'썬크림':['썬크림','선크림','자외선차단제'],
    '수분크림':['수분크림','보습크림','모이스처라이저'],
    '쿠션팩트':['쿠션팩트','쿠션파운데이션','에어쿠션'],
    '마스크팩':['마스크팩','시트마스크','페이스팩','수면팩'],
    '레티놀크림':['레티놀크림','레티놀세럼','안티에이징크림'],
    '무선이어폰':['무선이어폰','블루투스이어폰','에어팟','TWS이어폰'],
    '보조배터리':['보조배터리','파워뱅크','휴대용충전기','충전배터리'],
    '스마트워치':['스마트워치','애플워치','갤럭시워치','스마트밴드'],
    '블루투스스피커':['블루투스스피커','무선스피커','포터블스피커'],
    '기계식키보드':['기계식키보드','게이밍키보드','무선키보드'],
    '수납박스':['수납박스','수납함','정리함','수납바구니'],
    '러그':['러그','카펫','거실매트'],'캔들':['캔들','향초','소이캔들','아로마캔들'],
    '단백질쉐이크':['단백질쉐이크','프로틴쉐이크','단백질보충제'],
    '홍삼':['홍삼','홍삼정','홍삼농축액'],'유산균':['유산균','프로바이오틱스','장유산균'],
    '오메가3':['오메가3','EPA DHA','피쉬오일'],
    '요가매트':['요가매트','운동매트','필라테스매트'],
    '폼롤러':['폼롤러','마사지롤러','근막롤러','근막이완'],
    '러닝화':['러닝화','조깅화','마라톤화'],'덤벨':['덤벨','아령','가변덤벨'],
    '등산화':['등산화','트레킹화','하이킹화'],
    '가습기':['가습기','초음파가습기','기화식가습기','무선가습기'],
    '무선청소기':['무선청소기','핸디청소기','스틱청소기'],
    '전기장판':['전기장판','전기매트','온열매트'],
    '텀블러':['텀블러','보온텀블러','스탠리텀블러','보냉텀블러'],
    '강아지간식':['강아지간식','강아지트릿','반려견간식'],
    '고양이사료':['고양이사료','고양이캔','습식사료'],
    '블랙박스':['블랙박스','차량용블랙박스','전후방블랙박스'],
  };
  return synonyms[kw]||[kw];
}

// ── 네이버 검색 ───────────────────────────────────────────────
async function fetchNaverSearchData(keyword){
  var result = await _fetchSearch(keyword);
  if(result) return result;
  await sleep(300);
  result = await _fetchSearch(keyword+' 추천');
  if(result) return result;
  console.warn('[search fallback]',keyword);
  return {blogCount:0,newsCount:0,cafeCount:0,kinCount:0,cafeSignal:'none',shopExists:false,shopItemCount:0,buyIntentHits:0,shoppingExists:false,allText:'',recentPostRatio:0,recentNewsRatio:0,avgPrice:0,priceGrade:'unknown',brands:[],categories:[],categories2:[],sampleShopItems:[],_fallback:true};
}

async function _fetchSearch(keyword){
  var blogRes = await naverGet('/v1/search/blog.json',{query:keyword,display:10,sort:'sim'});
  await sleep(150);
  var shopRes = await naverGet('/v1/search/shop.json',{query:keyword,display:10,sort:'sim',exclude:'used:rental:cbshop'});
  await sleep(150);
  var newsRes = await naverGet('/v1/search/news.json',{query:keyword,display:10,sort:'sim'});

  if(!blogRes&&!shopRes&&!newsRes) return null;

  var blogCount  = blogRes?safeNum(blogRes.total):0;
  var newsCount  = newsRes?safeNum(newsRes.total):0;
  var shopExists = !!(shopRes&&shopRes.items&&shopRes.items.length>0);
  var shopItems  = shopRes?(shopRes.items||[]):[];

  var allTitles=[];
  if(blogRes&&blogRes.items) allTitles=allTitles.concat(blogRes.items.map(function(i){return stripHtml(i.title)+' '+stripHtml(i.description||'');}));
  if(shopRes&&shopRes.items) allTitles=allTitles.concat(shopRes.items.map(function(i){return stripHtml(i.title)+' '+stripHtml(i.description||'');}));
  if(newsRes&&newsRes.items) allTitles=allTitles.concat(newsRes.items.map(function(i){return stripHtml(i.title)+' '+stripHtml(i.description||'');}));
  var allText=allTitles.join(' ');
  var buyIntentHits=0;
  CFG.BUY_INTENT_SIGNALS.forEach(function(sig){if(allText.indexOf(sig)>-1)buyIntentHits++;});

  // 블로그 최근 30일 신선도
  var recentPostCount=0;
  var d30=new Date(); d30.setDate(d30.getDate()-30);
  var threshold30=parseInt(d30.getFullYear()+String(d30.getMonth()+1).padStart(2,'0')+String(d30.getDate()).padStart(2,'0'));
  if(blogRes&&blogRes.items) blogRes.items.forEach(function(i){
    var pd=parseInt((i.postdate||'').replace(/[^0-9]/g,''));
    if(pd&&pd>=threshold30) recentPostCount++;
  });
  var recentRatio=blogRes&&blogRes.items&&blogRes.items.length>0?Math.round(recentPostCount/blogRes.items.length*100):0;

  // 뉴스 최근 7일
  var recentNewsCount=0;
  var d7=new Date(); d7.setDate(d7.getDate()-7);
  if(newsRes&&newsRes.items) newsRes.items.forEach(function(i){
    try{ var pd=new Date(i.pubDate); if(!isNaN(pd.getTime())&&pd>=d7) recentNewsCount++; }catch(e){}
  });
  var recentNewsRatio=newsRes&&newsRes.items&&newsRes.items.length>0?Math.round(recentNewsCount/newsRes.items.length*100):0;

  // 쇼핑 가격/브랜드/카테고리
  var priceList=[],brandSet={},categorySet={},category2Set={};
  if(shopRes&&shopRes.items) shopRes.items.forEach(function(i){
    var lp=safeNum(i.lprice); if(lp>0) priceList.push(lp);
    if(i.brand&&i.brand.trim()) brandSet[i.brand.trim()]=true;
    if(i.category1) categorySet[i.category1]=true;
    if(i.category2) category2Set[i.category2]=true;
  });
  var avgPrice=priceList.length?Math.round(priceList.reduce(function(s,v){return s+v;},0)/priceList.length):0;
  var priceGrade=avgPrice>=200000?'high':avgPrice>=50000?'mid':avgPrice>0?'low':'unknown';

  if(blogCount===0&&newsCount===0&&!shopExists) return null;

  return {
    blogCount,newsCount,cafeCount:0,kinCount:0,cafeSignal:'none',
    shopExists,shopItemCount:shopItems.length,
    buyIntentHits,shoppingExists:shopExists,allText,
    recentPostRatio:recentRatio,
    recentNewsRatio:recentNewsRatio,
    avgPrice,priceGrade,
    brands:Object.keys(brandSet).slice(0,3),
    categories:Object.keys(categorySet).slice(0,2),
    categories2:Object.keys(category2Set).slice(0,3),
    sampleShopItems:shopItems.slice(0,3).map(function(i){
      var lp=safeNum(i.lprice),hp=safeNum(i.hprice);
      return {title:stripHtml(i.title),price:lp,hprice:hp>0?hp:null,mallName:i.mallName||'네이버',brand:i.brand&&i.brand.trim()||'',maker:i.maker||'',category1:i.category1||'',category2:i.category2||'',category3:i.category3||'',link:i.link||''};
    }),
  };
}

// ── 자동완성 ──────────────────────────────────────────────────
function fetchNaverSuggestions(keyword){
  return new Promise(function(resolve){
    try{
      var enc=encodeURIComponent(keyword);
      var done=false;
      var t=setTimeout(function(){if(!done){done=true;resolve([]);}},3000);
      var req=https.request({
        hostname:'ac.search.naver.com',
        path:'/nx/ac?q='+enc+'&q_enc=UTF-8&st=100&r_format=json&r_enc=UTF-8',
        method:'GET',headers:{'User-Agent':'Mozilla/5.0','Referer':'https://search.naver.com/'}
      },function(res){
        var raw='';
        res.on('data',function(c){raw+=c;});
        res.on('end',function(){
          if(done)return; done=true; clearTimeout(t);
          try{ var d=JSON.parse(raw); var items=(d.items&&d.items[0])?d.items[0].slice(0,8).map(function(r){return r[0];}):[];resolve(items); }
          catch(e){resolve([]);}
        });
      });
      req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve([]);}});
      req.setTimeout(2500,function(){req.destroy();});
      req.end();
    }catch(e){resolve([]);}
  });
}

// ── 전체검색 의도 분석 ────────────────────────────────────────
function calcSearchIntentFromData(keyword, naverData, suggestions){
  var sugs=Array.isArray(suggestions)?suggestions:[];
  var kw=typeof keyword==='string'?keyword.toLowerCase():'';
  var sugText=sugs.join(' ').toLowerCase();
  var score=30,type='explore',buyCnt=0,probCnt=0,infoCnt=0,detected=[];

  CFG.SEARCH_INTENT.BUY.forEach(function(p){if(kw.indexOf(p)>-1){buyCnt++;score+=8;type='buy';if(detected.length<3)detected.push(p);}});
  CFG.SEARCH_INTENT.PROBLEM.forEach(function(p){if(kw.indexOf(p)>-1){probCnt++;score+=6;type='problem';if(detected.length<3)detected.push(p);}});
  CFG.SEARCH_INTENT.INFO.forEach(function(p){if(kw.indexOf(p)>-1){infoCnt++;score+=3;if(type==='explore')type='info';}});
  if(/^[가-힣]{2,6}$/.test(keyword)){score+=12;if(type==='explore')type='buy';}

  if(sugs.length>=6) score+=10; else if(sugs.length>=3) score+=5;
  sugs.forEach(function(sug){
    var s2=sug.toLowerCase();
    CFG.SEARCH_INTENT.BUY.forEach(function(p){if(s2.indexOf(p)>-1){score+=2;if(detected.length<3)detected.push(p+'(자동완성)');}});
  });
  if(detected.length===0&&sugs.length>0){
    for(var si=0;si<Math.min(sugs.length,3);si++){if(sugs[si]!==keyword)detected.push(sugs[si]);}
  }

  if(!naverData||naverData._fallback){
    var br0=type==='buy'?Math.max(50,Math.round(buyCnt/Math.max(buyCnt+probCnt+infoCnt,1)*100)):0;
    return {type:type,score:Math.min(100,Math.max(0,Math.round(score))),buyRatio:br0,patterns:detected,suggestions:sugs};
  }

  var text=(naverData.allText||'').toLowerCase()+' '+kw;
  var tBuy=0,tProb=0,tInfo=0;
  CFG.SEARCH_INTENT.BUY.forEach(function(p){if(text.indexOf(p)>-1){tBuy++;if(detected.length<3)detected.push(p);}});
  CFG.SEARCH_INTENT.PROBLEM.forEach(function(p){if(text.indexOf(p)>-1){tProb++;if(detected.length<3)detected.push(p);}});
  CFG.SEARCH_INTENT.INFO.forEach(function(p){if(text.indexOf(p)>-1)tInfo++;});

  if(naverData.shoppingExists&&tBuy>=2) type='buy';
  else if(tProb>tBuy&&tProb>=2) type='problem';
  else if(tInfo>tBuy&&tInfo>tProb) type='info';
  else if(naverData.buyIntentHits>=3) type='buy';

  if(type==='buy') score+=40;
  else if(type==='problem') score+=25;
  else if(type==='info') score+=10;

  if(naverData.shoppingExists) score+=15;
  score+=Math.min(20,(naverData.buyIntentHits||0)*3);
  if((naverData.blogCount||0)>10000) score+=5;
  if((naverData.newsCount||0)>(naverData.blogCount||0)*2) score-=15;
  if(!naverData.shoppingExists) score-=10;
  if((naverData.recentNewsRatio||0)>=70) score+=8; else if((naverData.recentNewsRatio||0)>=40) score+=4;
  if(sugs.length>=6) score+=10; else if(sugs.length>=3) score+=5;

  var tot=Math.max(tBuy+tProb+tInfo,1);
  var buyRatio=type==='buy'?Math.max(50,Math.round(tBuy/tot*100)):Math.round(tBuy/tot*100);
  return {type:type,score:Math.min(100,Math.max(0,Math.round(score))),buyRatio:buyRatio,patterns:detected.slice(0,3),suggestions:sugs};
}

// ── 데이터랩 파싱 ─────────────────────────────────────────────
function parseDatalabResult(results, kwMap){
  var scores={};
  (results||[]).forEach(function(r){
    var kw=kwMap?kwMap[r.title]:r.title; if(!kw) return;
    var pts=(r.data||[]).map(function(d){return {period:d.period,ratio:safeRatio(d.ratio)};});
    if(pts.length<4){scores[kw]=5;return;}
    var h=Math.floor(pts.length/2);
    var avg=function(a){return a.reduce(function(s,p){return s+p.ratio;},0)/(a.length||1);};
    var pa=avg(pts.slice(0,h)),ca=avg(pts.slice(h));
    var surge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?50:0);
    var mid=pts.slice(h),eh=mid.slice(0,Math.floor(mid.length/2)),rh=mid.slice(Math.floor(mid.length/2));
    var accel=avg(eh)>0?Math.round(((avg(rh)-avg(eh))/avg(eh))*100):0;
    scores[kw]=Math.max(0,surge)+Math.max(0,accel)+Math.round(avg(pts.slice(-3))*10);
  });
  return scores;
}

function parseDatalab(result, keyword){
  var pts=(result.data||[]).map(function(d){return {period:d.period,ratio:safeRatio(d.ratio)};});
  if(pts.length<4) return {surgeRate:0,accel:0,durability:50,_fallback:true};
  var h=Math.floor(pts.length/2);
  var avg=function(a){return a.reduce(function(s,p){return s+p.ratio;},0)/(a.length||1);};
  var pa=avg(pts.slice(0,h)),ca=avg(pts.slice(h));
  var surge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
  var mid=pts.slice(h),eh=mid.slice(0,Math.floor(mid.length/2)),rh=mid.slice(Math.floor(mid.length/2));
  var accel=avg(eh)>0?Math.round(((avg(rh)-avg(eh))/avg(eh))*100):0;
  var all=avg(pts);
  var dur=Math.round((pts.filter(function(p){return p.ratio>=all;}).length/pts.length)*100);
  return {surgeRate:surge,accel:accel,durability:dur};
}

// ── 데이터랩 단일 키워드 ─────────────────────────────────────
async function fetchNaverDatalabForKeyword(keyword, period){
  var synonyms=buildSynonymGroup(keyword);
  var totalDays=period==='month'?60:14, timeUnit=period==='month'?'week':'date';
  var body={
    startDate:fmtDate(agoDate(totalDays+1)),endDate:fmtDate(agoDate(1)),timeUnit:timeUnit,
    keywordGroups:[{groupName:keyword,keywords:synonyms}],device:'',gender:'',ages:[],
  };
  var data=await naverPost('/v1/datalab/search',body);
  if(data&&data.results&&data.results[0]) return parseDatalab(data.results[0],keyword);

  await sleep(400);
  var body2={
    startDate:fmtDate(agoDate(totalDays+1)),endDate:fmtDate(agoDate(1)),timeUnit:timeUnit,
    keywordGroups:[{groupName:keyword,keywords:[keyword]}],device:'',gender:'',ages:[],
  };
  var data2=await naverPost('/v1/datalab/search',body2);
  if(data2&&data2.results&&data2.results[0]) return parseDatalab(data2.results[0],keyword);

  console.warn('[datalab fallback]',keyword);
  return {surgeRate:0,accel:0,durability:50,_fallback:true};
}

// ── 데이터랩 배치 비교 (5개씩) ───────────────────────────────
async function compareKeywordsByDatalab(keywords, period){
  var totalDays=period==='month'?60:14, timeUnit=period==='month'?'week':'date';
  var scores={};
  keywords.forEach(function(kw){scores[kw]=0;});

  for(var i=0;i<keywords.length;i+=5){
    var batch=keywords.slice(i,i+5);
    var groups=batch.map(function(kw){
      var syns=buildSynonymGroup(kw);
      var kwList=[kw].concat(syns.filter(function(s){return s!==kw;})).slice(0,3);
      return {groupName:kw,keywords:kwList};
    });
    var body={
      startDate:fmtDate(agoDate(totalDays+1)),endDate:fmtDate(agoDate(1)),timeUnit:timeUnit,
      keywordGroups:groups,device:'',gender:'',ages:[],
    };
    var data=await naverPost('/v1/datalab/search',body);
    if(data&&data.results){
      var kwMap={}; groups.forEach(function(g){kwMap[g.groupName]=g.groupName;});
      var batchScores=parseDatalabResult(data.results,kwMap);
      Object.keys(batchScores).forEach(function(kw){scores[kw]=batchScores[kw];});
      console.log('[datalab compare] batch'+(Math.floor(i/5)+1),batch.map(function(kw){return kw+'('+(scores[kw]||0)+'점)';}).join(' | '));
    } else {
      batch.forEach(function(kw){if(!scores[kw])scores[kw]=5;});
    }
    if(i+5<keywords.length) await sleep(300);
  }
  return scores;
}

// ── 쇼핑인사이트 ─────────────────────────────────────────────
async function fetchNaverShoppingInsight(keyword, catId, period){
  var totalDays=period==='month'?60:14, timeUnit=period==='month'?'week':'date';
  var data=await naverPost('/v1/datalab/shopping/category/keywords',{
    startDate:fmtDate(agoDate(totalDays+1)),endDate:fmtDate(agoDate(1)),
    timeUnit:timeUnit,category:catId||'50000007',
    keyword:[{name:keyword,param:[keyword]}],device:'',gender:'',ages:[],
  });
  if(!data||!data.results) return {clickSurge:0,clickAccel:0,clickDurability:50,shopTrend:'stable',currentRatio:0,_fallback:true};
  var pts=((data.results||[])[0]||{}).data||[];
  if(pts.length<4) return {clickSurge:0,clickAccel:0,clickDurability:50,shopTrend:'stable',currentRatio:0,_fallback:true};
  var h=Math.floor(pts.length/2);
  var avg=function(a){return a.reduce(function(s,p){return s+safeRatio(p.ratio);},0)/(a.length||1);};
  var pa=avg(pts.slice(0,h)),ca=avg(pts.slice(h));
  var clickSurge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
  var last3=pts.slice(-3),prev3=pts.slice(Math.max(0,pts.length-6),-3);
  var clickAccel=avg(prev3)>0?Math.round(((avg(last3)-avg(prev3))/avg(prev3))*100):(avg(last3)>0?50:0);
  var all=avg(pts),dur=Math.round((pts.filter(function(p){return safeRatio(p.ratio)>=all;}).length/pts.length)*100);
  var shopTrend=clickSurge>=30?'hot':clickSurge>=10?'rising':clickSurge>=-10?'stable':'falling';
  return {clickSurge,clickAccel,clickDurability:dur,shopTrend,currentRatio:Math.round(ca*10)/10};
}

// ── 쇼핑 검색으로 카테고리 TOP 키워드 추출 ───────────────────
// GET /v1/search/shop.json → 상위 100개 상품명 → 단어 빈도 분석 → TOP 20
async function fetchCategoryTopByShopSearch(catId, period){
  var query=(CFG.CATEGORY_SEARCH_QUERY&&CFG.CATEGORY_SEARCH_QUERY[catId])||'인기';
  var allTitles=[];

  // 100개씩 2회 = 200개 수집 (API 최대 display=100)
  for(var page=0;page<2;page++){
    var res=await naverGet('/v1/search/shop.json',{
      query:   query,
      display: 100,
      start:   page*100+1,
      sort:    'sim',
      exclude: 'used:rental:cbshop',
    });
    if(res&&res.items&&res.items.length){
      res.items.forEach(function(item){
        // category3 (소분류)가 가장 실제 제품명에 가까움
        var parts=[];
        if(item.category3) parts.push(item.category3);
        if(item.category2) parts.push(item.category2);
        parts.push(stripHtml(item.title||''));
        allTitles.push(parts.join(' '));
      });
    } else { break; }
    await sleep(150);
  }

  if(!allTitles.length){
    console.warn('[shopTop] 검색결과 없음:',catId);
    return [];
  }

  // 단어 빈도 분석
  var stopWords=['추천','인기','최저가','무료배송','당일','판매','정품','할인',
    '특가','세일','NEW','신상','베스트','핫딜','A형','B형','S','M','L','XL',
    '1개','2개','세트','묶음','공식','리뷰','후기','최신'];
  var kwCount={};
  allTitles.forEach(function(title){
    var clean=title.replace(/<[^>]+>/g,'')
      .replace(/[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F a-zA-Z0-9]/g,' ')
      .trim();
    var tokens=clean.split(/\s+/).filter(function(t){
      return t.length>=2
        &&!/^[0-9]+$/.test(t)
        &&!/^[A-Z0-9]{1,3}$/.test(t)
        &&!stopWords.some(function(s){return t===s;});
    });
    // 단일 토큰
    tokens.forEach(function(t){ kwCount[t]=(kwCount[t]||0)+1; });
    // 연속 2개 복합어
    for(var i=0;i<tokens.length-1;i++){
      if(/[\uAC00-\uD7A3]/.test(tokens[i+1])){
        var pair=tokens[i]+' '+tokens[i+1];
        if(pair.length<=12) kwCount[pair]=(kwCount[pair]||0)+0.7;
      }
    }
  });

  // 빈도 3 이상, 상위 20개
  var sorted=Object.keys(kwCount)
    .filter(function(k){return kwCount[k]>=3;})
    .sort(function(a,b){return kwCount[b]-kwCount[a];})
    .slice(0,20);

  console.log('[shopTop]',catId,'추출:',sorted.slice(0,10).join(', '));
  return sorted.map(function(kw,idx){return {keyword:kw,rank:idx+1};});
}

// ── 카테고리 TOP 키워드 수집 ─────────────────────────────────
// 1. 쇼핑 검색 200개 → 빈도 분석 → TOP 20 추출 (공식 API, 쿠키 불필요)
// 2. 데이터랩으로 트렌드 점수화
// 3. 쇼핑인사이트로 최종 점수화
async function fetchCategoryTopKeywords(catIds, period){
  var allKeywords=[];

  for(var i=0;i<catIds.length;i++){
    var catId=catIds[i];

    // STEP 1: 쇼핑 검색으로 TOP 20 키워드 추출
    var top20=await fetchCategoryTopByShopSearch(catId,period);

    // 실패 시 CATEGORY_SEEDS 폴백
    if(!top20||!top20.length){
      console.warn('[cat]',catId,'쇼핑검색 실패 — SEEDS 폴백');
      var seeds=(CFG.CATEGORY_SEEDS&&CFG.CATEGORY_SEEDS[catId])||[];
      top20=seeds.slice(0,20).map(function(kw,idx){return {keyword:kw,rank:idx+1};});
    }

    // STEP 2: 데이터랩으로 트렌드 점수 비교
    var kwList=top20.map(function(item){return item.keyword;});
    var datalabScores=await compareKeywordsByDatalab(kwList,period);

    // 데이터랩 점수 순 정렬
    var ranked=kwList.slice().sort(function(a,b){
      return (datalabScores[b]||0)-(datalabScores[a]||0);
    });
    console.log('[cat]',catId,'데이터랩 TOP5:',
      ranked.slice(0,5).map(function(kw){return kw+'('+(datalabScores[kw]||0)+'점)';}).join(' | '));

    // STEP 3: 상위 N개만 쇼핑인사이트 점수화 (할당량 절약)
    var insightCallsPerCat=catIds.length===1?5:2;
    var catItems=[];

    for(var j=0;j<Math.min(ranked.length,insightCallsPerCat);j++){
      var kw=ranked[j];
      var insight=await fetchNaverShoppingInsight(kw,catId,period);
      var insightScore=0;
      if(insight&&!insight._fallback){
        insightScore=Math.max(0,insight.clickSurge||0)+Math.max(0,insight.clickAccel||0);
        if(insight.shopTrend==='hot')         insightScore+=30;
        else if(insight.shopTrend==='rising') insightScore+=15;
        else if(insight.shopTrend==='stable') insightScore+=5;
      }
      catItems.push({
        keyword:kw, catId:catId,
        insightData:insight&&!insight._fallback?insight:null,
        trendScore:(datalabScores[kw]||0)+insightScore,
      });
      await sleep(150);
    }

    // 나머지는 데이터랩 점수만
    ranked.slice(insightCallsPerCat).forEach(function(kw){
      catItems.push({keyword:kw,catId:catId,insightData:null,trendScore:datalabScores[kw]||0});
    });

    catItems.sort(function(a,b){return b.trendScore-a.trendScore;});
    var take=catIds.length===1?Math.min(catItems.length,10):3;
    allKeywords=allKeywords.concat(catItems.slice(0,take));
    console.log('[cat]',catId,'최종:',
      catItems.slice(0,take).map(function(c){return c.keyword+'('+c.trendScore+'점)';}).join(' | '));

    if(i<catIds.length-1) await sleep(300);
  }

  allKeywords.sort(function(a,b){return b.trendScore-a.trendScore;});
  var finalLimit=catIds.length===1?10:15;
  return allKeywords.slice(0,finalLimit);
}

// ── 클러스터 ──────────────────────────────────────────────────
function buildKeywordClusters(keywords){
  var clusters=[],assigned={};
  keywords.forEach(function(kw){
    if(assigned[kw]) return;
    var matched=false;
    for(var i=0;i<clusters.length;i++){
      var cl=clusters[i],root=cl.root;
      if(kw.indexOf(root)>-1||root.indexOf(kw)>-1){cl.keywords.push(kw);assigned[kw]=true;matched=true;break;}
      var minLen=Math.min(kw.length,root.length);
      if(minLen>=2){var c=0;for(var j=0;j<minLen;j++){if(kw[j]===root[j])c++;else break;}if(c>=2){cl.keywords.push(kw);assigned[kw]=true;matched=true;break;}}
    }
    if(!matched){clusters.push({root:kw,label:kw,keywords:[kw]});assigned[kw]=true;}
  });
  return clusters;
}

async function fetchNaverDatalabCluster(cluster, period){
  return fetchNaverDatalabForKeyword(cluster.root, period);
}

// ── 배치 수집 ─────────────────────────────────────────────────
async function fetchNaverBatch(keywords, period, scope, catIdMap){
  var results={};
  keywords.forEach(function(kw){results[kw]={};});

  // STEP A: 검색 — 1개씩 순차
  var searchOk=0;
  for(var i=0;i<keywords.length;i++){
    var kw=keywords[i];
    results[kw].search=await fetchNaverSearchData(kw);
    if(results[kw].search&&!results[kw].search._fallback) searchOk++;
    await sleep(200);
  }
  console.log('[STEP A] 검색 OK:'+searchOk+'/'+keywords.length);

  // STEP B: 데이터랩 — 1개씩 순차
  var dlOk=0;
  for(var di=0;di<keywords.length;di++){
    var dkw=keywords[di];
    results[dkw].datalab=await fetchNaverDatalabForKeyword(dkw,period);
    if(results[dkw].datalab&&!results[dkw].datalab._fallback) dlOk++;
    await sleep(300);
  }
  console.log('[STEP B] 데이터랩 OK:'+dlOk+'/'+keywords.length);

  // STEP C: 쇼핑인사이트 — 1개씩 순차 (scope 무관 항상 수집)
  var insightOk=0;
  for(var k=0;k<keywords.length;k++){
    var ikw=keywords[k];
    if(results[ikw].insight){insightOk++;continue;}
    var cid=(catIdMap&&catIdMap[ikw])||null;
    results[ikw].insight=await fetchNaverShoppingInsight(ikw,cid,period);
    if(results[ikw].insight&&!results[ikw].insight._fallback) insightOk++;
    await sleep(200);
  }
  console.log('[STEP C] 인사이트 OK:'+insightOk+'/'+keywords.length);

  return results;
}

module.exports = {
  fetchNaverSearchData,
  fetchNaverSuggestions,
  fetchNaverDatalab: async function(keywords, period){
    var result={};
    for(var i=0;i<keywords.length;i++){
      result[keywords[i]]=await fetchNaverDatalabForKeyword(keywords[i],period);
      await sleep(200);
    }
    return result;
  },
  fetchNaverShoppingInsight,
  fetchNaverBatch,
  calcSearchIntentFromData,
  fetchCategoryTopKeywords,
  buildKeywordClusters,
  fetchNaverDatalabCluster,
  fetchNaverDatalabForKeyword,
};
