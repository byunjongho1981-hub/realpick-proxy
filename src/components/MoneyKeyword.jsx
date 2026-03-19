const fmtPrice = n => n ? parseInt(n).toLocaleString() + "원" : "-";
const gradeColor = g => g==="S"?"#ffd700":g==="A"?"#03c75a":g==="B"?"#ff8800":"#888";
const scoreBg    = g => g==="S"?"rgba(255,215,0,0.1)":g==="A"?"rgba(3,199,90,0.08)":g==="B"?"rgba(255,136,0,0.08)":"rgba(255,255,255,0.03)";
const scoreBorder= g => g==="S"?"rgba(255,215,0,0.3)":g==="A"?"rgba(3,199,90,0.2)":g==="B"?"rgba(255,136,0,0.2)":"rgba(255,255,255,0.06)";

const Spinner = ({ color }) => (
  <div style={{ display:"inline-block", width:20, height:20, border:`2px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
);

const BreakdownBar = ({ label, value, max=25, color }) => (
  <div style={{ marginBottom:5 }}>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
      <span style={{ fontSize:10, color:"#666" }}>{label}</span>
      <span style={{ fontSize:10, fontWeight:700, color }}>{value}/{max}점</span>
    </div>
    <div style={{ height:3, background:"#1a1a1a", borderRadius:99 }}>
      <div style={{ height:"100%", borderRadius:99, width:`${(value/max)*100}%`, background:`linear-gradient(90deg,${color}66,${color})` }} />
    </div>
  </div>
);

export default function MoneyKeyword({ result, loading, error, keyword }) {
  if (!keyword) return null;

  const top1 = result?.top10?.[0];

  return (
    <div>
      {/* 헤더 */}
      <div style={{ fontSize:12, fontWeight:700, color:"#888", marginBottom:10, display:"flex", alignItems:"center", gap:6, borderBottom:"1px solid rgba(255,255,255,0.06)", paddingBottom:8 }}>
        💰 돈 될 가능성 분석
        {loading && <Spinner color="#ffd700" />}
      </div>

      {error && (
        <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:8, padding:"10px 12px", color:"#ff8888", fontSize:12, marginBottom:10 }}>
          ⚠️ {error}
        </div>
      )}

      {loading && (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, padding:30, color:"#555", fontSize:12 }}>
          <Spinner color="#ffd700" />
          <span>블로그·뉴스·카페 수집 → 키워드 추출 → 쇼핑 분석 → 점수 계산 중...</span>
        </div>
      )}

      {!loading && result && (
        <div>
          {/* 수집 요약 */}
          <div style={{ fontSize:10, color:"#555", marginBottom:14 }}>
            <b style={{ color:"#ffd700" }}>"{keyword}"</b> 관련 네이버 문서
            <b style={{ color:"#fff" }}> {result.totalDocs}개</b> 분석 →
            <b style={{ color:"#ffd700" }}> 키워드 {result.top10.length}개</b> 추출
          </div>

          {/* ── 1위 상세 카드 ── */}
          {top1 && (
            <div style={{ background:scoreBg(top1.grade), border:`1px solid ${scoreBorder(top1.grade)}`, borderRadius:14, padding:16, marginBottom:16 }}>
              {/* 키워드 + 점수 */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:10, color:gradeColor(top1.grade), fontWeight:700, marginBottom:4 }}>
                    🏆 가장 돈 될 키워드
                  </div>
                  <div style={{ fontSize:22, fontWeight:900, color:"#fff" }}>{top1.keyword}</div>
                  <div style={{ fontSize:12, color:gradeColor(top1.grade), marginTop:2 }}>{top1.gradeLabel}</div>
                </div>
                <div style={{ textAlign:"center", background:`${gradeColor(top1.grade)}22`, border:`2px solid ${gradeColor(top1.grade)}66`, borderRadius:12, padding:"8px 14px" }}>
                  <div style={{ fontSize:28, fontWeight:900, color:gradeColor(top1.grade), lineHeight:1 }}>{top1.moneyScore}</div>
                  <div style={{ fontSize:10, color:gradeColor(top1.grade), opacity:.8 }}>/ 100</div>
                  <div style={{ fontSize:12, fontWeight:900, color:gradeColor(top1.grade), marginTop:2 }}>등급 {top1.grade}</div>
                </div>
              </div>

              {/* 점수 바 */}
              <div style={{ height:5, background:"#1a1a1a", borderRadius:99, marginBottom:14 }}>
                <div style={{ height:"100%", borderRadius:99, width:`${top1.moneyScore}%`, background:`linear-gradient(90deg,${gradeColor(top1.grade)}66,${gradeColor(top1.grade)})`, transition:"width 0.7s" }} />
              </div>

              {/* 점수 분해 */}
              <div style={{ background:"rgba(0,0,0,0.2)", borderRadius:9, padding:"10px 12px", marginBottom:12 }}>
                <div style={{ fontSize:10, color:"#666", marginBottom:8, fontWeight:600 }}>📊 점수 분해 (각 25점 만점)</div>
                <BreakdownBar label="📺 트렌드 점수" value={top1.breakdown.trendPart}  color="#ff4444" />
                <BreakdownBar label="🔍 키워드 빈도" value={top1.breakdown.freqPart}   color="#4488ff" />
                <BreakdownBar label="🏪 경쟁도 (낮을수록 좋음)" value={top1.breakdown.competPart} color="#aa44ff" />
                <BreakdownBar label="💰 가격 매력도" value={top1.breakdown.pricePart}  color="#03c75a" />
              </div>

              {/* 이유 */}
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:10, color:"#666", fontWeight:600, marginBottom:6 }}>💡 점수 산출 이유</div>
                {top1.reasons.map((r, i) => (
                  <div key={i} style={{ display:"flex", gap:6, marginBottom:4 }}>
                    <span style={{ color:gradeColor(top1.grade), fontSize:10, flexShrink:0 }}>•</span>
                    <span style={{ fontSize:11, color:"#bbb", lineHeight:1.5 }}>{r}</span>
                  </div>
                ))}
              </div>

              {/* 쇼핑 통계 */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:10 }}>
                {[
                  { label:"🔍 언급수",   value:`${top1.count}회`,            color:"#4488ff" },
                  { label:"🏪 경쟁상품", value:`${top1.competition}개`,       color:"#aa44ff" },
                  { label:"💰 평균가",   value:fmtPrice(top1.avgPrice),       color:"#03c75a" }
                ].map((s,j) => (
                  <div key={j} style={{ background:"rgba(255,255,255,0.04)", borderRadius:7, padding:"7px", textAlign:"center" }}>
                    <div style={{ fontSize:9, color:"#555", marginBottom:2 }}>{s.label}</div>
                    <div style={{ fontSize:11, fontWeight:800, color:s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* 대표 상품 */}
              {top1.topShop && (
                <div onClick={() => top1.topShop.url && window.open(top1.topShop.url, "_blank")}
                  style={{ background:"rgba(3,199,90,0.06)", border:"1px solid rgba(3,199,90,0.15)", borderRadius:8, padding:"8px 10px", cursor:"pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background="rgba(3,199,90,0.12)"}
                  onMouseLeave={e => e.currentTarget.style.background="rgba(3,199,90,0.06)"}>
                  <div style={{ fontSize:9, color:"#03c75a", marginBottom:2 }}>🛍 대표 상품</div>
                  <div style={{ fontSize:11, color:"#ccc", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:2 }}>{top1.topShop.name}</div>
                  <div style={{ display:"flex", justifyContent:"space-between" }}>
                    <span style={{ fontSize:12, fontWeight:900, color:"#03c75a" }}>{fmtPrice(top1.topShop.price)}</span>
                    <span style={{ fontSize:10, color:"#444" }}>🏪 {top1.topShop.mall}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── TOP10 리스트 ── */}
          <div style={{ fontSize:11, color:"#555", marginBottom:8 }}>전체 TOP10 순위</div>
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            {result.top10.map((item, i) => (
              <div key={i} style={{ background:scoreBg(item.grade), border:`1px solid ${scoreBorder(item.grade)}`, borderRadius:9, padding:"9px 11px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                  {/* 순위 */}
                  <div style={{ flexShrink:0, width:20, height:20, borderRadius:5,
                    background: i===0?"linear-gradient(135deg,#ffd700,#ff8800)":i===1?"linear-gradient(135deg,#c0c0c0,#888)":i===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)",
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:i<3?"#000":"#555"
                  }}>{i+1}</div>

                  {/* 키워드 */}
                  <span style={{ fontSize:13, fontWeight:700, color:"#fff", flex:1 }}>{item.keyword}</span>

                  {/* 등급 배지 */}
                  <span style={{ fontSize:10, fontWeight:900, padding:"2px 7px", borderRadius:5, background:`${gradeColor(item.grade)}22`, color:gradeColor(item.grade), border:`1px solid ${gradeColor(item.grade)}44` }}>
                    {item.grade}등급
                  </span>

                  {/* 점수 */}
                  <span style={{ fontSize:14, fontWeight:900, color:gradeColor(item.grade), minWidth:36, textAlign:"right" }}>
                    {item.moneyScore}
                  </span>
                </div>

                {/* 점수 바 */}
                <div style={{ height:3, background:"#1a1a1a", borderRadius:99, marginBottom:5 }}>
                  <div style={{ height:"100%", borderRadius:99, width:`${item.moneyScore}%`, background:`linear-gradient(90deg,${gradeColor(item.grade)}55,${gradeColor(item.grade)})` }} />
                </div>

                {/* 이유 요약 (첫 번째만) */}
                <div style={{ fontSize:10, color:"#555", display:"flex", gap:6, flexWrap:"wrap" }}>
                  {item.reasons.slice(0,2).map((r, j) => (
                    <span key={j} style={{ background:"rgba(255,255,255,0.04)", borderRadius:4, padding:"2px 6px" }}>{r}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && !result && (
        <div style={{ textAlign:"center", color:"#333", fontSize:12, padding:24 }}>
          검색하면 분석이 시작됩니다.
        </div>
      )}
    </div>
  );
}
