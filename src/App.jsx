import AutoRecommend from "./components/AutoRecommend";

const ytApiKey = import.meta.env.VITE_YOUTUBE_API_KEY;

export default function App() {
  return (
    <div style={{ minHeight:"100vh", background:"#0c0c0f", fontFamily:"'Segoe UI',sans-serif", color:"#fff" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} *{box-sizing:border-box} ::-webkit-scrollbar{width:4px;height:4px} ::-webkit-scrollbar-track{background:#111} ::-webkit-scrollbar-thumb{background:#2a2a2a;border-radius:4px}`}</style>

      {/* 헤더 */}
      <div style={{ background:"rgba(255,255,255,0.025)", borderBottom:"1px solid rgba(255,255,255,0.06)", padding:"12px 24px", position:"sticky", top:0, zIndex:50, backdropFilter:"blur(12px)" }}>
        <div style={{ maxWidth:1200, margin:"0 auto" }}>
          <div style={{ fontSize:15, fontWeight:800 }}>📦 트렌드 레이더</div>
          <div style={{ fontSize:10, color:"#444", marginTop:1 }}>YouTube · 네이버 · Google Trends 실시간 분석</div>
        </div>
      </div>

      {/* 메인 */}
      <div style={{ maxWidth:1200, margin:"0 auto", padding:"18px 24px 60px" }}>
        <AutoRecommend apiKey={ytApiKey} />
      </div>
    </div>
  );
}
