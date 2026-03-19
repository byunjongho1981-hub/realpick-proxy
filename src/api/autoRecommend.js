// v3.0 - 카테고리 그룹 UI
import { useState } from "react";
import { runAutoRecommend } from "../api/autoRecommend";

// ── 유틸 ──────────────────────────────────────────
const fmtPrice   = n => n ? parseInt(n).toLocaleString()+"원" : "-";
const scoreColor = s => s>=70?"#ffd700":s>=50?"#03c75a":s>=30?"#ff8800":"#888";
const scoreLabel = s => s>=70?"S급":s>=50?"A급":s>=30?"B급":"C급";

const Spinner = ({ color, size=16 }) => (
  <div style={{ display:"inline-block", width:size, height:size, border:`2px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
);
const Bar = ({ value, color, height=3 }) => (
  <div style={{ height, background:"#1a1a1a", borderRadius:99 }}>
    <div style={{ height:"100%", borderRadius:99, width:`${Math.min(100,value)}%`, background:`linear-gradient(90deg,${color}55,${color})`, transition:"width 0.6s" }} />
  </div>
);

// ── 카테고리 분류 ──────────────────────────────────
const CATEGORIES = [
  { id:"tech",   label:"가전 / IT",     icon:"💻", keywords:["노트북","스마트폰","태블릿","이어폰","헤드폰","스피커","카메라","모니터","키보드","마우스","청소기","에어컨","냉장고","세탁기","TV","갤럭시","아이폰","애플","삼성","LG","다이슨","로봇청소기","공기청정기","가습기","선풍기","전기밥솥","전자레인지","오븐","식기세척기","블루투스","충전기","보조배터리","케이블","케이스"] },
  { id:"beauty", label:"뷰티 / 건강",   icon:"✨", keywords:["화장품","스킨케어","선크림","세럼","앰플","에센스","크림","파운데이션","마스카라","립스틱","쿠션","토너","로션","샴푸","컨디셔너","비타민","영양제","유산균","콜라겐","다이어트","헬스","단백질","프로틴","마스크팩","클렌징","폼클렌징","미백","보습","탄력","주름","자외선"] },
  { id:"living", label:"생활 / 주방",   icon:"🏠", keywords:["냄비","프라이팬","도마","칼","수납","정리","인테리어","조명","커튼","침구","이불","베개","매트리스","소파","의자","책상","선반","바구니","향초","디퓨저","세제","섬유유연제","주방세제","청소용품","걸레","수건","욕실","화장실","습기제거","방향제"] },
  { id:"fashion",label:"패션 / 잡화",   icon:"👗", keywords:["운동화","스니커즈","구두","샌들","슬리퍼","가방","백팩","크로스백","지갑","시계","선글라스","모자","목도리","장갑","반지","목걸이","귀걸이","팔찌","청바지","티셔츠","원피스","코트","패딩","점퍼","후드","맨투맨","레깅스","양말","속옷","브라"] },
  { id:"food",   label:"식품",          icon:"🍎", keywords:["과자","초콜릿","커피","차","음료","주스","탄산","우유","두유","쌀","밀가루","설탕","소금","기름","간장","된장","고추장","라면","국수","파스타","빵","케이크","아이스크림","냉동식품","닭가슴살","샐러드","견과류","건강식품","다이어트식품","단백질바"] },
  { id:"pet",    label:"반려동물",       icon:"🐾", keywords:["사료","간식","장난감","리드줄","목줄","하네스","켄넬","이동장","쿠션","방석","모래","패드","화장실","샴푸","영양제","치약","칫솔","빗","미용","옷"] },
];

const classifyKeyword = (keyword) => {
  const kw = keyword.toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.keywords.some(k => kw.includes(k) || k.includes(kw))) return cat.id;
  }
  return "etc";
};

// 결과를 카테고리별로 그룹화
const groupByCategory = (results) => {
  // 전체 순위 부여
  const ranked = results.map((item, globalRank) => ({ ...item, globalRank }));

  const groups = {};
  for (const item of ranked) {
    const catId = classifyKeyword(item.keyword);
    if (!groups[catId]) groups[catId] = [];
    groups[catId].push(item);
  }

  // 카테고리 내부: 점수순
  for (const catId in groups) {
    groups[catId].sort((a,b) => b.finalScore - a.finalScore);
  }

  // 카테고리 자체: 최고 점수 기준 정렬
  const catList = Object.entries(groups)
    .map(([id, items]) => {
      const cat = CATEGORIES.find(c=>c.id===id) || { id:"etc", label:"기타", icon:"📦" };
      return { ...cat, items, topScore: items[0]?.finalScore || 0 };
    })
    .sort((a,b) => b.topScore - a.topScore);

  return catList;
};

// TOP 뱃지
const TopBadge = ({ globalRank }) => {
  if (globalRank === 0) return (
    <span style={{ fontSize:9, padding:"2px 7px", borderRadius:6, background:"rgba(255,215,0,0.2)", color:"#ffd700", border:"1px solid rgba(255,215,0,0.4)", fontWeight:800 }}>🔥 BEST</span>
  );
  if (globalRank <= 2) return (
    <span style={{ fontSize:9, padding:"2px 7px", borderRadius:6, background:"rgba(3,199,90,0.15)", color:"#03c75a", border:"1px solid rgba(3,199,90,0.3)", fontWeight:700 }}>추천</span>
  );
  return null;
};

// ── 카드 컴포넌트 ──────────────────────────────────
const ResultCard = ({ item, rank }) => {
  const [open, setOpen] = useState(false);
  const sc = scoreColor(item.finalScore);
  const isBest = item.globalRank === 0;

  return (
    <div style={{
      background: isBest ? "rgba(255,215,0,0.05)" : "rgba(255,255,255,0.02)",
      border: `1px solid ${isBest ? "rgba(255,215,0,0.2)" : "rgba(255,255,255,0.06)"}`,
      borderRadius:10, overflow:"hidden",
      transition:"border-color 0.2s"
    }}>
      {/* 요약 행 */}
      <div onClick={() => setOpen(!open)} style={{ padding:"10px 12px", cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}>
        {/* 카테고리 내 순위 */}
        <div style={{ flexShrink:0, width:22, height:22, borderRadius:5,
          background: rank===0?"linear-gradient(135deg,#ffd700,#ff8800)":rank===1?"linear-gradient(135deg,#c0c0c0,#888)":rank===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)",
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:900, color:rank<3?"#000":"#555"
        }}>{rank+1}</div>

        {/* 키워드 + 뱃지 */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4, flexWrap:"wrap" }}>
            <span style={{ fontSize:13, fontWeight:800, color:"#fff" }}>{item.keyword}</span>
            <TopBadge globalRank={item.globalRank} />
            <span style={{ fontSize:9, padding:"2px 6px", borderRadius:5, background:`${sc}22`, color:sc, border:`1px solid ${sc}44` }}>
              {scoreLabel(item.finalScore)}
            </span>
            <span style={{ fontSize:9, padding:"2px 6px", borderRadius:5,
              background: item.trend.status==="급상승"?"rgba(255,215,0,0.12)":item.trend.status==="상승"?"rgba(3,199,90,0.1)":"rgba(255,255,255,0.04)",
              color: item.trend.status==="급상승"?"#ffd700":item.trend.status==="상승"?"#03c75a":"#555"
            }}>
              {item.trend.status==="급상승"?"🚀 급상승":item.trend.status==="상승"?"📈 상승":"📊 유지"}
            </span>
            <span style={{ fontSize:9, padding:"2px 6px", borderRadius:5, background:`${item.timing.color}15`, color:item.timing.color, border:`1px solid ${item.timing.color}30` }}>
              {item.timing.label}
            </span>
          </div>
          <Bar value={item.finalScore} color={sc} />
        </div>

        {/* 점수 */}
        <div style={{ flexShrink:0, textAlign:"right" }}>
          <div style={{ fontSize:18, fontWeight:900, color:sc, lineHeight:1 }}>{item.finalScore}</div>
          <div style={{ fontSize:9, color:"#444" }}>/ 100</div>
        </div>
        <div style={{ fontSize:9, color:"#333" }}>{open?"▲":"▼"}</div>
      </div>

      {/* 상세 펼침 */}
      {open && (
        <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", padding:"12px" }}>
          {/* 5개 지표 */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:4, marginBottom:10 }}>
            {[
              { label:"트렌드",  val:`${item.trend.score}점`,  color:"#ff4444" },
              { label:"가속도",  val:`${item.trend.velocity}x`, color:"#ffd700" },
              { label:"구매의도", val:`${item.purchase}%`,       color:"#03c75a" },
              { label:"경쟁도",  val:`${item.competition}점`,   color:item.competition<50?"#03c75a":"#ff8800" },
              { label:"쇼핑",   val:`${item.shop?.score||0}점`, color:"#4488ff" },
            ].map((s,j) => (
              <div key={j} style={{ background:"rgba(255,255,255,0.04)", borderRadius:6, padding:"6px 4px", textAlign:"center" }}>
                <div style={{ fontSize:8, color:"#555", marginBottom:1 }}>{s.label}</div>
                <div style={{ fontSize:11, fontWeight:800, color:s.color }}>{s.val}</div>
              </div>
            ))}
          </div>

          {/* 추천 이유 */}
          <div style={{ background:"rgba(255,255,255,0.02)", borderRadius:7, padding:"8px 10px", marginBottom:8 }}>
            <div style={{ fontSize:9, color:"#555", marginBottom:4 }}>💡 추천 이유</div>
            {item.reason.split(" · ").map((r,j) => (
              <div key={j} style={{ display:"flex", gap:4, marginBottom:2 }}>
                <span style={{ color:sc, fontSize:9 }}>•</span>
                <span style={{ fontSize:10, color:"#aaa" }}>{r}</span>
              </div>
            ))}
          </div>

          {/* 대표 상품 */}
          {item.shop?.top && (
            <div onClick={()=>item.shop.top.url&&window.open(item.shop.top.url,"_blank")}
              style={{ background:"rgba(3,199,90,0.05)", border:"1px solid rgba(3,199,90,0.12)", borderRadius:7, padding:"8px 10px", cursor:"pointer" }}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(3,199,90,0.1)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(3,199,90,0.05)"}>
              <div style={{ fontSize:9, color:"#03c75a", marginBottom:2 }}>🛍 리뷰 최다 상품</div>
              <div style={{ fontSize:11, color:"#ccc", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:3 }}>{item.shop.top.name}</div>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontSize:13, fontWeight:900, color:"#03c75a" }}>{fmtPrice(item.shop.top.price)}</span>
                <span style={{ fontSize:10, color:"#444" }}>🏪 {item.shop.top.mall}</span>
              </div>
              {item.shop.reviewTotal>0 && (
                <div style={{ fontSize:10, color:"#555", marginTop:2 }}>💬 리뷰 {item.shop.reviewTotal.toLocaleString()}개</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── 메인 컴포넌트 ──────────────────────────────────
export default function AutoRecommend({ apiKey }) {
  const [loading, setLoading]         = useState(false);
  const [progress, setProgress]       = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [groups, setGroups]           = useState([]);
  const [error, setError]             = useState("");
  const [ran, setRan]                 = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");

  const handleRun = async () => {
    setLoading(true); setError(""); setGroups([]); setRan(true);
    setProgress(0); setProgressMsg("시작 중...");
    try {
      const data = await runAutoRecommend(apiKey, (pct, msg) => {
        setProgress(pct); setProgressMsg(msg);
      });
      setGroups(groupByCategory(data));
    } catch (e) {
      setError(e.message || "분석 중 오류 발생");
    } finally {
      setLoading(false);
    }
  };

  const allItems = groups.flatMap(g => g.items);
  const filtered = activeFilter === "all"
    ? groups
    : groups.filter(g => g.id === activeFilter);

  return (
    <div>
      {/* 실행 버튼 */}
      <button onClick={handleRun} disabled={loading} style={{
        width:"100%", padding:"14px", borderRadius:12, border:"none",
        cursor: loading?"not-allowed":"pointer",
        background: loading?"#222":"linear-gradient(135deg,#ff8800,#ffd700)",
        color: loading?"#555":"#000", fontWeight:800, fontSize:14,
        display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:16
      }}>
        {loading ? <><Spinner color="#ff8800" size={16}/> 분석 중...</> : "🔥 추천 상품 자동 분석"}
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
          <div style={{ fontSize:10, color:"#444", marginTop:5, textAlign:"center" }}>
            네이버 쇼핑랭킹 · 블로그 · 뉴스 · 카페 · YouTube 실시간 분석 중
          </div>
        </div>
      )}

      {error && (
        <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:8, padding:"10px 12px", color:"#ff8888", fontSize:12, marginBottom:12 }}>
          ⚠️ {error}
        </div>
      )}

      {!loading && ran && !error && groups.length === 0 && (
        <div style={{ textAlign:"center", color:"#444", fontSize:12, padding:32 }}>
          조건에 맞는 추천 상품이 없습니다. 다시 시도해주세요.
        </div>
      )}

      {/* 결과 */}
      {!loading && groups.length > 0 && (
        <div>
          {/* 상단 요약 바 */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
            <div style={{ fontSize:11, color:"#555" }}>
              <b style={{ color:"#ffd700" }}>{allItems.length}개</b> 키워드 · <b style={{ color:"#ffd700" }}>{groups.length}개</b> 카테고리
            </div>
            <div style={{ fontSize:10, color:"#444" }}>점수순 정렬</div>
          </div>

          {/* 카테고리 필터 탭 */}
          <div style={{ display:"flex", gap:4, marginBottom:14, flexWrap:"wrap" }}>
            <button onClick={()=>setActiveFilter("all")} style={{
              padding:"5px 12px", borderRadius:20, border:"none", fontSize:10, cursor:"pointer", fontWeight:700,
              background: activeFilter==="all"?"rgba(255,215,0,0.15)":"rgba(255,255,255,0.04)",
              color: activeFilter==="all"?"#ffd700":"#555",
              border: activeFilter==="all"?"1px solid rgba(255,215,0,0.3)":"1px solid rgba(255,255,255,0.06)"
            }}>전체 {allItems.length}</button>
            {groups.map(g => (
              <button key={g.id} onClick={()=>setActiveFilter(g.id)} style={{
                padding:"5px 12px", borderRadius:20, border:"none", fontSize:10, cursor:"pointer",
                background: activeFilter===g.id?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.03)",
                color: activeFilter===g.id?"#fff":"#555",
                border: activeFilter===g.id?"1px solid rgba(255,255,255,0.2)":"1px solid rgba(255,255,255,0.05)"
              }}>{g.icon} {g.label} {g.items.length}</button>
            ))}
          </div>

          {/* BEST 키워드 하이라이트 */}
          {activeFilter === "all" && allItems[0] && (
            <div style={{ background:"linear-gradient(135deg,rgba(255,215,0,0.06),rgba(255,136,0,0.04))", border:"1px solid rgba(255,215,0,0.2)", borderRadius:12, padding:"12px 14px", marginBottom:14, display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ fontSize:24 }}>🔥</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10, color:"#ffd700", fontWeight:700, marginBottom:3 }}>오늘의 BEST 추천</div>
                <div style={{ fontSize:16, fontWeight:900, color:"#fff", marginBottom:2 }}>{allItems[0].keyword}</div>
                <div style={{ fontSize:10, color:"#888" }}>{allItems[0].reason.split(" · ")[0]}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:28, fontWeight:900, color:"#ffd700", lineHeight:1 }}>{allItems[0].finalScore}</div>
                <div style={{ fontSize:9, color:"#555" }}>/ 100</div>
              </div>
            </div>
          )}

          {/* 카테고리별 그룹 */}
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            {filtered.map(group => (
              <div key={group.id}>
                {/* 카테고리 헤더 */}
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, paddingBottom:6, borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                  <span style={{ fontSize:16 }}>{group.icon}</span>
                  <span style={{ fontSize:13, fontWeight:700, color:"#ccc" }}>{group.label}</span>
                  <span style={{ fontSize:10, color:"#444", marginLeft:2 }}>{group.items.length}개</span>
                  <div style={{ marginLeft:"auto", fontSize:10, color:"#555" }}>
                    최고 <b style={{ color:scoreColor(group.topScore) }}>{group.topScore}점</b>
                  </div>
                </div>

                {/* 카드 리스트 */}
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {group.items.map((item, rank) => (
                    <ResultCard key={item.keyword} item={item} rank={rank} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
