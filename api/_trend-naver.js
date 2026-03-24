var https = require('https');
var CFG   = require('./_trend-config');

function safeNum(v){ return isNaN(Number(v)) ? 0 : Number(v); }
function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }

function fmtDate(d){
  var p = function(n){return String(n).padStart(2,'0');};
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}
function agoDate(n){ var d=new Date(); d.setDate(d.getDate()-n); return d; }

function naverGet(path, params){
  return new Promise(function(resolve, reject){
    var qs = Object.keys(params).map(function(k){
      return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);
    }).join('&');
    var t = setTimeout(function(){ reject(new Error('timeout')); }, CFG.TIMEOUT);
    var req = https.request({
      hostname:'openapi.naver.com', path:path+'?'+qs, method:'GET',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      }
    }, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end', function(){
        clearTimeout(t);
        try{
          var d=JSON.parse(raw);
          if(d.errorCode){ console.error('[naverGet]',d.errorCode,d.errorMessage); resolve(null); return; }
          resolve(d);
        }catch(e){ resolve(null); }
      });
    });
    req.on('error',function(e){clearTimeout(t); reject(e);});
    req.end();
  });
}

function naverPost(path, body){
  return new Promise(function(resolve, reject){
    var buf = Buffer.from(JSON.stringify(body),'utf8');
    var t   = setTimeout(function(){ reject(new Error('timeout')); }, CFG.TIMEOUT);
    var req = https.request({
      hostname:'openapi.naver.com', path:path, method:'POST',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
        'Content-Type':'application/json',
        'Content-Length': buf.length,
      }
    }, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end', function(){
        clearTimeout(t);
        try{
          var d=JSON.parse(raw);
          if(d.errorCode){ console.error('[naverPost]',d.errorCode,d.errorMessage); resolve(null); return; }
          resolve(d);
        }catch(e){ resolve(null); }
      });
    });
    req.on('error',function(e){clearTimeout(t); reject(e);});
    req.write(buf); req.end();
  });
}

// ── 네이버 검색 (블로그+쇼핑+뉴스+카페) ─────────────────────
async function fetchNaverSearchData(keyword){
  try{
    var [blogRes, shopRes, newsRes, cafeRes] = await Promise.all([
      naverGet('/v1/search/blog.json',        { query:keyword, display:20, sort:'date' }),
      naverGet('/v1/search/shop.json',        { query:keyword, display:10, sort:'sim'  }),
      naverGet('/v1/search/news.json',        { query:keyword, display:10, sort:'date' }),
      naverGet('/v1/search/cafearticle.json', { query:keyword, display:10, sort:'date' }),
    ]);
    await sleep(200);

    var blogCount  = blogRes ? safeNum(blogRes.total)  : 0;
    var newsCount  = newsRes ? safeNum(newsRes.total)  : 0;
    var cafeCount  = cafeRes ? safeNum(cafeRes.total)  : 0;
    var shopExists = !!(shopRes&&shopRes.items&&shopRes.items.length>0);
    var shopItems  = shopRes ? (shopRes.items||[]) : [];

    var allTitles = [];
    if(blogRes&&blogRes.items) allTitles=allTitles.concat(blogRes.items.map(function(i){return i.title+' '+(i.description||'');}));
    if(shopRes&&shopRes.items) allTitles=allTitles.concat(shopRes.items.map(function(i){return i.title||'';}));
    if(cafeRes&&cafeRes.items) allTitles=allTitles.concat(cafeRes.items.map(function(i){return i.title+' '+(i.description||'');}));
    var allText = allTitles.join(' ').replace(/<[^>]+>/g,'');
    var buyIntentHits = 0;
    CFG.BUY_INTENT_SIGNALS.forEach(function(sig){ if(allText.indexOf(sig)>-1) buyIntentHits++; });

    return {
      blogCount:blogCount, newsCount:newsCount, cafeCount:cafeCount,
      cafeSignal: cafeCount>=50?'active':cafeCount>=10?'low':'none',
      shopExists:shopExists, shopItemCount:shopItems.length,
      buyIntentHits:buyIntentHits, shoppingExists:shopExists,
      sampleShopItems: shopItems.slice(0,3).map(function(i){
        return { title:i.title.replace(/<[^>]+>/g,''), price:safeNum(i.lprice), link:i.link||'' };
      }),
    };
  }catch(e){
    console.error('[naver-search]',keyword,e.message);
    return null;
  }
}

// ── ★ [6] 유사 키워드군 클러스터링 ──────────────────────────
// 키워드들을 공통 어근/의미 기준으로 묶어 클러스터 구성
function buildKeywordClusters(keywords){
  var clusters = [];
  var assigned = {};

  keywords.forEach(function(kw){
    if(assigned[kw]) return;

    // 이미 만들어진 클러스터에 속하는지 확인
    var matched = false;
    for(var i=0; i<clusters.length; i++){
      var cl = clusters[i];
      var root = cl.root;
      // 어근 포함 여부 (양방향)
      if(kw.indexOf(root)>-1 || root.indexOf(kw)>-1){
        cl.keywords.push(kw);
        assigned[kw] = true;
        matched = true;
        break;
      }
      // 공통 앞 2글자 이상
      var minLen = Math.min(kw.length, root.length);
      if(minLen >= 2){
        var common = 0;
        for(var j=0; j<minLen; j++){
          if(kw[j]===root[j]) common++; else break;
        }
        if(common >= 2){
          cl.keywords.push(kw);
          assigned[kw] = true;
          matched = true;
          break;
        }
      }
    }

    if(!matched){
      clusters.push({ root:kw, label:kw, keywords:[kw] });
      assigned[kw] = true;
    }
  });

  // 단독 클러스터(1개짜리)는 묶지 않고 그대로 유지
  return clusters;
}

// ── ★ [6] 클러스터 단위 데이터랩 비교 호출 ──────────────────
// 하나의 데이터랩 API 호출에 유사 키워드군을 함께 넣어 상대적 강도 비교
async function fetchNaverDatalabCluster(cluster, period){
  var keywords = cluster.keywords.slice(0,5); // API 최대 5개
  if(!keywords.length) return null;

  var totalDays = period==='month' ? 60 : 14;
  var timeUnit  = period==='month' ? 'week' : 'date';
  var groups    = keywords.map(function(kw){
    return { groupName:kw, keywords:[kw] };
  });
  var body = {
    startDate:     fmtDate(agoDate(totalDays+1)),
    endDate:       fmtDate(agoDate(1)),
    timeUnit:      timeUnit,
    keywordGroups: groups,
  };

  try{
    var data = await naverPost('/v1/datalab/search', body);
    if(!data||!data.results) return null;
    await sleep(300);

    var result = {};
    data.results.forEach(function(r, idx){
      var originalKw = keywords[idx] || r.title;
      var pts = r.data || [];
      if(pts.length < 4){ result[originalKw] = null; return; }
      var h    = Math.floor(pts.length/2);
      var prev = pts.slice(0,h), curr = pts.slice(h);
      var avg  = function(a){ return a.reduce(function(s,p){return s+safeNum(p.ratio);},0)/(a.length||1); };
      var pa   = avg(prev), ca = avg(curr);
      var surge = pa>0 ? Math.round(((ca-pa)/pa)*100) : (ca>0?100:0);
      var eh    = curr.slice(0,Math.floor(curr.length/2)), rh=curr.slice(Math.floor(curr.length/2));
      var accel = avg(eh)>0 ? Math.round(((avg(rh)-avg(eh))/avg(eh))*100) : 0;
      var all   = avg(pts);
      var dur   = Math.round((pts.filter(function(p){return safeNum(p.ratio)>=all;}).length/pts.length)*100);

      result[originalKw] = {
        surgeRate:   surge,
        accel:       accel,
        durability:  dur,
        rawData:     pts,
        clusterRoot: cluster.root,          // ★ 클러스터 정보 포함
        clusterSize: cluster.keywords.length,
      };
    });

    // ★ 클러스터 내 가장 강한 키워드 선정
    var bestKw = null, bestSurge = -Infinity;
    Object.keys(result).forEach(function(kw){
      if(result[kw] && result[kw].surgeRate > bestSurge){
        bestSurge = result[kw].surgeRate;
        bestKw = kw;
      }
    });
    if(bestKw) result[cluster.root+'__best'] = bestKw;

    return result;
  }catch(e){
    console.error('[datalab-cluster]', cluster.root, e.message);
    return null;
  }
}

// ── 데이터랩: 전체 키워드 처리 (클러스터 묶기 + 개별 폴백) ──
async function fetchNaverDatalab(keywords, period){
  // ★ [6] 유사 키워드군 클러스터 구성
  var clusters = buildKeywordClusters(keywords);
  var result   = {};

  for(var i=0; i<clusters.length; i++){
    var cl      = clusters[i];
    var clResult = await fetchNaverDatalabCluster(cl, period);
    if(clResult){
      Object.keys(clResult).forEach(function(k){
        if(k.indexOf('__best')<0) result[k] = clResult[k];
      });
    }
    if(i < clusters.length-1) await sleep(400);
  }

  return result;
}

// ── 쇼핑인사이트 ─────────────────────────────────────────────
async function fetchNaverShoppingInsight(keyword, catId, period){
  try{
    var totalDays = period==='month' ? 60 : 14;
    var timeUnit  = period==='month' ? 'week' : 'date';
    var cid = catId || '50000008';
    var body = {
      startDate: fmtDate(agoDate(totalDays+1)),
      endDate:   fmtDate(agoDate(1)),
      timeUnit:  timeUnit,
      category:  cid,
      keyword:   [{name:keyword, param:[keyword]}],
      device:'', gender:'', ages:[],
    };
    var data = await naverPost('/v1/datalab/shopping/category/keywords', body);
    if(!data||!data.results) return null;
    await sleep(300);

    var pts = ((data.results||[])[0]||{}).data||[];
    if(pts.length < 4) return null;
    var h    = Math.floor(pts.length/2);
    var prev = pts.slice(0,h), curr = pts.slice(h);
    var avg  = function(a){ return a.reduce(function(s,p){return s+safeNum(p.ratio);},0)/(a.length||1); };
    var pa   = avg(prev), ca = avg(curr);
    var clickSurge = pa>0 ? Math.round(((ca-pa)/pa)*100) : (ca>0?100:0);
    var last3=pts.slice(-3), prev3=pts.slice(Math.max(0,pts.length-6),-3);
    var l3=avg(last3), p3=avg(prev3);
    var clickAccel   = p3>0 ? Math.round(((l3-p3)/p3)*100) : (l3>0?50:0);
    var all          = avg(pts);
    var dur          = Math.round((pts.filter(function(p){return safeNum(p.ratio)>=all;}).length/pts.length)*100);
    var shopTrend    = clickSurge>=30?'hot':clickSurge>=10?'rising':clickSurge>=-10?'stable':'falling';

    return {
      clickSurge:clickSurge, clickAccel:clickAccel,
      clickDurability:dur, shopTrend:shopTrend,
      currentRatio:Math.round(ca*10)/10,
    };
  }catch(e){
    console.error('[insight]',keyword,e.message);
    return null;
  }
}

// ── 배치 수집 ────────────────────────────────────────────────
async function fetchNaverBatch(keywords, period){
  var results = {};

  // 1단계: 검색+카페+뉴스 (순차)
  for(var i=0; i<keywords.length; i++){
    var kw = keywords[i];
    if(!results[kw]) results[kw] = {};
    results[kw].search = await fetchNaverSearchData(kw);
    await sleep(400);
  }

  // 2단계: ★ 클러스터 기반 데이터랩 (묶어서 비교)
  var dlData = await fetchNaverDatalab(keywords, period);
  keywords.forEach(function(kw){
    if(!results[kw]) results[kw] = {};
    results[kw].datalab = dlData[kw] || null;
  });
  await sleep(500);

  // 3단계: 쇼핑인사이트 (1개씩)
  for(var k=0; k<keywords.length; k++){
    var kw2 = keywords[k];
    if(!results[kw2]) results[kw2] = {};
    results[kw2].insight = await fetchNaverShoppingInsight(kw2, null, period);
    await sleep(400);
  }

  return results;
}

module.exports = {
  fetchNaverSearchData,
  fetchNaverDatalab,
  fetchNaverShoppingInsight,
  fetchNaverBatch,
  buildKeywordClusters,        // ★ 클러스터 함수 export
  fetchNaverDatalabCluster,    // ★
};
