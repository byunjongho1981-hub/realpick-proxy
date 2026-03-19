const CACHE_TTL = 5 * 60 * 1000;
const cache     = new Map();
const getCache  = k => { const h=cache.get(k); if(!h) return null; if(Date.now()-h.ts>CACHE_TTL){cache.delete(k);return null;} return h.data; };
const setCache  = (k, d) => cache.set(k, { ts: Date.now(), data: d });

// Groq 프록시 호출
const callAI = async (prompt) => {
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.choices?.[0]?.message?.content || "";
};

// ══════════════════════════════════════
// Step 1. 유튜브 제목 → 핵심 키워드 추출
// ══════════════════════════════════════
export const extractKeywordsFromTitles = async (titles) => {
  if (!titles || titles.length === 0) return [];
  const prompt = `아래 유튜브 제목에서 핵심 명사 키워드 5개를 추출해서 JSON 배열로만 답해줘.
마크다운, 설명, 줄바꿈 없이 오직 JSON 배열만.
예시: ["키워드1","키워드2","키워드3","키워드4","키워드5"]

제목:
${titles.slice(0,8).map((t,i)=>`${i+1}. ${t}`).join("\n")}`;

  const text = await callAI(prompt);
  const m1 = text.match(/\[[\s\S]*?\]/);
  if (m1) { try { return JSON.parse(m1[0]); } catch {} }
  const m2 = text.match(/"([^"]+)"/g);
  if (m2 && m2.length >= 2) return m2.map(s=>s.replace(/"/g,"")).filter(s=>s.length>=2).slice(0,5);
  const m3 = text.replace(/[\[\]"]/g,"").split(",").map(s=>s.trim()).filter(s=>s.length>=2);
  if (m3.length >= 2) return m3.slice(0,5);
  throw new Error("키워드 파싱 실패");
};

// ══════════════════════════════════════
// Step 2. 네이버 검색 (블로그 + 뉴스)
// ══════════════════════════════════════
const searchNaver = async (type, keyword) => {
  try {
    const res = await fetch(`/api/naver-search?query=${encodeURIComponent(keyword)}&type=${type}`);
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch { return []; }
};

// ══════════════════════════════════════
// Step 3. 네이버 쇼핑
// ══════════════════════════════════════
const searchShop = async (keyword) => {
  try {
    const res = await fetch(`/api/naver-shop?query=${encodeURIComponent(keyword)}`);
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch { return []; }
};

const stripHtml = s => s.replace(/<[^>]*>/g,"").replace(/&quot;/g,'"').replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").trim();

// ══════════════════════════════════════
// Step 4. 사람 관심 분석
// ══════════════════════════════════════
const analyzeInterest = (blogs, news) => {
  const total = blogs.length + news.length;
  const score = Math.min(100, (total / 20) * 100);
  const level = score >= 70 ? "높음" : score >= 40 ? "보통" : "낮음";
  return { total, score: Math.round(score), level,
    blogCount: blogs.length, newsCount: news.length,
    topBlog: blogs[0] ? stripHtml(blogs[0].title) : null,
    topNews: news[0]  ? stripHtml(news[0].title)  : null
  };
};

// ══════════════════════════════════════
// Step 5. 구매 가능성 분석
// ══════════════════════════════════════
const analyzePurchase = (shops) => {
  if (!shops.length) return { score: 0, level: "낮음", avgPrice: 0, minPrice: 0, maxPrice: 0, competition: 0, topShop: null };

  const prices     = shops.map(s => parseInt(s.lprice)||0).filter(p => p > 0);
  const avgPrice   = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
  const minPrice   = prices.length ? Math.min(...prices) : 0;
  const maxPrice   = prices.length ? Math.max(...prices) : 0;
  const competition = shops.length; // 경쟁 상품 수

  // 구매 가능성 점수: 상품수 40% + 가격경쟁력 40% + 가격분포 20%
  const shopScore  = Math.min(100, (competition / 5) * 100) * 0.4;
  const priceScore = avgPrice > 0 ? Math.max(0, 100 - (avgPrice / 200000) * 100) * 0.4 : 0;
  const spreadScore = maxPrice > minPrice ? Math.min(100, ((maxPrice - minPrice) / avgPrice) * 100) * 0.2 : 0;
  const score = Math.round(Math.min(100, shopScore + priceScore + spreadScore));
  const level = score >= 70 ? "높음" : score >= 40 ? "보통" : "낮음";

  const topShop = shops[0] ? {
    name:  stripHtml(shops[0].title),
    price: parseInt(shops[0].lprice)||0,
    mall:  shops[0].mallName,
    url:   shops[0].link
  } : null;

  return { score, level, avgPrice, minPrice, maxPrice, competition, topShop };
};

// ══════════════════════════════════════
// Step 6. 최종 추천 생성 (AI)
// ══════════════════════════════════════
const generateRecommendation = async (keyword, interest, purchase) => {
  try {
    const prompt = `다음 데이터를 바탕으로 이 키워드의 판매/마케팅 전략을 2~3문장으로 한국어로 조언해줘.
키워드: "${keyword}"
사람 관심도: ${interest.level} (블로그+뉴스 ${interest.total}건)
구매 가능성: ${purchase.level} (쇼핑 상품 ${purchase.competition}개, 평균가 ${purchase.avgPrice.toLocaleString()}원)

짧고 실용적인 조언만. 마크다운 없이 텍스트만.`;
    return await callAI(prompt);
  } catch { return null; }
};

// ══════════════════════════════════════
// 메인 파이프라인
// ══════════════════════════════════════
export const analyzeKeywords = async (titles, originalKeyword) => {
  const ck = `analyze:${originalKeyword.trim().toLowerCase()}`;
  const cached = getCache(ck);
  if (cached) return { result: cached, fromCache: true };

  // Step 1: 키워드 추출
  const keywords = await extractKeywordsFromTitles(titles);
  if (!keywords.length) throw new Error("키워드 추출 실패");

  // Step 2~3: 각 키워드 병렬 검색
  const searchResults = await Promise.all(
    keywords.map(async (kw) => {
      const [blogs, news, shops] = await Promise.all([
        searchNaver("blog", kw),
        searchNaver("news", kw),
        searchShop(kw)
      ]);
      return { keyword: kw, blogs, news, shops };
    })
  );

  // Step 4~5: 분석
  const analyzed = searchResults.map(({ keyword, blogs, news, shops }) => {
    const interest  = analyzeInterest(blogs, news);
    const purchase  = analyzePurchase(shops);
    const totalScore = Math.round(interest.score * 0.5 + purchase.score * 0.5);
    return { keyword, interest, purchase, totalScore };
  });

  const sorted = analyzed.sort((a,b) => b.totalScore - a.totalScore);

  // Step 6: 1위 키워드에 대해서만 최종 추천 생성
  let recommendation = null;
  if (sorted.length > 0) {
    recommendation = await generateRecommendation(
      sorted[0].keyword,
      sorted[0].interest,
      sorted[0].purchase
    );
  }

  const result = { keywords: sorted, recommendation, extractedAt: Date.now() };
  setCache(ck, result);
  return { result, fromCache: false };
};
