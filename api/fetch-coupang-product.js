// api/fetch-coupang-product.js
// POST /api/fetch-coupang-product  { keyword, productId }
// 쿠팡 파트너스 API — 상품 검색 후 카드 UI용 JSON 반환

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { keyword, productId } = req.body;
  const query = (keyword || productId || '').trim();

  if (!query) {
    return res.status(400).json({ status: 'fallback', message: '검색어가 없습니다.', items: [] });
  }

  const accessKey = process.env.COUPANG_ACCESS_KEY;
  const secretKey = process.env.COUPANG_SECRET_KEY;

  if (!accessKey || !secretKey) {
    return res.status(200).json({ status: 'fallback', message: '쿠팡 API 키 미설정', items: [] });
  }

  try {
    const method = 'GET';
    const path   = '/v2/providers/affiliate_open_api/apis/openapi/v1/products/search';
    const qs     = `keyword=${encodeURIComponent(query.slice(0, 50))}&limit=5&subId=realpick`;
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
    console.log('[fetch-coupang-product] status:', r.status, '| rCode:', d.rCode);

    if (!r.ok || d.rCode !== '0') {
      return res.status(200).json({
        status  : 'fallback',
        message : d.rMessage || '쿠팡 API 오류',
        items   : []
      });
    }

    const raw   = d.data?.productData || [];
    const items = raw.map(p => ({
      title       : p.productName || '',
      price       : p.salePriceStr ? parseInt(p.salePriceStr.replace(/,/g, '')) : 0,
      image       : p.productImage || '',
      deeplink    : p.productUrl   || '',
      rating      : p.productRating || 0,
      reviewCount : p.reviewCount   || 0
    }));

    console.log('[fetch-coupang-product] items:', items.length);
    return res.status(200).json({ status: 'success', items });

  } catch(e) {
    console.error('[fetch-coupang-product] 오류:', e.message);
    return res.status(200).json({
      status  : 'fallback',
      message : '상품 정보를 불러오지 못했습니다.',
      items   : []
    });
  }
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
