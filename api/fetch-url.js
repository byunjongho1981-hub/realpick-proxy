// api/fetch-url.js
// POST /api/fetch-url  { url }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const finalUrl = await resolveRedirect(url);
    console.log('[fetch-url] original:', url, '→ final:', finalUrl);

    let productInfo = null;

    if (finalUrl.includes('search.shopping.naver.com') || finalUrl.includes('smartstore.naver.com') || finalUrl.includes('naver.me')) {
      productInfo = await fetchNaver(finalUrl);
    } else if (finalUrl.includes('coupang.com')) {
      productInfo = await fetchCoupang(finalUrl);
    } else if (finalUrl.includes('11st.co.kr')) {
      productInfo = await fetchGeneral(finalUrl, '11번가');
    } else if (finalUrl.includes('oliveyoung.co.kr')) {
      productInfo = await fetchGeneral(finalUrl, '올리브영');
    } else {
      productInfo = await fetchGeneral(finalUrl, '기타');
    }

    if (!productInfo) throw new Error('제품 정보를 가져올 수 없습니다');

    // ★ imageUrl 서버에서 직접 base64 변환 (enrichWithGemini 바깥에서 처리)
    const imageUrl = productInfo.imageUrl || '';
    if (imageUrl) {
      console.log('[fetch-url] imageUrl found:', imageUrl.slice(0, 80));
      const imgData = await fetchImageAsBase64(imageUrl);
      if (imgData) {
        productInfo.imageBase64   = imgData.base64;
        productInfo.imageMimeType = imgData.mimeType;
        console.log('[fetch-url] image base64 ok, size:', imgData.base64.length);
      } else {
        console.warn('[fetch-url] image base64 failed for:', imageUrl.slice(0, 80));
        // base64 실패 시 URL만이라도 반환
        productInfo.imageUrl = imageUrl;
      }
    } else {
      console.warn('[fetch-url] no imageUrl extracted');
    }

    return res.status(200).json({ success: true, product: productInfo });

  } catch (err) {
    console.error('[fetch-url] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── 이미지 URL → base64 ──────────────────────────────────────
async function fetchImageAsBase64(imageUrl) {
  try {
    const r = await fetch(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000)
    });
    if (!r.ok) return null;
    const contentType = r.headers.get('content-type') || 'image/jpeg';
    const mimeType = contentType.split(';')[0].trim();
    if (!mimeType.startsWith('image/')) return null;
    const buf = await r.arrayBuffer();
    const base64 = Buffer.from(buf).toString('base64');
    return { base64, mimeType };
  } catch(e) {
    console.warn('[fetchImageAsBase64] failed:', e.message);
    return null;
  }
}

// ── 단축 URL → 최종 URL 추적 ────────────────────────────────
async function resolveRedirect(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000)
    });
    return res.url || url;
  } catch(e) {
    console.warn('[fetch-url] redirect resolve failed:', e.message);
    return url;
  }
}

// ── 네이버 쇼핑 API ──────────────────────────────────────────
async function fetchNaver(url) {
  let keyword = '';

  try {
    const urlObj = new URL(url);
    keyword = urlObj.searchParams.get('query') || urlObj.searchParams.get('q') || '';

    if (!keyword && url.includes('smartstore')) {
      const parts = urlObj.pathname.split('/').filter(Boolean);
      keyword = decodeURIComponent(parts[parts.length - 1] || '');
    }

    const catMatch = url.match(/catalog\/(\d+)/);
    if (!keyword && catMatch) keyword = catMatch[1];

    if (!keyword) {
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': 'facebookexternalhit/1.1' },
          signal: AbortSignal.timeout(6000)
        });
        if (r.ok) {
          const html = await r.text();
          const og = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)||[])[1];
          const title = (html.match(/<title>([^<]+)<\/title>/i)||[])[1];
          keyword = (og || title || '').replace(/\s*[|-].*$/,'').trim();
        }
      } catch(e) {}
    }
  } catch(e) {
    keyword = '';
  }

  if (!keyword) throw new Error('URL에서 키워드를 추출할 수 없습니다. 제품명을 직접 입력해주세요.');

  keyword = keyword.slice(0, 50);

  const apiUrl = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=5&sort=sim`;
  const response = await fetch(apiUrl, {
    headers: {
      'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
    },
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) throw new Error('네이버 API 오류: ' + response.status);

  const data = await response.json();
  const items = data.items || [];
  if (!items.length) throw new Error('검색 결과 없음: ' + keyword);

  const item   = items[0];
  const prices = items.map(i => parseInt(i.lprice)).filter(p => p > 0);
  const price  = parseInt(item.lprice) || 0;

  return enrichWithGemini({
    productName : item.title.replace(/<[^>]+>/g, ''),
    price,
    avgPrice    : prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0,
    category    : item.category1 || item.category2 || '쇼핑',
    brand       : item.brand || '',
    platform    : '네이버쇼핑',
    originalUrl : url,
    keyword,
    imageUrl    : item.image || ''  // ★ 네이버 쇼핑 이미지
  });
}

// ── 쿠팡 ─────────────────────────────────────────────────────
async function fetchCoupang(url) {
  let keyword = '';
  let imageUrl = '';

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) {
      const html = await r.text();
      const og   = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)||[])[1];
      const t    = (html.match(/<title>([^<]+)<\/title>/i)||[])[1];
      keyword  = (og || t || '').replace(/\s*[|-].*쿠팡.*/i,'').trim();
      // ★ og:image 추출
      imageUrl = (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)||[])[1] || '';
    }
  } catch(e) {}

  if (!keyword) {
    try {
      const u = new URL(url);
      keyword = u.searchParams.get('q') || u.searchParams.get('itemName') || '';
    } catch(e) {}
  }

  if (!keyword) throw new Error('쿠팡 제품명을 추출할 수 없습니다. 직접 입력해주세요.');

  const apiUrl = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(keyword.slice(0,50))}&display=3&sort=sim`;
  const rr = await fetch(apiUrl, {
    headers: {
      'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
    },
    signal: AbortSignal.timeout(8000)
  });
  const dd = rr.ok ? await rr.json() : {};
  const items = dd.items || [];
  const price = items.length ? parseInt(items[0].lprice) : 0;
  // 쿠팡 og:image 없으면 네이버 이미지 fallback
  if (!imageUrl && items.length) imageUrl = items[0].image || '';

  return enrichWithGemini({
    productName : keyword,
    price,
    category    : items.length ? (items[0].category1 || '') : '쇼핑',
    platform    : '쿠팡',
    originalUrl : url,
    keyword,
    imageUrl     // ★
  });
}

// ── 일반 사이트 ───────────────────────────────────────────────
async function fetchGeneral(url, platformName) {
  const agents = [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Twitterbot/1.0'
  ];

  let html = '';
  for (const ua of agents) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': ua, 'Accept': 'text/html' },
        signal: AbortSignal.timeout(7000)
      });
      if (r.ok) { html = await r.text(); break; }
    } catch(e) { continue; }
  }

  if (!html) throw new Error(platformName + ' 페이지를 가져올 수 없습니다. 제품명을 직접 입력해주세요.');

  const ogTitle  = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)||[])[1] || '';
  const ogDesc   = (html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)||[])[1] || '';
  const titleTag = (html.match(/<title>([^<]+)<\/title>/i)||[])[1] || '';
  const priceStr = (html.match(/["']price["']\s*:\s*["']?([\d,]+)/i)||[])[1] || '0';
  const imageUrl = (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)||[])[1] || ''; // ★

  return enrichWithGemini({
    productName : (ogTitle || titleTag.split('|')[0]).trim(),
    price       : parseInt(priceStr.replace(/,/g,'')) || 0,
    description : ogDesc,
    platform    : platformName,
    originalUrl : url,
    imageUrl     // ★
  });
}

// ── Gemini 보강 ───────────────────────────────────────────────
async function enrichWithGemini(raw) {
  const savedImageUrl = raw.imageUrl || ''; // ★ 미리 백업
  const apiKey   = process.env.GEMINI_API_KEY;
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey;

  const prompt = `아래 제품 원본 정보를 분석하여 블로그 작성용 구조화 데이터를 추출하라.
JSON만 출력. 다른 텍스트 절대 금지.

입력:
${JSON.stringify(raw, null, 2)}

출력:
{
  "productName": "정확한 제품명 (브랜드+모델명 포함)",
  "price": 숫자,
  "category": "카테고리",
  "priceGrade": "A(3만↓) or B(3~30만) or C(30~100만) or D(100만↑)",
  "features": ["핵심 특징 1","특징 2","특징 3"],
  "pros": ["장점 1","장점 2","장점 3"],
  "cons": ["단점/주의 1","단점 2"],
  "targetUser": "타겟 사용자 1문장",
  "hookScene": "구매 검색하게 된 불편 장면 1~2문장",
  "reviewSummary": "후기 요약",
  "platform": "${raw.platform || '기타'}",
  "originalUrl": "${raw.originalUrl || ''}",
  "imageUrl": "${raw.imageUrl || ''}"
}`;

  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1000, temperature: 0.3 }
      })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const result = JSON.parse(text.replace(/```json|```/g, '').trim());
    result.imageUrl = savedImageUrl; // ★ 강제 복원
    return result;
  } catch(e) {
    console.error('[enrichWithGemini]', e.message);
    return { ...raw, priceGrade: calcGrade(raw.price), features: [], pros: [], cons: [] };
  }
}

function calcGrade(price) {
  if (!price)          return 'B';
  if (price < 30000)   return 'A';
  if (price < 300000)  return 'B';
  if (price < 1000000) return 'C';
  return 'D';
}
