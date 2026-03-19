import { useState } from "react";
import SearchBox from "./components/SearchBox";
import NaverAnalysis from "./components/NaverAnalysis";
import { fetchYouTube } from "./api/youtube";
import { extractShoppingKeyword, fetchNaverProducts } from "./api/naver";
import { fetchNaverKeywords } from "./api/keyword";

/* ── 유틸 ── */
const fmtNum = n => { if(!n) return"-"; const x=parseInt(n); if(x>=100000000) return(x/100000000).toFixed(1)+"억"; if(x>=10000) return Math.floor(x/10000)+"만"; if(x>=1000) return(x/1000).toFixed(1)+"천"; return x.toLocaleString(); };
const dayAgo = iso => { if(!iso) return""; const d=Math.floor((Date.now()-new Date(iso))/86400000); if(d===0)return"오늘"; if(d<7)return`${d}일 전`; if(d<30)return`${Math.floor(d/7)}주 전`; return`${Math.floor(d/30)}개월 전`; };
const tColor = s => s>=80?"#ff2222":s>=60?"#ff8800":s>=40?"#ffcc00":"#4488ff";

/* ── 공통 컴포넌트 ── */
const Spinner = ({ color, size=16 }) => (
  <div style={{ display:"inline-block", width:size, height:size, border:`2px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite", flexShrink:0 }} />
);
const LoadBox = ({ color, text }) => (
  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, padding:30, color:"#555", fontSize:12 }}>
    <Spinner color={color} size={24} />{text}
  </div>
);
const ErrBox = ({ msg }) => (
  <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:8, padding:"10px 12px", color:"#ff8888", fontSize:12, marginBottom:10 }}>⚠️ {msg}</div>
);
const EmptyBox = ({ text }) => (
  <div style={{ textAlign:"center", color:"#333", fontSize:12, padding:20 }}>{text}</div>
);
const ColHeader = ({ icon, title, loading, color, cache }) => (
  <div style={{ fontSize:13, fontWeight:700, color:"#aaa", marginBottom:12, display:"flex", alignItems:"center", gap:8 }}>
    {icon} {title}
    {loading && <Spinner color={color} />}
    {cache && <span style={{ fontSize:10, color:"#ffaa00" }}>⚡캐시</span>}
  </div>
);

export default function App() {
  const [keyword, setKeyword]                 = useState("");
  const [videos, setVideos]                   = useState([]);
  const [products, setProducts]               = useState([]);
  const [keywords, setKeywords]               = useState([]);
  const [shoppingKeyword, setShoppingKeyword] = useState("");
  const [loadingYT, setLoadingYT]             = useState(false);
  const [loadingNV, setLoadingNV]             = useState(false);
  const [loadingKW, setLoadingKW]             = useState(false);
  const [ytError, setYtError]                 = useState("");
  const [nvError, setNvError]                 = useState("");
  const [kwError, setKwError]                 = useState("");
  const [searched, setSearched]               = useState(false);
  const [cacheHit, setCacheHit]               = useState({ yt:false, nv:false, kw:false });

  const handleSearch = async ({ keyword: kw, apiKey }) => {
    setKeyword(kw);
    setVideos([]); setProducts([]); setKeywords([]); setShoppingKeyword("");
    setYtError(""); setNvError(""); setKwError("");
    setSearched(true); setCacheHit({ yt:false, nv:false, kw:false });
    setLoadingYT(true); setLoadingNV(true); setLoadingKW(true);

    // Step 1: YouTube
    let ytVideos = [];
    try {
      const { videos: v, fromCache } = await fetchYouTube(kw, apiKey);
      ytVideos = v; setVideos(v);
      setCacheHit(p => ({ ...p, yt: fromCache }));
    } catch (e) {
      const msg = e.message || "";
      setYtError(
        msg.includes("Failed to fetch") ? "네트워크 오류" :
        msg.includes("403") ? "API 키 권한 없음 또는 할당량 초과" :
        msg.includes("400") ? "API 키가 올바르지 않습니다" :
        "YouTube 오류: " + msg
      );
    } finally { setLoadingYT(false); }

    // Step 2: 쇼핑 키워드 추출
    let derivedKw = kw;
    try {
      if (ytVideos.length > 0)
        derivedKw = await extractShoppingKeyword(kw, ytVideos.map(v => v.title));
    } catch { derivedKw = kw; }
    setShoppingKeyword(derivedKw);

    // Step 3: 쇼핑 + 키워드 병렬
    await Promise.all([
      (async () => {
        try {
          const { products: p, fromCache } = await fetchNaverProducts(derivedKw);
          if (!Array.isArray(p) || p.length === 0) setNvError("검색된 상품이 없습니다.");
          else { setProducts(p); setCacheHit(prev => ({ ...prev, nv: fromCache })); }
        } catch (e) {
          setNvError(e.message?.includes("파싱") ? "상품 데이터 오류. 다시 시도해주세요." : "쇼핑 오류: " + (e.message||""));
        } finally { setLoadingNV(false); }
      })(),
      (async () => {
        try {
          const { keywords: k, fromCache } = await fetchNaverKeywords(kw);
          if (!Array.isArray(k) || k.length === 0) setKwError("키워드 분석 결과 없음");
          else { setKeywords(k); setCacheHit(prev => ({ ...prev, kw: fromCache })); }
        } catch (e) {
          setKwError("키워드 분석 오류: " + (e.message||""));
        } finally { setLoadingKW(false); }
      })()
    ]);
  };

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0a0a0a 0%,#111 60%,#0d0d1a 100%)", fontFamily:"'Segoe UI',sans-serif", color:"#fff" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} *{box-sizing:border-box}`}</style>

      {/* 헤더 */}
      <div style={{ textAlign:"center", padding:"24px 16px 12px" }}>
        <div style={{ fontSize:26, marginBottom:4 }}>🔍</div>
        <h1 style={{ fontSize:20, fontWeight:800, margin:0 }}>트렌드 & 쇼핑 통합 검색</h1>
        <p style={{ color:"#444", fontSize:11, marginTop:4 }}>YouTube 트렌드 + 네이버 쇼핑 + 관심 키워드 TOP10</p>
      </div>

      {/* 3컬럼 */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1.4fr 1fr", gap:16, padding:"0 16px 40px", maxWidth:1400, margin:"0 auto", alignItems:"start" }}>

        {/* ── 왼쪽: 검색창 + 키워드 TOP10 ── */}
        <div>
          <SearchBox onSearch={handleSearch} loading={loadingYT||loadingNV||loadingKW} />
          {searched && (
            <div style={{ marginTop:20 }}>
              <ColHeader icon="🔥" title="관심 키워드 TOP10" loading={loadingKW} color="#ff8800" cache={cacheHit.kw} />
              {kwError && <ErrBox msg={kwError} />}
              {loadingKW && <LoadBox color="#ff8800" text="키워드 분석 중..." />}
              {!loadingKW && keywords.length > 0 && (
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {keywords.map((item, i) => (
                    <div key={i} style={{ background:i<3?"rgba(255,136,0,0.07)":"rgba(255,255,255,0.03)", border:i<3?"1px solid rgba(255,136,0,0.2)":"1px solid rgba(255,255,255,0.06)", borderRadius:10, padding:"10px 12px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                        <div style={{ flexShrink:0, width:24, height:24, borderRadius:6,
                          background: i===0?"linear-gradient(135deg,#ffd700,#ff8800)":i===1?"linear-gradient(135deg,#c0c0c0,#888)":i===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)",
                          display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:900, color:i<3?"#000":"#666"
                        }}>{i+1}</div>
                        <span style={{ fontSize:13, fontWeight:800, color:"#fff", flex:1 }}>{item.keyword}</span>
                        <span style={{ fontSize:13, fontWeight:900, color:"#ff8800" }}>{item.count.toLocaleString()}</span>
                      </div>
                      <div style={{ height:3, background:"#1a1a1a", borderRadius:99 }}>
                        <div style={{ height:"100%", borderRadius:99, width:`${Math.round((item.count/keywords[0].count)*100)}%`, background:"linear-gradient(90deg,#ff880088,#ff8800)" }} />
                      </div>
                      <div style={{ fontSize:10, color:"#666", marginTop:4 }}>{item.reason}</div>
                    </div>
                  ))}
                </div>
              )}
              {!loadingKW && keywords.length === 0 && !kwError && <EmptyBox text="키워드 결과 없음" />}
            </div>
          )}
        </div>

        {/* ── 가운데: YouTube 트렌드 ── */}
        <div>
          <ColHeader icon="📺" title="YouTube 트렌드" loading={loadingYT} color="#ff4444" cache={cacheHit.yt} />
          {ytError && <ErrBox msg={ytError} />}
          {loadingYT && <LoadBox color="#ff4444" text="유튜브 분석 중..." />}
          {!loadingYT && videos.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {[...videos].sort((a,b) => b.trendScore - a.trendScore).map((v, i) => (
                <div key={v.id} onClick={() => window.open(v.url, "_blank")}
                  style={{ background:i===0?"rgba(255,34,34,0.07)":"rgba(255,255,255,0.03)", border:i===0?"1px solid rgba(255,34,34,0.25)":"1px solid rgba(255,255,255,0.06)", borderRadius:12, padding:12, cursor:"pointer", display:"flex", gap:10 }}
                  onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,0.07)"}
                  onMouseLeave={e => e.currentTarget.style.background=i===0?"rgba(255,34,34,0.07)":"rgba(255,255,255,0.03)"}>
                  <div style={{ position:"relative", flexShrink:0 }}>
                    <img src={v.thumbnail} alt="" style={{ width:100, height:56, objectFit:"cover", borderRadius:6, display:"block" }} />
                    <div style={{ position:"absolute", top:3, left:3, background:i<3?"linear-gradient(135deg,#ff2222,#880000)":"rgba(0,0,0,0.7)", borderRadius:4, padding:"1px 5px", fontSize:9, fontWeight:800 }}>#{i+1}</div>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:12, lineHeight:1.4, marginBottom:3, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{v.title}</div>
                    <div style={{ fontSize:10, color:"#ff8888", marginBottom:4 }}>📢 {v.channel}</div>
                    <div style={{ display:"flex", gap:8, marginBottom:5 }}>
                      <span style={{ fontSize:10, color:"#aaa" }}>👁 <b style={{ color:"#fff" }}>{fmtNum(v.viewCount)}</b></span>
                      <span style={{ fontSize:10, color:"#aaa" }}>👍 {fmtNum(v.likeCount)}</span>
                      <span style={{ fontSize:10, color:"#555" }}>📅 {dayAgo(v.publishedAt)}</span>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <div style={{ flex:1, height:3, background:"#1e1e1e", borderRadius:99 }}>
                        <div style={{ height:"100%", borderRadius:99, width:`${v.trendScore}%`, background:`linear-gradient(90deg,${tColor(v.trendScore)}88,${tColor(v.trendScore)})` }} />
                      </div>
                      <span style={{ fontSize:10, fontWeight:800, color:tColor(v.trendScore) }}>{v.trendScore}점</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loadingYT && !ytError && videos.length === 0 && searched && <EmptyBox text="48시간 이내 영상 없음" />}
        </div>

        {/* ── 오른쪽: 네이버 쇼핑 + 분석 ── */}
        <div>
          <ColHeader icon="🛍" title="네이버 쇼핑" loading={loadingNV} color="#03c75a" cache={cacheHit.nv} />
          {shoppingKeyword && !loadingNV && (
            <div style={{ marginBottom:10, padding:"6px 10px", background:"rgba(3,199,90,0.06)", border:"1px solid rgba(3,199,90,0.2)", borderRadius:8, fontSize:11, color:"#4a9a6a" }}>
              🔑 <b style={{ color:"#03c75a" }}>{shoppingKeyword}</b>
              {shoppingKeyword !== keyword && <span style={{ color:"#2a5a3a" }}> (원본: {keyword})</span>}
            </div>
          )}
          {nvError && <ErrBox msg={nvError} />}
          {loadingNV && <LoadBox color="#03c75a" text="쇼핑 검색 중..." />}
          {!loadingNV && products.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {products.map((p, i) => (
                <div key={i} onClick={() => p.url && window.open(p.url, "_blank")}
                  style={{ background:"rgba(3,199,90,0.04)", border:"1px solid rgba(3,199,90,0.15)", borderRadius:12, padding:12, cursor:p.url?"pointer":"default" }}
                  onMouseEnter={e => e.currentTarget.style.background="rgba(3,199,90,0.09)"}
                  onMouseLeave={e => e.currentTarget.style.background="rgba(3,199,90,0.04)"}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                    <span style={{ fontSize:10, color:"#03c75a", fontWeight:700 }}>#{i+1}</span>
                    {p.url && <span style={{ fontSize:11, color:"#555" }}>↗</span>}
                  </div>
                  <div style={{ fontWeight:700, fontSize:12, lineHeight:1.4, marginBottom:5, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
                    {p.name?.replace(/<[^>]*>/g,"")}
                  </div>
                  <div style={{ fontSize:14, fontWeight:900, color:"#03c75a", marginBottom:4 }}>{p.price ? parseInt(p.price).toLocaleString()+"원" : "-"}</div>
                  <div style={{ fontSize:11, color:"#555", marginBottom:3 }}>
                    🏪 {p.mall}
                    {p.isAd && <span style={{ marginLeft:5, fontSize:9, color:"#ff6644", border:"1px solid #ff664466", borderRadius:3, padding:"1px 3px" }}>광고</span>}
                  </div>
                  {(p.rating||p.reviewCount) && <div style={{ fontSize:10, color:"#666", marginBottom:4 }}>⭐{p.rating} 💬{fmtNum(p.reviewCount)}개</div>}
                  {p.reason && <div style={{ fontSize:10, color:"#4a9a6a", padding:"5px 8px", background:"rgba(3,199,90,0.06)", borderRadius:6 }}>💡 {p.reason}</div>}
                </div>
              ))}
            </div>
          )}
          {!loadingNV && !nvError && products.length === 0 && searched && <EmptyBox text="상품 결과 없음" />}

          {/* 네이버 쇼핑 분석 */}
          {!loadingNV && products.length > 0 && (
            <NaverAnalysis products={products} />
          )}
        </div>

      </div>
    </div>
  );
}
