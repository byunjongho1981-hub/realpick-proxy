// ─── CHARACTER DNA (모든 씬에 강제 주입) ───────────────────────────────────
const CHARACTER_DNA = `
FIXED CHARACTER (must appear identical in every image):
- Korean woman, age 28–32, slim athletic build
- Face: soft oval face, natural double eyelids, slightly high cheekbones, small lips with natural lip color
- Hair: straight black hair, shoulder-length, pulled back loosely with a few strands falling on forehead
- Skin: fair porcelain skin, no heavy makeup — light natural makeup only
- Always the SAME woman across all scenes. Do NOT change her face, hair, or body type.
`.trim();

// ────────────────────────────────────────────────────────────────────────────

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

  // 캐릭터 DNA + 원본 프롬프트 결합
  const fullPrompt = `${CHARACTER_DNA}\n\nSCENE DESCRIPTION:\n${prompt}\n\nCRITICAL RULES:\n- The woman described above MUST be the main subject\n- Do NOT generate any male characters as the protagonist\n- Do NOT alter her appearance from the DNA above\n- Photorealistic, 4K, cinematic lighting\n- All people in background are East Asian Korean appearance`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
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
      return res.status(500).json({ error: '이미지 파트 없음', parts: JSON.stringify(parts).slice(0, 200) });
    }

    return res.status(200).json({
      base64: imgPart.inlineData.data,
      mimeType: imgPart.inlineData.mimeType
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
