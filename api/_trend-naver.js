var https = require('https');
var CFG   = require('./_trend-config');

function safeNum(v){ return isNaN(Number(v))?0:Number(v); }
function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }
function fmtDate(d){ var p=function(n){return String(n).padStart(2,'0');}; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function agoDate(n){ var d=new Date(); d.setDate(d.getDate()-n); return d; }

// ── 공통 요청 함수 ────────────────────────────────────────────
// reject 없음 — 항상 resolve(null|data) → try-catch 불필요
function naverGet(path, params){
  return new Promise(function(resolve){
    try{
      var qs=Object.keys(params).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);}).join('&');
      var t=setTimeout(function(){resolve(null);},5000);
      var req=https.request({
        hostname:'openapi.naver.com',path:path+'?'+qs,method:'GET',
        headers:{'X-Naver-Client-Id':process.env.NAVER_CLIENT_ID,'X-Naver-Client-Secret':process.env.NAVER_CLIENT_SECRET}
      },function(res){
        var raw='';
        res.on('data',function(c){raw+=c;});
        res.on('end',function(){
          clearTimeout(t);
          try{
            var d=JSON.parse(raw);
            if(d.errorCode){ console.error('[naverGet]',path,d.errorCode,d.errorMessage); resolve(null); return; }
            resolve(d);
          }catch(e){ resolve(null); }
        });
      });
      req.on('error',function(){ clearTimeout(t); resolve(null); });
      req.end();
    }catch(e){ resolve(null); }
  });
}

function naverPost(path, body){
  return new Promise(function(resolve){
    try{
      var buf=Buffer.from(JSON.stringify(body),'utf8');
      var t=setTimeout(function(){resolve(null);},5000);
      var req=https.request({
        hostname:'openapi.naver.com',path:path,method:'POST',
        headers:{'X-Naver-Client-Id':process.env.NAVER_CLIENT_ID,'X-Naver-Client-Secret':process.env.NAVER_CLIENT_SECRET,'Content-Type':'application/json','Content-Length':buf.length}
      },function(res){
        var raw='';
        res.on('data',function(c){raw+=c;});
        res.on('end',function(){
          clearTimeout(t);
          try{
            var d=JSON.parse(raw);
            if(d.errorCode){ console.error('[naverPost]',path,d.errorCode,d.errorMessage); resolve(null); return; }
            resolve(d);
          }catch(e){ resolve(null); }
        });
      });
      req.on('error',function(){ clearTimeout(t); resolve(null); });
      req.write(buf); req.end();
    }catch(e){ resolve(null); }
  });
}

// ── 네이버 검색 (blog + shop + news 병렬) ─────────────────────
// cafearticle/kin 제거: 권한 불확실 + 순차시 timeout 원인
async function fetchNaverSearchData(keyword){
  var res=await Promise.all([
    naverGet('/v1/search/blog.json',{query:keyword,display:20,sort:'date'}),
    naverGet('/v1/search/shop.json',{query:keyword,display:10,sort:'sim'}),
    naverGet('/v1/search/news.json',{query:keyword,display:10,sort:'date'}),
  ]);
  var blogRes=res[0], shopRes=res[1], newsRes=res[2];

  // 3개 모두 null이면 수집 실패
  if(!blogRes&&!shopRes&&!newsRes) return null;

  var blogCount  = blogRes?safeNum(blogRes.total):0;
  var newsCount  = newsRes?safeNum(newsRes.total):0;
  var shopExists = !!(shopRes&&shopRes.items&&shopRes.items.length>0);
  var shopItems  = shopRes?(shopRes.items||[]):[];

  var allTitles=[];
  if(blogRes&&blogRes.items) allTitles=allTitles.concat(blogRes.items.map(function(i){return i.title+' '+(i.description||'');}));
  if(shopRes&&shopRes.items) allTitles=allTitles.concat(shopRes.items.map(function(i){return i.title||'';}));
  var allText=allTitles.join(' ').replace(/<[^>]+>/g,'');

  var buyIntentHits=0;
  CFG.BUY_INTENT_SIGNALS.forEach(function(sig){if(allText.indexOf(sig)>-1)buyIntentHits++;});

  return {
    blogCount, newsCount, cafeCount:0, kinCount:0,
    cafeSignal:'none',
    shopExists, shopItemCount:shopItems.length,
    buyIntentHits, shoppingExists:shopExists,
    allText,
    sampleShopItems:shopItems.slice(0,3).map(function(i){
      return {title:i.title.replace(/<[^>]+>/g,''),price:safeNum(i.lprice),link:i.link||''};
    }),
  };
}

// ── 네이버 자동완성 ───────────────────────────────────────────
function fetchNaverSuggestions(keyword){
  return new Promise(function(resolve){
    try{
      var enc=encodeURIComponent(keyword);
      var t=setTimeout(function(){resolve([]);},3000);
      var req=https.request({
        hostname:'ac.search.naver.com',
        path:'/nx/ac?q='+enc+'&q_enc=UTF-8&st=100&r_format=json&r_enc=UTF-8',
        method:'GET',
        headers:{'User-Agent':'Mozilla/5.0','Referer':'https://search.naver.com/'}
      },function(res){
        var raw='';
        res.on('data',function(c){raw+=c;});
        res.on('end',function(){
          clearTimeout(t);
          try{
            var d=JSON.parse(raw);
            var items=(d.items&&d.items[0])?d.items[0].slice(0,8).map(function(r){return r[0];}):[];
            resolve(items);
          }catch(e){resolve([]);}
        });
      });
      req.on('error',function(){clearTimeout(t);resolve([]);});
      req.setTimeout(2500,function(){req.destroy();resolve([]);});
      req.end();
    }catch(e){resolve([]);}
  });
}

// ── 전체검색 의도 분석 ────────────────────────────────────────
// sugs는 최상단 단일 선언 — ReferenceError 원천 차단
function calcSearchIntentFromData(keyword, naverData, suggestions){
  var sugs = Array.isArray(suggestions)?suggestions:[];
  var kw   = typeof keyword==='string'?keyword.toLowerCase():'';

  var score=30, type='explore', buyCnt=0, probCnt=0, infoCnt=0;

  // naverData 없어도 키워드+자동완성으로 추론 (수집 실패 시도 의미있는 점수 반환)
  if(!naverData){
    CFG.SEARCH_INTENT.BUY.forEach(function(p){     if(kw.indexOf(p)>-1){buyCnt++;score+=8;type='buy';} });
    CFG.SEARCH_INTENT.PROBLEM.forEach(function(p){ if(kw.indexOf(p)>-1){probCnt++;score+=6;type='problem';} });
    CFG.SEARCH_INTENT.INFO.forEach(function(p){    if(kw.indexOf(p)>-1){infoCnt++;score+=3;if(type==='explore')type='info';} });
    if(/^[가-힣]{2,6}$/.test(keyword)){score+=12;if(type==='explore')type='buy';} // 순수 한글 제품명
    if(sugs.length>=6)      score+=10;
    else if(sugs.length>=3) score+=5;
    var sugText=sugs.join(' ').toLowerCase();
    CFG.SEARCH_INTENT.BUY.forEach(function(p){if(sugText.indexOf(p)>-1)score+=2;});
    var buyRatio=buyCnt>0?Math.round(buyCnt/(Math.max(buyCnt+probCnt+infoCnt,1))*100):0;
    return {type:type,score:Math.min(100,Math.max(0,Math.round(score))),buyRatio:buyRatio,patterns:[],suggestions:sugs};
  }

  // naverData 있는 경우 — 전체 분석
  var text=(naverData.allText||'').toLowerCase()+' '+kw;
  CFG.SEARCH_INTENT.BUY.forEach(function(p){     if(text.indexOf(p)>-1)buyCnt++; });
  CFG.SEARCH_INTENT.PROBLEM.forEach(function(p){ if(text.indexOf(p)>-1)probCnt++; });
  CFG.SEARCH_INTENT.INFO.forEach(function(p){    if(text.indexOf(p)>-1)infoCnt++; });

  var total=Math.max(buyCnt+probCnt+infoCnt,1);
  var buyRatio=Math.round(buyCnt/total*100);

  if(naverData.shoppingExists&&buyCnt>=2)     type='buy';
  else if(probCnt>buyCnt&&probCnt>=2)         type='problem';
  else if(infoCnt>buyCnt&&infoCnt>probCnt)    type='info';
  else if(naverData.buyIntentHits>=3)         type='buy';
  else if(/^[가-힣]{2,6}$/.test(keyword))     type='buy';

  if(type==='buy')          score+=40;
  else if(type==='problem') score+=25;
  else if(type==='info')    score+=10;

  if(naverData.shoppingExists)                  score+=15;
  score+=Math.min(20,naverData.buyIntentHits*3);
  if(naverData.blogCount>10000)                 score+=5;
  if(naverData.newsCount>naverData.blogCount*2) score-=15;
  if(!naverData.shoppingExists)                 score-=10;
  if((naverData.kinCount||0)>500)               score+=8;
  else if((naverData.kinCount||0)>100)          score+=4;

  // 자동완성 가점
  if(sugs.length>=6)       score+=10;
  else if(sugs.length>=3)  score+=5;
  var sugText=sugs.join(' ').toLowerCase();
  CFG.SEARCH_INTENT.BUY.forEach(function(p){if(sugText.indexOf(p)>-1)score+=2;});

  var detected=[];
  CFG.SEARCH_INTENT.BUY.forEach(function(p){if(text.indexOf(p)>-1&&detected.length<3)detected.push(p);});
  if(detected.length<3) CFG.SEARCH_INTENT.PROBLEM.forEach(function(p){if(text.indexOf(p)>-1&&detected.length<3)detected.push(p);});

  return {
    type:type,
    score:Math.min(100,Math.max(0,Math.round(score))),
    buyRatio:buyRatio,
    patterns:detected,
    suggestions:sugs,
  };
}

// ── 클러스터 기반 데이터랩 ────────────────────────────────────
function buildKeywordClusters(keywords){
  var clusters=[],assigned={};
  keywords.forEach(function(kw){
    if(assigned[kw]) return;
    var matched=false;
    for(var i=0;i<clusters.length;i++){
      var cl=clusters[i],root=cl.root;
      if(kw.indexOf(root)>-1||root.indexOf(kw)>-1){cl.keywords.push(kw);assigned[kw]=true;matched=true;break;}
      var minLen=Math.min(kw.length,root.length);
      if(minLen>=2){
        var common=0;
        for(var j=0;j<minLen;j++){if(kw[j]===root[j])common++;else break;}
        if(common>=2){cl.keywords.push(kw);assigned[kw]=true;matched=true;break;}
      }
    }
    if(!matched){clusters.push({root:kw,label:kw,keywords:[kw]});assigned[kw]=true;}
  });
  return clusters;
}

async function fetchNaverDatalabCluster(cluster, period){
  var keywords=cluster.keywords.slice(0,5);
  if(!keywords.length) return null;
  var totalDays=period==='month'?60:14, timeUnit=period==='month'?'week':'date';
  var body={
    startDate:fmtDate(agoDate(totalDays+1)),
    endDate:fmtDate(agoDate(1)),
    timeUnit:timeUnit,
    keywordGroups:keywords.map(function(kw){return {groupName:kw,keywords:[kw]};}),
  };
  var data=await naverPost('/v1/datalab/search',body);
  if(!data||!data.results) return null;
  var result={};
  data.results.forEach(function(r,idx){
    var pts=r.data||[];
    if(pts.length<4){result[keywords[idx]]=null;return;}
    var h=Math.floor(pts.length/2);
    var avg=function(a){return a.reduce(function(s,p){return s+safeNum(p.ratio);},0)/(a.length||1);};
    var pa=avg(pts.slice(0,h)),ca=avg(pts.slice(h));
    var surge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
    var mid=pts.slice(h), eh=mid.slice(0,Math.floor(mid.length/2)), rh=mid.slice(Math.floor(mid.length/2));
    var accel=avg(eh)>0?Math.round(((avg(rh)-avg(eh))/avg(eh))*100):0;
    var all=avg(pts);
    var dur=Math.round((pts.filter(function(p){return safeNum(p.ratio)>=all;}).length/pts.length)*100);
    result[keywords[idx]]={surgeRate:surge,accel:accel,durability:dur,rawData:pts,clusterRoot:cluster.root,clusterSize:cluster.keywords.length};
  });
  return result;
}

async function fetchNaverDatalab(keywords, period){
  var clusters=buildKeywordClusters(keywords), result={};
  for(var i=0;i<clusters.length;i++){
    var cl=clusters[i];
    var clResult=await fetchNaverDatalabCluster(cl,period);
    if(clResult) Object.keys(clResult).forEach(function(k){result[k]=clResult[k];});
    // 클러스터 실패 시 개별 재시도
    if(!clResult){
      for(var j=0;j<cl.keywords.length;j++){
        var s=await fetchNaverDatalabCluster({root:cl.keywords[j],label:cl.keywords[j],keywords:[cl.keywords[j]]},period);
        if(s) Object.keys(s).forEach(function(k){result[k]=s[k];});
        if(j<cl.keywords.length-1) await sleep(300);
      }
    }
    if(i<clusters.length-1) await sleep(400);
  }
  return result;
}

// ── 쇼핑인사이트 ─────────────────────────────────────────────
async function fetchNaverShoppingInsight(keyword, catId, period){
  var totalDays=period==='month'?60:14, timeUnit=period==='month'?'week':'date';
  var body={
    startDate:fmtDate(agoDate(totalDays+1)),
    endDate:fmtDate(agoDate(1)),
    timeUnit:timeUnit,
    category:catId||'50000007',
    keyword:[{name:keyword,param:[keyword]}],
    device:'',gender:'',ages:[],
  };
  var data=await naverPost('/v1/datalab/shopping/category/keywords',body);
  if(!data||!data.results) return null;
  var pts=((data.results||[])[0]||{}).data||[];
  if(pts.length<4) return null;
  var h=Math.floor(pts.length/2);
  var avg=function(a){return a.reduce(function(s,p){return s+safeNum(p.ratio);},0)/(a.length||1);};
  var pa=avg(pts.slice(0,h)),ca=avg(pts.slice(h));
  var clickSurge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
  var last3=pts.slice(-3),prev3=pts.slice(Math.max(0,pts.length-6),-3);
  var clickAccel=avg(prev3)>0?Math.round(((avg(last3)-avg(prev3))/avg(prev3))*100):(avg(last3)>0?50:0);
  var all=avg(pts);
  var dur=Math.round((pts.filter(function(p){return safeNum(p.ratio)>=all;}).length/pts.length)*100);
  var shopTrend=clickSurge>=30?'hot':clickSurge>=10?'rising':clickSurge>=-10?'stable':'falling';
  return {clickSurge,clickAccel,clickDurability:dur,shopTrend,currentRatio:Math.round(ca*10)/10};
}

// ── 카테고리 TOP 키워드 수집 ──────────────────────────────────
async function fetchCategoryTopKeywords(catIds, period){
  var result=[];
  for(var i=0;i<catIds.length;i++){
    var catId=catIds[i];
    var seeds=(CFG.CATEGORY_SEEDS&&CFG.CATEGORY_SEEDS[catId])||[];
    if(!seeds.length) continue;
    var catItems=[];
    for(var j=0;j<Math.min(seeds.length,6);j++){
      var insight=await fetchNaverShoppingInsight(seeds[j],catId,period);
      var trendScore=0;
      if(insight){
        trendScore=Math.max(0,insight.clickSurge||0)+Math.max(0,insight.clickAccel||0);
        if(insight.shopTrend==='hot')    trendScore+=30;
        else if(insight.shopTrend==='rising') trendScore+=15;
      }
      catItems.push({keyword:seeds[j],catId:catId,insightData:insight,trendScore:trendScore});
      await sleep(300);
    }
    catItems.sort(function(a,b){return b.trendScore-a.trendScore;});
    result=result.concat(catItems.slice(0,3));
  }
  return result;
}

// ── 배치 수집 ────────────────────────────────────────────────
// scope: 'all'|'shop'|'search' / catIdMap: {keyword:catId}
async function fetchNaverBatch(keywords, period, scope, catIdMap){
  var s=scope||'all', results={};

  // 검색 (scope !== 'shop') — 병렬 처리
  if(s!=='shop'){
    var searchResults=await Promise.all(
      keywords.map(function(kw){ return fetchNaverSearchData(kw); })
    );
    keywords.forEach(function(kw,i){
      results[kw]={search:searchResults[i]||null};
    });
    await sleep(300);
  }

  // 데이터랩 (scope !== 'shop')
  if(s!=='shop'){
    var dlData=await fetchNaverDatalab(keywords,period);
    keywords.forEach(function(kw){
      if(!results[kw]) results[kw]={};
      results[kw].datalab=dlData[kw]||null;
    });
    await sleep(400);
  }

  // 쇼핑인사이트 (scope !== 'search') — 순차 (API 특성상)
  if(s!=='search'){
    for(var k=0;k<keywords.length;k++){
      var kw=keywords[k];
      if(!results[kw]) results[kw]={};
      if(!results[kw].insight){
        var cid=(catIdMap&&catIdMap[kw])||null;
        results[kw].insight=await fetchNaverShoppingInsight(kw,cid,period);
        await sleep(300);
      }
    }
  }

  return results;
}

module.exports = {
  fetchNaverSearchData,
  fetchNaverSuggestions,
  fetchNaverDatalab,
  fetchNaverShoppingInsight,
  fetchNaverBatch,
  calcSearchIntentFromData,
  fetchCategoryTopKeywords,
  buildKeywordClusters,
  fetchNaverDatalabCluster,
};
