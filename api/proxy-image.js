export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  var { base64, mimeType } = req.body;
  if (!base64) return res.status(400).json({ error: 'base64 필요' });

  var apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'IMGBB_API_KEY 미설정' });

  try {
    var form = new URLSearchParams();
    form.append('key', apiKey);
    form.append('image', base64);

    var r = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: form
    });
    var data = await r.json();
    if (!data.success) throw new Error(data.error?.message || 'ImgBB 업로드 실패');

    res.json({ url: data.data.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
