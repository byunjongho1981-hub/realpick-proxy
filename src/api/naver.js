const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const CACHE_TTL  = 5 * 60 * 1000;
const cache      = new Map();
const getCache   = k => {
  const h = cache.get(k);
  if (!h) return null;
  if (Date.now() - h.ts > CACHE_TTL) { cache.delete(k); return null; }
  return h.data;
};
const setCache = (k, d) => cache.set(k, { ts: Date.now(), data: d });

export const extractShoppingKeyword = async (originalKeyword, titles) => {
  const res = await fetch(CLAUDE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      system: `You are a Naver Shopping keyword extractor.
Given a search keyword and YouTube video titles, extract the single best product keyword for Naver Shopping.
Rules:
- Return ONLY the keyword, nothing else (no explanation, no punctuation)
- 2–5 Korean words max
- Focus on purchasable product names, not concepts or events
- Remove brand hype words (최고, 추천, 리뷰, 언박싱, 후기, 꿀팁 등)
- If no clear product found, return the original keyword`,
      messages: [{
        role: "user",
        content: `원본 키워드: "${originalKeyword}"\n\n유튜브 제목 목록:\n${titles.slice(0, 8).map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\n네이버 쇼핑 검색 키워드 1개만 반환:`
      }]
    })
  });
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  return text || originalKeyword;
};

export const fetchNaverProducts = async (shoppingKw) => {
  const ck     = `nv:${shoppingKw.trim().toLowerCase()}`;
  const cached = getCache(ck);
  if (cached) return { products: cached, fromCache: true };

  const res = await fetch(CLAUDE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: `You are a Naver Shopping product researcher.
Search Naver Shopping for products related to the given keyword.
Return ONLY a JSON array, no markdown, no explanation.
Format:
[{"name":"상품명","price":"숫자만(원단위)","mall":"판매처","rating":"평점(0~5)","reviewCount":"리뷰수","url":"상품URL","reason":"한줄추천이유(한국어)","isAd":false}]
Return 4–5 items. Prioritize popular, well-reviewed products.
Set "isAd": true if the listing appears to be sponsored/advertisement.`,
      messages: [{
        role: "user",
        content: `네이버 쇼핑에서 "${shoppingKw}" 관련 인기 상품 검색해서 JSON만 반환해줘.`
      }]
    })
  });
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("파싱 실패");
  const products = JSON.parse(m[0]);
  setCache(ck, products);
  return { products, fromCache: false };
};
