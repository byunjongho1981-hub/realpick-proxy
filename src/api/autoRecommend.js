// v7.0 - 카테고리 제거 / 실시간 수요 기반 키워드 추천
const safe    = (fn, fb=0) => { try { const v=fn(); return (v===null||v===undefined||isNaN(v)||!isFinite(v))?fb:v; } catch { return fb; } };
const safeDiv = (a, b, fb=0) => (!b||isNaN(b)||!isFinite(b)) ? fb : safe(()=>a/b, fb);
const stripHtml = s => (s||"").replace(/<[^>]*>/g,"").replace(/&[^;]+;/g," ").trim();
const fmt = d => d.toISOString().split("T")[0];
const dateRange = (days) => ({ start: fmt(new Date(Date.now()-days*86400000)), end: fmt(new Date()) });

// ══════════════════════════════════════
// API 호출
// ══════════════════════════════════════
const fetchNaver = async (type, query, display=20) => {
  try {
    const res = await fetch(`/api/naver-search?query=${encodeURIComponent(query)}&type=${type}&display=${display}`);
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch { return []; }
};

const fetchShop = async (query, display=10) => {
  try {
    const res = await fetch(`/api/naver-shop?query=${encodeURIComponent(query)}&display=${display}`);
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch { return []; }
};

const fetchYTRaw = async (query, apiKey, hours=24, order="date", maxResults=15) => {
  try {
    const published = new Date(Date.now()-hours*3600000).toISOString();
    const sr = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=id&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&order=${order}&regionCode=KR&relevanceLanguage=ko&publishedAfter=${published}&key=${apiKey}`
    );
    if (!sr.ok) return [];
    const sd = await sr.json();
    if (sd.error || !sd.items?.length) return [];
    const ids = sd.items.map(i=>i.id.videoId).join(",");
    const vr = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&fields=items(id,snippet(title,publishedAt),statistics)&id=${ids}&key=${apiKey}`
    );
    if (!vr.ok) return [];
    return (await vr.json()).items || [];
  } catch { return []; }
};

const fetchDataLab = async (keyword) => {
  try {
    const { start, end } = dateRange(30);
    const res = await fetch("/api/naver-datalab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: start, endDate: end, timeUnit: "date",
        keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const pts = (data.results?.[0]?.data || []).sort((a,b)=>a.period.localeCompare(b.period));
    if (!pts.length) return null;
    const avg = arr => arr.reduce((s,v)=>s+v,0)/Math.max(1,arr.length);
    const a1  = avg(pts.slice(-1).map(p=>p.ratio));
    const a7  = avg(pts.slice(-7).map(p=>p.ratio));
    const a30 = avg(pts.map(p=>p.ratio));
    const r1v7  = a7  > 0 ? Math.round((a1/a7  -1)*100) : 0;
    const r7v30 = a30 > 0 ? Math.round((a7/a30 -1)*100) : 0;
    const risingRate = Math.round(r1v7*0.6 + r7v30*0.4);
    const trendDir = risingRate>=50?"급상승":risingRate>=15?"상승":risingRate>=-10?"유지":"하락";
    return { a1, a7, a30, risingRate, r1v7, r7v30, trendDir };
  } catch { return null; }
};

const fetchInsight = async (keyword) => {
  try {
    const { start, end } = dateRange(30);
    const res = await fetch("/api/naver-insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate:start, endDate:end, timeUnit:"date", keyword, device:"", gender:"", ages:[] }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const pts = (data.results?.[0]?.data || []).sort((a,b)=>a.period.localeCompare(b.period));
    if (!pts.length) return null;
    const avg = arr => arr.reduce((s,v)=>s+v,0)/Math.max(1,arr.length);
    const a1  = avg(pts.slice(-1).map(p=>p.ratio));
    const a7  = avg(pts.slice(-7).map(p=>p.ratio));
    const a30 = avg(pts.map(p=>p.ratio));
    const r1v7  = a7  > 0 ? Math.round((a1/a7  -1)*100) : 0;
    const r7v30 = a30 > 0 ? Math.round((a7/a30 -1)*100) : 0;
    const clickRising = Math.round(r1v7*0.6 + r7v30*0.4);
    return { a1, a7, a30, clickRising, r1v7, r7v30 };
  } catch { return null; }
};

// ══════════════════════════════════════
// Step 1. 후보 키워드 자동 수집
// ══════════════════════════════════════
const STOP = new Set([
  "것","수","등","및","이","그","저","를","이다","있다","하다","되다","않다","없다","같다",
  "많다","보다","위해","통해","대한","관련","가장","지난","올해","지금","오늘","정말","너무",
  "아주","매우","모든","어떤","이번","다음","현재","최근","직접","바로","다시","함께","위한",
  "대해","진짜","완전","우리","합니다","있습니다","하는","하고","하면","해서","해야","하지",
  "추천","리뷰","후기","언박싱","비교","최고","베스트","꿀팁","영상","채널","구독","유튜브",
  "클릭","좋아요","댓글","공유","구경","소개","일상","정보","상품","제품","브랜드","신제품",
  "출시","인기","요즘","핫한","강추","사용","기능","디자인","방법","효과","성분","재료",
  "구매","구입","할인","판매","가격","배송","정품","공식","최저가","무료","특가","세일",
  "리뷰어","유튜버","크리에이터","광고","협찬","내돈내산","솔직","진심","레알",
]);

// 동사/형용사 어미 패턴
const VERB_ENDINGS = /(?:하다|되다|이다|있다|없다|같다|많다|크다|작다|좋다|싫다|해서|하고|하면|해야|하지|하는|하여|하며|합니다|됩니다|입니다)$/;

const extractKeywords = (texts, minLen=2, maxLen=8, topN=30) => {
  const text = texts.join(" ").replace(/[^\uAC00-\uD7A3\s]/g," ").replace(/\s+/g," ");
  const tokens = (text.match(/[가-힣]{2,10}/g)||[]).filter(w => {
    if (w.length < minLen || w.length > maxLen) return false;
    if (STOP.has(w)) return false;
    if (VERB_ENDINGS.test(w)) return false;
    return true;
  });
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t]||0)+1;
  return Object.entries(freq)
    .filter(([,c])=>c>=2)
    .sort((a,b)=>b[1]-a[1])
    .slice(0, topN)
    .map(([kw,cnt])=>({ kw, cnt }));
};

const collectCandidates = async (apiKey) => {
  // 다각도 소스 병렬 수집
  const [
    newsItems, blogItems, cafeItems,
    shopTrend1, shopTrend2, shopTrend3,
    ytVideos1, ytVideos2,
  ] = await Promise.all([
    fetchNaver("news",        "신제품 출시 인기 품절 대란", 30),
    fetchNaver("blog",        "구매후기 사용후기 강추 솔직", 30),
    fetchNaver("cafearticle", "공동구매 살까말까 후기 추천", 30),
    fetchShop("인기", 20),
    fetchShop("신상", 20),
    fetchShop("품절", 20),
    apiKey ? fetchYTRaw("요즘 핫한 신상 리뷰 언박싱", apiKey, 24, "date", 20) : Promise.resolve([]),
    apiKey ? fetchYTRaw("구매 추천 신제품 리뷰", apiKey, 48, "viewCount", 15) : Promise.resolve([]),
  ]);

  // 텍스트 수집
  const naverTexts = [
    ...newsItems.map(i=>stripHtml(i.title+" "+(i.description||""))),
    ...blogItems.map(i=>stripHtml(i.title+" "+(i.description||""))),
    ...cafeItems.map(i=>stripHtml(i.title+" "+(i.description||""))),
  ];
  const shopTexts = [
    ...shopTrend1, ...shopTrend2, ...shopTrend3
  ].map(i=>stripHtml(i.title||""));
  const ytTexts = [
    ...(ytVideos1||[]), ...(ytVideos2||[])
  ].map(v=>v.snippet?.title||"");

  // 소스별 키워드 추출
  const naverKws = extractKeywords(naverTexts, 2, 8, 30);
  const shopKws  = extractKeywords(shopTexts,  2, 7, 25);
  const ytKws    = extractKeywords(ytTexts,    2, 8, 25);

  // 가중치 합산: 쇼핑 3x, YouTube 2x, 네이버 1x
  const scoreMap = {};
  for (const {kw,cnt} of naverKws) scoreMap[kw] = (scoreMap[kw]||0) + cnt*1;
  for (const {kw,cnt} of shopKws)  scoreMap[kw] = (scoreMap[kw]||0) + cnt*3;
  for (const {kw,cnt} of ytKws)    scoreMap[kw] = (scoreMap[kw]||0) + cnt*2;

  // 쇼핑 상품명에서 직접 추출한 키워드 부스트
  const directShopKws = new Set(shopKws.slice(0,10).map(k=>k.kw));
  for (const kw of directShopKws) {
    if (scoreMap[kw]) scoreMap[kw] *= 1.5;
  }

  return Object.entries(scoreMap)
    .sort((a,b)=>b[1]-a[1])
    .slice(0, 40)
    .map(([kw])=>kw);
};

// ══════════════════════════════════════
// YouTube 반응 속도 분석
// ══════════════════════════════════════
const analyzeYT = (videos) => {
  if (!videos.length) return {
    score:0, velocity:0, accel:1, status:"유지",
    avgViews:0, avgEngRate:0, freshCount:0, freshAvgHours:0, hasData:false
  };
  const now = Date.now();
  const enriched = videos.map(v => {
    const views    = safe(()=>parseInt(v.statistics?.viewCount)||0);
    const likes    = safe(()=>parseInt(v.statistics?.likeCount)||0);
    const comments = safe(()=>parseInt(v.statistics?.commentCount)||0);
    const pub      = v.snippet?.publishedAt;
    const hoursAgo = pub ? Math.max(0.1, safe(()=>(now-new Date(pub))/3600000,1)) : 24;
    const engagement = views + likes*5 + comments*10;
    const velocity   = safeDiv(engagement, hoursAgo, 0);
    const engRate    = safeDiv(likes+comments, Math.max(1,views), 0)*100;
    return { views, velocity, hoursAgo, engRate };
  });

  const fresh  = enriched.filter(v=>v.hoursAgo<=12);
  const mature = enriched.filter(v=>v.hoursAgo>12);
  const avgViews    = safe(()=>enriched.reduce((s,v)=>s+v.views,0)/enriched.length, 0);
  const avgVelocity = safe(()=>enriched.reduce((s,v)=>s+v.velocity,0)/enriched.length, 0);
  const avgEngRate  = safe(()=>enriched.reduce((s,v)=>s+v.engRate,0)/enriched.length, 0);
  const ytScore     = Math.min(100, safe(()=>Math.log10(avgVelocity+1)/Math.log10(10000)*100, 0));
  const fv = fresh.length  ? safe(()=>fresh.reduce((s,v)=>s+v.velocity,0)/fresh.length,  0) : 0;
  const mv = mature.length ? safe(()=>mature.reduce((s,v)=>s+v.velocity,0)/mature.length, 1) : 1;
  const accel = Math.min(5, safeDiv(fv, Math.max(1,mv), 1));
  const status = accel>=2.5?"급상승":accel>=1.5?"상승 시작":accel>=0.8?"유지":"하락 가능";

  return {
    score: Math.round(ytScore), velocity: safe(()=>Math.round(accel*10)/10,1),
    accel, status, avgViews: Math.round(avgViews),
    avgEngRate: Math.round(avgEngRate*10)/10, hasData:true,
    freshCount: fresh.length,
    freshAvgHours: fresh.length ? Math.round(fresh.reduce((s,v)=>s+v.hoursAgo,0)/fresh.length*10)/10 : 0,
  };
};

// ══════════════════════════════════════
// 쇼핑 분석
// ══════════════════════════════════════
const analyzeShopData = (items) => {
  if (!items.length) return { exists:false, score:0, avgPrice:0, reviewTotal:0, top:null };
  const prices  = items.map(s=>parseInt(s.lprice)||0).filter(p=>p>0);
  const reviews = items.map(s=>parseInt(s.reviewCount)||0);
  const avgPrice    = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
  const reviewTotal = reviews.reduce((a,b)=>a+b,0);
  const priceScore  = avgPrice>=3000&&avgPrice<=1000000
    ? 100-safe(()=>Math.abs(Math.log10(avgPrice)-Math.log10(50000))/Math.log10(100)*50,50) : 20;
  const reviewScore = Math.min(100, safe(()=>Math.log10(reviewTotal+1)/Math.log10(10000)*100,0));
  const score = Math.round(priceScore*0.5+reviewScore*0.5);
  const topItem = [...items].sort((a,b)=>(parseInt(b.reviewCount)||0)-(parseInt(a.reviewCount)||0))[0];
  return {
    exists:true, score, avgPrice, reviewTotal, count:items.length,
    top: topItem ? { name:stripHtml(topItem.title), price:parseInt(topItem.lprice)||0, mall:topItem.mallName, url:topItem.link } : null
  };
};

// ══════════════════════════════════════
// 실시간 관심 점수
// ══════════════════════════════════════
const calcRealtimeScore = (datalab, insight, yt, purchase, shop, competition) => {
  const compBonus = Math.max(0, 100-competition);

  // 각 신호 정규화
  const searchScore = datalab
    ? Math.min(100, Math.max(0, 50 + datalab.risingRate))
    : 25;
  const clickScore  = insight
    ? Math.min(100, Math.max(0, 50 + insight.clickRising))
    : 25;
  const ytScore = yt.hasData
    ? Math.min(100, yt.score + (yt.accel-1)*15)
    : 0;

  // 가중 합산: YT 35% + DataLab 25% + Insight 20% + 구매의도 15% + 경쟁역수 5%
  let score = ytScore*0.35 + searchScore*0.25 + clickScore*0.20 + purchase*0.15 + compBonus*0.05;

  // 상승 보너스
  if (datalab?.trendDir==="급상승")    score = Math.min(100, score*1.35);
  else if (datalab?.trendDir==="상승") score = Math.min(100, score*1.15);
  if (yt.status==="급상승")            score = Math.min(100, score*1.2);
  else if (yt.status==="상승 시작")    score = Math.min(100, score*1.1);

  // 하락 패널티
  if (datalab?.trendDir==="하락" && yt.status==="하락 가능") score *= 0.5;

  return Math.round(Math.min(100, Math.max(0, score)));
};

const calcFinalScore = (datalab, yt, purchase, shop, competition) => {
  const compBonus   = Math.max(0, 100-competition);
  const searchScore = datalab ? Math.min(100, Math.max(0, 50+datalab.r7v30)) : 30;
  let score;
  if (yt.hasData && yt.score>0) {
    score = searchScore*0.20 + yt.score*0.25 + purchase*0.25 + shop.score*0.20 + compBonus*0.10;
    if (yt.status==="급상승")      score = Math.min(100, score*1.25);
    else if (yt.status==="상승 시작") score = Math.min(100, score*1.1);
  } else {
    score = searchScore*0.25 + purchase*0.35 + shop.score*0.30 + compBonus*0.10;
  }
  return Math.round(Math.min(100, Math.max(0, score)));
};

const calcCompetition = (docCount, avgViews, shopCount) => {
  const d = Math.min(100, safe(()=>Math.log10(safeDiv(docCount,Math.max(1,avgViews),0)+1)/Math.log10(10)*100,50));
  const s = Math.min(100, safe(()=>shopCount/20*100,50));
  return Math.round(d*0.6+s*0.4);
};

const calcPurchaseIntent = (items) => {
  if (!items.length) return 0;
  const INTENT = {
    purchase: ["구매","사다","샀","구입","주문","결제","살까","사야","구매후기","장바구니"],
    compare:  ["비교","vs","어떤게","뭐가","차이","고민","선택","골라"],
    price:    ["최저가","할인","쿠폰","세일","얼마","저렴","가성비","특가"],
    review:   ["후기","리뷰","사용기","써봤","써본","솔직","실제"],
  };
  const text  = items.map(i=>stripHtml(i.title+" "+(i.description||""))).join(" ");
  const total = Math.max(1, (text.match(/[가-힣]+/g)||[]).length);
  const hits  =
    INTENT.purchase.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*3 +
    INTENT.compare.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*2 +
    INTENT.price.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*2 +
    INTENT.review.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*1;
  return Math.min(100, Math.round(safeDiv(hits,total,0)*80));
};

// ── 타이밍 ────────────────────────────
const getTiming = (score, trendDir, ytStatus, mode) => {
  if (mode==="realtime") {
    if (score>=60 && (trendDir==="급상승"||ytStatus==="급상승")) return { label:"⚡ 지금 당장", color:"#ffd700" };
    if (score>=40) return { label:"🚀 진입 시작", color:"#ff8800" };
    if (score>=20) return { label:"👀 모니터링", color:"#4488ff" };
    return { label:"⏸ 대기", color:"#555" };
  }
  if (score>=65) return { label:"⚡ 지금 당장", color:"#ffd700" };
  if (score>=45) return { label:"✅ 진입 적기", color:"#03c75a" };
  if (score>=25) return { label:"📊 검토 필요", color:"#ff8800" };
  return { label:"⏰ 관망", color:"#888" };
};

// ── 추천 이유 ─────────────────────────
const buildReason = (datalab, insight, yt, purchase, shop, mode) => {
  const parts = [];
  if (mode==="realtime") {
    if (datalab?.trendDir==="급상승")    parts.push(`검색 ${datalab.risingRate}% 급상승`);
    else if (datalab?.risingRate>0)      parts.push(`검색 상승 +${datalab.risingRate}%`);
    if (insight?.clickRising>10)         parts.push(`쇼핑 클릭 +${insight.clickRising}%`);
    if (yt.hasData && yt.velocity>=1.5)  parts.push(`YouTube 가속 ${yt.velocity}x`);
    if (yt.freshCount>=1)                parts.push(`최신 영상 ${yt.freshCount}개 반응 중`);
    if (yt.avgEngRate>0.5)               parts.push(`참여율 ${yt.avgEngRate}%`);
  } else {
    if (datalab?.r7v30>10)               parts.push(`7일 검색 +${datalab.r7v30}%`);
    if (insight?.clickRising>0)          parts.push(`쇼핑 클릭 추세 +${insight.clickRising}%`);
    if (purchase>=40)                    parts.push(`구매 의도 ${purchase}%`);
    if (shop.reviewTotal>100)            parts.push(`리뷰 ${shop.reviewTotal.toLocaleString()}개`);
    if (shop.avgPrice>0)                 parts.push(`평균가 ${shop.avgPrice.toLocaleString()}원`);
  }
  return parts.join(" · ") || "복합 데이터 분석 기반";
};

// ══════════════════════════════════════
// 메인 파이프라인
// ══════════════════════════════════════
export const runAutoRecommend = async (apiKey, onProgress, mode="stable") => {
  if (onProgress) onProgress(3, "실시간 후보 키워드 수집 중...");

  // Step 1: 동적 후보 키워드 수집
  const candidates = await collectCandidates(apiKey);
  if (!candidates.length) throw new Error("후보 키워드 수집 실패");

  if (onProgress) onProgress(12, `${candidates.length}개 후보 키워드 검증 시작...`);

  const results = [];

  for (let i=0; i<candidates.length; i++) {
    const kw  = candidates[i];
    const pct = 12 + Math.round((i/candidates.length)*84);
    if (onProgress) onProgress(pct, `"${kw}" 검증 중... (${i+1}/${candidates.length})`);

    try {
      // 4개 신호 병렬 수집
      const [datalab, insight, videos, blogs, news, shops] = await Promise.all([
        fetchDataLab(kw),
        fetchInsight(kw),
        apiKey ? fetchYTRaw(kw, apiKey, mode==="realtime"?12:48, mode==="realtime"?"date":"viewCount", 10) : Promise.resolve([]),
        fetchNaver("blog", kw, 15),
        fetchNaver("news", kw, 10),
        fetchShop(kw, 10),
      ]);

      const allDocs     = [...blogs, ...news];
      const yt          = analyzeYT(videos);
      const purchase    = calcPurchaseIntent(allDocs);
      const shop        = analyzeShopData(shops);
      const competition = calcCompetition(allDocs.length, yt.avgViews, shops.length);
      const realtimeScore = calcRealtimeScore(datalab, insight, yt, purchase, shop, competition);
      const finalScore    = calcFinalScore(datalab, yt, purchase, shop, competition);

      // 필터: 쇼핑 데이터 없으면 제외
      if (!shop.exists) continue;
      // 실시간: DataLab 또는 YT 중 하나는 있어야
      if (mode==="realtime" && !datalab && !yt.hasData) continue;
      if (mode==="realtime" && realtimeScore < 5) continue;

      const score  = mode==="realtime" ? realtimeScore : finalScore;
      const timing = getTiming(score, datalab?.trendDir||"유지", yt.status, mode);
      const reason = buildReason(datalab, insight, yt, purchase, shop, mode);

      results.push({
        keyword:       kw,
        finalScore,
        realtimeScore,
        // 출력 항목
        risingRate:    datalab?.risingRate    ?? null,
        risingRate1v7: datalab?.r1v7          ?? null,
        risingRate7v30:datalab?.r7v30         ?? null,
        trendDir:      datalab?.trendDir      ?? "데이터 없음",
        clickRising:   insight?.clickRising   ?? null,
        clickRising1v7:insight?.r1v7          ?? null,
        ytVelocity:    yt.velocity,
        ytStatus:      yt.status,
        ytFreshCount:  yt.freshCount,
        avgEngRate:    yt.avgEngRate,
        // 기존 컴포넌트 호환
        trend: {
          score:yt.score, velocity:yt.velocity, accel:yt.accel,
          status:yt.status, avgViews:yt.avgViews, avgEngRate:yt.avgEngRate,
          hasData:yt.hasData, freshCount:yt.freshCount, freshAvgHours:yt.freshAvgHours
        },
        purchase, competition, shop, timing, reason, mode,
      });
    } catch { continue; }
  }

  if (onProgress) onProgress(100, "분석 완료");

  if (!results.length) {
    if (mode==="realtime") throw new Error("현재 급상승 중인 항목이 없습니다. 안정 추천을 이용해주세요.");
    throw new Error("분석 결과가 없습니다. 잠시 후 다시 시도해주세요.");
  }

  const key = mode==="realtime" ? "realtimeScore" : "finalScore";
  return results.sort((a,b)=>b[key]-a[key]).slice(0, mode==="realtime"?5:10);
};
