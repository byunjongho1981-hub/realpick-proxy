/**
 * /api/auto-discover.js
 */
const https = require('https');

// ════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════
const CFG = {
  TIMEOUT_MS:     9000,
  RETRY:          1,
  MAX_KW_PER_CAT: 15,
  MAX_CANDIDATES: 30,
  DATALAB_LIMIT:  8,
  SCORE: { shopping:25, blog:20, news:10, cafe:15, trend:30 },
  GRADE: { A:70, B:50 },
  CHANGE: { RISING:10, FALLING:-10 },
  DEFAULT_PERIOD: 'week',
};

// 카테고리 처리 순서 고정
const CAT_ORDER = [
  '50000003','50000002','50000008','50000007','50000006',
  '50000004','50000005','50000000','50000001','50000009',
  '50000010','50000011','50000012','50000013','50000014',
];

const CAT_NAMES = {
  '50000000':'패션의류','50000001':'패션잡화','50000002':'화장품/미용',
  '50000003':'디지털/가전','50000004':'가구/인테리어','50000005':'출산/육아',
  '50000006':'식품','50000007':'스포츠/레저','50000008':'생활/건강',
  '50000009':'도서/음반','50000010':'완구/취미','50000011':'문구/오피스',
  '50000012':'반려동물','50000013':'자동차용품','50000014':'여행/티켓',
};

// 고정 시드 (일관성 보장)
const CAT_SEEDS = {
  '50000000':['원피스','청바지','맨투맨','후드티','코트','니트','슬랙스','레깅스'],
  '50000001':['운동화','크로스백','반지갑','선글라스','벨트','토트백','백팩','스니커즈'],
  '50000002':['선크림','토너패드','비타민C세럼','쿠션팩트','클렌징폼','레티놀크림','앰플','선스틱'],
  '50000003':['무선이어폰','로봇청소기','공기청정기','스마트워치','에어프라이어','노트북','블루투스스피커','무선충전기'],
  '50000004':['스탠딩책상','패브릭소파','간접조명','수납장','침대프레임','커튼','러그','원목침대'],
  '50000005':['기저귀','분유','아기물티슈','유모차','유아식판','아기띠','젖병소독기','아기세제'],
  '50000006':['단백질쉐이크','그래놀라','닭가슴살','견과류','오트밀','그릭요거트','프로틴바','콜라겐'],
  '50000007':['요가매트','러닝화','등산스틱','헬스장갑','폼롤러','덤벨세트','등산화','캠핑텐트'],
  '50000008':['마사지건','안마의자','혈압계','유산균','콜라겐','전동칫솔','경추베개','족욕기'],
  '50000009':['베스트셀러소설','자기계발서','영어회화책','그림책','만화책','독서대','북스탠드','e북리더'],
  '50000010':['레고','보드게임','RC카','피규어','퍼즐','드론','모형키트','미니어처'],
  '50000011':['무선마우스','기계식키보드','모니터암','책상정리함','포스트잇','바인더','라벨프린터','USB허브'],
  '50000012':['강아지사료','고양이사료','펫패드','하네스','고양이모래','강아지간식','펫캐리어','자동급식기'],
  '50000013':['차량용방향제','하이패스단말기','블랙박스','차량용충전기','세차용품','카매트','주차알림판','타이어공기압'],
  '50000014':['캐리어','여행파우치','목베개','여행용품','숙박권','항공권','렌터카','여행보험'],
};

// 전체 탐색 캐시 (24시간)
const ALL_CACHE = { data:null, updatedAt:null, TTL_MS: 24*60*60*1000 };
function getAllCache() {
  if (!ALL_CACHE.data) return null;
  if (Date.now() - ALL_CACHE.updatedAt > ALL_CACHE.TTL_MS) return null;
  return ALL_CACHE.data;
}
function setAllCache(data) { ALL_CACHE.data = data; ALL_CACHE.updatedAt = Date.now(); }

// ════════════════════════════════════════
// ENV
// ════════════════════════════════════════
function checkEnv() {
  const miss = ['NAVER_CLIENT_ID','NAVER_CLIENT_SECRET'].filter(k => !process.env[k]);
  if (miss.length) throw new Error('환경변수 누락: ' + miss.join(', '));
}

// ════════════════════════════════════════
// 날짜 범위
// ════════════════════════════════════════
function buildRange(period) {
  const fmt = d => d.toISOString().slice(0,10);
  const ago = n => { const d = new Date(); d.setDate(d.getDate()-n); return d; };
  const now = new Date();
  if (period === 'today') return { start:fmt(now),    end:fmt(now),   prevStart:fmt(ago(1)),  prevEnd:fmt(ago(1)),  unit:'date' };
  if (period === 'month') return { start:fmt(ago(29)),end:fmt(now),   prevStart:fmt(ago(59)), prevEnd:fmt(ago(30)), unit:'week' };
  return                         { start:fmt(ago(6)), end:fmt(now),   prevStart:fmt(ago(13)), prevEnd:fmt(ago(7)),  unit:'date' };
}

// ════════════════════════════════════════
// HTTP
// ════════════════════════════════════════
function httpCall(opts, body) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), CFG.TIMEOUT_MS);
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { clearTimeout(t); try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    });
    req.on('error', e => { clearTimeout(t); reject(e); });
    if (body) req.write(body);
    req.end();
  });
}

const HEADERS = () => ({
  'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
  'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
});

function naverGet(path, params) {
  const qs = new URLSearchParams(params).toString();
  return httpCall({ hostname:'openapi.naver.com', path:`${path}?${qs}`, method:'GET', headers:HEADERS() });
}

function naverPost(path, bodyObj) {
  const body = JSON.stringify(bodyObj);
  return httpCall({
    hostname:'openapi.naver.com', path, method:'POST',
    headers:{ ...HEADERS(), 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
  }, body);
}

async function withRetry(fn, n) {
  if (n === undefined) n = CFG.RETRY;
  try { return await fn(); }
  catch(e) { if (n > 0) return withRetry(fn, n-1); return null; }
}

// ════════════════════════════════════════
// 텍스트 정제
// ════════════════════════════════════════
function clean(text) {
  return String(text||'').replace(/<[^>]+>/g,'').replace(/&\w+;/g,' ')
    .replace(/[^\w가-힣\s]/g,' ').replace(/\s+/g,' ').trim();
}
const AD_RE   = /\[광고\]|\[협찬\]|쿠폰|특가|이벤트|당일배송|무료배송|사은품/i;
const SPAM_RE = /(.)\1{4,}|[\u3040-\u30FF]|[\u4E00-\u9FFF]|https?:\/\//;
function isClean(t) { return t.length >= 2 && !AD_RE.test(t) && !SPAM_RE.test(t); }
function safeNum(v, fb) { if (fb === undefined) fb = 0; const n = Number(v); return isNaN(n) ? fb : n; }

// ════════════════════════════════════════
// Datalab 카테고리 키워드
// ════════════════════════════════════════
async function fetchCatKeywords(categoryId) {
  const range = buildRange('week');
  try {
    const data = await withRetry(() => naverPost('/v1/datalab/shopping/category/keywords', {
      startDate:range.start, endDate:range.end, timeUnit:'date',
      category:categoryId, device:'', gender:'', ages:[],
    }));
    if (!data || !Array.isArray(data.results) || !data.results.length) return null;
    const scored = data.results.map(r => {
      const pts = Array.isArray(r.data) ? r.data : [];
      const avg = pts.length ? pts.reduce((s,p) => s + safeNum(p.ratio), 0) / pts.length : 0;
      const kw = Array.isArray(r.keyword) ? r.keyword[0] : (r.title || r.keyword || '');
      return { kw: String(kw).trim(), avg };
    }).filter(x => x.kw.length > 0);
    scored.sort((a,b) => b.avg - a.avg);
    return scored.slice(0, CFG.MAX_KW_PER_CAT).map(x => x.kw);
  } catch(e) {
    return null;
  }
}

// ════════════════════════════════════════
// Datalab 변화율
// ════════════════════════════════════════
async function getDatalabRate(keyword, range) {
  try {
    const data = await naverPost('/v1/datalab/search', {
      startDate:range.prevStart, endDate:range.end, timeUnit:range.unit,
      keywordGroups:[{ groupName:keyword, keywords:[keyword] }],
    });
    const pts = data && data.results && data.results[0] && data.results[0].data;
    if (!Array.isArray(pts) || pts.length < 2) return null;
    const half = Math.floor(pts.length/2);
    const avg = arr => arr.reduce((s,p) => s + safeNum(p.ratio), 0) / (arr.length||1);
    const prev = avg(pts.slice(0, half));
    const cur  = avg(pts.slice(half));
    if (prev === 0) return cur > 0 ? 100 : null;
    return Math.round(((cur-prev)/prev)*1000)/10;
  } catch { return null; }
}

// ════════════════════════════════════════
// 일반 검색 (개별 카테고리용)
// ════════════════════════════════════════
async function searchAll(keyword, catId) {
  const shopParams = { query:keyword, display:15, sort:'sim' };
  if (catId && catId !== 'all') shopParams.category = catId;
  const catLabel = (catId && CAT_NAMES[catId]) ? CAT_NAMES[catId] : '';
  const blogQuery = catLabel ? keyword+' '+catLabel : keyword;

  const [sh,bl,nw,ca] = await Promise.allSettled([
    withRetry(() => naverGet('/v1/search/shop.json',        shopParams)),
    withRetry(() => naverGet('/v1/search/blog.json',        { query:blogQuery, display:15, sort:'date' })),
    withRetry(() => naverGet('/v1/search/news.json',        { query:keyword,   display:10, sort:'date' })),
    withRetry(() => naverGet('/v1/search/cafearticle.json', { query:keyword,   display:10 })),
  ]);
  const get = r => r.status === 'fulfilled' ? r.value : null;
  const norm = (d, src) => {
    if (!d || !Array.isArray(d.items) || !d.items.length) return [];
    return d.items
      .map(i => ({ source:src, title:clean(i.title||''), link:i.link||'', price:safeNum(i.lprice||i.price,0), pubDate:i.pubdate||i.postdate||'' }))
      .filter(i => isClean(i.title) && (src !== 'shopping' || i.price > 0));
  };
  return {
    items: [...norm(get(sh),'shopping'),...norm(get(bl),'blog'),...norm(get(nw),'news'),...norm(get(ca),'cafe')],
    status: { shopping:sh.status, blog:bl.status, news:nw.status, cafe:ca.status },
  };
}

// ════════════════════════════════════════
// 시드 확장
// ════════════════════════════════════════
async function expandSeed(seedKw, depth) {
  const STOP = new Set(['이','가','을','를','의','에','는','은','도','와','과','및','세트','상품','제품','판매','구매','추천','리뷰','후기']);
  const r1 = await withRetry(() => naverGet('/v1/search/shop.json', { query:seedKw, display:20, sort:'sim' }));
  const freq = {};
  ((r1&&r1.items)||[]).forEach(i => {
    clean(i.title||'').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w) && w !== seedKw)
      .forEach(w => { freq[w] = (freq[w]||0) + 1; });
  });
  const related = Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0,8).map(([w]) => w);
  let expanded = [seedKw, ...related];
  if (depth >= 2 && related.length) {
    const d2 = await Promise.allSettled(related.slice(0,3).map(kw => withRetry(() => naverGet('/v1/search/shop.json', { query:kw, display:10, sort:'sim' }))));
    d2.forEach(r => {
      if (r.status === 'fulfilled' && r.value && r.value.items) {
        r.value.items.forEach(i => {
          clean(i.title||'').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w))
            .forEach(w => { if (!expanded.includes(w)) expanded.push(w); });
        });
      }
    });
  }
  return [...new Set(expanded)].slice(0, 15);
}

// ════════════════════════════════════════
// 점수 계산 (고정 공식 — 변경 금지)
// ════════════════════════════════════════
function calcScore(items, maxCount) {
  const W = CFG.SCORE;
  const tot = items.length || 1;
  const cnt = src => items.filter(i => i.source === src).length;
  const breakdown = {
    shopping: Math.round((cnt('shopping')/tot) * W.shopping),
    blog:     Math.round((cnt('blog')    /tot) * W.blog),
    news:     Math.round((cnt('news')    /tot) * W.news),
    cafe:     Math.round((cnt('cafe')    /tot) * W.cafe),
    trend:    Math.round((items.length / maxCount) * W.trend),
  };
  const totalScore = Math.min(100, Object.values(breakdown).reduce((a,b) => a+b, 0));
  const srcs = [...new Set(items.map(i => i.source))];
  return {
    totalScore, breakdown,
    grade:      totalScore >= CFG.GRADE.A ? 'A' : totalScore >= CFG.GRADE.B ? 'B' : 'C',
    confidence: srcs.length >= 3 ? 'high' : srcs.length >= 2 ? 'medium' : 'low',
  };
}

function judgeT(count, rate) {
  if (rate !== null && rate !== undefined) {
    if (rate >= CFG.CHANGE.RISING)  return { status:'rising',  changeRate:rate, source:'datalab' };
    if (rate <= CFG.CHANGE.FALLING) return { status:'falling', changeRate:rate, source:'datalab' };
    return                                 { status:'stable',  changeRate:rate, source:'datalab' };
  }
  if (count === 1) return { status:'new',     changeRate:null, source:'count' };
  if (count >= 8)  return { status:'rising',  changeRate:null, source:'count' };
  if (count >= 4)  return { status:'stable',  changeRate:null, source:'count' };
  return                  { status:'falling', changeRate:null, source:'count' };
}

function makeSummary(name, score, trend) {
  if (score.confidence === 'low') return { summary:`${name} — 데이터 부족, 판단 보류`, action:'hold' };
  const action = score.grade==='A' && score.confidence==='high' ? 'shorts'
               : score.grade==='A' ? 'blog'
               : score.grade==='B' ? 'blog' : 'compare';
  const rateText = trend.source==='datalab' && trend.changeRate!=null
    ? ` (${trend.changeRate>0?'+':''}${trend.changeRate}%)` : '';
  const labels = { rising:'🔥 급상승', stable:'➡️ 보합', falling:'📉 하락', new:'✨ 신규', unknown:'❓ 보류' };
  return { summary:`${name} ${labels[trend.status]||''}${rateText} · ${Math.round(score.totalScore)}점 · ${action.toUpperCase()} 추천`, action };
}

// ════════════════════════════════════════
// 일반 후보 빌드 (개별 카테고리)
// ════════════════════════════════════════
async function buildCandidates(keywords, range, catId) {
  if (!Array.isArray(keywords) || !keywords.length) return { candidates:[], apiStatus:{} };
  const unique = [...new Set(keywords.map(k => String(k).trim()).filter(Boolean))].slice(0, 40);
  if (!unique.length) return { candidates:[], apiStatus:{} };

  const searches = await Promise.allSettled(unique.map(kw => searchAll(kw, catId)));
  const rates = {};
  await Promise.allSettled(
    unique.slice(0, CFG.DATALAB_LIMIT).map(async kw => { rates[kw] = await getDatalabRate(kw, range); })
  );

  const valid = unique.map((kw,i) => {
    const r = searches[i];
    const items = r.status==='fulfilled' && r.value ? (r.value.items||[]) : [];
    return { kw, items, count:items.length };
  }).filter(c => c.count > 0);

  if (!valid.length) return { candidates:[], apiStatus:{ search:'결과 없음' } };

  const maxCount = Math.max(...valid.map(c => c.count), 1);
  const candidates = valid.map(c => {
    const score = calcScore(c.items, maxCount);
    const trend = judgeT(c.count, rates[c.kw] != null ? rates[c.kw] : null);
    const { summary, action } = makeSummary(c.kw, score, trend);
    return {
      id: c.kw, name:c.kw, keywords:[c.kw],
      sources:[...new Set(c.items.map(i => i.source))],
      count:c.count, score, trend, summary, action,
      sampleItems: c.items.slice(0,3).map(i => ({ title:i.title, link:i.link, source:i.source })),
    };
  });

  return {
    candidates: candidates.sort((a,b) => b.score.totalScore - a.score.totalScore).slice(0, CFG.MAX_CANDIDATES),
    apiStatus: {
      search:  searches.filter(r => r.status==='fulfilled').length + '/' + unique.length + ' 성공',
      datalab: Object.values(rates).some(v => v !== null) ? 'fulfilled' : 'skipped',
    },
  };
}

// ════════════════════════════════════════
// 전체 탐색 전용 함수
// 규칙: 카테고리 순서 고정 / 전수 처리 / 누락 기록 / 동일 점수 공식 / 카테고리당 최소 5개 후보
// ════════════════════════════════════════
async function searchAllCategories(range) {
  const completed  = [];  // 완료된 카테고리
  const failed     = [];  // 실패한 카테고리 + 사유
  const allPool    = [];  // 전체 후보 풀

  // CAT_ORDER 순서 고정 — 순차 처리
  for (const catId of CAT_ORDER) {
    const catName = CAT_NAMES[catId] || catId;
    console.log('[전체탐색] 처리 시작:', catName);

    try {
      // 1. 키워드 수집 — 고정 seed 사용 (일관성 보장)
      const baseKws  = (CAT_SEEDS[catId] || []).slice(0, 5);
      const keywords = baseKws.length >= 5 ? baseKws : (CAT_SEEDS[catId] || []);

      if (!keywords.length) {
        failed.push({ catId, catName, reason:'시드 키워드 없음' });
        continue;
      }

      // 2. 카테고리 독립 검색 (쇼핑 + 블로그)
      const catItems = [];
      for (const kw of keywords) {
        try {
          const [sh, bl] = await Promise.allSettled([
            withRetry(() => naverGet('/v1/search/shop.json', { query:kw, display:10, sort:'sim', category:catId })),
            withRetry(() => naverGet('/v1/search/blog.json', { query:kw+' '+catName, display:10, sort:'date' })),
          ]);
          const shopItems = (sh.status==='fulfilled' && sh.value && Array.isArray(sh.value.items))
            ? sh.value.items.map(i => ({ source:'shopping', kw, title:clean(i.title||''), link:i.link||'', price:safeNum(i.lprice||i.price,0) }))
                             .filter(i => isClean(i.title) && i.price > 0)
            : [];
          const blogItems = (bl.status==='fulfilled' && bl.value && Array.isArray(bl.value.items))
            ? bl.value.items.map(i => ({ source:'blog', kw, title:clean(i.title||''), link:i.link||'', price:0 }))
                             .filter(i => isClean(i.title))
            : [];
          catItems.push(...shopItems, ...blogItems);
        } catch(e) {
          console.warn('[전체탐색]', catName, kw, '검색 실패:', e.message);
        }
      }

      if (!catItems.length) {
        failed.push({ catId, catName, reason:'검색 결과 없음' });
        continue;
      }

      // 3. 카테고리 내 키워드별 그룹핑
      const kwGroups = {};
      catItems.forEach(item => {
        if (!kwGroups[item.kw]) kwGroups[item.kw] = [];
        kwGroups[item.kw].push(item);
      });

      // 4. 카테고리 내 점수 계산 (고정 공식 동일 적용)
      const kwList   = Object.keys(kwGroups);
      const maxInCat = Math.max(...kwList.map(kw => kwGroups[kw].length), 1);

      const catCandidates = kwList.map(kw => {
        const items = kwGroups[kw];
        const score = calcScore(items, maxInCat);
        const trend = judgeT(items.length, null);
        const { summary, action } = makeSummary(kw, score, trend);
        return {
          id:       catId + '__' + kw,
          name:     kw,
          category: catName,
          catId,
          keywords: [kw],
          sources:  [...new Set(items.map(i => i.source))],
          count:    items.length,
          score, trend, summary, action,
          sampleItems: items.slice(0,3).map(i => ({ title:i.title, link:i.link, source:i.source })),
        };
      });

      // 카테고리별 점수순 정렬 → 상위 5개 전체 풀에 추가 (최소 5개 규칙)
      catCandidates.sort((a,b) => b.score.totalScore - a.score.totalScore);
      const top5 = catCandidates.slice(0, 5);
      allPool.push(...top5);

      completed.push({ catId, catName, candidates: top5.length });
      console.log('[전체탐색] 완료:', catName, '→ 후보', top5.length, '개');

    } catch(e) {
      failed.push({ catId, catName, reason: e.message || '알 수 없는 오류' });
      console.error('[전체탐색] 실패:', catName, e.message);
    }
  }

  // 5. 종합 재평가 — 동일 고정 공식으로 전체 재점수화
  const globalMax = Math.max(...allPool.map(c => c.count), 1);
  allPool.forEach(c => {
    const W = CFG.SCORE;
    const shopCnt = c.sources.includes('shopping') ? Math.round(c.count * 0.65) : 0;
    const blogCnt = c.sources.includes('blog')     ? Math.round(c.count * 0.35) : 0;
    const newBreakdown = {
      shopping: Math.round((shopCnt / Math.max(c.count,1)) * W.shopping),
      blog:     Math.round((blogCnt / Math.max(c.count,1)) * W.blog),
      news:     0,
      cafe:     0,
      trend:    Math.round((c.count / globalMax) * W.trend),
    };
    const newTotal = Math.min(100, Object.values(newBreakdown).reduce((a,b) => a+b, 0));
    c.score.totalScore = newTotal;
    c.score.breakdown  = newBreakdown;
    c.score.grade      = newTotal >= CFG.GRADE.A ? 'A' : newTotal >= CFG.GRADE.B ? 'B' : 'C';
  });

  // 6. 최종 정렬 → 상위 10개
  allPool.sort((a,b) => b.score.totalScore - a.score.totalScore);
  const top10 = allPool.slice(0, 10);

  return {
    candidates: top10,
    apiStatus: {
      completed: completed.length + '/' + CAT_ORDER.length + ' 카테고리',
      failed:    failed.length > 0
        ? failed.map(f => f.catName + '(' + f.reason + ')').join(', ')
        : '없음',
    },
    processLog: {
      completed: completed.map(c => c.catName + '(' + c.candidates + '개)'),
      failed:    failed.map(f => ({ name:f.catName, reason:f.reason })),
    },
  };
}

// ════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try { checkEnv(); }
  catch(e) { return res.status(500).json({ error:e.message, code:'ENV_ERROR' }); }

  const mode   = req.query.mode   || 'category';
  const period = ['today','week','month'].includes(req.query.period) ? req.query.period : CFG.DEFAULT_PERIOD;
  const range  = buildRange(period);

  try {
    // ── 카테고리 모드
    if (mode === 'category') {
      const catId = req.query.categoryId || '50000003';

      // 전체 탐색
      if (catId === 'all') {
        const cached = getAllCache();
        if (cached) {
          return res.status(200).json({
            ...cached,
            fromCache: true,
            cacheAge:  Math.round((Date.now() - ALL_CACHE.updatedAt) / 1000) + '초 전',
          });
        }

        const { candidates, apiStatus, processLog } = await searchAllCategories(range);
        const result = {
          candidates, mode,
          categoryId:'all', categoryName:'전체',
          period, total:candidates.length,
          apiStatus, processLog,
          updatedAt: new Date().toISOString(),
          fromCache: false,
        };
        setAllCache(result);
        return res.status(200).json(result);
      }

      // 개별 카테고리
      let keywords = await fetchCatKeywords(catId);
      if (!Array.isArray(keywords) || !keywords.length) {
        keywords = CAT_SEEDS[catId] || CAT_SEEDS['50000003'];
      }
      const { candidates, apiStatus } = await buildCandidates(keywords, range, catId);
      return res.status(200).json({
        candidates, mode,
        categoryId:catId, categoryName:CAT_NAMES[catId]||catId,
        keywords, period, total:candidates.length,
        apiStatus, updatedAt:new Date().toISOString(),
      });
    }

    // ── 시드 모드
    if (mode === 'seed') {
      const seedKw = String(req.query.keyword||'').trim().slice(0,30);
      if (!seedKw) return res.status(400).json({ error:'키워드를 입력해주세요', code:'NO_KEYWORD' });
      const depth = Math.min(safeNum(req.query.depth,1), 2);
      const keywords = await expandSeed(seedKw, depth);
      const { candidates, apiStatus } = await buildCandidates(keywords, range, null);
      return res.status(200).json({
        candidates, mode,
        seedKeyword:seedKw, expandedKeywords:keywords,
        period, total:candidates.length,
        apiStatus, updatedAt:new Date().toISOString(),
      });
    }

    return res.status(400).json({ error:'알 수 없는 mode', code:'INVALID_MODE' });

  } catch(e) {
    console.error('[auto-discover]', e.message, e.stack);
    return res.status(500).json({ error:'탐색 중 오류가 발생했습니다.', detail:e.message, code:'SERVER_ERROR' });
  }
};
