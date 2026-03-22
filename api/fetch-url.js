// api/fetch-url.js
// POST /api/fetch-url
// { url } → 사이트 텍스트 추출 → 제품 정보 반환

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    // ── 1. 페이지 HTML 수집 ──────────────────────────────────
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    // ── 2. 텍스트 추출 (HTML 태그 제거) ─────────────────────
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 8000); // Gemini 토큰 절약

    // ── 3. Gemini로 제품 정보 구조화 ──────────────────────────
    const apiKey = process.env.GEMINI_API_KEY;
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey;

    const prompt = `아래 웹페이지 텍스트에서 제품 정보를 추출하라.
반드시 JSON만 출력. 다른 텍스트 금지.

웹페이지 URL: ${url}
웹페이지 내용:
${text}

출력 형식:
{
  "productName": "제품명",
  "price": 숫자 (원화, 없으면 0),
  "category": "카테고리",
  "features": ["핵심 특징 1", "핵심 특징 2", "핵심 특징 3"],
  "specs": ["스펙 1", "스펙 2"],
  "pros": ["장점 1", "장점 2"],
  "cons": ["단점 1", "단점 2"],
  "targetUser": "주요 타겟 사용자",
  "reviewSummary": "후기 요약 (있는 경우)",
  "priceGrade": "A or B or C or D",
  "platform": "쿠팡 or 네이버 or 11번가 or 기타",
  "originalUrl": "${url}"
}`;

    const geminiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1000, temperature: 0.3 }
      })
    });

    const geminiData = await geminiRes.json();
    if (geminiData.error) throw new Error(geminiData.error.message);

    const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    const productInfo = JSON.parse(clean);

    return res.status(200).json({ success: true, product: productInfo });

  } catch (err) {
    console.error('[fetch-url]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
