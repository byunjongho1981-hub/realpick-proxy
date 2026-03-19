import { useState } from "react";

const Spinner = ({ color }) => (
  <div style={{ display: "inline-block", width: 22, height: 22, border: `3px solid ${color}33`, borderTopColor: color, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
);

export default function SearchBox({ onSearch, loading }) {
  const [apiKey, setApiKey]   = useState("");
  const [keyword, setKeyword] = useState("");
  const [showKey, setShowKey] = useState(false);

  const handleSearch = () => {
    if (!keyword.trim() || !apiKey.trim()) return;
    onSearch({ keyword, apiKey });
  };

  return (
    <div style={{ maxWidth: 700, margin: "0 auto" }}>
      {/* API Key */}
      <div style={{ background: "rgba(255,68,68,0.05)", border: "1px solid rgba(255,68,68,0.15)", borderRadius: 11, padding: 13, marginBottom: 11 }}>
        <div style={{ fontSize: 11, color: "#ff8888", marginBottom: 7, fontWeight: 600 }}>🔑 YouTube Data API v3 Key</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="AIza..."
            style={{ flex: 1, padding: "10px 13px", fontSize: 13, borderRadius: 8, border: "1.5px solid #2a2a2a", background: "#1a1a1a", color: "#fff", outline: "none" }}
          />
          <button onClick={() => setShowKey(p => !p)} style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #333", background: "#1e1e1e", color: "#aaa", cursor: "pointer" }}>
            {showKey ? "🙈" : "👁"}
          </button>
        </div>
        <div style={{ fontSize: 10, color: "#444", marginTop: 5 }}>
          네이버 쇼핑은 Claude 웹서치 자동 연동 (별도 키 불필요)
        </div>
      </div>

      {/* Search */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSearch()}
          placeholder="키워드 입력 (예: 무선이어폰, 공기청정기...)"
          style={{ flex: 1, padding: "12px 15px", fontSize: 14, borderRadius: 10, border: "1.5px solid #2a2a2a", background: "#1a1a1a", color: "#fff", outline: "none" }}
          onFocus={e => e.target.style.borderColor = "#ff4444"}
          onBlur={e => e.target.style.borderColor = "#2a2a2a"}
        />
        <button
          onClick={handleSearch}
          disabled={loading || !keyword.trim() || !apiKey.trim()}
          style={{ padding: "12px 20px", borderRadius: 10, border: "none", background: loading ? "#333" : "linear-gradient(135deg,#ff2222,#aa0000)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: loading ? "not-allowed" : "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 8 }}
        >
          {loading ? <><Spinner color="#fff" /> 검색 중...</> : "🔍 검색"}
        </button>
      </div>
    </div>
  );
}
