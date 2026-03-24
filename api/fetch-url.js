// api/fetch-url.js
// POST /api/fetch-url  { url }

module.exports = async function handler(req, res) {
  try {
    const parsed       = new URL(finalUrl);
    const parts        = parsed.pathname.split('/').filter(Boolean);
    const productId    = (parts[0]==='vp' && parts[1]==='products') ? parts[2] : '';
    const itemId       = parsed.searchParams.get('itemId') || '';
    const vendorItemId = parsed.searchParams.get('vendorItemId') || '';

    let fixedUrl = productId ? `https://www.coupang.com/vp/products/${productId}` : finalUrl;
    if (productId && itemId && vendorItemId) fixedUrl += `?itemId=${itemId}&vendorItemId=${vendorItemId}`;
    else if (productId && itemId)            fixedUrl += `?itemId=${itemId}`;

    // (1) contentkeyword 추출
    let keyword = '';
    const m = finalUrl.match(/[?&]contentkeyword=([^&]+)/);
    if (m && m[1]) keyword = decodeURIComponent(m[1]).trim();

    // (2) itemId로 네이버 웹검색 → 제품명 추출
    if (!keyword && itemId) {
      try {
        const r = await fetch(
          `https://openapi.naver.com/v1/search/webkr.json?query=${encodeURIComponent('쿠팡 ' + itemId)}&display=5`,
          { headers: { 'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET }, signal: AbortSignal.timeout(6000) }
        );
        if (r.ok) {
          const d = await r.json();
          const hit = (d.items || []).find(i => i.link && i.link.includes('coupang.com')) || (d.items || [])[0];
          if (hit && hit.title) {
            keyword = hit.title.replace(/<[^>]+>/g,'').replace(/쿠팡.*$/i,'').replace(/\s*[\|\-].*$/,'').trim();
          }
        }
      } catch(e) { console.warn('[fetchCoupang] webkr(itemId) 실패:', e.message); }
    }

    // (3) productId로 네이버 웹검색 → 제품명 추출
    if (!keyword && productId) {
      try {
        const r = await fetch(
          `https://openapi.naver.com/v1/search/webkr.json?query=${encodeURIComponent('쿠팡 ' + productId)}&display=5`,
          { headers: { 'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET }, signal: AbortSignal.timeout(6000) }
        );
        if (r.ok) {
          const d = await r.json();
          const hit = (d.items || []).find(i => i.link && i.link.includes('coupang.com')) || (d.items || [])[0];
          if (hit && hit.title) {
            keyword = hit.title.replace(/<[^>]+>/g,'').replace(/쿠팡.*$/i,'').replace(/\s*[\|\-].*$/,'').trim();
          }
        }
      } catch(e) { console.warn('[fetchCoupang] webkr(productId) 실패:', e.message); }
    }

    // (4) ★ 네이버 쇼핑 API로 상세 정보 추가 수집
    let naverShopData = {};
    if (keyword) {
      try {
        const r = await fetch(
          `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=5&sort=sim`,
          { headers: { 'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET }, signal: AbortSignal.timeout(6000) }
        );
        if (r.ok) {
          const d = await r.json();
          const item = (d.items || [])[0];
          if (item) {
            naverShopData = {
              price    : parseInt(item.lprice) || 0,
              category : item.category1 || item.category2 || '쿠팡',
              brand    : item.brand || '',
              imageUrl : item.image || ''
            };
          }
        }
      } catch(e) { console.warn('[fetchCoupang] naverShop 실패:', e.message); }
    }

    console.log('[fetchCoupang] productId:', productId, '| keyword:', keyword || '(없음)');

    // ★ enrichWithGemini 호출 — 네이버/일반과 동일하게 특징·장단점·후기 보강
    return enrichWithGemini({
      productName  : keyword || (productId ? '쿠팡 상품 ' + productId : '쿠팡 상품'),
      price        : naverShopData.price || 0,
      category     : naverShopData.category || '쿠팡',
      brand        : naverShopData.brand || '',
      imageUrl     : naverShopData.imageUrl || '',
      platform     : '쿠팡',
      originalUrl,
      finalUrl,
      fixedUrl,
      productId    : productId || '',
      itemId       : itemId || '',
      vendorItemId : vendorItemId || '',
      keyword
    });

  } catch(e) {
    console.warn('[fetchCoupang] 파싱 실패:', e.message);
    return {
      productName  : '쿠팡 상품',
      price        : 0,
      category     : '쿠팡',
      platform     : '쿠팡',
      originalUrl,
      finalUrl,
      fixedUrl     : finalUrl,
      productId    : '',
      itemId       : '',
      vendorItemId : '',
      keyword      : '',
      priceGrade   : 'B',
      features     : [],
      pros         : [],
      cons         : [],
      targetUser   : '',
      hookScene    : '',
      reviewSummary: '',
      imageUrl     : ''
    };
  }
}
