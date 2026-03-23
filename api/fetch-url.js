// ── Gemini 보강 ───────────────────────────────────────────────
async function enrichWithGemini(raw) {
  const savedImageUrl = raw.imageUrl || '';
  const apiKey   = process.env.GEMINI_API_KEY;
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + apiKey;

  if (!raw.productName) {
    console.warn('[enrichWithGemini] 제품명 없음 — fallback 처리');
    return { ...raw, priceGrade: calcGrade(raw.price), features: [], pros: [], cons: [] };
  }

  const prompt = `아래 제품 원본 정보를 분석하여 블로그 작성용 구조화 데이터를 추출하라.
JSON만 출력. 다른 텍스트 절대 금지. 마크다운 코드블록 금지.

입력:
${JSON.stringify(raw, null, 2)}

출력 형식:
{"productName":"정확한 제품명","price":숫자,"category":"카테고리","priceGrade":"A or B or C or D","features":["특징1","특징2","특징3"],"pros":["장점1","장점2","장점3"],"cons":["단점1","단점2"],"targetUser":"타겟 사용자 1문장","hookScene":"구매 검색하게 된 불편 장면 1~2문장","reviewSummary":"후기 요약","platform":"${raw.platform || '기타'}","originalUrl":"${raw.originalUrl || ''}","imageUrl":"${raw.imageUrl || ''}"}`;

  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2000, temperature: 0.3 } // ★ 1000 → 2000
      }),
      signal: AbortSignal.timeout(15000)
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);

    const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) throw new Error('Gemini 응답 비어있음');

    const clean = text.replace(/```json|```/g, '').trim();

    // ★ JSON 잘린 경우 닫는 중괄호 보정 후 파싱 시도
    const startIdx = clean.indexOf('{');
    if (startIdx === -1) throw new Error('JSON 블록 없음: ' + clean.slice(0, 100));

    let jsonStr = clean.slice(startIdx);
    // 잘린 JSON 보정: 열린 { 개수만큼 } 추가
    const openCount  = (jsonStr.match(/\{/g) || []).length;
    const closeCount = (jsonStr.match(/\}/g) || []).length;
    if (openCount > closeCount) {
      jsonStr += '}'.repeat(openCount - closeCount);
    }

    const result = JSON.parse(jsonStr);
    result.imageUrl = savedImageUrl;
    return result;

  } catch(e) {
    console.error('[enrichWithGemini]', e.message);
    return {
      ...raw,
      priceGrade    : calcGrade(raw.price),
      features      : [],
      pros          : [],
      cons          : [],
      targetUser    : '',
      hookScene     : '',
      reviewSummary : ''
    };
  }
}
