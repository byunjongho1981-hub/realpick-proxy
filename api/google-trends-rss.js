// api/google-trends-rss.js
// 엔드포인트: GET /api/google-trends-rss
// 구글 트렌드 RSS → 키워드 + 최신성 + 증가율 반환

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const response = await fetch(
      'https://trends.google.com/trends/trendingsearches/daily/rss?geo=KR',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
          'Accept': 'application/rss+xml, application/xml, text/xml',
          'Accept-Language': 'ko-KR,ko;q=0.9'
        }
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const xml = await response.text();
    const now = Date.now();

    // 키워드 추출
    const titles = [...xml.matchAll(/<title><!\[CDATA\[(.+?)\]\]><\/title>/g)]
      .map(m => m[1])
      .filter(t => !t.includes('인기 검색어'));

    // 트래픽 추출
    const traffic = [...xml.matchAll(/<ht:approx_traffic>(.+?)<\/ht:approx_traffic>/g)]
      .map(m => parseInt(m[1].replace(/[,+]/g, '')) || 0);

    // 발행 시간 추출
    const pubDates = [...xml.matchAll(/<pubDate>(.+?)<\/pubDate>/g)]
      .map(m => new Date(m[1]).getTime());

    // 관련 뉴스 제목 (키워드당 첫 번째)
    const newsItems = [...xml.matchAll(/<ht:news_item_title><!\[CDATA\[(.+?)\]\]><\/ht:news_item_title>/g)]
      .map(m => m[1]);

    const trends = titles.map((kw, i) => {
      const hoursAgo = (now - (pubDates[i] || now)) / 3600000;
      // 최신성: 1시간 이내 100점 → 24시간 지나면 0점
      const recency = Math.max(0, Math.round(100 - (hoursAgo * 4.2)));
      // 트래픽 기반 증가율 추정
      const growthRate = Math.min(0.5, (traffic[i] || 0) / 3000000);

      return {
        keyword: kw,
        traffic: traffic[i] || 0,
        recency,
        growthRate,
        hoursAgo: Math.round(hoursAgo),
        newsHint: newsItems[i * 3] || '',
        detectedAt: pubDates[i] || now
      };
    });

    res.status(200).json({ trends, collectedAt: now, count: trends.length });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
