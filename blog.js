var S = { product:null, titles:[], selectedTitle:0, body:'', hashtags:[], thumb:{}, seo:{}, generated:false };
var S_IMAGES = new Array(6).fill(null);
var S_PROD_REF = null; // 제품 원본 이미지 { data, mimeType }
var S_URL_INFO = null;
var S_ACTIVE_SLOT = -1;

var SLOT_LABELS = ['📸1 대표이미지','📸2 핵심구조','📸3 활용장면','📸4 세부디테일','📸5 구성품','📸6 CTA직전'];
var BLOG_STATE_KEY = 'blog-state-draft';

// ── 슬롯 렌더 ────────────────────────────────────────────────
function renderSlots() {
  var container = document.getElementById('img-slots');
  if (!container) return;
  container.innerHTML = SLOT_LABELS.map(function(label, i) {
    var img = S_IMAGES[i];
    if (img) {
      var src = img.data ? 'data:'+img.mimeType+';base64,'+img.data : (img.url||'');
      return '<div style="display:flex;flex-direction:column;gap:4px">'
        +'<div class="img-slot filled" id="slot-'+i+'" onclick="focusSlot('+i+')">'
        +'<div class="img-slot-num">'+(i+1)+'</div>'
        +'<img src="'+src+'" alt="슬롯'+(i+1)+'"/>'
        +'<button class="img-slot-del" onclick="event.stopPropagation();clearSlot('+i+')">✕</button>'
        +'</div>'
        +'<button id="regen-slot-'+i+'" onclick="regenSlotImage('+i+')"'
        +' style="width:100%;padding:4px 0;background:var(--pri-lt);border:1px solid var(--pri-bdr);border-radius:6px;font-size:10px;font-weight:700;color:var(--pri);cursor:pointer;transition:all .15s"'
        +' onmouseover="this.style.background=\'var(--pri)\';this.style.color=\'#fff\'"'
        +' onmouseout="this.style.background=\'var(--pri-lt)\';this.style.color=\'var(--pri)\'">'
        +'↺ 재작성</button>'
        +'</div>';
    }
    return '<div style="display:flex;flex-direction:column;gap:4px">'
      +'<div class="img-slot" id="slot-'+i+'" onclick="openSlot('+i+')" onpaste="pasteSlot(event,'+i+')">'
      +'<div style="font-size:20px">➕</div>'
      +'<div class="img-slot-label">'+label+'</div>'
      +'<div class="img-slot-paste">클릭 or Ctrl+V</div>'
      +'</div>'
      +'<div style="height:24px"></div>'
      +'</div>';
  }).join('');
}

function openSlot(idx) {
  S_ACTIVE_SLOT = idx;
  var input = document.getElementById('img-input-slot');
  input.onchange = function(e){ handleSlotFile(e, idx); };
  input.click();
}

function focusSlot(idx) { openSlot(idx); }

function handleSlotFile(e, idx) {
  var file = e.target.files[0]; if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) {
    S_IMAGES[idx] = { data: ev.target.result.split(',')[1], mimeType: file.type };
    renderSlots();
    showToast('📸 슬롯 '+(idx+1)+' 이미지 등록됨');
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function pasteSlot(e, idx) {
  var items = (e.clipboardData||e.originalEvent&&e.originalEvent.clipboardData||{}).items||[];
  for (var i=0; i<items.length; i++) {
    if (items[i].type.indexOf('image') === -1) continue;
    var file = items[i].getAsFile(); if (!file) continue;
    var reader = new FileReader();
    (function(f, slotIdx){
      reader.onload = function(ev) {
        S_IMAGES[slotIdx] = { data: ev.target.result.split(',')[1], mimeType: f.type };
        renderSlots();
        showToast('📸 슬롯 '+(slotIdx+1)+' 붙여넣기 완료');
      };
      reader.readAsDataURL(f);
    })(file, idx);
    e.preventDefault(); break;
  }
}

function clearSlot(idx) {
  S_IMAGES[idx] = null;
  renderSlots();
  showToast('슬롯 '+(idx+1)+' 초기화됨');
}

document.addEventListener('paste', function(e) {
  var items = (e.clipboardData||{}).items||[];
  var hasImg = false;
  for (var i=0;i<items.length;i++) if(items[i].type.indexOf('image')!==-1){hasImg=true;break;}
  if (!hasImg) return;
  var targetIdx = S_ACTIVE_SLOT >= 0 ? S_ACTIVE_SLOT : S_IMAGES.indexOf(null);
  if (targetIdx < 0) { showToast('⚠️ 슬롯이 모두 찼습니다'); return; }
  pasteSlot(e, targetIdx);
});

// ── 제품 원본 이미지 핸들러 ──────────────────────────────────
function handleProdRefFile(input) {
  var file = input.files ? input.files[0] : input;
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) {
    S_PROD_REF = { data: ev.target.result.split(',')[1], mimeType: file.type };
    var preview = document.getElementById('prod-ref-preview');
    var ph  = document.getElementById('prod-ref-ph');
    var del = document.getElementById('prod-ref-del');
    if (preview) { preview.src = ev.target.result; preview.style.display = 'block'; }
    if (ph)  ph.style.display  = 'none';
    if (del) del.style.display = 'flex';
    showToast('📦 제품 원본 이미지 등록됨 — 이미지 생성 시 참조됩니다');
    // prodRef는 용량이 크므로 sessionStorage 별도 저장
    try { sessionStorage.setItem(BLOG_STATE_KEY+'-prodref', ev.target.result); } catch(e) {}
  };
  reader.readAsDataURL(file);
  if (input.value !== undefined) input.value = '';
}

function handleProdRefDrop(e) {
  var file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  handleProdRefFile(file);
}

function clearProdRef() {
  S_PROD_REF = null;
  var preview = document.getElementById('prod-ref-preview');
  var ph  = document.getElementById('prod-ref-ph');
  var del = document.getElementById('prod-ref-del');
  if (preview) { preview.src = ''; preview.style.display = 'none'; }
  if (ph)  ph.style.display  = 'flex';
  if (del) del.style.display = 'none';
  sessionStorage.removeItem(BLOG_STATE_KEY+'-prodref');
  showToast('제품 원본 이미지 초기화됨');
}

function restoreProdRef() {
  try {
    var saved = sessionStorage.getItem(BLOG_STATE_KEY+'-prodref');
    if (!saved) return;
    var mime = saved.split(';')[0].replace('data:','') || 'image/jpeg';
    S_PROD_REF = { data: saved.split(',')[1], mimeType: mime };
    var preview = document.getElementById('prod-ref-preview');
    var ph  = document.getElementById('prod-ref-ph');
    var del = document.getElementById('prod-ref-del');
    if (preview) { preview.src = saved; preview.style.display = 'block'; }
    if (ph)  ph.style.display  = 'none';
    if (del) del.style.display = 'flex';
  } catch(e) {}
}

// ── 상태 저장 ────────────────────────────────────────────────
function saveDraft() {
  try {
    var ta = document.getElementById('body-textarea');
    var draft = {
      product: S.product,
      titles: S.titles,
      selectedTitle: S.selectedTitle,
      body: ta ? ta.value : S.body,
      hashtags: S.hashtags,
      thumb: S.thumb,
      seo: S.seo,
      generated: S.generated,
      urlInput: (document.getElementById('url-input')||{}).value || '',
      postType: (document.getElementById('post-type')||{}).value || 'guide',
      postLength: (document.getElementById('post-length')||{}).value || 'medium',
      tags: [...document.querySelectorAll('.tag.on')].map(function(t){return t.textContent;}),
      images: S_IMAGES.map(function(img){
        if (!img) return null;
        return { mimeType: img.mimeType, hasData: !!img.data, url: img.url||null };
      })
    };
    sessionStorage.setItem(BLOG_STATE_KEY, JSON.stringify(draft));
    for (var i=0; i<6; i++) {
      if (S_IMAGES[i] && S_IMAGES[i].data) {
        try { sessionStorage.setItem(BLOG_STATE_KEY+'-img'+i, S_IMAGES[i].data); } catch(e){}
      } else {
        sessionStorage.removeItem(BLOG_STATE_KEY+'-img'+i);
      }
    }
  } catch(e) {}
}

// ── 상태 복원 ────────────────────────────────────────────────
function restoreDraft() {
  try {
    var raw = sessionStorage.getItem(BLOG_STATE_KEY);
    if (!raw) return false;
    var draft = JSON.parse(raw);
    if (draft.product) setProduct(draft.product);
    if (draft.urlInput) { var urlEl = document.getElementById('url-input'); if (urlEl) urlEl.value = draft.urlInput; }
    if (draft.postType) { var ptEl = document.getElementById('post-type'); if (ptEl) ptEl.value = draft.postType; }
    if (draft.postLength) { var plEl = document.getElementById('post-length'); if (plEl) plEl.value = draft.postLength; }
    if (draft.tags && draft.tags.length) {
      document.querySelectorAll('.tag').forEach(function(t){
        t.classList.toggle('on', draft.tags.indexOf(t.textContent) !== -1);
      });
    }
    if (draft.images) {
      draft.images.forEach(function(img, i){
        if (!img) return;
        var data = null;
        try { data = sessionStorage.getItem(BLOG_STATE_KEY+'-img'+i); } catch(e){}
        if (data) {
          S_IMAGES[i] = { data: data, mimeType: img.mimeType };
        } else if (img.url) {
          S_IMAGES[i] = { url: img.url, mimeType: img.mimeType };
        }
      });
      renderSlots();
    }
    restoreProdRef();
    if (draft.generated && draft.titles && draft.titles.length) {
      S.titles = draft.titles;
      S.selectedTitle = draft.selectedTitle || 0;
      S.body = draft.body || '';
      S.hashtags = draft.hashtags || [];
      S.thumb = draft.thumb || {};
      S.seo = draft.seo || {};
      S.generated = true;
      var ta = document.getElementById('body-textarea');
      if (ta && draft.body) ta.value = draft.body;
      renderResult();
      document.getElementById('result-area').style.display = 'block';
      updateStep(3);
      showImgAutoBtn();
      showToast('✅ 이전 작성 내용 복원됨');
    }
    return true;
  } catch(e) { return false; }
}

function clearDraft() {
  sessionStorage.removeItem(BLOG_STATE_KEY);
  sessionStorage.removeItem(BLOG_STATE_KEY+'-prodref');
  for (var i=0; i<6; i++) sessionStorage.removeItem(BLOG_STATE_KEY+'-img'+i);
  location.reload();
}

// ── 초기화 ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', function() {
  renderSlots();
  var ta = document.getElementById('body-textarea');
  if (ta) {
    ta.addEventListener('input', function(){ S.body = ta.value; saveDraft(); });
  }
  try {
    if (restoreDraft()) return;
    var ir = sessionStorage.getItem('image-result');
    if (ir) {
      var cards = JSON.parse(ir);
      cards.forEach(function(c){
        if (c.src && c.slot >= 1 && c.slot <= 6) {
          var b64 = c.src.split(',')[1] || '';
          var mime = c.src.split(';')[0].replace('data:','') || 'image/png';
          S_IMAGES[c.slot-1] = { data: b64, mimeType: mime };
        }
      });
      renderSlots();
      showToast('🖼 이미지 '+cards.filter(function(c){return c.src;}).length+'장 자동 연결됨');
    }
    var hp = sessionStorage.getItem('blog-product');
    if (hp) { setProduct(JSON.parse(hp)); sessionStorage.removeItem('blog-product'); return; }
    var hr = sessionStorage.getItem('hot-last-result');
    if (hr) {
      var d = JSON.parse(hr);
      if (d && d.candidates && d.candidates.length) { setProduct(d.candidates[0]); showToast('📦 지금 뜨는 제품 1순위 자동 연결됨'); }
    }
  } catch(e) {}
  var tm = new Date(); tm.setDate(tm.getDate()+1);
  document.getElementById('schedule-date').value = tm.toISOString().slice(0,10);
});

document.addEventListener('visibilitychange', function(){
  if (document.visibilityState === 'hidden' && (S.generated || S.product)) saveDraft();
});
window.addEventListener('beforeunload', function(){
  if (S.generated || S.product) saveDraft();
});

// ── URL 분석 ─────────────────────────────────────────────────
async function analyzeUrl() {
  var url = document.getElementById('url-input').value.trim();
  if (!url) { showToast('⚠️ URL을 입력해주세요'); return; }
  if (!url.startsWith('http')) { showToast('⚠️ http://로 시작하는 URL을 입력해주세요'); return; }
  var btn = document.getElementById('url-btn');
  btn.disabled = true; btn.textContent = '분석 중...';
  document.getElementById('url-result').style.display = 'none';
  try {
    var res = await fetch('/api/fetch-url', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url}) });
    var data = await res.json();
    if (data.error) throw new Error(data.error);
    var p = data.product;
    S_URL_INFO = p;
    setProduct({ name:p.productName||'URL 제품', judge:{trendStatus:'spreading',decision:'go'}, score:{total:0,grade:p.priceGrade||'B'}, rss:{}, data:{datalab:{},youtube:{},shopping:{avgPrice:p.price||0}}, urlInfo:p });
    var re = document.getElementById('url-result');
    re.style.display = 'flex'; re.className = 'url-result';
    re.innerHTML = '<div style="flex-basis:100%;font-size:11px;font-weight:800;color:#0891b2;margin-bottom:4px">✅ URL 분석 완료</div>'
      +(p.productName?'<span class="url-tag">📦 '+p.productName+'</span>':'')
      +(p.price?'<span class="url-tag">💰 '+Number(p.price).toLocaleString()+'원</span>':'')
      +(p.priceGrade?'<span class="url-tag">등급 '+p.priceGrade+'</span>':'')
      +(p.platform?'<span class="url-tag">🛒 '+p.platform+'</span>':'')
      +(p.category?'<span class="url-tag">'+p.category+'</span>':'')
      +(p.targetUser?'<span class="url-tag" style="flex-basis:100%">👤 '+p.targetUser+'</span>':'');
    showToast('✅ URL 분석 완료 — 제품 정보 연결됨');
  } catch(e) { showToast('⚠️ URL 분석 실패: '+e.message); }
  finally { btn.disabled=false; btn.textContent='🔍 분석'; }
}

// ── 제품 연결 ────────────────────────────────────────────────
function setProduct(p) {
  S.product = p;
  var jdg=p.judge||{}, sc=p.score||{}, rss=p.rss||{}, dl=(p.data||{}).datalab||{};
  var sc2 = jdg.trendStatus==='rising'?'#10b981':'#6366f1';
  var sl = {rising:'🔥 급상승',spreading:'🚀 확산중',plateau:'⏳ 정체',falling:'❌ 하락'}[jdg.trendStatus]||'–';
  var dl2 = {go:'🔥 지금 실행',conditional:'⚠️ 조건부',wait:'⏳ 관망',no:'❌ 비추천'}[jdg.decision]||'–';
  document.getElementById('product-card').className = 'product-card';
  document.getElementById('product-card').innerHTML =
    '<div><div class="pc-name">'+(p.name||'–')+'</div>'
    +'<div class="pc-badges" style="margin-top:8px">'
    +'<span class="pc-badge" style="background:'+sc2+'18;color:'+sc2+'">'+sl+'</span>'
    +'<span class="pc-badge" style="background:#fef2f2;color:#ef4444">'+dl2+'</span>'
    +(dl.surgeRate?'<span class="pc-badge" style="background:#ecfdf5;color:#10b981">검색량 '+(dl.surgeRate>=0?'+':'')+dl.surgeRate+'%</span>':'')
    +(rss.detectionCount>0?'<span class="pc-badge" style="background:#fff7ed;color:#f97316">📡 RSS '+rss.detectionCount+'건</span>':'')
    +(p.urlInfo?'<span class="pc-badge" style="background:#ecfeff;color:#0891b2">🔗 URL 분석</span>':'')
    +'</div></div>'
    +'<div class="pc-meta">'
    +'<div class="pc-meta-item"><div class="pc-meta-val">'+(sc.total||0)+'</div><div class="pc-meta-lbl">점수</div></div>'
    +'<div class="pc-meta-item"><div class="pc-meta-val">'+(sc.grade||'–')+'</div><div class="pc-meta-lbl">등급</div></div>'
    +'</div>'
    +'<button onclick="clearProduct()" style="margin-left:auto;padding:4px 10px;background:#f8fafc;border:1px solid var(--bdr);border-radius:6px;font-size:11px;cursor:pointer;color:var(--muted)">변경</button>';
  updateStep(1);
  showToast('"'+p.name+'" 연결됨');
  saveDraft();
}

function clearProduct() {
  S.product=null; S_URL_INFO=null;
  document.getElementById('url-result').style.display='none';
  document.getElementById('url-input').value='';
  document.getElementById('product-card').className='product-card empty';
  document.getElementById('product-card').innerHTML=
    '<div style="text-align:center"><div style="font-size:28px;margin-bottom:8px">📡</div>'
    +'<div style="font-size:13px;font-weight:700;color:var(--faint);margin-bottom:6px">연결된 제품 없음</div>'
    +'<div style="font-size:11px;color:#c4cad4;margin-bottom:12px">아래에서 제품을 연결하세요</div>'
    +'<button onclick="openProductSearch()" style="padding:8px 18px;background:var(--pri);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">🔥 지금 뜨는 제품에서 선택</button></div>';
  sessionStorage.removeItem(BLOG_STATE_KEY);
}

function setManualProduct() {
  var kw = document.getElementById('manual-product').value.trim();
  if (!kw) return;
  setProduct({ name:kw, judge:{}, score:{total:0,grade:'–'}, rss:{}, data:{} });
  document.getElementById('manual-product').value='';
}

function goHotPage() { sessionStorage.setItem('hot-to-blog','1'); location.href='/hot.html'; }

function openProductSearch() {
  document.getElementById('product-modal').style.display='flex';
  try {
    var d = JSON.parse(sessionStorage.getItem('hot-last-result'));
    var c = (d&&d.candidates)||[];
    if (c.length) {
      document.getElementById('modal-product-list').innerHTML = c.map(function(p,i){
        var sc=p.score||{};
        var gc=sc.grade==='A'?'#10b981':sc.grade==='B'?'#6366f1':'#94a3b8';
        return '<div onclick="selectFromModal('+i+')" style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#f8fafc;border-radius:10px;cursor:pointer;border:1.5px solid transparent;transition:all .15s" onmouseover="this.style.borderColor=\'var(--pri-bdr)\'" onmouseout="this.style.borderColor=\'transparent\'">'
          +'<div style="font-size:22px;font-weight:900;color:'+gc+';min-width:24px">'+(i+1)+'</div>'
          +'<div style="flex:1"><div style="font-size:13px;font-weight:800">'+p.name+'</div>'
          +'<div style="font-size:11px;color:var(--muted);margin-top:2px">'+(sc.total||0)+'점 · '+(sc.grade||'–')+'등급</div></div></div>';
      }).join('');
    }
  } catch(e){}
}
function selectFromModal(i){ try{var d=JSON.parse(sessionStorage.getItem('hot-last-result'));var p=(d.candidates||[])[i];if(p){setProduct(p);closeModal();}}catch(e){} }
function closeModal(){ document.getElementById('product-modal').style.display='none'; }

// ── 블로그 생성 ──────────────────────────────────────────────
async function generateBlog() {
  if (!S.product) { showToast('⚠️ 제품을 먼저 연결해주세요'); return; }
  var btn = document.getElementById('gen-btn');
  btn.disabled=true; showLoading(true); updateStep(2);
  var p=S.product, jdg=p.judge||{}, sc=p.score||{}, rss=p.rss||{};
  var d=p.data||{}, dl=d.datalab||{}, yt=d.youtube||{}, shop=d.shopping||{};
  var urlInfo=p.urlInfo||S_URL_INFO||{};
  var inputUrl = document.getElementById('url-input').value.trim() || urlInfo.originalUrl || '';
  var postType=document.getElementById('post-type').value;
  var postLength=document.getElementById('post-length').value;
  var tags=[...document.querySelectorAll('.tag.on')].map(function(t){return t.textContent;});
  var validImages=S_IMAGES.filter(Boolean);
  var typeLabel={review:'상품 리뷰',compare:'비교 추천',guide:'구매 가이드',trend:'트렌드 분석'}[postType]||'리뷰';
  var lenLabel={short:'800자 이상',medium:'1500자 이상',long:'2500자 이상'}[postLength]||'1500자 이상';
  var userPrompt =
    '아래 제품 데이터를 기반으로 스킬 v10.2를 완전히 적용한 수익형 블로그 글을 작성하라.\n\n'
    +'제품명: '+p.name+'\n글 유형: '+typeLabel+'\n글 길이: '+lenLabel+'\n'
    +'트렌드: '+(jdg.trendStatus||'–')+' / 결정: '+(jdg.decision||'–')+'\n'
    +'검색량 변화: '+(dl.surgeRate>=0?'+':'')+(dl.surgeRate||0)+'%\n'
    +'RSS 신호: '+(rss.score||0)+'점 / '+(rss.detectionCount||0)+'건\n'
    +'유튜브: 영상 '+(yt.videoCount||0)+'개 / 평균 조회수 '+(yt.avgViews||0)+'\n'
    +'쇼핑: 상품 '+(shop.itemCount||0)+'개 / 평균가 '+(shop.avgPrice||0)+'원\n'
    +(urlInfo.features?'URL 분석 특징: '+urlInfo.features.join(', ')+'\n':'')
    +(urlInfo.pros?'장점: '+urlInfo.pros.join(', ')+'\n':'')
    +(urlInfo.cons?'단점: '+urlInfo.cons.join(', ')+'\n':'')
    +(urlInfo.reviewSummary?'후기 요약: '+urlInfo.reviewSummary+'\n':'')
    +(inputUrl?'구매 링크 URL: '+inputUrl+'\n⚠️ 본문의 모든 CTA 링크는 반드시 이 URL만 사용할 것: '+inputUrl+'\n':'')
    +'포함 요소: '+tags.join(', ')+'\n'
    +(validImages.length?'\n첨부 이미지 '+validImages.length+'장을 분석하여 [📸 사진] 배치 설명에 반영하라.\n':'')
    +'\n⚠️ 절대 중간에 끊지 마라. JSON이 완전히 닫힐 때까지 출력을 멈추지 마라.\n'
    +'반드시 완성된 JSON만 출력:\n'
    +'{"titles":["제목1","제목2","제목3","제목4","제목5"],"body":"본문(마크다운+사진위치표시)","hashtags":["태그1",...],"thumb":{"main":"20자이내","sub":"15자이내","badge":"8자이내"},"seo":{"keyword_density":true,"title_length":true,"meta_desc":true,"heading_structure":true,"cta_included":true,"internal_link":true}}';

  setLoadingStep('스킬 v10.2 적용 중...', 15); await sleep(300);
  setLoadingStep('가격대 분석 + 구조 설계 중...', 35); await sleep(300);
  setLoadingStep('본문 작성 중...', 55);
  try {
    var res = await fetch('/api/blog-generate', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ user:userPrompt, max_tokens:8000 })
    });
    var data2 = await res.json();
    if (data2.error) throw new Error(data2.error);
    setLoadingStep('SEO 분석 중...', 80); await sleep(200);
    var raw = data2.text||'';
    var clean = raw.replace(/```json|```/g,'').trim();
    var result = JSON.parse(clean);
    S.titles=result.titles||[]; S.body=result.body||''; S.hashtags=result.hashtags||[];
    S.thumb=result.thumb||{}; S.seo=result.seo||{}; S.selectedTitle=0; S.generated=true;
    setLoadingStep('완료!', 100); await sleep(200);
    renderResult();
    document.getElementById('result-area').style.display='block';
    document.getElementById('result-area').scrollIntoView({behavior:'smooth',block:'start'});
    updateStep(3);
    saveDraft();
    showImgAutoBtn();
  } catch(e) {
    showToast('⚠️ 생성 오류: '+e.message);
    console.error(e);
  } finally {
    showLoading(false); btn.disabled=false;
  }
}

// ── 본문 이미지 삽입 ─────────────────────────────────────────
function insertImagesIntoBody(body) {
  if (!S_IMAGES.filter(Boolean).length) return body;
  var seqIdx = 0;
  return body.replace(/\[📸\s*(\d*)[^\]]*\]/g, function(m, num) {
    var idx = num ? parseInt(num) - 1 : seqIdx++;
    var img = (idx >= 0 && idx < 6) ? S_IMAGES[idx] : null;
    if (!img) return m;
    return '\n\n<img src="data:'+img.mimeType+';base64,'+img.data+'" style="max-width:100%;border-radius:10px;margin:10px 0" alt="제품이미지"/>\n\n';
  });
}

function cleanMarkdown(t) {
  return t.replace(/#{1,6}\s*/g,'').replace(/\*\*(.+?)\*\*/g,'$1').replace(/\*(.+?)\*/g,'$1')
    .replace(/__(.+?)__/g,'$1').replace(/^>\s*/gm,'').replace(/\n{3,}/g,'\n\n').trim();
}

// ── 결과 렌더 ────────────────────────────────────────────────
function renderResult() {
  document.getElementById('title-list').innerHTML = S.titles.map(function(t,i){
    var len=t.length, ok=len>=20&&len<=50;
    return '<div class="title-item'+(i===S.selectedTitle?' selected':'')+'" onclick="selectTitle('+i+')">'
      +'<div class="title-num">'+(i+1)+'</div><div class="title-text">'+t+'</div>'
      +'<span class="seo-score" style="background:'+(ok?'#ecfdf5;color:#10b981':'#fff7ed;color:#d97706')+'">'+len+'자'+(ok?' ✓':'')+'</span></div>';
  }).join('');
  document.getElementById('body-textarea').value = cleanMarkdown(S.body);
  updateCharCount();
  document.getElementById('hashtag-wrap').innerHTML = S.hashtags.map(function(h){
    return '<span class="hashtag">#'+h.replace(/^#/,'')+'</span>';
  }).join('');
  updateThumbPreview();
  var seoItems=[
    {key:'keyword_density',label:'키워드 밀도 적절'},{key:'title_length',label:'제목 길이 최적 (20~50자)'},
    {key:'meta_desc',label:'메타 설명 포함'},{key:'heading_structure',label:'헤딩 구조 (H2/H3)'},
    {key:'cta_included',label:'구매 유도 CTA 포함'},{key:'internal_link',label:'내부/제휴 링크 포함'}
  ];
  var pass=0;
  document.getElementById('seo-checklist').innerHTML = seoItems.map(function(item){
    var ok=S.seo[item.key]; if(ok) pass++;
    return '<div class="seo-item"><div class="seo-dot" style="background:'+(ok?'#10b981':'#f43f5e')+'"></div>'
      +'<span style="flex:1">'+item.label+'</span>'
      +'<span style="font-size:10px;font-weight:700;color:'+(ok?'#10b981':'#f43f5e')+'">'+(ok?'통과':'미흡')+'</span></div>';
  }).join('');
  var score=Math.round((pass/seoItems.length)*100);
  document.getElementById('seo-bar').style.width=score+'%';
  document.getElementById('seo-score-text').textContent=score+'점';
}

function selectTitle(i){ S.selectedTitle=i; renderResult(); saveDraft(); }

function updateThumbPreview() {
  var t=S.thumb, style=(document.getElementById('thumb-style')||{}).value||'dark';
  var bg={dark:'linear-gradient(135deg,#1e293b,#334155)',red:'linear-gradient(135deg,#7f1d1d,#ef4444)',green:'linear-gradient(135deg,#064e3b,#10b981)',purple:'linear-gradient(135deg,#3b0764,#8b5cf6)'}[style];
  var prev=document.getElementById('thumb-preview'); if(prev) prev.style.background=bg;
  var m=document.getElementById('thumb-main'),sb=document.getElementById('thumb-sub'),bd=document.getElementById('thumb-badge');
  if(m) m.textContent=t.main||(S.product?S.product.name+' 추천':'');
  if(sb) sb.textContent=t.sub||'지금 구매하면 이득인 이유';
  if(bd) bd.textContent=t.badge||'🔥 HOT';
}

function updateCharCount(){
  var ta=document.getElementById('body-textarea'),el=document.getElementById('char-count');
  if(ta&&el) el.textContent=ta.value.replace(/\s/g,'').length+'자';
}

async function regenSection(section) {
  if(!S.product||!S.generated){showToast('⚠️ 먼저 생성해주세요');return;}
  var prompts={
    body:'제품명: '+S.product.name+'\n기존 본문을 다른 스타일로 재작성. 스킬 v10.2 전환 구조 적용. 본문만 출력.',
    thumb:'제품명: '+S.product.name+'\n썸네일 문구 재생성.\nJSON: {"main":"20자이내","sub":"15자이내","badge":"8자이내"}'
  };
  showToast('재생성 중...');
  try {
    var res=await fetch('/api/blog-generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:prompts[section],max_tokens:2000})});
    var data=await res.json(); if(data.error) throw new Error(data.error);
    var raw=data.text||'';
    if(section==='body'){ S.body=raw.trim(); document.getElementById('body-textarea').value=S.body; updateCharCount(); showToast('✓ 본문 재생성 완료'); }
    else if(section==='thumb'){ S.thumb=JSON.parse(raw.replace(/```json|```/g,'').trim()); updateThumbPreview(); showToast('✓ 썸네일 재생성 완료'); }
    saveDraft();
  } catch(e){showToast('⚠️ 재생성 오류');}
}

// ── ImgBB 업로드 ─────────────────────────────────────────────
async function uploadImagesToImgBB() {
  var urlMap = {};
  for (var i = 0; i < 6; i++) {
    var img = S_IMAGES[i];
    if (!img || !img.data) continue;
    try {
      var r = await fetch('/api/proxy-image', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({base64:img.data,mimeType:img.mimeType}) });
      var d = await r.json();
      if (d.url) urlMap[i] = d.url;
    } catch(e) {}
  }
  return urlMap;
}

function insertUrlsIntoBody(body, urlMap) {
  var seqIdx = 0;
  var EMOJI_HEADING = /^([\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|✅|⚠️|💡|🔥|🛒|👉|💰|📌|🎯|⭐|🙌|💬|📦)/u;
  var processed = body.replace(/\[📸\s*(\d*)[^\]]*\]/g, function(m, num) {
    var idx = num ? parseInt(num)-1 : seqIdx++;
    var url = urlMap[idx];
    if (!url) return '\x01';
    return '\x00<img src="'+url+'" style="max-width:100%;border-radius:10px;margin:30px 0;display:block" alt="제품이미지"/>\x00';
  });
  return processed.split('\x00').map(function(chunk) {
    if (chunk.startsWith('<img')) return chunk;
    return chunk.replace(/\x01/g,'').trim().split(/\n{1,}/).reduce(function(acc, line) {
      var t = line.trim();
      if (!t) { acc.push('<div style="height:14px"></div>'); return acc; }
      if (EMOJI_HEADING.test(t)) {
        acc.push('<p style="margin:30px 0 16px 0;line-height:1.8;font-size:24px;font-weight:bold">'+t+'</p>');
      } else {
        if (acc.length && acc[acc.length-1].startsWith('<p style="margin:0')) {
          acc[acc.length-1] = acc[acc.length-1].replace(/<\/p>$/, '<br>'+t+'</p>');
        } else {
          acc.push('<p style="margin:0 0 16px 0;line-height:1.9;font-size:19px">'+t+'</p>');
        }
      }
      return acc;
    }, []).join('');
  }).join('');
}

// ── 복사/업로드 ──────────────────────────────────────────────
async function copySelected(type){
  if(type==='body'){
    var raw = document.getElementById('body-textarea').value;
    var hasImgs = S_IMAGES.filter(Boolean).length > 0;
    var html, blob;
    if(hasImgs){ showToast('🔄 이미지 업로드 중...'); var urlMap=await uploadImagesToImgBB(); html=insertUrlsIntoBody(raw,urlMap); }
    else { html=insertUrlsIntoBody(raw,{}); }
    if(navigator.clipboard && window.ClipboardItem){
      blob = new Blob([html],{type:'text/html'});
      navigator.clipboard.write([new ClipboardItem({'text/html':blob})])
        .then(function(){ showToast(hasImgs?'✓ 이미지 포함 복사됨':'✓ 복사됨'); })
        .catch(function(){ copyText(raw); showToast('✓ 텍스트만 복사됨'); });
    } else { copyText(html); showToast('✓ 복사됨'); }
    return;
  }
  var text='';
  if(type==='title') text=S.titles[S.selectedTitle]||'';
  else if(type==='hashtag') text=S.hashtags.map(function(h){return '#'+h.replace(/^#/,'');}).join(' ');
  else if(type==='thumb'){var t=S.thumb;text=(t.badge||'')+'\n'+(t.main||'')+'\n'+(t.sub||'');}
  copyText(text); showToast('✓ 복사됨');
}

async function uploadTo(platform){
  if(!S.generated){showToast('⚠️ 먼저 생성해주세요');return;}
  var title=S.titles[S.selectedTitle]||'';
  var body=document.getElementById('body-textarea').value;
  var tags=S.hashtags.map(function(h){return h.replace(/^#/,'');}).join(',');
  var sched=document.getElementById('use-schedule').checked?' ('+document.getElementById('schedule-date').value+' '+document.getElementById('schedule-time').value+' 예약)':' (즉시)';
  if(platform==='both'){
    var hasImgs=S_IMAGES.filter(Boolean).length>0;
    showToast(hasImgs?'🔄 이미지 업로드 중...':'복사 중...');
    var urlMap=hasImgs?await uploadImagesToImgBB():{};
    var bodyWithImgs=insertUrlsIntoBody(body,urlMap);
    var fullHtml='<h2>'+title+'</h2>\n'+bodyWithImgs+'\n<p>'+tags+'</p>';
    if(navigator.clipboard && window.ClipboardItem){
      var blob=new Blob([fullHtml],{type:'text/html'});
      navigator.clipboard.write([new ClipboardItem({'text/html':blob})])
        .then(function(){ showToast('✓ 이미지 포함 전체 복사됨'); })
        .catch(function(){ copyText('【제목】\n'+title+'\n\n'+body+'\n\n'+tags); showToast('✓ 텍스트만 복사됨'); });
    } else { copyText('【제목】\n'+title+'\n\n'+body+'\n\n'+tags); showToast('✓ 복사됨'); }
    updateStep(4); return;
  }
  copyText('【제목】\n'+title+'\n\n'+body+'\n\n'+tags);
  window.open({naver:'https://blog.naver.com/PostWriteForm.naver',tistory:'https://www.tistory.com/manage/post/write'}[platform],'_blank');
  showToast('✓ '+(platform==='naver'?'네이버':'티스토리')+' 열림 + 내용 복사됨'+sched);
  updateStep(4);
}

// ── 미리보기 ─────────────────────────────────────────────────
function togglePreview() {
  var ta=document.getElementById('body-textarea'),pv=document.getElementById('body-preview'),btn=document.getElementById('preview-btn');
  if(pv.style.display==='none'){
    pv.innerHTML=renderBodyWithImages(ta.value); pv.style.display='block'; ta.style.display='none';
    btn.textContent='편집'; btn.style.background='#f1f5f9'; btn.style.color='#475569';
  } else {
    pv.style.display='none'; ta.style.display='block';
    btn.textContent='미리보기'; btn.style.background='#fff7ed'; btn.style.color='#f97316';
  }
}

function renderBodyWithImages(text) {
  var escaped=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return escaped.replace(/\[(?:📸|📷|🖼|📟)[^\]]*(\d)[^\]]*\]/g,function(match,num){
    var idx=parseInt(num)-1, img=(idx>=0&&idx<6)?S_IMAGES[idx]:null;
    if(img&&img.data) return '\n<img src="data:'+img.mimeType+';base64,'+img.data+'" style="max-width:100%;border-radius:10px;margin:12px 0;display:block" alt="📸'+(idx+1)+'"/>\n';
    if(img&&img.url) return '\n<img src="'+img.url+'" style="max-width:100%;border-radius:10px;margin:12px 0;display:block" alt="📸'+(idx+1)+'" onerror="this.style.display=\'none\'"/>\n';
    return '\n<div style="background:#f1f5f9;border:2px dashed #c7d2fe;border-radius:10px;padding:20px;text-align:center;color:#94a3b8;font-size:12px;margin:12px 0">📸 이미지 '+(idx+1)+' 슬롯 — 이미지를 첨부하면 여기에 표시됩니다</div>\n';
  });
}

// ── 공통 유틸 ────────────────────────────────────────────────
function updateStep(active){
  for(var i=1;i<=4;i++){
    var n=document.getElementById('step'+i+'-num'),l=document.getElementById('step'+i+'-label');
    if(!n||!l) continue;
    if(i<active){n.className='step-num done';n.textContent='✓';l.className='step-label done';}
    else if(i===active){n.className='step-num active';n.textContent=String(i);l.className='step-label active';}
    else{n.className='step-num idle';n.textContent=String(i);l.className='step-label idle';}
  }
  var hints={1:'제품 연결됨',2:'설정 후 생성 버튼',3:'제목 선택 후 업로드',4:'업로드 완료! 🎉'};
  var h=document.getElementById('step-hint'); if(h) h.textContent=hints[active]||'';
}
function showLoading(on){document.getElementById('loading-overlay').style.display=on?'flex':'none';}
function setLoadingStep(msg,pct){document.getElementById('loading-step').textContent=msg;document.getElementById('loading-bar').style.width=pct+'%';}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function toggleTag(el){el.classList.toggle('on'); saveDraft();}
function copyText(t){try{var e=document.createElement('textarea');e.value=t;e.style.cssText='position:fixed;top:-9999px;opacity:0;';document.body.appendChild(e);e.focus();e.select();document.execCommand('copy');document.body.removeChild(e);}catch(e){if(navigator.clipboard)navigator.clipboard.writeText(t);}}
function showToast(msg){var t=document.getElementById('_toast');if(!t){t=document.createElement('div');t.id='_toast';t.className='toast';document.body.appendChild(t);}t.textContent=msg;t.style.opacity='1';clearTimeout(t._t);t._t=setTimeout(function(){t.style.opacity='0';},2500);}
function showApiSetup(){showToast('💡 네이버/티스토리 API 연동은 OAuth 설정 필요');}

// ══════════════════════════════════════════════════════════════
// ★ 이미지 자동 생성 시스템
// ══════════════════════════════════════════════════════════════
var IMG_CHARACTER_DNA = [
  'CRITICAL: This exact woman must appear in every image — same face, same hair, same body. No variation allowed.',
  'CHARACTER SPECIFICATION:',
  '- Korean woman, exactly age 29, slim build, height 165cm',
  '- Face: soft oval face shape, natural double eyelids (not dramatic), slightly defined cheekbones, small lips with pale pink natural color, straight nose, no dimples',
  '- Eyes: dark brown almond-shaped eyes, thin natural eyebrows',
  '- Hair: straight jet-black hair, shoulder-length bob cut, tucked behind ears, no bangs, clean and simple',
  '- Skin: very fair porcelain skin tone (#F5E6D8), zero blemishes, minimal natural makeup only',
  '- Body: slim but not skinny, natural posture',
  'CONSISTENCY RULES:',
  '- Her face MUST look identical across all scenes',
  '- Same hair style and color in every image',
  '- Same skin tone in every image',
  '- Do NOT age her, alter her face shape, or change any feature'
].join('\n');

// ── 제품 분석 → 씬별 맞춤 프롬프트 생성 ─────────────────────
async function analyzeProductForScenes(prodName, bodyText) {
  var prompt =
    '아래 제품명과 블로그 본문을 분석해서 구매 전환을 높이는 이미지 6장의 씬 프롬프트를 영어로 만들어라.\n\n'
    + '제품명: ' + prodName + '\n'
    + '본문 요약: ' + bodyText.slice(0, 500) + '\n\n'
    + '분석 기준:\n'
    + '1. 이 제품이 어디서 어떻게 쓰이는지 파악\n'
    + '2. 구매자가 구매 전 느끼는 불편/문제가 무엇인지\n'
    + '3. 구매 후 어떤 감정/변화를 경험하는지\n'
    + '4. 각 씬이 구매 욕구를 자극하는 스토리 흐름을 가져야 함\n\n'
    + '씬 구성 규칙:\n'
    + '씬1: 제품 없이 — 구매 전 불편한 상황. 찡그린 표정, 문제 상황 연출\n'
    + '씬2: 제품 단독샷 — NO PEOPLE. 제품만, 깔끔한 배경, 선명한 디테일\n'
    + '씬3: 제품 첫 만남 — 여성이 제품을 처음 보는 순간, 호기심·기대 표정\n'
    + '씬4: 실제 사용 장면 — 제품 용도에 맞는 환경에서 자연스럽게 사용 중\n'
    + '씬5: 사용 후 만족 — 결과물이나 효과가 보이는 장면, 밝고 만족스러운 표정\n'
    + '씬6: 라이프스타일 — 제품 덕분에 더 나아진 일상, 여유롭고 행복한 분위기\n\n'
    + '⚠️ 반드시 제품의 실제 용도에 맞는 환경만 사용할 것\n'
    + '예) 주방가전→주방, 자전거→야외, 화장품→욕실·거울 앞, 옷→옷장·거울·외출\n\n'
    + '반드시 JSON만 출력:\n'
    + '{"scenes":[{"slot":1,"prompt":"..."},{"slot":2,"prompt":"..."},{"slot":3,"prompt":"..."},{"slot":4,"prompt":"..."},{"slot":5,"prompt":"..."},{"slot":6,"prompt":"..."}]}';

  try {
    var res = await fetch('/api/blog-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: prompt, max_tokens: 2000 })
    });
    var data = await res.json();
    if (data.error) throw new Error(data.error);
    var raw = (data.text || '').replace(/```json|```/g, '').trim();
    var parsed = JSON.parse(raw);
    return parsed.scenes || [];
  } catch(e) {
    console.warn('[analyzeProductForScenes] 실패:', e.message);
    return [];
  }
}

async function generateImagesFromBody() {
  if (!S.generated) { showToast('⚠️ 먼저 블로그 글을 생성해주세요'); return; }

  var btn  = document.getElementById('img-auto-btn');
  var prog = document.getElementById('img-auto-prog');
  var bar  = document.getElementById('img-auto-bar');
  var step = document.getElementById('img-auto-step');
  var cnt  = document.getElementById('img-auto-count');

  btn.disabled = true;
  btn.innerHTML = '⏳ 생성 중...';
  prog.style.display = 'block';
  bar.style.width = '0%';

  var body     = document.getElementById('body-textarea').value;
  var prodName = S.product ? S.product.name : '제품';
  var success  = 0;
  var fail     = 0;

  // ── 1단계: 제품 분석 → 맞춤 씬 프롬프트 생성 ──────────────
  step.textContent = '제품 분석 중...';
  cnt.textContent  = '';
  bar.style.width  = '5%';

  var analyzedScenes = await analyzeProductForScenes(prodName, body);

  // 분석 실패 시 기존 방식 폴백
  if (!analyzedScenes.length) {
    analyzedScenes = extractScenesFromBody(body).map(function(s) {
      return { slot: s.slot, prompt: buildScenePrompt(s, prodName) };
    });
  }

  var total = analyzedScenes.length;
  bar.style.width = '10%';

  // ── 2단계: 이미지 순차 생성 ────────────────────────────────
  for (var i = 0; i < analyzedScenes.length; i++) {
    var scene   = analyzedScenes[i];
    var slotIdx = scene.slot - 1;

    step.textContent = '씬 ' + scene.slot + ' 생성 중...';
    cnt.textContent  = (i + 1) + ' / ' + total;

    var fullPrompt = IMG_CHARACTER_DNA
      + '\n\nSCENE:\n' + scene.prompt
      + '\n\nPRODUCT NAME: ' + prodName
      + '\n\nRULES: Photorealistic, 4K, cinematic.'
      + ' NO TEXT, NO LETTERS, NO CAPTIONS, NO SUBTITLES anywhere.'
      + (S_PROD_REF
        ? ' The reference product image must appear in this scene with EXACT same color, shape, design.'
          + (scene.slot === 2 ? ' Product-only shot, absolutely no people.' : '')
        : '');

    var payload = { prompt: fullPrompt };
    if (S_PROD_REF) {
      payload.imageBase64   = S_PROD_REF.data;
      payload.imageMimeType = S_PROD_REF.mimeType;
    }

    var ctrl    = new AbortController();
    var timeout = setTimeout(function() { ctrl.abort(); }, 55000);

    try {
      var res = await fetch('/api/generate-image', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  ctrl.signal
      });
      clearTimeout(timeout);
      var data = await res.json();
      if (!res.ok || !data.base64) throw new Error(data.error || '생성 실패');
      S_IMAGES[slotIdx] = { data: data.base64, mimeType: data.mimeType };
      renderSlots();
      success++;
    } catch(e) {
      clearTimeout(timeout);
      fail++;
      console.warn('슬롯 ' + scene.slot + ' 실패:', e.message);
    }

    bar.style.width = Math.round(10 + ((i + 1) / total) * 90) + '%';
  }

  bar.style.width  = '100%';
  step.textContent = '완료! ✅ ' + success + '장 성공' + (fail > 0 ? ' / ' + fail + '장 실패' : '');
  cnt.textContent  = '';
  btn.disabled     = false;
  btn.innerHTML    = '🔄 이미지 다시 생성';

  if (success > 0) {
    saveDraft();
    showToast('🎨 이미지 ' + success + '장 생성 완료');
  } else {
    showToast('⚠️ 이미지 생성 실패 — API 상태를 확인해주세요');
  }
}
  if (!S.generated) { showToast('⚠️ 먼저 블로그 글을 생성해주세요'); return; }

  var btn = document.getElementById('regen-slot-'+slotIdx);
  var slot = document.getElementById('slot-'+slotIdx);
  if (btn) { btn.disabled=true; btn.textContent='생성 중...'; }
  if (slot) slot.style.opacity = '0.5';

  var body     = document.getElementById('body-textarea').value;
  var prodName = S.product ? S.product.name : '제품';
  var sceneNum = slotIdx + 1;

  // 해당 슬롯의 본문 컨텍스트 추출
  var scenes   = extractScenesFromBody(body);
  var scene    = scenes.find(function(s){ return s.slot === sceneNum; })
              || { slot: sceneNum, context: '' };

  var camera   = SCENE_CAMERA[sceneNum] || '';
  var situation = (scene.slot !== 2 && scene.context && scene.context.length > 20)
    ? scene.context
    : buildScenePrompt(scene, prodName);

  var fullPrompt = IMG_CHARACTER_DNA
    + '\n\nSCENE CAMERA DIRECTION: ' + camera
    + '\n\nSCENE CONTENT:\n' + situation
    + '\n\nPRODUCT: ' + prodName
    + '\n\nIMAGE RULES: Photorealistic, 4K, cinematic. Korean setting.'
    + ' NO TEXT, NO LETTERS, NO CAPTIONS anywhere in the image.'
    + (S_PROD_REF
        ? ' PRODUCT CONSISTENCY: Reference image shows the EXACT product.'
        + ' Reproduce same color, shape, design. Do NOT change the product.'
        + (sceneNum === 2 ? ' Product-only shot, no people.' : '')
        : '');

  var payload = { prompt: fullPrompt };
  if (S_PROD_REF) { payload.imageBase64=S_PROD_REF.data; payload.imageMimeType=S_PROD_REF.mimeType; }

  var ctrl = new AbortController();
  var timeout = setTimeout(function(){ ctrl.abort(); }, 55000);

  try {
    var res = await fetch('/api/generate-image', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload), signal: ctrl.signal
    });
    clearTimeout(timeout);
    var data = await res.json();
    if (!res.ok || !data.base64) throw new Error(data.error || '생성 실패');
    S_IMAGES[slotIdx] = { data: data.base64, mimeType: data.mimeType };
    renderSlots();
    saveDraft();
    showToast('✅ 슬롯 '+sceneNum+' 재작성 완료');
  } catch(e) {
    clearTimeout(timeout);
    if (slot) slot.style.opacity = '1';
    if (btn) { btn.disabled=false; btn.textContent='↺ 재작성'; }
    showToast('⚠️ 슬롯 '+sceneNum+' 재작성 실패: '+(e.name==='AbortError'?'시간 초과':e.message));
  }
}

function extractScenesFromBody(body) {
  var scenes = [], markerRe = /\[📸\s*(\d+)[^\]]*\]/g, match, markers = [];
  while ((match = markerRe.exec(body)) !== null) markers.push({ slot:parseInt(match[1]), idx:match.index });
  if (markers.length >= 3) {
    markers.forEach(function(mk) {
      var before = body.slice(Math.max(0,mk.idx-220),mk.idx).replace(/\[📸\d+[^\]]*\]/g,'').trim();
      var after  = body.slice(mk.idx,Math.min(body.length,mk.idx+220)).replace(/\[📸\d+[^\]]*\]/g,'').trim();
      scenes.push({ slot:mk.slot, context:(before.slice(-130)+' '+after.slice(0,130)).trim() });
    });
  } else {
    var clean = body.replace(/\[📸\d+[^\]]*\]/g,'').replace(/\n{2,}/g,'\n').trim();
    var unit = Math.floor(clean.length/6);
    for (var i=1;i<=6;i++) scenes.push({ slot:i, context:clean.slice((i-1)*unit,i*unit).trim().slice(0,220) });
  }
  return scenes;
}

// 씬별 카메라 구도만 고정 — 내용은 항상 본문 컨텍스트 우선
var SCENE_CAMERA = {
  1: 'CLOSE-UP portrait. Tight frame on face and upper body only. Shallow depth of field. Subject looking slightly to the side.',
  2: 'PRODUCT ONLY shot. NO PEOPLE. The product laid flat or displayed alone on clean white or light grey surface. Top-down or 45-degree angle. Sharp studio lighting. Macro detail visible.',
  3: 'FULL BODY shot. Full figure visible head to toe. Korean indoor setting, bright natural light.',
  4: 'DYNAMIC shot. Low camera angle looking slightly upward. Subject in natural motion. Bokeh street background.',
  5: 'SEATED MEDIUM shot. Waist-up. Subject sitting naturally, warm indoor bokeh background.',
  6: 'WIDE LIFESTYLE shot. Full figure in expansive modern Korean urban or café environment. Relaxed, natural posture.'
};

function buildScenePrompt(scene, prodName) {
  var camera = SCENE_CAMERA[scene.slot] || '';
  // 컨텍스트가 있으면 내용으로, 없으면 슬롯별 기본 상황
  var situation = [
    'Korean woman in a relatable daily frustration moment related to "'+prodName+'"',
    '"'+prodName+'" product displayed alone, no people, clean background',  // 씬2 인물 없음
    'Korean woman encountering "'+prodName+'" with curiosity and interest',
    'Korean woman actively using "'+prodName+'" in a natural daily situation',
    'Korean woman reacting with satisfaction and delight after using "'+prodName+'"',
    'Korean woman enjoying life with "'+prodName+'" in an aspirational setting'
  ][scene.slot - 1] || '"'+prodName+'" lifestyle scene';
}

async function generateImagesFromBody() {
  if (!S.generated) { showToast('⚠️ 먼저 블로그 글을 생성해주세요'); return; }
  var btn  = document.getElementById('img-auto-btn');
  var prog = document.getElementById('img-auto-prog');
  var bar  = document.getElementById('img-auto-bar');
  var step = document.getElementById('img-auto-step');
  var cnt  = document.getElementById('img-auto-count');
  btn.disabled=true; btn.innerHTML='⏳ 생성 중...';
  prog.style.display='block'; bar.style.width='0%';

  var body     = document.getElementById('body-textarea').value;
  var prodName = S.product ? S.product.name : '제품';
  var scenes   = extractScenesFromBody(body);
  var total=scenes.length, success=0, fail=0;

  for (var i=0; i<scenes.length; i++) {
    var scene=scenes[i], slotIdx=scene.slot-1;
    step.textContent='씬 '+scene.slot+' 생성 중...';
    cnt.textContent=(i+1)+' / '+total;
    bar.style.width=Math.round((i/total)*100)+'%';

    // 항상 buildScenePrompt 통해 구도+컨텍스트 조합
    var sceneDesc = buildScenePrompt(scene, prodName);
    var fullPrompt = IMG_CHARACTER_DNA
      + '\n\nSCENE CAMERA DIRECTION: ' + (SCENE_CAMERA[scene.slot] || '')
      + '\n\nSCENE CONTENT:\n' + sceneDesc
      + '\n\nPRODUCT: ' + prodName
      + '\n\nIMAGE RULES: Photorealistic, 4K, cinematic. Korean setting.'
      + ' NO TEXT, NO LETTERS, NO CAPTIONS anywhere in the image.'
      + (S_PROD_REF
          ? ' PRODUCT CONSISTENCY: The reference image shows the EXACT product.'
          + ' Every scene must show this EXACT product — same color, same shape, same design. Do NOT change the product.'
          + (scene.slot === 2 ? ' This is a product-only shot, no people.' : '')
          : '');

    var payload = { prompt: fullPrompt };
    if (S_PROD_REF) { payload.imageBase64=S_PROD_REF.data; payload.imageMimeType=S_PROD_REF.mimeType; }

    var ctrl=new AbortController(), timeout=setTimeout(function(){ctrl.abort();},55000);
    try {
      var res=await fetch('/api/generate-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:ctrl.signal});
      clearTimeout(timeout);
      var data=await res.json();
      if(!res.ok||!data.base64) throw new Error(data.error||'생성 실패');
      S_IMAGES[slotIdx]={data:data.base64,mimeType:data.mimeType};
      renderSlots(); success++;
    } catch(e) { clearTimeout(timeout); fail++; console.warn('슬롯 '+scene.slot+' 실패:',e.message); }
    bar.style.width=Math.round(((i+1)/total)*100)+'%';
  }

  bar.style.width='100%';
  step.textContent='완료! ✅ '+success+'장 성공'+(fail>0?' / '+fail+'장 실패':'');
  cnt.textContent=''; btn.disabled=false; btn.innerHTML='🔄 이미지 다시 생성';
  if(success>0){ saveDraft(); showToast('🎨 이미지 '+success+'장 생성 완료 — 슬롯에 자동 배치됨'); }
  else showToast('⚠️ 이미지 생성 실패 — API 상태를 확인해주세요');
}
