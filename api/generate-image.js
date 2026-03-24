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
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt + '\n\nIMPORTANT: Only depict elements that are explicitly described in the prompt. Do NOT add, invent, or imagine any extra components, accessories, or features not mentioned. All human figures must be East Asian (Korean appearance): natural skin tone, black hair, realistic Korean facial features. No Western or ambiguous ethnicity.' }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE']
        }
      })
    });

    const data = await response.json();
    console.log('Gemini image status:', response.status);
    console.log('Gemini image response:', JSON.stringify(data).slice(0, 300));

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
