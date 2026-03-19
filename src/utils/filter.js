export const filterVideos = (videos) => {
  const now = Date.now();
  const seenIds    = new Set();
  const seenTitles = new Set();

  return videos.filter(v => {
    if (!v.viewCount || parseInt(v.viewCount) === 0)          return false;
    if (!v.publishedAt)                                        return false;
    if (now - new Date(v.publishedAt) > 7 * 24 * 60 * 60 * 1000) return false;
    if (seenIds.has(v.id))                                     return false;
    const t = v.title?.trim().toLowerCase() || "";
    if (seenTitles.has(t))                                     return false;
    seenIds.add(v.id);
    seenTitles.add(t);
    return true;
  });
};
