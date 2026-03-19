export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY 환경변수 없음" });

  const prompt = req.body?.prompt;
  if (!prompt) return res.status(400).json({ error: "prompt 필드 없음", received: JSON.stringify(req.body) });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
      })
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch { return res.status(500).json({ error: "Gemini 응답 파싱 실패", raw: text.slice(0, 300) }); }

    if (!r.ok || data.error) {
      return res.status(r.status).json({
        error: data.error?.message || "Gemini API 오류",
        code: data.error?.code,
        status: data.error?.status
      });
    }

    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: "fetch 실패: " + e.message });
  }
}
