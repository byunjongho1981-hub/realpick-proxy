export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { base64, mimeType } = req.body;

  if (!base64) {
    return res.status(400).json({ error: 'base64 데이터가 없습니다' });
  }

  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'IMGBB_API_KEY 환경변수 없음' });
  }

  try {
    // ImgBB는 multipart/form-data 방식
    const form = new URLSearchParams();
    form.append('key', apiKey);
    form.append('image', base64); // 순수 base64 (data:... 헤더 제거된 것)

    const response = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });

    const data = await response.json();

    if (!data.success) {
      console.error('ImgBB 오류:', data);
      return res.status(500).json({ error: 'ImgBB 업로드 실패', detail: data });
    }

    // display_url: 직접 표시용 URL (네이버 블로그 붙여넣기에 적합)
    return res.status(200).json({ url: data.data.display_url });

  } catch (e) {
    console.error('proxy-image 오류:', e);
    return res.status(500).json({ error: e.message });
  }
}
