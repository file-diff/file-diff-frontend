import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useLocation,
} from "react-router-dom";
import TreeComparePage from "./pages/TreeComparePage";
import TreeComparePage2 from "./pages/TreeComparePage2";
import FileComparePage from "./pages/FileComparePage";
import HealthCheckPage from "./pages/HealthCheckPage";
import HistoryPage from "./pages/HistoryPage";
import TokenizePage from "./pages/TokenizePage";
import FontSelector from "./components/FontSelector";
import { DEFAULT_FONT_ID } from "./config/fonts";
import { applyFont } from "./utils/fontInit";
import { clearAllStoredData } from "./utils/storage";
import "./App.css";

function AppShell() {
  const buildVersion = import.meta.env.VITE_BUILD_VERSION?.trim();
  const gitCommit = import.meta.env.VITE_GIT_COMMIT?.trim();
  const location = useLocation();
  const buildLabel = [buildVersion, gitCommit && `(${gitCommit})`]
    .filter(Boolean)
    .join(" ");

  const handleClearAll = () => {
    clearAllStoredData();
    applyFont(DEFAULT_FONT_ID);
    window.location.replace(
      location.pathname === "/" ? "/?clear=1" : location.pathname
    );
  };

  return (
    <>
      <nav className="app-nav">
        <div className="nav-brand-group">
          <div className="nav-brand">Git Diff Online</div>
          {buildLabel && (
            <div className="nav-build-version">Build version: {buildLabel}</div>
          )}
        </div>
        <div className="nav-links">
          <Link to="/" className="nav-link">
            📂 Directory Compare
          </Link>
          <Link to="/files" className="nav-link">
            📄 File Compare
          </Link>
          <Link to="/history" className="nav-link">
            📜 History
          </Link>
          <Link to="/tokenize" className="nav-link">
            🎨 Tokenize
          </Link>
          <Link to="/health" className="nav-link">
            🩺 Backend Check
          </Link>
          <button type="button" className="nav-clear-button" onClick={handleClearAll}>
            Clear all
          </button>
          <FontSelector />
        </div>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<TreeComparePage />} />
          <Route path="/compare2" element={<TreeComparePage2 />} />
          <Route path="/files" element={<FileComparePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/tokenize" element={<TokenizePage />} />
          <Route path="/health" element={<HealthCheckPage />} />
        </Routes>
      </main>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
