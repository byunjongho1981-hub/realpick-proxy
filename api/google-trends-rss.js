// api/google-trends-rss.js
// GET /api/google-trends-rss

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // ── 구글 RSS 직접 수집 시도 ──────────────────────────────
  const RSS_URL = 'https://trends.google.com/trends/trendingsearches/daily/rss?geo=KR';

  // ★ url.parse() 대신 WHATWG URL API 사용 (DEP0169 해결)
  const parsedUrl = new URL(RSS_URL);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000); // 7초 타임아웃

    const response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept'         : 'text/xml, application/xml, application/rss+xml, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Cache-Control'  : 'no-cache'
      }
    });
    clearTimeout(timer);

    // ── 구글이 차단한 경우 (403/429) → fallback ──
    if (!response.ok) {
      console.error('[google-trends-rss] HTTP', response.status);
      return res.status(200).json(fallback(`HTTP_${response.status}`));
    }

    const xml = await response.text();

    // XML이 비어있거나 RSS 형식이 아닌 경우
    if (!xml || !xml.includes('<channel>')) {
      console.error('[google-trends-rss] invalid XML');
      return res.status(200).json(fallback('INVALID_XML'));
    }

    const now = Date.now();

    // 키워드 추출
    const titles = [...xml.matchAll(/<title><!\[CDATA\[(.+?)\]\]><\/title>/g)]
      .map(m => m[1])
      .filter(t => !t.includes('인기 검색어') && !t.includes('Trending'));

    // 트래픽 추출
    const traffic = [...xml.matchAll(/<ht:approx_traffic>(.+?)<\/ht:approx_traffic>/g)]
      .map(m => parseInt(m[1].replace(/[,+]/g, '')) || 0);

    // 발행 시간 추출
    const pubDates = [...xml.matchAll(/<pubDate>(.+?)<\/pubDate>/g)]
      .map(m => { try { return new Date(m[1]).getTime(); } catch { return now; } });

    if (!titles.length) {
      return res.status(200).json(fallback('NO_ITEMS'));
    }

    const trends = titles.map((kw, i) => {
      const hoursAgo  = (now - (pubDates[i] || now)) / 3600000;
      const recency   = Math.max(0, Math.round(100 - hoursAgo * 4.2));
      const growthRate = Math.min(0.5, (traffic[i] || 0) / 3000000);

      return {
        keyword     : kw,
        traffic     : traffic[i] || 0,
        recency,
        growthRate,
        hoursAgo    : Math.round(hoursAgo),
        detectedAt  : pubDates[i] || now
      };
    });

    return res.status(200).json({
      trends,
      collectedAt : now,
      count       : trends.length,
      source      : 'live'   // 실제 수집 성공
    });

  } catch (err) {
    // AbortError = 타임아웃, 그 외 네트워크 에러
    const reason = err.name === 'AbortError' ? 'TIMEOUT' : err.message;
    console.error('[google-trends-rss] fetch error:', reason);

    // ★ 500 대신 200 + fallback 반환 — hot.html 흐름 보호
    return res.status(200).json(fallback(reason));
  }
}

// ── Fallback: 수집 실패 시 빈 배열 반환 (흐름 유지) ──────────
// hot.html의 injectRssSignal()은 빈 배열이면 무시하므로 안전
function fallback(reason) {
  return {
    trends      : [],
    collectedAt : Date.now(),
    count       : 0,
    source      : 'fallback',
    reason      : reason   // Vercel 로그에서 원인 확인용
  };
}
