import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import "./FileComparePage.css";

interface LineSlot {
  lineNumber: number;
  leftText: string | null;
  rightText: string | null;
  isEqual: boolean;
}

function buildLineSlots(leftLines: string[], rightLines: string[]): LineSlot[] {
  const maxLen = Math.max(leftLines.length, rightLines.length);
  const slots: LineSlot[] = [];

  for (let i = 0; i < maxLen; i++) {
    const leftText = i < leftLines.length ? leftLines[i] : null;
    const rightText = i < rightLines.length ? rightLines[i] : null;
    const isEqual = leftText === rightText;
    slots.push({ lineNumber: i + 1, leftText, rightText, isEqual });
  }

  return slots;
}

function LineRow({ slot }: { slot: LineSlot }) {
  const leftClass =
    slot.leftText === null
      ? "file-line--absent"
      : slot.isEqual
        ? "file-line--same"
        : "file-line--different";
  const rightClass =
    slot.rightText === null
      ? "file-line--absent"
      : slot.isEqual
        ? "file-line--same"
        : "file-line--different";

  return (
    <div className="file-diff__row">
      <div className={`file-diff__cell file-diff__cell--left ${leftClass}`}>
        <span className="file-line__number">{slot.leftText !== null ? slot.lineNumber : ""}</span>
        <span className="file-line__text">{slot.leftText ?? ""}</span>
      </div>
      <div className="file-diff__indicator">
        {slot.leftText === null || slot.rightText === null ? (
          <span className="diff-icon diff-icon--absent" title="Line only on one side">◌</span>
        ) : slot.isEqual ? (
          <span className="diff-icon diff-icon--equal" title="Lines are equal">✓</span>
        ) : (
          <span className="diff-icon diff-icon--different" title="Lines differ">✗</span>
        )}
      </div>
      <div className={`file-diff__cell file-diff__cell--right ${rightClass}`}>
        <span className="file-line__number">{slot.rightText !== null ? slot.lineNumber : ""}</span>
        <span className="file-line__text">{slot.rightText ?? ""}</span>
      </div>
    </div>
  );
}

export default function FileComparePage() {
  const [searchParams] = useSearchParams();
  const leftUrl = searchParams.get("leftUrl") ?? "";
  const rightUrl = searchParams.get("rightUrl") ?? "";
  const filePath = searchParams.get("path") ?? "";

  const [leftText, setLeftText] = useState<string | null>(null);
  const [rightText, setRightText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!leftUrl || !rightUrl) return;

    const controller = new AbortController();

    const loadFiles = async () => {
      setIsLoading(true);
      setError("");

      try {
        const [leftResponse, rightResponse] = await Promise.all([
          fetch(leftUrl, { signal: controller.signal }),
          fetch(rightUrl, { signal: controller.signal }),
        ]);

        if (!leftResponse.ok) {
          throw new Error(`Failed to fetch left file (${leftResponse.status})`);
        }
        if (!rightResponse.ok) {
          throw new Error(`Failed to fetch right file (${rightResponse.status})`);
        }

        const [left, right] = await Promise.all([
          leftResponse.text(),
          rightResponse.text(),
        ]);

        if (!controller.signal.aborted) {
          setLeftText(left);
          setRightText(right);
        }
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to load files");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void loadFiles();

    return () => {
      controller.abort();
    };
  }, [leftUrl, rightUrl]);

  const hasUrls = leftUrl && rightUrl;
  const hasContent = leftText !== null && rightText !== null;

  const slots =
    hasContent
      ? buildLineSlots(leftText.split(/\r?\n|\r/), rightText.split(/\r?\n|\r/))
      : [];

  const equalCount = slots.filter((s) => s.isEqual).length;
  const differentCount = slots.filter(
    (s) => !s.isEqual && s.leftText !== null && s.rightText !== null
  ).length;
  const leftOnlyCount = slots.filter(
    (s) => s.leftText !== null && s.rightText === null
  ).length;
  const rightOnlyCount = slots.filter(
    (s) => s.leftText === null && s.rightText !== null
  ).length;

  return (
    <div className="file-compare-page">
      <div className="page-header">
        <h1>📄 File Comparison</h1>
        {filePath && <p className="page-subtitle">{filePath}</p>}
        <Link to="/" className="back-link">
          ← Back to Tree Comparison
        </Link>
      </div>

      {!hasUrls && (
        <div className="placeholder-card">
          <div className="placeholder-icon">📂</div>
          <h2>No files selected</h2>
          <p>
            Navigate to a file comparison from the directory view by clicking the
            compare icon next to a text file.
          </p>
          <Link to="/" className="back-link">
            ← Go to Directory Comparison
          </Link>
        </div>
      )}

      {error && <div className="file-error">{error}</div>}

      {isLoading && <div className="file-loading">Loading files…</div>}

      {hasContent && (
        <>
          <div className="file-diff__summary">
            <span className="summary-item summary-item--equal">✓ {equalCount} equal</span>
            <span className="summary-item summary-item--different">✗ {differentCount} different</span>
            {leftOnlyCount > 0 && (
              <span className="summary-item summary-item--left-only">◌ {leftOnlyCount} left only</span>
            )}
            {rightOnlyCount > 0 && (
              <span className="summary-item summary-item--right-only">◌ {rightOnlyCount} right only</span>
            )}
            <span className="summary-item summary-item--total">{slots.length} lines total</span>
          </div>
          <div className="file-diff">
            <div className="file-diff__header">
              <div className="file-diff__label file-diff__label--left">Left</div>
              <div className="file-diff__label file-diff__label--center" />
              <div className="file-diff__label file-diff__label--right">Right</div>
            </div>
            <div className="file-diff__body">
              {slots.map((slot) => (
                <LineRow key={slot.lineNumber} slot={slot} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
