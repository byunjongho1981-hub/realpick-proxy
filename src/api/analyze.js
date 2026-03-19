const CLAUDE_URL    = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

const HEADERS = {
  "Content-Type": "application/json",
  "x-api-key": ANTHROPIC_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true"
};

const CACHE_TTL = 5 * 60 * 1000;
const cache     = new Map();
const getCache  = k => { const h=cache.get(k); if(!h) return null; if(Date.now()-h.ts>CACHE_TTL){cache.delete(k);return null;} return h.data; };
const setCache  = (k, d) => cache.set(k, { ts: Date.now(), data: d });

// ══════════════════════════════════════
// Step 1. 유튜브 제목에서 핵심 키워드 추출
// ══════════════════════════════════════
export const extractKeywordsFromTitles = async (titles) => {
  if (!titles || titles.length === 0) return [];

  const res = await fetch(CLAUDE_URL, {
    method: "POST", headers: HEADERS,
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      system: `You are a Korean keyword extractor.
Extract the most important product/topic keywords from YouTube video titles.
Return ONLY a JSON array of strings, no markdown, no explanation.
Format: ["키워드1","키워드2","키워드3"]
Rules:
- Extract 3-5 keywords max
- Focus on nouns and product names
- Remove common words (추천, 리뷰, 후기, 언박싱, 비교, 최고, 베스트)
- Korean only`,
      messages: [{
        role: "user",
        content: `유튜브 제목 목록:\n${titles.slice(0,10).map((t,i)=>`${i+1}. ${t}`).join("\n")}\n\n핵심 키워드 JSON 배열만 반환:`
      }]
    })
  });
  const data = await res.json();
  const text = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").trim();
  try {
    const m = text.match(/\[[\s\S]*?\]/);
    return m ? JSON.parse(m[0]) : [];
  } catch { return []; }
};

// ══════════════════════════════════════
// Step 2. 네이버 검색 + 쇼핑 통합 조회
// ══════════════════════════════════════
const searchNaverBlog = async (keyword) => {
  try {
    const res = await fetch(`/api/naver-search?query=${encodeURIComponent(keyword)}&type=blog`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  } catch { return []; }
};

const searchNaverNews = async (keyword) => {
  try {
    const res = await fetch(`/api/naver-search?query=${encodeURIComponent(keyword)}&type=news`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  } catch { return []; }
};

const searchNaverShop = async (keyword) => {
  try {
    const res = await fetch(`/api/naver-shop?query=${encodeURIComponent(keyword)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  } catch { return []; }
};

// ══════════════════════════════════════
// Step 3. 통합 분석
// ══════════════════════════════════════
const stripHtml = s => s.replace(/<[^>]*>/g,"").replace(/&quot;/g,'"').replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&nbsp;/g," ").trim();

export const analyzeKeywords = async (titles, originalKeyword) => {
  const ck = `analyze:${originalKeyword.trim().toLowerCase()}`;
  const cached = getCache(ck);
  if (cached) return { result: cached, fromCache: true };

  // Step 1: 제목에서 키워드 추출
  const keywords = await extractKeywordsFromTitles(titles);
  if (!keywords.length) throw new Error("키워드 추출 실패");

  // Step 2: 각 키워드로 네이버 검색 + 쇼핑 병렬 조회
  const searchResults = await Promise.all(
    keywords.map(async (kw) => {
      const [blogs, news, shops] = await Promise.all([
        searchNaverBlog(kw),
        searchNaverNews(kw),
        searchNaverShop(kw)
      ]);
      return { keyword: kw, blogs, news, shops };
    })
  );

  // Step 3: 통합 분석
  const integrated = searchResults.map(({ keyword, blogs, news, shops }) => {
    // 블로그+뉴스 언급 수
    const mentionCount = blogs.length + news.length;

    // 쇼핑 평균가
    const prices = shops.map(s => parseInt(s.lprice)||0).filter(p => p > 0);
    const avgPrice = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
    const minPrice = prices.length ? Math.min(...prices) : 0;

    // 쇼핑 상품 수
    const shopCount = shops.length;

    // 관심도 점수 (언급수 50% + 쇼핑상품수 30% + 가격경쟁력 20%)
    const mentionScore = Math.min(100, (mentionCount / 20) * 100) * 0.5;
    const shopScore    = Math.min(100, (shopCount / 5) * 100) * 0.3;
    const priceScore   = avgPrice > 0 ? Math.max(0, 100 - (avgPrice / 100000) * 30) * 0.2 : 0;
    const interestScore = Math.round(mentionScore + shopScore + priceScore);

    // 대표 블로그 제목
    const topBlog = blogs[0] ? stripHtml(blogs[0].title) : null;
    const topNews = news[0]  ? stripHtml(news[0].title)  : null;

    // 대표 쇼핑 상품
    const topShop = shops[0] ? {
      name:  stripHtml(shops[0].title),
      price: parseInt(shops[0].lprice)||0,
      mall:  shops[0].mallName,
      url:   shops[0].link
    } : null;

    return {
      keyword,
      mentionCount,
      shopCount,
      avgPrice,
      minPrice,
      interestScore,
      topBlog,
      topNews,
      topShop
    };
  });

  // 관심도 점수 기준 정렬
  const sorted = integrated.sort((a,b) => b.interestScore - a.interestScore);

  const result = { keywords: sorted, extractedAt: Date.now() };
  setCache(ck, result);
  return { result, fromCache: false };
};
