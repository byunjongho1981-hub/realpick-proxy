// RealtimeTab.jsx
import { DetailCard, Spinner, EmptyBox, scoreColor } from "./shared";

export default function RealtimeTab({ loading, ran, results, onRun }) {
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:800 }}>⚡ 실시간 추천</div>
          <div style={{ fontSize:10, color:"#555", marginTop:2 }}>최근 12~24h 급상승 · DataLab+YouTube 기반</div>
        </div>
        <button onClick={onRun} disabled={loading} style={{ padding:"7px 14px", borderRadius:8, border:"none", cursor:loading?"not-allowed":"pointer", background:loading?"#222":"linear-gradient(135deg,#ff4400,#ffd700)", color:loading?"#555":"#000", fontWeight:700, fontSize:11, display:"flex", alignItems:"center", gap:5 }}>
          {loading?<><Spinner size={11}/> 분석 중...</>:"⚡ 재분석"}
        </button>
      </div>

      {!ran && !loading && <EmptyBox text="버튼을 눌러 실시간 추천을 시작하세요." />}
      {!loading && ran && results.length===0 && <EmptyBox text="현재 급상승 중인 항목이 없습니다. 안정 추천을 이용해주세요." />}

      {!loading && results.length>0 && (
        <div>
          {/* BEST 하이라이트 */}
          <div style={{ background:"linear-gradient(135deg,rgba(255,68,0,0.08),rgba(255,215,0,0.05))", border:"1px solid rgba(255,215,0,0.2)", borderRadius:11, padding:"12px 14px", marginBottom:11, display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:24 }}>⚡</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:10, color:"#ffd700", fontWeight:700, marginBottom:2 }}>실시간 1위</div>
              <div style={{ fontSize:15, fontWeight:900, color:"#fff", marginBottom:2 }}>{results[0].keyword}</div>
              <div style={{ fontSize:10, color:"#777" }}>{results[0].reason}</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:26, fontWeight:900, color:"#ffd700", lineHeight:1 }}>{results[0].realtimeScore}</div>
              <div style={{ fontSize:9, color:"#555" }}>실시간 점수</div>
            </div>
          </div>

          <div style={{ fontSize:11, color:"#555", marginBottom:9 }}>급상승 키워드 <b style={{ color:"#ffd700" }}>TOP {results.length}</b></div>
          <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
            {results.map((item,i)=><DetailCard key={item.keyword} item={item} rank={i} mode="realtime"/>)}
          </div>
        </div>
      )}
    </div>
  );
}
