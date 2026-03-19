export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 허용" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY 없음" });

  let prompt = "";
  try {
    if (typeof req.body === "string") {
      prompt = JSON.parse(req.body)?.prompt || "";
    } else {
      prompt = req.body?.prompt || "";
    }
  } catch {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf-8");
      prompt = JSON.parse(raw)?.prompt || "";
    } catch (e) {
      return res.status(400).json({ error: "body 파싱 실패: " + e.message });
    }
  }

  if (!prompt) return res.status(400).json({ error: "prompt 없음" });

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;
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
    catch { return res.status(500).json({ error: "응답 파싱 실패", raw: text.slice(0, 200) }); }

    if (!r.ok || data.error) {
      return res.status(r.status || 400).json({
        error: data.error?.message || "Gemini 오류",
        code: data.error?.code,
        status: data.error?.status
      });
    }

    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: "fetch 실패: " + e.message });
  }
}
