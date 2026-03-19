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

// 모든 content 블록에서 텍스트 추출
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

// 텍스트에서 가장 긴 JSON 배열 추출
const parseJsonArray = (text) => {
  const matches = [...text.matchAll(/\[[\s\S]*?\]/g)];
  if (!matches.length) throw new Error("파싱 실패");
  const longest = matches.sort((a, b) => b[0].length - a[0].length)[0];
  return JSON.parse(longest[0]);
};

export const fetchNaverKeywords = async (keyword) => {
  const ck     = `kw:${keyword.trim().toLowerCase()}`;
  const cached = getCache(ck);
  if (cached) return { keywords: cached, fromCache: true };

  const res = await fetch(CLAUDE_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: `You are a Korean keyword trend analyst.
Search Naver blog, news, and cafe posts related to the given keyword.
Analyze the text content and extract the most frequently mentioned core keywords.
Return ONLY a JSON array sorted by frequency, no markdown, no explanation.
Format:
[{"keyword":"키워드","count":숫자,"category":"블로그|뉴스|카페|공통","reason":"한줄설명"}]
Return exactly 10 items (TOP 10).
Focus on meaningful Korean nouns and phrases that reflect real user interest.
Exclude common stop words (것, 수, 등, 및, 이, 그, 저).`,
      messages: [{
        role: "user",
        content: `네이버 블로그, 뉴스, 카페에서 "${keyword}" 관련 글을 검색하고, 사람들이 가장 많이 언급하는 핵심 키워드 TOP10을 JSON으로만 반환해줘.`
      }]
    })
  });

  const data = await res.json();
  const text = extractText(data.content);
  const keywords = parseJsonArray(text);
  setCache(ck, keywords);
  return { keywords, fromCache: false };
};
