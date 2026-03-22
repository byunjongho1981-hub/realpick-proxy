// api/google-trends-rss.js
// GET /api/google-trends-rss
//
// 구글 트렌드 RSS → 뽐뿌 핫딜 + 네이버 경제뉴스 + 클리앙 RSS로 교체
// 반환 포맷 동일 유지 → hot.html 수정 불필요

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const now = Date.now();

  // ── RSS 소스 정의 ─────────────────────────────────────────
  const SOURCES = [
    {
      name : '뽐뿌_국내',
      url  : 'https://www.ppomppu.co.kr/rss.php?id=ppomppu',
      type : 'deal'
    },
    {
      name : '뽐뿌_해외',
      url  : 'https://www.ppomppu.co.kr/rss.php?id=foreign',
      type : 'deal'
    },
    {
      name : '뽐뿌_중고',
      url  : 'https://www.ppomppu.co.kr/rss.php?id=freemarketpc',
      type : 'deal'
    },
    {
      name : '알리익스프레스_핫딜',
      url  : 'https://www.ppomppu.co.kr/rss.php?id=aliexpress',
      type : 'deal'
    }
  ];

  try {
    // ── 병렬 수집 ─────────────────────────────────────────
    const fetches = SOURCES.map(src =>
      fetch(src.url, {
        headers: {
          'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept'         : 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'ko-KR,ko;q=0.9'
        }
      })
      .then(r => r.ok ? r.text() : null)
      .then(xml => ({ xml, src }))
      .catch(() => ({ xml: null, src }))
    );

    const results = await Promise.all(fetches);

    // ── XML 파싱 → 키워드 추출 ────────────────────────────
    const keywordMap = {}; // keyword → { count, sources, latestAt, type }

    results.forEach(({ xml, src }) => {
      if (!xml || !xml.includes('<item>')) return;

      // 제목 추출
      const titles = [
        ...xml.matchAll(/<title><!\[CDATA\[(.+?)\]\]><\/title>/g),
        ...xml.matchAll(/<title>([^<]{2,80})<\/title>/g)
      ].map(m => m[1].trim())
       .filter(t => t.length >= 2 && !t.includes('뽐뿌') && !t.includes('클리앙') && !t.includes('네이버'));

      // 발행 시간 추출
      const pubDates = [...xml.matchAll(/<pubDate>(.+?)<\/pubDate>/g)]
        .map(m => { try { return new Date(m[1]).getTime(); } catch { return now; } });

      titles.forEach((title, i) => {
        // 제목에서 2~8자 한글 명사 추출
        const words = title.match(/[가-힣a-zA-Z0-9]{2,10}/g) || [];
        const hoursAgo = (now - (pubDates[i] || now)) / 3600000;

        // 24시간 이내 항목만
        if (hoursAgo > 24) return;

        words.forEach(word => {
          // 불용어 제거
          if (STOPWORDS.includes(word)) return;
          if (!keywordMap[word]) {
            keywordMap[word] = { count: 0, sources: new Set(), latestAt: 0, type: src.type };
          }
          keywordMap[word].count++;
          keywordMap[word].sources.add(src.name);
          keywordMap[word].latestAt = Math.max(keywordMap[word].latestAt, pubDates[i] || now);
        });
      });
    });

    // ── 점수 계산 → trends 포맷 변환 ─────────────────────
    const trends = Object.entries(keywordMap)
      .filter(([_, v]) => v.count >= 2) // 2회 이상 등장한 것만
      .map(([keyword, v]) => {
        const hoursAgo   = (now - v.latestAt) / 3600000;
        const recency    = Math.max(0, Math.round(100 - hoursAgo * 4.2));
        const multiSource = v.sources.size >= 2;
        // 등장 횟수 + 다중 소스 기반 증가율 추정
        const growthRate = Math.min(0.5, (v.count / 10) + (multiSource ? 0.1 : 0));

        return {
          keyword,
          traffic      : v.count * 1000,
          recency,
          growthRate,
          hoursAgo     : Math.round(hoursAgo),
          multiSource,
          sourceList   : [...v.sources],
          detectionCount: v.count,
          detectedAt   : v.latestAt,
          source       : 'rss_combined'
        };
      })
      .sort((a, b) => b.growthRate - a.growthRate)
      .slice(0, 20);

    console.log('[rss] collected:', trends.length, 'keywords from', results.filter(r => r.xml).length, 'sources');

    return res.status(200).json({
      trends,
      collectedAt : now,
      count       : trends.length,
      source      : 'rss_combined',
      sources     : SOURCES.map(s => s.name)
    });

  } catch (err) {
    console.error('[rss] error:', err.message);
    return res.status(200).json({
      trends: [], count: 0, source: 'fallback', reason: err.message
    });
  }
}

// ── 불용어 목록 ───────────────────────────────────────────────
const STOPWORDS = [
  // 조사/접속사
  '이다','있다','없다','하다','되다','이고','에서','으로','부터','까지',
  '그리고','하지만','그러나','때문','이번','지난','오늘','내일','어제',
  // 일반 명사 (제품과 무관)
  '뉴스','기사','방송','정부','대통령','국회','선거','사건','사고',
  '공지','이벤트','할인','무료','배송','구매','판매','후기','리뷰',
  '추천','비교','순위','랭킹','가격','최저','최고','브랜드','신제품',
  // 숫자/단위
  '원짜리','개월','년도','퍼센트','달러','유로',
];
