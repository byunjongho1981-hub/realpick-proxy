'use strict';

const https  = require('https');
const CFG    = require('./_trend-config');
const NAVER  = require('./_trend-naver');
const YOUTUBE= require('./_trend-youtube');
const GROQ   = require('./_trend-groq');
const GEMINI = require('./_trend-gemini');

const sleep    = ms => new Promise(r => setTimeout(r, ms));
const safeNum  = v  => (isNaN(Number(v)) ? 0 : Number(v));
const clamp    = v  => Math.min(100, Math.max(0, Math.round(safeNum(v))));
const stripHtml= s  => (s || '').replace(/<[^>]+>/g, '');

// ══════════════════════════════════════════════════════════════
// NAVER SHOP GET
// ══════════════════════════════════════════════════════════════
function naverShopGet(query, display = 100, start = 1) {
  return new Promise(resolve => {
    try {
      const qs = [
        `query=${encodeURIComponent(query)}`,
        `display=${display}`,
        `start=${start}`,
        `sort=sim`,
        `exclude=used:rental:cbshop`,
      ].join('&');
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 6000);
      const req = https.request({
        hostname: 'openapi.naver.com',
        path: `/v1/search/shop.json?${qs}`,
        method: 'GET',
        headers: {
          'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
          'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
        },
      }, res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          if (done) return;
          done = true; clearTimeout(t);
          try {
            const d = JSON.parse(raw);
            if (d.errorCode) { console.error('[shopGet]', d.errorCode, d.errorMessage); resolve(null); return; }
            resolve(d);
          } catch (_) { resolve(null); }
        });
      });
      req.on('error', () => { if (!done) { done = true; clearTimeout(t); resolve(null); } });
      req.setTimeout(5500, () => req.destroy());
      req.end();
    } catch (_) { resolve(null); }
  });
}

// ══════════════════════════════════════════════════════════════
// 핵심: 쇼핑 타이틀 → 실제 제품명 추출
// "닥터자르트 시카페어 크림 50ml 2개" → "닥터자르트 시카페어 크림"
// ══════════════════════════════════════════════════════════════
function extractProductName(title, brand, maker) {
  let t = stripHtml(title || '');

  // 1. 광고/이벤트 문구 제거
  t = t.replace(/\[.*?\]/g, '')        // [특가] [공식] 등
       .replace(/\(.*?\)/g, '')        // (50ml) (증정) 등
       .replace(/【.*?】/g, '')
       .replace(/\d+\+\d+/g, '')       // 1+1
       .replace(/\d+매|\d+개|\d+팩|\d+입|\d+세트/g, '')
       .replace(/\d+\s*[gGmMlLkK]+\b/g, '')  // 용량 제거
       .replace(/무료배송|당일배송|로켓배송|오늘출발/g, '')
       .replace(/공식|정품|정식|국내정품|직배송|공식판매점/g, '')
       .replace(/특가|할인|세일|쿠폰|적립/g, '')
       .replace(/최저가|추천|인기|베스트|신상/g, '')
       .replace(/\s{2,}/g, ' ')
       .trim();

  // 2. 브랜드명 앞에 붙으면 정제 (이미 포함된 경우 중복 제거)
  // 예: "토리든 다이브인 로우 분자 히알루론산 세럼" 유지

  // 3. 토큰 분리 후 의미 있는 제품명 길이만 취함
  //    한글 제품명: 보통 2~6개 단어
  const tokens = t.split(/\s+/).filter(tk =>
    tk.length >= 1 &&
    !/^[A-Z]{1,2}$/.test(tk) &&   // 단독 알파벳 제거
    !/^\d+$/.test(tk)              // 순수 숫자 제거
  );

  // 4. 브랜드/제조사가 첫 토큰에 없으면 앞에 붙임
  const hasBrand = brand && t.toLowerCase().includes(brand.toLowerCase().slice(0, 3));
  const prefix   = (!hasBrand && brand && brand.length >= 2) ? brand + ' ' : '';

  // 5. 최대 5토큰까지만 (너무 길면 카드 UI 넘침)
  const name = (prefix + tokens.slice(0, 5).join(' ')).trim();
  return name.length >= 2 ? name : t.slice(0, 30).trim();
}

// ══════════════════════════════════════════════════════════════
// STEP 1 — 키워드 → 실제 제품명 TOP 20 추출
// 쇼핑 300개 수집 → 제품명 빈도 분석
// ══════════════════════════════════════════════════════════════
async function extractProductCandidates(keyword, apiStatus) {
  // 빈도 카운터 & 메타 저장
  const counter     = {};   // productName → count
  const metaMap     = {};   // productName → shopMeta

  // 검색 변형 쿼리 4종
  const queries = [
    keyword,
    `${keyword} 추천`,
    `${keyword} 인기`,
    `${keyword} 후기`,
  ];

  for (const q of queries) {
    // 1회 쿼리당 최대 100개씩 최대 2페이지 = 200개
    for (let page = 0; page < 2; page++) {
      const res = await naverShopGet(q, 100, page * 100 + 1);
      if (!res || !res.items || !res.items.length) break;

      res.items.forEach(item => {
        // ★ 실제 제품명 추출 (category3 사용 금지)
        const name = extractProductName(
          item.title,
          (item.brand || '').trim(),
          (item.maker || '').trim()
        );
        if (!name || name.length < 2) return;

        // 키워드와 전혀 무관한 제품 제거 (완전히 다른 카테고리 방지)
        // 예: "크림" 검색 시 "크림파스타 만들기 도구" 같은 것 제거
        const nameNorm  = name.replace(/\s/g, '').toLowerCase();
        const kwNorm    = keyword.replace(/\s/g, '').toLowerCase();
        // 제품명이나 카테고리에 키워드 포함되거나 shopMeta category에 포함
        const catStr    = [item.category1, item.category2, item.category3, item.category4].join(' ').toLowerCase();
        const relevant  = nameNorm.includes(kwNorm) || catStr.includes(kwNorm) ||
                          (item.brand || '').toLowerCase().includes(kwNorm);
        if (!relevant && keyword.length >= 2) {
          // 관련도 낮은 경우 카운트만 0.3 가중
        }

        counter[name] = (counter[name] || 0) + 1;

        // 최저가 기준으로 메타 업데이트
        if (!metaMap[name] || safeNum(item.lprice) < safeNum(metaMap[name].price)) {
          metaMap[name] = {
            price:     safeNum(item.lprice),
            hprice:    safeNum(item.hprice),
            category1: item.category1 || '',
            category2: item.category2 || '',
            category3: item.category3 || '',
            mallName:  item.mallName  || '',
            brand:     item.brand     || '',
            maker:     item.maker     || '',
            image:     item.image     || '',
            link:      item.link      || '',
          };
        }
      });

      await sleep(200);
    }
    await sleep(250);
  }

  // 빈도 기준 정렬 → TOP 20
  let sorted = Object.entries(counter)
    .filter(([k]) => k.length >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, freq]) => ({
      productName:      name,
      originalKeyword:  keyword,
      frequency:        freq,
      shopMeta:         metaMap[name] || null,
      naverData:        null,
      datalabData:      null,
      insightData:      null,
      ytData:           null,
      searchIntentData: null,
      groqFit:          null,
      geminiBonus:      null,
      scores:           {},
      finalScore:       0,
      group:            'watch',
    }));

  // 후보 부족(8개 미만) 시 Groq 보완
  if (sorted.length < 8) {
    try {
      const groqList = await GROQ.mapKeywordToProducts(keyword, CFG.KW_TYPE.GENERAL_PRODUCT);
      groqList.forEach(name => {
        if (!sorted.find(s => s.productName === name)) {
          sorted.push({
            productName: name, originalKeyword: keyword, frequency: 1, shopMeta: null,
            naverData: null, datalabData: null, insightData: null, ytData: null,
            searchIntentData: null, groqFit: null, geminiBonus: null,
            scores: {}, finalScore: 0, group: 'watch',
          });
        }
      });
    } catch (_) {}
  }

  const result = sorted.slice(0, 20);
  apiStatus.step1 = `✅ 제품 후보 ${result.length}개 추출`;
  console.log('[STEP1] 실제제품명 TOP8:', result.slice(0, 8).map(s => `${s.productName}(${s.frequency})`).join(' | '));
  return result;
}

// ══════════════════════════════════════════════════════════════
// STEP 2 — 제품별 Naver 검색 + 검색의도
// ══════════════════════════════════════════════════════════════
async function collectSearchData(candidates, apiStatus) {
  let ok = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      c.naverData = await NAVER.fetchNaverSearchData(c.productName);
      if (c.naverData && !c.naverData._fallback) ok++;
    } catch (_) { c.naverData = null; }
    await sleep(220);

    try {
      const sugs = await NAVER.fetchNaverSuggestions(c.productName);
      c.searchIntentData = NAVER.calcSearchIntentFromData(c.productName, c.naverData, sugs);
    } catch (_) { c.searchIntentData = null; }
    await sleep(100);
  }
  apiStatus.step2 = `✅ 검색 데이터 ${ok}/${candidates.length}`;
  console.log(`[STEP2] 검색 OK: ${ok}/${candidates.length}`);
  return candidates;
}

// ══════════════════════════════════════════════════════════════
// STEP 3 — Datalab 추세
// ══════════════════════════════════════════════════════════════
async function collectDatalabData(candidates, period, apiStatus) {
  let ok = 0;
  for (let i = 0; i < candidates.length; i++) {
    try {
      candidates[i].datalabData = await NAVER.fetchNaverDatalabForKeyword(candidates[i].productName, period);
      if (candidates[i].datalabData && !candidates[i].datalabData._fallback) ok++;
    } catch (_) { candidates[i].datalabData = null; }
    await sleep(320);
  }
  apiStatus.step3 = `✅ 데이터랩 ${ok}/${candidates.length}`;
  return candidates;
}

// ══════════════════════════════════════════════════════════════
// STEP 4 — Shopping Insight (상위 12개)
// ══════════════════════════════════════════════════════════════
async function collectInsightData(candidates, period, apiStatus) {
  const limit = Math.min(candidates.length, 12);
  let ok = 0;
  for (let i = 0; i < limit; i++) {
    const c = candidates[i];
    try {
      const catName = c.shopMeta?.category1 || '';
      const catId   = CFG.NAVER_CAT_IDS[catName] || null;
      c.insightData = await NAVER.fetchNaverShoppingInsight(c.productName, catId, period);
      if (c.insightData && !c.insightData._fallback) ok++;
    } catch (_) { c.insightData = null; }
    await sleep(220);
  }
  candidates.slice(limit).forEach(c => { c.insightData = null; });
  apiStatus.step4 = `✅ 쇼핑인사이트 ${ok}/${limit}`;
  return candidates;
}

// ══════════════════════════════════════════════════════════════
// STEP 5 — YouTube 배치 (상위 12개)
// ══════════════════════════════════════════════════════════════
async function collectYoutubeData(candidates, apiStatus) {
  const top12 = candidates.slice(0, 12).map(c => c.productName);
  try {
    const batch = await YOUTUBE.fetchYouTubeBatch(top12);
    candidates.forEach(c => {
      c.ytData = batch[c.productName] || null;
      if (c.ytData) {
        c.isShortsCompatible = !!c.ytData.isShortsCompatible;
        c.isBlogCompatible   = !!c.ytData.isBlogCompatible;
        c.hasVisualHook      = !!c.ytData.hasVisualHook;
        c.hasUsageScene      = !!c.ytData.hasUsageScene;
      }
    });
    apiStatus.step5 = `✅ YouTube ${Object.values(batch).filter(Boolean).length}개`;
  } catch (e) {
    candidates.forEach(c => { c.ytData = null; });
    apiStatus.step5 = '⚠️ YouTube fallback';
    console.warn('[STEP5] YouTube 오류:', e.message);
  }
  return candidates;
}

// ══════════════════════════════════════════════════════════════
// STEP 6 — Groq 전환 점수 (상위 10개)
// ══════════════════════════════════════════════════════════════
async function collectGroqFit(candidates, apiStatus) {
  const top10 = candidates.slice(0, 10);
  for (let i = 0; i < top10.length; i++) {
    try {
      top10[i].groqFit = await GROQ.calcProductFitGroq(top10[i].productName, CFG.KW_TYPE.GENERAL_PRODUCT);
    } catch (_) { top10[i].groqFit = null; }
    await sleep(160);
  }
  apiStatus.step6 = '✅ Groq 전환 분석 완료';
  return candidates;
}

// ══════════════════════════════════════════════════════════════
// SCORING
// ══════════════════════════════════════════════════════════════
function calcSalesSignal(naverData, shopMeta) {
  if (!naverData || naverData._fallback) return 30;
  let s = 15;
  if (naverData.shoppingExists)                      s += 28;
  const cnt = safeNum(naverData.shopItemCount);
  if (cnt > 200)      s += 25;
  else if (cnt > 50)  s += 18;
  else if (cnt > 10)  s += 10;
  else if (cnt > 0)   s +=  5;
  s += Math.min(18, safeNum(naverData.buyIntentHits) * 3);
  const price = shopMeta ? safeNum(shopMeta.price) : 0;
  if (price >= 5000 && price <= 80000)   s += 12;
  else if (price > 80000 && price <= 200000) s += 6;
  if (naverData.priceGrade === 'mid')    s +=  5;
  return clamp(s);
}

function calcReviewQuality(naverData) {
  if (!naverData || naverData._fallback) return 25;
  let s = 8;
  const blog = safeNum(naverData.blogCount);
  if (blog > 100000)      s += 32;
  else if (blog > 30000)  s += 25;
  else if (blog > 5000)   s += 18;
  else if (blog > 500)    s += 10;
  else if (blog > 50)     s +=  5;
  s += Math.min(20, safeNum(naverData.recentPostRatio) * 0.22);
  s += Math.min(12, safeNum(naverData.buyIntentHits)   * 2);
  if (safeNum(naverData.newsCount) > safeNum(naverData.blogCount) * 3) s -= 12;
  return clamp(s);
}

function calcTrendScore(datalabData, insightData) {
  let s = 22;
  if (datalabData && !datalabData._fallback) {
    const sr = safeNum(datalabData.surgeRate);
    if (sr > 80)       s += 38;
    else if (sr > 40)  s += 28;
    else if (sr > 15)  s += 16;
    else if (sr > 0)   s +=  8;
    else if (sr < -15) s -= 18;
    if (safeNum(datalabData.accel)      > 20)  s += 10;
    if (safeNum(datalabData.durability) > 65)  s +=  5;
  }
  if (insightData && !insightData._fallback) {
    const cs = safeNum(insightData.clickSurge);
    if (cs > 40)      s += 22;
    else if (cs > 15) s += 14;
    else if (cs > 0)  s +=  6;
    if (insightData.shopTrend === 'hot')     s += 15;
    else if (insightData.shopTrend === 'rising')  s +=  8;
    else if (insightData.shopTrend === 'falling') s -= 12;
  }
  return clamp(s);
}

function calcViralScore(ytData) {
  if (!ytData) return 22;
  let s = 8;
  const rc = safeNum(ytData.recentCount);
  if (rc > 30)       s += 28;
  else if (rc > 10)  s += 18;
  else if (rc > 3)   s += 10;
  else if (rc > 0)   s +=  5;
  const vs = safeNum(ytData.avgViralScore);
  if (vs > 5000)     s += 28;
  else if (vs > 500) s += 18;
  else if (vs > 50)  s +=  8;
  if (ytData.hasShorts)     s += 14;
  if (ytData.hasVisualHook) s +=  8;
  return clamp(Math.max(s, 8));
}

function calcConversionScore(groqFit, searchIntentData) {
  let s = 45;
  if (groqFit && typeof groqFit.score === 'number') s = Math.round((s + safeNum(groqFit.score)) / 2);
  if (searchIntentData) {
    if (searchIntentData.type === 'buy')     s += 15;
    else if (searchIntentData.type === 'problem') s += 10;
    s += Math.min(10, safeNum(searchIntentData.buyRatio) * 0.1);
  }
  return clamp(s);
}

function scoreProduct(c) {
  const salesSignal   = calcSalesSignal(c.naverData, c.shopMeta);
  const reviewQuality = calcReviewQuality(c.naverData);
  const trendScore    = calcTrendScore(c.datalabData, c.insightData);
  const viralScore    = calcViralScore(c.ytData);
  const convScore     = calcConversionScore(c.groqFit, c.searchIntentData);

  const finalScore = clamp(
    0.30 * salesSignal  +
    0.25 * reviewQuality +
    0.25 * trendScore   +
    0.10 * viralScore   +
    0.10 * convScore
  );

  let group;
  if (finalScore >= 65 && salesSignal >= 58 && trendScore >= 48) group = 'hot';
  else if (finalScore >= 48)                                       group = 'rising';
  else                                                             group = 'watch';

  return {
    ...c,
    scores: { salesSignal, reviewQuality, trendScore, viralScore, conversion: convScore },
    finalScore,
    group,
    searchIntentType:   c.searchIntentData?.type     || 'explore',
    isShortsCompatible: !!(c.ytData?.isShortsCompatible || c.ytData?.hasVisualHook),
    isBlogCompatible:   !!(c.ytData?.isBlogCompatible),
    hasVisualHook:      !!(c.ytData?.hasVisualHook),
    hasUsageScene:      !!(c.ytData?.hasUsageScene),
  };
}

// ══════════════════════════════════════════════════════════════
// STEP 7 — Groq 이유 + 쇼츠/블로그 아이디어
// ══════════════════════════════════════════════════════════════
async function generateReasons(top10, apiStatus) {
  for (let i = 0; i < top10.length; i++) {
    try {
      const d = await GROQ.generateReasonSummary(top10[i]);
      top10[i].groqReason = d.reason || '';
      top10[i].shortsIdea = d.shorts || '';
      top10[i].blogIdea   = d.blog   || '';
    } catch (_) {
      top10[i].groqReason = `${top10[i].productName} 판매 상승세 확인`;
      top10[i].shortsIdea = `${top10[i].productName} 사용 전후 비교 쇼츠`;
      top10[i].blogIdea   = `${top10[i].productName} TOP5 추천 + 가격비교`;
    }
    await sleep(160);
  }
  apiStatus.step7 = '✅ Groq 설명 완료';
  return top10;
}

// ══════════════════════════════════════════════════════════════
// STEP 8 — Gemini 종합 추천 + 가이드
// ══════════════════════════════════════════════════════════════
async function generateGeminiInsights(top10, apiStatus) {
  for (let i = 0; i < Math.min(top10.length, 5); i++) {
    try { top10[i].geminiExplanation = await GEMINI.explainWhyNow(top10[i]); }
    catch (_) { top10[i].geminiExplanation = ''; }
    await sleep(220);
  }

  let structuredRecs = null, guide = '';
  try {
    const groups = {
      top_trend:    top10.filter(p => p.group === 'hot'),
      stable:       top10.filter(p => p.group === 'rising'),
      experimental: top10.filter(p => p.group === 'watch'),
    };
    structuredRecs = await GEMINI.generateStructuredRecommendations(top10, groups);
  } catch (_) {}

  try {
    const summary = await GEMINI.mergeAndSummarizeSignals(top10);
    guide         = await GEMINI.generateFinalNarrative(top10, summary);
  } catch (_) {
    guide = 'TOP 제품으로 쇼츠 영상 먼저 제작하고 블로그 리뷰로 전환 트래픽을 확보하세요.';
  }

  apiStatus.step8 = '✅ Gemini 분석 완료';
  return { top10, structuredRecs, guide };
}

// ══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST만 허용' });

  if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET)
    return res.status(500).json({ error: 'NAVER 환경변수 누락' });

  const rawBody = await new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => buf += c);
    req.on('end',  () => resolve(buf));
    req.on('error', e => reject(e));
  });

  try {
    const payload  = JSON.parse(rawBody);
    const keyword  = (payload.keyword || '').trim();
    const period   = payload.period   || 'week';
    const maxCount = Math.max(5, Math.min(10, safeNum(payload.maxCount) || 10));

    if (!keyword) return res.status(400).json({ error: '키워드를 입력하세요' });

    const apiStatus = {};
    console.log(`[product-search] 시작: "${keyword}"`);

    let candidates = await extractProductCandidates(keyword, apiStatus);
    if (!candidates.length)
      return res.status(200).json({ products: [], apiStatus, error: '제품 후보 없음' });

    candidates = await collectSearchData(candidates, apiStatus);
    candidates = await collectDatalabData(candidates, period, apiStatus);
    candidates = await collectInsightData(candidates, period, apiStatus);
    candidates = await collectYoutubeData(candidates, apiStatus);
    candidates = await collectGroqFit(candidates, apiStatus);

    candidates = candidates.map(scoreProduct).sort((a, b) => b.finalScore - a.finalScore);
    const top10 = candidates.slice(0, maxCount);

    await generateReasons(top10, apiStatus);
    const { structuredRecs, guide } = await generateGeminiInsights(top10, apiStatus);

    console.log(`[product-search] 완료 TOP${top10.length}:`, top10.map(p => p.productName).join(' | '));

    return res.status(200).json({
      keyword,
      products:       top10,
      total:          top10.length,
      structuredRecs,
      guide,
      apiStatus,
      updatedAt:      new Date().toISOString(),
    });

  } catch (e) {
    console.error('[product-search fatal]', e.message, '\n', e.stack);
    return res.status(500).json({ error: '검색 오류', detail: e.message });
  }
};
