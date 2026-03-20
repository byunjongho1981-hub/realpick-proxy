/**
 * /api/auto-discover.js
 * Vercel 무료 플랜 10초 타임아웃 기준으로 설계
 * 개별 카테고리: 키워드 5개 × 쇼핑 1개 API = 5회 호출
 * 전체 탐색: 카테고리 15개 × 쇼핑 1개 = 15회 호출 (순차)
 */
const https = require('https');

const CFG = {
  TIMEOUT_MS: 7000,
  RETRY:      1,
  GRADE: { A:70, B:50 },
  CHANGE: { RISING:10, FALLING:-10 },
  SCORE: { shopping:40, blog:20, news:10, cafe:15, trend:15 },
  DEFAULT_PERIOD: 'week',
};

const CAT_ORDER = [
  '50000003','50000002','50000008','50000007','50000006',
  '50000004','50000005','50000000','50000001','50000009',
  '50000010','50000011','50000012','50000013','50000014',
];

const CAT_NAMES = {
  '50000000':'패션의류','50000001':'패션잡화','50000002':'화장품/미용',
  '50000003':'디지털/가전','50000004':'가구/인테리어','50000005':'출산/육아',
  '50000006':'식품','50000007':'스포츠/레저','50000008':'생활/건강',
  '50000009':'도서/음반','50000010':'완구/취미','50000011':'문구/오피스',
  '50000012':'반려동물','50000013':'자동차용품','50000014':'여행/티켓',
};

const CAT_SEEDS = {
  '50000000':['원피스','청바지','맨투맨','후드티','코트'],
  '50000001':['운동화','크로스백','선글라스','벨트','백팩'],
  '50000002':['선크림','토너패드','비타민C세럼','클렌징폼','앰플'],
  '50000003':['무선이어폰','로봇청소기','공기청정기','에어프라이어','스마트워치'],
  '50000004':['스탠딩책상','패브릭소파','간접조명','수납장','침대프레임'],
  '50000005':['기저귀','분유','아기물티슈','유모차','아기띠'],
  '50000006':['단백질쉐이크','닭가슴살','견과류','오트밀','그릭요거트'],
  '50000007':['요가매트','러닝화','폼롤러','덤벨세트','캠핑텐트'],
  '50000008':['마사지건','유산균','전동칫솔','경추베개','족욕기'],
  '50000009':['베스트셀러소설','자기계발서','그림책','독서대','e북리더'],
  '50000010':['레고','보드게임','피규어','퍼즐','드론'],
  '50000011':['무선마우스','기계식키보드','포스트잇','USB허브','모니터암'],
  '50000012':['강아지사료','고양이사료','펫패드','강아지간식','자동급식기'],
  '50000013':['블랙박스','하이패스단말기','차량용충전기','세차용품','카매트'],
  '50000014':['캐리어','여행파우치','목베개','숙박권','여행보험'],
};

// 전체 탐색 캐시 (1시간)
const CACHE = { data:null, ts:null, TTL: 60*60*1000 };
function getCache(){ return CACHE.data && (Date.now()-CACHE.ts < CACHE.TTL) ? CACHE.data : null; }
function setCache(d){ CACHE.data=d; CACHE.ts=Date.now(); }

// ── HTTP
function checkEnv(){
  const miss = ['NAVER_CLIENT_ID','NAVER_CLIENT_SECRET'].filter(k=>!process.env[k]);
  if(miss.length) throw new Error('환경변수 누락: '+miss.join(', '));
}
function httpCall(opts, body){
  return new Promise((resolve,reject)=>{
    const t=setTimeout(()=>reject(new Error('timeout')), CFG.TIMEOUT_MS);
    const req=https.request(opts, res=>{
      let raw='';
      res.on('data',c=>raw+=c);
      res.on('end',()=>{ clearTimeout(t); try{resolve(JSON.parse(raw));}catch{resolve({});} });
    });
    req.on('error',e=>{ clearTimeout(t); reject(e); });
    if(body) req.write(body);
    req.end();
  });
}
const HDR=()=>({'X-Naver-Client-Id':process.env.NAVER_CLIENT_ID,'X-Naver-Client-Secret':process.env.NAVER_CLIENT_SECRET});
function naverGet(path, params){
  return httpCall({hostname:'openapi.naver.com',path:`${path}?${new URLSearchParams(params)}`,method:'GET',headers:HDR()});
}
async function withRetry(fn, n=CFG.RETRY){
  try{return await fn();}catch(e){if(n>0)return withRetry(fn,n-1);return null;}
}

// ── 텍스트 정제
function clean(t){ return String(t||'').replace(/<[^>]+>/g,'').replace(/&\w+;/g,' ').replace(/[^\w가-힣\s]/g,' ').replace(/\s+/g,' ').trim(); }
const AD_RE=/\[광고\]|\[협찬\]|쿠폰|특가|이벤트|당일배송|무료배송|사은품/i;
const SP_RE=/(.)\1{4,}|[\u3040-\u30FF]|[\u4E00-\u9FFF]|https?:\/\//;
function isClean(t){ return t.length>=2 && !AD_RE.test(t) && !SP_RE.test(t); }
function safeNum(v,fb=0){ const n=Number(v); return isNaN(n)?fb:n; }

// ── 쇼핑 검색 1회 (핵심 함수)
async function shopSearch(keyword, catId){
  const params={query:keyword, display:20, sort:'sim'};
  if(catId && catId!=='all') params.category=catId;
  const data=await withRetry(()=>naverGet('/v1/search/shop.json', params));
  if(!data||!Array.isArray(data.items)) return [];
  return data.items
    .map(i=>({title:clean(i.title||''),link:i.link||'',price:safeNum(i.lprice||i.price,0),mallName:i.mallName||''}))
    .filter(i=>isClean(i.title)&&i.price>0);
}

// ── 점수 계산 (고정 공식)
function calcScore(itemCount, maxCount){
  const shopScore  = Math.round((itemCount/maxCount)*CFG.SCORE.shopping);
  const trendScore = Math.round((itemCount/maxCount)*CFG.SCORE.trend);
  const total = Math.min(100, shopScore+trendScore);
  return {
    totalScore: total,
    breakdown:  {shopping:shopScore, trend:trendScore},
    grade:      total>=CFG.GRADE.A?'A':total>=CFG.GRADE.B?'B':'C',
    confidence: itemCount>=10?'high':itemCount>=5?'medium':'low',
  };
}
function judgeT(count){
  if(count===1)  return {status:'new',    changeRate:null, source:'count'};
  if(count>=12)  return {status:'rising', changeRate:null, source:'count'};
  if(count>=6)   return {status:'stable', changeRate:null, source:'count'};
  return                {status:'falling',changeRate:null, source:'count'};
}
function makeSummary(name, score, trend){
  if(score.confidence==='low') return {summary:`${name} — 데이터 부족, 판단 보류`, action:'hold'};
  const action=score.grade==='A'?'shorts':score.grade==='B'?'blog':'compare';
  const lbl={rising:'🔥 급상승',stable:'➡️ 보합',falling:'📉 하락',new:'✨ 신규',unknown:'❓ 보류'};
  return {summary:`${name} ${lbl[trend.status]||''} · ${score.totalScore}점 · ${action.toUpperCase()} 추천`, action};
}

// ── 개별 카테고리 탐색
async function discoverCategory(catId, period){
  const keywords = CAT_SEEDS[catId]||CAT_SEEDS['50000003'];

  // 키워드 5개 병렬 쇼핑 검색
  const results = await Promise.allSettled(keywords.map(kw=>shopSearch(kw,catId)));

  const valid = keywords.map((kw,i)=>{
    const items = results[i].status==='fulfilled' ? results[i].value||[] : [];
    return {kw, items, count:items.length};
  }).filter(c=>c.count>0);

  if(!valid.length) return {candidates:[], apiStatus:{search:'결과 없음'}};

  const maxCount = Math.max(...valid.map(c=>c.count),1);
  const candidates = valid.map(c=>{
    const score = calcScore(c.count, maxCount);
    const trend = judgeT(c.count);
    const {summary,action} = makeSummary(c.kw, score, trend);
    return {
      id:c.kw, name:c.kw, keywords:[c.kw],
      sources:['shopping'], count:c.count,
      score, trend, summary, action,
      sampleItems:c.items.slice(0,3).map(i=>({title:i.title,link:i.link,source:'shopping'})),
    };
  }).sort((a,b)=>b.score.totalScore-a.score.totalScore);

  return {
    candidates: candidates.slice(0,15),
    apiStatus: {search:valid.length+'/'+keywords.length+' 성공'},
  };
}

// ── 전체 탐색 (카테고리 순차 처리)
async function discoverAll(){
  const completed=[], failed=[], allPool=[];

  for(const catId of CAT_ORDER){
    const catName=CAT_NAMES[catId]||catId;
    try{
      const keywords=CAT_SEEDS[catId]||[];
      const topKw=keywords[0]||''; // 카테고리 대표 키워드 1개
      if(!topKw){ failed.push({catId,catName,reason:'키워드 없음'}); continue; }

      const items=await shopSearch(topKw, catId);
      if(!items.length){ failed.push({catId,catName,reason:'검색 결과 없음'}); continue; }

      // 카테고리별 후보 생성
      const score=calcScore(items.length, 20); // 최대 20 기준
      const trend=judgeT(items.length);
      const {summary,action}=makeSummary(topKw, score, trend);
      allPool.push({
        id:catId+'__'+topKw, name:topKw, category:catName, catId,
        keywords:[topKw], sources:['shopping'], count:items.length,
        score, trend, summary, action,
        sampleItems:items.slice(0,3).map(i=>({title:i.title,link:i.link,source:'shopping'})),
      });
      completed.push(catName);
    }catch(e){
      failed.push({catId,catName,reason:e.message||'오류'});
    }
  }

  // 종합 재평가 (동일 고정 공식)
  const globalMax=Math.max(...allPool.map(c=>c.count),1);
  allPool.forEach(c=>{
    const s=calcScore(c.count, globalMax);
    c.score=s;
  });
  allPool.sort((a,b)=>b.score.totalScore-a.score.totalScore);

  return {
    candidates: allPool.slice(0,10),
    apiStatus:{
      completed: completed.length+'/'+CAT_ORDER.length+' 카테고리',
      failed: failed.length?failed.map(f=>f.catName+'('+f.reason+')').join(', '):'없음',
    },
    processLog:{completed, failed},
  };
}

// ── 시드 확장
async function discoverSeed(seedKw, depth){
  const STOP=new Set(['이','가','을','를','의','에','는','은','도','와','과','세트','상품','제품','판매']);
  const r1=await withRetry(()=>naverGet('/v1/search/shop.json',{query:seedKw,display:20,sort:'sim'}));
  const freq={};
  ((r1&&r1.items)||[]).forEach(i=>{
    clean(i.title||'').split(/\s+/).filter(w=>w.length>1&&!STOP.has(w)&&w!==seedKw)
      .forEach(w=>{freq[w]=(freq[w]||0)+1;});
  });
  const related=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([w])=>w);
  const keywords=[seedKw,...related].slice(0,8);

  const results=await Promise.allSettled(keywords.map(kw=>shopSearch(kw,null)));
  const valid=keywords.map((kw,i)=>{
    const items=results[i].status==='fulfilled'?results[i].value||[]:[];
    return {kw,items,count:items.length};
  }).filter(c=>c.count>0);

  if(!valid.length) return {candidates:[],apiStatus:{search:'결과 없음'}};
  const maxCount=Math.max(...valid.map(c=>c.count),1);
  const candidates=valid.map(c=>{
    const score=calcScore(c.count,maxCount);
    const trend=judgeT(c.count);
    const {summary,action}=makeSummary(c.kw,score,trend);
    return {
      id:c.kw, name:c.kw, keywords:[c.kw],
      sources:['shopping'], count:c.count,
      score, trend, summary, action,
      sampleItems:c.items.slice(0,3).map(i=>({title:i.title,link:i.link,source:'shopping'})),
    };
  }).sort((a,b)=>b.score.totalScore-a.score.totalScore);
  return {candidates:candidates.slice(0,15), apiStatus:{search:valid.length+'/'+keywords.length+' 성공'}};
}

// ── MAIN
module.exports=async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();

  try{checkEnv();}catch(e){return res.status(500).json({error:e.message,code:'ENV_ERROR'});}

  const mode  =req.query.mode||'category';
  const period=['today','week','month'].includes(req.query.period)?req.query.period:CFG.DEFAULT_PERIOD;

  try{
    if(mode==='category'){
      const catId=req.query.categoryId||'50000003';

      if(catId==='all'){
        const cached=getCache();
        if(cached) return res.status(200).json({...cached,fromCache:true,cacheAge:Math.round((Date.now()-CACHE.ts)/1000)+'초 전'});
        const {candidates,apiStatus,processLog}=await discoverAll();
        const result={candidates,mode,categoryId:'all',categoryName:'전체',period,total:candidates.length,apiStatus,processLog,updatedAt:new Date().toISOString(),fromCache:false};
        setCache(result);
        return res.status(200).json(result);
      }

      const {candidates,apiStatus}=await discoverCategory(catId,period);
      return res.status(200).json({
        candidates,mode,categoryId:catId,categoryName:CAT_NAMES[catId]||catId,
        period,total:candidates.length,apiStatus,updatedAt:new Date().toISOString(),
      });
    }

    if(mode==='seed'){
      const seedKw=String(req.query.keyword||'').trim().slice(0,30);
      if(!seedKw) return res.status(400).json({error:'키워드를 입력해주세요',code:'NO_KEYWORD'});
      const depth=Math.min(safeNum(req.query.depth,1),2);
      const {candidates,apiStatus}=await discoverSeed(seedKw,depth);
      return res.status(200).json({
        candidates,mode,seedKeyword:seedKw,period,total:candidates.length,
        apiStatus,updatedAt:new Date().toISOString(),
      });
    }

    return res.status(400).json({error:'알 수 없는 mode',code:'INVALID_MODE'});

  }catch(e){
    console.error('[auto-discover]',e.message);
    return res.status(500).json({error:'탐색 중 오류가 발생했습니다.',detail:e.message,code:'SERVER_ERROR'});
  }
};
