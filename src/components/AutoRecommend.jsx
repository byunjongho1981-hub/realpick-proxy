// v4.0 - 홈 대시보드
import { useState } from "react";
import { runAutoRecommend } from "../api/autoRecommend";

// ── 유틸 ──────────────────────────────────────────
const fmtPrice   = n => n ? parseInt(n).toLocaleString()+"원" : "-";
const scoreColor = s => s>=70?"#ffd700":s>=50?"#03c75a":s>=30?"#ff8800":"#888";
const scoreLabel = s => s>=70?"S급":s>=50?"A급":s>=30?"B급":"C급";
const scoreBg    = s => s>=70?"rgba(255,215,0,0.07)":s>=50?"rgba(3,199,90,0.06)":s>=30?"rgba(255,136,0,0.06)":"rgba(255,255,255,0.02)";

const Spinner = ({ color, size=16 }) => (
  <div style={{ display:"inline-block", width:size, height:size, border:`2px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite", flexShrink:0 }} />
);
const Bar = ({ value, color, height=3 }) => (
  <div style={{ height, background:"#1a1a1a", borderRadius:99 }}>
    <div style={{ height:"100%", borderRadius:99, width:`${Math.min(100,value||0)}%`, background:`linear-gradient(90deg,${color}55,${color})`, transition:"width 0.6s" }} />
  </div>
);

// ── 카테고리 정의 ──────────────────────────────────
const CATS = [
  { id:"tech",    label:"가전/IT",    icon:"💻", kw:["노트북","스마트폰","태블릿","이어폰","헤드폰","스피커","카메라","모니터","청소기","에어컨","냉장고","세탁기","TV","갤럭시","아이폰","삼성","LG","다이슨","로봇","공기청정기","가습기","선풍기","전기밥솥","블루투스","충전기","보조배터리"] },
  { id:"beauty",  label:"뷰티/건강",  icon:"✨", kw:["화장품","스킨케어","선크림","세럼","앰플","에센스","크림","파운데이션","마스카라","립스틱","쿠션","토너","로션","샴푸","비타민","영양제","유산균","콜라겐","다이어트","단백질","프로틴","마스크팩","클렌징"] },
  { id:"living",  label:"생활/주방",  icon:"🏠", kw:["냄비","프라이팬","도마","칼","수납","정리","인테리어","조명","침구","이불","베개","매트리스","소파","의자","책상","세제","청소","주방","욕실","방향제","향초"] },
  { id:"fashion", label:"패션/잡화",  icon:"👗", kw:["운동화","스니커즈","구두","샌들","가방","백팩","지갑","시계","선글라스","모자","청바지","티셔츠","원피스","코트","패딩","후드","맨투맨","레깅스"] },
  { id:"food",    label:"식품",       icon:"🍎", kw:["과자","초콜릿","커피","차","음료","주스","우유","두유","쌀","라면","국수","빵","케이크","아이스크림","냉동식품","닭가슴살","견과류","건강식품"] },
  { id:"pet",     label:"반려동물",   icon:"🐾", kw:["사료","간식","장난감","리드줄","목줄","하네스","켄넬","이동장","쿠션","모래","패드","샴푸","영양제"] },
];

const classifyCat = kw => {
  const k = kw.toLowerCase();
  for (const c of CATS) if (c.kw.some(w => k.includes(w)||w.includes(k))) return c.id;
  return "etc";
};

const groupResults = (results) => {
  const ranked = results.map((item, i) => ({ ...item, globalRank: i }));
  const map = {};
  for (const item of ranked) {
    const id = classifyCat(item.keyword);
    if (!map[id]) map[id] = [];
    map[id].push(item);
  }
  return Object.entries(map)
    .map(([id, items]) => {
      const cat = CATS.find(c=>c.id===id) || { id:"etc", label:"기타", icon:"📦" };
      return { ...cat, items: items.sort((a,b)=>b.finalScore-a.finalScore), topScore: items[0]?.finalScore||0 };
    })
    .sort((a,b) => b.topScore-a.topScore);
};

// ── 공통 ResultCard ────────────────────────────────
const ResultCard = ({ item, rank, compact=false }) => {
  const [open, setOpen] = useState(false);
  const sc = scoreColor(item.finalScore);

  if (compact) return (
    <div style={{ background:scoreBg(item.finalScore), border:`1px solid ${sc}22`, borderRadius:9, padding:"9px 11px", display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ flexShrink:0, width:20, height:20, borderRadius:4,
        background:rank===0?"linear-gradient(135deg,#ffd700,#ff8800)":rank===1?"linear-gradient(135deg,#c0c0c0,#888)":"rgba(255,255,255,0.06)",
        display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:rank<2?"#000":"#555"
      }}>{rank+1}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:800, color:"#fff", marginBottom:2 }}>{item.keyword}</div>
        <div style={{ display:"flex", gap:5, alignItems:"center" }}>
          <span style={{ fontSize:9, color:item.trend.status==="급상승"?"#ffd700":item.trend.status==="상승"?"#03c75a":"#555" }}>
            {item.trend.status==="급상승"?"🚀":item.trend.status==="상승"?"📈":"📊"} {item.trend.status}
          </span>
          <span style={{ fontSize:9, color:item.timing.color }}>{item.timing.label}</span>
        </div>
      </div>
      <div style={{ textAlign:"right", flexShrink:0 }}>
        <div style={{ fontSize:16, fontWeight:900, color:sc }}>{item.finalScore}</div>
        <div style={{ fontSize:8, color:"#444" }}>점</div>
      </div>
    </div>
  );

  return (
    <div style={{ background:scoreBg(item.finalScore), border:`1px solid ${sc}22`, borderRadius:10, overflow:"hidden" }}>
      <div onClick={()=>setOpen(!open)} style={{ padding:"10px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}>
        <div style={{ flexShrink:0, width:22, height:22, borderRadius:5,
          background:rank===0?"linear-gradient(135deg,#ffd700,#ff8800)":rank===1?"linear-gradient(135deg,#c0c0c0,#888)":rank===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)",
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:900, color:rank<3?"#000":"#555"
        }}>{rank+1}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3, flexWrap:"wrap" }}>
            <span style={{ fontSize:13, fontWeight:800, color:"#fff" }}>{item.keyword}</span>
            {item.globalRank===0 && <span style={{ fontSize:9, padding:"2px 6px", borderRadius:5, background:"rgba(255,215,0,0.2)", color:"#ffd700", border:"1px solid rgba(255,215,0,0.4)", fontWeight:800 }}>🔥 BEST</span>}
            {item.globalRank>0 && item.globalRank<=2 && <span style={{ fontSize:9, padding:"2px 6px", borderRadius:5, background:"rgba(3,199,90,0.15)", color:"#03c75a", border:"1px solid rgba(3,199,90,0.3)" }}>추천</span>}
            <span style={{ fontSize:9, padding:"2px 5px", borderRadius:5, background:`${sc}22`, color:sc }}>{scoreLabel(item.finalScore)}</span>
            <span style={{ fontSize:9, padding:"2px 5px", borderRadius:5,
              background:item.trend.status==="급상승"?"rgba(255,215,0,0.1)":item.trend.status==="상승"?"rgba(3,199,90,0.08)":"rgba(255,255,255,0.04)",
              color:item.trend.status==="급상승"?"#ffd700":item.trend.status==="상승"?"#03c75a":"#555"
            }}>{item.trend.status==="급상승"?"🚀 급상승":item.trend.status==="상승"?"📈 상승":"📊 유지"}</span>
            <span style={{ fontSize:9, padding:"2px 5px", borderRadius:5, color:item.timing.color }}>{item.timing.label}</span>
          </div>
          <Bar value={item.finalScore} color={sc} />
        </div>
        <div style={{ flexShrink:0, textAlign:"right" }}>
          <div style={{ fontSize:18, fontWeight:900, color:sc, lineHeight:1 }}>{item.finalScore}</div>
          <div style={{ fontSize:8, color:"#444" }}>/ 100</div>
        </div>
        <div style={{ fontSize:9, color:"#333" }}>{open?"▲":"▼"}</div>
      </div>
      {open && (
        <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", padding:"11px 12px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:4, marginBottom:10 }}>
            {[
              { l:"트렌드",  v:`${item.trend.score}점`,   c:"#ff4444" },
              { l:"가속도",  v:`${item.trend.velocity}x`, c:"#ffd700" },
              { l:"구매의도",v:`${item.purchase}%`,        c:"#03c75a" },
              { l:"경쟁도",  v:`${item.competition}점`,   c:item.competition<50?"#03c75a":"#ff8800" },
              { l:"쇼핑",   v:`${item.shop?.score||0}점`, c:"#4488ff" },
            ].map((s,j)=>(
              <div key={j} style={{ background:"rgba(255,255,255,0.04)", borderRadius:6, padding:"5px 3px", textAlign:"center" }}>
                <div style={{ fontSize:8, color:"#555", marginBottom:1 }}>{s.l}</div>
                <div style={{ fontSize:10, fontWeight:800, color:s.c }}>{s.v}</div>
              </div>
            ))}
          </div>
          <div style={{ background:"rgba(255,255,255,0.02)", borderRadius:7, padding:"7px 9px", marginBottom:8 }}>
            <div style={{ fontSize:9, color:"#555", marginBottom:3 }}>💡 추천 이유</div>
            {item.reason.split(" · ").map((r,j)=>(
              <div key={j} style={{ display:"flex", gap:4, marginBottom:2 }}>
                <span style={{ color:sc, fontSize:9 }}>•</span>
                <span style={{ fontSize:10, color:"#aaa" }}>{r}</span>
              </div>
            ))}
          </div>
          {item.shop?.top && (
            <div onClick={()=>item.shop.top.url&&window.open(item.shop.top.url,"_blank")}
              style={{ background:"rgba(3,199,90,0.05)", border:"1px solid rgba(3,199,90,0.12)", borderRadius:7, padding:"7px 9px", cursor:"pointer" }}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(3,199,90,0.1)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(3,199,90,0.05)"}>
              <div style={{ fontSize:9, color:"#03c75a", marginBottom:2 }}>🛍 리뷰 최다 상품</div>
              <div style={{ fontSize:11, color:"#ccc", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:2 }}>{item.shop.top.name}</div>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontSize:13, fontWeight:900, color:"#03c75a" }}>{fmtPrice(item.shop.top.price)}</span>
                <span style={{ fontSize:10, color:"#444" }}>🏪 {item.shop.top.mall}</span>
              </div>
              {item.shop.reviewTotal>0 && <div style={{ fontSize:9, color:"#555", marginTop:2 }}>💬 리뷰 {item.shop.reviewTotal.toLocaleString()}개</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════════════════
export default function AutoRecommend({ apiKey }) {
  const [loading, setLoading]         = useState(false);
  const [progress, setProgress]       = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [groups, setGroups]           = useState([]);
  const [allItems, setAllItems]       = useState([]);
  const [error, setError]             = useState("");
  const [ran, setRan]                 = useState(false);
  const [activeTab, setActiveTab]     = useState("home");
  const [catFilter, setCatFilter]     = useState("all");

  const handleRun = async () => {
    setLoading(true); setError(""); setGroups([]); setAllItems([]); setRan(true);
    setProgress(0); setProgressMsg("시작 중...");
    try {
      const data = await runAutoRecommend(apiKey, (pct, msg) => {
        setProgress(pct); setProgressMsg(msg);
      });
      const g = groupResults(data);
      setGroups(g);
      setAllItems(data.map((item,i)=>({...item,globalRank:i})));
    } catch (e) {
      setError(e.message||"분석 중 오류 발생");
    } finally {
      setLoading(false);
    }
  };

  const TABS = [
    { id:"home",    label:"홈",         icon:"🏠" },
    { id:"live",    label:"실시간 추천", icon:"🔥" },
    { id:"cat",     label:"카테고리",   icon:"📊" },
    { id:"shop",    label:"쇼핑 인사이트", icon:"💰" },
    { id:"setting", label:"설정",       icon:"⚙️" },
  ];

  const best = allItems[0];
  const top3 = allItems.slice(0,3);

  // ── 진행 바 (공통) ──
  const ProgressBar = () => loading && (
    <div style={{ marginBottom:16 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
        <span style={{ fontSize:11, color:"#888" }}>{progressMsg}</span>
        <span style={{ fontSize:11, color:"#ffd700", fontWeight:700 }}>{progress}%</span>
      </div>
      <div style={{ height:4, background:"#1a1a1a", borderRadius:99 }}>
        <div style={{ height:"100%", borderRadius:99, width:`${progress}%`, background:"linear-gradient(90deg,#ff880088,#ffd700)", transition:"width 0.3s" }} />
      </div>
      <div style={{ fontSize:10, color:"#444", marginTop:4, textAlign:"center" }}>네이버 쇼핑랭킹 · 블로그 · 뉴스 · YouTube 분석 중</div>
    </div>
  );

  return (
    <div style={{ fontFamily:"'Segoe UI',sans-serif" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* ── 내부 탭 네비 ── */}
      <div style={{ display:"flex", gap:2, marginBottom:16, background:"rgba(255,255,255,0.03)", borderRadius:10, padding:3, flexWrap:"wrap" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
            flex:1, minWidth:60, padding:"8px 6px", borderRadius:7, border:"none", fontSize:11, cursor:"pointer",
            fontWeight: activeTab===t.id ? 700 : 400,
            background: activeTab===t.id ? "rgba(255,255,255,0.1)" : "transparent",
            color: activeTab===t.id ? "#fff" : "#555",
            borderBottom: activeTab===t.id ? "2px solid #ffd700" : "2px solid transparent",
            transition:"all 0.15s", whiteSpace:"nowrap"
          }}>{t.icon} {t.label}</button>
        ))}
      </div>

      {/* ════════════════════════════════
          🏠 홈 탭
      ════════════════════════════════ */}
      {activeTab==="home" && (
        <div>
          {/* 분석 실행 버튼 */}
          <button onClick={handleRun} disabled={loading} style={{
            width:"100%", padding:"13px", borderRadius:11, border:"none",
            cursor:loading?"not-allowed":"pointer",
            background:loading?"#222":"linear-gradient(135deg,#ff8800,#ffd700)",
            color:loading?"#555":"#000", fontWeight:800, fontSize:14,
            display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:14
          }}>
            {loading ? <><Spinner color="#ff8800" size={16}/> 분석 중...</> : "🔥 지금 추천 분석 시작"}
          </button>
          <ProgressBar />
          {error && <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:8, padding:"9px 11px", color:"#ff8888", fontSize:12, marginBottom:12 }}>⚠️ {error}</div>}

          {!ran && !loading && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:16 }}>
              {[
                { icon:"🔥", title:"실시간 추천", desc:"지금 팔릴 상품 TOP 5" },
                { icon:"📊", title:"카테고리 분석", desc:"분야별 트렌드 탐색" },
                { icon:"💰", title:"쇼핑 인사이트", desc:"가격·리뷰 검증" },
              ].map((c,i) => (
                <div key={i} onClick={()=>setActiveTab(["live","cat","shop"][i])} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:10, padding:"14px 12px", textAlign:"center", cursor:"pointer" }}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
                  onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}>
                  <div style={{ fontSize:22, marginBottom:6 }}>{c.icon}</div>
                  <div style={{ fontSize:12, fontWeight:700, color:"#ccc", marginBottom:3 }}>{c.title}</div>
                  <div style={{ fontSize:10, color:"#444" }}>{c.desc}</div>
                </div>
              ))}
            </div>
          )}

          {ran && !loading && allItems.length > 0 && (
            <div>
              {/* 분석 상태 요약 */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:14 }}>
                {[
                  { label:"분석 키워드", value:`${allItems.length}개`, color:"#ffd700" },
                  { label:"카테고리",   value:`${groups.length}개`,    color:"#4488ff" },
                  { label:"최고 점수",  value:`${allItems[0]?.finalScore||0}점`, color:"#03c75a" },
                ].map((s,i)=>(
                  <div key={i} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:9, padding:"10px", textAlign:"center" }}>
                    <div style={{ fontSize:9, color:"#555", marginBottom:4 }}>{s.label}</div>
                    <div style={{ fontSize:18, fontWeight:900, color:s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* 오늘의 BEST */}
              {best && (
                <div style={{ background:"linear-gradient(135deg,rgba(255,215,0,0.07),rgba(255,136,0,0.04))", border:"1px solid rgba(255,215,0,0.22)", borderRadius:12, padding:"14px", marginBottom:14 }}>
                  <div style={{ fontSize:10, color:"#ffd700", fontWeight:700, marginBottom:6 }}>🔥 오늘의 BEST 추천</div>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:20, fontWeight:900, color:"#fff", marginBottom:4 }}>{best.keyword}</div>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:6 }}>
                        <span style={{ fontSize:10, color:best.timing.color }}>{best.timing.label}</span>
                        <span style={{ fontSize:10, color:best.trend.status==="급상승"?"#ffd700":best.trend.status==="상승"?"#03c75a":"#666" }}>
                          {best.trend.status==="급상승"?"🚀 급상승":best.trend.status==="상승"?"📈 상승":"📊 유지"}
                        </span>
                      </div>
                      <div style={{ fontSize:10, color:"#777" }}>{best.reason.split(" · ")[0]}</div>
                    </div>
                    <div style={{ textAlign:"center", flexShrink:0 }}>
                      <div style={{ fontSize:36, fontWeight:900, color:scoreColor(best.finalScore), lineHeight:1 }}>{best.finalScore}</div>
                      <div style={{ fontSize:9, color:"#555" }}>/ 100</div>
                    </div>
                  </div>
                </div>
              )}

              {/* TOP 3 미리보기 */}
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:11, color:"#555", fontWeight:600, marginBottom:8 }}>📋 추천 TOP 3 미리보기</div>
                <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  {top3.map((item,i) => <ResultCard key={item.keyword} item={item} rank={i} compact />)}
                </div>
              </div>

              {/* 카테고리 요약 */}
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:11, color:"#555", fontWeight:600, marginBottom:8 }}>📊 카테고리별 요약</div>
                <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                  {groups.map(g => (
                    <div key={g.id} onClick={()=>{ setActiveTab("cat"); setCatFilter(g.id); }}
                      style={{ display:"flex", alignItems:"center", gap:8, background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.05)", borderRadius:8, padding:"8px 10px", cursor:"pointer" }}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                      onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.02)"}>
                      <span style={{ fontSize:14 }}>{g.icon}</span>
                      <span style={{ fontSize:12, color:"#ccc", flex:1 }}>{g.label}</span>
                      <span style={{ fontSize:10, color:"#555" }}>{g.items.length}개</span>
                      <div style={{ width:60 }}><Bar value={g.topScore} color={scoreColor(g.topScore)} /></div>
                      <span style={{ fontSize:12, fontWeight:800, color:scoreColor(g.topScore), width:28, textAlign:"right" }}>{g.topScore}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 전체 분석 보기 버튼 */}
              <button onClick={()=>setActiveTab("live")} style={{ width:"100%", padding:"11px", borderRadius:9, border:"1px solid rgba(255,215,0,0.25)", background:"rgba(255,215,0,0.06)", color:"#ffd700", fontWeight:700, fontSize:12, cursor:"pointer" }}>
                전체 추천 결과 보기 →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════
          🔥 실시간 추천 탭
      ════════════════════════════════ */}
      {activeTab==="live" && (
        <div>
          <button onClick={handleRun} disabled={loading} style={{
            width:"100%", padding:"13px", borderRadius:11, border:"none",
            cursor:loading?"not-allowed":"pointer",
            background:loading?"#222":"linear-gradient(135deg,#ff8800,#ffd700)",
            color:loading?"#555":"#000", fontWeight:800, fontSize:14,
            display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:14
          }}>
            {loading ? <><Spinner color="#ff8800" size={16}/> 분석 중...</> : "🔥 추천 상품 자동 분석"}
          </button>
          <ProgressBar />
          {error && <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:8, padding:"9px 11px", color:"#ff8888", fontSize:12, marginBottom:12 }}>⚠️ {error}</div>}
          {!loading && ran && allItems.length===0 && <div style={{ textAlign:"center", color:"#444", fontSize:12, padding:24 }}>조건에 맞는 추천 상품이 없습니다.</div>}

          {!loading && allItems.length > 0 && (
            <div>
              {/* BEST 하이라이트 */}
              {best && (
                <div style={{ background:"linear-gradient(135deg,rgba(255,215,0,0.07),rgba(255,136,0,0.04))", border:"1px solid rgba(255,215,0,0.2)", borderRadius:11, padding:"12px 14px", marginBottom:12, display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:22 }}>🔥</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:10, color:"#ffd700", fontWeight:700, marginBottom:2 }}>BEST 추천</div>
                    <div style={{ fontSize:15, fontWeight:900, color:"#fff" }}>{best.keyword}</div>
                    <div style={{ fontSize:10, color:"#777", marginTop:2 }}>{best.reason.split(" · ")[0]}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:28, fontWeight:900, color:scoreColor(best.finalScore), lineHeight:1 }}>{best.finalScore}</div>
                    <div style={{ fontSize:9, color:"#555" }}>/ 100</div>
                  </div>
                </div>
              )}
              <div style={{ fontSize:11, color:"#555", marginBottom:10 }}>실시간 분석 기반 <b style={{ color:"#ffd700" }}>추천 TOP {allItems.length}</b></div>
              <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                {allItems.map((item,i) => <ResultCard key={item.keyword} item={item} rank={i} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════
          📊 카테고리 분석 탭
      ════════════════════════════════ */}
      {activeTab==="cat" && (
        <div>
          {!ran ? (
            <div style={{ textAlign:"center", padding:40 }}>
              <div style={{ fontSize:13, color:"#444", marginBottom:14 }}>홈 탭에서 분석을 먼저 실행해주세요.</div>
              <button onClick={()=>setActiveTab("home")} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid rgba(255,215,0,0.25)", background:"rgba(255,215,0,0.07)", color:"#ffd700", fontWeight:700, fontSize:12, cursor:"pointer" }}>홈으로 이동</button>
            </div>
          ) : (
            <div>
              {/* 카테고리 필터 */}
              <div style={{ display:"flex", gap:4, marginBottom:14, flexWrap:"wrap" }}>
                <button onClick={()=>setCatFilter("all")} style={{ padding:"5px 12px", borderRadius:20, border: catFilter==="all"?"1px solid rgba(255,215,0,0.3)":"1px solid rgba(255,255,255,0.06)", fontSize:10, cursor:"pointer", fontWeight:catFilter==="all"?700:400, background:catFilter==="all"?"rgba(255,215,0,0.12)":"rgba(255,255,255,0.03)", color:catFilter==="all"?"#ffd700":"#555" }}>
                  전체 {allItems.length}
                </button>
                {groups.map(g => (
                  <button key={g.id} onClick={()=>setCatFilter(g.id)} style={{ padding:"5px 12px", borderRadius:20, border:catFilter===g.id?"1px solid rgba(255,255,255,0.2)":"1px solid rgba(255,255,255,0.05)", fontSize:10, cursor:"pointer", background:catFilter===g.id?"rgba(255,255,255,0.09)":"rgba(255,255,255,0.03)", color:catFilter===g.id?"#fff":"#555" }}>
                    {g.icon} {g.label} {g.items.length}
                  </button>
                ))}
              </div>

              {/* 그룹 렌더 */}
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                {(catFilter==="all" ? groups : groups.filter(g=>g.id===catFilter)).map(group => (
                  <div key={group.id}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, paddingBottom:6, borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                      <span style={{ fontSize:16 }}>{group.icon}</span>
                      <span style={{ fontSize:13, fontWeight:700, color:"#ccc" }}>{group.label}</span>
                      <span style={{ fontSize:10, color:"#444" }}>{group.items.length}개</span>
                      <div style={{ marginLeft:"auto", fontSize:10, color:"#555" }}>
                        최고 <b style={{ color:scoreColor(group.topScore) }}>{group.topScore}점</b>
                      </div>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                      {group.items.map((item,rank) => <ResultCard key={item.keyword} item={item} rank={rank} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════
          💰 쇼핑 인사이트 탭
      ════════════════════════════════ */}
      {activeTab==="shop" && (
        <div>
          {!ran ? (
            <div style={{ textAlign:"center", padding:40 }}>
              <div style={{ fontSize:13, color:"#444", marginBottom:14 }}>홈 탭에서 분석을 먼저 실행해주세요.</div>
              <button onClick={()=>setActiveTab("home")} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid rgba(255,215,0,0.25)", background:"rgba(255,215,0,0.07)", color:"#ffd700", fontWeight:700, fontSize:12, cursor:"pointer" }}>홈으로 이동</button>
            </div>
          ) : (
            <div>
              <div style={{ fontSize:11, color:"#555", marginBottom:12 }}>실제 판매 가능성 기준 <b style={{ color:"#03c75a" }}>쇼핑 데이터 분석</b></div>

              {/* 쇼핑 점수 비교 */}
              <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:11, padding:"13px", marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:10 }}>📊 쇼핑 점수 비교</div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {[...allItems].sort((a,b)=>(b.shop?.score||0)-(a.shop?.score||0)).map((item,i) => (
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:11, color:"#ccc", width:80, flexShrink:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.keyword}</span>
                      <div style={{ flex:1 }}><Bar value={item.shop?.score||0} color="#4488ff" /></div>
                      <span style={{ fontSize:11, fontWeight:700, color:"#4488ff", width:28, textAlign:"right", flexShrink:0 }}>{item.shop?.score||0}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 가격대 요약 */}
              <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:11, padding:"13px", marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:10 }}>💵 평균 가격대</div>
                <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  {allItems.filter(i=>i.shop?.avgPrice>0).sort((a,b)=>a.shop.avgPrice-b.shop.avgPrice).map((item,i) => (
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 8px", background:"rgba(3,199,90,0.03)", borderRadius:7 }}>
                      <span style={{ fontSize:11, color:"#ccc", flex:1 }}>{item.keyword}</span>
                      <span style={{ fontSize:12, fontWeight:800, color:"#03c75a" }}>{fmtPrice(item.shop.avgPrice)}</span>
                      <span style={{ fontSize:9, color:"#444" }}>리뷰 {(item.shop.reviewTotal||0).toLocaleString()}개</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 대표 상품 링크 */}
              <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:11, padding:"13px" }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:10 }}>🛍 리뷰 최다 대표 상품</div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {allItems.filter(i=>i.shop?.top).map((item,i) => (
                    <div key={i} onClick={()=>item.shop.top.url&&window.open(item.shop.top.url,"_blank")}
                      style={{ display:"flex", alignItems:"center", gap:8, background:"rgba(3,199,90,0.04)", border:"1px solid rgba(3,199,90,0.1)", borderRadius:8, padding:"8px 10px", cursor:"pointer" }}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(3,199,90,0.09)"}
                      onMouseLeave={e=>e.currentTarget.style.background="rgba(3,199,90,0.04)"}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:10, color:"#03c75a", marginBottom:1 }}>{item.keyword}</div>
                        <div style={{ fontSize:11, color:"#ccc", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.shop.top.name}</div>
                      </div>
                      <div style={{ textAlign:"right", flexShrink:0 }}>
                        <div style={{ fontSize:12, fontWeight:900, color:"#03c75a" }}>{fmtPrice(item.shop.top.price)}</div>
                        <div style={{ fontSize:9, color:"#444" }}>🏪 {item.shop.top.mall}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════
          ⚙️ 설정 탭
      ════════════════════════════════ */}
      {activeTab==="setting" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:11, padding:"14px" }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:10 }}>🔑 API 상태</div>
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", background:"rgba(255,255,255,0.03)", borderRadius:7 }}>
              <div style={{ width:7, height:7, borderRadius:"50%", background:apiKey?"#03c75a":"#ff4444", flexShrink:0 }} />
              <span style={{ fontSize:11, color:"#ccc" }}>YouTube API Key</span>
              <span style={{ fontSize:10, color:apiKey?"#03c75a":"#ff4444", marginLeft:"auto" }}>{apiKey?"연결됨":"미설정"}</span>
            </div>
          </div>
          <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:11, padding:"14px" }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:10 }}>📐 분석 기준</div>
            {[
              { label:"시드 키워드 수집",  desc:"네이버 쇼핑랭킹 + 블로그/뉴스/카페 + YouTube 15개 쿼리" },
              { label:"트렌드 판단",       desc:"48h 이내 YouTube 조회수 가속도 (급상승/상승/유지)" },
              { label:"구매 의도 분석",    desc:"구매·비교·가격·리뷰 키워드 빈도 가중 합산" },
              { label:"경쟁도 분석",       desc:"문서 수 / 평균 조회수 / 쇼핑 상품 수 기반" },
              { label:"최종 점수 공식",    desc:"트렌드 × 가속도 × 구매의도 × 쇼핑점수 ÷ 경쟁도" },
            ].map((r,i) => (
              <div key={i} style={{ padding:"7px 0", borderBottom: i<4?"1px solid rgba(255,255,255,0.04)":"none" }}>
                <div style={{ fontSize:11, color:"#ccc", marginBottom:2 }}>{r.label}</div>
                <div style={{ fontSize:10, color:"#555" }}>{r.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:11, padding:"14px" }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:10 }}>🎯 필터 기준</div>
            {[
              { label:"구매 의도 최소치", value:"10점 이상" },
              { label:"쇼핑 데이터",     value:"필수 (없으면 제외)" },
              { label:"최종 점수 최소",  value:"3점 이상" },
              { label:"경쟁도 최대",     value:"97점 이하" },
              { label:"최대 추천 수",    value:"TOP 5" },
            ].map((r,i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:i<4?"1px solid rgba(255,255,255,0.04)":"none" }}>
                <span style={{ fontSize:11, color:"#777" }}>{r.label}</span>
                <span style={{ fontSize:11, color:"#ffd700", fontWeight:700 }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
