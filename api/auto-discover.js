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
function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }

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

// ════════════════════════════════════════════════════════════
// 교차검증
// ════════════════════════════════════════════════════════════
function countVerifiedSources(c, naverResult, velocity){
  var signals=[];
  if(naverResult&&naverResult.totalCount>=100)              signals.push('naver_shop');
  if(velocity&&velocity.surgeRate>=10)                      signals.push('naver_search');
  if(c.shoppingInsight&&c.shoppingInsight.clickSurge>=10)  signals.push('naver_insight');
  if((c.cafeCount||0)>=50)                                  signals.push('naver_cafe');
  if((c._ytScore||0)>=20)                                   signals.push('youtube');
  if((c.coupangRankChange||0)>=5)                           signals.push('coupang');
  if((c._snsScore||0)>=20)                                  signals.push('sns');
  if(c.hasOverseas)                                         signals.push('overseas');
  (c.groqSignals||[]).forEach(function(s){if(signals.indexOf(s)<0) signals.push(s);});
  return signals;
}
function checkMinDemand(c, naverResult){
  var r=[];
  if(!naverResult||naverResult.totalCount<50)              r.push('쇼핑결과부족('+((naverResult&&naverResult.totalCount)||0)+')');
  if((c.blogCount||0)===0&&(c.cafeCount||0)===0)           r.push('블로그·카페없음');
  if(c.velocity&&c.velocity.surgeRate<-20)                 r.push('검색량하락('+c.velocity.surgeRate+'%)');
  return r;
}
function assignVerifyGrade(vs, fails){
  if(fails.length>0) return {grade:'UNVERIFIED',emoji:'⚠️',label:'검증미달',color:'#94a3b8',failReasons:fails};
  if(vs.length>=3&&vs.indexOf('naver_search')>-1) return {grade:'VERIFIED',emoji:'✅',label:'검증완료',color:'#10b981',failReasons:[]};
  if(vs.length>=2) return {grade:'LIKELY',emoji:'🟡',label:'가능성있음',color:'#f59e0b',failReasons:[]};
  return {grade:'UNVERIFIED',emoji:'⚠️',label:'단일소스',color:'#94a3b8',failReasons:[]};
}
function crossVerify(c, naverResult, velocity){
  var vs=countVerifiedSources(c, naverResult, velocity);
  var fails=checkMinDemand(c, naverResult);
  var grade=assignVerifyGrade(vs, fails);
  c.verify={grade:grade.grade,emoji:grade.emoji,label:grade.label,color:grade.color,sourceCount:vs.length,verifiedSources:vs,failReasons:grade.failReasons};
  if(grade.grade==='VERIFIED')        c.score.totalScore=Math.min(100,c.score.totalScore+15);
  else if(grade.grade==='UNVERIFIED') c.score.totalScore=Math.max(0,  c.score.totalScore-20);
  return c;
}
function sortByVerify(list){
  var order={VERIFIED:0,LIKELY:1,UNVERIFIED:2};
  return list.sort(function(a,b){
    var ga=order[(a.verify&&a.verify.grade)||'UNVERIFIED'];
    var gb=order[(b.verify&&b.verify.grade)||'UNVERIFIED'];
    if(ga!==gb) return ga-gb;
    return b.score.totalScore-a.score.totalScore;
  });
}

// ── 헬퍼 ─────────────────────────────────────────────────────
function ytMatchScore(name,ytItems){
  if(!ytItems||!ytItems.length||!name) return 0;
  var tokens=name.split(/[\s\/\-]+/).filter(function(t){return t.length>=2;});
  if(!tokens.length) tokens=[name.slice(0,4)];
  var cnt=0;
  ytItems.forEach(function(v){
    var t=(v.title||'').toLowerCase();
    if(tokens.some(function(tk){return t.indexOf(tk.toLowerCase())>-1;})) cnt++;
  });
  return Math.min(cnt/5*100,100);
}
function snsMatchScore(name,tiktok,instagram){
  if(!name) return 0;
  var tokens=name.split(/[\s\/\-]+/).filter(function(t){return t.length>=2;});
  var tt=(tiktok||[]).filter(function(h){return tokens.some(function(t){return h.tag.indexOf(t)>-1||t.indexOf(h.tag)>-1;});}).length;
  var ig=(instagram||[]).filter(function(h){return tokens.some(function(t){return h.tag.indexOf(t)>-1||t.indexOf(h.tag)>-1;});}).length;
  return Math.min(tt*20+ig*15,100);
}
async function buildKeywordPool(catId){
  var fallback=CFG.CAT_SEEDS[catId]||CFG.CAT_SEEDS['50000003'];
  var dynamic=await FETCH.fetchCategoryTopKeywords(catId,fallback.slice(0,5));
  var pool=dynamic.slice();
  fallback.forEach(function(kw){if(pool.indexOf(kw)<0) pool.push(kw);});
  return {keywords:pool.slice(0,30),dynamicCount:dynamic.length};
}

// ════════════════════════════════════════════════════════════
// 카테고리 탐색
// ════════════════════════════════════════════════════════════
async function discoverCategory(catId, period){
  // STAGE1: 키워드 풀
  var pool=await buildKeywordPool(catId);
  var kws=pool.keywords;

  // STAGE2: 쇼핑 검색
  var valid=await FETCH.batchShopSearch(kws);
  var withItems=valid.filter(function(v){return v.result.items.length>0;});
  if(!withItems.length) return {candidates:[],apiStatus:{search:'결과없음'}};
  var maxTotal=withItems.reduce(function(m,v){return Math.max(m,v.result.totalCount);},0)||40;
  var top10=withItems.slice(0,20).sort(function(a,b){return b.result.totalCount-a.result.totalCount;}).slice(0,10);
  await sleep(300);

  // STAGE3: velocity + insight 순차
  var vMap={},siMap={};
  for(var vi=0;vi<top10.length;vi++){
    try{
      vMap[top10[vi].kw]=await FETCH.fetchVelocity(top10[vi].kw,period);
      await sleep(250);
      siMap[top10[vi].kw]=await FETCH.fetchShoppingInsight(top10[vi].kw,period);
      await sleep(250);
    }catch(e){console.error('[cat-v]',top10[vi].kw,e.message);}
  }
  await sleep(500);

  // STAGE4: 블로그·카페·뉴스 배치
  var top10kws=top10.map(function(v){return v.kw;});
  var naverCounts=await NAVER_EXT.fetchNaverCountsBatch(top10kws);
  var ncMap={};
  top10kws.forEach(function(kw,i){ncMap[kw]=naverCounts[i]||{blogCount:0,cafeCount:0,newsCount:0};});

  // STAGE5: 교차검증
  var candidates=withItems.map(function(v){
    var c=buildCandidate(v.kw,v.result,maxTotal,null,vMap[v.kw]||null,siMap[v.kw]||null);
    var nc=ncMap[v.kw]||{blogCount:0,cafeCount:0,newsCount:0};
    c.blogCount=nc.blogCount; c.cafeCount=nc.cafeCount; c.newsCount=nc.newsCount;
    c._ytScore=0; c._snsScore=0; c.groqSignals=[]; c.hasOverseas=false; c.coupangRankChange=0;
    crossVerify(c,v.result,vMap[v.kw]||null);
    delete c._ytScore; delete c._snsScore;
    return c;
  }).filter(function(c){return c.score.totalScore>0;});
  sortByVerify(candidates);

  var verified=candidates.filter(function(c){return c.verify&&c.verify.grade==='VERIFIED';}).length;
  var likely  =candidates.filter(function(c){return c.verify&&c.verify.grade==='LIKELY';}).length;
  return {
    candidates:candidates.slice(0,10),
    apiStatus:{search:withItems.length+'/'+kws.length+' 성공',dynamic:pool.dynamicCount+'개 실시간',verified:'✅'+verified+'/🟡'+likely+'/⚠️'+(candidates.length-verified-likely)}
  };
}

// ════════════════════════════════════════════════════════════
// 전체 카테고리 탐색
// ════════════════════════════════════════════════════════════
async function discoverAll(period){
  var tasks=[];
  var poolResults=await Promise.allSettled(CFG.CAT_ORDER.map(function(catId){return buildKeywordPool(catId);}));
  CFG.CAT_ORDER.forEach(function(catId,idx){
    var pool=poolResults[idx].status==='fulfilled'?poolResults[idx].value:{keywords:(CFG.CAT_SEEDS[catId]||[]).slice(0,3),dynamicCount:0};
    pool.keywords.slice(0,5).forEach(function(kw){tasks.push({catId:catId,kw:kw});});
  });
  await sleep(300);
  var BATCH=10,pool=[],completed=[],failed=[];
  for(var i=0;i<tasks.length;i+=BATCH){
    var chunk=tasks.slice(i,i+BATCH);
    var settled=await Promise.allSettled(chunk.map(function(t){return FETCH.shopSearch(t.kw,null);}));
    settled.forEach(function(r,j){
      var t=chunk[j],result=r.status==='fulfilled'?r.value:{items:[],totalCount:0};
      if(result.items.length>0){
        pool.push({catId:t.catId,kw:t.kw,result:result});
        if(completed.indexOf(CFG.CAT_NAMES[t.catId]||t.catId)<0) completed.push(CFG.CAT_NAMES[t.catId]||t.catId);
      }else{
        if(failed.indexOf(CFG.CAT_NAMES[t.catId]||t.catId)<0) failed.push(CFG.CAT_NAMES[t.catId]||t.catId);
      }
    });
    if(i+BATCH<tasks.length) await sleep(300);
  }
  if(!pool.length) return {candidates:[],apiStatus:{completed:'0',failed:'전체실패'},processLog:{completed:[],failed:[]}};
  await sleep(500);
  var maxTotal=pool.reduce(function(m,v){return Math.max(m,v.result.totalCount);},0)||40;
  var vMap={},siMap={};
  var top10pool=pool.slice().sort(function(a,b){return b.result.totalCount-a.result.totalCount;}).slice(0,10);
  for(var pi=0;pi<top10pool.length;pi++){
    try{
      vMap[top10pool[pi].kw]=await FETCH.fetchVelocity(top10pool[pi].kw,period);
      await sleep(250);
      siMap[top10pool[pi].kw]=await FETCH.fetchShoppingInsight(top10pool[pi].kw,period);
      await sleep(250);
    }catch(e){console.error('[all-v]',top10pool[pi].kw,e.message);}
  }
  await sleep(500);
  var top10kws2=top10pool.map(function(v){return v.kw;});
  var nc10=await NAVER_EXT.fetchNaverCountsBatch(top10kws2);
  var ncMap2={};
  top10kws2.forEach(function(kw,i){ncMap2[kw]=nc10[i]||{blogCount:0,cafeCount:0,newsCount:0};});
  var candidates=pool.map(function(v){
    var c=buildCandidate(v.kw,v.result,maxTotal,null,vMap[v.kw]||null,siMap[v.kw]||null);
    c.category=CFG.CAT_NAMES[v.catId]||v.catId;
    var nc=ncMap2[v.kw]||{blogCount:0,cafeCount:0,newsCount:0};
    c.blogCount=nc.blogCount; c.cafeCount=nc.cafeCount; c.newsCount=nc.newsCount;
    c._ytScore=0; c._snsScore=0; c.groqSignals=[]; c.hasOverseas=false; c.coupangRankChange=0;
    crossVerify(c,v.result,vMap[v.kw]||null);
    delete c._ytScore; delete c._snsScore;
    return c;
  });
  sortByVerify(candidates);
  return {
    candidates:candidates.slice(0,10),
    apiStatus:{completed:completed.length+'/'+CFG.CAT_ORDER.length+' 카테고리',failed:failed.length?failed.join(', '):'없음'},
    processLog:{completed:completed,failed:failed}
  };
}

// ════════════════════════════════════════════════════════════
// 시드 키워드 탐색
// ════════════════════════════════════════════════════════════
async function discoverSeed(seedKw, period){
  var STOP=new Set(['이','가','을','를','의','에','는','은','도','와','과','세트','상품','제품','판매']);
  var list=ANALYZE.expandIntentKeywords(seedKw);
  var r1=await FETCH.shopSearch(seedKw,null).catch(function(){return {items:[],totalCount:0};});
  var freq={};
  (r1.items||[]).forEach(function(i){
    FETCH.cleanText(i.title||'').split(/\s+/).filter(function(w){return w.length>1&&!STOP.has(w)&&w!==seedKw;}).forEach(function(w){freq[w]=(freq[w]||0)+1;});
  });
  Object.entries(freq).sort(function(a,b){return b[1]-a[1];}).slice(0,3).forEach(function(e){list.push({kw:e[0],intent:'none'});});
  var seen={},unique=[];
  list.forEach(function(item){if(!seen[item.kw]){seen[item.kw]=true;unique.push(item);}});
  unique=unique.slice(0,12);
  await sleep(300);
  var res=await Promise.allSettled(unique.map(function(item){return FETCH.shopSearch(item.kw,null);}));
  var valid=[];
  for(var i=0;i<unique.length;i++){
    var r=res[i].status==='fulfilled'?res[i].value:{items:[],totalCount:0};
    if(r.items.length>0) valid.push({kw:unique[i].kw,intent:unique[i].intent,result:r});
  }
  if(!valid.length) return {candidates:[],apiStatus:{search:'결과없음'}};
  var maxTotal=valid.reduce(function(m,v){return Math.max(m,v.result.totalCount);},0)||40;
  await sleep(300);
  var vMap={},siMap={};
  var top10seed=valid.slice().sort(function(a,b){return b.result.totalCount-a.result.totalCount;}).slice(0,10);
  for(var si2=0;si2<top10seed.length;si2++){
    try{
      vMap[top10seed[si2].kw]=await FETCH.fetchVelocity(top10seed[si2].kw,period);
      await sleep(250);
      siMap[top10seed[si2].kw]=await FETCH.fetchShoppingInsight(top10seed[si2].kw,period);
      await sleep(250);
    }catch(e){console.error('[seed-v]',top10seed[si2].kw,e.message);}
  }
  await sleep(500);
  var seedKws=valid.map(function(v){return v.kw;});
  var seedNc=await NAVER_EXT.fetchNaverCountsBatch(seedKws);
  var seedNcMap={};
  seedKws.forEach(function(kw,i){seedNcMap[kw]=seedNc[i]||{blogCount:0,cafeCount:0,newsCount:0};});
  var candidates=valid.map(function(v){
    var c=buildCandidate(v.kw,v.result,maxTotal,v.intent,vMap[v.kw]||null,siMap[v.kw]||null);
    var nc=seedNcMap[v.kw]||{blogCount:0,cafeCount:0,newsCount:0};
    c.blogCount=nc.blogCount; c.cafeCount=nc.cafeCount; c.newsCount=nc.newsCount;
    c._ytScore=0; c._snsScore=0; c.groqSignals=[]; c.hasOverseas=false; c.coupangRankChange=0;
    crossVerify(c,v.result,vMap[v.kw]||null);
    delete c._ytScore; delete c._snsScore;
    return c;
  });
  sortByVerify(candidates);
  return {candidates:candidates.slice(0,10),apiStatus:{search:valid.length+'/'+unique.length+' 성공'}};
}

// ════════════════════════════════════════════════════════════
// 멀티소스 블루오션 탐색 — 체크포인트 완화
// ════════════════════════════════════════════════════════════
async function discoverMulti(period){
  var apiStatus={};
  var pipeLog=[];
  function log(stage,ok,detail){
    var msg='['+stage+'] '+(ok?'✅':'⚠️')+' '+(detail||'');
    pipeLog.push(msg);
    console.log('[multi]',msg);
  }

  // ── STAGE1: 외부 소스 병렬 수집 ─────────────────────────
  // ★ 어떤 API가 실패해도 계속 진행
  var fetched=await Promise.allSettled([
    MULTI.fetchYoutubeTrending(),
    MULTI.fetchYoutubeShorts(),
    MULTI.fetchCoupangBest(),
    MULTI.fetchGoogleKorea(),
    MULTI.fetchGoogleOverseas(),
    MULTI.fetchTikTokTrends(),
    MULTI.fetchInstagramTrends()
  ]);
  var youtube   =fetched[0].status==='fulfilled'?fetched[0].value:[];
  var shorts    =fetched[1].status==='fulfilled'?fetched[1].value:[];
  var coupang   =fetched[2].status==='fulfilled'?fetched[2].value:[];
  var googleKr  =fetched[3].status==='fulfilled'?fetched[3].value:[];
  var googleOs  =fetched[4].status==='fulfilled'?fetched[4].value:[];
  var tiktok    =fetched[5].status==='fulfilled'?fetched[5].value:[];
  var instagram =fetched[6].status==='fulfilled'?fetched[6].value:[];
  var allYt=youtube.concat(shorts);

  apiStatus.youtube=allYt.length+'개';
  apiStatus.coupang=coupang.length+'개';
  apiStatus.tiktok=tiktok.length+'개';
  apiStatus.instagram=instagram.length+'개';
  apiStatus.google=(googleKr.length+googleOs.length)+'개';

  var sourceCount=[allYt.length,coupang.length,tiktok.length+instagram.length,googleKr.length+googleOs.length].filter(function(n){return n>0;}).length;
  log('STAGE1', sourceCount>0, sourceCount+'개 소스 확보');

  // ★ 소스가 하나도 없을 때만 중단 (기존 2개→1개로 완화)
  if(sourceCount===0){
    return {candidates:[],apiStatus:Object.assign(apiStatus,{error:'외부 소스 수집 실패'}),pipeLog:pipeLog};
  }
  await sleep(200);

  // ── STAGE2: GROQ 제품 추출 ───────────────────────────────
  var extracted=await GROQ.extractTrendingProducts({
    youtube:youtube,shorts:shorts,coupang:coupang,
    tiktok:tiktok,instagram:instagram,
    googleKr:googleKr,googleOs:googleOs,naver:[]
  }).catch(function(e){ console.error('[groq]',e.message); return []; });

  log('STAGE2', extracted.length>0, extracted.length+'개 추출');

  // ★ GROQ 실패 시 폴백 순서: 쿠팡 → Google 텍스트 파싱 → 네이버 CAT_SEEDS
  if(extracted.length===0){
    if(coupang.length>0){
      log('STAGE2-FALLBACK', true, '쿠팡 베스트로 대체');
      extracted=coupang.slice(0,10).map(function(p){
        return {name:p.name,score:50,signals:['coupang'],reason:'쿠팡 베스트셀러',blogAngle:'',peakHours:72,hasOverseas:false};
      });
    } else if(googleKr.length>0||googleOs.length>0){
      // Google 텍스트에서 명사 추출
      log('STAGE2-FALLBACK', true, 'Google 텍스트로 대체');
      var gTexts=(googleKr.concat(googleOs)).map(function(g){return g.title+' '+g.snippet;}).join(' ');
      var gFreq={};
      gTexts.split(/[\s,·\-\|]+/).forEach(function(w){
        w=w.replace(/[^가-힣a-zA-Z0-9]/g,'').trim();
        if(w.length>=2&&w.length<=10&&/[가-힣]/.test(w)) gFreq[w]=(gFreq[w]||0)+1;
      });
      var gKws=Object.keys(gFreq).sort(function(a,b){return gFreq[b]-gFreq[a];}).slice(0,10);
      extracted=gKws.map(function(kw){
        return {name:kw,score:40,signals:['google'],reason:'구글 트렌드 감지',blogAngle:'',peakHours:72,hasOverseas:true};
      });
    } else {
      // 최후 폴백: 네이버 CAT_SEEDS 상위 키워드
      log('STAGE2-FALLBACK', true, 'CAT_SEEDS 폴백');
      var fallbackKws=[];
      CFG.CAT_ORDER.slice(0,5).forEach(function(catId){
        (CFG.CAT_SEEDS[catId]||[]).slice(0,2).forEach(function(kw){ fallbackKws.push(kw); });
      });
      extracted=fallbackKws.slice(0,10).map(function(kw){
        return {name:kw,score:30,signals:['naver'],reason:'네이버 카테고리 시드',blogAngle:'',peakHours:72,hasOverseas:false};
      });
    }
  }
  apiStatus.groq=extracted.length+'개 추출';
  await sleep(300);

  // ── STAGE3: 네이버 쇼핑 검증 (병렬) ─────────────────────
  var naverResults=await Promise.allSettled(
    extracted.map(function(e){return FETCH.shopSearch(e.name,null);})
  );
  var shopCount=naverResults.filter(function(r){return r.status==='fulfilled'&&r.value.items.length>0;}).length;
  log('STAGE3', shopCount>0, shopCount+'/'+extracted.length+' 상품확인');

  // ★ 1개 이상이면 계속 (기존 3개→1개로 완화)
  if(shopCount===0){
    return {candidates:[],apiStatus:Object.assign(apiStatus,{error:'네이버 쇼핑 검증 전체 실패'}),pipeLog:pipeLog};
  }
  apiStatus['쇼핑검증']=shopCount+'/'+extracted.length;

  var maxTotal=0;
  naverResults.forEach(function(r){if(r.status==='fulfilled') maxTotal=Math.max(maxTotal,r.value.totalCount);});
  if(!maxTotal) maxTotal=40;
  await sleep(500);

  // ── STAGE4: 블로그·카페·뉴스 배치 순차 ──────────────────
  var kwList=extracted.map(function(e){return e.name;});
  var naverCounts=await NAVER_EXT.fetchNaverCountsBatch(kwList);
  log('STAGE4', true, '블로그/카페 수집완료');
  apiStatus['블로그/카페']=naverCounts.filter(function(nc){return nc.blogCount>0;}).length+'개';
  await sleep(500);

  // ── STAGE5: 후보 구성 ────────────────────────────────────
  var candidates=[];
  for(var i=0;i<extracted.length;i++){
    var e=extracted[i];
    var nr=naverResults[i].status==='fulfilled'?naverResults[i].value:{items:[],totalCount:0};
    var nc=naverCounts[i]||{blogCount:0,cafeCount:0,newsCount:0};
    if(!nr.items.length) continue;
    var c=buildCandidate(e.name,nr,maxTotal,null,null,null);
    c.groqScore=e.score||0; c.groqSignals=e.signals||[]; c.groqReason=e.reason||'';
    c.groqBlogAngle=e.blogAngle||''; c.groqPeakHours=e.peakHours||72; c.hasOverseas=e.hasOverseas||false;
    c.blogCount=nc.blogCount; c.cafeCount=nc.cafeCount; c.newsCount=nc.newsCount;
    c._ytScore=ytMatchScore(e.name,allYt);
    c._snsScore=snsMatchScore(e.name,tiktok,instagram);
    var cpItem=coupang.find(function(p){return p.name.indexOf(c.name.slice(0,4))>-1;});
    c.coupangRank=cpItem?cpItem.rank:null;
    c.coupangRankChange=cpItem?cpItem.rankChange:0;
    candidates.push(c);
  }
  log('STAGE5', candidates.length>0, candidates.length+'개 후보');

  if(!candidates.length){
    return {candidates:[],apiStatus:Object.assign(apiStatus,{error:'최종 후보 없음'}),pipeLog:pipeLog};
  }

  // ── STAGE6: velocity + insight 순차 ─────────────────────
  var top5=candidates.slice(0,5);
  for(var vi=0;vi<top5.length;vi++){
    var cv=top5[vi];
    try{
      cv.velocity=await FETCH.fetchVelocity(cv.name,period);
      await sleep(300);
      cv.shoppingInsight=await FETCH.fetchShoppingInsight(cv.name,period);
      await sleep(300);
      if(cv.velocity||cv.shoppingInsight){
        cv.velocityLabel=SCORE.velocityLabel(cv.velocity);
        var nr2=naverResults.find(function(r,j){return extracted[j]&&extracted[j].name===cv.name&&r.status==='fulfilled';});
        var res2=nr2?nr2.value:{items:cv.sampleItems||[],totalCount:cv.totalCount||0};
        var ns=SCORE.calcScore(res2,maxTotal,cv.velocity,cv.commercial,cv.shoppingInsight);
        cv.score=ns; cv.insightLabel=ns.insightLabel;
      }
    }catch(e2){console.error('[velocity]',cv.name,e2.message);}
  }
  log('STAGE6', true, 'velocity/insight 수집완료');

  // ── STAGE7: 교차검증 + 블루오션 ─────────────────────────
  candidates.forEach(function(c){
    var vel=c.velocity||{};
    var nr=naverResults.find(function(r,j){return extracted[j]&&extracted[j].name===c.name&&r.status==='fulfilled';});
    crossVerify(c, nr?nr.value:null, vel.surgeRate!==undefined?vel:null);

    c.blueOcean=BLUE.calcBlueOcean({
      searchSurge:vel.surgeRate||0, ytScore:c._ytScore||0,
      coupangSurge:c.coupangRankChange||0, snsScore:c._snsScore||0,
      hasOverseas:c.hasOverseas||false, blogCount:c.blogCount||0
    });
    c.phase=BLUE.detectPhase({
      searchSurge:vel.surgeRate||0, blogCount:c.blogCount||0,
      cafeCount:c.cafeCount||0, newsCount:c.newsCount||0,
      ytSurge:c._ytScore||0, snsSurge:c._snsScore||0
    });

    var groqBonus=c.verify&&c.verify.grade==='UNVERIFIED'?0:Math.round((c.groqScore||0)/100*15);
    c.score.totalScore=Math.min(100,c.score.totalScore+groqBonus);
    if(c.groqSignals&&c.groqSignals.length)
      c.sources=c.sources.concat(c.groqSignals.filter(function(s){return c.sources.indexOf(s)<0;}));

    var r=[];
    if(c.verify) r.push(c.verify.emoji+' '+c.verify.label+' ('+c.verify.sourceCount+'개 소스)');
    if(c.blueOcean.score>=5)      r.push('🔥 극강 블루오션 '+c.blueOcean.score);
    else if(c.blueOcean.score>=2) r.push('✅ 블루오션 '+c.blueOcean.score);
    if(c.phase) r.push(c.phase.emoji+' '+c.phase.phase);
    if(c.hasOverseas) r.push('🌍 해외 선행 신호');
    if(c.coupangRankChange>=10) r.push('🛒 쿠팡 '+c.coupangRankChange+'단계 급등');
    if(r.length) c.reason=r.join(' · ')+(c.groqReason?' — '+c.groqReason:'');
    if(c.groqBlogAngle) c.blogAngle=c.groqBlogAngle;
    if(c.groqPeakHours) c.peakHours=c.groqPeakHours;
    delete c._ytScore; delete c._snsScore;
  });

  // VERIFIED 우선 → 블루오션순 → 점수순
  candidates.sort(function(a,b){
    var order={VERIFIED:0,LIKELY:1,UNVERIFIED:2};
    var ga=order[(a.verify&&a.verify.grade)||'UNVERIFIED'];
    var gb=order[(b.verify&&b.verify.grade)||'UNVERIFIED'];
    if(ga!==gb) return ga-gb;
    var bo=(b.blueOcean&&b.blueOcean.score||0)-(a.blueOcean&&a.blueOcean.score||0);
    if(Math.abs(bo)>0.5) return bo;
    return b.score.totalScore-a.score.totalScore;
  });

  var verified=candidates.filter(function(c){return c.verify&&c.verify.grade==='VERIFIED';}).length;
  var likely  =candidates.filter(function(c){return c.verify&&c.verify.grade==='LIKELY';}).length;
  log('STAGE7', verified+likely>0, '✅'+verified+'/🟡'+likely+'/⚠️'+(candidates.length-verified-likely));

  apiStatus['검증결과']='✅'+verified+'/🟡'+likely+'/⚠️'+(candidates.length-verified-likely);
  apiStatus.pipeline=pipeLog.join(' | ');
  return {candidates:candidates.slice(0,10),apiStatus:apiStatus};
}

// ════════════════════════════════════════════════════════════
// 핸들러
// ════════════════════════════════════════════════════════════
module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();
  try{checkEnv();}catch(e){return res.status(500).json({error:e.message});}

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
    return res.status(500).json({error:'탐색 중 오류가 발생했습니다.',detail:e.message});
  }
};
