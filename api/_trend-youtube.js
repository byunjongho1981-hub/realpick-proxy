var https = require('https');
var CFG   = require('./_trend-config');

function safeNum(v){ return isNaN(Number(v)) ? 0 : Number(v); }

function ytGet(path, params){
  return new Promise(function(resolve, reject){
    var qs = Object.keys(params).map(function(k){
      return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);
    }).join('&');
    var t = setTimeout(function(){ reject(new Error('youtube timeout')); }, CFG.TIMEOUT);
    var req = https.request({
      hostname:'www.googleapis.com',
      path:path+'?'+qs, method:'GET', headers:{}
    }, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end', function(){
        clearTimeout(t);
        try{ resolve(JSON.parse(raw)); }catch(e){ resolve({}); }
      });
    });
    req.on('error',function(e){clearTimeout(t); reject(e);});
    req.end();
  });
}

// 게시 후 시간(시간) 계산
function hoursSince(publishedAt){
  try{
    var diff = Date.now() - new Date(publishedAt).getTime();
    return Math.max(diff / (1000*60*60), 1);
  }catch(e){ return 24; }
}

// viralScore = (조회수 + 3*좋아요 + 5*댓글) / 게시 후 시간
function calcViralScore(views, likes, comments, publishedAt){
  var h = hoursSince(publishedAt);
  return Math.round((safeNum(views) + 3*safeNum(likes) + 5*safeNum(comments)) / h);
}

// Shorts 여부 추정 (제목/설명에 #shorts 또는 영상 길이 60초 이하)
function isShorts(title, desc, duration){
  if(!title&&!desc&&!duration) return false;
  var text = (title||'')+(desc||'');
  if(/\#shorts|\#short/i.test(text)) return true;
  // duration: PT1M30S 형식 파싱
  if(duration){
    var m = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if(m){
      var secs = safeNum(m[1])*3600 + safeNum(m[2])*60 + safeNum(m[3]);
      if(secs <= 60) return true;
    }
  }
  return false;
}

// 쇼츠 적합성 — 시각적 변화, 사용 전후, 비교 가능 여부
function assessShortsCompatibility(titles){
  var signals = ['전후','변화','비교','써봤','사용','개봉','리뷰','테스트','효과','비포'];
  var hit = 0;
  signals.forEach(function(s){
    if(titles.some(function(t){ return t.indexOf(s)>-1; })) hit++;
  });
  return hit >= 2;
}

// 블로그 적합성 — 정보성, 설명형 콘텐츠
function assessBlogCompatibility(titles){
  var signals = ['추천','비교','장단점','방법','후기','가이드','총정리','완벽정리','리뷰'];
  var hit = 0;
  signals.forEach(function(s){
    if(titles.some(function(t){ return t.indexOf(s)>-1; })) hit++;
  });
  return hit >= 2;
}

// ── 단일 키워드 YouTube 분석 ─────────────────────────────────
async function fetchYouTubeData(keyword){
  var key = process.env.YOUTUBE_API_KEY;
  if(!key) return null;
  try{
    // 최근 14일 검색
    var since = new Date(); since.setDate(since.getDate()-14);
    var searchRes = await ytGet('/youtube/v3/search', {
      part:'snippet', type:'video', order:'viewCount',
      q: encodeURIComponent(keyword+' 추천 리뷰'),
      publishedAfter: since.toISOString(),
      regionCode:'KR', maxResults:20,
      key: key,
    });
    if(!searchRes || !searchRes.items || !searchRes.items.length){
      return { recentCount:0, avgViralScore:0, hasShorts:false, isShortsCompatible:false, isBlogCompatible:false, topVideos:[] };
    }
    var items      = searchRes.items;
    var videoIds   = items.map(function(i){ return i.id&&i.id.videoId; }).filter(Boolean).join(',');
    var statsRes   = videoIds ? await ytGet('/youtube/v3/videos', {
      part:'statistics,contentDetails', id:videoIds, key:key,
    }) : { items:[] };

    var statsMap = {};
    (statsRes.items||[]).forEach(function(v){ statsMap[v.id] = v; });

    var viralScores = [];
    var hasShorts   = false;
    var topVideos   = [];
    items.forEach(function(item){
      var vid     = item.id&&item.id.videoId;
      var snippet = item.snippet||{};
      var stat    = statsMap[vid];
      if(!stat) return;
      var views    = safeNum(stat.statistics&&stat.statistics.viewCount);
      var likes    = safeNum(stat.statistics&&stat.statistics.likeCount);
      var comments = safeNum(stat.statistics&&stat.statistics.commentCount);
      var dur      = stat.contentDetails&&stat.contentDetails.duration;
      var pub      = snippet.publishedAt;
      var viral    = calcViralScore(views, likes, comments, pub);
      viralScores.push(viral);
      if(isShorts(snippet.title, snippet.description, dur)) hasShorts = true;
      topVideos.push({ title:snippet.title||'', views, likes, viral, videoId:vid });
    });

    topVideos.sort(function(a,b){return b.viral-a.viral;});
    var titles = items.map(function(i){return (i.snippet&&i.snippet.title)||'';});

    return {
      recentCount:       items.length,
      avgViralScore:     viralScores.length ? Math.round(viralScores.reduce(function(s,v){return s+v;},0)/viralScores.length) : 0,
      maxViralScore:     viralScores.length ? Math.max.apply(null,viralScores) : 0,
      hasShorts:         hasShorts,
      isShortsCompatible: assessShortsCompatibility(titles),
      isBlogCompatible:   assessBlogCompatibility(titles),
      topVideos:         topVideos.slice(0,3),
    };
  }catch(e){
    console.error('[youtube]', keyword, e.message);
    return null;
  }
}

// ── 배치 처리 ────────────────────────────────────────────────
async function fetchYouTubeBatch(keywords){
  var results = {};
  for(var i=0; i<keywords.length; i++){
    results[keywords[i]] = await fetchYouTubeData(keywords[i]);
    if(i < keywords.length-1) await new Promise(function(r){setTimeout(r,300);});
  }
  return results;
}

module.exports = { fetchYouTubeData, fetchYouTubeBatch };
