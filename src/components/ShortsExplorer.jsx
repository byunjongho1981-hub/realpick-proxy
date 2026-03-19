// ShortsExplorer.jsx — 유튜브 제품 쇼츠 탐색기
import { useState } from "react";

// ── 상수 ──────────────────────────────
const PRODUCT_KWS = ["추천","리뷰","후기","비교","가성비","꿀템","구매","언박싱","추천템","생활용품","주방용품","필수템","스마트스토어","쿠팡","쇼핑","아이템","신상","언박","득템"];
const NEGATIVE_KWS = ["뉴스","사건","브이로그","먹방","챌린지","예능","밈","일상","루틴","정치","스포츠","음악","드라마","영화"];

// ── 유틸 ──────────────────────────────
const fmt = n => { if(!n&&n!==0) return"-"; const x=parseInt(n)||0; if(x>=100000000) return(x/100000000).toFixed(1)+"억"; if(x>=10000) return Math.floor(x/10000)+"만"; if(x>=1000) return(x/1000).toFixed(1)+"천"; return x.toLocaleString(); };
const fmtDate = s => { if(!s) return"-"; const d=new Date(s); const days=Math.floor((Date.now()-d)/86400000); if(days===0) return"오늘"; if(days<7) return`${days}일 전`; if(days<30) return`${Math.floor(days/7)}주 전`; if(days<365) return`${Math.floor(days/30)}개월 전`; return`${Math.floor(days/365)}년 전`; };
const fmtDur = s => { if(!s) return"-"; const m=Math.floor(s/60); const sec=s%60; return m>0?`${m}:${String(sec).padStart(2,"0")}`:`0:${String(sec).padStart(2,"0")}`; };
const scoreColor = s => s>=70?"#ffd700":s>=50?"#03c75a":s>=30?"#ff8800":"#888";
const scoreGrade = s => s>=70?"S":s>=50?"A":s>=30?"B":"C";

// ISO 8601 duration → 초
const parseDuration = iso => {
  if(!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if(!m) return 0;
  return (parseInt(m[1]||0)*3600)+(parseInt(m[2]||0)*60)+(parseInt(m[3]||0));
};

// 제품 키워드 감지
const detectProductKws = (title,desc,tags) => {
  const text = [title,desc,...(tags||[])].join(" ").toLowerCase();
  return PRODUCT_KWS.filter(k=>text.includes(k));
};

const detectNegativeKws = (title,desc,tags) => {
  const text = [title,desc,...(tags||[])].join(" ").toLowerCase();
  return NEGATIVE_KWS.filter(k=>text.includes(k));
};

// 점수 계산
const calcScore = (video) => {
  const { durationSeconds, viewCount, likeCount, commentCount, publishedAt, title, description, tags, isShortsCandidate, detectedKeywords, detectedNegativeKeywords } = video;
  const reasons = [];
  let score = 0;

  // 1. 조회수 (0~25점)
  const viewScore = Math.min(25, Math.log10(Math.max(1,viewCount))/7*25);
  score += viewScore;
  if(viewCount>=100000) reasons.push(`조회수 ${fmt(viewCount)} — 높은 노출`);

  // 2. 좋아요율 (0~20점)
  const likeRate = viewCount>0 ? likeCount/viewCount : 0;
  const likeScore = Math.min(20, likeRate*2000);
  score += likeScore;
  if(likeRate>=0.05) reasons.push(`좋아요율 ${(likeRate*100).toFixed(1)}% — 높음`);

  // 3. 댓글율 (0~10점)
  const commentRate = viewCount>0 ? commentCount/viewCount : 0;
  const commentScore = Math.min(10, commentRate*5000);
  score += commentScore;
  if(commentRate>=0.01) reasons.push(`댓글 반응률 ${(commentRate*100).toFixed(2)}%`);

  // 4. 최신성 (0~15점)
  const daysAgo = (Date.now()-new Date(publishedAt))/86400000;
  let recencyScore = 0;
  if(daysAgo<=7)  { recencyScore=15; reasons.push("최근 7일 내 업로드 ⚡"); }
  else if(daysAgo<=14) { recencyScore=12; reasons.push("최근 14일 내 업로드"); }
  else if(daysAgo<=30) { recencyScore=8;  reasons.push("최근 30일 내 업로드"); }
  else if(daysAgo<=90) { recencyScore=4; }
  score += recencyScore;

  // 5. 쇼츠 점수 (0~15점)
  let shortsScore = 0;
  if(durationSeconds>0 && durationSeconds<=60) { shortsScore+=10; reasons.push("60초 이하 쇼츠 후보"); }
  else if(durationSeconds<=180) shortsScore+=3;
  const hasShorts = [title,description,...(tags||[])].join(" ").toLowerCase().includes("#shorts");
  if(hasShorts) { shortsScore+=5; reasons.push("#shorts 포함"); }
  score += Math.min(15, shortsScore);

  // 6. 제품 키워드 (0~15점)
  const kwScore = Math.min(15, detectedKeywords.length*3);
  score += kwScore;
  if(detectedKeywords.length>0) reasons.push(`제품 키워드: ${detectedKeywords.slice(0,4).join(", ")}`);

  // 7. 감점 키워드
  const penaltyScore = detectedNegativeKeywords.length * 5;
  score -= penaltyScore;
  if(detectedNegativeKeywords.length>0) reasons.push(`⚠ 감점 키워드: ${detectedNegativeKeywords.join(", ")}`);

  return { score: Math.round(Math.min(100,Math.max(0,score))), reasons };
};

// ── API 함수 ───────────────────────────
const searchYouTubeVideos = async (apiKey, params) => {
  const { keyword, regionCode, languageCode, daysAgo, maxResults, order } = params;
  const published = new Date(Date.now()-daysAgo*86400000).toISOString();
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(keyword)}&type=video&maxResults=${maxResults}&order=${order}&regionCode=${regionCode}&relevanceLanguage=${languageCode}&publishedAfter=${published}&videoDuration=short&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if(data.error) throw new Error(data.error.message);
  return (data.items||[]).map(i=>i.id.videoId);
};

const fetchVideoDetails = async (apiKey, videoIds) => {
  const ids = videoIds.join(",");
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${ids}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if(data.error) throw new Error(data.error.message);
  return (data.items||[]).map(v => {
    const dur = parseDuration(v.contentDetails?.duration);
    const title = v.snippet?.title||"";
    const desc  = v.snippet?.description||"";
    const tags  = v.snippet?.tags||[];
    const posKws = detectProductKws(title,desc,tags);
    const negKws = detectNegativeKws(title,desc,tags);
    const videoData = {
      videoId: v.id,
      title,
      channelTitle: v.snippet?.channelTitle||"",
      publishedAt:  v.snippet?.publishedAt||"",
      durationSeconds: dur,
      viewCount:    parseInt(v.statistics?.viewCount)||0,
      likeCount:    parseInt(v.statistics?.likeCount)||0,
      commentCount: parseInt(v.statistics?.commentCount)||0,
      thumbnail:    v.snippet?.thumbnails?.medium?.url||v.snippet?.thumbnails?.default?.url||"",
      tags,
      description: desc.slice(0,300),
      isShortsCandidate: dur<=60||[title,desc,...tags].join(" ").toLowerCase().includes("#shorts"),
      detectedKeywords: posKws,
      detectedNegativeKeywords: negKws,
      url: `https://www.youtube.com/watch?v=${v.id}`,
    };
    const { score, reasons } = calcScore(videoData);
    return { ...videoData, productScore: score, reasons };
  });
};

// ── Spinner ────────────────────────────
const Spinner = () => (
  <div style={{ display:"inline-block", width:16, height:16, border:"2px solid #ff880033", borderTopColor:"#ff8800", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
);

// ── 상세 패널 ──────────────────────────
const DetailPanel = ({ video, onClose }) => {
  if(!video) return null;
  const sc = scoreColor(video.productScore);
  return (
    <div style={{ position:"fixed", top:0, right:0, bottom:0, width:360, background:"#0f0f13", borderLeft:"1px solid rgba(255,255,255,0.08)", zIndex:1000, overflowY:"auto", padding:20 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div style={{ fontSize:13, fontWeight:700, color:"#ccc" }}>📋 상세 분석</div>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"#666", fontSize:18, cursor:"pointer" }}>✕</button>
      </div>

      {/* 썸네일 */}
      <img src={video.thumbnail} alt="" style={{ width:"100%", borderRadius:8, marginBottom:12, display:"block" }} />

      {/* 제목 */}
      <div style={{ fontSize:13, fontWeight:700, color:"#fff", marginBottom:8, lineHeight:1.5 }}>{video.title}</div>
      <div style={{ fontSize:11, color:"#555", marginBottom:12 }}>{video.channelTitle} · {fmtDate(video.publishedAt)}</div>

      {/* 점수 */}
      <div style={{ background:`${sc}15`, border:`1px solid ${sc}33`, borderRadius:9, padding:"10px 12px", marginBottom:12, display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ fontSize:32, fontWeight:900, color:sc, lineHeight:1 }}>{video.productScore}</div>
        <div>
          <div style={{ fontSize:11, color:sc, fontWeight:700 }}>{scoreGrade(video.productScore)}급 제품성</div>
          <div style={{ fontSize:10, color:"#555" }}>100점 만점</div>
        </div>
      </div>

      {/* 점수 이유 */}
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:7 }}>📊 점수 산출 이유</div>
        {video.reasons.map((r,i)=>(
          <div key={i} style={{ display:"flex", gap:6, marginBottom:4 }}>
            <span style={{ color: r.startsWith("⚠")?"#ff4444":"#03c75a", fontSize:10, flexShrink:0 }}>•</span>
            <span style={{ fontSize:11, color:"#aaa" }}>{r}</span>
          </div>
        ))}
      </div>

      {/* 감지 키워드 */}
      {video.detectedKeywords.length>0 && (
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:6 }}>🏷 제품 키워드 감지</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
            {video.detectedKeywords.map((k,i)=>(
              <span key={i} style={{ fontSize:10, padding:"2px 8px", borderRadius:20, background:"rgba(3,199,90,0.12)", color:"#03c75a", border:"1px solid rgba(3,199,90,0.2)" }}>{k}</span>
            ))}
          </div>
        </div>
      )}

      {/* 설명 */}
      {video.description && (
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:6 }}>📝 설명 일부</div>
          <div style={{ fontSize:10, color:"#666", lineHeight:1.6, background:"rgba(255,255,255,0.03)", borderRadius:7, padding:"8px 10px" }}>{video.description}</div>
        </div>
      )}

      {/* 판매 포인트 */}
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:6 }}>💡 판매 가능성 포인트</div>
        <div style={{ background:"rgba(255,215,0,0.05)", border:"1px solid rgba(255,215,0,0.1)", borderRadius:7, padding:"8px 10px" }}>
          {video.productScore>=70 && <div style={{ fontSize:10, color:"#ccc", marginBottom:3 }}>• 높은 제품성 점수 — 쿠팡파트너스 포스팅 적합</div>}
          {video.isShortsCandidate && <div style={{ fontSize:10, color:"#ccc", marginBottom:3 }}>• 쇼츠 형식 — 모바일 노출 최적화</div>}
          {video.viewCount>=50000 && <div style={{ fontSize:10, color:"#ccc", marginBottom:3 }}>• 충분한 조회수 — 시장 수요 검증됨</div>}
          {video.detectedKeywords.length>=3 && <div style={{ fontSize:10, color:"#ccc", marginBottom:3 }}>• 복수 제품 키워드 — 구매 의도 높음</div>}
          {video.likeCount/Math.max(1,video.viewCount)>=0.05 && <div style={{ fontSize:10, color:"#ccc" }}>• 높은 좋아요율 — 콘텐츠 공감도 높음</div>}
        </div>
      </div>

      {/* 링크 */}
      <a href={video.url} target="_blank" rel="noopener noreferrer" style={{ display:"block", textAlign:"center", padding:"10px", background:"linear-gradient(135deg,#ff4400,#ff8800)", borderRadius:8, color:"#000", fontWeight:700, fontSize:12, textDecoration:"none" }}>
        ▶ YouTube에서 보기
      </a>
    </div>
  );
};

// ── 결과 카드 ──────────────────────────
const VideoCard = ({ video, selected, onClick }) => {
  const sc = scoreColor(video.productScore);
  return (
    <div onClick={onClick} style={{ background: selected?"rgba(255,215,0,0.06)":"rgba(255,255,255,0.02)", border:`1px solid ${selected?sc+"55":"rgba(255,255,255,0.06)"}`, borderRadius:10, padding:12, cursor:"pointer", transition:"all 0.15s" }}
      onMouseEnter={e=>{ if(!selected) e.currentTarget.style.background="rgba(255,255,255,0.05)"; }}
      onMouseLeave={e=>{ if(!selected) e.currentTarget.style.background="rgba(255,255,255,0.02)"; }}>
      <div style={{ display:"flex", gap:10 }}>
        {/* 썸네일 */}
        <div style={{ position:"relative", flexShrink:0 }}>
          <img src={video.thumbnail} alt="" style={{ width:100, height:56, objectFit:"cover", borderRadius:6, display:"block" }} />
          <div style={{ position:"absolute", bottom:3, right:3, background:"rgba(0,0,0,0.8)", borderRadius:3, padding:"1px 4px", fontSize:9, color:"#fff" }}>{fmtDur(video.durationSeconds)}</div>
          {video.isShortsCandidate && <div style={{ position:"absolute", top:3, left:3, background:"#ff4400", borderRadius:3, padding:"1px 5px", fontSize:8, fontWeight:700, color:"#fff" }}>SHORTS</div>}
        </div>

        {/* 정보 */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:12, fontWeight:600, color:"#fff", lineHeight:1.4, marginBottom:4, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{video.title}</div>
          <div style={{ fontSize:10, color:"#666", marginBottom:6 }}>{video.channelTitle} · {fmtDate(video.publishedAt)}</div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <span style={{ fontSize:10, color:"#aaa" }}>👁 {fmt(video.viewCount)}</span>
            <span style={{ fontSize:10, color:"#aaa" }}>👍 {fmt(video.likeCount)}</span>
            <span style={{ fontSize:10, color:"#aaa" }}>💬 {fmt(video.commentCount)}</span>
          </div>
        </div>

        {/* 점수 */}
        <div style={{ flexShrink:0, textAlign:"center", minWidth:44 }}>
          <div style={{ fontSize:22, fontWeight:900, color:sc, lineHeight:1 }}>{video.productScore}</div>
          <div style={{ fontSize:9, color:sc, fontWeight:700 }}>{scoreGrade(video.productScore)}급</div>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════
export default function ShortsExplorer({ defaultApiKey="" }) {
  const [apiKey, setApiKey]       = useState(defaultApiKey);
  const [keyword, setKeyword]     = useState("가성비 추천");
  const [region, setRegion]       = useState("KR");
  const [lang, setLang]           = useState("ko");
  const [days, setDays]           = useState(30);
  const [maxRes, setMaxRes]       = useState(20);
  const [sortBy, setSortBy]       = useState("score");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [results, setResults]     = useState([]);
  const [selected, setSelected]   = useState(null);
  const [searched, setSearched]   = useState(false);
  const [viewMode, setViewMode]   = useState("card"); // card | table

  const handleSearch = async () => {
    if(!apiKey.trim()) { setError("YouTube API Key를 입력해주세요."); return; }
    if(!keyword.trim()) { setError("검색 키워드를 입력해주세요."); return; }
    setLoading(true); setError(""); setResults([]); setSelected(null); setSearched(true);
    try {
      const ytOrder = sortBy==="date"?"date":"viewCount";
      const ids = await searchYouTubeVideos(apiKey, { keyword, regionCode:region, languageCode:lang, daysAgo:parseInt(days), maxResults:Math.min(50,parseInt(maxRes)||20), order:ytOrder });
      if(!ids.length) { setResults([]); return; }
      const videos = await fetchVideoDetails(apiKey, ids);
      let sorted = [...videos];
      if(sortBy==="score") sorted.sort((a,b)=>b.productScore-a.productScore);
      else if(sortBy==="views") sorted.sort((a,b)=>b.viewCount-a.viewCount);
      else if(sortBy==="date") sorted.sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
      setResults(sorted);
    } catch(e) {
      setError("오류: "+e.message);
    } finally { setLoading(false); }
  };

  const shorts    = results.filter(v=>v.isShortsCandidate);
  const avgScore  = results.length ? Math.round(results.reduce((s,v)=>s+v.productScore,0)/results.length) : 0;
  const bestVideo = results[0];

  return (
    <div style={{ fontFamily:"'Segoe UI',sans-serif", color:"#fff" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} input,select{outline:none;} input::placeholder{color:#444}`}</style>

      {/* 헤더 */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:16, fontWeight:800, marginBottom:3 }}>🎬 유튜브 제품 쇼츠 탐색기</div>
        <div style={{ fontSize:11, color:"#555" }}>제품 판매 가능성이 높은 쇼츠 영상 후보를 발굴하는 분석 도구</div>
      </div>

      {/* API Key */}
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:10, color:"#666", marginBottom:4 }}>YouTube Data API Key</div>
        <input value={apiKey} onChange={e=>setApiKey(e.target.value)} type="password"
          placeholder="AIza..."
          style={{ width:"100%", background:"#111", border:"1px solid #222", borderRadius:7, padding:"8px 10px", color:"#ccc", fontSize:12 }} />
      </div>

      {/* 검색 폼 */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 80px 80px", gap:8, marginBottom:8 }}>
        <input value={keyword} onChange={e=>setKeyword(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&handleSearch()}
          placeholder="검색 키워드 (예: 가성비 추천, 주방용품 리뷰)"
          style={{ background:"#111", border:"1px solid #222", borderRadius:7, padding:"8px 10px", color:"#ccc", fontSize:12 }} />
        <input value={region} onChange={e=>setRegion(e.target.value)} placeholder="KR"
          style={{ background:"#111", border:"1px solid #222", borderRadius:7, padding:"8px 10px", color:"#ccc", fontSize:12, textAlign:"center" }} />
        <input value={lang} onChange={e=>setLang(e.target.value)} placeholder="ko"
          style={{ background:"#111", border:"1px solid #222", borderRadius:7, padding:"8px 10px", color:"#ccc", fontSize:12, textAlign:"center" }} />
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr auto", gap:8, marginBottom:12 }}>
        <div>
          <div style={{ fontSize:9, color:"#555", marginBottom:3 }}>최근 며칠</div>
          <input type="number" value={days} onChange={e=>setDays(e.target.value)} min={1} max={365}
            style={{ width:"100%", background:"#111", border:"1px solid #222", borderRadius:7, padding:"7px 10px", color:"#ccc", fontSize:12 }} />
        </div>
        <div>
          <div style={{ fontSize:9, color:"#555", marginBottom:3 }}>최대 결과 수</div>
          <input type="number" value={maxRes} onChange={e=>setMaxRes(e.target.value)} min={5} max={50}
            style={{ width:"100%", background:"#111", border:"1px solid #222", borderRadius:7, padding:"7px 10px", color:"#ccc", fontSize:12 }} />
        </div>
        <div>
          <div style={{ fontSize:9, color:"#555", marginBottom:3 }}>정렬 기준</div>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
            style={{ width:"100%", background:"#111", border:"1px solid #222", borderRadius:7, padding:"7px 10px", color:"#ccc", fontSize:12, cursor:"pointer" }}>
            <option value="score">제품성 점수순</option>
            <option value="views">조회수순</option>
            <option value="date">최신순</option>
          </select>
        </div>
        <div style={{ display:"flex", alignItems:"flex-end" }}>
          <button onClick={handleSearch} disabled={loading}
            style={{ padding:"8px 20px", borderRadius:7, border:"none", cursor:loading?"not-allowed":"pointer", background:loading?"#222":"linear-gradient(135deg,#ff4400,#ffd700)", color:loading?"#555":"#000", fontWeight:800, fontSize:12, display:"flex", alignItems:"center", gap:6, whiteSpace:"nowrap" }}>
            {loading ? <><Spinner /> 검색 중...</> : "🔍 검색"}
          </button>
        </div>
      </div>

      {/* 에러 */}
      {error && <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:7, padding:"8px 11px", color:"#ff8888", fontSize:11, marginBottom:12 }}>⚠️ {error}</div>}

      {/* 요약 박스 */}
      {searched && !loading && results.length>0 && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:14 }}>
          {[
            { label:"총 검색",    value:`${results.length}개`,      color:"#ccc" },
            { label:"쇼츠 후보",  value:`${shorts.length}개`,       color:"#ff8800" },
            { label:"평균 점수",  value:`${avgScore}점`,            color:scoreColor(avgScore) },
            { label:"최고 점수",  value:`${bestVideo?.productScore||0}점`, color:scoreColor(bestVideo?.productScore||0) },
          ].map((s,i)=>(
            <div key={i} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:8, padding:"9px 11px", textAlign:"center" }}>
              <div style={{ fontSize:9, color:"#555", marginBottom:3 }}>{s.label}</div>
              <div style={{ fontSize:18, fontWeight:900, color:s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* 뷰 모드 토글 */}
      {results.length>0 && (
        <div style={{ display:"flex", gap:4, marginBottom:10 }}>
          <button onClick={()=>setViewMode("card")} style={{ padding:"5px 12px", borderRadius:6, border:"none", fontSize:11, cursor:"pointer", background:viewMode==="card"?"rgba(255,255,255,0.1)":"transparent", color:viewMode==="card"?"#fff":"#555" }}>카드형</button>
          <button onClick={()=>setViewMode("table")} style={{ padding:"5px 12px", borderRadius:6, border:"none", fontSize:11, cursor:"pointer", background:viewMode==="table"?"rgba(255,255,255,0.1)":"transparent", color:viewMode==="table"?"#fff":"#555" }}>테이블형</button>
        </div>
      )}

      {/* 결과 없음 */}
      {searched && !loading && results.length===0 && !error && (
        <div style={{ textAlign:"center", color:"#444", fontSize:12, padding:40 }}>
          <div style={{ fontSize:32, marginBottom:8 }}>🔍</div>
          검색 결과가 없습니다. 키워드나 기간을 변경해보세요.
        </div>
      )}

      {/* 카드형 결과 */}
      {viewMode==="card" && results.length>0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
          {results.map(v=>(
            <VideoCard key={v.videoId} video={v} selected={selected?.videoId===v.videoId} onClick={()=>setSelected(v)} />
          ))}
        </div>
      )}

      {/* 테이블형 결과 */}
      {viewMode==="table" && results.length>0 && (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
            <thead>
              <tr style={{ borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
                {["점수","제목","채널","업로드","길이","조회수","좋아요","댓글","쇼츠"].map((h,i)=>(
                  <th key={i} style={{ padding:"8px 10px", textAlign:i===0?"center":"left", color:"#666", fontWeight:600, whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map(v=>(
                <tr key={v.videoId} onClick={()=>setSelected(v)} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)", cursor:"pointer", background:selected?.videoId===v.videoId?"rgba(255,215,0,0.05)":"transparent" }}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
                  onMouseLeave={e=>e.currentTarget.style.background=selected?.videoId===v.videoId?"rgba(255,215,0,0.05)":"transparent"}>
                  <td style={{ padding:"8px 10px", textAlign:"center" }}>
                    <span style={{ fontSize:14, fontWeight:900, color:scoreColor(v.productScore) }}>{v.productScore}</span>
                  </td>
                  <td style={{ padding:"8px 10px", maxWidth:200 }}>
                    <div style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:"#ccc" }}>{v.title}</div>
                  </td>
                  <td style={{ padding:"8px 10px", color:"#666", whiteSpace:"nowrap" }}>{v.channelTitle}</td>
                  <td style={{ padding:"8px 10px", color:"#666", whiteSpace:"nowrap" }}>{fmtDate(v.publishedAt)}</td>
                  <td style={{ padding:"8px 10px", color:"#666", whiteSpace:"nowrap" }}>{fmtDur(v.durationSeconds)}</td>
                  <td style={{ padding:"8px 10px", color:"#aaa", whiteSpace:"nowrap" }}>{fmt(v.viewCount)}</td>
                  <td style={{ padding:"8px 10px", color:"#aaa", whiteSpace:"nowrap" }}>{fmt(v.likeCount)}</td>
                  <td style={{ padding:"8px 10px", color:"#aaa", whiteSpace:"nowrap" }}>{fmt(v.commentCount)}</td>
                  <td style={{ padding:"8px 10px", textAlign:"center" }}>
                    {v.isShortsCandidate ? <span style={{ fontSize:9, padding:"2px 6px", background:"rgba(255,68,0,0.15)", color:"#ff8800", borderRadius:4 }}>✓</span> : <span style={{ color:"#333" }}>-</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 상세 패널 */}
      {selected && <DetailPanel video={selected} onClose={()=>setSelected(null)} />}
    </div>
  );
}
