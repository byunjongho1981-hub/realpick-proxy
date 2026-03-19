// StableTab.jsx
import { DetailCard, Spinner, EmptyBox } from "./shared";

export default function StableTab({ loading, ran, results, onRun }) {
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:800 }}>💰 안정 추천</div>
          <div style={{ fontSize:10, color:"#555", marginTop:2 }}>쇼핑·검색 종합 데이터 기반</div>
        </div>
        <button onClick={onRun} disabled={loading} style={{ padding:"7px 14px", borderRadius:8, border:"none", cursor:loading?"not-allowed":"pointer", background:loading?"#222":"linear-gradient(135deg,#0055ff,#03c75a)", color:loading?"#555":"#fff", fontWeight:700, fontSize:11, display:"flex", alignItems:"center", gap:5 }}>
          {loading?<><Spinner color="#03c75a" size={11}/> 분석 중...</>:"💰 재분석"}
        </button>
      </div>

      {!ran && !loading && <EmptyBox text="버튼을 눌러 안정 추천을 시작하세요." />}
      {!loading && ran && results.length===0 && <EmptyBox text="분석 결과가 없습니다. 다시 시도해주세요." />}

      {!loading && results.length>0 && (
        <div>
          <div style={{ background:"linear-gradient(135deg,rgba(3,199,90,0.07),rgba(0,85,255,0.04))", border:"1px solid rgba(3,199,90,0.2)", borderRadius:11, padding:"12px 14px", marginBottom:11, display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:24 }}>💰</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:10, color:"#03c75a", fontWeight:700, marginBottom:2 }}>안정 추천 1위</div>
              <div style={{ fontSize:15, fontWeight:900, color:"#fff", marginBottom:2 }}>{results[0].keyword}</div>
              <div style={{ fontSize:10, color:"#777" }}>{results[0].reason}</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:26, fontWeight:900, color:"#03c75a", lineHeight:1 }}>{results[0].finalScore}</div>
              <div style={{ fontSize:9, color:"#555" }}>종합 점수</div>
            </div>
          </div>

          <div style={{ fontSize:11, color:"#555", marginBottom:9 }}>안정 추천 <b style={{ color:"#03c75a" }}>TOP {results.length}</b></div>
          <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
            {results.map((item,i)=><DetailCard key={item.keyword} item={item} rank={i} mode="stable"/>)}
          </div>
        </div>
      )}
    </div>
  );
}
