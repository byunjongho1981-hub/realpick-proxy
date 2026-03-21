// api/hot-analyze.js
var https = require('https');

// ── HTTP 헬퍼 ──────────────────────────────────────────────────
function naverGet(path, params) {
  return new Promise(function(resolve, reject) {
    var qs = Object.keys(params).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var t = setTimeout(function() { reject(new Error('NAVER_TIMEOUT')); }, 10000);
    var req = https.request({
      hostname: 'openapi.naver.com', path: path + '?' + qs, method: 'GET',
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
      }
    }, function(res) {
      var raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() {
        clearTimeout(t);
        try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); }
      });
    });
    req.on('error', function(e) { clearTimeout(t); reject(e); });
    req.end();
  });
}

function naverPost(body) {
  return new Promise(function(resolve, reject) {
    var buf = Buffer.from(JSON.stringify(body), 'utf8');
    var t = setTimeout(function() { reject(new Error('DATALAB_TIMEOUT')); }, 10000);
    var req = https.request({
      hostname: 'openapi.naver.com', path: '/v1/datalab/search', method: 'POST',
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
        'Content-Type': 'application/json',
        'Content-Length': buf.length
      }
    }, function(res) {
      var raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() {
        clearTimeout(t);
        try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); }
      });
    });
    req.on('error', function(e) { clearTimeout(t); reject(e); });
    req.write(buf); req.end();
  });
}

function ytGet(path) {
  return new Promise(function(resolve, reject) {
    var t = setTimeout(function() { reject(new Error('YT_TIMEOUT')); }, 10000);
    https.get('https://www.googleapis.com' + path, function(res) {
      var raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() {
        clearTimeout(t);
        try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); }
      });
    }).on('error', function(e) { clearTimeout(t); reject(e); });
  });
}

function groqPost(messages) {
  return new Promise(function(resolve, reject) {
    var buf = Buffer.from(JSON.stringify({
      model: 'llama3-8b-8192', messages: messages, max_tokens: 250, temperature: 0.3
    }), 'utf8');
    var t = setTimeout(function() { reject(new Error('GROQ_TIMEOUT')); }, 15000);
    var req = https.request({
      hostname: 'api.groq.com', path: '/openai/v1/chat/completions', method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': buf.length
      }
    }, function(res) {
      var raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() {
        clearTimeout(t);
        try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); }
      });
    });
    req.on('error', function(e) { clearTimeout(t); reject(e); });
    req.write(buf); req.end();
  });
}

// ── 유틸 ──────────────────────────────────────────────────────
function parseDuration(d) {
  if (!d) return 0;
  var m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1]||0)*3600 + parseInt(m[2]||0)*60 + parseInt(m[3]||0));
}
function clean(t) {
  return String(t||'').replace(/<[^>]+>/g,'').replace(/[^\w가-힣\s]/g,' ').replace(/\s+/g,' ').trim();
}
function sn(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function fmtDate(d) {
  var pad = function(n) { return String(n).padStart(2,'0'); };
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}

// ── YouTube 분석 ──────────────────────────────────────────────
async function analyzeYouTube(keyword) {
  var key = process.env.YOUTUBE_API_KEY;
  var empty = { videoCount:0, avgViews:0, shortsRatio:0, channelRepeat:0, totalChannels:0, topVideos:[], apiStatus:'NO_KEY' };
  if (!key) return empty;

  try {
    // 최근 7일
    var ago7 = new Date(); ago7.setDate(ago7.getDate()-7);
    var searchUrl = '/youtube/v3/search'
      + '?part=snippet'
      + '&q=' + encodeURIComponent(keyword)
      + '&type=video'
      + '&publishedAfter=' + encodeURIComponent(ago7.toISOString())
      + '&maxResults=50'
      + '&order=viewCount'
      + '&relevanceLanguage=ko'
      + '&key=' + key;

    var sd = await ytGet(searchUrl).catch(function(e) { return {_err: e.message}; });

    // API 오류 감지
    if (sd.error) {
      console.error('[YT search error]', JSON.stringify(sd.error));
      return Object.assign({}, empty, { apiStatus: 'API_ERROR: ' + (sd.error.message||'unknown') });
    }

    var items = sd.items || [];
    if (!items.length) {
      // publishedAfter 없이 재시도 (최근 영상이 없는 경우)
      var sd2 = await ytGet(
        '/youtube/v3/search?part=snippet&q='+encodeURIComponent(keyword)+'&type=video&maxResults=20&order=viewCount&relevanceLanguage=ko&key='+key
      ).catch(function(){return {};});
      items = sd2.items || [];
      if (!items.length) return Object.assign({}, empty, { apiStatus: 'NO_RESULTS' });
    }

    var ids = items.map(function(i) { return i.id && i.id.videoId; }).filter(Boolean).slice(0,50).join(',');
    var vd = await ytGet(
      '/youtube/v3/videos?part=statistics,contentDetails,snippet&id='+ids+'&key='+key
    ).catch(function(){return {};});
    var vids = vd.items || [];

    var totalViews=0, shorts=0, channels={};
    vids.forEach(function(v) {
      totalViews += sn((v.statistics||{}).viewCount);
      if (parseDuration((v.contentDetails||{}).duration) <= 60) shorts++;
    });
    items.forEach(function(i) {
      var ch = (i.snippet||{}).channelId;
      if (ch) channels[ch] = (channels[ch]||0)+1;
    });

    // 상위 5개 영상
    var topVideos = vids.slice(0,5).map(function(v) {
      var sp = v.snippet||{}, st = v.statistics||{}, cd = v.contentDetails||{};
      var dur = parseDuration(cd.duration);
      var thumb = sp.thumbnails
        ? ((sp.thumbnails.medium||sp.thumbnails.high||sp.thumbnails.default)||{}).url||''
        : '';
      return {
        id: v.id,
        title: sp.title || '',
        channel: sp.channelTitle || '',
        thumbnail: thumb,
        views: sn(st.viewCount),
        likes: sn(st.likeCount),
        duration: dur,
        isShorts: dur > 0 && dur <= 60,
        publishedAt: (sp.publishedAt||'').slice(0,10),
        url: 'https://www.youtube.com/watch?v=' + v.id
      };
    });

    return {
      videoCount: items.length,
      avgViews: vids.length ? Math.round(totalViews/vids.length) : 0,
      shortsRatio: vids.length ? shorts/vids.length : 0,
      channelRepeat: Object.values(channels).filter(function(c){return c>1;}).length,
      totalChannels: Object.keys(channels).length,
      totalViews: totalViews,
      topVideos: topVideos,
      apiStatus: 'OK'
    };
  } catch(e) {
    console.error('[YT error]', e.message);
    return Object.assign({}, empty, { apiStatus: 'ERROR: '+e.message });
  }
}

// ── 네이버 블로그 분석 ─────────────────────────────────────────
async function analyzeBlog(keyword) {
  try {
    var d = await naverGet('/v1/search/blog.json', { query: keyword+' 리뷰 후기', display: 30, sort: 'date' });
    var items = d.items || [];
    var rKw = ['리뷰','후기','추천','비교','솔직'];
    var cnt = items.filter(function(i) {
      var t = clean(i.title||'')+' '+clean(i.description||'');
      return rKw.some(function(w){return t.indexOf(w)>-1;});
    }).length;
    return { total: sn(d.total), reviewRatio: items.length ? cnt/items.length : 0, recentCount: items.length, apiStatus: 'OK' };
  } catch(e) {
    return { total:0, reviewRatio:0, recentCount:0, apiStatus: 'ERROR' };
  }
}

// ── 네이버 쇼핑 분석 ──────────────────────────────────────────
async function analyzeShopping(keyword) {
  try {
    var d = await naverGet('/v1/search/shop.json', { query: keyword, display: 40, sort: 'sim' });
    var items = d.items || [];
    var prices = items.map(function(i){return sn(i.lprice);}).filter(function(p){return p>0;});
    return {
      total: sn(d.total), itemCount: items.length,
      avgPrice: prices.length ? Math.round(prices.reduce(function(a,b){return a+b;},0)/prices.length) : 0,
      minPrice: prices.length ? Math.min.apply(null,prices) : 0,
      maxPrice: prices.length ? Math.max.apply(null,prices) : 0,
      apiStatus: 'OK'
    };
  } catch(e) {
    return { total:0, itemCount:0, avgPrice:0, minPrice:0, maxPrice:0, apiStatus:'ERROR' };
  }
}

// ── 네이버 데이터랩 ───────────────────────────────────────────
// ★ endDate를 어제로 설정 (오늘 날짜는 Naver가 거부하는 경우 있음)
async function analyzeDatalab(keyword) {
  try {
    var now  = new Date();
    var yest = new Date(now); yest.setDate(now.getDate()-1); // 어제
    var ago14= new Date(now); ago14.setDate(now.getDate()-15);// 15일 전

    var body = {
      startDate: fmtDate(ago14),
      endDate:   fmtDate(yest),
      timeUnit:  'date',
      keywordGroups: [{ groupName: keyword, keywords: [keyword] }]
    };

    var d = await naverPost(body);

    // 오류 응답 감지
    if (d.errorCode) {
      console.error('[Datalab error]', d.errorCode, d.errorMessage);
      return { surgeRate:0, surge3d:0, surge7d:0, trend:'unknown', avgRatio:0, apiStatus:'ERROR:'+d.errorCode };
    }

    var pts = ((d.results||[])[0]||{}).data||[];
    if (pts.length < 6) {
      return { surgeRate:0, surge3d:0, surge7d:0, trend:'unknown', avgRatio:0, apiStatus:'INSUFFICIENT:'+pts.length };
    }

    var avg = function(a) {
      return a.reduce(function(s,p){return s+sn(p.ratio);},0) / (a.length||1);
    };

    // 7일 변화: 전반부 vs 후반부
    var h = Math.floor(pts.length/2);
    var pa = avg(pts.slice(0,h)), ca = avg(pts.slice(h));
    var surge7d = pa>0 ? Math.round(((ca-pa)/pa)*100) : (ca>0?100:0);

    // 3일 변화: 최근 3일 vs 직전 3일
    var last3 = pts.slice(-3), prev3 = pts.slice(-6,-3);
    var l3 = avg(last3), p3 = avg(prev3);
    var surge3d = p3>0 ? Math.round(((l3-p3)/p3)*100) : (l3>0?100:0);

    var trend = surge7d>=30?'rising' : surge7d>=10?'growing' : surge7d>=-10?'stable' : 'falling';

    return {
      surgeRate: surge7d, surge3d: surge3d, surge7d: surge7d,
      trend: trend, avgRatio: Math.round(ca*10)/10,
      apiStatus: 'OK', dataPoints: pts.length
    };
  } catch(e) {
    console.error('[Datalab error]', e.message);
    return { surgeRate:0, surge3d:0, surge7d:0, trend:'unknown', avgRatio:0, apiStatus:'ERROR:'+e.message };
  }
}

// ── 점수 계산 ──────────────────────────────────────────────────
function calcScore(yt, blog, shop, dl) {
  var s = {};
  var surge = dl.surgeRate||0;
  s.trend   = surge>=30?25 : surge>=15?20 : surge>=5?15 : surge>=0?10 : surge>=-10?5 : 0;
  var av    = yt.avgViews||0;
  s.views   = av>=500000?20 : av>=100000?17 : av>=50000?14 : av>=10000?10 : av>=1000?6 : av>0?3 : 0;
  s.shorts  = Math.round((yt.shortsRatio||0)*15);
  var si=shop.itemCount||0, sr=blog.reviewRatio||0;
  s.sales   = (si>=100?10 : si>=30?7 : si>=5?4 : si>0?2 : 0) + Math.round(sr*10);
  var vc    = yt.videoCount||0;
  s.compete = vc===0?10 : vc<=5?9 : vc<=15?7 : vc<=30?5 : vc<=50?3 : 1;
  s.timing  = dl.trend==='rising'?10 : dl.trend==='growing'?8 : dl.trend==='stable'?5 : 2;
  if (s.compete>=7 && dl.trend==='rising') s.timing = Math.min(10, s.timing+2);
  var total = s.trend+s.views+s.shorts+s.sales+s.compete+s.timing;
  return { total: Math.min(100,total), breakdown: s, grade: total>=75?'A':total>=55?'B':'C' };
}

// ── 판단 ──────────────────────────────────────────────────────
function judge(yt, blog, shop, dl) {
  var surge=dl.surgeRate||0, vc=yt.videoCount||0, av=yt.avgViews||0;
  var trendStatus = surge>=30&&vc>=5?'rising' : surge>=10||(vc>=10&&av>=5000)?'spreading' : surge>=-10?'plateau' : 'falling';
  var si=shop.itemCount||0, sr=blog.reviewRatio||0;
  var salesType   = si>=30&&sr>=0.4?'sell' : si>=5||sr>=0.3?'mixed' : 'info';
  var competition = vc<=10?'low' : vc<=30?'medium' : 'high';
  var timing      = (trendStatus==='rising'||trendStatus==='spreading')&&competition!=='high'?'now' : trendStatus==='plateau'?'wait' : 'late';
  var sr2=yt.shortsRatio||0;
  var shortsfit   = sr2>=0.5&&av>=10000?'great' : sr2>=0.3||av>=3000?'ok' : 'bad';

  var decision;
  if (salesType==='sell'&&(trendStatus==='rising'||trendStatus==='spreading')&&competition==='low') decision='go';
  else if (salesType==='sell'&&competition!=='low') decision='conditional';
  else if (trendStatus==='plateau'||trendStatus==='spreading') decision='wait';
  else decision='no';

  // 경쟁도 이유
  var competeReasons = [];
  if      (vc>=50)  competeReasons.push('최근 7일 영상 '+vc+'개 — 포화 수준');
  else if (vc>=30)  competeReasons.push('최근 7일 영상 '+vc+'개 — 경쟁 높음');
  else if (vc>=10)  competeReasons.push('최근 7일 영상 '+vc+'개 — 중간 경쟁');
  else if (vc<=5)   competeReasons.push('최근 7일 영상 '+vc+'개 — 진입 여유');

  if ((yt.channelRepeat||0)>=3) competeReasons.push('상위 채널 반복 등장 '+yt.channelRepeat+'회 — 특정 채널 독점');
  else if ((yt.channelRepeat||0)===0) competeReasons.push('채널 집중도 낮음 — 분산된 경쟁');
  else competeReasons.push('채널 반복 '+yt.channelRepeat+'회 — 일부 채널 우세');

  if (av>=500000)        competeReasons.push('평균 조회수 '+Math.round(av/10000)+'만 — 고관심 시장');
  else if (av>=10000)    competeReasons.push('평균 조회수 '+Math.round(av/1000)+'천 — 중간 관심');
  else if (av<1000&&vc>10) competeReasons.push('영상 많지만 평균 조회수 낮음 — 반응 약한 시장');

  if (competeReasons.length < 2) competeReasons.push('채널 수 '+(yt.totalChannels||vc)+'개 — 기준 판단');

  return {
    trendStatus, salesType, competition, timing, shortsfit, decision,
    competeReasons: competeReasons.slice(0,3),
    timingData: { surge3d: dl.surge3d||0, surge7d: dl.surge7d||0, trend: dl.trend||'unknown' }
  };
}

// ── Groq 추천 이유 ─────────────────────────────────────────────
async function getGroqReason(kw, yt, blog, shop, dl, score, jdg) {
  if (!process.env.GROQ_API_KEY) return null;
  try {
    var prompt =
      '아래 데이터를 보고 한국어로 추천 이유를 2줄 이내로 작성하라.\n'+
      '반드시 "수치/지표 포함 + 원인 → 결론" 구조로 작성하라.\n'+
      '예시: "조회수 평균 12만 + 쇼츠 비율 80% → 콘텐츠 제작 유리"\n'+
      '예시: "네이버 쇼핑 40개 + 고경쟁 → 신규 진입 주의"\n---\n'+
      '키워드: '+kw+'\n'+
      'YT영상수: '+yt.videoCount+'개 | 평균조회수: '+yt.avgViews+' | 쇼츠비율: '+Math.round((yt.shortsRatio||0)*100)+'%\n'+
      '쇼핑상품: '+shop.itemCount+'개 | 리뷰비율: '+Math.round((blog.reviewRatio||0)*100)+'%\n'+
      '검색량3일: '+(dl.surge3d>=0?'+':'')+dl.surge3d+'% | 7일: '+(dl.surge7d>=0?'+':'')+dl.surge7d+'%\n'+
      '트렌드: '+jdg.trendStatus+' | 경쟁: '+jdg.competition+' | 타이밍: '+jdg.timing+' | 점수: '+score.total+'\n---\n'+
      '출력: 추천 이유만. 기호/번호 없이.';
    var d = await groqPost([{role:'user',content:prompt}]);
    var t = (((d.choices||[])[0]||{}).message||{}).content;
    return t ? t.trim().replace(/^["']|["']$/g,'').slice(0,120) : null;
  } catch(e) { return null; }
}

// ── 후보 키워드 추출 ──────────────────────────────────────────
async function extractCandidates(seedKw) {
  try {
    var d = await naverGet('/v1/search/shop.json', { query: seedKw, display: 40, sort: 'sim' });
    var stop = new Set([
      '이','가','을','를','의','에','는','은','도','와','과','로','으로','에서','부터','까지','만','라','이라',
      '블랙','화이트','레드','블루','그린','옐로우','핑크','실버','골드','베이지','그레이','네이비','브라운','퍼플','오렌지',
      '검정','흰색','빨강','파랑','초록','노랑','분홍','회색','하늘','남색',
      '가벼운','튼튼한','편한','편안한','슬림','스마트','프리미엄','고급','특가','신상',
      '세트','상품','제품','판매','추천','구매','할인','무료','배송','당일','정품','공식','브랜드','인기','최신','신제품',
      '스타일','디자인','사이즈','색상','옵션','모델','버전','에디션','패키지','구성','포함','1개','2개','3개'
    ]);
    var freq = {};
    (d.items||[]).forEach(function(item) {
      clean(item.title||'').split(/\s+/).filter(function(w) {
        return w.length>=3 && !stop.has(w) && w!==seedKw && /[가-힣]{2,}/.test(w) && !/^\d+$/.test(w);
      }).forEach(function(w){ freq[w]=(freq[w]||0)+1; });
    });
    var related = Object.entries(freq).sort(function(a,b){return b[1]-a[1];}).slice(0,9).map(function(e){return e[0];});
    var out = [seedKw];
    related.forEach(function(kw){ if(out.indexOf(kw)<0) out.push(kw); });
    return out.slice(0,10);
  } catch(e) { return [seedKw]; }
}

// ── Main ───────────────────────────────────────────────────────
module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if (req.method==='OPTIONS') return res.status(200).end();

  var keyword = String(req.query.keyword||'').trim().slice(0,30);
  if (!keyword) return res.status(400).json({error:'키워드를 입력해주세요'});

  var envCheck = {
    NAVER:   !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET),
    YOUTUBE: !!process.env.YOUTUBE_API_KEY,
    GROQ:    !!process.env.GROQ_API_KEY
  };

  try {
    var candidates = await extractCandidates(keyword);

    // ── Phase 1: 네이버만으로 전체 후보 점수 계산 (YouTube/Datalab 없이)
    var BATCH = 3;
    var phase1 = [];
    for (var i=0; i<candidates.length; i+=BATCH) {
      var chunk = candidates.slice(i,i+BATCH);
      var settled = await Promise.allSettled(chunk.map(async function(kw) {
        var [blog, shop] = await Promise.all([analyzeBlog(kw), analyzeShopping(kw)]);
        return { kw, blog, shop };
      }));
      settled.forEach(function(r){ if(r.status==='fulfilled') phase1.push(r.value); });
      if (i+BATCH < candidates.length) await sleep(150);
    }

    // 네이버 점수로 1차 정렬 → 상위 5개만 YouTube + Datalab 호출
    var TOP_N = 5;
    phase1.sort(function(a,b){
      var sa = (a.shop.itemCount||0)*2 + Math.round((a.blog.reviewRatio||0)*10);
      var sb = (b.shop.itemCount||0)*2 + Math.round((b.blog.reviewRatio||0)*10);
      return sb-sa;
    });

    var topKws  = phase1.slice(0, TOP_N).map(function(r){return r.kw;});
    var restKws = phase1.slice(TOP_N).map(function(r){return r.kw;});

    // ── Phase 2: 상위 5개만 YouTube + Datalab 호출
    var ytMap={}, dlMap={};
    for (var j=0; j<topKws.length; j++) {
      var kw = topKws[j];
      var [yt, dl] = await Promise.all([analyzeYouTube(kw), analyzeDatalab(kw)]);
      ytMap[kw] = yt;
      dlMap[kw] = dl;
      if (j < topKws.length-1) await sleep(200);
    }

    // 나머지는 YouTube/Datalab 빈 값
    var emptyYt = { videoCount:0, avgViews:0, shortsRatio:0, channelRepeat:0, totalChannels:0, topVideos:[], apiStatus:'SKIPPED' };
    var emptyDl = { surgeRate:0, surge3d:0, surge7d:0, trend:'unknown', avgRatio:0, apiStatus:'SKIPPED' };
    restKws.forEach(function(kw){ ytMap[kw]=emptyYt; dlMap[kw]=emptyDl; });

    // ── 전체 결과 조합
    var results = phase1.map(function(r){
      var yt    = ytMap[r.kw]  || emptyYt;
      var dl    = dlMap[r.kw]  || emptyDl;
      var score = calcScore(yt, r.blog, r.shop, dl);
      var jdg   = judge(yt, r.blog, r.shop, dl);
      return { kw:r.kw, yt, blog:r.blog, shop:r.shop, dl, score, jdg };
    });

    results.sort(function(a,b){ return b.score.total - a.score.total; });

    // ── Groq: 상위 5개만
    await Promise.allSettled(results.slice(0,5).map(async function(r){
      r.aiReason = await getGroqReason(r.kw, r.yt, r.blog, r.shop, r.dl, r.score, r.jdg);
    }));

    var out = results.map(function(r){
      return {
        id: r.kw, name: r.kw,
        score: r.score, judge: r.jdg,
        aiReason: r.aiReason || null,
        apiStatus: {
          youtube:  r.yt.apiStatus  || 'unknown',
          datalab:  r.dl.apiStatus  || 'unknown',
          blog:     r.blog.apiStatus || 'unknown',
          shopping: r.shop.apiStatus || 'unknown'
        },
        data: {
          youtube:  { videoCount:r.yt.videoCount, avgViews:r.yt.avgViews, shortsRatio:Math.round((r.yt.shortsRatio||0)*100), channelRepeat:r.yt.channelRepeat, totalChannels:r.yt.totalChannels, topVideos:r.yt.topVideos||[] },
          blog:     { total:r.blog.total, reviewRatio:Math.round((r.blog.reviewRatio||0)*100) },
          shopping: { total:r.shop.total, itemCount:r.shop.itemCount, avgPrice:r.shop.avgPrice },
          datalab:  { surgeRate:r.dl.surgeRate, surge3d:r.dl.surge3d, surge7d:r.dl.surge7d, trend:r.dl.trend, avgRatio:r.dl.avgRatio, dataPoints:r.dl.dataPoints }
        }
      };
    });

    return res.status(200).json({
      keyword, candidates: out, total: out.length,
      envCheck, updatedAt: new Date().toISOString()
    });

  } catch(e) {
    console.error('[hot-analyze]', e.message);
    return res.status(500).json({ error:'분석 중 오류 발생', detail:e.message, envCheck });
  }
};
