/**
 * /api/discover.js
 * 네이버 쇼핑·블로그·뉴스·카페 병렬 수집 → 제품군 그룹핑 → 점수 계산 → 결과 반환
 */

const https = require('https');

// ════════════════════════════════════════
// CONFIG (수정 시 이 블록만 변경)
// ════════════════════════════════════════
const CONFIG = {
  MAX_CANDIDATES: 30,
  API_TIMEOUT_MS: 8000,
  RETRY_COUNT: 1,
  DEFAULT_KEYWORD: '인기상품',
  SCORE_WEIGHTS: { shopping: 25, blog: 20, news: 10, cafe: 15, trend: 30 },
  GRADE: { A: 70, B: 50 },               // A: 70점 이상, B: 50점 이상, 나머지 C
  TREND: {
    RISING:  'rising',
    STABLE:  'stable',
    FALLING: 'falling',
    NEW:     'new',
    UNKNOWN: 'unknown',
  },
  ACTION: { SHORTS: 'shorts', BLOG: 'blog', HOLD: 'hold', COMPARE: 'compare' },
};

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

/** 숫자 변환 — NaN 방어 */
function safeNum(val, fallback = 0) {
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

/** HTML 태그·특수문자 제거 */
function cleanText(text = '') {
  return String(text)
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-zA-Z]+;/g, ' ')
    .replace(/[^\w가-힣\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 핵심 명사 추출 (불용어 제거) */
function extractKeywords(title = '') {
  const stopWords = new Set([
    '이', '가', '을', '를', '의', '에', '와', '과', '및', '또는',
    'the', 'a', 'an', 'of', 'for', 'in', 'on', 'at',
    '세트', '상품', '제품', '판매', '할인', '무료',
  ]);
  return cleanText(title)
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w))
    .slice(0, 5);
}

// ════════════════════════════════════════
// NAVER API CALLER
// ════════════════════════════════════════

/** 단일 네이버 API 호출 (timeout 포함) */
function naverCall(path, params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const options = {
      hostname: 'openapi.naver.com',
      path: `${path}?${qs}`,
      method: 'GET',
      headers: {
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      },
    };

    const timer = setTimeout(() => reject(new Error('API timeout')), CONFIG.API_TIMEOUT_MS);

    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ items: [] }); }
      });
    });

    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

/** 재시도 래퍼 */
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

/**
 * 소스별 응답을 통일 구조로 변환
 * @param {object|null} data  - 네이버 API 응답
 * @param {string} source     - 'shopping' | 'blog' | 'news' | 'cafe'
 * @returns {Array<{source, title, link, price, pubDate, description}>}
 */
function normalize(data, source) {
  if (!data || !Array.isArray(data.items)) return [];
  return data.items.map(item => ({
    source,
    title:       cleanText(item.title        || ''),
    link:        item.link                   || '',
    price:       safeNum(item.lprice || item.price, 0),
    mallName:    item.mallName               || '',
    pubDate:     item.pubdate || item.postdate || '',
    description: cleanText(item.description  || ''),
  })).filter(item => item.title.length > 0);
}

// ════════════════════════════════════════
// GROUPING
// ════════════════════════════════════════

/**
 * 유사 제품명을 하나의 대표 그룹으로 묶음
 * @param {Array} items - normalize() 결과 배열
 * @returns {Array<Group>}
 */
function groupCandidates(items) {
  if (!Array.isArray(items) || !items.length) return [];

  const groups = new Map();

  items.forEach(item => {
    const kws = extractKeywords(item.title);
    if (!kws.length) return;

    // 첫 2 키워드를 정렬하여 그룹 키로 사용
    const key = kws.slice(0, 2).sort().join('__');

    if (!groups.has(key)) {
      groups.set(key, {
        id:             key,
        name:           item.title,
        keywords:       kws,
        items:          [],
        sourcesSet:     new Set(),
      });
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

/**
 * 그룹별 트렌드 점수 계산 (breakdown 포함)
 * @param {object} group
 * @param {Array}  allGroups - 정규화 기준용
 * @returns {{ totalScore, breakdown, grade, confidence }}
 */
function calcScore(group, allGroups) {
  const W = CONFIG.SCORE_WEIGHTS;
  const maxCount = Math.max(...allGroups.map(g => g.count), 1);

  // 소스별 아이템 수
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
// TREND ANALYZER
// ════════════════════════════════════════

/**
 * 데이터 수 기반 단순 트렌드 판정
 * (실제 기간 비교 데이터 있으면 교체 가능)
 */
function analyzeTrend(group) {
  const T = CONFIG.TREND;
  if (group.count >= 8)  return { status: T.RISING,  changeRate:  0.30 };
  if (group.count >= 4)  return { status: T.STABLE,  changeRate:  0 };
  if (group.count === 1) return { status: T.NEW,     changeRate:  null };
  return                        { status: T.FALLING, changeRate: -0.10 };
}

// ════════════════════════════════════════
// SUMMARY GENERATOR
// ════════════════════════════════════════

/**
 * 사용자용 한 줄 결론 생성
 * 데이터 부족 시 과장 금지
 */
function makeSummary(group, score, trend) {
  const A = CONFIG.ACTION;
  const statusLabel = {
    rising: '🔥 급상승', stable: '➡️ 보합',
    falling: '📉 하락',  new: '✨ 신규', unknown: '❓ 보류',
  };

  if (score.confidence === 'low') {
    return {
      summary: `${group.name} — 데이터 부족, 판단 보류`,
      action:  A.HOLD,
      label:   statusLabel[trend.status] || statusLabel.unknown,
    };
  }

  const actionMap = {
    A: score.confidence === 'high' ? A.SHORTS : A.BLOG,
    B: A.BLOG,
    C: A.COMPARE,
  };
  const action = actionMap[score.grade] || A.HOLD;
  const label  = statusLabel[trend.status] || statusLabel.unknown;

  return {
    summary: `${group.name} ${label} · ${Math.round(score.totalScore)}점 · ${action.toUpperCase()} 추천`,
    action,
    label,
  };
}

// ════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ENV 검증
  try { validateEnv(); }
  catch (e) {
    return res.status(500).json({ error: e.message, code: 'ENV_ERROR' });
  }

  const keyword = String(req.query.keyword || CONFIG.DEFAULT_KEYWORD).trim().slice(0, 50);
  const display = Math.min(safeNum(req.query.display, 20), 30);

  try {
    // ── 병렬 수집 (부분 실패 허용)
    const [shopping, blog, news, cafe] = await Promise.allSettled([
      fetchWithRetry(() => naverCall('/v1/search/shop.json',        { query: keyword, display, sort: 'sim' })),
      fetchWithRetry(() => naverCall('/v1/search/blog.json',        { query: keyword, display, sort: 'date' })),
      fetchWithRetry(() => naverCall('/v1/search/news.json',        { query: keyword, display, sort: 'date' })),
      fetchWithRetry(() => naverCall('/v1/search/cafearticle.json', { query: keyword, display })),
    ]);

    const get = r => (r.status === 'fulfilled' ? r.value : null);

    const allItems = [
      ...normalize(get(shopping), 'shopping'),
      ...normalize(get(blog),     'blog'),
      ...normalize(get(news),     'news'),
      ...normalize(get(cafe),     'cafe'),
    ];

    if (!allItems.length) {
      return res.status(200).json({
        candidates: [],
        keyword,
        total: 0,
        message: '수집된 결과가 없습니다.',
        apiStatus: {
          shopping: shopping.status,
          blog:     blog.status,
          news:     news.status,
          cafe:     cafe.status,
        },
        updatedAt: new Date().toISOString(),
      });
    }

    // ── 그룹핑 → 점수 → 트렌드 → 요약
    const groups = groupCandidates(allItems);

    const candidates = groups.map(group => {
      const score  = calcScore(group, groups);
      const trend  = analyzeTrend(group);
      const { summary, action, label } = makeSummary(group, score, trend);
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
        trendLabel:  label,
        sampleItems: group.items.slice(0, 3).map(i => ({
          title:  i.title,
          link:   i.link,
          source: i.source,
        })),
      };
    }).sort((a, b) => b.score.totalScore - a.score.totalScore);

    return res.status(200).json({
      candidates,
      keyword,
      total: candidates.length,
      apiStatus: {
        shopping: shopping.status,
        blog:     blog.status,
        news:     news.status,
        cafe:     cafe.status,
      },
      updatedAt: new Date().toISOString(),
    });

  } catch (e) {
    console.error('[/api/discover]', e.message);
    return res.status(500).json({
      error:  '분석 중 오류가 발생했습니다.',
      detail: e.message,
      code:   'DISCOVER_ERROR',
    });
  }
};
