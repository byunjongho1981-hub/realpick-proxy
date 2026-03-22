// api/blog-generate.js
// POST /api/blog-generate
// blog.html → 이 함수 → Gemini 2.0 Flash

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' });

  const { system, user, max_tokens } = req.body;
  if (!user) return res.status(400).json({ error: 'user prompt required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  const endpoint =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=' + apiKey;

  // system + user 합산 (Gemini는 system instruction 별도 지원)
  const body = {
    system_instruction: system
      ? { parts: [{ text: system }] }
      : undefined,
    contents: [
      { role: 'user', parts: [{ text: user }] }
    ],
    generationConfig: {
      maxOutputTokens: max_tokens || 4000,
      temperature: 0.7
    }
  };

  // undefined 키 제거
  if (!body.system_instruction) delete body.system_instruction;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      const msg = data.error?.message || JSON.stringify(data);
      console.error('[blog-generate] Gemini error:', msg);
      return res.status(response.status).json({ error: msg });
    }

    // 응답 텍스트 추출
    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return res.status(200).json({ text });

  } catch (err) {
    console.error('[blog-generate]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
