/**
 * /api/sns-hot.js
 * YouTube + Instagram + TikTok 공식 API 기반 SNS 반응 분석
 *
 * 필요 환경변수:
 *   YOUTUBE_API_KEY
 *   INSTAGRAM_ACCESS_TOKEN
 *   TIKTOK_ACCESS_TOKEN
 *
 * 입력: ?keywords=스마트폰,무선이어폰,다이어트식품
 * 키워드는 반드시 트렌드 탐색 탭에서 전달받음 — 여기서 생성 금지
 */

var https = require('https');

var TIMEOUT = 10000;
var CACHE   = {};  // keyword → {data, ts}
var CACHE_TTL = 30 * 60 * 1000; // 30분

// ── HTTP GET 유틸
function httpGet(hostname, path){
  return new Promise(function(resolve){
    var t = setTimeout(function(){resolve(null);}, TIMEOUT);
    https.get({hostname:hostname, path:path, headers:{'User-Agent':'RealPick/1.0'}}, function(res){
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

// ── HTTP POST 유틸
function httpPost(hostname, path, body, headers){
  return new Promise(function(resolve){
    var buf = Buffer.from(JSON.stringify(body));
    var t   = setTimeout(function(){resolve(null);}, TIMEOUT);
    var h   = Object.assign({'Content-Type':'application/json','Content-Length':buf.length}, headers||{});
    var req = https.request({hostname:hostname, path:path, method:'POST', headers:h}, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(t);
        try{resolve({status:res.statusCode, data:JSON.parse(raw)});}
        catch(e){resolve({status:res.statusCode, data:null});}
      });
    });
    req.on('error',function(){clearTimeout(t);resolve(null);});
    req.write(buf);
    req.end();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2단계: YouTube Data API v3
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function fetchYouTube(keyword){
  var key = process.env.YOUTUBE_API_KEY;
  if(!key) return {ok:false, error:'YOUTUBE_API_KEY 없음'};

  var since = new Date();
  since.setDate(since.getDate()-7);
  var publishedAfter = since.toISOString();

  // search.list
  var searchPath = '/youtube/v3/search?part=snippet&type=video&order=date'
    +'&regionCode=KR&maxResults=20'
    +'&publishedAfter='+encodeURIComponent(publishedAfter)
    +'&q='+encodeURIComponent(keyword)
    +'&key='+key;

  var searchRes = await httpGet('www.googleapis.com', searchPath);
  if(!searchRes||searchRes.status!==200||!searchRes.data||!searchRes.data.items){
    return {ok:false, error:'YouTube search 실패 '+( searchRes?searchRes.status:'timeout')};
  }

  var items   = searchRes.data.items||[];
  var videoIds = items.map(function(i){return i.id&&i.id.videoId;}).filter(Boolean).join(',');
  if(!videoIds) return {ok:true, videoCount:0, avgViews:0, shortsRatio:0, channels:[]};

  // videos.list — 통계 + contentDetails
  var videoPath = '/youtube/v3/videos?part=statistics,contentDetails,snippet'
    +'&id='+encodeURIComponent(videoIds)
    +'&key='+key;

  var videoRes = await httpGet('www.googleapis.com', videoPath);
  var videos   = (videoRes&&videoRes.data&&videoRes.data.items)||[];

  var totalViews = 0, shortsCount = 0, channelMap = {};
  videos.forEach(function(v){
    var views = Number((v.statistics||{}).viewCount||0);
    totalViews += views;

    // 쇼츠 판별: 재생시간 60초 이하
    var dur = (v.contentDetails||{}).duration||'';
    var m   = dur.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
    var sec = (m?Number(m[1]||0)*60+Number(m[2]||0):999);
    if(sec<=60) shortsCount++;

    var ch = (v.snippet||{}).channelTitle||'';
    if(ch) channelMap[ch]=(channelMap[ch]||0)+1;
  });

  var avgViews    = videos.length ? Math.round(totalViews/videos.length) : 0;
  var shortsRatio = videos.length ? Math.round((shortsCount/videos.length)*100) : 0;
  var topChannels = Object.entries(channelMap).sort(function(a,b){return b[1]-a[1];}).slice(0,3).map(function(e){return e[0];});

  return {
    ok:          true,
    videoCount:  videos.length,
    avgViews:    avgViews,
    totalViews:  totalViews,
    shortsRatio: shortsRatio,
    topChannels: topChannels,
    recentCount: items.length
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3단계: Instagram Graph API (Hashtag)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function fetchInstagram(keyword){
  var token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if(!token) return {ok:false, error:'INSTAGRAM_ACCESS_TOKEN 없음'};

  var igUserId = process.env.INSTAGRAM_USER_ID;
  if(!igUserId) return {ok:false, error:'INSTAGRAM_USER_ID 없음'};

  var tag = keyword.replace(/\s+/g,'');

  // ig_hashtag_search
  var searchPath = '/v18.0/ig_hashtag_search?user_id='+igUserId
    +'&q='+encodeURIComponent(tag)
    +'&access_token='+token;

  var searchRes = await httpGet('graph.facebook.com', searchPath);
  if(!searchRes||searchRes.status!==200||!searchRes.data||!searchRes.data.data||!searchRes.data.data.length){
    return {ok:false, error:'Instagram hashtag 검색 실패'};
  }

  var hashtagId = searchRes.data.data[0].id;

  // recent_media
  var recentPath = '/v18.0/'+hashtagId+'/recent_media'
    +'?fields=id,media_type,like_count,comments_count,timestamp'
    +'&user_id='+igUserId
    +'&access_token='+token;

  var recentRes = await httpGet('graph.facebook.com', recentPath);
  var recentItems = (recentRes&&recentRes.data&&recentRes.data.data)||[];

  // top_media
  var topPath = '/v18.0/'+hashtagId+'/top_media'
    +'?fields=id,media_type,like_count,comments_count'
    +'&user_id='+igUserId
    +'&access_token='+token;

  var topRes  = await httpGet('graph.facebook.com', topPath);
  var topItems = (topRes&&topRes.data&&topRes.data.data)||[];

  var totalLikes = recentItems.reduce(function(s,i){return s+Number(i.like_count||0);},0);
  var avgLikes   = recentItems.length ? Math.round(totalLikes/recentItems.length) : 0;

  return {
    ok:          true,
    hashtagId:   hashtagId,
    recentCount: recentItems.length,
    topCount:    topItems.length,
    avgLikes:    avgLikes,
    hasTopMedia: topItems.length>0
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4단계: TikTok Research API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function fetchTikTok(keyword){
  var token = process.env.TIKTOK_ACCESS_TOKEN;
  if(!token) return {ok:false, error:'TIKTOK_ACCESS_TOKEN 없음'};

  var now   = new Date();
  var start = new Date(now); start.setDate(start.getDate()-7);
  var fmt   = function(d){return d.toISOString().slice(0,10).replace(/-/g,'');};

  var body = {
    query: {
      and: [
        {operation:'IN', field_name:'keyword', field_values:[keyword]},
        {operation:'EQ', field_name:'region_code', field_values:['KR']}
      ]
    },
    start_date: fmt(start),
    end_date:   fmt(now),
    max_count:  20,
    fields:     ['id','view_count','like_count','share_count','create_time','duration']
  };

  var res = await httpPost(
    'open.tiktokapis.com',
    '/v2/research/video/query/?fields=id,view_count,like_count,share_count,create_time,duration',
    body,
    {'Authorization':'Bearer '+token}
  );

  if(!res||res.status!==200||!res.data||!res.data.data){
    return {ok:false, error:'TikTok API 실패 '+(res?res.status:'timeout')};
  }

  var videos     = res.data.data.videos||[];
  var totalViews = videos.reduce(function(s,v){return s+Number(v.view_count||0);},0);
  var avgViews   = videos.length ? Math.round(totalViews/videos.length) : 0;
  var shortVids  = videos.filter(function(v){return Number(v.duration||0)<=60;}).length;

  return {
    ok:          true,
    videoCount:  videos.length,
    avgViews:    avgViews,
    totalViews:  totalViews,
    shortRatio:  videos.length ? Math.round((shortVids/videos.length)*100) : 0
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5단계: 점수 계산
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function calcScore(yt, ig, tt){
  var score = 0;

  // YouTube 조회수 (30점)
  if(yt.ok){
    score += Math.min(yt.avgViews/100000, 1) * 30;
  }

  // YouTube 최근성 (15점)
  if(yt.ok){
    score += Math.min(yt.recentCount/20, 1) * 15;
  }

  // 쇼츠 비율 (15점)
  if(yt.ok){
    score += Math.min(yt.shortsRatio/100, 1) * 15;
  }

  // Instagram 활동성 (15점)
  if(ig.ok){
    var igScore = 0;
    if(ig.recentCount>0) igScore += 8;
    if(ig.hasTopMedia)   igScore += 4;
    if(ig.avgLikes>100)  igScore += 3;
    score += igScore;
  }

  // TikTok 활동성 (15점)
  if(tt.ok){
    score += Math.min(tt.avgViews/50000, 1) * 10;
    score += Math.min(tt.videoCount/20,  1) * 5;
  }

  // 반복 등장 (10점) — YouTube + TikTok 둘 다 있으면
  if(yt.ok&&tt.ok&&yt.videoCount>0&&tt.videoCount>0) score += 10;
  else if((yt.ok&&yt.videoCount>0)||(tt.ok&&tt.videoCount>0)) score += 5;

  var total = Math.round(Math.min(score, 100));
  var grade = total>=80?'S':total>=60?'A':total>=40?'B':'C';

  // 태그
  var tags = [];
  if(yt.ok && yt.avgViews>50000)    tags.push('🔥 급상승');
  if(yt.ok && yt.shortsRatio>50)    tags.push('🎬 쇼츠 적합');
  if(ig.ok && ig.recentCount>5)     tags.push('📱 SNS 반응');

  // 추천 이유
  var reasons = [];
  if(yt.ok && yt.avgViews>50000)    reasons.push('YouTube 평균 조회수 '+yt.avgViews.toLocaleString()+'회');
  if(yt.ok && yt.shortsRatio>50)    reasons.push('쇼츠 비율 '+yt.shortsRatio+'%');
  if(ig.ok && ig.recentCount>0)     reasons.push('Instagram 최근 게시물 '+ig.recentCount+'개');
  if(tt.ok && tt.avgViews>0)        reasons.push('TikTok 평균 조회수 '+tt.avgViews.toLocaleString()+'회');
  if(!reasons.length)               reasons.push('데이터 수집 완료');

  return {total:total, grade:grade, tags:tags, reason:reasons.slice(0,2).join(' · ')};
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 메인 핸들러
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
module.exports = async function(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();

  // 1단계: 키워드 입력 (트렌드 탐색 탭에서 전달)
  var raw = String(req.query.keywords||'').trim();
  if(!raw) return res.status(400).json({error:'keywords 파라미터 필요 (트렌드 탐색 탭에서 전달)'});

  var keywords = raw.split(',')
    .map(function(k){return k.trim();})
    .filter(function(k){return k.length>0;})
    .filter(function(k,i,a){return a.indexOf(k)===i;}); // 중복 제거

  if(!keywords.length) return res.status(400).json({error:'유효한 키워드 없음'});

  // 캐시 확인
  var cacheKey = keywords.sort().join(',');
  if(CACHE[cacheKey]&&(Date.now()-CACHE[cacheKey].ts<CACHE_TTL)){
    return res.status(200).json(Object.assign({},CACHE[cacheKey].data,{fromCache:true}));
  }

  // 환경변수 확인
  var envStatus = {
    youtube:   !!process.env.YOUTUBE_API_KEY,
    instagram: !!process.env.INSTAGRAM_ACCESS_TOKEN,
    tiktok:    !!process.env.TIKTOK_ACCESS_TOKEN
  };

  try{
    // 2~4단계: 키워드별 병렬 처리 (동시 2개 제한)
    var results = [];
    for(var i=0;i<keywords.length;i+=2){
      var batch = keywords.slice(i,i+2);
      var batchRes = await Promise.allSettled(batch.map(async function(kw){
        var yt = envStatus.youtube   ? await fetchYouTube(kw)   : {ok:false,error:'키 없음'};
        var ig = envStatus.instagram ? await fetchInstagram(kw) : {ok:false,error:'키 없음'};
        var tt = envStatus.tiktok    ? await fetchTikTok(kw)    : {ok:false,error:'키 없음'};
        var sc = calcScore(yt, ig, tt);
        return {keyword:kw, score:sc, youtube:yt, instagram:ig, tiktok:tt};
      }));
      batchRes.forEach(function(r){
        if(r.status==='fulfilled') results.push(r.value);
      });
    }

    // 점수순 정렬
    results.sort(function(a,b){return b.score.total-a.score.total;});

    var data = {
      results:     results,
      total:       results.length,
      top3:        results.slice(0,3),
      envStatus:   envStatus,
      keywordSource: 'trend_tab',
      updatedAt:   new Date().toISOString(),
      fromCache:   false
    };

    CACHE[cacheKey] = {data:data, ts:Date.now()};
    return res.status(200).json(data);

  }catch(e){
    console.error('[sns-hot]',e.message);
    return res.status(500).json({error:'분석 오류', detail:e.message});
  }
};
