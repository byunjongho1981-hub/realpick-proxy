var https = require('https');
var CFG   = require('./_trend-config');

function geminiPost(prompt, maxTokens){
  var key   = process.env.GEMINI_API_KEY;
  if(!key) return Promise.reject(new Error('GEMINI_API_KEY 없음'));
  var model = CFG.GEMINI_MODEL;
  var body  = Buffer.from(JSON.stringify({
    contents:[{ parts:[{ text: prompt }] }],
    generationConfig:{ maxOutputTokens: maxTokens||1000, temperature:0.1 },
  }),'utf8');
  var path = '/v1beta/models/'+model+':generateContent?key='+key;
  return new Promise(function(resolve, reject){
    var t = setTimeout(function(){reject(new Error('gemini timeout'));}, 25000);
    var req = https.request({
      hostname:'generativelanguage.googleapis.com',
      path:path, method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':body.length},
    }, function(res){
      var raw='';
      res.on('data',function(c){raw+=c;});
      res.on('end', function(){
        clearTimeout(t);
        try{ resolve(JSON.parse(raw)); }catch(e){ resolve({}); }
      });
    });
    req.on('error',function(e){clearTimeout(t); reject(e);});
    req.write(body); req.end();
  });
}

function getText(resp){
  try{ return ((resp.candidates||[])[0].content.parts||[])[0].text||''; }catch(e){ return ''; }
}
function safeJson(text){
  try{ var m=text.match(/\{[\s\S]*\}|\[[\s\S]*\]/); if(!m) return null; return JSON.parse(m[0]); }catch(e){ return null; }
}

// ── 1. 전체 후보군 종합 비교 + 그룹 설명 ─────────────────────
async function mergeAndSummarizeSignals(candidates){
  if(!candidates||!candidates.length) return null;
  var summary=candidates.slice(0,10).map(function(c){
    return c.productName+'(점수:'+c.finalScore+',그룹:'+c.group+')';
  }).join(', ');
  var prompt='아래 제품 후보들을 종합 분석하라.\n후보: '+summary+'\n\n'
    +'1) 전체적 트렌드 특징 한 줄\n2) 최우선 추천 이유 한 줄\n3) 주의해야 할 점 한 줄\n'
    +'JSON: {"overallTrend":"","topReason":"","caution":""}';
  try{
    var resp=await geminiPost(prompt,400);
    var parsed=safeJson(getText(resp));
    if(parsed&&parsed.overallTrend) return parsed;
  }catch(e){ console.error('[gemini-merge]',e.message); }
  return null;
}

// ── 2. 키워드군 클러스터 비교 ────────────────────────────────
async function compareKeywordClusters(clusters){
  if(!clusters||!clusters.length) return null;
  var clusterText=clusters.map(function(cl){
    return '['+cl.label+']: '+cl.keywords.join(', ');
  }).join('\n');
  var prompt='아래 키워드 클러스터들을 비교 분석하라.\n'+clusterText+'\n\n'
    +'각 클러스터에 대해:\n- 대표 의미\n- 제품 후보 (일반명사형, 1~2개)\n- 블루오션 여부\n'
    +'JSON 배열: [{"cluster":"라벨","meaning":"의미","products":["제품"],"isBlueOcean":bool}]';
  try{
    var resp=await geminiPost(prompt,600);
    var parsed=safeJson(getText(resp));
    if(Array.isArray(parsed)) return parsed;
  }catch(e){ console.error('[gemini-cluster]',e.message); }
  return null;
}

// ── 3. 왜 지금인지 설명 ──────────────────────────────────────
async function explainWhyNow(candidate){
  var sc=candidate.scores||{};
  var prompt='제품: '+candidate.productName+'\n'
    +'지속성점수: '+(sc.persistence||0)+'\n'
    +'최근상승점수: '+(sc.recentRise||0)+'\n'
    +'구매의도점수: '+(sc.buyIntent||0)+'\n'
    +'쇼핑관심점수: '+(sc.shoppingInterest||0)+'\n'
    +'유튜브확산점수: '+(sc.youtubeViral||0)+'\n\n'
    +'"왜 지금 테스트해야 하는가"를 데이터 기반으로 2~3문장으로 설명하라.\n'
    +'근거 있게, 과장 없이. JSON: {"explanation":""}';
  try{
    var resp=await geminiPost(prompt,300);
    var parsed=safeJson(getText(resp));
    if(parsed&&parsed.explanation) return parsed.explanation;
  }catch(e){ console.error('[gemini-why]',e.message); }
  return '데이터 기반 검증을 통해 상승 가능성이 확인된 제품입니다.';
}

// ── 4. 신뢰 보정 점수 보조 ───────────────────────────────────
async function calcTrustBonusGemini(candidate){
  var sc=candidate.scores||{};
  var prompt='제품: '+candidate.productName+'\n'
    +'키워드유형: '+candidate.kwType+'\n'
    +'구매의도점수: '+(sc.buyIntent||0)+'\n'
    +'쇼핑관심점수: '+(sc.shoppingInterest||0)+'\n\n'
    +'이 후보의 신뢰도 보정값을 -20~+20 범위로 평가하라.\n'
    +'브랜드종속/일시이슈 → 음수, 일반명사/문제해결형 → 양수\n'
    +'JSON: {"adjustment":숫자,"reason":"이유한줄"}';
  try{
    var resp=await geminiPost(prompt,200);
    var parsed=safeJson(getText(resp));
    if(parsed&&typeof parsed.adjustment==='number') return parsed;
  }catch(e){ console.error('[gemini-trust]',e.message); }
  return null;
}

// ── 5. 최종 가이드 생성 ──────────────────────────────────────
async function generateFinalNarrative(topCandidates, summary){
  if(!topCandidates||!topCandidates.length) return '';
  var top3=topCandidates.slice(0,3).map(function(c){
    return c.productName+'('+c.finalScore+'점,'+c.group+')';
  }).join(' / ');
  var prompt='분석 결과 TOP3: '+top3+'\n'
    +'전체 요약: '+(summary&&summary.overallTrend||'')+'\n\n'
    +'실제 수익화(쇼츠+블로그+제휴마케팅)를 위한 실행 가이드를 3줄로 작성하라.\n'
    +'초보자도 이해할 수 있게, 구체적으로.\n'
    +'JSON: {"guide":"실행가이드(줄바꿈\\n사용)"}';
  try{
    var resp=await geminiPost(prompt,400);
    var parsed=safeJson(getText(resp));
    if(parsed&&parsed.guide) return parsed.guide;
  }catch(e){ console.error('[gemini-narrative]',e.message); }
  return 'TOP 후보 제품으로 쇼츠 영상을 먼저 제작하고\n블로그 리뷰로 검색 트래픽을 확보하세요.\n쿠팡 파트너스 링크를 삽입하여 제휴 수익을 창출하세요.';
}

// ── 6. ★ [10] generateStructuredRecommendations ─────────────
// 전체 분석 결과를 구조화된 추천 보고서로 생성
// 각 후보별 콘텐츠 전략 + 수익화 방향을 JSON 스키마로 출력
async function generateStructuredRecommendations(candidates, groups){
  if(!candidates||!candidates.length) return null;

  var inputData = candidates.slice(0,10).map(function(c){
    var sc=c.scores||{};
    return {
      productName:     c.productName,
      finalScore:      c.finalScore,
      group:           c.group,
      kwType:          c.kwType,
      persistence:     Math.round(sc.persistence||0),
      recentRise:      Math.round(sc.recentRise||0),
      buyIntent:       Math.round(sc.buyIntent||0),
      shoppingInterest:Math.round(sc.shoppingInterest||0),
      youtubeViral:    Math.round(sc.youtubeViral||0),
      isShortsReady:   c.isShortsCompatible,
      isBlogReady:     c.isBlogCompatible,
      hasVisualHook:   c.hasVisualHook,
      hasUsageScene:   c.hasUsageScene,
    };
  });

  var groupSummary = {
    topTrend:     (groups&&groups['top_trend']||[]).length,
    stable:       (groups&&groups['stable']||[]).length,
    experimental: (groups&&groups['experimental']||[]).length,
  };

  var prompt =
    '아래 제품 후보 분석 결과를 바탕으로 구조화된 추천 보고서를 JSON으로 생성하라.\n\n'
    +'후보 데이터:\n'+JSON.stringify(inputData,null,2)+'\n\n'
    +'그룹 요약: 최우선 '+groupSummary.topTrend+'개 / 안정형 '+groupSummary.stable+'개 / 실험형 '+groupSummary.experimental+'개\n\n'
    +'아래 JSON 스키마를 반드시 준수하라:\n'
    +'{\n'
    +'  "executiveSummary": "전체 분석 요약 2문장",\n'
    +'  "immediateActions": [\n'
    +'    {\n'
    +'      "productName": "제품명",\n'
    +'      "priority": 1,\n'
    +'      "contentType": "shorts|blog|both",\n'
    +'      "monetization": "수익화 방법 1문장",\n'
    +'      "contentAngle": "콘텐츠 각도 1문장",\n'
    +'      "urgency": "즉시|이번주|이번달",\n'
    +'      "estimatedDifficulty": "low|medium|high"\n'
    +'    }\n'
    +'  ],\n'
    +'  "watchList": ["관망 추천 제품1", "관망 추천 제품2"],\n'
    +'  "avoidList": ["회피 추천 제품1"],\n'
    +'  "overallStrategy": "전체 전략 방향 2~3문장"\n'
    +'}\n\n'
    +'JSON만 출력. 마크다운 금지.';

  try{
    var resp=await geminiPost(prompt,1200);
    var text=getText(resp);
    var parsed=safeJson(text);
    if(parsed&&parsed.executiveSummary&&Array.isArray(parsed.immediateActions)){
      return parsed;
    }
  }catch(e){ console.error('[gemini-structured]',e.message); }

  // 폴백: 규칙 기반 구조화 추천
  return {
    executiveSummary: '총 '+candidates.length+'개 후보 중 최우선 '+groupSummary.topTrend+'개가 즉시 테스트 대상입니다. 쇼츠와 블로그를 병행하여 빠른 수익화를 시도하세요.',
    immediateActions: candidates.slice(0,5).map(function(c,i){
      return {
        productName:           c.productName,
        priority:              i+1,
        contentType:           c.isShortsCompatible&&c.isBlogCompatible?'both':c.isShortsCompatible?'shorts':'blog',
        monetization:          '쿠팡 파트너스 링크 삽입 후 제휴 수익 창출',
        contentAngle:          c.groqReason || (c.productName+' 추천 및 사용 후기'),
        urgency:               c.group==='top_trend'?'즉시':c.group==='stable'?'이번주':'이번달',
        estimatedDifficulty:   c.isHardToConvert?'high':c.isProblemSolving?'low':'medium',
      };
    }),
    watchList:      candidates.filter(function(c){return c.group==='experimental';}).slice(0,3).map(function(c){return c.productName;}),
    avoidList:      candidates.filter(function(c){return c.isBrandDependent||c.isTemporaryTrend;}).map(function(c){return c.productName;}),
    overallStrategy:'지속성과 최근 상승이 동시에 확인된 제품을 우선 테스트하세요. 쇼츠로 빠르게 반응을 확인하고, 반응이 좋으면 블로그 심화 콘텐츠로 전환하세요. 제휴 마케팅 링크는 반드시 포함하세요.',
  };
}

module.exports = {
  mergeAndSummarizeSignals,
  compareKeywordClusters,
  explainWhyNow,
  calcTrustBonusGemini,
  generateFinalNarrative,
  generateStructuredRecommendations,  // ★
};
