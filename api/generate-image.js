module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, productImg, productMime, charImg, charMime } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`;

  // ── 파트 구성: 텍스트 + 제품 이미지 + 캐릭터 이미지(선택)
  const parts = [];

  // 1. 제품 참조 이미지
  if (productImg) {
    parts.push({ inline_data: { mime_type: productMime || 'image/jpeg', data: productImg } });
  }

  // 2. 캐릭터 참조 이미지
  if (charImg) {
    parts.push({ inline_data: { mime_type: charMime || 'image/jpeg', data: charImg } });
  }

  // 3. 생성 지시 텍스트
  const systemInstruction = [
    productImg ? 'Reference image 1 = PRODUCT. Maintain IDENTICAL product design, color, shape in generated image.' : '',
    charImg    ? 'Reference image 2 = CHARACTER. Maintain IDENTICAL character appearance, face, style in generated image.' : '',
    'All human figures must be East Asian (Korean appearance), black hair, realistic.',
    'Style: photorealistic, premium, 4K, cinematic lighting.',
    'No cartoon, no 3D exaggeration, no heavy stylization.',
  ].filter(Boolean).join('\n');

  parts.push({
    text: `${systemInstruction}\n\nGenerate image: ${prompt}`
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      })
    });

    const data = await response.json();
    console.log('generate-image status:', response.status);

    if (!response.ok) {
      const errMsg = data?.error?.message || JSON.stringify(data);
      return res.status(response.status).json({ error: errMsg });
    }

    // 이미지 파트 추출
    const resParts = data.candidates?.[0]?.content?.parts || [];
    const imgPart = resParts.find(p => p.inlineData?.mimeType?.startsWith('image/'));

    if (!imgPart) {
      const textPart = resParts.find(p => p.text)?.text || '';
      return res.status(500).json({ error: '이미지 파트 없음', text: textPart.slice(0, 200) });
    }

    return res.status(200).json({
      base64:   imgPart.inlineData.data,
      mimeType: imgPart.inlineData.mimeType
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
