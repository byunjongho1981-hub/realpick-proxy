// api/proxy-image.js
// POST /api/proxy-image  { url }
// 서버가 이미지 URL을 대신 fetch → base64 반환 (CORS 우회)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
    'facebookexternalhit/1.1',
    'Googlebot-Image/1.0'
  ];

  for (const ua of agents) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': ua,
          'Referer': 'https://shopping.naver.com',
          'Accept': 'image/webp,image/apng,image/*'
        },
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) continue;

      const contentType = r.headers.get('content-type') || 'image/jpeg';
      const mimeType = contentType.split(';')[0].trim();
      if (!mimeType.startsWith('image/')) continue;

      const buf = await r.arrayBuffer();
      const base64 = Buffer.from(buf).toString('base64');
      console.log('[proxy-image] ok, mime:', mimeType, 'size:', base64.length);
      return res.status(200).json({ base64, mimeType });
    } catch(e) {
      console.warn('[proxy-image] attempt failed:', e.message);
      continue;
    }
  }

  return res.status(500).json({ error: '이미지 변환 실패' });
}
