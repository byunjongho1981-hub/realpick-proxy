/**
 * /api/sns-hot.js
 * YouTube Data API v3 + Naver Datalab 기반 SNS 반응 분석
 *
 * 필요 환경변수:
 *   YOUTUBE_API_KEY
 *   NAVER_CLIENT_ID
 *   NAVER_CLIENT_SECRET
 */

var https = require('https');

var TIMEOUT = 10000;
var CACHE   = {};
var CACHE_TTL = 30 * 60 * 1000;

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

function httpPost(hostname, path, body, headers){
  return new Promise(function(resolve){
    var buf = Buffer.from(JSON.stringify(body));
    var t   = setTimeout(function(){resolve(null);}, TIMEOUT);
    var req = https.request({
      hostname:hostname, path:path, method:'POST',
      headers:Object.assign({'Content-Type':'application/json','Content-Length':buf.length}, headers||{})
    }, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{resolve({status:res.statusCode, data:JSON.parse(raw)});}
        catch(e){resolve({status:res.statusCode, data:null});}
      });
    });
    req.on('error',function(){clearTimeout(t);resolve(null);});
    req.write(buf); req.end();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. YouTube Data API v3
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function fetchYouTube(keyword){
  var key = process.env.YOUTUBE_API_KEY;
  if(!key) return {ok:false, error:'YOUTUBE_API_KEY 없음'};

  var since = new Date();
  since.setDate(since.getDate()-7);

  var sr = await httpGet('www.googleapis.com',
    '/youtube/v3/search?part=snippet&type=video&order=date&regionCode=KR&maxResults=20'
    +'&publishedAfter='+encodeURIComponent(since.toISOString())
    +'&q='+encodeURIComponent(keyword)
    +'&key='+key);

  if(!sr||sr.status!==200||!sr.data||!sr.data.items)
    return {ok:false, error:'YouTube 검색 실패 '+(sr?sr.status:'timeout')};

  var ids = sr.data.items.map(function(i){return i.id&&i.id.videoId;}).filter(Boolean).join(',');
  if(!ids) return {ok:true, videoCount:0, avgViews:0, shortsRatio:0, topChannels:[], recentCount:0};

  var vr = await httpGet('www.googleapis.com',
    '/youtube/v3/videos?part=statistics,contentDetails,snippet&id='+encodeURIComponent(ids)+'&key='+key);
  var videos = (vr&&vr.data&&vr.data.items)||[];

  var totalViews=0, shorts=0, chMap={};
  videos.forEach(function(v){
    totalViews += Number((v.statistics||{}).viewCount||0);
    var dur = ((v.contentDetails||{}).duration||'');
    var m   = dur.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
    if(m && Number(m[1]||0)*60+Number(m[2]||0)<=60) shorts++;
    var ch = (v.snippet||{}).channelTitle||'';
    if(ch) chMap[ch]=(chMap[ch]||0)+1;
  });

  return {
    ok:          true,
    videoCount:  videos.length,
    avgViews:    videos.length ? Math.round(totalViews/videos.length) : 0,
    totalViews:  totalViews,
    shortsRatio: videos.length ? Math.round((shorts/videos.length)*100) : 0,
    topChannels: Object.entries(chMap).sort(function(a,b){return b[1]-a[1];}).slice(0,3).map(function(e){return e[0];}),
    recentCount: sr.data.items.length
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. Naver Datalab 검색량 트렌드
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function fetchNaverDatalab(keyword){
  var cid = process.env.NAVER_CLIENT_ID;
  var sec = process.env.NAVER_CLIENT_SECRET;
  if(!cid||!sec) return {ok:false, error:'NAVER 키 없음'};

  var now  = new Date();
  var pad  = function(n){return String(n).padStart(2,'0');};
  var fmt  = function(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
  var ago  = function(n){var d=new Date(now);d.setDate(d.getDate()-n);return d;};

  var body = {
    startDate: fmt(ago(29)),
    endDate:   fmt(now),
    timeUnit:  'date',
    keywordGroups:[{groupName:keyword, keywords:[keyword]}]
  };
  var buf = Buffer.from(JSON.stringify(body));
  var res = await new Promise(function(resolve){
    var t   = setTimeout(function(){resolve(null);}, TIMEOUT);
    var req = https.request({
      hostname:'openapi.naver.com', path:'/v1/datalab/search', method:'POST',
      headers:{
        'X-Naver-Client-Id':     cid,
        'X-Naver-Client-Secret': sec,
        'Content-Type':          'application/json',
        'Content-Length':        buf.length
      }
    }, function(r){
      var raw='';
      r.on('data',function(c){raw+=c;});
      r.on('end',function(){
        clearTimeout(t);
        try{resolve({status:r.statusCode,data:JSON.parse(raw)});}
        catch(e){resolve(null);}
      });
    });
    req.on('error',function(){clearTimeout(t);resolve(null);});
    req.write(buf); req.end();
  });

  if(!res||res.status!==200||!res.data||!res.data.results)
    return {ok:false, error:'Datalab 실패 '+(res?res.status:'timeout')};

  var pts    = (res.data.results[0]&&res.data.results[0].data)||[];
  if(!pts.length) return {ok:true, trend:'데이터 없음', surgeRate:0, avgRatio:0};

  var recent = pts.slice(-7).reduce(function(s,p){return s+Number(p.ratio||0);},0)/7;
  var older  = pts.slice(0,7).reduce(function(s,p){return s+Number(p.ratio||0);},0)/7;
  var surge  = older>0 ? Math.round(((recent-older)/older)*100) : 0;
  var trend  = surge>=20?'🔥 급상승':surge>=5?'📈 상승':surge<=-10?'📉 하락':'➡️ 보합';

  return {ok:true, surgeRate:surge, trend:trend, avgRatio:Math.round(recent*10)/10, points:pts.length};
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 점수 계산
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function calcScore(yt, dl){
  var score = 0;

  if(yt.ok){
    score += Math.min(yt.avgViews/100000, 1) * 35;  // YouTube 조회수 35점
    score += Math.min(yt.recentCount/20,  1) * 20;  // YouTube 최근성 20점
    score += Math.min(yt.shortsRatio/100, 1) * 15;  // 쇼츠 비율 15점
  }

  if(dl.ok){
    score += Math.min(dl.avgRatio/100, 1)   * 20;   // 검색량 20점
    if(dl.surgeRate>=20)      score += 10;           // 급상승 보너스 10점
    else if(dl.surgeRate>=5)  score += 5;
  }

  var total = Math.round(Math.min(score, 100));
  var grade = total>=80?'S':total>=60?'A':total>=40?'B':'C';

  var tags=[], reasons=[];
  if(yt.ok&&yt.avgViews>50000)   {tags.push('🔥 급상승');    reasons.push('YouTube 평균 '+fmtN(yt.avgViews)+'회');}
  if(yt.ok&&yt.shortsRatio>50)   {tags.push('🎬 쇼츠 적합'); reasons.push('쇼츠 비율 '+yt.shortsRatio+'%');}
  if(dl.ok&&dl.surgeRate>=10)    {tags.push('📈 검색 급증');  reasons.push('네이버 검색량 '+dl.trend);}
  if(yt.ok&&yt.videoCount>10)     tags.push('📺 콘텐츠 多');
  if(!reasons.length) reasons.push('데이터 수집 완료');

  return {total:total, grade:grade, tags:tags, reason:reasons.slice(0,2).join(' · ')};
}

function fmtN(n){
  if(n>=10000) return Math.round(n/10000)+'만';
  if(n>=1000)  return Math.round(n/1000)+'천';
  return String(n);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 메인 핸들러
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();

  var raw = String(req.query.keywords||'').trim();
  if(!raw) return res.status(400).json({error:'keywords 파라미터 필요'});

  var keywords = raw.split(',').map(function(k){return k.trim();})
    .filter(function(k){return k.length>0;})
    .filter(function(k,i,a){return a.indexOf(k)===i;})
    .slice(0,15);

  if(!keywords.length) return res.status(400).json({error:'유효한 키워드 없음'});

  var cacheKey = keywords.slice().sort().join(',');
  if(CACHE[cacheKey]&&(Date.now()-CACHE[cacheKey].ts<CACHE_TTL)){
    return res.status(200).json(Object.assign({},CACHE[cacheKey].data,{fromCache:true}));
  }

  var envStatus = {
    youtube:  !!process.env.YOUTUBE_API_KEY,
    naver:    !!(process.env.NAVER_CLIENT_ID&&process.env.NAVER_CLIENT_SECRET)
  };

  try{
    var results=[];
    for(var i=0;i<keywords.length;i+=3){
      var batch=keywords.slice(i,i+3);
      var bRes=await Promise.allSettled(batch.map(async function(kw){
        var yt = envStatus.youtube ? await fetchYouTube(kw)      : {ok:false,error:'키 없음'};
        var dl = envStatus.naver   ? await fetchNaverDatalab(kw)  : {ok:false,error:'키 없음'};
        return {keyword:kw, score:calcScore(yt,dl), youtube:yt, datalab:dl};
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
