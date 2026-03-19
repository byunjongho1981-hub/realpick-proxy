const NAVER_ID     = import.meta.env.VITE_NAVER_CLIENT_ID;
const NAVER_SECRET = import.meta.env.VITE_NAVER_CLIENT_SECRET;

const NAVER_HEADERS = {
  "X-Naver-Client-Id": NAVER_ID,
  "X-Naver-Client-Secret": NAVER_SECRET
};

const CACHE_TTL = 5 * 60 * 1000;
const cache     = new Map();
const getCache  = k => { const h=cache.get(k); if(!h) return null; if(Date.now()-h.ts>CACHE_TTL){cache.delete(k);return null;} return h.data; };
const setCache  = (k, d) => cache.set(k, { ts: Date.now(), data: d });

// 네이버 검색 API 호출
const searchNaver = async (type, keyword, display = 10) => {
  const url = `https://openapi.naver.com/v1/search/${type}.json?query=${encodeURIComponent(keyword)}&display=${display}`;
  const res = await fetch(url, { headers: NAVER_HEADERS });
  if (!res.ok) throw new Error(`네이버 ${type} API 오류 (${res.status})`);
  const data = await res.json();
  return data.items || [];
};

// HTML 태그 제거
const stripHtml = str => str.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// 텍스트에서 핵심 명사 추출 (2글자 이상 한국어)
const extractNouns = (text) => {
  const stopWords = new Set(["것","수","등","및","이","그","저","를","이다","있다","하다","되다","않다","없다","같다","많다","보다","위해","통해","대한","관련","가장","지난","올해","지금","오늘","내일","어제"]);
  const words = text.match(/[가-힣]{2,6}/g) || [];
  return words.filter(w => !stopWords.has(w));
};

// 키워드 빈도 집계
const countKeywords = (wordList) => {
  const freq = {};
  for (const w of wordList) {
    freq[w] = (freq[w] || 0) + 1;
  }
  return freq;
};

export const fetchNaverKeywords = async (keyword) => {
  const ck = `kw:${keyword.trim().toLowerCase()}`;
  const cached = getCache(ck);
  if (cached) return { keywords: cached, fromCache: true };

  // 블로그 + 뉴스 + 카페 병렬 호출
  const [blogs, news, cafes] = await Promise.all([
    searchNaver("blog",  keyword, 20).catch(() => []),
    searchNaver("news",  keyword, 20).catch(() => []),
    searchNaver("cafearticle", keyword, 20).catch(() => [])
  ]);

  // 각 소스에서 텍스트 추출
  const blogText  = blogs.map(i => stripHtml(i.title + " " + (i.description||""))).join(" ");
  const newsText  = news.map(i  => stripHtml(i.title + " " + (i.description||""))).join(" ");
  const cafeText  = cafes.map(i => stripHtml(i.title + " " + (i.description||""))).join(" ");

  const allText = blogText + " " + newsText + " " + cafeText;
  const nouns   = extractNouns(allText);
  const freq    = countKeywords(nouns);

  // 원본 키워드 제외 후 상위 10개 추출
  const sorted = Object.entries(freq)
    .filter(([w]) => !keyword.includes(w) && w !== keyword)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // 카테고리 판별
  const blogNouns  = new Set(extractNouns(blogText));
  const newsNouns  = new Set(extractNouns(newsText));
  const cafeNouns  = new Set(extractNouns(cafeText));

  const keywords = sorted.map(([word, count]) => {
    const inBlog = blogNouns.has(word);
    const inNews = newsNouns.has(word);
    const inCafe = cafeNouns.has(word);
    const sources = [inBlog&&"블로그", inNews&&"뉴스", inCafe&&"카페"].filter(Boolean);
    const category = sources.length >= 2 ? "공통" : sources[0] || "공통";
    return { keyword: word, count, category, reason: `${sources.join("·")}에서 ${count}회 언급` };
  });

  setCache(ck, keywords);
  return { keywords, fromCache: false };
};
