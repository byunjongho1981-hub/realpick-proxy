module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{
          text: prompt + '\n\nCRITICAL: Generate EXACTLY as described. Do NOT change any colors, styles, or designs mentioned. All people must be East Asian Korean appearance with black hair. Photorealistic, 4K, cinematic lighting only.'
        }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const data = await response.json();
    console.log('generate-image status:', response.status);

    if (!response.ok) {
      const errMsg = data?.error?.message || JSON.stringify(data);
      return res.status(response.status).json({ error: errMsg });
    }

    const parts = data.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (!imgPart) {
      return res.status(500).json({ error: '이미지 파트 없음', parts: JSON.stringify(parts).slice(0,200) });
    }

    return res.status(200).json({
      base64: imgPart.inlineData.data,
      mimeType: imgPart.inlineData.mimeType
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
