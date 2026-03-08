import type { ComparisonSlot, DiffEntry } from "../utils/csvParser";
import "./TreeDiffView.css";

interface TreeDiffViewProps {
  slots: ComparisonSlot[];
  leftLabel: string;
  rightLabel: string;
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

function EntryRow({ entry }: { entry: DiffEntry | null }) {
  if (!entry) {
    return <div className="tree-row tree-row--empty" />;
  }

  const statusClass = `tree-row--${entry.status}`;
  const icon = fileTypeIcon[entry.fileType] ?? "📄";
  const indent = entry.depth * 20;
  const sizeStr = formatSize(entry.size);
  const hashStr =
    entry.fileType !== "d" && entry.hash !== "N/A" ? entry.hash : "";

  return (
    <div className={`tree-row ${statusClass}`} title={entry.path}>
      <span className="tree-entry" style={{ paddingLeft: `${indent}px` }}>
        <span className="tree-icon">{icon}</span>
        <span className="tree-name">{entry.name}</span>
      </span>
      <span className="tree-meta">
        {sizeStr && <span className="tree-size">{sizeStr}</span>}
        {hashStr && <span className="tree-hash">{hashStr}</span>}
      </span>
    </div>
  );
}

export default function TreeDiffView({
  slots,
  leftLabel,
  rightLabel,
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
        {slots.map((slot, i) => (
          <div
            className="tree-diff__slot"
            key={slot.left?.path ?? slot.right?.path ?? `slot-${i}`}
          >
            <div className="tree-diff__column">
              <EntryRow entry={slot.left} />
            </div>
            <div className="tree-diff__column">
              <EntryRow entry={slot.right} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
