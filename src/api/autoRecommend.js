// v6.0 - DataLab 검색 트렌드 + 쇼핑인사이트 + YouTube 통합
const safe    = (fn, fb=0) => { try { const v=fn(); return (v===null||v===undefined||isNaN(v)||!isFinite(v))?fb:v; } catch { return fb; } };
const safeDiv = (a, b, fb=0) => (!b||isNaN(b)||!isFinite(b)) ? fb : safe(()=>a/b, fb);
const stripHtml = s => (s||"").replace(/<[^>]*>/g,"").replace(/&[^;]+;/g," ").trim();

const fmt = d => d.toISOString().split("T")[0]; // YYYY-MM-DD

// ── 날짜 헬퍼 ─────────────────────────
const dateRange = (daysAgo) => {
  const end   = new Date();
  const start = new Date(Date.now() - daysAgo*86400000);
  return { start: fmt(start), end: fmt(end) };
};

// ══════════════════════════════════════
// API 호출
// ══════════════════════════════════════
const fetchNaver = async (type, query, display=15) => {
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

// ── DataLab 검색어 트렌드 ─────────────
// 1일 / 7일 / 30일 ratio 비교 → 상승률 계산
const fetchDataLab = async (keyword) => {
  try {
    const { start, end } = dateRange(30);
    const body = {
      startDate: start,
      endDate: end,
      timeUnit: "date",
      keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
    };
    const res = await fetch("/api/naver-datalab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const points = data.results?.[0]?.data || [];
    if (!points.length) return null;

    // 최근 1일 / 7일 평균 / 30일 평균
    const sorted  = [...points].sort((a,b)=>a.period.localeCompare(b.period));
    const last1   = sorted.slice(-1).map(p=>p.ratio);
    const last7   = sorted.slice(-7).map(p=>p.ratio);
    const last30  = sorted.map(p=>p.ratio);

    const avg1  = last1.reduce((a,b)=>a+b,0) / Math.max(1, last1.length);
    const avg7  = last7.reduce((a,b)=>a+b,0) / Math.max(1, last7.length);
    const avg30 = last30.reduce((a,b)=>a+b,0) / Math.max(1, last30.length);

    // 상승률: 최근 1일 vs 7일 평균
    const risingRate1v7  = avg7  > 0 ? Math.round((avg1/avg7  - 1)*100) : 0;
    // 상승률: 최근 7일 평균 vs 30일 평균
    const risingRate7v30 = avg30 > 0 ? Math.round((avg7/avg30 - 1)*100) : 0;

    // 종합 상승률 (단기 + 중기 가중)
    const risingRate = Math.round(risingRate1v7*0.6 + risingRate7v30*0.4);

    // 트렌드 방향
    let trendDir;
    if      (risingRate >= 50)  trendDir = "급상승";
    else if (risingRate >= 15)  trendDir = "상승";
    else if (risingRate >= -10) trendDir = "유지";
    else                        trendDir = "하락";

    return { avg1, avg7, avg30, risingRate, risingRate1v7, risingRate7v30, trendDir, points: sorted };
  } catch { return null; }
};

// ── 쇼핑인사이트 클릭 트렌드 ─────────
const fetchShoppingInsight = async (keyword) => {
  try {
    const { start, end } = dateRange(30);
    const body = {
      startDate: start,
      endDate: end,
      timeUnit: "date",
      keyword,
      device: "",
      gender: "",
      ages: [],
    };
    const res = await fetch("/api/naver-insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const points = data.results?.[0]?.data || [];
    if (!points.length) return null;

    const sorted = [...points].sort((a,b)=>a.period.localeCompare(b.period));
    const last1  = sorted.slice(-1).map(p=>p.ratio);
    const last7  = sorted.slice(-7).map(p=>p.ratio);
    const last30 = sorted.map(p=>p.ratio);

    const avg1  = last1.reduce((a,b)=>a+b,0)  / Math.max(1, last1.length);
    const avg7  = last7.reduce((a,b)=>a+b,0)  / Math.max(1, last7.length);
    const avg30 = last30.reduce((a,b)=>a+b,0) / Math.max(1, last30.length);

    const clickRising1v7  = avg7  > 0 ? Math.round((avg1/avg7  - 1)*100) : 0;
    const clickRising7v30 = avg30 > 0 ? Math.round((avg7/avg30 - 1)*100) : 0;
    const clickRising     = Math.round(clickRising1v7*0.6 + clickRising7v30*0.4);

    return { avg1, avg7, avg30, clickRising, clickRising1v7, clickRising7v30, points: sorted };
  } catch { return null; }
};

// ── YouTube: 최신 업로드 중심 속도 계산 ─
const fetchYT = async (query, apiKey, mode="stable", maxResults=10) => {
  try {
    const hours     = mode==="realtime" ? 12 : 48;
    const order     = mode==="realtime" ? "date" : "viewCount";
    const published = new Date(Date.now()-hours*60*60*1000).toISOString();
    const sr = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=id&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&order=${order}&regionCode=KR&relevanceLanguage=ko&publishedAfter=${published}&key=${apiKey}`
    );
    if (!sr.ok) return [];
    const sd = await sr.json();
    if (sd.error || !sd.items?.length) {
      if (mode==="realtime") {
        const pub24 = new Date(Date.now()-24*60*60*1000).toISOString();
        const sr2 = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=id&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&order=date&regionCode=KR&relevanceLanguage=ko&publishedAfter=${pub24}&key=${apiKey}`
        );
        if (!sr2.ok) return [];
        const sd2 = await sr2.json();
        if (sd2.error || !sd2.items?.length) return [];
        const ids2 = sd2.items.map(i=>i.id.videoId).join(",");
        const vr2  = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&fields=items(id,snippet(title,publishedAt),statistics)&id=${ids2}&key=${apiKey}`);
        if (!vr2.ok) return [];
        return (await vr2.json()).items || [];
      }
      return [];
    }
    const ids = sd.items.map(i=>i.id.videoId).join(",");
    const vr  = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&fields=items(id,snippet(title,publishedAt),statistics)&id=${ids}&key=${apiKey}`);
    if (!vr.ok) return [];
    return (await vr.json()).items || [];
  } catch { return []; }
};

// ── YouTube 반응 속도 분석 ────────────
const analyzeYT = (videos, mode="stable") => {
  if (!videos.length) return { score:0, velocity:0, accel:1, status:"유지", avgViews:0, avgEngRate:0, freshCount:0, freshAvgHours:0, hasData:false };
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

  const threshold = mode==="realtime" ? 12 : 24;
  const fresh  = enriched.filter(v=>v.hoursAgo<=threshold);
  const mature = enriched.filter(v=>v.hoursAgo>threshold);

  const avgViews    = safe(()=>enriched.reduce((s,v)=>s+v.views,0)/enriched.length, 0);
  const avgVelocity = safe(()=>enriched.reduce((s,v)=>s+v.velocity,0)/enriched.length, 0);
  const avgEngRate  = safe(()=>enriched.reduce((s,v)=>s+v.engRate,0)/enriched.length, 0);
  const ytScore     = Math.min(100, safe(()=>Math.log10(avgVelocity+1)/Math.log10(10000)*100, 0));

  const fv = fresh.length  ? safe(()=>fresh.reduce((s,v)=>s+v.velocity,0)/fresh.length,  0) : 0;
  const mv = mature.length ? safe(()=>mature.reduce((s,v)=>s+v.velocity,0)/mature.length, 1) : 1;
  const accel = Math.min(5, safeDiv(fv, Math.max(1,mv), 1));

  let status;
  if      (accel>=2.5)  status = "급상승";
  else if (accel>=1.5)  status = "상승 시작";
  else if (accel>=0.8)  status = "유지";
  else                  status = "하락 가능";

  return {
    score: Math.round(ytScore),
    velocity: safe(()=>Math.round(accel*10)/10, 1),
    accel, status,
    avgViews: Math.round(avgViews),
    avgEngRate: Math.round(avgEngRate*10)/10,
    hasData: true,
    freshCount: fresh.length,
    freshAvgHours: fresh.length ? Math.round(fresh.reduce((s,v)=>s+v.hoursAgo,0)/fresh.length*10)/10 : 0,
  };
};

// ── 구매 의도 ─────────────────────────
const INTENT = {
  purchase: ["구매","사다","샀","구입","주문","결제","살까","사야","구매후기","구입했","장바구니"],
  compare:  ["비교","vs","어떤게","뭐가","차이","고민","선택","골라","추천"],
  price:    ["최저가","할인","쿠폰","세일","가격","얼마","저렴","가성비","특가","무료배송"],
  review:   ["후기","리뷰","사용기","써봤","써본","솔직","진짜","실제"],
};
const calcPurchaseIntent = (items) => {
  if (!items.length) return 0;
  const text  = items.map(i=>stripHtml(i.title+" "+(i.description||""))).join(" ");
  const total = Math.max(1, (text.match(/[가-힣]+/g)||[]).length);
  const hits =
    INTENT.purchase.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*3 +
    INTENT.compare.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*2 +
    INTENT.price.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*2 +
    INTENT.review.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*1;
  return Math.min(100, Math.round(safeDiv(hits, total, 0)*80));
};

// ── 쇼핑 분석 ─────────────────────────
const analyzeShop = (items) => {
  if (!items.length) return { exists:false, score:0, avgPrice:0, minPrice:0, reviewTotal:0, top:null };
  const prices  = items.map(s=>parseInt(s.lprice)||0).filter(p=>p>0);
  const reviews = items.map(s=>parseInt(s.reviewCount)||0);
  const avgPrice    = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
  const minPrice    = prices.length ? Math.min(...prices) : 0;
  const reviewTotal = reviews.reduce((a,b)=>a+b,0);
  const priceScore  = avgPrice>=3000&&avgPrice<=1000000
    ? 100-safe(()=>Math.abs(Math.log10(avgPrice)-Math.log10(50000))/Math.log10(100)*50,50) : 20;
  const reviewScore = Math.min(100, safe(()=>Math.log10(reviewTotal+1)/Math.log10(10000)*100,0));
  const score = Math.round(priceScore*0.5+reviewScore*0.5);
  const topItem = [...items].sort((a,b)=>(parseInt(b.reviewCount)||0)-(parseInt(a.reviewCount)||0))[0];
  return {
    exists:true, score, avgPrice, minPrice, reviewTotal, count:items.length,
    top: topItem ? { name:stripHtml(topItem.title), price:parseInt(topItem.lprice)||0, mall:topItem.mallName, url:topItem.link } : null
  };
};

const calcCompetition = (docCount, avgViews, shopCount) => {
  const d = Math.min(100, safe(()=>Math.log10(safeDiv(docCount,Math.max(1,avgViews),0)+1)/Math.log10(10)*100,50));
  const s = Math.min(100, safe(()=>shopCount/20*100,50));
  return Math.round(d*0.6+s*0.4);
};

// ══════════════════════════════════════
// 실시간 관심 점수 (4개 신호 통합)
// ══════════════════════════════════════
const calcRealtimeScore = (datalab, insight, yt, purchase, shop, competition) => {
  const compBonus = Math.max(0, 100-competition);

  // 1. 검색 상승률 점수 (DataLab) — 0~100
  const searchScore = datalab
    ? Math.min(100, Math.max(0, 50 + datalab.risingRate))
    : 30; // DataLab 없으면 중간값

  // 2. 쇼핑 클릭 상승률 (Insight) — 0~100
  const clickScore = insight
    ? Math.min(100, Math.max(0, 50 + insight.clickRising))
    : 30;

  // 3. YouTube 반응 속도 — 0~100
  const ytScore = yt.hasData
    ? Math.min(100, yt.score + (yt.accel-1)*20)
    : 0;

  // 4. 구매 의도 — 0~100
  const purchScore = purchase;

  // 가중 합산
  // DataLab 25% + 쇼핑인사이트 25% + YouTube 30% + 구매의도 15% + 경쟁역수 5%
  let score = searchScore*0.25 + clickScore*0.25 + ytScore*0.30 + purchScore*0.15 + compBonus*0.05;

  // 상태 배율
  if (datalab?.trendDir==="급상승") score = Math.min(100, score*1.4);
  else if (datalab?.trendDir==="상승") score = Math.min(100, score*1.2);
  if (yt.status==="급상승")         score = Math.min(100, score*1.2);
  else if (yt.status==="상승 시작") score = Math.min(100, score*1.1);

  return Math.round(Math.min(100, Math.max(0, score)));
};

// 안정 추천 점수
const calcFinalScore = (datalab, yt, purchase, shop, competition) => {
  const compBonus = Math.max(0, 100-competition);
  const searchScore = datalab ? Math.min(100, Math.max(0, 50+datalab.risingRate7v30)) : 30;
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

// ── 타이밍 판단 ───────────────────────
const getTiming = (score, trendDir, ytStatus, mode) => {
  if (mode==="realtime") {
    if ((trendDir==="급상승"||ytStatus==="급상승") && score>=55) return { label:"⚡ 지금 당장", color:"#ffd700" };
    if ((trendDir==="상승"||ytStatus==="상승 시작") && score>=35) return { label:"🚀 진입 시작", color:"#ff8800" };
    if (score>=20) return { label:"👀 모니터링", color:"#4488ff" };
    return { label:"⏸ 대기", color:"#555" };
  }
  if (score>=65) return { label:"⚡ 지금 당장", color:"#ffd700" };
  if (score>=45) return { label:"✅ 진입 적기", color:"#03c75a" };
  if (score>=25) return { label:"📊 검토 필요", color:"#ff8800" };
  return { label:"⏰ 관망", color:"#888" };
};

// ── 추천 이유 생성 ────────────────────
const buildReason = (datalab, insight, yt, purchase, shop, mode) => {
  const parts = [];
  if (mode==="realtime") {
    if (datalab?.trendDir==="급상승") parts.push(`검색량 ${datalab.risingRate}% 급상승`);
    else if (datalab?.risingRate>0)   parts.push(`검색 상승률 +${datalab.risingRate}%`);
    if (insight?.clickRising>0)       parts.push(`쇼핑 클릭 +${insight.clickRising}%`);
    if (yt.hasData && yt.velocity>=1.5) parts.push(`YouTube 가속도 ${yt.velocity}x`);
    if (yt.freshCount>=2)             parts.push(`최신 영상 ${yt.freshCount}개 반응 중`);
  } else {
    if (datalab?.risingRate7v30>10)   parts.push(`7일 검색 상승 +${datalab.risingRate7v30}%`);
    if (purchase>=50)                 parts.push(`구매 의도 ${purchase}%`);
    if (shop.reviewTotal>100)         parts.push(`누적 리뷰 ${shop.reviewTotal.toLocaleString()}개`);
    if (shop.avgPrice>0)              parts.push(`평균가 ${shop.avgPrice.toLocaleString()}원`);
    if (yt.hasData)                   parts.push(`YouTube ${yt.status}`);
  }
  return parts.join(" · ") || "복합 데이터 분석 기반";
};

// ══════════════════════════════════════
// 고정 시드
// ══════════════════════════════════════
const FIXED_SEEDS = [
  "무선이어폰","공기청정기","로봇청소기","노트북","태블릿","스마트워치","블루투스스피커","보조배터리",
  "선크림","세럼","비타민","마스크팩","폼클렌징","샴푸","단백질보충제","유산균",
  "에어프라이어","전기포트","텀블러","가습기","제습기","수납박스","전기그릴",
  "운동화","크로스백","레깅스","선글라스","백팩",
  "닭가슴살","견과류","프로틴바","커피원두","그릭요거트",
  "강아지사료","고양이간식","펫패드",
  "원피스","청바지","후드티","맨투맨","패딩",
  "냄비","프라이팬","밀폐용기","텀블러",
];

const collectSeeds = async () => {
  let extra = [];
  try {
    const shopItems = await Promise.all(["인기 가전","인기 뷰티","인기 생활"].map(q=>fetchShop(q,5)));
    const STOP = new Set(["최고","인기","추천","할인","특가","무료","배송","신상","정품","공식"]);
    const freq = {};
    shopItems.flat().forEach(i=>{
      (stripHtml(i.title).match(/[가-힣]{2,6}/g)||[])
        .filter(w=>!STOP.has(w)).forEach(w=>{ freq[w]=(freq[w]||0)+1; });
    });
    extra = Object.entries(freq).filter(([,c])=>c>=2).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k])=>k);
  } catch {}
  return [...new Set([...FIXED_SEEDS, ...extra])].slice(0, 40);
};

// ══════════════════════════════════════
// 메인 파이프라인
// ══════════════════════════════════════
export const runAutoRecommend = async (apiKey, onProgress, mode="stable") => {
  if (onProgress) onProgress(3, mode==="realtime" ? "⚡ 실시간 신호 수집 중..." : "💰 안정 분석 시작...");

  const seeds = await collectSeeds();
  if (onProgress) onProgress(8, `${seeds.length}개 키워드 분석 시작...`);

  const results = [];

  for (let i=0; i<seeds.length; i++) {
    const kw  = seeds[i];
    const pct = 8 + Math.round((i/seeds.length)*88);
    if (onProgress) onProgress(pct, `"${kw}" 분석 중... (${i+1}/${seeds.length})`);

    try {
      // 4개 신호 병렬 수집
      const [datalab, insight, videos, blogs, news, cafes, shops] = await Promise.all([
        fetchDataLab(kw),
        fetchShoppingInsight(kw),
        apiKey ? fetchYT(kw, apiKey, mode, 10) : Promise.resolve([]),
        fetchNaver("blog",        kw, 15),
        fetchNaver("news",        kw, 10),
        fetchNaver("cafearticle", kw, 10),
        fetchShop(kw, 10),
      ]);

      const allDocs     = [...blogs, ...news, ...cafes];
      const yt          = analyzeYT(videos, mode);
      const purchase    = calcPurchaseIntent(allDocs);
      const shop        = analyzeShop(shops);
      const competition = calcCompetition(allDocs.length, yt.avgViews, shops.length);
      const realtimeScore = calcRealtimeScore(datalab, insight, yt, purchase, shop, competition);
      const finalScore    = calcFinalScore(datalab, yt, purchase, shop, competition);

      if (!shop.exists) continue;

      // 실시간 모드: DataLab 또는 YouTube 중 하나는 있어야
      if (mode==="realtime" && !datalab && !yt.hasData) continue;
      if (mode==="realtime" && yt.status==="하락 가능" && (!datalab || datalab.trendDir==="하락")) continue;
      if (mode==="realtime" && realtimeScore < 5) continue;

      const score  = mode==="realtime" ? realtimeScore : finalScore;
      const timing = getTiming(score, datalab?.trendDir||"유지", yt.status, mode);
      const reason = buildReason(datalab, insight, yt, purchase, shop, mode);

      results.push({
        keyword: kw,
        finalScore,
        realtimeScore,
        // 출력 항목
        risingRate:    datalab?.risingRate    ?? null,
        risingRate1v7: datalab?.risingRate1v7 ?? null,
        risingRate7v30:datalab?.risingRate7v30?? null,
        trendDir:      datalab?.trendDir      ?? "데이터 없음",
        clickRising:   insight?.clickRising   ?? null,
        clickRising1v7:insight?.clickRising1v7?? null,
        ytVelocity:    yt.velocity,
        ytStatus:      yt.status,
        ytFreshCount:  yt.freshCount,
        avgEngRate:    yt.avgEngRate,
        // 기존 호환
        trend: { score:yt.score, velocity:yt.velocity, accel:yt.accel, status:yt.status, avgViews:yt.avgViews, avgEngRate:yt.avgEngRate, hasData:yt.hasData, freshCount:yt.freshCount, freshAvgHours:yt.freshAvgHours },
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
  return results.sort((a,b)=>b[key]-a[key]).slice(0, mode==="realtime" ? 5 : 10);
};
