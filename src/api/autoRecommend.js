// v3.0 - 고정 시드 키워드 + 안정화
const safe    = (fn, fb=0) => { try { const v=fn(); return (v===null||v===undefined||isNaN(v)||!isFinite(v))?fb:v; } catch { return fb; } };
const safeDiv = (a, b, fb=0) => (!b||isNaN(b)||!isFinite(b)) ? fb : safe(()=>a/b, fb);
const stripHtml = s => (s||"").replace(/<[^>]*>/g,"").replace(/&[^;]+;/g," ").trim();

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

const fetchYT = async (query, apiKey, maxResults=10) => {
  try {
    const published = new Date(Date.now()-48*60*60*1000).toISOString();
    const sr = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=id&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&order=viewCount&regionCode=KR&relevanceLanguage=ko&publishedAfter=${published}&key=${apiKey}`
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

// ══════════════════════════════════════
// 고정 시드 키워드 (카테고리별 검증된 상품명)
// ══════════════════════════════════════
const FIXED_SEEDS = [
  // 가전/IT
  "무선이어폰", "공기청정기", "로봇청소기", "노트북", "태블릿",
  // 뷰티/건강
  "선크림", "세럼", "비타민", "단백질보충제", "마스크팩",
  // 생활/주방
  "에어프라이어", "전기포트", "텀블러", "수납박스", "가습기",
  // 패션
  "운동화", "크로스백", "레깅스", "썬글라스",
  // 식품
  "닭가슴살", "견과류", "프로틴바", "커피원두",
  // 반려동물
  "강아지사료", "고양이간식",
];

// ══════════════════════════════════════
// 트렌드 시드: 네이버 쇼핑에서 인기 상품명 추출
// ══════════════════════════════════════
const fetchTrendingFromShop = async () => {
  const queries = ["인기 가전", "인기 뷰티", "인기 생활용품", "인기 식품"];
  const results = await Promise.all(queries.map(q => fetchShop(q, 5)));
  const titles = results.flat().map(i => stripHtml(i.title||""));

  // 상품 타이틀에서 2~6자 한글 명사 추출 (불용어 제외)
  const STOP = new Set(["최고","인기","추천","할인","특가","무료","배송","신상","정품","공식","한국"]);
  const freq = {};
  for (const t of titles) {
    const tokens = (t.match(/[가-힣]{2,6}/g)||[]).filter(w=>!STOP.has(w));
    for (const tk of tokens) freq[tk] = (freq[tk]||0)+1;
  }
  return Object.entries(freq)
    .filter(([,c])=>c>=2)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,10)
    .map(([kw])=>kw);
};

// ══════════════════════════════════════
// Step 1. 시드 수집 (고정 + 트렌드 혼합)
// ══════════════════════════════════════
const collectSeeds = async (apiKey) => {
  // 트렌드 시드 추가 수집 (실패해도 고정 시드로 진행)
  let trendSeeds = [];
  try { trendSeeds = await fetchTrendingFromShop(); } catch {}

  // YouTube 트렌드에서도 추가
  let ytSeeds = [];
  if (apiKey) {
    try {
      const videos = await fetchYT("요즘 핫한 생활용품 가전 뷰티", apiKey, 15);
      const ytTitles = videos.map(v=>v.snippet?.title||"");
      const STOP = new Set(["추천","리뷰","후기","언박싱","구매","할인","최고","베스트"]);
      const freq = {};
      for (const t of ytTitles) {
        const tokens = (t.match(/[가-힣]{2,6}/g)||[]).filter(w=>!STOP.has(w));
        for (const tk of tokens) freq[tk]=(freq[tk]||0)+1;
      }
      ytSeeds = Object.entries(freq)
        .filter(([,c])=>c>=2)
        .sort((a,b)=>b[1]-a[1])
        .slice(0,8)
        .map(([kw])=>kw);
    } catch {}
  }

  // 고정 시드 + 트렌드 시드 + YouTube 시드 합치기 (중복 제거)
  const merged = [...new Set([...FIXED_SEEDS, ...trendSeeds, ...ytSeeds])];
  return merged.slice(0, 25);
};

// ══════════════════════════════════════
// Step 2. 트렌드 점수
// ══════════════════════════════════════
const calcTrend = (videos) => {
  if (!videos.length) return { score:0, velocity:1, status:"유지", avgViews:0 };
  const now = Date.now();
  const enriched = videos.map(v => {
    const views    = safe(()=>parseInt(v.statistics?.viewCount)||0);
    const likes    = safe(()=>parseInt(v.statistics?.likeCount)||0);
    const comments = safe(()=>parseInt(v.statistics?.commentCount)||0);
    const pub      = v.snippet?.publishedAt;
    const hoursAgo = pub ? Math.max(0.5, safe(()=>(now-new Date(pub))/3600000,1)) : 24;
    const engagement = views + likes*3 + comments*5;
    const velocity   = safeDiv(engagement, hoursAgo, 0);
    return { views, engagement, velocity, hoursAgo };
  });
  const avgViews    = safe(()=>enriched.reduce((s,v)=>s+v.views,0)/enriched.length, 0);
  const avgVelocity = safe(()=>enriched.reduce((s,v)=>s+v.velocity,0)/enriched.length, 0);
  const trendScore  = Math.min(100, safe(()=>Math.log10(avgVelocity+1)/Math.log10(10000)*100, 0));
  const fresh   = enriched.filter(v=>v.hoursAgo<=24);
  const mature  = enriched.filter(v=>v.hoursAgo>24);
  const freshVel  = fresh.length  ? safe(()=>fresh.reduce((s,v)=>s+v.velocity,0)/fresh.length,  0) : 0;
  const matureVel = mature.length ? safe(()=>mature.reduce((s,v)=>s+v.velocity,0)/mature.length, 1) : 1;
  const accel  = Math.min(3, safeDiv(freshVel, Math.max(1,matureVel), 1));
  const status = accel>=1.8?"급상승":accel>=1.2?"상승":"유지";
  return { score:Math.round(trendScore), velocity:safe(()=>Math.round(accel*10)/10,1), status, avgViews:Math.round(avgViews) };
};

// ══════════════════════════════════════
// Step 3. 구매 의도
// ══════════════════════════════════════
const INTENT = {
  purchase: ["구매","사다","샀","구입","주문","결제","살까","사야","구매후기","구입했","장바구니"],
  compare:  ["비교","vs","어떤게","뭐가","차이","고민","선택","골라","추천"],
  price:    ["최저가","할인","쿠폰","세일","가격","얼마","저렴","가성비","특가","무료배송"],
  review:   ["후기","리뷰","사용기","써봤","써본","솔직","진짜","실제"],
};
const calcPurchaseIntent = (items) => {
  const text  = items.map(i=>stripHtml(i.title+" "+(i.description||""))).join(" ");
  const total = Math.max(1, (text.match(/[가-힣]+/g)||[]).length);
  const scores = {
    purchase: INTENT.purchase.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*3,
    compare:  INTENT.compare.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*2,
    price:    INTENT.price.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*2,
    review:   INTENT.review.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*1,
  };
  const totalHits = Object.values(scores).reduce((a,b)=>a+b,0);
  return Math.min(100, Math.round(safeDiv(totalHits, total, 0)*80));
};

// ══════════════════════════════════════
// Step 4. 쇼핑 분석
// ══════════════════════════════════════
const analyzeShop = (items) => {
  if (!items.length) return { exists:false, score:0, avgPrice:0, minPrice:0, reviewTotal:0, top:null };
  const prices  = items.map(s=>parseInt(s.lprice)||0).filter(p=>p>0);
  const reviews = items.map(s=>parseInt(s.reviewCount)||0);
  const avgPrice    = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
  const minPrice    = prices.length ? Math.min(...prices) : 0;
  const reviewTotal = reviews.reduce((a,b)=>a+b,0);
  const priceScore  = avgPrice>=3000 && avgPrice<=1000000
    ? 100 - safe(()=>Math.abs(Math.log10(avgPrice)-Math.log10(50000))/Math.log10(100)*50, 50)
    : 20;
  const reviewScore = Math.min(100, safe(()=>Math.log10(reviewTotal+1)/Math.log10(10000)*100, 0));
  const score = Math.round(priceScore*0.5 + reviewScore*0.5);
  const topItem = [...items].sort((a,b)=>(parseInt(b.reviewCount)||0)-(parseInt(a.reviewCount)||0))[0];
  return {
    exists:true, score, avgPrice, minPrice, reviewTotal, count:items.length,
    top: topItem ? { name:stripHtml(topItem.title), price:parseInt(topItem.lprice)||0, mall:topItem.mallName, url:topItem.link } : null
  };
};

// ══════════════════════════════════════
// Step 5. 경쟁도
// ══════════════════════════════════════
const calcCompetition = (docCount, avgViews, shopCount) => {
  const docScore  = Math.min(100, safe(()=>Math.log10(safeDiv(docCount,Math.max(1,avgViews),0)+1)/Math.log10(10)*100, 50));
  const shopScore = Math.min(100, safe(()=>shopCount/20*100, 50));
  return Math.round(docScore*0.6 + shopScore*0.4);
};

// ══════════════════════════════════════
// Step 6. 최종 점수
// ══════════════════════════════════════
const calcFinalScore = (trend, purchase, shopScore, competition) => {
  const t   = safe(()=>trend.score/100, 0);
  const v   = Math.min(2, safe(()=>trend.velocity, 1));
  const p   = safe(()=>purchase/100, 0);
  const s   = safe(()=>shopScore/100, 0.5);
  const c   = Math.max(0.01, safe(()=>competition/100, 0.5));
  const raw = safe(()=>t * v * p * s * (1/c) * 150, 0);
  return Math.round(Math.min(100, raw));
};

const getTiming = (score, status, comp) => {
  if (status==="급상승" && score>=50) return { label:"⚡ 지금 당장", color:"#ffd700" };
  if (status==="상승"   && score>=30) return { label:"✅ 진입 적기", color:"#03c75a" };
  if (score>=10 && comp<70)           return { label:"📊 검토 필요", color:"#ff8800" };
  return { label:"⏰ 시기 늦음", color:"#888" };
};

const buildReason = (trend, purchase, competition, shop) => {
  const parts = [];
  if (trend.status==="급상승")    parts.push(`48h 내 급상승 (가속도 ${trend.velocity}x)`);
  else if (trend.status==="상승") parts.push(`상승 흐름 감지`);
  if (purchase>=60)               parts.push(`구매 의도 ${purchase}% — 매우 높음`);
  else if (purchase>=20)          parts.push(`구매 의도 ${purchase}%`);
  if (competition<30)             parts.push(`경쟁 낮음 — 블루오션`);
  else if (competition<60)        parts.push(`경쟁 보통`);
  if (shop.reviewTotal>50)        parts.push(`누적 리뷰 ${shop.reviewTotal.toLocaleString()}개`);
  if (shop.avgPrice>0)            parts.push(`평균가 ${shop.avgPrice.toLocaleString()}원`);
  return parts.join(" · ") || "복합 데이터 분석 기반";
};

// ══════════════════════════════════════
// 메인 파이프라인
// ══════════════════════════════════════
export const runAutoRecommend = async (apiKey, onProgress) => {
  if (onProgress) onProgress(3, "시드 키워드 준비 중...");

  const seeds = await collectSeeds(apiKey);
  if (!seeds.length) throw new Error("키워드 수집 실패");

  if (onProgress) onProgress(12, `${seeds.length}개 키워드 분석 시작...`);

  const results = [];

  for (let i=0; i<seeds.length; i++) {
    const kw  = seeds[i];
    const pct = 12 + Math.round((i/seeds.length)*83);
    if (onProgress) onProgress(pct, `"${kw}" 분석 중... (${i+1}/${seeds.length})`);

    try {
      const [videos, blogs, news, cafes, shops] = await Promise.all([
        apiKey ? fetchYT(kw, apiKey, 8) : Promise.resolve([]),
        fetchNaver("blog",        kw, 15),
        fetchNaver("news",        kw, 10),
        fetchNaver("cafearticle", kw, 10),
        fetchShop(kw, 10),
      ]);

      const allDocs     = [...blogs, ...news, ...cafes];
      const trend       = calcTrend(videos);
      const purchase    = calcPurchaseIntent(allDocs);
      const shop        = analyzeShop(shops);
      const competition = calcCompetition(allDocs.length, trend.avgViews, shops.length);
      const finalScore  = calcFinalScore(trend, purchase, shop.score, competition);

      // 쇼핑 데이터 없으면 제외 (상품이 아닌 키워드)
      if (!shop.exists) continue;
      // 나머지는 최대한 통과
      if (finalScore < 1) continue;

      const timing = getTiming(finalScore, trend.status, competition);
      const reason  = buildReason(trend, purchase, competition, shop);

      results.push({ keyword:kw, finalScore, trend, purchase, competition, shop, timing, reason });
    } catch { continue; }
  }

  if (onProgress) onProgress(100, "분석 완료");

  if (!results.length) throw new Error("분석 결과가 없습니다. 잠시 후 다시 시도해주세요.");

  return results.sort((a,b)=>b.finalScore-a.finalScore).slice(0,10);
};
