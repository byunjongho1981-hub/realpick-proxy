// api/analyze-scenes.js
// POST /api/analyze-scenes { prompt }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  // 텍스트 전용 모델 사용 (이미지 생성 모델 아님 — 빠르고 저렴)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 2000,
          temperature: 0.4
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const data = await response.json();

    if (!response.ok) {
      const errMsg = data?.error?.message || JSON.stringify(data);
      return res.status(response.status).json({ error: errMsg });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return res.status(500).json({ error: 'Gemini 응답 비어있음' });

    // JSON 블록 추출
    const clean    = text.replace(/```json|```/g, '').trim();
    const startIdx = clean.indexOf('{');
    const endIdx   = clean.lastIndexOf('}');
    if (startIdx === -1 || endIdx === -1) {
      return res.status(500).json({ error: 'JSON 파싱 실패', raw: clean.slice(0, 200) });
    }

    const jsonStr = clean.slice(startIdx, endIdx + 1);
    const parsed  = JSON.parse(jsonStr);

    return res.status(200).json({ text: JSON.stringify(parsed) });

  } catch(e) {
    return res.status(500).json({ error: e.name === 'AbortError' ? '시간 초과 (20초)' : e.message });
  }
};
