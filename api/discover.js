/**
 * /api/discover.js
 * 네이버 쇼핑·블로그·뉴스·카페 병렬 수집
 * + Datalab 검색량 변화율 연동
 * + 기간 필터 (today / week / month)
 */

const https = require('https');

// ════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════
const CONFIG = {
  MAX_CANDIDATES: 30,
  API_TIMEOUT_MS: 8000,
  RETRY_COUNT: 1,
  DEFAULT_KEYWORD: '인기상품',
  SCORE_WEIGHTS: { shopping: 25, blog: 20, news: 10, cafe: 15, trend: 30 },
  GRADE:  { A: 70, B: 50 },
  TREND: {
    RISING:  'rising',
    STABLE:  'stable',
    FALLING: 'falling',
    NEW:     'new',
    UNKNOWN: 'unknown',
  },
  ACTION: { SHORTS: 'shorts', BLOG: 'blog', HOLD: 'hold', COMPARE: 'compare' },
  // 변화율 기준 (Datalab 기반)
  CHANGE_RATE: { RISING: 10, FALLING: -10 },   // % 기준
};

// ════════════════════════════════════════
// 기간 계산
// ════════════════════════════════════════

/**
 * period 문자열 → { startDate, endDate, prevStartDate, prevEndDate }
 * Datalab 비교를 위해 현재 기간과 이전 기간을 함께 반환
 */
function buildDateRange(period = 'week') {
  const pad  = n => String(n).padStart(2, '0');
  const fmt  = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const now  = new Date();

  const daysBefore = (d, n) => {
    const t = new Date(d);
    t.setDate(t.getDate() - n);
    return t;
  };

  let curStart, curEnd, prevStart, prevEnd;

  if (period === 'today') {
    curStart  = now;
    curEnd    = now;
    prevStart = daysBefore(now, 1);
    prevEnd   = daysBefore(now, 1);
  } else if (period === 'month') {
    curStart  = daysBefore(now, 29);
    curEnd    = now;
    prevStart = daysBefore(now, 59);
    prevEnd   = daysBefore(now, 30);
  } else {                          // week (기본값)
    curStart  = daysBefore(now, 6);
    curEnd    = now;
    prevStart = daysBefore(now, 13);
    prevEnd   = daysBefore(now, 7);
  }

  return {
    startDate:     fmt(curStart),
    endDate:       fmt(curEnd),
    prevStartDate: fmt(prevStart),
    prevEndDate:   fmt(prevEnd),
    timeUnit:      period === 'today' ? 'date' : period === 'month' ? 'week' : 'date',
  };
}

// ════════════════════════════════════════
// ENV 검증
// ════════════════════════════════════════
function validateEnv() {
  const required = ['NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) throw new Error(`환경변수 누락: ${missing.join(', ')}`);
}

// ════════════════════════════════════════
// UTILS
// ════════════════════════════════════════
function safeNum(val, fallback = 0) {
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

function cleanText(text = '') {
  return String(text)
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-zA-Z]+;/g, ' ')
    .replace(/[^\w가-힣\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractKeywords(title = '') {
  const stopWords = new Set([
    '이','가','을','를','의','에','와','과','및','또는',
    'the','a','an','of','for','in','on','at',
    '세트','상품','제품','판매','할인','무료',
  ]);
  return cleanText(title)
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w))
    .slice(0, 5);
}

// ════════════════════════════════════════
// HTTP 공통 헬퍼
// ════════════════════════════════════════
function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API timeout')), CONFIG.API_TIMEOUT_MS);
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(raw)); }
        catch { resolve({}); }
      });
    });
    req.on('error', e => { clearTimeout(timer); reject(e); });
    if (body) req.write(body);
    req.end();
  });
}

// ════════════════════════════════════════
// NAVER SEARCH API (GET)
// ════════════════════════════════════════
function naverSearch(path, params) {
  const qs = new URLSearchParams(params).toString();
  return httpRequest({
    hostname: 'openapi.naver.com',
    path:     `${path}?${qs}`,
    method:   'GET',
    headers: {
      'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
    },
  });
}

// ════════════════════════════════════════
// NAVER DATALAB API (POST)
// 현재 기간 vs 이전 기간 → 변화율 반환
// ════════════════════════════════════════
async function fetchDatalabChangeRate(keyword, dateRange) {
  const body = JSON.stringify({
    startDate: dateRange.prevStartDate,   // 이전 기간 시작
    endDate:   dateRange.endDate,          // 현재 기간 끝 (전체 포함)
    timeUnit:  dateRange.timeUnit,
    keywordGroups: [
      { groupName: keyword, keywords: [keyword] },
    ],
  });

  try {
    const data = await httpRequest({
      hostname: 'openapi.naver.com',
      path:     '/v1/datalab/search',
      method:   'POST',
      headers: {
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
        'Content-Type':          'application/json',
        'Content-Length':        Buffer.byteLength(body),
      },
    }, body);

    const results = data.results;
    if (!Array.isArray(results) || !results.length) return null;

    const points = results[0].data;
    if (!Array.isArray(points) || points.length < 2) return null;

    // 전반부 = 이전 기간, 후반부 = 현재 기간
    const half    = Math.floor(points.length / 2);
    const prev    = points.slice(0, half);
    const current = points.slice(half);

    const avgOf = arr => arr.reduce((s, p) => s + safeNum(p.ratio), 0) / (arr.length || 1);
    const prevAvg = avgOf(prev);
    const curAvg  = avgOf(current);

    // division by zero 방어
    if (prevAvg === 0) return curAvg > 0 ? 100 : null;

    const changeRate = ((curAvg - prevAvg) / prevAvg) * 100;
    return Math.round(changeRate * 10) / 10;  // 소수점 1자리

  } catch (e) {
    console.warn('[datalab error]', keyword, e.message);
    return null;  // 실패 시 null → 기존 수량 기반 판정으로 fallback
  }
}

// ════════════════════════════════════════
// 재시도 래퍼
// ════════════════════════════════════════
async function fetchWithRetry(fn, retries = CONFIG.RETRY_COUNT) {
  try { return await fn(); }
  catch (e) {
    if (retries > 0) return fetchWithRetry(fn, retries - 1);
    return null;
  }
}

// ════════════════════════════════════════
// RESPONSE NORMALIZER
// ════════════════════════════════════════
function normalize(data, source) {
  if (!data || !Array.isArray(data.items)) return [];
  return data.items.map(item => ({
    source,
    title:       cleanText(item.title         || ''),
    link:        item.link                    || '',
    price:       safeNum(item.lprice || item.price, 0),
    pubDate:     item.pubdate || item.postdate || '',
    description: cleanText(item.description   || ''),
  })).filter(item => item.title.length > 0);
}

// ════════════════════════════════════════
// 기간 기반 아이템 필터링
// ════════════════════════════════════════
function filterByPeriod(items, startDate) {
  if (!startDate) return items;
  const since = new Date(startDate).getTime();
  return items.filter(item => {
    if (!item.pubDate) return true;   // 날짜 없으면 포함
    const t = new Date(item.pubDate).getTime();
    return isNaN(t) || t >= since;
  });
}

// ════════════════════════════════════════
// GROUPING
// ════════════════════════════════════════
function groupCandidates(items) {
  if (!Array.isArray(items) || !items.length) return [];
  const groups = new Map();

  items.forEach(item => {
    const kws = extractKeywords(item.title);
    if (!kws.length) return;
    const key = kws.slice(0, 2).sort().join('__');
    if (!groups.has(key)) {
      groups.set(key, { id: key, name: item.title, keywords: kws, items: [], sourcesSet: new Set() });
    }
    const g = groups.get(key);
    g.items.push(item);
    g.sourcesSet.add(item.source);
  });

  return Array.from(groups.values())
    .filter(g => g.items.length > 0)
    .map(g => ({
      id:       g.id,
      name:     g.name,
      keywords: g.keywords,
      count:    g.items.length,
      sources:  Array.from(g.sourcesSet),
      items:    g.items.slice(0, 5),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, CONFIG.MAX_CANDIDATES);
}

// ════════════════════════════════════════
// SCORE CALCULATOR
// ════════════════════════════════════════
function calcScore(group, allGroups) {
  const W        = CONFIG.SCORE_WEIGHTS;
  const maxCount = Math.max(...allGroups.map(g => g.count), 1);
  const bySource = src => group.items.filter(i => i.source === src).length;

  const breakdown = {
    shopping: group.sources.includes('shopping') ? Math.round((bySource('shopping') / Math.max(group.count, 1)) * W.shopping) : 0,
    blog:     group.sources.includes('blog')     ? Math.round((bySource('blog')     / Math.max(group.count, 1)) * W.blog)     : 0,
    news:     group.sources.includes('news')     ? Math.round((bySource('news')     / Math.max(group.count, 1)) * W.news)     : 0,
    cafe:     group.sources.includes('cafe')     ? Math.round((bySource('cafe')     / Math.max(group.count, 1)) * W.cafe)     : 0,
    trend:    Math.round((group.count / maxCount) * W.trend),
  };

  const totalScore = Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0));
  const grade      = totalScore >= CONFIG.GRADE.A ? 'A' : totalScore >= CONFIG.GRADE.B ? 'B' : 'C';
  const confidence = group.sources.length >= 3 ? 'high' : group.sources.length >= 2 ? 'medium' : 'low';

  return { totalScore, breakdown, grade, confidence };
}

// ════════════════════════════════════════
// TREND ANALYZER (Datalab 우선, fallback 수량 기반)
// ════════════════════════════════════════
function analyzeTrend(group, datalabRate) {
  const T = CONFIG.TREND;
  const R = CONFIG.CHANGE_RATE;

  // Datalab 변화율 있으면 우선 적용
  if (datalabRate !== null && datalabRate !== undefined) {
    if (datalabRate >= R.RISING)  return { status: T.RISING,  changeRate: datalabRate, source: 'datalab' };
    if (datalabRate <= R.FALLING) return { status: T.FALLING, changeRate: datalabRate, source: 'datalab' };
    return                               { status: T.STABLE,  changeRate: datalabRate, source: 'datalab' };
  }

  // Fallback: 수량 기반
  if (group.count === 1) return { status: T.NEW,     changeRate: null,  source: 'count' };
  if (group.count >= 8)  return { status: T.RISING,  changeRate: null,  source: 'count' };
  if (group.count >= 4)  return { status: T.STABLE,  changeRate: null,  source: 'count' };
  return                        { status: T.FALLING, changeRate: null,  source: 'count' };
}

// ════════════════════════════════════════
// SUMMARY GENERATOR
// ════════════════════════════════════════
function makeSummary(group, score, trend) {
  const A = CONFIG.ACTION;
  const statusLabel = {
    rising: '🔥 급상승', stable: '➡️ 보합',
    falling: '📉 하락',  new: '✨ 신규', unknown: '❓ 보류',
  };

  if (score.confidence === 'low') {
    return { summary: `${group.name} — 데이터 부족, 판단 보류`, action: A.HOLD };
  }

  const actionMap = { A: score.confidence === 'high' ? A.SHORTS : A.BLOG, B: A.BLOG, C: A.COMPARE };
  const action    = actionMap[score.grade] || A.HOLD;
  const label     = statusLabel[trend.status] || statusLabel.unknown;

  // 변화율 텍스트 (Datalab 기반일 때만 표시)
  const rateText = trend.source === 'datalab' && trend.changeRate !== null
    ? ` (${trend.changeRate > 0 ? '+' : ''}${trend.changeRate}%)`
    : '';

  return {
    summary: `${group.name} ${label}${rateText} · ${Math.round(score.totalScore)}점 · ${action.toUpperCase()} 추천`,
    action,
  };
}

// ════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try { validateEnv(); }
  catch (e) { return res.status(500).json({ error: e.message, code: 'ENV_ERROR' }); }

  const keyword   = String(req.query.keyword || CONFIG.DEFAULT_KEYWORD).trim().slice(0, 50);
  const display   = Math.min(safeNum(req.query.display, 20), 30);
  const period    = ['today', 'week', 'month'].includes(req.query.period) ? req.query.period : 'week';
  const dateRange = buildDateRange(period);

  try {
    // ── 1. 소스 병렬 수집
    const [shopping, blog, news, cafe] = await Promise.allSettled([
      fetchWithRetry(() => naverSearch('/v1/search/shop.json',        { query: keyword, display, sort: 'sim' })),
      fetchWithRetry(() => naverSearch('/v1/search/blog.json',        { query: keyword, display, sort: 'date' })),
      fetchWithRetry(() => naverSearch('/v1/search/news.json',        { query: keyword, display, sort: 'date' })),
      fetchWithRetry(() => naverSearch('/v1/search/cafearticle.json', { query: keyword, display })),
    ]);

    const get = r => r.status === 'fulfilled' ? r.value : null;

    // ── 2. 정규화 + 기간 필터
    const allItems = filterByPeriod([
      ...normalize(get(shopping), 'shopping'),
      ...normalize(get(blog),     'blog'),
      ...normalize(get(news),     'news'),
      ...normalize(get(cafe),     'cafe'),
    ], dateRange.startDate);

    if (!allItems.length) {
      return res.status(200).json({
        candidates: [], keyword, total: 0, period,
        message: `${period} 기간 내 수집된 결과가 없습니다.`,
        apiStatus: {
          shopping: shopping.status, blog: blog.status,
          news: news.status,         cafe: cafe.status,
        },
        updatedAt: new Date().toISOString(),
      });
    }

    // ── 3. 그룹핑
    const groups = groupCandidates(allItems);

    // ── 4. Datalab 변화율 — 상위 5개 그룹만 호출 (API 부하 방지)
    const datalabRates = {};
    await Promise.allSettled(
      groups.slice(0, 5).map(async g => {
        const rep = g.keywords[0] || g.name.split(' ')[0]; // 대표 키워드
        datalabRates[g.id] = await fetchDatalabChangeRate(rep, dateRange);
      })
    );

    // ── 5. 점수 → 트렌드 → 요약
    const candidates = groups.map(group => {
      const score  = calcScore(group, groups);
      const trend  = analyzeTrend(group, datalabRates[group.id] ?? null);
      const { summary, action } = makeSummary(group, score, trend);
      return {
        id:          group.id,
        name:        group.name,
        keywords:    group.keywords,
        sources:     group.sources,
        count:       group.count,
        score,
        trend,
        summary,
        action,
        sampleItems: group.items.slice(0, 3).map(i => ({
          title: i.title, link: i.link, source: i.source,
        })),
      };
    }).sort((a, b) => b.score.totalScore - a.score.totalScore);

    return res.status(200).json({
      candidates,
      keyword,
      period,
      dateRange: { start: dateRange.startDate, end: dateRange.endDate },
      total: candidates.length,
      apiStatus: {
        shopping: shopping.status, blog: blog.status,
        news: news.status,         cafe: cafe.status,
        datalab: Object.values(datalabRates).some(v => v !== null) ? 'fulfilled' : 'skipped',
      },
      updatedAt: new Date().toISOString(),
    });

  } catch (e) {
    console.error('[/api/discover]', e.message);
    return res.status(500).json({ error: '분석 중 오류가 발생했습니다.', detail: e.message, code: 'DISCOVER_ERROR' });
  }
};
