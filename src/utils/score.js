export const calcTrend = v => {
  const views    = Math.max(0, parseInt(v.viewCount)  || 0);
  const likes    = Math.max(0, parseInt(v.likeCount)  || 0);
  const comments = Math.max(0, parseInt(v.commentCount) || 0);
  const published = v.publishedAt ? new Date(v.publishedAt).getTime() : null;
  const elapsedMs = published ? Date.now() - published : 0;
  const days      = elapsedMs > 0 ? Math.max(0.01, elapsedMs / 86400000) : 1;
  const logBase   = Math.log10(50000000);
  const vScore    = logBase > 0 ? Math.min(100, Math.log10(views + 1) / logBase * 100) : 0;
  const lRate     = views > 0 ? Math.min(100, (likes    / views) * 2000) : 0;
  const cRate     = views > 0 ? Math.min(100, (comments / views) * 5000) : 0;
  const fresh     = Math.max(0, 100 - (days / 30) * 40);
  const score     = vScore * 0.5 + lRate * 0.2 + cRate * 0.1 + fresh * 0.2;
  return isNaN(score) ? 0 : Math.round(Math.min(100, Math.max(0, score)));
};

export const scoreColor = s => s >= 80 ? "#ff2222" : s >= 60 ? "#ff8800" : s >= 40 ? "#ffcc00" : "#4488ff";
export const scoreBg    = s => s >= 80 ? "rgba(255,34,34,0.12)" : s >= 60 ? "rgba(255,136,0,0.12)" : s >= 40 ? "rgba(255,204,0,0.10)" : "rgba(68,136,255,0.10)";
export const scoreLabel = s => s >= 80 ? "🔥 급상승" : s >= 60 ? "📈 인기" : s >= 40 ? "📊 보통" : "💤 낮음";
