import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import TreeComparePage from "./pages/TreeComparePage";
import FileComparePage from "./pages/FileComparePage";
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
        </div>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<TreeComparePage />} />
          <Route path="/files" element={<FileComparePage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

export default App;
