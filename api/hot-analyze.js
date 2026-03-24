async function extractCandidates(seedKw) {
  try {
    // 네이버 연관검색어 API
    var d = await naverGet('/v1/search/shop.json', {
      query: seedKw, display: 10, sort: 'sim'
    });

    // 연관검색어 API 호출
    var related = await fetch(
      'https://ac.search.naver.com/nx/ac?q=' + encodeURIComponent(seedKw) +
      '&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100',
      { signal: AbortSignal.timeout(5000) }
    )
    .then(function(r) { return r.json(); })
    .catch(function() { return {}; });

    // 연관검색어 추출
    var relatedKws = [];
    try {
      var items = (related.items || [])[0] || [];
      relatedKws = items
        .map(function(i) { return Array.isArray(i) ? i[0] : i; })
        .filter(function(kw) {
          return kw && kw !== seedKw && kw.length >= 2 && kw.length <= 15;
        })
        .slice(0, 5);
    } catch(e) {}

    // 연관검색어 없으면 네이버 쇼핑 인기 상품명에서 추출 (fallback)
    if (!relatedKws.length) {
      var stop = new Set([
        '이','가','을','를','의','에','는','은','도','와','과','로','으로',
        '블랙','화이트','레드','블루','그린','핑크','실버','골드','베이지','그레이',
        '세트','상품','제품','추천','할인','무료','배송','당일','정품','인기',
        '1개','2개','3개','스타일','디자인','사이즈','색상','옵션','모델'
      ]);
      var freq = {};
      (d.items || []).forEach(function(item) {
        clean(item.title || '').split(/\s+/).filter(function(w) {
          return w.length >= 2 && !stop.has(w) && w !== seedKw &&
                 /[가-힣]{2,}/.test(w) && !/^\d+$/.test(w);
        }).forEach(function(w) { freq[w] = (freq[w] || 0) + 1; });
      });
      relatedKws = Object.entries(freq)
        .sort(function(a, b) { return b[1] - a[1]; })
        .slice(0, 5)
        .map(function(e) { return e[0]; });
    }

    // seedKw 포함 최대 3개 반환
    var out = [seedKw];
    relatedKws.forEach(function(kw) {
      if (out.indexOf(kw) < 0 && out.length < 3) out.push(kw);
    });

    console.log('[extractCandidates] seed:', seedKw, '→', out);
    return out;

  } catch(e) {
    console.warn('[extractCandidates] 오류:', e.message);
    return [seedKw];
  }
}
