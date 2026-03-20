/**
 * /api/auto-discover.js
 * mode=category : 카테고리 인기키워드 → Datalab 변화율 → 점수화
 * mode=rising   : 복수 카테고리 급상승 필터
 * mode=seed     : 시드 키워드 연관어 확장
 */

const https = require('https');

// ════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════
const CFG = {
  TIMEOUT_MS:     9000,
  RETRY:          1,
  MAX_KW_PER_CAT: 15,   // 카테고리당 키워드 수
  MAX_CANDIDATES: 30,
  DATALAB_LIMIT:  8,    // Datalab 호출 상한 (부하 방지)
  SCORE: { shopping:25, blog:20, news:10, cafe:15, trend:30 },
  GRADE: { A:70, B:50 },
  CHANGE: { RISING:10, FALLING:-10 },
  DEFAULT_PERIOD: 'week',
};

// 카테고리 이름 맵
const CAT_NAMES = {
  '50000000':'패션의류','50000001':'패션잡화','50000002':'화장품/미용',
  '50000003':'디지털/가전','50000004':'가구/인테리어','50000005':'출산/육아',
  '50000006':'식품','50000007':'스포츠/레저','50000008':'생활/건강',
};

// 카테고리별 시드 키워드 (API 실패 fallback + 탐색 기반)
const CAT_SEEDS = {
  // 패션의류
  '50000000':[
    '원피스','청바지','맨투맨','후드티','코트',
    '니트','패딩점퍼','슬랙스','레깅스','기능성티셔츠',
    '린넨셔츠','와이드팬츠','집업후드','트레이닝세트','반소매니트',
    '숄더백','미니스커트','롱스커트','크롭티','오버핏셔츠',
  ],
  // 패션잡화
  '50000001':[
    '운동화','크로스백','반지갑','선글라스','벨트',
    '토트백','백팩','슬링백','카드지갑','모자',
    '스니커즈','로퍼','샌들','부츠','청키힐',
    '비니','버킷햇','스카프','머플러','장갑',
  ],
  // 화장품/미용
  '50000002':[
    '선크림','토너패드','비타민C세럼','쿠션팩트','클렌징폼',
    '히알루론산세럼','레티놀크림','아이크림','앰플','에센스',
    '선스틱','워터프루프마스카라','쿠션파운데이션','립틴트','눈썹펜슬',
    '두피케어샴푸','탈모샴푸','염색약','세럼헤어미스트','두피에센스',
    '미백크림','보습크림','각질제거제','클렌징오일','폼클렌저',
  ],
  // 디지털/가전
  '50000003':[
    '무선이어폰','로봇청소기','공기청정기','스마트워치','태블릿',
    '노트북','기계식키보드','무선마우스','웹캠','모니터',
    '블루투스스피커','무선충전기','보조배터리','스마트홈카메라','AI스피커',
    '에어프라이어','전기밥솥','식기세척기','드럼세탁기','스팀다리미',
    '4K모니터','게이밍의자','스탠드조명','USB허브','케이블정리',
  ],
  // 가구/인테리어
  '50000004':[
    '스탠딩책상','패브릭소파','간접조명','수납장','침대프레임',
    '모션데스크','1인소파','북유럽조명','드레스룸수납','원목침대',
    '커튼','블라인드','러그','쿠션','포스터액자',
    '홈카페선반','주방수납','욕실수납','신발장','TV장식장',
    '좌식의자','빈백소파','벽선반','행거','캔들홀더',
  ],
  // 출산/육아
  '50000005':[
    '기저귀','분유','아기물티슈','유모차','유아식판',
    '아기띠','신생아속싸개','아기세제','이유식메이커','젖병소독기',
    '유아학습책','원목장난감','아기체육관매트','아기욕조','유아수영복',
    '어린이비타민','아기로션','아기선크림','영유아보험','키즈자전거',
    '아기카시트','아기모니터','점프수트','아기신발','유아우산',
  ],
  // 식품
  '50000006':[
    '단백질쉐이크','그래놀라','냉동삼겹살','견과류','오트밀',
    '닭가슴살','그릭요거트','저칼로리간식','프로틴바','두부면',
    '홍삼정','프리미엄김','냉동만두','밀키트','즉석카레',
    '아몬드우유','귀리','냉동과일','콤부차','사과식초',
    '제로칼로리음료','프로바이오틱스','콜라겐분말','비타민D','오메가3',
  ],
  // 스포츠/레저
  '50000007':[
    '요가매트','러닝화','등산스틱','헬스장갑','폼롤러',
    '덤벨세트','케틀벨','저항밴드','스쿼트랙','인클라인벤치',
    '등산화','기능성등산바지','방수재킷','트레킹폴','등산배낭',
    '수영고글','아쿠아슈즈','보드복','스키장갑','핫팩',
    '캠핑텐트','캠핑의자','캠핑랜턴','캠핑쿡웨어','해먹',
  ],
  // 생활/건강
  '50000008':[
    '마사지건','안마의자','혈압계','유산균','콜라겐',
    '공기청정기필터','제습기','가습기','살균소독기','UV살균기',
    '면도기','전동칫솔','혀클리너','치실','구강세정기',
    '수면안대','귀마개','경추베개','메모리폼매트리스','전기요',
    '반신욕기','족욕기','눈찜질기','온열매트','혈당계',
  ],
};

// ════════════════════════════════════════
// ENV 검증
// ════════════════════════════════════════
function checkEnv() {
  const miss = ['NAVER_CLIENT_ID','NAVER_CLIENT_SECRET'].filter(k => !process.env[k]);
  if (miss.length) throw new Error('환경변수 누락: ' + miss.join(', '));
}

// ════════════════════════════════════════
// 날짜 범위
// ════════════════════════════════════════
function buildRange(period = 'week') {
  const fmt = d => d.toISOString().slice(0,10);
  const ago = n => { const d = new Date(); d.setDate(d.getDate()-n); return d; };
  const now = new Date();
  if (period==='today')  return { start:fmt(now),    end:fmt(now),   prevStart:fmt(ago(1)),  prevEnd:fmt(ago(1)),  unit:'date' };
  if (period==='month')  return { start:fmt(ago(29)),end:fmt(now),   prevStart:fmt(ago(59)), prevEnd:fmt(ago(30)), unit:'week' };
  return                        { start:fmt(ago(6)), end:fmt(now),   prevStart:fmt(ago(13)), prevEnd:fmt(ago(7)),  unit:'date' };
}

// ════════════════════════════════════════
// HTTP 헬퍼
// ════════════════════════════════════════
function httpCall(opts, body=null) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), CFG.TIMEOUT_MS);
    const req = https.request(opts, res => {
      let raw='';
      res.on('data', c=>raw+=c);
      res.on('end', ()=>{ clearTimeout(t); try{ resolve(JSON.parse(raw)); }catch{ resolve({}); } });
    });
    req.on('error', e=>{ clearTimeout(t); reject(e); });
    if(body) req.write(body);
    req.end();
  });
}

const NAVER_HEADERS = () => ({
  'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
  'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
});

function naverGet(path, params) {
  return httpCall({ hostname:'openapi.naver.com', path:`${path}?${new URLSearchParams(params)}`, method:'GET', headers:NAVER_HEADERS() });
}

function naverPost(path, bodyObj) {
  const body = JSON.stringify(bodyObj);
  return httpCall({
    hostname:'openapi.naver.com', path, method:'POST',
    headers:{ ...NAVER_HEADERS(), 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
  }, body);
}

async function withRetry(fn, n=CFG.RETRY) {
  try{ return await fn(); }
  catch(e){ if(n>0) return withRetry(fn, n-1); return null; }
}

// ════════════════════════════════════════
// 텍스트 정제
// ════════════════════════════════════════
function clean(text='') {
  return String(text).replace(/<[^>]+>/g,'').replace(/&\w+;/g,' ')
    .replace(/[^\w가-힣\s]/g,' ').replace(/\s+/g,' ').trim();
}
const AD_RE   = /\[광고\]|\[협찬\]|쿠폰|특가|이벤트|당일배송|무료배송|사은품/i;
const SPAM_RE = /(.)\1{4,}|[\u3040-\u30FF]|[\u4E00-\u9FFF]|https?:\/\//;
function isClean(t='') { return t.length>=2 && !AD_RE.test(t) && !SPAM_RE.test(t); }
function safeNum(v,fb=0){ const n=Number(v); return isNaN(n)?fb:n; }

// ════════════════════════════════════════
// 카테고리 인기 키워드 수집
// Naver Shopping Insight → 키워드별 ratio 기준 상위 추출
// ════════════════════════════════════════
async function fetchCatKeywords(categoryId) {
  const range = buildRange('week');
  try {
    // Shopping Insight 인기 키워드 API
    const data = await withRetry(() =>
      naverPost('/v1/datalab/shopping/category/keywords', {
        startDate: range.start,
        endDate:   range.end,
        timeUnit:  'date',
        category:  categoryId,
        device:    '',
        gender:    '',
        ages:      [],
      })
    );

    // 응답 구조: { results: [{ title, keyword:[], data:[{period,ratio}] }] }
    const results = data?.results;
    if (!Array.isArray(results) || !results.length) return null;

    // ratio 평균으로 정렬 → 상위 키워드 추출
    const scored = results.map(r => {
      const pts = Array.isArray(r.data) ? r.data : [];
      const avg = pts.length ? pts.reduce((s,p)=>s+safeNum(p.ratio),0)/pts.length : 0;
      // keyword 필드: 배열이거나 문자열
      const kw = Array.isArray(r.keyword) ? r.keyword[0] : (r.title || r.keyword || '');
      return { kw: String(kw).trim(), avg };
    }).filter(x => x.kw.length > 0);

    scored.sort((a,b)=>b.avg-a.avg);
    return scored.slice(0, CFG.MAX_KW_PER_CAT).map(x=>x.kw);

  } catch(e) {
    console.warn('[fetchCatKeywords]', categoryId, e.message);
    return null;
  }
}

// ════════════════════════════════════════
// Datalab 검색량 변화율
// ════════════════════════════════════════
async function getDatalabRate(keyword, range) {
  try {
    const data = await naverPost('/v1/datalab/search', {
      startDate: range.prevStart,
      endDate:   range.end,
      timeUnit:  range.unit,
      keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
    });
    const pts = data?.results?.[0]?.data;
    if (!Array.isArray(pts) || pts.length < 2) return null;
    const half = Math.floor(pts.length/2);
    const avg  = arr => arr.reduce((s,p)=>s+safeNum(p.ratio),0) / (arr.length||1);
    const prev = avg(pts.slice(0, half));
    const cur  = avg(pts.slice(half));
    if (prev===0) return cur>0 ? 100 : null;
    return Math.round(((cur-prev)/prev)*1000)/10;
  } catch { return null; }
}

// ════════════════════════════════════════
// 네이버 검색 4소스
// ════════════════════════════════════════
async function searchAll(keyword) {
  const [sh,bl,nw,ca] = await Promise.allSettled([
    withRetry(()=>naverGet('/v1/search/shop.json',        {query:keyword,display:15,sort:'sim'})),
    withRetry(()=>naverGet('/v1/search/blog.json',        {query:keyword,display:15,sort:'date'})),
    withRetry(()=>naverGet('/v1/search/news.json',        {query:keyword,display:10,sort:'date'})),
    withRetry(()=>naverGet('/v1/search/cafearticle.json', {query:keyword,display:10})),
  ]);
  const get  = r => r.status==='fulfilled' ? r.value : null;
  const norm = (d, src) => {
    if (!d?.items?.length) return [];
    return d.items
      .map(i=>({ source:src, title:clean(i.title||''), link:i.link||'', price:safeNum(i.lprice||i.price,0), pubDate:i.pubdate||i.postdate||'' }))
      .filter(i=>isClean(i.title) && (src!=='shopping'||i.price>0));
  };
  return {
    items:[...norm(get(sh),'shopping'),...norm(get(bl),'blog'),...norm(get(nw),'news'),...norm(get(ca),'cafe')],
    status:{ shopping:sh.status, blog:bl.status, news:nw.status, cafe:ca.status },
  };
}

// ════════════════════════════════════════
// 시드 키워드 연관어 확장
// ════════════════════════════════════════
async function expandSeed(seedKw, depth=1) {
  const STOP = new Set(['이','가','을','를','의','에','는','은','도','와','과','및','세트','상품','제품','판매','구매','추천','리뷰','후기']);
  const r1   = await withRetry(()=>naverGet('/v1/search/shop.json',{query:seedKw,display:20,sort:'sim'}));
  const freq = {};
  (r1?.items||[]).forEach(i=>{
    clean(i.title||'').split(/\s+/).filter(w=>w.length>1&&!STOP.has(w)&&w!==seedKw).forEach(w=>{
      freq[w]=(freq[w]||0)+1;
    });
  });
  const related = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([w])=>w);
  let expanded  = [seedKw, ...related];

  if (depth>=2 && related.length) {
    const d2 = await Promise.allSettled(related.slice(0,3).map(kw=>withRetry(()=>naverGet('/v1/search/shop.json',{query:kw,display:10,sort:'sim'}))));
    d2.forEach(r=>{
      if(r.status==='fulfilled'&&r.value?.items){
        r.value.items.forEach(i=>{
          clean(i.title||'').split(/\s+/).filter(w=>w.length>1&&!STOP.has(w)).forEach(w=>{ if(!expanded.includes(w)) expanded.push(w); });
        });
      }
    });
  }
  return [...new Set(expanded)].slice(0,15);
}

// ════════════════════════════════════════
// 점수 계산
// ════════════════════════════════════════
function calcScore(items, maxCount) {
  const W   = CFG.SCORE;
  const tot = items.length || 1;
  const cnt = src => items.filter(i=>i.source===src).length;
  const breakdown = {
    shopping: Math.round((cnt('shopping')/tot)*W.shopping),
    blog:     Math.round((cnt('blog')    /tot)*W.blog),
    news:     Math.round((cnt('news')    /tot)*W.news),
    cafe:     Math.round((cnt('cafe')    /tot)*W.cafe),
    trend:    Math.round((items.length/maxCount)*W.trend),
  };
  const totalScore = Math.min(100, Object.values(breakdown).reduce((a,b)=>a+b,0));
  const srcs = [...new Set(items.map(i=>i.source))];
  return {
    totalScore,
    breakdown,
    grade:      totalScore>=CFG.GRADE.A?'A':totalScore>=CFG.GRADE.B?'B':'C',
    confidence: srcs.length>=3?'high':srcs.length>=2?'medium':'low',
  };
}

function judgeT(count, rate) {
  if(rate!==null&&rate!==undefined){
    if(rate>=CFG.CHANGE.RISING)  return {status:'rising',  changeRate:rate, source:'datalab'};
    if(rate<=CFG.CHANGE.FALLING) return {status:'falling', changeRate:rate, source:'datalab'};
    return                              {status:'stable',  changeRate:rate, source:'datalab'};
  }
  if(count===1) return {status:'new',    changeRate:null, source:'count'};
  if(count>=8)  return {status:'rising', changeRate:null, source:'count'};
  if(count>=4)  return {status:'stable', changeRate:null, source:'count'};
  return               {status:'falling',changeRate:null, source:'count'};
}

function makeSummary(name, score, trend) {
  if(score.confidence==='low') return {summary:`${name} — 데이터 부족, 판단 보류`, action:'hold'};
  const action = score.grade==='A'&&score.confidence==='high'?'shorts':score.grade==='A'?'blog':score.grade==='B'?'blog':'compare';
  const rateText = trend.source==='datalab'&&trend.changeRate!=null?` (${trend.changeRate>0?'+':''}${trend.changeRate}%)`:'';
  const labels   = {rising:'🔥 급상승',stable:'➡️ 보합',falling:'📉 하락',new:'✨ 신규',unknown:'❓ 보류'};
  return {summary:`${name} ${labels[trend.status]||''}${rateText} · ${Math.round(score.totalScore)}점 · ${action.toUpperCase()} 추천`, action};
}

// ════════════════════════════════════════
// 키워드 배열 → 후보 빌드 (공통)
// ════════════════════════════════════════
async function buildCandidates(keywords, range, filterFn=null) {
  // ① 중복 제거
  const unique = [...new Set(keywords.map(k=>k.trim()).filter(Boolean))].slice(0, 40);
  if(!unique.length) return {candidates:[], apiStatus:{}};

  // ② 검색 병렬
  const searches = await Promise.allSettled(unique.map(kw=>searchAll(kw)));

  // ③ Datalab 변화율 (상위 DATALAB_LIMIT개)
  const rates = {};
  await Promise.allSettled(
    unique.slice(0, CFG.DATALAB_LIMIT).map(async kw=>{
      rates[kw] = await getDatalabRate(kw, range);
    })
  );

  // ④ 유효 후보만 추출
  const valid = unique.map((kw,i)=>{
    const r = searches[i];
    const items = r.status==='fulfilled'?(r.value?.items||[]):[];
    return {kw, items, count:items.length};
  }).filter(c=>c.count>0);

  if(!valid.length) return {candidates:[], apiStatus:{datalab:'skipped'}};

  const maxCount = Math.max(...valid.map(c=>c.count), 1);

  // ⑤ 점수·트렌드·요약
  let candidates = valid.map(c=>{
    const score = calcScore(c.items, maxCount);
    const trend = judgeT(c.count, rates[c.kw]??null);
    const {summary,action} = makeSummary(c.kw, score, trend);
    return {
      id: c.kw, name:c.kw, keywords:[c.kw],
      sources:[...new Set(c.items.map(i=>i.source))],
      count:c.count, score, trend, summary, action,
      sampleItems:c.items.slice(0,3).map(i=>({title:i.title,link:i.link,source:i.source})),
    };
  });

  // ⑥ 외부 필터 적용
  if(filterFn) candidates = candidates.filter(filterFn);

  return {
    candidates: candidates.sort((a,b)=>b.score.totalScore-a.score.totalScore).slice(0,CFG.MAX_CANDIDATES),
    apiStatus: {
      search: searches.filter(r=>r.status==='fulfilled').length + '/' + unique.length + ' 성공',
      datalab: Object.values(rates).some(v=>v!==null)?'fulfilled':'skipped',
    },
  };
}

// ════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();

  try{ checkEnv(); }
  catch(e){ return res.status(500).json({error:e.message,code:'ENV_ERROR'}); }

  const mode   = req.query.mode || 'category';
  const period = ['today','week','month'].includes(req.query.period)?req.query.period:CFG.DEFAULT_PERIOD;
  const range  = buildRange(period);

  try {

    // ── MODE 1: 카테고리 자동탐색
    if(mode==='category') {
      const catId = req.query.categoryId || '50000003';

      // Shopping Insight에서 인기 키워드 수집
      let keywords = await fetchCatKeywords(catId);

      // API 실패 시 카테고리별 시드로 fallback
      if(!keywords||!keywords.length) {
        console.warn('[category] API 실패, seed fallback:', catId);
        keywords = CAT_SEEDS[catId] || CAT_SEEDS['50000003'];
      }

      console.log(`[category] ${CAT_NAMES[catId]} 키워드 ${keywords.length}개:`, keywords);

      const {candidates, apiStatus} = await buildCandidates(keywords, range);
      return res.status(200).json({
        candidates, mode, categoryId:catId,
        categoryName: CAT_NAMES[catId]||catId,
        keywords, period, total:candidates.length,
        apiStatus, updatedAt:new Date().toISOString(),
      });
    }

    // ── MODE 2: 급상승 모니터링
    if(mode==='rising') {
      const cats      = (req.query.categories||'50000003,50000002,50000008').split(',').filter(Boolean);
      const threshold = safeNum(req.query.threshold, CFG.CHANGE.RISING);

      // 카테고리별 키워드 수집 → 병합 → 중복 제거
      const kwSets = await Promise.allSettled(cats.map(c=>fetchCatKeywords(c)));
      let allKws   = [];
      kwSets.forEach((r,i)=>{
        const kws = r.status==='fulfilled'&&r.value ? r.value : (CAT_SEEDS[cats[i]]||[]);
        allKws.push(...kws);
      });
      // 중복 제거 (핵심)
      allKws = [...new Set(allKws.map(k=>k.trim()).filter(Boolean))];
      console.log(`[rising] 카테고리 ${cats.length}개, 중복제거 후 키워드 ${allKws.length}개`);

      const {candidates, apiStatus} = await buildCandidates(
        allKws, range,
        c => c.trend?.changeRate !== null && c.trend?.changeRate >= threshold
      );
      return res.status(200).json({
        candidates, mode, threshold, period,
        total:candidates.length, apiStatus, updatedAt:new Date().toISOString(),
      });
    }

    // ── MODE 3: 시드 키워드 확장
    if(mode==='seed') {
      const seedKw = String(req.query.keyword||'').trim().slice(0,30);
      if(!seedKw) return res.status(400).json({error:'키워드를 입력해주세요',code:'NO_KEYWORD'});
      const depth = Math.min(safeNum(req.query.depth,1),2);

      const keywords = await expandSeed(seedKw, depth);
      console.log(`[seed] "${seedKw}" 확장 키워드 ${keywords.length}개:`, keywords);

      const {candidates, apiStatus} = await buildCandidates(keywords, range);
      return res.status(200).json({
        candidates, mode, seedKeyword:seedKw,
        expandedKeywords:keywords, period,
        total:candidates.length, apiStatus, updatedAt:new Date().toISOString(),
      });
    }

    return res.status(400).json({error:'알 수 없는 mode', code:'INVALID_MODE'});

  } catch(e) {
    console.error('[auto-discover]', e.message);
    return res.status(500).json({error:'탐색 중 오류가 발생했습니다.', detail:e.message, code:'SERVER_ERROR'});
  }
};
