// api/coupang-search.js
// POST /api/coupang-search  { keyword }
// 쿠팡 파트너스 API — HMAC-SHA256 서명

import crypto from 'crypto';

function generateHmacSignature(method, path, query, secretKey) {
  const datetime = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:T]/g, '').slice(0, 14);
  const message = datetime + method + path + (query ? query : '');
  const signature = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return { datetime, signature };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { keyword } = req.body;
  if (!keyword) return res.status(400).json({ error: 'keyword 필요' });

  const accessKey = process.env.COUPANG_ACCESS_KEY;
  const secretKey = process.env.COUPANG_SECRET_KEY;
  if (!accessKey || !secretKey) return res.status(500).json({ error: 'COUPANG API 키 미설정' });

  try {
    const method = 'GET';
    const path   = '/v2/providers/affiliate_open_api/apis/openapi/v1/products/search';
    const query  = `keyword=${encodeURIComponent(keyword)}&limit=5&subId=realpick`;

    const { datetime, signature } = generateHmacSignature(method, path, query, secretKey);

    const url = `https://api-gateway.coupang.com${path}?${query}`;
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`,
        'Content-Type': 'application/json;charset=UTF-8'
      },
      signal: AbortSignal.timeout(10000)
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.message || '쿠팡 API 오류: ' + r.status);

    const items = data.data?.productData || [];
    if (!items.length) return res.status(200).json({ items: [] });

    // 필요한 필드만 추출
    const result = items.map(function(item) {
      return {
        productName : item.productName || '',
        price       : item.salePriceStr ? parseInt(item.salePriceStr.replace(/,/g,'')) : 0,
        imageUrl    : item.productImage || '',
        productUrl  : item.productUrl  || '',
        category    : item.categoryName || '쇼핑',
        rating      : item.productRating || 0,
        reviewCount : item.reviewCount || 0
      };
    });

    return res.status(200).json({ items: result });

  } catch(e) {
    console.error('[coupang-search]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
