/**
 * /api/sns-hot.js
 * YouTube Data API v3 + RapidAPI (Instagram + TikTok)
 *
 * 필요 환경변수:
 *   YOUTUBE_API_KEY
 *   RAPIDAPI_KEY  ← RapidAPI 대시보드에서 발급
 */

var https = require('https');

var TIMEOUT = 10000;
var CACHE   = {};
var CACHE_TTL = 30 * 60 * 1000;

// ── HTTP GET
function httpGet(hostname, path, headers){
  return new Promise(function(resolve){
    var t = setTimeout(function(){resolve(null);}, TIMEOUT);
    https.get({hostname:hostname, path:path, headers:Object.assign({'User-Agent':'RealPick/1.0'}, headers||{})}, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{resolve({status:res.statusCode, data:JSON.parse(raw)});}
        catch(e){resolve({status:res.statusCode, data:null, raw:raw.slice(0,200)});}
      });
    }).on('error',function(e){clearTimeout(t);resolve(null);});
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// YouTube Data API v3
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function fetchYouTube(keyword){
  var key = process.env.YOUTUBE_API_KEY;
  if(!key) return {ok:false, error:'YOUTUBE_API_KEY 없음'};

  var since = new Date();
  since.setDate(since.getDate()-7);

  var searchPath = '/youtube/v3/search?part=snippet&type=video&order=date'
    +'&regionCode=KR&maxResults=20'
    +'&publishedAfter='+encodeURIComponent(since.toISOString())
    +'&q='+encodeURIComponent(keyword)
    +'&key='+key;

  var sr = await httpGet('www.googleapis.com', searchPath);
  if(!sr||sr.status!==200||!sr.data||!sr.data.items) return {ok:false, error:'YouTube 검색 실패 '+(sr?sr.status:'timeout')};

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
// Instagram via RapidAPI
// host: instagram-scraper-api2.p.rapidapi.com
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function fetchInstagram(keyword){
  var key = process.env.RAPIDAPI_KEY;
  if(!key) return {ok:false, error:'RAPIDAPI_KEY 없음'};

  var tag = keyword.replace(/\s+/g,'');
  var host = 'instagram-scraper-api2.p.rapidapi.com';
  var headers = {
    'x-rapidapi-key':  key,
    'x-rapidapi-host': host
  };

  var r = await httpGet(host, '/v1/hashtag?hashtag='+encodeURIComponent(tag), headers);
  if(!r||r.status!==200||!r.data) return {ok:false, error:'Instagram API 실패 '+(r?r.status:'timeout')};

  var d    = r.data;
  var info = d.data||d||{};
  var mediaCount  = Number(info.media_count||info.edge_hashtag_to_media&&info.edge_hashtag_to_media.count||0);
  var recentCount = (info.edge_hashtag_to_media&&info.edge_hashtag_to_media.edges||[]).length;
  var topCount    = (info.edge_hashtag_to_top_posts&&info.edge_hashtag_to_top_posts.edges||[]).length;

  return {
    ok:          true,
    tag:         tag,
    mediaCount:  mediaCount,
    recentCount: recentCount,
    topCount:    topCount,
    hasTopMedia: topCount>0
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TikTok via RapidAPI
// host: tiktok-api23.p.rapidapi.com
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function fetchTikTok(keyword){
  var key = process.env.RAPIDAPI_KEY;
  if(!key) return {ok:false, error:'RAPIDAPI_KEY 없음'};

  var host = 'tiktok-api-fast-reliable-data-scraper.p.rapidapi.com';
  var headers = {
    'x-rapidapi-key':  key,
    'x-rapidapi-host': host
  };

  var r = await httpGet(host,
    '/search/keyword?keyword='+encodeURIComponent(keyword)+'&count=20', headers);
  if(!r||r.status!==200||!r.data) return {ok:false, error:'TikTok API 실패 '+(r?r.status:'timeout')};

  var items = r.data.data||r.data.item_list||r.data.videos||r.data.result||[];
  if(!Array.isArray(items)||!items.length) return {ok:true, videoCount:0, avgViews:0, shortRatio:0};

  var totalViews=0, shorts=0;
  items.forEach(function(v){
    totalViews += Number(v.stats&&v.stats.playCount||v.play_count||v.playCount||0);
    var dur = Number(v.video&&v.video.duration||v.duration||0);
    if(dur>0&&dur<=60) shorts++;
  });

  return {
    ok:          true,
    videoCount:  items.length,
    avgViews:    Math.round(totalViews/items.length),
    totalViews:  totalViews,
    shortRatio:  Math.round((shorts/items.length)*100)
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 점수 계산
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function calcScore(yt, ig, tt){
  var score = 0;

  if(yt.ok){
    score += Math.min(yt.avgViews/100000, 1) * 30;  // YouTube 조회수 30점
    score += Math.min(yt.recentCount/20,  1) * 15;  // YouTube 최근성 15점
    score += Math.min(yt.shortsRatio/100, 1) * 15;  // 쇼츠 비율 15점
  }

  if(ig.ok){
    var igS = 0;
    if(ig.mediaCount>10000) igS+=5;
    if(ig.recentCount>0)    igS+=5;
    if(ig.hasTopMedia)      igS+=5;
    score += Math.min(igS, 15);                      // Instagram 15점
  }

  if(tt.ok){
    score += Math.min(tt.avgViews/50000, 1) * 10;   // TikTok 조회수 10점
    score += Math.min(tt.videoCount/20,  1) * 5;    // TikTok 영상수 5점
  }

  // 반복 등장 10점
  var srcs = [yt.ok&&yt.videoCount>0, ig.ok&&ig.recentCount>0, tt.ok&&tt.videoCount>0].filter(Boolean).length;
  score += srcs>=3?10:srcs>=2?5:0;

  var total = Math.round(Math.min(score, 100));
  var grade = total>=80?'S':total>=60?'A':total>=40?'B':'C';

  var tags=[], reasons=[];
  if(yt.ok&&yt.avgViews>50000){tags.push('🔥 급상승'); reasons.push('YouTube 평균 '+fmtN(yt.avgViews)+'회');}
  if(yt.ok&&yt.shortsRatio>50){tags.push('🎬 쇼츠 적합'); reasons.push('쇼츠 비율 '+yt.shortsRatio+'%');}
  if(ig.ok&&ig.recentCount>0) {tags.push('📱 SNS 반응'); reasons.push('Instagram 게시물 '+ig.mediaCount.toLocaleString()+'개');}
  if(tt.ok&&tt.avgViews>10000) reasons.push('TikTok 평균 '+fmtN(tt.avgViews)+'회');
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
    youtube:   !!process.env.YOUTUBE_API_KEY,
    instagram: !!process.env.RAPIDAPI_KEY,
    tiktok:    !!process.env.RAPIDAPI_KEY
  };

  try{
    var results=[];
    for(var i=0;i<keywords.length;i+=2){
      var batch=keywords.slice(i,i+2);
      var bRes=await Promise.allSettled(batch.map(async function(kw){
        var yt = envStatus.youtube   ? await fetchYouTube(kw)   : {ok:false,error:'키 없음'};
        var ig = envStatus.instagram ? await fetchInstagram(kw) : {ok:false,error:'키 없음'};
        var tt = envStatus.tiktok    ? await fetchTikTok(kw)    : {ok:false,error:'키 없음'};
        return {keyword:kw, score:calcScore(yt,ig,tt), youtube:yt, instagram:ig, tiktok:tt};
      }));
      bRes.forEach(function(r){if(r.status==='fulfilled') results.push(r.value);});
    }

    results.sort(function(a,b){return b.score.total-a.score.total;});

    var data={
      results:results, total:results.length,
      top3:results.slice(0,3),
      envStatus:envStatus,
      keywordSource:'trend_tab',
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
