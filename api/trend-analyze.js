// collectExternalData 함수 전체 교체
async function collectExternalData(candidates, period, apiStatus, scope, preInsightMap){
  var productNames = candidates.map(function(c){ return c.productName; });

  console.log('[DEBUG 1] collectExternalData 시작');
  console.log('[DEBUG 2] productNames:', JSON.stringify(productNames));
  console.log('[DEBUG 3] scope:', scope, '/ period:', period);

  // catId 맵
  var catIdMap = {};
  candidates.forEach(function(c){ if(c.catId) catIdMap[c.productName] = c.catId; });
  console.log('[DEBUG 4] catIdMap:', JSON.stringify(catIdMap));

  // pre-fetch insight 주입
  if(preInsightMap){
    candidates.forEach(function(c){
      if(!c.insightData && preInsightMap[c.originalKeyword])
        c.insightData = preInsightMap[c.originalKeyword];
    });
  }
  var preCount = candidates.filter(function(c){ return !!c.insightData; }).length;
  console.log('[DEBUG 5] pre-fetch insight 주입:', preCount+'개');

  // ── 네이버 배치 수집 ─────────────────────────────────────
  var naverBatch = {};
  try{
    console.log('[DEBUG 6] fetchNaverBatch 호출 시작');
    naverBatch = await NAVER.fetchNaverBatch(productNames, period, scope, catIdMap);
    console.log('[DEBUG 7] fetchNaverBatch 완료. keys:', JSON.stringify(Object.keys(naverBatch)));
  }catch(e){
    console.error('[DEBUG ERR] fetchNaverBatch 예외 발생:', e.message, e.stack);
    apiStatus.naver = '❌ exception: ' + e.message;
  }

  // 수집 결과 집계
  var searchOk=0, dlOk=0, insightOk=0;
  productNames.forEach(function(p){
    var nd = naverBatch[p] || {};
    console.log('[DEBUG 8] 키워드:'+p+' search:'+(nd.search?'ok':'null')+' datalab:'+(nd.datalab?'ok':'null')+' insight:'+(nd.insight?'ok':'null'));
    if(nd.search)  searchOk++;
    if(nd.datalab) dlOk++;
    if(nd.insight) insightOk++;
  });

  console.log('[DEBUG 9] 최종집계 search:'+searchOk+' datalab:'+dlOk+' insight:'+insightOk+'/'+productNames.length);

  apiStatus.naver_search  = searchOk>0  ? '✅ 검색 '+searchOk+'/'+productNames.length   : '❌ 검색 0건';
  apiStatus.naver_datalab = dlOk>0      ? '✅ 데이터랩 '+dlOk+'/'+productNames.length   : '❌ 데이터랩 0건';
  apiStatus.naver_insight = insightOk>0 ? '✅ 인사이트 '+insightOk+'/'+productNames.length : '❌ 인사이트 0건';

  if(searchOk===0 && dlOk===0){
    console.error('[DEBUG 10] 검색+데이터랩 전부 0 — 인사이트+YouTube만으로 진행');
    apiStatus.naver = '⚠️ 검색/데이터랩 0건';
  } else {
    apiStatus.naver = '✅ 검색'+searchOk+' 데이터랩'+dlOk+' 인사이트'+insightOk;
  }

  // candidates에 데이터 주입
  candidates.forEach(function(c){
    var nd = naverBatch[c.productName] || {};
    c.naverData   = nd.search  || c.naverData  || null;
    c.datalabData = nd.datalab || c.datalabData || null;
    if(!c.insightData) c.insightData = nd.insight || null;
    if(c.naverData && c.datalabData)
      c.shopWeakVsSearch = !c.naverData.shoppingExists && safeNum(c.datalabData.surgeRate) > 20;
  });

  // ── YouTube ───────────────────────────────────────────────
  var ytBatch = {};
  try{
    console.log('[DEBUG 11] YouTube 수집 시작');
    ytBatch = await YOUTUBE.fetchYouTubeBatch(productNames.slice(0,10));
    console.log('[DEBUG 12] YouTube 완료:', Object.keys(ytBatch).length+'개');
    apiStatus.youtube = '✅ YouTube '+Object.keys(ytBatch).length+'개';
  }catch(e){
    console.error('[DEBUG ERR] YouTube 예외:', e.message);
    apiStatus.youtube = '❌ '+e.message;
  }

  candidates.forEach(function(c){
    c.ytData = ytBatch[c.productName] || null;
    if(c.ytData){
      c.isShortsCompatible = !!c.ytData.isShortsCompatible;
      c.isBlogCompatible   = !!c.ytData.isBlogCompatible;
      c.hasVisualHook      = !!c.ytData.hasVisualHook;
      c.hasUsageScene      = !!c.ytData.hasUsageScene;
    }
  });

  return candidates;
}
