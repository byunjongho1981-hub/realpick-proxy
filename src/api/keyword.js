const CACHE_TTL = 5 * 60 * 1000;
const cache     = new Map();
const getCache  = k => { const h=cache.get(k); if(!h) return null; if(Date.now()-h.ts>CACHE_TTL){cache.delete(k);return null;} return h.data; };
const setCache  = (k, d) => cache.set(k, { ts: Date.now(), data: d });

// ── Step 1: 검색 결과 수집 (프록시 경유) ──
const searchNaver = async (type, keyword) => {
  const res = await fetch(`/api/naver-search?query=${encodeURIComponent(keyword)}&type=${type}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || []).map(item => ({
    title:       item.title       || "",
    description: item.description || "",
    source:      type === "blog" ? "블로그" : type === "news" ? "뉴스" : "카페"
  }));
};

// ── Step 2: 텍스트 추출 ──
const extractText = (items) =>
  items.map(i =>
    (i.title + " " + i.description)
      .replace(/<[^>]*>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/[^\uAC00-\uD7A3\s]/g, " ")
      .trim()
  ).join(" ");

// ── Step 3: 단어 분해 ──
const STOP_WORDS = new Set([
  "것","수","등","및","이","그","저","를","이다","있다","하다","되다","않다",
  "없다","같다","많다","보다","위해","통해","대한","관련","가장","지난","올해",
  "지금","오늘","내일","어제","정말","너무","아주","매우","모든","어떤","무슨",
  "여기","저기","거기","이번","다음","이후","이전","현재","최근","이상","이하",
  "직접","바로","다시","계속","함께","따라","통한","위한","대해","에서","으로",
  "부터","까지","에게","에도","에만","에는","에서는","으로는","으로도"
]);

const tokenize = (text) =>
  (text.match(/[가-힣]{2,7}/g) || [])
    .filter(w => !STOP_WORDS.has(w));

// ── Step 4: 빈도 분석 ──
const analyzeFrequency = (tokens) => {
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
  return freq;
};

// ── Step 5: 핵심 키워드 생성 ──
const buildKeywords = (freqMap, sourceMap, originalKeyword, topN=10) =>
  Object.entries(freqMap)
    .filter(([w, cnt]) =>
      cnt >= 2 &&
      !originalKeyword.includes(w) &&
      w !== originalKeyword
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => {
      const sources  = sourceMap[word] || new Set();
      const srcArr   = [...sources];
      const category = srcArr.length >= 2 ? "공통" : srcArr[0] || "공통";
      return {
        keyword:  word,
        count,
        category,
        reason: `${srcArr.join("·")}에서 ${count}회 언급`
      };
    });

// ── 메인 파이프라인 ──
export const fetchNaverKeywords = async (keyword) => {
  const ck = `kw:${keyword.trim().toLowerCase()}`;
  const cached = getCache(ck);
  if (cached) return { keywords: cached, fromCache: true };

  // Step 1: 블로그 + 뉴스 + 카페 병렬 수집
  const [blogs, news, cafes] = await Promise.all([
    searchNaver("blog",        keyword),
    searchNaver("news",        keyword),
    searchNaver("cafearticle", keyword)
  ]);

  const allItems = [...blogs, ...news, ...cafes];
  if (!allItems.length) throw new Error("검색 결과 없음");

  // Step 2: 텍스트 추출
  const blogText = extractText(blogs);
  const newsText = extractText(news);
  const cafeText = extractText(cafes);

  // Step 3: 단어 분해
  const allTokens  = tokenize(blogText + " " + newsText + " " + cafeText);
  const blogTokens = new Set(tokenize(blogText));
  const newsTokens = new Set(tokenize(newsText));
  const cafeTokens = new Set(tokenize(cafeText));

  // Step 4: 빈도 분석
  const freqMap = analyzeFrequency(allTokens);

  // 소스별 매핑
  const sourceMap = {};
  for (const word of Object.keys(freqMap)) {
    const sources = new Set();
    if (blogTokens.has(word)) sources.add("블로그");
    if (newsTokens.has(word)) sources.add("뉴스");
    if (cafeTokens.has(word)) sources.add("카페");
    sourceMap[word] = sources;
  }

  // Step 5: 핵심 키워드 생성
  const keywords = buildKeywords(freqMap, sourceMap, keyword);
  if (!keywords.length) throw new Error("키워드 추출 실패");

  setCache(ck, keywords);
  return { keywords, fromCache: false };
};
