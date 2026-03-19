// ══════════════════════════════════════════════
// 돈 될 키워드 검색 엔진 v1.0
// ══════════════════════════════════════════════

const CACHE_TTL = 5 * 60 * 1000;
const cache     = new Map();
const getCache  = k => { const h=cache.get(k); if(!h) return null; if(Date.now()-h.ts>CACHE_TTL){cache.delete(k);return null;} return h.data; };
const setCache  = (k, d) => cache.set(k, { ts: Date.now(), data: d });

const safe = (fn, fallback) => { try { const v = fn(); return (v===null||v===undefined||isNaN(v)||!isFinite(v)) ? fallback : v; } catch { return fallback; } };
const safeDiv = (a, b, fallback=0) => (!b || isNaN(b) || !isFinite(b)) ? fallback : safe(()=>a/b, fallback);
const stripHtml = s => (s||"").replace(/<[^>]*>/g,"").replace(/&[a-z]+;/g," ").trim();

// ──────────────────────────────────────────────
// [2] 데이터 수집
// ──────────────────────────────────────────────
const fetchNaver = async (type, query, display=20) => {
  try {
    const res = await fetch(`/api/naver-search?query=${encodeURIComponent(query)}&type=${type}&display=${display}`);
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch { return []; }
};

const fetchShop = async (query) => {
  try {
    const res = await fetch(`/api/naver-shop?query=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch { return []; }
};

const fetchYouTube = async (query, apiKey) => {
  try {
    const sr = await fetch(`https://www.googleapis.com/youtube/v3/search?part=id&q=${encodeURIComponent(query)}&type=video&maxResults=20&order=relevance&regionCode=KR&relevanceLanguage=ko&key=${apiKey}`);
    if (!sr.ok) return [];
    const sd = await sr.json();
    if (sd.error || !sd.items?.length) return [];
    const ids = sd.items.map(i=>i.id.videoId).join(",");
    const vr = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&fields=items(id,snippet(title,publishedAt),statistics)&id=${ids}&key=${apiKey}`);
    if (!vr.ok) return [];
    const vd = await vr.json();
    return (vd.items||[]);
  } catch { return [] ; }
};

// ──────────────────────────────────────────────
// [3] 키워드 확장
// ──────────────────────────────────────────────
const expandKeywords = (base) => {
  const suffixes = ["추천","후기","가격","비교","구매","최저가","할인","리뷰","사용법","효과"];
  const prefixes = ["저렴한","인기","최고","좋은","싼"];
  const questions = [`${base} 어디서 사나요`, `${base} 가격이 얼마`, `${base} 추천해줘`];
  const longtail  = [`${base} 구매 방법`, `${base} 싸게 사는 법`, `${base} 후기 모음`];
  const related   = [...suffixes.map(s=>`${base} ${s}`), ...prefixes.map(p=>`${p} ${base}`)];
  return [...new Set([base, ...related.slice(0,10), ...longtail, ...questions])].slice(0,20);
};

// ──────────────────────────────────────────────
// [4] 데이터 전처리
// ──────────────────────────────────────────────
const filterVideos = (videos) => {
  const now = Date.now();
  const seenIds = new Set(), seenTitles = new Set();
  return videos.filter(v => {
    const views = parseInt(v.statistics?.viewCount)||0;
    const pub   = v.snippet?.publishedAt;
    if (!views || !pub) return false;
    if (now - new Date(pub) > 48*60*60*1000) return false;
    if (seenIds.has(v.id)) return false;
    const t = (v.snippet?.title||"").trim().toLowerCase();
    if (seenTitles.has(t)) return false;
    seenIds.add(v.id); seenTitles.add(t);
    return true;
  });
};

// ──────────────────────────────────────────────
// [5] 키워드 의도 분류
// ──────────────────────────────────────────────
const INTENT_MAP = {
  purchase: ["구매","사다","사는","구입","주문","구매","파는","팔","최저가","가격","할인","쿠폰","배송","사야","살까"],
  info:     ["방법","하는법","알아보기","설명","뜻","의미","이란","이유","원인","효과","성분","종류"],
  problem:  ["해결","안되","오류","문제","고장","수리","방법","도움","도와","해결책","안되는"],
  compare:  ["비교","차이","vs","versus","어떤게","뭐가","추천","순위","랭킹","베스트","TOP"]
};

const classifyIntent = (texts) => {
  const counts = { purchase:0, info:0, problem:0, compare:0, other:0 };
  const combined = texts.join(" ");
  for (const [intent, words] of Object.entries(INTENT_MAP)) {
    for (const w of words) {
      const matches = (combined.match(new RegExp(w, "gi"))||[]).length;
      counts[intent] += matches;
    }
  }
  const total = Object.values(counts).reduce((a,b)=>a+b,0) || 1;
  return {
    purchase: safe(()=>Math.round((counts.purchase/total)*100), 0),
    info:     safe(()=>Math.round((counts.info/total)*100), 0),
    problem:  safe(()=>Math.round((counts.problem/total)*100), 0),
    compare:  safe(()=>Math.round((counts.compare/total)*100), 0),
  };
};

// ──────────────────────────────────────────────
// [6] 핵심 키워드 추출
// ──────────────────────────────────────────────
const STOP = new Set([
  "것","수","등","및","이","그","저","를","이다","있다","하다","되다","않다","없다","같다","많다",
  "보다","위해","통해","대한","관련","가장","지난","올해","지금","오늘","정말","너무","아주","매우",
  "모든","어떤","이번","다음","현재","최근","직접","바로","다시","함께","따라","위한","대해","진짜",
  "완전","우리","합니다","있습니다","하는","하고","하면","해서","해야","하여","하지","했다","입니다",
  "됩니다","위한","이런","저런","그런","같은","없는","있는","할수","해줘","어떤","어느","얼마"
]);

const extractTopKeywords = (items, original, n=10) => {
  const text = items.map(i => stripHtml(i.title+" "+(i.description||""))
    .replace(/[^\uAC00-\uD7A3\s]/g," ").replace(/\s+/g," ")
  ).join(" ");
  const tokens = (text.match(/[가-힣]{2,8}/g)||[]).filter(w=>!STOP.has(w)&&w!==original&&!original.includes(w));
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t]||0)+1;
  return Object.entries(freq).filter(([,c])=>c>=2).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([kw,cnt])=>({kw,cnt}));
};

// ──────────────────────────────────────────────
// [7] 트렌드 점수
// ──────────────────────────────────────────────
const calcTrendScore = (videos) => {
  if (!videos.length) return 0;
  const scores = videos.map(v => {
    const views    = safe(()=>parseInt(v.statistics?.viewCount)||0, 0);
    const likes    = safe(()=>parseInt(v.statistics?.likeCount)||0, 0);
    const comments = safe(()=>parseInt(v.statistics?.commentCount)||0, 0);
    const pub      = v.snippet?.publishedAt;
    const hoursAgo = pub ? Math.max(1, safe(()=>(Date.now()-new Date(pub))/3600000, 1)) : 1;
    const raw = safeDiv(views + likes*2 + comments*3, hoursAgo, 0);
    return Math.min(100, safe(()=>Math.log10(raw+1)/Math.log10(10000)*100, 0));
  });
  return Math.round(safe(()=>scores.reduce((a,b)=>a+b,0)/scores.length, 0));
};

// ──────────────────────────────────────────────
// [8] 경쟁도
// ──────────────────────────────────────────────
const calcCompetition = (resultCount, avgViews) => {
  const safeAvg = Math.max(1, avgViews||1);
  const raw     = safeDiv(resultCount, safeAvg, 0);
  const norm    = Math.min(100, safe(()=>Math.log10(raw+1)/Math.log10(1000)*100, 50));
  const label   = norm < 33 ? "낮음" : norm < 66 ? "보통" : "높음";
  return { score: Math.round(norm), label };
};

// ──────────────────────────────────────────────
// [9] 쇼핑 분석
// ──────────────────────────────────────────────
const analyzeShop = (items) => {
  if (!items.length) return { exists: false, avgPrice:0, minPrice:0, maxPrice:0, top5:[], priceRange:"없음" };
  const prices = items.map(i=>parseInt(i.lprice)||0).filter(p=>p>0);
  const avg    = prices.length ? Math.round(safe(()=>prices.reduce((a,b)=>a+b,0)/prices.length, 0)) : 0;
  const min    = prices.length ? Math.min(...prices) : 0;
  const max    = prices.length ? Math.max(...prices) : 0;
  const top5   = [...items].sort((a,b)=>(parseInt(b.reviewCount)||0)-(parseInt(a.reviewCount)||0)).slice(0,5).map(i=>({
    name:  stripHtml(i.title),
    price: parseInt(i.lprice)||0,
    mall:  i.mallName,
    url:   i.link,
    review:parseInt(i.reviewCount)||0
  }));
  const priceRange = avg===0?"없음":avg<10000?"1만원 미만":avg<50000?"1~5만원":avg<100000?"5~10만원":avg<300000?"10~30만원":"30만원 이상";
  return { exists:true, avgPrice:avg, minPrice:min, maxPrice:max, top5, priceRange, count:items.length };
};

// ──────────────────────────────────────────────
// [10] 최종 점수
// ──────────────────────────────────────────────
const calcFinalScore = (trend, purchaseRatio, competition) => {
  const t = safe(()=>trend/100, 0);
  const p = safe(()=>purchaseRatio/100, 0);
  const c = Math.max(0.01, safe(()=>competition.score/100, 0.5));
  const raw = safe(()=>t * p * (1/c) * 100, 0);
  return Math.round(Math.min(100, Math.max(0, raw)));
};

// ──────────────────────────────────────────────
// [11] 추천 필터 + 이유 생성
// ──────────────────────────────────────────────
const buildRecommendation = (item) => {
  const reasons = [];
  let recommend = true;

  if (item.intent.purchase >= 30) reasons.push(`구매 의도 ${item.intent.purchase}% — 높은 구매 전환 기대`);
  else { reasons.push(`구매 의도 ${item.intent.purchase}% — 낮음`); recommend = false; }

  if (item.shopping.exists) reasons.push(`쇼핑 상품 ${item.shopping.count}개, 평균가 ${(item.shopping.avgPrice||0).toLocaleString()}원`);
  else { reasons.push("쇼핑 상품 없음 — 시장 미개척"); recommend = false; }

  if (item.competition.label === "낮음") reasons.push("경쟁도 낮음 — 진입 유리");
  else if (item.competition.label === "보통") reasons.push("경쟁도 보통 — 차별화 필요");
  else { reasons.push("경쟁도 높음 — 진입 어려움"); recommend = recommend && false; }

  if (item.trendScore >= 60) reasons.push(`트렌드 점수 ${item.trendScore}점 — 인기 상승 중`);
  else reasons.push(`트렌드 점수 ${item.trendScore}점`);

  return { recommend, reasons };
};

// ──────────────────────────────────────────────
// 메인 파이프라인
// ──────────────────────────────────────────────
export const runMoneyEngine = async (keyword, apiKey) => {
  const ck = `engine:${keyword.trim().toLowerCase()}`;
  const cached = getCache(ck);
  if (cached) return { result: cached, fromCache: true };

  // [3] 키워드 확장
  const expanded = expandKeywords(keyword);

  // [2] 데이터 수집 — 입력 키워드 기준 병렬
  const [blogs, news, cafes, shops, ytRaw] = await Promise.all([
    fetchNaver("blog",        keyword, 20),
    fetchNaver("news",        keyword, 20),
    fetchNaver("cafearticle", keyword, 20),
    fetchShop(keyword),
    apiKey ? fetchYouTube(keyword, apiKey) : Promise.resolve([])
  ]);

  // [4] 전처리
  const videos   = filterVideos(ytRaw);
  const allItems = [...blogs, ...news, ...cafes];

  // [6] 핵심 키워드 추출
  const topKws = extractTopKeywords(allItems, keyword, 10);
  if (!topKws.length) throw new Error("키워드 추출 실패 — 검색 결과 부족");

  // 각 키워드 분석
  const avgViews = videos.length
    ? safe(()=>videos.reduce((s,v)=>s+(parseInt(v.statistics?.viewCount)||0),0)/videos.length, 1)
    : 1;

  const results = await Promise.all(topKws.map(async ({ kw, cnt }) => {
    // 키워드별 쇼핑 (상위 5개만)
    const kwShops = kw === keyword ? shops : await fetchShop(kw);

    // [5] 의도 분류
    const kwItems = [...blogs, ...news, ...cafes].filter(i =>
      (i.title+" "+(i.description||"")).includes(kw)
    );
    const texts  = kwItems.map(i => stripHtml(i.title+" "+(i.description||"")));
    const intent = classifyIntent(texts.length ? texts : [kw]);

    // [7] 트렌드
    const kwVideos   = videos.filter(v => (v.snippet?.title||"").includes(kw));
    const trendScore = kwVideos.length ? calcTrendScore(kwVideos) : calcTrendScore(videos);

    // [8] 경쟁도
    const competition = calcCompetition(allItems.length + kwItems.length, avgViews);

    // [9] 쇼핑
    const shopping = analyzeShop(kwShops);

    // [10] 최종 점수
    const finalScore = calcFinalScore(trendScore, intent.purchase, competition);

    // [11] 추천 + 이유
    const item = { keyword: kw, count: cnt, trendScore, intent, competition, shopping, finalScore };
    const { recommend, reasons } = buildRecommendation(item);

    return { ...item, recommend, reasons };
  }));

  // [14] 정렬 + 상위 10개
  const sorted = results.sort((a,b)=>b.finalScore-a.finalScore).slice(0,10);

  const result = {
    keyword,
    expandedCount: expanded.length,
    totalDocs: allItems.length,
    videoCount: videos.length,
    items: sorted,
    extractedAt: Date.now()
  };

  setCache(ck, result);
  return { result, fromCache: false };
};
