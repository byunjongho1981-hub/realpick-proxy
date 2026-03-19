const fmtPrice = n => n ? parseInt(n).toLocaleString() + "원" : "-";
const scoreColor = s => s >= 70 ? "#03c75a" : s >= 40 ? "#ff8800" : "#ff4444";
const scoreLabel = s => s >= 70 ? "🔥 고관심" : s >= 40 ? "📊 보통" : "❄️ 저관심";

const Spinner = ({ color }) => (
  <div style={{ display:"inline-block", width:26, height:26, border:`3px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
);

export default function IntegratedAnalysis({ result, loading, error, keyword }) {
  if (!keyword) return null;

  return (
    <div style={{ marginTop:24 }}>
      {/* 헤더 */}
      <div style={{ fontSize:13, fontWeight:700, color:"#aaa", marginBottom:12, display:"flex", alignItems:"center", gap:8 }}>
        🔗 통합 분석
        {loading && <Spinner color="#aa44ff" />}
      </div>

      {error && (
        <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:8, padding:"10px 12px", color:"#ff8888", fontSize:12, marginBottom:10 }}>
          ⚠️ {error}
        </div>
      )}

      {loading && (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12, padding:30, color:"#666", fontSize:12 }}>
          <Spinner color="#aa44ff" />
          유튜브 제목 분석 → 네이버 검색 → 통합 분석 중...
        </div>
      )}

      {!loading && result?.keywords?.length > 0 && (
        <>
          <div style={{ fontSize:11, color:"#555", marginBottom:14 }}>
            <b style={{ color:"#aa44ff" }}>"{keyword}"</b> 관련 유튜브 제목에서 추출한 키워드별 관심도 분석
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {result.keywords.map((item, i) => (
              <div key={i} style={{
                background: i===0 ? "rgba(170,68,255,0.08)" : "rgba(255,255,255,0.03)",
                border: i===0 ? "1px solid rgba(170,68,255,0.3)" : "1px solid rgba(255,255,255,0.06)",
                borderRadius:13, padding:14
              }}>
                {/* 키워드 + 점수 */}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:24, height:24, borderRadius:6,
                      background: i===0?"linear-gradient(135deg,#aa44ff,#6622cc)":i===1?"linear-gradient(135deg,#c0c0c0,#888)":i===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)",
                      display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:900, color:i<3?"#fff":"#666"
                    }}>{i+1}</div>
                    <span style={{ fontSize:15, fontWeight:800, color:"#fff" }}>{item.keyword}</span>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:13, fontWeight:900, color:scoreColor(item.interestScore) }}>
                      {scoreLabel(item.interestScore)}
                    </div>
                    <div style={{ fontSize:11, color:"#555" }}>{item.interestScore}점</div>
                  </div>
                </div>

                {/* 점수 바 */}
                <div style={{ height:4, background:"#1a1a1a", borderRadius:99, marginBottom:12 }}>
                  <div style={{ height:"100%", borderRadius:99, width:`${item.interestScore}%`,
                    background:`linear-gradient(90deg,${scoreColor(item.interestScore)}88,${scoreColor(item.interestScore)})`,
                    transition:"width 0.6s"
                  }} />
                </div>

                {/* 통계 */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:10 }}>
                  {[
                    { label:"📰 언급수", value:`${item.mentionCount}건`, color:"#4488ff" },
                    { label:"🛍 쇼핑상품", value:`${item.shopCount}개`, color:"#03c75a" },
                    { label:"💰 평균가", value:fmtPrice(item.avgPrice), color:"#ffcc00" }
                  ].map((stat,j) => (
                    <div key={j} style={{ background:"rgba(255,255,255,0.04)", borderRadius:8, padding:"8px", textAlign:"center" }}>
                      <div style={{ fontSize:10, color:"#555", marginBottom:3 }}>{stat.label}</div>
                      <div style={{ fontSize:12, fontWeight:800, color:stat.color }}>{stat.value}</div>
                    </div>
                  ))}
                </div>

                {/* 대표 쇼핑 상품 */}
                {item.topShop && (
                  <div onClick={() => item.topShop.url && window.open(item.topShop.url, "_blank")}
                    style={{ background:"rgba(3,199,90,0.06)", border:"1px solid rgba(3,199,90,0.15)", borderRadius:8, padding:"8px 10px", cursor:"pointer", marginBottom:8 }}
                    onMouseEnter={e => e.currentTarget.style.background="rgba(3,199,90,0.12)"}
                    onMouseLeave={e => e.currentTarget.style.background="rgba(3,199,90,0.06)"}>
                    <div style={{ fontSize:10, color:"#03c75a", marginBottom:3 }}>🛍 대표 상품</div>
                    <div style={{ fontSize:11, color:"#ccc", marginBottom:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.topShop.name}</div>
                    <div style={{ display:"flex", justifyContent:"space-between" }}>
                      <span style={{ fontSize:12, fontWeight:900, color:"#03c75a" }}>{fmtPrice(item.topShop.price)}</span>
                      <span style={{ fontSize:10, color:"#555" }}>🏪 {item.topShop.mall}</span>
                    </div>
                  </div>
                )}

                {/* 대표 뉴스/블로그 */}
                {(item.topNews || item.topBlog) && (
                  <div style={{ fontSize:10, color:"#555", lineHeight:1.5 }}>
                    {item.topNews && <div>📰 {item.topNews}</div>}
                    {item.topBlog && <div>📝 {item.topBlog}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && !error && !result && keyword && (
        <div style={{ textAlign:"center", color:"#333", fontSize:12, padding:20 }}>
          검색하면 통합 분석이 시작됩니다.
        </div>
      )}
    </div>
  );
}
