// ═══════════════════════════════════════════════════════════
// api/naver-insight-top.js — 쇼핑인사이트 인기검색어 TOP 20
// ═══════════════════════════════════════════════════════════
var https = require('https');

function safeNum(v){return isNaN(Number(v))?0:Number(v);}

function fetchInsightTop(catId, count){
  count = count || 20;
  return new Promise(function(resolve){
    try{
      var today   = new Date();
      var weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate()-28);
      var fmt = function(d){
        var p=function(n){return String(n).padStart(2,'0');};
        return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
      };

      // ★ form-urlencoded 방식으로 변경 (브라우저 실제 요청 방식)
      var params=[
        'cid='+encodeURIComponent(catId),
        'timeUnit=date',
        'startDate='+encodeURIComponent(fmt(weekAgo)),
        'endDate='+encodeURIComponent(fmt(today)),
        'device=',
        'gender=',
        'age=',
        'count='+count,
      ].join('&');
      var buf  = Buffer.from(params,'utf8');
      var done = false;
      var t    = setTimeout(function(){
        if(!done){done=true;resolve({status:'timeout',raw:''});}
      },8000);

      var cookie = process.env.NAVER_COOKIE||'';
      var req = https.request({
        hostname: 'datalab.naver.com',
        path:     '/shoppingInsight/getCategoryKeywordRank.naver',
        method:   'POST',
        headers:{
          'Content-Type':   'application/x-www-form-urlencoded; charset=UTF-8',
          'Content-Length': buf.length,
          'Cookie':         cookie,
          'Referer':        'https://datalab.naver.com/shoppingInsight/sCategory.naver',
          'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
          'Accept':         'application/json, text/plain, */*',
          'Accept-Language':'ko-KR,ko;q=0.9',
          'Origin':         'https://datalab.naver.com',
          'X-Requested-With':'XMLHttpRequest',
        }
      },function(res){
        var raw='';
        res.on('data',function(c){raw+=c;});
        res.on('end',function(){
          if(done)return; done=true; clearTimeout(t);
          resolve({status:res.statusCode, raw:raw.slice(0,500)});
        });
      });
      req.on('error',function(e){
        if(!done){done=true;clearTimeout(t);resolve({status:'error',raw:e.message});}
      });
      req.setTimeout(7000,function(){req.destroy();});
      req.write(buf); req.end();
    }catch(e){
      resolve({status:'exception',raw:e.message});
    }
  });
}

module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS') return res.status(200).end();

  var catId  = (req.query&&req.query.catId)||'50000000';
  var cookie = process.env.NAVER_COOKIE||'';

  // 진단 정보
  var debug = {
    cookie_set:   !!cookie,
    cookie_length: cookie.length,
    cookie_preview: cookie.slice(0,30)+'...',
    catId: catId,
  };

  if(!cookie){
    return res.status(200).json({error:'NAVER_COOKIE 미설정', debug});
  }

  var result = await fetchInsightTop(catId, 20);

  // raw 응답 그대로 반환 — 디버그용
  return res.status(200).json({
    debug,
    httpStatus: result.status,
    rawPreview: result.raw,
    isHtml:     result.raw.trim().startsWith('<'),
    isJson:     result.raw.trim().startsWith('{') || result.raw.trim().startsWith('['),
  });
};

module.exports.fetchInsightTop = fetchInsightTop;
// ═══════════════════════════════════════════════════════════
// api/naver-insight-top.js — 쇼핑인사이트 인기검색어 TOP 20
// 환경변수 NAVER_COOKIE 필요
// ═══════════════════════════════════════════════════════════
var https = require('https');

function fetchInsightTop(catId, count){
  count = count || 20;
  return new Promise(function(resolve){
    try{
      var today   = new Date();
      var weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate()-28);
      var fmt = function(d){
        var p=function(n){return String(n).padStart(2,'0');};
        return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
      };
      var payload = JSON.stringify({
        cid:       catId,
        timeUnit:  'date',
        startDate: fmt(weekAgo),
        endDate:   fmt(today),
        device:    '',
        gender:    '',
        age:       '',
        count:     count,
      });
      var buf  = Buffer.from(payload,'utf8');
      var done = false;
      var t    = setTimeout(function(){
        if(!done){done=true;resolve(null);}
      },8000);

      var req = https.request({
        hostname: 'datalab.naver.com',
        path:     '/shoppingInsight/getCategoryKeywordRank.naver',
        method:   'POST',
        headers:{
          'Content-Type':   'application/json',
          'Content-Length': buf.length,
          'Cookie':         process.env.NAVER_COOKIE||'',   // ★ 핵심
          'Referer':        'https://datalab.naver.com/shoppingInsight/sCategory.naver',
          'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
          'Accept':         'application/json, text/plain, */*',
          'Accept-Language':'ko-KR,ko;q=0.9',
          'Origin':         'https://datalab.naver.com',
          'X-Requested-With':'XMLHttpRequest',
        }
      },function(res){
        var raw='';
        res.on('data',function(c){raw+=c;});
        res.on('end',function(){
          if(done)return; done=true; clearTimeout(t);
          // HTML 반환 = 쿠키 만료 또는 없음
          if(raw.trim().startsWith('<')){
            console.error('[insightTop] HTML 반환 — 쿠키 만료 또는 미설정');
            resolve(null); return;
          }
          try{
            var d=JSON.parse(raw);
            // 응답 구조 탐색
            var list = d.result&&d.result.keywordList
              || d.keywordList
              || (Array.isArray(d)?d:[]);
            if(!list.length){
              console.error('[insightTop] 빈 응답. raw:',raw.slice(0,200));
              resolve(null); return;
            }
            var keywords = list.map(function(item){
              return {
                keyword: item.keyword||item.name||'',
                rank:    safeNum(item.rank||0),
              };
            }).filter(function(item){return item.keyword;});
            console.log('[insightTop ok]',catId,'TOP'+keywords.length,'1위:',keywords[0]&&keywords[0].keyword);
            resolve(keywords);
          }catch(e){
            console.error('[insightTop parse]',catId,e.message,'raw:',raw.slice(0,300));
            resolve(null);
          }
        });
      });
      req.on('error',function(e){
        if(!done){done=true;clearTimeout(t);
        console.error('[insightTop req]',catId,e.message);resolve(null);}
      });
      req.setTimeout(7000,function(){req.destroy();});
      req.write(buf); req.end();
    }catch(e){
      console.error('[insightTop]',e.message);
      resolve(null);
    }
  });
}

function safeNum(v){return isNaN(Number(v))?0:Number(v);}

// ── 핸들러 (테스트용) ────────────────────────────────────────
module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  if(req.method==='OPTIONS') return res.status(200).end();

  var catId = (req.query&&req.query.catId)||'50000000';
  var count = safeNum((req.query&&req.query.count)||20);

  if(!process.env.NAVER_COOKIE){
    return res.status(200).json({
      error:'NAVER_COOKIE 환경변수 미설정',
      guide:'네이버 로그인 후 datalab.naver.com에서 쿠키를 복사해 환경변수에 추가하세요'
    });
  }

  var result = await fetchInsightTop(catId, count);
  if(!result){
    return res.status(200).json({error:'TOP 키워드 수집 실패 — 쿠키 만료 가능성'});
  }
  return res.status(200).json({catId, count:result.length, keywords:result});
};

// ── 외부 모듈에서 사용 ────────────────────────────────────────
module.exports.fetchInsightTop = fetchInsightTop;


// ═══════════════════════════════════════════════════════════
// _trend-naver.js 수정 — fetchCategoryTopKeywords 교체
// ═══════════════════════════════════════════════════════════

/*
fetchCategoryTopKeywords를 아래로 교체:

async function fetchCategoryTopKeywords(catIds, period){
  var allKeywords=[];
  var INSIGHT_TOP = require('./naver-insight-top').fetchInsightTop;

  for(var i=0;i<catIds.length;i++){
    var catId=catIds[i];
    var top20=null;

    // ★ NAVER_COOKIE 있으면 실시간 TOP 20 수집
    if(process.env.NAVER_COOKIE){
      top20 = await INSIGHT_TOP(catId, 20);
    }

    // 실패 시 CATEGORY_SEEDS 폴백
    if(!top20||!top20.length){
      console.warn('[cat]',catId,'쿠키 없음 또는 실패 — SEEDS 폴백');
      var seeds=(CFG.CATEGORY_SEEDS&&CFG.CATEGORY_SEEDS[catId])||[];
      top20=seeds.slice(0,20).map(function(kw,idx){
        return {keyword:kw,rank:idx+1};
      });
    }

    // 데이터랩으로 트렌드 점수화
    var kwList=top20.map(function(item){return item.keyword;});
    var datalabScores=await compareKeywordsByDatalab(kwList,period);
    var ranked=kwList.slice().sort(function(a,b){
      return (datalabScores[b]||0)-(datalabScores[a]||0);
    });

    var insightCallsPerCat=catIds.length===1?5:2;
    var catItems=[];
    for(var j=0;j<Math.min(ranked.length,insightCallsPerCat);j++){
      var kw=ranked[j];
      var insight=await fetchNaverShoppingInsight(kw,catId,period);
      var insightScore=0;
      if(insight&&!insight._fallback){
        insightScore=Math.max(0,insight.clickSurge||0)+Math.max(0,insight.clickAccel||0);
        if(insight.shopTrend==='hot')         insightScore+=30;
        else if(insight.shopTrend==='rising') insightScore+=15;
        else if(insight.shopTrend==='stable') insightScore+=5;
      }
      catItems.push({keyword:kw,catId:catId,insightData:insight&&!insight._fallback?insight:null,
        trendScore:(datalabScores[kw]||0)+insightScore});
      await sleep(150);
    }
    ranked.slice(insightCallsPerCat).forEach(function(kw){
      catItems.push({keyword:kw,catId:catId,insightData:null,trendScore:datalabScores[kw]||0});
    });

    catItems.sort(function(a,b){return b.trendScore-a.trendScore;});
    var take=catIds.length===1?Math.min(catItems.length,10):3;
    allKeywords=allKeywords.concat(catItems.slice(0,take));
    if(i<catIds.length-1) await sleep(300);
  }

  allKeywords.sort(function(a,b){return b.trendScore-a.trendScore;});
  return allKeywords.slice(0,catIds.length===1?10:15);
}
*/
