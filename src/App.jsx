import { useState } from "react";
import SearchBox from "./components/SearchBox";
import NaverAnalysis from "./components/NaverAnalysis";
import IntegratedAnalysis from "./components/IntegratedAnalysis";
import { fetchYouTube } from "./api/youtube";
import { extractShoppingKeyword, fetchNaverProducts } from "./api/naver";
import { fetchNaverKeywords } from "./api/keyword";
import { analyzeKeywords } from "./api/analyze";

const fmtNum = n => { if(!n) return"-"; const x=parseInt(n); if(x>=100000000) return(x/100000000).toFixed(1)+"억"; if(x>=10000) return Math.floor(x/10000)+"만"; if(x>=1000) return(x/1000).toFixed(1)+"천"; return x.toLocaleString(); };
const dayAgo = iso => { if(!iso) return""; const d=Math.floor((Date.now()-new Date(iso))/86400000); if(d===0)return"오늘"; if(d<7)return`${d}일 전`; if(d<30)return`${Math.floor(d/7)}주 전`; return`${Math.floor(d/30)}개월 전`; };
const tColor = s => s>=80?"#ff2222":s>=60?"#ff8800":s>=40?"#ffcc00":"#4488ff";

const Spinner = ({ color, size=16 }) => (
  <div style={{ display:"inline-block", width:size, height:size, border:`2px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite", flexShrink:0 }} />
);
const LoadBox = ({ color, text }) => (
  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, padding:24, color:"#555", fontSize:12 }}>
    <Spinner color={color} size={22} />{text}
  </div>
);
const ErrBox = ({ msg }) => (
  <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:8, padding:"10px 12px", color:"#ff8888", fontSize:12, marginBottom:10 }}>⚠️ {msg}</div>
);
const EmptyBox = ({ text }) => (
  <div style={{ textAlign:"center", color:"#444", fontSize:12, padding:16 }}>{text}</div>
);
const SectionTitle = ({ icon, title, loading, color, cache }) => (
  <div style={{ fontSize:12, fontWeight:700, color:"#888", marginBottom:10, display:"flex", alignItems:"center", gap:6, borderBottom:"1px solid rgba(255,255,255,0.06)", paddingBottom:8 }}>
    <span>{icon}</span> {title}
    {loading && <Spinner color={color} size={12} />}
    {cache && <span style={{ fontSize:9, color:"#ffaa00", marginLeft:2 }}>⚡캐시</span>}
  </div>
);

export default function App() {
  const [keyword, setKeyword]               = useState("");
  const [videos, setVideos]                 = useState([]);
  const [products, setProducts]             = useState([]);
  const [keywords, setKeywords]             = useState([]);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [shoppingKeyword, setShoppingKeyword] = useState("");
  const [loadingYT, setLoadingYT]           = useState(false);
  const [loadingNV, setLoadingNV]           = useState(false);
  const [loadingKW, setLoadingKW]           = useState(false);
  const [loadingAN, setLoadingAN]           = useState(false);
  const [ytError, setYtError]               = useState("");
  const [nvError, setNvError]               = useState("");
  const [kwError, setKwError]               = useState("");
  const [anError, setAnError]               = useState("");
  const [searched, setSearched]             = useState(false);
  const [cacheHit, setCacheHit]             = useState({ yt:false, nv:false, kw:false });

  const handleSearch = async ({ keyword: kw, apiKey }) => {
    setKeyword(kw);
    setVideos([]); setProducts([]); setKeywords([]); setAnalysisResult(null); setShoppingKeyword("");
    setYtError(""); setNvError(""); setKwError(""); setAnError("");
    setSearched(true); setCacheHit({ yt:false, nv:false, kw:false });
    setLoadingYT(true); setLoadingNV(true); setLoadingKW(true); setLoadingAN(true);

    let ytVideos = [];
    try {
      const { videos: v, fromCache } = await fetchYouTube(kw, apiKey);
      ytVideos = v; setVideos(v);
      setCacheHit(p => ({ ...p, yt: fromCache }));
    } catch (e) {
      const msg = e.message || "";
      setYtError(msg.includes("403") ? "API 키 권한 없음 또는 할당량 초과" : msg.includes("400") ? "API 키가 올바르지 않습니다" : "YouTube 오류: " + msg);
    } finally { setLoadingYT(false); }

    let derivedKw = kw;
    try {
      if (ytVideos.length > 0) derivedKw = await extractShoppingKeyword(kw, ytVideos.map(v => v.title));
    } catch { derivedKw = kw; }
    setShoppingKeyword(derivedKw);

    await Promise.all([
      (async () => {
        try {
          const { products: p, fromCache } = await fetchNaverProducts(derivedKw);
          if (!Array.isArray(p) || p.length === 0) setNvError("검색된 상품이 없습니다.");
          else { setProducts(p); setCacheHit(prev => ({ ...prev, nv: fromCache })); }
        } catch (e) { setNvError("쇼핑 오류: " + (e.message||"")); }
        finally { setLoadingNV(false); }
      })(),
      (async () => {
        try {
          const { keywords: k, fromCache } = await fetchNaverKeywords(kw);
          if (!Array.isArray(k) || k.length === 0) setKwError("키워드 분석 결과 없음");
          else { setKeywords(k); setCacheHit(prev => ({ ...prev, kw: fromCache })); }
        } catch (e) { setKwError("키워드 분석 오류: " + (e.message||"")); }
        finally { setLoadingKW(false); }
      })(),
      (async () => {
        try {
          if (ytVideos.length === 0) { setAnError("유튜브 영상 없음"); return; }
          const { result } = await analyzeKeywords(ytVideos.map(v => v.title), kw);
          setAnalysisResult(result);
        } catch (e) { setAnError("통합 분석 오류: " + (e.message||"")); }
        finally { setLoadingAN(false); }
      })()
    ]);
  };

  return (
    <div style={{ minHeight:"100vh", background:"#0c0c0f", fontFamily:"'Segoe UI',sans-serif", color:"#fff" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} *{box-sizing:border-box} ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-thumb{background:#333}`}</style>

      {/* ── 헤더 + 검색창 ── */}
      <div style={{ background:"rgba(255,255,255,0.03)", borderBottom:"1px solid rgba(255,255,255,0.06)", padding:"20px 24px" }}>
        <div style={{ maxWidth:1600, margin:"0 auto", display:"flex", alignItems:"center", gap:20 }}>
          <div>
            <div style={{ fontSize:18, fontWeight:800 }}>🔍 트렌드 & 쇼핑 통합 검색</div>
            <div style={{ fontSize:11, color:"#555", marginTop:2 }}>YouTube · 네이버 쇼핑 · 키워드 · 통합 분석</div>
          </div>
          <div style={{ flex:1 }}>
            <SearchBox onSearch={handleSearch} loading={loadingYT||loadingNV||loadingKW||loadingAN} />
          </div>
        </div>
      </div>

      {/* ── 메인 콘텐츠 ── */}
      {searched && (
        <div style={{ maxWidth:1600, margin:"0 auto", padding:"16px 24px 40px", display:"grid", gridTemplateColumns:"300px 1fr 320px", gridTemplateRows:"auto auto", gap:16 }}>

          {/* ── 왼쪽: 키워드 TOP10 ── */}
          <div style={{ gridColumn:"1", gridRow:"1 / 3", background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:14, padding:16, height:"fit-content" }}>
            <SectionTitle icon="🔥" title="관심 키워드 TOP10" loading={loadingKW} color="#ff8800" cache={cacheHit.kw} />
            {kwError && <ErrBox msg={kwError} />}
            {loadingKW && <LoadBox color="#ff8800" text="분석 중..." />}
            {!loadingKW && keywords.length > 0 && (
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                {keywords.map((item, i) => (
                  <div key={i} style={{ background:i<3?"rgba(255,136,0,0.07)":"rgba(255,255,255,0.02)", border:i<3?"1px solid rgba(255,136,0,0.15)":"1px solid rgba(255,255,255,0.04)", borderRadius:8, padding:"8px 10px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4 }}>
                      <div style={{ flexShrink:0, width:20, height:20, borderRadius:5,
                        background: i===0?"linear-gradient(135deg,#ffd700,#ff8800)":i===1?"linear-gradient(135deg,#c0c0c0,#888)":i===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)",
                        display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:900, color:i<3?"#000":"#555"
                      }}>{i+1}</div>
                      <span style={{ fontSize:13, fontWeight:700, color:"#fff", flex:1 }}>{item.keyword}</span>
                      <span style={{ fontSize:12, fontWeight:800, color:"#ff8800" }}>{item.count}</span>
                    </div>
                    <div style={{ height:2, background:"#1a1a1a", borderRadius:99 }}>
                      <div style={{ height:"100%", borderRadius:99, width:`${Math.round((item.count/keywords[0].count)*100)}%`, background:"linear-gradient(90deg,#ff880066,#ff8800)" }} />
                    </div>
                    <div style={{ fontSize:10, color:"#555", marginTop:3 }}>{item.reason}</div>
                  </div>
                ))}
              </div>
            )}
            {!loadingKW && keywords.length === 0 && !kwError && <EmptyBox text="결과 없음" />}
          </div>

          {/* ── 가운데 상단: YouTube ── */}
          <div style={{ gridColumn:"2", gridRow:"1", background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:14, padding:16 }}>
            <SectionTitle icon="📺" title="YouTube 트렌드" loading={loadingYT} color="#ff4444" cache={cacheHit.yt} />
            {ytError && <ErrBox msg={ytError} />}
            {loadingYT && <LoadBox color="#ff4444" text="유튜브 분석 중..." />}
            {!loadingYT && videos.length > 0 && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {[...videos].sort((a,b) => b.trendScore - a.trendScore).map((v, i) => (
                  <div key={v.id} onClick={() => window.open(v.url, "_blank")}
                    style={{ background:i===0?"rgba(255,34,34,0.07)":"rgba(255,255,255,0.02)", border:i===0?"1px solid rgba(255,34,34,0.2)":"1px solid rgba(255,255,255,0.04)", borderRadius:10, padding:10, cursor:"pointer", display:"flex", gap:8 }}
                    onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,0.06)"}
                    onMouseLeave={e => e.currentTarget.style.background=i===0?"rgba(255,34,34,0.07)":"rgba(255,255,255,0.02)"}>
                    <div style={{ position:"relative", flexShrink:0 }}>
                      <img src={v.thumbnail} alt="" style={{ width:88, height:50, objectFit:"cover", borderRadius:5, display:"block" }} />
                      <div style={{ position:"absolute", top:2, left:2, background:i<3?"linear-gradient(135deg,#ff2222,#880000)":"rgba(0,0,0,0.75)", borderRadius:3, padding:"1px 4px", fontSize:9, fontWeight:800 }}>#{i+1}</div>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:600, fontSize:11, lineHeight:1.4, marginBottom:3, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{v.title}</div>
                      <div style={{ fontSize:10, color:"#ff8888", marginBottom:3 }}>📢 {v.channel}</div>
                      <div style={{ display:"flex", gap:6, marginBottom:4 }}>
                        <span style={{ fontSize:9, color:"#aaa" }}>👁 <b style={{ color:"#fff" }}>{fmtNum(v.viewCount)}</b></span>
                        <span style={{ fontSize:9, color:"#555" }}>📅 {dayAgo(v.publishedAt)}</span>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                        <div style={{ flex:1, height:2, background:"#1e1e1e", borderRadius:99 }}>
                          <div style={{ height:"100%", borderRadius:99, width:`${v.trendScore}%`, background:`linear-gradient(90deg,${tColor(v.trendScore)}66,${tColor(v.trendScore)})` }} />
                        </div>
                        <span style={{ fontSize:9, fontWeight:800, color:tColor(v.trendScore) }}>{v.trendScore}점</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!loadingYT && !ytError && videos.length === 0 && <EmptyBox text="48시간 이내 영상 없음" />}
          </div>

          {/* ── 가운데 하단: 통합 분석 ── */}
          <div style={{ gridColumn:"2", gridRow:"2", background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:14, padding:16 }}>
            <IntegratedAnalysis result={analysisResult} loading={loadingAN} error={anError} keyword={keyword} />
          </div>

          {/* ── 오른쪽: 네이버 쇼핑 ── */}
          <div style={{ gridColumn:"3", gridRow:"1 / 3", background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:14, padding:16, height:"fit-content" }}>
            <SectionTitle icon="🛍" title="네이버 쇼핑" loading={loadingNV} color="#03c75a" cache={cacheHit.nv} />
            {shoppingKeyword && !loadingNV && (
              <div style={{ marginBottom:10, padding:"5px 9px", background:"rgba(3,199,90,0.06)", border:"1px solid rgba(3,199,90,0.15)", borderRadius:6, fontSize:11, color:"#4a9a6a" }}>
                🔑 <b style={{ color:"#03c75a" }}>{shoppingKeyword}</b>
                {shoppingKeyword !== keyword && <span style={{ color:"#2a5a3a" }}> (원본: {keyword})</span>}
              </div>
            )}
            {nvError && <ErrBox msg={nvError} />}
            {loadingNV && <LoadBox color="#03c75a" text="쇼핑 검색 중..." />}
            {!loadingNV && products.length > 0 && (
              <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                {products.map((p, i) => (
                  <div key={i} onClick={() => p.url && window.open(p.url, "_blank")}
                    style={{ background:"rgba(3,199,90,0.04)", border:"1px solid rgba(3,199,90,0.12)", borderRadius:10, padding:10, cursor:p.url?"pointer":"default" }}
                    onMouseEnter={e => e.currentTarget.style.background="rgba(3,199,90,0.09)"}
                    onMouseLeave={e => e.currentTarget.style.background="rgba(3,199,90,0.04)"}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ fontSize:9, color:"#03c75a", fontWeight:700 }}>#{i+1}</span>
                      {p.url && <span style={{ fontSize:10, color:"#444" }}>↗</span>}
                    </div>
                    <div style={{ fontWeight:600, fontSize:11, lineHeight:1.4, marginBottom:4, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
                      {p.name?.replace(/<[^>]*>/g,"")}
                    </div>
                    <div style={{ fontSize:14, fontWeight:900, color:"#03c75a", marginBottom:3 }}>{p.price ? parseInt(p.price).toLocaleString()+"원" : "-"}</div>
                    <div style={{ fontSize:10, color:"#555" }}>🏪 {p.mall}</div>
                    {p.reason && <div style={{ fontSize:10, color:"#4a9a6a", marginTop:5, padding:"4px 7px", background:"rgba(3,199,90,0.05)", borderRadius:5 }}>💡 {p.reason}</div>}
                  </div>
                ))}
              </div>
            )}
            {!loadingNV && !nvError && products.length === 0 && <EmptyBox text="상품 결과 없음" />}

            {!loadingNV && products.length > 0 && (
              <div style={{ marginTop:12 }}>
                <NaverAnalysis products={products} />
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
