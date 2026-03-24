export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mediaType } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: `You are a product image prompt engineer for Korean e-commerce blogs.
Analyze this product image and generate 6 English image generation prompts — one per slot.
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

Rules per slot:
1. 대표이미지: product on pure white background, studio lighting, 4K sharp, commercial photography
2. 핵심구조: technical exploded-view or annotated diagram showing key features, clean infographic style
3. 활용장면: Korean lifestyle scene with person using the product naturally, bright natural light
4. 세부디테일: extreme close-up macro shot of material texture and craftsmanship, shallow DOF
5. 구성품: overhead flat-lay of product and all accessories on light background, minimal style
6. CTA직접: bold promotional banner, product featured prominently, Korean text overlay space, vibrant colors

Make each prompt specific to this exact product.` }
        ]
      }]
    })
  });

  const data = await response.json();
  if (!response.ok) return res.status(response.status).json({ error: data });

  const raw = data.content.find(b => b.type === 'text')?.text || '';
  const clean = raw.replace(/```json|```/g, '').trim();
  try {
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);
  } catch {
    return res.status(500).json({ error: 'JSON parse failed', raw });
  }
}
