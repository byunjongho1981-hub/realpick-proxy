export const filterVideos = (videos) => {
  const now = Date.now();
  const seenIds    = new Set();
  const seenTitles = new Set();

  return videos.filter(v => {
    if (!v.viewCount || parseInt(v.viewCount) === 0)          return false;
    if (!v.publishedAt)                                        return false;
    if (now - new Date(v.publishedAt) > 48 * 60 * 60 * 1000) return false;
    if (seenIds.has(v.id))                                     return false;
    const t = v.title?.trim().toLowerCase() || "";
    if (seenTitles.has(t))                                     return false;
    seenIds.add(v.id);
    seenTitles.add(t);
    return true;
  });
};

export const filterProducts = (products, { priceMin, priceMax, minReviews, excludeAds }) => {
  return products.filter(p => {
    const price   = parseInt(p.price)       || 0;
    const reviews = parseInt(p.reviewCount) || 0;
    if (priceMin   && price   < parseInt(priceMin))   return false;
    if (priceMax   && price   > parseInt(priceMax))   return false;
    if (minReviews && reviews < parseInt(minReviews)) return false;
    if (excludeAds && p.isAd)                         return false;
    return true;
  });
};

export const sortVideos = (videos, sortBy) =>
  [...videos].sort((a, b) => {
    if (sortBy === "trend") return b.trendScore - a.trendScore;
    if (sortBy === "views") return (parseInt(b.viewCount) || 0) - (parseInt(a.viewCount) || 0);
    if (sortBy === "date")  return new Date(b.publishedAt) - new Date(a.publishedAt);
    return 0;
  });
