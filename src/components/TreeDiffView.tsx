import { Link } from "react-router-dom";
import type { ComparisonSlot, DiffEntry } from "../utils/csvParser";
import "./TreeDiffView.css";

interface TreeDiffViewProps {
  slots: ComparisonSlot[];
  leftLabel: string;
  rightLabel: string;
  getLeftDownloadUrl?: (entry: DiffEntry) => string;
  getRightDownloadUrl?: (entry: DiffEntry) => string;
}

const fileTypeIcon: Record<string, string> = {
  d: "📁",
  t: "📄",
  b: "💾",
  x: "⚙️",
  s: "🔗",
};

function formatSize(size: number): string {
  if (size === 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function EntryRow({
  entry,
  getDownloadUrl,
}: {
  entry: DiffEntry | null;
  getDownloadUrl?: (entry: DiffEntry) => string;
}) {
  if (!entry) {
    return <div className="tree-row tree-row--empty" />;
  }

  const statusClass = `tree-row--${entry.status}`;
  const icon = fileTypeIcon[entry.fileType] ?? "📄";
  const indent = entry.depth * 20;
  const sizeStr = formatSize(entry.size);
  const hashStr =
    entry.fileType !== "d" && entry.hash !== "N/A" ? entry.hash : "";
  const downloadUrl = hashStr ? getDownloadUrl?.(entry) ?? "" : "";

  return (
    <div className={`tree-row ${statusClass}`} title={entry.path}>
      <span className="tree-entry" style={{ paddingLeft: `${indent}px` }}>
        <span className="tree-icon">{icon}</span>
        <span className="tree-name">{entry.name}</span>
      </span>
      <span className="tree-meta">
        {sizeStr && <span className="tree-size">{sizeStr}</span>}
        {hashStr && <span className="tree-hash">{hashStr}</span>}
        {entry.fileType !== "d" && (
          downloadUrl ? (
            <a
              className="tree-download"
              href={downloadUrl}
              download={entry.name}
              aria-label={`Download ${entry.path}`}
              title={`Download ${entry.path}`}
            >
              ⭳
            </a>
          ) : (
            <span
              className="tree-download tree-download--disabled"
              aria-hidden="true"
              title="Download unavailable"
            >
              ⭳
            </span>
          )
        )}
      </span>
    </div>
  );
}

function buildFileCompareUrl(
  leftEntry: DiffEntry,
  rightEntry: DiffEntry,
  getLeftDownloadUrl?: (entry: DiffEntry) => string,
  getRightDownloadUrl?: (entry: DiffEntry) => string,
): string | null {
  if (leftEntry.fileType !== "t" || rightEntry.fileType !== "t") return null;

  const leftUrl = getLeftDownloadUrl?.(leftEntry) ?? "";
  const rightUrl = getRightDownloadUrl?.(rightEntry) ?? "";
  if (!leftUrl || !rightUrl) return null;

  const params = new URLSearchParams();
  params.set("leftUrl", leftUrl);
  params.set("rightUrl", rightUrl);
  params.set("path", leftEntry.path);
  return `/files?${params.toString()}`;
}

export default function TreeDiffView({
  slots,
  leftLabel,
  rightLabel,
  getLeftDownloadUrl,
  getRightDownloadUrl,
}: TreeDiffViewProps) {
  return (
    <div className="tree-diff">
      <div className="tree-diff__header">
        <div className="tree-diff__label tree-diff__label--left">
          {leftLabel}
        </div>
        <div className="tree-diff__label tree-diff__label--right">
          {rightLabel}
        </div>
      </div>
      <div className="tree-diff__body">
        {slots.map((slot, i) => {
          const compareUrl =
            slot.left && slot.right
              ? buildFileCompareUrl(
                  slot.left,
                  slot.right,
                  getLeftDownloadUrl,
                  getRightDownloadUrl,
                )
              : null;

          return (
            <div
              className="tree-diff__slot"
              key={slot.left?.path ?? slot.right?.path ?? `slot-${i}`}
            >
              <div className="tree-diff__column">
                <EntryRow entry={slot.left} getDownloadUrl={getLeftDownloadUrl} />
              </div>
              {compareUrl ? (
                <Link
                  className="tree-diff__compare-link"
                  to={compareUrl}
                  title={`Compare ${slot.left?.path ?? ""}`}
                >
                  ⇔
                </Link>
              ) : (
                <span className="tree-diff__compare-link tree-diff__compare-link--disabled" />
              )}
              <div className="tree-diff__column">
                <EntryRow
                  entry={slot.right}
                  getDownloadUrl={getRightDownloadUrl}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
