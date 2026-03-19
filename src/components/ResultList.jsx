import { useState } from "react";
import { scoreColor, scoreBg, scoreLabel } from "../utils/score.js";
import { sortVideos, filterProducts } from "../utils/filter.js";

const fmt      = n => { if (!n) return "-"; const x = parseInt(n); if (x >= 100000000) return (x/100000000).toFixed(1)+"억"; if (x >= 10000) return Math.floor(x/10000)+"만"; if (x >= 1000) return (x/1000).toFixed(1)+"천"; return x.toLocaleString(); };
const fmtDate  = iso => { if (!iso) return "-"; const d = new Date(iso); return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}`; };
const dayAgo   = iso => { if (!iso) return ""; const d = Math.floor((Date.now()-new Date(iso))/86400000); if (d===0) return "오늘"; if (d<7) return `${d}일 전`; if (d<30) return `${Math.floor(d/7)}주 전`; if (d<365) return `${Math.floor(d/30)}개월 전`; return `${Math.floor(d/365)}년 전`; };
const fmtPrice = n => n ? parseInt(n).toLocaleString()+"원" : "-";

const Spinner = ({ color }) => (
  <div style={{ display:"inline-block", width:26, height:26, border:`3px solid ${color}33`, borderTopColor:color, borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
);

const ScoreBar = ({ score }) => (
  <div style={{ marginTop:8 }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
      <span style={{ fontSize:10, color:"#555" }}>트렌드 점수</span>
      <span style={{ fontSize:12, fontWeight:800, color:scoreColor(score) }}>{scoreLabel(score)} {score}점</span>
    </div>
    <div style={{ height:4, background:"#1e1e1e", borderRadius:99 }}>
      <div style={{ height:"100%", borderRadius:99, width:`${score}%`, background:`linear-gradient(90deg,${scoreColor(score)}88,${scoreColor(score)})`, transition:"width 0.5s" }} />
    </div>
  </div>
);

export default function ResultList({ keyword, videos, products, shoppingKeyword, loadingYT, loadingNV, ytError, nvError, cacheHit }) {
  const [sortBy, setSortBy]         = useState("trend");
  const [tab, setTab]               = useState("both");
  const [priceMin, setPriceMin]     = useState("");
  const [priceMax, setPriceMax]     = useState("");
  const [minReviews, setMinReviews] = useState("");
  const [excludeAds, setExcludeAds] = useState(false);

  const sorted           = sortVideos(videos, sortBy);
  const filteredProducts = filterProducts(products, { priceMin, priceMax, minReviews, excludeAds });

  const SortBtn = ({ val, label }) => (
    <button onClick={() => setSortBy(val)} style={{ padding:"6px 12px", borderRadius:7, border:"none", fontSize:11, cursor:"pointer", fontWeight:sortBy===val?700:400, background:sortBy===val?"rgba(255,68,68,0.2)":"rgba(255,255,255,0.04)", color:sortBy===val?"#ff6666":"#666" }}>{label}</button>
  );
  const TabBtn = ({ val, label, loading: l }) => (
    <button onClick={() => setTab(val)} style={{ padding:"9px 18px", borderRadius:9, border:"none", fontSize:13, cursor:"pointer", fontWeight:tab===val?700:400, background:tab===val?"rgba(255,255,255,0.1)":"transparent", color:tab===val?"#fff":"#555" }}>
      {label}{l && <span style={{ marginLeft:5, fontSize:10, color:"#ff8888" }}>로딩중</span>}
    </button>
  );

  return (
    <div style={{ maxWidth:700, margin:"0 auto" }}>
      {/* 에러 */}
      {ytError && (tab==="both"||tab==="youtube") && (
        <div style={{ background:"#1e0a0a", border:"1px solid #ff4444", borderRadius:9, padding:"11px 15px", color:"#ff8888", fontSize:13, marginBottom:16 }}>
          📺 YouTube 오류: {ytError}
        </div>
      )}
      {nvError && (tab==="both"||tab==="naver") && (
        <div style={{ background:"#0a1a0f", border:"1px solid rgba(3,199,90,0.3)", borderRadius:9, padding:"11px 15px", color:"#4a9a6a", fontSize:13, marginBottom:16 }}>
          🛍 쇼핑 알림: {nvError}
        </div>
      )}

      {/* 탭 */}
      <div style={{ display:"flex", gap:4, marginBottom:18, background:"rgba(255,255,255,0.03)", borderRadius:11, padding:4, width:"fit-content" }}>
        <TabBtn val="both"    label="전체"           loading={false} />
        <TabBtn val="youtube" label="📺 YouTube"     loading={loadingYT} />
        <TabBtn val="naver"   label="🛍 네이버 쇼핑" loading={loadingNV} />
      </div>

      {/* ── YouTube ── */}
      {(tab==="both"||tab==="youtube") && (
        <div style={{ marginBottom:28 }}>
          {tab==="both" && (
            <div style={{ fontSize:13, fontWeight:700, color:"#aaa", marginBottom:12 }}>
              📺 YouTube 트렌드
              {loadingYT && <span style={{ marginLeft:8, fontSize:11, color:"#ff8888" }}>분석 중...</span>}
            </div>
          )}
          {loadingYT && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12, padding:30, color:"#666", fontSize:13 }}>
              <Spinner color="#ff4444" /><span>유튜브 데이터 가져오는 중...</span>
            </div>
          )}
          {!loadingYT && videos.length > 0 && (
            <>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <span style={{ color:"#444", fontSize:11 }}>
                  <b style={{ color:"#ff4444" }}>"{keyword}"</b> {videos.length}개
                  {cacheHit?.yt && <span style={{ marginLeft:8, color:"#ffaa00", fontSize:10 }}>⚡ 캐시</span>}
                </span>
                <div style={{ display:"flex", gap:5 }}>
                  <SortBtn val="trend" label="🔥 트렌드순" />
                  <SortBtn val="views" label="👁 조회수순" />
                  <SortBtn val="date"  label="📅 최신순" />
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:9 }}>
                {sorted.map((v, i) => (
                  <div key={v.id} onClick={() => window.open(v.url, "_blank")}
                    style={{ background:i===0&&sortBy==="trend"?"rgba(255,34,34,0.07)":"rgba(255,255,255,0.03)", border:i===0&&sortBy==="trend"?"1px solid rgba(255,34,34,0.25)":"1px solid rgba(255,255,255,0.06)", borderRadius:13, padding:13, cursor:"pointer", display:"flex", gap:11, alignItems:"flex-start" }}
                    onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,0.07)"}
                    onMouseLeave={e => e.currentTarget.style.background=i===0&&sortBy==="trend"?"rgba(255,34,34,0.07)":"rgba(255,255,255,0.03)"}>
                    <div style={{ position:"relative", flexShrink:0 }}>
                      <img src={v.thumbnail} alt="" style={{ width:112, height:63, objectFit:"cover", borderRadius:7, display:"block" }} />
                      <div style={{ position:"absolute", top:4, left:4, background:i<3?"linear-gradient(135deg,#ff2222,#880000)":"rgba(0,0,0,0.7)", borderRadius:4, padding:"1px 5px", fontSize:10, fontWeight:800 }}>#{i+1}</div>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:700, fontSize:13, lineHeight:1.4, marginBottom:4, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{v.title}</div>
                      <div style={{ fontSize:11, color:"#ff8888", marginBottom:5 }}>📢 {v.channel}</div>
                      <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                        <span style={{ fontSize:11, color:"#aaa" }}>👁 <b style={{ color:"#fff" }}>{fmt(v.viewCount)}</b></span>
                        <span style={{ fontSize:11, color:"#aaa" }}>👍 {fmt(v.likeCount)}</span>
                        <span style={{ fontSize:11, color:"#aaa" }}>💬 {fmt(v.commentCount)}</span>
                        <span style={{ fontSize:11, color:"#555" }}>📅 {fmtDate(v.publishedAt)} ({dayAgo(v.publishedAt)})</span>
                      </div>
                      <ScoreBar score={v.trendScore} />
                    </div>
                    <div style={{ flexShrink:0, width:48, height:48, borderRadius:10, background:scoreBg(v.trendScore), border:`1.5px solid ${scoreColor(v.trendScore)}44`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
                      <div style={{ fontSize:16, fontWeight:900, color:scoreColor(v.trendScore), lineHeight:1 }}>{v.trendScore}</div>
                      <div style={{ fontSize:9, color:scoreColor(v.trendScore), opacity:.7 }}>점</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {!loadingYT && !ytError && videos.length===0 && (
            <div style={{ textAlign:"center", color:"#333", fontSize:13, padding:24 }}>48시간 이내 영상이 없습니다.</div>
          )}
        </div>
      )}

      {/* ── 네이버 쇼핑 ── */}
      {(tab==="both"||tab==="naver") && (
        <div>
          {tab==="both" && (
            <div style={{ fontSize:13, fontWeight:700, color:"#aaa", marginBottom:12 }}>
              🛍 네이버 쇼핑 추천
              {loadingNV && <span style={{ marginLeft:8, fontSize:11, color:"#03c75a" }}>검색 중...</span>}
            </div>
          )}
          {shoppingKeyword && shoppingKeyword !== "(캐시)" && !loadingNV && (
            <div style={{ marginBottom:12, padding:"7px 12px", background:"rgba(3,199,90,0.06)", border:"1px solid rgba(3,199,90,0.2)", borderRadius:8, fontSize:12, color:"#4a9a6a", display:"flex", alignItems:"center", gap:6 }}>
              🔑 추출된 쇼핑 키워드: <b style={{ color:"#03c75a" }}>{shoppingKeyword}</b>
              {shoppingKeyword !== keyword && <span style={{ color:"#2a5a3a", fontSize:11 }}>(원본: {keyword})</span>}
              {cacheHit?.nv && <span style={{ marginLeft:"auto", color:"#ffaa00", fontSize:10 }}>⚡ 캐시</span>}
            </div>
          )}
          {loadingNV && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12, padding:24, color:"#555", fontSize:13 }}>
              <Spinner color="#03c75a" /><span>네이버 쇼핑 상품 검색 중...</span>
            </div>
          )}
          {!loadingNV && products.length > 0 && (
            <>
              {/* 필터 */}
              <div style={{ marginBottom:14, padding:"12px 14px", background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:11 }}>
                <div style={{ fontSize:11, color:"#666", marginBottom:10, fontWeight:600 }}>🎛 필터</div>
                <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <input value={priceMin} onChange={e => setPriceMin(e.target.value.replace(/\D/g,""))} placeholder="최소 금액"
                      style={{ width:90, padding:"6px 9px", fontSize:12, borderRadius:7, border:"1px solid #2a2a2a", background:"#1a1a1a", color:"#fff", outline:"none" }} />
                    <span style={{ color:"#444", fontSize:12 }}>~</span>
                    <input value={priceMax} onChange={e => setPriceMax(e.target.value.replace(/\D/g,""))} placeholder="최대 금액"
                      style={{ width:90, padding:"6px 9px", fontSize:12, borderRadius:7, border:"1px solid #2a2a2a", background:"#1a1a1a", color:"#fff", outline:"none" }} />
                    <span style={{ color:"#555", fontSize:11 }}>원</span>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ fontSize:11, color:"#666" }}>리뷰</span>
                    <input value={minReviews} onChange={e => setMinReviews(e.target.value.replace(/\D/g,""))} placeholder="최소"
                      style={{ width:70, padding:"6px 9px", fontSize:12, borderRadius:7, border:"1px solid #2a2a2a", background:"#1a1a1a", color:"#fff", outline:"none" }} />
                    <span style={{ fontSize:11, color:"#555" }}>개 이상</span>
                  </div>
                  <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", userSelect:"none" }}>
                    <div onClick={() => setExcludeAds(p => !p)} style={{ width:32, height:18, borderRadius:9, background:excludeAds?"#ff4444":"#2a2a2a", position:"relative", transition:"background 0.2s", cursor:"pointer" }}>
                      <div style={{ position:"absolute", top:2, left:excludeAds?14:2, width:14, height:14, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
                    </div>
                    <span style={{ fontSize:11, color:excludeAds?"#ff8888":"#666" }}>광고 제외</span>
                  </label>
                  {(priceMin||priceMax||minReviews||excludeAds) && (
                    <button onClick={() => { setPriceMin(""); setPriceMax(""); setMinReviews(""); setExcludeAds(false); }}
                      style={{ padding:"5px 10px", borderRadius:7, border:"1px solid #333", background:"transparent", color:"#666", fontSize:11, cursor:"pointer" }}>초기화</button>
                  )}
                </div>
                <div style={{ marginTop:8, fontSize:11, color:"#555" }}>
                  {products.length}개 중 <b style={{ color:"#fff" }}>{filteredProducts.length}개</b> 표시
                  {filteredProducts.length < products.length && <span style={{ color:"#ff8888", marginLeft:6 }}>{products.length - filteredProducts.length}개 필터됨</span>}
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {filteredProducts.map((p, i) => (
                  <div key={i} onClick={() => p.url && window.open(p.url, "_blank")}
                    style={{ background:"rgba(3,199,90,0.04)", border:"1px solid rgba(3,199,90,0.15)", borderRadius:13, padding:14, cursor:p.url?"pointer":"default" }}
                    onMouseEnter={e => e.currentTarget.style.background="rgba(3,199,90,0.09)"}
                    onMouseLeave={e => e.currentTarget.style.background="rgba(3,199,90,0.04)"}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                      <div style={{ fontSize:10, color:"#03c75a", fontWeight:700 }}>추천 #{i+1}</div>
                      {p.url && <div style={{ fontSize:12, color:"#555" }}>↗</div>}
                    </div>
                    <div style={{ fontWeight:700, fontSize:13, lineHeight:1.4, marginBottom:7, overflow:"hidden", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{p.name}</div>
                    <div style={{ fontSize:16, fontWeight:900, color:"#03c75a", marginBottom:6 }}>{fmtPrice(p.price)}</div>
                    <div style={{ fontSize:11, color:"#666", marginBottom:4 }}>
                      🏪 {p.mall}
                      {p.isAd && <span style={{ marginLeft:6, fontSize:10, color:"#ff6644", border:"1px solid #ff664466", borderRadius:4, padding:"1px 4px" }}>광고</span>}
                    </div>
                    {(p.rating||p.reviewCount) && (
                      <div style={{ fontSize:11, color:"#888", marginBottom:6 }}>⭐ {p.rating} &nbsp;💬 리뷰 {fmt(p.reviewCount)}개</div>
                    )}
                    <div style={{ fontSize:11, color:"#4a9a6a", lineHeight:1.4, padding:"6px 9px", background:"rgba(3,199,90,0.06)", borderRadius:7 }}>💡 {p.reason}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          {!loadingNV && filteredProducts.length===0 && products.length>0 && (
            <div style={{ textAlign:"center", color:"#555", fontSize:13, padding:24 }}>필터 조건에 맞는 상품이 없습니다.</div>
          )}
          {!loadingNV && products.length===0 && !nvError && (
            <div style={{ textAlign:"center", color:"#333", fontSize:13, padding:24 }}>쇼핑 결과를 가져오지 못했습니다.</div>
          )}
        </div>
      )}
    </div>
  );
}
