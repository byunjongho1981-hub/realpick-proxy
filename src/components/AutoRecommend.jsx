// v8.0 - 탭 라우터만 담당
import { useState } from "react";
import { runAutoRecommend } from "../api/autoRecommend";
import { groupResults, ProgressBar, ErrBox } from "./recommend/shared";
import HomeTab       from "./recommend/HomeTab";
import RealtimeTab   from "./recommend/RealtimeTab";
import StableTab     from "./recommend/StableTab";
import CategoryTab   from "./recommend/CategoryTab";
import ShortsExplorer from "./recommend/ShortsExplorer";
import SettingTab    from "./recommend/SettingTab";

const VERSION_LOG = [
  { ver:"v8.0", desc:"파일 분리 리팩토링 + 쇼츠 탐색기 통합" },
  { ver:"v7.2", desc:"Google Trends RSS 통합" },
  { ver:"v7.1", desc:"키워드 오염 필터 강화" },
  { ver:"v7.0", desc:"동적 후보 수집 / DataLab+Insight 통합" },
  { ver:"v5.0", desc:"실시간·안정 추천 분리" },
];

export default function AutoRecommend({ apiKey }) {
  const [loadingRT, setLoadingRT]     = useState(false);
  const [loadingST, setLoadingST]     = useState(false);
  const [progress, setProgress]       = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [rtResults, setRtResults]     = useState([]);
  const [stResults, setStResults]     = useState([]);
  const [rtGroups, setRtGroups]       = useState([]);
  const [stGroups, setStGroups]       = useState([]);
  const [error, setError]             = useState("");
  const [ranRT, setRanRT]             = useState(false);
  const [ranST, setRanST]             = useState(false);
  const [activeTab, setActiveTab]     = useState("home");

  const TABS = [
    { id:"home",     label:"홈",       icon:"🏠" },
    { id:"realtime", label:"실시간",   icon:"⚡" },
    { id:"stable",   label:"안정",     icon:"💰" },
    { id:"cat",      label:"카테고리", icon:"📊" },
    { id:"shorts",   label:"쇼츠탐색", icon:"🎬" },
    { id:"setting",  label:"설정",     icon:"⚙️" },
  ];

  const handleRun = async (mode) => {
    const setLoading = mode==="realtime" ? setLoadingRT : setLoadingST;
    setLoading(true); setError(""); setProgress(0); setProgressMsg("시작 중...");
    if(mode==="realtime") { setRanRT(true); setActiveTab("realtime"); }
    else                  { setRanST(true); setActiveTab("stable"); }
    try {
      const data = await runAutoRecommend(apiKey, (pct,msg)=>{ setProgress(pct); setProgressMsg(msg); }, mode);
      if(mode==="realtime"){ setRtResults(data); setRtGroups(groupResults(data)); }
      else                 { setStResults(data); setStGroups(groupResults(data)); }
    } catch(e){ setError(e.message||"분석 중 오류 발생"); }
    finally{ setLoading(false); }
  };

  const loading = loadingRT || loadingST;

  return (
    <div style={{ fontFamily:"'Segoe UI',sans-serif", color:"#fff" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} *{box-sizing:border-box}`}</style>

      {/* 탭 네비 */}
      <div style={{ display:"flex", gap:2, marginBottom:16, background:"rgba(255,255,255,0.03)", borderRadius:10, padding:3, flexWrap:"wrap", alignItems:"center" }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
            flex:1, minWidth:48, padding:"8px 4px", borderRadius:7, border:"none", fontSize:10, cursor:"pointer",
            fontWeight: activeTab===t.id ? 700 : 400,
            background: activeTab===t.id ? "rgba(255,255,255,0.1)" : "transparent",
            color: activeTab===t.id ? "#fff" : "#555",
            borderBottom: activeTab===t.id ? "2px solid #ffd700" : "2px solid transparent",
            transition:"all 0.15s", whiteSpace:"nowrap"
          }}>{t.icon} {t.label}</button>
        ))}
      </div>

      {/* 공통: 진행바 + 에러 */}
      <ProgressBar loading={loading} progress={progress} progressMsg={progressMsg} />
      {error && <ErrBox msg={error} />}

      {/* 탭 라우팅 */}
      {activeTab==="home" && (
        <HomeTab
          apiKey={apiKey}
          loadingRT={loadingRT} loadingST={loadingST}
          ranRT={ranRT} ranST={ranST}
          rtResults={rtResults} stResults={stResults}
          onRunRT={()=>handleRun("realtime")}
          onRunST={()=>handleRun("stable")}
          onTabChange={setActiveTab}
          VERSION_LOG={VERSION_LOG}
        />
      )}
      {activeTab==="realtime" && (
        <RealtimeTab loading={loadingRT} ran={ranRT} results={rtResults} onRun={()=>handleRun("realtime")} />
      )}
      {activeTab==="stable" && (
        <StableTab loading={loadingST} ran={ranST} results={stResults} onRun={()=>handleRun("stable")} />
      )}
      {activeTab==="cat" && (
        <CategoryTab ranRT={ranRT} ranST={ranST} rtGroups={rtGroups} stGroups={stGroups} onTabChange={setActiveTab} />
      )}
      {activeTab==="shorts" && (
        <ShortsExplorer defaultApiKey={apiKey||""} />
      )}
      {activeTab==="setting" && (
        <SettingTab apiKey={apiKey} VERSION_LOG={VERSION_LOG} />
      )}
    </div>
  );
}
