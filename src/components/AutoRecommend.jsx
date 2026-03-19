// v8.0 - 쇼츠 탐색기 통합 + 홈 버전 표시
import { useState } from "react";
import { runAutoRecommend } from "../api/autoRecommend";

const VERSION = "v8.0";
const VERSION_LOG = [
  { ver:"v8.0", desc:"쇼츠 탐색기 탭 추가 (제품성 점수·상세 분석)" },
  { ver:"v7.2", desc:"Google Trends RSS 통합" },
  { ver:"v7.1", desc:"키워드 오염 필터 강화" },
  { ver:"v7.0", desc:"동적 후보 수집 / DataLab+Insight 통합" },
  { ver:"v5.0", desc:"실시간·안정 추천 분리" },
];

// ══════════════════════════════════════
// 공통 유틸
// ══════════════════════════════════════
const fmtPrice   = n => n ? parseInt(n).toLocaleString()+"원" : "-";
const fmtNum     = n => { if(!n&&n!==0) return"-"; const x=parseInt(n)||0; if(x>=100000000) return(x/100000000).toFixed(1)+"억"; if(x>=10000) return Math.floor(x/10000)+"만"; if(x>=1000) return(x/1000).toFixed(1)+"천"; return x.toLocaleString(); };
const fmtDate    = s => { if(!s) return"-"; const d=Math.floor((Date.now()-new Date(s))/86400000); if(d===0)return"오늘"; if(d<7)return`${d}일 전`; if(d<30)return`${Math.floor(d/7)}주 전`; return`${Math.floor(d/30)}개월 전`; };
const fmtDur     = s => { if(!s) return"-"; const m=Math.floor(s/60),sec=s%60; return m>0?`${m}:${String(sec).padStart(2,"0")}`:`0:${String(sec).padStart(2,"0")}`; };
const scoreColor = s => s>=70?"#ffd700":s>=50?"#03c75a":s>=30?"#ff8800":"#888";
const scoreLabel = s => s>=70?"S급":s>=50?"A급":s>=30?"B급":"C급";
const scoreBg    = s => s>=70?"rgba(255,215,0,0.07)":s>=50?"rgba(3,199,90,0.06)":s>=30?"rgba(255,136,0,0.06)":"rgba(255,255,255,0.02)";
const statusColor= s => s==="급상승"?"#ffd700":s==="상승 시작"?"#ff8800":s==="유지"?"#4488ff":"#ff4444";
const statusIcon = s => s==="급상승"?"🚀":s==="상승 시작"?"📈":s==="유지"?"📊":"📉";

const Spinner = ({ color="#ff8800", size=16 }) => (
  <div style={{ display:"inline-block", width:size, height:size, border:`2px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite", flexShrink:0 }} />
);
const Bar = ({ value, color, height=3 }) => (
  <div style={{ height, background:"#1a1a1a", borderRadius:99 }}>
    <div style={{ height:"100%", borderRadius:99, width:`${Math.min(100,Math.max(0,value||0))}%`, background:`linear-gradient(90deg,${color}55,${color})`, transition:"width 0.6s" }} />
  </div>
);

// ══════════════════════════════════════
// 추천 관련
// ══════════════════════════════════════
const CATS = [
  { id:"tech",    label:"가전/IT",   icon:"💻", kw:["무선이어폰","공기청정기","로봇청소기","노트북","태블릿","스마트워치","블루투스스피커","보조배터리"] },
  { id:"beauty",  label:"뷰티/건강", icon:"✨", kw:["선크림","세럼","비타민","마스크팩","폼클렌징","샴푸","단백질보충제","유산균"] },
  { id:"living",  label:"생활/주방", icon:"🏠", kw:["에어프라이어","전기포트","텀블러","가습기","제습기","수납박스","전기그릴"] },
  { id:"fashion", label:"패션/잡화", icon:"👗", kw:["운동화","크로스백","레깅스","선글라스","백팩"] },
  { id:"food",    label:"식품",      icon:"🍎", kw:["닭가슴살","견과류","프로틴바","커피원두","그릭요거트"] },
  { id:"pet",     label:"반려동물",  icon:"🐾", kw:["강아지사료","고양이간식","펫패드"] },
];
const getCat = kw => { const k=kw.toLowerCase(); for(const c of CATS) if(c.kw.some(w=>k.includes(w)||w.includes(k))) return c; return {id:"etc",label:"기타",icon:"📦"}; };
const groupResults = results => {
  const ranked = results.map((item,i)=>({...item,globalRank:i}));
  const map = {};
  for(const item of ranked){ const cat=getCat(item.keyword); if(!map[cat.id]) map[cat.id]={...cat,items:[]}; map[cat.id].items.push(item); }
  return Object.values(map).map(g=>({...g,topScore:g.items[0]?.realtimeScore||g.items[0]?.finalScore||0})).sort((a,b)=>b.topScore-a.topScore);
};

const CompactCard = ({ item, rank, mode }) => {
  const score = mode==="realtime"?item.realtimeScore:item.finalScore;
  const sc = scoreColor(score);
  return (
    <div style={{ background:scoreBg(score), border:`1px solid ${sc}22`, borderRadius:9, padding:"9px 11px", display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ flexShrink:0, width:20, height:20, borderRadius:4, background:rank===0?"linear-gradient(135deg,#ffd700,#ff8800)":rank===1?"linear-gradient(135deg,#c0c0c0,#888)":"rgba(255,255,255,0.06)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:900, color:rank<2?"#000":"#555" }}>{rank+1}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:800, color:"#fff", marginBottom:2 }}>{item.keyword}</div>
        <div style={{ display:"flex", gap:5 }}>
          <span style={{ fontSize:9, color:statusColor(item.trend.status) }}>{statusIcon(item.trend.status)} {item.trend.status}</span>
          <span style={{ fontSize:9, color:item.timing.color }}>{item.timing.label}</span>
        </div>
      </div>
      <div style={{ textAlign:"right", flexShrink:0 }}>
        <div style={{ fontSize:16, fontWeight:900, color:sc }}>{score}</div>
        <div style={{ fontSize:8, color:"#444" }}>점</div>
      </div>
    </div>
  );
};

const DetailCard = ({ item, rank, mode }) => {
  const [open, setOpen] = useState(false);
  const score = mode==="realtime"?item.realtimeScore:item.finalScore;
  const sc = scoreColor(score);
  const isRT = mode==="realtime";
  return (
    <div style={{ background:scoreBg(score), border:`1px solid ${sc}22`, borderRadius:11, overflow:"hidden" }}>
      <div onClick={()=>setOpen(!open)} style={{ padding:"11px 13px", cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}>
        <div style={{ flexShrink:0, width:22, height:22, borderRadius:5, background:rank===0?"linear-gradient(135deg,#ffd700,#ff8800)":rank===1?"linear-gradient(135deg,#c0c0c0,#888)":rank===2?"linear-gradient(135deg,#cd7f32,#8b4513)":"rgba(255,255,255,0.06)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:900, color:rank<3?"#000":"#555" }}>{rank+1}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3, flexWrap:"wrap" }}>
            <span style={{ fontSize:13, fontWeight:800, color:"#fff" }}>{item.keyword}</span>
            {rank===0 && <span style={{ fontSize:9, padding:"2px 6px", borderRadius:5, background:"rgba(255,215,0,0.2)", color:"#ffd700", border:"1px solid rgba(255,215,0,0.4)", fontWeight:800 }}>{isRT?"⚡ 실시간 1위":"🔥 BEST"}</span>}
            <span style={{ fontSize:9, padding:"2px 5px", borderRadius:5, background:`${sc}22`, color:sc }}>{scoreLabel(score)}</span>
            <span style={{ fontSize:9, padding:"2px 5px", borderRadius:5, background:`${statusColor(item.trend.status)}18`, color:statusColor(item.trend.status) }}>{statusIcon(item.trend.status)} {item.trend.status}</span>
            <span style={{ fontSize:9, padding:"2px 5px", borderRadius:5, color:item.timing.color }}>{item.timing.label}</span>
            <span style={{ fontSize:9, color:"#444" }}>{getCat(item.keyword).icon} {getCat(item.keyword).label}</span>
          </div>
          <Bar value={score} color={sc} />
        </div>
        <div style={{ flexShrink:0, textAlign:"right" }}>
          <div style={{ fontSize:20, fontWeight:900, color:sc, lineHeight:1 }}>{score}</div>
          <div style={{ fontSize:8, color:"#444" }}>/ 100</div>
        </div>
        <div style={{ fontSize:9, color:"#333" }}>{open?"▲":"▼"}</div>
      </div>
      {open && (
        <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", padding:"12px 13px" }}>
          {isRT && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:4, marginBottom:10 }}>
              {[
                { l:"실시간 점수", v:`${item.realtimeScore}점`, c:"#ffd700" },
                { l:"상승 속도",   v:`${item.trend.velocity}x`, c:item.trend.velocity>=2?"#ff4444":"#ff8800" },
                { l:"참여율",      v:`${item.trend.avgEngRate||0}%`, c:"#03c75a" },
                { l:"최신 영상",   v:`${item.trend.freshCount||0}개`, c:"#4488ff" },
              ].map((s,j)=>(
                <div key={j} style={{ background:"rgba(255,255,255,0.04)", borderRadius:6, padding:"6px 4px", textAlign:"center" }}>
                  <div style={{ fontSize:8, color:"#555", marginBottom:1 }}>{s.l}</div>
                  <div style={{ fontSize:11, fontWeight:800, color:s.c }}>{s.v}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:4, marginBottom:10 }}>
            {[
              { l:"트렌드",  v:`${item.trend.score}점`,   c:"#ff4444" },
              { l:"가속도",  v:`${item.trend.velocity}x`, c:"#ffd700" },
              { l:"구매의도",v:`${item.purchase}%`,        c:"#03c75a" },
              { l:"경쟁도",  v:`${item.competition}점`,   c:item.competition<50?"#03c75a":"#ff8800" },
              { l:"쇼핑",   v:`${item.shop?.score||0}점`, c:"#4488ff" },
            ].map((s,j)=>(
              <div key={j} style={{ background:"rgba(255,255,255,0.04)", borderRadius:6, padding:"5px 3px", textAlign:"center" }}>
                <div style={{ fontSize:8, color:"#555", marginBottom:1 }}>{s.l}</div>
                <div style={{ fontSize:10, fontWeight:800, color:s.c }}>{s.v}</div>
              </div>
            ))}
          </div>
          <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:7, padding:"8px 10px", marginBottom:8 }}>
            <div style={{ fontSize:9, color:"#555", marginBottom:3 }}>{isRT?"⚡ 실시간 추천 이유":"💡 추천 이유"}</div>
            <div style={{ fontSize:11, color:"#bbb" }}>{item.reason}</div>
          </div>
          {item.shop?.top && (
            <div onClick={()=>item.shop.top.url&&window.open(item.shop.top.url,"_blank")}
              style={{ background:"rgba(3,199,90,0.05)", border:"1px solid rgba(3,199,90,0.12)", borderRadius:7, padding:"8px 10px", cursor:"pointer" }}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(3,199,90,0.1)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(3,199,90,0.05)"}>
              <div style={{ fontSize:9, color:"#03c75a", marginBottom:2 }}>🛍 리뷰 최다 상품</div>
              <div style={{ fontSize:11, color:"#ccc", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:2 }}>{item.shop.top.name}</div>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontSize:13, fontWeight:900, color:"#03c75a" }}>{fmtPrice(item.shop.top.price)}</span>
                <span style={{ fontSize:10, color:"#444" }}>🏪 {item.shop.top.mall}</span>
              </div>
              {item.shop.reviewTotal>0 && <div style={{ fontSize:9, color:"#555", marginTop:2 }}>💬 리뷰 {item.shop.reviewTotal.toLocaleString()}개</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════
// 쇼츠 탐색기
// ══════════════════════════════════════
const PRODUCT_KWS  = ["추천","리뷰","후기","비교","가성비","꿀템","구매","언박싱","추천템","생활용품","주방용품","필수템","스마트스토어","쿠팡","쇼핑","아이템","신상","득템"];
const NEGATIVE_KWS = ["뉴스","사건","브이로그","먹방","챌린지","예능","밈","일상","루틴","정치","스포츠","음악","드라마","영화"];

const parseDuration = iso => { if(!iso) return 0; const m=iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); if(!m) return 0; return (parseInt(m[1]||0)*3600)+(parseInt(m[2]||0)*60)+(parseInt(m[3]||0)); };
const detectProductKws  = (t,d,tags) => { const tx=[t,d,...(tags||[])].join(" ").toLowerCase(); return PRODUCT_KWS.filter(k=>tx.includes(k)); };
const detectNegativeKws = (t,d,tags) => { const tx=[t,d,...(tags||[])].join(" ").toLowerCase(); return NEGATIVE_KWS.filter(k=>tx.includes(k)); };

const calcShortsScore = video => {
  const { durationSeconds, viewCount, likeCount, commentCount, publishedAt, title, description, tags, detectedKeywords, detectedNegativeKeywords } = video;
  const reasons = []; let score = 0;
  // 조회수
  score += Math.min(25, Math.log10(Math.max(1,viewCount))/7*25);
  if(viewCount>=100000) reasons.push(`조회수 ${fmtNum(viewCount)} — 높은 노출`);
  // 좋아요율
  const lr = viewCount>0?likeCount/viewCount:0;
  score += Math.min(20, lr*2000);
  if(lr>=0.05) reasons.push(`좋아요율 ${(lr*100).toFixed(1)}%`);
  // 댓글율
  const cr = viewCount>0?commentCount/viewCount:0;
  score += Math.min(10, cr*5000);
  if(cr>=0.01) reasons.push(`댓글 반응률 ${(cr*100).toFixed(2)}%`);
  // 최신성
  const days=(Date.now()-new Date(publishedAt))/86400000;
  if(days<=7){score+=15;reasons.push("최근 7일 내 ⚡");}
  else if(days<=14){score+=12;reasons.push("최근 14일 내");}
  else if(days<=30){score+=8;reasons.push("최근 30일 내");}
  else score+=4;
  // 쇼츠
  let ss=0;
  if(durationSeconds>0&&durationSeconds<=60){ss+=10;reasons.push("60초 이하 쇼츠");}
  else if(durationSeconds<=180) ss+=3;
  if([title,description,...(tags||[])].join(" ").toLowerCase().includes("#shorts")){ss+=5;reasons.push("#shorts 포함");}
  score+=Math.min(15,ss);
  // 제품 키워드
  score+=Math.min(15,detectedKeywords.length*3);
  if(detectedKeywords.length>0) reasons.push(`키워드: ${detectedKeywords.slice(0,4).join(", ")}`);
  // 감점
  score-=detectedNegativeKeywords.length*5;
  if(detectedNegativeKeywords.length>0) reasons.push(`⚠ 감점: ${detectedNegativeKeywords.join(", ")}`);
  return { score:Math.round(Math.min(100,Math.max(0,score))), reasons };
};

const ShortsScoreColor = s => s>=70?"#ffd700":s>=50?"#03c75a":s>=30?"#ff8800":"#888";
const ShortsGrade = s => s>=70?"S":s>=50?"A":s>=30?"B":"C";

const ShortsDetailPanel = ({ video, onClose }) => {
  if(!video) return null;
  const sc = ShortsScoreColor(video.productScore);
  return (
    <div style={{ position:"fixed", top:0, right:0, bottom:0, width:340, background:"#0f0f13", borderLeft:"1px solid rgba(255,255,255,0.08)", zIndex:1000, overflowY:"auto", padding:18 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div style={{ fontSize:12, fontWeight:700, color:"#ccc" }}>📋 상세 분석</div>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"#555", fontSize:16, cursor:"pointer" }}>✕</button>
      </div>
      <img src={video.thumbnail} alt="" style={{ width:"100%", borderRadius:7, marginBottom:10, display:"block" }} />
      <div style={{ fontSize:12, fontWeight:700, color:"#fff", marginBottom:6, lineHeight:1.5 }}>{video.title}</div>
      <div style={{ fontSize:10, color:"#555", marginBottom:10 }}>{video.channelTitle} · {fmtDate(video.publishedAt)}</div>
      <div style={{ background:`${sc}15`, border:`1px solid ${sc}33`, borderRadius:8, padding:"9px 12px", marginBottom:10, display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ fontSize:30, fontWeight:900, color:sc, lineHeight:1 }}>{video.productScore}</div>
        <div>
          <div style={{ fontSize:11, color:sc, fontWeight:700 }}>{ShortsGrade(video.productScore)}급 제품성</div>
          <div style={{ fontSize:9, color:"#555" }}>/ 100점</div>
        </div>
      </div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:10, fontWeight:700, color:"#888", marginBottom:6 }}>📊 점수 이유</div>
        {video.reasons.map((r,i)=>(
          <div key={i} style={{ display:"flex", gap:5, marginBottom:3 }}>
            <span style={{ color:r.startsWith("⚠")?"#ff4444":"#03c75a", fontSize:9 }}>•</span>
            <span style={{ fontSize:10, color:"#aaa" }}>{r}</span>
          </div>
        ))}
      </div>
      {video.detectedKeywords.length>0 && (
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#888", marginBottom:5 }}>🏷 제품 키워드</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
            {video.detectedKeywords.map((k,i)=>(
              <span key={i} style={{ fontSize:9, padding:"2px 7px", borderRadius:20, background:"rgba(3,199,90,0.1)", color:"#03c75a", border:"1px solid rgba(3,199,90,0.2)" }}>{k}</span>
            ))}
          </div>
        </div>
      )}
      {video.description && (
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#888", marginBottom:5 }}>📝 설명</div>
          <div style={{ fontSize:9, color:"#555", lineHeight:1.6, background:"rgba(255,255,255,0.03)", borderRadius:6, padding:"7px 9px" }}>{video.description}</div>
        </div>
      )}
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:10, fontWeight:700, color:"#888", marginBottom:5 }}>💡 판매 포인트</div>
        <div style={{ background:"rgba(255,215,0,0.04)", border:"1px solid rgba(255,215,0,0.1)", borderRadius:7, padding:"8px 10px" }}>
          {video.productScore>=70 && <div style={{ fontSize:10, color:"#ccc", marginBottom:2 }}>• 높은 제품성 — 쿠팡파트너스 적합</div>}
          {video.isShortsCandidate && <div style={{ fontSize:10, color:"#ccc", marginBottom:2 }}>• 쇼츠 형식 — 모바일 최적화</div>}
          {video.viewCount>=50000 && <div style={{ fontSize:10, color:"#ccc", marginBottom:2 }}>• 충분한 조회수 — 시장 수요 검증</div>}
          {video.detectedKeywords.length>=3 && <div style={{ fontSize:10, color:"#ccc", marginBottom:2 }}>• 복수 키워드 — 구매 의도 높음</div>}
        </div>
      </div>
      <a href={video.url} target="_blank" rel="noopener noreferrer" style={{ display:"block", textAlign:"center", padding:"9px", background:"linear-gradient(135deg,#ff4400,#ff8800)", borderRadius:7, color:"#000", fontWeight:700, fontSize:11, textDecoration:"none" }}>▶ YouTube에서 보기</a>
    </div>
  );
};

const ShortsVideoCard = ({ video, selected, onClick }) => {
  const sc = ShortsScoreColor(video.productScore);
  return (
    <div onClick={onClick} style={{ background:selected?"rgba(255,215,0,0.05)":"rgba(255,255,255,0.02)", border:`1px solid ${selected?sc+"55":"rgba(255,255,255,0.06)"}`, borderRadius:10, padding:11, cursor:"pointer", transition:"all 0.15s" }}
      onMouseEnter={e=>{ if(!selected) e.currentTarget.style.background="rgba(255,255,255,0.05)"; }}
      onMouseLeave={e=>{ if(!selected) e.currentTarget.style.background=selected?"rgba(255,215,0,0.05)":"rgba(255,255,255,0.02)"; }}>
      <div style={{ display:"flex", gap:10 }}>
        <div style={{ position:"relative", flexShrink:0 }}>
          <img src={video.thumbnail} alt="" style={{ width:96, height:54, objectFit:"cover", borderRadius:6, display:"block" }} />
          <div style={{ position:"absolute", bottom:3, right:3, background:"rgba(0,0,0,0.8)", borderRadius:3, padding:"1px 4px", fontSize:8, color:"#fff" }}>{fmtDur(video.durationSeconds)}</div>
          {video.isShortsCandidate && <div style={{ position:"absolute", top:3, left:3, background:"#ff4400", borderRadius:3, padding:"1px 5px", fontSize:7, fontWeight:700, color:"#fff" }}>SHORTS</div>}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, fontWeight:600, color:"#fff", lineHeight:1.4, marginBottom:4, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{video.title}</div>
          <div style={{ fontSize:9, color:"#555", marginBottom:5 }}>{video.channelTitle} · {fmtDate(video.publishedAt)}</div>
          <div style={{ display:"flex", gap:8 }}>
            <span style={{ fontSize:9, color:"#888" }}>👁 {fmtNum(video.viewCount)}</span>
            <span style={{ fontSize:9, color:"#888" }}>👍 {fmtNum(video.likeCount)}</span>
            <span style={{ fontSize:9, color:"#888" }}>💬 {fmtNum(video.commentCount)}</span>
          </div>
        </div>
        <div style={{ flexShrink:0, textAlign:"center", minWidth:40 }}>
          <div style={{ fontSize:20, fontWeight:900, color:sc, lineHeight:1 }}>{video.productScore}</div>
          <div style={{ fontSize:9, color:sc, fontWeight:700 }}>{ShortsGrade(video.productScore)}</div>
        </div>
      </div>
    </div>
  );
};

const ShortsExplorer = ({ defaultApiKey="" }) => {
  const [apiKey, setApiKey]     = useState(defaultApiKey);
  const [keyword, setKeyword]   = useState("가성비 추천");
  const [region, setRegion]     = useState("KR");
  const [lang, setLang]         = useState("ko");
  const [days, setDays]         = useState(30);
  const [maxRes, setMaxRes]     = useState(20);
  const [sortBy, setSortBy]     = useState("score");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [results, setResults]   = useState([]);
  const [selected, setSelected] = useState(null);
  const [searched, setSearched] = useState(false);
  const [viewMode, setViewMode] = useState("card");

  const searchYT = async () => {
    const published = new Date(Date.now()-parseInt(days)*86400000).toISOString();
    const order = sortBy==="date"?"date":"viewCount";
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(keyword)}&type=video&maxResults=${Math.min(50,parseInt(maxRes)||20)}&order=${order}&regionCode=${region}&relevanceLanguage=${lang}&publishedAfter=${published}&videoDuration=short&key=${apiKey}`;
    const res = await fetch(url); const data = await res.json();
    if(data.error) throw new Error(data.error.message);
    return (data.items||[]).map(i=>i.id.videoId);
  };

  const fetchDetails = async ids => {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${ids.join(",")}&key=${apiKey}`;
    const res = await fetch(url); const data = await res.json();
    if(data.error) throw new Error(data.error.message);
    return (data.items||[]).map(v => {
      const dur=parseDuration(v.contentDetails?.duration);
      const title=v.snippet?.title||"",desc=v.snippet?.description||"",tags=v.snippet?.tags||[];
      const posKws=detectProductKws(title,desc,tags),negKws=detectNegativeKws(title,desc,tags);
      const vd = { videoId:v.id, title, channelTitle:v.snippet?.channelTitle||"", publishedAt:v.snippet?.publishedAt||"", durationSeconds:dur, viewCount:parseInt(v.statistics?.viewCount)||0, likeCount:parseInt(v.statistics?.likeCount)||0, commentCount:parseInt(v.statistics?.commentCount)||0, thumbnail:v.snippet?.thumbnails?.medium?.url||"", tags, description:desc.slice(0,300), isShortsCandidate:dur<=60||[title,desc,...tags].join(" ").toLowerCase().includes("#shorts"), detectedKeywords:posKws, detectedNegativeKeywords:negKws, url:`https://www.youtube.com/watch?v=${v.id}` };
      const { score, reasons } = calcShortsScore(vd);
      return { ...vd, productScore:score, reasons };
    });
  };

  const handleSearch = async () => {
    if(!apiKey.trim()){ setError("YouTube API Key를 입력해주세요."); return; }
    if(!keyword.trim()){ setError("검색 키워드를 입력해주세요."); return; }
    setLoading(true); setError(""); setResults([]); setSelected(null); setSearched(true);
    try {
      const ids = await searchYT();
      if(!ids.length){ setResults([]); return; }
      const videos = await fetchDetails(ids);
      let sorted = [...videos];
      if(sortBy==="score") sorted.sort((a,b)=>b.productScore-a.productScore);
      else if(sortBy==="views") sorted.sort((a,b)=>b.viewCount-a.viewCount);
      else sorted.sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
      setResults(sorted);
    } catch(e){ setError("오류: "+e.message); }
    finally{ setLoading(false); }
  };

  const shorts=results.filter(v=>v.isShortsCandidate);
  const avgScore=results.length?Math.round(results.reduce((s,v)=>s+v.productScore,0)/results.length):0;

  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:15, fontWeight:800, marginBottom:3 }}>🎬 유튜브 제품 쇼츠 탐색기</div>
        <div style={{ fontSize:10, color:"#555" }}>제품 판매 가능성이 높은 쇼츠 영상 후보 발굴 도구</div>
      </div>
      <div style={{ marginBottom:10 }}>
        <div style={{ fontSize:10, color:"#555", marginBottom:3 }}>YouTube API Key</div>
        <input value={apiKey} onChange={e=>setApiKey(e.target.value)} type="password" placeholder="AIza..."
          style={{ width:"100%", background:"#111", border:"1px solid #222", borderRadius:7, padding:"8px 10px", color:"#ccc", fontSize:11, outline:"none" }} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 70px 70px", gap:7, marginBottom:7 }}>
        <input value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSearch()}
          placeholder="검색 키워드 (예: 가성비 추천, 주방용품 리뷰)"
          style={{ background:"#111", border:"1px solid #222", borderRadius:7, padding:"8px 10px", color:"#ccc", fontSize:11, outline:"none" }} />
        <input value={region} onChange={e=>setRegion(e.target.value)} placeholder="KR"
          style={{ background:"#111", border:"1px solid #222", borderRadius:7, padding:"8px 10px", color:"#ccc", fontSize:11, textAlign:"center", outline:"none" }} />
        <input value={lang} onChange={e=>setLang(e.target.value)} placeholder="ko"
          style={{ background:"#111", border:"1px solid #222", borderRadius:7, padding:"8px 10px", color:"#ccc", fontSize:11, textAlign:"center", outline:"none" }} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr auto", gap:7, marginBottom:12 }}>
        <div>
          <div style={{ fontSize:9, color:"#444", marginBottom:2 }}>최근 며칠</div>
          <input type="number" value={days} onChange={e=>setDays(e.target.value)} min={1} max={365}
            style={{ width:"100%", background:"#111", border:"1px solid #222", borderRadius:7, padding:"7px 10px", color:"#ccc", fontSize:11, outline:"none" }} />
        </div>
        <div>
          <div style={{ fontSize:9, color:"#444", marginBottom:2 }}>최대 결과</div>
          <input type="number" value={maxRes} onChange={e=>setMaxRes(e.target.value)} min={5} max={50}
            style={{ width:"100%", background:"#111", border:"1px solid #222", borderRadius:7, padding:"7px 10px", color:"#ccc", fontSize:11, outline:"none" }} />
        </div>
        <div>
          <div style={{ fontSize:9, color:"#444", marginBottom:2 }}>정렬</div>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
            style={{ width:"100%", background:"#111", border:"1px solid #222", borderRadius:7, padding:"7px 10px", color:"#ccc", fontSize:11, cursor:"pointer", outline:"none" }}>
            <option value="score">제품성 점수순</option>
            <option value="views">조회수순</option>
            <option value="date">최신순</option>
          </select>
        </div>
        <div style={{ display:"flex", alignItems:"flex-end" }}>
          <button onClick={handleSearch} disabled={loading}
            style={{ padding:"8px 16px", borderRadius:7, border:"none", cursor:loading?"not-allowed":"pointer", background:loading?"#222":"linear-gradient(135deg,#ff4400,#ffd700)", color:loading?"#555":"#000", fontWeight:800, fontSize:11, display:"flex", alignItems:"center", gap:5, whiteSpace:"nowrap" }}>
            {loading?<><Spinner size={12}/> 검색 중...</>:"🔍 검색"}
          </button>
        </div>
      </div>
      {error && <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:7, padding:"8px 11px", color:"#ff8888", fontSize:11, marginBottom:10 }}>⚠️ {error}</div>}
      {searched && !loading && results.length>0 && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:7, marginBottom:12 }}>
          {[
            { l:"총 검색",   v:`${results.length}개`,  c:"#ccc" },
            { l:"쇼츠 후보", v:`${shorts.length}개`,   c:"#ff8800" },
            { l:"평균 점수", v:`${avgScore}점`,         c:ShortsScoreColor(avgScore) },
            { l:"최고 점수", v:`${results[0]?.productScore||0}점`, c:ShortsScoreColor(results[0]?.productScore||0) },
          ].map((s,i)=>(
            <div key={i} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:8, padding:"8px", textAlign:"center" }}>
              <div style={{ fontSize:9, color:"#555", marginBottom:2 }}>{s.l}</div>
              <div style={{ fontSize:16, fontWeight:900, color:s.c }}>{s.v}</div>
            </div>
          ))}
        </div>
      )}
      {results.length>0 && (
        <div style={{ display:"flex", gap:4, marginBottom:8 }}>
          {["card","table"].map(m=>(
            <button key={m} onClick={()=>setViewMode(m)} style={{ padding:"4px 10px", borderRadius:6, border:"none", fontSize:10, cursor:"pointer", background:viewMode===m?"rgba(255,255,255,0.1)":"transparent", color:viewMode===m?"#fff":"#555" }}>{m==="card"?"카드형":"테이블형"}</button>
          ))}
        </div>
      )}
      {searched && !loading && results.length===0 && !error && (
        <div style={{ textAlign:"center", color:"#444", fontSize:12, padding:32 }}>검색 결과가 없습니다. 키워드나 기간을 변경해보세요.</div>
      )}
      {viewMode==="card" && results.length>0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {results.map(v=><ShortsVideoCard key={v.videoId} video={v} selected={selected?.videoId===v.videoId} onClick={()=>setSelected(v)}/>)}
        </div>
      )}
      {viewMode==="table" && results.length>0 && (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
            <thead>
              <tr style={{ borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
                {["점수","제목","채널","업로드","길이","조회수","좋아요","쇼츠"].map((h,i)=>(
                  <th key={i} style={{ padding:"7px 8px", textAlign:i===0?"center":"left", color:"#555", fontWeight:600, whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map(v=>(
                <tr key={v.videoId} onClick={()=>setSelected(v)} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)", cursor:"pointer" }}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <td style={{ padding:"7px 8px", textAlign:"center" }}><span style={{ fontSize:13, fontWeight:900, color:ShortsScoreColor(v.productScore) }}>{v.productScore}</span></td>
                  <td style={{ padding:"7px 8px", maxWidth:180 }}><div style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:"#ccc" }}>{v.title}</div></td>
                  <td style={{ padding:"7px 8px", color:"#555", whiteSpace:"nowrap" }}>{v.channelTitle}</td>
                  <td style={{ padding:"7px 8px", color:"#555", whiteSpace:"nowrap" }}>{fmtDate(v.publishedAt)}</td>
                  <td style={{ padding:"7px 8px", color:"#555", whiteSpace:"nowrap" }}>{fmtDur(v.durationSeconds)}</td>
                  <td style={{ padding:"7px 8px", color:"#888", whiteSpace:"nowrap" }}>{fmtNum(v.viewCount)}</td>
                  <td style={{ padding:"7px 8px", color:"#888", whiteSpace:"nowrap" }}>{fmtNum(v.likeCount)}</td>
                  <td style={{ padding:"7px 8px", textAlign:"center" }}>{v.isShortsCandidate?<span style={{ fontSize:8, padding:"1px 5px", background:"rgba(255,68,0,0.15)", color:"#ff8800", borderRadius:3 }}>✓</span>:<span style={{ color:"#333" }}>-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && <ShortsDetailPanel video={selected} onClose={()=>setSelected(null)}/>}
    </div>
  );
};

// ══════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════
export default function AutoRecommend({ apiKey }) {
  const [loadingRT, setLoadingRT] = useState(false);
  const [loadingST, setLoadingST] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [rtResults, setRtResults] = useState([]);
  const [stResults, setStResults] = useState([]);
  const [rtGroups, setRtGroups]   = useState([]);
  const [stGroups, setStGroups]   = useState([]);
  const [error, setError]         = useState("");
  const [ranRT, setRanRT]         = useState(false);
  const [ranST, setRanST]         = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [catFilter, setCatFilter] = useState("all");
  const [showChangelog, setShowChangelog] = useState(false);

  const TABS = [
    { id:"home",     label:"홈",       icon:"🏠" },
    { id:"realtime", label:"실시간",   icon:"⚡" },
    { id:"stable",   label:"안정",     icon:"💰" },
    { id:"cat",      label:"카테고리", icon:"📊" },
    { id:"shorts",   label:"쇼츠탐색", icon:"🎬" },
    { id:"setting",  label:"설정",     icon:"⚙️" },
  ];

  const handleRun = async (mode) => {
    const setLoading = mode==="realtime"?setLoadingRT:setLoadingST;
    setLoading(true); setError(""); setProgress(0); setProgressMsg("시작 중...");
    if(mode==="realtime") setRanRT(true); else setRanST(true);
    try {
      const data = await runAutoRecommend(apiKey, (pct,msg)=>{ setProgress(pct); setProgressMsg(msg); }, mode);
      if(mode==="realtime"){ setRtResults(data); setRtGroups(groupResults(data)); }
      else { setStResults(data); setStGroups(groupResults(data)); }
    } catch(e){ setError(e.message||"분석 중 오류 발생"); }
    finally{ setLoading(false); }
  };

  const loading = loadingRT||loadingST;
  const ProgressBar = () => loading ? (
    <div style={{ marginBottom:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
        <span style={{ fontSize:11, color:"#888" }}>{progressMsg}</span>
        <span style={{ fontSize:11, color:"#ffd700", fontWeight:700 }}>{progress}%</span>
      </div>
      <div style={{ height:4, background:"#1a1a1a", borderRadius:99 }}>
        <div style={{ height:"100%", borderRadius:99, width:`${progress}%`, background:"linear-gradient(90deg,#ff880088,#ffd700)", transition:"width 0.3s" }} />
      </div>
      <div style={{ fontSize:10, color:"#444", marginTop:4, textAlign:"center" }}>네이버 쇼핑 · 블로그 · 뉴스 · YouTube 실시간 분석 중</div>
    </div>
  ) : null;

  return (
    <div style={{ fontFamily:"'Segoe UI',sans-serif", color:"#fff" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} input,select{box-sizing:border-box}`}</style>

      {/* 탭 + 버전 뱃지 */}
      <div style={{ display:"flex", gap:2, marginBottom:16, background:"rgba(255,255,255,0.03)", borderRadius:10, padding:3, flexWrap:"wrap", alignItems:"center" }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{ flex:1, minWidth:48, padding:"8px 4px", borderRadius:7, border:"none", fontSize:10, cursor:"pointer", fontWeight:activeTab===t.id?700:400, background:activeTab===t.id?"rgba(255,255,255,0.1)":"transparent", color:activeTab===t.id?"#fff":"#555", borderBottom:activeTab===t.id?"2px solid #ffd700":"2px solid transparent", transition:"all 0.15s", whiteSpace:"nowrap" }}>{t.icon} {t.label}</button>
        ))}
        <button onClick={()=>setShowChangelog(!showChangelog)} style={{ fontSize:9, color:"#ffd700", padding:"3px 8px", borderRadius:20, border:"1px solid rgba(255,215,0,0.25)", background:"rgba(255,215,0,0.06)", whiteSpace:"nowrap", flexShrink:0, cursor:"pointer" }}>
          {VERSION}
        </button>
      </div>

      {/* 체인지로그 드롭다운 */}
      {showChangelog && (
        <div style={{ background:"rgba(255,215,0,0.04)", border:"1px solid rgba(255,215,0,0.15)", borderRadius:9, padding:"10px 12px", marginBottom:14 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#ffd700", marginBottom:8 }}>📋 버전 히스토리</div>
          {VERSION_LOG.map((v,i)=>(
            <div key={i} style={{ display:"flex", gap:10, marginBottom:4, alignItems:"center" }}>
              <span style={{ fontSize:9, padding:"2px 7px", borderRadius:20, background:i===0?"rgba(255,215,0,0.15)":"rgba(255,255,255,0.05)", color:i===0?"#ffd700":"#555", fontWeight:i===0?700:400, flexShrink:0 }}>{v.ver}</span>
              <span style={{ fontSize:10, color:i===0?"#ccc":"#555" }}>{v.desc}</span>
            </div>
          ))}
        </div>
      )}

      <ProgressBar />
      {error && <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:8, padding:"9px 11px", color:"#ff8888", fontSize:12, marginBottom:12 }}>⚠️ {error}</div>}

      {/* ── 홈 ── */}
      {activeTab==="home" && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
            <button onClick={()=>{ setActiveTab("realtime"); handleRun("realtime"); }} disabled={loadingRT} style={{ padding:"13px 10px", borderRadius:11, border:"none", cursor:loadingRT?"not-allowed":"pointer", background:loadingRT?"#222":"linear-gradient(135deg,#ff4400,#ffd700)", color:loadingRT?"#555":"#000", fontWeight:800, fontSize:13, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
              {loadingRT?<><Spinner size={14}/> 분석 중...</>:<>⚡ 실시간 추천</>}
            </button>
            <button onClick={()=>{ setActiveTab("stable"); handleRun("stable"); }} disabled={loadingST} style={{ padding:"13px 10px", borderRadius:11, border:"none", cursor:loadingST?"not-allowed":"pointer", background:loadingST?"#222":"linear-gradient(135deg,#0055ff,#03c75a)", color:loadingST?"#555":"#fff", fontWeight:800, fontSize:13, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
              {loadingST?<><Spinner color="#03c75a" size={14}/> 분석 중...</>:<>💰 안정 추천</>}
            </button>
          </div>

          {/* 기능 카드 */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:14 }}>
            {[
              { icon:"⚡", label:"실시간 추천", desc:"12~24h 급상승", color:"#ff8800", tab:"realtime" },
              { icon:"💰", label:"안정 추천",   desc:"종합 데이터 기반", color:"#03c75a", tab:"stable" },
              { icon:"🎬", label:"쇼츠 탐색",  desc:"제품성 점수 분석", color:"#4488ff", tab:"shorts" },
            ].map((c,i)=>(
              <div key={i} onClick={()=>setActiveTab(c.tab)} style={{ background:`${c.color}08`, border:`1px solid ${c.color}18`, borderRadius:9, padding:"10px 8px", textAlign:"center", cursor:"pointer" }}
                onMouseEnter={e=>e.currentTarget.style.background=`${c.color}15`}
                onMouseLeave={e=>e.currentTarget.style.background=`${c.color}08`}>
                <div style={{ fontSize:20, marginBottom:4 }}>{c.icon}</div>
                <div style={{ fontSize:11, fontWeight:700, color:"#ccc", marginBottom:2 }}>{c.label}</div>
                <div style={{ fontSize:9, color:"#555" }}>{c.desc}</div>
              </div>
            ))}
          </div>

          {/* 결과 요약 */}
          {(ranRT||ranST) && (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {ranRT && rtResults.length>0 && (
                <div>
                  <div style={{ fontSize:11, color:"#888", fontWeight:600, marginBottom:6 }}>⚡ 실시간 TOP 3</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                    {rtResults.slice(0,3).map((item,i)=><CompactCard key={item.keyword} item={item} rank={i} mode="realtime"/>)}
                  </div>
                </div>
              )}
              {ranST && stResults.length>0 && (
                <div>
                  <div style={{ fontSize:11, color:"#888", fontWeight:600, marginBottom:6 }}>💰 안정 TOP 3</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                    {stResults.slice(0,3).map((item,i)=><CompactCard key={item.keyword} item={item} rank={i} mode="stable"/>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 실시간 ── */}
      {activeTab==="realtime" && (
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
            <div><div style={{ fontSize:15, fontWeight:800 }}>⚡ 실시간 추천</div><div style={{ fontSize:10, color:"#555", marginTop:2 }}>최근 12~24h 급상승</div></div>
            <button onClick={()=>handleRun("realtime")} disabled={loadingRT} style={{ padding:"7px 14px", borderRadius:8, border:"none", cursor:loadingRT?"not-allowed":"pointer", background:loadingRT?"#222":"linear-gradient(135deg,#ff4400,#ffd700)", color:loadingRT?"#555":"#000", fontWeight:700, fontSize:11, display:"flex", alignItems:"center", gap:5 }}>
              {loadingRT?<><Spinner size={11}/> 분석 중...</>:"⚡ 재분석"}
            </button>
          </div>
          {!ranRT && !loadingRT && <div style={{ textAlign:"center", color:"#444", fontSize:12, padding:28 }}>버튼을 눌러 실시간 추천을 시작하세요.</div>}
          {!loadingRT && ranRT && rtResults.length===0 && <div style={{ textAlign:"center", color:"#555", fontSize:12, padding:28 }}>현재 급상승 중인 항목이 없습니다.<br/>안정 추천을 이용해주세요.</div>}
          {!loadingRT && rtResults.length>0 && (
            <div>
              <div style={{ background:"linear-gradient(135deg,rgba(255,68,0,0.08),rgba(255,215,0,0.05))", border:"1px solid rgba(255,215,0,0.2)", borderRadius:11, padding:"12px", marginBottom:11, display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:22 }}>⚡</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:10, color:"#ffd700", fontWeight:700, marginBottom:2 }}>실시간 1위</div>
                  <div style={{ fontSize:15, fontWeight:900, color:"#fff", marginBottom:2 }}>{rtResults[0].keyword}</div>
                  <div style={{ fontSize:10, color:"#777" }}>{rtResults[0].reason}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:26, fontWeight:900, color:"#ffd700", lineHeight:1 }}>{rtResults[0].realtimeScore}</div>
                  <div style={{ fontSize:9, color:"#555" }}>실시간 점수</div>
                </div>
              </div>
              <div style={{ fontSize:11, color:"#555", marginBottom:9 }}>급상승 <b style={{ color:"#ffd700" }}>TOP {rtResults.length}</b></div>
              <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                {rtResults.map((item,i)=><DetailCard key={item.keyword} item={item} rank={i} mode="realtime"/>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 안정 ── */}
      {activeTab==="stable" && (
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
            <div><div style={{ fontSize:15, fontWeight:800 }}>💰 안정 추천</div><div style={{ fontSize:10, color:"#555", marginTop:2 }}>쇼핑·검색 종합 분석</div></div>
            <button onClick={()=>handleRun("stable")} disabled={loadingST} style={{ padding:"7px 14px", borderRadius:8, border:"none", cursor:loadingST?"not-allowed":"pointer", background:loadingST?"#222":"linear-gradient(135deg,#0055ff,#03c75a)", color:loadingST?"#555":"#fff", fontWeight:700, fontSize:11, display:"flex", alignItems:"center", gap:5 }}>
              {loadingST?<><Spinner color="#03c75a" size={11}/> 분석 중...</>:"💰 재분석"}
            </button>
          </div>
          {!ranST && !loadingST && <div style={{ textAlign:"center", color:"#444", fontSize:12, padding:28 }}>버튼을 눌러 안정 추천을 시작하세요.</div>}
          {!loadingST && ranST && stResults.length===0 && <div style={{ textAlign:"center", color:"#444", fontSize:12, padding:28 }}>분석 결과가 없습니다.</div>}
          {!loadingST && stResults.length>0 && (
            <div>
              <div style={{ background:"linear-gradient(135deg,rgba(3,199,90,0.07),rgba(0,85,255,0.04))", border:"1px solid rgba(3,199,90,0.2)", borderRadius:11, padding:"12px", marginBottom:11, display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:22 }}>💰</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:10, color:"#03c75a", fontWeight:700, marginBottom:2 }}>안정 1위</div>
                  <div style={{ fontSize:15, fontWeight:900, color:"#fff", marginBottom:2 }}>{stResults[0].keyword}</div>
                  <div style={{ fontSize:10, color:"#777" }}>{stResults[0].reason}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:26, fontWeight:900, color:"#03c75a", lineHeight:1 }}>{stResults[0].finalScore}</div>
                  <div style={{ fontSize:9, color:"#555" }}>종합 점수</div>
                </div>
              </div>
              <div style={{ fontSize:11, color:"#555", marginBottom:9 }}>안정 추천 <b style={{ color:"#03c75a" }}>TOP {stResults.length}</b></div>
              <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                {stResults.map((item,i)=><DetailCard key={item.keyword} item={item} rank={i} mode="stable"/>)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 카테고리 ── */}
      {activeTab==="cat" && (
        <div>
          <div style={{ fontSize:15, fontWeight:800, marginBottom:4 }}>📊 카테고리 분석</div>
          <div style={{ fontSize:10, color:"#555", marginBottom:10 }}>{ranRT?"실시간 기준":ranST?"안정 기준":"먼저 추천 분석을 실행해주세요"}</div>
          {!ranRT && !ranST ? (
            <div style={{ textAlign:"center", padding:36 }}>
              <button onClick={()=>setActiveTab("home")} style={{ padding:"8px 18px", borderRadius:8, border:"1px solid rgba(255,215,0,0.25)", background:"rgba(255,215,0,0.07)", color:"#ffd700", fontWeight:700, fontSize:11, cursor:"pointer" }}>홈으로 이동</button>
            </div>
          ) : (
            <div>
              <div style={{ display:"flex", gap:4, marginBottom:10, flexWrap:"wrap" }}>
                <button onClick={()=>setCatFilter("all")} style={{ padding:"4px 10px", borderRadius:20, border:catFilter==="all"?"1px solid rgba(255,215,0,0.3)":"1px solid rgba(255,255,255,0.06)", fontSize:9, cursor:"pointer", fontWeight:catFilter==="all"?700:400, background:catFilter==="all"?"rgba(255,215,0,0.12)":"rgba(255,255,255,0.03)", color:catFilter==="all"?"#ffd700":"#555" }}>전체</button>
                {(ranRT?rtGroups:stGroups).map(g=>(
                  <button key={g.id} onClick={()=>setCatFilter(g.id)} style={{ padding:"4px 10px", borderRadius:20, border:catFilter===g.id?"1px solid rgba(255,255,255,0.2)":"1px solid rgba(255,255,255,0.05)", fontSize:9, cursor:"pointer", background:catFilter===g.id?"rgba(255,255,255,0.09)":"rgba(255,255,255,0.03)", color:catFilter===g.id?"#fff":"#555" }}>
                    {g.icon} {g.label} {g.items.length}
                  </button>
                ))}
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:13 }}>
                {(ranRT?rtGroups:stGroups).filter(g=>catFilter==="all"||g.id===catFilter).map(group=>(
                  <div key={group.id}>
                    <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:6, paddingBottom:5, borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                      <span style={{ fontSize:15 }}>{group.icon}</span>
                      <span style={{ fontSize:12, fontWeight:700, color:"#ccc" }}>{group.label}</span>
                      <span style={{ fontSize:9, color:"#444" }}>{group.items.length}개</span>
                      <div style={{ marginLeft:"auto", fontSize:10, color:"#555" }}>최고 <b style={{ color:scoreColor(group.topScore) }}>{group.topScore}점</b></div>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                      {group.items.map((item,rank)=><DetailCard key={item.keyword} item={item} rank={rank} mode={ranRT?"realtime":"stable"}/>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 쇼츠 탐색 ── */}
      {activeTab==="shorts" && <ShortsExplorer defaultApiKey={apiKey||""} />}

      {/* ── 설정 ── */}
      {activeTab==="setting" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:11, padding:"14px" }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:10 }}>🔑 API 상태</div>
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", background:"rgba(255,255,255,0.03)", borderRadius:7 }}>
              <div style={{ width:7, height:7, borderRadius:"50%", background:apiKey?"#03c75a":"#ff4444" }} />
              <span style={{ fontSize:11, color:"#ccc" }}>YouTube API Key</span>
              <span style={{ fontSize:10, color:apiKey?"#03c75a":"#ff4444", marginLeft:"auto" }}>{apiKey?"연결됨":"미설정"}</span>
            </div>
          </div>
          <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:11, padding:"14px" }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:10 }}>📐 점수 공식</div>
            {[
              { l:"⚡ 실시간", d:"YT속도35% + DataLab25% + 쇼핑클릭20% + 구매의도15% + 경쟁역수5%" },
              { l:"💰 안정",   d:"트렌드25% + YT25% + 구매의도25% + 쇼핑20% + 경쟁역수10%" },
              { l:"🎬 쇼츠",   d:"조회수25% + 좋아요율20% + 최신성15% + 쇼츠판별15% + 제품키워드15% + 댓글10%" },
            ].map((r,i)=>(
              <div key={i} style={{ padding:"6px 0", borderBottom:i<2?"1px solid rgba(255,255,255,0.04)":"none" }}>
                <div style={{ fontSize:11, color:"#ccc", marginBottom:1 }}>{r.l}</div>
                <div style={{ fontSize:10, color:"#555" }}>{r.d}</div>
              </div>
            ))}
          </div>
          <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:11, padding:"14px" }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:8 }}>📋 버전 히스토리</div>
            {VERSION_LOG.map((v,i)=>(
              <div key={i} style={{ display:"flex", gap:10, marginBottom:5, alignItems:"center" }}>
                <span style={{ fontSize:9, padding:"2px 7px", borderRadius:20, background:i===0?"rgba(255,215,0,0.15)":"rgba(255,255,255,0.04)", color:i===0?"#ffd700":"#555", fontWeight:i===0?700:400, flexShrink:0 }}>{v.ver}</span>
                <span style={{ fontSize:10, color:i===0?"#aaa":"#444" }}>{v.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
