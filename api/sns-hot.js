var https = require('https');
var TIMEOUT = 10000;
var CACHE = {}, CACHE_TTL = 20 * 60 * 1000;

var SELL_KW = ['추천','후기','리뷰','비교','top','가성비','사용기','언박싱','best','구매','최저가','순위'];
var INFO_KW = ['방법','원인','효과','부작용','이유','차이','뜻','설명','분석','정보'];

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

async function analyzeYouTube(keyword, ytKey){
  if(!ytKey) return {ok:false, error:'YOUTUBE_API_KEY 없음'};
  var since7 = new Date(); since7.setDate(since7.getDate()-7);
  var since30 = new Date(); since30.setDate(since30.getDate()-30);

  var sr7 = await httpGet('www.googleapis.com',
    '/youtube/v3/search?part=snippet&type=video&order=date&regionCode=KR&maxResults=20'
    +'&publishedAfter='+encodeURIComponent(since7.toISOString())
    +'&q='+encodeURIComponent(keyword)+'&key='+ytKey);

  var sr30 = await httpGet('www.googleapis.com',
    '/youtube/v3/search?part=snippet&type=video&order=viewCount&regionCode=KR&maxResults=20'
    +'&publishedAfter='+encodeURIComponent(since30.toISOString())
    +'&q='+encodeURIComponent(keyword)+'&key='+ytKey);

  var items7  = (sr7 &&sr7.data &&sr7.data.items )||[];
  var items30 = (sr30&&sr30.data&&sr30.data.items)||[];
  var ids = items30.map(function(i){return i.id&&i.id.videoId;}).filter(Boolean).join(',');
  if(!ids) return {ok:true, videoCount:0, avgViews:0, shortsRatio:0, recentCount:0, titles:[], uniqueChannels:0, concentration:0};

  var vr = await httpGet('www.googleapis.com',
    '/youtube/v3/videos?part=statistics,contentDetails,snippet&id='+encodeURIComponent(ids)+'&key='+ytKey);
  var videos = (vr&&vr.data&&vr.data.items)||[];

  var totalViews=0, shorts=0, chMap={}, titles=[], viewsList=[];
  videos.forEach(function(v){
    var views=Number((v.statistics||{}).viewCount||0);
    totalViews+=views; viewsList.push(views);
    var dur=((v.contentDetails||{}).duration||'');
    var m=dur.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
    if(m&&Number(m[1]||0)*60+Number(m[2]||0)<=60) shorts++;
    var ch=(v.snippet||{}).channelTitle||'';
    if(ch) chMap[ch]=(chMap[ch]||0)+1;
    var title=(v.snippet||{}).title||'';
    if(title) titles.push(title.toLowerCase());
  });

  var top3Views=viewsList.sort(function(a,b){return b-a;}).slice(0,3).reduce(function(s,v){return s+v;},0);
  return {
    ok:true,
    videoCount:  videos.length,
    recentCount: items7.length,
    avgViews:    videos.length?Math.round(totalViews/videos.length):0,
    totalViews:  totalViews,
    shortsRatio: videos.length?Math.round((shorts/videos.length)*100):0,
    uniqueChannels: Object.keys(chMap).length,
    concentration:  totalViews>0?Math.round((top3Views/totalViews)*100):0,
    titles: titles
  };
}

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
          resolve({ok:true, surgeRate:surge, trend:trend, avgRatio:Math.round(recent*10)/10});
        }catch(e){resolve({ok:false,error:e.message});}
      });
    });
    req.on('error',function(e){clearTimeout(t);resolve({ok:false,error:e.message});});
    req.write(buf); req.end();
  });
}

// ── 판매형 판단 (제목 비율 기반)
function judgeSaleability(yt, keyword){
  var kw=keyword.toLowerCase(), titles=yt.titles||[];
  var sellCount=0;
  titles.forEach(function(t){if(SELL_KW.some(function(w){return t.indexOf(w)>-1;})) sellCount++;});
  var total=titles.length||1;
  var sellRatio=Math.round((sellCount/total)*100);
  if(SELL_KW.some(function(w){return kw.indexOf(w)>-1;})) sellRatio=Math.min(100,sellRatio+20);
  if(INFO_KW.some(function(w){return kw.indexOf(w)>-1;})) sellRatio=Math.max(0,sellRatio-20);
  var type,label,score;
  if(sellRatio>=60)     {type='sell';  label='💰 판매형'; score=20;}
  else if(sellRatio>=30){type='mixed'; label='🔀 혼합형'; score=10;}
  else                  {type='info';  label='📘 정보형'; score=3;}
  return {type:type, label:label, score:score, sellRatio:sellRatio};
}

// ── 트렌드 상태
function judgeTrend(yt, dl){
  if(dl.ok&&dl.surgeRate>=30) return {status:'급상승', icon:'🔥', color:'#ef4444'};
  if(yt.ok&&yt.recentCount>=10) return {status:'확산중', icon:'🚀', color:'#f97316'};
  if(dl.ok&&dl.surgeRate<=-15) return {status:'하락',   icon:'⛔', color:'#94a3b8'};
  if(yt.ok&&yt.recentCount>=5) return {status:'확산중', icon:'🚀', color:'#f97316'};
  return {status:'정체', icon:'⚠️', color:'#f59e0b'};
}

// ── 경쟁도 분석
function judgeCompetition(yt){
  if(!yt.ok||!yt.videoCount) return {level:'unknown', label:'–', color:'#94a3b8', score:5};
  var ratio=yt.avgViews>0?yt.videoCount/(yt.avgViews/1000):99;
  if(ratio>=5||(yt.videoCount>=15&&yt.avgViews<10000))
    return {level:'high',   label:'🔴 고경쟁', color:'#ef4444', score:2};
  if(ratio>=2||(yt.videoCount>=8&&yt.avgViews<50000))
    return {level:'medium', label:'🟡 중경쟁', color:'#f59e0b', score:5};
  return   {level:'low',    label:'🟢 저경쟁', color:'#10b981', score:10};
}

// ── 쇼츠 적합도
function judgeShortsfit(yt){
  if(!yt.ok) return {label:'–', level:'unknown', color:'#94a3b8'};
  if(yt.shortsRatio>=60) return {label:'🎬 쇼츠 적합', level:'high',   color:'#6366f1'};
  if(yt.shortsRatio>=30) return {label:'🎬 보통',       level:'medium', color:'#f59e0b'};
  return                        {label:'🎬 부적합',      level:'low',    color:'#94a3b8'};
}

// ── 타이밍 판단
function judgeTiming(yt, dl){
  var signals=0;
  if(yt.ok&&yt.recentCount>=10) signals+=2;
  else if(yt.ok&&yt.recentCount>=5) signals+=1;
  if(dl.ok&&dl.surgeRate>=20) signals+=2;
  else if(dl.ok&&dl.surgeRate>=5) signals+=1;
  else if(dl.ok&&dl.surgeRate<=-10) signals-=2;
  if(yt.ok&&yt.avgViews>500000) signals-=1;
  if(signals>=3) return {status:'지금 진입', icon:'🔥', color:'#ef4444'};
  if(signals>=1) return {status:'관망',      icon:'⏳', color:'#f59e0b'};
  return               {status:'늦음',      icon:'❌', color:'#94a3b8'};
}

// ── 종합 점수 (투명화)
function calcScore(yt, dl, sale, competition){
  var trendScore=0;
  if(dl.ok){var s=dl.surgeRate; trendScore=s>=30?25:s>=15?18:s>=5?12:s>=-5?8:3;}
  else if(yt.ok){trendScore=Math.round(Math.min(yt.recentCount/20,1)*15);}
  var viewScore  = yt.ok?Math.round(Math.min(yt.avgViews/200000,1)*25):0;
  var shortsScore= yt.ok?Math.round(Math.min(yt.shortsRatio/100,1)*20):0;
  var saleScore  = sale.score||0;
  var compScore  = competition.score||5;
  var total=Math.round(Math.min(trendScore+viewScore+shortsScore+saleScore+compScore,100));
  return {
    total:total,
    grade:total>=80?'S':total>=65?'A':total>=45?'B':'C',
    breakdown:{trend:trendScore, views:viewScore, shorts:shortsScore, sale:saleScore, compete:compScore}
  };
}

// ── AI 추천 이유
function buildAiReason(yt, dl, timing, sale, competition){
  var parts=[];
  if(dl.ok&&dl.surgeRate>=10) parts.push('네이버 검색량 +'+dl.surgeRate+'% 급증');
  else if(yt.ok&&yt.recentCount>=5) parts.push('최근 7일 영상 '+yt.recentCount+'개 등록');
  if(yt.ok&&yt.avgViews>0) parts.push('평균 조회수 '+fmtN(yt.avgViews));
  if(sale.sellRatio!==undefined) parts.push('판매형 제목 '+sale.sellRatio+'%');
  if(yt.ok&&yt.shortsRatio>0) parts.push('쇼츠 비율 '+yt.shortsRatio+'%');
  var result=timing.status==='지금 진입'?'→ 지금 진입 타이밍':timing.status==='관망'?'→ 진입 시점 관망 필요':'→ 성장 둔화, 진입 재고';
  return (parts.slice(0,2).join(' + ')||'데이터 수집 완료')+' '+result;
}

function fmtN(n){
  if(n>=10000) return Math.round(n/10000)+'만';
  if(n>=1000)  return Math.round(n/1000)+'천';
  return String(n||0);
}

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
        var yt=await analyzeYouTube(kw,ytKey);
        var dl=await analyzeDatalab(kw,cid,sec);
        var sale       =judgeSaleability(yt,kw);
        var trend      =judgeTrend(yt,dl);
        var competition=judgeCompetition(yt);
        var shorts     =judgeShortsfit(yt);
        var timing     =judgeTiming(yt,dl);
        var score      =calcScore(yt,dl,sale,competition);
        var aiReason   =buildAiReason(yt,dl,timing,sale,competition);
        return {keyword:kw, score:score, sale:sale, trend:trend, competition:competition, shorts:shorts, timing:timing, aiReason:aiReason, youtube:yt, datalab:dl};
      }));
      bRes.forEach(function(r){if(r.status==='fulfilled') results.push(r.value);});
    }

    results.sort(function(a,b){return b.score.total-a.score.total;});
    var data={results:results, total:results.length, top3:results.slice(0,3), envStatus:envStatus, updatedAt:new Date().toISOString(), fromCache:false};
    CACHE[cacheKey]={data:data, ts:Date.now()};
    return res.status(200).json(data);

  }catch(e){
    console.error('[sns-hot]',e.message);
    return res.status(500).json({error:'분석 오류', detail:e.message});
  }
};
