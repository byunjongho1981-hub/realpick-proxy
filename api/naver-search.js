export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { query, type } = req.query;
  if (!query) return res.status(400).json({ error: "query required" });

  const validTypes = ["blog", "news", "cafearticle"];
  const searchType = validTypes.includes(type) ? type : "blog";

  const url = `https://openapi.naver.com/v1/search/${searchType}.json?query=${encodeURIComponent(query)}&display=20`;
  const response = await fetch(url, {
    headers: {
      "X-Naver-Client-Id":     process.env.VITE_NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": process.env.VITE_NAVER_CLIENT_SECRET
    }
  });
  const data = await response.json();
  res.status(200).json(data);
}
