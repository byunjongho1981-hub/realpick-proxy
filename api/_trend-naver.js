var https = require('https');
var CFG   = require('./_trend-config');

function safeNum(v){ return isNaN(Number(v))?0:Number(v); }
function sleep(ms){ return new Promise(function(r){setTimeout(r,ms);}); }
function fmtDate(d){ var p=function(n){return String(n).padStart(2,'0');}; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function agoDate(n){ var d=new Date(); d.setDate(d.getDate()-n); return d; }
function stripHtml(s){ return (s||'').replace(/<[^>]+>/g,''); }

// ── 키워드 변형 생성 [5] ─────────────────────────────────────
function expandKeyword(kw){
  return [kw, kw+' 추천', kw+' 후기', kw+' 비교'];
}
// 데이터랩용 유의어 그룹 [3]
function buildSynonymGroup(kw){
  var synonyms={
    '선크림':['선크림','자외선차단제','썬크림'],
    '썬크림':['썬크림','선크림','자외선차단제'],
    '보조배터리':['보조배터리','충전기','파워뱅크'],
    '무선이어폰':['무선이어폰','블루투스이어폰','에어팟'],
    '마스크팩':['마스크팩','시트마스크','페이스팩'],
    '폼롤러':['폼롤러','마사지롤러','근막이완'],
    '수납박스':['수납박스','정리함','수납함'],
    '레깅스':['레깅스','요가바지','운동바지'],
  };
  return synonyms[kw]||[kw];
}

// ── 공통 GET (항상 resolve) ───────────────────────────────────
function naverGet(path, params){
  return new Promise(function(resolve){
    try{
      var qs=Object.keys(params).map(function(k){
        return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);
      }).join('&');
      var done=false;
      var t=setTimeout(function(){if(!done){done=true;resolve(null);}},5000);
      var req=https.request({
        hostname:'openapi.naver.com', path:path+'?'+qs, method:'GET',
        headers:{'X-Naver-Client-Id':process.env.NAVER_CLIENT_ID,'X-Naver-Client-Secret':process.env.NAVER_CLIENT_SECRET}
      },function(res){
        var raw='';
        res.on('data',function(c){raw+=c;});
        res.on('end',function(){
          if(done)return; done=true; clearTimeout(t);
          try{
            var d=JSON.parse(raw);
            if(d.errorCode){console.error('[naverGet]',path,d.errorCode,d.errorMessage);resolve(null);return;}
            resolve(d);
          }catch(e){resolve(null);}
        });
      });
      req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve(null);}});
      req.setTimeout(4500,function(){req.destroy();});
      req.end();
    }catch(e){resolve(null);}
  });
}

// ── 공통 POST (항상 resolve) ──────────────────────────────────
function naverPost(path, body){
  return new Promise(function(resolve){
    try{
      var buf=Buffer.from(JSON.stringify(body),'utf8');
      var done=false;
      var t=setTimeout(function(){if(!done){done=true;resolve(null);}},5000);
      var req=https.request({
        hostname:'openapi.naver.com', path:path, method:'POST',
        headers:{'X-Naver-Client-Id':process.env.NAVER_CLIENT_ID,'X-Naver-Client-Secret':process.env.NAVER_CLIENT_SECRET,'Content-Type':'application/json','Content-Length':buf.length}
      },function(res){
        var raw='';
        res.on('data',function(c){raw+=c;});
        res.on('end',function(){
          if(done)return; done=true; clearTimeout(t);
          try{
            var d=JSON.parse(raw);
            if(d.errorCode){console.error('[naverPost]',path,d.errorCode,d.errorMessage);resolve(null);return;}
            resolve(d);
          }catch(e){resolve(null);}
        });
      });
      req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve(null);}});
      req.setTimeout(4500,function(){req.destroy();});
      req.write(buf); req.end();
    }catch(e){resolve(null);}
  });
}

// ── [2] 네이버 검색 — 키워드 변형 + fallback ─────────────────
async function fetchNaverSearchData(keyword){
  // 1차: 기본 키워드
  var result = await _fetchSearch(keyword);
  if(result) return result;

  // 2차: "키워드 추천" 으로 재시도
  await sleep(300);
  console.warn('[search retry]', keyword+'→'+keyword+' 추천');
  result = await _fetchSearch(keyword+' 추천');
  if(result) return result;

  // 3차: fallback [6]
  console.warn('[search fallback]', keyword);
  return {
    blogCount:0, newsCount:0, cafeCount:0, kinCount:0, cafeSignal:'none',
    shopExists:false, shopItemCount:0, buyIntentHits:0, shoppingExists:false,
    allText:'', sampleShopItems:[],
    _fallback: true,
  };
}

async function _fetchSearch(keyword){
  var blogRes = await naverGet('/v1/search/blog.json',{query:keyword,display:10,sort:'date'});
  await sleep(150);
  var shopRes = await naverGet('/v1/search/shop.json',{query:keyword,display:10,sort:'sim'});
  await sleep(150);
  var newsRes = await naverGet('/v1/search/news.json',{query:keyword,display:10,sort:'date'});

  if(!blogRes&&!shopRes&&!newsRes) return null;

  var blogCount  = blogRes?safeNum(blogRes.total):0;
  var newsCount  = newsRes?safeNum(newsRes.total):0;
  var shopExists = !!(shopRes&&shopRes.items&&shopRes.items.length>0);
  var shopItems  = shopRes?(shopRes.items||[]):[];

  // [2] title + description 모두 분석, HTML 태그 제거
  var allTitles=[];
  if(blogRes&&blogRes.items) allTitles=allTitles.concat(blogRes.items.map(function(i){
    return stripHtml(i.title)+' '+stripHtml(i.description||'');
  }));
  if(shopRes&&shopRes.items) allTitles=allTitles.concat(shopRes.items.map(function(i){
    return stripHtml(i.title)+' '+stripHtml(i.description||'');
  }));
  if(newsRes&&newsRes.items) allTitles=allTitles.concat(newsRes.items.map(function(i){
    return stripHtml(i.title)+' '+stripHtml(i.description||'');
  }));
  var allText=allTitles.join(' ');
  var buyIntentHits=0;
  CFG.BUY_INTENT_SIGNALS.forEach(function(sig){if(allText.indexOf(sig)>-1)buyIntentHits++;});

  // 최소 1개라도 수집되면 성공으로 간주
  if(blogCount===0&&newsCount===0&&!shopExists) return null;

  return {
    blogCount, newsCount, cafeCount:0, kinCount:0, cafeSignal:'none',
    shopExists, shopItemCount:shopItems.length,
    buyIntentHits, shoppingExists:shopExists, allText,
    sampleShopItems:shopItems.slice(0,3).map(function(i){
      return {title:stripHtml(i.title),price:safeNum(i.lprice),link:i.link||''};
    }),
  };
}

// ── 자동완성 ──────────────────────────────────────────────────
function fetchNaverSuggestions(keyword){
  return new Promise(function(resolve){
    try{
      var enc=encodeURIComponent(keyword);
      var done=false;
      var t=setTimeout(function(){if(!done){done=true;resolve([]);}},3000);
      var req=https.request({
        hostname:'ac.search.naver.com',
        path:'/nx/ac?q='+enc+'&q_enc=UTF-8&st=100&r_format=json&r_enc=UTF-8',
        method:'GET',
        headers:{'User-Agent':'Mozilla/5.0','Referer':'https://search.naver.com/'}
      },function(res){
        var raw='';
        res.on('data',function(c){raw+=c;});
        res.on('end',function(){
          if(done)return; done=true; clearTimeout(t);
          try{
            var d=JSON.parse(raw);
            var items=(d.items&&d.items[0])?d.items[0].slice(0,8).map(function(r){return r[0];}):[];
            resolve(items);
          }catch(e){resolve([]);}
        });
      });
      req.on('error',function(){if(!done){done=true;clearTimeout(t);resolve([]);}});
      req.setTimeout(2500,function(){req.destroy();});
      req.end();
    }catch(e){resolve([]);}
  });
}

// ── [3] 데이터랩 — 유의어 그룹 + fallback ────────────────────
async function fetchNaverDatalabForKeyword(keyword, period){
  var synonyms = buildSynonymGroup(keyword);
  var totalDays = period==='month'?60:14;
  var timeUnit  = period==='month'?'week':'date';
  var body = {
    startDate: fmtDate(agoDate(totalDays+1)),
    endDate:   fmtDate(agoDate(1)),
    timeUnit:  timeUnit,
    keywordGroups:[{ groupName:keyword, keywords:synonyms }],
  };
  var data = await naverPost('/v1/datalab/search', body);
  if(data&&data.results&&data.results[0]) return parseDatalab(data.results[0], keyword);

  // 재시도: 단일 키워드
  await sleep(400);
  var body2 = {
    startDate: fmtDate(agoDate(totalDays+1)),
    endDate:   fmtDate(agoDate(1)),
    timeUnit:  timeUnit,
    keywordGroups:[{ groupName:keyword, keywords:[keyword] }],
  };
  var data2 = await naverPost('/v1/datalab/search', body2);
  if(data2&&data2.results&&data2.results[0]) return parseDatalab(data2.results[0], keyword);

  // fallback [6]
  console.warn('[datalab fallback]', keyword);
  return {surgeRate:0, accel:0, durability:50, _fallback:true};
}

function parseDatalab(result, keyword){
  var pts = result.data||[];
  if(pts.length<4) return {surgeRate:0,accel:0,durability:50,_fallback:true};
  var h   = Math.floor(pts.length/2);
  var avg = function(a){return a.reduce(function(s,p){return s+safeNum(p.ratio);},0)/(a.length||1);};
  var pa=avg(pts.slice(0,h)), ca=avg(pts.slice(h));
  var surge  = pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
  var mid=pts.slice(h), eh=mid.slice(0,Math.floor(mid.length/2)), rh=mid.slice(Math.floor(mid.length/2));
  var accel  = avg(eh)>0?Math.round(((avg(rh)-avg(eh))/avg(eh))*100):0;
  var all    = avg(pts);
  var dur    = Math.round((pts.filter(function(p){return safeNum(p.ratio)>=all;}).length/pts.length)*100);
  console.log('[datalab ok]', keyword, 'surge:'+surge+'% accel:'+accel+'%');
  return {surgeRate:surge, accel:accel, durability:dur};
}

// ── 쇼핑인사이트 ─────────────────────────────────────────────
async function fetchNaverShoppingInsight(keyword, catId, period){
  var totalDays=period==='month'?60:14, timeUnit=period==='month'?'week':'date';
  var data = await naverPost('/v1/datalab/shopping/category/keywords',{
    startDate:fmtDate(agoDate(totalDays+1)), endDate:fmtDate(agoDate(1)),
    timeUnit:timeUnit, category:catId||'50000007',
    keyword:[{name:keyword,param:[keyword]}], device:'',gender:'',ages:[],
  });
  if(!data||!data.results) return {clickSurge:0,clickAccel:0,clickDurability:50,shopTrend:'stable',currentRatio:0,_fallback:true};

  var pts=((data.results||[])[0]||{}).data||[];
  if(pts.length<4) return {clickSurge:0,clickAccel:0,clickDurability:50,shopTrend:'stable',currentRatio:0,_fallback:true};

  var h=Math.floor(pts.length/2);
  var avg=function(a){return a.reduce(function(s,p){return s+safeNum(p.ratio);},0)/(a.length||1);};
  var pa=avg(pts.slice(0,h)),ca=avg(pts.slice(h));
  var clickSurge=pa>0?Math.round(((ca-pa)/pa)*100):(ca>0?100:0);
  var last3=pts.slice(-3),prev3=pts.slice(Math.max(0,pts.length-6),-3);
  var clickAccel=avg(prev3)>0?Math.round(((avg(last3)-avg(prev3))/avg(prev3))*100):(avg(last3)>0?50:0);
  var all=avg(pts), dur=Math.round((pts.filter(function(p){return safeNum(p.ratio)>=all;}).length/pts.length)*100);
  var shopTrend=clickSurge>=30?'hot':clickSurge>=10?'rising':clickSurge>=-10?'stable':'falling';
  return {clickSurge,clickAccel,clickDurability:dur,shopTrend,currentRatio:Math.round(ca*10)/10};
}

// ── 전체검색 의도 분석 ────────────────────────────────────────
function calcSearchIntentFromData(keyword, naverData, suggestions){
  var sugs    = Array.isArray(suggestions)?suggestions:[];
  var kw      = typeof keyword==='string'?keyword.toLowerCase():'';
  var sugText = sugs.join(' ').toLowerCase();
  var score   = 30, type='explore', buyCnt=0, probCnt=0, infoCnt=0, detected=[];

  CFG.SEARCH_INTENT.BUY.forEach(function(p){
    if(kw.indexOf(p)>-1){buyCnt++;score+=8;type='buy';if(detected.length<3)detected.push(p);}
  });
  CFG.SEARCH_INTENT.PROBLEM.forEach(function(p){
    if(kw.indexOf(p)>-1){probCnt++;score+=6;type='problem';if(detected.length<3)detected.push(p);}
  });
  CFG.SEARCH_INTENT.INFO.forEach(function(p){
    if(kw.indexOf(p)>-1){infoCnt++;score+=3;if(type==='explore')type='info';}
  });
  if(/^[가-힣]{2,6}$/.test(keyword)){score+=12;if(type==='explore')type='buy';}

  if(sugs.length>=6) score+=10;
  else if(sugs.length>=3) score+=5;
  sugs.forEach(function(sug){
    var s2=sug.toLowerCase();
    CFG.SEARCH_INTENT.BUY.forEach(function(p){
      if(s2.indexOf(p)>-1){score+=2;if(detected.length<3)detected.push(p+'(자동완성)');}
    });
  });
  if(detected.length===0&&sugs.length>0){
    for(var si=0;si<Math.min(sugs.length,3);si++){
      if(sugs[si]!==keyword) detected.push(sugs[si]);
    }
  }

  if(!naverData||naverData._fallback){
    var br0=type==='buy'?Math.max(50,Math.round(buyCnt/Math.max(buyCnt+probCnt+infoCnt,1)*100)):0;
    return {type:type,score:Math.min(100,Math.max(0,Math.round(score))),buyRatio:br0,patterns:detected,suggestions:sugs};
  }

  var text=(naverData.allText||'').toLowerCase()+' '+kw;
  var tBuy=0,tProb=0,tInfo=0;
  CFG.SEARCH_INTENT.BUY.forEach(function(p){if(text.indexOf(p)>-1){tBuy++;if(detected.length<3)detected.push(p);}});
  CFG.SEARCH_INTENT.PROBLEM.forEach(function(p){if(text.indexOf(p)>-1){tProb++;if(detected.length<3)detected.push(p);}});
  CFG.SEARCH_INTENT.INFO.forEach(function(p){if(text.indexOf(p)>-1)tInfo++;});

  if(naverData.shoppingExists&&tBuy>=2)  type='buy';
  else if(tProb>tBuy&&tProb>=2)         type='problem';
  else if(tInfo>tBuy&&tInfo>tProb)      type='info';
  else if(naverData.buyIntentHits>=3)   type='buy';

  if(type==='buy')          score+=40;
  else if(type==='problem') score+=25;
  else if(type==='info')    score+=10;

  if(naverData.shoppingExists)                            score+=15;
  score+=Math.min(20,(naverData.buyIntentHits||0)*3);
  if((naverData.blogCount||0)>10000)                      score+=5;
  if((naverData.newsCount||0)>(naverData.blogCount||0)*2) score-=15;
  if(!naverData.shoppingExists)                           score-=10;

  if(sugs.length>=6) score+=10;
  else if(sugs.length>=3) score+=5;

  var tot=Math.max(tBuy+tProb+tInfo,1);
  var buyRatio=type==='buy'?Math.max(50,Math.round(tBuy/tot*100)):Math.round(tBuy/tot*100);
  return {type:type,score:Math.min(100,Math.max(0,Math.round(score))),buyRatio:buyRatio,patterns:detected.slice(0,3),suggestions:sugs};
}

// ── 클러스터 ──────────────────────────────────────────────────
function buildKeywordClusters(keywords){
  var clusters=[],assigned={};
  keywords.forEach(function(kw){
    if(assigned[kw]) return;
    var matched=false;
    for(var i=0;i<clusters.length;i++){
      var cl=clusters[i],root=cl.root;
      if(kw.indexOf(root)>-1||root.indexOf(kw)>-1){cl.keywords.push(kw);assigned[kw]=true;matched=true;break;}
      var minLen=Math.min(kw.length,root.length);
      if(minLen>=2){var c=0;for(var j=0;j<minLen;j++){if(kw[j]===root[j])c++;else break;} if(c>=2){cl.keywords.push(kw);assigned[kw]=true;matched=true;break;}}
    }
    if(!matched){clusters.push({root:kw,label:kw,keywords:[kw]});assigned[kw]=true;}
  });
  return clusters;
}

async function fetchNaverDatalabCluster(cluster, period){
  return fetchNaverDatalabForKeyword(cluster.root, period);
}

// ── 쇼핑 검색 결과에서 핵심 키워드 추출 ─────────────────────
function extractKeywordsFromTitles(titles){
  var stopWords=['추천','인기','최저가','무료배송','당일','판매','공식','정품',
    '할인','특가','세일','NEW','신상','베스트','핫딜','리미티드',
    'A형','B형','S','M','L','XL','XXL','1개','2개','세트','묶음'];

  var kwCount={};

  titles.forEach(function(title){
    // HTML 태그, 특수문자 제거
    var clean=title.replace(/<[^>]+>/g,'').replace(/[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F a-zA-Z0-9]/g,' ').trim();

    // 공백 기준 분리
    var tokens=clean.split(/\s+/).filter(function(t){
      return t.length>=2
        && !/^[0-9]+$/.test(t)                          // 숫자만 제거
        && !/^[A-Z0-9]{1,3}$/.test(t)                   // 단순 영문 약자 제거
        && !stopWords.some(function(s){ return t===s; }); // 불용어 제거
    });

    // 연속 2개 토큰 조합 (복합어 추출)
    for(var i=0;i<tokens.length;i++){
      var t1=tokens[i];
      kwCount[t1]=(kwCount[t1]||0)+1;
      if(i<tokens.length-1){
        var t2=tokens[i]+' '+tokens[i+1];
        // 복합어: 둘 다 한글이고 전체 길이 10자 이내
        if(/[\uAC00-\uD7A3]/.test(tokens[i+1]) && t2.length<=10){
          kwCount[t2]=(kwCount[t2]||0)+0.5;
        }
      }
    }
  });

  // 빈도 2 이상만, 점수 순 정렬
  return Object.keys(kwCount)
    .filter(function(k){ return kwCount[k]>=2; })
    .sort(function(a,b){ return kwCount[b]-kwCount[a]; })
    .slice(0,25); // 최대 25개
}

// ── 쇼핑인사이트 TOP 500 → TOP 20 키워드 추출 ───────────────
// 쇼핑 검색 API: display=100, start=1/101/201/301/401 (5회 = 500개)
async function fetchShoppingTop500Keywords(catId, period){
  var query=(CFG.CATEGORY_SEARCH_QUERY&&CFG.CATEGORY_SEARCH_QUERY[catId])||'인기';
  var allTitles=[];

  // 500개 수집 (100개씩 5회)
  for(var page=0;page<5;page++){
    var start=page*100+1;
    var res=await naverGet('/v1/search/shop.json',{
      query:   query,
      display: 100,
      start:   start,
      sort:    'sim',
    });
    if(res&&res.items&&res.items.length){
      res.items.forEach(function(item){
        allTitles.push((item.title||'')+(item.category3?' '+item.category3:'')+(item.category4?' '+item.category4:''));
      });
      console.log('[top500]',catId,'page'+(page+1)+' 수집:'+res.items.length+'개 (누적:'+allTitles.length+')');
    } else {
      console.warn('[top500]',catId,'page'+(page+1)+' 응답 없음 — 중단');
      break;
    }
    await sleep(150);
  }

  if(!allTitles.length) return [];

  // 키워드 추출 + 빈도 계산
  var extracted=extractKeywordsFromTitles(allTitles);
  console.log('[top500]',catId,'총',allTitles.length,'개 상품 → 상위 키워드:',extracted.slice(0,20).join(', '));

  // TOP 20 반환
  return extracted.slice(0,20);
}

// ── 카테고리 TOP 키워드 수집 (방법 1 — TOP 500 기반) ─────────
async function fetchCategoryTopKeywords(catIds, period){
  var allKeywords=[];

  for(var i=0;i<catIds.length;i++){
    var catId=catIds[i];
    console.log('[cat]',catId,'TOP500 수집 시작');

    // STEP 1: 쇼핑 TOP 500에서 TOP 20 키워드 추출
    var top20=await fetchShoppingTop500Keywords(catId,period);

    if(!top20.length){
      // 폴백: CATEGORY_SEEDS
      console.warn('[cat]',catId,'TOP500 실패 — SEEDS 폴백');
      top20=(CFG.CATEGORY_SEEDS&&CFG.CATEGORY_SEEDS[catId])||[];
      top20=top20.slice(0,10);
    }

    // STEP 2: TOP 20 키워드를 쇼핑인사이트로 트렌드 점수화
    var catItems=[];
    for(var j=0;j<top20.length;j++){
      var kw=top20[j];
      var insight=await fetchNaverShoppingInsight(kw,catId,period);
      var trendScore=0;
      if(insight&&!insight._fallback){
        trendScore=Math.max(0,insight.clickSurge||0)+Math.max(0,insight.clickAccel||0);
        if(insight.shopTrend==='hot')         trendScore+=30;
        else if(insight.shopTrend==='rising') trendScore+=15;
        else if(insight.shopTrend==='stable') trendScore+=5;
      } else {
        trendScore=10; // 인사이트 실패해도 0점 금지
      }
      catItems.push({
        keyword:    kw,
        catId:      catId,
        insightData:insight&&!insight._fallback?insight:null,
        trendScore: trendScore,
      });
      await sleep(120);
    }

    // 트렌드 점수 순 정렬
    catItems.sort(function(a,b){return b.trendScore-a.trendScore;});

    // 단일 카테고리: 최대 10개 / 복수 카테고리: 상위 3개
    var take=catIds.length===1?Math.min(catItems.length,10):3;
    allKeywords=allKeywords.concat(catItems.slice(0,take));

    console.log('[cat]',catId,'최종:'+take+'개',
      catItems.slice(0,take).map(function(c){
        return c.keyword+'('+c.trendScore+'점)';
      }).join(', '));

    if(i<catIds.length-1) await sleep(300);
  }

  allKeywords.sort(function(a,b){return b.trendScore-a.trendScore;});
  var finalLimit=catIds.length===1?10:15;
  console.log('[fetchCategoryTopKeywords] 최종:'+Math.min(allKeywords.length,finalLimit)+'개');
  return allKeywords.slice(0,finalLimit);
}

// ── 배치 수집 ─────────────────────────────────────────────────
async function fetchNaverBatch(keywords, period, scope, catIdMap){
  var s=scope||'all', results={};
  keywords.forEach(function(kw){ results[kw]={}; });

  // STEP A: 검색 — 1개씩 순차
  if(s!=='shop'){
    var searchOk=0;
    for(var i=0;i<keywords.length;i++){
      var kw=keywords[i];
      results[kw].search = await fetchNaverSearchData(kw); // 내부에서 재시도+fallback 처리
      if(results[kw].search && !results[kw].search._fallback) searchOk++;
      await sleep(200);
    }
    console.log('[STEP A] 검색 OK:'+searchOk+'/'+keywords.length);
  }

  // STEP B: 데이터랩 — 1개씩 순차 (유의어 그룹 내장)
  if(s!=='shop'){
    var dlOk=0;
    for(var di=0;di<keywords.length;di++){
      var dkw=keywords[di];
      results[dkw].datalab = await fetchNaverDatalabForKeyword(dkw, period);
      if(results[dkw].datalab && !results[dkw].datalab._fallback) dlOk++;
      await sleep(300);
    }
    console.log('[STEP B] 데이터랩 OK:'+dlOk+'/'+keywords.length);
  }

  // STEP C: 쇼핑인사이트 — 1개씩 순차
  if(s!=='search'){
    var insightOk=0;
    for(var k=0;k<keywords.length;k++){
      var ikw=keywords[k];
      if(results[ikw].insight){ insightOk++; continue; }
      var cid=(catIdMap&&catIdMap[ikw])||null;
      results[ikw].insight = await fetchNaverShoppingInsight(ikw, cid, period);
      if(results[ikw].insight && !results[ikw].insight._fallback) insightOk++;
      await sleep(200);
    }
    console.log('[STEP C] 인사이트 OK:'+insightOk+'/'+keywords.length);
  }

  return results;
}

module.exports = {
  fetchNaverSearchData,
  fetchNaverSuggestions,
  fetchNaverDatalab: async function(keywords, period){
    var result={};
    for(var i=0;i<keywords.length;i++){
      result[keywords[i]]=await fetchNaverDatalabForKeyword(keywords[i],period);
      await sleep(200);
    }
    return result;
  },
  fetchNaverShoppingInsight,
  fetchNaverBatch,
  calcSearchIntentFromData,
  fetchCategoryTopKeywords,
  buildKeywordClusters,
  fetchNaverDatalabCluster,
  fetchNaverDatalabForKeyword,
};
