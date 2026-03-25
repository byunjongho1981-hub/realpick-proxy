var https = require('https');
var CFG   = require('./_trend-config');

function safeNum(v){ return isNaN(Number(v)) ? 0 : Number(v); }
function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }
function fmtDate(d){ var p=function(n){return String(n).padStart(2,'0');}; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function agoDate(n){ var d=new Date(); d.setDate(d.getDate()-n); return d; }

function naverGet(path, params){
  return new Promise(function(resolve, reject){
    var qs=Object.keys(params).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);}).join('&');
    var t=setTimeout(function(){reject(new Error('timeout'));},CFG.TIMEOUT);
    var req=https.request({
      hostname:'openapi.naver.com', path:path+'?'+qs, method:'GET',
      headers:{'X-Naver-Client-Id':process.env.NAVER_CLIENT_ID,'X-Naver-Client-Secret':process.env.NAVER_CLIENT_SECRET}
    },function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{
          var d=JSON.parse(raw);
          if(d.errorCode){
            console.error('[naverGet-err]',path,d.errorCode,d.errorMessage);
            resolve(null); return;
          }
          resolve(d);
        }catch(e){ console.error('[naverGet-parse]',path,e.message); resolve(null); }
      });
    });
    req.on('error',function(e){clearTimeout(t);reject(e);});
    req.end();
  });
}

function naverPost(path, body){
  return new Promise(function(resolve, reject){
    var buf=Buffer.from(JSON.stringify(body),'utf8');
    var t=setTimeout(function(){reject(new Error('timeout'));},CFG.TIMEOUT);
    var req=https.request({
      hostname:'openapi.naver.com', path:path, method:'POST',
      headers:{'X-Naver-Client-Id':process.env.NAVER_CLIENT_ID,'X-Naver-Client-Secret':process.env.NAVER_CLIENT_SECRET,'Content-Type':'application/json','Content-Length':buf.length}
    },function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{ var d=JSON.parse(raw); if(d.errorCode){resolve(null);return;} resolve(d); }catch(e){resolve(null);}
      });
    });
    req.on('error',function(e){clearTimeout(t);reject(e);});
    req.write(buf); req.end();
  });
}

// ── 네이버 검색 (블로그+쇼핑+뉴스+카페) ─────────────────────
async function fetchNaverSearchData(keyword){
  try{
    // ★ 각 API 독립 try-catch — 일부 권한 없어도 수집 가능한 데이터 반환
    var blogRes=null,shopRes=null,newsRes=null,cafeRes=null,kinRes=null;
    try{ blogRes=await naverGet('/v1/search/blog.json',        {query:keyword,display:20,sort:'date'}); }catch(e){ console.warn('[blog]',keyword,e.message); }
    await sleep(150);
    try{ shopRes=await naverGet('/v1/search/shop.json',        {query:keyword,display:10,sort:'sim'});  }catch(e){ console.warn('[shop]',keyword,e.message); }
    await sleep(150);
    try{ newsRes=await naverGet('/v1/search/news.json',        {query:keyword,display:10,sort:'date'}); }catch(e){ console.warn('[news]',keyword,e.message); }
    await sleep(150);
    try{ cafeRes=await naverGet('/v1/search/cafearticle.json', {query:keyword,display:10,sort:'date'}); }catch(e){ console.warn('[cafe]',keyword,e.message); }
    await sleep(150);
    try{ kinRes =await naverGet('/v1/search/kin.json',         {query:keyword,display:10,sort:'date'}); }catch(e){ console.warn('[kin]', keyword,e.message); }
    await sleep(150);
    var blogCount  = blogRes ? safeNum(blogRes.total)  : 0;
    var newsCount  = newsRes ? safeNum(newsRes.total)  : 0;
    var cafeCount  = cafeRes ? safeNum(cafeRes.total)  : 0;
    var kinCount   = kinRes  ? safeNum(kinRes.total)   : 0; // ★ 지식인
    var shopExists = !!(shopRes&&shopRes.items&&shopRes.items.length>0);
    var shopItems  = shopRes ? (shopRes.items||[]) : [];
    var allTitles=[];
    if(blogRes&&blogRes.items) allTitles=allTitles.concat(blogRes.items.map(function(i){return i.title+' '+(i.description||'');}));
    if(shopRes&&shopRes.items) allTitles=allTitles.concat(shopRes.items.map(function(i){return i.title||'';}));
    if(cafeRes&&cafeRes.items) allTitles=allTitles.concat(cafeRes.items.map(function(i){return i.title+' '+(i.description||'');}));
    // ★ 설계서 [2][3]: 지식인 항목도 allText에 포함 — 문제형 패턴("불편/문제/안됨") 감지용
    if(kinRes&&kinRes.items)  allTitles=allTitles.concat(kinRes.items.map(function(i){return i.title+' '+(i.description||'');}));
    var allText=allTitles.join(' ').replace(/<[^>]+>/g,'');
    var buyIntentHits=0;
    CFG.BUY_INTENT_SIGNALS.forEach(function(sig){if(allText.indexOf(sig)>-1)buyIntentHits++;});
    return {
      blogCount,newsCount,cafeCount,kinCount,
      cafeSignal:cafeCount>=50?'active':cafeCount>=10?'low':'none',
      shopExists,shopItemCount:shopItems.length,
      buyIntentHits,shoppingExists:shopExists,
      allText,  // ★ 검색의도 분석에 재사용
      sampleShopItems:shopItems.slice(0,3).map(function(i){
        return {title:i.title.replace(/<[^>]+>/g,''),price:safeNum(i.lprice),link:i.link||''};
      }),
    };
  }catch(e){
    console.error('[naver-search]',keyword,e.message);
    return null;
  }
}

// ── ★ 설계서 [2]: 네이버 자동완성 수집 (폴백 강화) ──────────
function fetchNaverSuggestions(keyword){
  return new Promise(function(resolve){
    var t=setTimeout(function(){resolve([]);},4000);
    try{
      var enc=encodeURIComponent(keyword);
      var req=https.request({
        hostname:'ac.search.naver.com',
        path:'/nx/ac?q='+enc+'&con_q=&frm=nv&ans=2&aq=4&q_enc=UTF-8&st=100&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run_ptyp=true&nlu_query=&type=extend&target=ac',
        method:'GET',
        headers:{
          'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer':'https://search.naver.com/',
          'Accept':'application/json',
        }
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
      req.setTimeout(3500,function(){req.destroy();resolve([]);});
      req.end();
    }catch(e){clearTimeout(t);resolve([]);}
  });
}
// naverData(fetchNaverSearchData 결과)를 재활용 — 추가 API 호출 없음
function calcSearchIntentFromData(keyword, naverData){
  if(!naverData){
    return {type:'explore',score:30,buyRatio:0,patterns:[],suggestions:[]};
  }
  var text=(naverData.allText||'').toLowerCase()+' '+keyword.toLowerCase();

  // 패턴 카운트
  var buyCnt=0, probCnt=0, infoCnt=0;
  CFG.SEARCH_INTENT.BUY.forEach(function(p){ if(text.indexOf(p)>-1) buyCnt++; });
  CFG.SEARCH_INTENT.PROBLEM.forEach(function(p){ if(text.indexOf(p)>-1) probCnt++; });
  CFG.SEARCH_INTENT.INFO.forEach(function(p){ if(text.indexOf(p)>-1) infoCnt++; });

  var total=Math.max(buyCnt+probCnt+infoCnt,1);
  var buyRatio=Math.round(buyCnt/total*100);

  // 의도 분류
  var type;
  if(naverData.shoppingExists&&buyCnt>=2)     type='buy';
  else if(probCnt>buyCnt&&probCnt>=2)         type='problem';
  else if(infoCnt>buyCnt&&infoCnt>probCnt)    type='info';
  else if(naverData.buyIntentHits>=3)         type='buy';
  else                                        type='explore';

  // 점수 계산
  var score=30;
  if(type==='buy')     score+=40;
  else if(type==='problem') score+=25;
  else if(type==='info')    score+=10;

  if(naverData.shoppingExists)                score+=15;
  score+=Math.min(20, naverData.buyIntentHits*3);
  if(naverData.cafeCount>500)                 score+=8;
  if(naverData.blogCount>10000)               score+=5;
  // ★ 설계서 [4]: 자동완성 다양성 가점 (최상단 sugs 재사용)
  if(sugs.length>=6)      score+=10;
  else if(sugs.length>=3) score+=5;
  var sugText=sugs.join(' ').toLowerCase();
  CFG.SEARCH_INTENT.BUY.forEach(function(p){if(sugText.indexOf(p)>-1) score+=2;});

  // 뉴스 비중 높으면 감점
  if(naverData.newsCount>naverData.blogCount*2) score-=15;
  // 쇼핑 없으면 감점
  if(!naverData.shoppingExists)               score-=10;
  // ★ 설계서 [2][4]: 지식인 활성 → 구매/문제 탐색 신호 → 가점
  if((naverData.kinCount||0)>500)             score+=8;
  else if((naverData.kinCount||0)>100)        score+=4;

  // 감지된 패턴 목록 (상위 3개)
  var detectedPatterns=[];
  CFG.SEARCH_INTENT.BUY.forEach(function(p){ if(text.indexOf(p)>-1&&detectedPatterns.length<3) detectedPatterns.push(p); });
  if(detectedPatterns.length<3) CFG.SEARCH_INTENT.PROBLEM.forEach(function(p){ if(text.indexOf(p)>-1&&detectedPatterns.length<3) detectedPatterns.push(p); });

  return {
    type:type,
    score:Math.min(100,Math.max(0,Math.round(score))),
    buyRatio:buyRatio,
    patterns:detectedPatterns,
    suggestions:sugs,  // ★ 자동완성 포함
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
  try{
    var data=await naverPost('/v1/datalab/search',body);
    if(!data||!data.results) return null;
    await sleep(300);
    var result={};
    data.results.forEach(function(r,idx){
      var pts=r.data||[];
      if(pts.length<4){result[keywords[idx]]=null;return;}
      var h=Math.floor(pts.length/2);
      var avg=function(a){return a.reduce(function(s,p){return s+safeNum(p.ratio);},0)/(a.length||1);};
      var pa=avg(pts.slice(0,h)),ca=avg(pts.slice(h));
      var surge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
      var eh=pts.slice(h,h+Math.floor(pts.slice(h).length/2)),rh=pts.slice(h+Math.floor(pts.slice(h).length/2));
      var accel=avg(eh)>0?Math.round(((avg(rh)-avg(eh))/avg(eh))*100):0;
      var all=avg(pts);
      var dur=Math.round((pts.filter(function(p){return safeNum(p.ratio)>=all;}).length/pts.length)*100);
      result[keywords[idx]]={surgeRate:surge,accel:accel,durability:dur,rawData:pts,clusterRoot:cluster.root,clusterSize:cluster.keywords.length};
    });
    return result;
  }catch(e){console.error('[datalab-cluster]',cluster.root,e.message);return null;}
}

async function fetchNaverDatalab(keywords, period){
  var clusters=buildKeywordClusters(keywords), result={};
  for(var i=0;i<clusters.length;i++){
    var cl=clusters[i];
    try{
      var clResult=await fetchNaverDatalabCluster(cl,period);
      if(clResult) Object.keys(clResult).forEach(function(k){result[k]=clResult[k];});
    }catch(e){
      console.warn('[datalab-cluster-fail]',cl.root,e.message);
      // ★ 클러스터 실패 시 키워드별 단독 재시도
      for(var j=0;j<cl.keywords.length;j++){
        try{
          var single=await fetchNaverDatalabCluster({root:cl.keywords[j],label:cl.keywords[j],keywords:[cl.keywords[j]]},period);
          if(single) Object.keys(single).forEach(function(k){result[k]=single[k];});
          await sleep(300);
        }catch(e2){ console.warn('[datalab-single-fail]',cl.keywords[j],e2.message); }
      }
    }
    if(i<clusters.length-1) await sleep(400);
  }
  return result;
}

// ── 쇼핑인사이트 ─────────────────────────────────────────────
async function fetchNaverShoppingInsight(keyword, catId, period){
  try{
    var totalDays=period==='month'?60:14,timeUnit=period==='month'?'week':'date';
    var body={
      startDate:fmtDate(agoDate(totalDays+1)),
      endDate:fmtDate(agoDate(1)),
      timeUnit:timeUnit,
      category:catId||'50000008',
      keyword:[{name:keyword,param:[keyword]}],
      device:'',gender:'',ages:[],
    };
    var data=await naverPost('/v1/datalab/shopping/category/keywords',body);
    if(!data||!data.results) return null;
    await sleep(300);
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
  }catch(e){console.error('[insight]',keyword,e.message);return null;}
}

// ── ★ 카테고리별 TOP 키워드 수집 ─────────────────────────────
// 카테고리 ID 배열 → 각 시드 키워드를 쇼핑인사이트로 스코어링 → 상위 반환
async function fetchCategoryTopKeywords(catIds, period){
  var result=[];
  for(var i=0;i<catIds.length;i++){
    var catId=catIds[i];
    var seeds=CFG.CATEGORY_SEEDS[catId]||[];
    if(!seeds.length) continue;
    var catItems=[];
    for(var j=0;j<Math.min(seeds.length,6);j++){
      try{
        var insight=await fetchNaverShoppingInsight(seeds[j],catId,period);
        var trendScore=0;
        if(insight){
          trendScore=Math.max(0,insight.clickSurge||0)+Math.max(0,insight.clickAccel||0);
          if(insight.shopTrend==='hot')    trendScore+=30;
          else if(insight.shopTrend==='rising') trendScore+=15;
        }
        catItems.push({keyword:seeds[j],catId:catId,insightData:insight,trendScore:trendScore});
      }catch(e){
        catItems.push({keyword:seeds[j],catId:catId,insightData:null,trendScore:0});
      }
      await sleep(350);
    }
    // 카테고리당 상위 3개만
    catItems.sort(function(a,b){return b.trendScore-a.trendScore;});
    result=result.concat(catItems.slice(0,3));
  }
  return result;
}

// ── 배치 수집 (scope + catIdMap 지원) ────────────────────────
// scope: 'all' | 'shop' | 'search'
// catIdMap: { [keyword]: catId } — 카테고리 모드에서 전달
async function fetchNaverBatch(keywords, period, scope, catIdMap){
  var s=scope||'all';
  var results={};

  // 1단계: 전체검색 (scope !== 'shop')
  if(s!=='shop'){
    for(var i=0;i<keywords.length;i++){
      var kw=keywords[i];
      if(!results[kw]) results[kw]={};
      results[kw].search=await fetchNaverSearchData(kw);
      await sleep(400);
    }
  }

  // 2단계: 데이터랩 (scope !== 'shop')
  if(s!=='shop'){
    var dlData=await fetchNaverDatalab(keywords,period);
    keywords.forEach(function(kw){
      if(!results[kw]) results[kw]={};
      results[kw].datalab=dlData[kw]||null;
    });
    await sleep(500);
  }

  // 3단계: 쇼핑인사이트 (scope !== 'search') — ★ catId 정확히 전달
  if(s!=='search'){
    for(var k=0;k<keywords.length;k++){
      var kw2=keywords[k];
      if(!results[kw2]) results[kw2]={};
      if(!results[kw2].insight){
        var cid=(catIdMap&&catIdMap[kw2])||null; // ★ 해당 키워드의 catId 사용
        results[kw2].insight=await fetchNaverShoppingInsight(kw2,cid,period);
        await sleep(400);
      }
    }
  }

  return results;
}

module.exports = {
  fetchNaverSearchData,
  fetchNaverDatalab,
  fetchNaverShoppingInsight,
  fetchNaverBatch,
  calcSearchIntentFromData,
  fetchNaverSuggestions,        // ★
  fetchCategoryTopKeywords,
  buildKeywordClusters,
  fetchNaverDatalabCluster,
};
