var CFG     = require('./_config');
var FETCH   = require('./_fetch');
var SCORE   = require('./_score');
var ANALYZE = require('./_analyze');

var TTL = 5*60*1000;

var CACHE_ALL = {};
var CACHE_CAT = {};

function getCacheAll(period){ var c=CACHE_ALL[period]; return c&&c.data&&(Date.now()-c.ts<TTL)?c.data:null; }
function setCacheAll(period,d){ CACHE_ALL[period]={data:d,ts:Date.now()}; }
function getCacheCat(catId,period){ var k=catId+'_'+period; var c=CACHE_CAT[k]; return c&&c.data&&(Date.now()-c.ts<TTL)?c.data:null; }
function setCacheCat(catId,period,d){ var k=catId+'_'+period; CACHE_CAT[k]={data:d,ts:Date.now()}; }

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
  var samples    = [];
  for(var i=0;i<Math.min(3,result.items.length);i++) samples.push({title:result.items[i].title, link:result.items[i].link, source:'shopping'});
  return {
    id:kw, name:kw, keywords:[kw], sources:['shopping'],
    count:result.items.length, totalCount:result.totalCount,
    intent:intent, intentLabel:ANALYZE.INTENT_LABEL[intent]||'–',
    commercial:commercial,
    velocity:velocity||null, velocityLabel:SCORE.velocityLabel(velocity),
    shoppingInsight: shoppingInsight||null,
    insightLabel:    score.insightLabel||null,
    insightDetail:   score.insightDetail||null,
    reason:ANALYZE.buildReason(kw, score, trend, velocity, intent),
    score:score, trend:trend,
    summary:base.summary, action:action,
    sampleItems:samples
  };
}

// ★ 버그1 수정: siMap 추가, velocity + 쇼핑인사이트 동시 수집
async function discoverCategory(catId, period){
  var kws=CFG.CAT_SEEDS[catId]||CFG.CAT_SEEDS['50000003'];
  var valid=await FETCH.batchShopSearch(kws);
  var withItems = valid.filter(function(v){return v.result.items.length>0;});
  var noItems   = valid.filter(function(v){return v.result.items.length===0;});
  valid = withItems.concat(noItems);

  if(!valid.length) return {candidates:[], apiStatus:{search:'결과 없음'}};

  var maxTotal=valid.reduce(function(m,v){return Math.max(m,v.result.totalCount);},0)||40;

  // velocity + 쇼핑인사이트: 상위 5개만 호출 (API 한도 절약)
  var vMap={}, siMap={};
  var top10 = valid.slice(0,20)
    .sort(function(a,b){return b.result.totalCount-a.result.totalCount;})
    .slice(0,10);

  for(var vi=0; vi<top10.length; vi++){
    var v = top10[vi];
    var res2 = await Promise.all([
      FETCH.fetchVelocity(v.kw, period),
      FETCH.fetchShoppingInsight(v.kw, period)
    ]);
    vMap[v.kw]  = res2[0];
    siMap[v.kw] = res2[1];
    if(vi < top10.length-1) await new Promise(function(r){setTimeout(r,200);});
  }

  var candidates=valid.map(function(v){
    return buildCandidate(v.kw, v.result, maxTotal, null, vMap[v.kw]||null, siMap[v.kw]||null);
  }).filter(function(c){return c.score.totalScore>0;});
  candidates.sort(function(a,b){return b.score.totalScore-a.score.totalScore;});
  return {candidates:candidates.slice(0,30), apiStatus:{search:withItems.length+'/'+kws.length+' 성공'}};
}

async function discoverAll(){
  var tasks=[];
  CFG.CAT_ORDER.forEach(function(catId){
    var seeds=(CFG.CAT_SEEDS[catId]||[]).slice(0,3);
    seeds.forEach(function(kw){ tasks.push({catId:catId, kw:kw}); });
  });

  var BATCH=10, pool=[], completed=[], failed=[];
  for(var i=0;i<tasks.length;i+=BATCH){
    var chunk=tasks.slice(i,i+BATCH);
    var settled=await Promise.allSettled(chunk.map(function(t){return FETCH.shopSearch(t.kw,null);}));
    settled.forEach(function(r,j){
      var t=chunk[j];
      var result=r.status==='fulfilled'?r.value:{items:[],totalCount:0};
      if(result.items.length>0){
        pool.push({catId:t.catId, kw:t.kw, result:result});
        if(completed.indexOf(CFG.CAT_NAMES[t.catId]||t.catId)<0) completed.push(CFG.CAT_NAMES[t.catId]||t.catId);
      } else {
        if(failed.indexOf(CFG.CAT_NAMES[t.catId]||t.catId)<0) failed.push(CFG.CAT_NAMES[t.catId]||t.catId);
      }
    });
    if(i+BATCH<tasks.length) await new Promise(function(r){setTimeout(r,200);});
  }

  if(!pool.length) return {candidates:[], apiStatus:{completed:'0', failed:'전체 실패'}, processLog:{completed:[], failed:[]}};
  var maxTotal=pool.reduce(function(m,v){return Math.max(m,v.result.totalCount);},0)||40;

  // ★ 전체 탐색도 상위 5개 velocity + 쇼핑인사이트 수집
  var vMap={}, siMap={};
  var top10pool = pool.slice().sort(function(a,b){return b.result.totalCount-a.result.totalCount;}).slice(0,10);
  for(var pi=0; pi<top10pool.length; pi++){
    var pv = top10pool[pi];
    var pres = await Promise.all([
      FETCH.fetchVelocity(pv.kw, 'week'),
      FETCH.fetchShoppingInsight(pv.kw, 'week')
    ]);
    vMap[pv.kw]  = pres[0];
    siMap[pv.kw] = pres[1];
    if(pi < top10pool.length-1) await new Promise(function(r){setTimeout(r,200);});
  }

  var candidates=pool.map(function(v){
    var c=buildCandidate(v.kw, v.result, maxTotal, null, vMap[v.kw]||null, siMap[v.kw]||null);
    c.category=CFG.CAT_NAMES[v.catId]||v.catId;
    return c;
  });
  candidates.sort(function(a,b){return b.score.totalScore-a.score.totalScore;});
  return {
    candidates:candidates.slice(0,50),
    apiStatus:{completed:completed.length+'/'+CFG.CAT_ORDER.length+' 카테고리', failed:failed.length?failed.join(', '):'없음'},
    processLog:{completed:completed, failed:failed}
  };
}

// ★ 버그2 수정: period 파라미터 추가
async function discoverSeed(seedKw, period){
  var STOP=new Set(['이','가','을','를','의','에','는','은','도','와','과','세트','상품','제품','판매']);
  var list=ANALYZE.expandIntentKeywords(seedKw);
  var r1=await FETCH.shopSearch(seedKw, null).catch(function(){return {items:[],totalCount:0};});
  var freq={};
  (r1.items||[]).forEach(function(i){
    FETCH.cleanText(i.title||'').split(/\s+/).filter(function(w){return w.length>1&&!STOP.has(w)&&w!==seedKw;})
      .forEach(function(w){freq[w]=(freq[w]||0)+1;});
  });
  Object.entries(freq).sort(function(a,b){return b[1]-a[1];}).slice(0,3).forEach(function(e){list.push({kw:e[0],intent:'none'});});
  var seen={}, unique=[];
  list.forEach(function(item){if(!seen[item.kw]){seen[item.kw]=true;unique.push(item);}});
  unique=unique.slice(0,12);
  var res=await Promise.allSettled(unique.map(function(item){return FETCH.shopSearch(item.kw,null);}));
  var valid=[];
  for(var i=0;i<unique.length;i++){
    var r=res[i].status==='fulfilled'?res[i].value:{items:[],totalCount:0};
    if(r.items.length>0) valid.push({kw:unique[i].kw, intent:unique[i].intent, result:r});
  }
  if(!valid.length) return {candidates:[], apiStatus:{search:'결과 없음'}};
  var maxTotal=valid.reduce(function(m,v){return Math.max(m,v.result.totalCount);},0)||40;

  var vMap={}, siMap={};
  var top10seed = valid.slice().sort(function(a,b){return b.result.totalCount-a.result.totalCount;}).slice(0,10);
  for(var si2=0; si2<top10seed.length; si2++){
    var sv = top10seed[si2];
    var sres = await Promise.all([
      FETCH.fetchVelocity(sv.kw, period),
      FETCH.fetchShoppingInsight(sv.kw, period)
    ]);
    vMap[sv.kw]  = sres[0];
    siMap[sv.kw] = sres[1];
    if(si2 < top10seed.length-1) await new Promise(function(r){setTimeout(r,200);});
  }

  var candidates=valid.map(function(v){
    return buildCandidate(v.kw, v.result, maxTotal, v.intent, vMap[v.kw]||null, siMap[v.kw]||null);
  });
  candidates.sort(function(a,b){return b.score.totalScore-a.score.totalScore;});
  return {candidates:candidates.slice(0,50), apiStatus:{search:valid.length+'/'+unique.length+' 성공'}};
}

module.exports=async function(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();
  try{checkEnv();}catch(e){return res.status(500).json({error:e.message});}
  var mode=req.query.mode||'category', period=req.query.period||'week';
  try{
    if(mode==='category'){
      var catId=req.query.categoryId||'50000003';
      if(catId==='all'){
        var cached=getCacheAll(period);
        if(cached){cached.fromCache=true;cached.cacheAge=Math.round((Date.now()-CACHE_ALL[period].ts)/1000)+'초 전';return res.status(200).json(cached);}
        var ar=await discoverAll();
        var result={candidates:ar.candidates, clusters:ANALYZE.clusterCandidates(ar.candidates), mode:mode, categoryId:'all', categoryName:'전체', period:period, total:ar.candidates.length, apiStatus:ar.apiStatus, processLog:ar.processLog, updatedAt:new Date().toISOString(), fromCache:false};
        setCacheAll(period, result);
        return res.status(200).json(result);
      }
      var cachedCat=getCacheCat(catId,period);
      if(cachedCat){cachedCat.fromCache=true;cachedCat.cacheAge=Math.round((Date.now()-CACHE_CAT[catId+'_'+period].ts)/1000)+'초 전';return res.status(200).json(cachedCat);}
      var cr=await discoverCategory(catId, period);
      var catResult={candidates:cr.candidates, clusters:ANALYZE.clusterCandidates(cr.candidates), mode:mode, categoryId:catId, categoryName:CFG.CAT_NAMES[catId]||catId, period:period, total:cr.candidates.length, apiStatus:cr.apiStatus, updatedAt:new Date().toISOString(), fromCache:false};
      setCacheCat(catId, period, catResult);
      return res.status(200).json(catResult);
    }
    if(mode==='seed'){
      var seedKw=String(req.query.keyword||'').trim().slice(0,30);
      if(!seedKw) return res.status(400).json({error:'키워드를 입력해주세요'});
      // ★ period 전달
      var sr=await discoverSeed(seedKw, period);
      return res.status(200).json({candidates:sr.candidates, clusters:ANALYZE.clusterCandidates(sr.candidates), mode:mode, seedKeyword:seedKw, period:period, total:sr.candidates.length, apiStatus:sr.apiStatus, updatedAt:new Date().toISOString()});
    }
    return res.status(400).json({error:'알 수 없는 mode'});
  }catch(e){
    console.error('[auto-discover]',e.message);
    return res.status(500).json({error:'탐색 중 오류가 발생했습니다.', detail:e.message});
  }
};
