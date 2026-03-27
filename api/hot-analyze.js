// api/hot-analyze.js

// ── HTTP 헬퍼 ──────────────────────────────────────────────────
function naverGet(path, params) {
  var qs = Object.keys(params).map(function(k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  return fetch('https://openapi.naver.com' + path + '?' + qs, {
    headers: {
      'X-Naver-Client-Id'    : process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
    },
    signal: AbortSignal.timeout(10000)
  })
  .then(function(r) { return r.json(); })
  .catch(function() { return {}; });
}

function naverPost(path, body) {
  return fetch('https://openapi.naver.com' + path, {
    method : 'POST',
    headers: {
      'X-Naver-Client-Id'    : process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
      'Content-Type'         : 'application/json'
    },
    body  : JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  })
  .then(function(r) { return r.json(); })
  .catch(function() { return {}; });
}

function ytGet(path) {
  return fetch('https://www.googleapis.com' + path, {
    signal: AbortSignal.timeout(10000)
  })
  .then(function(r) {
    if (r.status === 403) return { error: { code: 403, message: 'forbidden' } };
    if (r.status === 400) return { error: { code: 400, message: 'bad_request' } };
    return r.json();
  })
  .catch(function(e) { return { error: { code: 0, message: e.message } }; });
}

function groqPost(messages) {
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method : 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
      'Content-Type' : 'application/json'
    },
    body  : JSON.stringify({ model:'llama3-8b-8192', messages:messages, max_tokens:250, temperature:0.3 }),
    signal: AbortSignal.timeout(15000)
  })
  .then(function(r) { return r.json(); })
  .catch(function() { return {}; });
}

// ── 유틸 ──────────────────────────────────────────────────────
function parseDuration(d) {
  if (!d) return 0;
  var m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return parseInt(m[1]||0)*3600 + parseInt(m[2]||0)*60 + parseInt(m[3]||0);
}
function clean(t) { return String(t||'').replace(/<[^>]+>/g,'').replace(/[^\w가-힣\s]/g,' ').replace(/\s+/g,' ').trim(); }
function sn(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function fmtDate(d) {
  var pad = function(n) { return String(n).padStart(2,'0'); };
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}

// ── 키워드→카테고리ID 동적 매핑 ──────────────────────────────
var _kwCatMap = null;
function getKwCatMap() {
  if (_kwCatMap) return _kwCatMap;
  _kwCatMap = {};
  try {
    var cfg = require('./_config');
    Object.keys(cfg.CAT_SEEDS||{}).forEach(function(catId) {
      (cfg.CAT_SEEDS[catId]||[]).forEach(function(kw) {
        if (!_kwCatMap[kw]) _kwCatMap[kw] = catId;
      });
    });
  } catch(e) {}
  return _kwCatMap;
}

// ── YouTube 분석 ──────────────────────────────────────────────
async function analyzeYouTube(keyword) {
  var key = process.env.YOUTUBE_API_KEY;
  var empty = { videoCount:0, avgViews:0, shortsRatio:0, channelRepeat:0, totalChannels:0, topVideos:[], apiStatus:'NO_KEY' };
  if (!key) return empty;
  try {
    var ago7 = new Date(); ago7.setDate(ago7.getDate()-7);

    // ★ 수정 1: encodeURIComponent 제거 (이중 인코딩 방지)
    // ★ 수정 2: relevanceLanguage=ko 제거 (한국어 필터로 결과 극단적 축소 방지)
    var sd = await ytGet(
      '/youtube/v3/search?part=snippet&q='+encodeURIComponent(keyword)+
      '&type=video&publishedAfter='+ago7.toISOString()+
      '&maxResults=50&order=viewCount&key='+key
    );

    if (sd.error) {
      var status = sd.error.code === 403 ? 'QUOTA_OR_KEY_ERROR' : 'API_ERROR_' + sd.error.code;
      return Object.assign({}, empty, { apiStatus: status });
    }
    var items = sd.items||[];
    if (!items.length) {
      // fallback: 날짜 필터 없이 재시도
      var sd2 = await ytGet(
        '/youtube/v3/search?part=snippet&q='+encodeURIComponent(keyword)+
        '&type=video&maxResults=20&order=viewCount&key='+key
      );
      if (sd2.error) return Object.assign({}, empty, { apiStatus: 'QUOTA_OR_KEY_ERROR' });
      items = sd2.items||[];
      if (!items.length) return Object.assign({}, empty, {apiStatus:'NO_RESULTS'});
    }
    var ids = items.map(function(i){return i.id&&i.id.videoId;}).filter(Boolean).slice(0,50).join(',');
    var vd = await ytGet('/youtube/v3/videos?part=statistics,contentDetails,snippet&id='+ids+'&key='+key);
    if (vd.error) return Object.assign({}, empty, { apiStatus: 'QUOTA_OR_KEY_ERROR' });
    var vids = vd.items||[];
    var totalViews=0, shorts=0, channels={};
    vids.forEach(function(v) {
      totalViews += sn((v.statistics||{}).viewCount);
      if (parseDuration((v.contentDetails||{}).duration)<=60) shorts++;
    });
    items.forEach(function(i) {
      var ch=(i.snippet||{}).channelId;
      if (ch) channels[ch]=(channels[ch]||0)+1;
    });
    var topVideos = vids.slice(0,5).map(function(v) {
      var sp=v.snippet||{}, st=v.statistics||{}, cd=v.contentDetails||{};
      var dur=parseDuration(cd.duration);
      var thumb=sp.thumbnails?((sp.thumbnails.medium||sp.thumbnails.high||sp.thumbnails.default)||{}).url||'':'';
      return {
        id:v.id, title:sp.title||'', channel:sp.channelTitle||'', thumbnail:thumb,
        views:sn(st.viewCount), likes:sn(st.likeCount), duration:dur, isShorts:dur>0&&dur<=60,
        publishedAt:(sp.publishedAt||'').slice(0,10), url:'https://www.youtube.com/watch?v='+v.id
      };
    });
    return {
      videoCount:items.length, avgViews:vids.length?Math.round(totalViews/vids.length):0,
      shortsRatio:vids.length?shorts/vids.length:0,
      channelRepeat:Object.values(channels).filter(function(c){return c>1;}).length,
      totalChannels:Object.keys(channels).length, totalViews:totalViews,
      topVideos:topVideos, apiStatus:'OK'
    };
  } catch(e) { return Object.assign({}, empty, {apiStatus:'ERROR:'+e.message}); }
}

async function analyzeBlog(keyword) {
  try {
    var d = await naverGet('/v1/search/blog.json', {query:keyword+' 리뷰 후기', display:30, sort:'date'});
    var items = d.items||[];
    var rKw = ['리뷰','후기','추천','비교','솔직'];
    var cnt = items.filter(function(i) {
      var t=clean(i.title||'')+' '+clean(i.description||'');
      return rKw.some(function(w){return t.indexOf(w)>-1;});
    }).length;
    return {total:sn(d.total), reviewRatio:items.length?cnt/items.length:0, recentCount:items.length, apiStatus:'OK'};
  } catch(e) { return {total:0, reviewRatio:0, recentCount:0, apiStatus:'ERROR'}; }
}

async function analyzeShopping(keyword) {
  try {
    var d = await naverGet('/v1/search/shop.json', {query:keyword, display:40, sort:'sim'});
    var items = d.items||[];
    var prices = items.map(function(i){return sn(i.lprice);}).filter(function(p){return p>0;});
    return {
      total:sn(d.total), itemCount:items.length,
      avgPrice:prices.length?Math.round(prices.reduce(function(a,b){return a+b;},0)/prices.length):0,
      minPrice:prices.length?Math.min.apply(null,prices):0,
      maxPrice:prices.length?Math.max.apply(null,prices):0,
      apiStatus:'OK'
    };
  } catch(e) { return {total:0, itemCount:0, avgPrice:0, minPrice:0, maxPrice:0, apiStatus:'ERROR'}; }
}

async function analyzeDatalab(keyword) {
  try {
    var now  = new Date();
    var yest = new Date(now); yest.setDate(now.getDate()-1);
    var ago14= new Date(now); ago14.setDate(now.getDate()-15);
    var d = await naverPost('/v1/datalab/search', {
      startDate:fmtDate(ago14), endDate:fmtDate(yest), timeUnit:'date',
      keywordGroups:[{groupName:keyword, keywords:[keyword]}]
    });
    if (d.errorCode) return {surgeRate:0, surge3d:0, surge7d:0, trend:'unknown', avgRatio:0, apiStatus:'ERROR:'+d.errorCode};
    var pts = ((d.results||[])[0]||{}).data||[];
    if (pts.length<6) return {surgeRate:0, surge3d:0, surge7d:0, trend:'unknown', avgRatio:0, apiStatus:'INSUFFICIENT'};
    var avg = function(a){return a.reduce(function(s,p){return s+sn(p.ratio);},0)/(a.length||1);};
    var h=Math.floor(pts.length/2), pa=avg(pts.slice(0,h)), ca=avg(pts.slice(h));
    var surge7d=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
    var last3=pts.slice(-3), prev3=pts.slice(-6,-3);
    var l3=avg(last3), p3=avg(prev3);
    var surge3d=p3>0?Math.round(((l3-p3)/p3)*100):(l3>0?100:0);
    var trend=surge7d>=30?'rising':surge7d>=10?'growing':surge7d>=-10?'stable':'falling';
    return {surgeRate:surge7d, surge3d:surge3d, surge7d:surge7d, trend:trend, avgRatio:Math.round(ca*10)/10, apiStatus:'OK'};
  } catch(e) { return {surgeRate:0, surge3d:0, surge7d:0, trend:'unknown', avgRatio:0, apiStatus:'ERROR:'+e.message}; }
}

async function analyzeShoppingInsight(keyword) {
  var catId = getKwCatMap()[keyword] || '50000003';
  try {
    var now  = new Date();
    var yest = new Date(now); yest.setDate(now.getDate()-1);
    var ago14= new Date(now); ago14.setDate(now.getDate()-15);
    var d = await naverPost('/v1/datalab/shopping/categories', {
      startDate:fmtDate(ago14), endDate:fmtDate(yest), timeUnit:'date',
      category:[{name:keyword, param:[catId]}], device:'', gender:'', ages:[]
    });
    if (d.errorCode) return null;
    var pts=((d.results||[])[0]||{}).data||[];
    if (pts.length<4) return null;
    var avg=function(a){return a.reduce(function(s,p){return s+sn(p.ratio);},0)/(a.length||1);};
    var h=Math.floor(pts.length/2), pa=avg(pts.slice(0,h)), ca=avg(pts.slice(h));
    var clickSurge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
    var last3=pts.slice(-3), prev3=pts.slice(Math.max(0,pts.length-6),-3);
    var l3=avg(last3), p3=avg(prev3);
    var clickAccel=p3>0?Math.round(((l3-p3)/p3)*100):(l3>0?50:0);
    var all=avg(pts);
    var clickDurability=Math.round((pts.filter(function(p){return sn(p.ratio)>=all;}).length/pts.length)*100);
    return {
      clickSurge:clickSurge, clickAccel:clickAccel, clickDurability:clickDurability,
      currentRatio:Math.round(ca*10)/10,
      shopTrend:clickSurge>=30?'hot':clickSurge>=10?'rising':clickSurge>=-10?'stable':'falling'
    };
  } catch(e) { return null; }
}

function calcScore(yt, blog, shop, dl) {
  var s = {};
  var surge = dl.surgeRate||0;
  s.trend   = surge>=30?25:surge>=15?20:surge>=5?15:surge>=0?10:surge>=-10?5:0;
  var av    = yt.avgViews||0;
  s.views   = av>=500000?20:av>=100000?17:av>=50000?14:av>=10000?10:av>=1000?6:av>0?3:0;
  s.shorts  = Math.round((yt.shortsRatio||0)*15);
  var si=shop.itemCount||0, sr=blog.reviewRatio||0;
  s.sales   = (si>=100?10:si>=30?7:si>=5?4:si>0?2:0)+Math.round(sr*10);
  var vc    = yt.videoCount||0;
  s.compete = vc===0?10:vc<=5?9:vc<=15?7:vc<=30?5:vc<=50?3:1;
  s.timing  = dl.trend==='rising'?10:dl.trend==='growing'?8:dl.trend==='stable'?5:2;
  if (s.compete>=7&&dl.trend==='rising') s.timing=Math.min(10,s.timing+2);
  var total = s.trend+s.views+s.shorts+s.sales+s.compete+s.timing;
  return {total:Math.min(100,total), breakdown:s, grade:total>=75?'A':total>=55?'B':'C'};
}

function judge(yt, blog, shop, dl, si) {
  var surge=dl.surgeRate||0, vc=yt.videoCount||0, av=yt.avgViews||0;
  var siSurge = si?(si.clickSurge||0):0;
  var trendStatus = (surge>=30||siSurge>=30)&&vc>=5?'rising'
    : surge>=10||siSurge>=10||(vc>=10&&av>=5000)?'spreading'
    : surge>=-10?'plateau':'falling';
  var si2=shop.itemCount||0, sr=blog.reviewRatio||0;
  var salesType   = si2>=30&&sr>=0.4?'sell':si2>=5||sr>=0.3?'mixed':'info';
  var competition = vc<=10?'low':vc<=30?'medium':'high';
  var timing      = (trendStatus==='rising'||trendStatus==='spreading')&&competition!=='high'?'now':trendStatus==='plateau'?'wait':'late';
  var sr2=yt.shortsRatio||0;
  var shortsfit   = sr2>=0.5&&av>=10000?'great':sr2>=0.3||av>=3000?'ok':'bad';
  var decision;
  if (salesType==='sell'&&(trendStatus==='rising'||trendStatus==='spreading')&&competition==='low') decision='go';
  else if (salesType==='sell'&&competition!=='low') decision='conditional';
  else if (trendStatus==='plateau'||trendStatus==='spreading') decision='wait';
  else decision='no';
  var competeReasons=[];
  if(vc>=50) competeReasons.push('최근 7일 영상 '+vc+'개 — 포화 수준');
  else if(vc>=30) competeReasons.push('최근 7일 영상 '+vc+'개 — 경쟁 높음');
  else if(vc>=10) competeReasons.push('최근 7일 영상 '+vc+'개 — 중간 경쟁');
  else competeReasons.push('최근 7일 영상 '+vc+'개 — 진입 여유');
  if((yt.channelRepeat||0)>=3) competeReasons.push('상위 채널 반복 등장 '+yt.channelRepeat+'회 — 특정 채널 독점');
  else if((yt.channelRepeat||0)===0) competeReasons.push('채널 집중도 낮음 — 분산된 경쟁');
  else competeReasons.push('채널 반복 '+yt.channelRepeat+'회 — 일부 채널 우세');
  if(av>=500000) competeReasons.push('평균 조회수 '+Math.round(av/10000)+'만 — 고관심 시장');
  else if(av>=10000) competeReasons.push('평균 조회수 '+Math.round(av/1000)+'천 — 중간 관심');
  else if(av<1000&&vc>10) competeReasons.push('영상 많지만 평균 조회수 낮음 — 반응 약한 시장');
  if(competeReasons.length<2) competeReasons.push('채널 수 '+(yt.totalChannels||vc)+'개 — 기준 판단');
  return {
    trendStatus:trendStatus, salesType:salesType, competition:competition,
    timing:timing, shortsfit:shortsfit, decision:decision,
    competeReasons:competeReasons.slice(0,3),
    timingData:{
      surge3d:dl.surge3d||0, surge7d:dl.surge7d||0,
      trend:dl.trend||'unknown', shopTrend:si?(si.shopTrend||'unknown'):'unknown'
    }
  };
}

async function getGroqReason(kw, yt, blog, shop, dl, score, jdg) {
  if (!process.env.GROQ_API_KEY) return null;
  try {
    var prompt =
      '아래 데이터를 보고 한국어로 추천 이유를 2줄 이내로 작성하라.\n'+
      '반드시 "수치/지표 포함 + 원인 → 결론" 구조로 작성하라.\n---\n'+
      '키워드: '+kw+'\n'+
      'YT영상수: '+yt.videoCount+'개 | 평균조회수: '+yt.avgViews+' | 쇼츠비율: '+Math.round((yt.shortsRatio||0)*100)+'%\n'+
      '쇼핑상품: '+shop.itemCount+'개 | 리뷰비율: '+Math.round((blog.reviewRatio||0)*100)+'%\n'+
      '검색량변화: '+(dl.surge7d>=0?'+':'')+dl.surge7d+'%\n'+
      '트렌드: '+jdg.trendStatus+' | 경쟁: '+jdg.competition+' | 타이밍: '+jdg.timing+' | 점수: '+score.total+'\n---\n'+
      '출력: 추천 이유만. 기호/번호 없이.';
    var d = await groqPost([{role:'user',content:prompt}]);
    var t=(((d.choices||[])[0]||{}).message||{}).content;
    return t?t.trim().replace(/^["']|["']$/g,'').slice(0,120):null;
  } catch(e) { return null; }
}

async function extractCandidates(seedKw) {
  try {
    if (process.env.GROQ_API_KEY) {
      var d = await groqPost([{
        role: 'user',
        content:
          '아래 키워드와 관련된 검색 키워드 2개를 추출하라.\n' +
          '규칙:\n' +
          '- 반드시 한국어\n' +
          '- 실제 네이버/유튜브에서 검색할 법한 구체적인 키워드\n' +
          '- 원래 키워드보다 더 구체적이거나 관련 상품명\n' +
          '- 각 키워드는 2~15자\n' +
          '- 쉼표로 구분해서 키워드만 출력. 다른 텍스트 없이.\n' +
          '예시: 캠핑텐트 → 1인용텐트,백패킹텐트\n' +
          '키워드: ' + seedKw
      }]);
      var text = (((d.choices || [])[0] || {}).message || {}).content || '';
      var relatedKws = text
        .replace(/[^가-힣a-zA-Z0-9,\s]/g, '')
        .split(',')
        .map(function(k) { return k.trim(); })
        .filter(function(k) {
          return k && k !== seedKw && k.length >= 2 && k.length <= 15;
        })
        .slice(0, 2);
      if (relatedKws.length >= 1) {
        var out = [seedKw].concat(relatedKws).slice(0, 3);
        console.log('[extractCandidates] Groq 키워드:', out);
        return out;
      }
    }
    var related = await fetch(
      'https://ac.search.naver.com/nx/ac?q=' + encodeURIComponent(seedKw) +
      '&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100',
      { signal: AbortSignal.timeout(5000) }
    )
    .then(function(r) { return r.json(); })
    .catch(function() { return {}; });
    var relatedKws2 = [];
    try {
      var items2 = (related.items || [])[0] || [];
      relatedKws2 = items2
        .map(function(i) { return Array.isArray(i) ? i[0] : i; })
        .filter(function(kw) {
          return kw && kw !== seedKw && kw.length >= 2 && kw.length <= 15;
        })
        .slice(0, 2);
    } catch(e2) {}
    var out2 = [seedKw].concat(relatedKws2).slice(0, 3);
    console.log('[extractCandidates] fallback 키워드:', out2);
    return out2;
  } catch(e) {
    console.warn('[extractCandidates] 오류:', e.message);
    return [seedKw];
  }
}

// ── Main ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if (req.method==='OPTIONS') return res.status(200).end();

  var keyword = String(req.query.keyword||'').trim().slice(0,30);
  if (!keyword) return res.status(400).json({error:'키워드를 입력해주세요'});

  var envCheck = {
    NAVER:   !!(process.env.NAVER_CLIENT_ID&&process.env.NAVER_CLIENT_SECRET),
    YOUTUBE: !!process.env.YOUTUBE_API_KEY,
    GROQ:    !!process.env.GROQ_API_KEY
  };

  try {
    var candidates = await extractCandidates(keyword);
    var BATCH=3, phase1=[];
    for (var i=0; i<candidates.length; i+=BATCH) {
      var chunk = candidates.slice(i,i+BATCH);
      var settled = await Promise.allSettled(chunk.map(function(kw) {
        return Promise.all([analyzeBlog(kw), analyzeShopping(kw)]).then(function(r) {
          return {kw:kw, blog:r[0], shop:r[1]};
        });
      }));
      settled.forEach(function(r){ if(r.status==='fulfilled') phase1.push(r.value); });
      if (i+BATCH<candidates.length) await sleep(150);
    }

    var TOP_N=3;
    phase1.sort(function(a,b){
      var sa=(a.shop.itemCount||0)*2+Math.round((a.blog.reviewRatio||0)*10);
      var sb=(b.shop.itemCount||0)*2+Math.round((b.blog.reviewRatio||0)*10);
      return sb-sa;
    });

    var topKws  = phase1.slice(0,TOP_N).map(function(r){return r.kw;});
    var restKws = phase1.slice(TOP_N).map(function(r){return r.kw;});
    var ytMap={}, dlMap={}, siMap={};

    for (var j=0; j<topKws.length; j++) {
      var kw2 = topKws[j];
      var p2 = await Promise.all([
        analyzeYouTube(kw2),
        analyzeDatalab(kw2),
        analyzeShoppingInsight(kw2)
      ]);
      ytMap[kw2] = p2[0];
      dlMap[kw2] = p2[1];
      siMap[kw2] = p2[2];
      if (j<topKws.length-1) await sleep(200);
    }

    var emptyYt = {videoCount:0, avgViews:0, shortsRatio:0, channelRepeat:0, totalChannels:0, topVideos:[], apiStatus:'SKIPPED'};
    var emptyDl = {surgeRate:0, surge3d:0, surge7d:0, trend:'unknown', avgRatio:0, apiStatus:'SKIPPED'};
    restKws.forEach(function(kw3){ ytMap[kw3]=emptyYt; dlMap[kw3]=emptyDl; siMap[kw3]=null; });

    var results = phase1.map(function(r) {
      var yt2 = ytMap[r.kw]||emptyYt;
      var dl2 = dlMap[r.kw]||emptyDl;
      var si2 = siMap[r.kw]||null;
      var score2 = calcScore(yt2, r.blog, r.shop, dl2);
      var jdg2   = judge(yt2, r.blog, r.shop, dl2, si2);
      return {kw:r.kw, yt:yt2, blog:r.blog, shop:r.shop, dl:dl2, si:si2, score:score2, jdg:jdg2};
    });

    results.sort(function(a,b){return b.score.total-a.score.total;});

    for (var k=0; k<Math.min(3,results.length); k++) {
      var rr = results[k];
      rr.aiReason = await getGroqReason(rr.kw, rr.yt, rr.blog, rr.shop, rr.dl, rr.score, rr.jdg);
    }

    var out = results.slice(0,3).map(function(r) {
      return {
        id:r.kw, name:r.kw, score:r.score, judge:r.jdg,
        aiReason:r.aiReason||null,
        apiStatus:{
          youtube:  r.yt.apiStatus||'unknown',
          datalab:  r.dl.apiStatus||'unknown',
          blog:     r.blog.apiStatus||'unknown',
          shopping: r.shop.apiStatus||'unknown'
        },
        data:{
          youtube:  {videoCount:r.yt.videoCount, avgViews:r.yt.avgViews, shortsRatio:Math.round((r.yt.shortsRatio||0)*100), channelRepeat:r.yt.channelRepeat, totalChannels:r.yt.totalChannels, topVideos:r.yt.topVideos||[]},
          blog:     {total:r.blog.total, reviewRatio:Math.round((r.blog.reviewRatio||0)*100)},
          shopping: {total:r.shop.total, itemCount:r.shop.itemCount, avgPrice:r.shop.avgPrice},
          datalab:  {surgeRate:r.dl.surgeRate, surge3d:r.dl.surge3d, surge7d:r.dl.surge7d, trend:r.dl.trend, avgRatio:r.dl.avgRatio},
          shoppingInsight: r.si ? {clickSurge:r.si.clickSurge, clickAccel:r.si.clickAccel, clickDurability:r.si.clickDurability, shopTrend:r.si.shopTrend} : null
        }
      };
    });

    return res.status(200).json({
      keyword:keyword, candidates:out, total:out.length,
      envCheck:envCheck, updatedAt:new Date().toISOString()
    });

  } catch(e) {
    console.error('[hot-analyze]', e.message);
    return res.status(500).json({error:'분석 중 오류 발생', detail:e.message, envCheck:envCheck});
  }
}
