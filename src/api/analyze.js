const CACHE_TTL = 5 * 60 * 1000;
const cache     = new Map();
const getCache  = k => { const h=cache.get(k); if(!h) return null; if(Date.now()-h.ts>CACHE_TTL){cache.delete(k);return null;} return h.data; };
const setCache  = (k, d) => cache.set(k, { ts: Date.now(), data: d });

// Gemini 프록시 호출
const callGemini = async (prompt) => {
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt })
  });
  const data = await res.json();
  // 에러 메시지 상세 노출
  if (data.error) throw new Error(`Gemini 오류 [${data.code||res.status}]: ${data.error}`);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!text) throw new Error("Gemini 응답 비어있음: " + JSON.stringify(data).slice(0, 200));
  return text;
};

// ══════════════════════════════════════
// Step 1. 유튜브 제목에서 핵심 키워드 추출
// ══════════════════════════════════════
export const extractKeywordsFromTitles = async (titles) => {
  if (!titles || titles.length === 0) return [];

  const prompt = `아래 유튜브 제목에서 핵심 명사 키워드 5개를 추출해서 JSON 배열로만 답해줘.
마크다운, 설명, 줄바꿈 없이 오직 JSON 배열만.
예시: ["키워드1","키워드2","키워드3","키워드4","키워드5"]

제목:
${titles.slice(0,8).map((t,i)=>`${i+1}. ${t}`).join("\n")}`;

  // 에러를 잡지 않고 위로 전파 → App.jsx에서 정확한 메시지 표시
  const text = await callGemini(prompt);

  // 1) JSON 배열 파싱
  const m1 = text.match(/\[[\s\S]*?\]/);
  if (m1) {
    try { return JSON.parse(m1[0]); } catch {}
  }

  // 2) 따옴표 단어 직접 추출
  const m2 = text.match(/"([^"]+)"/g);
  if (m2 && m2.length >= 2) {
    return m2.map(s => s.replace(/"/g,"")).filter(s => s.length >= 2).slice(0,5);
  }

  // 3) 쉼표 구분 텍스트
  const m3 = text.replace(/[\[\]"]/g,"").split(",").map(s=>s.trim()).filter(s=>s.length>=2);
  if (m3.length >= 2) return m3.slice(0,5);

  throw new Error("키워드 파싱 실패. Gemini 응답: " + text.slice(0,100));
};

// ══════════════════════════════════════
// Step 2. 네이버 검색 + 쇼핑 조회
// ══════════════════════════════════════
const searchNaverBlog = async (keyword) => {
  try {
    const res = await fetch(`/api/naver-search?query=${encodeURIComponent(keyword)}&type=blog`);
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch { return []; }
};

const searchNaverNews = async (keyword) => {
  try {
    const res = await fetch(`/api/naver-search?query=${encodeURIComponent(keyword)}&type=news`);
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch { return []; }
};

const searchNaverShop = async (keyword) => {
  try {
    const res = await fetch(`/api/naver-shop?query=${encodeURIComponent(keyword)}`);
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch { return []; }
};

// ══════════════════════════════════════
// Step 3. 통합 분석
// ══════════════════════════════════════
const stripHtml = s => s
  .replace(/<[^>]*>/g,"")
  .replace(/&quot;/g,'"').replace(/&amp;/g,"&")
  .replace(/&lt;/g,"<").replace(/&gt;/g,">")
  .trim();

export const analyzeKeywords = async (titles, originalKeyword) => {
  const ck = `analyze:${originalKeyword.trim().toLowerCase()}`;
  const cached = getCache(ck);
  if (cached) return { result: cached, fromCache: true };

  // Step 1: 키워드 추출 (에러 전파)
  const keywords = await extractKeywordsFromTitles(titles);
  if (!keywords.length) throw new Error("키워드 추출 실패");

  // Step 2: 각 키워드 병렬 검색
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
    const prices       = shops.map(s => parseInt(s.lprice)||0).filter(p => p > 0);
    const avgPrice     = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
    const minPrice     = prices.length ? Math.min(...prices) : 0;
    const shopCount    = shops.length;

    const mentionScore  = Math.min(100, (mentionCount / 20) * 100) * 0.5;
    const shopScore     = Math.min(100, (shopCount / 5) * 100) * 0.3;
    const priceScore    = avgPrice > 0 ? Math.max(0, 100 - (avgPrice / 100000) * 30) * 0.2 : 0;
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
