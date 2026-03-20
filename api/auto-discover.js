var https = require('https');

var TIMEOUT = 3500;
var GRADE_A = 70;
var GRADE_B = 50;

var CAT_NAMES = {
  '50000000':'패션의류','50000001':'패션잡화','50000002':'화장품/미용',
  '50000003':'디지털/가전','50000004':'가구/인테리어','50000005':'출산/육아',
  '50000006':'식품','50000007':'스포츠/레저','50000008':'생활/건강',
  '50000009':'도서/음반','50000010':'완구/취미','50000011':'문구/오피스',
  '50000012':'반려동물','50000013':'자동차용품','50000014':'여행/티켓'
};

var CAT_ORDER = [
  '50000003','50000002','50000008','50000007','50000006',
  '50000004','50000005','50000000','50000001','50000009',
  '50000010','50000011','50000012','50000013','50000014'
];

var CAT_SEEDS = {
  '50000000':['원피스','청바지','맨투맨','후드티','코트'],
  '50000001':['운동화','크로스백','선글라스','벨트','백팩'],
  '50000002':['선크림','토너패드','비타민C세럼','클렌징폼','앰플'],
  '50000003':['무선이어폰','로봇청소기','공기청정기','에어프라이어','스마트워치'],
  '50000004':['스탠딩책상','패브릭소파','간접조명','수납장','침대프레임'],
  '50000005':['기저귀','분유','아기물티슈','유모차','아기띠'],
  '50000006':['단백질쉐이크','닭가슴살','견과류','오트밀','그릭요거트'],
  '50000007':['요가매트','러닝화','폼롤러','덤벨세트','캠핑텐트'],
  '50000008':['마사지건','유산균','전동칫솔','경추베개','족욕기'],
  '50000009':['베스트셀러소설','자기계발서','그림책','독서대','e북리더'],
  '50000010':['레고','보드게임','피규어','퍼즐','드론'],
  '50000011':['무선마우스','기계식키보드','포스트잇','USB허브','모니터암'],
  '50000012':['강아지사료','고양이사료','펫패드','강아지간식','자동급식기'],
  '50000013':['블랙박스','하이패스단말기','차량용충전기','세차용품','카매트'],
  '50000014':['캐리어','여행파우치','목베개','숙박권','여행보험']
};

var CACHE = { data: null, ts: 0, TTL: 60 * 60 * 1000 };

function getCache() {
  if (!CACHE.data) return null;
  if (Date.now() - CACHE.ts > CACHE.TTL) return null;
  return CACHE.data;
}
function setCache(d) {
  CACHE.data = d;
  CACHE.ts = Date.now();
}

function checkEnv() {
  var miss = [];
  if (!process.env.NAVER_CLIENT_ID) miss.push('NAVER_CLIENT_ID');
  if (!process.env.NAVER_CLIENT_SECRET) miss.push('NAVER_CLIENT_SECRET');
  if (miss.length > 0) throw new Error('환경변수 누락: ' + miss.join(', '));
}

function httpGet(path, params) {
  return new Promise(function(resolve, reject) {
    var qs = '';
    var keys = Object.keys(params);
    for (var i = 0; i < keys.length; i++) {
      qs += (i === 0 ? '?' : '&') + encodeURIComponent(keys[i]) + '=' + encodeURIComponent(params[keys[i]]);
    }
    var options = {
      hostname: 'openapi.naver.com',
      path: path + qs,
      method: 'GET',
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
      }
    };
    var timer = setTimeout(function() { reject(new Error('timeout')); }, TIMEOUT);
    var req = https.request(options, function(res) {
      var raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() {
        clearTimeout(timer);
        try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); }
      });
    });
    req.on('error', function(e) { clearTimeout(timer); reject(e); });
    req.end();
  });
}

function cleanText(t) {
  return String(t || '').replace(/<[^>]+>/g, '').replace(/[^\w가-힣\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function isClean(t) {
  if (t.length < 2) return false;
  if (/\[광고\]|\[협찬\]|쿠폰|특가|이벤트/.test(t)) return false;
  return true;
}
function safeNum(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function shopSearch(keyword, catId) {
  var params = { query: keyword, display: 20, sort: 'sim' };
  if (catId && catId !== 'all') params.category = catId;
  return httpGet('/v1/search/shop.json', params).then(function(data) {
    if (!data || !Array.isArray(data.items)) return [];
    var result = [];
    for (var i = 0; i < data.items.length; i++) {
      var item = data.items[i];
      var title = cleanText(item.title || '');
      var price = safeNum(item.lprice || item.price);
      if (isClean(title) && price > 0) {
        result.push({ title: title, link: item.link || '', price: price });
      }
    }
    return result;
  }).catch(function() { return []; });
}

function calcScore(count, maxCount) {
  var ratio = maxCount > 0 ? count / maxCount : 0;
  var total = Math.min(100, Math.round(ratio * 55));
  var grade = total >= GRADE_A ? 'A' : total >= GRADE_B ? 'B' : 'C';
  var confidence = count >= 10 ? 'high' : count >= 5 ? 'medium' : 'low';
  return { totalScore: total, breakdown: { shopping: Math.round(ratio*40), trend: Math.round(ratio*15) }, grade: grade, confidence: confidence };
}

function judgeT(count) {
  if (count === 1) return { status: 'new',     changeRate: null, source: 'count' };
  if (count >= 12) return { status: 'rising',  changeRate: null, source: 'count' };
  if (count >= 6)  return { status: 'stable',  changeRate: null, source: 'count' };
  return                  { status: 'falling', changeRate: null, source: 'count' };
}

function makeSummary(name, score, trend) {
  // confidence 무관하게 grade + trend 기준으로 액션 결정
  var action;
  if (trend.status === 'rising' && score.grade === 'A') {
    action = 'shorts';
  } else if (trend.status === 'rising' || score.grade === 'A' || score.grade === 'B') {
    action = 'blog';
  } else if (trend.status === 'falling') {
    action = 'hold';
  } else {
    action = 'compare';
  }
  var labels = { rising: '🔥 급상승', stable: '➡️ 보합', falling: '📉 하락', new: '✨ 신규' };
  var lbl = labels[trend.status] || '';
  var note = score.confidence === 'low' ? ' (데이터 부족)' : '';
  return { summary: name + ' ' + lbl + ' · ' + score.totalScore + '점 · ' + action.toUpperCase() + ' 추천' + note, action: action };
}

function buildCandidate(kw, items, maxCount) {
  var score = calcScore(items.length, maxCount);
  var trend = judgeT(items.length);
  var sm = makeSummary(kw, score, trend);
  var samples = [];
  for (var i = 0; i < Math.min(3, items.length); i++) {
    samples.push({ title: items[i].title, link: items[i].link, source: 'shopping' });
  }
  return {
    id: kw, name: kw, keywords: [kw], sources: ['shopping'],
    count: items.length, score: score, trend: trend,
    summary: sm.summary, action: sm.action, sampleItems: samples
  };
}

// 개별 카테고리 탐색
async function discoverCategory(catId) {
  var keywords = CAT_SEEDS[catId] || CAT_SEEDS['50000003'];
  var promises = [];
  for (var i = 0; i < keywords.length; i++) {
    promises.push(shopSearch(keywords[i], catId));
  }
  var results = await Promise.allSettled(promises);
  var valid = [];
  for (var j = 0; j < keywords.length; j++) {
    var items = results[j].status === 'fulfilled' ? results[j].value : [];
    if (items.length > 0) valid.push({ kw: keywords[j], items: items, count: items.length });
  }
  if (!valid.length) return { candidates: [], apiStatus: { search: '결과 없음' } };
  var maxCount = 0;
  for (var k = 0; k < valid.length; k++) { if (valid[k].count > maxCount) maxCount = valid[k].count; }
  var candidates = [];
  for (var m = 0; m < valid.length; m++) {
    candidates.push(buildCandidate(valid[m].kw, valid[m].items, maxCount));
  }
  candidates.sort(function(a, b) { return b.score.totalScore - a.score.totalScore; });
  return { candidates: candidates.slice(0, 15), apiStatus: { search: valid.length + '/' + keywords.length + ' 성공' } };
}

// 전체 탐색 (병렬)
async function discoverAll() {
  var promises = [];
  for (var i = 0; i < CAT_ORDER.length; i++) {
    var catId = CAT_ORDER[i];
    var topKw = CAT_SEEDS[catId] && CAT_SEEDS[catId][0] ? CAT_SEEDS[catId][0] : '';
    promises.push(shopSearch(topKw, catId));
  }
  var results = await Promise.allSettled(promises);
  var pool = [];
  var completed = [];
  var failed = [];
  for (var j = 0; j < CAT_ORDER.length; j++) {
    var catId2 = CAT_ORDER[j];
    var catName = CAT_NAMES[catId2] || catId2;
    var items = results[j].status === 'fulfilled' ? results[j].value : [];
    if (!items.length) { failed.push(catName); continue; }
    pool.push({ catId: catId2, catName: catName, kw: CAT_SEEDS[catId2][0], items: items, count: items.length });
    completed.push(catName);
  }
  var globalMax = 0;
  for (var k = 0; k < pool.length; k++) { if (pool[k].count > globalMax) globalMax = pool[k].count; }
  var candidates = [];
  for (var m = 0; m < pool.length; m++) {
    var c = buildCandidate(pool[m].kw, pool[m].items, globalMax);
    c.category = pool[m].catName;
    candidates.push(c);
  }
  candidates.sort(function(a, b) { return b.score.totalScore - a.score.totalScore; });
  return {
    candidates: candidates.slice(0, 10),
    apiStatus: { completed: completed.length + '/' + CAT_ORDER.length + ' 카테고리', failed: failed.length > 0 ? failed.join(', ') : '없음' },
    processLog: { completed: completed, failed: failed }
  };
}

// 시드 확장
async function discoverSeed(seedKw) {
  var r1 = await httpGet('/v1/search/shop.json', { query: seedKw, display: 20, sort: 'sim' }).catch(function() { return {}; });
  var freq = {};
  var items0 = r1 && Array.isArray(r1.items) ? r1.items : [];
  for (var i = 0; i < items0.length; i++) {
    var words = cleanText(items0[i].title || '').split(/\s+/);
    for (var w = 0; w < words.length; w++) {
      var word = words[w];
      if (word.length > 1 && word !== seedKw) freq[word] = (freq[word] || 0) + 1;
    }
  }
  var entries = [];
  var fkeys = Object.keys(freq);
  for (var f = 0; f < fkeys.length; f++) entries.push([fkeys[f], freq[fkeys[f]]]);
  entries.sort(function(a, b) { return b[1] - a[1]; });
  var keywords = [seedKw];
  for (var e = 0; e < Math.min(6, entries.length); e++) keywords.push(entries[e][0]);
  keywords = keywords.slice(0, 8);
  var promises = [];
  for (var p = 0; p < keywords.length; p++) promises.push(shopSearch(keywords[p], null));
  var results = await Promise.allSettled(promises);
  var valid = [];
  for (var j = 0; j < keywords.length; j++) {
    var sitems = results[j].status === 'fulfilled' ? results[j].value : [];
    if (sitems.length > 0) valid.push({ kw: keywords[j], items: sitems, count: sitems.length });
  }
  if (!valid.length) return { candidates: [], apiStatus: { search: '결과 없음' } };
  var maxCount = 0;
  for (var k = 0; k < valid.length; k++) { if (valid[k].count > maxCount) maxCount = valid[k].count; }
  var candidates = [];
  for (var m = 0; m < valid.length; m++) candidates.push(buildCandidate(valid[m].kw, valid[m].items, maxCount));
  candidates.sort(function(a, b) { return b.score.totalScore - a.score.totalScore; });
  return { candidates: candidates.slice(0, 15), apiStatus: { search: valid.length + '/' + keywords.length + ' 성공' } };
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try { checkEnv(); } catch(e) { return res.status(500).json({ error: e.message }); }

  var mode = req.query.mode || 'category';
  var period = req.query.period || 'week';

  try {
    if (mode === 'category') {
      var catId = req.query.categoryId || '50000003';

      if (catId === 'all') {
        var cached = getCache();
        if (cached) {
          var age = Math.round((Date.now() - CACHE.ts) / 1000);
          cached.fromCache = true;
          cached.cacheAge = age + '초 전';
          return res.status(200).json(cached);
        }
        var allResult = await discoverAll();
        var result = {
          candidates: allResult.candidates, mode: mode,
          categoryId: 'all', categoryName: '전체', period: period,
          total: allResult.candidates.length, apiStatus: allResult.apiStatus,
          processLog: allResult.processLog, updatedAt: new Date().toISOString(), fromCache: false
        };
        setCache(result);
        return res.status(200).json(result);
      }

      var catResult = await discoverCategory(catId);
      return res.status(200).json({
        candidates: catResult.candidates, mode: mode,
        categoryId: catId, categoryName: CAT_NAMES[catId] || catId,
        period: period, total: catResult.candidates.length,
        apiStatus: catResult.apiStatus, updatedAt: new Date().toISOString()
      });
    }

    if (mode === 'seed') {
      var seedKw = String(req.query.keyword || '').trim().slice(0, 30);
      if (!seedKw) return res.status(400).json({ error: '키워드를 입력해주세요' });
      var seedResult = await discoverSeed(seedKw);
      return res.status(200).json({
        candidates: seedResult.candidates, mode: mode,
        seedKeyword: seedKw, period: period,
        total: seedResult.candidates.length, apiStatus: seedResult.apiStatus,
        updatedAt: new Date().toISOString()
      });
    }

    return res.status(400).json({ error: '알 수 없는 mode' });

  } catch(e) {
    console.error('[auto-discover]', e.message);
    return res.status(500).json({ error: '탐색 중 오류가 발생했습니다.', detail: e.message });
  }
};
