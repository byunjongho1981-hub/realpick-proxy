import { useState } from "react";
import SearchBox from "./components/SearchBox";
import ResultList from "./components/ResultList";
import { fetchYouTube } from "./api/youtube";
import { extractShoppingKeyword, fetchNaverProducts } from "./api/naver";

export default function App() {
  const [keyword, setKeyword]               = useState("");
  const [videos, setVideos]                 = useState([]);
  const [products, setProducts]             = useState([]);
  const [shoppingKeyword, setShoppingKeyword] = useState("");
  const [loadingYT, setLoadingYT]           = useState(false);
  const [loadingNV, setLoadingNV]           = useState(false);
  const [ytError, setYtError]               = useState("");
  const [nvError, setNvError]               = useState("");
  const [searched, setSearched]             = useState(false);
  const [cacheHit, setCacheHit]             = useState({ yt: false, nv: false });

  const handleSearch = async ({ keyword: kw, apiKey }) => {
    setKeyword(kw);
    setVideos([]); setProducts([]); setShoppingKeyword("");
    setYtError(""); setNvError("");
    setSearched(true); setCacheHit({ yt: false, nv: false });
    setLoadingYT(true); setLoadingNV(true);

    // Step 1: YouTube
    let ytVideos = [];
    try {
      const { videos: v, fromCache } = await fetchYouTube(kw, apiKey);
      ytVideos = v;
      setVideos(v);
      setCacheHit(p => ({ ...p, yt: fromCache }));
    } catch (e) {
      const msg = e.message || "";
      setYtError(
        msg.includes("Failed to fetch") ? "네트워크 오류: 인터넷 연결을 확인해주세요." :
        msg.includes("403")             ? "API 키 권한 없음 또는 할당량 초과." :
        msg.includes("400")             ? "API 키가 올바르지 않습니다." :
        "YouTube 오류: " + msg
      );
    } finally {
      setLoadingYT(false);
    }

    // Step 2: 쇼핑 키워드 추출
    let derivedKw = kw;
    try {
      if (ytVideos.length > 0) {
        derivedKw = await extractShoppingKeyword(kw, ytVideos.map(v => v.title));
      }
    } catch { derivedKw = kw; }
    setShoppingKeyword(derivedKw);

    // Step 3: 네이버 쇼핑
    try {
      const { products: p, fromCache } = await fetchNaverProducts(derivedKw);
      if (!Array.isArray(p) || p.length === 0) {
        setNvError("검색된 쇼핑 상품이 없습니다.");
      } else {
        setProducts(p);
        setCacheHit(prev => ({ ...prev, nv: fromCache }));
      }
    } catch (e) {
      const msg = e.message || "";
      setNvError(
        msg.includes("Failed to fetch") ? "네트워크 오류: 인터넷 연결을 확인해주세요." :
        msg.includes("파싱")            ? "상품 데이터를 불러오지 못했습니다. 다시 시도해주세요." :
        "쇼핑 오류: " + msg
      );
    } finally {
      setLoadingNV(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg,#0a0a0a 0%,#111 60%,#0d0d1a 100%)",
      padding: "30px 16px",
      fontFamily: "'Segoe UI', sans-serif",
      color: "#fff"
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* 헤더 */}
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 32, marginBottom: 4 }}>🔍</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>트렌드 & 쇼핑 통합 검색</h1>
        <p style={{ color: "#444", fontSize: 11, marginTop: 4 }}>
          YouTube 트렌드 분석 + 네이버 쇼핑 상품 추천
        </p>
      </div>

      {/* 검색창 */}
      <SearchBox onSearch={handleSearch} loading={loadingYT || loadingNV} />

      {/* 결과 */}
      {searched && (
        <div style={{ marginTop: 28 }}>
          <ResultList
            keyword={keyword}
            videos={videos}
            products={products}
            shoppingKeyword={shoppingKeyword}
            loadingYT={loadingYT}
            loadingNV={loadingNV}
            ytError={ytError}
            nvError={nvError}
            cacheHit={cacheHit}
          />
        </div>
      )}
    </div>
  );
}
