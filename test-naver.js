// api/test-naver.js — Naver API 진단용 (확인 후 삭제)
var https = require('https');

function httpPost(path, body) {
  return new Promise(function(resolve, reject) {
    var buf = Buffer.from(JSON.stringify(body), 'utf8');
    var t = setTimeout(function() { reject(new Error('TIMEOUT_10s')); }, 10000);
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
        catch(e) { resolve({ status: res.statusCode, body: raw }); }
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

  var now   = new Date();
  var yest  = new Date(now); yest.setDate(now.getDate()-1);
  var ago14 = new Date(now); ago14.setDate(now.getDate()-15);

  var kw = req.query.kw || '운동화';

  var result = {
    env: {
      NAVER_CLIENT_ID:     process.env.NAVER_CLIENT_ID ? process.env.NAVER_CLIENT_ID.slice(0,6)+'***' : '❌ 없음',
      NAVER_CLIENT_SECRET: process.env.NAVER_CLIENT_SECRET ? '***설정됨***' : '❌ 없음'
    },
    dates: {
      startDate: fmtDate(ago14),
      endDate:   fmtDate(yest)
    },
    velocity: null,
    insight:  null
  };

  // 1. 검색어트렌드 테스트
  try {
    var v = await httpPost('/v1/datalab/search', {
      startDate: fmtDate(ago14), endDate: fmtDate(yest), timeUnit: 'date',
      keywordGroups: [{ groupName: kw, keywords: [kw] }]
    });
    result.velocity = {
      httpStatus: v.status,
      errorCode:  v.body.errorCode || null,
      errorMsg:   v.body.errorMessage || null,
      dataPoints: v.body.results ? ((v.body.results[0]||{}).data||[]).length : 0,
      ok:         !v.body.errorCode && v.status === 200
    };
  } catch(e) {
    result.velocity = { error: e.message };
  }

  // 2. 쇼핑인사이트 테스트
  try {
    var s = await httpPost('/v1/datalab/shopping/keyword/ratio', {
      startDate: fmtDate(ago14), endDate: fmtDate(yest), timeUnit: 'date',
      keyword: kw, device: '', gender: '', ages: []
    });
    result.insight = {
      httpStatus: s.status,
      errorCode:  s.body.errorCode || null,
      errorMsg:   s.body.errorMessage || null,
      dataPoints: s.body.results ? ((s.body.results[0]||{}).data||[]).length : 0,
      ok:         !s.body.errorCode && s.status === 200
    };
  } catch(e) {
    result.insight = { error: e.message };
  }

  return res.status(200).json(result);
};
