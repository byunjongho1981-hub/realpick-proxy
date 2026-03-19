// v5.0 - 실시간 / 안정 추천 분리
import { useState } from "react";
import { runAutoRecommend } from "../api/autoRecommend";

// ── 유틸 ──────────────────────────────
const fmtPrice   = n => n ? parseInt(n).toLocaleString()+"원" : "-";
const scoreColor = s => s>=70?"#ffd700":s>=50?"#03c75a":s>=30?"#ff8800":"#888";
const scoreLabel = s => s>=70?"S급":s>=50?"A급":s>=30?"B급":"C급";
const scoreBg    = s => s>=70?"rgba(255,215,0,0.07)":s>=50?"rgba(3,199,90,0.06)":s>=30?"rgba(255,136,0,0.06)":"rgba(255,255,255,0.02)";
const statusColor = s => s==="급상승"?"#ffd700":s==="상승 시작"?"#ff8800":s==="유지"?"#4488ff":"#ff4444";
const statusIcon  = s => s==="급상승"?"🚀":s==="상승 시작"?"📈":s==="유지"?"📊":"📉";

const Spinner = ({ color, size=16 }) => (
  <div style={{ display:"inline-block", width:size, height:size, border:`2px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite", flexShrink:0 }} />
);
const Bar = ({ value, color, height=3 }) => (
  <div style={{ height, background:"#1a1a1a", borderRadius:99 }}>
    <div style={{ height:"100%", borderRadius:99, width:`${Math.min(100,Math.max(0,value||0))}%`, background:`linear-gradient(90deg,${color}55,${color})`, transition:"width 0.6s" }} />
  </div>
);

// ── 카테고리 ──────────────────────────
const CATS = [
  { id:"tech",    label:"가전/IT",   icon:"💻", kw:["무선이어폰","공기청정기","로봇청소기","노트북","태블릿","스마트워치","블루투스스피커","보조배터리"] },
  { id:"beauty",  label:"뷰티/건강", icon:"✨", kw:["선크림","세럼","비타민","마스크팩","폼클렌징","샴푸","단백질보충제","유산균"] },
  { id:"living",  label:"생활/주방", icon:"🏠", kw:["에어프라이어","전기포트","텀블러","가습기","제습기","수납박스","전기그릴"] },
  { id:"fashion", label:"패션/잡화", icon:"👗", kw:["운동화","크로스백","레깅스","선글라스","백팩"] },
  { id:"food",    label:"식품",      icon:"🍎", kw:["닭가슴살","견과류","프로틴바","커피원두","그릭요거트"] },
  { id:"pet",     label:"반려동물",  icon:"🐾", kw:["강아지사료","고양이간식","펫패드"] },
];
const getCat = kw => {
  const k = kw.toLowerCase();
  for (const c of CATS) if (c.kw.some(w=>k.includes(w)||w.includes(k))) return c;
  return { id:"etc", label:"기타", icon:"📦" };
};
const groupResults = (results) => {
  const ranked = results.map((item,i)=>({...item, globalRank:i}));
  const map = {};
  for (const item of ranked) {
    const cat = getCat(item.keyword);
    if (!map[cat.id]) map[cat.id] = { ...cat, items:[] };
    map[cat.id].items.push(item);
  }
  return Object.values(map)
    .map(g=>({ ...g, topScore: g.items[0]?.realtimeScore || g.items[0]?.finalScore || 0 }))
    .sort((a,b)=>b.topScore-a.topScore);
};

// ── 결과 카드 (compact) ───────────────
const CompactCard = ({ item, rank, mode }) => {
  const score = mode==="realtime" ? item.realtimeScore : item.finalScore;
  const sc = scoreColor(score);
  return (
    <div style={{ background:scoreBg(score), border:`1px solid ${sc}22`, borderRadius:9, padding:"9px 11px", display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ flexShrink:0, width:20, height:20, borderRadius:4,
        background:rank===0?"linear-gradient(135deg,#ffd700,#ff8800)":rank===1?"linear-gradient(135deg,#c0c0c0,#888)":"rgba(255,255,255,0.06)",
        display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:rank<2?"#000":"#555"
      }}>{rank+1}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:800, color:"#fff", marginBottom:2 }}>{item.keyword}</div>
        <div style={{ display:"flex", gap:5 }}>
          <span style={{ fontSize:9, color:statusColor(item.trend.status) }}>{statusIcon(item.trend.status)} {item.trend.status}</span>
          <span style={{ fontSize:9, color:item.timing.color }}>{item.timing.label}</span>
        </div>
      </div>
      <div style={{ textAlign:"right", flexShrink:0 }}>
        <div style={{ fontSize:16, fontWeight:900, color:sc }}>{score}</div>
        <div style={{ fontSize:8, color:"#444" }}>점</div>
      </div>
    </div>
  );
};

// ── 상세 카드 ─────────────────────────
const DetailCard = ({ item, rank, mode }) => {
  const [open, setOpen] = useState(false);
  const score = mode==="realtime" ? item.realtimeScore : item.finalScore;
  const sc = scoreColor(score);
  const isRT = mode==="realtime";

  return (
    <div style={{ background:scoreBg(score), border:`1px solid ${sc}22`, borderRadius:11, overflow:"hidden" }}>
      <div onClick={()=>setOpen(!open)} style={{ padding:"11px 13px", cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}>
        <div style={{ flexShrink:0, width:22, height:22, borderRadius:5,
          background:rank===0?"linear-gradient(135deg,#ffd700,#ff8800)":rank===1?"linear-gradient(135deg,#c0c0c0,#888)":rank===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)",
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:900, color:rank<3?"#000":"#555"
        }}>{rank+1}</div>

        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3, flexWrap:"wrap" }}>
            <span style={{ fontSize:13, fontWeight:800, color:"#fff" }}>{item.keyword}</span>
            {rank===0 && <span style={{ fontSize:9, padding:"2px 6px", borderRadius:5, background:"rgba(255,215,0,0.2)", color:"#ffd700", border:"1px solid rgba(255,215,0,0.4)", fontWeight:800 }}>
              {isRT ? "⚡ 실시간 1위" : "🔥 BEST"}
            </span>}
            <span style={{ fontSize:9, padding:"2px 5px", borderRadius:5, background:`${sc}22`, color:sc }}>{scoreLabel(score)}</span>
            <span style={{ fontSize:9, padding:"2px 5px", borderRadius:5, background:`${statusColor(item.trend.status)}18`, color:statusColor(item.trend.status) }}>
              {statusIcon(item.trend.status)} {item.trend.status}
            </span>
            <span style={{ fontSize:9, padding:"2px 5px", borderRadius:5, color:item.timing.color }}>{item.timing.label}</span>
            {getCat(item.keyword).icon && (
              <span style={{ fontSize:9, color:"#444" }}>{getCat(item.keyword).icon} {getCat(item.keyword).label}</span>
            )}
          </div>
          <Bar value={score} color={sc} />
        </div>

        <div style={{ flexShrink:0, textAlign:"right" }}>
          <div style={{ fontSize:20, fontWeight:900, color:sc, lineHeight:1 }}>{score}</div>
          <div style={{ fontSize:8, color:"#444" }}>/ 100</div>
        </div>
        <div style={{ fontSize:9, color:"#333" }}>{open?"▲":"▼"}</div>
      </div>

      {open && (
        <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", padding:"12px 13px" }}>

          {/* 실시간 전용 지표 */}
          {isRT && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:4, marginBottom:10 }}>
              {[
                { l:"실시간 점수", v:`${item.realtimeScore}점`,       c:"#ffd700" },
                { l:"상승 속도",   v:`${item.trend.velocity}x`,        c:item.trend.velocity>=2?"#ff4444":"#ff8800" },
                { l:"참여율",      v:`${item.trend.avgEngRate||0}%`,   c:"#03c75a" },
                { l:"최신 영상",   v:`${item.trend.freshCount||0}개`,  c:"#4488ff" },
              ].map((s,j)=>(
                <div key={j} style={{ background:"rgba(255,255,255,0.04)", borderRadius:6, padding:"6px 4px", textAlign:"center" }}>
                  <div style={{ fontSize:8, color:"#555", marginBottom:1 }}>{s.l}</div>
                  <div style={{ fontSize:11, fontWeight:800, color:s.c }}>{s.v}</div>
                </div>
              ))}
            </div>
          )}

          {/* 공통 지표 */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:4, marginBottom:10 }}>
            {[
              { l:"트렌드",  v:`${item.trend.score}점`,    c:"#ff4444" },
              { l:"가속도",  v:`${item.trend.velocity}x`,  c:"#ffd700" },
              { l:"구매의도",v:`${item.purchase}%`,         c:"#03c75a" },
              { l:"경쟁도",  v:`${item.competition}점`,    c:item.competition<50?"#03c75a":"#ff8800" },
              { l:"쇼핑",   v:`${item.shop?.score||0}점`,  c:"#4488ff" },
            ].map((s,j)=>(
              <div key={j} style={{ background:"rgba(255,255,255,0.04)", borderRadius:6, padding:"5px 3px", textAlign:"center" }}>
                <div style={{ fontSize:8, color:"#555", marginBottom:1 }}>{s.l}</div>
                <div style={{ fontSize:10, fontWeight:800, color:s.c }}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* 한줄 설명 */}
          <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:7, padding:"8px 10px", marginBottom:8 }}>
            <div style={{ fontSize:9, color:"#555", marginBottom:3 }}>{isRT?"⚡ 실시간 추천 이유":"💡 추천 이유"}</div>
            <div style={{ fontSize:11, color:"#bbb" }}>{item.reason}</div>
          </div>

          {/* 대표 상품 */}
          {item.shop?.top && (
            <div onClick={()=>item.shop.top.url&&window.open(item.shop.top.url,"_blank")}
              style={{ background:"rgba(3,199,90,0.05)", border:"1px solid rgba(3,199,90,0.12)", borderRadius:7, padding:"8px 10px", cursor:"pointer" }}
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

// ══════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════
export default function AutoRecommend({ apiKey }) {
  const [loadingRT, setLoadingRT]     = useState(false);
  const [loadingST, setLoadingST]     = useState(false);
  const [progress, setProgress]       = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [rtResults, setRtResults]     = useState([]);   // 실시간
  const [stResults, setStResults]     = useState([]);   // 안정
  const [rtGroups, setRtGroups]       = useState([]);
  const [stGroups, setStGroups]       = useState([]);
  const [error, setError]             = useState("");
  const [ranRT, setRanRT]             = useState(false);
  const [ranST, setRanST]             = useState(false);
  const [activeTab, setActiveTab]     = useState("home");
  const [catFilter, setCatFilter]     = useState("all");

  const handleRun = async (mode) => {
    const setLoading = mode==="realtime" ? setLoadingRT : setLoadingST;
    setLoading(true); setError(""); setProgress(0); setProgressMsg("시작 중...");
    if (mode==="realtime") setRanRT(true); else setRanST(true);
    try {
      const data = await runAutoRecommend(apiKey, (pct,msg)=>{ setProgress(pct); setProgressMsg(msg); }, mode);
      if (mode==="realtime") { setRtResults(data); setRtGroups(groupResults(data)); }
      else                   { setStResults(data); setStGroups(groupResults(data)); }
    } catch(e) {
      setError(e.message||"분석 중 오류 발생");
    } finally { setLoading(false); }
  };

  const loading    = loadingRT || loadingST;
  const curResults = activeTab==="realtime" ? rtResults : stResults;
  const curGroups  = activeTab==="cat" ? (ranRT ? rtGroups : stGroups) : [];
  const best       = curResults[0];

  const TABS = [
    { id:"home",     label:"홈",       icon:"🏠" },
    { id:"realtime", label:"실시간",   icon:"⚡" },
    { id:"stable",   label:"안정",     icon:"💰" },
    { id:"cat",      label:"카테고리", icon:"📊" },
    { id:"setting",  label:"설정",     icon:"⚙️" },
  ];

  const ProgressBar = () => loading && (
    <div style={{ marginBottom:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
        <span style={{ fontSize:11, color:"#888" }}>{progressMsg}</span>
        <span style={{ fontSize:11, color:"#ffd700", fontWeight:700 }}>{progress}%</span>
      </div>
      <div style={{ height:4, background:"#1a1a1a", borderRadius:99 }}>
        <div style={{ height:"100%", borderRadius:99, width:`${progress}%`, background:"linear-gradient(90deg,#ff880088,#ffd700)", transition:"width 0.3s" }} />
      </div>
      <div style={{ fontSize:10, color:"#444", marginTop:4, textAlign:"center" }}>
        네이버 쇼핑 · 블로그 · 뉴스 · YouTube 실시간 분석 중
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily:"'Segoe UI',sans-serif" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* 내부 탭 */}
      <div style={{ display:"flex", gap:2, marginBottom:16, background:"rgba(255,255,255,0.03)", borderRadius:10, padding:3, flexWrap:"wrap" }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
            flex:1, minWidth:52, padding:"8px 4px", borderRadius:7, border:"none", fontSize:11, cursor:"pointer",
            fontWeight:activeTab===t.id?700:400,
            background:activeTab===t.id?"rgba(255,255,255,0.1)":"transparent",
            color:activeTab===t.id?"#fff":"#555",
            borderBottom:activeTab===t.id?"2px solid #ffd700":"2px solid transparent",
            transition:"all 0.15s", whiteSpace:"nowrap"
          }}>{t.icon} {t.label}</button>
        ))}
      </div>

      <ProgressBar />
      {error && <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:8, padding:"9px 11px", color:"#ff8888", fontSize:12, marginBottom:12 }}>⚠️ {error}</div>}

      {/* ════ 홈 ════ */}
      {activeTab==="home" && (
        <div>
          {/* 실행 버튼 2개 */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
            <button onClick={()=>{ setActiveTab("realtime"); handleRun("realtime"); }} disabled={loadingRT} style={{
              padding:"14px 10px", borderRadius:11, border:"none", cursor:loadingRT?"not-allowed":"pointer",
              background:loadingRT?"#222":"linear-gradient(135deg,#ff4400,#ffd700)",
              color:loadingRT?"#555":"#000", fontWeight:800, fontSize:13,
              display:"flex", alignItems:"center", justifyContent:"center", gap:6
            }}>
              {loadingRT ? <><Spinner color="#ff8800" size={14}/> 분석 중...</> : <>⚡ 실시간 추천</>}
            </button>
            <button onClick={()=>{ setActiveTab("stable"); handleRun("stable"); }} disabled={loadingST} style={{
              padding:"14px 10px", borderRadius:11, border:"none", cursor:loadingST?"not-allowed":"pointer",
              background:loadingST?"#222":"linear-gradient(135deg,#0055ff,#03c75a)",
              color:loadingST?"#555":"#fff", fontWeight:800, fontSize:13,
              display:"flex", alignItems:"center", justifyContent:"center", gap:6
            }}>
              {loadingST ? <><Spinner color="#03c75a" size={14}/> 분석 중...</> : <>💰 안정 추천</>}
            </button>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginBottom:14 }}>
            <div style={{ background:"rgba(255,68,0,0.05)", border:"1px solid rgba(255,68,0,0.15)", borderRadius:9, padding:"10px 12px" }}>
              <div style={{ fontSize:10, color:"#ff8800", fontWeight:700, marginBottom:4 }}>⚡ 실시간 추천</div>
              <div style={{ fontSize:11, color:"#777" }}>최근 12~24h 유튜브 급상승 기반</div>
              <div style={{ fontSize:10, color:"#555", marginTop:4 }}>속도 35% · 참여도 25% · 구매의도 20%</div>
            </div>
            <div style={{ background:"rgba(3,199,90,0.05)", border:"1px solid rgba(3,199,90,0.15)", borderRadius:9, padding:"10px 12px" }}>
              <div style={{ fontSize:10, color:"#03c75a", fontWeight:700, marginBottom:4 }}>💰 안정 추천</div>
              <div style={{ fontSize:11, color:"#777" }}>쇼핑·검색 데이터 종합 분석</div>
              <div style={{ fontSize:10, color:"#555", marginTop:4 }}>트렌드 30% · 구매의도 30% · 쇼핑 25%</div>
            </div>
          </div>

          {/* 요약 */}
          {(ranRT || ranST) && (
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {ranRT && rtResults.length>0 && (
                <div>
                  <div style={{ fontSize:11, color:"#888", fontWeight:600, marginBottom:7 }}>⚡ 실시간 TOP 3</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                    {rtResults.slice(0,3).map((item,i)=><CompactCard key={item.keyword} item={item} rank={i} mode="realtime"/>)}
                  </div>
                </div>
              )}
              {ranST && stResults.length>0 && (
                <div>
                  <div style={{ fontSize:11, color:"#888", fontWeight:600, marginBottom:7 }}>💰 안정 TOP 3</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                    {stResults.slice(0,3).map((item,i)=><CompactCard key={item.keyword} item={item} rank={i} mode="stable"/>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ════ 실시간 추천 ════ */}
      {activeTab==="realtime" && (
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
            <div>
              <div style={{ fontSize:15, fontWeight:800 }}>⚡ 실시간 추천</div>
              <div style={{ fontSize:10, color:"#555", marginTop:2 }}>최근 12~24h 유튜브 급상승 상품</div>
            </div>
            <button onClick={()=>handleRun("realtime")} disabled={loadingRT} style={{ padding:"8px 16px", borderRadius:8, border:"none", cursor:loadingRT?"not-allowed":"pointer", background:loadingRT?"#222":"linear-gradient(135deg,#ff4400,#ffd700)", color:loadingRT?"#555":"#000", fontWeight:700, fontSize:11, display:"flex", alignItems:"center", gap:6 }}>
              {loadingRT ? <><Spinner color="#ff8800" size={12}/> 분석 중...</> : "⚡ 재분석"}
            </button>
          </div>

          {!ranRT && !loadingRT && <div style={{ textAlign:"center", color:"#444", fontSize:12, padding:32 }}>버튼을 눌러 실시간 추천을 시작하세요.</div>}
          {!loadingRT && ranRT && rtResults.length===0 && <div style={{ textAlign:"center", color:"#555", fontSize:12, padding:32 }}>현재 급상승 중인 항목이 없습니다.<br/>안정 추천을 이용해주세요.</div>}

          {!loadingRT && rtResults.length>0 && (
            <div>
              {/* BEST 하이라이트 */}
              <div style={{ background:"linear-gradient(135deg,rgba(255,68,0,0.08),rgba(255,215,0,0.05))", border:"1px solid rgba(255,215,0,0.2)", borderRadius:11, padding:"13px", marginBottom:12, display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:24 }}>⚡</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:10, color:"#ffd700", fontWeight:700, marginBottom:2 }}>실시간 1위</div>
                  <div style={{ fontSize:16, fontWeight:900, color:"#fff", marginBottom:2 }}>{rtResults[0].keyword}</div>
                  <div style={{ fontSize:10, color:"#888" }}>{rtResults[0].reason}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:28, fontWeight:900, color:"#ffd700", lineHeight:1 }}>{rtResults[0].realtimeScore}</div>
                  <div style={{ fontSize:9, color:"#555" }}>실시간 점수</div>
                </div>
              </div>

              <div style={{ fontSize:11, color:"#555", marginBottom:10 }}>급상승 키워드 <b style={{ color:"#ffd700" }}>TOP {rtResults.length}</b> · 실시간 점수 기준</div>
              <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                {rtResults.map((item,i)=><DetailCard key={item.keyword} item={item} rank={i} mode="realtime"/>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════ 안정 추천 ════ */}
      {activeTab==="stable" && (
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
            <div>
              <div style={{ fontSize:15, fontWeight:800 }}>💰 안정 추천</div>
              <div style={{ fontSize:10, color:"#555", marginTop:2 }}>쇼핑·검색 종합 데이터 기반</div>
            </div>
            <button onClick={()=>handleRun("stable")} disabled={loadingST} style={{ padding:"8px 16px", borderRadius:8, border:"none", cursor:loadingST?"not-allowed":"pointer", background:loadingST?"#222":"linear-gradient(135deg,#0055ff,#03c75a)", color:loadingST?"#555":"#fff", fontWeight:700, fontSize:11, display:"flex", alignItems:"center", gap:6 }}>
              {loadingST ? <><Spinner color="#03c75a" size={12}/> 분석 중...</> : "💰 재분석"}
            </button>
          </div>

          {!ranST && !loadingST && <div style={{ textAlign:"center", color:"#444", fontSize:12, padding:32 }}>버튼을 눌러 안정 추천을 시작하세요.</div>}
          {!loadingST && ranST && stResults.length===0 && <div style={{ textAlign:"center", color:"#444", fontSize:12, padding:32 }}>분석 결과가 없습니다. 다시 시도해주세요.</div>}

          {!loadingST && stResults.length>0 && (
            <div>
              {stResults[0] && (
                <div style={{ background:"linear-gradient(135deg,rgba(3,199,90,0.07),rgba(0,85,255,0.04))", border:"1px solid rgba(3,199,90,0.2)", borderRadius:11, padding:"13px", marginBottom:12, display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:24 }}>💰</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:10, color:"#03c75a", fontWeight:700, marginBottom:2 }}>안정 추천 1위</div>
                    <div style={{ fontSize:16, fontWeight:900, color:"#fff", marginBottom:2 }}>{stResults[0].keyword}</div>
                    <div style={{ fontSize:10, color:"#888" }}>{stResults[0].reason}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:28, fontWeight:900, color:"#03c75a", lineHeight:1 }}>{stResults[0].finalScore}</div>
                    <div style={{ fontSize:9, color:"#555" }}>종합 점수</div>
                  </div>
                </div>
              )}
              <div style={{ fontSize:11, color:"#555", marginBottom:10 }}>안정 추천 <b style={{ color:"#03c75a" }}>TOP {stResults.length}</b> · 종합 점수 기준</div>
              <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                {stResults.map((item,i)=><DetailCard key={item.keyword} item={item} rank={i} mode="stable"/>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════ 카테고리 ════ */}
      {activeTab==="cat" && (
        <div>
          <div style={{ fontSize:15, fontWeight:800, marginBottom:4 }}>📊 카테고리 분석</div>
          <div style={{ fontSize:10, color:"#555", marginBottom:12 }}>
            {ranRT ? "실시간 추천 기준" : ranST ? "안정 추천 기준" : "먼저 추천 분석을 실행해주세요"}
          </div>

          {!ranRT && !ranST ? (
            <div style={{ textAlign:"center", padding:40 }}>
              <button onClick={()=>setActiveTab("home")} style={{ padding:"9px 20px", borderRadius:8, border:"1px solid rgba(255,215,0,0.25)", background:"rgba(255,215,0,0.07)", color:"#ffd700", fontWeight:700, fontSize:12, cursor:"pointer" }}>홈으로 이동</button>
            </div>
          ) : (
            <div>
              <div style={{ display:"flex", gap:4, marginBottom:12, flexWrap:"wrap" }}>
                <button onClick={()=>setCatFilter("all")} style={{ padding:"5px 12px", borderRadius:20, border:catFilter==="all"?"1px solid rgba(255,215,0,0.3)":"1px solid rgba(255,255,255,0.06)", fontSize:10, cursor:"pointer", fontWeight:catFilter==="all"?700:400, background:catFilter==="all"?"rgba(255,215,0,0.12)":"rgba(255,255,255,0.03)", color:catFilter==="all"?"#ffd700":"#555" }}>
                  전체
                </button>
                {(ranRT ? rtGroups : stGroups).map(g=>(
                  <button key={g.id} onClick={()=>setCatFilter(g.id)} style={{ padding:"5px 12px", borderRadius:20, border:catFilter===g.id?"1px solid rgba(255,255,255,0.2)":"1px solid rgba(255,255,255,0.05)", fontSize:10, cursor:"pointer", background:catFilter===g.id?"rgba(255,255,255,0.09)":"rgba(255,255,255,0.03)", color:catFilter===g.id?"#fff":"#555" }}>
                    {g.icon} {g.label} {g.items.length}
                  </button>
                ))}
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                {(ranRT ? rtGroups : stGroups)
                  .filter(g=>catFilter==="all"||g.id===catFilter)
                  .map(group=>(
                    <div key={group.id}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:7, paddingBottom:6, borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                        <span style={{ fontSize:16 }}>{group.icon}</span>
                        <span style={{ fontSize:13, fontWeight:700, color:"#ccc" }}>{group.label}</span>
                        <span style={{ fontSize:10, color:"#444" }}>{group.items.length}개</span>
                        <div style={{ marginLeft:"auto", fontSize:10, color:"#555" }}>
                          최고 <b style={{ color:scoreColor(group.topScore) }}>{group.topScore}점</b>
                        </div>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                        {group.items.map((item,rank)=>(
                          <DetailCard key={item.keyword} item={item} rank={rank} mode={ranRT?"realtime":"stable"}/>
                        ))}
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════ 설정 ════ */}
      {activeTab==="setting" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:11, padding:"14px" }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:10 }}>🔑 API 상태</div>
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", background:"rgba(255,255,255,0.03)", borderRadius:7 }}>
              <div style={{ width:7, height:7, borderRadius:"50%", background:apiKey?"#03c75a":"#ff4444" }} />
              <span style={{ fontSize:11, color:"#ccc" }}>YouTube API Key</span>
              <span style={{ fontSize:10, color:apiKey?"#03c75a":"#ff4444", marginLeft:"auto" }}>{apiKey?"연결됨 (실시간 추천 가능)":"미설정 (안정 추천만 가능)"}</span>
            </div>
          </div>
          <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:11, padding:"14px" }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:10 }}>⚡ 실시간 vs 💰 안정 비교</div>
            {[
              { label:"수집 시간 윈도우",  rt:"12h (최신순)",        st:"48h (조회수순)" },
              { label:"YouTube 수집 방식", rt:"order=date (최신 우선)", st:"order=viewCount" },
              { label:"점수 공식",         rt:"속도35%+참여25%+구매20%+쇼핑15%", st:"트렌드30%+구매30%+쇼핑25%+경쟁15%" },
              { label:"상태 분류",         rt:"급상승/상승시작/유지/하락가능", st:"동일" },
              { label:"YouTube 필수 여부", rt:"필수", st:"선택 (없어도 결과)" },
              { label:"결과 수",           rt:"TOP 5", st:"TOP 10" },
            ].map((r,i)=>(
              <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, padding:"6px 0", borderBottom:i<5?"1px solid rgba(255,255,255,0.04)":"none" }}>
                <span style={{ fontSize:10, color:"#666" }}>{r.label}</span>
                <span style={{ fontSize:10, color:"#ff8800" }}>⚡ {r.rt}</span>
                <span style={{ fontSize:10, color:"#03c75a" }}>💰 {r.st}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
