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

// ── 캐시 (요청 단위 인메모리) ──
const _cache = {};
async function cached(key, fn) {
  if (_cache[key]) return _cache[key];
  const v = await fn();
  _cache[key] = v;
  return v;
}

// ── 재시도 ──
async function withRetry(fn, label = '') {
  for (let i = 0; i < CONFIG.RETRY; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === CONFIG.RETRY - 1) throw e;
      await sleep(500 * (i + 1));
    }
  }
}

// ── 날짜 ──
function dateRange(months = 12) {
  const end = new Date(), start = new Date();
  start.setMonth(start.getMonth() - months);
  const f = d => d.toISOString().slice(0, 10);
  return { startDate: f(start), endDate: f(end) };
}

const HEADERS = () => ({
  'X-Naver-Client-Id':     CONFIG.ID,
  'X-Naver-Client-Secret': CONFIG.SECRET,
  'Content-Type':          'application/json',
});

// ─────────────────────────────────────────
// A. 후보 발굴
// ─────────────────────────────────────────
const SEEDS = ['생활가전','뷰티','건강식품','홈인테리어','주방용품','디지털기기','다이어트','운동용품'];

const STOP = new Set(['추천','후기','리뷰','최고','인기','판매','구매','할인','가격','비교','효과','정품']);

function extractKws(text) {
  return (text.match(/[가-힣]{2,8}/g) ?? []).filter(t => !STOP.has(t));
}

async function naverSearch(query, type = 'shop') {
  const url = type === 'shop'
    ? 'https://openapi.naver.com/v1/search/shop.json'
    : 'https://openapi.naver.com/v1/search/blog.json';
  return cached(`search:${type}:${query}`, () => withRetry(async () => {
    await sleep(CONFIG.RATE);
    const r = await axios.get(url, {
      params: { query, display: 20, sort: 'sim' },
      headers: HEADERS(),
    });
    return r.data?.items ?? [];
  }));
}

async function discoverCandidates() {
  const set = new Set();
  for (const seed of SEEDS) {
    const shop = await naverSearch(seed, 'shop');
    shop.forEach(i => extractKws((i.title ?? '').replace(/<[^>]+>/g, '')).forEach(k => set.add(k)));
    const blog = await naverSearch(`${seed} 추천`, 'blog');
    blog.forEach(i => extractKws((i.description ?? '').replace(/<[^>]+>/g, '')).forEach(k => set.add(k)));
  }
  const seen = new Set();
  return [...set].filter(k => { if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 100);
}

// ─────────────────────────────────────────
// B. 트렌드 분석
// ─────────────────────────────────────────
async function getTrend(keywords) {
  const { startDate, endDate } = dateRange(12);
  return withRetry(async () => {
    await sleep(CONFIG.RATE);
    const r = await axios.post('https://openapi.naver.com/v1/datalab/search', {
      startDate, endDate, timeUnit: 'month',
      keywordGroups: keywords.slice(0, 5).map(k => ({ groupName: k, keywords: [k] })),
    }, { headers: HEADERS() });
    return r.data?.results ?? [];
  });
}

function analyzeTrend(results) {
  const out = {};
  for (const g of results) {
    const vals = g.data.map(d => d.ratio).filter(v => v != null);
    if (vals.length < 3) { out[g.title] = { latest: 0, avg3: 0, prev3: 0, growth: 0, vol: 0 }; continue; }
    const avg3  = mean(vals.slice(-3));
    const prev3 = mean(vals.slice(-6, -3));
    out[g.title] = {
      latest: vals[vals.length - 1],
      avg3, prev3,
      growth: prev3 === 0 ? 0 : (avg3 - prev3) / prev3,
      vol:    stddev(vals.slice(-6)),
    };
  }
  return out;
}

// ─────────────────────────────────────────
// C. 쇼핑 인텐트
// ─────────────────────────────────────────
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
  '50000007':'생활/건강', '50000006':'스포츠/레저','50000005':'식품',
};

async function getShoppingIntent(kw, cat) {
  const { startDate, endDate } = dateRange(6);
  return cached(`shop:${cat}:${kw}`, () => withRetry(async () => {
    await sleep(CONFIG.RATE);
    const r = await axios.post(
      'https://openapi.naver.com/v1/datalab/shopping/category/keyword/ratio',
      { startDate, endDate, timeUnit: 'month', category: cat,
        keyword: [{ name: kw, param: [kw] }], device: '', gender: '', ages: [] },
      { headers: HEADERS() }
    );
    return r.data?.results?.[0]?.data ?? [];
  }));
}

// ─────────────────────────────────────────
// D. 마켓 퀄리티
// ─────────────────────────────────────────
async function marketQuality(kw) {
  const items = await naverSearch(kw, 'shop');
  if (!items.length) return { score: 0 };
  const prices = items.map(i => parseInt(i.lprice ?? 0)).filter(p => p > 0);
  const avgPrice = mean(prices);
  const brands = items.map(i => i.mallName ?? 'x');
  const bc = {};
  brands.forEach(b => { bc[b] = (bc[b] ?? 0) + 1; });
  const hhi = Object.values(bc).reduce((s, c) => s + (c / brands.length) ** 2, 0);
  const diversity = 1 - hhi;
  const priceScore = avgPrice >= 10000 && avgPrice <= 100000 ? 1 : avgPrice <= 300000 ? 0.6 : 0.3;
  const visual = /기기|기계|도구|폰|청소|조리|카메라|패드/.test(kw);
  return {
    score: r2((diversity * 0.4) + (priceScore * 0.4) + (visual ? 0.2 : 0)),
    avgPrice, diversity, visual,
  };
}

// ─────────────────────────────────────────
// E. 스코어링
// ─────────────────────────────────────────
function score(trend, intentScore, catScore, mq) {
  const ts = Math.min((trend.latest ?? 0) / 100, 1);
  const gs = trend.growth > 0.2 ? 1 : trend.growth > 0 ? 0.7 : trend.growth > -0.1 ? 0.4 : 0.1;
  return r2(ts * 0.25 + gs * 0.20 + intentScore * 0.25 + catScore * 0.10 + mq.score * 0.10);
}

function validate(trend, intent, mq) {
  if ((trend.latest ?? 0) < 5)  return 'FAIL:weak_trend';
  if (trend.growth < -0.3)       return 'FAIL:declining';
  if (intent < 0.2)              return 'FAIL:no_intent';
  if (mq.score < 0.2)            return 'FAIL:poor_market';
  return 'PASS';
}

// ─────────────────────────────────────────
// PIPELINE
// ─────────────────────────────────────────
async function runPipeline() {
  const candidates = await discoverCandidates();
  const results = [];

  for (let i = 0; i < candidates.length; i += 5) {
    const batch = candidates.slice(i, i + 5);
    let trendMap = {};
    try { trendMap = analyzeTrend(await getTrend(batch)); } catch {}

    for (const kw of batch) {
      const trend  = trendMap[kw] ?? { latest: 0, avg3: 0, prev3: 0, growth: 0, vol: 0 };
      const cat    = catId(kw);
      let intentScore = 0, catScore = 0;
      try {
        const sd = await getShoppingIntent(kw, cat);
        intentScore = r2(Math.min(mean(sd.map(d => d.ratio)) / 50, 1));
        catScore    = r2(Math.min(mean(sd.slice(-3).map(d => d.ratio)) / 50, 1));
      } catch {}
      let mq = { score: 0 };
      try { mq = await marketQuality(kw); } catch {}

      const validation = validate(trend, intentScore, mq);
      const final_score = score(trend, intentScore, catScore, mq);

      results.push({
        keyword: kw,
        mapped_category: CAT_NAME[cat] ?? '기타',
        latest_value: r2(trend.latest),
        avg_3m: r2(trend.avg3),
        prev_3m: r2(trend.prev3),
        growth_rate: r2(trend.growth, 3),
        volatility: r2(trend.vol, 3),
        shopping_intent_score: intentScore,
        category_strength_score: catScore,
        market_quality_score: mq.score,
        final_score,
        validation_result: validation,
        avg_price: mq.avgPrice,
      });
    }
    await sleep(400);
  }

  const passed = results.filter(r => r.validation_result === 'PASS').sort((a, b) => b.final_score - a.final_score);
  return {
    summary: { total: results.length, passed: passed.length, failed: results.length - passed.length, generated_at: new Date().toISOString() },
    ranking: passed,
    failed: results.filter(r => r.validation_result !== 'PASS').map(r => ({ keyword: r.keyword, reason: r.validation_result })),
  };
}

// ─────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();
  try {
    const result = await runPipeline();
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// ─── utils ───
function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function stddev(a) { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length || 1)); }
function r2(v, d = 2) { return Math.round(v * 10 ** d) / 10 ** d; }
