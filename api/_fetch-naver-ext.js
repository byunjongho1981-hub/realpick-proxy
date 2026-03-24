var https = require('https');
var CFG   = require('./_config');

function safeNum(v){ return isNaN(Number(v)) ? 0 : Number(v); }

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
      res.on('end',  function(){ clearTimeout(t); try{ resolve(JSON.parse(raw)); }catch(e){ resolve({}); } });
    });
    req.on('error', function(e){ clearTimeout(t); reject(e); });
    req.end();
  });
}

// 블로그 포스팅 수 → 공급량 지표
function fetchBlogCount(kw){
  return naverGet('/v1/search/blog.json', { query:kw, display:1, sort:'date' })
    .then(function(d){ return safeNum(d.total); })
    .catch(function(){ return 0; });
}

// 카페 언급수 → 커뮤니티 반응 (태동기 감지)
function fetchCafeCount(kw){
  return naverGet('/v1/search/cafearticle.json', { query:kw, display:1, sort:'date' })
    .then(function(d){ return safeNum(d.total); })
    .catch(function(){ return 0; });
}

// 뉴스 언급수 → 성숙기 신호
function fetchNewsCount(kw){
  return naverGet('/v1/search/news.json', { query:kw, display:1, sort:'date' })
    .then(function(d){ return safeNum(d.total); })
    .catch(function(){ return 0; });
}

// 3개 동시 수집
function fetchNaverCounts(kw){
  return Promise.all([
    fetchBlogCount(kw),
    fetchCafeCount(kw),
    fetchNewsCount(kw)
  ]).then(function(r){
    return { blogCount: r[0], cafeCount: r[1], newsCount: r[2] };
  }).catch(function(){ return { blogCount:0, cafeCount:0, newsCount:0 }; });
}

module.exports = { fetchBlogCount, fetchCafeCount, fetchNewsCount, fetchNaverCounts };
