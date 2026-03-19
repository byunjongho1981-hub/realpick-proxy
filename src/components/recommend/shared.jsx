// shared.jsx — 공통 유틸·컴포넌트
import { useState } from "react";

// ── 유틸 ──────────────────────────────
export const fmtPrice   = n => n ? parseInt(n).toLocaleString()+"원" : "-";
export const fmtNum     = n => { if(!n&&n!==0) return"-"; const x=parseInt(n)||0; if(x>=100000000) return(x/100000000).toFixed(1)+"억"; if(x>=10000) return Math.floor(x/10000)+"만"; if(x>=1000) return(x/1000).toFixed(1)+"천"; return x.toLocaleString(); };
export const fmtDate    = s => { if(!s) return"-"; const d=Math.floor((Date.now()-new Date(s))/86400000); if(d===0)return"오늘"; if(d<7)return`${d}일 전`; if(d<30)return`${Math.floor(d/7)}주 전`; return`${Math.floor(d/30)}개월 전`; };
export const scoreColor = s => s>=70?"#ffd700":s>=50?"#03c75a":s>=30?"#ff8800":"#888";
export const scoreLabel = s => s>=70?"S급":s>=50?"A급":s>=30?"B급":"C급";
export const scoreBg    = s => s>=70?"rgba(255,215,0,0.07)":s>=50?"rgba(3,199,90,0.06)":s>=30?"rgba(255,136,0,0.06)":"rgba(255,255,255,0.02)";
export const statusColor= s => s==="급상승"?"#ffd700":s==="상승 시작"?"#ff8800":s==="유지"?"#4488ff":"#ff4444";
export const statusIcon = s => s==="급상승"?"🚀":s==="상승 시작"?"📈":s==="유지"?"📊":"📉";

// ── 공통 UI ───────────────────────────
export const Spinner = ({ color="#ff8800", size=16 }) => (
  <div style={{ display:"inline-block", width:size, height:size, border:`2px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite", flexShrink:0 }} />
);

export const Bar = ({ value, color, height=3 }) => (
  <div style={{ height, background:"#1a1a1a", borderRadius:99 }}>
    <div style={{ height:"100%", borderRadius:99, width:`${Math.min(100,Math.max(0,value||0))}%`, background:`linear-gradient(90deg,${color}55,${color})`, transition:"width 0.6s" }} />
  </div>
);

export const ErrBox = ({ msg }) => (
  <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:8, padding:"9px 11px", color:"#ff8888", fontSize:12, marginBottom:12 }}>⚠️ {msg}</div>
);

export const EmptyBox = ({ text }) => (
  <div style={{ textAlign:"center", color:"#444", fontSize:12, padding:28 }}>{text}</div>
);

export const ProgressBar = ({ loading, progress, progressMsg }) => loading ? (
  <div style={{ marginBottom:14 }}>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
      <span style={{ fontSize:11, color:"#888" }}>{progressMsg}</span>
      <span style={{ fontSize:11, color:"#ffd700", fontWeight:700 }}>{progress}%</span>
    </div>
    <div style={{ height:4, background:"#1a1a1a", borderRadius:99 }}>
      <div style={{ height:"100%", borderRadius:99, width:`${progress}%`, background:"linear-gradient(90deg,#ff880088,#ffd700)", transition:"width 0.3s" }} />
    </div>
    <div style={{ fontSize:10, color:"#444", marginTop:4, textAlign:"center" }}>네이버 쇼핑 · 블로그 · 뉴스 · YouTube 분석 중</div>
  </div>
) : null;

// ── 카테고리 ──────────────────────────
export const CATS = [
  { id:"tech",    label:"가전/IT",   icon:"💻", kw:["무선이어폰","공기청정기","로봇청소기","노트북","태블릿","스마트워치","블루투스스피커","보조배터리"] },
  { id:"beauty",  label:"뷰티/건강", icon:"✨", kw:["선크림","세럼","비타민","마스크팩","폼클렌징","샴푸","단백질보충제","유산균"] },
  { id:"living",  label:"생활/주방", icon:"🏠", kw:["에어프라이어","전기포트","텀블러","가습기","제습기","수납박스","전기그릴"] },
  { id:"fashion", label:"패션/잡화", icon:"👗", kw:["운동화","크로스백","레깅스","선글라스","백팩"] },
  { id:"food",    label:"식품",      icon:"🍎", kw:["닭가슴살","견과류","프로틴바","커피원두","그릭요거트"] },
  { id:"pet",     label:"반려동물",  icon:"🐾", kw:["강아지사료","고양이간식","펫패드"] },
];
export const getCat = kw => { const k=kw.toLowerCase(); for(const c of CATS) if(c.kw.some(w=>k.includes(w)||w.includes(k))) return c; return {id:"etc",label:"기타",icon:"📦"}; };
export const groupResults = results => {
  const ranked = results.map((item,i)=>({...item,globalRank:i}));
  const map = {};
  for(const item of ranked){ const cat=getCat(item.keyword); if(!map[cat.id]) map[cat.id]={...cat,items:[]}; map[cat.id].items.push(item); }
  return Object.values(map).map(g=>({...g,topScore:g.items[0]?.realtimeScore||g.items[0]?.finalScore||0})).sort((a,b)=>b.topScore-a.topScore);
};

// ── 추천 카드 (compact) ───────────────
export const CompactCard = ({ item, rank, mode }) => {
  const score = mode==="realtime"?item.realtimeScore:item.finalScore;
  const sc = scoreColor(score);
  return (
    <div style={{ background:scoreBg(score), border:`1px solid ${sc}22`, borderRadius:9, padding:"9px 11px", display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ flexShrink:0, width:20, height:20, borderRadius:4, background:rank===0?"linear-gradient(135deg,#ffd700,#ff8800)":rank===1?"linear-gradient(135deg,#c0c0c0,#888)":"rgba(255,255,255,0.06)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:rank<2?"#000":"#555" }}>{rank+1}</div>
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

// ── 추천 카드 (detail) ────────────────
export const DetailCard = ({ item, rank, mode }) => {
  const [open, setOpen] = useState(false);
  const score = mode==="realtime"?item.realtimeScore:item.finalScore;
  const sc = scoreColor(score);
  const isRT = mode==="realtime";
  return (
    <div style={{ background:scoreBg(score), border:`1px solid ${sc}22`, borderRadius:11, overflow:"hidden" }}>
      <div onClick={()=>setOpen(!open)} style={{ padding:"11px 13px", cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}>
        <div style={{ flexShrink:0, width:22, height:22, borderRadius:5, background:rank===0?"linear-gradient(135deg,#ffd700,#ff8800)":rank===1?"linear-gradient(135deg,#c0c0c0,#888)":rank===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:900, color:rank<3?"#000":"#555" }}>{rank+1}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3, flexWrap:"wrap" }}>
            <span style={{ fontSize:13, fontWeight:800, color:"#fff" }}>{item.keyword}</span>
            {rank===0 && <span style={{ fontSize:9, padding:"2px 6px", borderRadius:5, background:"rgba(255,215,0,0.2)", color:"#ffd700", border:"1px solid rgba(255,215,0,0.4)", fontWeight:800 }}>{isRT?"⚡ 실시간 1위":"🔥 BEST"}</span>}
            <span style={{ fontSize:9, padding:"2px 5px", borderRadius:5, background:`${sc}22`, color:sc }}>{scoreLabel(score)}</span>
            <span style={{ fontSize:9, padding:"2px 5px", borderRadius:5, background:`${statusColor(item.trend.status)}18`, color:statusColor(item.trend.status) }}>{statusIcon(item.trend.status)} {item.trend.status}</span>
            <span style={{ fontSize:9, padding:"2px 5px", color:item.timing.color }}>{item.timing.label}</span>
            <span style={{ fontSize:9, color:"#444" }}>{getCat(item.keyword).icon} {getCat(item.keyword).label}</span>
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
          {isRT && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:4, marginBottom:10 }}>
              {[
                { l:"실시간 점수", v:`${item.realtimeScore}점`, c:"#ffd700" },
                { l:"상승 속도",   v:`${item.trend.velocity}x`, c:item.trend.velocity>=2?"#ff4444":"#ff8800" },
                { l:"참여율",      v:`${item.trend.avgEngRate||0}%`, c:"#03c75a" },
                { l:"최신 영상",   v:`${item.trend.freshCount||0}개`, c:"#4488ff" },
              ].map((s,j)=>(
                <div key={j} style={{ background:"rgba(255,255,255,0.04)", borderRadius:6, padding:"6px 4px", textAlign:"center" }}>
                  <div style={{ fontSize:8, color:"#555", marginBottom:1 }}>{s.l}</div>
                  <div style={{ fontSize:11, fontWeight:800, color:s.c }}>{s.v}</div>
                </div>
              ))}
            </div>
          )}
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
          <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:7, padding:"8px 10px", marginBottom:8 }}>
            <div style={{ fontSize:9, color:"#555", marginBottom:3 }}>{isRT?"⚡ 실시간 추천 이유":"💡 추천 이유"}</div>
            <div style={{ fontSize:11, color:"#bbb" }}>{item.reason}</div>
          </div>
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
