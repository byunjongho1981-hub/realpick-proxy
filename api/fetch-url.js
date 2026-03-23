// api/fetch-url.js
// POST /api/fetch-url  { url }

import crypto from 'crypto';

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
      productInfo = await fetchCoupang(url, finalUrl);
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

// ── 쿠팡 파트너스 API ─────────────────────────────────────────
function generateCoupangSignature(method, path, query, secretKey) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const datetime =
    now.getUTCFullYear() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) + 'T' +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds()) + 'Z';

  // 쿠팡 공식 서명 형식: datetime + method + path + "?" + query
  const message = datetime + method + path + (query ? '?' + query : '');
  const signature = crypto.createHmac('sha256', secretKey).update(message).digest('hex');

  console.log('[coupang-sig] datetime:', datetime, '| message:', message.slice(0, 80));
  return { datetime, signature };
}

async function fetchCoupang(originalUrl, finalUrl) {
  const accessKey = process.env.COUPANG_ACCESS_KEY;
  const secretKey = process.env.COUPANG_SECRET_KEY;

  // 1. URL에서 productId 추출
  const productIdMatch = finalUrl.match(/\/products\/(\d+)/);
  const productId = productIdMatch ? productIdMatch[1] : null;

  // 2. productId로 쿠팡 파트너스 상품 상세 API 조회
  if (productId && accessKey && secretKey) {
    try {
      const method = 'GET';
      const path   = `/v2/providers/affiliate_open_api/apis/openapi/v1/products/${productId}`;
      const query  = 'subId=realpick';
      const { datetime, signature } = generateCoupangSignature(method, path, query, secretKey);

      const r = await fetch(`https://api-gateway.coupang.com${path}?${query}`, {
        method: 'GET',
        headers: {
          'Authorization': `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`,
          'Content-Type': 'application/json;charset=UTF-8'
        },
        signal: AbortSignal.timeout(10000)
      });

      const d = await r.json();
      const item = d.data;

      if (item && item.productName) {
        console.log('[fetchCoupang] 상품 상세 API 성공:', item.productName);
        return enrichWithGemini({
          productName : item.productName,
          price       : item.salePriceStr ? parseInt(item.salePriceStr.replace(/,/g,'')) : 0,
          category    : item.categoryName || '쇼핑',
          platform    : '쿠팡',
          originalUrl : originalUrl,
          keyword     : item.productName,
          imageUrl    : item.productImage || '',
          rating      : item.productRating || 0,
          reviewCount : item.reviewCount || 0
        });
      }
    } catch(e) {
      console.warn('[fetchCoupang] 상품 상세 API 실패:', e.message);
    }
  }

  // 3. keyword 추출 시도 (URL 파라미터)
  let keyword = '';
  try {
    const u = new URL(finalUrl);
    keyword = u.searchParams.get('q') || u.searchParams.get('keyword')
      || u.searchParams.get('itemName') || u.searchParams.get('contentkeyword') || '';
  } catch(e) {}

  // 4. og:title 추출 시도
  if (!keyword) {
    try {
      const r = await fetch(finalUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
        signal: AbortSignal.timeout(6000)
      });
      if (r.ok) {
        const html = await r.text();
        const og = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)||[])[1];
        const t  = (html.match(/<title>([^<]+)<\/title>/i)||[])[1];
        keyword = (og || t || '').replace(/\s*[\|\-].*쿠팡.*/i, '').trim();
      }
    } catch(e) {}
  }

  // 5. keyword로 쿠팡 파트너스 검색 API
  if (keyword && accessKey && secretKey) {
    try {
      const method = 'GET';
      const path   = '/v2/providers/affiliate_open_api/apis/openapi/v1/products/search';
      const query  = `keyword=${encodeURIComponent(keyword.slice(0,50))}&limit=5&subId=realpick`;
      const { datetime, signature } = generateCoupangSignature(method, path, query, secretKey);

      const r = await fetch(`https://api-gateway.coupang.com${path}?${query}`, {
        method: 'GET',
        headers: {
          'Authorization': `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`,
          'Content-Type': 'application/json;charset=UTF-8'
        },
        signal: AbortSignal.timeout(10000)
      });

      const d = await r.json();
      const items = d.data?.productData || [];
      if (items.length) {
        const item = items[0];
        return enrichWithGemini({
          productName : item.productName || keyword,
          price       : item.salePriceStr ? parseInt(item.salePriceStr.replace(/,/g,'')) : 0,
          category    : item.categoryName || '쇼핑',
          platform    : '쿠팡',
          originalUrl : originalUrl,
          keyword,
          imageUrl    : item.productImage || ''
        });
      }
    } catch(e) {
      console.warn('[fetchCoupang] 검색 API 실패:', e.message);
    }
  }

  if (!keyword) throw new Error('쿠팡 제품명을 추출할 수 없습니다. 제품명을 직접 입력해주세요.');

  // 6. 최후 fallback — 네이버 쇼핑
  const apiUrl = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(keyword.slice(0,50))}&display=3&sort=sim`;
  const rr = await fetch(apiUrl, {
    headers: {
      'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
    },
    signal: AbortSignal.timeout(8000)
  });
  const dd = rr.ok ? await rr.json() : {};
  const naverItems = dd.items || [];

  return enrichWithGemini({
    productName : keyword,
    price       : naverItems.length ? parseInt(naverItems[0].lprice) : 0,
    category    : naverItems.length ? (naverItems[0].category1 || '') : '쇼핑',
    platform    : '쿠팡',
    originalUrl : originalUrl,
    keyword,
    imageUrl    : naverItems.length ? (naverItems[0].image || '') : ''
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
  const savedImageUrl = raw.imageUrl || '';
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
    if (openCount > closeCount) {
      jsonStr += '}'.repeat(openCount - closeCount);
    }

    const result = JSON.parse(jsonStr);
    result.imageUrl = savedImageUrl;
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
