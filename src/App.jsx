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

// ── 유틸 ──────────────────────────────────────────
const fmtNum = n => { if(!n) return"-"; const x=parseInt(n); if(x>=100000000) return(x/100000000).toFixed(1)+"억"; if(x>=10000) return Math.floor(x/10000)+"만"; if(x>=1000) return(x/1000).toFixed(1)+"천"; return x.toLocaleString(); };
const dayAgo = iso => { if(!iso) return""; const d=Math.floor((Date.now()-new Date(iso))/86400000); if(d===0)return"오늘"; if(d<7)return`${d}일 전`; if(d<30)return`${Math.floor(d/7)}주 전`; return`${Math.floor(d/30)}개월 전`; };
const tColor = s => s>=80?"#ff2222":s>=60?"#ff8800":s>=40?"#ffcc00":"#4488ff";

// ── 공통 컴포넌트 ──────────────────────────────────
const Spinner = ({ color, size=14 }) => (
  <div style={{ display:"inline-block", width:size, height:size, border:`2px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite", flexShrink:0 }} />
);
const LoadBox = ({ color, text }) => (
  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8, padding:32, color:"#555", fontSize:12 }}>
    <Spinner color={color} size={22} />{text}
  </div>
);
const ErrBox = ({ msg }) => (
  <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:7, padding:"8px 10px", color:"#ff8888", fontSize:11, marginBottom:8 }}>⚠️ {msg}</div>
);
const EmptyBox = ({ text }) => (
  <div style={{ textAlign:"center", color:"#333", fontSize:12, padding:40 }}>{text}</div>
);
const Card = ({ children, style }) => (
  <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:14, padding:16, ...style }}>{children}</div>
);
const SectionTitle = ({ icon, title, loading, color, cache, sub }) => (
  <div style={{ marginBottom:12, borderBottom:"1px solid rgba(255,255,255,0.06)", paddingBottom:10 }}>
    <div style={{ fontSize:13, fontWeight:700, color:"#ccc", display:"flex", alignItems:"center", gap:6 }}>
      {icon} {title}
      {loading && <Spinner color={color} size={12} />}
      {cache && <span style={{ fontSize:9, color:"#ffaa00", marginLeft:2 }}>⚡캐시</span>}
    </div>
    {sub && <div style={{ fontSize:10, color:"#444", marginTop:3 }}>{sub}</div>}
  </div>
);

// ── 설정 패널 ──────────────────────────────────────
const SettingsPanel = ({ settings, onChange }) => {
  const Row = ({ label, sub, children }) => (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
      <div>
        <div style={{ fontSize:13, color:"#ccc" }}>{label}</div>
        {sub && <div style={{ fontSize:10, color:"#444", marginTop:2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
  const Toggle = ({ val, onToggle }) => (
    <div onClick={onToggle} style={{ width:40, height:22, borderRadius:11, background:val?"#03c75a":"#222", cursor:"pointer", position:"relative", transition:"background 0.2s", border:`1px solid ${val?"#03c75a33":"#333"}` }}>
      <div style={{ position:"absolute", top:2, left:val?20:2, width:16, height:16, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
    </div>
  );
  const Select = ({ val, options, onSelect }) => (
    <select value={val} onChange={e=>onSelect(e.target.value)} style={{ background:"#1a1a1a", border:"1px solid #333", borderRadius:6, color:"#ccc", fontSize:11, padding:"4px 8px", cursor:"pointer" }}>
      {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  return (
    <div style={{ maxWidth:640, margin:"0 auto", display:"flex", flexDirection:"column", gap:14 }}>
      <Card>
        <SectionTitle icon="🤖" title="자동 실행 설정" color="#ffd700" />
        <Row label="자동 추천 실행" sub="앱 로드 시 자동으로 추천 분석 시작">
          <Toggle val={settings.autoRun} onToggle={()=>onChange("autoRun", !settings.autoRun)} />
        </Row>
        <Row label="YouTube 트렌드 포함" sub="YouTube 데이터 수집 (API 쿼터 소모)">
          <Toggle val={settings.useYoutube} onToggle={()=>onChange("useYoutube", !settings.useYoutube)} />
        </Row>
        <Row label="결과 갱신 주기" sub="자동 추천 주기적 갱신">
          <Select val={settings.refreshInterval} onSelect={v=>onChange("refreshInterval", v)} options={[
            { value:"off", label:"수동" }, { value:"30", label:"30분" }, { value:"60", label:"1시간" }, { value:"180", label:"3시간" }
          ]} />
        </Row>
      </Card>

      <Card>
        <SectionTitle icon="🎯" title="필터 조건 설정" color="#4488ff" />
        <Row label="최소 구매 의도 점수" sub="이 점수 미만 키워드 제외">
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <input type="range" min={0} max={80} step={5} value={settings.minPurchaseIntent}
              onChange={e=>onChange("minPurchaseIntent", parseInt(e.target.value))}
              style={{ width:100, accentColor:"#4488ff" }} />
            <span style={{ fontSize:12, color:"#4488ff", fontWeight:700, width:28 }}>{settings.minPurchaseIntent}</span>
          </div>
        </Row>
        <Row label="최대 경쟁도" sub="이 점수 초과 키워드 제외 (낮을수록 블루오션)">
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <input type="range" min={10} max={100} step={5} value={settings.maxCompetition}
              onChange={e=>onChange("maxCompetition", parseInt(e.target.value))}
              style={{ width:100, accentColor:"#ff8800" }} />
            <span style={{ fontSize:12, color:"#ff8800", fontWeight:700, width:28 }}>{settings.maxCompetition}</span>
          </div>
        </Row>
        <Row label="추천 결과 수" sub="TOP N 표시">
          <Select val={settings.topN} onSelect={v=>onChange("topN", parseInt(v))} options={[
            { value:"3", label:"TOP 3" }, { value:"5", label:"TOP 5" }, { value:"10", label:"TOP 10" }
          ]} />
        </Row>
        <Row label="트렌드 상태 필터" sub="특정 트렌드 상태만 표시">
          <Select val={settings.trendFilter} onSelect={v=>onChange("trendFilter", v)} options={[
            { value:"all", label:"전체" }, { value:"급상승", label:"급상승만" }, { value:"상승", label:"상승 이상" }
          ]} />
        </Row>
      </Card>

      <Card>
        <SectionTitle icon="📐" title="데이터 기준 설정" color="#aa44ff" />
        <Row label="가격 범위" sub="분석 대상 상품 가격 범위">
          <Select val={settings.priceRange} onSelect={v=>onChange("priceRange", v)} options={[
            { value:"all", label:"전체" }, { value:"low", label:"1만원 미만" },
            { value:"mid", label:"1만~10만원" }, { value:"high", label:"10만원 이상" }
          ]} />
        </Row>
        <Row label="트렌드 수집 기간" sub="YouTube 영상 기준 시간">
          <Select val={settings.trendWindow} onSelect={v=>onChange("trendWindow", v)} options={[
            { value:"24", label:"24시간" }, { value:"48", label:"48시간" }, { value:"72", label:"72시간" }
          ]} />
        </Row>
        <Row label="분석 깊이" sub="수집 키워드 수 (많을수록 느림)">
          <Select val={settings.depth} onSelect={v=>onChange("depth", v)} options={[
            { value:"fast", label:"빠름 (10개)" }, { value:"normal", label:"보통 (18개)" }, { value:"deep", label:"정밀 (25개)" }
          ]} />
        </Row>
      </Card>

      <div style={{ fontSize:10, color:"#333", textAlign:"center", paddingBottom:8 }}>
        설정은 다음 분석 실행 시 적용됩니다
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════
// 메인 App
// ══════════════════════════════════════════════════
export default function App() {
  const ytApiKey = import.meta.env.VITE_YOUTUBE_API_KEY;

  // ── 검색 상태 ──
  const [keyword, setKeyword]                 = useState("");
  const [videos, setVideos]                   = useState([]);
  const [products, setProducts]               = useState([]);
  const [keywords, setKeywords]               = useState([]);
  const [analysisResult, setAnalysisResult]   = useState(null);
  const [engineResult, setEngineResult]       = useState(null);
  const [shoppingKeyword, setShoppingKeyword] = useState("");
  const [loadingYT, setLoadingYT]             = useState(false);
  const [loadingNV, setLoadingNV]             = useState(false);
  const [loadingKW, setLoadingKW]             = useState(false);
  const [loadingAN, setLoadingAN]             = useState(false);
  const [loadingEN, setLoadingEN]             = useState(false);
  const [ytError, setYtError]                 = useState("");
  const [nvError, setNvError]                 = useState("");
  const [kwError, setKwError]                 = useState("");
  const [anError, setAnError]                 = useState("");
  const [enError, setEnError]                 = useState("");
  const [searched, setSearched]               = useState(false);
  const [cacheHit, setCacheHit]               = useState({ yt:false, nv:false });
  const [activeTab, setActiveTab]             = useState("home");

  // ── 설정 상태 ──
  const [settings, setSettings] = useState({
    autoRun: false,
    useYoutube: true,
    refreshInterval: "off",
    minPurchaseIntent: 30,
    maxCompetition: 90,
    topN: 5,
    trendFilter: "all",
    priceRange: "all",
    trendWindow: "48",
    depth: "normal",
  });
  const updateSetting = (key, val) => setSettings(p => ({ ...p, [key]: val }));

  // ── 검색 핸들러 ──
  const handleSearch = async ({ keyword: kw, apiKey: ak }) => {
    setKeyword(kw);
    setVideos([]); setProducts([]); setKeywords([]);
    setAnalysisResult(null); setEngineResult(null); setShoppingKeyword("");
    setYtError(""); setNvError(""); setKwError(""); setAnError(""); setEnError("");
    setSearched(true); setCacheHit({ yt:false, nv:false });
    setLoadingYT(true); setLoadingNV(true); setLoadingKW(true); setLoadingAN(true); setLoadingEN(true);

    // 키워드 탭으로 자동 이동
    setActiveTab("keyword");

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

  const anyLoading = loadingYT||loadingNV||loadingKW||loadingAN||loadingEN;

  // ── 탭 정의 ──
  const TABS = [
    { val:"home",    icon:"🔥", label:"실시간 추천" },
    { val:"keyword", icon:"📊", label:"키워드 분석" },
    { val:"product", icon:"💰", label:"상품 분석" },
    { val:"oppo",    icon:"🚀", label:"기회 포착" },
    { val:"setting", icon:"⚙️", label:"설정" },
  ];

  // ── 탭별 로딩 인디케이터 ──
  const tabLoading = {
    keyword: loadingYT||loadingKW||loadingAN,
    product: loadingNV,
    oppo:    loadingEN,
  };

  return (
    <div style={{ minHeight:"100vh", background:"#0c0c0f", fontFamily:"'Segoe UI',sans-serif", color:"#fff" }}>
      <style>{`
        @keyframes spin { to { transform:rotate(360deg) } }
        * { box-sizing:border-box }
        ::-webkit-scrollbar { width:4px; height:4px }
        ::-webkit-scrollbar-track { background:#111 }
        ::-webkit-scrollbar-thumb { background:#2a2a2a; border-radius:4px }
      `}</style>

      {/* ── 헤더 ── */}
      <div style={{ background:"rgba(255,255,255,0.025)", borderBottom:"1px solid rgba(255,255,255,0.06)", padding:"12px 24px", position:"sticky", top:0, zIndex:100, backdropFilter:"blur(12px)" }}>
        <div style={{ maxWidth:1600, margin:"0 auto", display:"flex", alignItems:"center", gap:20 }}>
          <div style={{ flexShrink:0 }}>
            <div style={{ fontSize:14, fontWeight:800, letterSpacing:"-0.3px" }}>📦 트렌드 레이더</div>
            <div style={{ fontSize:9, color:"#444", marginTop:1 }}>YouTube · 네이버 실시간 분석</div>
          </div>
          <div style={{ flex:1 }}>
            <SearchBox onSearch={handleSearch} loading={anyLoading} />
          </div>
          {searched && (
            <div style={{ flexShrink:0, fontSize:11, color:"#03c75a", background:"rgba(3,199,90,0.08)", border:"1px solid rgba(3,199,90,0.15)", borderRadius:6, padding:"4px 10px" }}>
              🔑 {keyword}
            </div>
          )}
        </div>
      </div>

      {/* ── 탭 네비게이션 ── */}
      <div style={{ background:"rgba(255,255,255,0.015)", borderBottom:"1px solid rgba(255,255,255,0.05)", padding:"0 24px" }}>
        <div style={{ maxWidth:1600, margin:"0 auto", display:"flex", gap:0 }}>
          {TABS.map(t => {
            const isActive = activeTab === t.val;
            const isLoading = tabLoading[t.val] && searched;
            return (
              <button key={t.val} onClick={() => setActiveTab(t.val)} style={{
                padding:"12px 20px", border:"none", background:"transparent", cursor:"pointer",
                fontSize:12, fontWeight: isActive ? 700 : 400,
                color: isActive ? "#fff" : "#555",
                borderBottom: isActive ? "2px solid #ffd700" : "2px solid transparent",
                transition:"all 0.15s",
                display:"flex", alignItems:"center", gap:6,
                position:"relative"
              }}>
                {t.icon} {t.label}
                {isLoading && <Spinner color="#ffd700" size={10} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 본문 ── */}
      <div style={{ maxWidth:1600, margin:"0 auto", padding:"18px 24px 60px" }}>

        {/* ══ 홈: 실시간 추천 ══ */}
        {activeTab === "home" && (
          <div>
            <div style={{ marginBottom:16, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontSize:18, fontWeight:800 }}>🔥 실시간 추천 상품</div>
                <div style={{ fontSize:11, color:"#555", marginTop:3 }}>YouTube · 네이버 블로그·뉴스·카페·쇼핑 데이터 기반 자동 분석</div>
              </div>
              {searched && (
                <button onClick={() => setActiveTab("keyword")} style={{ fontSize:11, color:"#ffd700", background:"rgba(255,215,0,0.07)", border:"1px solid rgba(255,215,0,0.2)", borderRadius:8, padding:"6px 14px", cursor:"pointer" }}>
                  📊 "{keyword}" 분석 결과 보기 →
                </button>
              )}
            </div>
            <AutoRecommend apiKey={ytApiKey} />
          </div>
        )}

        {/* ══ 키워드 분석 ══ */}
        {activeTab === "keyword" && (
          <div>
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:18, fontWeight:800 }}>📊 키워드 분석</div>
              <div style={{ fontSize:11, color:"#555", marginTop:3 }}>인기 키워드 · 검색 의도 · 트렌드 데이터</div>
            </div>
            {!searched ? (
              <EmptyBox text="상단 검색창에 키워드를 입력하면 분석 결과가 표시됩니다." />
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"300px 1fr", gap:14, alignItems:"start" }}>
                {/* 인기 키워드 */}
                <Card>
                  <SectionTitle icon="🔥" title="관심 키워드 TOP10" loading={loadingKW} color="#ff8800" sub="최근 48h 검색 빈도 기준" />
                  {kwError && <ErrBox msg={kwError} />}
                  {loadingKW && <LoadBox color="#ff8800" text="키워드 분석 중..." />}
                  {!loadingKW && keywords.length > 0 && (
                    <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                      {keywords.map((item, i) => (
                        <div key={i} style={{ background:i<3?"rgba(255,136,0,0.07)":"rgba(255,255,255,0.02)", border:i<3?"1px solid rgba(255,136,0,0.12)":"1px solid rgba(255,255,255,0.04)", borderRadius:8, padding:"8px 10px" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4 }}>
                            <div style={{ flexShrink:0, width:20, height:20, borderRadius:5,
                              background:i===0?"linear-gradient(135deg,#ffd700,#ff8800)":i===1?"linear-gradient(135deg,#c0c0c0,#888)":i===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)",
                              display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:i<3?"#000":"#555"
                            }}>{i+1}</div>
                            <span style={{ fontSize:12, fontWeight:700, color:"#fff", flex:1 }}>{item.keyword}</span>
                            <span style={{ fontSize:11, fontWeight:800, color:"#ff8800" }}>{item.count}</span>
                          </div>
                          <div style={{ height:2, background:"#1a1a1a", borderRadius:99 }}>
                            <div style={{ height:"100%", borderRadius:99, width:`${Math.round((item.count/keywords[0].count)*100)}%`, background:"linear-gradient(90deg,#ff880055,#ff8800)", transition:"width 0.6s" }} />
                          </div>
                          {item.reason && <div style={{ fontSize:10, color:"#555", marginTop:4 }}>{item.reason}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {!loadingKW && !kwError && !keywords.length && <EmptyBox text="키워드 없음" />}
                </Card>

                {/* YouTube 트렌드 + 통합분석 */}
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  <Card>
                    <SectionTitle icon="📺" title="YouTube 트렌드" loading={loadingYT} color="#ff4444" cache={cacheHit.yt} sub="최근 48h 조회수 기준 정렬" />
                    {ytError && <ErrBox msg={ytError} />}
                    {loadingYT && <LoadBox color="#ff4444" text="YouTube 분석 중..." />}
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
                              <div style={{ display:"flex", gap:6, marginBottom:4 }}>
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
                  </Card>

                  <Card>
                    <IntegratedAnalysis result={analysisResult} loading={loadingAN} error={anError} keyword={keyword} />
                  </Card>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ 상품 분석 ══ */}
        {activeTab === "product" && (
          <div>
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:18, fontWeight:800 }}>💰 상품 분석</div>
              <div style={{ fontSize:11, color:"#555", marginTop:3 }}>네이버 쇼핑 기반 가격 · 리뷰 · 경쟁도 분석</div>
            </div>
            {!searched ? (
              <EmptyBox text="상단 검색창에 키워드를 입력하면 분석 결과가 표시됩니다." />
            ) : (
              <div style={{ maxWidth:860, margin:"0 auto" }}>
                <Card>
                  <SectionTitle icon="🛍" title="네이버 쇼핑 분석" loading={loadingNV} color="#03c75a" cache={cacheHit.nv}
                    sub={shoppingKeyword && !loadingNV ? `검색 키워드: ${shoppingKeyword}${shoppingKeyword!==keyword?` (원본: ${keyword})`:""}`  : ""} />
                  {nvError && <ErrBox msg={nvError} />}
                  {loadingNV && <LoadBox color="#03c75a" text="쇼핑 데이터 분석 중..." />}
                  {!loadingNV && products.length > 0 && (
                    <>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:8, marginBottom:14 }}>
                        {products.map((p,i) => (
                          <div key={i} onClick={()=>p.url&&window.open(p.url,"_blank")}
                            style={{ background:"rgba(3,199,90,0.04)", border:"1px solid rgba(3,199,90,0.1)", borderRadius:9, padding:10, cursor:p.url?"pointer":"default" }}
                            onMouseEnter={e=>e.currentTarget.style.background="rgba(3,199,90,0.09)"}
                            onMouseLeave={e=>e.currentTarget.style.background="rgba(3,199,90,0.04)"}>
                            <div style={{ fontWeight:600, fontSize:11, lineHeight:1.4, marginBottom:5, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
                              {p.name?.replace(/<[^>]*>/g,"")}
                            </div>
                            <div style={{ fontSize:15, fontWeight:900, color:"#03c75a", marginBottom:3 }}>{p.price?parseInt(p.price).toLocaleString()+"원":"-"}</div>
                            <div style={{ fontSize:10, color:"#555", marginBottom:4 }}>🏪 {p.mall}</div>
                            {p.reason && <div style={{ fontSize:10, color:"#4a9a6a", padding:"3px 7px", background:"rgba(3,199,90,0.05)", borderRadius:4 }}>💡 {p.reason}</div>}
                          </div>
                        ))}
                      </div>
                      <NaverAnalysis products={products} />
                    </>
                  )}
                  {!loadingNV && !nvError && !products.length && <EmptyBox text="상품 없음" />}
                </Card>
              </div>
            )}
          </div>
        )}

        {/* ══ 기회 포착 ══ */}
        {activeTab === "oppo" && (
          <div>
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:18, fontWeight:800 }}>🚀 기회 포착</div>
              <div style={{ fontSize:11, color:"#555", marginTop:3 }}>경쟁 낮은 키워드 · 신규 트렌드 · 진입 타이밍 분석</div>
            </div>
            {!searched ? (
              <EmptyBox text="상단 검색창에 키워드를 입력하면 기회 분석 결과가 표시됩니다." />
            ) : (
              <div style={{ maxWidth:900, margin:"0 auto" }}>
                <Card>
                  <MoneyEngine result={engineResult} loading={loadingEN} error={enError} />
                </Card>
                {/* 타이밍 가이드 */}
                {engineResult && !loadingEN && (
                  <Card style={{ marginTop:14 }}>
                    <SectionTitle icon="⏰" title="진입 타이밍 가이드" color="#ffd700" />
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
                      {[
                        { label:"⚡ 지금 당장", desc:"급상승 + 높은 구매의도 + 낮은 경쟁도", color:"#ffd700" },
                        { label:"✅ 진입 적기", desc:"상승 흐름 + 구매의도 확인 + 경쟁 보통", color:"#03c75a" },
                        { label:"📊 검토 필요", desc:"트렌드 불명확 또는 경쟁 높음", color:"#ff8800" },
                      ].map((t,i) => (
                        <div key={i} style={{ background:`${t.color}08`, border:`1px solid ${t.color}22`, borderRadius:9, padding:12, textAlign:"center" }}>
                          <div style={{ fontSize:13, fontWeight:800, color:t.color, marginBottom:6 }}>{t.label}</div>
                          <div style={{ fontSize:10, color:"#555", lineHeight:1.5 }}>{t.desc}</div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══ 설정 ══ */}
        {activeTab === "setting" && (
          <div>
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:18, fontWeight:800 }}>⚙️ 설정</div>
              <div style={{ fontSize:11, color:"#555", marginTop:3 }}>자동 실행 · 필터 조건 · 데이터 기준 설정</div>
            </div>
            <SettingsPanel settings={settings} onChange={updateSetting} />
          </div>
        )}

      </div>
    </div>
  );
}
