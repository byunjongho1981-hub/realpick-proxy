// api/naver-shopping.js
// 엔드포인트: GET /api/naver-shopping?keyword=피규어
// 네이버 쇼핑인사이트 수요 지수 + 증가율 반환

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword required' });

  const endDate = new Date();
  const startDate = new Date(Date.now() - 7 * 24 * 3600000);
  const fmt = d => d.toISOString().slice(0, 10);

  try {
    const body = {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      timeUnit: 'date',
      keyword: [{ name: keyword, param: [keyword] }],
      device: '',
      ages: [],
      gender: ''
    };

    const response = await fetch(
      'https://openapi.naver.com/v1/datalab/shopping/keywords',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
          'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
        },
        body: JSON.stringify(body)
      }
    );

    const data = await response.json();
    const results = data.results?.[0]?.data || [];

    // 최근 2일 평균 vs 이전 5일 평균으로 증가율 계산
    const recent2 = results.slice(-2).map(d => d.ratio);
    const prev5   = results.slice(0, 5).map(d => d.ratio);
    const avgRecent = recent2.reduce((a, b) => a + b, 0) / (recent2.length || 1);
    const avgPrev   = prev5.reduce((a, b) => a + b, 0) / (prev5.length || 1) || 1;
    const growthRate = (avgRecent - avgPrev) / avgPrev;
    const demandScore = Math.round(Math.max(...results.map(d => d.ratio), 0));

    res.status(200).json({ keyword, demandScore, growthRate, raw: results });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
