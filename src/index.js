// ============================================================
// Naver Product Discovery Pipeline
// Node.js | Vercel-ready | Modular Architecture
// ============================================================

import axios from 'axios';
import NodeCache from 'node-cache';

// ─── Config ─────────────────────────────────────────────────
const CONFIG = {
  NAVER_CLIENT_ID:     process.env.NAVER_CLIENT_ID,
  NAVER_CLIENT_SECRET: process.env.NAVER_CLIENT_SECRET,
  DATALAB_API_KEY:     process.env.NAVER_DATALAB_API_KEY,   // DataLab 전용 키
  CACHE_TTL_SEC:       3600,
  RETRY_MAX:           3,
  RETRY_DELAY_MS:      800,
  RATE_LIMIT_MS:       300,   // API 호출 간격
};

// ─── Logger ─────────────────────────────────────────────────
const log = {
  info:  (...a) => console.log ('[INFO] ', ...a),
  warn:  (...a) => console.warn ('[WARN] ', ...a),
  error: (...a) => console.error('[ERROR]', ...a),
  debug: (...a) => process.env.DEBUG && console.log('[DEBUG]', ...a),
};

// ─── Cache ──────────────────────────────────────────────────
const cache = new NodeCache({ stdTTL: CONFIG.CACHE_TTL_SEC });

// ─── Utilities ──────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, label = '') {
  for (let i = 0; i < CONFIG.RETRY_MAX; i++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = i === CONFIG.RETRY_MAX - 1;
      log.warn(`${label} retry ${i + 1}/${CONFIG.RETRY_MAX} – ${err.message}`);
      if (isLast) throw err;
      await sleep(CONFIG.RETRY_DELAY_MS * (i + 1));
    }
  }
}

function cached(key, fn) {
  const hit = cache.get(key);
  if (hit !== undefined) { log.debug('cache hit:', key); return Promise.resolve(hit); }
  return fn().then(v => { cache.set(key, v); return v; });
}

// ─── Date Helpers ───────────────────────────────────────────
function getDateRange(monthsBack = 12) {
  const end   = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - monthsBack);
  const fmt = d => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

// ============================================================
// A. CANDIDATE DISCOVERY LAYER
// ============================================================

/**
 * Naver Search API 호출 (shopping / blog / news)
 */
async function searchNaver(query, display = 20, type = 'shop') {
  const key = `search:${type}:${query}`;
  return cached(key, () => withRetry(async () => {
    await sleep(CONFIG.RATE_LIMIT_MS);
    const url = type === 'shop'
      ? 'https://openapi.naver.com/v1/search/shop.json'
      : type === 'blog'
      ? 'https://openapi.naver.com/v1/search/blog.json'
      : 'https://openapi.naver.com/v1/search/news.json';

    const res = await axios.get(url, {
      params: { query, display, start: 1, sort: 'sim' },
      headers: {
        'X-Naver-Client-Id':     CONFIG.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': CONFIG.NAVER_CLIENT_SECRET,
      },
    });
    return res.data?.items ?? [];
  }, `searchNaver:${type}:${query}`));
}

/**
 * 시드 카테고리 → 쇼핑/블로그 검색으로 후보 키워드 수집
 */
async function discoverCandidates(seedCategories) {
  log.info('▶ 후보 키워드 발굴 시작');
  const rawKeywords = new Set();

  for (const seed of seedCategories) {
    // 쇼핑 결과에서 상품명 추출
    const shopItems = await searchNaver(seed, 30, 'shop');
    for (const item of shopItems) {
      const title = item.title?.replace(/<[^>]+>/g, '').trim();
      if (title) extractProductKeywords(title).forEach(k => rawKeywords.add(k));
    }

    // 블로그에서 추천/리뷰 키워드 추출
    const blogItems = await searchNaver(`${seed} 추천`, 20, 'blog');
    for (const item of blogItems) {
      const desc = (item.description || '').replace(/<[^>]+>/g, '');
      extractProductKeywords(desc).forEach(k => rawKeywords.add(k));
    }
  }

  const normalized = normalizeKeywords([...rawKeywords]);
  log.info(`  → 후보 ${normalized.length}개 확보`);
  return normalized;
}

// ─── Keyword Normalization ───────────────────────────────────

const STOP_WORDS = new Set([
  '추천','후기','리뷰','최고','인기','판매','구매','직구','할인','가격',
  '비교','사용법','방법','이유','효과','장점','단점','브랜드','정품',
]);
const NON_PRODUCT_PATTERN = /^(뉴스|연예|정치|사건|사고|스포츠|날씨|증시|주가)/;

/**
 * 원시 텍스트에서 상품성 키워드 추출
 */
function extractProductKeywords(text) {
  // 2~8글자 명사 패턴 (한글 + 영문 혼용 허용)
  const tokens = text.match(/[가-힣a-zA-Z0-9][가-힣a-zA-Z0-9\s]{1,10}/g) ?? [];
  return tokens
    .map(t => t.trim())
    .filter(t => t.length >= 2 && t.length <= 12)
    .filter(t => !STOP_WORDS.has(t))
    .filter(t => !NON_PRODUCT_PATTERN.test(t));
}

/**
 * 키워드 정규화 & 중복 제거
 */
function normalizeKeywords(keywords) {
  const seen = new Set();
  return keywords
    .map(k => k.toLowerCase().replace(/\s+/g, ' ').trim())
    .filter(k => k.length >= 2)
    .filter(k => { if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 200); // DataLab quota 보호
}

// ============================================================
// B. TREND VALIDATION LAYER
// ============================================================

/**
 * DataLab Search Trend API
 */
async function getSearchTrend(keywords, segmentation = {}) {
  const key = `trend:${keywords.join(',')}`;
  return cached(key, () => withRetry(async () => {
    await sleep(CONFIG.RATE_LIMIT_MS);
    const { startDate, endDate } = getDateRange(12);

    const body = {
      startDate, endDate,
      timeUnit: 'month',
      keywordGroups: keywords.slice(0, 5).map(k => ({
        groupName: k,
        keywords: [k],
      })),
      ...segmentation,
    };

    const res = await axios.post(
      'https://openapi.naver.com/v1/datalab/search',
      body,
      {
        headers: {
          'X-Naver-Client-Id':     CONFIG.NAVER_CLIENT_ID,
          'X-Naver-Client-Secret': CONFIG.NAVER_CLIENT_SECRET,
          'Content-Type':          'application/json',
        },
      }
    );
    return res.data?.results ?? [];
  }, `getSearchTrend:${keywords[0]}`));
}

/**
 * 트렌드 수치 분석
 */
function analyzeTrend(results) {
  const analysis = {};

  for (const group of results) {
    const name   = group.title;
    const values = group.data.map(d => d.ratio).filter(v => v != null);
    if (values.length < 3) {
      analysis[name] = { latest_value: 0, avg_3m: 0, prev_3m: 0, growth_rate: 0, volatility: 0 };
      continue;
    }

    const latest_value = values[values.length - 1];
    const avg_3m  = mean(values.slice(-3));
    const prev_3m = mean(values.slice(-6, -3));
    const growth_rate = prev_3m === 0 ? 0 : (avg_3m - prev_3m) / prev_3m;
    const volatility  = stddev(values.slice(-6));

    analysis[name] = { latest_value, avg_3m, prev_3m, growth_rate, volatility };
  }
  return analysis;
}

// ============================================================
// C. SHOPPING INTENT VALIDATION LAYER
// ============================================================

// 네이버 쇼핑 카테고리 매핑 (주요 카테고리만)
const CATEGORY_MAP = {
  '50000000': '패션의류',    '50000001': '패션잡화',
  '50000002': '화장품/미용', '50000003': '디지털/가전',
  '50000004': '가구/인테리어','50000005': '식품',
  '50000006': '스포츠/레저', '50000007': '생활/건강',
  '50000008': '여가/생활편의',
};

/**
 * 키워드 → 추정 카테고리 ID 매핑
 */
function mapToCategory(keyword) {
  const rules = [
    [/폰|노트북|태블릿|이어폰|스피커|키보드|마우스/, '50000003'],
    [/크림|세럼|마스크팩|선크림|파운데이션|립/, '50000002'],
    [/의자|책상|침대|소파|선반|조명/, '50000004'],
    [/단백질|비타민|홍삼|유산균|다이어트/, '50000007'],
    [/운동화|레깅스|요가|덤벨|헬스/, '50000006'],
    [/에어프라이어|커피|냄비|도마|밀키트/, '50000005'],
  ];
  for (const [regex, catId] of rules) {
    if (regex.test(keyword)) return catId;
  }
  return '50000007'; // fallback: 생활/건강
}

/**
 * DataLab Shopping Insight – 키워드 트렌드
 */
async function getShoppingInsight(keyword, categoryId) {
  const key = `shopping:${categoryId}:${keyword}`;
  return cached(key, () => withRetry(async () => {
    await sleep(CONFIG.RATE_LIMIT_MS);
    const { startDate, endDate } = getDateRange(6);

    const body = {
      startDate, endDate,
      timeUnit:   'month',
      category:   categoryId,
      keyword:    [{ name: keyword, param: [keyword] }],
      device:     '',
      gender:     '',
      ages:       [],
    };

    const res = await axios.post(
      'https://openapi.naver.com/v1/datalab/shopping/category/keyword/ratio',
      body,
      {
        headers: {
          'X-Naver-Client-Id':     CONFIG.NAVER_CLIENT_ID,
          'X-Naver-Client-Secret': CONFIG.NAVER_CLIENT_SECRET,
          'Content-Type':          'application/json',
        },
      }
    );
    return res.data?.results?.[0]?.data ?? [];
  }, `getShoppingInsight:${keyword}`));
}

/**
 * 쇼핑 세그먼트 분석 (디바이스/성별/연령)
 */
async function getShoppingSegments(keyword, categoryId) {
  const segments = { device: {}, gender: {}, age: {} };

  // Device
  for (const device of ['mo', 'pc']) {
    try {
      await sleep(CONFIG.RATE_LIMIT_MS);
      const data = await getShoppingInsightByDimension(keyword, categoryId, { device });
      segments.device[device] = mean(data.map(d => d.ratio));
    } catch { segments.device[device] = 0; }
  }

  // Gender
  for (const gender of ['f', 'm']) {
    try {
      await sleep(CONFIG.RATE_LIMIT_MS);
      const data = await getShoppingInsightByDimension(keyword, categoryId, { gender });
      segments.gender[gender] = mean(data.map(d => d.ratio));
    } catch { segments.gender[gender] = 0; }
  }

  return segments;
}

async function getShoppingInsightByDimension(keyword, categoryId, dimension) {
  const { startDate, endDate } = getDateRange(3);
  const body = {
    startDate, endDate,
    timeUnit: 'month',
    category: categoryId,
    keyword:  [{ name: keyword, param: [keyword] }],
    device:   dimension.device  ?? '',
    gender:   dimension.gender  ?? '',
    ages:     dimension.ages    ?? [],
  };
  const res = await axios.post(
    'https://openapi.naver.com/v1/datalab/shopping/category/keyword/ratio',
    body,
    {
      headers: {
        'X-Naver-Client-Id':     CONFIG.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': CONFIG.NAVER_CLIENT_SECRET,
        'Content-Type':          'application/json',
      },
    }
  );
  return res.data?.results?.[0]?.data ?? [];
}

// ============================================================
// D. MARKET QUALITY VALIDATION LAYER
// ============================================================

async function assessMarketQuality(keyword) {
  const items = await searchNaver(keyword, 20, 'shop');
  if (!items.length) return { score: 0, reason: 'no_products' };

  // 브랜드 다양성 (HHI 역수)
  const brands = items.map(i => i.mallName ?? 'unknown');
  const brandCounts = {};
  brands.forEach(b => { brandCounts[b] = (brandCounts[b] ?? 0) + 1; });
  const hhi = Object.values(brandCounts).reduce((s, c) => s + (c / brands.length) ** 2, 0);
  const diversity = 1 - hhi; // 높을수록 다양

  // 가격대 충동구매 적합성 (1만~10만원)
  const prices = items
    .map(i => parseInt(i.lprice ?? 0))
    .filter(p => p > 0);
  const avgPrice = mean(prices);
  const priceScore = avgPrice >= 10000 && avgPrice <= 100000 ? 1
                   : avgPrice > 100000 && avgPrice <= 300000 ? 0.6 : 0.3;

  // 리뷰 수 (소비자 검증)
  const avgReview = mean(items.map(i => parseInt(i.reviewCount ?? 0)));
  const reviewScore = Math.min(avgReview / 500, 1);

  // 비주얼 데모 가능성 (제품명에 물리적 키워드 존재)
  const visualHint = /기계|기기|도구|제품|장치|폰|노트북|패드|카메라|청소|조리/.test(keyword);

  const score = (diversity * 0.3) + (priceScore * 0.3) + (reviewScore * 0.2) + (visualHint ? 0.2 : 0);
  return { score: round(score), diversity, avgPrice, avgReview, visualHint };
}

// ============================================================
// E. SCORING LAYER
// ============================================================

function computeFinalScore(metrics) {
  const {
    trend, shopping_intent, category_strength,
    content_friendly, market_quality,
  } = metrics;

  // 트렌드 강도 (0~1)
  const trendStrength = Math.min((trend.latest_value ?? 0) / 100, 1);

  // 최근 성장률 점수
  const growthScore = trend.growth_rate > 0.2  ? 1.0
                    : trend.growth_rate > 0.0   ? 0.7
                    : trend.growth_rate > -0.1  ? 0.4
                    : 0.1;

  const final_score =
    (trendStrength      * 0.25) +
    (growthScore        * 0.20) +
    (shopping_intent    * 0.25) +
    (category_strength  * 0.10) +
    (content_friendly   * 0.10) +
    (market_quality     * 0.10);

  return round(final_score);
}

// ============================================================
// RANKING & OUTPUT
// ============================================================

function rankCandidates(scored) {
  return scored
    .filter(c => c.validation_result === 'PASS')
    .sort((a, b) => b.final_score - a.final_score);
}

function buildValidationResult(metrics) {
  const { trend, shopping_intent, market_quality } = metrics;
  if ((trend.latest_value ?? 0) < 5)  return 'FAIL:weak_trend';
  if (trend.growth_rate < -0.3)        return 'FAIL:declining';
  if (shopping_intent < 0.2)           return 'FAIL:no_intent';
  if (market_quality < 0.2)            return 'FAIL:poor_market';
  return 'PASS';
}

// ============================================================
// MAIN PIPELINE
// ============================================================

export async function runPipeline(seedCategories = DEFAULT_SEEDS) {
  log.info('=== Naver Product Discovery Pipeline START ===');
  const results = [];

  // A. 후보 발굴
  const candidates = await discoverCandidates(seedCategories);
  log.info(`총 후보: ${candidates.length}개`);

  // B+C+D. 배치로 분석 (DataLab quota 보호: 5개씩)
  for (let i = 0; i < candidates.length; i += 5) {
    const batch = candidates.slice(i, i + 5);
    log.info(`분석 중 ${i + 1}~${i + batch.length} / ${candidates.length}`);

    // B. 트렌드
    let trendData = {};
    try {
      const raw = await getSearchTrend(batch);
      trendData = analyzeTrend(raw);
    } catch (e) { log.warn('트렌드 분석 실패:', e.message); }

    for (const kw of batch) {
      const trend = trendData[kw] ?? { latest_value: 0, avg_3m: 0, prev_3m: 0, growth_rate: 0, volatility: 0 };
      const catId = mapToCategory(kw);
      const catName = CATEGORY_MAP[catId] ?? '기타';

      // C. 쇼핑 인텐트
      let shoppingData = [], shoppingIntentScore = 0, segments = {};
      try {
        shoppingData = await getShoppingInsight(kw, catId);
        shoppingIntentScore = round(Math.min(mean(shoppingData.map(d => d.ratio)) / 50, 1));
        segments = await getShoppingSegments(kw, catId);
      } catch (e) { log.warn(`쇼핑 인사이트 실패 [${kw}]:`, e.message); }

      // D. 마켓 퀄리티
      let mq = { score: 0 };
      try { mq = await assessMarketQuality(kw); } catch (e) { log.warn('마켓 퀄리티 실패:', e.message); }

      // 카테고리 강도 (최근 쇼핑 평균)
      const categoryStrength = round(Math.min(mean(shoppingData.slice(-3).map(d => d.ratio)) / 50, 1));

      // 콘텐츠 적합성
      const contentFriendly = computeContentFriendly(kw, mq);

      const metrics = {
        trend,
        shopping_intent:   shoppingIntentScore,
        category_strength: categoryStrength,
        content_friendly:  contentFriendly,
        market_quality:    mq.score,
      };

      const validation_result = buildValidationResult(metrics);
      const final_score = computeFinalScore(metrics);

      results.push({
        keyword:                kw,
        mapped_category:        catName,
        latest_value:           round(trend.latest_value),
        avg_3m:                 round(trend.avg_3m),
        prev_3m:                round(trend.prev_3m),
        growth_rate:            round(trend.growth_rate, 3),
        volatility:             round(trend.volatility, 3),
        shopping_intent_score:  shoppingIntentScore,
        category_strength_score:categoryStrength,
        content_friendly_score: contentFriendly,
        market_quality_score:   mq.score,
        final_score,
        validation_result,
        segments,
        market_detail: mq,
      });
    }

    await sleep(500); // 배치 간 휴식
  }

  const ranked = rankCandidates(results);
  const report = buildReport(ranked, results);
  log.info(`=== Pipeline 완료 | PASS: ${ranked.length} / 전체: ${results.length} ===`);
  return report;
}

// ─── Content Friendly Score ──────────────────────────────────
function computeContentFriendly(keyword, mq) {
  let score = 0;
  if (mq.visualHint)   score += 0.4;
  if (mq.avgPrice >= 10000 && mq.avgPrice <= 150000) score += 0.3;
  if (mq.diversity > 0.5) score += 0.3; // 비교 가능한 상품 다양성
  return round(score);
}

// ─── Report Builder ──────────────────────────────────────────
function buildReport(ranked, all) {
  const top10 = ranked.slice(0, 10);

  return {
    summary: {
      total_candidates:  all.length,
      passed:            ranked.length,
      failed:            all.length - ranked.length,
      top_keyword:       top10[0]?.keyword ?? 'N/A',
      generated_at:      new Date().toISOString(),
    },
    ranking_table: ranked.map((r, i) => ({
      rank: i + 1,
      keyword:                  r.keyword,
      mapped_category:          r.mapped_category,
      latest_value:             r.latest_value,
      avg_3m:                   r.avg_3m,
      prev_3m:                  r.prev_3m,
      growth_rate:              r.growth_rate,
      volatility:               r.volatility,
      shopping_intent_score:    r.shopping_intent_score,
      category_strength_score:  r.category_strength_score,
      content_friendly_score:   r.content_friendly_score,
      market_quality_score:     r.market_quality_score,
      final_score:              r.final_score,
      validation_result:        r.validation_result,
    })),
    top10_insights: top10.map(r => ({
      keyword: r.keyword,
      reason_passed: buildReason(r),
      strongest_device: maxKey(r.segments?.device ?? {}),
      strongest_gender: maxKey(r.segments?.gender ?? {}),
      market_avg_price: r.market_detail?.avgPrice,
    })),
    failed_summary: all
      .filter(r => r.validation_result !== 'PASS')
      .map(r => ({ keyword: r.keyword, reason: r.validation_result })),
  };
}

function buildReason(r) {
  const parts = [];
  if (r.growth_rate > 0.1)           parts.push(`최근 3개월 ${(r.growth_rate * 100).toFixed(0)}% 성장`);
  if (r.shopping_intent_score > 0.6) parts.push('쇼핑 클릭 인텐트 강함');
  if (r.content_friendly_score > 0.6)parts.push('Shorts/블로그 시각화 적합');
  if (r.market_quality_score > 0.6)  parts.push('브랜드 다양성·충동구매 가격대 양호');
  return parts.join(' / ') || '종합 점수 기준 통과';
}

// ─── Math Utils ──────────────────────────────────────────────
function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length || 1));
}
function round(v, d = 2) { return Math.round(v * 10 ** d) / 10 ** d; }
function maxKey(obj) { return Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'; }

// ─── Default Seeds ───────────────────────────────────────────
const DEFAULT_SEEDS = [
  '생활가전', '뷰티', '건강식품', '홈인테리어', '운동용품',
  '주방용품', '디지털기기', '반려동물', '다이어트',
];

export default runPipeline;
