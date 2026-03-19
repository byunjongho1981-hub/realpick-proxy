// ShortsExplorer.jsx
import { useState } from "react";
import { fmtNum, fmtDate, Spinner } from "./shared";

const fmtDur = s => { if(!s) return"-"; const m=Math.floor(s/60),sec=s%60; return m>0?`${m}:${String(sec).padStart(2,"0")}`:`0:${String(sec).padStart(2,"0")}`; };
const sColor = s => s>=70?"#ffd700":s>=50?"#03c75a":s>=30?"#ff8800":"#888";
const sGrade = s => s>=70?"S":s>=50?"A":s>=30?"B":"C";

const PRODUCT_KWS  = ["추천","리뷰","후기","비교","가성비","꿀템","구매","언박싱","추천템","생활용품","주방용품","필수템","스마트스토어","쿠팡","쇼핑","아이템","신상","득템"];
const NEGATIVE_KWS = ["뉴스","사건","브이로그","먹방","챌린지","예능","밈","일상","루틴","정치","스포츠","음악","드라마","영화"];

const parseDuration = iso => { if(!iso) return 0; const m=iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); if(!m) return 0; return (parseInt(m[1]||0)*3600)+(parseInt(m[2]||0)*60)+(parseInt(m[3]||0)); };
const detectPos = (t,d,tags) => { const tx=[t,d,...(tags||[])].join(" ").toLowerCase(); return PRODUCT_KWS.filter(k=>tx.includes(k)); };
const detectNeg = (t,d,tags) => { const tx=[t,d,...(tags||[])].join(" ").toLowerCase(); return NEGATIVE_KWS.filter(k=>tx.includes(k)); };

const calcScore = video => {
  const { durationSeconds,viewCount,likeCount,commentCount,publishedAt,title,description,tags,detectedKeywords,detectedNegativeKeywords } = video;
  const reasons=[]; let score=0;
  score+=Math.min(25,Math.log10(Math.max(1,viewCount))/7*25);
  if(viewCount>=100000) reasons.push(`조회수 ${fmtNum(viewCount)} — 높은 노출`);
  const lr=viewCount>0?likeCount/viewCount:0;
  score+=Math.min(20,lr*2000);
  if(lr>=0.05) reasons.push(`좋아요율 ${(lr*100).toFixed(1)}%`);
  const cr=viewCount>0?commentCount/viewCount:0;
  score+=Math.min(10,cr*5000);
  const days=(Date.now()-new Date(publishedAt))/86400000;
  if(days<=7){score+=15;reasons.push("최근 7일 내 ⚡");}
  else if(days<=14){score+=12;reasons.push("최근 14일 내");}
  else if(days<=30){score+=8;reasons.push("최근 30일 내");}
  else score+=4;
  let ss=0;
  if(durationSeconds>0&&durationSeconds<=60){ss+=10;reasons.push("60초 이하 쇼츠");}
  else if(durationSeconds<=180) ss+=3;
  if([title,description,...(tags||[])].join(" ").toLowerCase().includes("#shorts")){ss+=5;reasons.push("#shorts 포함");}
  score+=Math.min(15,ss);
  score+=Math.min(15,detectedKeywords.length*3);
  if(detectedKeywords.length>0) reasons.push(`키워드: ${detectedKeywords.slice(0,4).join(", ")}`);
  score-=detectedNegativeKeywords.length*5;
  if(detectedNegativeKeywords.length>0) reasons.push(`⚠ 감점: ${detectedNegativeKeywords.join(", ")}`);
  return { score:Math.round(Math.min(100,Math.max(0,score))), reasons };
};

// 상세 패널
const DetailPanel = ({ video, onClose }) => {
  if(!video) return null;
  const sc = sColor(video.productScore);
  return (
    <div style={{ position:"fixed", top:0, right:0, bottom:0, width:320, background:"#0f0f13", borderLeft:"1px solid rgba(255,255,255,0.08)", zIndex:1000, overflowY:"auto", padding:16 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <div style={{ fontSize:12, fontWeight:700, color:"#ccc" }}>📋 상세 분석</div>
        <button onClick={onClose} style={{ background:"none", border:"none", color:"#555", fontSize:16, cursor:"pointer" }}>✕</button>
      </div>
      <img src={video.thumbnail} alt="" style={{ width:"100%", borderRadius:7, marginBottom:10, display:"block" }} />
      <div style={{ fontSize:12, fontWeight:700, color:"#fff", marginBottom:5, lineHeight:1.5 }}>{video.title}</div>
      <div style={{ fontSize:10, color:"#555", marginBottom:10 }}>{video.channelTitle} · {fmtDate(video.publishedAt)}</div>
      <div style={{ background:`${sc}15`, border:`1px solid ${sc}33`, borderRadius:8, padding:"9px 12px", marginBottom:10, display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ fontSize:28, fontWeight:900, color:sc, lineHeight:1 }}>{video.productScore}</div>
        <div><div style={{ fontSize:11, color:sc, fontWeight:700 }}>{sGrade(video.productScore)}급 제품성</div><div style={{ fontSize:9, color:"#555" }}>/ 100점</div></div>
      </div>
      <div style={{ marginBottom:10 }}>
        <div style={{ fontSize:10, fontWeight:700, color:"#888", marginBottom:5 }}>📊 점수 이유</div>
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
            {video.detectedKeywords.map((k,i)=><span key={i} style={{ fontSize:9, padding:"2px 7px", borderRadius:20, background:"rgba(3,199,90,0.1)", color:"#03c75a", border:"1px solid rgba(3,199,90,0.2)" }}>{k}</span>)}
          </div>
        </div>
      )}
      {video.description && (
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#888", marginBottom:4 }}>📝 설명</div>
          <div style={{ fontSize:9, color:"#555", lineHeight:1.6, background:"rgba(255,255,255,0.03)", borderRadius:6, padding:"7px 9px" }}>{video.description}</div>
        </div>
      )}
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:10, fontWeight:700, color:"#888", marginBottom:5 }}>💡 판매 포인트</div>
        <div style={{ background:"rgba(255,215,0,0.04)", border:"1px solid rgba(255,215,0,0.1)", borderRadius:7, padding:"8px 10px" }}>
          {video.productScore>=70 && <div style={{ fontSize:10, color:"#ccc", marginBottom:2 }}>• 높은 제품성 — 쿠팡파트너스 적합</div>}
          {video.isShortsCandidate && <div style={{ fontSize:10, color:"#ccc", marginBottom:2 }}>• 쇼츠 형식 — 모바일 최적화</div>}
          {video.viewCount>=50000 && <div style={{ fontSize:10, color:"#ccc", marginBottom:2 }}>• 충분한 조회수 — 시장 수요 검증</div>}
          {video.detectedKeywords.length>=3 && <div style={{ fontSize:10, color:"#ccc" }}>• 복수 키워드 — 구매 의도 높음</div>}
        </div>
      </div>
      <a href={video.url} target="_blank" rel="noopener noreferrer" style={{ display:"block", textAlign:"center", padding:"9px", background:"linear-gradient(135deg,#ff4400,#ff8800)", borderRadius:7, color:"#000", fontWeight:700, fontSize:11, textDecoration:"none" }}>▶ YouTube에서 보기</a>
    </div>
  );
};

// 비디오 카드
const VideoCard = ({ video, selected, onClick }) => {
  const sc = sColor(video.productScore);
  return (
    <div onClick={onClick} style={{ background:selected?"rgba(255,215,0,0.05)":"rgba(255,255,255,0.02)", border:`1px solid ${selected?sc+"55":"rgba(255,255,255,0.06)"}`, borderRadius:10, padding:11, cursor:"pointer" }}
      onMouseEnter={e=>{ if(!selected) e.currentTarget.style.background="rgba(255,255,255,0.05)"; }}
      onMouseLeave={e=>{ if(!selected) e.currentTarget.style.background="rgba(255,255,255,0.02)"; }}>
      <div style={{ display:"flex", gap:10 }}>
        <div style={{ position:"relative", flexShrink:0 }}>
          <img src={video.thumbnail} alt="" style={{ width:96, height:54, objectFit:"cover", borderRadius:6, display:"block" }} />
          <div style={{ position:"absolute", bottom:3, right:3, background:"rgba(0,0,0,0.8)", borderRadius:3, padding:"1px 4px", fontSize:8, color:"#fff" }}>{fmtDur(video.durationSeconds)}</div>
          {video.isShortsCandidate && <div style={{ position:"absolute", top:3, left:3, background:"#ff4400", borderRadius:3, padding:"1px 5px", fontSize:7, fontWeight:700, color:"#fff" }}>SHORTS</div>}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, fontWeight:600, color:"#fff", lineHeight:1.4, marginBottom:4, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{video.title}</div>
          <div style={{ fontSize:9, color:"#555", marginBottom:4 }}>{video.channelTitle} · {fmtDate(video.publishedAt)}</div>
          <div style={{ display:"flex", gap:8 }}>
            <span style={{ fontSize:9, color:"#888" }}>👁 {fmtNum(video.viewCount)}</span>
            <span style={{ fontSize:9, color:"#888" }}>👍 {fmtNum(video.likeCount)}</span>
            <span style={{ fontSize:9, color:"#888" }}>💬 {fmtNum(video.commentCount)}</span>
          </div>
        </div>
        <div style={{ flexShrink:0, textAlign:"center", minWidth:38 }}>
          <div style={{ fontSize:20, fontWeight:900, color:sc, lineHeight:1 }}>{video.productScore}</div>
          <div style={{ fontSize:9, color:sc, fontWeight:700 }}>{sGrade(video.productScore)}</div>
        </div>
      </div>
    </div>
  );
};

// 메인
export default function ShortsExplorer({ defaultApiKey="" }) {
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

  const inputStyle = { background:"#111", border:"1px solid #222", borderRadius:7, padding:"8px 10px", color:"#ccc", fontSize:11, outline:"none", width:"100%", boxSizing:"border-box" };

  const handleSearch = async () => {
    if(!apiKey.trim()){ setError("YouTube API Key를 입력해주세요."); return; }
    if(!keyword.trim()){ setError("검색 키워드를 입력해주세요."); return; }
    setLoading(true); setError(""); setResults([]); setSelected(null); setSearched(true);
    try {
      const published = new Date(Date.now()-parseInt(days)*86400000).toISOString();
      const order = sortBy==="date"?"date":"viewCount";
      const sr = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(keyword)}&type=video&maxResults=${Math.min(50,parseInt(maxRes)||20)}&order=${order}&regionCode=${region}&relevanceLanguage=${lang}&publishedAfter=${published}&videoDuration=short&key=${apiKey}`);
      const sd = await sr.json();
      if(sd.error) throw new Error(sd.error.message);
      const ids = (sd.items||[]).map(i=>i.id.videoId);
      if(!ids.length){ setResults([]); return; }
      const vr = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${ids.join(",")}&key=${apiKey}`);
      const vd = await vr.json();
      if(vd.error) throw new Error(vd.error.message);
      const videos = (vd.items||[]).map(v => {
        const dur=parseDuration(v.contentDetails?.duration);
        const title=v.snippet?.title||"",desc=v.snippet?.description||"",tags=v.snippet?.tags||[];
        const posKws=detectPos(title,desc,tags),negKws=detectNeg(title,desc,tags);
        const data = { videoId:v.id, title, channelTitle:v.snippet?.channelTitle||"", publishedAt:v.snippet?.publishedAt||"", durationSeconds:dur, viewCount:parseInt(v.statistics?.viewCount)||0, likeCount:parseInt(v.statistics?.likeCount)||0, commentCount:parseInt(v.statistics?.commentCount)||0, thumbnail:v.snippet?.thumbnails?.medium?.url||"", tags, description:desc.slice(0,300), isShortsCandidate:dur<=60||[title,desc,...tags].join(" ").toLowerCase().includes("#shorts"), detectedKeywords:posKws, detectedNegativeKeywords:negKws, url:`https://www.youtube.com/watch?v=${v.id}` };
        const { score, reasons } = calcScore(data);
        return { ...data, productScore:score, reasons };
      });
      let sorted=[...videos];
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
        <div style={{ fontSize:10, color:"#555" }}>제품 판매 가능성이 높은 쇼츠 후보 발굴 도구</div>
      </div>

      <div style={{ marginBottom:9 }}>
        <div style={{ fontSize:9, color:"#555", marginBottom:3 }}>YouTube API Key</div>
        <input value={apiKey} onChange={e=>setApiKey(e.target.value)} type="password" placeholder="AIza..." style={inputStyle} />
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 64px 64px", gap:7, marginBottom:7 }}>
        <input value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSearch()} placeholder="검색 키워드" style={inputStyle} />
        <input value={region} onChange={e=>setRegion(e.target.value)} placeholder="KR" style={{...inputStyle, textAlign:"center"}} />
        <input value={lang} onChange={e=>setLang(e.target.value)} placeholder="ko" style={{...inputStyle, textAlign:"center"}} />
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr auto", gap:7, marginBottom:12 }}>
        <div>
          <div style={{ fontSize:9, color:"#444", marginBottom:2 }}>최근 며칠</div>
          <input type="number" value={days} onChange={e=>setDays(e.target.value)} min={1} max={365} style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize:9, color:"#444", marginBottom:2 }}>최대 결과</div>
          <input type="number" value={maxRes} onChange={e=>setMaxRes(e.target.value)} min={5} max={50} style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize:9, color:"#444", marginBottom:2 }}>정렬</div>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{...inputStyle, cursor:"pointer"}}>
            <option value="score">제품성 점수순</option>
            <option value="views">조회수순</option>
            <option value="date">최신순</option>
          </select>
        </div>
        <div style={{ display:"flex", alignItems:"flex-end" }}>
          <button onClick={handleSearch} disabled={loading} style={{ padding:"8px 14px", borderRadius:7, border:"none", cursor:loading?"not-allowed":"pointer", background:loading?"#222":"linear-gradient(135deg,#ff4400,#ffd700)", color:loading?"#555":"#000", fontWeight:800, fontSize:11, display:"flex", alignItems:"center", gap:5, whiteSpace:"nowrap" }}>
            {loading?<><Spinner size={11}/> 검색 중...</>:"🔍 검색"}
          </button>
        </div>
      </div>

      {error && <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:7, padding:"8px 11px", color:"#ff8888", fontSize:11, marginBottom:10 }}>⚠️ {error}</div>}

      {searched && !loading && results.length>0 && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6, marginBottom:11 }}>
          {[
            { l:"총 검색",   v:`${results.length}개`,  c:"#ccc" },
            { l:"쇼츠 후보", v:`${shorts.length}개`,   c:"#ff8800" },
            { l:"평균 점수", v:`${avgScore}점`,         c:sColor(avgScore) },
            { l:"최고 점수", v:`${results[0]?.productScore||0}점`, c:sColor(results[0]?.productScore||0) },
          ].map((s,i)=>(
            <div key={i} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:8, padding:"7px 8px", textAlign:"center" }}>
              <div style={{ fontSize:8, color:"#555", marginBottom:2 }}>{s.l}</div>
              <div style={{ fontSize:15, fontWeight:900, color:s.c }}>{s.v}</div>
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
        <div style={{ textAlign:"center", color:"#444", fontSize:12, padding:28 }}>검색 결과가 없습니다. 키워드나 기간을 변경해보세요.</div>
      )}

      {viewMode==="card" && results.length>0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {results.map(v=><VideoCard key={v.videoId} video={v} selected={selected?.videoId===v.videoId} onClick={()=>setSelected(v)}/>)}
        </div>
      )}

      {viewMode==="table" && results.length>0 && (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10 }}>
            <thead>
              <tr style={{ borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
                {["점수","제목","채널","업로드","길이","조회수","쇼츠"].map((h,i)=>(
                  <th key={i} style={{ padding:"7px 8px", textAlign:i===0?"center":"left", color:"#555", fontWeight:600, whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map(v=>(
                <tr key={v.videoId} onClick={()=>setSelected(v)} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)", cursor:"pointer" }}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <td style={{ padding:"7px 8px", textAlign:"center" }}><span style={{ fontSize:13, fontWeight:900, color:sColor(v.productScore) }}>{v.productScore}</span></td>
                  <td style={{ padding:"7px 8px", maxWidth:180 }}><div style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:"#ccc" }}>{v.title}</div></td>
                  <td style={{ padding:"7px 8px", color:"#555", whiteSpace:"nowrap" }}>{v.channelTitle}</td>
                  <td style={{ padding:"7px 8px", color:"#555", whiteSpace:"nowrap" }}>{fmtDate(v.publishedAt)}</td>
                  <td style={{ padding:"7px 8px", color:"#555", whiteSpace:"nowrap" }}>{fmtDur(v.durationSeconds)}</td>
                  <td style={{ padding:"7px 8px", color:"#888", whiteSpace:"nowrap" }}>{fmtNum(v.viewCount)}</td>
                  <td style={{ padding:"7px 8px", textAlign:"center" }}>{v.isShortsCandidate?<span style={{ fontSize:8, padding:"1px 5px", background:"rgba(255,68,0,0.15)", color:"#ff8800", borderRadius:3 }}>✓</span>:<span style={{ color:"#333" }}>-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <DetailPanel video={selected} onClose={()=>setSelected(null)}/>}
    </div>
  );
}
