var CFG     = require('./_config');
var FETCH   = require('./_fetch');
var SCORE   = require('./_score');
var ANALYZE = require('./_analyze');

var TTL = 5*60*1000;

// ★ 캐시 — 전체(all) + 카테고리별 분리
var CACHE_ALL = {data:null, ts:0};
var CACHE_CAT = {}; // { catId: {data, ts} }

function getCacheAll(){ return CACHE_ALL.data&&(Date.now()-CACHE_ALL.ts<TTL)?CACHE_ALL.data:null; }
function setCacheAll(d){ CACHE_ALL.data=d; CACHE_ALL.ts=Date.now(); }
function getCacheCat(catId,period){ var k=catId+'_'+period; var c=CACHE_CAT[k]; return c&&c.data&&(Date.now()-c.ts<TTL)?c.data:null; }
function setCacheCat(catId,period,d){ var k=catId+'_'+period; CACHE_CAT[k]={data:d,ts:Date.now()}; }

function checkEnv(){
  var miss=[];
  if(!process.env.NAVER_CLIENT_ID)     miss.push('NAVER_CLIENT_ID');
  if(!process.env.NAVER_CLIENT_SECRET) miss.push('NAVER_CLIENT_SECRET');
  if(miss.length) throw new Error('환경변수 누락: '+miss.join(', '));
}

function buildCandidate(kw, result, maxTotal, intentOverride, velocity){
  var intent     = intentOverride||ANALYZE.detectIntent(kw);
  var commercial = SCORE.calcCommercialScore(kw, result, intent);
  var score      = SCORE.calcScore(result, maxTotal, velocity, commercial);
  var trend      = SCORE.judgeT(result.totalCount);
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
    reason:ANALYZE.buildReason(kw, score, trend, velocity, intent),
    score:score, trend:trend,
    summary:base.summary, action:action,
    sampleItems:samples
  };
}

async function discoverCategory(catId, period){
  var kws=CFG.CAT_SEEDS[catId]||CFG.CAT_SEEDS['50000003'];
  var res=await Promise.allSettled(kws.map(function(kw){return FETCH.shopSearch(kw,null);}));
  var valid=[];
  for(var i=0;i<kws.length;i++){
    var r=res[i].status==='fulfilled'?res[i].value:{items:[],totalCount:0};
    valid.push({kw:kws[i], result:r});
  }
  var withItems = valid.filter(function(v){return v.result.items.length>0;});
  var noItems   = valid.filter(function(v){return v.result.items.length===0;});
  valid = withItems.concat(noItems);

  if(!valid.length) return {candidates:[], apiStatus:{search:'결과 없음'}};

  // ★ maxTotal 고정 — 전체 결과 중 최댓값으로 고정해 점수 안정화
  var maxTotal=valid.reduce(function(m,v){return Math.max(m,v.result.totalCount);},0)||40;

  var vMap={};
  await Promise.allSettled(
    valid.slice(0,20).sort(function(a,b){return b.result.totalCount-a.result.totalCount;})
    .map(async function(v){vMap[v.kw]=await FETCH.fetchVelocity(v.kw, period);})
  );

  var candidates=valid.map(function(v){
    return buildCandidate(v.kw, v.result, maxTotal, null, vMap[v.kw]||null);
  }).filter(function(c){return c.score.totalScore>0;});
  candidates.sort(function(a,b){return b.score.totalScore-a.score.totalScore;});
  return {candidates:candidates.slice(0,30), apiStatus:{search:withItems.length+'/'+kws.length+' 성공'}};
}

async function discoverAll(){
  var res=await Promise.allSettled(CFG.CAT_ORDER.map(function(catId){
    var kw=(CFG.CAT_SEEDS[catId]||[])[0]||'';
    if(!kw) return Promise.resolve({catId:catId, kw:'', result:{items:[],totalCount:0}, ok:false});
    return FETCH.shopSearch(kw,catId)
      .then(function(r){return {catId:catId, kw:kw, result:r, ok:true};})
      .catch(function(){return {catId:catId, kw:kw, result:{items:[],totalCount:0}, ok:false};});
  }));
  var pool=[], completed=[], failed=[];
  res.forEach(function(r){
    if(r.status!=='fulfilled') return;
    var v=r.value;
    if(!v.ok||!v.result.items.length){failed.push(CFG.CAT_NAMES[v.catId]||v.catId);return;}
    pool.push(v); completed.push(CFG.CAT_NAMES[v.catId]||v.catId);
  });
  var maxTotal=pool.reduce(function(m,v){return Math.max(m,v.result.totalCount);},0)||40;
  var candidates=pool.map(function(v){
    var c=buildCandidate(v.kw, v.result, maxTotal, null, null);
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

async function discoverSeed(seedKw){
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
  var vMap={};
  await Promise.allSettled(
    valid.slice().sort(function(a,b){return b.result.totalCount-a.result.totalCount;}).slice(0,5)
    .map(async function(v){vMap[v.kw]=await FETCH.fetchVelocity(v.kw);})
  );
  var candidates=valid.map(function(v){return buildCandidate(v.kw, v.result, maxTotal, v.intent, vMap[v.kw]||null);});
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
        var cached=getCacheAll();
        if(cached){cached.fromCache=true;cached.cacheAge=Math.round((Date.now()-CACHE_ALL.ts)/1000)+'초 전';return res.status(200).json(cached);}
        var ar=await discoverAll();
        var result={candidates:ar.candidates, clusters:ANALYZE.clusterCandidates(ar.candidates), mode:mode, categoryId:'all', categoryName:'전체', period:period, total:ar.candidates.length, apiStatus:ar.apiStatus, processLog:ar.processLog, updatedAt:new Date().toISOString(), fromCache:false};
        setCacheAll(result);
        return res.status(200).json(result);
      }
      // ★ 카테고리별 캐시 적용
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
      var sr=await discoverSeed(seedKw);
      return res.status(200).json({candidates:sr.candidates, clusters:ANALYZE.clusterCandidates(sr.candidates), mode:mode, seedKeyword:seedKw, period:period, total:sr.candidates.length, apiStatus:sr.apiStatus, updatedAt:new Date().toISOString()});
    }
    return res.status(400).json({error:'알 수 없는 mode'});
  }catch(e){
    console.error('[auto-discover]',e.message);
    return res.status(500).json({error:'탐색 중 오류가 발생했습니다.', detail:e.message});
  }
};
