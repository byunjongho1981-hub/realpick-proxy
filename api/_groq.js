var https = require('https');

function groqPost(messages, maxTokens){
  var key = process.env.GROQ_API_KEY;
  if(!key) return Promise.reject(new Error('GROQ_API_KEY 없음'));
  var body = Buffer.from(JSON.stringify({
    model:       'llama-3.3-70b-versatile',
    messages:    messages,
    max_tokens:  maxTokens || 1200,
    temperature: 0.1
  }), 'utf8');
  return new Promise(function(resolve, reject){
    var t = setTimeout(function(){ reject(new Error('groq timeout')); }, 20000);
    var req = https.request({
      hostname:'api.groq.com', path:'/openai/v1/chat/completions', method:'POST',
      headers:{
        'Authorization': 'Bearer '+key,
        'Content-Type':  'application/json',
        'Content-Length': body.length
      }
    }, function(res){
      var raw='';
      res.on('data', function(c){ raw+=c; });
      res.on('end',  function(){ clearTimeout(t); try{ resolve(JSON.parse(raw)); }catch(e){ resolve({}); } });
    });
    req.on('error', function(e){ clearTimeout(t); reject(e); });
    req.write(body); req.end();
  });
}

function safeParseJson(text){
  try{
    var m = text.match(/\[[\s\S]*\]/);
    if(!m) return [];
    var r = JSON.parse(m[0]);
    return Array.isArray(r) ? r : [];
  }catch(e){ return []; }
}

// 멀티소스 통합 분석 → 제품 TOP10 추출
async function extractTrendingProducts(sources){
  var youtube   = sources.youtube   || [];
  var shorts    = sources.shorts    || [];
  var coupang   = sources.coupang   || [];
  var tiktok    = sources.tiktok    || [];
  var instagram = sources.instagram || [];
  var googleKr  = sources.googleKr  || [];
  var googleOs  = sources.googleOs  || [];
  var naver     = sources.naver     || [];

  var prompt = '아래 플랫폼 데이터를 교차 분석해서 향후 24-72시간 내 한국에서 떡상할 제품 TOP10을 추출해라.\n반드시 JSON 배열만 출력. 설명·마크다운 금지.\n\n';

  if(youtube.length || shorts.length){
    prompt += '[유튜브 급상승 영상 — 최근 48시간]\n';
    youtube.slice(0,12).forEach(function(v,i){ prompt+=(i+1)+'. '+v.title+'\n'; });
    shorts.slice(0,8).forEach(function(v){ prompt+='(Shorts) '+v.title+'\n'; });
    prompt += '\n';
  }
  if(coupang.length){
    prompt += '[쿠팡 베스트셀러 + 순위 변동]\n';
    coupang.slice(0,10).forEach(function(p){
      var chg = p.rankChange>0?'▲'+p.rankChange:p.rankChange<0?'▼'+Math.abs(p.rankChange):'─';
      prompt += p.rank+'위 '+chg+' '+p.name+(p.price?' '+p.price.toLocaleString()+'원':'')+'\n';
    });
    prompt += '\n';
  }
  if(tiktok.length || instagram.length){
    prompt += '[SNS 인기 해시태그]\n';
    tiktok.slice(0,6).forEach(function(h){ prompt+='틱톡 #'+h.tag+(h.videoCount?' '+h.videoCount.toLocaleString()+'영상':'')+'\n'; });
    instagram.slice(0,5).forEach(function(h){ prompt+='인스타 #'+h.tag+'\n'; });
    prompt += '\n';
  }
  if(googleOs.length){
    prompt += '[해외 선행 트렌드 — 미국/일본 (한국 2-4주 선행)]\n';
    googleOs.slice(0,5).forEach(function(g,i){ prompt+=(i+1)+'. '+g.title+'\n'; });
    prompt += '\n';
  }
  if(naver.length){
    prompt += '[네이버 급상승 후보]\n';
    naver.slice(0,8).forEach(function(n){ prompt+=n+' '; });
    prompt += '\n\n';
  }

  prompt += '판단 기준:\n';
  prompt += '①여러 플랫폼에서 동시 감지 ②이제 막 상승 시작 ③블로그 경쟁 아직 적음\n';
  prompt += '④한국 소비자가 살 수 있는 실물 제품 ⑤신규 쿠팡 순위 진입/급등\n\n';
  prompt += '출력 형식 (JSON 배열만):\n';
  prompt += '[{"name":"제품명(한국어)","score":0-100,"signals":["youtube","tiktok","coupang"],"reason":"이유 1문장","blogAngle":"블로그 각도 1문장","phase":"태동기|성장기|성숙기","peakHours":48,"action":"shorts|blog|hold","hasOverseas":true}]';

  try{
    var resp = await groqPost([
      { role:'system', content:'한국 이커머스 트렌드 분석 전문가. 여러 플랫폼 신호를 교차 분석해 경쟁 전에 뜰 제품을 발굴. JSON만 출력.' },
      { role:'user',   content:prompt }
    ], 1200);
    var text = (((resp.choices||[])[0]||{}).message||{}).content||'';
    return safeParseJson(text).slice(0,10);
  }catch(e){ console.error('[groq extract]', e.message); return []; }
}

// 개별 제품 심층 분석
async function analyzeProduct(name, data){
  var prompt = '제품: '+name+'\n'
    + '검색량 증가율: '+(data.searchSurge||0)+'%\n'
    + '블로그 포스팅: '+(data.blogCount||0)+'개\n'
    + '카페 언급: '+(data.cafeCount||0)+'건\n'
    + '쇼핑 클릭 변화: '+(data.clickSurge||0)+'%\n\n'
    + '아래 4가지를 JSON으로만 답해라:\n'
    + '{"phase":"태동기|성장기|성숙기|쇠퇴기","reason":"블루오션 이유 1문장","blogAngle":"상위노출 블로그 각도 1문장","peakHours":숫자}';
  try{
    var resp = await groqPost([
      { role:'system', content:'한국 이커머스 트렌드 분석가. JSON만 출력.' },
      { role:'user',   content:prompt }
    ], 300);
    var text = (((resp.choices||[])[0]||{}).message||{}).content||'';
    var m = text.match(/\{[\s\S]*\}/);
    if(!m) return null;
    return JSON.parse(m[0]);
  }catch(e){ return null; }
}

module.exports = { extractTrendingProducts, analyzeProduct };
