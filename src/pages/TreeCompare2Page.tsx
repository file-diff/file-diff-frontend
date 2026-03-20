import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import TreeDiffView from "../components/TreeDiffView";
import { buildJobFileDownloadUrl, JOBS_API_URL } from "../config/api";
import { diffCsv, jobFilesResponseToCsv, parseCsv } from "../utils/csvParser";
import type { DiffEntry, JobFilesResponse } from "../utils/csvParser";
import "./TreeComparePage.css";
import "./TreeCompare2Page.css";

const POLL_INTERVAL_MS = 1500;
const TERMINAL_JOB_STATUSES = new Set([
  "cancelled",
  "completed",
  "error",
  "failed",
]);

interface JobRequest {
  repo: string;
  commit: string;
}

interface IndexingJobStartResponse {
  id?: string;
  repo?: string;
  status?: string;
  error?: string;
  commit?: string;
  commit_sha?: string;
  commitSha?: string;
  resolved_commit?: string;
  resolvedCommit?: string;
  sha?: string;
}

interface IndexingJobStatusResponse {
  id?: string;
  repo?: string;
  status?: string;
  error?: string;
  commit?: string;
  commit_sha?: string;
  commitSha?: string;
  resolved_commit?: string;
  resolvedCommit?: string;
  sha?: string;
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

function buildJobFilesUrl(jobId: string): string {
  return `${JOBS_API_URL}/${encodeURIComponent(jobId)}/files`;
}

function buildJobStatusUrl(jobId: string): string {
  return `${JOBS_API_URL}/${encodeURIComponent(jobId)}`;
}

function isTerminalJobStatus(status?: string): boolean {
  return TERMINAL_JOB_STATUSES.has(status?.toLowerCase() ?? "");
}

function extractResolvedCommit(
  data: IndexingJobStartResponse | IndexingJobStatusResponse | null | undefined
): string {
  if (!data) {
    return "";
  }

  const candidates = [
    data.resolvedCommit,
    data.resolved_commit,
    data.commitSha,
    data.commit_sha,
    data.commit,
    data.sha,
  ];

  return (
    candidates.find(
      (value): value is string => typeof value === "string" && value.trim() !== ""
    )?.trim() ?? ""
  );
}

function extractErrorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message.trim()) {
    return value.message.trim();
  }

  return fallback;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(resolve, ms);

    const handleAbort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    if (signal.aborted) {
      handleAbort();
      return;
    }

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

async function startIndexingJob(
  request: JobRequest,
  signal: AbortSignal
): Promise<IndexingJobStartResponse> {
  const response = await fetch(JOBS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    let message = `Unable to start indexing job for ${request.repo}.`;

    try {
      const errorData = (await response.json()) as { error?: string };
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  return (await response.json()) as IndexingJobStartResponse;
}

async function loadCompareSide(
  side: "left" | "right",
  request: JobRequest,
  signal: AbortSignal
): Promise<LoadedCompareSide> {
  const startedJob = await startIndexingJob(request, signal);
  const jobId = startedJob.id?.trim();

  if (!jobId) {
    throw new Error(`Missing ${side} job id.`);
  }

  const filesUrl = buildJobFilesUrl(jobId);
  const statusUrl = buildJobStatusUrl(jobId);
  const initialResolvedCommit = extractResolvedCommit(startedJob) || request.commit;

  while (true) {
    const [statusResult, filesResult] = await Promise.allSettled([
      fetch(statusUrl, { signal }),
      fetch(filesUrl, { signal }),
    ]);

    let statusData: IndexingJobStatusResponse | null = null;
    if (statusResult.status === "fulfilled") {
      if (!statusResult.value.ok) {
        throw new Error(`Unable to load ${side} job status.`);
      }

      statusData = (await statusResult.value.json()) as IndexingJobStatusResponse;
    } else if (statusResult.reason instanceof DOMException && statusResult.reason.name === "AbortError") {
      throw statusResult.reason;
    } else {
      throw new Error(`Unable to load ${side} job status.`);
    }

    if (filesResult.status === "fulfilled" && filesResult.value.ok) {
      const filesData = (await filesResult.value.json()) as JobFilesResponse;
      const csv = jobFilesResponseToCsv(filesData);

      return {
        repo: statusData.repo?.trim() || startedJob.repo?.trim() || request.repo,
        commit:
          extractResolvedCommit(statusData) ||
          extractResolvedCommit(startedJob) ||
          initialResolvedCommit,
        csv,
        jobId,
        label: `${side === "left" ? "Left" : "Right"} (${jobId})`,
      };
    }

    if (filesResult.status === "rejected") {
      if (
        filesResult.reason instanceof DOMException &&
        filesResult.reason.name === "AbortError"
      ) {
        throw filesResult.reason;
      }
    }

    if (isTerminalJobStatus(statusData.status)) {
      throw new Error(
        statusData.error?.trim() || `Unable to load ${side} files for job ${jobId}.`
      );
    }

    await delay(POLL_INTERVAL_MS, signal);
  }
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
    if (!jobId || entry.fileType === "d" || !entry.hash || entry.hash === "N/A") {
      return "";
    }

    return buildJobFileDownloadUrl(jobId, entry.hash);
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
          Loading indexed files for both repositories…
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
