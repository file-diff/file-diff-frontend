import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useLocation,
} from "react-router-dom";
import TreeComparePage from "./pages/TreeComparePage";
import TreeCompare2Page from "./pages/TreeCompare2Page";
import FileComparePage from "./pages/FileComparePage";
import HealthCheckPage from "./pages/HealthCheckPage";
import HistoryPage from "./pages/HistoryPage";
import TokenizePage from "./pages/TokenizePage";
import GrepPage from "./pages/GrepPage";
import RepositoryBrowserPage from "./pages/RepositoryBrowserPage";
import BranchesPage from "./pages/BranchesPage";
import OrganizationBrowserPage from "./pages/OrganizationBrowserPage";
import CreateTaskPage from "./pages/CreateTaskPage";
import AgentTaskInfoPage from "./pages/AgentTaskInfoPage";
import RepositoryViewPage from "./pages/RepositoryViewPage";
import FontSelector from "./components/FontSelector";
import { DEFAULT_FONT_ID } from "./config/fonts";
import { applyFont } from "./utils/fontInit";
import { clearAllStoredData } from "./utils/storage";
import "./App.css";

function AppShell() {
  const buildVersion = import.meta.env.VITE_BUILD_VERSION?.trim();
  const gitCommit = import.meta.env.VITE_GIT_COMMIT?.trim();
  const location = useLocation();
  const isTreeCompare2Route = location.pathname === "/tree";
  const buildLabel = [buildVersion, gitCommit && `(${gitCommit})`]
    .filter(Boolean)
    .join(" ");

  const handleClearAll = async () => {
    await clearAllStoredData();
    applyFont(DEFAULT_FONT_ID);
    window.location.replace(
      location.pathname === "/" ? "/?clear=1" : location.pathname
    );
  };

  return (
    <div className={`app-shell${isTreeCompare2Route ? " app-shell--tree-compare2" : ""}`}>
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
          <Link to="/commits" className="nav-link">
            🔀 Commits
          </Link>
          <Link to="/repository" className="nav-link">
            🗂️ Repository
          </Link>
          <Link to="/branches" className="nav-link">
            🌿 Branches
          </Link>
          <Link to="/browse" className="nav-link">
            🏢 Browse Org
          </Link>
          <Link to="/create-task" className="nav-link">
            🤖 Create Task
          </Link>
          <Link to="/agent-tasks" className="nav-link">
            📋 Agent Tasks
          </Link>
          <Link to="/tokenize" className="nav-link">
            🎨 Tokenize
          </Link>
          <Link to="/grep" className="nav-link">
            🔎 Grep
          </Link>
          <Link to="/health" className="nav-link">
            🩺 Backend Check
          </Link>
          <a href="/ssr-health" className="nav-link">
            🖥️ SSR Health
          </a>
          <button type="button" className="nav-clear-button" onClick={handleClearAll}>
            Clear all
          </button>
          <FontSelector />
        </div>
      </nav>
      <main className={`app-main${isTreeCompare2Route ? " app-main--tree-compare2" : ""}`}>
        <Routes>
          <Route path="/" element={<TreeComparePage />} />
          <Route path="/tree" element={<TreeCompare2Page />} />
          <Route path="/files" element={<FileComparePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/commits" element={<RepositoryBrowserPage />} />
          <Route path="/repository" element={<RepositoryViewPage />} />
          <Route path="/branches" element={<BranchesPage />} />
          <Route path="/browse" element={<OrganizationBrowserPage />} />
          <Route path="/create-task" element={<CreateTaskPage />} />
          <Route path="/agent-tasks" element={<AgentTaskInfoPage />} />
          <Route path="/tokenize" element={<TokenizePage />} />
          <Route path="/grep" element={<GrepPage />} />
          <Route path="/health" element={<HealthCheckPage />} />
        </Routes>
      </main>
    </div>
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
