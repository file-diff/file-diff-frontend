import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import TreeComparePage from "./pages/TreeComparePage";
import FileComparePage from "./pages/FileComparePage";
import HealthCheckPage from "./pages/HealthCheckPage";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <nav className="app-nav">
        <div className="nav-brand">Git Diff Online</div>
        <div className="nav-links">
          <Link to="/" className="nav-link">
            📂 Directory Compare
          </Link>
          <Link to="/files" className="nav-link">
            📄 File Compare
          </Link>
          <Link to="/health" className="nav-link">
            🩺 Backend Check
          </Link>
        </div>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<TreeComparePage />} />
          <Route path="/files" element={<FileComparePage />} />
          <Route path="/health" element={<HealthCheckPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

export default App;
