import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { parseCsv, diffCsv, jobFilesResponseToCsv } from "../utils/csvParser";
import type { DiffEntry, JobFilesResponse } from "../utils/csvParser";
import TreeDiffView from "../components/TreeDiffView";
import { buildJobFileDownloadUrl, JOBS_API_URL } from "../config/api";
import "./TreeComparePage2.css";

const JOBS_BASE_URL = JOBS_API_URL;
const POLL_INTERVAL_MS = 2000;
const DEFAULT_JOB_STATUS = "waiting";

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
  ref?: string;
  status?: string;
  progress?: number;
  total_files?: number;
  totalFiles?: number;
  processed_files?: number;
  processedFiles?: number;
  error?: string;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  commit?: string;
  commitShort?: string;
  commit_sha?: string;
  commitSha?: string;
  resolved_commit?: string;
  resolvedCommit?: string;
  sha?: string;
}

interface IndexingJobStatusResponse {
  id: string;
  repo?: string;
  ref?: string;
  status?: string;
  progress?: number;
  total_files?: number;
  totalFiles?: number;
  processed_files?: number;
  processedFiles?: number;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  error?: string;
  commit?: string;
  commitShort?: string;
  commit_sha?: string;
  commitSha?: string;
  resolved_commit?: string;
  resolvedCommit?: string;
  sha?: string;
}

interface SideState {
  repo: string;
  commit: string;
  jobId: string;
  jobStatus: string;
  csv: string;
  filesLoaded: boolean;
  error: string;
  totalFiles: number;
  processedFiles: number;
}

function isTerminalJobStatus(status: string): boolean {
  return TERMINAL_JOB_STATUSES.has(status.toLowerCase());
}

function extractResolvedCommit(
  data: IndexingJobStartResponse | IndexingJobStatusResponse
): string {
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

function getTotalFiles(
  data: IndexingJobStartResponse | IndexingJobStatusResponse
): number {
  return data.totalFiles ?? data.total_files ?? 0;
}

function getProcessedFiles(
  data: IndexingJobStartResponse | IndexingJobStatusResponse
): number {
  return data.processedFiles ?? data.processed_files ?? 0;
}

function buildJobFilesUrl(jobId: string): string {
  return `${JOBS_BASE_URL}/${jobId}/files`;
}

function createInitialSideState(repo: string, commit: string): SideState {
  return {
    repo,
    commit,
    jobId: "",
    jobStatus: "",
    csv: "",
    filesLoaded: false,
    error: "",
    totalFiles: 0,
    processedFiles: 0,
  };
}

export default function TreeComparePage2() {
  const [searchParams] = useSearchParams();

  const leftRepo = searchParams.get("leftRepo")?.trim() ?? "";
  const leftCommit = searchParams.get("leftCommit")?.trim() ?? "";
  const rightRepo = searchParams.get("rightRepo")?.trim() ?? "";
  const rightCommit = searchParams.get("rightCommit")?.trim() ?? "";

  const [left, setLeft] = useState<SideState>(() =>
    createInitialSideState(leftRepo, leftCommit)
  );
  const [right, setRight] = useState<SideState>(() =>
    createInitialSideState(rightRepo, rightCommit)
  );

  const startedRef = useRef(false);

  const startIndexingJob = useCallback(
    async (
      repo: string,
      commit: string,
      setSide: React.Dispatch<React.SetStateAction<SideState>>
    ) => {
      try {
        const payload: JobRequest = { repo, commit };
        const response = await fetch(JOBS_BASE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Failed to start indexing job (${response.status})`);
        }

        const data = (await response.json()) as IndexingJobStartResponse;

        if (!data.id) {
          throw new Error("Missing job id in response");
        }

        const resolvedCommit = extractResolvedCommit(data) || commit;

        setSide((prev) => ({
          ...prev,
          jobId: data.id!,
          jobStatus: data.status ?? DEFAULT_JOB_STATUS,
          commit: resolvedCommit,
          totalFiles: getTotalFiles(data),
          processedFiles: getProcessedFiles(data),
        }));
      } catch (err) {
        setSide((prev) => ({
          ...prev,
          error:
            err instanceof Error
              ? err.message
              : "Failed to start indexing job",
        }));
      }
    },
    []
  );

  useEffect(() => {
    if (startedRef.current) return;
    if (!leftRepo || !leftCommit || !rightRepo || !rightCommit) return;

    startedRef.current = true;

    void startIndexingJob(leftRepo, leftCommit, setLeft);
    void startIndexingJob(rightRepo, rightCommit, setRight);
  }, [leftRepo, leftCommit, rightRepo, rightCommit, startIndexingJob]);

  const pollSide = useCallback(
    async (side: SideState, setSide: React.Dispatch<React.SetStateAction<SideState>>) => {
      if (!side.jobId || isTerminalJobStatus(side.jobStatus)) return;

      try {
        const [statusResult, filesResult] = await Promise.allSettled([
          fetch(`${JOBS_BASE_URL}/${side.jobId}`),
          fetch(buildJobFilesUrl(side.jobId)),
        ]);

        if (statusResult.status !== "fulfilled" || !statusResult.value.ok) {
          throw new Error("Unable to load job status");
        }

        const statusData =
          (await statusResult.value.json()) as IndexingJobStatusResponse;

        let csv = side.csv;
        let filesLoaded = side.filesLoaded;

        if (filesResult.status === "fulfilled" && filesResult.value.ok) {
          const filesData =
            (await filesResult.value.json()) as JobFilesResponse;
          csv = jobFilesResponseToCsv(filesData);
          filesLoaded =
            Array.isArray(filesData.files) && filesData.files.length > 0;
        }

        setSide((prev) => ({
          ...prev,
          jobStatus: statusData.status ?? prev.jobStatus,
          totalFiles: getTotalFiles(statusData) || prev.totalFiles,
          processedFiles: getProcessedFiles(statusData) || prev.processedFiles,
          commit: extractResolvedCommit(statusData) || prev.commit,
          error: statusData.error ?? prev.error,
          csv,
          filesLoaded,
        }));
      } catch {
        /* keep polling on transient errors */
      }
    },
    []
  );

  useEffect(() => {
    const needsPollLeft = left.jobId && !isTerminalJobStatus(left.jobStatus);
    const needsPollRight = right.jobId && !isTerminalJobStatus(right.jobStatus);

    if (!needsPollLeft && !needsPollRight) return;

    const intervalId = window.setInterval(() => {
      if (left.jobId && !isTerminalJobStatus(left.jobStatus)) {
        void pollSide(left, setLeft);
      }
      if (right.jobId && !isTerminalJobStatus(right.jobStatus)) {
        void pollSide(right, setRight);
      }
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [left, right, pollSide]);

  const diff = useMemo(() => {
    if (!left.filesLoaded || !right.filesLoaded) return null;

    try {
      const leftEntries = parseCsv(left.csv, true);
      const rightEntries = parseCsv(right.csv, true);
      return diffCsv(leftEntries, rightEntries, "/", "/", true);
    } catch {
      return null;
    }
  }, [left.csv, left.filesLoaded, right.csv, right.filesLoaded]);

  const buildDownloadUrl = useCallback(
    (jobId: string, entry: DiffEntry): string => {
      if (
        !jobId ||
        entry.fileType === "d" ||
        !entry.hash ||
        entry.hash === "N/A"
      ) {
        return "";
      }
      return buildJobFileDownloadUrl(jobId, entry.hash);
    },
    []
  );

  const missingParams = !leftRepo || !leftCommit || !rightRepo || !rightCommit;

  if (missingParams) {
    return (
      <div className="tree-compare2-page">
        <div className="tree-compare2-error">
          Missing required URL parameters. Expected:{" "}
          <code>?leftRepo=…&leftCommit=…&rightRepo=…&rightCommit=…</code>
        </div>
      </div>
    );
  }

  const leftError = left.error;
  const rightError = right.error;

  if (leftError || rightError) {
    return (
      <div className="tree-compare2-page">
        {leftError && <div className="tree-compare2-error">Left: {leftError}</div>}
        {rightError && <div className="tree-compare2-error">Right: {rightError}</div>}
      </div>
    );
  }

  if (!diff) {
    const leftProgress =
      left.totalFiles > 0
        ? `${left.processedFiles}/${left.totalFiles}`
        : left.jobStatus || "starting…";
    const rightProgress =
      right.totalFiles > 0
        ? `${right.processedFiles}/${right.totalFiles}`
        : right.jobStatus || "starting…";

    return (
      <div className="tree-compare2-page">
        <div className="tree-compare2-loading">
          <div className="tree-compare2-loading__title">
            Loading file trees…
          </div>
          <div className="tree-compare2-loading__sides">
            <div className="tree-compare2-loading__side">
              <span className="tree-compare2-loading__label">Left</span>
              <span className="tree-compare2-loading__repo">{leftRepo}</span>
              <code className="tree-compare2-loading__commit">
                {left.commit.slice(0, 12) || leftCommit.slice(0, 12)}
              </code>
              <span className="tree-compare2-loading__status">
                {leftProgress}
              </span>
            </div>
            <div className="tree-compare2-loading__side">
              <span className="tree-compare2-loading__label">Right</span>
              <span className="tree-compare2-loading__repo">{rightRepo}</span>
              <code className="tree-compare2-loading__commit">
                {right.commit.slice(0, 12) || rightCommit.slice(0, 12)}
              </code>
              <span className="tree-compare2-loading__status">
                {rightProgress}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const leftLabel = `Left (${left.commit.slice(0, 7)})`;
  const rightLabel = `Right (${right.commit.slice(0, 7)})`;

  return (
    <div className="tree-compare2-page">
      <div className="compare-summary">
        <div className="compare-summary__side">
          <span className="compare-summary__label">Left</span>
          <span className="compare-summary__repo">{leftRepo}</span>
          <code className="compare-summary__commit">
            {left.commit.slice(0, 12)}
          </code>
        </div>
        <div className="compare-summary__side">
          <span className="compare-summary__label">Right</span>
          <span className="compare-summary__repo">{rightRepo}</span>
          <code className="compare-summary__commit">
            {right.commit.slice(0, 12)}
          </code>
        </div>
      </div>

      <div className="diff-legend">
        <span className="legend-item legend-item--same">● Same</span>
        <span className="legend-item legend-item--added">● Added</span>
        <span className="legend-item legend-item--removed">● Removed</span>
        <span className="legend-item legend-item--modified">● Modified</span>
      </div>

      <TreeDiffView
        slots={diff}
        leftLabel={leftLabel}
        rightLabel={rightLabel}
        getLeftDownloadUrl={(entry) => buildDownloadUrl(left.jobId, entry)}
        getRightDownloadUrl={(entry) => buildDownloadUrl(right.jobId, entry)}
      />
    </div>
  );
}
