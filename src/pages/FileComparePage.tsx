import { useCallback, useEffect, useMemo, useState } from "react";
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

function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function LineRow({
  slot,
  onCopyToRight,
}: {
  slot: LineSlot;
  onCopyToRight: (lineIndex: number) => void;
}) {
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

  const showArrow = !slot.isEqual && slot.leftText !== null && slot.rightText !== null;

  return (
    <div className="file-diff__row">
      <div className={`file-diff__cell file-diff__cell--left ${leftClass}`}>
        <span className="file-line__number">{slot.leftText !== null ? slot.lineNumber : ""}</span>
        <span className="file-line__text">{slot.leftText ?? ""}</span>
      </div>
      <div className="file-diff__indicator">
        {showArrow ? (
          <button
            className="diff-arrow"
            title="Copy left line to right"
            onClick={() => onCopyToRight(slot.lineNumber - 1)}
          >
            →
          </button>
        ) : slot.leftText === null || slot.rightText === null ? (
          <span className="diff-icon diff-icon--absent" title="Line only on one side">◌</span>
        ) : (
          <span className="diff-icon diff-icon--equal" title="Lines are equal">✓</span>
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

  const [leftLines, setLeftLines] = useState<string[] | null>(null);
  const [rightLines, setRightLines] = useState<string[] | null>(null);
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
          setLeftLines(left.split(/\r?\n|\r/));
          setRightLines(right.split(/\r?\n|\r/));
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

  const handleCopyToRight = useCallback(
    (lineIndex: number) => {
      if (!leftLines || !rightLines) return;
      if (lineIndex < 0 || lineIndex >= leftLines.length) return;

      setRightLines((prev) => {
        const updated = [...prev!];
        // Ensure array is large enough
        while (updated.length <= lineIndex) {
          updated.push("");
        }
        updated[lineIndex] = leftLines[lineIndex];
        return updated;
      });
    },
    [leftLines, rightLines]
  );

  const handleDownloadLeft = useCallback(() => {
    if (!leftLines) return;
    const filename = filePath ? filePath.split("/").pop() ?? "left.txt" : "left.txt";
    downloadTextFile(leftLines.join("\n"), filename);
  }, [leftLines, filePath]);

  const handleDownloadRight = useCallback(() => {
    if (!rightLines) return;
    const baseName = filePath ? filePath.split("/").pop() ?? "right.txt" : "right.txt";
    const dotIdx = baseName.lastIndexOf(".");
    const filename =
      dotIdx > 0
        ? `${baseName.slice(0, dotIdx)}-modified${baseName.slice(dotIdx)}`
        : `${baseName}-modified`;
    downloadTextFile(rightLines.join("\n"), filename);
  }, [rightLines, filePath]);

  const hasUrls = leftUrl && rightUrl;
  const hasContent = leftLines !== null && rightLines !== null;

  const slots = useMemo(
    () => (hasContent ? buildLineSlots(leftLines, rightLines) : []),
    [hasContent, leftLines, rightLines]
  );

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
          <div className="file-diff__actions">
            <button className="download-btn" onClick={handleDownloadLeft} title="Download left file">
              ⭳ Download Left
            </button>
            <button className="download-btn" onClick={handleDownloadRight} title="Download right file">
              ⭳ Download Right
            </button>
          </div>
          <div className="file-diff">
            <div className="file-diff__header">
              <div className="file-diff__label file-diff__label--left">Left</div>
              <div className="file-diff__label file-diff__label--center" />
              <div className="file-diff__label file-diff__label--right">Right</div>
            </div>
            <div className="file-diff__body">
              {slots.map((slot) => (
                <LineRow
                  key={slot.lineNumber}
                  slot={slot}
                  onCopyToRight={handleCopyToRight}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
