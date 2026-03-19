const categoryColor = c =>
  c === "뉴스"   ? "#4488ff" :
  c === "카페"   ? "#ff8800" :
  c === "블로그" ? "#aa44ff" : "#03c75a";

const Spinner = ({ color }) => (
  <div style={{ display:"inline-block", width:26, height:26, border:`3px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
);

export default function KeywordResult({ keyword, keywords, loading, error, cacheHit }) {
  if (!keyword) return null;

  const maxCount = keywords.length > 0 ? Math.max(...keywords.map(k => k.count)) : 1;

  return (
    <div style={{ maxWidth:700, margin:"0 auto" }}>

      {/* 에러 */}
      {error && (
        <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:9, padding:"11px 15px", color:"#ff8888", fontSize:13, marginBottom:16 }}>
          ⚠️ {error}
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12, padding:40, color:"#666", fontSize:13 }}>
          <Spinner color="#03c75a" />
          <span>네이버 블로그·뉴스·카페 분석 중...</span>
        </div>
      )}

      {/* 결과 */}
      {!loading && keywords.length > 0 && (
        <>
          {/* 헤더 */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <div>
              <div style={{ fontSize:15, fontWeight:800, color:"#fff" }}>
                🔥 사람들이 진짜 관심 있는 키워드 TOP10
              </div>
              <div style={{ fontSize:11, color:"#555", marginTop:3 }}>
                <b style={{ color:"#03c75a" }}>"{keyword}"</b> 관련 네이버 블로그·뉴스·카페 분석 결과
                {cacheHit && <span style={{ marginLeft:8, color:"#ffaa00" }}>⚡ 캐시</span>}
              </div>
            </div>
          </div>

          {/* 키워드 리스트 */}
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {keywords.map((item, i) => (
              <div key={i} style={{
                background: i < 3 ? "rgba(3,199,90,0.06)" : "rgba(255,255,255,0.03)",
                border: i < 3 ? "1px solid rgba(3,199,90,0.2)" : "1px solid rgba(255,255,255,0.06)",
                borderRadius:12, padding:"12px 16px"
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:8 }}>
                  {/* 순위 */}
                  <div style={{
                    flexShrink:0, width:32, height:32, borderRadius:8,
                    background: i === 0 ? "linear-gradient(135deg,#ffd700,#ff8800)" :
                                i === 1 ? "linear-gradient(135deg,#c0c0c0,#888)" :
                                i === 2 ? "linear-gradient(135deg,#cd7f32,#8b4513)" :
                                "rgba(255,255,255,0.06)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:13, fontWeight:900, color: i < 3 ? "#000" : "#666"
                  }}>
                    {i + 1}
                  </div>

                  {/* 키워드 */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:15, fontWeight:800, color:"#fff" }}>{item.keyword}</span>
                      <span style={{
                        fontSize:10, padding:"2px 7px", borderRadius:20,
                        background:`${categoryColor(item.category)}22`,
                        color:categoryColor(item.category),
                        border:`1px solid ${categoryColor(item.category)}44`
                      }}>{item.category}</span>
                    </div>
                    <div style={{ fontSize:11, color:"#666", marginTop:2 }}>{item.reason}</div>
                  </div>

                  {/* 언급 횟수 */}
                  <div style={{ flexShrink:0, textAlign:"right" }}>
                    <div style={{ fontSize:16, fontWeight:900, color:"#03c75a" }}>{item.count.toLocaleString()}</div>
                    <div style={{ fontSize:10, color:"#444" }}>언급</div>
                  </div>
                </div>

                {/* 바 */}
                <div style={{ height:4, background:"#1a1a1a", borderRadius:99 }}>
                  <div style={{
                    height:"100%", borderRadius:99,
                    width:`${Math.round((item.count / maxCount) * 100)}%`,
                    background: i < 3
                      ? "linear-gradient(90deg,#03c75a88,#03c75a)"
                      : "linear-gradient(90deg,#ffffff22,#ffffff44)",
                    transition:"width 0.6s ease"
                  }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && keywords.length === 0 && !error && keyword && (
        <div style={{ textAlign:"center", color:"#333", fontSize:13, padding:24 }}>
          키워드 분석 결과가 없습니다.
        </div>
      )}
    </div>
  );
}
