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

// Shorts 여부 추정
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

// ★ [8] 3초 내 시각적 훅 가능 여부 판단
// 제품이 화면에 바로 등장하거나 시각적 변화가 명확한지 판단
function assessVisualHook(titles){
  var hookSignals = [
    '개봉','언박싱','써봤','해봤','바르자마자','바로','즉시','3초','1분','
    전후','비포애프터','before after','변화','놀라운','충격','실화','대박',
    '이거 진짜','직접','실제로','솔직히','솔직한',
  ];
  var hit = 0;
  hookSignals.forEach(function(s){
    if(titles.some(function(t){ return t.indexOf(s)>-1; })) hit++;
  });
  return hit >= 2;
}

// ★ [8] 사용 장면이 명확한지 판단
// 언제, 어디서, 어떻게 쓰는지 제목에서 드러나는지
function assessUsageScene(titles){
  var sceneSignals = [
    '출근','집에서','자차','주방','욕실','침실','운전','사무실','운동할 때',
    '할 때','할때','하면서','사용법','사용방법','이렇게','이렇게 쓰면',
    '활용','활용법','실사용','일상','루틴','데일리',
  ];
  var hit = 0;
  sceneSignals.forEach(function(s){
    if(titles.some(function(t){ return t.indexOf(s)>-1; })) hit++;
  });
  return hit >= 2;
}

// Shorts 적합성 — 전후 비교, 시각적 변화
function assessShortsCompatibility(titles){
  var signals = ['전후','변화','비교','써봤','사용','개봉','리뷰','테스트','효과','비포','해봤','써보'];
  var hit = 0;
  signals.forEach(function(s){
    if(titles.some(function(t){ return t.indexOf(s)>-1; })) hit++;
  });
  return hit >= 2;
}

// 블로그 적합성 — 정보성, 설명형
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

    var searchRes = await ytGet('/youtube/v3/search', {
      part:           'snippet',
      type:           'video',
      order:          'viewCount',
      q:              keyword+' 추천 리뷰',
      publishedAfter: since.toISOString(),
      regionCode:     'KR',
      maxResults:     20,
      key:            key,
    });

    if(!searchRes || !searchRes.items || !searchRes.items.length){
      return {
        recentCount:0, avgViralScore:0, hasShorts:false,
        isShortsCompatible:false, isBlogCompatible:false,
        hasVisualHook:false, hasUsageScene:false,     // ★
        topVideos:[],
      };
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

    var viralScores=[], hasShorts=false, topVideos=[];
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
      hasVisualHook:      assessVisualHook(titles),    // ★ [8] 3초 훅
      hasUsageScene:      assessUsageScene(titles),    // ★ [8] 사용 장면
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
