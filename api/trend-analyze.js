'use strict';

const CFG     = require('./_trend-config');
const SCORE   = require('./_trend-score');
const NAVER   = require('./_trend-naver');
const YOUTUBE = require('./_trend-youtube');
const GROQ    = require('./_trend-groq');
const GEMINI  = require('./_trend-gemini');

// ══════════════════════════════════════════════════════════════════
// UTIL
// ══════════════════════════════════════════════════════════════════
const sleep   = ms => new Promise(r => setTimeout(r, ms));
const safeNum = v  => (isNaN(Number(v)) ? 0 : Number(v));
const normKw  = kw => (kw || '').toLowerCase().replace(/\s+/g, '');

async function fetchWithTimeout(url, ms = 6000, extraHeaders = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent'      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language' : 'ko-KR,ko;q=0.9',
        'Accept'          : 'text/html,application/xhtml+xml,*/*',
        ...extraHeaders,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

// ══════════════════════════════════════════════════════════════════
// LAYER 0 — HISTORY STORE  (Vercel KV → 인메모리 fallback)
// ══════════════════════════════════════════════════════════════════
let KV = null;
try { KV = require('@vercel/kv'); } catch (_) { /* KV 없음 → 메모리 사용 */ }
const MEM = {};

async function kvGet(key) {
  try { return KV ? await KV.get(key) : (MEM[key] ?? null); }
  catch (_) { return null; }
}
async function kvSet(key, val, ex = 691200 /* 8일 */) {
  try {
    if (KV) await KV.set(key, val, { ex });
    else     MEM[key] = val;
  } catch (_) {}
}

async function historyGet(kw) {
  const raw = await kvGet('h:' + kw);
  if (!raw) return [];
  try { return Array.isArray(raw) ? raw : JSON.parse(raw); }
  catch (_) { return []; }
}
async function historyPush(kw, value) {
  const hist    = await historyGet(kw);
  const cutoff  = Date.now() - 8 * 86_400_000;
  const trimmed = hist.filter(h => h.ts > cutoff);
  trimmed.push({ ts: Date.now(), v: value });
  await kvSet('h:' + kw, JSON.stringify(trimmed));
  return trimmed;
}

// ══════════════════════════════════════════════════════════════════
// LAYER 1 — PPOMPPU RSS  (선행 커뮤니티 신호)
// ══════════════════════════════════════════════════════════════════
const PPOMPPU_FEEDS = [
  'https://www.ppomppu.co.kr/rss.php?id=ppomppu',
  'https://www.ppomppu.co.kr/rss.php?id=ppomppu4',
];

async function fetchPpomppuSignals() {
  const counter = {};

  for (const url of PPOMPPU_FEEDS) {
    try {
      const resp = await fetchWithTimeout(url, 6000);
      if (!resp.ok) continue;
      const xml = await resp.text();

      // CDATA 유무 양쪽 대응
      const rx = /<title[^>]*>(?:<!\[CDATA\[)?\s*(.*?)\s*(?:\]\]>)?<\/title>/gis;
      for (const m of xml.matchAll(rx)) {
        const raw = m[1]
          .replace(/\[.*?\]/g, '')          // [게시판] 제거
          .replace(/\(.*?원.*?\)/g, '')      // (12,000원) 제거
          .replace(/https?:\/\/\S+/g, '')   // URL 제거
          .replace(/\d+[%원]/g, '')          // 숫자+단위 제거
          .replace(/[^\w가-힣\s]/g, ' ')
          .trim();

        const words = raw.split(/\s+/).filter(w => w.length >= 2 && !/^\d+$/.test(w));
        if (!words.length) continue;
        const keyword = words.slice(0, 3).join(' ').trim();
        if (keyword.length < 2) continue;
        counter[keyword] = (counter[keyword] || 0) + 1;
      }
    } catch (e) {
      console.warn('[ppomppu]', e.message);
    }
    await sleep(200);
  }

  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([keyword, count]) => ({ keyword, count, source: 'ppomppu' }));
}

// ══════════════════════════════════════════════════════════════════
// LAYER 2 — COUPANG RANKING  (실구매 랭킹 변화)
// ══════════════════════════════════════════════════════════════════
const COUPANG_CATS = [
  { name: '가전디지털', url: 'https://www.coupang.com/np/categories/497045' },
  { name: '뷰티',       url: 'https://www.coupang.com/np/categories/115573' },
  { name: '생활건강',   url: 'https://www.coupang.com/np/categories/194052' },
  { name: '식품',       url: 'https://www.coupang.com/np/categories/393760' },
  { name: '스포츠',     url: 'https://www.coupang.com/np/categories/203045' },
];

async function fetchCoupangRankings(catLimit = 3) {
  const results = [];

  for (const cat of COUPANG_CATS.slice(0, catLimit)) {
    try {
      const resp = await fetchWithTimeout(cat.url, 9000);
      if (!resp.ok) continue;
      const html = await resp.text();

      // data-product-name 우선, 없으면 class="name" fallback
      const nameRx = /data-product-name="([^"]{4,60})"/g;
      const altRx  = /class="name[^"]*"[^>]*>\s*([^<]{4,60})\s*</g;
      const rx     = html.match(/data-product-name=/) ? nameRx : altRx;

      let rank = 1;
      for (const m of html.matchAll(rx)) {
        const name = m[1].replace(/\s+/g, ' ').trim();
        if (name.length >= 2) {
          results.push({ keyword: name, rank, category: cat.name, source: 'coupang' });
          if (++rank > 10) break;
        }
      }
    } catch (e) {
      console.warn('[coupang]', cat.name, e.message);
    }
    await sleep(400);
  }

  return results;
}

// ══════════════════════════════════════════════════════════════════
// LAYER 3 — NAVER AUTOCOMPLETE  (실시간 구매의도 확인)
// ══════════════════════════════════════════════════════════════════
const BUY_SUFFIXES  = ['추천', '후기', '구매', '비교'];
const INFO_SUFFIXES = ['가격', '쿠팡'];

async function fetchAutoCompleteSignal(keyword) {
  let buyHits = 0, totalHits = 0;

  for (const sfx of [...BUY_SUFFIXES, ...INFO_SUFFIXES]) {
    try {
      const url  = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(keyword + ' ' + sfx)}&st=100&frm=nv&r_format=json&r_enc=UTF-8&lang=ko`;
      const resp = await fetchWithTimeout(url, 3000);
      if (!resp.ok) continue;
      const data  = await resp.json();
      const items = data.items?.[0] ?? [];
      if (items.length > 0) {
        totalHits++;
        if (BUY_SUFFIXES.includes(sfx)) buyHits++;
      }
    } catch (_) {}
    await sleep(50);
  }

  return { buyHits, totalHits, hasPurchaseIntent: buyHits >= 2 };
}

// ══════════════════════════════════════════════════════════════════
// LAYER 4 — Z-SCORE + MOMENTUM ENGINE
// ══════════════════════════════════════════════════════════════════
function calcZScore(hist) {
  if (!hist || hist.length < 2) return 0;
  const vals = hist.map(h => h.v);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std  = Math.sqrt(vals.map(v => (v - mean) ** 2).reduce((a, b) => a + b, 0) / vals.length);
  if (std === 0) return 0;
  return (vals[vals.length - 1] - mean) / std;
}

function calcMomentum(hist) {
  if (!hist || hist.length < 2) return 0;
  const now = Date.now();
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const slice = (from, to) => hist.filter(h => now - h.ts >= from && now - h.ts < to).map(h => h.v);

  const v0 = avg(slice(0,          86_400_000));       // 오늘
  const v3 = avg(slice(86_400_000 * 2, 86_400_000 * 4)); // 3일전
  const v7 = avg(slice(86_400_000 * 6, 86_400_000 * 8)); // 7일전

  if (v0 === null || v3 === null || v3 === 0) return 0;

  const delta1 = v0 - v3;
  if (v7 === null || v7 === 0) return delta1 > 0 ? 1.5 : 0.3;

  const delta2 = v3 - v7;
  if (delta2 === 0) return delta1 > 0 ? 2.0 : 0.0;
  return Math.min(5, Math.max(-2, delta1 / Math.abs(delta2)));
}

function momentumToScore(m) {
  if (m >= 2.0) return Math.min(100, 70 + m * 10);
  if (m >= 1.0) return 55 + (m - 1.0) * 15;
  if (m >= 0)   return m * 55;
  return 0;
}

// ══════════════════════════════════════════════════════════════════
// LAYER 5 — BLUE OCEAN INDEX
// ══════════════════════════════════════════════════════════════════
function calcBlueOcean(naverData) {
  if (!naverData) return 50;
  const supply = naverData.blogCount || 1;
  const demand = Math.max(
    (naverData.buyIntentHits || 0) * 1000,
    naverData.shoppingExists ? 5000 : 1000
  );
  const ratio = demand / supply;
  if (ratio > 10) return 95;
  if (ratio > 5)  return 82;
  if (ratio > 2)  return 68;
  if (ratio > 1)  return 52;
  if (ratio > 0.5)return 38;
  return 20;
}

// ══════════════════════════════════════════════════════════════════
// LAYER 6 — SIGNAL FUSION  (다중 신호 통합)
// ══════════════════════════════════════════════════════════════════
async function fuseSignals(candidate, ppomppuMap, coupangMap, histMap) {
  const sc      = { ...(candidate.scores || {}) };
  const pName   = normKw(candidate.productName);
  const oName   = normKw(candidate.originalKeyword);
  let bonus     = 0;

  // 1. 뽐뿌 커뮤니티 신호
  const ppCnt      = ppomppuMap[pName] || ppomppuMap[oName] || 0;
  sc.ppomppu       = Math.min(100, ppCnt * 30);
  if (ppCnt >= 2)  bonus += 10;
  else if (ppCnt)  bonus += 5;

  // 2. 쿠팡 랭킹
  const cpRank     = coupangMap[pName] || coupangMap[oName] || null;
  sc.coupangRank   = cpRank ? Math.max(0, 100 - cpRank * 9) : 0;
  if (cpRank !== null && cpRank <= 3) bonus += 12;
  else if (cpRank !== null && cpRank <= 7) bonus += 6;

  // 3. 히스토리 기반 모멘텀 + Z-Score
  const hist       = histMap[candidate.productName] || [];
  const momentum   = calcMomentum(hist);
  const zsc        = calcZScore(hist);
  sc.momentum      = Math.round(momentumToScore(momentum));
  sc.zScore        = Math.round(Math.min(100, Math.max(0, 50 + zsc * 15)));
  if (momentum >= 2.0) bonus += 15;
  else if (momentum >= 1.0) bonus += 7;

  // 4. 블루오션 지수
  sc.blueOcean     = calcBlueOcean(candidate.naverData);
  if (sc.blueOcean >= 80) bonus += 8;

  // 5. 자동완성 구매신호 (top 5만)
  let autoSignal   = { buyHits: 0, totalHits: 0, hasPurchaseIntent: false };
  try {
    autoSignal     = await fetchAutoCompleteSignal(candidate.productName);
    sc.autoIntent  = autoSignal.hasPurchaseIntent ? 80 : 35;
    if (autoSignal.hasPurchaseIntent) bonus += 5;
  } catch (_) {
    sc.autoIntent  = 40;
  }

  candidate.scores      = sc;
  candidate._bonus      = bonus;
  candidate._momentum   = +momentum.toFixed(3);
  candidate._zScore     = +zsc.toFixed(3);
  candidate._blueOcean  = sc.blueOcean;
  candidate._ppCnt      = ppCnt;
  candidate._cpRank     = cpRank;
  candidate._autoSignal = autoSignal;
  return candidate;
}

// ══════════════════════════════════════════════════════════════════
// 기존 파이프라인 함수 (원형 유지)
// ══════════════════════════════════════════════════════════════════
function buildKeywordMap(kw7d, kw24h) {
  const map = {};
  const add7  = (item) => {
    const kw = (item.keyword || '').trim();
    if (!kw) return;
    map[kw] = { keyword: kw, _catId: item._catId || null,
      kw7d:  { exists: true,  searchVolume: safeNum(item.searchVolume), increaseRate: safeNum(item.increaseRate) },
      kw24h: { exists: false, searchVolume: 0, increaseRate: 0 } };
  };
  const add24 = (item) => {
    const kw = (item.keyword || '').trim();
    if (!kw) return;
    if (map[kw]) map[kw].kw24h = { exists: true, searchVolume: safeNum(item.searchVolume), increaseRate: safeNum(item.increaseRate) };
    else map[kw] = { keyword: kw, _catId: null,
      kw7d:  { exists: false, searchVolume: 0, increaseRate: 0 },
      kw24h: { exists: true,  searchVolume: safeNum(item.searchVolume), increaseRate: safeNum(item.increaseRate) } };
  };
  (kw7d  || []).forEach(add7);
  (kw24h || []).forEach(add24);
  return Object.values(map);
}

async function classifyAndFilter(items) {
  const kwList = items.map(i => i.keyword);
  let classified;
  try {
    classified = await GROQ.classifyKeywords(kwList);
  } catch (_) {
    classified = kwList.map(kw => ({
      kw, normalized: kw,
      type:    GROQ.ruleBasedClassify(kw),
      isNoise: CFG.NOISE_PATTERNS.some(p => p.test(kw)),
    }));
  }

  const cmap = Object.fromEntries((classified || []).map(c => [c.kw, c]));
  const passed = [], excluded = [];

  items.forEach(item => {
    const cls = cmap[item.keyword] || {
      kw: item.keyword, normalized: item.keyword,
      type: GROQ.ruleBasedClassify(item.keyword),
      isNoise: CFG.NOISE_PATTERNS.some(p => p.test(item.keyword)),
    };
    if (cls.isNoise || cls.type === CFG.KW_TYPE.NEWS_EVENT) { excluded.push(item.keyword); return; }
    passed.push({ ...item, normalized: cls.normalized, kwType: cls.type });
  });

  let excludeReasons = {};
  if (excluded.length) {
    try { excludeReasons = await GROQ.generateExcludeReason(excluded); } catch (_) {}
  }
  return { passed, excluded, excludeReasons };
}

async function expandToProducts(filtered) {
  const candidates = [];
  for (let i = 0; i < filtered.length; i++) {
    const item = filtered[i];
    if (item.kwType === CFG.KW_TYPE.NEWS_EVENT) continue;
    let names;
    if (item.kwType === CFG.KW_TYPE.PROBLEM || item.kwType === CFG.KW_TYPE.SITUATION) {
      try   { names = await GROQ.mapKeywordToProducts(item.keyword, item.kwType); }
      catch (_) { names = GROQ.ruleBasedProductMapping(item.keyword); }
      await sleep(100);
    } else {
      names = [item.normalized || item.keyword];
    }
    (names || []).forEach(pname => {
      if (!pname?.trim()) return;
      candidates.push({
        originalKeyword: item.keyword,
        productName:     pname.trim(),
        normalized:      item.normalized,
        kwType:          item.kwType,
        catId:           item._catId || null,
        kw7d: item.kw7d, kw24h: item.kw24h,
        naverData: null, datalabData: null, insightData: null,
        ytData: null, searchIntentData: null,
        groqFit: null, geminiBonus: null,
        isGeneralNoun:    !/[A-Za-z0-9]/.test(pname) && pname.length <= 10,
        isProblemSolving: [CFG.KW_TYPE.PROBLEM, CFG.KW_TYPE.SITUATION].includes(item.kwType),
        isBrandDependent: item.kwType === CFG.KW_TYPE.BRAND,
        isTemporaryTrend: false,
        hasMedicalRisk:   /의약품|처방|진단|치료|수술/.test(pname),
        isHardToConvert:  [CFG.KW_TYPE.ACTION, CFG.KW_TYPE.UNKNOWN].includes(item.kwType),
        shopWeakVsSearch: false,
        isShortsCompatible: false, isBlogCompatible: false,
        hasVisualHook: false, hasUsageScene: false, isSeasonalFit: false,
        scores: {}, finalScore: 0, group: CFG.GROUP.C,
      });
    });
    if (i % 5 === 0) await sleep(50);
  }
  const seen = new Set();
  return candidates.filter(c => { if (seen.has(c.productName)) return false; seen.add(c.productName); return true; });
}

async function collectExternalData(candidates, period, apiStatus, scope, preInsightMap) {
  const names    = candidates.map(c => c.productName);
  const catIdMap = Object.fromEntries(candidates.filter(c => c.catId).map(c => [c.productName, c.catId]));

  if (preInsightMap) {
    candidates.forEach(c => { if (!c.insightData && preInsightMap[c.originalKeyword]) c.insightData = preInsightMap[c.originalKeyword]; });
  }

  let naverBatch = {};
  try {
    naverBatch = await NAVER.fetchNaverBatch(names, period, scope || 'all', catIdMap);
  } catch (e) {
    console.error('[collectExternal] naver:', e.message);
    apiStatus.naver = '❌ ' + e.message;
  }

  let searchOk = 0, dlOk = 0, insightOk = 0;
  names.forEach(p => {
    const nd = naverBatch[p] || {};
    if (nd.search  && !nd.search._fallback)  searchOk++;
    if (nd.datalab && !nd.datalab._fallback) dlOk++;
    if (nd.insight && !nd.insight._fallback) insightOk++;
  });
  apiStatus.naver_search  = `${searchOk  > 0 ? '✅' : '⚠️'} 검색 ${searchOk}/${names.length}`;
  apiStatus.naver_datalab = `${dlOk      > 0 ? '✅' : '⚠️'} 데이터랩 ${dlOk}/${names.length}`;
  apiStatus.naver_insight = `${insightOk > 0 ? '✅' : '⚠️'} 인사이트 ${insightOk}/${names.length}`;

  candidates.forEach(c => {
    const nd = naverBatch[c.productName] || {};
    c.naverData   = nd.search  || c.naverData  || null;
    c.datalabData = nd.datalab || c.datalabData || null;
    if (!c.insightData) c.insightData = nd.insight || null;
    if (c.naverData && c.datalabData)
      c.shopWeakVsSearch = !c.naverData.shoppingExists && safeNum(c.datalabData.surgeRate) > 20;
  });

  let ytBatch = {};
  try {
    ytBatch = await YOUTUBE.fetchYouTubeBatch(names.slice(0, 10));
    apiStatus.youtube = `✅ YouTube ${Object.keys(ytBatch).length}개`;
  } catch (e) {
    apiStatus.youtube = '⚠️ YouTube fallback';
    console.warn('[collectExternal] youtube:', e.message);
  }
  candidates.forEach(c => {
    c.ytData = ytBatch[c.productName] || null;
    if (c.ytData) {
      c.isShortsCompatible = !!c.ytData.isShortsCompatible;
      c.isBlogCompatible   = !!c.ytData.isBlogCompatible;
      c.hasVisualHook      = !!c.ytData.hasVisualHook;
      c.hasUsageScene      = !!c.ytData.hasUsageScene;
    }
  });
  return candidates;
}

async function enrichSearchIntent(candidates, apiStatus) {
  for (let i = 0; i < candidates.length; i++) {
    let suggestions = [];
    try { suggestions = await NAVER.fetchNaverSuggestions(candidates[i].productName); } catch (_) {}
    candidates[i].searchIntentData = NAVER.calcSearchIntentFromData(candidates[i].productName, candidates[i].naverData, suggestions);
    if (i < candidates.length - 1) await sleep(80);
  }
  apiStatus.searchIntent = '✅ 검색의도 완료';
  return candidates;
}

async function enrichWithGroq(candidates, apiStatus) {
  for (let i = 0; i < Math.min(candidates.length, 10); i++) {
    try { candidates[i].groqFit = await GROQ.calcProductFitGroq(candidates[i].productName, candidates[i].kwType); }
    catch (_) { candidates[i].groqFit = null; }
    await sleep(150);
  }
  apiStatus.groq = '✅ Groq 완료';
  return candidates;
}

function scoreSortGroup(candidates) {
  return candidates.map(c => SCORE.scoreCandidate(c)).sort((a, b) => b.finalScore - a.finalScore);
}

async function enrichWithGemini(candidates, apiStatus) {
  for (let i = 0; i < Math.min(candidates.length, 10); i++) {
    const c = candidates[i];
    try {
      c.geminiBonus = await GEMINI.calcTrustBonusGemini(c);
      if (c.geminiBonus && typeof c.geminiBonus.adjustment === 'number') {
        const adj = safeNum(c.geminiBonus.adjustment);
        c.scores.trustBonus = Math.min(100, Math.max(0, safeNum(c.scores.trustBonus) + adj));
        c.finalScore        = Math.min(100, Math.max(0, safeNum(c.finalScore) + Math.round(adj * CFG.WEIGHTS.productFit)));
      }
    } catch (_) { c.geminiBonus = null; }
    await sleep(200);
  }
  candidates.sort((a, b) => b.finalScore - a.finalScore);
  apiStatus.gemini = '✅ Gemini 보정 완료';
  return candidates;
}

async function generateDescriptions(candidates, groups) {
  const top = candidates.slice(0, 10);
  for (let i = 0; i < top.length; i++) {
    try {
      const d        = await GROQ.generateReasonSummary(top[i]);
      top[i].groqReason = d.reason || '';
      top[i].shortsIdea = d.shorts || '';
      top[i].blogIdea   = d.blog   || '';
    } catch (_) {
      top[i].groqReason = top[i].productName + ' 상승 트렌드 확인됨';
      top[i].shortsIdea = top[i].productName + ' 사용 전후 비교 쇼츠';
      top[i].blogIdea   = top[i].productName + ' 추천 TOP5 + 가격비교';
    }
    await sleep(150);
  }
  for (let i = 0; i < Math.min(top.length, 5); i++) {
    try { top[i].geminiExplanation = await GEMINI.explainWhyNow(top[i]); }
    catch (_) { top[i].geminiExplanation = ''; }
    await sleep(200);
  }
  let summary = null, guide = '', structuredRecs = null;
  try { summary        = await GEMINI.mergeAndSummarizeSignals(top); }       catch (_) {}
  try { guide          = await GEMINI.generateFinalNarrative(top, summary); }
  catch (_) { guide   = 'TOP 후보 제품으로 쇼츠 영상을 먼저 제작하고\n블로그 리뷰로 검색 트래픽을 확보하세요.'; }
  try { structuredRecs = await GEMINI.generateStructuredRecommendations(top, groups); } catch (_) {}
  return { candidates: top, summary, guide, structuredRecs };
}

// ══════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST만 허용' });

  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET)
    return res.status(500).json({ error: 'NAVER 환경변수 누락' });

  // body 수집
  const rawBody = await new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; });
    req.on('end',  ()  => resolve(buf));
    req.on('error', e  => reject(e));
  });

  try {
    const payload   = JSON.parse(rawBody);
    const mode      = payload.mode    || 'csv';
    const scope     = payload.scope   || 'all';
    const period    = payload.period  || 'week';
    const filters   = payload.filters || {};
    const maxCount  = Math.max(5, Math.min(50, safeNum(payload.maxCount) || 10));
    const apiStatus = {};

    let kw7d = [], kw24h = [], preInsightMap = null;

    // ── 카테고리 모드 ──────────────────────────────────────────
    if (mode === 'category') {
      const catIds = payload.categories || [];
      if (!catIds.length) return res.status(400).json({ error: '카테고리를 선택하세요' });
      apiStatus.mode = `카테고리 (${catIds.length}개)`;

      let catKwData = [];
      try {
        catKwData = await NAVER.fetchCategoryTopKeywords(catIds, period);
        await sleep(1000);
        apiStatus.categoryFetch = `✅ ${catKwData.length}개`;
      } catch (e) {
        apiStatus.categoryFetch = '❌ ' + e.message;
      }
      if (!catKwData.length)
        return res.status(200).json({ candidates: [], apiStatus, error: '카테고리 키워드 수집 실패' });

      preInsightMap = Object.fromEntries(catKwData.map(i => [i.keyword, i.insightData]));
      kw7d = catKwData.map(i => ({
        keyword:      i.keyword,
        searchVolume: i.insightData ? Math.max(0, Math.round(i.insightData.currentRatio * 10)) : 50,
        increaseRate: i.trendScore || 0,
        _catId:       i.catId,
      }));

    // ── CSV 모드 ───────────────────────────────────────────────
    } else {
      kw7d  = payload.kw7d  || [];
      kw24h = payload.kw24h || [];
      if (!kw7d.length && !kw24h.length)
        return res.status(400).json({ error: '키워드 데이터가 없습니다' });
    }

    // ── 외부 신호 병렬 수집 (메인 파이프라인과 동시 실행) ─────
    const [ppResult, cpResult] = await Promise.allSettled([
      fetchPpomppuSignals(),
      fetchCoupangRankings(3),
    ]);
    const ppList = ppResult.status === 'fulfilled' ? ppResult.value : [];
    const cpList = cpResult.status === 'fulfilled' ? cpResult.value : [];

    apiStatus.ppomppu = ppList.length ? `✅ 뽐뿌 ${ppList.length}개` : '⚠️ 뽐뿌 신호 없음';
    apiStatus.coupang = cpList.length ? `✅ 쿠팡 ${cpList.length}개` : '⚠️ 쿠팡 랭킹 없음';

    // 외부 신호를 키워드 풀에 병합
    kw7d = [
      ...kw7d,
      ...ppList.map(p => ({ keyword: p.keyword, searchVolume: p.count * 10, increaseRate: p.count * 5 })),
      ...cpList.map(c => ({ keyword: c.keyword, searchVolume: Math.max(10, 100 - c.rank * 8), increaseRate: 20 })),
    ];

    // ── 공통 파이프라인 ────────────────────────────────────────
    const merged              = buildKeywordMap(kw7d, kw24h);
    const { passed, excluded, excludeReasons } = await classifyAndFilter(merged);

    if (!passed.length)
      return res.status(200).json({ candidates: [], apiStatus, excluded, excludeReasons, error: '유효 키워드 없음' });

    let candidates = await expandToProducts(passed);
    if (!candidates.length)
      return res.status(200).json({ candidates: [], apiStatus, excluded, excludeReasons, error: '제품 후보 없음' });

    candidates = candidates.slice(0, 15); // 여유 풀: Gemini 전 필터 감안
    candidates = await collectExternalData(candidates, period, apiStatus, scope, preInsightMap);
    candidates = await enrichSearchIntent(candidates, apiStatus);
    candidates = await enrichWithGroq(candidates, apiStatus);
    candidates = scoreSortGroup(candidates);

    // ── Signal Intelligence 융합 ───────────────────────────────
    const ppMap = Object.fromEntries(ppList.map(p => [normKw(p.keyword), p.count]));
    const cpMap = Object.fromEntries(cpList.map(c => [normKw(c.keyword), c.rank]));

    // 히스토리 병렬 저장
    const histMap = {};
    await Promise.all(candidates.map(async c => {
      histMap[c.productName] = await historyPush(c.productName, safeNum(c.finalScore));
    }));

    // 신호 융합 (자동완성 포함 → 순차)
    for (let i = 0; i < candidates.length; i++) {
      candidates[i] = await fuseSignals(candidates[i], ppMap, cpMap, histMap);
      await sleep(80);
    }

    // 신호 보너스 반영 → 재정렬
    candidates = candidates
      .map(c => ({ ...c, finalScore: Math.min(100, safeNum(c.finalScore) + safeNum(c._bonus)) }))
      .sort((a, b) => b.finalScore - a.finalScore);

    candidates = await enrichWithGemini(candidates, apiStatus);

    // ── 필터 적용 (Gemini 보정 후) ────────────────────────────
    const f = filters;
    const fnum = k => safeNum(f[k]);
    if (fnum('minFinalScore')  > 0) candidates = candidates.filter(c => c.finalScore >= fnum('minFinalScore'));
    if (fnum('minBuyIntent')   > 0) candidates = candidates.filter(c => safeNum(c.scores.buyIntent) >= fnum('minBuyIntent'));
    if (fnum('minShopping')    > 0) candidates = candidates.filter(c => safeNum(c.scores.shoppingInterest) >= fnum('minShopping'));
    if (fnum('minYoutube')     > 0) candidates = candidates.filter(c => safeNum(c.scores.youtubeViral) >= fnum('minYoutube'));
    if (f.shortsOnly)       candidates = candidates.filter(c => c.isShortsCompatible);
    if (f.blogOnly)         candidates = candidates.filter(c => c.isBlogCompatible);
    if (f.noBrand)          candidates = candidates.filter(c => !c.isBrandDependent);
    if (f.generalNounOnly)  candidates = candidates.filter(c => c.isGeneralNoun);
    if (f.noNewsEvent)      candidates = candidates.filter(c => c.kwType !== CFG.KW_TYPE.NEWS_EVENT);
    candidates = candidates.slice(0, maxCount);

    const groups = {
      [CFG.GROUP.A]: candidates.filter(c => c.group === CFG.GROUP.A),
      [CFG.GROUP.B]: candidates.filter(c => c.group === CFG.GROUP.B),
      [CFG.GROUP.C]: candidates.filter(c => c.group === CFG.GROUP.C),
    };

    const result = await generateDescriptions(candidates, groups);

    // 실행 우선순위
    const actionPriority = result.candidates.map((c, i) => ({
      rank:          i + 1,
      productName:   c.productName,
      whyNow:        c.groqReason || (c.geminiExplanation || '').slice(0, 60) || '상승 트렌드 확인',
      shortsReady:   c.isShortsCompatible,
      blogReady:     c.isBlogCompatible,
      hasVisualHook: c.hasVisualHook,
      hasUsageScene: c.hasUsageScene,
      momentum:      c._momentum ?? 0,
      blueOcean:     c._blueOcean ?? 0,
      ppomppuHit:    (c._ppCnt || 0) > 0,
      coupangRank:   c._cpRank ?? null,
      autoIntent:    c._autoSignal?.hasPurchaseIntent ?? false,
      action:
        c.group === CFG.GROUP.A ? '즉시 쇼츠 + 블로그' :
        c.group === CFG.GROUP.B ? '블로그 리뷰 + 비교' : '소규모 테스트',
    }));

    return res.status(200).json({
      candidates:     result.candidates,
      groups,
      actionPriority,
      structuredRecs: result.structuredRecs,
      excluded,
      excludeReasons,
      summary:        result.summary,
      guide:          result.guide,
      apiStatus,
      signals: {
        ppomppu: ppList.slice(0, 10),
        coupang: cpList.slice(0, 10),
      },
      meta: { mode, scope, total: result.candidates.length, updatedAt: new Date().toISOString() },
    });

  } catch (e) {
    console.error('[trend-analyze fatal]', e.message, '\n', e.stack);
    return res.status(500).json({ error: '분석 중 오류', detail: e.message });
  }
};
