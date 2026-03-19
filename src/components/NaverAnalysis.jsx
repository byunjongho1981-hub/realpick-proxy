const fmtPrice = n => n ? parseInt(n).toLocaleString() + "원" : "-";
const fmt      = n => { if(!n) return"-"; const x=parseInt(n); if(x>=10000) return Math.floor(x/10000)+"만"; if(x>=1000) return(x/1000).toFixed(1)+"천"; return x.toLocaleString(); };

// 판매 가능성 점수 계산 (0~100)
const calcSalesScore = (product) => {
  const price   = parseInt(product.price)       || 0;
  const reviews = parseInt(product.reviewCount) || 0;
  const rating  = parseFloat(product.rating)    || 0;

  // 리뷰 점수 (40%) — 리뷰 1000개 기준 만점
  const reviewScore = Math.min(100, (reviews / 1000) * 100) * 0.4;

  // 평점 점수 (30%) — 5점 만점
  const ratingScore = (rating / 5) * 100 * 0.3;

  // 가격 점수 (30%) — 10만원 이하 고점, 높을수록 감점
  const priceScore = Math.max(0, 100 - (price / 100000) * 50) * 0.3;

  const score = reviewScore + ratingScore + priceScore;
  return Math.round(Math.min(100, Math.max(0, score)));
};

const scoreColor = s => s >= 70 ? "#03c75a" : s >= 40 ? "#ff8800" : "#ff4444";
const scoreLabel = s => s >= 70 ? "🔥 높음" : s >= 40 ? "📊 보통" : "❄️ 낮음";

// 가격대 분포
const getPriceRange = (price) => {
  const p = parseInt(price) || 0;
  if (p < 10000)  return "1만원 미만";
  if (p < 30000)  return "1~3만원";
  if (p < 50000)  return "3~5만원";
  if (p < 100000) return "5~10만원";
  if (p < 300000) return "10~30만원";
  return "30만원 이상";
};

const RANGE_ORDER = ["1만원 미만","1~3만원","3~5만원","5~10만원","10~30만원","30만원 이상"];

export default function NaverAnalysis({ products }) {
  if (!products || products.length === 0) return null;

  const validPrices  = products.map(p => parseInt(p.price)||0).filter(p => p > 0);
  const avgPrice     = validPrices.length ? Math.round(validPrices.reduce((a,b)=>a+b,0) / validPrices.length) : 0;
  const minPrice     = validPrices.length ? Math.min(...validPrices) : 0;
  const maxPrice     = validPrices.length ? Math.max(...validPrices) : 0;

  // 리뷰 TOP5
  const top5ByReview = [...products]
    .sort((a,b) => (parseInt(b.reviewCount)||0) - (parseInt(a.reviewCount)||0))
    .slice(0, 5);

  // 가격대 분포
  const distMap = {};
  for (const p of products) {
    const range = getPriceRange(p.price);
    distMap[range] = (distMap[range] || 0) + 1;
  }
  const maxDist = Math.max(...Object.values(distMap));
  const distribution = RANGE_ORDER.filter(r => distMap[r]).map(r => ({ range: r, count: distMap[r] }));

  // 판매 가능성 점수
  const scored = [...products]
    .map(p => ({ ...p, salesScore: calcSalesScore(p) }))
    .sort((a,b) => b.salesScore - a.salesScore);

  return (
    <div style={{ marginTop:20, display:"flex", flexDirection:"column", gap:12 }}>

      {/* 가격 요약 */}
      <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:14 }}>
        <div style={{ fontSize:12, fontWeight:700, color:"#aaa", marginBottom:10 }}>💰 가격 분석</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
          {[
            { label:"평균가", value:fmtPrice(avgPrice), color:"#fff" },
            { label:"최저가", value:fmtPrice(minPrice), color:"#03c75a" },
            { label:"최고가", value:fmtPrice(maxPrice), color:"#ff8888" }
          ].map((item,i) => (
            <div key={i} style={{ background:"rgba(255,255,255,0.04)", borderRadius:8, padding:"10px 8px", textAlign:"center" }}>
              <div style={{ fontSize:10, color:"#555", marginBottom:4 }}>{item.label}</div>
              <div style={{ fontSize:13, fontWeight:900, color:item.color }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 가격대 분포 */}
      <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:14 }}>
        <div style={{ fontSize:12, fontWeight:700, color:"#aaa", marginBottom:10 }}>📊 가격대 분포</div>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {distribution.map((d, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ fontSize:10, color:"#666", width:70, flexShrink:0 }}>{d.range}</div>
              <div style={{ flex:1, height:6, background:"#1a1a1a", borderRadius:99 }}>
                <div style={{ height:"100%", borderRadius:99, width:`${(d.count/maxDist)*100}%`, background:"linear-gradient(90deg,#4488ff88,#4488ff)" }} />
              </div>
              <div style={{ fontSize:10, color:"#4488ff", width:20, textAlign:"right" }}>{d.count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 리뷰 TOP5 */}
      <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:14 }}>
        <div style={{ fontSize:12, fontWeight:700, color:"#aaa", marginBottom:10 }}>💬 리뷰 많은 상품 TOP5</div>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {top5ByReview.map((p, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ flexShrink:0, width:18, height:18, borderRadius:5,
                background: i===0?"linear-gradient(135deg,#ffd700,#ff8800)":i===1?"linear-gradient(135deg,#c0c0c0,#888)":i===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)",
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:i<3?"#000":"#555"
              }}>{i+1}</div>
              <div style={{ flex:1, fontSize:11, color:"#ccc", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {p.name?.replace(/<[^>]*>/g,"")}
              </div>
              <div style={{ flexShrink:0, fontSize:11, fontWeight:700, color:"#03c75a" }}>
                💬 {fmt(p.reviewCount)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 판매 가능성 점수 */}
      <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:14 }}>
        <div style={{ fontSize:12, fontWeight:700, color:"#aaa", marginBottom:4 }}>🎯 판매 가능성 점수</div>
        <div style={{ fontSize:10, color:"#444", marginBottom:10 }}>리뷰 40% + 평점 30% + 가격 30%</div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {scored.map((p, i) => (
            <div key={i}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                <div style={{ fontSize:11, color:"#ccc", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginRight:8 }}>
                  {p.name?.replace(/<[^>]*>/g,"")}
                </div>
                <div style={{ flexShrink:0, fontSize:11, fontWeight:800, color:scoreColor(p.salesScore) }}>
                  {scoreLabel(p.salesScore)} {p.salesScore}점
                </div>
              </div>
              <div style={{ height:4, background:"#1a1a1a", borderRadius:99 }}>
                <div style={{ height:"100%", borderRadius:99, width:`${p.salesScore}%`, background:`linear-gradient(90deg,${scoreColor(p.salesScore)}88,${scoreColor(p.salesScore)})`, transition:"width 0.5s" }} />
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
