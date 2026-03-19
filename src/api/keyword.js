const CACHE_TTL = 5 * 60 * 1000;
const cache     = new Map();
const getCache  = k => { const h=cache.get(k); if(!h) return null; if(Date.now()-h.ts>CACHE_TTL){cache.delete(k);return null;} return h.data; };
const setCache  = (k, d) => cache.set(k, { ts: Date.now(), data: d });

// ══════════════════════════════════════
// Step 1. 검색 결과 수집 (프록시 경유)
// ══════════════════════════════════════
const searchNaver = async (type, keyword) => {
  try {
    const res = await fetch(`/api/naver-search?query=${encodeURIComponent(keyword)}&type=${type}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(item => ({
      title:       item.title       || "",
      description: item.description || "",
      source:      type === "blog" ? "블로그" : type === "news" ? "뉴스" : "카페"
    }));
  } catch { return []; }
};

// ══════════════════════════════════════
// Step 2. 텍스트 추출 + 정제
// ══════════════════════════════════════
const extractText = (items) =>
  items.map(i =>
    (i.title + " " + i.description)
      .replace(/<b>/g, "").replace(/<\/b>/g, "")  // 네이버 강조 태그 제거
      .replace(/<[^>]*>/g, "")                     // 나머지 HTML 태그 제거
      .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/[^\uAC00-\uD7A3\s]/g, " ")         // 한글 + 공백만 유지
      .replace(/\s+/g, " ")                         // 중복 공백 제거
      .trim()
  ).join(" ");

// ══════════════════════════════════════
// Step 3. 단어 분해 (불필요한 단어 제거)
// ══════════════════════════════════════

// 조사, 접속사, 부사, 일반 동사 불용어 목록
const STOP_WORDS = new Set([
  // 조사
  "이가","을를","은는","와과","로으로","에서","에게","부터","까지","에도","에만","에는",
  "으로는","으로도","에서는","이라","이라고","라고","라는","이라는",
  // 접속사
  "그리고","그러나","하지만","그런데","그래서","따라서","또한","또는","혹은","및","아니면",
  // 일반 불용어
  "것","수","등","이","그","저","때","곳","분","명","개","번","가지","정도",
  "있다","없다","하다","되다","이다","같다","많다","보다","오다","가다","나다","받다",
  "위해","통해","대한","관련","가장","지난","올해","지금","오늘","내일","어제",
  "정말","너무","아주","매우","모든","어떤","무슨","여기","저기","거기",
  "이번","다음","이후","이전","현재","최근","이상","이하","직접","바로",
  "다시","계속","함께","따라","통한","위한","대해","진짜","완전","엄청",
  "사실","경우","방법","문제","내용","생각","이유","부분","결과","상황",
  "사람","우리","자신","모두","아무","누구","무엇","어디","언제","왜","어떻게"
]);

const tokenize = (text) =>
  (text.match(/[가-힣]{2,8}/g) || [])
    .filter(w => !STOP_WORDS.has(w));

// ══════════════════════════════════════
// Step 4. 빈도수 분석
// ══════════════════════════════════════
const analyzeFrequency = (tokens) => {
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
  return freq;
};

// ══════════════════════════════════════
// Step 5. 핵심 키워드 TOP10 생성
// ══════════════════════════════════════
const buildTop10 = (freqMap, sourceMap, originalKeyword) => {
  // 원본 키워드 및 부분 포함 단어 제외, 최소 2회 이상
  const filtered = Object.entries(freqMap).filter(([w, cnt]) =>
    cnt >= 2 &&
    w !== originalKeyword &&
    !originalKeyword.includes(w) &&
    !w.includes(originalKeyword)
  );

  return filtered
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
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
};

// ══════════════════════════════════════
// 메인 파이프라인
// ══════════════════════════════════════
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

  if (!blogs.length && !news.length && !cafes.length)
    throw new Error("검색 결과 없음");

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

  // 소스 매핑
  const sourceMap = {};
  for (const word of Object.keys(freqMap)) {
    const s = new Set();
    if (blogTokens.has(word)) s.add("블로그");
    if (newsTokens.has(word)) s.add("뉴스");
    if (cafeTokens.has(word)) s.add("카페");
    sourceMap[word] = s;
  }

  // Step 5: TOP10 생성
  const keywords = buildTop10(freqMap, sourceMap, keyword);
  if (!keywords.length) throw new Error("키워드 추출 실패");

  setCache(ck, keywords);
  return { keywords, fromCache: false };
};
