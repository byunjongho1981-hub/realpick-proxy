// api/google-trends.js — Google Trends RSS 프록시
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const response = await fetch(
      "https://trends.google.com/trends/trendingsearches/daily/rss?geo=KR",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/rss+xml, application/xml, text/xml, */*",
        }
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: "Trends fetch failed" });
    }

    const xml = await response.text();

    // XML 파싱 — title 태그에서 키워드 추출
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];

      // 키워드
      const titleMatch = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                         block.match(/<title>(.*?)<\/title>/);
      const title = titleMatch?.[1]?.trim() || "";

      // 트래픽 (approximate_traffic)
      const trafficMatch = block.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/);
      const traffic = trafficMatch?.[1]?.replace(/[^0-9]/g, "") || "0";

      // 뉴스 제목들
      const newsTitles = [];
      const newsRegex = /<ht:news_item_title><!\[CDATA\[(.*?)\]\]><\/ht:news_item_title>/g;
      let newsMatch;
      while ((newsMatch = newsRegex.exec(block)) !== null) {
        newsTitles.push(newsMatch[1]);
      }

      if (title) {
        items.push({ title, traffic: parseInt(traffic)||0, newsTitles });
      }
    }

    return res.status(200).json({ items, updatedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
