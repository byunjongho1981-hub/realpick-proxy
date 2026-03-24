var https = require('https');
var CFG   = require('./_trend-config');

// ── Gemini POST (공식 SDK 방식 직접 구현) ────────────────────
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
  try{
    return ((resp.candidates||[])[0].content.parts||[])[0].text||'';
  }catch(e){ return ''; }
}

function safeJson(text){
  try{
    var m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if(!m) return null;
    return JSON.parse(m[0]);
  }catch(e){ return null; }
}

// ── 1. 전체 후보군 종합 비교 + 그룹 설명 ─────────────────────
async function mergeAndSummarizeSignals(candidates){
  if(!candidates || !candidates.length) return null;
  var summary = candidates.slice(0,10).map(function(c){
    return c.productName+'(점수:'+c.finalScore+',그룹:'+c.group+')';
  }).join(', ');
  var prompt =
    '아래 제품 후보들을 종합 분석하라.\n'+
    '후보: '+summary+'\n\n'+
    '1) 전체적 트렌드 특징 한 줄\n'+
    '2) 최우선 추천 이유 한 줄\n'+
    '3) 주의해야 할 점 한 줄\n'+
    'JSON: {"overallTrend":"","topReason":"","caution":""}';
  try{
    var resp   = await geminiPost(prompt, 400);
    var text   = getText(resp);
    var parsed = safeJson(text);
    if(parsed && parsed.overallTrend) return parsed;
  }catch(e){ console.error('[gemini-merge]', e.message); }
  return null;
}

// ── 2. 키워드군 클러스터 비교 ────────────────────────────────
async function compareKeywordClusters(clusters){
  if(!clusters || !clusters.length) return null;
  var clusterText = clusters.map(function(cl){
    return '['+cl.label+']: '+cl.keywords.join(', ');
  }).join('\n');
  var prompt =
    '아래 키워드 클러스터들을 비교 분석하라.\n'+
    clusterText+'\n\n'+
    '각 클러스터에 대해:\n'+
    '- 대표 의미\n'+
    '- 제품 후보 (일반명사형, 1~2개)\n'+
    '- 블루오션 여부\n'+
    'JSON 배열: [{"cluster":"라벨","meaning":"의미","products":["제품"],"isBlueOcean":bool}]';
  try{
    var resp   = await geminiPost(prompt, 600);
    var text   = getText(resp);
    var parsed = safeJson(text);
    if(Array.isArray(parsed)) return parsed;
  }catch(e){ console.error('[gemini-cluster]', e.message); }
  return null;
}

// ── 3. 왜 지금인지 설명 ──────────────────────────────────────
async function explainWhyNow(candidate){
  var prompt =
    '제품: '+candidate.productName+'\n'+
    '지속성점수: '+((candidate.scores&&candidate.scores.persistence)||0)+'\n'+
    '최근상승점수: '+((candidate.scores&&candidate.scores.recentRise)||0)+'\n'+
    '구매의도점수: '+((candidate.scores&&candidate.scores.buyIntent)||0)+'\n'+
    '쇼핑관심점수: '+((candidate.scores&&candidate.scores.shoppingInterest)||0)+'\n'+
    '유튜브확산점수: '+((candidate.scores&&candidate.scores.youtubeViral)||0)+'\n\n'+
    '"왜 지금 테스트해야 하는가"를 데이터 기반으로 2~3문장으로 설명하라.\n'+
    '근거 있게, 과장 없이. JSON: {"explanation":""}';
  try{
    var resp   = await geminiPost(prompt, 300);
    var text   = getText(resp);
    var parsed = safeJson(text);
    if(parsed && parsed.explanation) return parsed.explanation;
  }catch(e){ console.error('[gemini-why]', e.message); }
  return '데이터 기반 검증을 통해 상승 가능성이 확인된 제품입니다.';
}

// ── 4. 신뢰 보정 점수 보조 ───────────────────────────────────
async function calcTrustBonusGemini(candidate){
  var prompt =
    '제품: '+candidate.productName+'\n'+
    '키워드유형: '+candidate.kwType+'\n'+
    '구매의도점수: '+((candidate.scores&&candidate.scores.buyIntent)||0)+'\n'+
    '쇼핑관심점수: '+((candidate.scores&&candidate.scores.shoppingInterest)||0)+'\n\n'+
    '이 후보의 신뢰도 보정값을 -20~+20 범위로 평가하라.\n'+
    '브랜드종속/일시이슈 → 음수, 일반명사/문제해결형 → 양수\n'+
    'JSON: {"adjustment":숫자,"reason":"이유한줄"}';
  try{
    var resp   = await geminiPost(prompt, 200);
    var text   = getText(resp);
    var parsed = safeJson(text);
    if(parsed && typeof parsed.adjustment === 'number') return parsed;
  }catch(e){ console.error('[gemini-trust]', e.message); }
  return null;
}

// ── 5. 최종 보고서 생성 ──────────────────────────────────────
async function generateFinalNarrative(topCandidates, summary){
  if(!topCandidates || !topCandidates.length) return '';
  var top3 = topCandidates.slice(0,3).map(function(c){
    return c.productName+'('+c.finalScore+'점, '+c.group+')';
  }).join(' / ');
  var prompt =
    '분석 결과 TOP3: '+top3+'\n'+
    '전체 요약: '+(summary&&summary.overallTrend||'')+'\n\n'+
    '실제 수익화(쇼츠+블로그+제휴마케팅)를 위한 실행 가이드를 3줄로 작성하라.\n'+
    '초보자도 이해할 수 있게, 구체적으로.\n'+
    'JSON: {"guide":"실행가이드(줄바꿈\\n사용)"}';
  try{
    var resp   = await geminiPost(prompt, 400);
    var text   = getText(resp);
    var parsed = safeJson(text);
    if(parsed && parsed.guide) return parsed.guide;
  }catch(e){ console.error('[gemini-narrative]', e.message); }
  return 'TOP 후보 제품으로 쇼츠 영상을 먼저 제작하고\n블로그 리뷰로 검색 트래픽을 확보하세요.\n쿠팡 파트너스 링크를 삽입하여 제휴 수익을 창출하세요.';
}

module.exports = {
  mergeAndSummarizeSignals,
  compareKeywordClusters,
  explainWhyNow,
  calcTrustBonusGemini,
  generateFinalNarrative,
};
