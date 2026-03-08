import { useCallback, useEffect, useMemo, useState } from "react";
import { parseCsv, diffCsv, jobFilesResponseToCsv } from "../utils/csvParser";
import type { JobFilesResponse } from "../utils/csvParser";
import TreeDiffView from "../components/TreeDiffView";
import { sampleCsvLeft, sampleCsvRight } from "../data/sampleData";
import "./TreeComparePage.css";

const INDEXING_TRIGGER_URL =
  "http://localhost:12986/api/jobs/a11fe882-1f0c-4dd0-b2b9-3c031bfc4322";
const JOBS_BASE_URL = "http://localhost:12986/api/jobs";
const POLL_INTERVAL_MS = 2000;
const DEFAULT_JOB_STATUS = "waiting";
const TERMINAL_JOB_STATUSES = new Set([
  "cancelled",
  "completed",
  "error",
  "failed",
]);

type CompareSide = "left" | "right";

interface IndexingJobStartResponse {
  id?: string;
  status?: string;
}

interface IndexingJobStatusResponse {
  id: string;
  repo?: string;
  ref?: string;
  status?: string;
  progress?: number;
  total_files?: number;
  processed_files?: number;
  created_at?: string;
  updated_at?: string;
}

interface IndexingJobState extends IndexingJobStatusResponse {
  filesLoaded: number;
  filesUrl: string;
}

function buildJobFilesUrl(jobId: string): string {
  return `${JOBS_BASE_URL}/${jobId}/files`;
}

function isTerminalJobStatus(status?: string): boolean {
  return TERMINAL_JOB_STATUSES.has(status?.toLowerCase() ?? "");
}

export default function TreeComparePage() {
  const [leftInput, setLeftInput] = useState(sampleCsvLeft);
  const [rightInput, setRightInput] = useState(sampleCsvRight);
  const [leftEndpoint, setLeftEndpoint] = useState("");
  const [rightEndpoint, setRightEndpoint] = useState("");
  const [leftRepo, setLeftRepo] = useState("");
  const [rightRepo, setRightRepo] = useState("");
  const [leftRef, setLeftRef] = useState("main");
  const [rightRef, setRightRef] = useState("main");
  const [leftRoot, setLeftRoot] = useState("/");
  const [rightRoot, setRightRoot] = useState("/");
  const [leftLabel, setLeftLabel] = useState("Left");
  const [rightLabel, setRightLabel] = useState("Right");
  const [leftJob, setLeftJob] = useState<IndexingJobState | null>(null);
  const [rightJob, setRightJob] = useState<IndexingJobState | null>(null);
  const [leftIsStarting, setLeftIsStarting] = useState(false);
  const [rightIsStarting, setRightIsStarting] = useState(false);
  const [apiError, setApiError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [useNaturalSort, setUseNaturalSort] = useState(false);

  const diff = useMemo(() => {
    try {
      const leftEntries = parseCsv(leftInput, useNaturalSort);
      const rightEntries = parseCsv(rightInput, useNaturalSort);
      return diffCsv(
        leftEntries,
        rightEntries,
        leftRoot,
        rightRoot,
        useNaturalSort
      );
    } catch {
      return null;
    }
  }, [leftInput, rightInput, leftRoot, rightRoot, useNaturalSort]);


  const loadSample = () => {
    setLeftInput(sampleCsvLeft);
    setRightInput(sampleCsvRight);
    setLeftEndpoint("");
    setRightEndpoint("");
    setLeftJob(null);
    setRightJob(null);
    setLeftRoot("/");
    setRightRoot("/");
    setLeftLabel("Left");
    setRightLabel("Right");
    setApiError("");
  };

  const handleClear = () => {
    setLeftInput("");
    setRightInput("");
    setLeftEndpoint("");
    setRightEndpoint("");
    setLeftRepo("");
    setRightRepo("");
    setLeftRef("main");
    setRightRef("main");
    setLeftRoot("/");
    setRightRoot("/");
    setLeftJob(null);
    setRightJob(null);
    setApiError("");
    setLeftLabel("Left");
    setRightLabel("Right");
  };

  const applyFilesResponse = useCallback(
    (
      side: CompareSide,
      data: JobFilesResponse,
      fallbackJobId?: string
    ): number => {
      const csv = jobFilesResponseToCsv(data);
      const label = data.job_id ?? fallbackJobId;

      if (side === "left") {
        setLeftInput(csv);
        setLeftLabel(label ? `Left (${label})` : "Left");
      } else {
        setRightInput(csv);
        setRightLabel(label ? `Right (${label})` : "Right");
      }

      return Array.isArray(data.files) ? data.files.length : 0;
    },
    []
  );

  const pollIndexingJob = useCallback(
    async (side: CompareSide, currentJob: IndexingJobState) => {
      try {
        const [statusResult, filesResult] = await Promise.allSettled([
          fetch(`${JOBS_BASE_URL}/${currentJob.id}`),
          fetch(currentJob.filesUrl),
        ]);

        if (statusResult.status !== "fulfilled" || !statusResult.value.ok) {
          throw new Error("Unable to load job status");
        }

        const statusData =
          (await statusResult.value.json()) as IndexingJobStatusResponse;

        let filesLoaded = currentJob.filesLoaded;
        if (
          filesResult.status === "fulfilled" &&
          filesResult.value.ok
        ) {
          const filesData = (await filesResult.value.json()) as JobFilesResponse;
          filesLoaded = applyFilesResponse(
            side,
            filesData,
            statusData.id ?? currentJob.id
          );
        }

        const nextJob: IndexingJobState = {
          ...currentJob,
          ...statusData,
          repo: statusData.repo ?? currentJob.repo,
          ref: statusData.ref ?? currentJob.ref,
          status: statusData.status ?? currentJob.status,
          progress: statusData.progress ?? currentJob.progress,
          total_files: statusData.total_files ?? currentJob.total_files,
          processed_files:
            statusData.processed_files ?? currentJob.processed_files,
          created_at: statusData.created_at ?? currentJob.created_at,
          updated_at: statusData.updated_at ?? currentJob.updated_at,
          filesLoaded,
        };

        if (side === "left") {
          setLeftJob(nextJob);
        } else {
          setRightJob(nextJob);
        }
      } catch {
        setApiError(`Unable to refresh ${side} indexing job progress.`);
      }
    },
    [applyFilesResponse]
  );

  useEffect(() => {
    const activeJobs: Array<[CompareSide, IndexingJobState]> = [];

    if (leftJob && !isTerminalJobStatus(leftJob.status)) {
      activeJobs.push(["left", leftJob]);
    }

    if (rightJob && !isTerminalJobStatus(rightJob.status)) {
      activeJobs.push(["right", rightJob]);
    }

    if (activeJobs.length === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      activeJobs.forEach(([side, job]) => {
        void pollIndexingJob(side, job);
      });
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [leftJob, rightJob, pollIndexingJob]);

  const handleStartIndexing = async (side: CompareSide) => {
    const repo = (side === "left" ? leftRepo : rightRepo).trim();
    const ref = (side === "left" ? leftRef : rightRef).trim() || "main";

    if (!repo) {
      setApiError(`Enter the ${side} repository before starting indexing.`);
      return;
    }

    setApiError("");
    if (side === "left") {
      setLeftIsStarting(true);
    } else {
      setRightIsStarting(true);
    }

    try {
      const response = await fetch(INDEXING_TRIGGER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ repo, ref }),
      });

      if (!response.ok) {
        throw new Error("Unable to start indexing job");
      }

      const data = (await response.json()) as IndexingJobStartResponse;

      if (!data.id) {
        throw new Error("Missing job id");
      }

      const nextJob: IndexingJobState = {
        id: data.id,
        repo,
        ref,
        status: data.status ?? DEFAULT_JOB_STATUS,
        progress: 0,
        total_files: 0,
        processed_files: 0,
        created_at: "",
        updated_at: "",
        filesLoaded: 0,
        filesUrl: buildJobFilesUrl(data.id),
      };

      if (side === "left") {
        setLeftEndpoint(nextJob.filesUrl);
        setLeftInput("");
        setLeftLabel(`Left (${data.id})`);
        setLeftJob(nextJob);
      } else {
        setRightEndpoint(nextJob.filesUrl);
        setRightInput("");
        setRightLabel(`Right (${data.id})`);
        setRightJob(nextJob);
      }

      void pollIndexingJob(side, nextJob);
    } catch {
      setApiError(`Unable to start ${side} indexing job.`);
    } finally {
      if (side === "left") {
        setLeftIsStarting(false);
      } else {
        setRightIsStarting(false);
      }
    }
  };

  const handleLoadFromApi = async () => {
    const leftUrl = leftEndpoint.trim();
    const rightUrl = rightEndpoint.trim();

    if (!leftUrl || !rightUrl) {
      setApiError("Enter both left and right API endpoints.");
      return;
    }

    setIsLoading(true);
    setApiError("");

    try {
      const [leftResponse, rightResponse] = await Promise.all([
        fetch(leftUrl),
        fetch(rightUrl),
      ]);

      if (!leftResponse.ok || !rightResponse.ok) {
        throw new Error("Failed to load one or both endpoints.");
      }

      const [leftData, rightData] = await Promise.all([
        leftResponse.json(),
        rightResponse.json(),
      ]);

      applyFilesResponse("left", leftData);
      applyFilesResponse("right", rightData);
    } catch {
      setApiError("Unable to load job file lists from the provided endpoints.");
    } finally {
      setIsLoading(false);
    }
  };

  const renderJobStatus = (job: IndexingJobState | null) => {
    if (!job) {
      return null;
    }

    return (
      <div className="indexing-job-status">
        <div className="indexing-job-status__row">
          <span className="indexing-job-status__label">Job</span>
          <code>{job.id}</code>
        </div>
        <div className="indexing-job-status__row">
          <span className="indexing-job-status__label">Repository</span>
          <span>
            {job.repo}
            {job.ref ? ` @ ${job.ref}` : ""}
          </span>
        </div>
        <div className="indexing-job-status__row">
          <span className="indexing-job-status__label">Status</span>
          <span>{job.status ?? DEFAULT_JOB_STATUS}</span>
        </div>
        <div className="indexing-job-status__row">
          <span className="indexing-job-status__label">Progress</span>
          <span>{job.progress ?? 0}%</span>
        </div>
        <div className="indexing-job-status__row">
          <span className="indexing-job-status__label">Processed files</span>
          <span>
            {job.processed_files ?? 0}
            {job.total_files ? ` / ${job.total_files}` : ""}
          </span>
        </div>
        <div className="indexing-job-status__row">
          <span className="indexing-job-status__label">Files returned</span>
          <span>{job.filesLoaded}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="tree-compare-page">
      <div className="page-header">
        <h1>📂 Directory Comparison</h1>
        <p className="page-subtitle">
          Paste CSV data, start repository indexing jobs, or load two job file
          endpoints to compare directory structures side by side. Format:{" "}
          <code>type;path;size;timestamp;hash</code>
        </p>
      </div>

      <div className="sample-buttons">
        <button onClick={handleLoadFromApi} disabled={isLoading}>
          {isLoading ? "Loading..." : "Load from API"}
        </button>
        <button onClick={loadSample}>Load Sample</button>
        <button onClick={handleClear}>Clear</button>
      </div>

      <label className="sort-option" htmlFor="use-natural-sort">
        <input
          id="use-natural-sort"
          type="checkbox"
          checked={useNaturalSort}
          onChange={(e) => setUseNaturalSort(e.target.checked)}
        />
        Use natural sorting for both trees
      </label>

      {apiError && <div className="api-error">{apiError}</div>}

      <div className="input-panels">
        <div className="input-panel">
          <label htmlFor="left-repo">Left repository</label>
          <div className="indexing-controls">
            <input
              id="left-repo"
              type="text"
              value={leftRepo}
              onChange={(e) => setLeftRepo(e.target.value)}
              placeholder="Arkiv-Network/arkiv-op-geth"
              spellCheck={false}
            />
            <input
              id="left-ref"
              type="text"
              value={leftRef}
              onChange={(e) => setLeftRef(e.target.value)}
              placeholder="main"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => void handleStartIndexing("left")}
              disabled={leftIsStarting}
            >
              {leftIsStarting ? "Starting..." : "Start indexing"}
            </button>
          </div>
          {renderJobStatus(leftJob)}
          <label htmlFor="left-endpoint">Left API endpoint</label>
          <input
            id="left-endpoint"
            type="url"
            value={leftEndpoint}
            onChange={(e) => setLeftEndpoint(e.target.value)}
            placeholder="http://localhost:12986/api/jobs/<left-job-id>/files"
            spellCheck={false}
          />
          <label htmlFor="left-csv">Left</label>
          <textarea
            id="left-csv"
            value={leftInput}
            onChange={(e) => setLeftInput(e.target.value)}
            placeholder="Paste CSV data here..."
            spellCheck={false}
          />
        </div>
        <div className="input-panel">
          <label htmlFor="right-repo">Right repository</label>
          <div className="indexing-controls">
            <input
              id="right-repo"
              type="text"
              value={rightRepo}
              onChange={(e) => setRightRepo(e.target.value)}
              placeholder="Arkiv-Network/arkiv-op-geth"
              spellCheck={false}
            />
            <input
              id="right-ref"
              type="text"
              value={rightRef}
              onChange={(e) => setRightRef(e.target.value)}
              placeholder="main"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => void handleStartIndexing("right")}
              disabled={rightIsStarting}
            >
              {rightIsStarting ? "Starting..." : "Start indexing"}
            </button>
          </div>
          {renderJobStatus(rightJob)}
          <label htmlFor="right-endpoint">Right API endpoint</label>
          <input
            id="right-endpoint"
            type="url"
            value={rightEndpoint}
            onChange={(e) => setRightEndpoint(e.target.value)}
            placeholder="http://localhost:12986/api/jobs/<right-job-id>/files"
            spellCheck={false}
          />
          <label htmlFor="right-csv">Right</label>
          <textarea
            id="right-csv"
            value={rightInput}
            onChange={(e) => setRightInput(e.target.value)}
            placeholder="Paste CSV data here..."
            spellCheck={false}
          />
        </div>
      </div>

      {diff && (
        <div className="diff-result">
          <h2>Comparison Result</h2>
          <div className="compare-roots">
            <div className="compare-roots__field">
              <label htmlFor="left-root">Left root</label>
              <input
                id="left-root"
                type="text"
                value={leftRoot}
                onChange={(e) => setLeftRoot(e.target.value)}
                placeholder="/"
                spellCheck={false}
              />
            </div>
            <div className="compare-roots__field">
              <label htmlFor="right-root">Right root</label>
              <input
                id="right-root"
                type="text"
                value={rightRoot}
                onChange={(e) => setRightRoot(e.target.value)}
                placeholder="/"
                spellCheck={false}
              />
            </div>
          </div>
          <div className="diff-legend">
            <span className="legend-item legend-item--same">● Same</span>
            <span className="legend-item legend-item--added">● Added</span>
            <span className="legend-item legend-item--removed">● Removed</span>
            <span className="legend-item legend-item--modified">
              ● Modified
            </span>
          </div>
          <TreeDiffView
            left={diff.left}
            right={diff.right}
            leftLabel={leftLabel}
            rightLabel={rightLabel}
          />
        </div>
      )}
    </div>
  );
}
