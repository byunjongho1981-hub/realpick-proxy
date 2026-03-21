// api/hot-analyze.js
// YouTube + 네이버 + Groq 기반 "지금 뜨는 제품" 분석 엔진

var https = require('https');

// ── HTTP 헬퍼 ──────────────────────────────────────────────────
function naverGet(path, params) {
  return new Promise(function(resolve, reject) {
    var qs = Object.keys(params).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var t = setTimeout(function() { reject(new Error('timeout')); }, 8000);
    var req = https.request({
      hostname: 'openapi.naver.com', path: path + '?' + qs, method: 'GET',
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
      }
    }, function(res) {
      var raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() { clearTimeout(t); try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); } });
    });
    req.on('error', function(e) { clearTimeout(t); reject(e); });
    req.end();
  });
}

function naverPost(body) {
  return new Promise(function(resolve, reject) {
    var buf = Buffer.from(JSON.stringify(body), 'utf8');
    var t = setTimeout(function() { reject(new Error('timeout')); }, 8000);
    var req = https.request({
      hostname: 'openapi.naver.com', path: '/v1/datalab/search', method: 'POST',
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
        'Content-Type': 'application/json', 'Content-Length': buf.length
      }
    }, function(res) {
      var raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() { clearTimeout(t); try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); } });
    });
    req.on('error', function(e) { clearTimeout(t); reject(e); });
    req.write(buf); req.end();
  });
}

function ytGet(path) {
  return new Promise(function(resolve, reject) {
    var t = setTimeout(function() { reject(new Error('timeout')); }, 8000);
    https.get('https://www.googleapis.com' + path, function(res) {
      var raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() { clearTimeout(t); try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); } });
    }).on('error', function(e) { clearTimeout(t); reject(e); });
  });
}

function groqPost(messages) {
  return new Promise(function(resolve, reject) {
    var buf = Buffer.from(JSON.stringify({
      model: 'llama3-8b-8192', messages: messages, max_tokens: 200, temperature: 0.3
    }), 'utf8');
    var t = setTimeout(function() { reject(new Error('timeout')); }, 15000);
    var req = https.request({
      hostname: 'api.groq.com', path: '/openai/v1/chat/completions', method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
        'Content-Type': 'application/json', 'Content-Length': buf.length
      }
    }, function(res) {
      var raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() { clearTimeout(t); try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); } });
    });
    req.on('error', function(e) { clearTimeout(t); reject(e); });
    req.write(buf); req.end();
  });
}

// ── 유틸 ──────────────────────────────────────────────────────
function parseDuration(d) {
  if (!d) return 0;
  var m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600 + parseInt(m[2] || 0) * 60 + parseInt(m[3] || 0));
}
function clean(t) { return String(t || '').replace(/<[^>]+>/g, '').replace(/[^\w가-힣\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
function sn(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// ── YouTube 분석 ──────────────────────────────────────────────
async function analyzeYouTube(keyword) {
  var key = process.env.YOUTUBE_API_KEY;
  if (!key) return { videoCount: 0, avgViews: 0, shortsRatio: 0, channelRepeat: 0, error: 'NO_KEY' };
  try {
    var ago7 = new Date(); ago7.setDate(ago7.getDate() - 7);
    var sp = '/youtube/v3/search?part=snippet&q=' + encodeURIComponent(keyword) +
      '&type=video&publishedAfter=' + encodeURIComponent(ago7.toISOString()) +
      '&maxResults=50&order=viewCount&relevanceLanguage=ko&key=' + key;
    var sd = await ytGet(sp).catch(function() { return {}; });
    var items = sd.items || [];
    if (!items.length) return { videoCount: 0, avgViews: 0, shortsRatio: 0, channelRepeat: 0 };

    var ids = items.map(function(i) { return i.id && i.id.videoId; }).filter(Boolean).slice(0, 50).join(',');
    var vd = await ytGet('/youtube/v3/videos?part=statistics,contentDetails&id=' + ids + '&key=' + key).catch(function() { return {}; });
    var vids = vd.items || [];

    var totalViews = 0, shorts = 0, channels = {};
    vids.forEach(function(v) {
      totalViews += sn((v.statistics || {}).viewCount);
      if (parseDuration((v.contentDetails || {}).duration) <= 60) shorts++;
    });
    items.forEach(function(i) {
      var ch = (i.snippet || {}).channelId;
      if (ch) channels[ch] = (channels[ch] || 0) + 1;
    });
    return {
      videoCount: items.length,
      avgViews: vids.length ? Math.round(totalViews / vids.length) : 0,
      shortsRatio: vids.length ? shorts / vids.length : 0,
      channelRepeat: Object.values(channels).filter(function(c) { return c > 1; }).length,
      totalViews: totalViews
    };
  } catch(e) { return { videoCount: 0, avgViews: 0, shortsRatio: 0, channelRepeat: 0 }; }
}

// ── 네이버 블로그 분석 ─────────────────────────────────────────
async function analyzeBlog(keyword) {
  try {
    var d = await naverGet('/v1/search/blog.json', { query: keyword + ' 리뷰 후기', display: 30, sort: 'date' });
    var items = d.items || [];
    var rKw = ['리뷰', '후기', '추천', '비교', '솔직'];
    var cnt = items.filter(function(i) {
      var t = clean(i.title || '') + ' ' + clean(i.description || '');
      return rKw.some(function(w) { return t.indexOf(w) > -1; });
    }).length;
    return { total: sn(d.total), reviewRatio: items.length ? cnt / items.length : 0, recentCount: items.length };
  } catch(e) { return { total: 0, reviewRatio: 0, recentCount: 0 }; }
}

// ── 네이버 쇼핑 분석 ──────────────────────────────────────────
async function analyzeShopping(keyword) {
  try {
    var d = await naverGet('/v1/search/shop.json', { query: keyword, display: 40, sort: 'sim' });
    var items = d.items || [];
    var prices = items.map(function(i) { return sn(i.lprice); }).filter(function(p) { return p > 0; });
    return {
      total: sn(d.total),
      itemCount: items.length,
      avgPrice: prices.length ? Math.round(prices.reduce(function(a, b) { return a + b; }, 0) / prices.length) : 0,
      minPrice: prices.length ? Math.min.apply(null, prices) : 0,
      maxPrice: prices.length ? Math.max.apply(null, prices) : 0
    };
  } catch(e) { return { total: 0, itemCount: 0, avgPrice: 0, minPrice: 0, maxPrice: 0 }; }
}

// ── 네이버 데이터랩 분석 ──────────────────────────────────────
async function analyzeDatalab(keyword) {
  try {
    var now = new Date();
    var pad = function(n) { return String(n).padStart(2, '0'); };
    var fmt = function(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    var ago = new Date(now); ago.setDate(now.getDate() - 13);
    var d = await naverPost({
      startDate: fmt(ago), endDate: fmt(now), timeUnit: 'date',
      keywordGroups: [{ groupName: keyword, keywords: [keyword] }]
    });
    var pts = ((d.results || [])[0] || {}).data || [];
    if (pts.length < 4) return { surgeRate: 0, trend: 'unknown', avgRatio: 0 };
    var h = Math.floor(pts.length / 2);
    var avg = function(a) { return a.reduce(function(s, p) { return s + sn(p.ratio); }, 0) / (a.length || 1); };
    var pa = avg(pts.slice(0, h)), ca = avg(pts.slice(h));
    var surge = pa > 0 ? Math.round(((ca - pa) / pa) * 100) : (ca > 0 ? 100 : 0);
    return {
      surgeRate: surge,
      trend: surge >= 30 ? 'rising' : surge >= 10 ? 'growing' : surge >= -10 ? 'stable' : 'falling',
      avgRatio: Math.round(ca * 10) / 10
    };
  } catch(e) { return { surgeRate: 0, trend: 'unknown', avgRatio: 0 }; }
}

// ── 점수 계산 (Groq 사용 금지) ────────────────────────────────
function calcScore(yt, blog, shop, dl) {
  var s = {};
  var surge = dl.surgeRate || 0;
  s.trend    = surge >= 30 ? 25 : surge >= 15 ? 20 : surge >= 5 ? 15 : surge >= 0 ? 10 : surge >= -10 ? 5 : 0;
  var av = yt.avgViews || 0;
  s.views    = av >= 500000 ? 20 : av >= 100000 ? 17 : av >= 50000 ? 14 : av >= 10000 ? 10 : av >= 1000 ? 6 : av > 0 ? 3 : 0;
  s.shorts   = Math.round((yt.shortsRatio || 0) * 15);
  var si = shop.itemCount || 0, sr = blog.reviewRatio || 0;
  s.sales    = (si >= 100 ? 10 : si >= 30 ? 7 : si >= 5 ? 4 : si > 0 ? 2 : 0) + Math.round(sr * 10);
  var vc = yt.videoCount || 0;
  s.compete  = vc === 0 ? 10 : vc <= 5 ? 9 : vc <= 15 ? 7 : vc <= 30 ? 5 : vc <= 50 ? 3 : 1;
  s.timing   = dl.trend === 'rising' ? 10 : dl.trend === 'growing' ? 8 : dl.trend === 'stable' ? 5 : 2;
  if (s.compete >= 7 && dl.trend === 'rising') s.timing = Math.min(10, s.timing + 2);
  var total = s.trend + s.views + s.shorts + s.sales + s.compete + s.timing;
  return { total: Math.min(100, total), breakdown: s, grade: total >= 75 ? 'A' : total >= 55 ? 'B' : 'C' };
}

// ── 판단 레이블 ────────────────────────────────────────────────
function judge(yt, blog, shop, dl) {
  var surge = dl.surgeRate || 0, vc = yt.videoCount || 0;
  var trendStatus = surge >= 30 && vc >= 5 ? 'rising' : surge >= 10 || (vc >= 10 && yt.avgViews >= 5000) ? 'spreading' : surge >= -10 ? 'plateau' : 'falling';
  var si = shop.itemCount || 0, sr = blog.reviewRatio || 0;
  var salesType = si >= 30 && sr >= 0.4 ? 'sell' : si >= 5 || sr >= 0.3 ? 'mixed' : 'info';
  var competition = vc <= 10 ? 'low' : vc <= 30 ? 'medium' : 'high';
  var timing = (trendStatus === 'rising' || trendStatus === 'spreading') && competition !== 'high' ? 'now' : trendStatus === 'plateau' ? 'wait' : 'late';
  var sr2 = yt.shortsRatio || 0;
  var shortsfit = sr2 >= 0.5 && yt.avgViews >= 10000 ? 'great' : sr2 >= 0.3 || yt.avgViews >= 3000 ? 'ok' : 'bad';
  return { trendStatus, salesType, competition, timing, shortsfit };
}

// ── Groq 추천 이유 ─────────────────────────────────────────────
async function getGroqReason(kw, yt, blog, shop, dl, score, jdg) {
  if (!process.env.GROQ_API_KEY) return null;
  try {
    var prompt = '아래 데이터를 보고 한국어 30자 이내 추천 이유 1줄만 출력. 형식: "원인 → 결론"\n' +
      '키워드: ' + kw + ' | YT영상: ' + yt.videoCount + '개 | 평균조회수: ' + yt.avgViews +
      ' | 쇼핑상품: ' + shop.itemCount + '개 | 검색량변화: ' + dl.surgeRate + '%' +
      ' | 트렌드: ' + jdg.trendStatus + ' | 타이밍: ' + jdg.timing + ' | 점수: ' + score.total;
    var d = await groqPost([{ role: 'user', content: prompt }]);
    var t = (((d.choices || [])[0] || {}).message || {}).content;
    return t ? t.trim().replace(/^["']|["']$/g, '').slice(0, 60) : null;
  } catch(e) { return null; }
}

// ── 후보 키워드 추출 ──────────────────────────────────────────
async function extractCandidates(seedKw) {
  try {
    var d = await naverGet('/v1/search/shop.json', { query: seedKw, display: 40, sort: 'sim' });
    var stop = new Set([
      // 조사/접속사
      '이','가','을','를','의','에','는','은','도','와','과','로','으로','에서','부터','까지','만','도','라','이라',
      // 색상
      '블랙','화이트','레드','블루','그린','옐로우','핑크','실버','골드','베이지','그레이','네이비','브라운','퍼플','오렌지',
      '검정','흰색','빨강','파랑','초록','노랑','분홍','회색','하늘','남색',
      // 형용사/부사
      '가벼운','가벼운','튼튼한','편한','편안한','슬림','스마트','프리미엄','고급','특가','신상',
      // 쇼핑 일반어
      '세트','상품','제품','판매','추천','구매','할인','무료','배송','당일','정품','공식','브랜드','인기','최신','신제품',
      '스타일','디자인','사이즈','색상','옵션','모델','버전','에디션','패키지','구성','포함',
      // 숫자형
      '1개','2개','3개','10개','100g','500ml'
    ]);
    var freq = {};
    (d.items || []).forEach(function(item) {
      clean(item.title || '').split(/\s+/).filter(function(w) {
        return w.length >= 3       // ★ 2자 → 3자 이상으로 강화
          && !stop.has(w)
          && w !== seedKw
          && /[가-힣]{2,}/.test(w) // ★ 한글 2자 이상 포함된 단어만
          && !/^\d+$/.test(w);     // ★ 순수 숫자 제외
      }).forEach(function(w) { freq[w] = (freq[w] || 0) + 1; });
    });
    var related = Object.entries(freq).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 9).map(function(e) { return e[0]; });
    var out = [seedKw];
    related.forEach(function(kw) { if (out.indexOf(kw) < 0) out.push(kw); });
    return out.slice(0, 10);
  } catch(e) { return [seedKw]; }
}

// ── Main ───────────────────────────────────────────────────────
module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var keyword = String(req.query.keyword || '').trim().slice(0, 30);
  if (!keyword) return res.status(400).json({ error: '키워드를 입력해주세요' });

  try {
    var candidates = await extractCandidates(keyword);
    var results = [];
    var BATCH = 3;

    for (var i = 0; i < candidates.length; i += BATCH) {
      var chunk = candidates.slice(i, i + BATCH);
      var settled = await Promise.allSettled(chunk.map(async function(kw) {
        var [yt, blog, shop, dl] = await Promise.all([
          analyzeYouTube(kw), analyzeBlog(kw), analyzeShopping(kw), analyzeDatalab(kw)
        ]);
        var score = calcScore(yt, blog, shop, dl);
        var jdg = judge(yt, blog, shop, dl);
        return { kw, yt, blog, shop, dl, score, jdg };
      }));
      settled.forEach(function(r) { if (r.status === 'fulfilled') results.push(r.value); });
      if (i + BATCH < candidates.length) await sleep(300);
    }

    results.sort(function(a, b) { return b.score.total - a.score.total; });

    // Groq: 상위 10개만
    await Promise.allSettled(results.slice(0, 10).map(async function(r) {
      r.aiReason = await getGroqReason(r.kw, r.yt, r.blog, r.shop, r.dl, r.score, r.jdg);
    }));

    var out = results.map(function(r) {
      return {
        id: r.kw, name: r.kw,
        score: r.score,
        judge: r.jdg,
        aiReason: r.aiReason || null,
        data: {
          youtube:  { videoCount: r.yt.videoCount, avgViews: r.yt.avgViews, shortsRatio: Math.round((r.yt.shortsRatio || 0) * 100), channelRepeat: r.yt.channelRepeat },
          blog:     { total: r.blog.total, reviewRatio: Math.round((r.blog.reviewRatio || 0) * 100) },
          shopping: { total: r.shop.total, itemCount: r.shop.itemCount, avgPrice: r.shop.avgPrice },
          datalab:  { surgeRate: r.dl.surgeRate, trend: r.dl.trend, avgRatio: r.dl.avgRatio }
        }
      };
    });

    return res.status(200).json({ keyword: keyword, candidates: out, total: out.length, updatedAt: new Date().toISOString() });

  } catch(e) {
    console.error('[hot-analyze]', e.message);
    return res.status(500).json({ error: '분석 중 오류 발생', detail: e.message });
  }
};
