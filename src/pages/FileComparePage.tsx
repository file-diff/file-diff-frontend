import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { buildJobFileDiffUrl, buildTokenizeUrl } from "../config/api";
import { DEFAULT_SHIKI_THEME, SHIKI_THEMES } from "../constants/shikiThemes";
import "./FileComparePage.css";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LineSlot {
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  leftText: string | null;
  rightText: string | null;
  isEqual: boolean;
  leftHighlights: DiffChange[];
  rightHighlights: DiffChange[];
  leftTokens: TokenStyle[] | null;
  rightTokens: TokenStyle[] | null;
  leftDiffInfo: DiffLineSide | null;
  rightDiffInfo: DiffLineSide | null;
}

interface DiffChange {
  start: number;
  end: number;
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

/* --- Tokenizer types (mirrored from TokenizePage) --- */

interface TokenStyle {
  content: string;
  /// Offset from the beginning of the file
  offset: number;
  color: string;
  fontStyle: number;
}

interface TokenizeResponse {
  tokens: TokenStyle[][];
  fg?: string;
  bg?: string;
  themeName?: string;
}

type FontStyleFlag = number;
const FONT_STYLE_ITALIC: FontStyleFlag = 1;
const FONT_STYLE_BOLD: FontStyleFlag = 2;
const FONT_STYLE_UNDERLINE: FontStyleFlag = 4;

interface MergedToken {
  content: string;
  /// Offset from the beginning of the line (after merging with highlights)
  offset: number;
  color: string;
  fontStyle: number;
  highlight?: string;
}

function mergeStyles(tokens: TokenStyle[], highlights: DiffChange[]): MergedToken[] {
  const result: MergedToken[] = [];

  const lineStart = tokens.length > 0 ? tokens[0].offset : 0;
  for (const token of tokens) {
    // Calculate token's position relative to the start of the line, offset is from the file start
    const tokenStart = token.offset - lineStart;
    const tokenEnd = token.offset - lineStart + token.content.length;
    let currentPos = tokenStart;

    // Find highlights that overlap with this specific token
    const overlappingHighlights = highlights.filter(h =>
      h.start < tokenEnd && h.end > tokenStart
    ).sort((a, b) => a.start - b.start);

    if (overlappingHighlights.length === 0) {
      result.push({
        content: token.content,
        offset: tokenStart,
        color: token.color,
        fontStyle: token.fontStyle
      });
      continue;
    }

    for (const hl of overlappingHighlights) {
      // 1. Handle gap before the highlight (if any)
      if (hl.start > currentPos) {
        const partContent = token.content.substring(currentPos - tokenStart, hl.start - tokenStart);
        result.push({
          ...token,
          content: partContent,
          offset: currentPos
        });
        currentPos = hl.start;
      }

      // 2. Handle the overlapping part
      const overlapStart = Math.max(currentPos, hl.start);
      const overlapEnd = Math.min(tokenEnd, hl.end);

      if (overlapEnd > overlapStart) {
        const partContent = token.content.substring(overlapStart - tokenStart, overlapEnd - tokenStart);
        result.push({
          ...token,
          content: partContent,
          offset: overlapStart,
          highlight: hl.highlight // Merging the highlight property here
        });
        currentPos = overlapEnd;
      }
    }

    // 3. Handle remaining part of token after last highlight
    if (currentPos < tokenEnd) {
      const partContent = token.content.substring(currentPos - tokenStart, tokenEnd - tokenStart);
      result.push({
        ...token,
        content: partContent,
        offset: currentPos
      });
    }
  }

  return result;
}


/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildLineInfoMaps(chunks: DiffChunkEntry[][]) {
  const left = new Map<number, DiffChange[]>();
  const right = new Map<number, DiffChange[]>();
  const leftDiffInfo = new Map<number, DiffLineSide>();
  const rightDiffInfo = new Map<number, DiffLineSide>();

  for (const chunk of chunks) {
    for (const entry of chunk) {
      if (entry.lhs) {
        leftDiffInfo.set(entry.lhs.line_number, entry.lhs);
        left.set(
          entry.lhs.line_number,
          entry.lhs.changes
        );
      }
      if (entry.rhs) {
        rightDiffInfo.set(entry.rhs.line_number, entry.rhs);
        right.set(
          entry.rhs.line_number,
          entry.rhs.changes
        );
      }
    }
  }

  return { left, right, leftDiffInfo, rightDiffInfo };
}

/**
 * Convert fontStyle bitflags into React CSS properties.
 * Bit 1 = italic, Bit 2 = bold, Bit 4 = underline.
 */
function tokenFontStyle(flags?: number): React.CSSProperties | undefined {
  if (!flags) return undefined;

  const style: React.CSSProperties = {};
  if (flags & FONT_STYLE_ITALIC) style.fontStyle = "italic";
  if (flags & FONT_STYLE_BOLD) style.fontWeight = "bold";
  if (flags & FONT_STYLE_UNDERLINE) style.textDecoration = "underline";

  return Object.keys(style).length > 0 ? style : undefined;
}

function buildLineSlots(
  leftLines: string[],
  rightLines: string[],
  leftTokenLines: TokenStyle[][] | null,
  rightTokenLines: TokenStyle[][] | null
): LineSlot[] {
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
      leftTokens:
        leftTokenLines && i < leftTokenLines.length
          ? leftTokenLines[i]
          : null,
      rightTokens:
        rightTokenLines && i < rightTokenLines.length
          ? rightTokenLines[i]
          : null,
      leftDiffInfo: null,
      rightDiffInfo: null,
    });
  }

  return slots;
}

function buildLineSlotsFromDiff(
  leftLines: string[],
  rightLines: string[],
  alignedLines: [number | null, number | null][],
  chunks: DiffChunkEntry[][],
  leftTokenLines: TokenStyle[][] | null,
  rightTokenLines: TokenStyle[][] | null
): LineSlot[] {
  const lineInfo = buildLineInfoMaps(chunks);

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
        lhsLine !== null ? (lineInfo.left.get(lhsLine) ?? []) : [],
      rightHighlights:
        rhsLine !== null ? (lineInfo.right.get(rhsLine) ?? []) : [],
      leftTokens:
        leftTokenLines && lhsLine !== null && lhsLine < leftTokenLines.length
          ? leftTokenLines[lhsLine]
          : null,
      rightTokens:
        rightTokenLines &&
        rhsLine !== null &&
        rhsLine < rightTokenLines.length
          ? rightTokenLines[rhsLine]
          : null,
      leftDiffInfo:
        lhsLine !== null ? (lineInfo.leftDiffInfo.get(lhsLine) ?? null) : null,
      rightDiffInfo:
        rhsLine !== null ? (lineInfo.rightDiffInfo.get(rhsLine) ?? null) : null,
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
  highlights: DiffChange[];
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
      <span key={`h${i}`} className={`diff-highlight-${range.highlight}`}>
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

/**
 * Render a line using tokenizer output with diff highlights applied.
 *
 * Each token provides syntax highlighting (color, fontStyle).
 * Diff highlights specify character ranges that changed.
 * We split tokens at highlight boundaries so each span gets the right
 * combination of syntax color AND diff background.
 *
 * Falls back gracefully: if tokens is empty, renders nothing.
 */
function TokenizedHighlightedText({
  tokens,
  highlights,
}: {
  tokens: TokenStyle[];
  highlights: DiffChange[];
}) {
  // Split tokens at diff-highlight boundaries, counting letters from each token
  const segments = mergeStyles(tokens, highlights);

  return (
    <>
      {segments.map((seg, i) => (
        <span
          key={i}
          className={seg.highlight ? `diff-highlight-${seg.highlight}` : undefined}
          style={{
            color: seg.color,
            ...tokenFontStyle(seg.fontStyle),
          }}
        >
          {seg.content}
        </span>
      ))}
    </>
  );
}

function formatDetailValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function LineDetailsDialog({
  selectedLine,
  onClose,
}: {
  selectedLine: { slot: LineSlot; rowIndex: number } | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (selectedLine && !dialog.open) {
      dialog.showModal();
    } else if (!selectedLine && dialog.open) {
      dialog.close();
    }
  }, [selectedLine]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  const slot = selectedLine?.slot;
  const leftMergedTokens =
    slot?.leftTokens != null
      ? mergeStyles(slot.leftTokens, slot.leftHighlights)
      : null;
  const rightMergedTokens =
    slot?.rightTokens != null
      ? mergeStyles(slot.rightTokens, slot.rightHighlights)
      : null;

  return (
    <dialog className="line-details-dialog" ref={dialogRef}>
      <div className="line-details">
        <div className="line-details__header">
          <div>
            <h2>Line details</h2>
            <p className="line-details__meta">
              Row {selectedLine ? selectedLine.rowIndex + 1 : ""} · Left line{" "}
              {slot?.leftLineNumber ?? ""} · Right line{" "}
              {slot?.rightLineNumber ?? ""}
            </p>
          </div>
          <button
            type="button"
            className="line-details__close"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close line details"
          >
            ×
          </button>
        </div>
        <div className="line-details__content">
          <section className="line-details__column">
            <h3>Left</h3>
            <div className="line-details__group">
              <span className="line-details__label">Raw text</span>
              <pre className="line-details__value">
                {formatDetailValue(slot?.leftText ?? "")}
              </pre>
            </div>
            <div className="line-details__group">
              <span className="line-details__label">Diff info</span>
              <pre className="line-details__value">
                {formatDetailValue(slot?.leftDiffInfo)}
              </pre>
            </div>
            <div className="line-details__group">
              <span className="line-details__label">Tokenizer info</span>
              <pre className="line-details__value">
                {formatDetailValue(slot?.leftTokens)}
              </pre>
            </div>
            <div className="line-details__group">
              <span className="line-details__label">Merged tokenizer info</span>
              <pre className="line-details__value">
                {formatDetailValue(leftMergedTokens)}
              </pre>
            </div>
          </section>
          <section className="line-details__column">
            <h3>Right</h3>
            <div className="line-details__group">
              <span className="line-details__label">Raw text</span>
              <pre className="line-details__value">
                {formatDetailValue(slot?.rightText ?? "")}
              </pre>
            </div>
            <div className="line-details__group">
              <span className="line-details__label">Diff info</span>
              <pre className="line-details__value">
                {formatDetailValue(slot?.rightDiffInfo)}
              </pre>
            </div>
            <div className="line-details__group">
              <span className="line-details__label">Tokenizer info</span>
              <pre className="line-details__value">
                {formatDetailValue(slot?.rightTokens)}
              </pre>
            </div>
            <div className="line-details__group">
              <span className="line-details__label">Merged tokenizer info</span>
              <pre className="line-details__value">
                {formatDetailValue(rightMergedTokens)}
              </pre>
            </div>
          </section>
        </div>
      </div>
    </dialog>
  );
}

function LineRow({
  slot,
  onCopyToRight,
  onShowDetails,
}: {
  slot: LineSlot;
  onCopyToRight: (rightLineIndex: number, text: string) => void;
  onShowDetails: () => void;
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
            slot.leftTokens ? (
              <TokenizedHighlightedText
                tokens={slot.leftTokens}
                highlights={slot.leftHighlights}
              />
            ) : (
              <HighlightedText
                text={slot.leftText}
                highlights={slot.leftHighlights}
              />
            )
          ) : (
            ""
          )}
        </span>
      </div>
      <div className="file-diff__indicator">
        <div className="file-diff__indicator-actions">
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
          <button
            type="button"
            className="line-details-button"
            title="Show line details"
            aria-label="Show line details"
            onClick={onShowDetails}
          >
            i
          </button>
        </div>
      </div>
      <div className={`file-diff__cell file-diff__cell--right ${rightClass}`}>
        <span className="file-line__number">
          {slot.rightLineNumber ?? ""}
        </span>
        <span className="file-line__text">
          {slot.rightText !== null ? (
            slot.rightTokens ? (
              <TokenizedHighlightedText
                tokens={slot.rightTokens}
                highlights={slot.rightHighlights}
              />
            ) : (
              <HighlightedText
                text={slot.rightText}
                highlights={slot.rightHighlights}
              />
            )
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
  const [searchParams, setSearchParams] = useSearchParams();
  const leftUrl = searchParams.get("leftUrl") ?? "";
  const rightUrl = searchParams.get("rightUrl") ?? "";
  const leftHash = searchParams.get("leftHash") ?? "";
  const rightHash = searchParams.get("rightHash") ?? "";
  const filePath = searchParams.get("path") ?? "";
  const initialTheme = searchParams.get("theme") ?? DEFAULT_SHIKI_THEME;

  const [leftLines, setLeftLines] = useState<string[] | null>(null);
  const [rightLines, setRightLines] = useState<string[] | null>(null);
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [leftTokenData, setLeftTokenData] = useState<TokenizeResponse | null>(
    null
  );
  const [rightTokenData, setRightTokenData] =
    useState<TokenizeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(initialTheme);
  const [selectedLine, setSelectedLine] = useState<{
    slot: LineSlot;
    rowIndex: number;
  } | null>(null);

  useEffect(() => {
    if (!leftUrl || !rightUrl) return;

    const controller = new AbortController();

    const loadFiles = async () => {
      setIsLoading(true);
      setError("");
      setDiffData(null);
      setLeftTokenData(null);
      setRightTokenData(null);
      setSelectedLine(null);

      try {
        const diffPromise =
          leftHash && rightHash
            ? fetch(
                buildJobFileDiffUrl(leftHash, rightHash),
                { signal: controller.signal }
              )
                .then((r) =>
                  r.ok ? (r.json() as Promise<DiffResponse>) : null
                )
                .catch(() => null)
            : Promise.resolve(null);

        // Fetch tokenizer output for both sides (non-blocking: if it fails, we just skip syntax highlighting)
        const leftTokenPromise = leftHash
          ? fetch(buildTokenizeUrl(leftHash, theme), {
              signal: controller.signal,
            })
              .then((r) =>
                r.ok ? (r.json() as Promise<TokenizeResponse>) : null
              )
              .catch(() => null)
          : Promise.resolve(null);

        const rightTokenPromise = rightHash
          ? fetch(buildTokenizeUrl(rightHash, theme), {
              signal: controller.signal,
            })
              .then((r) =>
                r.ok ? (r.json() as Promise<TokenizeResponse>) : null
              )
              .catch(() => null)
          : Promise.resolve(null);

        const [leftResponse, rightResponse, diff, leftTokens, rightTokens] =
          await Promise.all([
            fetch(leftUrl, { signal: controller.signal }),
            fetch(rightUrl, { signal: controller.signal }),
            diffPromise,
            leftTokenPromise,
            rightTokenPromise,
          ]);

        console.log(
          "[FileComparePage] Fetched tokenizer data:",
          leftTokens
            ? `left: ${leftTokens.tokens.length} lines`
            : "left: none",
          rightTokens
            ? `right: ${rightTokens.tokens.length} lines`
            : "right: none"
        );

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
          setLeftTokenData(leftTokens);
          setRightTokenData(rightTokens);
        }
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Failed to load files"
          );
          setSelectedLine(null);
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
  }, [leftHash, leftUrl, rightHash, rightUrl, theme]);

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

    // Extract per-line token arrays (null if tokenizer data unavailable)
    const leftTokenLines = leftTokenData?.tokens ?? null;
    const rightTokenLines = rightTokenData?.tokens ?? null;

    console.log(
      "[FileComparePage] Building line slots —",
      "leftTokenLines:",
      leftTokenLines ? `${leftTokenLines.length} lines` : "none",
      "rightTokenLines:",
      rightTokenLines ? `${rightTokenLines.length} lines` : "none",
      "useDiffAlignment:",
      useDiffAlignment
    );

    if (useDiffAlignment) {
      return buildLineSlotsFromDiff(
        leftLines,
        rightLines,
        diffData!.aligned_lines!,
        diffData!.chunks ?? [],
        leftTokenLines,
        rightTokenLines
      );
    }
    return buildLineSlots(
      leftLines,
      rightLines,
      leftTokenLines,
      rightTokenLines
    );
  }, [
    hasContent,
    leftLines,
    rightLines,
    useDiffAlignment,
    diffData,
    leftTokenData,
    rightTokenData,
  ]);

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
          <div className="file-compare-controls">
            <div className="file-compare-field file-compare-field--theme">
              <label htmlFor="file-compare-theme">Theme</label>
              <input
                id="file-compare-theme"
                type="text"
                list="file-compare-theme-options"
                placeholder={DEFAULT_SHIKI_THEME}
                value={theme}
                onChange={(e) => {
                  const nextTheme = e.target.value;
                  const nextSearchParams = new URLSearchParams(searchParams);

                  setTheme(nextTheme);

                  if (nextTheme.trim()) {
                    nextSearchParams.set("theme", nextTheme.trim());
                  } else {
                    nextSearchParams.delete("theme");
                  }

                  setSearchParams(nextSearchParams, { replace: true });
                }}
              />
              <datalist id="file-compare-theme-options">
                {SHIKI_THEMES.map((themeName) => (
                  <option key={themeName} value={themeName} />
                ))}
              </datalist>
            </div>
          </div>
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
                  onShowDetails={() => setSelectedLine({ slot, rowIndex: i })}
                />
              ))}
            </div>
          </div>
          <LineDetailsDialog
            selectedLine={selectedLine}
            onClose={() => setSelectedLine(null)}
          />
        </>
      )}
    </div>
  );
}
