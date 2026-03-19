// api/discover.js  →  POST https://your-app.vercel.app/api/discover
// Vercel Serverless Function (Edge Runtime 제외, Node.js 18+)

import runPipeline from '../src/index.js';

export const config = { maxDuration: 60 }; // Vercel Pro: 최대 300초

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const { seeds } = req.body ?? {};
    const result = await runPipeline(seeds);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[API ERROR]', err);
    return res.status(500).json({ error: err.message });
  }
}
