export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // body 파싱 처리
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {}
    }

    const prompt = body?.prompt;
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
      })
    });
    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
```

Commit 후 브라우저에서 직접 확인:
```
https://본인사이트.vercel.app/api/gemini
