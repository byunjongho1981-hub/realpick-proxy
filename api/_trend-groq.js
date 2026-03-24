var https  = require('https');
var CFG    = require('./_trend-config');

// ── Groq POST ─────────────────────────────────────────────────
function groqPost(messages, maxTokens){
  var key = process.env.GROQ_API_KEY;
  if(!key) return Promise.reject(new Error('GROQ_API_KEY 없음'));
  var body = Buffer.from(JSON.stringify({
    model:       CFG.GROQ_MODEL,
    messages:    messages,
    max_tokens:  maxTokens||800,
    temperature: 0.1,
  }),'utf8');
  return new Promise(function(resolve, reject){
    var t = setTimeout(function(){reject(new Error('groq timeout'));}, 20000);
    var req = https.request({
      hostname:'api.groq.com', path:'/openai/v1/chat/completions', method:'POST',
      headers:{
        'Authorization':'Bearer '+key,
        'Content-Type':'application/json',
        'Content-Length': body.length,
      }
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

function safeJson(text){
  try{
    var m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if(!m) return null;
    return JSON.parse(m[0]);
  }catch(e){ return null; }
}

function getText(resp){
  return (((resp.choices||[])[0]||{}).message||{}).content||'';
}

// ── 규칙 기반 키워드 유형 분류 (폴백) ────────────────────────
function ruleBasedClassify(kw){
  var KT = CFG.KW_TYPE;
  // 노이즈 체크
  for(var i=0;i<CFG.NOISE_PATTERNS.length;i++){
    if(CFG.NOISE_PATTERNS[i].test(kw)) return KT.NEWS_EVENT;
  }
  // 브랜드 체크
  for(var j=0;j<CFG.BRAND_PATTERNS.length;j++){
    if(CFG.BRAND_PATTERNS[j].test(kw)) return KT.BRAND;
  }
  // 문제/상황 신호
  if(/불편|아프|피곤|냄새|곰팡이|통증|힘들|안됨|고민|문제/.test(kw)) return KT.PROBLEM;
  if(/할 때|할때|상황|경우|때문에|위해/.test(kw)) return KT.SITUATION;
  if(/하는법|방법|어떻게|사용법|따라하기/.test(kw)) return KT.ACTION;
  // 제품 직접 키워드 신호
  if(/기계|장치|용품|제품|아이템|도구|기기|세트|팩|크림|오일|스프레이|패드|커버|케이스/.test(kw)) return KT.PRODUCT_DIRECT;
  if(/추천|best|순위|가성비|리뷰/.test(kw)) return KT.GENERAL_PRODUCT;
  return KT.UNKNOWN;
}

// ── 규칙 기반 문제→제품 매핑 (폴백) ─────────────────────────
function ruleBasedProductMapping(kw){
  var keys = Object.keys(CFG.PROBLEM_TO_PRODUCT);
  for(var i=0;i<keys.length;i++){
    if(kw.indexOf(keys[i])>-1 || keys[i].indexOf(kw)>-1){
      return CFG.PROBLEM_TO_PRODUCT[keys[i]];
    }
  }
  // 기본: 키워드 + 용품/도구
  return [kw+' 용품', kw+' 해결 도구'];
}

// ── 1. 키워드 정규화 + 유형 분류 ─────────────────────────────
async function classifyKeywords(keywords){
  var prompt =
    '아래 키워드 목록을 분석하라. 각 키워드에 대해 JSON 배열로만 응답하라.\n'+
    '유형: product_direct|problem|situation|action|brand|news_event|general_product|unknown\n'+
    '노이즈(정치/연예/사고/스포츠결과) → news_event\n'+
    '브랜드명 → brand\n'+
    'JSON 형식: [{"kw":"원본","normalized":"정규화","type":"유형","isNoise":bool}]\n\n'+
    '키워드:\n'+keywords.join('\n');
  try{
    var resp = await groqPost([
      {role:'system',content:'한국 커머스 트렌드 분석 전문가. JSON만 출력.'},
      {role:'user',  content:prompt},
    ], 1000);
    var text   = getText(resp);
    var parsed = safeJson(text);
    if(Array.isArray(parsed)) return parsed;
  }catch(e){ console.error('[groq-classify]', e.message); }
  // 폴백: 규칙 기반
  return keywords.map(function(kw){
    return { kw:kw, normalized:kw, type:ruleBasedClassify(kw), isNoise:CFG.NOISE_PATTERNS.some(function(p){return p.test(kw);}) };
  });
}

// ── 2. 문제/상황 → 제품 후보 매핑 ──────────────────────────
async function mapKeywordToProducts(keyword, kwType){
  if(kwType !== CFG.KW_TYPE.PROBLEM && kwType !== CFG.KW_TYPE.SITUATION){
    return [keyword];
  }
  var prompt =
    '"'+keyword+'"는 문제/상황 키워드다.\n'+
    '이 문제를 해결할 수 있는 실제 구매 가능한 제품 후보 3개를 JSON 배열로만 출력하라.\n'+
    '브랜드명 없이 일반 제품명으로. 예: ["폼롤러","마사지건","근육이완크림"]\n'+
    '조건: 쿠팡/네이버쇼핑에서 바로 검색 가능한 제품명. JSON만 출력.';
  try{
    var resp   = await groqPost([
      {role:'system',content:'한국 이커머스 상품 전문가. JSON 배열만 출력.'},
      {role:'user',  content:prompt},
    ], 300);
    var text   = getText(resp);
    var parsed = safeJson(text);
    if(Array.isArray(parsed) && parsed.length) return parsed.slice(0,3);
  }catch(e){ console.error('[groq-map]', e.message); }
  return ruleBasedProductMapping(keyword);
}

// ── 3. 이유 요약 생성 ────────────────────────────────────────
async function generateReasonSummary(candidate){
  var prompt =
    '제품: '+candidate.productName+'\n'+
    '원본키워드: '+candidate.originalKeyword+'\n'+
    '7일CSV: '+(candidate.kw7d&&candidate.kw7d.exists?'있음':'없음')+'\n'+
    '24시간CSV: '+(candidate.kw24h&&candidate.kw24h.exists?'있음':'없음')+'\n'+
    '최종점수: '+candidate.finalScore+'\n'+
    '그룹: '+candidate.group+'\n\n'+
    '이 제품이 왜 지금 테스트해야 하는지 한 줄(50자 이내)로 설명하라.\n'+
    '쇼츠 아이디어 한 줄, 블로그 주제 한 줄도 각각 작성하라.\n'+
    'JSON: {"reason":"한줄이유","shorts":"쇼츠아이디어","blog":"블로그주제"}';
  try{
    var resp   = await groqPost([
      {role:'system',content:'한국 쇼츠/블로그 콘텐츠 전문가. JSON만 출력.'},
      {role:'user',  content:prompt},
    ], 400);
    var text   = getText(resp);
    var parsed = safeJson(text);
    if(parsed && parsed.reason) return parsed;
  }catch(e){ console.error('[groq-reason]', e.message); }
  return {
    reason:  candidate.productName+'의 검색 상승세가 확인됨. 지금 콘텐츠 선점 필요.',
    shorts:  candidate.productName+' 사용 전후 비교 쇼츠',
    blog:    candidate.productName+' 추천 + 가격비교 블로그',
  };
}

// ── 4. 제품 전환 적합성 점수 보조 ────────────────────────────
async function calcProductFitGroq(keyword, kwType){
  var prompt =
    '키워드: "'+keyword+'" (유형: '+kwType+')\n'+
    '이 키워드를 네이버/쿠팡에서 실제 판매되는 제품으로 연결할 수 있는지 평가하라.\n'+
    'score: 0~100 (100=바로 제품 구매 가능, 0=제품 연결 불가능)\n'+
    '{"score":숫자,"reason":"이유 한 줄"}';
  try{
    var resp   = await groqPost([
      {role:'system',content:'한국 이커머스 전문가. JSON만 출력.'},
      {role:'user',  content:prompt},
    ], 200);
    var text   = getText(resp);
    var parsed = safeJson(text);
    if(parsed && typeof parsed.score === 'number') return parsed;
  }catch(e){ console.error('[groq-fit]', e.message); }
  return null;
}

module.exports = {
  classifyKeywords,
  mapKeywordToProducts,
  generateReasonSummary,
  calcProductFitGroq,
  ruleBasedClassify,
  ruleBasedProductMapping,
};
