module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mediaType, productName, charBase64, charMediaType } = req.body || {};
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
            { text: `You are a shopping conversion image planning expert and AI prompt design specialist.
${productName ? `Product name: ${productName}\n` : ''}
Analyze the provided product image and design 6 purchase-motivating scenes following the EXACT structure below.

[PRODUCT CONSISTENCY — TOP PRIORITY]
- ALL 6 scenes must feature the EXACT SAME product as shown in the input image
- Do NOT change the product's shape, structure, color, proportion, or design in any scene
- Do NOT reinterpret, redesign, or substitute with a similar product
- Do NOT generate a different brand, model, or variant
- The product must remain the IDENTICAL object across all scenes

[WHAT YOU CAN CHANGE PER SCENE]
- Camera angle (front, side, close-up)
- Lighting and atmosphere
- Background and environment
- People, hands, and situational context

[STRICTLY FORBIDDEN]
- Changing product color
- Altering product structure or shape
- Making the product look like it has different functionality
- Compositing a different product
- Cartoon, 3D exaggeration, or heavy stylization

[PROMPT RULE — PRODUCT LOCK]
Every prompt_en that includes the product MUST contain:
"same product as input image, identical design, identical color, no modification, no substitution"

The most important goal is NOT variety of scenes — it is PRODUCT IDENTITY CONSISTENCY.
If the product changes between scenes, the entire task is considered a failure.


1. problem — Show the discomfort/pain when NOT having this product. Human emotion must be visible.
2. failure — Show someone trying the old/existing method and struggling. Frustration, inefficiency, wasted time.
3. solution — Product appears as THE answer. Clean, trustworthy, premium. Must feel like a revelation, not just a product shot.
4. usage — Actual usage scene. Hands, posture, flow must be intuitive. Keep it simple and natural.
5. result — Clear before/after improvement. Realistic, not exaggerated. Show the actual change.
6. lifestyle — Life after the problem is solved. Satisfaction, comfort, confidence, ease. Focus on the transformed state, not the product.

PROMPT RULES:
- prompt_en must be in English
- Base style: photorealistic, premium, realistic human expression, 4K, cinematic lighting
- All 6 scenes must share consistent color tone, lighting, and mood
- At least 3 scenes must include a person or hands
- All human figures must be East Asian (Korean appearance): natural skin tone, black hair, realistic Korean facial features
- Avoid Western or ambiguous ethnicity in any person or hands shown
- Focus on real-life environments
- Never repeat the same product-only shot
- Each scene must serve a clearly different role

Return ONLY valid JSON, no markdown, no preamble:
{
  "product_analysis": {
    "category": "",
    "use_case": "",
    "pain_point": "",
    "desired_outcome": "",
    "visual_style": "photorealistic, premium, cohesive"
  },
  "scenes": [
    {"step":1,"role":"problem","short_copy":"","visual_focus":"","prompt_en":"","negative_notes":""},
    {"step":2,"role":"failure","short_copy":"","visual_focus":"","prompt_en":"","negative_notes":""},
    {"step":3,"role":"solution","short_copy":"","visual_focus":"","prompt_en":"","negative_notes":""},
    {"step":4,"role":"usage","short_copy":"","visual_focus":"","prompt_en":"","negative_notes":""},
    {"step":5,"role":"result","short_copy":"","visual_focus":"","prompt_en":"","negative_notes":""},
    {"step":6,"role":"lifestyle","short_copy":"","visual_focus":"","prompt_en":"","negative_notes":""}
  ]
}` }
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
    return res.status(200).json({ prompts: parsed.prompts });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
