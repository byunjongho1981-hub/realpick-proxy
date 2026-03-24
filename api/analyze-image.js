module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mediaType, productName } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mediaType || 'image/jpeg', data: imageBase64 } },
            { text: `You are a product image prompt engineer for Korean e-commerce blogs.
${productName ? `Product name: ${productName}\n` : ''}Analyze this product image and generate 6 English image generation prompts — one per slot.
Return ONLY valid JSON, no markdown, no preamble.
Format:
{"prompts":[
  {"slot":1,"name":"대표이미지","prompt":"..."},
  {"slot":2,"name":"핵심구조","prompt":"..."},
  {"slot":3,"name":"활용장면","prompt":"..."},
  {"slot":4,"name":"세부디테일","prompt":"..."},
  {"slot":5,"name":"구성품","prompt":"..."},
  {"slot":6,"name":"CTA직접","prompt":"..."}
]}
Rules:
1. 대표이미지: product on pure white background, studio lighting, 4K sharp, commercial photography
2. 핵심구조: technical exploded-view diagram with labeled key features, clean infographic style
3. 활용장면: Korean lifestyle scene with person using the product naturally, bright natural light
4. 세부디테일: extreme close-up macro shot of material texture and craftsmanship, shallow DOF
5. 구성품: overhead flat-lay of product and all accessories on light background, minimal style
6. CTA직접: bold promotional banner, product featured prominently, vibrant colors, call-to-action
Make each prompt specific to this exact product.` }
          ]
        }]
      })
    });

    const data = await response.json();
    console.log('Gemini status:', response.status);

    if (!response.ok) {
      const errMsg = data?.error?.message || data?.error?.status || JSON.stringify(data);
      return res.status(response.status).json({ error: errMsg });
    }

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
