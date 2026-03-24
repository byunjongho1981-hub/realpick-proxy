var https = require('https');
var CFG   = require('./_config');

function safeNum(v){ return isNaN(Number(v)) ? 0 : Number(v); }
function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

function naverGet(path, params){
  return new Promise(function(resolve, reject){
    var qs = Object.keys(params).map(function(k){
      return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);
    }).join('&');
    var t = setTimeout(function(){ reject(new Error('timeout')); }, CFG.TIMEOUT);
    var req = https.request({
      hostname: 'openapi.naver.com', path: path+'?'+qs, method: 'GET',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
      }
    }, function(res){
      var raw='';
      res.on('data', function(c){ raw+=c; });
      res.on('end',  function(){
        clearTimeout(t);
        try{
          var d = JSON.parse(raw);
          // ★ 에러 코드 체크
          if(d.errorCode){ console.error('[naver-ext]', d.errorCode, d.errorMessage); resolve(null); return; }
          resolve(d);
        }catch(e){ resolve(null); }
      });
    });
    req.on('error', function(e){ clearTimeout(t); reject(e); });
    req.end();
  });
}

// 블로그 포스팅 수 → 공급량 지표
function fetchBlogCount(kw){
  return naverGet('/v1/search/blog.json', { query:kw, display:1, sort:'date' })
    .then(function(d){ return d ? safeNum(d.total) : 0; })
    .catch(function(e){ console.error('[blog-count]', kw, e.message); return 0; });
}

// 카페 언급수 → 커뮤니티 반응 (태동기 감지)
function fetchCafeCount(kw){
  return naverGet('/v1/search/cafearticle.json', { query:kw, display:1, sort:'date' })
    .then(function(d){ return d ? safeNum(d.total) : 0; })
    .catch(function(e){ console.error('[cafe-count]', kw, e.message); return 0; });
}

// 뉴스 언급수 → 성숙기 신호
function fetchNewsCount(kw){
  return naverGet('/v1/search/news.json', { query:kw, display:1, sort:'date' })
    .then(function(d){ return d ? safeNum(d.total) : 0; })
    .catch(function(e){ console.error('[news-count]', kw, e.message); return 0; });
}

// 단일 키워드: 3개 순차 수집 (딜레이 포함)
async function fetchNaverCounts(kw){
  try{
    var blog = await fetchBlogCount(kw);
    await sleep(150);
    var cafe = await fetchCafeCount(kw);
    await sleep(150);
    var news = await fetchNewsCount(kw);
    return { blogCount:blog, cafeCount:cafe, newsCount:news };
  }catch(e){
    console.error('[naver-counts]', kw, e.message);
    return { blogCount:0, cafeCount:0, newsCount:0 };
  }
}

// ★ 배치 수집: 한 번에 3개씩, 배치 간 500ms 딜레이
async function fetchNaverCountsBatch(keywords){
  var BATCH = 3;
  var results = [];
  for(var i=0; i<keywords.length; i+=BATCH){
    var chunk = keywords.slice(i, i+BATCH);
    // 배치 내에서는 순차 처리 (API 레이트 리밋 방지)
    for(var j=0; j<chunk.length; j++){
      var r = await fetchNaverCounts(chunk[j]);
      results.push(r);
    }
    if(i+BATCH < keywords.length) await sleep(500);
  }
  return results;
}

module.exports = { fetchBlogCount, fetchCafeCount, fetchNewsCount, fetchNaverCounts, fetchNaverCountsBatch };
