// api/keyword-monitor.js
// 카테고리별 키워드 수집 과정을 실시간 모니터링
// GET /api/keyword-monitor?catId=50000000&period=week

var CFG   = require('./_trend-config');
var NAVER = require('./_trend-naver');

function safeNum(v){ return isNaN(Number(v))?0:Number(v); }

module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS') return res.status(200).end();

  var catId  = (req.query&&req.query.catId) ||'50000000';
  var period = (req.query&&req.query.period)||'week';
  var catIds = catId==='all'
    ? Object.keys(CFG.NAVER_CAT_IDS||{'50000000':1})
    : [catId];

  var log=[], startTime=Date.now();
  function addLog(step, msg, data){
    var entry={
      time: ((Date.now()-startTime)/1000).toFixed(1)+'s',
      step: step,
      msg:  msg,
      data: data||null,
    };
    log.push(entry);
    console.log('[monitor]',step,msg, data?JSON.stringify(data).slice(0,200):'');
  }

  var result={
    catIds:   catIds,
    period:   period,
    log:      log,
    phases:   {},
  };

  try{
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PHASE 1: 쇼핑 검색 → 키워드 추출
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    addLog('PHASE1','쇼핑 검색 시작');
    var phase1={};

    for(var i=0;i<catIds.length;i++){
      var cid=catIds[i];
      var catName=Object.keys(CFG.NAVER_CAT_IDS||{}).find(function(k){return CFG.NAVER_CAT_IDS[k]===cid;})||cid;
      var query=(CFG.CATEGORY_SEARCH_QUERY&&CFG.CATEGORY_SEARCH_QUERY[cid])||'인기';

      addLog('PHASE1','쇼핑검색 호출',{catId:cid,catName:catName,query:query});

      // 쇼핑 검색 호출 (2회)
      var shopItems=[];
      for(var page=0;page<2;page++){
        var res2=await naverGetDirect('/v1/search/shop.json',{
          query:query,display:100,start:page*100+1,sort:'sim',exclude:'used:rental:cbshop'
        });
        if(res2&&res2.items){
          shopItems=shopItems.concat(res2.items);
          addLog('PHASE1','쇼핑검색 응답',{page:page+1,count:res2.items.length,sample:res2.items.slice(0,3).map(function(i){return {title:stripHtml(i.title),cat3:i.category3||'',price:i.lprice};})});
        } else {
          addLog('PHASE1','쇼핑검색 실패 — 폴백',{page:page+1});
          break;
        }
        await sleep(150);
      }

      // 빈도 분석
      var extracted=extractTopKeywords(shopItems);
      addLog('PHASE1','키워드 추출 완료',{total:shopItems.length,top20:extracted.slice(0,20)});
      phase1[cid]={catName:catName,shopCount:shopItems.length,extracted:extracted.slice(0,20)};
    }
    result.phases.phase1=phase1;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PHASE 2: 데이터랩 트렌드 비교
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    addLog('PHASE2','데이터랩 트렌드 비교 시작');
    var phase2={};

    for(var ci=0;ci<catIds.length;ci++){
      var cid2=catIds[ci];
      var kwList=(phase1[cid2]&&phase1[cid2].extracted)||[];
      if(!kwList.length){ phase2[cid2]={scores:{},ranked:[]}; continue; }

      addLog('PHASE2','데이터랩 비교',{catId:cid2,keywords:kwList});
      var scores=await NAVER.compareKeywordsByDatalab?
        await NAVER.compareKeywordsByDatalab(kwList,period):
        {};
      // 점수 순 정렬
      var ranked=kwList.slice().sort(function(a,b){return (scores[b]||0)-(scores[a]||0);});
      addLog('PHASE2','데이터랩 결과',{
        top10:ranked.slice(0,10).map(function(kw){return {keyword:kw,score:scores[kw]||0};})
      });
      phase2[cid2]={scores:scores,ranked:ranked,top5:ranked.slice(0,5)};
    }
    result.phases.phase2=phase2;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // PHASE 3: 쇼핑인사이트 점수화
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    addLog('PHASE3','쇼핑인사이트 점수화 시작');
    var phase3={};

    for(var pi=0;pi<catIds.length;pi++){
      var cid3=catIds[pi];
      var top5=(phase2[cid3]&&phase2[cid3].top5)||[];
      var insightResults=[];
      for(var ki=0;ki<top5.length;ki++){
        var kw=top5[ki];
        var insight=await NAVER.fetchNaverShoppingInsight(kw,cid3,period);
        var insightScore=0;
        if(insight&&!insight._fallback){
          insightScore=Math.max(0,insight.clickSurge||0)+Math.max(0,insight.clickAccel||0);
          if(insight.shopTrend==='hot')         insightScore+=30;
          else if(insight.shopTrend==='rising') insightScore+=15;
          else if(insight.shopTrend==='stable') insightScore+=5;
        }
        var totalScore=((phase2[cid3]&&phase2[cid3].scores&&phase2[cid3].scores[kw])||0)+insightScore;
        insightResults.push({
          keyword:    kw,
          datalab:    (phase2[cid3]&&phase2[cid3].scores&&phase2[cid3].scores[kw])||0,
          insight:    insightScore,
          total:      totalScore,
          shopTrend:  insight&&insight.shopTrend||'unknown',
          clickSurge: insight&&safeNum(insight.clickSurge)||0,
        });
        await sleep(150);
      }
      insightResults.sort(function(a,b){return b.total-a.total;});
      addLog('PHASE3','쇼핑인사이트 완료',{catId:cid3,results:insightResults});
      phase3[cid3]=insightResults;
    }
    result.phases.phase3=phase3;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 최종 선정 키워드
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    var finalKeywords=[];
    catIds.forEach(function(cid4){
      var items=phase3[cid4]||[];
      finalKeywords=finalKeywords.concat(items.slice(0,catIds.length===1?10:3));
    });
    finalKeywords.sort(function(a,b){return b.total-a.total;});
    result.finalKeywords=finalKeywords;
    addLog('DONE','최종 키워드 확정',{keywords:finalKeywords.map(function(k){return k.keyword+'('+k.total+'점)';})});

  }catch(e){
    addLog('ERROR',e.message);
    result.error=e.message;
  }

  result.elapsed=((Date.now()-startTime)/1000).toFixed(1)+'s';
  return res.status(200).json(result);
};

// ── 헬퍼 ─────────────────────────────────────────────────────
var https=require('https');
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function stripHtml(s){return (s||'').replace(/<[^>]+>/g,'');}

function naverGetDirect(path,params){
  return new Promise(function(resolve){
    try{
      var qs=Object.keys(params).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);}).join('&');
      var done=false;
      var t=setTimeout(function(){if(!done){done=true;resolve(null);}},6000);
      var req=https.request({
        hostname:'openapi.naver.com',path:path+'?'+qs,method:'GET',
        headers:{'X-Naver-Client-Id':process.env.NAVER_CLIENT_ID,'X-Naver-Client-Secret':process.env.NAVER_CLIENT_SECRET}
      },function(res){
        var raw='';
        res.on('data',function(c){raw+=c;});
        res.on('end',function(){
          if(done)return;done=true;clearTimeout(t);
          try{var d=JSON.parse(raw);if(d.errorCode){resolve(null);return;}resolve(d);}catch(e){resolve(null);}
        });
      });
      req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve(null);}});
      req.setTimeout(5500,function(){req.destroy();});
      req.end();
    }catch(e){resolve(null);}
  });
}

function extractTopKeywords(items){
  var stopWords=['추천','인기','최저가','무료배송','당일','판매','정품','할인',
    '특가','세일','NEW','신상','베스트','핫딜','A형','B형','S','M','L','XL',
    '1개','2개','세트','묶음','공식'];
  var kwCount={};
  items.forEach(function(item){
    var parts=[];
    if(item.category3) parts.push(item.category3);
    if(item.category2) parts.push(item.category2);
    parts.push(stripHtml(item.title||''));
    var text=parts.join(' ').replace(/<[^>]+>/g,'')
      .replace(/[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F a-zA-Z0-9]/g,' ').trim();
    var tokens=text.split(/\s+/).filter(function(t){
      return t.length>=2&&!/^[0-9]+$/.test(t)&&!/^[A-Z0-9]{1,3}$/.test(t)
        &&!stopWords.some(function(s){return t===s;});
    });
    tokens.forEach(function(t){kwCount[t]=(kwCount[t]||0)+1;});
    for(var i=0;i<tokens.length-1;i++){
      if(/[\uAC00-\uD7A3]/.test(tokens[i+1])){
        var pair=tokens[i]+' '+tokens[i+1];
        if(pair.length<=12) kwCount[pair]=(kwCount[pair]||0)+0.7;
      }
    }
  });
  return Object.keys(kwCount).filter(function(k){return kwCount[k]>=3;})
    .sort(function(a,b){return kwCount[b]-kwCount[a];}).slice(0,20);
}
