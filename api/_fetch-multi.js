var https  = require('https');
var crypto = require('crypto');

var _prevCoupangRanks = {};

function safeNum(v){ return isNaN(Number(v)) ? 0 : Number(v); }

function httpsGet(hostname, path, headers, timeout){
  return new Promise(function(resolve, reject){
    var t = setTimeout(function(){ reject(new Error('timeout')); }, timeout||9000);
    var req = https.request({ hostname:hostname, path:path, method:'GET', headers:headers||{} }, function(res){
      var raw='';
      res.on('data', function(c){ raw+=c; });
      res.on('end',  function(){ clearTimeout(t); try{ resolve(JSON.parse(raw)); }catch(e){ resolve({}); } });
    });
    req.on('error', function(e){ clearTimeout(t); reject(e); });
    req.end();
  });
}

// ── YouTube: 최근 48시간 급상승 영상 ─────────────────────────
function fetchYoutubeTrending(){
  var key = process.env.YOUTUBE_API_KEY;
  if(!key) return Promise.resolve([]);
  var d = new Date(); d.setDate(d.getDate()-2);
  var after = d.toISOString();
  var path = '/youtube/v3/search'
    + '?part=snippet&type=video&order=viewCount'
    + '&publishedAfter='+encodeURIComponent(after)
    + '&regionCode=KR&maxResults=30&relevanceLanguage=ko'
    + '&key='+key;
  return httpsGet('www.googleapis.com', path)
    .then(function(data){
      return (data.items||[]).map(function(item){
        return {
          videoId: item.id&&item.id.videoId||'',
          title:   (item.snippet&&item.snippet.title)||'',
          channel: (item.snippet&&item.snippet.channelTitle)||'',
          source:  'youtube'
        };
      }).filter(function(v){ return v.title.length > 0; });
    })
    .catch(function(e){ console.error('[youtube]', e.message); return []; });
}

// ── YouTube Shorts 급상승 ────────────────────────────────────
function fetchYoutubeShorts(){
  var key = process.env.YOUTUBE_API_KEY;
  if(!key) return Promise.resolve([]);
  var d = new Date(); d.setDate(d.getDate()-1);
  var after = d.toISOString();
  // ★ 한글 쿼리 encodeURIComponent 처리
  var q = encodeURIComponent('shorts 리뷰 추천 제품');
  var path = '/youtube/v3/search'
    + '?part=snippet&type=video&order=viewCount&videoDuration=short'
    + '&publishedAfter='+encodeURIComponent(after)
    + '&q='+q+'&regionCode=KR&maxResults=20&key='+key;
  return httpsGet('www.googleapis.com', path)
    .then(function(data){
      return (data.items||[]).map(function(item){
        return {
          title:   (item.snippet&&item.snippet.title)||'',
          channel: (item.snippet&&item.snippet.channelTitle)||'',
          source:  'youtube_shorts'
        };
      }).filter(function(v){ return v.title.length > 0; });
    })
    .catch(function(e){ console.error('[youtube-shorts]', e.message); return []; });
}

// ── Coupang: 베스트셀러 + 순위 변동 추적 ────────────────────
function getCoupangDt(){
  var n=new Date(), p=function(x){return String(x).padStart(2,'0');};
  return n.getUTCFullYear()+p(n.getUTCMonth()+1)+p(n.getUTCDate())
    +'T'+p(n.getUTCHours())+p(n.getUTCMinutes())+p(n.getUTCSeconds())+'Z';
}

function fetchCoupangBest(){
  var ak=process.env.COUPANG_ACCESS_KEY, sk=process.env.COUPANG_SECRET_KEY;
  if(!ak||!sk) return Promise.resolve([]);
  try{
    var method='GET';
    var path='/v2/providers/affiliate_open_api/apis/openapi/products/search';
    var query='keyword='+encodeURIComponent('베스트')+'&limit=20&sortType=BEST_SELLING';
    var dt=getCoupangDt();
    var sig=crypto.createHmac('sha256',sk).update(dt+method+path+'?'+query).digest('hex');
    var auth='CEA algorithm=HmacSHA256, access-key='+ak+', signed-date='+dt+', signature='+sig;
    return httpsGet('api-gateway.coupang.com', path+'?'+query, {
      'Authorization':auth, 'Content-Type':'application/json', 'Accept':'application/json'
    }).then(function(d){
      var list=(d.data&&d.data.productData)||d.data||[];
      if(!Array.isArray(list)) return [];
      return list.slice(0,20).map(function(p, idx){
        var name = p.productName||p.name||'';
        if(!name) return null;
        var prevRank = _prevCoupangRanks[name]||null;
        var rankChange = prevRank !== null ? prevRank-(idx+1) : 0;
        _prevCoupangRanks[name] = idx+1;
        return { name:name, price:safeNum(p.productPrice||p.salePrice||0), rank:idx+1, rankChange:rankChange, reviewCount:safeNum(p.reviewCount||0), source:'coupang' };
      }).filter(Boolean);
    }).catch(function(e){ console.error('[coupang]',e.message); return []; });
  }catch(e){ console.error('[coupang-auth]',e.message); return Promise.resolve([]); }
}

// ── Google: 국내 트렌드 ──────────────────────────────────────
function fetchGoogleKorea(){
  var key=process.env.GOOGLE_API_KEY, cx=process.env.GOOGLE_CX;
  if(!key||!cx) return Promise.resolve([]);
  // ★ 한글 encodeURIComponent 처리
  var q=encodeURIComponent('요즘 뜨는 제품 트렌드 2025 한국');
  var path='/customsearch/v1?key='+key+'&cx='+cx+'&q='+q+'&dateRestrict=d3&num=8&gl=kr&hl=ko';
  return httpsGet('www.googleapis.com', path)
    .then(function(data){
      return (data.items||[]).map(function(i){ return { title:i.title||'', snippet:i.snippet||'', source:'google_kr' }; });
    })
    .catch(function(e){ console.error('[google-kr]',e.message); return []; });
}

// ── Google: 해외 선행 트렌드 ─────────────────────────────────
function fetchGoogleOverseas(){
  var key=process.env.GOOGLE_API_KEY, cx=process.env.GOOGLE_CX;
  if(!key||!cx) return Promise.resolve([]);
  var q=encodeURIComponent('trending products viral tiktok japan korea 2025');
  var path='/customsearch/v1?key='+key+'&cx='+cx+'&q='+q+'&dateRestrict=d7&num=8';
  return httpsGet('www.googleapis.com', path)
    .then(function(data){
      return (data.items||[]).map(function(i){ return { title:i.title||'', snippet:i.snippet||'', source:'google_overseas' }; });
    })
    .catch(function(e){ console.error('[google-overseas]',e.message); return []; });
}

// ── TikTok 트렌드 (RapidAPI) ─────────────────────────────────
function fetchTikTokTrends(){
  var key=process.env.RAPIDAPI_KEY;
  if(!key) return Promise.resolve([]);
  return httpsGet('tiktok-api23.p.rapidapi.com',
    '/api/trending/hashtags?region=KR&count=20',
    { 'X-RapidAPI-Key':key, 'X-RapidAPI-Host':'tiktok-api23.p.rapidapi.com' }
  ).then(function(d){
    var list=d.data||d.hashtag_list||d.result||[];
    if(!Array.isArray(list)) return [];
    return list.slice(0,15).map(function(h){
      return { tag:String(h.name||h.hashtag_name||h.title||'').replace(/^#/,''), videoCount:safeNum(h.video_count||h.videoCount||0), viewCount:safeNum(h.view_count||h.viewCount||0), source:'tiktok' };
    }).filter(function(h){ return h.tag.length>1; });
  }).catch(function(e){ console.error('[tiktok]',e.message); return []; });
}

// ── Instagram 해시태그 (RapidAPI) ★ 인코딩 수정 ─────────────
function fetchInstagramTrends(){
  var key=process.env.RAPIDAPI_KEY;
  if(!key) return Promise.resolve([]);
  // ★ 한글 태그를 영문으로 교체 (unescaped characters 오류 방지)
  var hashtag = 'koreanshopping';
  var path = '/v1/hashtag_posts?hashtag='+encodeURIComponent(hashtag)+'&count=20';
  return httpsGet('instagram-scraper-api2.p.rapidapi.com', path,
    { 'X-RapidAPI-Key':key, 'X-RapidAPI-Host':'instagram-scraper-api2.p.rapidapi.com' }
  ).then(function(d){
    var items=d.data&&d.data.items||[];
    if(!Array.isArray(items)) return [];
    var tags={};
    items.slice(0,20).forEach(function(item){
      var caption=item.caption&&item.caption.text||'';
      (caption.match(/#[\w가-힣]+/g)||[]).forEach(function(tag){
        var t=tag.replace('#','');
        if(t.length>1) tags[t]=(tags[t]||0)+1;
      });
    });
    return Object.keys(tags).sort(function(a,b){return tags[b]-tags[a];}).slice(0,10).map(function(t){
      return { tag:t, count:tags[t], source:'instagram' };
    });
  }).catch(function(e){ console.error('[instagram]',e.message); return []; });
}

module.exports = {
  fetchYoutubeTrending,
  fetchYoutubeShorts,
  fetchCoupangBest,
  fetchGoogleKorea,
  fetchGoogleOverseas,
  fetchTikTokTrends,
  fetchInstagramTrends
};
