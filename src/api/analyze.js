const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`;
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const CACHE_TTL = 5 * 60 * 1000;
const cache     = new Map();
const getCache  = k => { const h=cache.get(k); if(!h) return null; if(Date.now()-h.ts>CACHE_TTL){cache.delete(k);return null;} return h.data; };
const setCache  = (k, d) => cache.set(k, { ts: Date.now(), data: d });

// Gemini API 호출
const callGemini = async (prompt) => {
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
};

const parseJsonArray = (text) => {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("파싱 실패");
  try { return JSON.parse(m[0]); }
  catch { return JSON.parse(m[0].replace(/[\u0000-\u001F\u007F-\u009F]/g, "")); }
};

// ══════════════════════════════════════
// Step 1. 유튜브 제목에서 핵심 키워드 추출 (Gemini)
// ══════════════════════════════════════
export const extractKeywordsFromTitles = async (titles) => {
  if (!titles || titles.length === 0) return [];
  try {
    const prompt = `다음 유튜브 제목들에서 핵심 키워드 3~5개를 추출해줘.
규칙:
- JSON 배열만 반환 (설명 없이)
- 한국어 명사만
- 추천/리뷰/후기/언박싱/비교/최고/베스트 제외
- 형식: ["키워드1","키워드2","키워드3"]

유튜브 제목:
${titles.slice(0,10).map((t,i)=>`${i+1}. ${t}`).join("\n")}

JSON:`;
    const text = await callGemini(prompt);
    return parseJsonArray(text);
  } catch { return []; }
};

// ══════════════════════════════════════
// Step 2. 네이버 검색 + 쇼핑 조회
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
const stripHtml = s => s
  .replace(/<[^>]*>/g,"")
  .replace(/&quot;/g,'"')
  .replace(/&amp;/g,"&")
  .replace(/&lt;/g,"<")
  .replace(/&gt;/g,">")
  .trim();

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
    const mentionCount = blogs.length + news.length;

    const prices   = shops.map(s => parseInt(s.lprice)||0).filter(p => p > 0);
    const avgPrice = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const shopCount = shops.length;

    const mentionScore = Math.min(100, (mentionCount / 20) * 100) * 0.5;
    const shopScore    = Math.min(100, (shopCount / 5) * 100) * 0.3;
    const priceScore   = avgPrice > 0 ? Math.max(0, 100 - (avgPrice / 100000) * 30) * 0.2 : 0;
    const interestScore = Math.round(mentionScore + shopScore + priceScore);

    const topBlog = blogs[0] ? stripHtml(blogs[0].title) : null;
    const topNews = news[0]  ? stripHtml(news[0].title)  : null;
    const topShop = shops[0] ? {
      name:  stripHtml(shops[0].title),
      price: parseInt(shops[0].lprice)||0,
      mall:  shops[0].mallName,
      url:   shops[0].link
    } : null;

    return { keyword, mentionCount, shopCount, avgPrice, minPrice, interestScore, topBlog, topNews, topShop };
  });

  const sorted = integrated.sort((a,b) => b.interestScore - a.interestScore);
  const result = { keywords: sorted, extractedAt: Date.now() };
  setCache(ck, result);
  return { result, fromCache: false };
};
