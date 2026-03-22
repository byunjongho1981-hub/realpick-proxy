// api/analyze-product.js
// 엔드포인트: POST /api/analyze-product
// body: { products: [...] }
// Claude AI가 점수 계산된 제품 배열을 받아 TOP 3 추천 반환

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { products } = req.body;
  if (!products || !products.length) return res.status(400).json({ error: 'products required' });

  const prompt = `당신은 쿠팡 파트너스 제휴 마케터 전문 AI입니다.
아래 제품 데이터를 분석하여 지금 당장 콘텐츠를 만들면 수익이 날 TOP 3를 선별하세요.

판단 기준:
1. RSS 신호 강도 높고 경쟁 낮은 제품 우선
2. 24~72시간 내 수요 급증 예상 제품
3. 유튜브 쇼츠/블로그 콘텐츠 제작 가능성

제품 데이터:
${JSON.stringify(products, null, 2)}

반드시 JSON만 출력. 다른 텍스트 절대 금지:
{
  "top3": [
    {
      "rank": 1,
      "keyword": "제품명",
      "reason": "추천 이유 2줄 이내",
      "contentAngle": "콘텐츠 각도 제안 1줄",
      "urgency": "high|medium|low",
      "estimatedWindow": "몇 시간 내 진입 권장"
    }
  ]
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();

    res.status(200).json(JSON.parse(clean));

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
