// v5.0 - 실시간 추천 / 안정 추천 분리
const safe    = (fn, fb=0) => { try { const v=fn(); return (v===null||v===undefined||isNaN(v)||!isFinite(v))?fb:v; } catch { return fb; } };
const safeDiv = (a, b, fb=0) => (!b||isNaN(b)||!isFinite(b)) ? fb : safe(()=>a/b, fb);
const stripHtml = s => (s||"").replace(/<[^>]*>/g,"").replace(/&[^;]+;/g," ").trim();

// ══════════════════════════════════════
// API
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

// ── YouTube: 모드별 수집 ──────────────
// realtime: order=date (최신순) + 12h 윈도우
// stable:   order=viewCount + 48h 윈도우
const fetchYT = async (query, apiKey, mode="stable", maxResults=10) => {
  try {
    const hours  = mode==="realtime" ? 12 : 48;
    const order  = mode==="realtime" ? "date" : "viewCount";
    const published = new Date(Date.now()-hours*60*60*1000).toISOString();
    const sr = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=id&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&order=${order}&regionCode=KR&relevanceLanguage=ko&publishedAfter=${published}&key=${apiKey}`
    );
    if (!sr.ok) return [];
    const sd = await sr.json();
    if (sd.error || !sd.items?.length) {
      // realtime에서 결과 없으면 24h로 재시도
      if (mode==="realtime") {
        const pub24 = new Date(Date.now()-24*60*60*1000).toISOString();
        const sr2 = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=id&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&order=date&regionCode=KR&relevanceLanguage=ko&publishedAfter=${pub24}&key=${apiKey}`
        );
        if (!sr2.ok) return [];
        const sd2 = await sr2.json();
        if (sd2.error || !sd2.items?.length) return [];
        const ids2 = sd2.items.map(i=>i.id.videoId).join(",");
        const vr2 = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&fields=items(id,snippet(title,publishedAt),statistics)&id=${ids2}&key=${apiKey}`
        );
        if (!vr2.ok) return [];
        return (await vr2.json()).items || [];
      }
      return [];
    }
    const ids = sd.items.map(i=>i.id.videoId).join(",");
    const vr = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&fields=items(id,snippet(title,publishedAt),statistics)&id=${ids}&key=${apiKey}`
    );
    if (!vr.ok) return [];
    return (await vr.json()).items || [];
  } catch { return []; }
};

// ── 고정 시드 ─────────────────────────
const FIXED_SEEDS = [
  "무선이어폰","공기청정기","로봇청소기","노트북","태블릿","스마트워치","블루투스스피커","보조배터리",
  "선크림","세럼","비타민","마스크팩","폼클렌징","샴푸","단백질보충제","유산균",
  "에어프라이어","전기포트","텀블러","가습기","제습기","수납박스","전기그릴",
  "운동화","크로스백","레깅스","선글라스","백팩",
  "닭가슴살","견과류","프로틴바","커피원두","그릭요거트",
  "강아지사료","고양이간식","펫패드",
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
  return [...new Set([...FIXED_SEEDS, ...extra])].slice(0,28);
};

// ══════════════════════════════════════
// 트렌드 분석 (모드별)
// ══════════════════════════════════════
const analyzeTrend = (videos, mode="stable") => {
  if (!videos.length) return {
    score:0, velocity:0, accel:1, status:"유지",
    avgViews:0, hasData:false, freshCount:0, engagementRate:0
  };
  const now = Date.now();
  const enriched = videos.map(v => {
    const views    = safe(()=>parseInt(v.statistics?.viewCount)||0);
    const likes    = safe(()=>parseInt(v.statistics?.likeCount)||0);
    const comments = safe(()=>parseInt(v.statistics?.commentCount)||0);
    const pub      = v.snippet?.publishedAt;
    const hoursAgo = pub ? Math.max(0.1, safe(()=>(now-new Date(pub))/3600000, 1)) : 24;
    const engagement = views + likes*5 + comments*10; // 실시간은 참여도 가중치 높임
    const velocity   = safeDiv(engagement, hoursAgo, 0);
    const engRate    = safeDiv(likes+comments, Math.max(1,views), 0) * 100;
    return { views, likes, comments, velocity, hoursAgo, engRate };
  });

  const threshold = mode==="realtime" ? 12 : 24;
  const fresh  = enriched.filter(v=>v.hoursAgo<=threshold);
  const mature = enriched.filter(v=>v.hoursAgo>threshold);

  const avgViews     = safe(()=>enriched.reduce((s,v)=>s+v.views,0)/enriched.length, 0);
  const avgVelocity  = safe(()=>enriched.reduce((s,v)=>s+v.velocity,0)/enriched.length, 0);
  const avgEngRate   = safe(()=>enriched.reduce((s,v)=>s+v.engRate,0)/enriched.length, 0);
  const trendScore   = Math.min(100, safe(()=>Math.log10(avgVelocity+1)/Math.log10(10000)*100, 0));

  const fv = fresh.length  ? safe(()=>fresh.reduce((s,v)=>s+v.velocity,0)/fresh.length,  0) : 0;
  const mv = mature.length ? safe(()=>mature.reduce((s,v)=>s+v.velocity,0)/mature.length, 1) : 1;
  const accel  = Math.min(5, safeDiv(fv, Math.max(1,mv), 1));

  // 4단계 상태 분류
  let status;
  if      (accel>=2.5)                          status = "급상승";
  else if (accel>=1.5 || (fresh.length>=2 && fv>mv)) status = "상승 시작";
  else if (accel>=0.8)                          status = "유지";
  else                                           status = "하락 가능";

  return {
    score: Math.round(trendScore),
    velocity: safe(()=>Math.round(accel*10)/10, 1),
    accel, status,
    avgViews: Math.round(avgViews),
    avgEngRate: Math.round(avgEngRate*10)/10,
    hasData: true,
    freshCount: fresh.length,
    freshAvgHours: fresh.length ? Math.round(fresh.reduce((s,v)=>s+v.hoursAgo,0)/fresh.length*10)/10 : 0,
  };
};

// ══════════════════════════════════════
// 구매 의도
// ══════════════════════════════════════
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

// ══════════════════════════════════════
// 쇼핑 분석
// ══════════════════════════════════════
const analyzeShop = (items) => {
  if (!items.length) return { exists:false, score:0, avgPrice:0, minPrice:0, reviewTotal:0, top:null };
  const prices  = items.map(s=>parseInt(s.lprice)||0).filter(p=>p>0);
  const reviews = items.map(s=>parseInt(s.reviewCount)||0);
  const avgPrice    = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
  const minPrice    = prices.length ? Math.min(...prices) : 0;
  const reviewTotal = reviews.reduce((a,b)=>a+b,0);
  const priceScore  = avgPrice>=3000 && avgPrice<=1000000
    ? 100 - safe(()=>Math.abs(Math.log10(avgPrice)-Math.log10(50000))/Math.log10(100)*50, 50) : 20;
  const reviewScore = Math.min(100, safe(()=>Math.log10(reviewTotal+1)/Math.log10(10000)*100, 0));
  const score = Math.round(priceScore*0.5 + reviewScore*0.5);
  const topItem = [...items].sort((a,b)=>(parseInt(b.reviewCount)||0)-(parseInt(a.reviewCount)||0))[0];
  return {
    exists:true, score, avgPrice, minPrice, reviewTotal, count:items.length,
    top: topItem ? { name:stripHtml(topItem.title), price:parseInt(topItem.lprice)||0, mall:topItem.mallName, url:topItem.link } : null
  };
};

const calcCompetition = (docCount, avgViews, shopCount) => {
  const d = Math.min(100, safe(()=>Math.log10(safeDiv(docCount,Math.max(1,avgViews),0)+1)/Math.log10(10)*100, 50));
  const s = Math.min(100, safe(()=>shopCount/20*100, 50));
  return Math.round(d*0.6 + s*0.4);
};

// ══════════════════════════════════════
// 점수 공식 분리
// ══════════════════════════════════════

// 안정 추천: 균형 가산식
const calcFinalScore = (trend, purchase, shop, competition) => {
  const compScore = Math.max(0, 100-competition);
  let score;
  if (trend.hasData && trend.score > 0) {
    score = trend.score*0.30 + purchase*0.30 + shop.score*0.25 + compScore*0.15;
    if (trend.status==="급상승")      score = Math.min(100, score*1.3);
    else if (trend.status==="상승 시작") score = Math.min(100, score*1.15);
  } else {
    score = purchase*0.45 + shop.score*0.40 + compScore*0.15;
  }
  return Math.round(Math.min(100, Math.max(0, score)));
};

// 실시간 추천: 속도·참여도 중심
const calcRealtimeScore = (trend, purchase, shop, competition) => {
  if (!trend.hasData) return 0; // 실시간은 YouTube 데이터 필수

  const compScore   = Math.max(0, 100-competition);
  const speedScore  = Math.min(100, safe(()=>trend.velocity/3*100, 0)); // 가속도 0~3 → 0~100
  const engScore    = Math.min(100, trend.avgEngRate*20);               // 참여율 → 0~100
  const freshBonus  = trend.freshCount>=2 ? 15 : trend.freshCount>=1 ? 8 : 0;

  // 실시간: 속도35% + 참여도25% + 구매의도20% + 쇼핑15% + 경쟁역수5%
  let score = speedScore*0.35 + engScore*0.25 + purchase*0.20 + shop.score*0.15 + compScore*0.05;
  score = Math.min(100, score + freshBonus);

  // 상태 배율
  if      (trend.status==="급상승")      score = Math.min(100, score*1.4);
  else if (trend.status==="상승 시작")   score = Math.min(100, score*1.2);
  else if (trend.status==="하락 가능")   score = score*0.6;

  return Math.round(Math.min(100, Math.max(0, score)));
};

// ── 타이밍 ────────────────────────────
const getTiming = (score, status, mode) => {
  if (mode==="realtime") {
    if (status==="급상승"   && score>=50) return { label:"⚡ 지금 당장", color:"#ffd700" };
    if (status==="상승 시작" && score>=30) return { label:"🚀 진입 시작", color:"#ff8800" };
    if (score>=15)                         return { label:"👀 모니터링", color:"#4488ff" };
    return { label:"⏸ 대기", color:"#555" };
  }
  if (status==="급상승"   && score>=50) return { label:"⚡ 지금 당장", color:"#ffd700" };
  if (status==="상승 시작" && score>=35) return { label:"✅ 진입 적기", color:"#03c75a" };
  if (score>=25)                         return { label:"📊 검토 필요", color:"#ff8800" };
  return { label:"⏰ 관망", color:"#888" };
};

// ── 실시간 한줄 설명 ─────────────────
const buildRealtimeReason = (trend, purchase, shop) => {
  if (trend.status==="급상승")
    return `최근 ${trend.freshAvgHours}h 내 영상 ${trend.freshCount}개, 가속도 ${trend.velocity}x 급상승 중`;
  if (trend.status==="상승 시작")
    return `업로드 직후 빠른 반응 감지 — 참여율 ${trend.avgEngRate}%`;
  if (purchase>=50)
    return `구매 의도 ${purchase}% + 쇼핑 리뷰 ${(shop.reviewTotal||0).toLocaleString()}개`;
  return `쇼핑 데이터 기반 안정 상품 (평균가 ${(shop.avgPrice||0).toLocaleString()}원)`;
};

const buildStableReason = (trend, purchase, competition, shop) => {
  const parts = [];
  if (trend.status==="급상승")      parts.push(`급상승 (가속도 ${trend.velocity}x)`);
  else if (trend.status==="상승 시작") parts.push(`상승 시작`);
  else if (!trend.hasData)           parts.push(`쇼핑·검색 데이터 기반`);
  if (purchase>=60)  parts.push(`구매 의도 ${purchase}% — 높음`);
  else if (purchase>=25) parts.push(`구매 의도 ${purchase}%`);
  if (competition<30) parts.push(`블루오션`);
  else if (competition<60) parts.push(`경쟁 보통`);
  if (shop.reviewTotal>50) parts.push(`리뷰 ${shop.reviewTotal.toLocaleString()}개`);
  if (shop.avgPrice>0) parts.push(`평균가 ${shop.avgPrice.toLocaleString()}원`);
  return parts.join(" · ") || "복합 데이터 기반";
};

// ══════════════════════════════════════
// 메인 파이프라인
// ══════════════════════════════════════
export const runAutoRecommend = async (apiKey, onProgress, mode="stable") => {
  if (onProgress) onProgress(3, mode==="realtime" ? "🔥 실시간 데이터 수집 중..." : "💰 안정 추천 분석 중...");

  const seeds = await collectSeeds();
  if (onProgress) onProgress(10, `${seeds.length}개 키워드 분석 시작...`);

  const results = [];

  for (let i=0; i<seeds.length; i++) {
    const kw  = seeds[i];
    const pct = 10 + Math.round((i/seeds.length)*86);
    if (onProgress) onProgress(pct, `"${kw}" 분석 중... (${i+1}/${seeds.length})`);

    try {
      const [videos, blogs, news, cafes, shops] = await Promise.all([
        apiKey ? fetchYT(kw, apiKey, mode, 10) : Promise.resolve([]),
        fetchNaver("blog",        kw, 15),
        fetchNaver("news",        kw, 10),
        fetchNaver("cafearticle", kw, 10),
        fetchShop(kw, 10),
      ]);

      const allDocs     = [...blogs, ...news, ...cafes];
      const trend       = analyzeTrend(videos, mode);
      const purchase    = calcPurchaseIntent(allDocs);
      const shop        = analyzeShop(shops);
      const competition = calcCompetition(allDocs.length, trend.avgViews, shops.length);
      const finalScore  = calcFinalScore(trend, purchase, shop, competition);
      const realtimeScore = calcRealtimeScore(trend, purchase, shop, competition);

      // 쇼핑 데이터 없으면 제외
      if (!shop.exists) continue;

      // 실시간 모드: YouTube 데이터 필수 + 하락 가능 제외
      if (mode==="realtime") {
        if (!trend.hasData) continue;
        if (trend.status==="하락 가능") continue;
        if (realtimeScore < 5) continue;
      }

      const score   = mode==="realtime" ? realtimeScore : finalScore;
      const timing  = getTiming(score, trend.status, mode);
      const reason  = mode==="realtime"
        ? buildRealtimeReason(trend, purchase, shop)
        : buildStableReason(trend, purchase, competition, shop);

      results.push({
        keyword:kw, finalScore, realtimeScore, trend, purchase,
        competition, shop, timing, reason, mode,
      });
    } catch { continue; }
  }

  if (onProgress) onProgress(100, "분석 완료");
  if (!results.length) {
    if (mode==="realtime") throw new Error("현재 급상승 중인 항목이 없습니다. 안정 추천을 이용해주세요.");
    throw new Error("분석 결과가 없습니다. 잠시 후 다시 시도해주세요.");
  }

  const sortKey = mode==="realtime" ? "realtimeScore" : "finalScore";
  return results.sort((a,b)=>b[sortKey]-a[sortKey]).slice(0, mode==="realtime" ? 5 : 10);
};
