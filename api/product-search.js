'use strict';

const https   = require('https');
const CFG     = require('./_trend-config');
const NAVER   = require('./_trend-naver');
const YOUTUBE = require('./_trend-youtube');
const GROQ    = require('./_trend-groq');
const GEMINI  = require('./_trend-gemini');

const sleep    = ms => new Promise(r => setTimeout(r, ms));
const safeNum  = v  => (isNaN(Number(v)) ? 0 : Number(v));
const clamp    = v  => Math.min(100, Math.max(0, Math.round(safeNum(v))));
const stripHtml= s  => (s || '').replace(/<[^>]+>/g, '');

function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function agoDate(n) { const d = new Date(); d.setDate(d.getDate()-n); return d; }

// ══════════════════════════════════════════════════════════════
// NAVER 공통 요청 (JSON body, application/json)
// ══════════════════════════════════════════════════════════════
function naverPost(path, body) {
  return new Promise(resolve => {
    try {
      const buf = Buffer.from(JSON.stringify(body), 'utf8');
      let done  = false;
      const t   = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 6000);
      const req = https.request({
        hostname: 'openapi.naver.com',
        path, method: 'POST',
        headers: {
          'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
          'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
          'Content-Type':          'application/json',
          'Content-Length':        buf.length,
        },
      }, res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          if (done) return;
          done = true; clearTimeout(t);
          try {
            const d = JSON.parse(raw);
            if (d.errorCode) { console.error('[naverPost]', path, d.errorCode, d.errorMessage); resolve(null); return; }
            resolve(d);
          } catch (_) { resolve(null); }
        });
      });
      req.on('error', () => { if (!done) { done = true; clearTimeout(t); resolve(null); } });
      req.setTimeout(5500, () => req.destroy());
      req.write(buf); req.end();
    } catch (_) { resolve(null); }
  });
}

function naverShopGet(query, display = 100, start = 1) {
  return new Promise(resolve => {
    try {
      const qs = `query=${encodeURIComponent(query)}&display=${display}&start=${start}&sort=sim&exclude=used:rental:cbshop`;
      let done  = false;
      const t   = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 6000);
      const req = https.request({
        hostname: 'openapi.naver.com',
        path: `/v1/search/shop.json?${qs}`, method: 'GET',
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
            if (d.errorCode) { console.error('[shopGet]', d.errorCode); resolve(null); return; }
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
// 데이터랩 파싱
// ══════════════════════════════════════════════════════════════
function parseDatalab(result, keyword) {
  const pts = (result.data || []).map(d => ({ period: d.period, ratio: safeNum(d.ratio) }));
  if (pts.length < 4) return { surgeRate:0, accel:0, durability:50, _fallback:true };

  const avg = arr => arr.reduce((s,p)=>s+p.ratio, 0) / (arr.length||1);
  const h   = Math.floor(pts.length / 2);
  const pa  = avg(pts.slice(0, h));
  const ca  = avg(pts.slice(h));
  const surge = pa > 0 ? Math.round(((ca-pa)/pa)*100) : (ca>0 ? 100 : 0);

  const mid  = pts.slice(h);
  const eh   = mid.slice(0, Math.floor(mid.length/2));
  const rh   = mid.slice(Math.floor(mid.length/2));
  const accel= avg(eh)>0 ? Math.round(((avg(rh)-avg(eh))/avg(eh))*100) : 0;

  const all = avg(pts);
  const dur = Math.round((pts.filter(p=>p.ratio>=all).length / pts.length)*100);

  return { surgeRate: surge, accel, durability: dur };
}

// ══════════════════════════════════════════════════════════════
// 데이터랩 변형어 생성 (최대 20개)
// ══════════════════════════════════════════════════════════════
function buildDatalabKeywords(productName, originalKeyword) {
  const set = new Set();

  // 1. 원본 키워드 최우선 (검색량 가장 많음)
  if (originalKeyword) set.add(originalKeyword.trim());

  // 2. 제품명 토큰 분할
  const tokens = productName.trim().split(/\s+/);
  if (tokens.length >= 1) set.add(tokens[0]);
  if (tokens.length >= 2) set.add(tokens.slice(0,2).join(' '));
  if (tokens.length >= 3) set.add(tokens.slice(0,3).join(' '));
  set.add(productName.trim());

  // 3. 원본 키워드 변형
  if (originalKeyword) {
    ['추천','인기','후기','비교'].forEach(s => set.add(originalKeyword + ' ' + s));
  }

  // 4. 마지막 토큰 (카테고리어)
  if (tokens.length > 1) set.add(tokens[tokens.length-1]);

  // 5. 동의어 확장
  const SYN = {
    '크림':    ['크림','보습크림','수분크림','스킨케어'],
    '세럼':    ['세럼','에센스','앰플'],
    '캐리어':  ['캐리어','여행가방','트렁크','여행캐리어'],
    '선크림':  ['선크림','선스크린','자외선차단제','썬크림'],
    '다이어트':['다이어트','체중감량','살빼기'],
    '수면':    ['수면','숙면','불면증'],
    '탈모':    ['탈모','두피','모발'],
    '마스크':  ['마스크팩','시트마스크','페이스팩'],
    '폼롤러':  ['폼롤러','마사지롤러','근막이완'],
    '텀블러':  ['텀블러','보온텀블러','보냉컵'],
    '가방':    ['가방','백팩','숄더백','크로스백'],
    '쿠션':    ['쿠션','쿠션팩트','파운데이션'],
    '향수':    ['향수','퍼퓸','오드퍼퓸'],
    '청소기':  ['청소기','무선청소기','로봇청소기'],
    '이어폰':  ['이어폰','무선이어폰','블루투스이어폰'],
  };
  const last = tokens[tokens.length-1];
  if (SYN[last]) SYN[last].forEach(s => set.add(s));
  if (originalKeyword && SYN[originalKeyword]) SYN[originalKeyword].forEach(s => set.add(s));

  return [...set].filter(k => k && k.length >= 2).slice(0, 20);
}

// ══════════════════════════════════════════════════════════════
// 데이터랩 직접 호출 (keywords 배열 완전 제어)
// ══════════════════════════════════════════════════════════════
async function fetchDatalabDirect(productName, originalKeyword, period) {
  const kwList    = buildDatalabKeywords(productName, originalKeyword);
  const totalDays = period === 'month' ? 60 : 14;
  const timeUnit  = period === 'month' ? 'week' : 'date';

  const body = {
    startDate:     fmtDate(agoDate(totalDays+1)),
    endDate:       fmtDate(agoDate(1)),
    timeUnit,
    keywordGroups: [{ groupName: originalKeyword || productName, keywords: kwList }],
    device: '', gender: '', ages: [],
  };

  console.log(`[datalab] "${productName}" → groupName:"${body.keywordGroups[0].groupName}" keywords(${kwList.length}):`, kwList.slice(0,5).join(', ') + (kwList.length>5?'...':''));

  const data = await naverPost('/v1/datalab/search', body);
  if (data && data.results && data.results[0]) {
    const result = parseDatalab(data.results[0], productName);
    if (!result._fallback) return result;
  }

  console.warn('[datalab fallback]', productName);
  return { surgeRate:0, accel:0, durability:50, _fallback:true };
}

// ══════════════════════════════════════════════════════════════
// STEP 1 — 쇼핑 수집 → 실제 제품명 추출
// ══════════════════════════════════════════════════════════════
function extractProductName(title, brand) {
  let t = stripHtml(title || '')
    .replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/【.*?】/g, '')
    .replace(/\d+\+\d+/g, '')
    .replace(/\d+매|\d+개|\d+팩|\d+입|\d+세트/g, '')
    .replace(/\d+\s*[gGmMlLkK]+\b/g, '')
    .replace(/무료배송|당일배송|로켓배송|오늘출발/g, '')
    .replace(/공식|정품|정식|국내정품|직배송/g, '')
    .replace(/특가|할인|세일|쿠폰|적립/g, '')
    .replace(/최저가|추천|인기|베스트|신상/g, '')
    .replace(/\s{2,}/g, ' ').trim();

  const tokens = t.split(/\s+/).filter(tk =>
    tk.length >= 1 && !/^[A-Z]{1,2}$/.test(tk) && !/^\d+$/.test(tk)
  );
  const hasBrand = brand && t.toLowerCase().includes(brand.toLowerCase().slice(0,3));
  const prefix   = (!hasBrand && brand && brand.length >= 2) ? brand + ' ' : '';
  const name     = (prefix + tokens.slice(0,5).join(' ')).trim();
  return name.length >= 2 ? name : t.slice(0,30).trim();
}

async function extractProductCandidates(keyword, apiStatus) {
  const counter = {}, metaMap = {};
  const queries = [keyword, `${keyword} 추천`, `${keyword} 인기`, `${keyword} 후기`];

  for (const q of queries) {
    for (let page = 0; page < 2; page++) {
      const res = await naverShopGet(q, 100, page*100+1);
      if (!res || !res.items || !res.items.length) break;

      res.items.forEach(item => {
        const name = extractProductName(item.title, (item.brand||'').trim());
        if (!name || name.length < 2) return;

        counter[name] = (counter[name] || 0) + 1;

        if (!metaMap[name] || safeNum(item.lprice) < safeNum(metaMap[name].price)) {
          metaMap[name] = {
            price: safeNum(item.lprice), hprice: safeNum(item.hprice),
            category1: item.category1||'', category2: item.category2||'',
            category3: item.category3||'', mallName: item.mallName||'',
            brand: item.brand||'', maker: item.maker||'',
            image: item.image||'', link: item.link||'',
          };
        }
      });
      await sleep(200);
    }
    await sleep(250);
  }

  let sorted = Object.entries(counter)
    .filter(([k]) => k.length >= 2)
    .sort((a,b) => b[1]-a[1])
    .slice(0,20)
    .map(([name,freq]) => ({
      productName: name, originalKeyword: keyword, frequency: freq,
      shopMeta: metaMap[name]||null,
      naverData:null, datalabData:null, insightData:null,
      ytData:null, searchIntentData:null, groqFit:null, geminiBonus:null,
      scores:{}, finalScore:0, group:'watch',
    }));

  if (sorted.length < 8) {
    try {
      const groqList = await GROQ.mapKeywordToProducts(keyword, CFG.KW_TYPE.GENERAL_PRODUCT);
      groqList.forEach(name => {
        if (!sorted.find(s => s.productName === name)) {
          sorted.push({ productName:name, originalKeyword:keyword, frequency:1, shopMeta:null,
            naverData:null, datalabData:null, insightData:null, ytData:null,
            searchIntentData:null, groqFit:null, geminiBonus:null,
            scores:{}, finalScore:0, group:'watch' });
        }
      });
    } catch (_) {}
  }

  const result = sorted.slice(0,20);
  apiStatus.step1 = `✅ 제품 후보 ${result.length}개 추출`;
  console.log('[STEP1] TOP8:', result.slice(0,8).map(s=>`${s.productName}(${s.frequency})`).join(' | '));
  return result;
}

// ══════════════════════════════════════════════════════════════
// STEP 2 — 네이버 검색 + 검색의도
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
// STEP 3 — 데이터랩 (keywords 배열 직접 제어 ★핵심 수정)
// ══════════════════════════════════════════════════════════════
async function collectDatalabData(candidates, period, apiStatus) {
  let ok = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      c.datalabData = await fetchDatalabDirect(c.productName, c.originalKeyword, period);
      if (c.datalabData && !c.datalabData._fallback) ok++;
    } catch (_) { c.datalabData = null; }
    await sleep(350);
  }
  apiStatus.step3 = `✅ 데이터랩 ${ok}/${candidates.length}`;
  console.log(`[STEP3] 데이터랩 OK: ${ok}/${candidates.length}`);
  return candidates;
}

// ══════════════════════════════════════════════════════════════
// STEP 4 — 쇼핑인사이트
// ══════════════════════════════════════════════════════════════
async function collectInsightData(candidates, period, apiStatus) {
  const limit = Math.min(candidates.length, 12);
  let ok = 0;
  for (let i = 0; i < limit; i++) {
    const c = candidates[i];
    try {
      const catName = c.shopMeta?.category1 || '';
      const catId   = CFG.NAVER_CAT_IDS[catName] || null;
      // 1차: 원본 키워드로 인사이트 (catId 있으면 더 정확)
      c.insightData = await NAVER.fetchNaverShoppingInsight(
        c.originalKeyword || c.productName, catId, period
      );
      if (c.insightData && !c.insightData._fallback) { ok++; }
      else {
        // 2차: 제품명으로 재시도
        await sleep(150);
        c.insightData = await NAVER.fetchNaverShoppingInsight(c.productName, catId, period);
        if (c.insightData && !c.insightData._fallback) ok++;
      }
    } catch (_) { c.insightData = null; }
    await sleep(220);
  }
  candidates.slice(limit).forEach(c => { c.insightData = null; });
  apiStatus.step4 = `✅ 쇼핑인사이트 ${ok}/${limit}`;
  console.log(`[STEP4] 인사이트 OK: ${ok}/${limit}`);
  return candidates;
}

// ══════════════════════════════════════════════════════════════
// STEP 5 — YouTube
// ══════════════════════════════════════════════════════════════
async function collectYoutubeData(candidates, apiStatus) {
  const top12 = candidates.slice(0,12).map(c => c.productName);
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
    console.warn('[STEP5]', e.message);
  }
  return candidates;
}

// ══════════════════════════════════════════════════════════════
// STEP 6 — Groq 전환 점수
// ══════════════════════════════════════════════════════════════
async function collectGroqFit(candidates, apiStatus) {
  for (let i = 0; i < Math.min(candidates.length, 10); i++) {
    try { candidates[i].groqFit = await GROQ.calcProductFitGroq(candidates[i].productName, CFG.KW_TYPE.GENERAL_PRODUCT); }
    catch (_) { candidates[i].groqFit = null; }
    await sleep(160);
  }
  apiStatus.step6 = '✅ Groq 완료';
  return candidates;
}

// ══════════════════════════════════════════════════════════════
// SCORING
// ══════════════════════════════════════════════════════════════
function calcSalesSignal(naverData, shopMeta) {
  if (!naverData || naverData._fallback) return 30;
  let s = 15;
  if (naverData.shoppingExists) s += 28;
  const cnt = safeNum(naverData.shopItemCount);
  if (cnt > 200) s += 25; else if (cnt > 50) s += 18; else if (cnt > 10) s += 10; else if (cnt > 0) s += 5;
  s += Math.min(18, safeNum(naverData.buyIntentHits) * 3);
  const price = shopMeta ? safeNum(shopMeta.price) : 0;
  if (price >= 5000 && price <= 80000) s += 12;
  else if (price > 80000 && price <= 200000) s += 6;
  if (naverData.priceGrade === 'mid') s += 5;
  return clamp(s);
}

function calcReviewQuality(naverData) {
  if (!naverData || naverData._fallback) return 25;
  let s = 8;
  const blog = safeNum(naverData.blogCount);
  if (blog > 100000) s += 32; else if (blog > 30000) s += 25;
  else if (blog > 5000) s += 18; else if (blog > 500) s += 10; else if (blog > 50) s += 5;
  s += Math.min(20, safeNum(naverData.recentPostRatio) * 0.22);
  s += Math.min(12, safeNum(naverData.buyIntentHits) * 2);
  if (safeNum(naverData.newsCount) > safeNum(naverData.blogCount) * 3) s -= 12;
  return clamp(s);
}

function calcTrendScore(datalabData, insightData) {
  const dlOk  = datalabData && !datalabData._fallback;
  const insOk = insightData && !insightData._fallback;
  if (!dlOk && !insOk) return 50; // 중립값

  let s = 22;
  if (dlOk) {
    const sr = safeNum(datalabData.surgeRate);
    if (sr > 80) s += 38; else if (sr > 40) s += 28;
    else if (sr > 15) s += 16; else if (sr > 0) s += 8; else if (sr < -15) s -= 18;
    if (safeNum(datalabData.accel) > 20) s += 10;
    if (safeNum(datalabData.durability) > 65) s += 5;
  }
  if (insOk) {
    const cs = safeNum(insightData.clickSurge);
    if (cs > 40) s += 22; else if (cs > 15) s += 14; else if (cs > 0) s += 6;
    if (insightData.shopTrend === 'hot') s += 15;
    else if (insightData.shopTrend === 'rising') s += 8;
    else if (insightData.shopTrend === 'falling') s -= 12;
  }
  return clamp(s);
}

function calcViralScore(ytData) {
  if (!ytData) return 22;
  let s = 8;
  const rc = safeNum(ytData.recentCount);
  if (rc > 30) s += 28; else if (rc > 10) s += 18; else if (rc > 3) s += 10; else if (rc > 0) s += 5;
  const vs = safeNum(ytData.avgViralScore);
  if (vs > 5000) s += 28; else if (vs > 500) s += 18; else if (vs > 50) s += 8;
  if (ytData.hasShorts) s += 14;
  if (ytData.hasVisualHook) s += 8;
  return clamp(Math.max(s, 8));
}

function calcConversionScore(groqFit, searchIntentData) {
  let s = 45;
  if (groqFit && typeof groqFit.score === 'number') s = Math.round((s + safeNum(groqFit.score)) / 2);
  if (searchIntentData) {
    if (searchIntentData.type === 'buy') s += 15;
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
    0.30 * salesSignal + 0.25 * reviewQuality +
    0.25 * trendScore  + 0.10 * viralScore + 0.10 * convScore
  );

  const hasTrendData = (c.datalabData && !c.datalabData._fallback) ||
                       (c.insightData  && !c.insightData._fallback);
  let group;
  if (hasTrendData) {
    if (finalScore >= 65 && salesSignal >= 58 && trendScore >= 48) group = 'hot';
    else if (finalScore >= 48) group = 'rising';
    else group = 'watch';
  } else {
    if (finalScore >= 58 && salesSignal >= 65 && reviewQuality >= 55) group = 'hot';
    else if (finalScore >= 44 && salesSignal >= 50) group = 'rising';
    else group = 'watch';
  }

  return {
    ...c,
    scores: { salesSignal, reviewQuality, trendScore, viralScore, conversion: convScore },
    finalScore, group, hasTrendData,
    searchIntentType:   c.searchIntentData?.type || 'explore',
    isShortsCompatible: !!(c.ytData?.isShortsCompatible || c.ytData?.hasVisualHook),
    isBlogCompatible:   !!(c.ytData?.isBlogCompatible),
    hasVisualHook:      !!(c.ytData?.hasVisualHook),
    hasUsageScene:      !!(c.ytData?.hasUsageScene),
  };
}

// ══════════════════════════════════════════════════════════════
// STEP 7 — Groq 설명
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
// STEP 8 — Gemini 분석
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
    guide = await GEMINI.generateFinalNarrative(top10, summary);
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
      return res.status(200).json({ products:[], apiStatus, error:'제품 후보 없음' });

    candidates = await collectSearchData(candidates, apiStatus);
    candidates = await collectDatalabData(candidates, period, apiStatus);
    candidates = await collectInsightData(candidates, period, apiStatus);
    candidates = await collectYoutubeData(candidates, apiStatus);
    candidates = await collectGroqFit(candidates, apiStatus);

    candidates = candidates.map(scoreProduct).sort((a,b) => b.finalScore - a.finalScore);
    const top10 = candidates.slice(0, maxCount);

    await generateReasons(top10, apiStatus);
    const { structuredRecs, guide } = await generateGeminiInsights(top10, apiStatus);

    console.log(`[product-search] 완료 TOP${top10.length}:`, top10.map(p=>p.productName).join(' | '));

    return res.status(200).json({
      keyword, products: top10, total: top10.length,
      structuredRecs, guide, apiStatus,
      updatedAt: new Date().toISOString(),
    });

  } catch (e) {
    console.error('[product-search fatal]', e.message, '\n', e.stack);
    return res.status(500).json({ error: '검색 오류', detail: e.message });
  }
};
