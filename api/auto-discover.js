var CFG       = require('./_config');
var FETCH     = require('./_fetch');
var SCORE     = require('./_score');
var ANALYZE   = require('./_analyze');
var NAVER_EXT = require('./_fetch-naver-ext');
var MULTI     = require('./_fetch-multi');
var GROQ      = require('./_groq');
var BLUE      = require('./_score-blue');

var TTL = 5*60*1000;
var CACHE_ALL = {}, CACHE_CAT = {};

function getCacheAll(p){ var c=CACHE_ALL[p]; return c&&c.data&&(Date.now()-c.ts<TTL)?c.data:null; }
function setCacheAll(p,d){ CACHE_ALL[p]={data:d,ts:Date.now()}; }
function getCacheCat(catId,p){ var k=catId+'_'+p; var c=CACHE_CAT[k]; return c&&c.data&&(Date.now()-c.ts<TTL)?c.data:null; }
function setCacheCat(catId,p,d){ var k=catId+'_'+p; CACHE_CAT[k]={data:d,ts:Date.now()}; }

function checkEnv(){
  var miss=[];
  if(!process.env.NAVER_CLIENT_ID)     miss.push('NAVER_CLIENT_ID');
  if(!process.env.NAVER_CLIENT_SECRET) miss.push('NAVER_CLIENT_SECRET');
  if(miss.length) throw new Error('환경변수 누락: '+miss.join(', '));
}

function buildCandidate(kw, result, maxTotal, intentOverride, velocity, shoppingInsight){
  var intent     = intentOverride||ANALYZE.detectIntent(kw);
  var commercial = SCORE.calcCommercialScore(kw, result, intent);
  var score      = SCORE.calcScore(result, maxTotal, velocity, commercial, shoppingInsight||null);
  var trend      = SCORE.judgeTWithInsight(result.totalCount, shoppingInsight||null);
  var base       = ANALYZE.makeSummary(kw, score, trend, intent);
  var action     = velocity?SCORE.velocityAction(velocity, base.action):base.action;
  var samples=[];
  for(var i=0;i<Math.min(3,result.items.length);i++) samples.push({title:result.items[i].title,link:result.items[i].link,source:'shopping'});
  return {
    id:kw, name:kw, keywords:[kw], sources:['shopping'],
    count:result.items.length, totalCount:result.totalCount,
    intent:intent, intentLabel:ANALYZE.INTENT_LABEL[intent]||'–',
    commercial:commercial,
    velocity:velocity||null, velocityLabel:SCORE.velocityLabel(velocity),
    shoppingInsight:shoppingInsight||null,
    insightLabel:score.insightLabel||null,
    insightDetail:score.insightDetail||null,
    reason:ANALYZE.buildReason(kw, score, trend, velocity, intent),
    score:score, trend:trend,
    summary:base.summary, action:action,
    sampleItems:samples
  };
}

// ── 카테고리 탐색 ────────────────────────────────────────────
async function discoverCategory(catId, period){
  var kws=CFG.CAT_SEEDS[catId]||CFG.CAT_SEEDS['50000003'];
  var valid=await FETCH.batchShopSearch(kws);
  var withItems=valid.filter(function(v){return v.result.items.length>0;});
  valid=withItems.concat(valid.filter(function(v){return !v.result.items.length;}));
  if(!valid.length) return {candidates:[], apiStatus:{search:'결과 없음'}};
  var maxTotal=valid.reduce(function(m,v){return Math.max(m,v.result.totalCount);},0)||40;
  var vMap={}, siMap={};
  var top10=valid.slice(0,20).sort(function(a,b){return b.result.totalCount-a.result.totalCount;}).slice(0,10);
  for(var vi=0;vi<top10.length;vi++){
    var v=top10[vi];
    var r2=await Promise.all([FETCH.fetchVelocity(v.kw,period),FETCH.fetchShoppingInsight(v.kw,period)]);
    vMap[v.kw]=r2[0]; siMap[v.kw]=r2[1];
    if(vi<top10.length-1) await new Promise(function(r){setTimeout(r,200);});
  }
  var candidates=valid.map(function(v){
    return buildCandidate(v.kw,v.result,maxTotal,null,vMap[v.kw]||null,siMap[v.kw]||null);
  }).filter(function(c){return c.score.totalScore>0;});
  candidates.sort(function(a,b){return b.score.totalScore-a.score.totalScore;});
  return {candidates:candidates.slice(0,10), apiStatus:{search:withItems.length+'/'+kws.length+' 성공'}};
}

// ── 전체 카테고리 탐색 ───────────────────────────────────────
async function discoverAll(period){
  var tasks=[];
  CFG.CAT_ORDER.forEach(function(catId){
    (CFG.CAT_SEEDS[catId]||[]).slice(0,3).forEach(function(kw){ tasks.push({catId:catId,kw:kw}); });
  });
  var BATCH=10, pool=[], completed=[], failed=[];
  for(var i=0;i<tasks.length;i+=BATCH){
    var chunk=tasks.slice(i,i+BATCH);
    var settled=await Promise.allSettled(chunk.map(function(t){return FETCH.shopSearch(t.kw,null);}));
    settled.forEach(function(r,j){
      var t=chunk[j], result=r.status==='fulfilled'?r.value:{items:[],totalCount:0};
      if(result.items.length>0){
        pool.push({catId:t.catId,kw:t.kw,result:result});
        if(completed.indexOf(CFG.CAT_NAMES[t.catId]||t.catId)<0) completed.push(CFG.CAT_NAMES[t.catId]||t.catId);
      } else {
        if(failed.indexOf(CFG.CAT_NAMES[t.catId]||t.catId)<0) failed.push(CFG.CAT_NAMES[t.catId]||t.catId);
      }
    });
    if(i+BATCH<tasks.length) await new Promise(function(r){setTimeout(r,200);});
  }
  if(!pool.length) return {candidates:[],apiStatus:{completed:'0',failed:'전체 실패'},processLog:{completed:[],failed:[]}};
  var maxTotal=pool.reduce(function(m,v){return Math.max(m,v.result.totalCount);},0)||40;
  var vMap={},siMap={};
  var top10pool=pool.slice().sort(function(a,b){return b.result.totalCount-a.result.totalCount;}).slice(0,10);
  for(var pi=0;pi<top10pool.length;pi++){
    var pv=top10pool[pi];
    var pres=await Promise.all([FETCH.fetchVelocity(pv.kw,period),FETCH.fetchShoppingInsight(pv.kw,period)]);
    vMap[pv.kw]=pres[0]; siMap[pv.kw]=pres[1];
    if(pi<top10pool.length-1) await new Promise(function(r){setTimeout(r,200);});
  }
  var candidates=pool.map(function(v){
    var c=buildCandidate(v.kw,v.result,maxTotal,null,vMap[v.kw]||null,siMap[v.kw]||null);
    c.category=CFG.CAT_NAMES[v.catId]||v.catId;
    return c;
  });
  candidates.sort(function(a,b){return b.score.totalScore-a.score.totalScore;});
  return {candidates:candidates.slice(0,10),apiStatus:{completed:completed.length+'/'+CFG.CAT_ORDER.length+' 카테고리',failed:failed.length?failed.join(', '):'없음'},processLog:{completed:completed,failed:failed}};
}

// ── 시드 키워드 확장 ─────────────────────────────────────────
async function discoverSeed(seedKw, period){
  var STOP=new Set(['이','가','을','를','의','에','는','은','도','와','과','세트','상품','제품','판매']);
  var list=ANALYZE.expandIntentKeywords(seedKw);
  var r1=await FETCH.shopSearch(seedKw,null).catch(function(){return {items:[],totalCount:0};});
  var freq={};
  (r1.items||[]).forEach(function(i){
    FETCH.cleanText(i.title||'').split(/\s+/).filter(function(w){return w.length>1&&!STOP.has(w)&&w!==seedKw;}).forEach(function(w){freq[w]=(freq[w]||0)+1;});
  });
  Object.entries(freq).sort(function(a,b){return b[1]-a[1];}).slice(0,3).forEach(function(e){list.push({kw:e[0],intent:'none'});});
  var seen={}, unique=[];
  list.forEach(function(item){if(!seen[item.kw]){seen[item.kw]=true;unique.push(item);}});
  unique=unique.slice(0,12);
  var res=await Promise.allSettled(unique.map(function(item){return FETCH.shopSearch(item.kw,null);}));
  var valid=[];
  for(var i=0;i<unique.length;i++){
    var r=res[i].status==='fulfilled'?res[i].value:{items:[],totalCount:0};
    if(r.items.length>0) valid.push({kw:unique[i].kw,intent:unique[i].intent,result:r});
  }
  if(!valid.length) return {candidates:[],apiStatus:{search:'결과 없음'}};
  var maxTotal=valid.reduce(function(m,v){return Math.max(m,v.result.totalCount);},0)||40;
  var vMap={},siMap={};
  var top10seed=valid.slice().sort(function(a,b){return b.result.totalCount-a.result.totalCount;}).slice(0,10);
  for(var si2=0;si2<top10seed.length;si2++){
    var sv=top10seed[si2];
    var sres=await Promise.all([FETCH.fetchVelocity(sv.kw,period),FETCH.fetchShoppingInsight(sv.kw,period)]);
    vMap[sv.kw]=sres[0]; siMap[sv.kw]=sres[1];
    if(si2<top10seed.length-1) await new Promise(function(r){setTimeout(r,200);});
  }
  var candidates=valid.map(function(v){
    return buildCandidate(v.kw,v.result,maxTotal,v.intent,vMap[v.kw]||null,siMap[v.kw]||null);
  });
  candidates.sort(function(a,b){return b.score.totalScore-a.score.totalScore;});
  return {candidates:candidates.slice(0,10),apiStatus:{search:valid.length+'/'+unique.length+' 성공'}};
}

// ── 멀티소스 블루오션 탐색 (수정) ────────────────────────────
async function discoverMulti(period){
  var apiStatus={};

  // STEP 1: 외부 소스 병렬 수집
  var results = await Promise.allSettled([
    MULTI.fetchYoutubeTrending(),
    MULTI.fetchYoutubeShorts(),
    MULTI.fetchCoupangBest(),
    MULTI.fetchGoogleKorea(),
    MULTI.fetchGoogleOverseas(),
    MULTI.fetchTikTokTrends(),
    MULTI.fetchInstagramTrends()
  ]);
  var youtube   = results[0].status==='fulfilled' ? results[0].value : [];
  var shorts    = results[1].status==='fulfilled' ? results[1].value : [];
  var coupang   = results[2].status==='fulfilled' ? results[2].value : [];
  var googleKr  = results[3].status==='fulfilled' ? results[3].value : [];
  var googleOs  = results[4].status==='fulfilled' ? results[4].value : [];
  var tiktok    = results[5].status==='fulfilled' ? results[5].value : [];
  var instagram = results[6].status==='fulfilled' ? results[6].value : [];

  apiStatus.youtube   = (youtube.length+shorts.length)+'개';
  apiStatus.coupang   = coupang.length+'개 (급등 '+coupang.filter(function(p){return p.rankChange>=10;}).length+'개)';
  apiStatus.tiktok    = tiktok.length+'개';
  apiStatus.instagram = instagram.length+'개';
  apiStatus.google    = (googleKr.length+googleOs.length)+'개';

  // STEP 2: GROQ 제품 추출
  var extracted = await GROQ.extractTrendingProducts({
    youtube:youtube, shorts:shorts, coupang:coupang,
    tiktok:tiktok, instagram:instagram,
    googleKr:googleKr, googleOs:googleOs, naver:[]
  }).catch(function(){ return []; });

  apiStatus.groq = extracted.length ? extracted.length+'개 추출' : '실패/키 없음';
  if(!extracted.length) return {candidates:[], apiStatus:apiStatus};

  // STEP 3: 네이버 쇼핑 검증 (병렬 유지)
  var naverResults = await Promise.allSettled(
    extracted.map(function(e){ return FETCH.shopSearch(e.name, null); })
  );

  var maxTotal=0;
  naverResults.forEach(function(r){ if(r.status==='fulfilled') maxTotal=Math.max(maxTotal, r.value.totalCount); });
  if(!maxTotal) maxTotal=40;

  // ★ STEP 3-1: 블로그·카페·뉴스 — 배치 순차 처리 (레이트 리밋 방지)
  var kwList = extracted.map(function(e){ return e.name; });
  var naverCounts = await NAVER_EXT.fetchNaverCountsBatch(kwList);
  apiStatus['블로그/카페'] = naverCounts.filter(function(nc){ return nc.blogCount>0; }).length+'개 수집';

  // STEP 4: 후보 구성
  var candidates=[];
  for(var i=0; i<extracted.length; i++){
    var e  = extracted[i];
    var nr = naverResults[i].status==='fulfilled' ? naverResults[i].value : {items:[],totalCount:0};
    // ★ 배치 결과는 인덱스로 직접 접근
    var nc = naverCounts[i] || {blogCount:0, cafeCount:0, newsCount:0};
    if(!nr.items.length) continue;
    var c = buildCandidate(e.name, nr, maxTotal, null, null, null);
    c.groqScore     = e.score      || 0;
    c.groqSignals   = e.signals    || [];
    c.groqReason    = e.reason     || '';
    c.groqBlogAngle = e.blogAngle  || '';
    c.groqPhase     = e.phase      || '';
    c.groqPeakHours = e.peakHours  || 72;
    c.hasOverseas   = e.hasOverseas|| false;
    c.blogCount     = nc.blogCount;
    c.cafeCount     = nc.cafeCount;
    c.newsCount     = nc.newsCount;
    c.tiktokCount = tiktok.filter(function(h){
      return c.name.indexOf(h.tag)>-1 || h.tag.indexOf(c.name.slice(0,3))>-1;
    }).length;
    var cpItem = coupang.find(function(p){ return p.name.indexOf(c.name.slice(0,4))>-1; });
    c.coupangRank       = cpItem ? cpItem.rank      : null;
    c.coupangRankChange = cpItem ? cpItem.rankChange : 0;
    candidates.push(c);
  }

  // ★ STEP 5: velocity + insight — 순차 처리 (레이트 리밋 방지)
  var top5 = candidates.slice(0,5);
  for(var vi=0; vi<top5.length; vi++){
    var cv = top5[vi];
    try{
      var vel = await FETCH.fetchVelocity(cv.name, period);
      await new Promise(function(r){setTimeout(r,200);});
      var si  = await FETCH.fetchShoppingInsight(cv.name, period);
      if(vel||si){
        cv.velocity        = vel;
        cv.velocityLabel   = SCORE.velocityLabel(vel);
        cv.shoppingInsight = si;
        var nr2 = naverResults.find(function(r,j){ return extracted[j]&&extracted[j].name===cv.name&&r.status==='fulfilled'; });
        var res2 = nr2 ? nr2.value : {items:cv.sampleItems||[],totalCount:cv.totalCount||0};
        var ns = SCORE.calcScore(res2, maxTotal, vel, cv.commercial, si);
        cv.score        = ns;
        cv.insightLabel = ns.insightLabel;
      }
    }catch(e){ console.error('[velocity/insight]', cv.name, e.message); }
    if(vi < top5.length-1) await new Promise(function(r){setTimeout(r,300);});
  }

  // STEP 6: 블루오션 스코어 + 단계 계산
  candidates.forEach(function(c){
    var vel = c.velocity||{};
    var boData = {
      searchSurge:  vel.surgeRate||0,
      ytSurge:      youtube.filter(function(v){ return v.title.indexOf(c.name.slice(0,3))>-1; }).length * 20,
      coupangSurge: c.coupangRankChange||0,
      snsSurge:     (c.tiktokCount||0)*15,
      hasOverseas:  c.hasOverseas||false,
      blogCount:    c.blogCount||0
    };
    c.blueOcean = BLUE.calcBlueOcean(boData);
    c.phase     = BLUE.detectPhase({
      searchSurge: vel.surgeRate||0,
      blogCount:   c.blogCount||0,
      cafeCount:   c.cafeCount||0,
      newsCount:   c.newsCount||0,
      ytSurge:     boData.ytSurge||0,
      snsSurge:    boData.snsSurge||0
    });
    c.score.totalScore = Math.min(100, c.score.totalScore + Math.round((c.groqScore||0)/100*15));
    if(c.groqSignals&&c.groqSignals.length){
      c.sources = c.sources.concat(c.groqSignals.filter(function(s){ return c.sources.indexOf(s)<0; }));
    }
    var r=[];
    if(c.blueOcean.score>=5)      r.push('🔥 극강 블루오션 '+c.blueOcean.score);
    else if(c.blueOcean.score>=2) r.push('✅ 블루오션 '+c.blueOcean.score);
    if(c.phase) r.push(c.phase.emoji+' '+c.phase.phase);
    if(c.hasOverseas) r.push('🌍 해외 선행 신호');
    if(c.coupangRankChange>=10) r.push('🛒 쿠팡 '+c.coupangRankChange+'단계 급등');
    if(r.length) c.reason = r.join(' · ')+(c.groqReason?' — '+c.groqReason:'');
    if(c.groqBlogAngle) c.blogAngle = c.groqBlogAngle;
    if(c.groqPeakHours) c.peakHours = c.groqPeakHours;
  });

  candidates.sort(function(a,b){
    var boDiff=(b.blueOcean&&b.blueOcean.score||0)-(a.blueOcean&&a.blueOcean.score||0);
    if(Math.abs(boDiff)>0.5) return boDiff;
    return b.score.totalScore-a.score.totalScore;
  });

  apiStatus.naver = candidates.length+'개 검증';
  return { candidates:candidates.slice(0,10), apiStatus:apiStatus };
}

// ── 핸들러 ───────────────────────────────────────────────────
module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();
  try{ checkEnv(); }catch(e){ return res.status(500).json({error:e.message}); }

  var mode=req.query.mode||'category', period=req.query.period||'week';

  try{
    if(mode==='multi'){
      var mr=await discoverMulti(period);
      return res.status(200).json({
        candidates:mr.candidates, clusters:ANALYZE.clusterCandidates(mr.candidates),
        mode:mode, period:period, total:mr.candidates.length,
        apiStatus:mr.apiStatus, updatedAt:new Date().toISOString()
      });
    }
    if(mode==='category'){
      var catId=req.query.categoryId||'50000003';
      if(catId==='all'){
        var cached=getCacheAll(period);
        if(cached){cached.fromCache=true;cached.cacheAge=Math.round((Date.now()-CACHE_ALL[period].ts)/1000)+'초 전';return res.status(200).json(cached);}
        var ar=await discoverAll(period);
        var result={candidates:ar.candidates,clusters:ANALYZE.clusterCandidates(ar.candidates),mode:mode,categoryId:'all',categoryName:'전체',period:period,total:ar.candidates.length,apiStatus:ar.apiStatus,processLog:ar.processLog,updatedAt:new Date().toISOString(),fromCache:false};
        setCacheAll(period,result); return res.status(200).json(result);
      }
      var cachedCat=getCacheCat(catId,period);
      if(cachedCat){cachedCat.fromCache=true;cachedCat.cacheAge=Math.round((Date.now()-CACHE_CAT[catId+'_'+period].ts)/1000)+'초 전';return res.status(200).json(cachedCat);}
      var cr=await discoverCategory(catId,period);
      var catResult={candidates:cr.candidates,clusters:ANALYZE.clusterCandidates(cr.candidates),mode:mode,categoryId:catId,categoryName:CFG.CAT_NAMES[catId]||catId,period:period,total:cr.candidates.length,apiStatus:cr.apiStatus,updatedAt:new Date().toISOString(),fromCache:false};
      setCacheCat(catId,period,catResult); return res.status(200).json(catResult);
    }
    if(mode==='seed'){
      var seedKw=String(req.query.keyword||'').trim().slice(0,30);
      if(!seedKw) return res.status(400).json({error:'키워드를 입력해주세요'});
      var sr=await discoverSeed(seedKw,period);
      return res.status(200).json({candidates:sr.candidates,clusters:ANALYZE.clusterCandidates(sr.candidates),mode:mode,seedKeyword:seedKw,period:period,total:sr.candidates.length,apiStatus:sr.apiStatus,updatedAt:new Date().toISOString()});
    }
    return res.status(400).json({error:'알 수 없는 mode'});
  }catch(e){
    console.error('[auto-discover]',e.message);
    return res.status(500).json({error:'탐색 중 오류가 발생했습니다.', detail:e.message});
  }
};
