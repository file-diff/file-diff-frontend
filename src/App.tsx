import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import TreeComparePage from "./pages/TreeComparePage";
import FileComparePage from "./pages/FileComparePage";
import HealthCheckPage from "./pages/HealthCheckPage";
import HistoryPage from "./pages/HistoryPage";
import TokenizePage from "./pages/TokenizePage";
import FontSelector from "./components/FontSelector";
import "./App.css";

function App() {
  const buildVersion = import.meta.env.VITE_BUILD_VERSION?.trim();
  const gitCommit = import.meta.env.VITE_GIT_COMMIT?.trim();
  const buildLabel = [buildVersion, gitCommit && `(${gitCommit})`]
    .filter(Boolean)
    .join(" ");

  return (
    <BrowserRouter>
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
          <FontSelector />
        </div>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<TreeComparePage />} />
          <Route path="/files" element={<FileComparePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/tokenize" element={<TokenizePage />} />
          <Route path="/health" element={<HealthCheckPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

export default App;
