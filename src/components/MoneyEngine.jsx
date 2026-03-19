import { useState } from "react";

const fmtPrice = n => n ? parseInt(n).toLocaleString()+"원" : "-";
const scoreColor = s => s>=70?"#ffd700":s>=50?"#03c75a":s>=30?"#ff8800":"#888";
const gradeBg    = s => s>=70?"rgba(255,215,0,0.08)":s>=50?"rgba(3,199,90,0.07)":s>=30?"rgba(255,136,0,0.07)":"rgba(255,255,255,0.02)";
const gradeBorder= s => s>=70?"rgba(255,215,0,0.25)":s>=50?"rgba(3,199,90,0.2)":s>=30?"rgba(255,136,0,0.2)":"rgba(255,255,255,0.05)";
const gradeLabel = s => s>=70?"S급":s>=50?"A급":s>=30?"B급":"C급";

const Spinner = ({ color, size=18 }) => (
  <div style={{ display:"inline-block", width:size, height:size, border:`2px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
);

const Bar = ({ value, max=100, color, height=3 }) => (
  <div style={{ height, background:"#1a1a1a", borderRadius:99 }}>
    <div style={{ height:"100%", borderRadius:99, width:`${Math.min(100,(value/max)*100)}%`, background:`linear-gradient(90deg,${color}55,${color})`, transition:"width 0.5s" }} />
  </div>
);

const Tag = ({ text, color }) => (
  <span style={{ fontSize:9, padding:"2px 6px", borderRadius:8, background:`${color}22`, color, border:`1px solid ${color}33` }}>{text}</span>
);

export default function MoneyEngine({ result, loading, error }) {
  const [expanded, setExpanded] = useState(null);

  if (!result && !loading && !error) return null;

  return (
    <div>
      {/* 헤더 */}
      <div style={{ fontSize:12, fontWeight:700, color:"#888", marginBottom:10, display:"flex", alignItems:"center", gap:6, borderBottom:"1px solid rgba(255,255,255,0.06)", paddingBottom:8 }}>
        🚀 돈 될 키워드 엔진
        {loading && <Spinner color="#ffd700" />}
      </div>

      {/* 에러 */}
      {error && (
        <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:8, padding:"10px 12px", color:"#ff8888", fontSize:12, marginBottom:10 }}>
          ⚠️ {error}
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, padding:30, color:"#555", fontSize:12 }}>
          <Spinner color="#ffd700" size={26} />
          <div style={{ textAlign:"center", lineHeight:1.8 }}>
            키워드 확장 → 유튜브 + 네이버 수집<br/>
            의도 분석 → 트렌드 · 경쟁도 계산<br/>
            쇼핑 분석 → 최종 점수 산출 중...
          </div>
        </div>
      )}

      {/* 결과 */}
      {!loading && result && (
        <div>
          {/* 요약 */}
          <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
            {[
              { label:"수집 문서", value:`${result.totalDocs}개`, color:"#4488ff" },
              { label:"유튜브 영상", value:`${result.videoCount}개`, color:"#ff4444" },
              { label:"확장 키워드", value:`${result.expandedCount}개`, color:"#aa44ff" },
              { label:"추출 키워드", value:`${result.items.length}개`, color:"#ffd700" }
            ].map((s,i) => (
              <div key={i} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:7, padding:"6px 10px", textAlign:"center" }}>
                <div style={{ fontSize:9, color:"#555", marginBottom:2 }}>{s.label}</div>
                <div style={{ fontSize:12, fontWeight:800, color:s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* 키워드 목록 */}
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {result.items.map((item, i) => (
              <div key={i} style={{ background:gradeBg(item.finalScore), border:`1px solid ${gradeBorder(item.finalScore)}`, borderRadius:10, overflow:"hidden" }}>

                {/* 요약 행 */}
                <div
                  onClick={() => setExpanded(expanded===i ? null : i)}
                  style={{ padding:"10px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}
                >
                  {/* 순위 */}
                  <div style={{ flexShrink:0, width:22, height:22, borderRadius:5,
                    background: i===0?"linear-gradient(135deg,#ffd700,#ff8800)":i===1?"linear-gradient(135deg,#c0c0c0,#888)":i===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)",
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:900, color:i<3?"#000":"#555"
                  }}>{i+1}</div>

                  {/* 키워드 + 태그 */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3 }}>
                      <span style={{ fontSize:13, fontWeight:800, color:"#fff" }}>{item.keyword}</span>
                      <Tag text={gradeLabel(item.finalScore)} color={scoreColor(item.finalScore)} />
                      {item.recommend
                        ? <Tag text="✅ 추천" color="#03c75a" />
                        : <Tag text="❌ 비추천" color="#888" />}
                    </div>
                    <Bar value={item.finalScore} color={scoreColor(item.finalScore)} />
                  </div>

                  {/* 점수 */}
                  <div style={{ flexShrink:0, textAlign:"right" }}>
                    <div style={{ fontSize:18, fontWeight:900, color:scoreColor(item.finalScore), lineHeight:1 }}>{item.finalScore}</div>
                    <div style={{ fontSize:9, color:"#555" }}>/ 100</div>
                  </div>

                  {/* 펼치기 */}
                  <div style={{ fontSize:10, color:"#444", flexShrink:0 }}>{expanded===i?"▲":"▼"}</div>
                </div>

                {/* 상세 (펼침) */}
                {expanded===i && (
                  <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", padding:"12px 12px 14px" }}>

                    {/* 지표 4개 */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:6, marginBottom:12 }}>
                      {[
                        { label:"📺 트렌드", value:`${item.trendScore}점`, color:"#ff4444" },
                        { label:"🛒 구매의도", value:`${item.intent.purchase}%`, color:"#03c75a" },
                        { label:"⚡ 경쟁도", value:item.competition.label, color:item.competition.label==="낮음"?"#03c75a":item.competition.label==="보통"?"#ff8800":"#ff4444" },
                        { label:"💰 평균가", value:fmtPrice(item.shopping.avgPrice), color:"#ffd700" }
                      ].map((s,j) => (
                        <div key={j} style={{ background:"rgba(255,255,255,0.04)", borderRadius:7, padding:"7px 8px", textAlign:"center" }}>
                          <div style={{ fontSize:9, color:"#555", marginBottom:2 }}>{s.label}</div>
                          <div style={{ fontSize:11, fontWeight:800, color:s.color }}>{s.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* 의도 분석 */}
                    <div style={{ marginBottom:12 }}>
                      <div style={{ fontSize:10, color:"#666", fontWeight:600, marginBottom:6 }}>🎯 키워드 의도 분석</div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5 }}>
                        {[
                          { label:"🛒 구매 의도", value:item.intent.purchase, color:"#03c75a" },
                          { label:"🔍 정보 탐색", value:item.intent.info,     color:"#4488ff" },
                          { label:"🔧 문제 해결", value:item.intent.problem,  color:"#ff8800" },
                          { label:"⚖️ 비교/검토", value:item.intent.compare,  color:"#aa44ff" }
                        ].map((s,j) => (
                          <div key={j}>
                            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                              <span style={{ fontSize:10, color:"#666" }}>{s.label}</span>
                              <span style={{ fontSize:10, fontWeight:700, color:s.color }}>{s.value}%</span>
                            </div>
                            <Bar value={s.value} color={s.color} height={2} />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 쇼핑 TOP5 */}
                    {item.shopping.exists && item.shopping.top5.length > 0 && (
                      <div style={{ marginBottom:12 }}>
                        <div style={{ fontSize:10, color:"#666", fontWeight:600, marginBottom:6 }}>🛍 쇼핑 TOP5 (리뷰순)</div>
                        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                          {item.shopping.top5.map((p, j) => (
                            <div key={j} onClick={() => p.url && window.open(p.url,"_blank")}
                              style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 8px", background:"rgba(3,199,90,0.04)", border:"1px solid rgba(3,199,90,0.1)", borderRadius:6, cursor:p.url?"pointer":"default" }}
                              onMouseEnter={e => e.currentTarget.style.background="rgba(3,199,90,0.09)"}
                              onMouseLeave={e => e.currentTarget.style.background="rgba(3,199,90,0.04)"}>
                              <span style={{ fontSize:10, color:"#ccc", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginRight:8 }}>{p.name}</span>
                              <span style={{ fontSize:10, fontWeight:700, color:"#03c75a", flexShrink:0 }}>{fmtPrice(p.price)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 이유 */}
                    <div>
                      <div style={{ fontSize:10, color:"#666", fontWeight:600, marginBottom:6 }}>💡 추천 이유</div>
                      {item.reasons.map((r, j) => (
                        <div key={j} style={{ display:"flex", gap:6, marginBottom:4 }}>
                          <span style={{ color:scoreColor(item.finalScore), fontSize:10, flexShrink:0 }}>•</span>
                          <span style={{ fontSize:11, color:"#bbb", lineHeight:1.5 }}>{r}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
