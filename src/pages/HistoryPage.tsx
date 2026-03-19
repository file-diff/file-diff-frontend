import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  buildHistoryEntryPermalink,
  readIndexingHistory,
  clearIndexingHistory,
  writeIndexingHistory,
} from "../utils/storage";
import type { IndexingHistoryEntry, StoredIndexingSideParams } from "../utils/storage";
import "./HistoryPage.css";

function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleString();
  } catch {
    return isoDate;
  }
}

function summarizeSide(side: StoredIndexingSideParams): string {
  const parts: string[] = [];

  if (side.repo) {
    parts.push(side.repo);
  }

  if (side.inputRefName) {
    parts.push(`@${side.inputRefName}`);
  }

  if (side.root && side.root !== "/") {
    parts.push(side.root);
  }

  return parts.join(" ") || "—";
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState(readIndexingHistory);

  const handleSelect = (entry: IndexingHistoryEntry) => {
    navigate(buildHistoryEntryPermalink(entry));
  };

  const handleClearHistory = () => {
    clearIndexingHistory();
    setEntries([]);
  };

  const handleRemoveEntry = (id: string) => {
    const updated = entries.filter((entry) => entry.id !== id);
    setEntries(updated);
    writeIndexingHistory(updated);
  };

  const displayEntries = [...entries].reverse();

  return (
    <div className="history-page">
      <div className="page-header">
        <h1>📜 Diff History</h1>
        <p className="page-subtitle">
          Browse your previous directory comparisons. Select any entry to
          restore its parameters on the compare page.
        </p>
      </div>

      <div className="history-actions">
        <button
          type="button"
          onClick={handleClearHistory}
          disabled={entries.length === 0}
        >
          Clear all history
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="history-empty">
          <div className="history-empty__icon">📭</div>
          <h2>No history yet</h2>
          <p>
            Start a directory comparison to see entries here. History is saved
            automatically when you run an indexing job.
          </p>
          <Link to="/" className="back-link">
            ← Back to Directory Compare
          </Link>
        </div>
      ) : (
        <div className="history-list">
          {displayEntries.map((entry) => {
            const permalink = buildHistoryEntryPermalink(entry);

            return (
              <div key={entry.id} className="history-entry">
                <div className="history-entry__header">
                  <span className="history-entry__date">
                    {formatDate(entry.storedAt)}
                  </span>
                  <span className="history-entry__side-badge">
                    Started: {entry.startedSide}
                  </span>
                  {entry.useDifferentRoots && (
                    <span className="history-entry__sort-badge">
                      Different roots
                    </span>
                  )}
                  {entry.useNaturalSort && (
                    <span className="history-entry__sort-badge">Natural sort</span>
                  )}
                </div>
                <div className="history-entry__sides">
                  <div className="history-entry__side">
                    <span className="history-entry__side-label">Left</span>
                    <span className="history-entry__side-summary">
                      {summarizeSide(entry.left)}
                    </span>
                    {entry.left.status && (
                      <span className="history-entry__status">
                        {entry.left.status}
                      </span>
                    )}
                  </div>
                  <div className="history-entry__side">
                    <span className="history-entry__side-label">Right</span>
                    <span className="history-entry__side-summary">
                      {summarizeSide(entry.right)}
                    </span>
                    {entry.right.status && (
                      <span className="history-entry__status">
                        {entry.right.status}
                      </span>
                    )}
                  </div>
                </div>
                <div className="history-entry__permalink">
                  <span className="history-entry__permalink-label">Permalink</span>
                  <a className="history-entry__permalink-link" href={permalink}>
                    {permalink}
                  </a>
                </div>
                <div className="history-entry__actions">
                  <button
                    type="button"
                    className="history-entry__select-btn"
                    onClick={() => handleSelect(entry)}
                  >
                    Open comparison
                  </button>
                  <button
                    type="button"
                    className="history-entry__remove-btn"
                    onClick={() => handleRemoveEntry(entry.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
