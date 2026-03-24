async function extractCandidates(seedKw) {
  try {
    if (process.env.GROQ_API_KEY) {
      var d = await groqPost([{
        role: 'user',
        content:
          '아래 키워드와 관련된 검색 키워드 2개를 추출하라.\n' +
          '규칙:\n' +
          '- 반드시 한국어\n' +
          '- 실제 네이버/유튜브에서 검색할 법한 구체적인 키워드\n' +
          '- 원래 키워드보다 더 구체적이거나 관련 상품명\n' +
          '- 각 키워드는 2~15자\n' +
          '- 쉼표로 구분해서 키워드만 출력. 다른 텍스트 없이.\n' +
          '예시: 캠핑텐트 → 1인용텐트,백패킹텐트\n' +
          '키워드: ' + seedKw
      }]);

      var text = (((d.choices || [])[0] || {}).message || {}).content || '';
      var relatedKws = text
        .replace(/[^가-힣a-zA-Z0-9,\s]/g, '')
        .split(',')
        .map(function(k) { return k.trim(); })
        .filter(function(k) {
          return k && k !== seedKw && k.length >= 2 && k.length <= 15;
        })
        .slice(0, 2);

      if (relatedKws.length >= 1) {
        var out = [seedKw].concat(relatedKws).slice(0, 3);
        console.log('[extractCandidates] Groq 키워드:', out);
        return out;
      }
    }

    // Groq 실패 시 네이버 자동완성 fallback
    var related = await fetch(
      'https://ac.search.naver.com/nx/ac?q=' + encodeURIComponent(seedKw) +
      '&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100',
      { signal: AbortSignal.timeout(5000) }
    )
    .then(function(r) { return r.json(); })
    .catch(function() { return {}; });

    var relatedKws = [];
    try {
      var items = (related.items || [])[0] || [];
      relatedKws = items
        .map(function(i) { return Array.isArray(i) ? i[0] : i; })
        .filter(function(kw) {
          return kw && kw !== seedKw && kw.length >= 2 && kw.length <= 15;
        })
        .slice(0, 2);
    } catch(e) {}

    var out = [seedKw].concat(relatedKws).slice(0, 3);
    console.log('[extractCandidates] fallback 키워드:', out);
    return out;

  } catch(e) {
    console.warn('[extractCandidates] 오류:', e.message);
    return [seedKw];
  }
}
