// v7.2 - Google Trends RSS 통합

// ── Google Trends RSS 수집 ─────────────
const fetchGoogleTrends = async () => {
  try {
    const res = await fetch("/api/google-trends");
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  } catch { return []; }
};

// ── STOP 사전 ─────────────────────────
const STOP = new Set([
  "살까","살지","살거","사야","살때","사면","사고","샀는","샀어","구매","구입","주문","결제",
  "어때","괜찮","좋아","싫어","비싸","저렴","싸다","좋다","별로","최고","최악","강추","비추",
  "재고","소진","품절","배송","도착","반품","교환","환불","후기","리뷰","사용","추천","비교",
  "할인","쿠폰","세일","특가","이벤트","공구","공동","공동구매","살까말까",
  "것","수","등","및","이","그","저","를","이다","있다","하다","되다","않다","없다","같다",
  "많다","보다","위해","통해","대한","관련","가장","지난","올해","지금","오늘","정말","너무",
  "아주","매우","모든","어떤","이번","다음","현재","최근","직접","바로","다시","함께","위한",
  "대해","진짜","완전","우리","합니다","있습니다","하는","하고","하면","해서","해야","하지",
  "영상","채널","구독","유튜브","클릭","좋아요","댓글","공유","구경","소개","일상","정보",
  "상품","제품","브랜드","출시","인기","요즘","핫한","방법","효과","성분","재료",
  "판매","가격","배송","정품","공식","최저가","무료","세일","이번주","어제","내일",
  "개봉","언박싱","분석","설명","정리","테스트","실험","선택","고민",
  "재고소진","원형","개칠","소방","이거","저거","그거","여기","저기","거기",
  "사건","사고","정치","선거","경제","주식","부동산","날씨","스포츠","연예","드라마",
  "영화","음악","콘서트","뉴스","방송","프로그램","예능","게임","축구","야구","농구",
]);

const VERB_END = /(?:하다|되다|이다|있다|없다|같다|많다|크다|작다|좋다|싫다|해서|하고|하면|해야|하지|하는|하여|하며|합니다|됩니다|입니다|인데|이라|이고|으로|에서|부터|까지|에게|한테|보다|처럼|만큼|살까|살지|샀|샀다|했다|됐다)$/;

// 상품명 추출 필터
const extractProductKws = (texts, minLen=2, maxLen=7, minCount=1, topN=20) => {
  const text = texts.join(" ").replace(/[^\uAC00-\uD7A3\s]/g," ").replace(/\s+/g," ");
  const tokens = (text.match(/[가-힣]{2,8}/g)||[]).filter(w => {
    if (w.length < minLen || w.length > maxLen) return false;
    if (STOP.has(w)) return false;
    if (VERB_END.test(w)) return false;
    return true;
  });
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t]||0)+1;
  return Object.entries(freq)
    .filter(([,c])=>c>=minCount)
    .sort((a,b)=>b[1]-a[1])
    .slice(0, topN)
    .map(([kw])=>kw);
};

// Google Trends 키워드 중 상품 관련만 필터
const PRODUCT_HINT = new Set([
  "폰","폰케이스","이어폰","노트북","태블릿","워치","스마트","가전","청소기","공기청정기",
  "크림","세럼","선크림","샴푸","마스크","팩","로션","비타민","영양제","보충제",
  "신발","운동화","가방","백팩","지갑","시계","선글라스","의류","옷","패딩","코트",
  "식품","음식","간식","커피","음료","쌀","고기","과자","영양","다이어트",
  "사료","장난감","강아지","고양이","반려",
  "에어프라이어","냄비","프라이팬","밀폐","텀블러","가습기",
]);

const isTrendProductRelated = (keyword) => {
  // 2~8자 한글이고 상품 힌트 포함 or 쇼핑 관련 단어 포함
  if (!/^[가-힣]{2,8}$/.test(keyword)) return false;
  if (STOP.has(keyword)) return false;
  if (VERB_END.test(keyword)) return false;
  // 트렌드 키워드 자체가 상품명처럼 보이면 통과
  for (const hint of PRODUCT_HINT) {
    if (keyword.includes(hint) || hint.includes(keyword)) return true;
  }
  return false;
};

// ── 고정 시드 ─────────────────────────
const FIXED_SEEDS = [
  "무선이어폰","공기청정기","로봇청소기","노트북","태블릿","스마트워치","보조배터리",
  "선크림","세럼","비타민","마스크팩","샴푸","단백질보충제","유산균",
  "에어프라이어","전기포트","텀블러","가습기","제습기","수납박스",
  "운동화","크로스백","레깅스","백팩","선글라스",
  "닭가슴살","견과류","프로틴바","커피원두",
  "강아지사료","고양이간식",
  "원피스","청바지","후드티","패딩","맨투맨",
  "냄비","프라이팬","밀폐용기",
];

// ── 후보 수집 (Trends + 쇼핑 + YouTube) ─
const collectCandidates = async (apiKey) => {
  const [trendsItems, shopResults, ytVideos] = await Promise.all([
    // 1. Google Trends RSS
    fetchGoogleTrends(),
    // 2. 쇼핑 상품명
    Promise.all(["인기 가전제품","인기 뷰티","인기 생활용품","인기 식품","신상품"]
      .map(q => fetchShop(q, 8))),
    // 3. YouTube 최신 영상
    apiKey ? fetchYTRaw("신상 리뷰 언박싱 가전 뷰티", apiKey, 24, "date", 15) : Promise.resolve([]),
  ]);

  // Google Trends → 트래픽 높은 순, 상품 관련만 필터
  const trendKws = trendsItems
    .sort((a,b) => b.traffic - a.traffic)
    .slice(0, 20)
    .flatMap(item => {
      const kws = [];
      // 트렌드 키워드 자체
      if (isTrendProductRelated(item.title)) kws.push(item.title);
      // 뉴스 제목에서 추출
      const newsKws = extractProductKws(item.newsTitles, 2, 7, 1, 3);
      kws.push(...newsKws.filter(k => !STOP.has(k)));
      return kws;
    });

  // 쇼핑 상품명 키워드
  const shopKws = extractProductKws(
    shopResults.flat().map(i => stripHtml(i.title||"")),
    2, 7, 1, 15
  );

  // YouTube 키워드
  const ytKws = extractProductKws(
    (ytVideos||[]).map(v => v.snippet?.title||""),
    2, 7, 1, 10
  );

  // 가중치 합산
  const scoreMap = {};
  for (const kw of FIXED_SEEDS) scoreMap[kw] = (scoreMap[kw]||0) + 1;
  for (const kw of trendKws)    scoreMap[kw] = (scoreMap[kw]||0) + 4; // Trends 최고 가중치
  for (const kw of shopKws)     scoreMap[kw] = (scoreMap[kw]||0) + 3;
  for (const kw of ytKws)       scoreMap[kw] = (scoreMap[kw]||0) + 2;

  const merged = Object.entries(scoreMap)
    .sort((a,b) => b[1]-a[1])
    .map(([kw]) => kw)
    .filter(kw => !STOP.has(kw) && !VERB_END.test(kw));

  return [...new Set(merged)].slice(0, 40);
};
