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

    if (
      finalUrl.includes('search.shopping.naver.com') ||
      finalUrl.includes('smartstore.naver.com') ||
      finalUrl.includes('naver.me') ||
      finalUrl.includes('brandconnect.naver.com')
    ) {
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
    return res.status(200).json({ success: true, product: productInfo });

  } catch (err) {
    console.error('[fetch-url] error:', err.message);
    return res.status(500).json({ error: err.message });
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

    if (url.includes('brandconnect.naver.com')) {
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

    if (!keyword) {
      keyword = urlObj.searchParams.get('query') || urlObj.searchParams.get('q') || '';
    }

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
    imageUrl    : item.image || ''
  });
}

// ── 쿠팡 ─────────────────────────────────────────────────────
async function fetchCoupang(url) {
  const parsed = new URL(url);
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  let productId = '';
  if (pathParts.length >= 3 && pathParts[0] === 'vp' && pathParts[1] === 'products') {
    productId = pathParts[2];
  }
  const itemId       = parsed.searchParams.get('itemId') || '';
  const vendorItemId = parsed.searchParams.get('vendorItemId') || '';

  if (!productId) throw new Error('쿠팡 상품 ID를 추출할 수 없습니다.');

  let fixedUrl = `https://www.coupang.com/vp/products/${productId}`;
  if (itemId && vendorItemId) {
    fixedUrl = `https://www.coupang.com/vp/products/${productId}?itemId=${itemId}&vendorItemId=${vendorItemId}`;
  } else if (itemId) {
    fixedUrl = `https://www.coupang.com/vp/products/${productId}?itemId=${itemId}`;
  }

  console.log('[fetchCoupang] productId:', productId, '| itemId:', itemId, '| fixedUrl:', fixedUrl);

  let html = '';
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) html = await r.text();
  } catch(e) {}

  const ogTitle  = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)||[])[1] || '';
  const ogDesc   = (html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)||[])[1] || '';
  const ogImage  = (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)||[])[1] || '';
  const titleTag = (html.match(/<title>([^<]+)<\/title>/i)||[])[1] || '';
  const priceStr =
    (html.match(/"salePrice"\s*:\s*([0-9]+)/i)||[])[1] ||
    (html.match(/"finalPrice"\s*:\s*([0-9]+)/i)||[])[1] ||
    (html.match(/"price"\s*:\s*([0-9]+)/i)||[])[1] ||
    '0';

  let productName = (ogTitle || titleTag).trim();
  let price       = parseInt(priceStr, 10) || 0;
  let imageUrl    = ogImage;

  // HTML 크롤링 실패 시 네이버 쇼핑으로 productId 검색 fallback
  if (!productName) {
    console.log('[fetchCoupang] HTML 추출 실패 → 네이버 쇼핑 fallback, productId:', productId);
    try {
      const naverUrl = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(productId)}&display=3&sort=sim`;
      const nr = await fetch(naverUrl, {
        headers: {
          'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
          'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
        },
        signal: AbortSignal.timeout(8000)
      });
      if (nr.ok) {
        const nd = await nr.json();
        const ni = (nd.items || [])[0];
        if (ni) {
          productName = ni.title.replace(/<[^>]+>/g, '');
          price       = parseInt(ni.lprice) || 0;
          imageUrl    = ni.image || '';
          console.log('[fetchCoupang] 네이버 fallback 성공:', productName);
        }
      }
    } catch(e) {
      console.warn('[fetchCoupang] 네이버 fallback 실패:', e.message);
    }
  }

  // 그래도 없으면 productId를 임시 이름으로
  if (!productName) productName = '쿠팡 상품 ' + productId;

  const raw = {
    productName,
    price,
    description  : ogDesc,
    category     : '쿠팡',
    brand        : '',
    platform     : '쿠팡',
    originalUrl  : url,
    keyword      : productName,
    imageUrl,
    productId,
    itemId,
    vendorItemId,
    fixedUrl
  };

  const enriched = await enrichWithGemini(raw);
  return {
    ...enriched,
    productId,
    itemId,
    vendorItemId,
    fixedUrl,
    imageUrl: enriched.imageUrl || imageUrl
  };
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
  const imageUrl = (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)||[])[1] || '';

  return enrichWithGemini({
    productName : (ogTitle || titleTag.split('|')[0]).trim(),
    price       : parseInt(priceStr.replace(/,/g,'')) || 0,
    description : ogDesc,
    platform    : platformName,
    originalUrl : url,
    imageUrl
  });
}

// ── Gemini 보강 ───────────────────────────────────────────────
async function enrichWithGemini(raw) {
  const savedImageUrl  = raw.imageUrl     || '';
  const savedProductId = raw.productId    || '';
  const savedItemId    = raw.itemId       || '';
  const savedVendorId  = raw.vendorItemId || '';
  const savedFixedUrl  = raw.fixedUrl     || '';

  const apiKey   = process.env.GEMINI_API_KEY;
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey;

  if (!raw.productName) {
    console.warn('[enrichWithGemini] 제품명 없음 — fallback 처리');
    return { ...raw, priceGrade: calcGrade(raw.price), features: [], pros: [], cons: [] };
  }

  const prompt = `아래 제품 원본 정보를 분석하여 블로그 작성용 구조화 데이터를 추출하라.
JSON만 출력. 다른 텍스트 절대 금지. 마크다운 코드블록 금지.
입력:
${JSON.stringify(raw, null, 2)}
출력 형식:
{"productName":"정확한 제품명","price":숫자,"category":"카테고리","priceGrade":"A or B or C or D","features":["특징1","특징2","특징3"],"pros":["장점1","장점2","장점3"],"cons":["단점1","단점2"],"targetUser":"타겟 사용자 1문장","hookScene":"구매 검색하게 된 불편 장면 1~2문장","reviewSummary":"후기 요약","platform":"${raw.platform || '기타'}","originalUrl":"${raw.originalUrl || ''}","imageUrl":"${raw.imageUrl || ''}"}`;

  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2000, temperature: 0.3 }
      }),
      signal: AbortSignal.timeout(15000)
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);

    const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) throw new Error('Gemini 응답 비어있음');

    const clean = text.replace(/```json|```/g, '').trim();
    const startIdx = clean.indexOf('{');
    if (startIdx === -1) throw new Error('JSON 블록 없음: ' + clean.slice(0, 100));

    let jsonStr = clean.slice(startIdx);
    const openCount  = (jsonStr.match(/\{/g) || []).length;
    const closeCount = (jsonStr.match(/\}/g) || []).length;
    if (openCount > closeCount) jsonStr += '}'.repeat(openCount - closeCount);

    const result = JSON.parse(jsonStr);

    // 원본 필드 보존 — Gemini가 덮어쓰지 못하게
    result.imageUrl     = savedImageUrl;
    result.productId    = savedProductId;
    result.itemId       = savedItemId;
    result.vendorItemId = savedVendorId;
    result.fixedUrl     = savedFixedUrl;

    return result;

  } catch(e) {
    console.error('[enrichWithGemini]', e.message);
    return {
      ...raw,
      priceGrade    : calcGrade(raw.price),
      features      : [],
      pros          : [],
      cons          : [],
      targetUser    : '',
      hookScene     : '',
      reviewSummary : ''
    };
  }
}

function calcGrade(price) {
  if (!price)          return 'B';
  if (price < 30000)   return 'A';
  if (price < 300000)  return 'B';
  if (price < 1000000) return 'C';
  return 'D';
}
