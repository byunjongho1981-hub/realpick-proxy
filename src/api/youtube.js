import { calcTrend } from "../utils/score.js";
import { filterVideos } from "../utils/filter.js";

const CACHE_TTL = 5 * 60 * 1000;
const cache     = new Map();
const getCache  = k => {
  const h = cache.get(k);
  if (!h) return null;
  if (Date.now() - h.ts > CACHE_TTL) { cache.delete(k); return null; }
  return h.data;
};
const setCache = (k, d) => cache.set(k, { ts: Date.now(), data: d });

export const fetchYouTube = async (keyword, apiKey) => {
  const ck     = `yt:${keyword.trim().toLowerCase()}`;
  const cached = getCache(ck);
  if (cached) return { videos: cached, fromCache: true };

  const sr = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=id&q=${encodeURIComponent(keyword)}&type=video&maxResults=20&order=relevance&regionCode=KR&relevanceLanguage=ko&key=${apiKey}`
  );
  if (!sr.ok) throw new Error(`HTTP ${sr.status}`);

  const sd = await sr.json();
  if (sd.error) {
    const c = sd.error.code;
    if (c === 403) throw new Error("API 키 권한 없음 또는 할당량 초과 (403)");
    if (c === 400) throw new Error("잘못된 API 키 또는 요청 (400)");
    throw new Error(sd.error.message || `API 오류 (${c})`);
  }

  const items = sd.items || [];
  if (!items.length) return { videos: [], fromCache: false };

  const ids = items.map(i => i.id.videoId).join(",");
  const vr  = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&fields=items(id,snippet(title,channelTitle,publishedAt,thumbnails/medium),statistics)&id=${ids}&key=${apiKey}`
  );
  if (!vr.ok) throw new Error(`통계 요청 실패 HTTP ${vr.status}`);

  const vd = await vr.json();
  if (vd.error) throw new Error(vd.error.message || "통계 API 오류");

  const map = {};
  (vd.items || []).forEach(v => { map[v.id] = v; });

  const merged = items.map(item => {
    const vid   = map[item.id.videoId] || {};
    const stats = vid.statistics || {};
    const snip  = vid.snippet    || {};
    const obj   = {
      id: item.id.videoId,
      title: snip.title,
      channel: snip.channelTitle,
      publishedAt: snip.publishedAt,
      thumbnail: snip.thumbnails?.medium?.url,
      viewCount: stats.viewCount,
      likeCount: stats.likeCount,
      commentCount: stats.commentCount,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`
    };
    obj.trendScore = calcTrend(obj);
    return obj;
  });

  const filtered = filterVideos(merged);
  setCache(ck, filtered);
  return { videos: filtered, fromCache: false };
};
