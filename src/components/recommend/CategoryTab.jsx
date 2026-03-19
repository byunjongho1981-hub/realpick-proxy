// CategoryTab.jsx
import { useState } from "react";
import { DetailCard, scoreColor } from "./shared";

export default function CategoryTab({ ranRT, ranST, rtGroups, stGroups, onTabChange }) {
  const [catFilter, setCatFilter] = useState("all");
  const groups = ranRT ? rtGroups : stGroups;
  const mode   = ranRT ? "realtime" : "stable";

  if(!ranRT && !ranST) return (
    <div style={{ textAlign:"center", padding:40 }}>
      <div style={{ fontSize:13, color:"#444", marginBottom:14 }}>먼저 추천 분석을 실행해주세요.</div>
      <button onClick={()=>onTabChange("home")} style={{ padding:"8px 18px", borderRadius:8, border:"1px solid rgba(255,215,0,0.25)", background:"rgba(255,215,0,0.07)", color:"#ffd700", fontWeight:700, fontSize:11, cursor:"pointer" }}>홈으로 이동</button>
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:15, fontWeight:800, marginBottom:3 }}>📊 카테고리 분석</div>
        <div style={{ fontSize:10, color:"#555" }}>{ranRT?"실시간 추천 기준":"안정 추천 기준"}</div>
      </div>

      {/* 필터 */}
      <div style={{ display:"flex", gap:4, marginBottom:12, flexWrap:"wrap" }}>
        <button onClick={()=>setCatFilter("all")} style={{ padding:"4px 10px", borderRadius:20, border:catFilter==="all"?"1px solid rgba(255,215,0,0.3)":"1px solid rgba(255,255,255,0.06)", fontSize:9, cursor:"pointer", fontWeight:catFilter==="all"?700:400, background:catFilter==="all"?"rgba(255,215,0,0.12)":"rgba(255,255,255,0.03)", color:catFilter==="all"?"#ffd700":"#555" }}>전체 {groups.reduce((s,g)=>s+g.items.length,0)}</button>
        {groups.map(g=>(
          <button key={g.id} onClick={()=>setCatFilter(g.id)} style={{ padding:"4px 10px", borderRadius:20, border:catFilter===g.id?"1px solid rgba(255,255,255,0.2)":"1px solid rgba(255,255,255,0.05)", fontSize:9, cursor:"pointer", background:catFilter===g.id?"rgba(255,255,255,0.09)":"rgba(255,255,255,0.03)", color:catFilter===g.id?"#fff":"#555" }}>
            {g.icon} {g.label} {g.items.length}
          </button>
        ))}
      </div>

      {/* 카테고리별 카드 */}
      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        {groups.filter(g=>catFilter==="all"||g.id===catFilter).map(group=>(
          <div key={group.id}>
            <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:7, paddingBottom:5, borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontSize:15 }}>{group.icon}</span>
              <span style={{ fontSize:12, fontWeight:700, color:"#ccc" }}>{group.label}</span>
              <span style={{ fontSize:9, color:"#444" }}>{group.items.length}개</span>
              <div style={{ marginLeft:"auto", fontSize:10, color:"#555" }}>최고 <b style={{ color:scoreColor(group.topScore) }}>{group.topScore}점</b></div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
              {group.items.map((item,rank)=><DetailCard key={item.keyword} item={item} rank={rank} mode={mode}/>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
