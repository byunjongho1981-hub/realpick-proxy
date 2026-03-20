var https = require('https');

var TIMEOUT = 4000;
var GRADE_A = 70, GRADE_B = 50;

var CAT_NAMES = {
  '50000000':'패션의류','50000001':'패션잡화','50000002':'화장품/미용',
  '50000003':'디지털/가전','50000004':'가구/인테리어','50000005':'출산/육아',
  '50000006':'식품','50000007':'스포츠/레저','50000008':'생활/건강',
  '50000009':'도서/음반','50000010':'완구/취미','50000011':'문구/오피스',
  '50000012':'반려동물','50000013':'자동차용품','50000014':'여행/티켓'
};

var CAT_ORDER = [
  '50000003','50000002','50000008','50000007','50000006',
  '50000004','50000005','50000000','50000001','50000009',
  '50000010','50000011','50000012','50000013','50000014'
];

var CAT_SEEDS = {
  '50000000':['원피스','청바지','맨투맨','후드티','코트','니트','가디건','슬랙스','반팔티','집업','숏패딩','트렌치코트','레깅스','와이드팬츠','블라우스','셔츠','조거팬츠','롱스커트','미니스커트','오버핏티'],
  '50000001':['운동화','크로스백','선글라스','벨트','백팩','토트백','스니커즈','샌들','로퍼','부츠','숄더백','클러치','모자','비니','머플러','장갑','지갑','키링','양말','슬리퍼'],
  '50000002':['선크림','토너패드','비타민C세럼','클렌징폼','앰플','수분크림','에센스','마스크팩','미셀라워터','BB크림','파운데이션','립밤','아이크림','클렌징오일','페이셜오일','각질제거제','프라이머','쿠션팩트','립틴트','눈썹펜슬'],
  '50000003':['무선이어폰','로봇청소기','공기청정기','에어프라이어','스마트워치','노트북','태블릿','스마트폰','블루투스스피커','게이밍마우스','외장하드','SSD','웹캠','모니터','기계식키보드','무선충전기','보조배터리','스마트TV','의류건조기','전동킥보드'],
  '50000004':['스탠딩책상','패브릭소파','간접조명','수납장','침대프레임','책상','의자','선반','행거','커튼','러그','조명','매트리스','화장대','신발장','옷장','테이블','빈백','벽시계','캔들'],
  '50000005':['기저귀','분유','아기물티슈','유모차','아기띠','보행기','젖병','아기침대','아기욕조','아기이유식','유아의류','아기장난감','아기모빌','카시트','아기안전문','아기수면조끼','아기로션','아기체온계','아기세제','어린이책'],
  '50000006':['단백질쉐이크','닭가슴살','견과류','오트밀','그릭요거트','프로틴바','커피원두','홍삼','비타민','콜라겐','다이어트식품','냉동도시락','시리얼','건강즙','흑마늘','아몬드','두유','무설탕과자','제로음료','저칼로리식품'],
  '50000007':['요가매트','러닝화','폼롤러','덤벨세트','캠핑텐트','등산화','자전거','헬스장갑','스포츠레깅스','수영복','배드민턴라켓','골프장갑','등산배낭','캠핑의자','낚시대','스키장갑','인라인스케이트','클라이밍화','서핑보드','줄넘기'],
  '50000008':['마사지건','유산균','전동칫솔','경추베개','족욕기','혈압계','체중계','안마의자','허리보호대','무릎보호대','수면안대','공기청정기','가습기','제습기','의료용압박스타킹','목마사지기','눈마사지기','탈모샴푸','두피케어','비염기'],
  '50000009':['베스트셀러소설','자기계발서','그림책','독서대','e북리더','만화책','영어원서','경제경영서','심리학책','역사책','요리책','육아서','어린이전집','수험서','포토북','달력','다이어리','노트','형광펜','독서등'],
  '50000010':['레고','보드게임','피규어','퍼즐','드론','RC카','블록장난감','인형','모형조립','미니어처','다트','마술도구','슬라임','버블건','물총','팽이','카드게임','전동장난감','체스','다마고치'],
  '50000011':['무선마우스','기계식키보드','포스트잇','USB허브','모니터암','스탠딩책상','라벨기','파일함','화이트보드','복합기','스캐너','책상정리함','형광펜세트','볼펜','노트북거치대','케이블정리','명함지갑','스테이플러','코팅기','재단기'],
  '50000012':['강아지사료','고양이사료','펫패드','강아지간식','자동급식기','고양이간식','강아지옷','고양이장난감','펫캐리어','강아지목욕용품','고양이모래','강아지하네스','펫유모차','강아지이동장','고양이캣타워','강아지쿠션','고양이화장실','펫드라이어','강아지치약','펫보험'],
  '50000013':['블랙박스','하이패스단말기','차량용충전기','세차용품','카매트','차량용공기청정기','타이어압력게이지','차량용방향제','썬팅필름','후방카메라','차량용청소기','카시트','스티어링커버','차량용냉장고','주차알림판','차량용우산거치대','엔진오일','와이퍼','차량용LED','스마트키케이스'],
  '50000014':['캐리어','여행파우치','목베개','숙박권','여행보험','여권지갑','트래블파우치','캐리어커버','휴대용세면도구','여행용멀티어댑터','스노쿨링세트','선글라스','모기퇴치제','여행용잠금장치','캠핑용품','비행기베개','수하물저울','여행용화장품','가이드북','여행용우산']
};

var CACHE = { data:null, ts:0, TTL:5*60*1000 };
function getCache(){ return CACHE.data&&(Date.now()-CACHE.ts<CACHE.TTL)?CACHE.data:null; }
function setCache(d){ CACHE.data=d; CACHE.ts=Date.now(); }

function checkEnv(){
  var miss=[];
  if(!process.env.NAVER_CLIENT_ID) miss.push('NAVER_CLIENT_ID');
  if(!process.env.NAVER_CLIENT_SECRET) miss.push('NAVER_CLIENT_SECRET');
  if(miss.length) throw new Error('환경변수 누락: '+miss.join(', '));
}

function httpGet(path, params){
  return new Promise(function(resolve, reject){
    var qs='';
    var keys=Object.keys(params);
    for(var i=0;i<keys.length;i++){
      qs+=(i===0?'?':'&')+encodeURIComponent(keys[i])+'='+encodeURIComponent(params[keys[i]]);
    }
    var timer=setTimeout(function(){reject(new Error('timeout'));}, TIMEOUT);
    var req=https.request({
      hostname:'openapi.naver.com', path:path+qs, method:'GET',
      headers:{'X-Naver-Client-Id':process.env.NAVER_CLIENT_ID,'X-Naver-Client-Secret':process.env.NAVER_CLIENT_SECRET}
    }, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){ clearTimeout(timer); try{resolve(JSON.parse(raw));}catch(e){resolve({});} });
    });
    req.on('error',function(e){clearTimeout(timer);reject(e);});
    req.end();
  });
}

function cleanText(t){
  return String(t||'').replace(/<[^>]+>/g,'').replace(/[^\w가-힣\s]/g,' ').replace(/\s+/g,' ').trim();
}
function isClean(t){
  if(t.length<2) return false;
  if(/\[광고\]|\[협찬\]|쿠폰|특가|이벤트/.test(t)) return false;
  return true;
}
function safeNum(v){ var n=Number(v); return isNaN(n)?0:n; }

function shopSearch(keyword, catId){
  var params={query:keyword, display:40, sort:'sim'};
  if(catId&&catId!=='all') params.category=catId;
  return httpGet('/v1/search/shop.json', params).then(function(data){
    if(!data||!Array.isArray(data.items)) return {items:[], totalCount:0};
    var items=[];
    for(var i=0;i<data.items.length;i++){
      var item=data.items[i];
      var title=cleanText(item.title||'');
      var price=safeNum(item.lprice||item.price);
      if(isClean(title)&&price>0){
        items.push({
          title:title,
          link:item.link||'',
          price:price,
          mall:item.mallName||''
        });
      }
    }
    return { items:items, totalCount:safeNum(data.total) };
  }).catch(function(){ return {items:[], totalCount:0}; });
}

function calcScore(result, maxTotal){
  var items      = result.items;
  var totalCount = result.totalCount;

  if(!items.length) return {totalScore:0, breakdown:{}, grade:'C', confidence:'low'};

  var searchScore = maxTotal>0 ? Math.round((Math.min(totalCount,maxTotal)/maxTotal)*40) : 0;

  var malls = {};
  items.forEach(function(i){ malls[i.mall]=true; });
  var mallCount  = Object.keys(malls).length;
  var mallScore  = Math.round(Math.min(mallCount/10, 1)*30);

  var prices = items.map(function(i){return i.price;}).filter(function(p){return p>0;});
  var priceScore = 0;
  if(prices.length>1){
    var minP=Math.min.apply(null,prices), maxP=Math.max.apply(null,prices);
    var range = maxP-minP;
    priceScore = range>0 ? Math.round(Math.min(range/(maxP*0.5),1)*20) : 5;
  }

  var countScore = Math.round(Math.min(items.length/40,1)*10);

  var total = Math.min(100, searchScore+mallScore+priceScore+countScore);
  var grade = total>=GRADE_A?'A':total>=GRADE_B?'B':'C';
  var confidence = mallCount>=5?'high':mallCount>=2?'medium':'low';

  return {
    totalScore: total,
    breakdown: {
      shopping: searchScore,
      blog:     mallScore,
      news:     priceScore,
      trend:    countScore
    },
    grade:      grade,
    confidence: confidence
  };
}

function judgeT(totalCount){
  if(totalCount===0)         return {status:'new',     changeRate:null, source:'count'};
  if(totalCount>=500000)     return {status:'rising',  changeRate:null, source:'count'};
  if(totalCount>=100000)     return {status:'stable',  changeRate:null, source:'count'};
  if(totalCount>=10000)      return {status:'stable',  changeRate:null, source:'count'};
  return                            {status:'falling', changeRate:null, source:'count'};
}

function makeSummary(name, score, trend){
  var action;
  if(trend.status==='rising'&&score.grade==='A')      action='shorts';
  else if(trend.status==='rising'||score.grade==='A') action='blog';
  else if(trend.status==='falling')                   action='hold';
  else if(score.grade==='B')                          action='blog';
  else                                                action='compare';

  var lbl={rising:'🔥 급상승',stable:'➡️ 보합',falling:'📉 하락',new:'✨ 신규'};
  var note=score.confidence==='low'?' (데이터 부족)':'';
  return {
    summary: name+' '+(lbl[trend.status]||'')+' · '+score.totalScore+'점 · '+action.toUpperCase()+' 추천'+note,
    action:  action
  };
}

function buildCandidateFromResult(kw, result, maxTotal){
  var score = calcScore(result, maxTotal);
  var trend = judgeT(result.totalCount);
  var sm    = makeSummary(kw, score, trend);
  var samples=[];
  for(var i=0;i<Math.min(3,result.items.length);i++){
    samples.push({title:result.items[i].title, link:result.items[i].link, source:'shopping'});
  }
  return {
    id:kw, name:kw, keywords:[kw], sources:['shopping'],
    count:result.items.length,
    totalCount:result.totalCount,
    score:score, trend:trend,
    summary:sm.summary, action:sm.action,
    sampleItems:samples
  };
}

async function discoverCategory(catId){
  var keywords=CAT_SEEDS[catId]||CAT_SEEDS['50000003'];
  var promises=keywords.map(function(kw){return shopSearch(kw,catId);});
  var results=await Promise.allSettled(promises);

  var valid=[];
  for(var i=0;i<keywords.length;i++){
    var r=results[i].status==='fulfilled'?results[i].value:{items:[],totalCount:0};
    if(r.items.length>0) valid.push({kw:keywords[i], result:r});
  }
  if(!valid.length) return {candidates:[], apiStatus:{search:'결과 없음'}};

  var maxTotal=0;
  valid.forEach(function(v){if(v.result.totalCount>maxTotal) maxTotal=v.result.totalCount;});
  if(maxTotal===0) maxTotal=40;

  var candidates=valid.map(function(v){
    return buildCandidateFromResult(v.kw, v.result, maxTotal);
  });
  candidates.sort(function(a,b){return b.score.totalScore-a.score.totalScore;});

  return {
    candidates:candidates.slice(0,15),
    apiStatus:{search:valid.length+'/'+keywords.length+' 성공'}
  };
}

async function discoverAll(){
  var promises=CAT_ORDER.map(function(catId){
    var kw=(CAT_SEEDS[catId]||[])[0]||'';
    if(!kw) return Promise.resolve({catId:catId,kw:'',result:{items:[],totalCount:0},ok:false});
    return shopSearch(kw,catId).then(function(result){
      return {catId:catId, kw:kw, result:result, ok:true};
    }).catch(function(){
      return {catId:catId, kw:kw, result:{items:[],totalCount:0}, ok:false};
    });
  });

  var results=await Promise.allSettled(promises);
  var pool=[], completed=[], failed=[];

  results.forEach(function(r){
    if(r.status!=='fulfilled') return;
    var v=r.value;
    if(!v.ok||!v.result.items.length){ failed.push(CAT_NAMES[v.catId]||v.catId); return; }
    pool.push(v);
    completed.push(CAT_NAMES[v.catId]||v.catId);
  });

  var maxTotal=0;
  pool.forEach(function(v){if(v.result.totalCount>maxTotal) maxTotal=v.result.totalCount;});
  if(maxTotal===0) maxTotal=40;

  var candidates=pool.map(function(v){
    var c=buildCandidateFromResult(v.kw, v.result, maxTotal);
    c.category=CAT_NAMES[v.catId]||v.catId;
    return c;
  });
  candidates.sort(function(a,b){return b.score.totalScore-a.score.totalScore;});

  return {
    candidates:candidates.slice(0,10),
    apiStatus:{completed:completed.length+'/'+CAT_ORDER.length+' 카테고리', failed:failed.length?failed.join(', '):'없음'},
    processLog:{completed:completed, failed:failed}
  };
}

async function discoverSeed(seedKw){
  var STOP=new Set(['이','가','을','를','의','에','는','은','도','와','과','세트','상품','제품','판매']);
  var r1=await httpGet('/v1/search/shop.json',{query:seedKw,display:20,sort:'sim'}).catch(function(){return {};});
  var freq={};
  ((r1&&r1.items)||[]).forEach(function(i){
    cleanText(i.title||'').split(/\s+/).filter(function(w){return w.length>1&&!STOP.has(w)&&w!==seedKw;})
      .forEach(function(w){freq[w]=(freq[w]||0)+1;});
  });
  var entries=Object.entries(freq).sort(function(a,b){return b[1]-a[1];});
  var keywords=[seedKw];
  for(var e=0;e<Math.min(6,entries.length);e++) keywords.push(entries[e][0]);
  keywords=keywords.slice(0,8);

  var promises=keywords.map(function(kw){return shopSearch(kw,null);});
  var results=await Promise.allSettled(promises);
  var valid=[];
  for(var i=0;i<keywords.length;i++){
    var r=results[i].status==='fulfilled'?results[i].value:{items:[],totalCount:0};
    if(r.items.length>0) valid.push({kw:keywords[i],result:r});
  }
  if(!valid.length) return {candidates:[],apiStatus:{search:'결과 없음'}};

  var maxTotal=0;
  valid.forEach(function(v){if(v.result.totalCount>maxTotal) maxTotal=v.result.totalCount;});
  if(maxTotal===0) maxTotal=40;

  var candidates=valid.map(function(v){return buildCandidateFromResult(v.kw,v.result,maxTotal);});
  candidates.sort(function(a,b){return b.score.totalScore-a.score.totalScore;});
  return {candidates:candidates.slice(0,15),apiStatus:{search:valid.length+'/'+keywords.length+' 성공'}};
}

module.exports=async function(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();

  try{checkEnv();}catch(e){return res.status(500).json({error:e.message});}

  var mode=req.query.mode||'category';
  var period=req.query.period||'week';

  try{
    if(mode==='category'){
      var catId=req.query.categoryId||'50000003';

      if(catId==='all'){
        var cached=getCache();
        if(cached){
          cached.fromCache=true;
          cached.cacheAge=Math.round((Date.now()-CACHE.ts)/1000)+'초 전';
          return res.status(200).json(cached);
        }
        var allResult=await discoverAll();
        var result={
          candidates:allResult.candidates, mode:mode,
          categoryId:'all', categoryName:'전체', period:period,
          total:allResult.candidates.length, apiStatus:allResult.apiStatus,
          processLog:allResult.processLog, updatedAt:new Date().toISOString(), fromCache:false
        };
        setCache(result);
        return res.status(200).json(result);
      }

      var catResult=await discoverCategory(catId);
      return res.status(200).json({
        candidates:catResult.candidates, mode:mode,
        categoryId:catId, categoryName:CAT_NAMES[catId]||catId,
        period:period, total:catResult.candidates.length,
        apiStatus:catResult.apiStatus, updatedAt:new Date().toISOString()
      });
    }

    if(mode==='seed'){
      var seedKw=String(req.query.keyword||'').trim().slice(0,30);
      if(!seedKw) return res.status(400).json({error:'키워드를 입력해주세요'});
      var seedResult=await discoverSeed(seedKw);
      return res.status(200).json({
        candidates:seedResult.candidates, mode:mode,
        seedKeyword:seedKw, period:period,
        total:seedResult.candidates.length, apiStatus:seedResult.apiStatus,
        updatedAt:new Date().toISOString()
      });
    }

    return res.status(400).json({error:'알 수 없는 mode'});

  }catch(e){
    console.error('[auto-discover]',e.message);
    return res.status(500).json({error:'탐색 중 오류가 발생했습니다.',detail:e.message});
  }
};
