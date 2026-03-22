// api/youtube-competition.js
// 엔드포인트: GET /api/youtube-competition?keyword=피규어
// 유튜브 경쟁 영상 수 + 최근 30일 신규 영상 수 반환

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword required' });

  try {
    const url =
      `https://www.googleapis.com/youtube/v3/search` +
      `?part=snippet` +
      `&q=${encodeURIComponent(keyword)}` +
      `&type=video` +
      `&order=viewCount` +
      `&maxResults=10` +
      `&regionCode=KR` +
      `&key=${process.env.YOUTUBE_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.error) throw new Error(data.error.message);

    const totalResults = data.pageInfo?.totalResults || 0;
    const items = data.items || [];

    // 최근 30일 이내 업로드된 영상 수
    const recentVideoCount = items.filter(v => {
      const pub = new Date(v.snippet.publishedAt);
      return (Date.now() - pub.getTime()) < 30 * 24 * 3600000;
    }).length;

    // 경쟁 지수: 총 영상 수 기반 0~100
    const competitionScore = Math.min(100, Math.round(totalResults / 100));

    res.status(200).json({
      keyword,
      totalResults,
      recentVideoCount,
      competitionScore
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
