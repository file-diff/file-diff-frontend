import { useState, useMemo } from "react";
import { parseCsv, diffCsv } from "../utils/csvParser";
import TreeDiffView from "../components/TreeDiffView";
import { sampleCsvLeft, sampleCsvRight } from "../data/sampleData";
import "./TreeComparePage.css";

export default function TreeComparePage() {
  const [leftInput, setLeftInput] = useState(sampleCsvLeft);
  const [rightInput, setRightInput] = useState(sampleCsvRight);

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
  };

  const handleClear = () => {
    setLeftInput("");
    setRightInput("");
  };

  return (
    <div className="tree-compare-page">
      <div className="page-header">
        <h1>📂 Directory Comparison</h1>
        <p className="page-subtitle">
          Paste CSV data to compare two directory structures side by side.
          Format: <code>type;path;size;timestamp;hash</code>
        </p>
      </div>

      <div className="sample-buttons">
        <button onClick={loadSample}>Load Sample</button>
        <button onClick={handleClear}>Clear</button>
      </div>

      <div className="input-panels">
        <div className="input-panel">
          <label htmlFor="left-csv">Left (original)</label>
          <textarea
            id="left-csv"
            value={leftInput}
            onChange={(e) => setLeftInput(e.target.value)}
            placeholder="Paste CSV data here..."
            spellCheck={false}
          />
        </div>
        <div className="input-panel">
          <label htmlFor="right-csv">Right (modified)</label>
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
            leftLabel="Original"
            rightLabel="Modified"
          />
        </div>
      )}
    </div>
  );
}
