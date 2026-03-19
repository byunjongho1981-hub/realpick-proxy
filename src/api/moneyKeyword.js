const CACHE_TTL = 5 * 60 * 1000;
const cache     = new Map();
const getCache  = k => { const h=cache.get(k); if(!h) return null; if(Date.now()-h.ts>CACHE_TTL){cache.delete(k);return null;} return h.data; };
const setCache  = (k, d) => cache.set(k, { ts: Date.now(), data: d });

// ── 네이버 콘텐츠 수집 ──
const fetchContent = async (type, keyword) => {
  try {
    const res = await fetch(`/api/naver-search?query=${encodeURIComponent(keyword)}&type=${type}`);
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch { return []; }
};

// ── 네이버 쇼핑 수집 ──
const fetchShop = async (keyword) => {
  try {
    const res = await fetch(`/api/naver-shop?query=${encodeURIComponent(keyword)}`);
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch { return []; }
};

// ── 텍스트 정제 ──
const STOP = new Set([
  "것","수","등","및","이","그","저","를","이다","있다","하다","되다","않다",
  "없다","같다","많다","보다","위해","통해","대한","관련","가장","지난","올해",
  "지금","오늘","정말","너무","아주","매우","모든","어떤","이번","다음","현재",
  "최근","직접","바로","다시","함께","따라","위한","대해","진짜","완전","우리",
  "합니다","있습니다","하는","하고","하면","해서","해야","하여","하지","했다"
]);

const extractText = items =>
  items.map(i => (i.title+" "+(i.description||""))
    .replace(/<[^>]*>/g,"").replace(/&[a-z]+;/g," ")
    .replace(/[^\uAC00-\uD7A3\s]/g," ").replace(/\s+/g," ").trim()
  ).join(" ");

const tokenize = text => (text.match(/[가-힣]{2,8}/g)||[]).filter(w=>!STOP.has(w));

const topKeywords = (tokens, original, n=10) => {
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t]||0)+1;
  return Object.entries(freq)
    .filter(([w,c]) => c>=2 && w!==original && !original.includes(w))
    .sort((a,b)=>b[1]-a[1]).slice(0,n)
    .map(([keyword,count])=>({ keyword, count }));
};

// ══════════════════════════════════════
// 핵심: 돈 될 가능성 점수 계산
// ══════════════════════════════════════
const calcMoneyScore = ({ keyword, count, totalDocs, shops, trendScore }) => {
  const reasons = [];
  let score = 0;

  // 1) 트렌드 점수 반영 (25점)
  const trendPart = Math.round((trendScore / 100) * 25);
  score += trendPart;
  if (trendScore >= 70) reasons.push(`유튜브 트렌드 점수 높음 (${trendScore}점)`);
  else if (trendScore >= 40) reasons.push(`유튜브 트렌드 점수 보통 (${trendScore}점)`);
  else reasons.push(`유튜브 트렌드 점수 낮음 (${trendScore}점)`);

  // 2) 키워드 빈도 (25점)
  const freqRatio = Math.min(1, count / 30);
  const freqPart  = Math.round(freqRatio * 25);
  score += freqPart;
  if (count >= 20) reasons.push(`네이버에서 ${count}회 언급 — 높은 관심도`);
  else if (count >= 10) reasons.push(`네이버에서 ${count}회 언급 — 보통 관심도`);
  else reasons.push(`네이버 언급 ${count}회 — 아직 낮은 관심도`);

  // 3) 쇼핑 경쟁도 (25점) — 상품 수 적을수록 진입 쉬움
  const competition = shops.length;
  let competPart = 0;
  if (competition === 0) {
    competPart = 5;
    reasons.push("쇼핑 상품 없음 — 시장 미개척 (리스크 있음)");
  } else if (competition <= 3) {
    competPart = 25;
    reasons.push(`쇼핑 경쟁 적음 (${competition}개) — 진입 유리`);
  } else if (competition <= 6) {
    competPart = 15;
    reasons.push(`쇼핑 경쟁 보통 (${competition}개)`);
  } else {
    competPart = 8;
    reasons.push(`쇼핑 경쟁 많음 (${competition}개) — 차별화 필요`);
  }
  score += competPart;

  // 4) 가격 매력도 (25점) — 1~30만원대가 가장 좋음
  const prices   = shops.map(s=>parseInt(s.lprice)||0).filter(p=>p>0);
  const avgPrice = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
  let pricePart  = 0;
  if (avgPrice === 0) {
    pricePart = 10;
    reasons.push("가격 데이터 없음");
  } else if (avgPrice >= 10000 && avgPrice <= 300000) {
    pricePart = 25;
    reasons.push(`평균가 ${avgPrice.toLocaleString()}원 — 구매 전환 유리한 가격대`);
  } else if (avgPrice > 300000 && avgPrice <= 1000000) {
    pricePart = 15;
    reasons.push(`평균가 ${avgPrice.toLocaleString()}원 — 고가, 구매 허들 있음`);
  } else if (avgPrice < 10000) {
    pricePart = 10;
    reasons.push(`평균가 ${avgPrice.toLocaleString()}원 — 저가, 마진 낮을 수 있음`);
  } else {
    pricePart = 5;
    reasons.push(`평균가 ${avgPrice.toLocaleString()}원 — 초고가, 타겟 좁음`);
  }
  score += pricePart;

  // 등급
  const grade = score >= 75 ? "S" : score >= 60 ? "A" : score >= 40 ? "B" : "C";
  const gradeLabel = score >= 75 ? "🔥 강력 추천" : score >= 60 ? "✅ 추천" : score >= 40 ? "📊 보통" : "❄️ 비추천";

  return {
    score: Math.min(100, score),
    grade, gradeLabel,
    reasons,
    breakdown: { trendPart, freqPart, competPart, pricePart },
    avgPrice, competition
  };
};

// ══════════════════════════════════════
// 메인 파이프라인
// ══════════════════════════════════════
export const analyzeMoneyKeywords = async (keyword, trendScoreMap = {}) => {
  const ck = `money:${keyword.trim().toLowerCase()}`;
  const cached = getCache(ck);
  if (cached) return { result: cached, fromCache: true };

  // Step 1: 블로그 + 뉴스 + 카페 병렬 수집
  const [blogs, news, cafes] = await Promise.all([
    fetchContent("blog",        keyword),
    fetchContent("news",        keyword),
    fetchContent("cafearticle", keyword)
  ]);

  const totalDocs = blogs.length + news.length + cafes.length;
  if (!totalDocs) throw new Error("네이버 검색 결과 없음");

  // Step 2: 키워드 추출
  const allText  = extractText([...blogs, ...news, ...cafes]);
  const tokens   = tokenize(allText);
  const top10kw  = topKeywords(tokens, keyword);
  if (!top10kw.length) throw new Error("키워드 추출 실패");

  // Step 3: 상위 5개 키워드 쇼핑 데이터 병렬 수집
  const top5 = top10kw.slice(0, 5);
  const shopResults = await Promise.all(top5.map(item => fetchShop(item.keyword)));

  // Step 4: 돈 될 가능성 점수 계산
  const analyzed = top10kw.map((item, i) => {
    const shops      = i < 5 ? shopResults[i] : [];
    const trendScore = trendScoreMap[item.keyword] || Math.round(Math.min(100, (item.count / 30) * 100));
    const money      = calcMoneyScore({ keyword: item.keyword, count: item.count, totalDocs, shops, trendScore });
    const prices     = shops.map(s=>parseInt(s.lprice)||0).filter(p=>p>0);

    return {
      keyword:   item.keyword,
      count:     item.count,
      trendScore,
      moneyScore:  money.score,
      grade:       money.grade,
      gradeLabel:  money.gradeLabel,
      reasons:     money.reasons,
      breakdown:   money.breakdown,
      avgPrice:    money.avgPrice,
      competition: money.competition,
      minPrice:    prices.length ? Math.min(...prices) : 0,
      maxPrice:    prices.length ? Math.max(...prices) : 0,
      topShop:     shops[0] ? {
        name:  shops[0].title.replace(/<[^>]*>/g,""),
        price: parseInt(shops[0].lprice)||0,
        mall:  shops[0].mallName,
        url:   shops[0].link
      } : null
    };
  });

  const sorted = analyzed.sort((a,b) => b.moneyScore - a.moneyScore);
  const result = { keyword, top10: sorted, totalDocs, extractedAt: Date.now() };
  setCache(ck, result);
  return { result, fromCache: false };
};
