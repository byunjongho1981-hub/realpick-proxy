export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // 환경변수 확인
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY 환경변수 없음" });
  }

  // body 파싱
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) {
      return res.status(400).json({ error: "body 파싱 실패: " + e.message });
    }
  }

  const prompt = body?.prompt;
  if (!prompt) {
    return res.status(400).json({ error: "prompt 필드 없음" });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
      })
    });

    const text = await response.text();

    // 응답이 JSON인지 확인
    let data;
    try { data = JSON.parse(text); }
    catch { return res.status(500).json({ error: "Gemini 응답 파싱 실패", raw: text.slice(0, 200) }); }

    if (data.error) {
      return res.status(400).json({ error: data.error.message, details: data.error });
    }

    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
