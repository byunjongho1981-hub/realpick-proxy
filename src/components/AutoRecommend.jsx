
import { useState } from "react";
import { runAutoRecommend } from "../api/autoRecommend";

const fmtPrice = n => n ? parseInt(n).toLocaleString()+"원" : "-";
const scoreColor = s => s>=70?"#ffd700":s>=50?"#03c75a":s>=30?"#ff8800":"#888";
const scoreLabel = s => s>=70?"S급":s>=50?"A급":s>=30?"B급":"C급";
const scoreBg    = s => s>=70?"rgba(255,215,0,0.08)":s>=50?"rgba(3,199,90,0.07)":s>=30?"rgba(255,136,0,0.07)":"rgba(255,255,255,0.03)";
const scoreBorder= s => s>=70?"rgba(255,215,0,0.25)":s>=50?"rgba(3,199,90,0.2)":s>=30?"rgba(255,136,0,0.2)":"rgba(255,255,255,0.06)";

const Spinner = ({ color, size=16 }) => (
  <div style={{ display:"inline-block", width:size, height:size, border:`2px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
);

const Bar = ({ value, max=100, color, height=3 }) => (
  <div style={{ height, background:"#1a1a1a", borderRadius:99 }}>
    <div style={{ height:"100%", borderRadius:99, width:`${Math.min(100,(value/max)*100)}%`, background:`linear-gradient(90deg,${color}55,${color})`, transition:"width 0.6s" }} />
  </div>
);

export default function AutoRecommend({ apiKey }) {
  const [loading, setLoading]     = useState(false);
  const [progress, setProgress]   = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [results, setResults]     = useState([]);
  const [error, setError]         = useState("");
  const [expanded, setExpanded]   = useState(null);
  const [ran, setRan]             = useState(false);

  const handleRun = async () => {
    setLoading(true); setError(""); setResults([]); setExpanded(null); setRan(true);
    setProgress(0); setProgressMsg("시작 중...");
    try {
      const data = await runAutoRecommend(apiKey, (pct, msg) => {
        setProgress(pct); setProgressMsg(msg);
      });
      setResults(data);
    } catch (e) {
      setError(e.message || "분석 중 오류 발생");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* 버튼 */}
      <button onClick={handleRun} disabled={loading} style={{
        width:"100%", padding:"14px", borderRadius:12, border:"none", cursor:loading?"not-allowed":"pointer",
        background: loading ? "#222" : "linear-gradient(135deg,#ff8800,#ffd700)",
        color: loading ? "#555" : "#000", fontWeight:800, fontSize:14,
        display:"flex", alignItems:"center", justifyContent:"center", gap:8,
        marginBottom:16, transition:"opacity 0.2s"
      }}>
        {loading ? <><Spinner color="#ff8800" size={16} /> 분석 중...</> : "🔥 추천 상품 자동 분석"}
      </button>

      {/* 진행 바 */}
      {loading && (
        <div style={{ marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
            <span style={{ fontSize:11, color:"#888" }}>{progressMsg}</span>
            <span style={{ fontSize:11, color:"#ffd700", fontWeight:700 }}>{progress}%</span>
          </div>
          <div style={{ height:4, background:"#1a1a1a", borderRadius:99 }}>
            <div style={{ height:"100%", borderRadius:99, width:`${progress}%`, background:"linear-gradient(90deg,#ff880088,#ffd700)", transition:"width 0.3s" }} />
          </div>
          <div style={{ fontSize:10, color:"#444", marginTop:6, textAlign:"center" }}>
            YouTube · 네이버 블로그·뉴스·카페·쇼핑 실시간 분석 중
          </div>
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:8, padding:"10px 12px", color:"#ff8888", fontSize:12, marginBottom:12 }}>
          ⚠️ {error}
        </div>
      )}

      {/* 결과 없음 */}
      {!loading && ran && !error && results.length === 0 && (
        <div style={{ textAlign:"center", color:"#444", fontSize:12, padding:24 }}>
          조건에 맞는 추천 상품이 없습니다. 다시 시도해주세요.
        </div>
      )}

      {/* 결과 */}
      {!loading && results.length > 0 && (
        <div>
          <div style={{ fontSize:11, color:"#555", marginBottom:10 }}>
            실시간 분석 기반 <b style={{ color:"#ffd700" }}>추천 상품 TOP {results.length}</b>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {results.map((item, i) => (
              <div key={i} style={{ background:scoreBg(item.finalScore), border:`1px solid ${scoreBorder(item.finalScore)}`, borderRadius:12, overflow:"hidden" }}>

                {/* 요약 행 */}
                <div onClick={() => setExpanded(expanded===i?null:i)}
                  style={{ padding:"11px 13px", cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}>

                  {/* 순위 */}
                  <div style={{ flexShrink:0, width:24, height:24, borderRadius:6,
                    background: i===0?"linear-gradient(135deg,#ffd700,#ff8800)":i===1?"linear-gradient(135deg,#c0c0c0,#888)":i===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)",
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:900, color:i<3?"#000":"#555"
                  }}>{i+1}</div>

                  {/* 키워드 + 태그 */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3, flexWrap:"wrap" }}>
                      <span style={{ fontSize:14, fontWeight:800, color:"#fff" }}>{item.keyword}</span>
                      <span style={{ fontSize:9, padding:"2px 6px", borderRadius:6, background:`${scoreColor(item.finalScore)}22`, color:scoreColor(item.finalScore), border:`1px solid ${scoreColor(item.finalScore)}44` }}>
                        {scoreLabel(item.finalScore)}
                      </span>
                      <span style={{ fontSize:9, padding:"2px 6px", borderRadius:6, background:`${item.timing.color}22`, color:item.timing.color, border:`1px solid ${item.timing.color}44` }}>
                        {item.timing.label}
                      </span>
                      <span style={{ fontSize:9, padding:"2px 6px", borderRadius:6,
                        background: item.trend.status==="급상승"?"rgba(255,215,0,0.15)":item.trend.status==="상승"?"rgba(3,199,90,0.12)":"rgba(255,255,255,0.05)",
                        color: item.trend.status==="급상승"?"#ffd700":item.trend.status==="상승"?"#03c75a":"#666"
                      }}>
                        {item.trend.status==="급상승"?"🚀 급상승":item.trend.status==="상승"?"📈 상승":"📊 유지"}
                      </span>
                    </div>
                    <Bar value={item.finalScore} color={scoreColor(item.finalScore)} />
                  </div>

                  {/* 점수 */}
                  <div style={{ flexShrink:0, textAlign:"right" }}>
                    <div style={{ fontSize:20, fontWeight:900, color:scoreColor(item.finalScore), lineHeight:1 }}>{item.finalScore}</div>
                    <div style={{ fontSize:9, color:"#555" }}>/ 100</div>
                  </div>

                  <div style={{ fontSize:10, color:"#444", flexShrink:0 }}>{expanded===i?"▲":"▼"}</div>
                </div>

                {/* 상세 */}
                {expanded===i && (
                  <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", padding:"12px 13px 14px" }}>

                    {/* 지표 5개 */}
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:5, marginBottom:12 }}>
                      {[
                        { label:"📺 트렌드",  value:`${item.trend.score}점`,       color:"#ff4444" },
                        { label:"⚡ 가속도",  value:`${item.trend.velocity}x`,      color:"#ffd700" },
                        { label:"🛒 구매의도", value:`${item.purchase}%`,           color:"#03c75a" },
                        { label:"⚔️ 경쟁도",  value:`${item.competition}점`,       color:item.competition<50?"#03c75a":"#ff8800" },
                        { label:"🛍 쇼핑점수", value:`${item.shop?.score||0}점`,    color:"#4488ff" }
                      ].map((s,j) => (
                        <div key={j} style={{ background:"rgba(255,255,255,0.04)", borderRadius:7, padding:"7px 5px", textAlign:"center" }}>
                          <div style={{ fontSize:9, color:"#555", marginBottom:2 }}>{s.label}</div>
                          <div style={{ fontSize:11, fontWeight:800, color:s.color }}>{s.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* 점수 분해 바 */}
                    <div style={{ marginBottom:12 }}>
                      <div style={{ fontSize:10, color:"#555", fontWeight:600, marginBottom:7 }}>📊 점수 분해</div>
                      {[
                        { label:"트렌드 점수",  value:item.trend.score, color:"#ff4444" },
                        { label:"구매 의도",    value:item.purchase,    color:"#03c75a" },
                        { label:"쇼핑 매력도",  value:item.shop?.score||0, color:"#4488ff" },
                        { label:"경쟁도 낮음",  value:Math.max(0,100-item.competition), color:"#aa44ff" }
                      ].map((b,j) => (
                        <div key={j} style={{ marginBottom:5 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                            <span style={{ fontSize:10, color:"#666" }}>{b.label}</span>
                            <span style={{ fontSize:10, fontWeight:700, color:b.color }}>{b.value}점</span>
                          </div>
                          <Bar value={b.value} color={b.color} height={3} />
                        </div>
                      ))}
                    </div>

                    {/* 추천 이유 */}
                    <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:8, padding:"9px 11px", marginBottom:10 }}>
                      <div style={{ fontSize:10, color:"#666", fontWeight:600, marginBottom:5 }}>💡 추천 이유</div>
                      {item.reason.split(" · ").map((r,j) => (
                        <div key={j} style={{ display:"flex", gap:5, marginBottom:3 }}>
                          <span style={{ color:scoreColor(item.finalScore), fontSize:10, flexShrink:0 }}>•</span>
                          <span style={{ fontSize:11, color:"#bbb" }}>{r}</span>
                        </div>
                      ))}
                    </div>

                    {/* 대표 쇼핑 상품 */}
                    {item.shop?.top && (
                      <div onClick={()=>item.shop.top.url&&window.open(item.shop.top.url,"_blank")}
                        style={{ background:"rgba(3,199,90,0.06)", border:"1px solid rgba(3,199,90,0.15)", borderRadius:8, padding:"8px 10px", cursor:"pointer" }}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(3,199,90,0.12)"}
                        onMouseLeave={e=>e.currentTarget.style.background="rgba(3,199,90,0.06)"}>
                        <div style={{ fontSize:9, color:"#03c75a", marginBottom:2 }}>🛍 리뷰 최다 상품</div>
                        <div style={{ fontSize:11, color:"#ccc", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:3 }}>
                          {item.shop.top.name}
                        </div>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <span style={{ fontSize:13, fontWeight:900, color:"#03c75a" }}>{fmtPrice(item.shop.top.price)}</span>
                          <span style={{ fontSize:10, color:"#444" }}>🏪 {item.shop.top.mall}</span>
                        </div>
                        {item.shop.reviewTotal>0 && (
                          <div style={{ fontSize:10, color:"#555", marginTop:3 }}>
                            💬 누적 리뷰 {item.shop.reviewTotal.toLocaleString()}개
                          </div>
                        )}
                      </div>
                    )}
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
