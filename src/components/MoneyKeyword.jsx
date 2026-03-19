const fmtPrice = n => n ? parseInt(n).toLocaleString() + "원" : "-";
const moneyColor = s => s >= 70 ? "#ffd700" : s >= 40 ? "#ff8800" : "#888";
const moneyLabel = s => s >= 70 ? "💰 고수익 가능" : s >= 40 ? "📈 가능성 있음" : "📊 낮음";

const Spinner = ({ color }) => (
  <div style={{ display:"inline-block", width:20, height:20, border:`2px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
);

const Badge = ({ text, color }) => (
  <span style={{ fontSize:9, padding:"2px 6px", borderRadius:10, background:`${color}22`, color, border:`1px solid ${color}44`, marginLeft:4 }}>{text}</span>
);

export default function MoneyKeyword({ result, loading, error, keyword }) {
  if (!keyword) return null;

  const top1 = result?.top10?.[0];

  return (
    <div>
      {/* 헤더 */}
      <div style={{ fontSize:12, fontWeight:700, color:"#888", marginBottom:10, display:"flex", alignItems:"center", gap:6, borderBottom:"1px solid rgba(255,255,255,0.06)", paddingBottom:8 }}>
        💰 돈 될 키워드 분석
        {loading && <Spinner color="#ffd700" />}
      </div>

      {error && (
        <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:8, padding:"10px 12px", color:"#ff8888", fontSize:12, marginBottom:10 }}>
          ⚠️ {error}
        </div>
      )}

      {loading && (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, padding:24, color:"#555", fontSize:12 }}>
          <Spinner color="#ffd700" />
          <span>블로그·뉴스·카페 수집 → 키워드 추출 → 쇼핑 분석 중...</span>
        </div>
      )}

      {!loading && result && (
        <div>
          {/* 총 수집 데이터 */}
          <div style={{ fontSize:10, color:"#555", marginBottom:12 }}>
            <b style={{ color:"#ffd700" }}>"{keyword}"</b> 관련 네이버 문서 <b style={{ color:"#fff" }}>{result.totalDocs}개</b> 분석 완료
          </div>

          {/* 1위 강조 카드 */}
          {top1 && (
            <div style={{ background:"linear-gradient(135deg,rgba(255,215,0,0.1),rgba(255,136,0,0.06))", border:"1px solid rgba(255,215,0,0.3)", borderRadius:12, padding:14, marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                <div>
                  <div style={{ fontSize:10, color:"#ffd700", fontWeight:700, marginBottom:4 }}>🏆 가장 돈 될 키워드</div>
                  <div style={{ fontSize:18, fontWeight:900, color:"#fff" }}>{top1.keyword}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:20, fontWeight:900, color:"#ffd700" }}>{top1.moneyScore}점</div>
                  <div style={{ fontSize:10, color:"#ff8800" }}>{moneyLabel(top1.moneyScore)}</div>
                </div>
              </div>

              {/* 점수 바 */}
              <div style={{ height:4, background:"#1a1a1a", borderRadius:99, marginBottom:10 }}>
                <div style={{ height:"100%", borderRadius:99, width:`${top1.moneyScore}%`, background:"linear-gradient(90deg,#ff880088,#ffd700)" }} />
              </div>

              {/* 통계 */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:8 }}>
                {[
                  { label:"📝 언급수", value:`${top1.count}회`, color:"#4488ff" },
                  { label:"🏪 쇼핑상품", value:`${top1.shopping?.competition||0}개`, color:"#03c75a" },
                  { label:"💰 평균가", value:fmtPrice(top1.shopping?.avgPrice), color:"#ffd700" }
                ].map((s,j) => (
                  <div key={j} style={{ background:"rgba(255,255,255,0.04)", borderRadius:7, padding:"7px 8px", textAlign:"center" }}>
                    <div style={{ fontSize:9, color:"#555", marginBottom:2 }}>{s.label}</div>
                    <div style={{ fontSize:11, fontWeight:800, color:s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* 출처 */}
              <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                {top1.sources.map(src => (
                  <Badge key={src} text={src} color={src==="블로그"?"#aa44ff":src==="뉴스"?"#4488ff":"#ff8800"} />
                ))}
              </div>

              {/* 대표 쇼핑 상품 */}
              {top1.shopping?.items?.[0] && (
                <div onClick={() => top1.shopping.items[0].url && window.open(top1.shopping.items[0].url, "_blank")}
                  style={{ marginTop:8, background:"rgba(3,199,90,0.06)", border:"1px solid rgba(3,199,90,0.15)", borderRadius:7, padding:"7px 9px", cursor:"pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background="rgba(3,199,90,0.12)"}
                  onMouseLeave={e => e.currentTarget.style.background="rgba(3,199,90,0.06)"}>
                  <div style={{ fontSize:9, color:"#03c75a", marginBottom:2 }}>🛍 대표 상품</div>
                  <div style={{ fontSize:11, color:"#ccc", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:2 }}>
                    {top1.shopping.items[0].name}
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between" }}>
                    <span style={{ fontSize:12, fontWeight:900, color:"#03c75a" }}>{fmtPrice(top1.shopping.items[0].price)}</span>
                    <span style={{ fontSize:10, color:"#444" }}>🏪 {top1.shopping.items[0].mall}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TOP10 리스트 */}
          <div style={{ fontSize:11, color:"#555", marginBottom:8 }}>전체 TOP10</div>
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            {result.top10.map((item, i) => (
              <div key={i} style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius:8, padding:"8px 10px",
                display:"flex", alignItems:"center", gap:8
              }}>
                {/* 순위 */}
                <div style={{ flexShrink:0, width:20, height:20, borderRadius:5,
                  background: i===0?"linear-gradient(135deg,#ffd700,#ff8800)":i===1?"linear-gradient(135deg,#c0c0c0,#888)":i===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)",
                  display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:i<3?"#000":"#555"
                }}>{i+1}</div>

                {/* 키워드 */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:2 }}>
                    <span style={{ fontSize:12, fontWeight:700, color:"#fff" }}>{item.keyword}</span>
                    {item.sources.map(src => (
                      <Badge key={src} text={src} color={src==="블로그"?"#aa44ff":src==="뉴스"?"#4488ff":"#ff8800"} />
                    ))}
                  </div>
                  <div style={{ height:2, background:"#1a1a1a", borderRadius:99 }}>
                    <div style={{ height:"100%", borderRadius:99, width:`${item.moneyScore}%`, background:`linear-gradient(90deg,${moneyColor(item.moneyScore)}66,${moneyColor(item.moneyScore)})` }} />
                  </div>
                </div>

                {/* 점수 + 언급수 */}
                <div style={{ flexShrink:0, textAlign:"right" }}>
                  <div style={{ fontSize:12, fontWeight:900, color:moneyColor(item.moneyScore) }}>{item.moneyScore}점</div>
                  <div style={{ fontSize:9, color:"#555" }}>언급 {item.count}회</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && !result && (
        <div style={{ textAlign:"center", color:"#333", fontSize:12, padding:20 }}>
          검색하면 분석이 시작됩니다.
        </div>
      )}
    </div>
  );
}
