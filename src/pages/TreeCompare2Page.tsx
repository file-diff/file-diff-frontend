import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import TreeDiffView from "../components/TreeDiffView";
import {
  buildCommitFilesUrl,
  buildHashFileDownloadUrl,
  buildJobFileDownloadUrl,
} from "../config/api";
import {
  deserializeFileRecords,
  deserializeJobFilesResponse,
} from "../utils/binaryDeserializer";
import { diffCsv, jobFilesResponseToCsv, parseCsv } from "../utils/csvParser";
import type { DiffEntry, JobFilesResponse } from "../utils/csvParser";
import "./TreeComparePage.css";
import "./TreeCompare2Page.css";

const TREE_COMPARE2_FILES_CACHE = "tree-compare2-files-v1";

interface JobRequest {
  repo: string;
  commit: string;
}

interface LoadedCompareSide {
  repo: string;
  commit: string;
  csv: string;
  jobId: string;
  label: string;
}

interface LoadedCompareData {
  left: LoadedCompareSide;
  right: LoadedCompareSide;
}

type FilesDecodeMode = "json" | "jobFilesResponseBinary" | "bareFileRecordsBinary";

function buildFileTypeSummary(files: JobFilesResponse["files"]): Record<string, number> {
  const summary: Record<string, number> = {};

  for (const file of files ?? []) {
    const fileType = file.t || "unknown";
    summary[fileType] = (summary[fileType] ?? 0) + 1;
  }

  return summary;
}

function buildFileTypeSamples(
  files: JobFilesResponse["files"],
  limit = 10
): Array<{ path: string; type: string; size: number; hash: string }> {
  return (files ?? []).slice(0, limit).map((file) => ({
    path: file.path,
    type: file.t || "unknown",
    size: file.s,
    hash: file.hash,
  }));
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
    console.warn("[TreeCompare2Page] failed to open Cache API", {
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

  console.log(`${logLabel} fetch response`, {
    url: response.url,
    status: response.status,
    ok: response.ok,
    contentType,
    contentLength: response.headers.get("content-length"),
  });

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

    console.log(`${logLabel} fetch failed`, { message });
    throw new Error(message);
  }

  let filesData: JobFilesResponse;
  let decodeMode: FilesDecodeMode = "json";

  if (contentType.includes("application/octet-stream")) {
    const buffer = await response.arrayBuffer();
    console.log(`${logLabel} received binary payload`, {
      byteLength: buffer.byteLength,
    });

    try {
      filesData = deserializeJobFilesResponse(buffer);
      decodeMode = "jobFilesResponseBinary";
    } catch (jobResponseError: unknown) {
      console.log(`${logLabel} failed to decode job payload, trying bare file records`, {
        error: extractErrorMessage(
          jobResponseError,
          "Unable to decode job files payload."
        ),
      });
      try {
        filesData = {
          commit: request.commit,
          commitShort: request.commit.slice(0, 7),
          status: "completed",
          progress: 100,
          files: deserializeFileRecords(buffer),
        };
        decodeMode = "bareFileRecordsBinary";
      } catch (fileRecordsError: unknown) {
        const headerDetails = extractErrorMessage(
          jobResponseError,
          "Unable to decode job files payload."
        );
        const fileDetails = extractErrorMessage(
          fileRecordsError,
          "Unable to decode bare file records payload."
        );
        throw new Error(
          `Unable to load ${side} files for commit ${request.commit}: ${headerDetails} ${fileDetails}`
        );
      }
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
        const { filesData, decodeMode } = await decodeCompareFilesResponse(
          side,
          request,
          cachedResponse,
          `${logLabel} [cache]`
        );

        if (isCompletedJobStatus(filesData.status)) {
          const commit = filesData.commit?.trim() || request.commit;
          const jobId = filesData.jobId?.trim() || filesData.job_id?.trim() || "";
          const commitLabel = commit ? commit.slice(0, 12) : "unknown";

          console.log(`${logLabel} decoded files`, {
            source: "cache",
            decodeMode,
            resolvedCommit: commit,
            jobId,
            fileCount: filesData.files?.length ?? 0,
            fileTypeSummary: buildFileTypeSummary(filesData.files),
            fileTypeSamples: buildFileTypeSamples(filesData.files),
          });

          return {
            repo: request.repo,
            commit,
            csv: jobFilesResponseToCsv(filesData),
            jobId,
            label: `${side === "left" ? "Left" : "Right"} (${commitLabel})`,
          };
        }

        try {
          await cache.delete(requestUrl);
          console.log(`${logLabel} removed non-completed cached response`, {
            status: filesData.status ?? "unknown",
          });
        } catch (error: unknown) {
          console.warn(`${logLabel} failed to remove non-completed cached response`, {
            error: extractErrorMessage(error, "Unable to remove cached response."),
            status: filesData.status ?? "unknown",
          });
        }
      }
    } catch (error: unknown) {
      console.warn(`${logLabel} cache lookup failed`, {
        error: extractErrorMessage(error, "Unable to read cached response."),
      });
    }
  }

  const response = await fetch(requestUrl, { signal });
  const { filesData, decodeMode } = await decodeCompareFilesResponse(
    side,
    request,
    response,
    logLabel
  );

  const commit = filesData.commit?.trim() || request.commit;
  const jobId = filesData.jobId?.trim() || filesData.job_id?.trim() || "";
  const commitLabel = commit ? commit.slice(0, 12) : "unknown";

  console.log(`${logLabel} decoded files`, {
    source: "network",
    decodeMode,
    resolvedCommit: commit,
    jobId,
    fileCount: filesData.files?.length ?? 0,
    fileTypeSummary: buildFileTypeSummary(filesData.files),
    fileTypeSamples: buildFileTypeSamples(filesData.files),
  });

  if (cache && isCompletedJobStatus(filesData.status)) {
    try {
      await cache.put(requestUrl, response.clone());
      console.log(`${logLabel} cached completed response`, {
        status: filesData.status,
      });
    } catch (error: unknown) {
      console.warn(`${logLabel} failed to cache completed response`, {
        error: extractErrorMessage(error, "Unable to store cached response."),
      });
    }
  }

  return {
    repo: request.repo,
    commit,
    csv: jobFilesResponseToCsv(filesData),
    jobId,
    label: `${side === "left" ? "Left" : "Right"} (${commitLabel})`,
  };
}

export default function TreeCompare2Page() {
  const [searchParams] = useSearchParams();
  const leftRepo = searchParams.get("leftRepo")?.trim() ?? "";
  const leftCommit = searchParams.get("leftCommit")?.trim() ?? "";
  const rightRepo = searchParams.get("rightRepo")?.trim() ?? "";
  const rightCommit = searchParams.get("rightCommit")?.trim() ?? "";
  const [compareData, setCompareData] = useState<LoadedCompareData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function loadComparison(): Promise<void> {
      if (!leftRepo || !leftCommit || !rightRepo || !rightCommit) {
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
            { repo: leftRepo, commit: leftCommit },
            controller.signal
          ),
          loadCompareSide(
            "right",
            { repo: rightRepo, commit: rightCommit },
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
  }, [leftCommit, leftRepo, rightCommit, rightRepo]);

  const diff = useMemo(() => {
    if (!compareData) {
      return null;
    }

    try {
      return diffCsv(
        parseCsv(compareData.left.csv, true),
        parseCsv(compareData.right.csv, true),
        "/",
        "/",
        true
      );
    } catch {
      return null;
    }
  }, [compareData]);

  const leftSummaryRepo = compareData?.left.repo ?? leftRepo;
  const leftSummaryCommit = compareData?.left.commit ?? leftCommit;
  const rightSummaryRepo = compareData?.right.repo ?? rightRepo;
  const rightSummaryCommit = compareData?.right.commit ?? rightCommit;

  const buildDownloadUrl = (jobId: string, entry: DiffEntry): string => {
    if (entry.fileType === "d" || !entry.hash || entry.hash === "N/A") {
      return "";
    }

    if (jobId) {
      return buildJobFileDownloadUrl(jobId, entry.hash);
    }

    return buildHashFileDownloadUrl(entry.hash);
  };

  return (
    <div className="tree-compare-page tree-compare2-page">
      <div className="compare-summary">
        <div className="compare-summary__side">
          <span className="compare-summary__label">Left</span>
          <span className="compare-summary__repo">{leftSummaryRepo || "—"}</span>
          <code className="compare-summary__commit">
            {leftSummaryCommit ? leftSummaryCommit.slice(0, 12) : "—"}
          </code>
        </div>
        <div className="compare-summary__side">
          <span className="compare-summary__label">Right</span>
          <span className="compare-summary__repo">{rightSummaryRepo || "—"}</span>
          <code className="compare-summary__commit">
            {rightSummaryCommit ? rightSummaryCommit.slice(0, 12) : "—"}
          </code>
        </div>
      </div>

      {apiError && <div className="api-error">{apiError}</div>}

      {isLoading && (
        <div className="tree-compare2-loading">
          Loading files for both commits…
        </div>
      )}

      {!isLoading && compareData && diff && (
        <div className="diff-result">
          <div className="diff-legend">
            <span className="legend-item legend-item--same">● Same</span>
            <span className="legend-item legend-item--added">● Added</span>
            <span className="legend-item legend-item--removed">● Removed</span>
            <span className="legend-item legend-item--modified">● Modified</span>
          </div>
          <TreeDiffView
            slots={diff}
            leftLabel={compareData.left.label}
            rightLabel={compareData.right.label}
            getLeftDownloadUrl={(entry) =>
              buildDownloadUrl(compareData.left.jobId, entry)
            }
            getRightDownloadUrl={(entry) =>
              buildDownloadUrl(compareData.right.jobId, entry)
            }
          />
        </div>
      )}
    </div>
  );
}
