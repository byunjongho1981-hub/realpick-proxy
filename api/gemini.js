import { buffer } from "node:stream/consumers";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY 없음" });

  // Vercel 서버리스에서 body를 raw stream으로 읽기
  let prompt = "";
  try {
    const raw = await buffer(req);
    const body = JSON.parse(raw.toString("utf-8"));
    prompt = body?.prompt || "";
  } catch (e) {
    return res.status(400).json({ error: "body 파싱 실패: " + e.message });
  }

  if (!prompt) return res.status(400).json({ error: "prompt 없음" });

  try {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=" + apiKey;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
      })
    });
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message, code: data.error.code });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
