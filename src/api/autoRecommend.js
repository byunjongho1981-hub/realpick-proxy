// v1.2
const safe    = (fn, fb=0) => { try { const v=fn(); return (v===null||v===undefined||isNaN(v)||!isFinite(v))?fb:v; } catch { return fb; } };
const safeDiv = (a, b, fb=0) => (!b||isNaN(b)||!isFinite(b)) ? fb : safe(()=>a/b, fb);
const stripHtml = s => (s||"").replace(/<[^>]*>/g,"").replace(/&[^;]+;/g," ").trim();

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

const fetchYT = async (query, apiKey, maxResults=15) => {
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

const STOP = new Set([
  "것","수","등","및","이","그","저","를","이다","있다","하다","되다","않다","없다","같다",
  "많다","보다","위해","통해","대한","관련","가장","지난","올해","지금","오늘","정말","너무",
  "아주","매우","모든","어떤","이번","다음","현재","최근","직접","바로","다시","함께","위한",
  "대해","진짜","완전","우리","합니다","있습니다","하는","하고","하면","해서","해야","하지",
  "추천","리뷰","후기","언박싱","비교","최고","베스트","꿀팁","영상","채널","구독","유튜브",
  "클릭","좋아요","댓글","공유","구경","소개","먹방","브이로그","일상","정보"
]);

const extractKeywordsFromText = (texts, minCount=1, maxWords=20) => {
  const text = texts.join(" ").replace(/[^\uAC00-\uD7A3\s]/g," ").replace(/\s+/g," ");
  const tokens = (text.match(/[가-힣]{2,8}/g)||[]).filter(w=>!STOP.has(w));
  const freq = {};
  for (const t of tokens) freq[t]=(freq[t]||0)+1;
  return Object.entries(freq)
    .filter(([,c])=>c>=minCount)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,maxWords)
    .map(([kw])=>kw);
};

const collectSeeds = async (apiKey) => {
  const queries = [
    { type:"news",        q:"신제품 출시" },
    { type:"news",        q:"인기 상품 품절" },
    { type:"blog",        q:"요즘 핫한 제품" },
    { type:"blog",        q:"구매 후기 강추" },
    { type:"cafearticle", q:"공동구매 추천" },
    { type:"cafearticle", q:"살까말까 고민" },
  ];

  const [naverResults, ytVideos] = await Promise.all([
    Promise.all(queries.map(({type,q})=>fetchNaver(type,q,20))),
    apiKey ? fetchYT("요즘 뜨는 제품 추천", apiKey, 20) : Promise.resolve([])
  ]);

  const naverTexts = naverResults.flat().map(i=>stripHtml(i.title+" "+(i.description||"")));
  const ytTitles   = ytVideos.map(v=>v.snippet?.title||"");

  const naverKws = extractKeywordsFromText(naverTexts, 1, 25);
  const ytKws    = extractKeywordsFromText(ytTitles,   1, 15);

  const weightedMap = {};
  for (const kw of naverKws) weightedMap[kw] = (weightedMap[kw]||0) + 1;
  for (const kw of ytKws)    weightedMap[kw] = (weightedMap[kw]||0) + 2;

  return Object.entries(weightedMap)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,20)
    .map(([kw])=>kw);
};

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
  const fresh  = enriched.filter(v=>v.hoursAgo<=24);
  const mature = enriched.filter(v=>v.hoursAgo>24);
  const freshVel  = fresh.length  ? safe(()=>fresh.reduce((s,v)=>s+v.velocity,0)/fresh.length,  0) : 0;
  const matureVel = mature.length ? safe(()=>mature.reduce((s,v)=>s+v.velocity,0)/mature.length, 1) : 1;
  const accel     = Math.min(3, safeDiv(freshVel, Math.max(1,matureVel), 1));
  const status    = accel>=1.8?"급상승":accel>=1.2?"상승":"유지";
  return { score:Math.round(trendScore), velocity:safe(()=>Math.round(accel*10)/10,1), status, avgViews:Math.round(avgViews) };
};

const INTENT = {
  purchase: ["구매","사다","샀","구입","주문","결제","살까","사야","구매완료","구매후기","추천구매","구입했"],
  compare:  ["비교","vs","어떤게","뭐가","차이","고민","선택","골라","추천"],
  price:    ["최저가","할인","쿠폰","세일","가격","얼마","저렴","가성비","특가"],
  review:   ["후기","리뷰","사용기","써봤","써본","솔직","진짜","실제"]
};

const calcPurchaseIntent = (items) => {
  const text  = items.map(i=>stripHtml(i.title+" "+(i.description||""))).join(" ");
  const total = Math.max(1, (text.match(/[가-힣]+/g)||[]).length);
  const scores = {
    purchase: INTENT.purchase.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0) * 3,
    compare:  INTENT.compare.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0) * 2,
    price:    INTENT.price.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0) * 2,
    review:   INTENT.review.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0) * 1,
  };
  const totalHits = Object.values(scores).reduce((a,b)=>a+b,0);
  return Math.min(100, Math.round(safeDiv(totalHits, total, 0) * 80));
};

const analyzeShop = (items) => {
  if (!items.length) return { exists:false, score:0, avgPrice:0, minPrice:0, reviewTotal:0, top:null };
  const prices  = items.map(s=>parseInt(s.lprice)||0).filter(p=>p>0);
  const reviews = items.map(s=>parseInt(s.reviewCount)||0);
  const avgPrice    = prices.length  ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
  const minPrice    = prices.length  ? Math.min(...prices) : 0;
  const reviewTotal = reviews.reduce((a,b)=>a+b,0);
  const priceScore  = avgPrice>=5000 && avgPrice<=500000
    ? 100 - safe(()=>Math.abs(Math.log10(avgPrice)-Math.log10(50000))/Math.log10(100)*50, 50)
    : 30;
  const reviewScore = Math.min(100, safe(()=>Math.log10(reviewTotal+1)/Math.log10(10000)*100, 0));
  const score = Math.round(priceScore*0.5 + reviewScore*0.5);
  const topItem = [...items].sort((a,b)=>(parseInt(b.reviewCount)||0)-(parseInt(a.reviewCount)||0))[0];
  return {
    exists:true, score, avgPrice, minPrice, reviewTotal, count:items.length,
    top: topItem ? { name:stripHtml(topItem.title), price:parseInt(topItem.lprice)||0, mall:topItem.mallName, url:topItem.link } : null
  };
};

const calcCompetition = (docCount, avgViews, shopCount) => {
  const docScore  = Math.min(100, safe(()=>Math.log10(safeDiv(docCount,Math.max(1,avgViews),0)+1)/Math.log10(10)*100, 50));
  const shopScore = Math.min(100, safe(()=>shopCount/20*100, 50));
  return Math.round(docScore*0.6 + shopScore*0.4);
};

const calcFinalScore = (trend, purchase, shopScore, competition) => {
  const t  = safe(()=>trend.score/100, 0);
  const v  = Math.min(2, safe(()=>trend.velocity, 1));
  const p  = safe(()=>purchase/100, 0);
  const s  = safe(()=>shopScore/100, 0.5);
  const c  = Math.max(0.01, safe(()=>competition/100, 0.5));
  const raw = safe(()=>t * v * p * s * (1/c) * 150, 0);
  return Math.round(Math.min(100, raw));
};

const getTiming = (score, status, comp) => {
  if (status==="급상승" && score>=50) return { label:"⚡ 지금 당장", color:"#ffd700" };
  if (status==="상승"   && score>=30) return { label:"✅ 진입 적기", color:"#03c75a" };
  if (score>=15 && comp<60)           return { label:"📊 검토 필요", color:"#ff8800" };
  return { label:"⏰ 시기 늦음", color:"#888" };
};

const buildReason = (trend, purchase, competition, shop) => {
  const parts = [];
  if (trend.status==="급상승")        parts.push(`48h 내 급상승 (가속도 ${trend.velocity}x)`);
  else if (trend.status==="상승")     parts.push(`상승 흐름 감지`);
  if (purchase>=60)                   parts.push(`구매 의도 ${purchase}% — 매우 높음`);
  else if (purchase>=30)              parts.push(`구매 의도 ${purchase}%`);
  if (competition<30)                 parts.push(`경쟁 낮음 — 블루오션`);
  else if (competition<60)            parts.push(`경쟁 보통`);
  if (shop.reviewTotal>100)           parts.push(`누적 리뷰 ${shop.reviewTotal.toLocaleString()}개`);
  if (shop.avgPrice>0)                parts.push(`평균가 ${shop.avgPrice.toLocaleString()}원`);
  return parts.join(" · ") || "복합 데이터 분석 기반";
};

export const runAutoRecommend = async (apiKey, onProgress) => {
  if (onProgress) onProgress(3, "다채널 트렌드 키워드 수집 중...");

  const seeds = await collectSeeds(apiKey);
  if (!seeds.length) throw new Error("트렌드 키워드 수집 실패");

  if (onProgress) onProgress(15, `${seeds.length}개 후보 키워드 심층 분석 시작...`);

  const results = [];

  for (let i=0; i<seeds.length; i++) {
    const kw  = seeds[i];
    const pct = 15 + Math.round((i/seeds.length)*78);
    if (onProgress) onProgress(pct, `"${kw}" 분석 중... (${i+1}/${seeds.length})`);

    try {
      const [videos, blogs, news, cafes, shops] = await Promise.all([
        apiKey ? fetchYT(kw, apiKey, 10) : Promise.resolve([]),
        fetchNaver("blog",        kw, 20),
        fetchNaver("news",        kw, 10),
        fetchNaver("cafearticle", kw, 10),
        fetchShop(kw, 10)
      ]);

      const allDocs     = [...blogs, ...news, ...cafes];
      const trend       = calcTrend(videos);
      const purchase    = calcPurchaseIntent(allDocs);
      const shop        = analyzeShop(shops);
      const competition = calcCompetition(allDocs.length, trend.avgViews, shops.length);
      const finalScore  = calcFinalScore(trend, purchase, shop.score, competition);

      // ── 완화된 필터 ──
      if (purchase < 15)    continue; // 구매 의도 최소
      if (!shop.exists)     continue; // 쇼핑 데이터 없음
      if (finalScore < 5)   continue; // 점수 최소
      if (competition > 95) continue; // 극심한 레드오션만 제외
      if (!allDocs.length)  continue; // 검색 결과 없음

      const timing = getTiming(finalScore, trend.status, competition);
      const reason  = buildReason(trend, purchase, competition, shop);

      results.push({ keyword:kw, finalScore, trend, purchase, competition, shop, timing, reason });
    } catch { continue; }
  }

  if (onProgress) onProgress(100, "분석 완료");

  if (!results.length) throw new Error("추천 상품을 찾지 못했습니다. 잠시 후 다시 시도해주세요.");

  return results.sort((a,b)=>b.finalScore-a.finalScore).slice(0,5);
};
