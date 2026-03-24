var https = require('https');
var CFG   = require('./_trend-config');

function safeNum(v){ return isNaN(Number(v)) ? 0 : Number(v); }

// ★ 버그1 수정: ytGet 내부에서만 encodeURIComponent 처리
// 호출 시 파라미터 값을 미리 인코딩하지 말 것
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

function hoursSince(publishedAt){
  try{
    var diff = Date.now() - new Date(publishedAt).getTime();
    return Math.max(diff / (1000*60*60), 1);
  }catch(e){ return 24; }
}

function calcViralScore(views, likes, comments, publishedAt){
  var h = hoursSince(publishedAt);
  return Math.round((safeNum(views) + 3*safeNum(likes) + 5*safeNum(comments)) / h);
}

function isShorts(title, desc, duration){
  if(!title && !desc && !duration) return false;
  if(/\#shorts|\#short/i.test((title||'')+(desc||''))) return true;
  if(duration){
    var m = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if(m){
      var secs = safeNum(m[1])*3600 + safeNum(m[2])*60 + safeNum(m[3]);
      if(secs <= 60) return true;
    }
  }
  return false;
}

function assessShortsCompatibility(titles){
  var signals = ['전후','변화','비교','써봤','사용','개봉','리뷰','테스트','효과','비포','해봤','써보'];
  var hit = 0;
  signals.forEach(function(s){
    if(titles.some(function(t){ return t.indexOf(s)>-1; })) hit++;
  });
  return hit >= 2;
}

function assessBlogCompatibility(titles){
  var signals = ['추천','비교','장단점','방법','후기','가이드','총정리','완벽정리','리뷰','선택','어떤'];
  var hit = 0;
  signals.forEach(function(s){
    if(titles.some(function(t){ return t.indexOf(s)>-1; })) hit++;
  });
  return hit >= 2;
}

async function fetchYouTubeData(keyword){
  var key = process.env.YOUTUBE_API_KEY;
  if(!key) return null;
  try{
    var since = new Date(); since.setDate(since.getDate()-14);

    // ★ 버그1 수정: q 값을 인코딩 없이 전달 (ytGet이 내부에서 처리)
    var searchRes = await ytGet('/youtube/v3/search', {
      part:           'snippet',
      type:           'video',
      order:          'viewCount',
      q:              keyword+' 추천 리뷰',   // 인코딩 금지
      publishedAfter: since.toISOString(),
      regionCode:     'KR',
      maxResults:     20,
      key:            key,
    });

    if(!searchRes || !searchRes.items || !searchRes.items.length){
      return { recentCount:0, avgViralScore:0, hasShorts:false, isShortsCompatible:false, isBlogCompatible:false, topVideos:[] };
    }

    var items    = searchRes.items;
    var videoIds = items.map(function(i){ return i.id&&i.id.videoId; }).filter(Boolean).join(',');

    var statsRes = { items:[] };
    if(videoIds){
      statsRes = await ytGet('/youtube/v3/videos', {
        part: 'statistics,contentDetails',
        id:   videoIds,
        key:  key,
      });
    }

    var statsMap = {};
    (statsRes.items||[]).forEach(function(v){ statsMap[v.id] = v; });

    var viralScores = [], hasShorts = false, topVideos = [];
    items.forEach(function(item){
      var vid     = item.id&&item.id.videoId;
      var snippet = item.snippet||{};
      var stat    = statsMap[vid];
      if(!stat) return;
      var views    = safeNum(stat.statistics&&stat.statistics.viewCount);
      var likes    = safeNum(stat.statistics&&stat.statistics.likeCount);
      var comments = safeNum(stat.statistics&&stat.statistics.commentCount);
      var dur      = stat.contentDetails&&stat.contentDetails.duration;
      var viral    = calcViralScore(views, likes, comments, snippet.publishedAt);
      viralScores.push(viral);
      if(isShorts(snippet.title, snippet.description, dur)) hasShorts = true;
      topVideos.push({ title:snippet.title||'', views:views, likes:likes, viral:viral, videoId:vid });
    });

    topVideos.sort(function(a,b){ return b.viral-a.viral; });
    var titles = items.map(function(i){ return (i.snippet&&i.snippet.title)||''; });
    var avgViral = viralScores.length
      ? Math.round(viralScores.reduce(function(s,v){return s+v;},0)/viralScores.length)
      : 0;

    return {
      recentCount:        items.length,
      avgViralScore:      avgViral,
      maxViralScore:      viralScores.length ? Math.max.apply(null,viralScores) : 0,
      hasShorts:          hasShorts,
      isShortsCompatible: assessShortsCompatibility(titles),
      isBlogCompatible:   assessBlogCompatibility(titles),
      topVideos:          topVideos.slice(0,3),
    };
  }catch(e){
    console.error('[youtube]', keyword, e.message);
    return null;
  }
}

async function fetchYouTubeBatch(keywords){
  var results = {};
  for(var i=0; i<keywords.length; i++){
    results[keywords[i]] = await fetchYouTubeData(keywords[i]);
    if(i < keywords.length-1) await new Promise(function(r){setTimeout(r,300);});
  }
  return results;
}

module.exports = { fetchYouTubeData, fetchYouTubeBatch };
