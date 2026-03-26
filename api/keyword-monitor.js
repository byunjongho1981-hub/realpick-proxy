// api/keyword-monitor.js
// 쇼핑인사이트 인기검색어 TOP 20 기반 키워드 수집 모니터링
// GET /api/keyword-monitor?catId=50000000&period=week

var https  = require('https');
var CFG    = require('./_trend-config');
var NAVER  = require('./_trend-naver');

function safeNum(v){ return isNaN(Number(v))?0:Number(v); }
function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }
function stripHtml(s){ return (s||'').replace(/<[^>]+>/g,''); }

module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS') return res.status(200).end();

  var catId   = (req.query&&req.query.catId) ||'50000000';
  var period  = (req.query&&req.query.period)||'week';
  var catIds  = [catId];
  var hasCookie = !!(process.env.NAVER_COOKIE&&process.env.NAVER_COOKIE.length>10);

  var log=[], startTime=Date.now();
  function addLog(step, msg, data){
    log.push({
      time: ((Date.now()-startTime)/1000).toFixed(1)+'s',
      step: step, msg: msg, data: data||null,
    });
    console.log('[monitor]',step,msg,data?JSON.stringify(data).slice(0,200):'');
  }

  var result={ catId, period, hasCookie, log, phases:{} };

  try{
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PHASE 1: 쇼핑인사이트 인기검색어 TOP 20
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    addLog('PHASE1', hasCookie?'쇼핑인사이트 내부API 호출':'쿠키 없음 — 쇼핑검색 폴백 사용');

    var top20=null, source='';

    if(hasCookie){
      // 1순위: 쇼핑인사이트 내부 API
      top20 = await fetchInsightTopDirect(catId, 20);
      if(top20&&top20.length){
        source='insight_api';
        addLog('PHASE1','✅ 쇼핑인사이트 TOP20 수집 성공',{
          count: top20.length,
          top10: top20.slice(0,10).map(function(k){return '#'+k.rank+' '+k.keyword;})
        });
      } else {
        addLog('PHASE1','⚠️ 쇼핑인사이트 API 실패 — 쇼핑검색 폴백');
      }
    }

    if(!top20||!top20.length){
      // 2순위: 쇼핑검색 빈도 분석
      addLog('PHASE1','쇼핑검색 200개 수집 시작',{query: CFG.CATEGORY_SEARCH_QUERY&&CFG.CATEGORY_SEARCH_QUERY[catId]});
      top20 = await fetchByShopSearch(catId);
      source = top20&&top20.length ? 'shop_search' : 'seeds';

      if(!top20||!top20.length){
        // 3순위: CATEGORY_SEEDS
        var seeds=(CFG.CATEGORY_SEEDS&&CFG.CATEGORY_SEEDS[catId])||[];
        top20=seeds.slice(0,20).map(function(kw,idx){return {keyword:kw,rank:idx+1};});
        source='seeds';
        addLog('PHASE1','⚠️ SEEDS 폴백 사용',{count:top20.length});
      } else {
        addLog('PHASE1','✅ 쇼핑검색 추출 완료',{
          source: source,
          count:  top20.length,
          top10:  top20.slice(0,10).map(function(k){return '#'+k.rank+' '+k.keyword;})
        });
      }
    }

    result.phases.phase1={ source, top20 };

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PHASE 2: 데이터랩 트렌드 점수 비교
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    var kwList=top20.map(function(k){return k.keyword;}).filter(Boolean);
    addLog('PHASE2','데이터랩 트렌드 비교 시작',{keywords:kwList.length+'개',batches:Math.ceil(kwList.length/5)+'회 호출'});

    var datalabScores={};
    try{
      datalabScores=await NAVER.compareKeywordsByDatalab
        ?await NAVER.compareKeywordsByDatalab(kwList,period)
        :{};
    }catch(e){ addLog('PHASE2','⚠️ 데이터랩 오류:'+e.message); }

    var ranked=kwList.slice().sort(function(a,b){return (datalabScores[b]||0)-(datalabScores[a]||0);});
    addLog('PHASE2','✅ 데이터랩 비교 완료',{
      top10: ranked.slice(0,10).map(function(kw){return kw+'('+(Math.round(datalabScores[kw]||0))+'점)';})
    });
    result.phases.phase2={ scores:datalabScores, ranked };

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PHASE 3: 쇼핑인사이트 클릭트렌드 점수화
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    var top5=ranked.slice(0,5);
    addLog('PHASE3','쇼핑인사이트 점수화 시작',{targets:top5});

    var insightResults=[];
    for(var j=0;j<top5.length;j++){
      var kw=top5[j];
      var insight=await NAVER.fetchNaverShoppingInsight(kw,catId,period);
      var insightScore=0;
      if(insight&&!insight._fallback){
        insightScore=Math.max(0,insight.clickSurge||0)+Math.max(0,insight.clickAccel||0);
        if(insight.shopTrend==='hot')         insightScore+=30;
        else if(insight.shopTrend==='rising') insightScore+=15;
        else if(insight.shopTrend==='stable') insightScore+=5;
      }
      var total=Math.round((datalabScores[kw]||0)+insightScore);
      insightResults.push({
        keyword:    kw,
        datalab:    Math.round(datalabScores[kw]||0),
        insight:    Math.round(insightScore),
        total:      total,
        shopTrend:  insight&&!insight._fallback?insight.shopTrend:'unknown',
        clickSurge: insight&&!insight._fallback?safeNum(insight.clickSurge):0,
        clickAccel: insight&&!insight._fallback?safeNum(insight.clickAccel):0,
      });
      addLog('PHASE3','인사이트 수집',{keyword:kw,trend:insight&&insight.shopTrend,clickSurge:insight&&insight.clickSurge,total:total});
      await sleep(150);
    }

    insightResults.sort(function(a,b){return b.total-a.total;});
    addLog('PHASE3','✅ 점수화 완료',{results:insightResults.map(function(r){return r.keyword+'('+r.total+'점/'+r.shopTrend+')';})});
    result.phases.phase3=insightResults;

    // 최종
    result.finalKeywords=insightResults;
    addLog('DONE','🏆 최종 선정 완료',{keywords:insightResults.map(function(r){return r.keyword;})});

  }catch(e){
    addLog('ERROR',e.message);
    result.error=e.message;
  }

  result.elapsed=((Date.now()-startTime)/1000).toFixed(1)+'s';
  return res.status(200).json(result);
};

// ── 쇼핑인사이트 내부 API ─────────────────────────────────────
function fetchInsightTopDirect(catId, count){
  return new Promise(function(resolve){
    try{
      var today=new Date(), monthAgo=new Date();
      monthAgo.setDate(today.getDate()-28);
      var fmt=function(d){var p=function(n){return String(n).padStart(2,'0');};return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());};
      var payload=JSON.stringify({cid:catId,timeUnit:'date',startDate:fmt(monthAgo),endDate:fmt(today),device:'',gender:'',age:'',count:count||20});
      var buf=Buffer.from(payload,'utf8');
      var done=false;
      var t=setTimeout(function(){if(!done){done=true;resolve(null);}},8000);
      var req=https.request({
        hostname:'datalab.naver.com',
        path:'/shoppingInsight/getCategoryKeywordRank.naver',
        method:'POST',
        headers:{
          'Content-Type':'application/json','Content-Length':buf.length,
          'Cookie':process.env.NAVER_COOKIE||'',
          'Referer':'https://datalab.naver.com/shoppingInsight/sCategory.naver',
          'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
          'Accept':'application/json, text/plain, */*','Accept-Language':'ko-KR,ko;q=0.9',
          'Origin':'https://datalab.naver.com','X-Requested-With':'XMLHttpRequest',
        }
      },function(res){
        var chunks=[];
        res.on('data',function(c){chunks.push(c);});
        res.on('end',function(){
          if(done)return; done=true; clearTimeout(t);
          var raw=Buffer.concat(chunks).toString('utf8');
          if(raw.trim().startsWith('<')){console.warn('[insightTop] HTML반환 — 쿠키 만료');resolve(null);return;}
          try{
            var d=JSON.parse(raw);
            var list=d.result&&d.result.keywordList||d.keywordList||(Array.isArray(d)?d:[]);
            if(!list.length){resolve(null);return;}
            resolve(list.map(function(item){return {keyword:item.keyword||item.name||'',rank:safeNum(item.rank||0)};}).filter(function(i){return i.keyword;}));
          }catch(e){resolve(null);}
        });
      });
      req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve(null);}});
      req.setTimeout(7000,function(){req.destroy();});
      req.write(buf); req.end();
    }catch(e){resolve(null);}
  });
}

// ── 쇼핑검색 빈도 분석 폴백 ──────────────────────────────────
async function fetchByShopSearch(catId){
  var query=(CFG.CATEGORY_SEARCH_QUERY&&CFG.CATEGORY_SEARCH_QUERY[catId])||'인기';
  var allItems=[];
  for(var page=0;page<2;page++){
    var res=await naverGetSimple('/v1/search/shop.json',{query:query,display:100,start:page*100+1,sort:'sim',exclude:'used:rental:cbshop'});
    if(res&&res.items) allItems=allItems.concat(res.items); else break;
    await sleep(150);
  }
  if(!allItems.length) return [];
  var stopWords=['추천','인기','최저가','무료배송','당일','판매','정품','할인','특가','세일','NEW','신상','베스트','세트','묶음'];
  var kwCount={};
  allItems.forEach(function(item){
    var text=[(item.category3||''),(item.category2||''),stripHtml(item.title||'')].join(' ').replace(/[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F a-zA-Z0-9]/g,' ').trim();
    var tokens=text.split(/\s+/).filter(function(t){return t.length>=2&&!/^[0-9]+$/.test(t)&&!stopWords.some(function(s){return t===s;});});
    tokens.forEach(function(t){kwCount[t]=(kwCount[t]||0)+1;});
    for(var i=0;i<tokens.length-1;i++){
      if(/[\uAC00-\uD7A3]/.test(tokens[i+1])){var pair=tokens[i]+' '+tokens[i+1];if(pair.length<=12)kwCount[pair]=(kwCount[pair]||0)+0.7;}
    }
  });
  return Object.keys(kwCount).filter(function(k){return kwCount[k]>=3;})
    .sort(function(a,b){return kwCount[b]-kwCount[a];}).slice(0,20)
    .map(function(kw,idx){return {keyword:kw,rank:idx+1};});
}

var https=require('https');
function safeNum(v){return isNaN(Number(v))?0:Number(v);}
function naverGetSimple(path,params){
  return new Promise(function(resolve){
    try{
      var qs=Object.keys(params).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);}).join('&');
      var done=false,t=setTimeout(function(){if(!done){done=true;resolve(null);}},6000);
      var req=https.request({hostname:'openapi.naver.com',path:path+'?'+qs,method:'GET',
        headers:{'X-Naver-Client-Id':process.env.NAVER_CLIENT_ID,'X-Naver-Client-Secret':process.env.NAVER_CLIENT_SECRET}
      },function(res){var raw='';res.on('data',function(c){raw+=c;});res.on('end',function(){if(done)return;done=true;clearTimeout(t);try{var d=JSON.parse(raw);if(d.errorCode){resolve(null);return;}resolve(d);}catch(e){resolve(null);}});});
      req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve(null);}});
      req.setTimeout(5500,function(){req.destroy();}); req.end();
    }catch(e){resolve(null);}
  });
}
