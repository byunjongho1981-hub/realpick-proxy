import { useState, useEffect, useRef } from "react";

const VERCEL_URL = "https://realpick-proxy-git-main-byunjongho1981-3007s-projects.vercel.app";

const TABS = [
  { id: 0, icon: "🔥", label: "트렌드헌터" },
  { id: 1, icon: "📊", label: "속도분석" },
  { id: 2, icon: "🎬", label: "실행보드" },
  { id: 3, icon: "💰", label: "수익트래커" },
];

const STATUS_STEPS = ["기획", "제작중", "업로드", "수익 발생"];
const STATUS_STYLE = {
  "기획":      { bg: "#f1f5f9", color: "#64748b", border: "#cbd5e1" },
  "제작중":    { bg: "#fffbeb", color: "#d97706", border: "#fcd34d" },
  "업로드":    { bg: "#eff6ff", color: "#2563eb", border: "#93c5fd" },
  "수익 발생": { bg: "#f0fdf4", color: "#16a34a", border: "#86efac" },
};
const FIXED_CATEGORIES = ["가전/IT", "주방/생활", "건강/뷰티", "스포츠/아웃도어", "패션/잡화", "반려동물", "육아/교육"];
const DEFAULT_BOARD = [
  { id: 1, product: "에어프라이어 10L", type: "숏츠", status: "업로드", revenue: 12400 },
  { id: 2, product: "무선 청소기 경량", type: "블로그", status: "제작중", revenue: 0 },
];
const REVENUE = { coupang: { clicks: 1240, conversions: 38, revenue: 47200 }, naver: { clicks: 890, conversions: 22, revenue: 29800 } };
const CACHE_MS = 3 * 60 * 60 * 1000;

// 네이버 쇼핑인사이트 카테고리 코드
const SHOPPING_CATEGORIES = [
  { name: "가전", code: "50000803" },
  { name: "주방용품", code: "50000004" },
  { name: "건강식품", code: "50000008" },
  { name: "뷰티", code: "50000002" },
  { name: "스포츠", code: "50000006" },
  { name: "패션잡화", code: "50000001" },
  { name: "생활용품", code: "50000005" },
  { name: "반려동물", code: "50000907" },
];

// 네이버 검색어트렌드 키워드 그룹
const TREND_KEYWORDS = [
  { groupName: "주방가전", keywords: ["에어프라이어", "전기포트", "믹서기", "인덕션"] },
  { groupName: "청소가전", keywords: ["무선청소기", "로봇청소기", "스팀청소기"] },
  { groupName: "뷰티", keywords: ["선크림", "마스크팩", "클렌징폼", "앰플"] },
  { groupName: "건강", keywords: ["유산균", "비타민", "오메가3", "프로틴"] },
  { groupName: "스포츠", keywords: ["요가매트", "덤벨", "폼롤러", "줄넘기"] },
  { groupName: "패션잡화", keywords: ["크로스백", "토트백", "볼캡", "머플러"] },
  { groupName: "생활용품", keywords: ["수납함", "행거", "방향제", "가습기"] },
];

function normalizeName(name) {
  return name.replace(/\s+/g,"").toLowerCase().replace(/[^\w가-힣]/g,"");
}

// 뽐뿌 RSS (보조 소스)
async function fetchPpomppu() {
  const proxies = [
    u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];
  for (const p of proxies) {
    try {
      const r = await fetch(p("https://www.ppomppu.co.kr/rss.php?id=ppomppu"), { signal: AbortSignal.timeout(6000) });
      const text = await r.text();
      let xml = ""; try { xml = JSON.parse(text).contents || ""; } catch { xml = text; }
      if (!xml || xml.length < 100) continue;
      const items = [];
      const cdata = [...xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g)];
      if (cdata.length > 1) { cdata.slice(1,15).forEach(m => m[1]?.trim() && items.push(m[1].trim())); return items; }
      [...xml.matchAll(/<title>(.*?)<\/title>/g)].slice(1,15).forEach(m => {
        const t = m[1].replace(/<[^>]+>/g,"").trim(); if (t) items.push(t);
      });
      if (items.length > 0) return items;
    } catch {}
  }
  return [];
}

// 네이버 검색어트렌드 API
async function fetchNaverTrend(keywordGroups) {
  const today = new Date();
  const end = today.toISOString().slice(0,10);
  const start = new Date(today - 30*24*60*60*1000).toISOString().slice(0,10);
  try {
    const res = await fetch(`${VERCEL_URL}/api/naver`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: start, endDate: end, timeUnit: "week", keywordGroups })
    });
    return await res.json();
  } catch { return null; }
}

// 네이버 쇼핑인사이트 API
async function fetchNaverShopping(categoryCode, categoryName) {
  const today = new Date();
  const end = today.toISOString().slice(0,10);
  const start = new Date(today - 30*24*60*60*1000).toISOString().slice(0,10);
  try {
    const res = await fetch(`${VERCEL_URL}/api/naver`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Naver-Endpoint": "https://openapi.naver.com/v1/datalab/shopping/categories"
      },
      body: JSON.stringify({
        startDate: start, endDate: end, timeUnit: "week",
        category: [{ name: categoryName, param: [categoryCode] }]
      })
    });
    return await res.json();
  } catch { return null; }
}

export default function App() {
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [board, setBoard] = useState(DEFAULT_BOARD);
  const [statusMsg, setStatusMsg] = useState("");
  const [sourceStatus, setSourceStatus] = useState({});
  const [lastFetched, setLastFetched] = useState(null);
  const [nextFetchIn, setNextFetchIn] = useState(null);
  const [apiSaved, setApiSaved] = useState(false);
  const historyRef = useRef([]);
  const cacheRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    async function testNaver() {
      try {
        const res = await fetch(`${VERCEL_URL}/api/naver`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDate: "2026-01-01", endDate: "2026-03-17", timeUnit: "week", keywordGroups: [{ groupName: "테스트", keywords: ["에어프라이어"] }] })
        });
        const data = await res.json();
        if (data.results || data.startDate) setApiSaved(true);
      } catch {}
    }
    testNaver();
  }, []);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      if (!cacheRef.current?.timestamp) { setNextFetchIn(null); return; }
      const rem = CACHE_MS - (Date.now() - cacheRef.current.timestamp);
      if (rem <= 0) { setNextFetchIn("갱신 가능"); return; }
      const h = Math.floor(rem/3600000), m = Math.floor((rem%3600000)/60000), s = Math.floor((rem%60000)/1000);
      setNextFetchIn(`${h}h ${m}m ${s}s 후 갱신`);
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  async function hunt(force = false) {
    if (!force && cacheRef.current && Date.now() - cacheRef.current.timestamp < CACHE_MS) {
      setProducts(cacheRef.current.products);
      setStatusMsg(cacheRef.current.statusMsg + " (캐시)");
      setLastFetched(new Date(cacheRef.current.timestamp));
      return;
    }
    setLoading(true); setProducts([]); setSelected(null); setDetail(null);
    setSourceStatus({}); setStatusMsg("📡 네이버 데이터 수집 중...");

    const collectedData = [];

    // 1. 네이버 검색어트렌드 수집
    setStatusMsg("📊 네이버 검색어트렌드 분석 중...");
    setSourceStatus({ "네이버 검색어트렌드": "checking", "네이버 쇼핑인사이트": "checking", "뽐뿌 핫딜": "checking" });

    const trendData = await fetchNaverTrend(TREND_KEYWORDS);
    if (trendData?.results) {
      trendData.results.forEach(r => {
        const lastWeek = r.data?.slice(-2);
        if (lastWeek?.length >= 2) {
          const growth = lastWeek[1].ratio - lastWeek[0].ratio;
          collectedData.push({ keyword: r.title, type: "검색어트렌드", growth, ratio: lastWeek[1].ratio });
        }
      });
      setSourceStatus(prev => ({ ...prev, "네이버 검색어트렌드": "alive" }));
    } else {
      setSourceStatus(prev => ({ ...prev, "네이버 검색어트렌드": "dead" }));
    }

    // 2. 네이버 쇼핑인사이트 수집 (상위 4개 카테고리)
    setStatusMsg("🛒 네이버 쇼핑인사이트 분석 중...");
    let shoppingOk = false;
    for (const cat of SHOPPING_CATEGORIES.slice(0, 4)) {
      const data = await fetchNaverShopping(cat.code, cat.name);
      if (data?.results) {
        const lastWeek = data.results[0]?.data?.slice(-2);
        if (lastWeek?.length >= 2) {
          const growth = lastWeek[1].ratio - lastWeek[0].ratio;
          collectedData.push({ keyword: cat.name, type: "쇼핑인사이트", growth, ratio: lastWeek[1].ratio });
          shoppingOk = true;
        }
      }
    }
    setSourceStatus(prev => ({ ...prev, "네이버 쇼핑인사이트": shoppingOk ? "alive" : "dead" }));

    // 3. 뽐뿌 RSS 수집 (보조)
    setStatusMsg("📌 뽐뿌 핫딜 수집 중...");
    const ppomppu = await fetchPpomppu();
    if (ppomppu.length > 0) {
      ppomppu.forEach(k => collectedData.push({ keyword: k, type: "뽐뿌핫딜", growth: 0, ratio: 50 }));
      setSourceStatus(prev => ({ ...prev, "뽐뿌 핫딜": "alive" }));
    } else {
      setSourceStatus(prev => ({ ...prev, "뽐뿌 핫딜": "dead" }));
    }

    // 4. 성장률 기준 정렬
    const sorted = collectedData.sort((a, b) => b.growth - a.growth);
    const dataBlock = sorted.slice(0, 30).map((d, i) =>
      `${i+1}. [${d.type} / 증가율${d.growth.toFixed(1)} / 현재지수${d.ratio.toFixed(1)}] ${d.keyword}`
    ).join("\n");

    setStatusMsg("🤖 AI TOP 3 선정 중...");

    try {
      const res = await fetch(`${VERCEL_URL}/api/claude`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:2000,
          system:`당신은 TREND HUNTER 시스템의 AI 분석기입니다.
입력 데이터는 네이버 실제 API 데이터입니다 (검색어트렌드 + 쇼핑인사이트 + 뽐뿌핫딜).
증가율(growth)이 높을수록 빠르게 상승 중인 상품입니다.

성공 기준: 경쟁이 적고 + 리뷰가 이미 존재하고 + 아직 폭발 전인 상품
필터: 가격 5,000~30,000원 우선 / 3초 이해 가능 / 충동구매 가능 / 브랜드·광고 제외
TOP 3만 선정 (반드시 3개)

카테고리는 반드시: ${FIXED_CATEGORIES.join(", ")} 중에서만
[ 로 시작 ] 로 끝나는 순수 JSON만.
형식: [{"rank":1,"name":"구체적인상품명","category":"가전/IT","reason":"네이버 데이터 기반 근거 1문장","speedScore":85,"profitScore":78,"competitionLevel":"낮음","phase":"상승중","priceRange":"12,000~18,000원","platform":["쿠팡","네이버"],"sources":["네이버 검색어트렌드"],"frequency":3,"successFlags":{"reviewExists":true,"notExplodedYet":true,"reactionStarting":true}}]`,
          messages:[{ role:"user", content:`네이버 실데이터 기반 TOP 3 JSON만:\n\n${dataBlock}` }]
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const txt = data.content.filter(b=>b.type==="text").map(b=>b.text).join("");
      const s = txt.indexOf("["), e = txt.lastIndexOf("]");
      if (s===-1) throw new Error("JSON 파싱 실패");
      const parsed = JSON.parse(txt.slice(s,e+1));
      const seen = new Set();
      const deduped = parsed.filter(p => { const k = normalizeName(p.name); if (seen.has(k)) return false; seen.add(k); return true; });
      historyRef.current = [...historyRef.current.slice(-5), { timestamp: Date.now(), products: deduped }];
      const aliveCount = Object.values(sourceStatus).filter(v=>v==="alive").length;
      const msg = `✅ 네이버 실데이터 기반 · ${sorted.length}개 데이터포인트 → TOP 3 완료`;
      cacheRef.current = { products: deduped, statusMsg: msg, timestamp: Date.now() };
      setProducts(deduped); setStatusMsg(msg); setLastFetched(new Date());
    } catch(err) { setStatusMsg("🔴 오류: " + err.message); }
    setLoading(false);
  }

  async function fetchDetail(product) {
    setDetailLoading(true); setDetail(null); setTab(1);
    const prev = historyRef.current.length >= 2
      ? historyRef.current[historyRef.current.length-2].products.find(p => normalizeName(p.name) === normalizeName(product.name))
      : null;

    // 네이버 실제 검색량 데이터
    let naverData = null;
    try {
      const nr = await fetchNaverTrend([{ groupName: product.name, keywords: [product.name] }]);
      if (nr?.results) naverData = nr;
    } catch {}

    try {
      const res = await fetch(`${VERCEL_URL}/api/claude`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:1200,
          system:`TREND HUNTER 속도 분석 전문가. { 로 시작 } 로 끝나는 순수 JSON만.
형식: {"avgPrice":"12,000원","competition":"낮음","searchVolume":"월 2.1만회","searchGrowth":"+34%","coupangRating":"4.2","reviewGrowth":"+12%/주","commissionRate":"3~5%","speedTrend":[40,48,55,62,71,83,95],"shortsTip":"팁","blogTip":"팁","estimatedMonthlyRevenue":"약 18만원","entryWindow":"지금이 적기","warning":"없음"}`,
          messages:[{ role:"user", content:`"${product.name}" 분석. 네이버실데이터: ${naverData ? JSON.stringify(naverData.results[0]?.data?.slice(-4)) : "없음"}. 이전점수: ${prev?.speedScore||"없음"}. JSON만.` }]
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const txt = data.content.filter(b=>b.type==="text").map(b=>b.text).join("");
      const s = txt.indexOf("{"), e = txt.lastIndexOf("}");
      if (s===-1) throw new Error("파싱 실패");
      setDetail({ ...JSON.parse(txt.slice(s,e+1)), prevScore: prev?.speedScore||null, naverReal: !!naverData });
    } catch { setDetail({ error:true }); }
    setDetailLoading(false);
  }

  function addToBoard(product) {
    const items = ["숏츠","블로그"].map((type,i) => ({ id:Date.now()+i, product:product.name, type, status:"기획", revenue:0 }));
    setBoard(p => [...items, ...p]); setTab(2);
  }
  function cycleStatus(id) {
    setBoard(p => p.map(item => item.id!==id ? item : { ...item, status: STATUS_STEPS[(STATUS_STEPS.indexOf(item.status)+1)%STATUS_STEPS.length] }));
  }

  const totalRevenue = REVENUE.coupang.revenue + REVENUE.naver.revenue;
  const phaseColor = { "초기감지":"#7c3aed","상승중":"#2563eb","폭발직전":"#d97706","이미터짐":"#94a3b8" };
  const phaseEmoji = { "초기감지":"🌱","상승중":"📈","폭발직전":"🔥","이미터짐":"💨" };
  const sourceEntries = Object.entries(sourceStatus);

  return (
    <div style={{ background:"#0f172a", minHeight:"100vh", fontFamily:"system-ui,sans-serif", color:"#f1f5f9" }}>
      <div style={{ background:"#1e293b", borderBottom:"1px solid #334155", padding:"14px 28px", display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:22 }}>🎯</span>
        <div>
          <div style={{ fontSize:16, fontWeight:800, color:"#f8fafc" }}>TREND HUNTER</div>
          <div style={{ fontSize:11, color:"#64748b" }}>네이버 실데이터 기반 · 24~72시간 선점</div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
          {nextFetchIn && <div style={{ background:"#0f172a", border:"1px solid #334155", borderRadius:20, padding:"4px 12px", fontSize:11, color:"#94a3b8" }}>⏱ {nextFetchIn}</div>}
          <div style={{ display:"flex", alignItems:"center", gap:6, background:apiSaved?"#052e1620":"#1c150740", border:`1px solid ${apiSaved?"#16a34a":"#d97706"}`, borderRadius:20, padding:"4px 12px" }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:apiSaved?"#22c55e":"#eab308" }}/>
            <span style={{ fontSize:12, color:apiSaved?"#4ade80":"#fbbf24", fontWeight:600 }}>{apiSaved?"네이버 API 연동됨":"API 미연동"}</span>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:960, margin:"0 auto", padding:"24px 20px" }}>
        <div style={{ background:"#1e293b", borderRadius:14, padding:"6px", display:"flex", gap:4, marginBottom:20, border:"1px solid #334155" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4, padding:"10px 8px", borderRadius:10, border:"none", cursor:"pointer", background:tab===t.id?"#2563eb":"transparent", color:tab===t.id?"#fff":"#64748b" }}>
              <span style={{ fontSize:18 }}>{t.icon}</span>
              <span style={{ fontSize:11, fontWeight:tab===t.id?700:500 }}>{t.label}</span>
            </button>
          ))}
        </div>

        {tab===0 && (
          <div>
            <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:12, padding:"12px 16px", marginBottom:16, display:"flex", gap:20, alignItems:"center" }}>
              <div style={{ fontSize:12, color:"#94a3b8", fontWeight:600 }}>✅ 성공 타이밍</div>
              {[["리뷰 존재","#16a34a"],["폭발 전","#2563eb"],["반응 시작","#d97706"]].map(([label,color])=>(
                <div key={label} style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background:color }}/>
                  <span style={{ fontSize:12, color:"#cbd5e1" }}>{label}</span>
                </div>
              ))}
              <div style={{ marginLeft:"auto", fontSize:11, color:"#475569" }}>3개 동시 충족 = 진입</div>
            </div>

            <div style={{ background:"#1e293b", borderRadius:16, padding:24, border:"1px solid #334155" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                <div>
                  <div style={{ fontSize:16, fontWeight:800 }}>🔥 TOP 3 선정</div>
                  <div style={{ fontSize:12, color:"#475569", marginTop:4 }}>{lastFetched ? `마지막 수집: ${lastFetched.toLocaleTimeString("ko-KR")}` : "네이버 실데이터 기반 분석"}</div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={()=>hunt(false)} disabled={loading}
                    style={{ background:loading?"#334155":"#dc2626", color:loading?"#475569":"#fff", border:"none", borderRadius:10, padding:"10px 24px", fontSize:13, fontWeight:700, cursor:loading?"not-allowed":"pointer" }}>
                    {loading?"⏳ 헌팅 중...":"🚀 지금 헌팅"}
                  </button>
                  {cacheRef.current && <button onClick={()=>hunt(true)} disabled={loading} style={{ background:"transparent", color:"#64748b", border:"1px solid #334155", borderRadius:10, padding:"10px 14px", fontSize:12, cursor:"pointer" }}>🔄 강제갱신</button>}
                </div>
              </div>

              {sourceEntries.length > 0 && (
                <div style={{ background:"#0f172a", border:"1px solid #1e293b", borderRadius:10, padding:"10px 14px", marginBottom:16 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#475569", marginBottom:8 }}>📡 데이터 소스 현황</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {sourceEntries.map(([name,v])=>(
                      <span key={name} style={{ background:v==="alive"?"#052e16":v==="dead"?"#1f0707":"#1c1507", border:`1px solid ${v==="alive"?"#16a34a":v==="dead"?"#dc2626":"#d97706"}`, borderRadius:6, padding:"3px 10px", fontSize:11, color:v==="alive"?"#4ade80":v==="dead"?"#f87171":"#fbbf24", fontWeight:600 }}>
                        {v==="alive"?"✅":v==="dead"?"❌":"⏳"} {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {statusMsg && (
                <div style={{ background:statusMsg.startsWith("✅")?"#052e1640":statusMsg.startsWith("⚠️")?"#1c150740":"#1f070740", border:`1px solid ${statusMsg.startsWith("✅")?"#16a34a":statusMsg.startsWith("⚠️")?"#d97706":"#dc2626"}`, borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:12, color:statusMsg.startsWith("✅")?"#4ade80":statusMsg.startsWith("⚠️")?"#fbbf24":"#f87171" }}>
                  {statusMsg}
                </div>
              )}

              {!loading && products.length===0 && !statusMsg && (
                <div style={{ background:"#1c150740", border:"1px solid #d97706", borderRadius:10, padding:"14px 16px", fontSize:13, color:"#fbbf24" }}>
                  💡 <b>지금 헌팅</b> 버튼을 눌러 네이버 실데이터 기반 TOP 3를 발굴하세요
                </div>
              )}
              {loading && <div style={{ textAlign:"center", padding:"50px 0", color:"#475569" }}><div style={{ fontSize:40, marginBottom:12 }}>🚀</div><div style={{ fontSize:14 }}>{statusMsg}</div></div>}

              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                {products.map((p,i)=>{
                  const sel = selected?.rank===p.rank;
                  const fullSuccess = p.successFlags?.reviewExists && p.successFlags?.notExplodedYet && p.successFlags?.reactionStarting;
                  const pColor = phaseColor[p.phase]||"#64748b";
                  return (
                    <div key={i} onClick={()=>setSelected(sel?null:p)} style={{ border:`2px solid ${sel?"#2563eb":fullSuccess?"#16a34a30":"#334155"}`, borderRadius:14, padding:"16px", cursor:"pointer", background:sel?"#1e3a8a20":fullSuccess?"#052e1620":"#0f172a" }}>
                      <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
                        <div style={{ background:sel?"#2563eb":"#1e293b", color:sel?"#fff":"#64748b", borderRadius:10, width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:15, flexShrink:0 }}>{p.rank}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:6 }}>
                            <span style={{ fontWeight:800, fontSize:16, color:"#f8fafc" }}>{p.name}</span>
                            <span style={{ background:pColor+"30", border:`1px solid ${pColor}`, color:pColor, borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:700 }}>{phaseEmoji[p.phase]} {p.phase}</span>
                            <span style={{ background:"#1e293b", border:"1px solid #334155", color:"#94a3b8", borderRadius:6, padding:"2px 8px", fontSize:11 }}>{p.category}</span>
                          </div>
                          <div style={{ fontSize:12, color:"#94a3b8", marginBottom:8 }}>{p.reason}</div>
                          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                            {[[p.successFlags?.reviewExists,"리뷰 존재","#16a34a"],[p.successFlags?.notExplodedYet,"폭발 전","#2563eb"],[p.successFlags?.reactionStarting,"반응 시작","#d97706"]].map(([flag,label,color])=>(
                              <span key={label} style={{ background:flag?color+"20":"#1e293b", border:`1px solid ${flag?color:"#334155"}`, borderRadius:6, padding:"2px 8px", fontSize:11, color:flag?color:"#475569", fontWeight:600 }}>{flag?"✓":"✗"} {label}</span>
                            ))}
                          </div>
                        </div>
                        <div style={{ flexShrink:0, textAlign:"center" }}>
                          <div style={{ fontSize:10, color:"#475569", marginBottom:4 }}>속도점수</div>
                          <div style={{ fontWeight:900, fontSize:28, lineHeight:1, color:p.speedScore>=80?"#4ade80":p.speedScore>=60?"#fbbf24":"#f87171" }}>{p.speedScore}</div>
                          <div style={{ fontSize:10, color:"#475569", marginTop:4 }}>{p.priceRange}</div>
                        </div>
                      </div>
                      {sel && (
                        <div style={{ marginTop:14, paddingTop:14, borderTop:"1px solid #334155", display:"flex", alignItems:"center", gap:8 }}>
                          <div style={{ display:"flex", gap:6, flex:1, flexWrap:"wrap" }}>
                            {p.platform?.map((pl,j)=><span key={j} style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:6, padding:"3px 10px", fontSize:12, color:"#94a3b8" }}>{pl}</span>)}
                            {p.sources?.map((src,j)=><span key={j} style={{ background:"#052e1620", border:"1px solid #16a34a", borderRadius:6, padding:"3px 8px", fontSize:11, color:"#4ade80" }}>✓ {src}</span>)}
                          </div>
                          <button onClick={e=>{e.stopPropagation();fetchDetail(p);}} style={{ background:"#2563eb", color:"#fff", border:"none", borderRadius:8, padding:"9px 20px", fontSize:13, fontWeight:700, cursor:"pointer" }}>속도 분석 →</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {tab===1 && (
          <div style={{ background:"#1e293b", borderRadius:16, padding:24, border:"1px solid #334155" }}>
            <div style={{ fontSize:16, fontWeight:800, marginBottom:20 }}>📊 {selected?`${selected.name} — 속도 분석`:"속도 분석"}</div>
            {!selected&&!detailLoading&&<div style={{ textAlign:"center", padding:"50px 0", color:"#475569" }}><div style={{ fontSize:36, marginBottom:10 }}>👆</div><div>트렌드헌터 탭에서 상품 선택 후 속도 분석을 눌러주세요</div></div>}
            {detailLoading&&<div style={{ textAlign:"center", padding:"50px 0", color:"#475569" }}><div style={{ fontSize:36, marginBottom:10 }}>🔎</div><div>네이버 실데이터 분석 중...</div></div>}
            {detail&&!detail.error&&(
              <div>
                <div style={{ background:detail.naverReal?"#052e1640":"#1c150740", border:`1px solid ${detail.naverReal?"#16a34a":"#d97706"}`, borderRadius:8, padding:"8px 14px", marginBottom:16, fontSize:12, color:detail.naverReal?"#4ade80":"#fbbf24" }}>
                  {detail.naverReal?"✅ 네이버 실제 검색량 데이터 기반":"⚠️ AI 추정값"}
                </div>
                {detail.prevScore&&<div style={{ background:"#1e40af20", border:"1px solid #3b82f6", borderRadius:8, padding:"10px 14px", marginBottom:16, fontSize:13, color:"#60a5fa", fontWeight:600 }}>📈 이전 속도점수: {detail.prevScore} → 현재: {selected?.speedScore} ({selected?.speedScore-detail.prevScore>=0?"+":""}{selected?.speedScore-detail.prevScore})</div>}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:20 }}>
                  {[["평균 가격",detail.avgPrice],["경쟁 강도",detail.competition],["월간 검색량",detail.searchVolume],["검색 증가율",detail.searchGrowth],["리뷰 증가",detail.reviewGrowth],["월 예상 수익",detail.estimatedMonthlyRevenue]].map(([label,value],i)=>(
                    <div key={i} style={{ background:"#0f172a", border:"1px solid #334155", borderRadius:10, padding:14 }}>
                      <div style={{ fontSize:11, color:"#475569", marginBottom:6 }}>{label}</div>
                      <div style={{ fontSize:15, fontWeight:700, color:"#f8fafc" }}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background:"#0f172a", border:"1px solid #334155", borderRadius:10, padding:16, marginBottom:14 }}>
                  <div style={{ fontSize:12, color:"#64748b", marginBottom:10, fontWeight:600 }}>7일 속도 추이</div>
                  <div style={{ display:"flex", gap:6, alignItems:"flex-end", height:64 }}>
                    {(detail.speedTrend||[40,48,55,62,71,83,95]).map((v,i)=>(
                      <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                        <div style={{ width:"100%", background:v>=80?"#4ade80":v>=60?"#fbbf24":"#60a5fa", borderRadius:4, height:`${Math.round((v/100)*56)}px`, minHeight:4 }}/>
                        <div style={{ fontSize:10, color:"#475569" }}>D-{6-i}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ background:"#052e1640", border:"1px solid #16a34a", borderRadius:10, padding:"12px 16px", marginBottom:14 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:"#4ade80", marginBottom:4 }}>🎯 진입 타이밍</div>
                  <div style={{ fontSize:14, color:"#f8fafc" }}>{detail.entryWindow}</div>
                  {detail.warning&&detail.warning!=="없음"&&<div style={{ fontSize:12, color:"#fbbf24", marginTop:8 }}>⚠️ {detail.warning}</div>}
                </div>
                <div style={{ background:"#0f172a", border:"1px solid #334155", borderRadius:10, padding:16, marginBottom:16 }}>
                  <div style={{ fontSize:12, fontWeight:700, marginBottom:10, color:"#94a3b8" }}>콘텐츠 제작 팁</div>
                  <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                    <span style={{ background:"#1e40af20", color:"#60a5fa", borderRadius:5, padding:"2px 8px", fontSize:11, fontWeight:600, flexShrink:0 }}>숏츠</span>
                    <span style={{ fontSize:13, color:"#cbd5e1" }}>{detail.shortsTip}</span>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <span style={{ background:"#052e1620", color:"#4ade80", borderRadius:5, padding:"2px 8px", fontSize:11, fontWeight:600, flexShrink:0 }}>블로그</span>
                    <span style={{ fontSize:13, color:"#cbd5e1" }}>{detail.blogTip}</span>
                  </div>
                </div>
                <button onClick={()=>addToBoard(selected)} style={{ width:"100%", background:"#2563eb", color:"#fff", border:"none", borderRadius:10, padding:"13px", fontSize:14, fontWeight:700, cursor:"pointer" }}>🚀 즉시 실행 — 실행보드에 추가</button>
              </div>
            )}
            {detail?.error&&<div style={{ background:"#1f070740", border:"1px solid #dc2626", borderRadius:10, padding:14, fontSize:13, color:"#f87171" }}>분석 오류. 다시 시도해주세요.</div>}
          </div>
        )}

        {tab===2 && (
          <div style={{ background:"#1e293b", borderRadius:16, padding:24, border:"1px solid #334155" }}>
            <div style={{ fontSize:16, fontWeight:800, marginBottom:4 }}>🎬 실행보드</div>
            <div style={{ fontSize:12, color:"#475569", marginBottom:20 }}>상품 1개 = 콘텐츠 3개 이상 · 반응 없으면 즉시 폐기</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {board.map(item=>{
                const st = STATUS_STYLE[item.status];
                return (
                  <div key={item.id} style={{ border:"1px solid #334155", borderRadius:12, padding:"14px 16px", display:"flex", alignItems:"center", gap:12, background:"#0f172a" }}>
                    <span style={{ fontSize:18 }}>{item.type==="숏츠"?"🎬":"📝"}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:600, fontSize:14, color:"#f8fafc" }}>{item.product}</div>
                      <div style={{ fontSize:12, color:"#475569", marginTop:2 }}>{item.type}</div>
                    </div>
                    {item.revenue>0&&<div style={{ fontSize:13, fontWeight:700, color:"#4ade80" }}>+₩{item.revenue.toLocaleString()}</div>}
                    <button onClick={()=>cycleStatus(item.id)} style={{ background:st.bg, color:st.color, border:`1px solid ${st.border}`, borderRadius:8, padding:"5px 12px", fontSize:12, fontWeight:600, cursor:"pointer" }}>{item.status}</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab===3 && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
              {[{name:"쿠팡파트너스",color:"#f87171",border:"#dc2626",...REVENUE.coupang},{name:"네이버커넥트",color:"#4ade80",border:"#16a34a",...REVENUE.naver}].map((p,i)=>(
                <div key={i} style={{ background:"#1e293b", border:`1px solid ${p.border}30`, borderRadius:16, padding:20 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:p.color, marginBottom:16 }}>{p.name}</div>
                  {[["총 클릭",p.clicks.toLocaleString()],["전환 건수",p.conversions+"건"],["누적 수익","₩"+p.revenue.toLocaleString()]].map(([l,v],j)=>(
                    <div key={j} style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
                      <span style={{ fontSize:12, color:"#64748b" }}>{l}</span>
                      <span style={{ fontSize:14, fontWeight:700, color:"#f8fafc" }}>{v}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ background:"#1e293b", border:"1px solid #334155", borderRadius:16, padding:24 }}>
              <div style={{ fontSize:12, color:"#475569", marginBottom:6 }}>이번 달 합산 수익</div>
              <div style={{ fontSize:34, fontWeight:800, color:"#60a5fa" }}>₩{totalRevenue.toLocaleString()}</div>
              <div style={{ marginTop:18, display:"flex", borderRadius:8, overflow:"hidden", height:36 }}>
                {[{label:"쿠팡",pct:Math.round(REVENUE.coupang.revenue/totalRevenue*100),color:"#dc2626"},{label:"네이버",pct:Math.round(REVENUE.naver.revenue/totalRevenue*100),color:"#16a34a"}].map((b,i)=>(
                  <div key={i} style={{ flex:b.pct, background:b.color, display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <span style={{ fontSize:12, color:"#fff", fontWeight:700 }}>{b.label} {b.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
