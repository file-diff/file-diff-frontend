import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { buildJobFileDiffUrl } from "../config/api";
import "./FileComparePage.css";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChangeRange {
  start: number;
  end: number;
}

interface LineSlot {
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  leftText: string | null;
  rightText: string | null;
  isEqual: boolean;
  leftHighlights: ChangeRange[];
  rightHighlights: ChangeRange[];
}

interface DiffChange {
  start: number;
  end: number;
  content: string;
  highlight: string;
}

interface DiffLineSide {
  line_number: number;
  changes: DiffChange[];
}

interface DiffChunkEntry {
  lhs?: DiffLineSide;
  rhs?: DiffLineSide;
}

interface DiffResponse {
  status: string;
  language?: string;
  path?: string;
  aligned_lines?: [number | null, number | null][];
  chunks?: DiffChunkEntry[][];
}

interface JobFileInfo {
  jobId: string;
  hash: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function parseJobFileInfo(downloadUrl: string): JobFileInfo | null {
  const match = downloadUrl.match(
    /\/jobs\/([^/]+)\/files\/hash\/([^/]+)\/download/
  );
  if (!match) return null;
  return {
    jobId: decodeURIComponent(match[1]),
    hash: decodeURIComponent(match[2]),
  };
}

function buildHighlightMaps(chunks: DiffChunkEntry[][]) {
  const left = new Map<number, ChangeRange[]>();
  const right = new Map<number, ChangeRange[]>();

  for (const chunk of chunks) {
    for (const entry of chunk) {
      if (entry.lhs) {
        left.set(
          entry.lhs.line_number,
          entry.lhs.changes.map((c) => ({ start: c.start, end: c.end }))
        );
      }
      if (entry.rhs) {
        right.set(
          entry.rhs.line_number,
          entry.rhs.changes.map((c) => ({ start: c.start, end: c.end }))
        );
      }
    }
  }

  return { left, right };
}

function buildLineSlots(leftLines: string[], rightLines: string[]): LineSlot[] {
  const maxLen = Math.max(leftLines.length, rightLines.length);
  const slots: LineSlot[] = [];

  for (let i = 0; i < maxLen; i++) {
    const leftText = i < leftLines.length ? leftLines[i] : null;
    const rightText = i < rightLines.length ? rightLines[i] : null;
    const isEqual = leftText === rightText;
    slots.push({
      leftLineNumber: i < leftLines.length ? i + 1 : null,
      rightLineNumber: i < rightLines.length ? i + 1 : null,
      leftText,
      rightText,
      isEqual,
      leftHighlights: [],
      rightHighlights: [],
    });
  }

  return slots;
}

function buildLineSlotsFromDiff(
  leftLines: string[],
  rightLines: string[],
  alignedLines: [number | null, number | null][],
  chunks: DiffChunkEntry[][]
): LineSlot[] {
  const highlights = buildHighlightMaps(chunks);

  return alignedLines.map(([lhsLine, rhsLine]) => {
    const leftText =
      lhsLine !== null && lhsLine >= 0 && lhsLine < leftLines.length
        ? leftLines[lhsLine]
        : null;
    const rightText =
      rhsLine !== null && rhsLine >= 0 && rhsLine < rightLines.length
        ? rightLines[rhsLine]
        : null;
    const isEqual =
      leftText !== null && rightText !== null && leftText === rightText;

    return {
      leftLineNumber: lhsLine !== null ? lhsLine + 1 : null,
      rightLineNumber: rhsLine !== null ? rhsLine + 1 : null,
      leftText,
      rightText,
      isEqual,
      leftHighlights:
        lhsLine !== null ? (highlights.left.get(lhsLine) ?? []) : [],
      rightHighlights:
        rhsLine !== null ? (highlights.right.get(rhsLine) ?? []) : [],
    };
  });
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

/* ------------------------------------------------------------------ */
/*  Components                                                         */
/* ------------------------------------------------------------------ */

function HighlightedText({
  text,
  highlights,
}: {
  text: string;
  highlights: ChangeRange[];
}) {
  if (highlights.length === 0) return <>{text}</>;

  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let lastEnd = 0;

  sorted.forEach((range, i) => {
    if (range.start > lastEnd) {
      parts.push(<span key={`t${i}`}>{text.slice(lastEnd, range.start)}</span>);
    }
    parts.push(
      <span key={`h${i}`} className="diff-highlight">
        {text.slice(range.start, range.end)}
      </span>
    );
    lastEnd = range.end;
  });

  if (lastEnd < text.length) {
    parts.push(<span key="tail">{text.slice(lastEnd)}</span>);
  }

  return <>{parts}</>;
}

function LineRow({
  slot,
  onCopyToRight,
}: {
  slot: LineSlot;
  onCopyToRight: (rightLineIndex: number, text: string) => void;
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

  const showArrow =
    !slot.isEqual && slot.leftText !== null && slot.rightText !== null;

  return (
    <div className="file-diff__row">
      <div className={`file-diff__cell file-diff__cell--left ${leftClass}`}>
        <span className="file-line__number">
          {slot.leftLineNumber ?? ""}
        </span>
        <span className="file-line__text">
          {slot.leftText !== null ? (
            <HighlightedText
              text={slot.leftText}
              highlights={slot.leftHighlights}
            />
          ) : (
            ""
          )}
        </span>
      </div>
      <div className="file-diff__indicator">
        {showArrow ? (
          <button
            className="diff-arrow"
            title="Copy left line to right"
            onClick={() =>
              onCopyToRight(slot.rightLineNumber! - 1, slot.leftText!)
            }
          >
            →
          </button>
        ) : slot.leftText === null || slot.rightText === null ? (
          <span
            className="diff-icon diff-icon--absent"
            title="Line only on one side"
          >
            ◌
          </span>
        ) : (
          <span
            className="diff-icon diff-icon--equal"
            title="Lines are equal"
          >
            ✓
          </span>
        )}
      </div>
      <div className={`file-diff__cell file-diff__cell--right ${rightClass}`}>
        <span className="file-line__number">
          {slot.rightLineNumber ?? ""}
        </span>
        <span className="file-line__text">
          {slot.rightText !== null ? (
            <HighlightedText
              text={slot.rightText}
              highlights={slot.rightHighlights}
            />
          ) : (
            ""
          )}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function FileComparePage() {
  const [searchParams] = useSearchParams();
  const leftUrl = searchParams.get("leftUrl") ?? "";
  const rightUrl = searchParams.get("rightUrl") ?? "";
  const filePath = searchParams.get("path") ?? "";

  const [leftLines, setLeftLines] = useState<string[] | null>(null);
  const [rightLines, setRightLines] = useState<string[] | null>(null);
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!leftUrl || !rightUrl) return;

    const controller = new AbortController();

    const loadFiles = async () => {
      setIsLoading(true);
      setError("");
      setDiffData(null);

      try {
        const leftInfo = parseJobFileInfo(leftUrl);
        const rightInfo = parseJobFileInfo(rightUrl);

        const diffPromise =
          leftInfo && rightInfo
            ? fetch(
                buildJobFileDiffUrl(
                  leftInfo.jobId,
                  leftInfo.hash,
                  rightInfo.hash
                ),
                { signal: controller.signal }
              )
                .then((r) =>
                  r.ok ? (r.json() as Promise<DiffResponse>) : null
                )
                .catch(() => null)
            : Promise.resolve(null);

        const [leftResponse, rightResponse, diff] = await Promise.all([
          fetch(leftUrl, { signal: controller.signal }),
          fetch(rightUrl, { signal: controller.signal }),
          diffPromise,
        ]);

        if (!leftResponse.ok) {
          throw new Error(
            `Failed to fetch left file (${leftResponse.status})`
          );
        }
        if (!rightResponse.ok) {
          throw new Error(
            `Failed to fetch right file (${rightResponse.status})`
          );
        }

        const [left, right] = await Promise.all([
          leftResponse.text(),
          rightResponse.text(),
        ]);

        if (!controller.signal.aborted) {
          setLeftLines(left.split(/\r?\n|\r/));
          setRightLines(right.split(/\r?\n|\r/));
          setDiffData(diff);
        }
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Failed to load files"
          );
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
    (rightLineIndex: number, text: string) => {
      if (!rightLines) return;

      setRightLines((prev) => {
        const updated = [...prev!];
        while (updated.length <= rightLineIndex) {
          updated.push("");
        }
        updated[rightLineIndex] = text;
        return updated;
      });
      setDiffData(null);
    },
    [rightLines]
  );

  const handleDownloadLeft = useCallback(() => {
    if (!leftLines) return;
    const filename = filePath
      ? filePath.split("/").pop() ?? "left.txt"
      : "left.txt";
    downloadTextFile(leftLines.join("\n"), filename);
  }, [leftLines, filePath]);

  const handleDownloadRight = useCallback(() => {
    if (!rightLines) return;
    const baseName = filePath
      ? filePath.split("/").pop() ?? "right.txt"
      : "right.txt";
    const dotIdx = baseName.lastIndexOf(".");
    const filename =
      dotIdx > 0
        ? `${baseName.slice(0, dotIdx)}-modified${baseName.slice(dotIdx)}`
        : `${baseName}-modified`;
    downloadTextFile(rightLines.join("\n"), filename);
  }, [rightLines, filePath]);

  const hasUrls = leftUrl && rightUrl;
  const hasContent = leftLines !== null && rightLines !== null;

  const useDiffAlignment =
    diffData?.status === "changed" &&
    Array.isArray(diffData.aligned_lines) &&
    diffData.aligned_lines.length > 0;

  const slots = useMemo(() => {
    if (!hasContent) return [];
    if (useDiffAlignment) {
      return buildLineSlotsFromDiff(
        leftLines,
        rightLines,
        diffData!.aligned_lines!,
        diffData!.chunks ?? []
      );
    }
    return buildLineSlots(leftLines, rightLines);
  }, [hasContent, leftLines, rightLines, useDiffAlignment, diffData]);

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
            <span className="summary-item summary-item--equal">
              ✓ {equalCount} equal
            </span>
            <span className="summary-item summary-item--different">
              ✗ {differentCount} different
            </span>
            {leftOnlyCount > 0 && (
              <span className="summary-item summary-item--left-only">
                ◌ {leftOnlyCount} left only
              </span>
            )}
            {rightOnlyCount > 0 && (
              <span className="summary-item summary-item--right-only">
                ◌ {rightOnlyCount} right only
              </span>
            )}
            <span className="summary-item summary-item--total">
              {slots.length} lines total
            </span>
            {useDiffAlignment && (
              <span className="summary-item summary-item--diff-aligned">
                ⚡ diff-aligned
              </span>
            )}
          </div>
          <div className="file-diff__actions">
            <button
              className="download-btn"
              onClick={handleDownloadLeft}
              title="Download left file"
            >
              ⭳ Download Left
            </button>
            <button
              className="download-btn"
              onClick={handleDownloadRight}
              title="Download right file"
            >
              ⭳ Download Right
            </button>
          </div>
          <div className="file-diff">
            <div className="file-diff__header">
              <div className="file-diff__label file-diff__label--left">
                Left
              </div>
              <div className="file-diff__label file-diff__label--center" />
              <div className="file-diff__label file-diff__label--right">
                Right
              </div>
            </div>
            <div className="file-diff__body">
              {slots.map((slot, i) => (
                <LineRow
                  key={i}
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
