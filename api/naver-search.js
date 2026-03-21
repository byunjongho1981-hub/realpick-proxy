const https = require('https');

const DELAY_MS = 300;
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 8000;

function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }

function httpGet(path, params){
  return new Promise(function(resolve, reject){
    var qs = Object.keys(params).map(function(k){
      return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);
    }).join('&');
    var timer = setTimeout(function(){reject(new Error('timeout'));}, TIMEOUT_MS);
    var req = https.request({
      hostname:'openapi.naver.com', path:path+'?'+qs, method:'GET',
      headers:{
        'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
      }
    }, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end',function(){
        clearTimeout(timer);
        try{resolve({status:res.statusCode, data:JSON.parse(raw)});}
        catch(e){resolve({status:res.statusCode, data:{}});}
      });
    });
    req.on('error',function(e){clearTimeout(timer);reject(e);});
    req.end();
  });
}

// 재시도 포함 단일 호출
async function callWithRetry(query, sort, start, searchType, log){
  var key = query+'|'+sort+'|'+start;
  var attempts = 0;
  while(attempts < 3){
    attempts++;
    try{
      var res = await httpGet('/v1/search/'+searchType+'.json',{
        query:query, sort:sort, display:20, start:start
      });
      if(res.status===429){
        await sleep(1500);
        continue;
      }
      if(res.status!==200){
        if(attempts<3) await sleep(attempts===1?0:2000);
        continue;
      }
      log.success++;
      return res.data;
    }catch(e){
      if(attempts<3) await sleep(attempts===1?0:2000);
    }
  }
  log.fail++;
  log.failedCalls.push(key);
  return null;
}

// 동시 호출 제한 큐
async function runQueue(tasks, concurrency){
  var results=[], idx=0;
  async function worker(){
    while(idx<tasks.length){
      var i=idx++;
      results[i]=await tasks[i]();
      await sleep(DELAY_MS);
    }
  }
  var workers=[];
  for(var i=0;i<Math.min(concurrency,tasks.length);i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

function cleanText(t){
  return String(t||'').replace(/<[^>]+>/g,'').replace(/&[a-zA-Z]+;/g,' ').replace(/\s+/g,' ').trim();
}
function normalizeDate(d){
  if(!d) return '';
  var s=String(d).replace(/\D/g,'');
  if(s.length>=8) return s.slice(0,4)+'.'+s.slice(4,6)+'.'+s.slice(6,8);
  return d;
}
function isValidItem(item){
  if(!item.link||!item.title) return false;
  if(item.title.length<2||item.link.length<5) return false;
  if(!/^https?:\/\//.test(item.link)) return false;
  return true;
}
function isLowQuality(item){
  return item.title.length<5&&item.description.length<10;
}

function parseItems(data, query, sort, start, searchType){
  if(!data||!Array.isArray(data.items)) return [];
  var now = new Date().toISOString();
  return data.items.map(function(item){
    return {
      searchQuery:  query,
      sortType:     sort,
      pageStart:    start,
      searchType:   searchType,
      title:        cleanText(item.title||''),
      description:  cleanText(item.description||''),
      link:         item.link||'',
      bloggername:  item.bloggername||'',
      bloggerlink:  item.bloggerlink||'',
      postdate:     normalizeDate(item.postdate||item.pubDate||''),
      collectedAt:  now
    };
  }).filter(isValidItem);
}

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(200).end();

  var query = String(req.query.query||'').trim().slice(0,50);
  if(!query) return res.status(400).json({error:'query required'});

  var validTypes = ['blog','news','cafearticle'];
  var searchType = validTypes.includes(req.query.type)?req.query.type:'blog';
  var display    = parseInt(req.query.display)||5; // 최종 반환 수

  var log = { query:query, totalCalls:0, success:0, fail:0, failedCalls:[] };

  // ── 호출 계획: sort×2 × page×2 = 4회
  var plans = [
    {sort:'sim',  start:1},
    {sort:'sim',  start:21},
    {sort:'date', start:1},
    {sort:'date', start:21}
  ];

  var tasks = plans.map(function(p){
    return async function(){
      log.totalCalls++;
      return { plan:p, data: await callWithRetry(query, p.sort, p.start, searchType, log) };
    };
  });

  var results = await runQueue(tasks, MAX_CONCURRENT);

  // ── 원본 수집
  var rawResults = [];
  results.forEach(function(r){
    if(!r||!r.data) return;
    var items = parseItems(r.data, query, r.plan.sort, r.plan.start, searchType);
    rawResults = rawResults.concat(items);
  });

  var rawCount = rawResults.length;

  // ── 중복 제거
  var seen = {}, dedupedResults = [];
  rawResults.forEach(function(item){
    if(!seen[item.link]){
      seen[item.link]=true;
      dedupedResults.push(item);
    }
  });

  var dupRemoved = rawCount - dedupedResults.length;

  // ── 저품질 마킹
  var validResults = dedupedResults.map(function(item){
    return Object.assign({}, item, {lowQuality: isLowQuality(item)});
  });

  // ── 로그
  log.rawCount     = rawCount;
  log.dedupCount   = dedupedResults.length;
  log.dupRemoved   = dupRemoved;
  log.validCount   = validResults.filter(function(i){return !i.lowQuality;}).length;

  // ── 최종 반환 (display 수만큼, 저품질 후순위)
  var sorted = validResults
    .filter(function(i){return !i.lowQuality;})
    .concat(validResults.filter(function(i){return i.lowQuality;}));

  return res.status(200).json({
    items:        sorted.slice(0, display),
    rawResults:   rawResults,
    dedupedResults: dedupedResults,
    validResults: validResults,
    crawlLog:     log,
    summary:{
      query:        query,
      searchType:   searchType,
      totalCalls:   log.totalCalls,
      success:      log.success,
      fail:         log.fail,
      rawCount:     rawCount,
      dedupCount:   dedupedResults.length,
      dupRemoved:   dupRemoved,
      validCount:   log.validCount
    }
  });
}
