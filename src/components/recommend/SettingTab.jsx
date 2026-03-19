// SettingTab.jsx
export default function SettingTab({ apiKey, VERSION_LOG }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {/* API 상태 */}
      <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:11, padding:"14px" }}>
        <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:10 }}>🔑 API 상태</div>
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", background:"rgba(255,255,255,0.03)", borderRadius:7 }}>
          <div style={{ width:7, height:7, borderRadius:"50%", background:apiKey?"#03c75a":"#ff4444", flexShrink:0 }} />
          <span style={{ fontSize:11, color:"#ccc" }}>YouTube API Key</span>
          <span style={{ fontSize:10, color:apiKey?"#03c75a":"#ff4444", marginLeft:"auto" }}>{apiKey?"연결됨 (실시간·쇼츠 탐색 가능)":"미설정"}</span>
        </div>
        <div style={{ fontSize:10, color:"#555", marginTop:8, padding:"6px 10px", background:"rgba(255,255,255,0.02)", borderRadius:6 }}>
          YouTube API Key는 상단 검색창의 API Key 입력란에서 설정하세요.
        </div>
      </div>

      {/* 점수 공식 */}
      <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:11, padding:"14px" }}>
        <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:10 }}>📐 점수 공식</div>
        {[
          { l:"⚡ 실시간", d:"YT속도 35% + DataLab 25% + 쇼핑클릭 20% + 구매의도 15% + 경쟁역수 5%", c:"#ff8800" },
          { l:"💰 안정",   d:"트렌드 25% + YouTube 25% + 구매의도 25% + 쇼핑점수 20% + 경쟁역수 10%", c:"#03c75a" },
          { l:"🎬 쇼츠",   d:"조회수 25% + 좋아요율 20% + 최신성 15% + 쇼츠판별 15% + 제품키워드 15% + 댓글 10%", c:"#4488ff" },
        ].map((r,i)=>(
          <div key={i} style={{ padding:"8px 0", borderBottom:i<2?"1px solid rgba(255,255,255,0.04)":"none" }}>
            <div style={{ fontSize:11, color:r.c, fontWeight:700, marginBottom:3 }}>{r.l}</div>
            <div style={{ fontSize:10, color:"#555" }}>{r.d}</div>
          </div>
        ))}
      </div>

      {/* 데이터 소스 */}
      <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:11, padding:"14px" }}>
        <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:10 }}>📡 데이터 소스</div>
        {[
          { icon:"🔴", label:"Google Trends RSS",   desc:"한국 급상승 검색어 — 가중치 4x" },
          { icon:"🟢", label:"네이버 쇼핑",          desc:"인기 상품명 직접 추출 — 가중치 3x" },
          { icon:"🟡", label:"YouTube Data API",    desc:"최신 영상 반응 속도 — 가중치 2x" },
          { icon:"⚪", label:"네이버 DataLab",       desc:"검색 트렌드 1일/7일/30일 비교" },
          { icon:"⚪", label:"네이버 Shopping Insight", desc:"쇼핑 클릭 추이 분석" },
        ].map((r,i)=>(
          <div key={i} style={{ display:"flex", gap:10, padding:"6px 0", borderBottom:i<4?"1px solid rgba(255,255,255,0.04)":"none", alignItems:"center" }}>
            <span style={{ fontSize:12, flexShrink:0 }}>{r.icon}</span>
            <div>
              <div style={{ fontSize:11, color:"#ccc" }}>{r.label}</div>
              <div style={{ fontSize:9, color:"#555" }}>{r.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 버전 히스토리 */}
      <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:11, padding:"14px" }}>
        <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:10 }}>📋 버전 히스토리</div>
        {VERSION_LOG.map((v,i)=>(
          <div key={i} style={{ display:"flex", gap:10, marginBottom:6, alignItems:"center" }}>
            <span style={{ fontSize:9, padding:"2px 8px", borderRadius:20, background:i===0?"rgba(255,215,0,0.15)":"rgba(255,255,255,0.04)", color:i===0?"#ffd700":"#555", fontWeight:i===0?700:400, flexShrink:0 }}>{v.ver}</span>
            <span style={{ fontSize:10, color:i===0?"#aaa":"#444" }}>{v.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
