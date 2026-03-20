/**
 * /api/auto-discover.js
 *
 * mode=category : 카테고리 인기키워드 TOP N → Datalab 변화율 → 점수화
 * mode=rising   : 복수 카테고리 모니터링 → 급상승(threshold%) 키워드만 반환
 * mode=seed     : 시드 키워드 → 연관 검색어 확장 → 전체 점수화
 */

const https = require('https');

// ════════════════════════════════════════
// CONFIG (배점/기준 수정 시 이 블록만)
// ════════════════════════════════════════
const CFG = {
  TIMEOUT_MS:     8000,
  RETRY:          1,
  MAX_KEYWORDS:   20,   // 카테고리에서 가져올 인기 키워드 수
  MAX_CANDIDATES: 30,   // 최종 결과 최대 수
  DATALAB_LIMIT:  10,   // Datalab 호출할 키워드 수 (API 부하 제한)
  SCORE: { shopping:25, blog:20, news:10, cafe:15, trend:30 },
  GRADE: { A:70, B:50 },
  CHANGE: { RISING:10, FALLING:-10 },  // 변화율 % 기준
  DEFAULT_PERIOD: 'week',
};

// ════════════════════════════════════════
// ENV
// ════════════════════════════════════════
function checkEnv() {
  const miss = ['NAVER_CLIENT_ID','NAVER_CLIENT_SECRET'].filter(k => !process.env[k]);
  if (miss.length) throw new Error('환경변수 누락: ' + miss.join(', '));
}

// ════════════════════════════════════════
// DATE RANGE
// ════════════════════════════════════════
function buildRange(period = 'week') {
  const fmt = d => d.toISOString().slice(0, 10);
  const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
  const now = new Date();
  if (period === 'today')
    return { startDate:fmt(now),    endDate:fmt(now),   prevStart:fmt(ago(1)),  prevEnd:fmt(ago(1)),  unit:'date' };
  if (period === 'month')
    return { startDate:fmt(ago(29)),endDate:fmt(now),   prevStart:fmt(ago(59)), prevEnd:fmt(ago(30)), unit:'week' };
  // week (기본)
  return   { startDate:fmt(ago(6)), endDate:fmt(now),   prevStart:fmt(ago(13)), prevEnd:fmt(ago(7)),  unit:'date' };
}

// ════════════════════════════════════════
// HTTP 헬퍼
// ════════════════════════════════════════
function httpCall(options, body = null) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), CFG.TIMEOUT_MS);
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { clearTimeout(t); try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    });
    req.on('error', e => { clearTimeout(t); reject(e); });
    if (body) req.write(body);
    req.end();
  });
}

function naverGet(path, params) {
  return httpCall({
    hostname: 'openapi.naver.com',
    path: `${path}?${new URLSearchParams(params)}`,
    method: 'GET',
    headers: { 'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET },
  });
}

function naverPost(path, bodyObj) {
  const body = JSON.stringify(bodyObj);
  return httpCall({
    hostname: 'openapi.naver.com',
    path,
    method: 'POST',
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
}

async function withRetry(fn, n = CFG.RETRY) {
  try { return await fn(); }
  catch (e) { if (n > 0) return withRetry(fn, n - 1); return null; }
}

// ════════════════════════════════════════
// TEXT UTILS
// ════════════════════════════════════════
function clean(text = '') {
  return String(text).replace(/<[^>]+>/g, '').replace(/&\w+;/g, ' ')
    .replace(/[^\w가-힣\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// 광고/스팸 패턴
const AD_RE   = /\[광고\]|\[협찬\]|쿠폰|특가|이벤트|당일배송|무료배송|사은품|AD\b/i;
const SPAM_RE = /(.)\1{4,}|[\u3040-\u30FF]|[\u4E00-\u9FFF]|https?:\/\//;

function isClean(title = '') {
  return title.length >= 2 && !AD_RE.test(title) && !SPAM_RE.test(title);
}

function safeNum(v, fb = 0) { const n = Number(v); return isNaN(n) ? fb : n; }

// ════════════════════════════════════════
// 1. 카테고리 인기키워드 수집
//    Naver Shopping Insight / 쇼핑인사이트
// ════════════════════════════════════════
async function fetchCategoryKeywords(categoryId) {
  const data = await withRetry(() =>
    naverGet('/v1/datalab/shopping/category/keywords', {
      startDate: new Date(Date.now() - 7*86400000).toISOString().slice(0,10),
      endDate:   new Date().toISOString().slice(0,10),
      timeUnit:  'date',
      category:  categoryId,
      device:    '',
      gender:    '',
      ages:      '',
    })
  );
  // 응답에서 키워드 목록 추출 (API 버전마다 구조 상이 — 방어 처리)
  const items = data?.results?.[0]?.data || data?.keywords || data?.data || [];
  return Array.isArray(items) ? items.slice(0, CFG.MAX_KEYWORDS).map(i => i.keyword || i.name || i.title || String(i)).filter(Boolean) : [];
}

// 대안: /api/keywords 엔드포인트 (기존 proxy 활용)
async function fetchKeywordsViaProxy(categoryId) {
  const res = await withRetry(() =>
    naverPost('/v1/datalab/shopping/category/keywords', {
      startDate: new Date(Date.now() - 7*86400000).toISOString().slice(0,10),
      endDate:   new Date().toISOString().slice(0,10),
      timeUnit:  'week',
      category:  categoryId,
      device:    '', gender:    '', ages:      '',
    })
  );
  const raw = res?.results?.[0]?.data || [];
  return Array.isArray(raw) ? raw.slice(0, CFG.MAX_KEYWORDS).map(i => i.keyword || String(i)).filter(Boolean) : [];
}

// ════════════════════════════════════════
// 2. Datalab 검색량 변화율
// ════════════════════════════════════════
async function getDatalabRate(keyword, range) {
  try {
    const data = await naverPost('/v1/datalab/search', {
      startDate: range.prevStart,
      endDate:   range.endDate,
      timeUnit:  range.unit,
      keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
    });
    const pts = data?.results?.[0]?.data;
    if (!Array.isArray(pts) || pts.length < 2) return null;
    const h = Math.floor(pts.length / 2);
    const avg = arr => arr.reduce((s, p) => s + safeNum(p.ratio), 0) / (arr.length || 1);
    const prev = avg(pts.slice(0, h));
    const cur  = avg(pts.slice(h));
    if (prev === 0) return cur > 0 ? 100 : null;
    return Math.round(((cur - prev) / prev) * 1000) / 10;  // 소수점 1자리
  } catch { return null; }
}

// ════════════════════════════════════════
// 3. 네이버 검색 (쇼핑/블로그/뉴스/카페)
// ════════════════════════════════════════
async function searchAll(keyword, display = 15) {
  const [sh, bl, nw, ca] = await Promise.allSettled([
    withRetry(() => naverGet('/v1/search/shop.json',        { query: keyword, display, sort: 'sim' })),
    withRetry(() => naverGet('/v1/search/blog.json',        { query: keyword, display, sort: 'date' })),
    withRetry(() => naverGet('/v1/search/news.json',        { query: keyword, display, sort: 'date' })),
    withRetry(() => naverGet('/v1/search/cafearticle.json', { query: keyword, display })),
  ]);
  const get = r => r.status === 'fulfilled' ? r.value : null;
  const norm = (d, src) => {
    if (!d?.items?.length) return [];
    return d.items
      .map(i => ({ source: src, title: clean(i.title||''), link: i.link||'', price: safeNum(i.lprice||i.price,0), pubDate: i.pubdate||i.postdate||'' }))
      .filter(i => isClean(i.title) && (src !== 'shopping' || i.price > 0));
  };
  return {
    items: [...norm(get(sh),'shopping'), ...norm(get(bl),'blog'), ...norm(get(nw),'news'), ...norm(get(ca),'cafe')],
    status: { shopping: sh.status, blog: bl.status, news: nw.status, cafe: ca.status },
  };
}

// ════════════════════════════════════════
// 4. 시드 키워드 연관어 확장
//    네이버 쇼핑 검색 결과에서 자주 등장하는 단어 추출
// ════════════════════════════════════════
async function expandSeedKeywords(seedKw, depth = 1) {
  const stopWords = new Set(['이','가','을','를','의','에','는','은','도','와','과','및','또는','세트','상품','제품','판매','구매','추천','리뷰','후기']);

  // 1차: 쇼핑 검색으로 연관 제품명 수집
  const r1 = await withRetry(() => naverGet('/v1/search/shop.json', { query: seedKw, display: 20, sort: 'sim' }));
  const titles = (r1?.items || []).map(i => clean(i.title || '')).filter(Boolean);

  // 제목에서 명사 토큰 빈도 계산
  const freq = {};
  titles.forEach(t => {
    t.split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w) && w !== seedKw).forEach(w => {
      freq[w] = (freq[w] || 0) + 1;
    });
  });

  // 빈도 상위 키워드 추출
  const related = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0, 8).map(([w]) => w);

  let expanded = [seedKw, ...related];

  // 2단계: 연관어 각각에 대해 다시 한 번 확장
  if (depth >= 2 && related.length > 0) {
    const deeper = await Promise.allSettled(
      related.slice(0, 3).map(kw =>
        withRetry(() => naverGet('/v1/search/shop.json', { query: kw, display: 10, sort: 'sim' }))
      )
    );
    deeper.forEach(r => {
      if (r.status === 'fulfilled' && r.value?.items) {
        r.value.items.forEach(i => {
          clean(i.title||'').split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w)).forEach(w => {
            if (!expanded.includes(w)) expanded.push(w);
          });
        });
      }
    });
    expanded = [...new Set(expanded)].slice(0, 15);
  }

  return expanded;
}

// ════════════════════════════════════════
// 점수 계산
// ════════════════════════════════════════
function calcScore(items, allCandidates) {
  const W = CFG.SCORE;
  const maxCount = Math.max(...allCandidates.map(c => c._count), 1);
  const cnt = src => items.filter(i => i.source === src).length;
  const total = items.length || 1;

  const breakdown = {
    shopping: Math.round((cnt('shopping') / total) * W.shopping),
    blog:     Math.round((cnt('blog')     / total) * W.blog),
    news:     Math.round((cnt('news')     / total) * W.news),
    cafe:     Math.round((cnt('cafe')     / total) * W.cafe),
    trend:    Math.round((items.length / maxCount) * W.trend),
  };

  const totalScore = Math.min(100, Object.values(breakdown).reduce((a,b)=>a+b,0));
  const srcs = [...new Set(items.map(i => i.source))];
  return {
    totalScore,
    breakdown,
    grade:      totalScore >= CFG.GRADE.A ? 'A' : totalScore >= CFG.GRADE.B ? 'B' : 'C',
    confidence: srcs.length >= 3 ? 'high' : srcs.length >= 2 ? 'medium' : 'low',
  };
}

// ════════════════════════════════════════
// 트렌드 판정
// ════════════════════════════════════════
function judgeT(count, rate) {
  const T = CFG.CHANGE;
  if (rate !== null && rate !== undefined) {
    if (rate >= T.RISING)  return { status:'rising',  changeRate: rate, source:'datalab' };
    if (rate <= T.FALLING) return { status:'falling', changeRate: rate, source:'datalab' };
    return                        { status:'stable',  changeRate: rate, source:'datalab' };
  }
  if (count === 1) return { status:'new',     changeRate:null, source:'count' };
  if (count >= 8)  return { status:'rising',  changeRate:null, source:'count' };
  if (count >= 4)  return { status:'stable',  changeRate:null, source:'count' };
  return                  { status:'falling', changeRate:null, source:'count' };
}

// ════════════════════════════════════════
// 한 줄 결론
// ════════════════════════════════════════
function makeSummary(name, score, trend) {
  const ACTIONS = { shorts:'shorts', blog:'blog', hold:'hold', compare:'compare' };
  if (score.confidence === 'low') return { summary:`${name} — 데이터 부족, 판단 보류`, action:ACTIONS.hold };

  const action = score.grade==='A' && score.confidence==='high' ? ACTIONS.shorts
               : score.grade==='A' ? ACTIONS.blog
               : score.grade==='B' ? ACTIONS.blog : ACTIONS.compare;

  const rateText = trend.source==='datalab' && trend.changeRate!=null
    ? ` (${trend.changeRate>0?'+':''}${trend.changeRate}%)`
    : '';
  const statusLabel = { rising:'🔥 급상승', stable:'➡️ 보합', falling:'📉 하락', new:'✨ 신규', unknown:'❓ 보류' };

  return {
    summary: `${name} ${statusLabel[trend.status]||''}${rateText} · ${Math.round(score.totalScore)}점 · ${action.toUpperCase()} 추천`,
    action,
  };
}

// ════════════════════════════════════════
// 키워드 배열 → 후보 생성 공통 로직
// ════════════════════════════════════════
async function buildCandidates(keywords, range, filterFn = null) {
  if (!keywords.length) return { candidates: [], apiStatus: {} };

  // 검색 병렬 실행
  const searchResults = await Promise.allSettled(
    keywords.slice(0, CFG.MAX_CANDIDATES).map(kw => searchAll(kw, 15))
  );

  // Datalab 변화율 (상위 DATALAB_LIMIT개만)
  const datalabRates = {};
  await Promise.allSettled(
    keywords.slice(0, CFG.DATALAB_LIMIT).map(async kw => {
      datalabRates[kw] = await getDatalabRate(kw, range);
    })
  );

  // 후보 목록 생성 (임시 _count 포함)
  const rawCandidates = keywords.map((kw, i) => {
    const r = searchResults[i];
    const items = r.status==='fulfilled' ? (r.value?.items || []) : [];
    return { kw, items, _count: items.length };
  }).filter(c => c._count > 0);

  // 점수 계산
  const candidates = rawCandidates.map(c => {
    const score  = calcScore(c.items, rawCandidates);
    const trend  = judgeT(c._count, datalabRates[c.kw] ?? null);
    const { summary, action } = makeSummary(c.kw, score, trend);
    const srcs = [...new Set(c.items.map(i => i.source))];
    return { id: c.kw, name: c.kw, keywords: [c.kw], sources: srcs, count: c._count, score, trend, summary, action,
      sampleItems: c.items.slice(0, 3).map(i => ({ title:i.title, link:i.link, source:i.source })) };
  });

  // 외부 필터 적용 (급상승 모드용 threshold 등)
  const filtered = filterFn ? candidates.filter(filterFn) : candidates;

  return {
    candidates: filtered.sort((a,b)=>b.score.totalScore-a.score.totalScore).slice(0, CFG.MAX_CANDIDATES),
    apiStatus: {
      ...Object.fromEntries(keywords.slice(0,4).map((kw,i)=>[`search_${i}`, searchResults[i]?.status])),
      datalab: Object.values(datalabRates).some(v=>v!==null) ? 'fulfilled' : 'skipped',
    },
  };
}

// ════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try { checkEnv(); }
  catch (e) { return res.status(500).json({ error: e.message, code: 'ENV_ERROR' }); }

  const mode   = req.query.mode   || 'category';
  const period = ['today','week','month'].includes(req.query.period) ? req.query.period : CFG.DEFAULT_PERIOD;
  const range  = buildRange(period);

  try {
    // ── MODE 1: 카테고리 자동탐색
    if (mode === 'category') {
      const catId = req.query.categoryId || '50000003';
      let keywords = await fetchKeywordsViaProxy(catId);

      // fallback: 키워드 못 가져오면 기본값
      if (!keywords.length) keywords = ['무선청소기','에어프라이어','마사지건','공기청정기','안마의자'];

      const { candidates, apiStatus } = await buildCandidates(keywords, range);
      return res.status(200).json({ candidates, mode, categoryId: catId, period, total: candidates.length, apiStatus, updatedAt: new Date().toISOString() });
    }

    // ── MODE 2: 급상승 모니터링
    if (mode === 'rising') {
      const cats      = (req.query.categories || '50000003,50000002,50000008').split(',');
      const threshold = safeNum(req.query.threshold, CFG.CHANGE.RISING);

      // 여러 카테고리 키워드 병합
      const kwSets = await Promise.allSettled(cats.map(c => fetchKeywordsViaProxy(c)));
      let allKws = [...new Set(kwSets.flatMap(r => r.status==='fulfilled' ? r.value : []))].slice(0, 40);

      if (!allKws.length) allKws = ['무선청소기','에어프라이어','마사지건','공기청정기','로봇청소기'];

      // threshold 이상만 통과 (Datalab rate 기준)
      const { candidates, apiStatus } = await buildCandidates(allKws, range,
        c => c.trend?.changeRate !== null && c.trend?.changeRate >= threshold
      );
      return res.status(200).json({ candidates, mode, threshold, period, total: candidates.length, apiStatus, updatedAt: new Date().toISOString() });
    }

    // ── MODE 3: 시드 키워드 확장
    if (mode === 'seed') {
      const seedKw = String(req.query.keyword || '').trim().slice(0, 30);
      if (!seedKw) return res.status(400).json({ error: '키워드를 입력해주세요', code: 'NO_KEYWORD' });
      const depth  = Math.min(safeNum(req.query.depth, 1), 2);

      const keywords = await expandSeedKeywords(seedKw, depth);
      const { candidates, apiStatus } = await buildCandidates(keywords, range);
      return res.status(200).json({ candidates, mode, seedKeyword: seedKw, expandedKeywords: keywords, period, total: candidates.length, apiStatus, updatedAt: new Date().toISOString() });
    }

    return res.status(400).json({ error: '알 수 없는 mode', code: 'INVALID_MODE' });

  } catch (e) {
    console.error('[auto-discover]', e.message);
    return res.status(500).json({ error: '탐색 중 오류가 발생했습니다.', detail: e.message, code: 'SERVER_ERROR' });
  }
};
