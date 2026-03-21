/**
 * /api/sns-hot.js
 * YouTube + Naver Datalab 기반 제품 실행 가치 판단 시스템
 * 키워드는 반드시 트렌드 탐색 탭에서 전달받음
 */
var https = require('https');
var TIMEOUT = 10000;
var CACHE = {}, CACHE_TTL = 20 * 60 * 1000;

// 판매형 키워드
var SELL_KW   = ['추천','후기','리뷰','비교','best','top','가성비','구매','최저가','순위','언박싱','사용기'];
var INFO_KW   = ['방법','원인','효과','부작용','이유','차이','뜻','설명','분석','정보'];

function httpGet(hostname, path, headers){
  return new Promise(function(resolve){
    var t = setTimeout(function(){resolve(null);}, TIMEOUT);
    https.get({hostname:hostname, path:path, headers:Object.assign({'User-Agent':'RealPick/1.0'}, headers||{})}, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{resolve({status:res.statusCode, data:JSON.parse(raw)});}
        catch(e){resolve({status:res.statusCode, data:null});}
      });
    }).on('error',function(){clearTimeout(t);resolve(null);});
  });
}

// ── YouTube 분석
async function analyzeYouTube(keyword, ytKey){
  if(!ytKey) return {ok:false, error:'YOUTUBE_API_KEY 없음'};

  var since = new Date(); since.setDate(since.getDate()-7);
  var since30 = new Date(); since30.setDate(since30.getDate()-30);

  // 최근 7일
  var sr7 = await httpGet('www.googleapis.com',
    '/youtube/v3/search?part=snippet&type=video&order=date&regionCode=KR&maxResults=20'
    +'&publishedAfter='+encodeURIComponent(since.toISOString())
    +'&q='+encodeURIComponent(keyword)+'&key='+ytKey);

  // 최근 30일
  var sr30 = await httpGet('www.googleapis.com',
    '/youtube/v3/search?part=snippet&type=video&order=viewCount&regionCode=KR&maxResults=20'
    +'&publishedAfter='+encodeURIComponent(since30.toISOString())
    +'&q='+encodeURIComponent(keyword)+'&key='+ytKey);

  var items7  = (sr7 &&sr7.data &&sr7.data.items )||[];
  var items30 = (sr30&&sr30.data&&sr30.data.items)||[];

  var ids = items30.map(function(i){return i.id&&i.id.videoId;}).filter(Boolean).join(',');
  if(!ids) return {ok:true, videoCount:0, avgViews:0, shortsRatio:0, recentCount:0, titles:[], channels:[]};

  var vr = await httpGet('www.googleapis.com',
    '/youtube/v3/videos?part=statistics,contentDetails,snippet&id='+encodeURIComponent(ids)+'&key='+ytKey);
  var videos = (vr&&vr.data&&vr.data.items)||[];

  var totalViews=0, shorts=0, chMap={}, titles=[];
  var viewsList=[];
  videos.forEach(function(v){
    var views = Number((v.statistics||{}).viewCount||0);
    totalViews += views;
    viewsList.push(views);
    var dur = ((v.contentDetails||{}).duration||'');
    var m = dur.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
    if(m && Number(m[1]||0)*60+Number(m[2]||0)<=60) shorts++;
    var ch = (v.snippet||{}).channelTitle||'';
    if(ch) chMap[ch]=(chMap[ch]||0)+1;
    var title = (v.snippet||{}).title||'';
    if(title) titles.push(title.toLowerCase());
  });

  var avgViews    = videos.length ? Math.round(totalViews/videos.length) : 0;
  var shortsRatio = videos.length ? Math.round((shorts/videos.length)*100) : 0;
  var topChannels = Object.entries(chMap).sort(function(a,b){return b[1]-a[1];}).slice(0,5);

  // 경쟁도: 상위 3개 채널 집중도
  var top3Views = viewsList.sort(function(a,b){return b-a;}).slice(0,3).reduce(function(s,v){return s+v;},0);
  var concentration = totalViews>0 ? Math.round((top3Views/totalViews)*100) : 0;
  var uniqueChannels = Object.keys(chMap).length;

  return {
    ok:           true,
    videoCount:   videos.length,
    recentCount:  items7.length,
    avgViews:     avgViews,
    totalViews:   totalViews,
    shortsRatio:  shortsRatio,
    topChannels:  topChannels,
    uniqueChannels:uniqueChannels,
    concentration: concentration,
    titles:       titles
  };
}

// ── Naver Datalab
async function analyzeDatalab(keyword, cid, sec){
  if(!cid||!sec) return {ok:false, error:'NAVER 키 없음'};
  var now=new Date();
  var pad=function(n){return String(n).padStart(2,'0');};
  var fmt=function(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
  var ago=function(n){var d=new Date(now);d.setDate(d.getDate()-n);return d;};
  var body=JSON.stringify({
    startDate:fmt(ago(29)), endDate:fmt(now), timeUnit:'date',
    keywordGroups:[{groupName:keyword, keywords:[keyword]}]
  });
  var buf=Buffer.from(body);
  return new Promise(function(resolve){
    var t=setTimeout(function(){resolve({ok:false,error:'timeout'});},TIMEOUT);
    var req=https.request({
      hostname:'openapi.naver.com', path:'/v1/datalab/search', method:'POST',
      headers:{
        'X-Naver-Client-Id':cid,'X-Naver-Client-Secret':sec,
        'Content-Type':'application/json','Content-Length':buf.length
      }
    },function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{
          var d=JSON.parse(raw);
          var pts=((d.results||[])[0]||{}).data||[];
          if(!pts.length) return resolve({ok:true,surgeRate:0,trend:'보합',avgRatio:0});
          var recent=pts.slice(-7).reduce(function(s,p){return s+Number(p.ratio||0);},0)/7;
          var older =pts.slice(0,7).reduce(function(s,p){return s+Number(p.ratio||0);},0)/7;
          var surge=older>0?Math.round(((recent-older)/older)*100):0;
          var trend=surge>=30?'급상승':surge>=10?'상승':surge<=-15?'하락':'보합';
          resolve({ok:true, surgeRate:surge, trend:trend, avgRatio:Math.round(recent*10)/10, points:pts});
        }catch(e){resolve({ok:false,error:e.message});}
      });
    });
    req.on('error',function(e){clearTimeout(t);resolve({ok:false,error:e.message});});
    req.write(buf); req.end();
  });
}

// ── 판매 가능성 판단
function judgeSaleability(yt, keyword){
  var kw = keyword.toLowerCase();
  var titles = yt.titles||[];
  var kwLow = kw;

  var sellScore=0, infoScore=0;

  // 키워드 자체 분석
  SELL_KW.forEach(function(w){if(kwLow.indexOf(w)>-1) sellScore+=3;});
  INFO_KW.forEach(function(w){if(kwLow.indexOf(w)>-1) infoScore+=3;});

  // 타이틀 분석
  titles.forEach(function(title){
    SELL_KW.forEach(function(w){if(title.indexOf(w)>-1) sellScore++;});
    INFO_KW.forEach(function(w){if(title.indexOf(w)>-1) infoScore++;});
  });

  var type, label;
  if(sellScore>infoScore*1.5)      {type='sell';  label='💰 판매형';}
  else if(infoScore>sellScore*1.5) {type='info';  label='📘 정보형';}
  else                             {type='mixed'; label='🔀 혼합형';}

  return {type:type, label:label, sellScore:sellScore, infoScore:infoScore};
}

// ── 트렌드 상태
function judgeTrend(yt, dl){
  if(dl.ok && dl.surgeRate>=30) return {status:'급상승', icon:'🔥', color:'#ef4444'};
  if(yt.ok && yt.recentCount>=10) return {status:'확산중', icon:'🚀', color:'#f97316'};
  if(dl.ok && dl.surgeRate<=-15) return {status:'하락',   icon:'⛔', color:'#94a3b8'};
  if(yt.ok && yt.recentCount>=5) return {status:'확산중', icon:'🚀', color:'#f97316'};
  return {status:'정체', icon:'⚠️', color:'#f59e0b'};
}

// ── 경쟁도 분석
function judgeCompetition(yt){
  if(!yt.ok||!yt.videoCount) return {level:'unknown', label:'–', color:'#94a3b8'};
  // 채널 다양성 낮고 집중도 높으면 High
  var score=0;
  if(yt.uniqueChannels>=10)      score+=2;
  else if(yt.uniqueChannels>=5)  score+=1;
  if(yt.concentration>=70)       score-=2; // 상위 집중 = high competition
  if(yt.avgViews>=100000)        score-=1;
  if(score>=2)  return {level:'low',    label:'🟢 저경쟁', color:'#10b981'};
  if(score>=0)  return {level:'medium', label:'🟡 중경쟁', color:'#f59e0b'};
  return          {level:'high',   label:'🔴 고경쟁', color:'#ef4444'};
}

// ── 쇼츠 적합도
function judgeShortsfit(yt){
  if(!yt.ok) return {label:'–', level:'unknown', color:'#94a3b8'};
  if(yt.shortsRatio>=60) return {label:'🎬 쇼츠 적합', level:'high',   color:'#6366f1'};
  if(yt.shortsRatio>=30) return {label:'🎬 보통',       level:'medium', color:'#f59e0b'};
  return                        {label:'🎬 부적합',      level:'low',    color:'#94a3b8'};
}

// ── 트렌드 상태
function judgeTrend(yt, dl){
  if(dl.ok && dl.surgeRate>=30) return {status:'급상승', icon:'🔥', color:'#ef4444'};
  if(yt.ok && yt.recentCount>=10) return {status:'확산중', icon:'🚀', color:'#f97316'};
  if(dl.ok && dl.surgeRate<=-15) return {status:'하락',   icon:'⛔', color:'#94a3b8'};
  if(yt.ok && yt.recentCount>=5) return {status:'확산중', icon:'🚀', color:'#f97316'};
  return {status:'정체', icon:'⚠️', color:'#f59e0b'};
}

// ── 쇼츠 적합도
function judgeShortsfit(yt){
  if(!yt.ok) return {label:'–', level:'unknown', color:'#94a3b8'};
  if(yt.shortsRatio>=60) return {label:'🎬 쇼츠 적합', level:'high',   color:'#6366f1'};
  if(yt.shortsRatio>=30) return {label:'🎬 보통',       level:'medium', color:'#f59e0b'};
  return                        {label:'🎬 부적합',      level:'low',    color:'#94a3b8'};
}
function calcScore(yt, dl, trend, competition, sale, shorts){
  var score=0;

  // 트렌드 상승 25%
  if(dl.ok){
    var s=dl.surgeRate;
    score += (s>=30?25:s>=15?18:s>=5?12:s>=-5?8:3);
  } else if(yt.ok){
    score += Math.min(yt.recentCount/20,1)*15;
  }

  // 조회수 25%
  if(yt.ok){
    score += Math.min(yt.avgViews/200000,1)*25;
  }

  // 쇼츠 적합도 20%
  if(yt.ok){
    score += Math.min(yt.shortsRatio/100,1)*20;
  }

  // 판매 가능성 20%
  if(sale.type==='sell')  score+=20;
  else if(sale.type==='mixed') score+=10;
  else score+=3;

  // 경쟁도 10% (저경쟁이 좋음)
  if(competition.level==='low')    score+=10;
  else if(competition.level==='medium') score+=5;
  else score+=1;

  var total=Math.round(Math.min(score,100));
  var grade=total>=80?'S':total>=65?'A':total>=45?'B':'C';
  return {total:total, grade:grade};
}

// ── AI 추천 이유
function buildAiReason(yt, dl, trend, competition, sale, shorts, sc){
  var reasons=[];

  if(trend.status==='급상승') reasons.push('네이버 검색량 '+dl.surgeRate+'% 급증');
  else if(trend.status==='확산중') reasons.push('최근 7일 YouTube 영상 '+yt.recentCount+'개 증가');

  if(yt.ok&&yt.avgViews>50000) reasons.push('평균 조회수 '+fmtN(yt.avgViews)+' 수요 확인');
  if(sale.type==='sell') reasons.push('제목 분석 결과 구매 의도 키워드 다수');
  if(shorts.level==='high') reasons.push('쇼츠 비율 '+yt.shortsRatio+'% 단기 콘텐츠 적합');
  if(competition.level==='low') reasons.push('채널 분산도 높아 진입 장벽 낮음');
  if(competition.level==='high') reasons.push('상위 채널 집중도 높아 경쟁 심함');

  if(!reasons.length){
    if(sc.total>=60) reasons.push('복합 지표 종합 점수 '+sc.total+'점 진입 가치 있음');
    else reasons.push('현재 데이터 부족 추가 관찰 필요');
  }

  return reasons.slice(0,2).join(' → ');
}

function fmtN(n){
  if(n>=10000) return Math.round(n/10000)+'만';
  if(n>=1000)  return Math.round(n/1000)+'천';
  return String(n);
}

// ── 메인
module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();

  var raw=String(req.query.keywords||'').trim();
  if(!raw) return res.status(400).json({error:'keywords 파라미터 필요'});

  var keywords=raw.split(',').map(function(k){return k.trim();})
    .filter(function(k){return k.length>0;})
    .filter(function(k,i,a){return a.indexOf(k)===i;})
    .slice(0,15);

  if(!keywords.length) return res.status(400).json({error:'유효한 키워드 없음'});

  var cacheKey=keywords.slice().sort().join(',');
  if(CACHE[cacheKey]&&(Date.now()-CACHE[cacheKey].ts<CACHE_TTL))
    return res.status(200).json(Object.assign({},CACHE[cacheKey].data,{fromCache:true}));

  var ytKey=process.env.YOUTUBE_API_KEY;
  var cid  =process.env.NAVER_CLIENT_ID;
  var sec  =process.env.NAVER_CLIENT_SECRET;

  var envStatus={youtube:!!ytKey, naver:!!(cid&&sec)};

  try{
    var results=[];
    for(var i=0;i<keywords.length;i+=2){
      var batch=keywords.slice(i,i+2);
      var bRes=await Promise.allSettled(batch.map(async function(kw){
        var yt = await analyzeYouTube(kw, ytKey);
        var dl = await analyzeDatalab(kw, cid, sec);

        var sale        = judgeSaleability(yt, kw);
        var trend       = judgeTrend(yt, dl);
        var competition = judgeCompetition(yt);
        var shorts      = judgeShortsfit(yt);
        var timing      = judgeTiming(yt, dl);
        var score       = calcScore(yt, dl, trend, competition, sale, shorts);
        var aiReason    = buildAiReason(yt, dl, trend, competition, sale, shorts, timing, score);

        return {
          keyword:kw, score:score,
          sale:sale, trend:trend, competition:competition, shorts:shorts, timing:timing,
          aiReason:aiReason,
          youtube:yt, datalab:dl
        };
      }));
      bRes.forEach(function(r){if(r.status==='fulfilled') results.push(r.value);});
    }

    results.sort(function(a,b){return b.score.total-a.score.total;});

    var data={
      results:results, total:results.length,
      top3:results.slice(0,3),
      envStatus:envStatus,
      updatedAt:new Date().toISOString(),
      fromCache:false
    };
    CACHE[cacheKey]={data:data, ts:Date.now()};
    return res.status(200).json(data);

  }catch(e){
    console.error('[sns-hot]',e.message);
    return res.status(500).json({error:'분석 오류', detail:e.message});
  }
};
