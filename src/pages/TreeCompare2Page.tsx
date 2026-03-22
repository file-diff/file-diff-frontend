import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import TreeDiffView from "../components/TreeDiffView";
import {
  buildCommitFilesUrl,
  buildHashFileDownloadUrl,
} from "../config/api";
import {
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

function buildGitHubRepoUrl(repo: string): string {
  const trimmedRepo = repo.trim();
  if (!trimmedRepo) {
    return "";
  }

  const segments = trimmedRepo
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 2) {
    return "";
  }

  return `https://github.com/${segments.map(encodeURIComponent).join("/")}`;
}

function buildGitHubCommitUrl(repo: string, commit: string): string {
  const repoUrl = buildGitHubRepoUrl(repo);
  const trimmedCommit = commit.trim();

  if (!repoUrl || !trimmedCommit) {
    return "";
  }

  return `${repoUrl}/commit/${encodeURIComponent(trimmedCommit)}`;
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
            csv: jobFilesResponseToCsv(r.filesData),
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

  if (cache && responseForCache && isCompletedJobStatus(r.filesData.status)) {
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
    csv: jobFilesResponseToCsv(r.filesData),
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
  const [compareData, setCompareData] = useState<LoadedCompareData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState("");

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

  const leftSummaryRepo = compareData?.left.repo || leftRepo || bothRepo;
  const leftSummaryCommit = compareData?.left.commit ?? leftCommit;
  const rightSummaryRepo = compareData?.right.repo || rightRepo || bothRepo;
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
      <div className="compare-summary">
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
              buildDownloadUrl(entry)
            }
            getRightDownloadUrl={(entry) =>
              buildDownloadUrl(entry)
            }
          />
        </div>
      )}
    </div>
  );
}
