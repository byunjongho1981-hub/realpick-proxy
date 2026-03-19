// v5.0 - 실시간 추천 / 안정 추천 분리
const safe    = (fn, fb=0) => { try { const v=fn(); return (v===null||v===undefined||isNaN(v)||!isFinite(v))?fb:v; } catch { return fb; } };
const safeDiv = (a, b, fb=0) => (!b||isNaN(b)||!isFinite(b)) ? fb : safe(()=>a/b, fb);
const stripHtml = s => (s||"").replace(/<[^>]*>/g,"").replace(/&[^;]+;/g," ").trim();

// ══════════════════════════════════════
// API
// ══════════════════════════════════════
const fetchNaver = async (type, query, display=20) => {
  try {
    const res = await fetch(`/api/naver-search?query=${encodeURIComponent(query)}&type=${type}&display=${display}`);
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch { return []; }
};
const fetchShop = async (query, display=10) => {
  try {
    const res = await fetch(`/api/naver-shop?query=${encodeURIComponent(query)}&display=${display}`);
    if (!res.ok) return [];
    return (await res.json()).items || [];
  } catch { return []; }
};

// ── YouTube: 모드별 수집 ──────────────
// realtime: order=date (최신순) + 12h 윈도우
// stable:   order=viewCount + 48h 윈도우
const fetchYT = async (query, apiKey, mode="stable", maxResults=10) => {
  try {
    const hours  = mode==="realtime" ? 12 : 48;
    const order  = mode==="realtime" ? "date" : "viewCount";
    const published = new Date(Date.now()-hours*60*60*1000).toISOString();
    const sr = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=id&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&order=${order}&regionCode=KR&relevanceLanguage=ko&publishedAfter=${published}&key=${apiKey}`
    );
    if (!sr.ok) return [];
    const sd = await sr.json();
    if (sd.error || !sd.items?.length) {
      // realtime에서 결과 없으면 24h로 재시도
      if (mode==="realtime") {
        const pub24 = new Date(Date.now()-24*60*60*1000).toISOString();
        const sr2 = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=id&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&order=date&regionCode=KR&relevanceLanguage=ko&publishedAfter=${pub24}&key=${apiKey}`
        );
        if (!sr2.ok) return [];
        const sd2 = await sr2.json();
        if (sd2.error || !sd2.items?.length) return [];
        const ids2 = sd2.items.map(i=>i.id.videoId).join(",");
        const vr2 = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&fields=items(id,snippet(title,publishedAt),statistics)&id=${ids2}&key=${apiKey}`
        );
        if (!vr2.ok) return [];
        return (await vr2.json()).items || [];
      }
      return [];
    }
    const ids = sd.items.map(i=>i.id.videoId).join(",");
    const vr = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&fields=items(id,snippet(title,publishedAt),statistics)&id=${ids}&key=${apiKey}`
    );
    if (!vr.ok) return [];
    return (await vr.json()).items || [];
  } catch { return []; }
};

// ── 고정 시드 ─────────────────────────
const FIXED_SEEDS = [
  // ── 패션 의류 ──────────────────────
  "원피스","청바지","티셔츠","후드티","맨투맨","니트","코트","패딩","점퍼","자켓",
  "레깅스","트레이닝복","스커트","블라우스","셔츠","슬랙스","반바지","수영복",
  // ── 패션 잡화 ──────────────────────
  "운동화","스니커즈","구두","샌들","슬리퍼","부츠","로퍼",
  "백팩","크로스백","토트백","숄더백","클러치","지갑","벨트",
  "시계","선글라스","모자","목도리","장갑","스카프",
  "목걸이","귀걸이","반지","팔찌","브로치",
  // ── 화장품 / 미용 ───────────────────
  "선크림","세럼","앰플","에센스","크림","토너","로션","미스트",
  "파운데이션","쿠션","비비크림","컨실러","프라이머",
  "립스틱","립글로스","립밤","아이섀도","마스카라","아이라이너","블러셔",
  "마스크팩","클렌징폼","클렌징오일","스크럽","필링젤",
  "샴푸","린스","트리트먼트","두피앰플","헤어오일","헤어에센스",
  "바디로션","바디워시","핸드크림","풋크림","제모크림",
  "향수","데오도란트",
  // ── 디지털 / 가전 ───────────────────
  "노트북","태블릿","스마트폰","갤럭시","아이폰","아이패드",
  "무선이어폰","블루투스이어폰","헤드폰","블루투스스피커","사운드바",
  "스마트워치","스마트밴드","보조배터리","고속충전기","무선충전기",
  "공기청정기","로봇청소기","무선청소기","스팀청소기","에어컨","제습기","가습기",
  "TV","모니터","빔프로젝터","웹캠","키보드","마우스","마우스패드",
  "냉장고","세탁기","건조기","식기세척기","전자레인지","에어프라이어",
  "전기밥솥","전기포트","믹서기","착즙기","커피머신","토스터","전기그릴",
  "선풍기","온풍기","전기히터","전기장판","안마기","안마의자",
  "카메라","미러리스","액션캠","드론","삼각대",
  "공유기","외장하드","USB허브","케이블",
  // ── 가구 / 인테리어 ─────────────────
  "소파","침대","매트리스","베개","이불","침구세트",
  "책상","의자","컴퓨터책상","게이밍의자","수납장","책장","옷장","행거",
  "식탁","의자","커피테이블","선반","벽선반",
  "커튼","블라인드","러그","카펫","조명","LED조명","스탠드",
  "벽지","데코스티커","액자","화분","인조식물",
  "욕실선반","수건걸이","변기커버","샤워기","비데",
  "방향제","디퓨저","향초","가습기",
  // ── 출산 / 육아 ─────────────────────
  "유모차","아기띠","카시트","아기침대","범퍼침대",
  "젖병","분유","이유식","아기과자","유아간식",
  "기저귀","물티슈","아기로션","아기샴푸","아기비누",
  "아기장난감","유아장난감","블록","모빌","바운서",
  "유아의류","아기의류","임산부의류","수유브라",
  "육아용품","유아가구","아기욕조",
  // ── 식품 ────────────────────────────
  "닭가슴살","소고기","돼지고기","연어","고등어","새우","오징어",
  "쌀","잡곡","현미","귀리","퀴노아",
  "라면","파스타","국수","즉석밥","즉석식품","냉동식품",
  "커피원두","커피믹스","녹차","홍차","허브티","보이차",
  "우유","두유","오트밀크","요거트","그릭요거트","치즈","버터",
  "과자","초콜릿","사탕","젤리","시리얼","그래놀라",
  "견과류","아몬드","호두","캐슈넛","프로틴바","에너지바",
  "김치","된장","고추장","간장","참기름","올리브오일",
  "건강즙","홍삼","비타민","유산균","오메가3","콜라겐","단백질보충제","프로틴",
  // ── 스포츠 / 레저 ───────────────────
  "러닝화","등산화","트레킹화","자전거","킥보드","인라인스케이트",
  "요가매트","폼롤러","덤벨","바벨","밴드운동","스피닝바이크","런닝머신",
  "등산복","기능성티셔츠","압박스타킹","스포츠양말","스포츠브라",
  "골프채","골프공","골프장갑","골프백",
  "테니스라켓","배드민턴라켓","축구공","농구공",
  "캠핑텐트","캠핑의자","캠핑테이블","캠핑매트","침낭","랜턴","버너",
  "낚시대","루어","낚시릴","낚시용품",
  "수영복","수경","수영모","물안경","오리발","스쿠버용품",
  // ── 생활 / 건강 ─────────────────────
  "세제","섬유유연제","주방세제","욕실세제","변기세제","곰팡이제거제",
  "청소포","극세사걸레","밀대청소기","물걸레청소기",
  "수납함","수납박스","정리함","행거바","옷걸이",
  "텀블러","보온병","도시락통","밀폐용기","지퍼백",
  "냄비","프라이팬","에그팬","그릴팬","압력밥솥","찜기","도마","칼세트",
  "마스크","손소독제","체온계","혈압계","혈당계","좌욕기",
  "영양제","홍삼","오메가3","루테인","마그네슘","아연","철분",
  "파스","두통약","소화제","피로회복제",
  // ── 반려동물 ────────────────────────
  "강아지사료","고양이사료","강아지간식","고양이간식","강아지껌",
  "강아지패드","고양이모래","고양이화장실","강아지울타리","고양이캣타워",
  "강아지장난감","고양이장난감","강아지옷","고양이옷",
  "강아지샴푸","고양이샴푸","강아지영양제","고양이영양제",
  "강아지목줄","리드줄","하네스","이동장","펫카시트",
  // ── 완구 / 취미 ─────────────────────
  "레고","블록장난감","피규어","다이캐스트","프라모델",
  "보드게임","카드게임","퍼즐","루빅스큐브",
  "RC카","드론","미니카","기차장난감",
  "인형","봉제인형","바비인형","마그네틱장난감",
  "색연필","스케치북","수채화","아크릴물감","캔버스","오일파스텔",
  "독서대","만년필","고급볼펜","노트","다이어리",
  // ── 도서 / 음반 ─────────────────────
  "자기계발서","경제경영","소설","영어회화","코딩책",
  "블루투스레코드플레이어","LP판","CD",
];
const collectSeeds = async () => {
  let extra = [];
  try {
    const shopItems = await Promise.all(["인기 가전","인기 뷰티","인기 생활"].map(q=>fetchShop(q,5)));
    const STOP = new Set(["최고","인기","추천","할인","특가","무료","배송","신상","정품","공식"]);
    const freq = {};
    shopItems.flat().forEach(i=>{
      (stripHtml(i.title).match(/[가-힣]{2,6}/g)||[])
        .filter(w=>!STOP.has(w)).forEach(w=>{ freq[w]=(freq[w]||0)+1; });
    });
    extra = Object.entries(freq).filter(([,c])=>c>=2).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k])=>k);
  } catch {}
  return [...new Set([...FIXED_SEEDS, ...extra])].slice(0,28);
};

// ══════════════════════════════════════
// 트렌드 분석 (모드별)
// ══════════════════════════════════════
const analyzeTrend = (videos, mode="stable") => {
  if (!videos.length) return {
    score:0, velocity:0, accel:1, status:"유지",
    avgViews:0, hasData:false, freshCount:0, engagementRate:0
  };
  const now = Date.now();
  const enriched = videos.map(v => {
    const views    = safe(()=>parseInt(v.statistics?.viewCount)||0);
    const likes    = safe(()=>parseInt(v.statistics?.likeCount)||0);
    const comments = safe(()=>parseInt(v.statistics?.commentCount)||0);
    const pub      = v.snippet?.publishedAt;
    const hoursAgo = pub ? Math.max(0.1, safe(()=>(now-new Date(pub))/3600000, 1)) : 24;
    const engagement = views + likes*5 + comments*10; // 실시간은 참여도 가중치 높임
    const velocity   = safeDiv(engagement, hoursAgo, 0);
    const engRate    = safeDiv(likes+comments, Math.max(1,views), 0) * 100;
    return { views, likes, comments, velocity, hoursAgo, engRate };
  });

  const threshold = mode==="realtime" ? 12 : 24;
  const fresh  = enriched.filter(v=>v.hoursAgo<=threshold);
  const mature = enriched.filter(v=>v.hoursAgo>threshold);

  const avgViews     = safe(()=>enriched.reduce((s,v)=>s+v.views,0)/enriched.length, 0);
  const avgVelocity  = safe(()=>enriched.reduce((s,v)=>s+v.velocity,0)/enriched.length, 0);
  const avgEngRate   = safe(()=>enriched.reduce((s,v)=>s+v.engRate,0)/enriched.length, 0);
  const trendScore   = Math.min(100, safe(()=>Math.log10(avgVelocity+1)/Math.log10(10000)*100, 0));

  const fv = fresh.length  ? safe(()=>fresh.reduce((s,v)=>s+v.velocity,0)/fresh.length,  0) : 0;
  const mv = mature.length ? safe(()=>mature.reduce((s,v)=>s+v.velocity,0)/mature.length, 1) : 1;
  const accel  = Math.min(5, safeDiv(fv, Math.max(1,mv), 1));

  // 4단계 상태 분류
  let status;
  if      (accel>=2.5)                          status = "급상승";
  else if (accel>=1.5 || (fresh.length>=2 && fv>mv)) status = "상승 시작";
  else if (accel>=0.8)                          status = "유지";
  else                                           status = "하락 가능";

  return {
    score: Math.round(trendScore),
    velocity: safe(()=>Math.round(accel*10)/10, 1),
    accel, status,
    avgViews: Math.round(avgViews),
    avgEngRate: Math.round(avgEngRate*10)/10,
    hasData: true,
    freshCount: fresh.length,
    freshAvgHours: fresh.length ? Math.round(fresh.reduce((s,v)=>s+v.hoursAgo,0)/fresh.length*10)/10 : 0,
  };
};

// ══════════════════════════════════════
// 구매 의도
// ══════════════════════════════════════
const INTENT = {
  purchase: ["구매","사다","샀","구입","주문","결제","살까","사야","구매후기","구입했","장바구니"],
  compare:  ["비교","vs","어떤게","뭐가","차이","고민","선택","골라","추천"],
  price:    ["최저가","할인","쿠폰","세일","가격","얼마","저렴","가성비","특가","무료배송"],
  review:   ["후기","리뷰","사용기","써봤","써본","솔직","진짜","실제"],
};
const calcPurchaseIntent = (items) => {
  if (!items.length) return 0;
  const text  = items.map(i=>stripHtml(i.title+" "+(i.description||""))).join(" ");
  const total = Math.max(1, (text.match(/[가-힣]+/g)||[]).length);
  const hits =
    INTENT.purchase.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*3 +
    INTENT.compare.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*2 +
    INTENT.price.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*2 +
    INTENT.review.reduce((c,w)=>c+(text.match(new RegExp(w,"gi"))||[]).length,0)*1;
  return Math.min(100, Math.round(safeDiv(hits, total, 0)*80));
};

// ══════════════════════════════════════
// 쇼핑 분석
// ══════════════════════════════════════
const analyzeShop = (items) => {
  if (!items.length) return { exists:false, score:0, avgPrice:0, minPrice:0, reviewTotal:0, top:null };
  const prices  = items.map(s=>parseInt(s.lprice)||0).filter(p=>p>0);
  const reviews = items.map(s=>parseInt(s.reviewCount)||0);
  const avgPrice    = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
  const minPrice    = prices.length ? Math.min(...prices) : 0;
  const reviewTotal = reviews.reduce((a,b)=>a+b,0);
  const priceScore  = avgPrice>=3000 && avgPrice<=1000000
    ? 100 - safe(()=>Math.abs(Math.log10(avgPrice)-Math.log10(50000))/Math.log10(100)*50, 50) : 20;
  const reviewScore = Math.min(100, safe(()=>Math.log10(reviewTotal+1)/Math.log10(10000)*100, 0));
  const score = Math.round(priceScore*0.5 + reviewScore*0.5);
  const topItem = [...items].sort((a,b)=>(parseInt(b.reviewCount)||0)-(parseInt(a.reviewCount)||0))[0];
  return {
    exists:true, score, avgPrice, minPrice, reviewTotal, count:items.length,
    top: topItem ? { name:stripHtml(topItem.title), price:parseInt(topItem.lprice)||0, mall:topItem.mallName, url:topItem.link } : null
  };
};

const calcCompetition = (docCount, avgViews, shopCount) => {
  const d = Math.min(100, safe(()=>Math.log10(safeDiv(docCount,Math.max(1,avgViews),0)+1)/Math.log10(10)*100, 50));
  const s = Math.min(100, safe(()=>shopCount/20*100, 50));
  return Math.round(d*0.6 + s*0.4);
};

// ══════════════════════════════════════
// 점수 공식 분리
// ══════════════════════════════════════

// 안정 추천: 균형 가산식
const calcFinalScore = (trend, purchase, shop, competition) => {
  const compScore = Math.max(0, 100-competition);
  let score;
  if (trend.hasData && trend.score > 0) {
    score = trend.score*0.30 + purchase*0.30 + shop.score*0.25 + compScore*0.15;
    if (trend.status==="급상승")      score = Math.min(100, score*1.3);
    else if (trend.status==="상승 시작") score = Math.min(100, score*1.15);
  } else {
    score = purchase*0.45 + shop.score*0.40 + compScore*0.15;
  }
  return Math.round(Math.min(100, Math.max(0, score)));
};

// 실시간 추천: 속도·참여도 중심
const calcRealtimeScore = (trend, purchase, shop, competition) => {
  if (!trend.hasData) return 0; // 실시간은 YouTube 데이터 필수

  const compScore   = Math.max(0, 100-competition);
  const speedScore  = Math.min(100, safe(()=>trend.velocity/3*100, 0)); // 가속도 0~3 → 0~100
  const engScore    = Math.min(100, trend.avgEngRate*20);               // 참여율 → 0~100
  const freshBonus  = trend.freshCount>=2 ? 15 : trend.freshCount>=1 ? 8 : 0;

  // 실시간: 속도35% + 참여도25% + 구매의도20% + 쇼핑15% + 경쟁역수5%
  let score = speedScore*0.35 + engScore*0.25 + purchase*0.20 + shop.score*0.15 + compScore*0.05;
  score = Math.min(100, score + freshBonus);

  // 상태 배율
  if      (trend.status==="급상승")      score = Math.min(100, score*1.4);
  else if (trend.status==="상승 시작")   score = Math.min(100, score*1.2);
  else if (trend.status==="하락 가능")   score = score*0.6;

  return Math.round(Math.min(100, Math.max(0, score)));
};

// ── 타이밍 ────────────────────────────
const getTiming = (score, status, mode) => {
  if (mode==="realtime") {
    if (status==="급상승"   && score>=50) return { label:"⚡ 지금 당장", color:"#ffd700" };
    if (status==="상승 시작" && score>=30) return { label:"🚀 진입 시작", color:"#ff8800" };
    if (score>=15)                         return { label:"👀 모니터링", color:"#4488ff" };
    return { label:"⏸ 대기", color:"#555" };
  }
  if (status==="급상승"   && score>=50) return { label:"⚡ 지금 당장", color:"#ffd700" };
  if (status==="상승 시작" && score>=35) return { label:"✅ 진입 적기", color:"#03c75a" };
  if (score>=25)                         return { label:"📊 검토 필요", color:"#ff8800" };
  return { label:"⏰ 관망", color:"#888" };
};

// ── 실시간 한줄 설명 ─────────────────
const buildRealtimeReason = (trend, purchase, shop) => {
  if (trend.status==="급상승")
    return `최근 ${trend.freshAvgHours}h 내 영상 ${trend.freshCount}개, 가속도 ${trend.velocity}x 급상승 중`;
  if (trend.status==="상승 시작")
    return `업로드 직후 빠른 반응 감지 — 참여율 ${trend.avgEngRate}%`;
  if (purchase>=50)
    return `구매 의도 ${purchase}% + 쇼핑 리뷰 ${(shop.reviewTotal||0).toLocaleString()}개`;
  return `쇼핑 데이터 기반 안정 상품 (평균가 ${(shop.avgPrice||0).toLocaleString()}원)`;
};

const buildStableReason = (trend, purchase, competition, shop) => {
  const parts = [];
  if (trend.status==="급상승")      parts.push(`급상승 (가속도 ${trend.velocity}x)`);
  else if (trend.status==="상승 시작") parts.push(`상승 시작`);
  else if (!trend.hasData)           parts.push(`쇼핑·검색 데이터 기반`);
  if (purchase>=60)  parts.push(`구매 의도 ${purchase}% — 높음`);
  else if (purchase>=25) parts.push(`구매 의도 ${purchase}%`);
  if (competition<30) parts.push(`블루오션`);
  else if (competition<60) parts.push(`경쟁 보통`);
  if (shop.reviewTotal>50) parts.push(`리뷰 ${shop.reviewTotal.toLocaleString()}개`);
  if (shop.avgPrice>0) parts.push(`평균가 ${shop.avgPrice.toLocaleString()}원`);
  return parts.join(" · ") || "복합 데이터 기반";
};

// ══════════════════════════════════════
// 메인 파이프라인
// ══════════════════════════════════════
export const runAutoRecommend = async (apiKey, onProgress, mode="stable") => {
  if (onProgress) onProgress(3, mode==="realtime" ? "🔥 실시간 데이터 수집 중..." : "💰 안정 추천 분석 중...");

  const seeds = await collectSeeds();
  if (onProgress) onProgress(10, `${seeds.length}개 키워드 분석 시작...`);

  const results = [];

  for (let i=0; i<seeds.length; i++) {
    const kw  = seeds[i];
    const pct = 10 + Math.round((i/seeds.length)*86);
    if (onProgress) onProgress(pct, `"${kw}" 분석 중... (${i+1}/${seeds.length})`);

    try {
      const [videos, blogs, news, cafes, shops] = await Promise.all([
        apiKey ? fetchYT(kw, apiKey, mode, 10) : Promise.resolve([]),
        fetchNaver("blog",        kw, 15),
        fetchNaver("news",        kw, 10),
        fetchNaver("cafearticle", kw, 10),
        fetchShop(kw, 10),
      ]);

      const allDocs     = [...blogs, ...news, ...cafes];
      const trend       = analyzeTrend(videos, mode);
      const purchase    = calcPurchaseIntent(allDocs);
      const shop        = analyzeShop(shops);
      const competition = calcCompetition(allDocs.length, trend.avgViews, shops.length);
      const finalScore  = calcFinalScore(trend, purchase, shop, competition);
      const realtimeScore = calcRealtimeScore(trend, purchase, shop, competition);

      // 쇼핑 데이터 없으면 제외
      if (!shop.exists) continue;

      // 실시간 모드: YouTube 데이터 필수 + 하락 가능 제외
      if (mode==="realtime") {
        if (!trend.hasData) continue;
        if (trend.status==="하락 가능") continue;
        if (realtimeScore < 5) continue;
      }

      const score   = mode==="realtime" ? realtimeScore : finalScore;
      const timing  = getTiming(score, trend.status, mode);
      const reason  = mode==="realtime"
        ? buildRealtimeReason(trend, purchase, shop)
        : buildStableReason(trend, purchase, competition, shop);

      results.push({
        keyword:kw, finalScore, realtimeScore, trend, purchase,
        competition, shop, timing, reason, mode,
      });
    } catch { continue; }
  }

  if (onProgress) onProgress(100, "분석 완료");
  if (!results.length) {
    if (mode==="realtime") throw new Error("현재 급상승 중인 항목이 없습니다. 안정 추천을 이용해주세요.");
    throw new Error("분석 결과가 없습니다. 잠시 후 다시 시도해주세요.");
  }

  const sortKey = mode==="realtime" ? "realtimeScore" : "finalScore";
  return results.sort((a,b)=>b[sortKey]-a[sortKey]).slice(0, mode==="realtime" ? 5 : 10);
};
