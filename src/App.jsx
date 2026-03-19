import { useState } from "react";
import SearchBox from "./components/SearchBox";
import NaverAnalysis from "./components/NaverAnalysis";
import IntegratedAnalysis from "./components/IntegratedAnalysis";
import MoneyEngine from "./components/MoneyEngine";
import AutoRecommend from "./components/AutoRecommend";
import { fetchYouTube } from "./api/youtube";
import { extractShoppingKeyword, fetchNaverProducts } from "./api/naver";
import { fetchNaverKeywords } from "./api/keyword";
import { analyzeKeywords } from "./api/analyze";
import { runMoneyEngine } from "./api/moneyEngine";

const fmtNum = n => { if(!n) return"-"; const x=parseInt(n); if(x>=100000000) return(x/100000000).toFixed(1)+"억"; if(x>=10000) return Math.floor(x/10000)+"만"; if(x>=1000) return(x/1000).toFixed(1)+"천"; return x.toLocaleString(); };
const dayAgo = iso => { if(!iso) return""; const d=Math.floor((Date.now()-new Date(iso))/86400000); if(d===0)return"오늘"; if(d<7)return`${d}일 전`; if(d<30)return`${Math.floor(d/7)}주 전`; return`${Math.floor(d/30)}개월 전`; };
const tColor = s => s>=80?"#ff2222":s>=60?"#ff8800":s>=40?"#ffcc00":"#4488ff";

const Spinner = ({ color, size=14 }) => (
  <div style={{ display:"inline-block", width:size, height:size, border:`2px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite", flexShrink:0 }} />
);
const LoadBox = ({ color, text }) => (
  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8, padding:20, color:"#555", fontSize:12 }}>
    <Spinner color={color} size={20} />{text}
  </div>
);
const ErrBox = ({ msg }) => (
  <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:7, padding:"8px 10px", color:"#ff8888", fontSize:11, marginBottom:8 }}>⚠️ {msg}</div>
);
const EmptyBox = ({ text }) => (
  <div style={{ textAlign:"center", color:"#444", fontSize:11, padding:14 }}>{text}</div>
);
const SectionTitle = ({ icon, title, loading, color, cache }) => (
  <div style={{ fontSize:12, fontWeight:700, color:"#888", marginBottom:10, display:"flex", alignItems:"center", gap:6, borderBottom:"1px solid rgba(255,255,255,0.06)", paddingBottom:8 }}>
    {icon} {title}
    {loading && <Spinner color={color} size={12} />}
    {cache && <span style={{ fontSize:9, color:"#ffaa00" }}>⚡캐시</span>}
  </div>
);

export default function App() {
  const ytApiKey = import.meta.env.VITE_YOUTUBE_API_KEY;

  const [keyword, setKeyword]               = useState("");
  const [videos, setVideos]                 = useState([]);
  const [products, setProducts]             = useState([]);
  const [keywords, setKeywords]             = useState([]);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [engineResult, setEngineResult]     = useState(null);
  const [shoppingKeyword, setShoppingKeyword] = useState("");
  const [loadingYT, setLoadingYT]           = useState(false);
  const [loadingNV, setLoadingNV]           = useState(false);
  const [loadingKW, setLoadingKW]           = useState(false);
  const [loadingAN, setLoadingAN]           = useState(false);
  const [loadingEN, setLoadingEN]           = useState(false);
  const [ytError, setYtError]               = useState("");
  const [nvError, setNvError]               = useState("");
  const [kwError, setKwError]               = useState("");
  const [anError, setAnError]               = useState("");
  const [enError, setEnError]               = useState("");
  const [searched, setSearched]             = useState(false);
  const [cacheHit, setCacheHit]             = useState({ yt:false, nv:false });
  const [activeTab, setActiveTab]           = useState("auto");

  const handleSearch = async ({ keyword: kw, apiKey: ak }) => {
    setKeyword(kw);
    setVideos([]); setProducts([]); setKeywords([]);
    setAnalysisResult(null); setEngineResult(null); setShoppingKeyword("");
    setYtError(""); setNvError(""); setKwError(""); setAnError(""); setEnError("");
    setSearched(true); setCacheHit({ yt:false, nv:false });
    setLoadingYT(true); setLoadingNV(true); setLoadingKW(true); setLoadingAN(true); setLoadingEN(true);

    let ytVideos = [];
    try {
      const { videos: v, fromCache } = await fetchYouTube(kw, ak || ytApiKey);
      ytVideos = v; setVideos(v);
      setCacheHit(p => ({ ...p, yt: fromCache }));
    } catch (e) {
      const msg = e.message||"";
      setYtError(msg.includes("403")?"API 키 권한 없음":msg.includes("400")?"API 키 오류":"YouTube 오류: "+msg);
    } finally { setLoadingYT(false); }

    let derivedKw = kw;
    try {
      if (ytVideos.length > 0) derivedKw = await extractShoppingKeyword(kw, ytVideos.map(v=>v.title));
    } catch { derivedKw = kw; }
    setShoppingKeyword(derivedKw);

    await Promise.all([
      (async () => {
        try {
          const { products: p, fromCache } = await fetchNaverProducts(derivedKw);
          if (!Array.isArray(p)||!p.length) setNvError("검색된 상품 없음");
          else { setProducts(p); setCacheHit(prev=>({...prev, nv:fromCache})); }
        } catch (e) { setNvError("쇼핑 오류: "+(e.message||"")); }
        finally { setLoadingNV(false); }
      })(),
      (async () => {
        try {
          const { keywords: k } = await fetchNaverKeywords(kw);
          if (!Array.isArray(k)||!k.length) setKwError("키워드 결과 없음");
          else setKeywords(k);
        } catch (e) { setKwError("키워드 오류: "+(e.message||"")); }
        finally { setLoadingKW(false); }
      })(),
      (async () => {
        try {
          if (!ytVideos.length) { setAnError("유튜브 영상 없음"); return; }
          const { result } = await analyzeKeywords(ytVideos.map(v=>v.title), kw);
          setAnalysisResult(result);
        } catch (e) { setAnError("통합 분석 오류: "+(e.message||"")); }
        finally { setLoadingAN(false); }
      })(),
      (async () => {
        try {
          const { result } = await runMoneyEngine(kw, ak || ytApiKey);
          setEngineResult(result);
        } catch (e) { setEnError("엔진 오류: "+(e.message||"")); }
        finally { setLoadingEN(false); }
      })()
    ]);
  };

  const TABS = [
    { val:"auto",    label:"🤖 자동추천" },
    { val:"youtube", label:"📺 유튜브 & 쇼핑" },
    { val:"engine",  label:"🚀 키워드 엔진" },
  ];

  return (
    <div style={{ minHeight:"100vh", background:"#0c0c0f", fontFamily:"'Segoe UI',sans-serif", color:"#fff" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} *{box-sizing:border-box}`}</style>

      {/* 헤더 */}
      <div style={{ background:"rgba(255,255,255,0.03)", borderBottom:"1px solid rgba(255,255,255,0.06)", padding:"14px 24px" }}>
        <div style={{ maxWidth:1600, margin:"0 auto", display:"flex", alignItems:"center", gap:20 }}>
          <div style={{ flexShrink:0 }}>
            <div style={{ fontSize:15, fontWeight:800 }}>🔍 트렌드 & 쇼핑 통합 검색</div>
            <div style={{ fontSize:10, color:"#555", marginTop:1 }}>YouTube · 네이버 · 키워드 엔진</div>
          </div>
          <div style={{ flex:1 }}>
            <SearchBox onSearch={handleSearch} loading={loadingYT||loadingNV||loadingKW||loadingAN||loadingEN} />
          </div>
        </div>
      </div>

      <div style={{ maxWidth:1600, margin:"0 auto", padding:"14px 24px 40px" }}>

        {/* 탭 */}
        <div style={{ display:"flex", gap:4, marginBottom:14, background:"rgba(255,255,255,0.03)", borderRadius:10, padding:4, width:"fit-content" }}>
          {TABS.map(t => (
            <button key={t.val} onClick={() => setActiveTab(t.val)} style={{
              padding:"8px 18px", borderRadius:7, border:"none", fontSize:12, cursor:"pointer",
              fontWeight: activeTab===t.val?700:400,
              background: activeTab===t.val?"rgba(255,255,255,0.1)":"transparent",
              color: activeTab===t.val?"#fff":"#555"
            }}>{t.label}</button>
          ))}
        </div>

        {/* ── 자동추천 탭 ── */}
        {activeTab==="auto" && (
          <AutoRecommend apiKey={ytApiKey} />
        )}

        {/* ── 유튜브 & 쇼핑 탭 ── */}
        {activeTab==="youtube" && searched && (
          <div style={{ display:"grid", gridTemplateColumns:"280px 1fr 300px", gap:14, alignItems:"start" }}>

            {/* 왼쪽: 관심 키워드 */}
            <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:12, padding:14 }}>
              <SectionTitle icon="🔥" title="관심 키워드 TOP10" loading={loadingKW} color="#ff8800" />
              {kwError && <ErrBox msg={kwError} />}
              {loadingKW && <LoadBox color="#ff8800" text="분석 중..." />}
              {!loadingKW && keywords.length > 0 && (
                <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  {keywords.map((item, i) => (
                    <div key={i} style={{ background:i<3?"rgba(255,136,0,0.07)":"rgba(255,255,255,0.02)", border:i<3?"1px solid rgba(255,136,0,0.12)":"1px solid rgba(255,255,255,0.04)", borderRadius:7, padding:"7px 9px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
                        <div style={{ flexShrink:0, width:18, height:18, borderRadius:4,
                          background:i===0?"linear-gradient(135deg,#ffd700,#ff8800)":i===1?"linear-gradient(135deg,#c0c0c0,#888)":i===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)",
                          display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:i<3?"#000":"#555"
                        }}>{i+1}</div>
                        <span style={{ fontSize:12, fontWeight:700, color:"#fff", flex:1 }}>{item.keyword}</span>
                        <span style={{ fontSize:11, fontWeight:800, color:"#ff8800" }}>{item.count}</span>
                      </div>
                      <div style={{ height:2, background:"#1a1a1a", borderRadius:99 }}>
                        <div style={{ height:"100%", borderRadius:99, width:`${Math.round((item.count/keywords[0].count)*100)}%`, background:"linear-gradient(90deg,#ff880055,#ff8800)" }} />
                      </div>
                      <div style={{ fontSize:10, color:"#555", marginTop:3 }}>{item.reason}</div>
                    </div>
                  ))}
                </div>
              )}
              {!loadingKW && !kwError && !keywords.length && <EmptyBox text="결과 없음" />}
            </div>

            {/* 가운데: YouTube + 통합분석 */}
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:12, padding:14 }}>
                <SectionTitle icon="📺" title="YouTube 트렌드" loading={loadingYT} color="#ff4444" cache={cacheHit.yt} />
                {ytError && <ErrBox msg={ytError} />}
                {loadingYT && <LoadBox color="#ff4444" text="분석 중..." />}
                {!loadingYT && videos.length > 0 && (
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    {[...videos].sort((a,b)=>b.trendScore-a.trendScore).map((v,i) => (
                      <div key={v.id} onClick={()=>window.open(v.url,"_blank")}
                        style={{ background:i===0?"rgba(255,34,34,0.07)":"rgba(255,255,255,0.02)", border:i===0?"1px solid rgba(255,34,34,0.18)":"1px solid rgba(255,255,255,0.04)", borderRadius:9, padding:9, cursor:"pointer", display:"flex", gap:8 }}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
                        onMouseLeave={e=>e.currentTarget.style.background=i===0?"rgba(255,34,34,0.07)":"rgba(255,255,255,0.02)"}>
                        <div style={{ position:"relative", flexShrink:0 }}>
                          <img src={v.thumbnail} alt="" style={{ width:84, height:47, objectFit:"cover", borderRadius:5, display:"block" }} />
                          <div style={{ position:"absolute", top:2, left:2, background:i<3?"linear-gradient(135deg,#ff2222,#880000)":"rgba(0,0,0,0.75)", borderRadius:3, padding:"1px 4px", fontSize:8, fontWeight:800 }}>#{i+1}</div>
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:600, fontSize:11, lineHeight:1.4, marginBottom:3, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{v.title}</div>
                          <div style={{ fontSize:9, color:"#ff8888", marginBottom:2 }}>📢 {v.channel}</div>
                          <div style={{ display:"flex", gap:6, marginBottom:3 }}>
                            <span style={{ fontSize:9, color:"#aaa" }}>👁 <b style={{ color:"#fff" }}>{fmtNum(v.viewCount)}</b></span>
                            <span style={{ fontSize:9, color:"#555" }}>📅 {dayAgo(v.publishedAt)}</span>
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                            <div style={{ flex:1, height:2, background:"#1e1e1e", borderRadius:99 }}>
                              <div style={{ height:"100%", borderRadius:99, width:`${v.trendScore}%`, background:`linear-gradient(90deg,${tColor(v.trendScore)}55,${tColor(v.trendScore)})` }} />
                            </div>
                            <span style={{ fontSize:9, fontWeight:800, color:tColor(v.trendScore) }}>{v.trendScore}점</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!loadingYT && !ytError && !videos.length && <EmptyBox text="48시간 이내 영상 없음" />}
              </div>

              <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:12, padding:14 }}>
                <IntegratedAnalysis result={analysisResult} loading={loadingAN} error={anError} keyword={keyword} />
              </div>
            </div>

            {/* 오른쪽: 네이버 쇼핑 */}
            <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:12, padding:14 }}>
              <SectionTitle icon="🛍" title="네이버 쇼핑" loading={loadingNV} color="#03c75a" cache={cacheHit.nv} />
              {shoppingKeyword && !loadingNV && (
                <div style={{ marginBottom:8, padding:"4px 8px", background:"rgba(3,199,90,0.06)", border:"1px solid rgba(3,199,90,0.12)", borderRadius:5, fontSize:10, color:"#4a9a6a" }}>
                  🔑 <b style={{ color:"#03c75a" }}>{shoppingKeyword}</b>
                  {shoppingKeyword!==keyword && <span style={{ color:"#2a5a3a" }}> (원본: {keyword})</span>}
                </div>
              )}
              {nvError && <ErrBox msg={nvError} />}
              {loadingNV && <LoadBox color="#03c75a" text="검색 중..." />}
              {!loadingNV && products.length > 0 && (
                <>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {products.map((p,i) => (
                      <div key={i} onClick={()=>p.url&&window.open(p.url,"_blank")}
                        style={{ background:"rgba(3,199,90,0.04)", border:"1px solid rgba(3,199,90,0.1)", borderRadius:9, padding:9, cursor:p.url?"pointer":"default" }}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(3,199,90,0.09)"}
                        onMouseLeave={e=>e.currentTarget.style.background="rgba(3,199,90,0.04)"}>
                        <div style={{ fontWeight:600, fontSize:11, lineHeight:1.4, marginBottom:3, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
                          {p.name?.replace(/<[^>]*>/g,"")}
                        </div>
                        <div style={{ fontSize:13, fontWeight:900, color:"#03c75a", marginBottom:2 }}>{p.price?parseInt(p.price).toLocaleString()+"원":"-"}</div>
                        <div style={{ fontSize:10, color:"#555" }}>🏪 {p.mall}</div>
                        {p.reason && <div style={{ fontSize:10, color:"#4a9a6a", marginTop:4, padding:"3px 6px", background:"rgba(3,199,90,0.05)", borderRadius:4 }}>💡 {p.reason}</div>}
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop:10 }}><NaverAnalysis products={products} /></div>
                </>
              )}
              {!loadingNV && !nvError && !products.length && <EmptyBox text="상품 없음" />}
            </div>
          </div>
        )}

        {activeTab==="youtube" && !searched && (
          <div style={{ textAlign:"center", color:"#333", fontSize:13, padding:60 }}>키워드를 검색하면 결과가 표시됩니다.</div>
        )}

        {/* ── 키워드 엔진 탭 ── */}
        {activeTab==="engine" && searched && (
          <div style={{ maxWidth:900, margin:"0 auto" }}>
            <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:12, padding:16 }}>
              <MoneyEngine result={engineResult} loading={loadingEN} error={enError} />
            </div>
          </div>
        )}

        {activeTab==="engine" && !searched && (
          <div style={{ textAlign:"center", color:"#333", fontSize:13, padding:60 }}>키워드를 검색하면 결과가 표시됩니다.</div>
        )}

      </div>
    </div>
  );
}
