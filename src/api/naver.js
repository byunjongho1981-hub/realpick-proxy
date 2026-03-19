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
  if (data.error) throw new Error(data.error);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
};

// 쇼핑 키워드 추출 (Gemini 프록시)
export const extractShoppingKeyword = async (originalKeyword, titles) => {
  if (!titles || titles.length === 0) return originalKeyword;
  try {
    const prompt = `다음 유튜브 제목들을 분석해서 네이버 쇼핑 검색에 가장 적합한 키워드 1개만 반환해줘.
규칙:
- 키워드만 반환 (설명 없이)
- 2~4개 한국어 단어
- 원본 키워드 의미 유지
- 추천/리뷰/후기/언박싱 같은 단어 제거

원본 키워드: "${originalKeyword}"
유튜브 제목:
${titles.slice(0,5).map((t,i)=>`${i+1}. ${t}`).join("\n")}

키워드:`;
    const text = await callGemini(prompt);
    const kw = text.trim().split("\n")[0].trim();
    if (!kw || !kw.includes(originalKeyword.slice(0,2))) return originalKeyword;
    return kw;
  } catch { return originalKeyword; }
};

// 네이버 쇼핑 API (프록시 경유)
export const fetchNaverProducts = async (shoppingKw) => {
  const ck = `nv:${shoppingKw.trim().toLowerCase()}`;
  const cached = getCache(ck);
  if (cached) return { products: cached, fromCache: true };

  const res = await fetch(`/api/naver-shop?query=${encodeURIComponent(shoppingKw)}`);
  if (!res.ok) throw new Error(`쇼핑 API 오류 (${res.status})`);

  const data = await res.json();
  if (data.error) throw new Error(data.error);

  const items = (data.items || []).slice(0, 5);
  const products = items.map((item, i) => ({
    name:        item.title.replace(/<[^>]*>/g, ""),
    price:       item.lprice,
    mall:        item.mallName,
    rating:      null,
    reviewCount: item.reviewCount || null,
    url:         item.link,
    reason:      i === 0 ? "가장 관련성 높은 상품" : "인기 추천 상품",
    isAd:        false
  }));

  setCache(ck, products);
  return { products, fromCache: false };
};
