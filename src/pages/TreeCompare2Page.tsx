import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import { useSearchParams } from "react-router-dom";
import TreeDiffView from "../components/TreeDiffView";
import {
  buildCommitFilesUrl,
  buildHashFileDownloadUrl,
} from "../config/api";
import {
  deserializeJobFilesResponse,
} from "../utils/binaryDeserializer";
import { diffCsv, parseJobFilesResponse } from "../utils/fileDiffParser.ts";
import type {
  ComparisonSlot,
  CsvEntry,
  DiffEntry,
  JobFilesResponse,
} from "../utils/fileDiffParser.ts";
import {
  readTreeCompare2FileNameFilterEnabled,
  readTreeCompare2FileNameFilterValue,
  readTreeCompare2ScrollPath,
  readTreeCompare2ShowUnchanged,
  writeTreeCompare2FileNameFilterEnabled,
  writeTreeCompare2FileNameFilterValue,
  writeTreeCompare2ScrollPath,
  writeTreeCompare2ShowUnchanged,
} from "../utils/storage";
import "./TreeComparePage.css";
import "./TreeCompare2Page.css";

const TREE_COMPARE2_FILES_CACHE = "tree-compare2-files-v1";
const GITHUB_REPO_SEGMENT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const GITHUB_COMMIT_PATTERN = /^[0-9a-fA-F]{7,40}$/;
// Keep fuzzy matches reasonably strict so short filename queries narrow the tree
// without pulling in unrelated paths.
const FILE_NAME_FILTER_FUSE_THRESHOLD = 0.35;

interface JobRequest {
  repo: string;
  commit: string;
}

interface LoadedCompareSide {
  repo: string;
  commit: string;
  entries: CsvEntry[];
  jobId: string;
  label: string;
}

interface LoadedCompareData {
  left: LoadedCompareSide;
  right: LoadedCompareSide;
}

type FilesDecodeMode = "json" | "jobFilesResponseBinary" | "bareFileRecordsBinary";

function isDirectoryPath(path: string, directoryPath: string): boolean {
  return path === directoryPath || path.startsWith(`${directoryPath}/`);
}

function filterUnchangedSlots(
  slots: ComparisonSlot[],
  showUnchanged: boolean
): ComparisonSlot[] {
  if (showUnchanged) {
    return slots;
  }

  const changedPaths = slots.flatMap((slot) => {
    const entry = slot.left ?? slot.right;
    if (!entry || entry.status === "same") {
      return [];
    }

    return [entry.path];
  });

  return slots.filter((slot) => {
    const entry = slot.left ?? slot.right;
    if (!entry) {
      return false;
    }

    if (entry.status !== "same") {
      return true;
    }

    if (entry.fileType !== "d") {
      return false;
    }

    return changedPaths.some((path) => isDirectoryPath(path, entry.path));
  });
}

function collectVisibleFilterPaths(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  const visiblePaths: string[] = [];

  for (let i = 1; i <= segments.length; i += 1) {
    visiblePaths.push(segments.slice(0, i).join("/"));
  }

  return visiblePaths;
}

function filterSlotsByFileName(
  slots: ComparisonSlot[],
  fileNameFilterFuse: Fuse<{
    entry: DiffEntry | null;
    name: string;
    path: string;
  }> | null,
  fileNameFilterEnabled: boolean,
  fileNameFilterValue: string
): ComparisonSlot[] {
  if (!fileNameFilterEnabled) {
    return slots;
  }

  const query = fileNameFilterValue.trim();
  if (!query) {
    return slots;
  }

  if (!fileNameFilterFuse) {
    return slots;
  }

  const includedPaths = new Set(
    fileNameFilterFuse.search(query).flatMap(({ item }) =>
      item.entry ? collectVisibleFilterPaths(item.entry.path) : []
    )
  );

  return slots.filter((slot) => {
    const entry = slot.left ?? slot.right;
    if (!entry) {
      return false;
    }

    return includedPaths.has(entry.path);
  });
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

function buildGitHubCommitUrl(repo: string, commit: string): string {
  const repoUrl = buildGitHubRepoUrl(repo);
  const trimmedCommit = commit.trim();

  if (!repoUrl || !GITHUB_COMMIT_PATTERN.test(trimmedCommit)) {
    return "";
  }

  return `${repoUrl}/commit/${encodeURIComponent(trimmedCommit)}`;
}

function firstNonEmptyString(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmedValue = typeof value === "string" ? value.trim() : "";
    if (trimmedValue) {
      return trimmedValue;
    }
  }

  return "";
}

function extractErrorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message.trim()) {
    return value.message.trim();
  }

  return fallback;
}

function isCompletedJobStatus(status?: string): boolean {
  return status?.trim().toLowerCase() === "completed";
}

async function openTreeCompareFilesCache(): Promise<Cache | null> {
  if (typeof window === "undefined" || typeof window.caches === "undefined") {
    return null;
  }

  try {
    return await window.caches.open(TREE_COMPARE2_FILES_CACHE);
  } catch (error: unknown) {
    console.error("[TreeCompare2Page] failed to open Cache API", {
      error: extractErrorMessage(error, "Unable to open browser cache."),
    });
    return null;
  }
}

async function decodeCompareFilesResponse(
  side: "left" | "right",
  request: JobRequest,
  response: Response,
  logLabel: string
): Promise<{ filesData: JobFilesResponse; decodeMode: FilesDecodeMode }> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    let message = `Unable to load ${side} files for commit ${request.commit}.`;

    try {
      const errorData = (await response.json()) as { error?: string };
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    console.error(`${logLabel} fetch failed`, { message });
    throw new Error(message);
  }

  let filesData: JobFilesResponse;
  let decodeMode: FilesDecodeMode = "json";

  if (contentType.includes("application/octet-stream")) {
    const buffer = await response.arrayBuffer();

    try {
      filesData = deserializeJobFilesResponse(buffer);
      decodeMode = "jobFilesResponseBinary";
    } catch (jobResponseError: unknown) {
      console.error(`${logLabel} failed to decode as JobFilesResponse ${jobResponseError}`);
      throw new Error(`Received binary response for ${side} side, but it was in an unexpected format.`);
    }
  } else {
    filesData = (await response.json()) as JobFilesResponse;
  }

  return { filesData, decodeMode };
}

async function loadCompareSide(
  side: "left" | "right",
  request: JobRequest,
  signal: AbortSignal
): Promise<LoadedCompareSide> {
  const requestUrl = buildCommitFilesUrl(request.commit, "binary");
  const logLabel = `[TreeCompare2Page] ${side} ${request.commit.slice(0, 12)}`;
  const cache = await openTreeCompareFilesCache();

  if (cache) {
    try {
      const cachedResponse = await cache.match(requestUrl);

      if (cachedResponse) {
        const r = await decodeCompareFilesResponse(
          side,
          request,
          cachedResponse,
          `${logLabel} [cache]`
        );

        if (isCompletedJobStatus(r.filesData.status)) {
          const commit = r.filesData.commit?.trim() || request.commit;
          const jobId = r.filesData.jobId?.trim() || r.filesData.job_id?.trim() || "";
          const commitLabel = commit ? commit.slice(0, 12) : "unknown";

          return {
            repo: request.repo,
            commit,
            entries: parseJobFilesResponse(r.filesData, true),
            jobId,
            label: `${side === "left" ? "Left" : "Right"} (${commitLabel})`,
          };
        }

        await cache.delete(requestUrl);
        console.log(`${logLabel} removed non-completed cached response`, {
          status: r.filesData.status ?? "unknown",
        });
      }
    } catch (error: unknown) {
      console.error(`${logLabel} cache lookup failed`, {
        error: extractErrorMessage(error, "Unable to read cached response."),
      });
    }
  }

  const response = await fetch(requestUrl, { signal });
  const responseForCache = cache && response.ok ? response.clone() : null;

  const r = await decodeCompareFilesResponse(
    side,
    request,
    response,
    logLabel
  );

  const commit = r.filesData.commit?.trim() || request.commit;
  const jobId = r.filesData.jobId?.trim() || r.filesData.job_id?.trim() || "";
  const commitLabel = commit ? commit.slice(0, 12) : "unknown";

  if (!isCompletedJobStatus(r.filesData.status)) {
    const statusText = r.filesData.status?.trim() || "unknown";
    throw new Error(
      `The ${side} side indexing job is not yet ready (status: ${statusText}). Please wait for indexing to complete and reload.`
    );
  }

  if (cache && responseForCache) {
    try {
      await cache.put(requestUrl, responseForCache);
      console.error(`${logLabel} cached completed response`, {
        status: r.filesData.status,
      });
    } catch (error: unknown) {
      console.error(`${logLabel} failed to cache completed response`, {
        error: extractErrorMessage(error, "Unable to store cached response."),
      });
    }
  }

  return {
    repo: request.repo,
    commit,
    entries: parseJobFilesResponse(r.filesData, true),
    jobId,
    label: `${side === "left" ? "Left" : "Right"} (${commitLabel})`,
  };
}

export default function TreeCompare2Page() {
  const [searchParams] = useSearchParams();
  const bothRepo = searchParams.get("b")?.trim() ?? "";
  const leftRepo = searchParams.get("lr")?.trim() ?? "";
  const leftCommit = searchParams.get("lc")?.trim() ?? "";
  const rightRepo = searchParams.get("rr")?.trim() ?? "";
  const rightCommit = searchParams.get("rc")?.trim() ?? "";
  const selectedPathFromUrl = searchParams.get("selectedPath")?.trim() ?? "";
  const [compareData, setCompareData] = useState<LoadedCompareData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(
    () => selectedPathFromUrl || null
  );
  const [showUnchanged, setShowUnchanged] = useState(
    () => readTreeCompare2ShowUnchanged() ?? true
  );
  const [fileNameFilterEnabled, setFileNameFilterEnabled] = useState(
    () => readTreeCompare2FileNameFilterEnabled() ?? false
  );
  const [fileNameFilterValue, setFileNameFilterValue] = useState(
    () => readTreeCompare2FileNameFilterValue() ?? ""
  );
  const [firstVisiblePath, setFirstVisiblePath] = useState<string>("");
  const [initialScrollPath] = useState(() => readTreeCompare2ScrollPath());
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadComparison(): Promise<void> {
      let lr = leftRepo;
      const lc = leftCommit;
      let rr = rightRepo;
      const rc = rightCommit;

      if (bothRepo) {
        lr = bothRepo;
        rr = bothRepo;
      }


      if (!lr || !lc || !rr || !rc) {
        setCompareData(null);
        setIsLoading(false);
        setApiError(
          "Provide leftRepo, leftCommit, rightRepo, and rightCommit in the URL."
        );
        return;
      }

      setIsLoading(true);
      setApiError("");
      setCompareData(null);

      try {
        const [left, right] = await Promise.all([
          loadCompareSide(
            "left",
            { repo: lr, commit: lc },
            controller.signal
          ),
          loadCompareSide(
            "right",
            { repo: rr, commit: rc },
            controller.signal
          ),
        ]);

        setCompareData({ left, right });
        setIsLoading(false);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setCompareData(null);
        setIsLoading(false);
        setApiError(
          extractErrorMessage(error, "Unable to load repository comparison.")
        );
      }
    }

    void loadComparison();

    return () => controller.abort();
  }, [bothRepo, leftCommit, leftRepo, rightCommit, rightRepo]);

  const diff = useMemo(() => {
    if (!compareData) {
      return null;
    }

    try {
      return diffCsv(
        compareData.left.entries,
        compareData.right.entries,
        "/",
        "/",
        true
      );
    } catch {
      return null;
    }
  }, [compareData]);
  const visibleDiff = useMemo(() => {
    if (!diff) {
      return null;
    }

    return filterUnchangedSlots(diff, showUnchanged);
  }, [diff, showUnchanged]);
  const fileNameFilterFuse = useMemo(() => {
    if (!visibleDiff) {
      return null;
    }

    return new Fuse(
      visibleDiff.map((slot) => {
        const entry = slot.left ?? slot.right;

        return {
          entry,
          name: entry?.name ?? "",
          path: entry?.path ?? "",
        };
      }),
      {
        keys: [
          { name: "name", weight: 0.8 },
          { name: "path", weight: 0.2 },
        ],
        threshold: FILE_NAME_FILTER_FUSE_THRESHOLD,
      }
    );
  }, [visibleDiff]);
  const filteredDiff = useMemo(() => {
    if (!visibleDiff) {
      return null;
    }

    return filterSlotsByFileName(
      visibleDiff,
      fileNameFilterFuse,
      fileNameFilterEnabled,
      fileNameFilterValue
    );
  }, [fileNameFilterEnabled, fileNameFilterFuse, fileNameFilterValue, visibleDiff]);

  useEffect(() => {
    writeTreeCompare2ShowUnchanged(showUnchanged);
  }, [showUnchanged]);

  useEffect(() => {
    writeTreeCompare2FileNameFilterEnabled(fileNameFilterEnabled);
  }, [fileNameFilterEnabled]);

  useEffect(() => {
    writeTreeCompare2FileNameFilterValue(fileNameFilterValue);
  }, [fileNameFilterValue]);

  useEffect(() => {
    if (firstVisiblePath) {
      writeTreeCompare2ScrollPath(firstVisiblePath);
    }
  }, [firstVisiblePath]);

  const handleScroll = useCallback(() => {
    if (scrollTimerRef.current != null) {
      clearTimeout(scrollTimerRef.current);
    }

    scrollTimerRef.current = setTimeout(() => {
      const container = scrollContainerRef.current;
      if (!container) {
        return;
      }

      const containerTop = container.getBoundingClientRect().top;
      const slots = container.querySelectorAll<HTMLElement>("[data-slot-path]");
      let bestPath = "";

      for (const slot of slots) {
        const rect = slot.getBoundingClientRect();
        if (rect.bottom > containerTop) {
          bestPath = slot.getAttribute("data-slot-path") ?? "";
          break;
        }
      }

      if (bestPath) {
        setFirstVisiblePath(bestPath);
      }
    }, 150);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current != null) {
        clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);

  const leftSummaryRepo = firstNonEmptyString(
    compareData?.left.repo,
    leftRepo,
    bothRepo
  );
  const leftSummaryCommit = compareData?.left.commit ?? leftCommit;
  const rightSummaryRepo = firstNonEmptyString(
    compareData?.right.repo,
    rightRepo,
    bothRepo
  );
  const rightSummaryCommit = compareData?.right.commit ?? rightCommit;
  const leftRepoUrl = buildGitHubRepoUrl(leftSummaryRepo);
  const leftCommitUrl = buildGitHubCommitUrl(leftSummaryRepo, leftSummaryCommit);
  const rightRepoUrl = buildGitHubRepoUrl(rightSummaryRepo);
  const rightCommitUrl = buildGitHubCommitUrl(
    rightSummaryRepo,
    rightSummaryCommit
  );

  const buildDownloadUrl = (entry: DiffEntry): string => {
    if (entry.fileType === "d" || !entry.hash || entry.hash === "N/A") {
      return "";
    }

    return buildHashFileDownloadUrl(entry.hash);
  };

  return (
    <div className="tree-compare-page tree-compare2-page">
      {apiError && (
        <div className="api-error">
          {apiError}
          <button
            type="button"
            className="api-error__reload-btn"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      )}

      {isLoading && (
        <div className="tree-compare2-loading">
          Loading files for both commits…
        </div>
      )}

      {!isLoading && compareData && diff && (
        <div className="tree-compare2-page__layout">
          <div className="tree-compare2-page__header">
            <div className="tree-compare2-controls">
              <label
                className="sort-option tree-compare2-option"
                htmlFor="show-unchanged"
              >
                <input
                  id="show-unchanged"
                  type="checkbox"
                  checked={showUnchanged}
                  onChange={(e) => setShowUnchanged(e.target.checked)}
                />
                Show unchanged files
              </label>

              <div className="tree-compare2-file-filter">
                <label
                  className="sort-option tree-compare2-option"
                  htmlFor="file-name-filter-enabled"
                >
                  <input
                    id="file-name-filter-enabled"
                    type="checkbox"
                    checked={fileNameFilterEnabled}
                    onChange={(e) => setFileNameFilterEnabled(e.target.checked)}
                  />
                  Filter file name
                </label>
                <input
                  id="file-name-filter-input"
                  className="tree-compare2-file-filter__input"
                  type="text"
                  value={fileNameFilterValue}
                  onChange={(e) => setFileNameFilterValue(e.target.value)}
                  placeholder="package.json"
                  spellCheck={false}
                  disabled={!fileNameFilterEnabled}
                />
              </div>

              {firstVisiblePath && (
                <span className="tree-compare2-scroll-position" title={firstVisiblePath}>
                  📍 {firstVisiblePath}
                </span>
              )}
            </div>

            <div className="compare-summary tree-compare2-summary">
              <div className="compare-summary__side">
                <span className="compare-summary__label">Left</span>
                {leftRepoUrl ? (
                  <a
                    className="compare-summary__repo compare-summary__link"
                    href={leftRepoUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {leftSummaryRepo}
                  </a>
                ) : (
                  <span className="compare-summary__repo">{leftSummaryRepo || "—"}</span>
                )}
                {leftCommitUrl ? (
                  <a
                    className="compare-summary__commit compare-summary__link"
                    href={leftCommitUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <code>{leftSummaryCommit.slice(0, 12)}</code>
                  </a>
                ) : (
                  <code className="compare-summary__commit">
                    {leftSummaryCommit ? leftSummaryCommit.slice(0, 12) : "—"}
                  </code>
                )}
              </div>
              <div className="compare-summary__side">
                <span className="compare-summary__label">Right</span>
                {rightRepoUrl ? (
                  <a
                    className="compare-summary__repo compare-summary__link"
                    href={rightRepoUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {rightSummaryRepo}
                  </a>
                ) : (
                  <span className="compare-summary__repo">{rightSummaryRepo || "—"}</span>
                )}
                {rightCommitUrl ? (
                  <a
                    className="compare-summary__commit compare-summary__link"
                    href={rightCommitUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <code>{rightSummaryCommit.slice(0, 12)}</code>
                  </a>
                ) : (
                  <code className="compare-summary__commit">
                    {rightSummaryCommit ? rightSummaryCommit.slice(0, 12) : "—"}
                  </code>
                )}
              </div>
            </div>
          </div>
          {(filteredDiff ?? visibleDiff ?? diff).length === 0 ? (
            <div className="tree-compare2-empty-state">
              <div className="tree-compare2-empty-state__icon">✅</div>
              <div className="tree-compare2-empty-state__title">No changes found</div>
              <div className="tree-compare2-empty-state__message">
                {fileNameFilterEnabled && fileNameFilterValue.trim()
                  ? "No files match the current filter. Try adjusting the file name filter or disabling it."
                  : showUnchanged
                    ? "Both commits have identical file trees."
                    : "No differences detected. Enable \"Show unchanged files\" to see all files."}
              </div>
            </div>
          ) : (
            <div
              className="diff-result tree-compare2-diff-result"
              ref={scrollContainerRef}
              onScroll={handleScroll}
            >
              <TreeDiffView
                slots={filteredDiff ?? visibleDiff ?? diff}
                getLeftDownloadUrl={(entry) =>
                  buildDownloadUrl(entry)
                }
                getRightDownloadUrl={(entry) =>
                  buildDownloadUrl(entry)
                }
                leftSource={{
                  label: "Left",
                  repo: leftSummaryRepo,
                  revision: leftSummaryCommit,
                  rootPath: "/",
                }}
                rightSource={{
                  label: "Right",
                  repo: rightSummaryRepo,
                  revision: rightSummaryCommit,
                  rootPath: "/",
                }}
                selectedPath={selectedPath}
                onSelectSlot={setSelectedPath}
                initialScrollPath={initialScrollPath}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
