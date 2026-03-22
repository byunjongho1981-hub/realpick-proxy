// api/blog-generate.js
// POST /api/blog-generate
// blog.html → 이 함수 → Anthropic API

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { system, user, max_tokens } = req.body;
  if (!user) return res.status(400).json({ error: 'user prompt required' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 4000,
        system: system || '',
        messages: [{ role: 'user', content: user }]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const text = data.content
      ? data.content.map(c => c.text || '').join('')
      : '';

    return res.status(200).json({ text });

  } catch (err) {
    console.error('[blog-generate]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
