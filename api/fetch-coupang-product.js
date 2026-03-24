// api/fetch-coupang-product.js
// POST /api/fetch-coupang-product  { keyword?, itemId?, contentkeyword? }
// 쿠팡 파트너스 API — keyword 자동 생성 + 상품 검색

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { keyword: rawKeyword, itemId, contentkeyword } = req.body;

  const accessKey = process.env.COUPANG_ACCESS_KEY;
  const secretKey = process.env.COUPANG_SECRET_KEY;
  if (!accessKey || !secretKey) {
    return res.status(200).json({ status: 'fallback', keyword: '', message: '쿠팡 API 키 미설정', items: [] });
  }

  // ── 1. keyword 생성 (우선순위) ───────────────────────────────
  let keyword = '';

  // (1) contentkeyword 직접 사용
  if (contentkeyword) {
    keyword = cleanKeyword(contentkeyword);
    console.log('[fetch-coupang-product] contentkeyword 사용:', keyword);
  }

  // (2) rawKeyword 직접 사용
  if (!keyword && rawKeyword) {
    keyword = cleanKeyword(rawKeyword);
    console.log('[fetch-coupang-product] rawKeyword 사용:', keyword);
  }

  // (3) itemId로 네이버 쇼핑 검색 → 제목 추출
  if (!keyword && itemId) {
    console.log('[fetch-coupang-product] itemId로 네이버 검색:', itemId);
    try {
      const r = await fetch(
        `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(itemId)}&display=3&sort=sim`,
        {
          headers: {
            'X-Naver-Client-Id':     process.env.NAVER_CLIENT_ID,
            'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
          },
          signal: AbortSignal.timeout(6000)
        }
      );
      if (r.ok) {
        const d  = await r.json();
        const ni = (d.items || [])[0];
        if (ni && ni.title) {
          keyword = cleanKeyword(ni.title.replace(/<[^>]+>/g, ''));
          console.log('[fetch-coupang-product] 네이버 keyword:', keyword);
        }
      }
    } catch(e) {
      console.warn('[fetch-coupang-product] 네이버 검색 실패:', e.message);
    }
  }

  if (!keyword) {
    return res.status(200).json({ status: 'fallback', keyword: '', message: 'keyword를 생성할 수 없습니다.', items: [] });
  }

  // ── 2. 쿠팡 파트너스 검색 API ────────────────────────────────
  try {
    const method = 'GET';
    const path   = '/v2/providers/affiliate_open_api/apis/openapi/v1/products/search';
    const qs     = `keyword=${encodeURIComponent(keyword)}&limit=5&subId=realpick`;
    const { datetime, signature } = await buildHmac(method, path, qs, secretKey);

    const r = await fetch(`https://api-gateway.coupang.com${path}?${qs}`, {
      method: 'GET',
      headers: {
        'Authorization': `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`,
        'Content-Type' : 'application/json;charset=UTF-8'
      },
      signal: AbortSignal.timeout(10000)
    });

    const d = await r.json();
    console.log('[fetch-coupang-product] API status:', r.status, '| rCode:', d.rCode, '| keyword:', keyword);

    if (!r.ok || d.rCode !== '0') {
      return res.status(200).json({
        status  : 'fallback',
        keyword,
        message : d.rMessage || '쿠팡 API 오류',
        items   : []
      });
    }

    const items = (d.data?.productData || []).map(p => ({
      title       : p.productName   || '',
      price       : p.salePriceStr  ? parseInt(p.salePriceStr.replace(/,/g, '')) : 0,
      image       : p.productImage  || '',
      deeplink    : p.productUrl    || '',
      rating      : p.productRating || 0,
      reviewCount : p.reviewCount   || 0
    }));

    console.log('[fetch-coupang-product] items:', items.length);
    return res.status(200).json({ status: 'success', keyword, items });

  } catch(e) {
    console.error('[fetch-coupang-product] 오류:', e.message);
    return res.status(200).json({
      status  : 'fallback',
      keyword,
      message : '상품 정보를 불러오지 못했습니다.',
      items   : []
    });
  }
}

// ── keyword 정제 ─────────────────────────────────────────────
function cleanKeyword(raw) {
  return raw
    .replace(/<[^>]+>/g, '')                          // HTML 태그
    .replace(/쿠팡|무료배송|로켓배송|특가|할인|최저가|당일배송/g, '') // 불필요 단어
    .replace(/\s*[\|\-\/\\].*$/, '')                  // | - / \ 이후 제거
    .replace(/\s{2,}/g, ' ')                          // 연속 공백
    .trim()
    .slice(0, 50);
}

// ── HMAC 서명 (crypto.subtle — import 없이) ──────────────────
async function buildHmac(method, path, query, secretKey) {
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const yy  = String(now.getUTCFullYear()).slice(2);
  const datetime =
    yy + pad(now.getUTCMonth()+1) + pad(now.getUTCDate()) + 'T' +
    pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';

  const message = datetime + method + path + (query || '');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig  = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const signature = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  return { datetime, signature };
}
