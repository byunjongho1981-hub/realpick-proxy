const fmtPrice = n => n ? parseInt(n).toLocaleString() + "원" : "-";
const scoreColor = s => s >= 70 ? "#03c75a" : s >= 40 ? "#ff8800" : "#ff4444";
const scoreLabel = s => s >= 70 ? "🔥 높음" : s >= 40 ? "📊 보통" : "❄️ 낮음";

const Spinner = ({ color }) => (
  <div style={{
    display:"inline-block", width:20, height:20,
    border:`2px solid ${color}33`, borderTopColor:color,
    borderRadius:"50%", animation:"spin 0.8s linear infinite"
  }} />
);

export default function IntegratedAnalysis({ result, loading, error, keyword }) {
  if (!keyword) return null;

  return (
    <div>
      <div style={{
        fontSize:12, fontWeight:700, color:"#888", marginBottom:10,
        display:"flex", alignItems:"center", gap:6,
        borderBottom:"1px solid rgba(255,255,255,0.06)", paddingBottom:8
      }}>
        🔗 통합 분석
        {loading && <Spinner color="#aa44ff" />}
      </div>

      {error && (
        <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:8, padding:"10px 12px", color:"#ff8888", fontSize:12, marginBottom:10 }}>
          ⚠️ {error}
        </div>
      )}

      {loading && (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, padding:24, color:"#555", fontSize:12 }}>
          <Spinner color="#aa44ff" />
          <span>YouTube → 키워드 추출 → 네이버 검색 → 분석 중...</span>
        </div>
      )}

      {!loading && result && (
        <div>
          {/* 최종 추천 */}
          {result.recommendation && (
            <div style={{
              background:"rgba(170,68,255,0.08)",
              border:"1px solid rgba(170,68,255,0.25)",
              borderRadius:11, padding:12, marginBottom:12
            }}>
              <div style={{ fontSize:11, color:"#aa44ff", fontWeight:700, marginBottom:6 }}>✨ 최종 추천</div>
              <div style={{ fontSize:12, color:"#ccc", lineHeight:1.7 }}>{result.recommendation}</div>
            </div>
          )}

          {/* 키워드 목록 */}
          <div style={{ fontSize:11, color:"#555", marginBottom:8 }}>
            <b style={{ color:"#aa44ff" }}>"{keyword}"</b> 키워드 분석
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {(result.keywords || []).map((item, i) => (
              <div key={i} style={{
                background: i === 0 ? "rgba(170,68,255,0.07)" : "rgba(255,255,255,0.02)",
                border: i === 0 ? "1px solid rgba(170,68,255,0.2)" : "1px solid rgba(255,255,255,0.05)",
                borderRadius:10, padding:11
              }}>
                {/* 키워드 + 점수 */}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{
                      width:20, height:20, borderRadius:5, fontSize:10, fontWeight:900,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      background: i===0?"linear-gradient(135deg,#aa44ff,#6622cc)":
                                  i===1?"linear-gradient(135deg,#c0c0c0,#888)":
                                  i===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)",
                      color: i < 3 ? "#fff" : "#555"
                    }}>{i+1}</div>
                    <span style={{ fontSize:13, fontWeight:800, color:"#fff" }}>{item.keyword}</span>
                  </div>
                  <span style={{ fontSize:12, fontWeight:900, color:scoreColor(item.totalScore) }}>
                    {scoreLabel(item.totalScore)} {item.totalScore}점
                  </span>
                </div>

                {/* 점수 바 */}
                <div style={{ height:3, background:"#1a1a1a", borderRadius:99, marginBottom:9 }}>
                  <div style={{
                    height:"100%", borderRadius:99, width:`${item.totalScore}%`,
                    background:`linear-gradient(90deg,${scoreColor(item.totalScore)}66,${scoreColor(item.totalScore)})`
                  }} />
                </div>

                {/* 관심도 + 구매가능성 */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:7 }}>
                  <div style={{ background:"rgba(68,136,255,0.06)", border:"1px solid rgba(68,136,255,0.12)", borderRadius:7, padding:"7px 9px" }}>
                    <div style={{ fontSize:9, color:"#4488ff", fontWeight:700, marginBottom:4 }}>👥 사람 관심도</div>
                    <div style={{ fontSize:12, fontWeight:800, color:scoreColor(item.interest?.score||0), marginBottom:2 }}>
                      {item.interest?.level} ({item.interest?.score}점)
                    </div>
                    <div style={{ fontSize:10, color:"#555" }}>
                      블로그 {item.interest?.blogCount} · 뉴스 {item.interest?.newsCount}
                    </div>
                  </div>
                  <div style={{ background:"rgba(3,199,90,0.06)", border:"1px solid rgba(3,199,90,0.12)", borderRadius:7, padding:"7px 9px" }}>
                    <div style={{ fontSize:9, color:"#03c75a", fontWeight:700, marginBottom:4 }}>🛍 구매 가능성</div>
                    <div style={{ fontSize:12, fontWeight:800, color:scoreColor(item.purchase?.score||0), marginBottom:2 }}>
                      {item.purchase?.level} ({item.purchase?.score}점)
                    </div>
                    <div style={{ fontSize:10, color:"#555" }}>
                      상품 {item.purchase?.competition}개 · 평균 {fmtPrice(item.purchase?.avgPrice)}
                    </div>
                  </div>
                </div>

                {/* 대표 상품 */}
                {item.purchase?.topShop && (
                  <div
                    onClick={() => item.purchase.topShop.url && window.open(item.purchase.topShop.url, "_blank")}
                    style={{ background:"rgba(3,199,90,0.05)", border:"1px solid rgba(3,199,90,0.1)", borderRadius:6, padding:"6px 8px", cursor:"pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background="rgba(3,199,90,0.1)"}
                    onMouseLeave={e => e.currentTarget.style.background="rgba(3,199,90,0.05)"}
                  >
                    <div style={{ fontSize:9, color:"#03c75a", marginBottom:2 }}>🛍 대표 상품</div>
                    <div style={{ fontSize:11, color:"#ccc", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:2 }}>
                      {item.purchase.topShop.name}
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between" }}>
                      <span style={{ fontSize:11, fontWeight:900, color:"#03c75a" }}>{fmtPrice(item.purchase.topShop.price)}</span>
                      <span style={{ fontSize:10, color:"#444" }}>🏪 {item.purchase.topShop.mall}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && !result && (
        <div style={{ textAlign:"center", color:"#333", fontSize:12, padding:20 }}>
          검색하면 통합 분석이 시작됩니다.
        </div>
      )}
    </div>
  );
}
