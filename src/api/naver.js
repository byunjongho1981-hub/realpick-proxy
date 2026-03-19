const CLAUDE_URL    = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

const CLAUDE_HEADERS = {
  "Content-Type": "application/json",
  "x-api-key": ANTHROPIC_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true"
};

const CACHE_TTL = 5 * 60 * 1000;
const cache     = new Map();
const getCache  = k => { const h=cache.get(k); if(!h) return null; if(Date.now()-h.ts>CACHE_TTL){cache.delete(k);return null;} return h.data; };
const setCache  = (k, d) => cache.set(k, { ts: Date.now(), data: d });

// 쇼핑 키워드 추출 (Claude)
export const extractShoppingKeyword = async (originalKeyword, titles) => {
  if (!titles || titles.length === 0) return originalKeyword;
  const res = await fetch(CLAUDE_URL, {
    method: "POST",
    headers: CLAUDE_HEADERS,
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 50,
      system: `Return ONLY the most relevant Naver Shopping search keyword. 2-4 Korean words. No explanation.`,
      messages: [{
        role: "user",
        content: `원본 키워드: "${originalKeyword}"\n유튜브 제목:\n${titles.slice(0,5).map((t,i)=>`${i+1}. ${t}`).join("\n")}\n\n쇼핑 검색 키워드 1개만:`
      }]
    })
  });
  const data = await res.json();
  const text = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").trim();
  if (!text || !text.includes(originalKeyword.slice(0,2))) return originalKeyword;
  return text;
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
