// HomeTab.jsx
import { useState } from "react";
import { CompactCard, Spinner } from "./shared";

export default function HomeTab({ apiKey, loadingRT, loadingST, ranRT, ranST, rtResults, stResults, onRunRT, onRunST, onTabChange, VERSION_LOG }) {
  const [showLog, setShowLog] = useState(false);
  const VERSION = VERSION_LOG[0]?.ver || "v1.0";

  return (
    <div>
      {/* 버전 클릭 → 체인지로그 */}
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:10 }}>
        <button onClick={()=>setShowLog(!showLog)} style={{ fontSize:9, color:"#ffd700", padding:"3px 10px", borderRadius:20, border:"1px solid rgba(255,215,0,0.25)", background:"rgba(255,215,0,0.06)", cursor:"pointer" }}>
          {VERSION} {showLog?"▲":"▼"}
        </button>
      </div>

      {showLog && (
        <div style={{ background:"rgba(255,215,0,0.04)", border:"1px solid rgba(255,215,0,0.15)", borderRadius:9, padding:"10px 12px", marginBottom:14 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#ffd700", marginBottom:8 }}>📋 버전 히스토리</div>
          {VERSION_LOG.map((v,i)=>(
            <div key={i} style={{ display:"flex", gap:10, marginBottom:4, alignItems:"center" }}>
              <span style={{ fontSize:9, padding:"2px 7px", borderRadius:20, background:i===0?"rgba(255,215,0,0.15)":"rgba(255,255,255,0.05)", color:i===0?"#ffd700":"#555", fontWeight:i===0?700:400, flexShrink:0 }}>{v.ver}</span>
              <span style={{ fontSize:10, color:i===0?"#ccc":"#555" }}>{v.desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* 실행 버튼 */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
        <button onClick={onRunRT} disabled={loadingRT} style={{ padding:"13px 10px", borderRadius:11, border:"none", cursor:loadingRT?"not-allowed":"pointer", background:loadingRT?"#222":"linear-gradient(135deg,#ff4400,#ffd700)", color:loadingRT?"#555":"#000", fontWeight:800, fontSize:13, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
          {loadingRT?<><Spinner size={14}/> 분석 중...</>:<>⚡ 실시간 추천</>}
        </button>
        <button onClick={onRunST} disabled={loadingST} style={{ padding:"13px 10px", borderRadius:11, border:"none", cursor:loadingST?"not-allowed":"pointer", background:loadingST?"#222":"linear-gradient(135deg,#0055ff,#03c75a)", color:loadingST?"#555":"#fff", fontWeight:800, fontSize:13, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
          {loadingST?<><Spinner color="#03c75a" size={14}/> 분석 중...</>:<>💰 안정 추천</>}
        </button>
      </div>

      {/* 기능 카드 */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:16 }}>
        {[
          { icon:"⚡", label:"실시간 추천", desc:"12~24h 급상승 기반", color:"#ff8800", tab:"realtime" },
          { icon:"💰", label:"안정 추천",   desc:"쇼핑·검색 종합 분석", color:"#03c75a", tab:"stable" },
          { icon:"🎬", label:"쇼츠 탐색",   desc:"제품성 점수 분석", color:"#4488ff", tab:"shorts" },
        ].map((c,i)=>(
          <div key={i} onClick={()=>onTabChange(c.tab)} style={{ background:`${c.color}08`, border:`1px solid ${c.color}18`, borderRadius:9, padding:"12px 8px", textAlign:"center", cursor:"pointer", transition:"background 0.15s" }}
            onMouseEnter={e=>e.currentTarget.style.background=`${c.color}15`}
            onMouseLeave={e=>e.currentTarget.style.background=`${c.color}08`}>
            <div style={{ fontSize:22, marginBottom:5 }}>{c.icon}</div>
            <div style={{ fontSize:11, fontWeight:700, color:"#ccc", marginBottom:3 }}>{c.label}</div>
            <div style={{ fontSize:9, color:"#555" }}>{c.desc}</div>
          </div>
        ))}
      </div>

      {/* 점수 공식 요약 */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:14 }}>
        <div style={{ background:"rgba(255,68,0,0.05)", border:"1px solid rgba(255,68,0,0.12)", borderRadius:9, padding:"10px 12px" }}>
          <div style={{ fontSize:10, color:"#ff8800", fontWeight:700, marginBottom:4 }}>⚡ 실시간 공식</div>
          <div style={{ fontSize:9, color:"#555", lineHeight:1.7 }}>YT속도 35%<br/>DataLab 25%<br/>쇼핑클릭 20%<br/>구매의도 15%</div>
        </div>
        <div style={{ background:"rgba(3,199,90,0.05)", border:"1px solid rgba(3,199,90,0.12)", borderRadius:9, padding:"10px 12px" }}>
          <div style={{ fontSize:10, color:"#03c75a", fontWeight:700, marginBottom:4 }}>💰 안정 공식</div>
          <div style={{ fontSize:9, color:"#555", lineHeight:1.7 }}>트렌드 25%<br/>YouTube 25%<br/>구매의도 25%<br/>쇼핑점수 20%</div>
        </div>
      </div>

      {/* 결과 요약 */}
      {(ranRT || ranST) && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {ranRT && rtResults.length>0 && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
                <div style={{ fontSize:11, color:"#888", fontWeight:600 }}>⚡ 실시간 TOP 3</div>
                <button onClick={()=>onTabChange("realtime")} style={{ fontSize:9, color:"#ff8800", background:"transparent", border:"none", cursor:"pointer" }}>전체 보기 →</button>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                {rtResults.slice(0,3).map((item,i)=><CompactCard key={item.keyword} item={item} rank={i} mode="realtime"/>)}
              </div>
            </div>
          )}
          {ranST && stResults.length>0 && (
            <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
                <div style={{ fontSize:11, color:"#888", fontWeight:600 }}>💰 안정 TOP 3</div>
                <button onClick={()=>onTabChange("stable")} style={{ fontSize:9, color:"#03c75a", background:"transparent", border:"none", cursor:"pointer" }}>전체 보기 →</button>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                {stResults.slice(0,3).map((item,i)=><CompactCard key={item.keyword} item={item} rank={i} mode="stable"/>)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
