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
const getCache  = k => {
  const h = cache.get(k);
  if (!h) return null;
  if (Date.now() - h.ts > CACHE_TTL) { cache.delete(k); return null; }
  return h.data;
};
const setCache = (k, d) => cache.set(k, { ts: Date.now(), data: d });

const extractText = (content = []) => {
  let text = "";
  for (const b of content) {
    if (b.type === "text") {
      text += b.text;
    } else if (b.type === "tool_result") {
      for (const c of (b.content || [])) {
        if (c.type === "text") text += c.text;
      }
    }
  }
  return text;
};

const parseJsonArray = (text) => {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("파싱 실패");
  try {
    return JSON.parse(m[0]);
  } catch {
    const clean = m[0].replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
    return JSON.parse(clean);
  }
};

export const extractShoppingKeyword = async (originalKeyword, titles) => {
  if (!titles || titles.length === 0) return originalKeyword;

  const res = await fetch(CLAUDE_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 50,
      system: `You are a Naver Shopping keyword extractor.
Rules:
- Return ONLY the keyword, nothing else
- Must be closely related to the original keyword
- 2–4 Korean words max
- Do NOT change the core meaning of the original keyword
- If unsure, return the original keyword exactly`,
      messages: [{
        role: "user",
        content: `원본 키워드: "${originalKeyword}"\n유튜브 제목:\n${titles.slice(0, 5).map((t, i) => `${i+1}. ${t}`).join("\n")}\n\n반환 (원본 키워드 의미 유지):`
      }]
    })
  });
  const data = await res.json();
  const text = extractText(data.content).trim();
  if (!text || !text.includes(originalKeyword.slice(0, 2))) return originalKeyword;
  return text;
};

export const fetchNaverProducts = async (shoppingKw) => {
  const ck     = `nv:${shoppingKw.trim().toLowerCase()}`;
  const cached = getCache(ck);
  if (cached) return { products: cached, fromCache: true };

  const res = await fetch(CLAUDE_URL, {
    method: "POST",
    headers: HEADERS,
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
  const text = extractText(data.content);
  const products = parseJsonArray(text);
  setCache(ck, products);
  return { products, fromCache: false };
};
