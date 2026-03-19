// api/discover.js — Vercel Serverless Function
// 외부 파일 import 없음. 파이프라인 전체 포함.

const axios = require('axios');

const CONFIG = {
  ID:     process.env.NAVER_CLIENT_ID,
  SECRET: process.env.NAVER_CLIENT_SECRET,
  RATE:   300,
  RETRY:  3,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const _cache = {};
async function cached(key, fn) {
  if (_cache[key]) return _cache[key];
  const v = await fn();
  _cache[key] = v;
  return v;
}

async function withRetry(fn) {
  for (let i = 0; i < CONFIG.RETRY; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === CONFIG.RETRY - 1) throw e;
      await sleep(500 * (i + 1));
    }
  }
}

function dateRange(months) {
  const end = new Date(), start = new Date();
  start.setMonth(start.getMonth() - months);
  const f = d => d.toISOString().slice(0, 10);
  return { startDate: f(start), endDate: f(end) };
}

function H() {
  return {
    'X-Naver-Client-Id':     CONFIG.ID,
    'X-Naver-Client-Secret': CONFIG.SECRET,
    'Content-Type':          'application/json',
  };
}

// ── A. 후보 발굴 ──
const SEEDS = ['생활가전','뷰티','건강식품','홈인테리어','주방용품','디지털기기','다이어트','운동용품'];
const STOP  = new Set(['추천','후기','리뷰','최고','인기','판매','구매','할인','가격','비교','효과','정품']);

function extractKws(text) {
  return (text.match(/[가-힣]{2,8}/g) || []).filter(t => !STOP.has(t));
}

async function naverSearch(query, type) {
  const url = type === 'blog'
    ? 'https://openapi.naver.com/v1/search/blog.json'
    : 'https://openapi.naver.com/v1/search/shop.json';
  return cached('s:' + type + ':' + query, () => withRetry(async () => {
    await sleep(CONFIG.RATE);
    const r = await axios.get(url, { params: { query, display: 20, sort: 'sim' }, headers: H() });
    return r.data && r.data.items ? r.data.items : [];
  }));
}

async function discoverCandidates() {
  const set = new Set();
  for (var i = 0; i < SEEDS.length; i++) {
    var seed = SEEDS[i];
    var shop = await naverSearch(seed, 'shop');
    shop.forEach(function(item) {
      extractKws((item.title || '').replace(/<[^>]+>/g, '')).forEach(function(k) { set.add(k); });
    });
    var blog = await naverSearch(seed + ' 추천', 'blog');
    blog.forEach(function(item) {
      extractKws((item.description || '').replace(/<[^>]+>/g, '')).forEach(function(k) { set.add(k); });
    });
  }
  var seen = new Set();
  return Array.from(set).filter(function(k) {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 60);
}

// ── B. 트렌드 ──
async function getTrend(keywords) {
  var d = dateRange(12);
  return withRetry(async () => {
    await sleep(CONFIG.RATE);
    var r = await axios.post('https://openapi.naver.com/v1/datalab/search', {
      startDate: d.startDate, endDate: d.endDate, timeUnit: 'month',
      keywordGroups: keywords.slice(0, 5).map(function(k) { return { groupName: k, keywords: [k] }; }),
    }, { headers: H() });
    return r.data && r.data.results ? r.data.results : [];
  });
}

function analyzeTrend(results) {
  var out = {};
  results.forEach(function(g) {
    var vals = g.data.map(function(d) { return d.ratio; }).filter(function(v) { return v != null; });
    if (vals.length < 3) { out[g.title] = { latest: 0, avg3: 0, prev3: 0, growth: 0 }; return; }
    var avg3  = mean(vals.slice(-3));
    var prev3 = mean(vals.slice(-6, -3));
    out[g.title] = {
      latest: vals[vals.length - 1],
      avg3: avg3, prev3: prev3,
      growth: prev3 === 0 ? 0 : (avg3 - prev3) / prev3,
    };
  });
  return out;
}

// ── C. 쇼핑 인텐트 ──
function catId(kw) {
  if (/폰|노트북|이어폰|스피커|키보드/.test(kw)) return '50000003';
  if (/크림|세럼|마스크팩|선크림|립/.test(kw))   return '50000002';
  if (/의자|책상|침대|소파|조명/.test(kw))        return '50000004';
  if (/단백질|비타민|홍삼|유산균/.test(kw))       return '50000007';
  if (/운동|레깅스|덤벨|헬스/.test(kw))          return '50000006';
  if (/에어프라이어|냄비|도마|커피/.test(kw))     return '50000005';
  return '50000007';
}

const CAT_NAME = {
  '50000003':'디지털/가전','50000002':'화장품/미용','50000004':'가구/인테리어',
  '50000007':'생활/건강','50000006':'스포츠/레저','50000005':'식품',
};

async function getShoppingIntent(kw, cat) {
  var d = dateRange(6);
  return cached('si:' + cat + ':' + kw, () => withRetry(async () => {
    await sleep(CONFIG.RATE);
    var r = await axios.post(
      'https://openapi.naver.com/v1/datalab/shopping/category/keyword/ratio',
      { startDate: d.startDate, endDate: d.endDate, timeUnit: 'month', category: cat,
        keyword: [{ name: kw, param: [kw] }], device: '', gender: '', ages: [] },
      { headers: H() }
    );
    return r.data && r.data.results && r.data.results[0] ? r.data.results[0].data : [];
  }));
}

// ── D. 마켓 퀄리티 ──
async function marketQuality(kw) {
  var items = await naverSearch(kw, 'shop');
  if (!items.length) return { score: 0, avgPrice: 0 };
  var prices = items.map(function(i) { return parseInt(i.lprice || 0); }).filter(function(p) { return p > 0; });
  var avgPrice = mean(prices);
  var brands = items.map(function(i) { return i.mallName || 'x'; });
  var bc = {};
  brands.forEach(function(b) { bc[b] = (bc[b] || 0) + 1; });
  var hhi = Object.values(bc).reduce(function(s, c) { return s + Math.pow(c / brands.length, 2); }, 0);
  var diversity = 1 - hhi;
  var priceScore = avgPrice >= 10000 && avgPrice <= 100000 ? 1 : avgPrice <= 300000 ? 0.6 : 0.3;
  return { score: r2(diversity * 0.5 + priceScore * 0.5), avgPrice: avgPrice };
}

// ── E. 스코어링 ──
function calcScore(trend, intent, mq) {
  var ts = Math.min((trend.latest || 0) / 100, 1);
  var gs = trend.growth > 0.2 ? 1 : trend.growth > 0 ? 0.7 : 0.3;
  return r2(ts * 0.30 + gs * 0.20 + intent * 0.30 + mq.score * 0.20);
}

function validate(trend, intent, mq) {
  if ((trend.latest || 0) < 5) return 'FAIL:weak_trend';
  if (trend.growth < -0.3)      return 'FAIL:declining';
  if (intent < 0.2)             return 'FAIL:no_intent';
  if (mq.score < 0.2)           return 'FAIL:poor_market';
  return 'PASS';
}

// ── PIPELINE ──
async function runPipeline() {
  var candidates = await discoverCandidates();
  var results = [];

  for (var i = 0; i < candidates.length; i += 5) {
    var batch = candidates.slice(i, i + 5);
    var trendMap = {};
    try { trendMap = analyzeTrend(await getTrend(batch)); } catch(e) {}

    for (var j = 0; j < batch.length; j++) {
      var kw   = batch[j];
      var cat  = catId(kw);
      var trend = trendMap[kw] || { latest: 0, avg3: 0, prev3: 0, growth: 0 };
      var intent = 0;
      try {
        var sd = await getShoppingIntent(kw, cat);
        intent = r2(Math.min(mean(sd.map(function(d) { return d.ratio; })) / 50, 1));
      } catch(e) {}
      var mq = { score: 0, avgPrice: 0 };
      try { mq = await marketQuality(kw); } catch(e) {}

      results.push({
        keyword:                kw,
        mapped_category:        CAT_NAME[cat] || '기타',
        latest_value:           r2(trend.latest),
        avg_3m:                 r2(trend.avg3),
        prev_3m:                r2(trend.prev3),
        growth_rate:            r2(trend.growth, 3),
        shopping_intent_score:  intent,
        market_quality_score:   mq.score,
        final_score:            calcScore(trend, intent, mq),
        validation_result:      validate(trend, intent, mq),
        avg_price:              mq.avgPrice,
      });
    }
    await sleep(300);
  }

  var passed = results
    .filter(function(r) { return r.validation_result === 'PASS'; })
    .sort(function(a, b) { return b.final_score - a.final_score; });

  return {
    summary: {
      total: results.length,
      passed: passed.length,
      failed: results.length - passed.length,
      generated_at: new Date().toISOString(),
    },
    ranking: passed,
    failed: results
      .filter(function(r) { return r.validation_result !== 'PASS'; })
      .map(function(r) { return { keyword: r.keyword, reason: r.validation_result }; }),
  };
}

// ── HANDLER ──
module.exports = async function(req, res) {
  try {
    var result = await runPipeline();
    res.status(200).json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};

function mean(a) { return a.length ? a.reduce(function(s,v){return s+v;},0)/a.length : 0; }
function r2(v, d) { d = d||2; return Math.round(v * Math.pow(10,d)) / Math.pow(10,d); }
