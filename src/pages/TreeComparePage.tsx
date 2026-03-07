import { useState, useMemo } from "react";
import { parseCsv, diffCsv, jobFilesResponseToCsv } from "../utils/csvParser";
import TreeDiffView from "../components/TreeDiffView";
import { sampleCsvLeft, sampleCsvRight } from "../data/sampleData";
import "./TreeComparePage.css";

export default function TreeComparePage() {
  const [leftInput, setLeftInput] = useState(sampleCsvLeft);
  const [rightInput, setRightInput] = useState(sampleCsvRight);
  const [leftEndpoint, setLeftEndpoint] = useState("");
  const [rightEndpoint, setRightEndpoint] = useState("");
  const [leftLabel, setLeftLabel] = useState("Left");
  const [rightLabel, setRightLabel] = useState("Right");
  const [apiError, setApiError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const diff = useMemo(() => {
    try {
      const leftEntries = parseCsv(leftInput);
      const rightEntries = parseCsv(rightInput);
      return diffCsv(leftEntries, rightEntries);
    } catch {
      return null;
    }
  }, [leftInput, rightInput]);

  const loadSample = () => {
    setLeftInput(sampleCsvLeft);
    setRightInput(sampleCsvRight);
    setLeftEndpoint("");
    setRightEndpoint("");
    setLeftLabel("Left");
    setRightLabel("Right");
    setApiError("");
  };

  const handleClear = () => {
    setLeftInput("");
    setRightInput("");
    setLeftEndpoint("");
    setRightEndpoint("");
    setApiError("");
    setLeftLabel("Left");
    setRightLabel("Right");
  };

  const handleLoadFromApi = async () => {
    const leftUrl = leftEndpoint.trim();
    const rightUrl = rightEndpoint.trim();

    if (!leftUrl || !rightUrl) {
      setApiError("Enter both left and right API endpoints.");
      return;
    }

    setIsLoading(true);
    setApiError("");

    try {
      const [leftResponse, rightResponse] = await Promise.all([
        fetch(leftUrl),
        fetch(rightUrl),
      ]);

      if (!leftResponse.ok || !rightResponse.ok) {
        throw new Error("Failed to load one or both endpoints.");
      }

      const [leftData, rightData] = await Promise.all([
        leftResponse.json(),
        rightResponse.json(),
      ]);

      setLeftInput(jobFilesResponseToCsv(leftData));
      setRightInput(jobFilesResponseToCsv(rightData));
      setLeftLabel(leftData.job_id ? `Left (${leftData.job_id})` : "Left");
      setRightLabel(rightData.job_id ? `Right (${rightData.job_id})` : "Right");
    } catch {
      setApiError("Unable to load job file lists from the provided endpoints.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="tree-compare-page">
      <div className="page-header">
        <h1>📂 Directory Comparison</h1>
        <p className="page-subtitle">
          Paste CSV data or load two job file endpoints to compare directory
          structures side by side. Format:{" "}
          <code>type;path;size;timestamp;hash</code>
        </p>
      </div>

      <div className="sample-buttons">
        <button onClick={handleLoadFromApi} disabled={isLoading}>
          {isLoading ? "Loading..." : "Load from API"}
        </button>
        <button onClick={loadSample}>Load Sample</button>
        <button onClick={handleClear}>Clear</button>
      </div>

      {apiError && <div className="api-error">{apiError}</div>}

      <div className="input-panels">
        <div className="input-panel">
          <label htmlFor="left-endpoint">Left API endpoint</label>
          <input
            id="left-endpoint"
            type="url"
            value={leftEndpoint}
            onChange={(e) => setLeftEndpoint(e.target.value)}
            placeholder="http://localhost:12986/api/jobs/<left-job-id>/files"
            spellCheck={false}
          />
          <label htmlFor="left-csv">Left</label>
          <textarea
            id="left-csv"
            value={leftInput}
            onChange={(e) => setLeftInput(e.target.value)}
            placeholder="Paste CSV data here..."
            spellCheck={false}
          />
        </div>
        <div className="input-panel">
          <label htmlFor="right-endpoint">Right API endpoint</label>
          <input
            id="right-endpoint"
            type="url"
            value={rightEndpoint}
            onChange={(e) => setRightEndpoint(e.target.value)}
            placeholder="http://localhost:12986/api/jobs/<right-job-id>/files"
            spellCheck={false}
          />
          <label htmlFor="right-csv">Right</label>
          <textarea
            id="right-csv"
            value={rightInput}
            onChange={(e) => setRightInput(e.target.value)}
            placeholder="Paste CSV data here..."
            spellCheck={false}
          />
        </div>
      </div>

      {diff && (
        <div className="diff-result">
          <h2>Comparison Result</h2>
          <div className="diff-legend">
            <span className="legend-item legend-item--same">● Same</span>
            <span className="legend-item legend-item--added">● Added</span>
            <span className="legend-item legend-item--removed">● Removed</span>
            <span className="legend-item legend-item--modified">
              ● Modified
            </span>
          </div>
          <TreeDiffView
            left={diff.left}
            right={diff.right}
            leftLabel={leftLabel}
            rightLabel={rightLabel}
          />
        </div>
      )}
    </div>
  );
}
