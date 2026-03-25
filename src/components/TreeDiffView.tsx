import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { ComparisonSlot, DiffEntry } from "../utils/fileDiffParser.ts";
import "./TreeDiffView.css";

const GITHUB_REPO_SEGMENT_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

interface TreeDiffViewProps {
  slots: ComparisonSlot[];
  getLeftDownloadUrl?: (entry: DiffEntry) => string;
  getRightDownloadUrl?: (entry: DiffEntry) => string;
  leftSource?: TreeDiffSource;
  rightSource?: TreeDiffSource;
  selectedPath?: string | null;
  onSelectSlot?: (path: string) => void;
}

interface TreeDiffSource {
  label: string;
  repo: string;
  revision: string;
  rootPath?: string;
}

type TreeDiffSide = "left" | "right";

interface TreeCompareSelection {
  side: TreeDiffSide;
  path: string;
  sourceLabel: string;
  displayPath: string;
  hash: string;
  downloadUrl: string;
}

interface TreeEntryActionsState extends TreeCompareSelection {
  fileType: DiffEntry["fileType"];
  fileUrl: string;
  historyUrl: string;
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

function normalizeGitPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

function encodeGitPath(path: string): string {
  return normalizeGitPath(path)
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildGitHubRepoUrl(repo: string): string {
  const trimmedRepo = repo.trim();
  if (!trimmedRepo) {
    return "";
  }

  const segments = trimmedRepo
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length !== 2) {
    return "";
  }

  if (!segments.every((segment) => GITHUB_REPO_SEGMENT_PATTERN.test(segment))) {
    return "";
  }

  return `https://github.com/${segments.map(encodeURIComponent).join("/")}`;
}

function buildRepositoryFilePath(rootPath = "", entryPath = ""): string {
  return [normalizeGitPath(rootPath), normalizeGitPath(entryPath)]
    .filter(Boolean)
    .join("/");
}

function buildGitHubFileUrl(
  repo: string,
  revision: string,
  rootPath: string,
  entryPath: string
): string {
  const repoUrl = buildGitHubRepoUrl(repo);
  const trimmedRevision = revision.trim();
  const displayPath = buildRepositoryFilePath(rootPath, entryPath);

  if (!repoUrl || !trimmedRevision || !displayPath) {
    return "";
  }

  return `${repoUrl}/blob/${encodeURIComponent(trimmedRevision)}/${encodeGitPath(displayPath)}`;
}

function buildGitHubHistoryUrl(
  repo: string,
  revision: string,
  rootPath: string,
  entryPath: string
): string {
  const repoUrl = buildGitHubRepoUrl(repo);
  const trimmedRevision = revision.trim();
  const displayPath = buildRepositoryFilePath(rootPath, entryPath);

  if (!repoUrl || !trimmedRevision || !displayPath) {
    return "";
  }

  return `${repoUrl}/commits/${encodeURIComponent(trimmedRevision)}/${encodeGitPath(displayPath)}`;
}

function EntryRow({
  entry,
  getDownloadUrl,
  source,
  side,
  isCompareSelected,
  onOpenActions,
}: {
  entry: DiffEntry | null;
  getDownloadUrl?: (entry: DiffEntry) => string;
  source?: TreeDiffSource;
  side: TreeDiffSide;
  isCompareSelected?: boolean;
  onOpenActions?: (actions: TreeEntryActionsState) => void;
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
  const displayPath = buildRepositoryFilePath(source?.rootPath, entry.path);
  const fileUrl = source
    ? buildGitHubFileUrl(
        source.repo,
        source.revision,
        source.rootPath ?? "",
        entry.path
      )
    : "";
  const historyUrl = source
    ? buildGitHubHistoryUrl(
        source.repo,
        source.revision,
        source.rootPath ?? "",
        entry.path
      )
    : "";
  const hasActions = Boolean(fileUrl || historyUrl || downloadUrl);

  return (
    <div
      className={`tree-row ${statusClass}${isCompareSelected ? " tree-row--compare-selected" : ""}`}
      title={entry.path}
    >
      <span className="tree-entry" style={{paddingLeft: `${indent}px`}}>
        <span className="tree-icon">{icon}</span>
        <span className="tree-name">{entry.name}</span>
      </span>
      <div style={{display: "flex", flex: 1}}></div>
      <span className="tree-meta">
        {sizeStr && <span className="tree-size">{sizeStr}</span>}
        {hashStr && <span className="tree-hash">{hashStr.slice(0, 8)}</span>}
        {entry.fileType !== "d" && (
          hasActions ? (
            <button
              type="button"
              className="tree-actions-trigger"
              onClick={(event) => {
                event.stopPropagation();
                onOpenActions?.({
                  side,
                  path: entry.path,
                  sourceLabel: source?.label ?? "File",
                  displayPath: displayPath || entry.path,
                  hash: entry.hash,
                  fileType: entry.fileType,
                  fileUrl,
                  historyUrl,
                  downloadUrl,
                });
              }}
              title={`More actions for ${entry.path}`}
              aria-label={`More actions for ${entry.path}`}
            >
              ⚙️
            </button>
          ) : (
            <span
              className="tree-download tree-download--disabled"
              aria-hidden="true"
              title="Actions unavailable"
            >
              ⚙️
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
  backUrl?: string,
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
  if (backUrl) {
    params.set("back", backUrl);
  }
  if (isValidHash(leftEntry.hash)) {
    params.set("leftHash", leftEntry.hash);
  }
  if (isValidHash(rightEntry.hash)) {
    params.set("rightHash", rightEntry.hash);
  }
  return `/files?${params.toString()}`;
}

function isValidHash(hash: string): boolean {
  return Boolean(hash) && hash !== "N/A";
}

function canCompareTextFile(entry: DiffEntry, downloadUrl: string): boolean {
  return entry.fileType === "t" && Boolean(downloadUrl);
}

function isSelectedCompareEntry(
  selectedEntry: TreeCompareSelection | null,
  side: TreeDiffSide,
  path: string | undefined
): boolean {
  return selectedEntry?.side === side && selectedEntry.path === path;
}

function buildSelectedFileCompareUrl(
  selectedEntry: TreeCompareSelection,
  currentEntry: TreeCompareSelection,
  backUrl?: string
): string | null {
  if (!selectedEntry.downloadUrl || !currentEntry.downloadUrl) {
    return null;
  }

  let leftFile = selectedEntry;
  let rightFile = currentEntry;

  if (selectedEntry.side !== currentEntry.side) {
    leftFile = selectedEntry.side === "left" ? selectedEntry : currentEntry;
    rightFile = selectedEntry.side === "right" ? selectedEntry : currentEntry;
  }

  const params = new URLSearchParams();
  params.set("leftUrl", leftFile.downloadUrl);
  params.set("rightUrl", rightFile.downloadUrl);
  params.set(
    "path",
    leftFile.displayPath === rightFile.displayPath
      ? leftFile.displayPath
      : `${leftFile.displayPath} ↔ ${rightFile.displayPath}`
  );
  if (backUrl) {
    params.set("back", backUrl);
  }
  if (isValidHash(leftFile.hash)) {
    params.set("leftHash", leftFile.hash);
  }
  if (isValidHash(rightFile.hash)) {
    params.set("rightHash", rightFile.hash);
  }

  return `/files?${params.toString()}`;
}

function buildTreeCompareSelection(
  side: TreeDiffSide,
  entry: DiffEntry,
  source: TreeDiffSource | undefined,
  getDownloadUrl: ((entry: DiffEntry) => string) | undefined
): TreeCompareSelection | null {
  const downloadUrl = getDownloadUrl?.(entry) ?? "";

  if (!canCompareTextFile(entry, downloadUrl)) {
    return null;
  }

  return {
    side,
    path: entry.path,
    sourceLabel: source?.label ?? (side === "left" ? "Left" : "Right"),
    displayPath: buildRepositoryFilePath(source?.rootPath, entry.path) || entry.path,
    hash: entry.hash,
    downloadUrl,
  };
}

function restoreTreeCompareSelection(
  search: string,
  slots: ComparisonSlot[],
  leftSource: TreeDiffSource | undefined,
  rightSource: TreeDiffSource | undefined,
  getLeftDownloadUrl: ((entry: DiffEntry) => string) | undefined,
  getRightDownloadUrl: ((entry: DiffEntry) => string) | undefined
): TreeCompareSelection | null {
  const params = new URLSearchParams(search);
  const side = params.get("compareSelectedSide");
  const path = params.get("compareSelectedPath")?.trim() ?? "";

  if ((side !== "left" && side !== "right") || !path) {
    return null;
  }

  for (const slot of slots) {
    const entry = side === "left" ? slot.left : slot.right;
    if (!entry || entry.path !== path) {
      continue;
    }

    return buildTreeCompareSelection(
      side,
      entry,
      side === "left" ? leftSource : rightSource,
      side === "left" ? getLeftDownloadUrl : getRightDownloadUrl
    );
  }

  return null;
}

export default function TreeDiffView({
  slots,
  getLeftDownloadUrl,
  getRightDownloadUrl,
  leftSource,
  rightSource,
  selectedPath,
  onSelectSlot,
}: TreeDiffViewProps) {
  const location = useLocation();
  const selectedRef = useRef<HTMLDivElement | null>(null);
  const [selectedCompareEntry, setSelectedCompareEntry] =
    useState<TreeCompareSelection | null>(() =>
      restoreTreeCompareSelection(
        location.search,
        slots,
        leftSource,
        rightSource,
        getLeftDownloadUrl,
        getRightDownloadUrl
      )
    );
  const [activeActions, setActiveActions] = useState<TreeEntryActionsState | null>(
    null
  );

  useEffect(() => {
    if (selectedPath && selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedPath, slots]);

  useEffect(() => {
    if (!activeActions) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveActions(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeActions]);

  return (
    <>
      <div className="tree-diff">
        <div className="tree-diff__body">
          {slots.map((slot, i) => {
            const slotPath = slot.left?.path ?? slot.right?.path ?? "";
            const isSelected = selectedPath != null && slotPath === selectedPath;
            const backParams = new URLSearchParams(location.search);
            if (slotPath) {
              backParams.set("selectedPath", slotPath);
            } else {
              backParams.delete("selectedPath");
            }
            if (selectedCompareEntry) {
              backParams.set("compareSelectedSide", selectedCompareEntry.side);
              backParams.set("compareSelectedPath", selectedCompareEntry.path);
            } else {
              backParams.delete("compareSelectedSide");
              backParams.delete("compareSelectedPath");
            }
            const backUrl = `${location.pathname}?${backParams.toString()}`;
            const compareUrl =
              slot.left && slot.right
                ? buildFileCompareUrl(
                    slot.left,
                    slot.right,
                    backUrl,
                    getLeftDownloadUrl,
                    getRightDownloadUrl,
                  )
                : null;

            return (
              <div
                className={"tree-diff__slot"}
                key={slotPath || `slot-${i}`}
                ref={isSelected ? selectedRef : undefined}
                onClick={() => onSelectSlot?.(slotPath)}
              >
                <div className="tree-diff__number">
                  {slot.no}
                </div>

              <div className="tree-diff__column">
                <EntryRow
                  entry={slot.left}
                  getDownloadUrl={getLeftDownloadUrl}
                  source={leftSource}
                  side="left"
                  isCompareSelected={isSelectedCompareEntry(
                    selectedCompareEntry,
                    "left",
                    slot.left?.path
                  )}
                    onOpenActions={setActiveActions}
                  />
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
                  source={rightSource}
                  side="right"
                  isCompareSelected={isSelectedCompareEntry(
                    selectedCompareEntry,
                    "right",
                    slot.right?.path
                  )}
                    onOpenActions={setActiveActions}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {activeActions && (
        (() => {
          const isCurrentSelected =
            selectedCompareEntry?.side === activeActions.side &&
            selectedCompareEntry.path === activeActions.path;
          const canSelectCurrentEntry =
            activeActions.fileType === "t" && Boolean(activeActions.downloadUrl);
          const compareBackParams = new URLSearchParams(location.search);
          compareBackParams.set("selectedPath", activeActions.path);
          if (selectedCompareEntry) {
            compareBackParams.set("compareSelectedSide", selectedCompareEntry.side);
            compareBackParams.set("compareSelectedPath", selectedCompareEntry.path);
          } else {
            compareBackParams.delete("compareSelectedSide");
            compareBackParams.delete("compareSelectedPath");
          }
          const compareWithSelectedUrl =
            selectedCompareEntry && canSelectCurrentEntry && !isCurrentSelected
              ? buildSelectedFileCompareUrl(
                  selectedCompareEntry,
                  activeActions,
                  `${location.pathname}?${compareBackParams.toString()}`
                )
              : null;
          const selectedCompareLabel = selectedCompareEntry
            ? `${selectedCompareEntry.sourceLabel}: ${selectedCompareEntry.displayPath}`
            : "";

          return (
        <div
          className="tree-actions-modal"
          role="presentation"
          onClick={() => setActiveActions(null)}
        >
          <div
            className="tree-actions-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tree-actions-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="tree-actions-modal__header">
              <div>
                <h3 id="tree-actions-modal-title">File actions</h3>
                <p className="tree-actions-modal__subtitle">
                  {activeActions.sourceLabel}:{" "}
                  <code>{activeActions.displayPath || "—"}</code>
                </p>
              </div>
              <button
                type="button"
                className="tree-actions-modal__close"
                onClick={() => setActiveActions(null)}
                aria-label="Close file actions"
              >
                ✕
              </button>
            </div>
            <div className="tree-actions-modal__content">
              {activeActions.fileUrl ? (
                <a
                  className="tree-actions-modal__link"
                  href={activeActions.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open file on GitHub
                </a>
              ) : (
                <span className="tree-actions-modal__link tree-actions-modal__link--disabled">
                  Open file on GitHub unavailable
                </span>
              )}
              {activeActions.historyUrl ? (
                <a
                  className="tree-actions-modal__link"
                  href={activeActions.historyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View file history
                </a>
              ) : (
                <span className="tree-actions-modal__link tree-actions-modal__link--disabled">
                  File history unavailable
                </span>
              )}
              {activeActions.downloadUrl ? (
                <a
                  className="tree-actions-modal__link"
                  href={activeActions.downloadUrl}
                >
                  Download file
                </a>
              ) : (
                <span className="tree-actions-modal__link tree-actions-modal__link--disabled">
                  Download unavailable
                </span>
              )}
              {canSelectCurrentEntry ? (
                <button
                  type="button"
                  className="tree-actions-modal__link tree-actions-modal__button"
                  onClick={() => {
                    setSelectedCompareEntry(activeActions);
                    setActiveActions(null);
                  }}
                >
                  {selectedCompareEntry?.side === activeActions.side &&
                  selectedCompareEntry.path === activeActions.path
                    ? "Selected for comparison"
                    : "Select for comparison"}
                </button>
              ) : (
                <span className="tree-actions-modal__link tree-actions-modal__link--disabled">
                  Selection unavailable
                </span>
              )}
              {compareWithSelectedUrl ? (
                <Link
                  className="tree-actions-modal__link"
                  to={compareWithSelectedUrl}
                  onClick={() => setActiveActions(null)}
                >
                  Compare with selected
                  <span className="tree-actions-modal__link-detail">
                    {selectedCompareLabel}
                  </span>
                </Link>
              ) : selectedCompareEntry ? (
                <button
                  type="button"
                  className="tree-actions-modal__link tree-actions-modal__button"
                  onClick={() => {
                    setSelectedCompareEntry(null);
                    setActiveActions(null);
                  }}
                >
                  Clear selected file
                </button>
              ) : (
                <span className="tree-actions-modal__link tree-actions-modal__link--disabled">
                  Select another text file to compare
                </span>
              )}
            </div>
          </div>
        </div>
          );
        })()
      )}
    </>
  );
}
