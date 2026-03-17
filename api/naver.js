export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Naver-Client-Id, X-Naver-Client-Secret, X-Naver-Endpoint");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const endpoint = req.headers["x-naver-endpoint"];
  const clientId = req.headers["x-naver-client-id"];
  const clientSecret = req.headers["x-naver-client-secret"];
  if (!endpoint || !clientId || !clientSecret) {
    return res.status(400).json({ error: "Missing headers" });
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
