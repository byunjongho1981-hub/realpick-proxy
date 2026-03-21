// api/test-naver.js — 쇼핑인사이트 상세 진단용
var https = require('https');

function httpPost(path, body) {
  return new Promise(function(resolve, reject) {
    var buf = Buffer.from(JSON.stringify(body), 'utf8');
    var t = setTimeout(function() { reject(new Error('TIMEOUT')); }, 10000);
    var req = https.request({
      hostname: 'openapi.naver.com', path: path, method: 'POST',
      headers: {
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
        'Content-Type':          'application/json',
        'Content-Length':        buf.length
      }
    }, function(res) {
      var raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() {
        clearTimeout(t);
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch(e) { resolve({ status: res.statusCode, raw: raw }); }
      });
    });
    req.on('error', function(e) { clearTimeout(t); reject(e); });
    req.write(buf); req.end();
  });
}

function fmtDate(d) {
  var pad = function(n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  var now  = new Date();
  var yest = new Date(now); yest.setDate(now.getDate()-1);
  var ago14= new Date(now); ago14.setDate(now.getDate()-15);
  var kw   = req.query.kw || '운동화';

  var startDate = fmtDate(ago14);
  var endDate   = fmtDate(yest);

  // ── 쇼핑인사이트 4가지 엔드포인트 모두 테스트
  var endpoints = [
    { name: 'keyword/ratio',    path: '/v1/datalab/shopping/keyword/ratio',    body: { startDate, endDate, timeUnit:'date', keyword: kw, device:'', gender:'', ages:[] } },
    { name: 'categories',       path: '/v1/datalab/shopping/categories',        body: { startDate, endDate, timeUnit:'date', category:[{name:kw, param:[kw]}], device:'', gender:'', ages:[] } },
    { name: 'keyword/tags',     path: '/v1/datalab/shopping/keyword/tags',      body: { startDate, endDate, timeUnit:'date', keyword: kw, device:'', gender:'', ages:[] } },
  ];

  var results = {
    env: {
      NAVER_CLIENT_ID:     process.env.NAVER_CLIENT_ID ? process.env.NAVER_CLIENT_ID.slice(0,8)+'***' : '❌ 없음',
      NAVER_CLIENT_SECRET: process.env.NAVER_CLIENT_SECRET ? '✅ 설정됨' : '❌ 없음'
    },
    dates: { startDate, endDate },
    keyword: kw,
    tests: {}
  };

  for (var i = 0; i < endpoints.length; i++) {
    var ep = endpoints[i];
    try {
      var r = await httpPost(ep.path, ep.body);
      results.tests[ep.name] = {
        httpStatus:  r.status,
        errorCode:   r.body ? r.body.errorCode   : null,
        errorMsg:    r.body ? r.body.errorMessage : null,
        hasResults:  r.body && r.body.results ? true : false,
        dataPoints:  r.body && r.body.results ? ((r.body.results[0]||{}).data||[]).length : 0,
        raw:         r.body || r.raw,
        ok:          r.status === 200 && r.body && !r.body.errorCode
      };
    } catch(e) {
      results.tests[ep.name] = { error: e.message };
    }
  }

  return res.status(200).json(results);
};
