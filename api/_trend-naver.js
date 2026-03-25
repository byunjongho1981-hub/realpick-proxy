var https = require('https');
var CFG   = require('./_trend-config');

function safeNum(v){ return isNaN(Number(v))?0:Number(v); }
function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }
function fmtDate(d){ var p=function(n){return String(n).padStart(2,'0');}; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function agoDate(n){ var d=new Date(); d.setDate(d.getDate()-n); return d; }

// ── 공통 GET (항상 resolve — reject 없음) ─────────────────────
function naverGet(path, params){
  return new Promise(function(resolve){
    try{
      var qs=Object.keys(params).map(function(k){
        return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);
      }).join('&');
      var done=false;
      var t=setTimeout(function(){ if(!done){done=true; console.warn('[naverGet timeout]',path); resolve(null);} },6000);
      var req=https.request({
        hostname:'openapi.naver.com', path:path+'?'+qs, method:'GET',
        headers:{'X-Naver-Client-Id':process.env.NAVER_CLIENT_ID,'X-Naver-Client-Secret':process.env.NAVER_CLIENT_SECRET}
      },function(res){
        var raw='';
        res.on('data',function(c){raw+=c;});
        res.on('end',function(){
          if(done) return; done=true; clearTimeout(t);
          try{
            var d=JSON.parse(raw);
            if(d.errorCode){ console.error('[naverGet err]',path,d.errorCode,d.errorMessage); resolve(null); return; }
            resolve(d);
          }catch(e){ console.error('[naverGet parse]',path,e.message); resolve(null); }
        });
      });
      req.on('error',function(e){ if(!done){done=true; clearTimeout(t); console.error('[naverGet req]',path,e.message); resolve(null);} });
      req.setTimeout(5500,function(){ req.destroy(); });
      req.end();
    }catch(e){ resolve(null); }
  });
}

// ── 공통 POST (항상 resolve — reject 없음) ────────────────────
function naverPost(path, body){
  return new Promise(function(resolve){
    try{
      var buf=Buffer.from(JSON.stringify(body),'utf8');
      var done=false;
      var t=setTimeout(function(){ if(!done){done=true; console.warn('[naverPost timeout]',path); resolve(null);} },6000);
      var req=https.request({
        hostname:'openapi.naver.com', path:path, method:'POST',
        headers:{'X-Naver-Client-Id':process.env.NAVER_CLIENT_ID,'X-Naver-Client-Secret':process.env.NAVER_CLIENT_SECRET,'Content-Type':'application/json','Content-Length':buf.length}
      },function(res){
        var raw='';
        res.on('data',function(c){raw+=c;});
        res.on('end',function(){
          if(done) return; done=true; clearTimeout(t);
          try{
            var d=JSON.parse(raw);
            if(d.errorCode){ console.error('[naverPost err]',path,d.errorCode,d.errorMessage); resolve(null); return; }
            resolve(d);
          }catch(e){ console.error('[naverPost parse]',path,e.message); resolve(null); }
        });
      });
      req.on('error',function(e){ if(!done){done=true; clearTimeout(t); console.error('[naverPost req]',path,e.message); resolve(null);} });
      req.setTimeout(5500,function(){ req.destroy(); });
      req.write(buf); req.end();
    }catch(e){ resolve(null); }
  });
}

// ── 네이버 검색 (blog+shop+news 병렬) ────────────────────────
async function fetchNaverSearchData(keyword){
  var res=await Promise.all([
    naverGet('/v1/search/blog.json',{query:keyword,display:20,sort:'date'}),
    naverGet('/v1/search/shop.json',{query:keyword,display:10,sort:'sim'}),
    naverGet('/v1/search/news.json',{query:keyword,display:10,sort:'date'}),
  ]);
  var blogRes=res[0], shopRes=res[1], newsRes=res[2];
  if(!blogRes&&!shopRes&&!newsRes){ console.warn('[search all-null]',keyword); return null; }

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

  console.log('[search ok]',keyword,'blog:'+blogCount,'shop:'+shopExists,'buyHits:'+buyIntentHits);
  return {
    blogCount, newsCount, cafeCount:0, kinCount:0, cafeSignal:'none',
    shopExists, shopItemCount:shopItems.length,
    buyIntentHits, shoppingExists:shopExists, allText,
    sampleShopItems:shopItems.slice(0,3).map(function(i){
      return {title:i.title.replace(/<[^>]+>/g,''),price:safeNum(i.lprice),link:i.link||''};
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
          if(done) return; done=true; clearTimeout(t);
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

// ── 전체검색 의도 분석 ────────────────────────────────────────
function calcSearchIntentFromData(keyword, naverData, suggestions){
  // 변수 최상단 단일 선언 — 어떤 경우도 충돌 없음
  var sugs     = Array.isArray(suggestions)?suggestions:[];
  var kw       = typeof keyword==='string'?keyword.toLowerCase():'';
  var sugText  = sugs.join(' ').toLowerCase();
  var score    = 30;
  var type     = 'explore';
  var buyCnt   = 0, probCnt = 0, infoCnt = 0;
  var detected = [];

  // 키워드 자체 패턴
  CFG.SEARCH_INTENT.BUY.forEach(function(p){
    if(kw.indexOf(p)>-1){buyCnt++;score+=8;type='buy';if(detected.length<3)detected.push(p);}
  });
  CFG.SEARCH_INTENT.PROBLEM.forEach(function(p){
    if(kw.indexOf(p)>-1){probCnt++;score+=6;type='problem';if(detected.length<3)detected.push(p);}
  });
  CFG.SEARCH_INTENT.INFO.forEach(function(p){
    if(kw.indexOf(p)>-1){infoCnt++;score+=3;if(type==='explore')type='info';}
  });
  // 순수 한글 2~6글자 제품명 → 구매형
  if(/^[가-힣]{2,6}$/.test(keyword)){score+=12;if(type==='explore')type='buy';}

  // 자동완성 가점
  if(sugs.length>=6) score+=10;
  else if(sugs.length>=3) score+=5;
  CFG.SEARCH_INTENT.BUY.forEach(function(p){
    if(sugText.indexOf(p)>-1){score+=2;if(detected.length<3)detected.push(p+'(자동완성)');}
  });

  // naverData 없으면 여기서 반환
  if(!naverData){
    var br0=type==='buy'?Math.max(50,Math.round(buyCnt/Math.max(buyCnt+probCnt+infoCnt,1)*100)):0;
    return {type:type,score:Math.min(100,Math.max(0,Math.round(score))),buyRatio:br0,patterns:detected,suggestions:sugs};
  }

  // naverData 있는 경우 — 텍스트 전체 분석
  var text=(naverData.allText||'').toLowerCase()+' '+kw;
  var tBuy=0,tProb=0,tInfo=0;
  CFG.SEARCH_INTENT.BUY.forEach(function(p){if(text.indexOf(p)>-1){tBuy++;if(detected.length<3)detected.push(p);}});
  CFG.SEARCH_INTENT.PROBLEM.forEach(function(p){if(text.indexOf(p)>-1){tProb++;if(detected.length<3)detected.push(p);}});
  CFG.SEARCH_INTENT.INFO.forEach(function(p){if(text.indexOf(p)>-1)tInfo++;});

  if(naverData.shoppingExists&&tBuy>=2)       type='buy';
  else if(tProb>tBuy&&tProb>=2)               type='problem';
  else if(tInfo>tBuy&&tInfo>tProb)            type='info';
  else if(naverData.buyIntentHits>=3)         type='buy';

  if(type==='buy')          score+=40;
  else if(type==='problem') score+=25;
  else if(type==='info')    score+=10;

  if(naverData.shoppingExists)                              score+=15;
  score+=Math.min(20,(naverData.buyIntentHits||0)*3);
  if((naverData.blogCount||0)>10000)                        score+=5;
  if((naverData.newsCount||0)>(naverData.blogCount||0)*2)   score-=15;
  if(!naverData.shoppingExists)                             score-=10;

  var tot=Math.max(tBuy+tProb+tInfo,1);
  var buyRatio=type==='buy'?Math.max(50,Math.round(tBuy/tot*100)):Math.round(tBuy/tot*100);
  return {type:type,score:Math.min(100,Math.max(0,Math.round(score))),buyRatio:buyRatio,patterns:detected.slice(0,3),suggestions:sugs};
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
      if(minLen>=2){var c=0;for(var j=0;j<minLen;j++){if(kw[j]===root[j])c++;else break;} if(c>=2){cl.keywords.push(kw);assigned[kw]=true;matched=true;break;}}
    }
    if(!matched){clusters.push({root:kw,label:kw,keywords:[kw]});assigned[kw]=true;}
  });
  return clusters;
}

async function fetchNaverDatalabCluster(cluster, period){
  var keywords=cluster.keywords.slice(0,5); if(!keywords.length) return null;
  var totalDays=period==='month'?60:14, timeUnit=period==='month'?'week':'date';
  var data=await naverPost('/v1/datalab/search',{
    startDate:fmtDate(agoDate(totalDays+1)), endDate:fmtDate(agoDate(1)), timeUnit:timeUnit,
    keywordGroups:keywords.map(function(kw){return {groupName:kw,keywords:[kw]};}),
  });
  if(!data||!data.results) return null;
  var result={};
  data.results.forEach(function(r,idx){
    var pts=r.data||[]; if(pts.length<4){result[keywords[idx]]=null;return;}
    var h=Math.floor(pts.length/2);
    var avg=function(a){return a.reduce(function(s,p){return s+safeNum(p.ratio);},0)/(a.length||1);};
    var pa=avg(pts.slice(0,h)),ca=avg(pts.slice(h));
    var surge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
    var mid=pts.slice(h),eh=mid.slice(0,Math.floor(mid.length/2)),rh=mid.slice(Math.floor(mid.length/2));
    var accel=avg(eh)>0?Math.round(((avg(rh)-avg(eh))/avg(eh))*100):0;
    var all=avg(pts),dur=Math.round((pts.filter(function(p){return safeNum(p.ratio)>=all;}).length/pts.length)*100);
    result[keywords[idx]]={surgeRate:surge,accel:accel,durability:dur,rawData:pts,clusterRoot:cluster.root,clusterSize:cluster.keywords.length};
  });
  console.log('[datalab ok]',cluster.root,'keys:'+Object.keys(result).length);
  return result;
}

async function fetchNaverDatalab(keywords, period){
  var clusters=buildKeywordClusters(keywords),result={};
  for(var i=0;i<clusters.length;i++){
    var cl=clusters[i];
    var clResult=await fetchNaverDatalabCluster(cl,period);
    if(clResult) Object.keys(clResult).forEach(function(k){result[k]=clResult[k];});
    if(!clResult){
      for(var j=0;j<cl.keywords.length;j++){
        var s=await fetchNaverDatalabCluster({root:cl.keywords[j],label:cl.keywords[j],keywords:[cl.keywords[j]]},period);
        if(s) Object.keys(s).forEach(function(k){result[k]=s[k];});
        if(j<cl.keywords.length-1) await sleep(200);
      }
    }
    if(i<clusters.length-1) await sleep(300);
  }
  return result;
}

// ── 쇼핑인사이트 ─────────────────────────────────────────────
async function fetchNaverShoppingInsight(keyword, catId, period){
  var totalDays=period==='month'?60:14, timeUnit=period==='month'?'week':'date';
  var data=await naverPost('/v1/datalab/shopping/category/keywords',{
    startDate:fmtDate(agoDate(totalDays+1)), endDate:fmtDate(agoDate(1)),
    timeUnit:timeUnit, category:catId||'50000007',
    keyword:[{name:keyword,param:[keyword]}], device:'',gender:'',ages:[],
  });
  if(!data||!data.results) return null;
  var pts=((data.results||[])[0]||{}).data||[]; if(pts.length<4) return null;
  var h=Math.floor(pts.length/2);
  var avg=function(a){return a.reduce(function(s,p){return s+safeNum(p.ratio);},0)/(a.length||1);};
  var pa=avg(pts.slice(0,h)),ca=avg(pts.slice(h));
  var clickSurge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
  var last3=pts.slice(-3),prev3=pts.slice(Math.max(0,pts.length-6),-3);
  var clickAccel=avg(prev3)>0?Math.round(((avg(last3)-avg(prev3))/avg(prev3))*100):(avg(last3)>0?50:0);
  var all=avg(pts),dur=Math.round((pts.filter(function(p){return safeNum(p.ratio)>=all;}).length/pts.length)*100);
  var shopTrend=clickSurge>=30?'hot':clickSurge>=10?'rising':clickSurge>=-10?'stable':'falling';
  return {clickSurge,clickAccel,clickDurability:dur,shopTrend,currentRatio:Math.round(ca*10)/10};
}

// ── 카테고리 TOP 키워드 수집 ──────────────────────────────────
// ★ 핵심 최적화: 3시드/카테고리, 150ms sleep → 12카테고리×3×(~500ms+150ms) = ~23초
async function fetchCategoryTopKeywords(catIds, period){
  var result=[];
  for(var i=0;i<catIds.length;i++){
    var catId=catIds[i];
    var seeds=(CFG.CATEGORY_SEEDS&&CFG.CATEGORY_SEEDS[catId])||[];
    if(!seeds.length) continue;
    var catItems=[];
    // ★ 3개씩 병렬 처리 (기존 순차 → 3배 빠름)
    for(var j=0;j<Math.min(seeds.length,6);j+=3){
      var batch=seeds.slice(j,j+3);
      var batchResults=await Promise.all(batch.map(function(seed){
        return fetchNaverShoppingInsight(seed,catId,period);
      }));
      batch.forEach(function(seed,k){
        var insight=batchResults[k];
        var trendScore=0;
        if(insight){
          trendScore=Math.max(0,insight.clickSurge||0)+Math.max(0,insight.clickAccel||0);
          if(insight.shopTrend==='hot')     trendScore+=30;
          else if(insight.shopTrend==='rising') trendScore+=15;
        }
        catItems.push({keyword:seed,catId:catId,insightData:insight,trendScore:trendScore});
      });
      if(j+3<Math.min(seeds.length,6)) await sleep(150);
    }
    catItems.sort(function(a,b){return b.trendScore-a.trendScore;});
    // ★ 카테고리당 상위 2개로 축소 (12카테고리 × 2 = 24개 → 15개로 추가 컷)
    result=result.concat(catItems.slice(0,2));
  }
  // 전체 상위 15개만 유지
  result.sort(function(a,b){return b.trendScore-a.trendScore;});
  return result.slice(0,15);
}

// ── 배치 수집 (scope + catIdMap) ─────────────────────────────
async function fetchNaverBatch(keywords, period, scope, catIdMap){
  var s=scope||'all', results={};

  // 검색 (scope !== 'shop') — ★ 5개씩 병렬 배치
  if(s!=='shop'){
    var BATCH=5;
    for(var bi=0;bi<keywords.length;bi+=BATCH){
      var batch=keywords.slice(bi,bi+BATCH);
      var batchRes=await Promise.all(batch.map(function(kw){return fetchNaverSearchData(kw);}));
      batch.forEach(function(kw,j){ results[kw]={search:batchRes[j]||null}; });
      if(bi+BATCH<keywords.length) await sleep(200);
    }
    await sleep(200);
  }

  // 데이터랩 (scope !== 'shop')
  if(s!=='shop'){
    var dlData=await fetchNaverDatalab(keywords,period);
    keywords.forEach(function(kw){
      if(!results[kw]) results[kw]={};
      results[kw].datalab=dlData[kw]||null;
    });
    await sleep(200);
  }

  // 쇼핑인사이트 (scope !== 'search') — ★ 200ms sleep (기존 300ms)
  if(s!=='search'){
    for(var k=0;k<keywords.length;k++){
      var kw=keywords[k];
      if(!results[kw]) results[kw]={};
      if(!results[kw].insight){
        var cid=(catIdMap&&catIdMap[kw])||null;
        results[kw].insight=await fetchNaverShoppingInsight(kw,cid,period);
        await sleep(200);
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
