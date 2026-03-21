var CFG     = require('./_config');
var FETCH   = require('./_fetch');
var SCORE   = require('./_score');
var ANALYZE = require('./_analyze');

var CACHE = {data:null, ts:0, TTL:5*60*1000};
function getCache(){ return CACHE.data&&(Date.now()-CACHE.ts<CACHE.TTL)?CACHE.data:null; }
function setCache(d){ CACHE.data=d; CACHE.ts=Date.now(); }

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

async function discoverCategory(catId){
  var kws=CFG.CAT_SEEDS[catId]||CFG.CAT_SEEDS['50000003'];
  var res=await Promise.allSettled(kws.map(function(kw){return FETCH.shopSearch(kw,catId);}));
  var valid=[];
  for(var i=0;i<kws.length;i++){
    var r=res[i].status==='fulfilled'?res[i].value:{items:[],totalCount:0};
    // 결과 없어도 포함 (items 0개여도 totalCount 있으면 포함)
    valid.push({kw:kws[i], result:r});
  }
  // items 있는 것 우선, 없는 것도 포함
  var withItems  = valid.filter(function(v){return v.result.items.length>0;});
  var noItems    = valid.filter(function(v){return v.result.items.length===0;});
  valid = withItems.concat(noItems);

  if(!valid.length) return {candidates:[], apiStatus:{search:'결과 없음'}};
  var maxTotal=valid.reduce(function(m,v){return Math.max(m,v.result.totalCount);},0)||40;

  // 상위 10개 velocity 조회
  var vMap={};
  await Promise.allSettled(
    valid.slice(0,10).sort(function(a,b){return b.result.totalCount-a.result.totalCount;})
    .map(async function(v){vMap[v.kw]=await FETCH.fetchVelocity(v.kw);})
  );

  var candidates=valid.map(function(v){
    return buildCandidate(v.kw, v.result, maxTotal, null, vMap[v.kw]||null);
  });
  candidates.sort(function(a,b){return b.score.totalScore-a.score.totalScore;});
  return {candidates:candidates.slice(0,50), apiStatus:{search:withItems.length+'/'+kws.length+' 성공'}};
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
        var cached=getCache();
        if(cached){cached.fromCache=true;cached.cacheAge=Math.round((Date.now()-CACHE.ts)/1000)+'초 전';return res.status(200).json(cached);}
        var ar=await discoverAll();
        var result={candidates:ar.candidates, clusters:ANALYZE.clusterCandidates(ar.candidates), mode:mode, categoryId:'all', categoryName:'전체', period:period, total:ar.candidates.length, apiStatus:ar.apiStatus, processLog:ar.processLog, updatedAt:new Date().toISOString(), fromCache:false};
        setCache(result);
        return res.status(200).json(result);
      }
      var cr=await discoverCategory(catId);
      return res.status(200).json({candidates:cr.candidates, clusters:ANALYZE.clusterCandidates(cr.candidates), mode:mode, categoryId:catId, categoryName:CFG.CAT_NAMES[catId]||catId, period:period, total:cr.candidates.length, apiStatus:cr.apiStatus, updatedAt:new Date().toISOString()});
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
