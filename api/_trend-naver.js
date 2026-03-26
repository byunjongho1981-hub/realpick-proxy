var https = require('https');
var CFG   = require('./_trend-config');

function safeNum(v){ return isNaN(Number(v))?0:Number(v); }
function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }
function fmtDate(d){ var p=function(n){return String(n).padStart(2,'0');}; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function agoDate(n){ var d=new Date(); d.setDate(d.getDate()-n); return d; }
function stripHtml(s){ return (s||'').replace(/<[^>]+>/g,''); }

// ── 키워드 변형 생성 [5] ─────────────────────────────────────
function expandKeyword(kw){
  return [kw, kw+' 추천', kw+' 후기', kw+' 비교'];
}
// 데이터랩용 유의어 그룹 [3]
function buildSynonymGroup(kw){
  var synonyms={
    '선크림':['선크림','자외선차단제','썬크림'],
    '썬크림':['썬크림','선크림','자외선차단제'],
    '보조배터리':['보조배터리','충전기','파워뱅크'],
    '무선이어폰':['무선이어폰','블루투스이어폰','에어팟'],
    '마스크팩':['마스크팩','시트마스크','페이스팩'],
    '폼롤러':['폼롤러','마사지롤러','근막이완'],
    '수납박스':['수납박스','정리함','수납함'],
    '레깅스':['레깅스','요가바지','운동바지'],
  };
  return synonyms[kw]||[kw];
}

// ── 공통 GET (항상 resolve) ───────────────────────────────────
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
          try{
            var d=JSON.parse(raw);
            if(d.errorCode){console.error('[naverGet]',path,d.errorCode,d.errorMessage);resolve(null);return;}
            resolve(d);
          }catch(e){resolve(null);}
        });
      });
      req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve(null);}});
      req.setTimeout(4500,function(){req.destroy();});
      req.end();
    }catch(e){resolve(null);}
  });
}

// ── 공통 POST (항상 resolve) ──────────────────────────────────
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
          try{
            var d=JSON.parse(raw);
            if(d.errorCode){console.error('[naverPost]',path,d.errorCode,d.errorMessage);resolve(null);return;}
            resolve(d);
          }catch(e){resolve(null);}
        });
      });
      req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve(null);}});
      req.setTimeout(4500,function(){req.destroy();});
      req.write(buf); req.end();
    }catch(e){resolve(null);}
  });
}

// ── [2] 네이버 검색 — 키워드 변형 + fallback ─────────────────
async function fetchNaverSearchData(keyword){
  // 1차: 기본 키워드
  var result = await _fetchSearch(keyword);
  if(result) return result;

  // 2차: "키워드 추천" 으로 재시도
  await sleep(300);
  console.warn('[search retry]', keyword+'→'+keyword+' 추천');
  result = await _fetchSearch(keyword+' 추천');
  if(result) return result;

  // 3차: fallback [6]
  console.warn('[search fallback]', keyword);
  return {
    blogCount:0, newsCount:0, cafeCount:0, kinCount:0, cafeSignal:'none',
    shopExists:false, shopItemCount:0, buyIntentHits:0, shoppingExists:false,
    allText:'', sampleShopItems:[],
    _fallback: true,
  };
}

async function _fetchSearch(keyword){
  var blogRes = await naverGet('/v1/search/blog.json',{query:keyword,display:10,sort:'sim'});
  await sleep(150);
  var shopRes = await naverGet('/v1/search/shop.json',{
    query:   keyword,
    display: 10,
    sort:    'sim',
    exclude: 'used:rental:cbshop', // ★ 중고/렌탈/해외직구 제외 — 수익화 불가 상품 필터
  });
  await sleep(150);
  var newsRes = await naverGet('/v1/search/news.json',{query:keyword,display:10,sort:'sim'});

  if(!blogRes&&!shopRes&&!newsRes) return null;

  var blogCount  = blogRes?safeNum(blogRes.total):0;
  var newsCount  = newsRes?safeNum(newsRes.total):0;
  var shopExists = !!(shopRes&&shopRes.items&&shopRes.items.length>0);
  var shopItems  = shopRes?(shopRes.items||[]):[];

  // title + description HTML 태그 제거 후 텍스트 분석
  var allTitles=[];
  if(blogRes&&blogRes.items) allTitles=allTitles.concat(blogRes.items.map(function(i){
    return stripHtml(i.title)+' '+stripHtml(i.description||'');
  }));
  if(shopRes&&shopRes.items) allTitles=allTitles.concat(shopRes.items.map(function(i){
    return stripHtml(i.title)+' '+stripHtml(i.description||'');
  }));
  if(newsRes&&newsRes.items) allTitles=allTitles.concat(newsRes.items.map(function(i){
    return stripHtml(i.title)+' '+stripHtml(i.description||'');
  }));
  var allText=allTitles.join(' ');

  // ★ 쇼핑 응답 추가 분석
  var priceList=[], brandSet={}, categorySet={}, category2Set={};
  if(shopRes&&shopRes.items){
    shopRes.items.forEach(function(i){
      var lp=safeNum(i.lprice);
      if(lp>0) priceList.push(lp);
      if(i.brand&&i.brand.trim())    brandSet[i.brand.trim()]=true;   // 빈문자열 제외
      if(i.category1)                categorySet[i.category1]=true;
      if(i.category2)                category2Set[i.category2]=true;  // ★ 중분류 추가
    });
  }
  var avgPrice   = priceList.length
    ? Math.round(priceList.reduce(function(s,v){return s+v;},0)/priceList.length)
    : 0;
  var priceGrade = avgPrice>=200000?'high':avgPrice>=50000?'mid':avgPrice>0?'low':'unknown';
  var brands     = Object.keys(brandSet).slice(0,3);
  var categories = Object.keys(categorySet).slice(0,2);
  var categories2= Object.keys(category2Set).slice(0,3); // ★ 중분류

  // ★ 뉴스 pubDate 기반 최신성 점수 (RFC 2822 → Date 파싱)
  var recentNewsCount=0;
  var sevenDaysAgo=new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate()-7);
  if(newsRes&&newsRes.items){
    newsRes.items.forEach(function(i){
      try{
        var pd=new Date(i.pubDate); // RFC 2822 → Date 자동 파싱
        if(!isNaN(pd.getTime())&&pd>=sevenDaysAgo) recentNewsCount++;
      }catch(e){}
    });
  }
  var recentNewsRatio=newsRes&&newsRes.items&&newsRes.items.length>0
    ?Math.round(recentNewsCount/newsRes.items.length*100):0;
  var recentPostCount=0;
  var thirtyDaysAgo=new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate()-30);
  var recentThreshold=parseInt(thirtyDaysAgo.getFullYear()+
    String(thirtyDaysAgo.getMonth()+1).padStart(2,'0')+
    String(thirtyDaysAgo.getDate()).padStart(2,'0'));
  if(blogRes&&blogRes.items){
    blogRes.items.forEach(function(i){
      var pd=parseInt((i.postdate||'').replace(/[^0-9]/g,''));
      if(pd&&pd>=recentThreshold) recentPostCount++;
    });
  }
  var recentRatio=blogRes&&blogRes.items&&blogRes.items.length>0
    ?Math.round(recentPostCount/blogRes.items.length*100):0;

  // 최소 1개라도 수집되면 성공으로 간주
  if(blogCount===0&&newsCount===0&&!shopExists) return null;

  return {
    blogCount, newsCount, cafeCount:0, kinCount:0, cafeSignal:'none',
    shopExists, shopItemCount:shopItems.length,
    buyIntentHits, shoppingExists:shopExists, allText,
    recentPostRatio:  recentRatio,
    recentNewsRatio:  recentNewsRatio,
    avgPrice:         avgPrice,
    priceGrade:       priceGrade,
    brands:           brands,
    categories:       categories,
    categories2:      categories2,   // ★ 중분류 추가
    sampleShopItems:shopItems.slice(0,3).map(function(i){
      var lp=safeNum(i.lprice), hp=safeNum(i.hprice);
      return {
        title:     stripHtml(i.title),
        price:     lp,
        hprice:    hp>0?hp:null,        // ★ 0이면 null (가격비교 데이터 없음)
        mallName:  i.mallName||'네이버', // ★ 없으면 기본값 '네이버'
        brand:     i.brand&&i.brand.trim()||'',
        maker:     i.maker||'',          // ★ 제조사 추가
        category1: i.category1||'',
        category2: i.category2||'',      // ★ 중분류 추가
        category3: i.category3||'',      // ★ 소분류 추가
        link:      i.link||'',
      };
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
        method:'GET',
        headers:{'User-Agent':'Mozilla/5.0','Referer':'https://search.naver.com/'}
      },function(res){
        var raw='';
        res.on('data',function(c){raw+=c;});
        res.on('end',function(){
          if(done)return; done=true; clearTimeout(t);
          try{
            var d=JSON.parse(raw);
            var items=(d.items&&d.items[0])?d.items[0].slice(0,8).map(function(r){return r[0];}):[];
            resolve(items);
          }catch(e){resolve([]);}
        });
      });
      req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve([]);}});
      req.setTimeout(2500,function(){req.destroy();});
      req.end();
    }catch(e){resolve([]);}
  });
}

// ── [3] 데이터랩 — 유의어 그룹 + fallback ────────────────────
async function fetchNaverDatalabForKeyword(keyword, period){
  var synonyms = buildSynonymGroup(keyword);
  var totalDays = period==='month'?60:14;
  var timeUnit  = period==='month'?'week':'date';
  var body = {
    startDate: fmtDate(agoDate(totalDays+1)),
    endDate:   fmtDate(agoDate(1)),
    timeUnit:  timeUnit,
    keywordGroups:[{ groupName:keyword, keywords:synonyms }],
    device: '',
    gender: '',
    ages:   [],
  };
  var data = await naverPost('/v1/datalab/search', body);
  if(data&&data.results&&data.results[0]) return parseDatalab(data.results[0], keyword);

  // 재시도: 단일 키워드
  await sleep(400);
  var body2 = {
    startDate: fmtDate(agoDate(totalDays+1)),
    endDate:   fmtDate(agoDate(1)),
    timeUnit:  timeUnit,
    keywordGroups:[{ groupName:keyword, keywords:[keyword] }],
    device: '',
    gender: '',
    ages:   [],
  };
  var data2 = await naverPost('/v1/datalab/search', body2);
  if(data2&&data2.results&&data2.results[0]) return parseDatalab(data2.results[0], keyword);

  // fallback [6]
  console.warn('[datalab fallback]', keyword);
  return {surgeRate:0, accel:0, durability:50, _fallback:true};
}

function parseDatalab(result, keyword){
  var pts=(result.data||[]).map(function(d){
    return {period:d.period, ratio:safeRatio(d.ratio)}; // ★ string→float
  });
  if(pts.length<4) return {surgeRate:0,accel:0,durability:50,_fallback:true};
  var h=Math.floor(pts.length/2);
  var avg=function(a){return a.reduce(function(s,p){return s+p.ratio;},0)/(a.length||1);};
  var pa=avg(pts.slice(0,h)), ca=avg(pts.slice(h));
  var surge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
  var mid=pts.slice(h),eh=mid.slice(0,Math.floor(mid.length/2)),rh=mid.slice(Math.floor(mid.length/2));
  var accel=avg(eh)>0?Math.round(((avg(rh)-avg(eh))/avg(eh))*100):0;
  var all=avg(pts);
  var dur=Math.round((pts.filter(function(p){return p.ratio>=all;}).length/pts.length)*100);
  console.log('[datalab ok]',keyword,'surge:'+surge+'% accel:'+accel+'% dur:'+dur+'%');
  return {surgeRate:surge, accel:accel, durability:dur};
}

// ── 쇼핑인사이트 ─────────────────────────────────────────────
async function fetchNaverShoppingInsight(keyword, catId, period){
  var totalDays=period==='month'?60:14, timeUnit=period==='month'?'week':'date';
  var data = await naverPost('/v1/datalab/shopping/category/keywords',{
    startDate:fmtDate(agoDate(totalDays+1)), endDate:fmtDate(agoDate(1)),
    timeUnit:timeUnit, category:catId||'50000007',
    keyword:[{name:keyword,param:[keyword]}], device:'',gender:'',ages:[],
  });
  if(!data||!data.results) return {clickSurge:0,clickAccel:0,clickDurability:50,shopTrend:'stable',currentRatio:0,_fallback:true};

  var pts=((data.results||[])[0]||{}).data||[];
  if(pts.length<4) return {clickSurge:0,clickAccel:0,clickDurability:50,shopTrend:'stable',currentRatio:0,_fallback:true};

  var h=Math.floor(pts.length/2);
  var avg=function(a){return a.reduce(function(s,p){return s+safeNum(p.ratio);},0)/(a.length||1);};
  var pa=avg(pts.slice(0,h)),ca=avg(pts.slice(h));
  var clickSurge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
  var last3=pts.slice(-3),prev3=pts.slice(Math.max(0,pts.length-6),-3);
  var clickAccel=avg(prev3)>0?Math.round(((avg(last3)-avg(prev3))/avg(prev3))*100):(avg(last3)>0?50:0);
  var all=avg(pts), dur=Math.round((pts.filter(function(p){return safeNum(p.ratio)>=all;}).length/pts.length)*100);
  var shopTrend=clickSurge>=30?'hot':clickSurge>=10?'rising':clickSurge>=-10?'stable':'falling';
  return {clickSurge,clickAccel,clickDurability:dur,shopTrend,currentRatio:Math.round(ca*10)/10};
}

// ── 전체검색 의도 분석 ────────────────────────────────────────
function calcSearchIntentFromData(keyword, naverData, suggestions){
  var sugs    = Array.isArray(suggestions)?suggestions:[];
  var kw      = typeof keyword==='string'?keyword.toLowerCase():'';
  var sugText = sugs.join(' ').toLowerCase();
  var score   = 30, type='explore', buyCnt=0, probCnt=0, infoCnt=0, detected=[];

  CFG.SEARCH_INTENT.BUY.forEach(function(p){
    if(kw.indexOf(p)>-1){buyCnt++;score+=8;type='buy';if(detected.length<3)detected.push(p);}
  });
  CFG.SEARCH_INTENT.PROBLEM.forEach(function(p){
    if(kw.indexOf(p)>-1){probCnt++;score+=6;type='problem';if(detected.length<3)detected.push(p);}
  });
  CFG.SEARCH_INTENT.INFO.forEach(function(p){
    if(kw.indexOf(p)>-1){infoCnt++;score+=3;if(type==='explore')type='info';}
  });
  if(/^[가-힣]{2,6}$/.test(keyword)){score+=12;if(type==='explore')type='buy';}

  if(sugs.length>=6) score+=10;
  else if(sugs.length>=3) score+=5;
  sugs.forEach(function(sug){
    var s2=sug.toLowerCase();
    CFG.SEARCH_INTENT.BUY.forEach(function(p){
      if(s2.indexOf(p)>-1){score+=2;if(detected.length<3)detected.push(p+'(자동완성)');}
    });
  });
  if(detected.length===0&&sugs.length>0){
    for(var si=0;si<Math.min(sugs.length,3);si++){
      if(sugs[si]!==keyword) detected.push(sugs[si]);
    }
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

  if(naverData.shoppingExists&&tBuy>=2)  type='buy';
  else if(tProb>tBuy&&tProb>=2)         type='problem';
  else if(tInfo>tBuy&&tInfo>tProb)      type='info';
  else if(naverData.buyIntentHits>=3)   type='buy';

  if(type==='buy')          score+=40;
  else if(type==='problem') score+=25;
  else if(type==='info')    score+=10;

  if(naverData.shoppingExists)                            score+=15;
  score+=Math.min(20,(naverData.buyIntentHits||0)*3);
  if((naverData.blogCount||0)>10000)                      score+=5;
  if((naverData.newsCount||0)>(naverData.blogCount||0)*2) score-=15;
  if(!naverData.shoppingExists)                           score-=10;

  if(sugs.length>=6) score+=10;
  else if(sugs.length>=3) score+=5;

  var tot=Math.max(tBuy+tProb+tInfo,1);
  var buyRatio=type==='buy'?Math.max(50,Math.round(tBuy/tot*100)):Math.round(tBuy/tot*100);
  return {type:type,score:Math.min(100,Math.max(0,Math.round(score))),buyRatio:buyRatio,patterns:detected.slice(0,3),suggestions:sugs};
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
      if(minLen>=2){var c=0;for(var j=0;j<minLen;j++){if(kw[j]===root[j])c++;else break;} if(c>=2){cl.keywords.push(kw);assigned[kw]=true;matched=true;break;}}
    }
    if(!matched){clusters.push({root:kw,label:kw,keywords:[kw]});assigned[kw]=true;}
  });
  return clusters;
}

async function fetchNaverDatalabCluster(cluster, period){
  return fetchNaverDatalabForKeyword(cluster.root, period);
}

// ── 쇼핑 검색 결과에서 핵심 키워드 추출 ─────────────────────
function extractKeywordsFromTitles(titles){
  var stopWords=['추천','인기','최저가','무료배송','당일','판매','공식','정품',
    '할인','특가','세일','NEW','신상','베스트','핫딜','리미티드',
    'A형','B형','S','M','L','XL','XXL','1개','2개','세트','묶음'];

  var kwCount={};

  titles.forEach(function(title){
    // HTML 태그, 특수문자 제거
    var clean=title.replace(/<[^>]+>/g,'').replace(/[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F a-zA-Z0-9]/g,' ').trim();

    // 공백 기준 분리
    var tokens=clean.split(/\s+/).filter(function(t){
      return t.length>=2
        && !/^[0-9]+$/.test(t)                          // 숫자만 제거
        && !/^[A-Z0-9]{1,3}$/.test(t)                   // 단순 영문 약자 제거
        && !stopWords.some(function(s){ return t===s; }); // 불용어 제거
    });

    // 연속 2개 토큰 조합 (복합어 추출)
    for(var i=0;i<tokens.length;i++){
      var t1=tokens[i];
      kwCount[t1]=(kwCount[t1]||0)+1;
      if(i<tokens.length-1){
        var t2=tokens[i]+' '+tokens[i+1];
        // 복합어: 둘 다 한글이고 전체 길이 10자 이내
        if(/[\uAC00-\uD7A3]/.test(tokens[i+1]) && t2.length<=10){
          kwCount[t2]=(kwCount[t2]||0)+0.5;
        }
      }
    }
  });

  // 빈도 2 이상만, 점수 순 정렬
  return Object.keys(kwCount)
    .filter(function(k){ return kwCount[k]>=2; })
    .sort(function(a,b){ return kwCount[b]-kwCount[a]; })
    .slice(0,25); // 최대 25개
}

// ratio는 string 타입 — parseFloat 명시 처리
function safeRatio(v){
  if(v===null||v===undefined||v==='') return 0;
  var n=parseFloat(String(v).replace(/[^0-9.-]/g,''));
  return isNaN(n)?0:n;
}

// 데이터랩 결과 파싱 — API 스펙 기준
// results[].title     = groupName (주제어)
// results[].keywords  = 검색어 배열
// results[].data[]    = [{period:"yyyy-mm-dd", ratio:"0"~"100"}]
function parseDatalabResult(results, keywordMap){
  // keywordMap: {groupName: originalKeyword} — title로 원본 키워드 역추적
  var scores={};
  (results||[]).forEach(function(r){
    var groupName=r.title;
    var kw=keywordMap?keywordMap[groupName]:groupName;
    if(!kw) return;

    var pts=(r.data||[]).map(function(d){
      return {period:d.period, ratio:safeRatio(d.ratio)}; // ★ string→float
    });
    if(pts.length<4){ scores[kw]=5; return; }

    var h=Math.floor(pts.length/2);
    var avg=function(a){
      return a.reduce(function(s,p){return s+p.ratio;},0)/(a.length||1);
    };
    var pa=avg(pts.slice(0,h)), ca=avg(pts.slice(h));
    var surge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?50:0);
    var mid=pts.slice(h);
    var eh=mid.slice(0,Math.floor(mid.length/2));
    var rh=mid.slice(Math.floor(mid.length/2));
    var accel=avg(eh)>0?Math.round(((avg(rh)-avg(eh))/avg(eh))*100):0;
    var recent=Math.round(avg(pts.slice(-3))*10);

    scores[kw]=Math.max(0,surge)+Math.max(0,accel)+recent;
    console.log('[datalab parse]',kw,'surge:'+surge+'% accel:'+accel+'% recent:'+Math.round(avg(pts.slice(-3))));
  });
  return scores;
}
// API 스펙: keywordGroups 최대 5개, keywords 최대 20개(동의어)
// → 5개씩 배치 호출, 그룹당 동의어 최대 3개 포함
async function compareKeywordsByDatalab(keywords, period){
  var totalDays = period==='month'?60:14;
  var timeUnit  = period==='month'?'week':'date';
  var scores    = {};
  keywords.forEach(function(kw){ scores[kw]=0; });

  // 키워드별 동의어 맵 (그룹당 keywords 배열에 함께 전달)
  var synonymMap={
    // ── 패션의류 ──────────────────────────────────────────
    '트위드자켓':   ['트위드자켓','트위드코트','트위드블레이저'],
    '원피스':       ['원피스','드레스','미니원피스','맥시원피스'],
    '트렌치코트':   ['트렌치코트','트렌치','봄코트','롱코트'],
    '바람막이':     ['바람막이','윈드브레이커','방풍자켓'],
    '스웨이드자켓': ['스웨이드자켓','스웨이드코트','무스탕'],
    '여성자켓':     ['여성자켓','여성재킷','봄자켓'],
    '가죽자켓':     ['가죽자켓','레더자켓','바이커자켓'],
    '여성가디건':   ['여성가디건','니트가디건','롱가디건'],
    '여성봄자켓':   ['여성봄자켓','봄아우터','스프링자켓'],
    '블라우스':     ['블라우스','셔츠블라우스','여성셔츠'],
    '후드집업':     ['후드집업','집업후드','후드자켓'],
    '경량패딩':     ['경량패딩','경량점퍼','초경량패딩'],
    '레더자켓':     ['레더자켓','가죽자켓','PU자켓'],
    '청바지':       ['청바지','데님팬츠','진바지','스키니진'],
    '니트':         ['니트','니트스웨터','울니트','뜨개옷'],
    '맨투맨':       ['맨투맨','스웨트셔츠','크루넥'],
    '와이드팬츠':   ['와이드팬츠','통바지','와이드슬랙스'],
    '슬랙스':       ['슬랙스','정장바지','드레스팬츠'],
    '레깅스':       ['레깅스','요가바지','요가레깅스','타이츠'],

    // ── 패션잡화 ──────────────────────────────────────────
    '크로스백':     ['크로스백','크로스바디백','숄더크로스백'],
    '미니백':       ['미니백','미니숄더백','미니크로스백'],
    '캔버스백':     ['캔버스백','에코백','천가방'],
    '버킷햇':       ['버킷햇','벙거지','버킷모자'],
    '비니':         ['비니','니트비니','털비니','겨울비니'],
    '선글라스':     ['선글라스','썬글라스','UV차단선글라스'],
    '슬리퍼':       ['슬리퍼','실내슬리퍼','쪼리','플립플랍'],
    '스니커즈':     ['스니커즈','운동화','캐주얼신발'],
    '숄더백':       ['숄더백','숄더핸드백','토트숄더백'],
    '토트백':       ['토트백','대용량토트백','쇼핑백'],
    '볼캡':         ['볼캡','야구모자','캡모자'],
    '에코백':       ['에코백','장바구니','캔버스백'],

    // ── 화장품/미용 ───────────────────────────────────────
    '선크림':       ['선크림','썬크림','자외선차단제','선스크린'],
    '썬크림':       ['썬크림','선크림','자외선차단제'],
    '토너패드':     ['토너패드','스킨패드','코튼패드'],
    '비타민C세럼':  ['비타민C세럼','비타민세럼','브라이트닝세럼'],
    '수분크림':     ['수분크림','보습크림','모이스처라이저'],
    '쿠션팩트':     ['쿠션팩트','쿠션파운데이션','에어쿠션'],
    '클렌징오일':   ['클렌징오일','메이크업클렌저','더블클렌징'],
    '마스크팩':     ['마스크팩','시트마스크','페이스마스크','수면팩'],
    '레티놀크림':   ['레티놀크림','레티놀세럼','안티에이징크림'],
    '선스틱':       ['선스틱','자외선차단스틱','선케어스틱'],

    // ── 디지털/가전 ───────────────────────────────────────
    '무선이어폰':   ['무선이어폰','블루투스이어폰','TWS이어폰','에어팟'],
    '보조배터리':   ['보조배터리','파워뱅크','충전배터리','휴대용충전기'],
    '스마트워치':   ['스마트워치','애플워치','갤럭시워치','스마트밴드'],
    '블루투스스피커':['블루투스스피커','무선스피커','포터블스피커'],
    'USB허브':      ['USB허브','USB멀티포트','C타입허브'],
    '기계식키보드': ['기계식키보드','게이밍키보드','무선키보드'],
    '웹캠':         ['웹캠','화상카메라','PC카메라'],
    '노트북거치대': ['노트북거치대','노트북스탠드','모니터받침'],
    'C타입케이블':  ['C타입케이블','USB-C케이블','PD충전케이블'],
    '마우스패드':   ['마우스패드','게이밍마우스패드','장패드'],

    // ── 가구/인테리어 ─────────────────────────────────────
    '수납박스':     ['수납박스','수납함','정리함','수납바구니'],
    '옷걸이행거':   ['옷걸이행거','행거','이동식행거'],
    '간접조명':     ['간접조명','LED조명','무드등','스탠드조명'],
    '러그':         ['러그','카펫','거실매트'],
    '화분':         ['화분',  '인테리어화분','다육화분','식물화분'],
    '캔들':         ['캔들','향초','소이캔들','아로마캔들'],
    '쿠션':         ['쿠션','소파쿠션','인테리어쿠션'],

    // ── 식품/건강 ─────────────────────────────────────────
    '단백질쉐이크': ['단백질쉐이크','프로틴쉐이크','단백질보충제','WPI프로틴'],
    '그릭요거트':   ['그릭요거트','플레인요거트','단백질요거트'],
    '홍삼':         ['홍삼','홍삼정','홍삼농축액','홍삼액'],
    '유산균':       ['유산균','프로바이오틱스','장유산균'],
    '콜라겐':       ['콜라겐','저분자콜라겐','어콜라겐','콜라겐펩타이드'],
    '비타민D':      ['비타민D','비타민D3','비타민D+K2'],
    '오메가3':      ['오메가3','EPA DHA','피쉬오일','오메가3캡슐'],
    '흑마늘즙':     ['흑마늘즙','흑마늘','발효흑마늘'],
    '닭가슴살':     ['닭가슴살','닭가슴살스테이크','훈제닭가슴살'],

    // ── 스포츠/레저 ───────────────────────────────────────
    '요가매트':     ['요가매트','운동매트','필라테스매트'],
    '폼롤러':       ['폼롤러','마사지롤러','근막롤러','마사지볼'],
    '러닝화':       ['러닝화','조깅화','운동화','마라톤화'],
    '헬스장갑':     ['헬스장갑','운동장갑','웨이트장갑'],
    '덤벨':         ['덤벨','아령','가변덤벨'],
    '등산화':       ['등산화','트레킹화','하이킹화'],
    '아이스팩':     ['아이스팩','냉찜질팩','아이스젤'],

    // ── 생활/건강 ─────────────────────────────────────────
    '가습기':       ['가습기','초음파가습기','기화식가습기','무선가습기'],
    '무선청소기':   ['무선청소기','핸디청소기','스틱청소기','코드리스청소기'],
    '전기장판':     ['전기장판','전기매트','온열매트'],
    '손선풍기':     ['손선풍기','미니선풍기','휴대용선풍기'],
    '텀블러':       ['텀블러','보온텀블러','스탠리텀블러','보냉텀블러'],
    '족욕기':       ['족욕기','발마사지기','족욕버블기'],
    '마사지쿠션':   ['마사지쿠션','안마쿠션','등마사지기'],

    // ── 반려동물 ──────────────────────────────────────────
    '강아지간식':   ['강아지간식','강아지트릿','반려견간식'],
    '고양이사료':   ['고양이사료','고양이캔','습식사료','건식사료'],
    '펫이동가방':   ['펫이동가방','강아지캐리어','고양이캐리어'],
    '강아지옷':     ['강아지옷','반려견의류','강아지패딩'],
    '고양이장난감': ['고양이장난감','낚시대장난감','캣닢장난감'],
    '자동급수기':   ['자동급수기','펫정수기','강아지정수기'],

    // ── 자동차용품 ────────────────────────────────────────
    '차량방향제':   ['차량방향제','차량용방향제','자동차방향제'],
    '블랙박스':     ['블랙박스','차량용블랙박스','전후방블랙박스'],
    '하이패스':     ['하이패스','하이패스단말기','하이패스OBD'],
    '차량용충전기': ['차량용충전기','시거잭충전기','차량USB충전기'],
    '세차샴푸':     ['세차샴푸','세차용품','차량세정제'],
    '트렁크정리함': ['트렁크정리함','차량수납함','트렁크박스'],
  };
  };

  // 5개씩 배치 처리
  for(var i=0;i<keywords.length;i+=5){
    var batch=keywords.slice(i,i+5);
    var groups=batch.map(function(kw){
      var syns=synonymMap[kw]||[kw];
      // 키워드 자신 포함 + 동의어 최대 3개 (API 스펙: 최대 20개)
      var kwList=[kw].concat(syns.filter(function(s){return s!==kw;})).slice(0,3);
      return { groupName:kw, keywords:kwList };
    });

    var body={
      startDate:     fmtDate(agoDate(totalDays+1)),
      endDate:       fmtDate(agoDate(1)),
      timeUnit:      timeUnit,
      keywordGroups: groups,
      device:        '',   // 전체 환경 (pc + mo)
      gender:        '',   // 전체 성별
      ages:          [],   // 전체 연령
    };

    var data=await naverPost('/v1/datalab/search', body);
    if(data&&data.results){
      // groupName → 원본 키워드 맵
      var kwMap={};
      groups.forEach(function(g){ kwMap[g.groupName]=g.groupName; });
      var batchScores=parseDatalabResult(data.results, kwMap);
      Object.keys(batchScores).forEach(function(kw){ scores[kw]=batchScores[kw]; });
      console.log('[datalab compare] batch'+(Math.floor(i/5)+1)+'/'+Math.ceil(keywords.length/5),
        batch.map(function(kw){ return kw+'('+(scores[kw]||0)+'점)'; }).join(' | '));
    } else {
      console.warn('[datalab compare] batch'+(Math.floor(i/5)+1)+' 응답 없음');
      batch.forEach(function(kw){ if(!scores[kw]) scores[kw]=5; });
    }
    if(i+5<keywords.length) await sleep(300);
  }
  return scores;
}

// ── 카테고리 TOP 키워드 수집 ─────────────────────────────────
// 1. CATEGORY_SEEDS 20개를 데이터랩으로 트렌드 비교 (4회 호출)
// 2. 상위 5개만 쇼핑인사이트 호출 (할당량 절약)
// 3. 최종 점수 = 데이터랩점수 + 인사이트점수
async function fetchCategoryTopKeywords(catIds, period){
  var allKeywords=[];

  for(var i=0;i<catIds.length;i++){
    var catId=catIds[i];
    var seeds=(CFG.CATEGORY_SEEDS&&CFG.CATEGORY_SEEDS[catId])||[];
    if(!seeds.length) continue;

    console.log('[cat]',catId,'SEEDS',seeds.length+'개 데이터랩 비교 시작');

    // STEP 1: 데이터랩으로 SEEDS 전체 트렌드 비교 (5개씩 배치)
    var datalabScores=await compareKeywordsByDatalab(seeds, period);

    // 데이터랩 점수 순 정렬 → 상위 5개 선정
    var ranked=seeds.slice().sort(function(a,b){
      return (datalabScores[b]||0)-(datalabScores[a]||0);
    });
    var top5=ranked.slice(0,5);
    console.log('[cat]',catId,'데이터랩 TOP5:',top5.map(function(kw){return kw+'('+(datalabScores[kw]||0)+'점)';}).join(' | '));

    // STEP 2: TOP 5만 쇼핑인사이트 트렌드 점수화
    var catItems=[];
    for(var j=0;j<top5.length;j++){
      var kw=top5[j];
      var insight=await fetchNaverShoppingInsight(kw,catId,period);
      var insightScore=0;
      if(insight&&!insight._fallback){
        insightScore=Math.max(0,insight.clickSurge||0)+Math.max(0,insight.clickAccel||0);
        if(insight.shopTrend==='hot')         insightScore+=30;
        else if(insight.shopTrend==='rising') insightScore+=15;
        else if(insight.shopTrend==='stable') insightScore+=5;
      }
      var totalScore=(datalabScores[kw]||0)+insightScore;
      catItems.push({
        keyword:    kw,
        catId:      catId,
        insightData:insight&&!insight._fallback?insight:null,
        trendScore: totalScore,
      });
      await sleep(150);
    }

    // 나머지 seeds는 데이터랩 점수만으로 추가 (인사이트 미호출)
    ranked.slice(5).forEach(function(kw){
      catItems.push({keyword:kw,catId:catId,insightData:null,trendScore:datalabScores[kw]||0});
    });

    catItems.sort(function(a,b){return b.trendScore-a.trendScore;});
    var take=catIds.length===1?Math.min(catItems.length,10):3;
    allKeywords=allKeywords.concat(catItems.slice(0,take));

    console.log('[cat]',catId,'최종 TOP'+take+':',
      catItems.slice(0,take).map(function(c){return c.keyword+'('+c.trendScore+'점)';}).join(' | '));

    if(i<catIds.length-1) await sleep(300);
  }

  allKeywords.sort(function(a,b){return b.trendScore-a.trendScore;});
  var finalLimit=catIds.length===1?10:15;
  console.log('[fetchCategoryTopKeywords] 최종:'+Math.min(allKeywords.length,finalLimit)+'개');
  return allKeywords.slice(0,finalLimit);
}

// ── 배치 수집 ─────────────────────────────────────────────────
async function fetchNaverBatch(keywords, period, scope, catIdMap){
  var s=scope||'all', results={};
  keywords.forEach(function(kw){ results[kw]={}; });

  // STEP A: 검색 — 1개씩 순차
  if(s!=='shop'){
    var searchOk=0;
    for(var i=0;i<keywords.length;i++){
      var kw=keywords[i];
      results[kw].search = await fetchNaverSearchData(kw); // 내부에서 재시도+fallback 처리
      if(results[kw].search && !results[kw].search._fallback) searchOk++;
      await sleep(200);
    }
    console.log('[STEP A] 검색 OK:'+searchOk+'/'+keywords.length);
  }

  // STEP B: 데이터랩 — 1개씩 순차 (유의어 그룹 내장)
  if(s!=='shop'){
    var dlOk=0;
    for(var di=0;di<keywords.length;di++){
      var dkw=keywords[di];
      results[dkw].datalab = await fetchNaverDatalabForKeyword(dkw, period);
      if(results[dkw].datalab && !results[dkw].datalab._fallback) dlOk++;
      await sleep(300);
    }
    console.log('[STEP B] 데이터랩 OK:'+dlOk+'/'+keywords.length);
  }

  // STEP C: 쇼핑인사이트 — 1개씩 순차
  if(s!=='search'){
    var insightOk=0;
    for(var k=0;k<keywords.length;k++){
      var ikw=keywords[k];
      if(results[ikw].insight){ insightOk++; continue; }
      var cid=(catIdMap&&catIdMap[ikw])||null;
      results[ikw].insight = await fetchNaverShoppingInsight(ikw, cid, period);
      if(results[ikw].insight && !results[ikw].insight._fallback) insightOk++;
      await sleep(200);
    }
    console.log('[STEP C] 인사이트 OK:'+insightOk+'/'+keywords.length);
  }

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
