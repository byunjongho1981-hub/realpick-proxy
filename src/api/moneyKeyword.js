const CACHE_TTL = 5 * 60 * 1000;
const cache     = new Map();
const getCache  = k => { const h=cache.get(k); if(!h) return null; if(Date.now()-h.ts>CACHE_TTL){cache.delete(k);return null;} return h.data; };
const setCache  = (k, d) => cache.set(k, { ts: Date.now(), data: d });

// ══════════════════════════════════════
// Step 1. 네이버 블로그/뉴스/카페 데이터 수집
// ══════════════════════════════════════
const fetchNaverContent = async (type, keyword, display = 20) => {
  try {
    const res = await fetch(`/api/naver-search?query=${encodeURIComponent(keyword)}&type=${type}&display=${display}`);
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch { return []; }
};

// ══════════════════════════════════════
// Step 2. 텍스트에서 핵심 키워드 추출
// ══════════════════════════════════════
const STOP_WORDS = new Set([
  "것","수","등","및","이","그","저","를","이다","있다","하다","되다","않다",
  "없다","같다","많다","보다","위해","통해","대한","관련","가장","지난","올해",
  "지금","오늘","내일","어제","정말","너무","아주","매우","모든","어떤","무슨",
  "여기","저기","거기","이번","다음","이후","이전","현재","최근","이상","이하",
  "직접","바로","다시","계속","함께","따라","통한","위한","대해","진짜","완전",
  "사실","경우","방법","내용","생각","이유","부분","결과","상황","우리","자신",
  "모두","아무","누구","무엇","어디","언제","왜","어떻게","합니다","있습니다",
  "합니다","했습니다","하는","하고","하면","해서","해도","해야","하여","하지"
]);

const extractText = (items) =>
  items.map(i =>
    (i.title + " " + (i.description || ""))
      .replace(/<[^>]*>/g, "")
      .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/[^\uAC00-\uD7A3\s]/g, " ")
      .replace(/\s+/g, " ").trim()
  ).join(" ");

const tokenize = (text) =>
  (text.match(/[가-힣]{2,8}/g) || []).filter(w => !STOP_WORDS.has(w));

const analyzeFrequency = (tokens) => {
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
  return freq;
};

// ══════════════════════════════════════
// Step 3. TOP10 키워드 추출
// ══════════════════════════════════════
const buildTop10 = (freqMap, sourceMap, originalKeyword) =>
  Object.entries(freqMap)
    .filter(([w, cnt]) => cnt >= 2 && w !== originalKeyword && !originalKeyword.includes(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => {
      const sources = sourceMap[word] || new Set();
      const srcArr  = [...sources];
      return {
        keyword:  word,
        count,
        category: srcArr.length >= 2 ? "공통" : srcArr[0] || "공통",
        sources:  srcArr
      };
    });

// ══════════════════════════════════════
// Step 4. 네이버 쇼핑 분석
// ══════════════════════════════════════
const fetchShoppingData = async (keyword) => {
  try {
    const res = await fetch(`/api/naver-shop?query=${encodeURIComponent(keyword)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const items = data.items || [];
    if (!items.length) return null;

    const prices    = items.map(i => parseInt(i.lprice)||0).filter(p => p > 0);
    const avgPrice  = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
    const minPrice  = prices.length ? Math.min(...prices) : 0;
    const maxPrice  = prices.length ? Math.max(...prices) : 0;
    const competition = items.length;

    // 경쟁도 점수 (낮을수록 좋음 — 진입 쉬움)
    const competitionScore = Math.max(0, 100 - (competition / 10) * 100);

    // 가격 매력도 (너무 비싸지도 싸지도 않은 10~100만원대가 좋음)
    const priceScore = avgPrice >= 10000 && avgPrice <= 1000000
      ? Math.min(100, (avgPrice / 100000) * 30 + 40)
      : avgPrice < 10000 ? 20 : 30;

    return {
      items: items.slice(0, 3).map(i => ({
        name:  i.title.replace(/<[^>]*>/g, ""),
        price: parseInt(i.lprice)||0,
        mall:  i.mallName,
        url:   i.link,
        image: i.image
      })),
      avgPrice, minPrice, maxPrice, competition,
      competitionScore: Math.round(competitionScore),
      priceScore: Math.round(priceScore)
    };
  } catch { return null; }
};

// ══════════════════════════════════════
// Step 5. 돈 될 가능성 점수 계산
// ══════════════════════════════════════
const calcMoneyScore = (keyword, count, sources, shopping) => {
  // 관심도: 언급수 기반 (40%)
  const interestScore = Math.min(100, (count / 30) * 100) * 0.4;

  // 확산도: 블로그+뉴스+카페 모두 있으면 만점 (20%)
  const spreadScore = (sources.length / 3) * 100 * 0.2;

  // 쇼핑 경쟁도: 낮을수록 진입 쉬움 (20%)
  const shopCompScore = shopping ? shopping.competitionScore * 0.2 : 0;

  // 가격 매력도 (20%)
  const priceScore = shopping ? shopping.priceScore * 0.2 : 0;

  return Math.round(Math.min(100, interestScore + spreadScore + shopCompScore + priceScore));
};

// ══════════════════════════════════════
// 메인 파이프라인
// ══════════════════════════════════════
export const analyzeMoneyKeywords = async (keyword) => {
  const ck = `money:${keyword.trim().toLowerCase()}`;
  const cached = getCache(ck);
  if (cached) return { result: cached, fromCache: true };

  // Step 1: 블로그 + 뉴스 + 카페 병렬 수집
  const [blogs, news, cafes] = await Promise.all([
    fetchNaverContent("blog",        keyword, 20),
    fetchNaverContent("news",        keyword, 20),
    fetchNaverContent("cafearticle", keyword, 20)
  ]);

  if (!blogs.length && !news.length && !cafes.length)
    throw new Error("네이버 검색 결과 없음");

  // Step 2: 텍스트 추출
  const blogText = extractText(blogs);
  const newsText = extractText(news);
  const cafeText = extractText(cafes);

  // Step 3: 빈도 분석
  const allTokens  = tokenize(blogText + " " + newsText + " " + cafeText);
  const blogTokens = new Set(tokenize(blogText));
  const newsTokens = new Set(tokenize(newsText));
  const cafeTokens = new Set(tokenize(cafeText));
  const freqMap    = analyzeFrequency(allTokens);

  const sourceMap = {};
  for (const word of Object.keys(freqMap)) {
    const s = new Set();
    if (blogTokens.has(word)) s.add("블로그");
    if (newsTokens.has(word)) s.add("뉴스");
    if (cafeTokens.has(word)) s.add("카페");
    sourceMap[word] = s;
  }

  const top10 = buildTop10(freqMap, sourceMap, keyword);
  if (!top10.length) throw new Error("키워드 추출 실패");

  // Step 4: 상위 5개 키워드에 대해 쇼핑 분석 병렬 실행
  const top5 = top10.slice(0, 5);
  const shoppingData = await Promise.all(
    top5.map(item => fetchShoppingData(item.keyword))
  );

  // Step 5: 돈 될 가능성 점수 계산
  const enriched = top10.map((item, i) => {
    const shopping   = i < 5 ? shoppingData[i] : null;
    const moneyScore = calcMoneyScore(item.keyword, item.count, item.sources, shopping);
    return { ...item, shopping, moneyScore };
  });

  // 돈 될 가능성 점수로 정렬
  const sorted = enriched.sort((a, b) => b.moneyScore - a.moneyScore);

  const result = {
    keyword,
    top10: sorted,
    totalDocs: blogs.length + news.length + cafes.length,
    extractedAt: Date.now()
  };

  setCache(ck, result);
  return { result, fromCache: false };
};
