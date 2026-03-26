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
      var t=setTimeout(function(){ if(!done){done=true; console.warn('[naverGet timeout]',path); resolve(null);} },4000);
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
      req.setTimeout(3500,function(){ req.destroy(); });
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
      var t=setTimeout(function(){ if(!done){done=true; console.warn('[naverPost timeout]',path); resolve(null);} },4000);
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
      req.setTimeout(3500,function(){ req.destroy(); });
      req.write(buf); req.end();
    }catch(e){ resolve(null); }
  });
}

// ── 네이버 검색 (blog+shop+news 병렬) ────────────────────────
async function fetchNaverSearchData(keyword){
  // 순차 호출 — Vercel 아웃바운드 동시연결 제한 회피
  var blogRes = await naverGet('/v1/search/blog.json',{query:keyword,display:10,sort:'date'});
  await sleep(150);
  var shopRes = await naverGet('/v1/search/shop.json',{query:keyword,display:10,sort:'sim'});
  await sleep(150);
  var newsRes = await naverGet('/v1/search/news.json',{query:keyword,display:10,sort:'date'});

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
  sugs.forEach(function(sug){
    var s2=sug.toLowerCase();
    CFG.SEARCH_INTENT.BUY.forEach(function(p){
      if(s2.indexOf(p)>-1){ score+=2; if(detected.length<3) detected.push(p+'(자동완성)'); }
    });
  });
  // ★ 감지된 패턴 없으면 자동완성 키워드 자체를 패턴으로 표시
  if(detected.length===0 && sugs.length>0){
    for(var si=0; si<Math.min(sugs.length,3); si++){
      if(sugs[si]!==keyword) detected.push(sugs[si]); // 키워드 자신 제외
    }
  }

  // naverData 없으면 여기서 반환 — detected 완성 후 반환
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

// ── 카테고리 TOP 키워드 — 전체 병렬 (시간 최우선) ────────────
// 12카테고리 × 2시드 전체 동시 → ~3초
async function fetchCategoryTopKeywords(catIds, period){
  var tasks=[];
  catIds.forEach(function(catId){
    var seeds=(CFG.CATEGORY_SEEDS&&CFG.CATEGORY_SEEDS[catId])||[];
    seeds.slice(0,2).forEach(function(seed){   // 카테고리당 2개만
      tasks.push({keyword:seed,catId:catId});
    });
  });

  // 전체 병렬 실행
  var results=await Promise.all(tasks.map(function(t){
    return fetchNaverShoppingInsight(t.keyword,t.catId,period)
      .then(function(insight){
        var trendScore=0;
        if(insight){
          trendScore=Math.max(0,insight.clickSurge||0)+Math.max(0,insight.clickAccel||0);
          if(insight.shopTrend==='hot')    trendScore+=30;
          else if(insight.shopTrend==='rising') trendScore+=15;
        }
        return {keyword:t.keyword,catId:t.catId,insightData:insight,trendScore:trendScore};
      });
  }));

  results.sort(function(a,b){return b.trendScore-a.trendScore;});
  console.log('[fetchCategoryTopKeywords] 수집:'+results.filter(function(r){return r.insightData;}).length+'/'+results.length);
  return results.slice(0,12);
}

// ── 배치 수집 — 60초 예산 기준 설계 ─────────────────────────
// 예산: 검색 ~15초 + 데이터랩 ~8초 + 인사이트 ~8초 = ~31초
async function fetchNaverBatch(keywords, period, scope, catIdMap){
  var s=scope||'all', results={};
  keywords.forEach(function(kw){ results[kw]={}; });

  // ── STEP A: 검색 — 1개씩 순차 + 200ms (Rate Limit 방지) ────
  if(s!=='shop'){
    var searchOk=0;
    for(var i=0;i<keywords.length;i++){
      var kw=keywords[i];
      results[kw].search=await fetchNaverSearchData(kw);
      if(results[kw].search) searchOk++;
      else console.warn('[search null]',kw);
      await sleep(200);
    }
    console.log('[STEP A] 검색 OK:'+searchOk+'/'+keywords.length);
  }

  // ── STEP B: 데이터랩 — 5개씩 한 번에 호출 (API 지원) ───
  if(s!=='shop'){
    var dlOk=0;
    for(var di=0;di<keywords.length;di+=5){
      var chunk=keywords.slice(di,di+5);
      var clResult=await fetchNaverDatalabCluster({root:chunk[0],label:chunk[0],keywords:chunk},period);
      if(clResult){
        chunk.forEach(function(kw){
          results[kw].datalab=clResult[kw]||null;
          if(clResult[kw]) dlOk++;
        });
      } else { console.warn('[datalab null] chunk:',chunk.join(',')); }
      if(di+5<keywords.length) await sleep(300);
    }
    console.log('[STEP B] 데이터랩 OK:'+dlOk+'/'+keywords.length);
  }

  // ── STEP C: 쇼핑인사이트 — 2개씩 병렬 ─────────────────
  if(s!=='search'){
    var insightOk=0;
    for(var k=0;k<keywords.length;k+=2){
      var ipair=keywords.slice(k,k+2);
      var iRes=await Promise.all(ipair.map(function(kw){
        if(results[kw].insight) return Promise.resolve(results[kw].insight);
        var cid=(catIdMap&&catIdMap[kw])||null;
        return fetchNaverShoppingInsight(kw,cid,period);
      }));
      ipair.forEach(function(kw,j){
        if(!results[kw].insight) results[kw].insight=iRes[j]||null;
        if(results[kw].insight) insightOk++;
        else console.warn('[insight null]',kw);
      });
      if(k+2<keywords.length) await sleep(200);
    }
    console.log('[STEP C] 인사이트 OK:'+insightOk+'/'+keywords.length);
  }

  return results;
}

// 데이터랩 단독 재시도 헬퍼
async function NAVER_DL_SINGLE(keyword, period){
  var totalDays=period==='month'?60:14, timeUnit=period==='month'?'week':'date';
  var data=await naverPost('/v1/datalab/search',{
    startDate:fmtDate(agoDate(totalDays+1)), endDate:fmtDate(agoDate(1)),
    timeUnit:timeUnit, keywordGroups:[{groupName:keyword,keywords:[keyword]}],
  });
  if(!data||!data.results) return null;
  var pts=(data.results[0]||{}).data||[]; if(pts.length<4) return null;
  var h=Math.floor(pts.length/2);
  var avg=function(a){return a.reduce(function(s,p){return s+safeNum(p.ratio);},0)/(a.length||1);};
  var pa=avg(pts.slice(0,h)),ca=avg(pts.slice(h));
  var surge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
  var mid=pts.slice(h),eh=mid.slice(0,Math.floor(mid.length/2)),rh=mid.slice(Math.floor(mid.length/2));
  var accel=avg(eh)>0?Math.round(((avg(rh)-avg(eh))/avg(eh))*100):0;
  var all=avg(pts),dur=Math.round((pts.filter(function(p){return safeNum(p.ratio)>=all;}).length/pts.length)*100);
  return {surgeRate:surge,accel:accel,durability:dur};
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
