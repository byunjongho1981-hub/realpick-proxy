const CHARACTER_DNA = `FIXED CHARACTER (must appear identical in every image):
- Korean woman, age 28-32, slim athletic build
- Face: soft oval face, natural double eyelids, slightly high cheekbones, small lips with natural lip color
- Hair: straight black hair, shoulder-length, pulled back loosely with a few strands falling on forehead
- Skin: fair porcelain skin, light natural makeup only
- Always the SAME woman across all scenes. Do NOT change her face, hair, or body type.`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, imageBase64, imageMimeType } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`;

  // CHARACTER_DNA 중복 주입 방지
  const alreadyHasDNA = prompt.includes('FIXED CHARACTER');
  const fullPrompt = alreadyHasDNA
    ? prompt
    : `${CHARACTER_DNA}\n\nSCENE DESCRIPTION:\n${prompt}\n\nCRITICAL RULES:\n- The woman described above MUST be the main subject\n- Do NOT generate any male characters as the protagonist\n- Photorealistic, 4K, cinematic lighting\n- All background people are East Asian Korean appearance\n- NO TEXT, NO LETTERS, NO CAPTIONS, NO SUBTITLES, NO WATERMARKS anywhere in the image\n- Pure visual scene only, absolutely no written characters of any language`;

  // parts 구성 — 제품 원본 이미지 있으면 첫 번째 파트로 추가
  const parts = [];
  if (imageBase64 && imageMimeType) {
    parts.push({ inlineData: { mimeType: imageMimeType, data: imageBase64 } });
    parts.push({ text: 'PRODUCT REFERENCE IMAGE ABOVE: Reproduce this product\'s exact color, shape, branding, and design faithfully in every scene. Do NOT alter the product.\n\n' + fullPrompt });
  } else {
    parts.push({ text: fullPrompt });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await response.json();
    console.log('generate-image status:', response.status);
    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || JSON.stringify(data) });
    }
    const responseParts = data.candidates?.[0]?.content?.parts || [];
    const imgPart = responseParts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
    if (!imgPart) {
      return res.status(500).json({ error: '이미지 파트 없음', parts: JSON.stringify(responseParts).slice(0,200) });
    }
    return res.status(200).json({ base64: imgPart.inlineData.data, mimeType: imgPart.inlineData.mimeType });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
