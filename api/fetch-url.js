// api/fetch-url.js
// POST /api/fetch-url  { url }
// 플랫폼 감지 → 네이버/쿠팡/일반 분기 처리

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    let productInfo = null;

    // ── 1. 네이버 쇼핑 ──────────────────────────────────────
    if (url.includes('search.shopping.naver.com') || url.includes('smartstore.naver.com')) {
      productInfo = await fetchNaver(url);
    }
    // ── 2. 쿠팡 ─────────────────────────────────────────────
    else if (url.includes('coupang.com')) {
      productInfo = await fetchCoupang(url);
    }
    // ── 3. 11번가 ────────────────────────────────────────────
    else if (url.includes('11st.co.kr')) {
      productInfo = await fetchGeneral(url, '11번가');
    }
    // ── 4. 올리브영 ─────────────────────────────────────────
    else if (url.includes('oliveyoung.co.kr')) {
      productInfo = await fetchGeneral(url, '올리브영');
    }
    // ── 5. 기타 ─────────────────────────────────────────────
    else {
      productInfo = await fetchGeneral(url, '기타');
    }

    if (!productInfo) throw new Error('제품 정보를 가져올 수 없습니다');

    return res.status(200).json({ success: true, product: productInfo });

  } catch (err) {
    console.error('[fetch-url]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── 네이버 쇼핑: 검색 API 활용 ──────────────────────────────
async function fetchNaver(url) {
  // URL에서 키워드 추출 (query 파라미터 or 스마트스토어 경로)
  let keyword = '';

  const urlObj = new URL(url);

  // search.shopping.naver.com?query=XXX
  keyword = urlObj.searchParams.get('query') || '';

  // 스마트스토어: /products/상품명 형태에서 추출
  if (!keyword && url.includes('smartstore')) {
    const parts = urlObj.pathname.split('/');
    keyword = decodeURIComponent(parts[parts.length - 1] || parts[parts.length - 2] || '');
  }

  // 카탈로그 ID → 네이버 쇼핑 API로 검색
  const catalogMatch = url.match(/catalog\/(\d+)/);
  if (catalogMatch && !keyword) {
    keyword = catalogMatch[1];
  }

  if (!keyword) throw new Error('URL에서 검색어를 추출할 수 없습니다. 직접 제품명을 입력해주세요.');

  // 네이버 쇼핑 검색 API
  const apiUrl = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=5&sort=sim`;
  const response = await fetch(apiUrl, {
    headers: {
      'X-Naver-Client-Id'    : process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
    },
    signal: AbortSignal.timeout(8000)
  });

  const data = await response.json();
  const items = data.items || [];
  if (!items.length) throw new Error('검색 결과가 없습니다: ' + keyword);

  const item = items[0];
  const prices = items.map(i => parseInt(i.lprice)).filter(p => p > 0);
  const avgPrice = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : 0;
  const price = parseInt(item.lprice) || 0;

  return await enrichWithGemini({
    productName  : item.title.replace(/<[^>]+>/g, ''),
    price,
    avgPrice,
    category     : item.category1 || item.category2 || '쇼핑',
    brand        : item.brand || '',
    mallName     : item.mallName || '네이버쇼핑',
    imageUrl     : item.image || '',
    link         : item.link || url,
    platform     : '네이버쇼핑',
    originalUrl  : url,
    keyword      : decodeURIComponent(keyword),
    rawItems     : items.slice(0, 3).map(i => ({
      title : i.title.replace(/<[^>]+>/g,''),
      price : i.lprice,
      mall  : i.mallName
    }))
  });
}

// ── 쿠팡: 제품 ID 추출 + Naver 교차 검색 ────────────────────
async function fetchCoupang(url) {
  // 쿠팡 URL에서 제품명 힌트 추출
  // https://www.coupang.com/vp/products/1234?itemId=...&vendorItemId=...
  const urlObj = new URL(url);
  let keyword = urlObj.searchParams.get('q') || urlObj.searchParams.get('query') || '';

  // /products/ 이후 ID만 있는 경우 → 파라미터에서 추출 시도
  if (!keyword) {
    keyword = urlObj.searchParams.get('itemName') || '';
  }

  // 직접 스크래핑 시도 (쿠팡은 일부 허용)
  if (!keyword) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Accept': 'text/html'
        },
        signal: AbortSignal.timeout(8000)
      });
      const html = await r.text();
      // og:title 추출
      const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
      if (ogTitle) keyword = ogTitle[1].replace(/\s*[-|].*쿠팡.*/i, '').trim();

      // title 태그 fallback
      if (!keyword) {
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch) keyword = titleMatch[1].replace(/\s*[-|].*쿠팡.*/i, '').trim();
      }
    } catch(e) {
      // 스크래핑 실패 시 URL 파라미터로 fallback
    }
  }

  if (!keyword) throw new Error('쿠팡 제품 정보를 가져올 수 없습니다. 제품명을 직접 입력해주세요.');

  // 네이버 쇼핑 API로 교차 검색
  const apiUrl = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=5&sort=sim`;
  const response = await fetch(apiUrl, {
    headers: {
      'X-Naver-Client-Id'    : process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
    },
    signal: AbortSignal.timeout(8000)
  });

  const data = await response.json();
  const items = data.items || [];
  const price = items.length ? parseInt(items[0].lprice) : 0;

  return await enrichWithGemini({
    productName : keyword,
    price,
    category    : items.length ? (items[0].category1 || '') : '쇼핑',
    brand       : items.length ? items[0].brand : '',
    platform    : '쿠팡',
    originalUrl : url,
    keyword
  });
}

// ── 일반 사이트: User-Agent 우회 시도 ───────────────────────
async function fetchGeneral(url, platformName) {
  const agents = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
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

  if (!html) throw new Error(platformName + ' 접근이 차단됐습니다. 제품명을 직접 입력해주세요.');

  // og:title, og:description, og:price 추출
  const ogTitle   = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)||[])[1] || '';
  const ogDesc    = (html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)||[])[1] || '';
  const titleTag  = (html.match(/<title>([^<]+)<\/title>/i)||[])[1] || '';
  const priceStr  = (html.match(/["']price["']\s*:\s*["']?([\d,]+)/i)||[])[1] || '0';

  const productName = ogTitle || titleTag.split('|')[0].trim() || '제품';
  const price = parseInt(priceStr.replace(/,/g,'')) || 0;

  return await enrichWithGemini({
    productName,
    price,
    description : ogDesc,
    platform    : platformName,
    originalUrl : url
  });
}

// ── Gemini로 제품 정보 보강 ──────────────────────────────────
async function enrichWithGemini(raw) {
  const apiKey  = process.env.GEMINI_API_KEY;
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey;

  const prompt = `아래 제품 정보를 분석하여 블로그 작성에 필요한 구조화된 정보를 추출하라.
반드시 JSON만 출력. 다른 텍스트 절대 금지.

제품 원본 정보:
${JSON.stringify(raw, null, 2)}

출력 형식:
{
  "productName": "정확한 제품명",
  "price": 숫자(원화),
  "category": "카테고리",
  "priceGrade": "A(3만↓) or B(3~30만) or C(30~100만) or D(100만↑)",
  "features": ["핵심 특징 1", "핵심 특징 2", "핵심 특징 3"],
  "pros": ["장점 1", "장점 2", "장점 3"],
  "cons": ["단점 또는 주의사항 1", "단점 2"],
  "targetUser": "이 제품이 맞는 타겟 사용자 1문장",
  "hookScene": "독자가 이 제품을 검색하게 된 구체적 불편 장면 1~2문장",
  "reviewSummary": "후기 요약 또는 예상 반응",
  "platform": "${raw.platform || '기타'}",
  "originalUrl": "${raw.originalUrl || ''}"
}`;

  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1000, temperature: 0.3 }
    })
  });

  const d = await r.json();
  if (d.error) {
    // Gemini 실패 시 raw 데이터 그대로 반환
    return { ...raw, priceGrade: calcGrade(raw.price), features: [], pros: [], cons: [] };
  }

  const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g,'').trim());
  } catch(e) {
    return { ...raw, priceGrade: calcGrade(raw.price), features: [], pros: [], cons: [] };
  }
}

function calcGrade(price) {
  if (!price) return 'B';
  if (price < 30000)  return 'A';
  if (price < 300000) return 'B';
  if (price < 1000000)return 'C';
  return 'D';
}
