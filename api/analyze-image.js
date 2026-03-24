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
            { text: `You are a professional product image analyst and e-commerce prompt engineer specializing in ALL product categories.

TASK: Analyze the product image with extreme precision, then generate 6 purchase-motivating scene prompts. The product must remain 100% identical across all scenes.

═══════════════════════════════════
STEP 1 — PRODUCT CATEGORY DETECTION
═══════════════════════════════════
First, identify the product category:
- fashion/clothing → character wears the product
- beauty/cosmetics → character applies or holds the product
- food/beverage → character consumes or prepares with the product
- home appliance/electronics → character uses the product in home/office
- sports/outdoor → character uses the product in activity setting
- furniture/interior → product shown in living space
- baby/kids → parent and child use the product
- pet → pet owner uses the product with pet
- other → infer appropriate usage context

Then extract EVERY visual detail:
PRODUCT_ID (one locked description):
- Exact product type
- Exact color(s) with descriptive names (e.g. "matte black", "rose gold", "ivory white")
- Shape, size, form factor
- Key visible features, textures, materials
- Any text, logo, brand visible
- Accessories or parts included in the image

This PRODUCT_ID must appear VERBATIM in every scene prompt that shows the product.

═══════════════════════════════════
STEP 2 — CHARACTER DEFINITION
═══════════════════════════════════
Based on the product category, define the most appropriate character:
- Fashion/beauty: Korean woman, mid-20s, shoulder-length straight black hair, slim, natural makeup
- Tech/appliance: Korean person, 30s, professional appearance, black hair
- Sports: Korean person, active build, athletic wear, black hair
- Baby: Korean mother, late-20s, warm expression, black hair
- Pet: Korean person, casual style, black hair
- Food: Korean person in casual home setting, black hair
- Default: Korean person, appropriate for product context, black hair

CHARACTER_ID must appear VERBATIM in every scene that includes a person.

═══════════════════════════════════
STEP 3 — SCENE STRUCTURE BY CATEGORY
═══════════════════════════════════
SCENE ROLES (universal — adapt context to the product category):
1. problem: Person experiencing the pain/inconvenience this product solves — NO product shown
2. failure: Person trying an inferior/old solution that doesn't work — NO product shown
3. solution: Product hero shot — PRODUCT_ID clean and prominent, no person needed
4. usage: CHARACTER_ID using/wearing/interacting with PRODUCT_ID naturally
5. result: Clear improvement shown — CHARACTER_ID with PRODUCT_ID, transformation visible
6. lifestyle: CHARACTER_ID thriving in daily life — confidence, satisfaction, ease

PROMPT FORMULA per scene:
[SCENE CONTEXT relevant to product category] + [CHARACTER_ID if person] + [PRODUCT_ID if product] + [STYLE LOCK]

STYLE LOCK (append to EVERY prompt):
"photorealistic, 4K resolution, cinematic soft lighting, Korean aesthetic, realistic human expression, no cartoon, no illustration, no 3D rendering"

CRITICAL RULES:
- Adapt ALL 6 scenes to match the actual product category — NEVER assume it is clothing
- When product appears: copy PRODUCT_ID verbatim
- When person appears: copy CHARACTER_ID verbatim
- NEVER change product color, shape, design between scenes
- NEVER show a different product
- All people: East Asian, Korean appearance, black hair

${productName ? `Product name hint: ${productName}` : ''}

Return ONLY valid JSON, no markdown, no preamble:
{
  "product_category": "",
  "product_id": "",
  "character_id": "",
  "scenes": [
    {"step":1,"role":"problem","short_copy":"","prompt_en":""},
    {"step":2,"role":"failure","short_copy":"","prompt_en":""},
    {"step":3,"role":"solution","short_copy":"","prompt_en":""},
    {"step":4,"role":"usage","short_copy":"","prompt_en":""},
    {"step":5,"role":"result","short_copy":"","prompt_en":""},
    {"step":6,"role":"lifestyle","short_copy":"","prompt_en":""}
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

    // scenes 배열 → prompts 배열 변환
    const SLOT_NAMES = {1:'문제상황',2:'기존한계',3:'제품등장',4:'사용장면',5:'결과변화',6:'라이프스타일'};
    const prompts = (parsed.scenes || []).map(s => ({
      slot: s.step,
      name: SLOT_NAMES[s.step] || `장면${s.step}`,
      prompt: s.prompt_en || '',
      short_copy: s.short_copy || ''
    }));

    return res.status(200).json({ prompts });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
