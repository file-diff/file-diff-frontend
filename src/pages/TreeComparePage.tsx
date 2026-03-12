import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { parseCsv, diffCsv, jobFilesResponseToCsv } from "../utils/csvParser";
import type { DiffEntry, JobFilesResponse } from "../utils/csvParser";
import TreeDiffView from "../components/TreeDiffView";
import { sampleCsvLeft, sampleCsvRight } from "../data/sampleData";
import { buildJobFileDownloadUrl, JOBS_API_URL } from "../config/api";
import {
  buildComparePermalink,
  readLastSelectedParams,
  writeLastSelectedParams,
  readIndexingHistory,
  writeIndexingHistory,
} from "../utils/storage";
import type { CompareSide, StoredIndexingSideParams, IndexingHistoryEntry } from "../utils/storage";
import "./TreeComparePage.css";

const INDEXING_TRIGGER_URL = JOBS_API_URL;
const JOBS_BASE_URL = JOBS_API_URL;
const LIST_REFS_URL = `${JOBS_API_URL}/refs`;
const RESOLVE_COMMIT_URL = `${JOBS_API_URL}/resolve`;
const POLL_INTERVAL_MS = 2000;
const REFS_LOAD_DEBOUNCE_MS = 300;
const DEFAULT_JOB_STATUS = "waiting";
const DEFAULT_LEFT_REF = "main";
const DEFAULT_RIGHT_REF = "main";
const DEFAULT_LEFT_REPO = "file-diff/file-diff-test-data";
const DEFAULT_RIGHT_REPO = "file-diff/file-diff-test-data";

const DEFAULT_LEFT_ROOT = "/tree1";
const DEFAULT_RIGHT_ROOT = "/tree2";

const TERMINAL_JOB_STATUSES = new Set([
  "cancelled",
  "completed",
  "error",
  "failed",
]);


interface ListRefsRequest {
  repo: string;
}

interface JobRequest {
  repo: string;
  commit: string;
}

interface ResolveCommitRequest {
  repo: string;
  ref: string;
}

interface ErrorResponse {
  error: string;
}

type GitRefType = "branch" | "tag";

interface GitRefSummary {
  name: string;
  ref: string;
  type: GitRefType;
  commit: string;
  commitShort: string;
}

interface ListRefsResponse {
  repo: string;
  refs: GitRefSummary[];
}

interface ResolveCommitResponse {
  repo: string;
  ref: string;
  commit: string;
  commitShort: string;
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

interface IndexingJobState extends IndexingJobStatusResponse {
  filesLoaded: number;
  filesUrl: string;
  historyEntryId: string;
  inputRefName: string;
  resolvedCommit: string;
}


function buildJobFilesUrl(jobId: string): string {
  return `${JOBS_BASE_URL}/${jobId}/files`;
}

function extractJobIdFromFilesUrl(filesUrl: string): string {
  const match = filesUrl
    .trim()
    .match(/\/jobs\/([^/]+)\/files(?:[/?#]|$)/);

  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function isTerminalJobStatus(status?: string): boolean {
  return TERMINAL_JOB_STATUSES.has(status?.toLowerCase() ?? "");
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

function formatCommitSummary(commit: string): string {
  return `Commit ${commit.slice(0, 7)}.`;
}

function getTotalFiles(
  data: IndexingJobStartResponse | IndexingJobStatusResponse
): number | undefined {
  return data.totalFiles ?? data.total_files;
}

function getProcessedFiles(
  data: IndexingJobStartResponse | IndexingJobStatusResponse
): number | undefined {
  return data.processedFiles ?? data.processed_files;
}

function getCreatedAt(
  data: IndexingJobStartResponse | IndexingJobStatusResponse
): string | undefined {
  return data.createdAt ?? data.created_at;
}

function getUpdatedAt(
  data: IndexingJobStartResponse | IndexingJobStatusResponse
): string | undefined {
  return data.updatedAt ?? data.updated_at;
}


function buildStoredIndexingSideParams(params: {
  endpoint: string;
  inputRefName: string;
  job: IndexingJobState | null;
  provider: string;
  repo: string;
  resolvedCommit?: string;
  root: string;
}): StoredIndexingSideParams {
  const endpoint = params.endpoint.trim();

  return {
    repo: params.repo.trim(),
    inputRefName: params.inputRefName.trim(),
    resolvedCommit: params.job?.resolvedCommit?.trim() ?? params.resolvedCommit?.trim() ?? "",
    provider: params.provider.trim(),
    root: params.root.trim(),
    endpoint: endpoint || params.job?.filesUrl || "",
    jobId: params.job?.id ?? "",
    status: params.job?.status ?? "",
  };
}

function appendIndexingHistoryEntry(entry: IndexingHistoryEntry): void {
  writeIndexingHistory([...readIndexingHistory(), entry]);
}

function updateIndexingHistoryEntry(
  entryId: string,
  side: CompareSide,
  job: IndexingJobState
): void {
  const history = readIndexingHistory();

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.id !== entryId) {
      continue;
    }
    const sideEntry = entry[side];
    const updatedEntry = {
      ...entry,
      [side]: {
        ...sideEntry,
        endpoint: job.filesUrl || sideEntry.endpoint,
        inputRefName: job.inputRefName || sideEntry.inputRefName,
        jobId: job.id || sideEntry.jobId,
        resolvedCommit: job.resolvedCommit || sideEntry.resolvedCommit,
        status: job.status ?? sideEntry.status,
      },
    };

    history[index] = {
      ...updatedEntry,
      permalink: buildComparePermalink(updatedEntry.left, updatedEntry.right),
    };
    writeIndexingHistory(history);
    return;
  }
}

function setQueryParam(
  params: URLSearchParams,
  key: string,
  value: string,
  defaultValue = ""
): void {
  const normalizedValue = value.trim();

  if (!normalizedValue || normalizedValue === defaultValue) {
    params.delete(key);
    return;
  }

  params.set(key, normalizedValue);
}

function sortGitRefs(a: GitRefSummary, b: GitRefSummary): number {
  if (a.type !== b.type) {
    return a.type.localeCompare(b.type);
  }

  return a.name.localeCompare(b.name);
}

function isGitRefType(value: unknown): value is GitRefType {
  return value === "branch" || value === "tag";
}

function normalizeGitRefSummary(value: unknown): GitRefSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const name =
    typeof candidate.name === "string" ? candidate.name.trim() : "";
  const ref = typeof candidate.ref === "string" ? candidate.ref.trim() : "";

  if (!name || !ref || !isGitRefType(candidate.type)) {
    return null;
  }

  return {
    name,
    ref,
    type: candidate.type,
    commit:
      typeof candidate.commit === "string" ? candidate.commit.trim() : "",
    commitShort:
      typeof candidate.commitShort === "string"
        ? candidate.commitShort.trim()
        : "",
  };
}

async function requestResolvedCommit(
  repo: string,
  ref: string,
  signal?: AbortSignal
): Promise<ResolveCommitResponse> {
  const response = await fetch(RESOLVE_COMMIT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ repo, ref } satisfies ResolveCommitRequest),
    signal,
  });

  if (!response.ok) {
    let message = "Unable to resolve commit";

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  return (await response.json()) as ResolveCommitResponse;
}

function useRepositoryRefs(repo: string) {
  const [refs, setRefs] = useState<GitRefSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const normalizedRepo = repo.trim();

    if (!normalizedRepo) {
      setRefs([]);
      setIsLoading(false);
      setError("");
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      const loadRefs = async () => {
        setRefs([]);
        setIsLoading(true);
        setError("");

        try {
          const response = await fetch(LIST_REFS_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ repo: normalizedRepo } satisfies ListRefsRequest),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error("Unable to load refs");
          }

          const data = (await response.json()) as ListRefsResponse;
          const nextRefs = Array.isArray(data.refs)
            ? data.refs
                .map(normalizeGitRefSummary)
                .filter((value): value is GitRefSummary => value !== null)
                .sort(sortGitRefs)
            : [];

          setRefs(nextRefs);
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }

          setRefs([]);
          setError(
            error instanceof Error && error.message
              ? error.message
              : "Unable to load refs"
          );
        } finally {
          if (!controller.signal.aborted) {
            setIsLoading(false);
          }
        }
      };

      void loadRefs();
    }, REFS_LOAD_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [repo]);

  return { refs, isLoading, error };
}

function useResolvedCommit(repo: string, ref: string) {
  const [commit, setCommit] = useState("");
  const [commitShort, setCommitShort] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const normalizedRepo = repo.trim();
    const normalizedRef = ref.trim();

    if (!normalizedRepo || !normalizedRef) {
      setCommit("");
      setCommitShort("");
      setIsLoading(false);
      setError("");
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      const loadCommit = async () => {
        setCommit("");
        setCommitShort("");
        setIsLoading(true);
        setError("");

        try {
          const data = await requestResolvedCommit(
            normalizedRepo,
            normalizedRef,
            controller.signal
          );
          setCommit(data.commit.trim());
          setCommitShort(data.commitShort.trim());
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }

          setCommit("");
          setCommitShort("");
          setError(
            error instanceof Error && error.message
              ? error.message
              : "Unable to resolve commit"
          );
        } finally {
          if (!controller.signal.aborted) {
            setIsLoading(false);
          }
        }
      };

      void loadCommit();
    }, REFS_LOAD_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [repo, ref]);

  return { commit, commitShort, isLoading, error };
}

export default function TreeComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentSearch = searchParams.toString();
  const { leftProvider, rightProvider } = useMemo(() => {
    const params = new URLSearchParams(currentSearch);
    const defaultProvider = params.get("provider")?.trim() ?? "";

    return {
      leftProvider: params.get("leftProvider")?.trim() || defaultProvider,
      rightProvider: params.get("rightProvider")?.trim() || defaultProvider,
    };
  }, [currentSearch]);
  const savedParams = useRef(readLastSelectedParams());
  const [leftInput, setLeftInput] = useState(sampleCsvLeft);
  const [rightInput, setRightInput] = useState(sampleCsvRight);
  const [leftEndpoint, setLeftEndpoint] = useState("");
  const [rightEndpoint, setRightEndpoint] = useState("");
  const [leftRepo, setLeftRepo] = useState(
    () =>
      searchParams.get("leftRepo")?.trim() ||
      savedParams.current?.leftRepo ||
      DEFAULT_LEFT_REPO
  );
  const [rightRepo, setRightRepo] = useState(
    () =>
      searchParams.get("rightRepo")?.trim() ||
      savedParams.current?.rightRepo ||
      DEFAULT_RIGHT_REPO
  );
  const [leftRef, setLeftRef] = useState(
    () =>
      searchParams.get("leftRef")?.trim() ||
      savedParams.current?.leftRef ||
      DEFAULT_LEFT_REF
  );
  const [rightRef, setRightRef] = useState(
    () =>
      searchParams.get("rightRef")?.trim() ||
      savedParams.current?.rightRef ||
      DEFAULT_RIGHT_REF
  );
  const [leftRoot, setLeftRoot] = useState(
    () =>
      searchParams.get("leftRoot")?.trim() ||
      savedParams.current?.leftRoot ||
      DEFAULT_LEFT_ROOT
  );
  const [rightRoot, setRightRoot] = useState(
    () =>
      searchParams.get("rightRoot")?.trim() ||
      savedParams.current?.rightRoot ||
      DEFAULT_RIGHT_ROOT
  );
  const [leftLabel, setLeftLabel] = useState("Left");
  const [rightLabel, setRightLabel] = useState("Right");
  const [leftPinnedCommit, setLeftPinnedCommit] = useState(
    () => searchParams.get("leftCommit")?.trim() || ""
  );
  const [rightPinnedCommit, setRightPinnedCommit] = useState(
    () => searchParams.get("rightCommit")?.trim() || ""
  );
  const [leftJob, setLeftJob] = useState<IndexingJobState | null>(null);
  const [rightJob, setRightJob] = useState<IndexingJobState | null>(null);
  const [leftIsStarting, setLeftIsStarting] = useState(false);
  const [rightIsStarting, setRightIsStarting] = useState(false);
  const [apiError, setApiError] = useState("");
  const [useNaturalSort, setUseNaturalSort] = useState(
    () => savedParams.current?.useNaturalSort ?? false
  );
  const leftRefsState = useRepositoryRefs(leftRepo);
  const rightRefsState = useRepositoryRefs(rightRepo);
  const leftResolvedCommitState = useResolvedCommit(leftRepo, leftRef);
  const rightResolvedCommitState = useResolvedCommit(rightRepo, rightRef);
  const leftCurrentCommit =
    leftJob?.resolvedCommit || leftPinnedCommit || leftResolvedCommitState.commit;
  const rightCurrentCommit =
    rightJob?.resolvedCommit || rightPinnedCommit || rightResolvedCommitState.commit;
  const leftDownloadJobId = leftJob?.id || extractJobIdFromFilesUrl(leftEndpoint);
  const rightDownloadJobId =
    rightJob?.id || extractJobIdFromFilesUrl(rightEndpoint);

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

  useEffect(() => {
    const nextParams = new URLSearchParams(currentSearch);
    setQueryParam(nextParams, "leftRepo", leftRepo);
    setQueryParam(nextParams, "rightRepo", rightRepo);
    setQueryParam(nextParams, "leftRef", leftRef);
    setQueryParam(nextParams, "rightRef", rightRef);
    setQueryParam(nextParams, "leftCommit", leftCurrentCommit);
    setQueryParam(nextParams, "rightCommit", rightCurrentCommit);
    setQueryParam(nextParams, "leftRoot", leftRoot);
    setQueryParam(nextParams, "rightRoot", rightRoot);

    if (nextParams.toString() !== currentSearch) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    currentSearch,
    leftCurrentCommit,
    leftRepo,
    leftRef,
    leftRoot,
    rightCurrentCommit,
    rightRepo,
    rightRef,
    rightRoot,
    setSearchParams,
  ]);

  useEffect(() => {
    writeLastSelectedParams({
      leftRepo,
      rightRepo,
      leftRef,
      rightRef,
      leftRoot,
      rightRoot,
      useNaturalSort,
    });
  }, [leftRepo, rightRepo, leftRef, rightRef, leftRoot, rightRoot, useNaturalSort]);

  const loadSample = () => {
    setLeftInput(sampleCsvLeft);
    setRightInput(sampleCsvRight);
    setLeftEndpoint("");
    setRightEndpoint("");
    setLeftJob(null);
    setRightJob(null);
    setLeftRoot(DEFAULT_LEFT_ROOT);
    setRightRoot(DEFAULT_RIGHT_ROOT);
    setLeftPinnedCommit("");
    setRightPinnedCommit("");
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
    setLeftRef(DEFAULT_LEFT_REF);
    setRightRef(DEFAULT_RIGHT_REF);
    setLeftRoot(DEFAULT_LEFT_ROOT);
    setRightRoot(DEFAULT_RIGHT_ROOT);
    setLeftPinnedCommit("");
    setRightPinnedCommit("");
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
      const label = data.jobId ?? data.job_id ?? fallbackJobId;

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
          total_files: getTotalFiles(statusData) ?? getTotalFiles(currentJob),
          processed_files:
            getProcessedFiles(statusData) ?? getProcessedFiles(currentJob),
          created_at: getCreatedAt(statusData) ?? getCreatedAt(currentJob),
          updated_at: getUpdatedAt(statusData) ?? getUpdatedAt(currentJob),
          error: statusData.error ?? currentJob.error,
          historyEntryId: currentJob.historyEntryId,
          inputRefName: currentJob.inputRefName,
          resolvedCommit:
            extractResolvedCommit(statusData) || currentJob.resolvedCommit,
          filesLoaded,
        };

        updateIndexingHistoryEntry(currentJob.historyEntryId, side, nextJob);

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
    const ref = (side === "left" ? leftRef : rightRef).trim();
    const currentCommit = side === "left" ? leftCurrentCommit : rightCurrentCommit;

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

    const historyEntryId = crypto.randomUUID();
    const leftHistorySide = buildStoredIndexingSideParams({
      repo: leftRepo,
      inputRefName: leftRef,
      provider: leftProvider,
      root: leftRoot,
      resolvedCommit: leftCurrentCommit,
      endpoint: side === "left" ? "" : leftEndpoint,
      job: side === "left" ? null : leftJob,
    });
    const rightHistorySide = buildStoredIndexingSideParams({
      repo: rightRepo,
      inputRefName: rightRef,
      provider: rightProvider,
      root: rightRoot,
      resolvedCommit: rightCurrentCommit,
      endpoint: side === "right" ? "" : rightEndpoint,
      job: side === "right" ? null : rightJob,
    });
    appendIndexingHistoryEntry({
      id: historyEntryId,
      permalink: buildComparePermalink(leftHistorySide, rightHistorySide),
      storedAt: new Date().toISOString(),
      startedSide: side,
      useNaturalSort,
      left: leftHistorySide,
      right: rightHistorySide,
    });

    try {
      const resolvedCommit = currentCommit
        ? {
            repo,
            ref,
            commit: currentCommit,
            commitShort: currentCommit.slice(0, 7),
          }
        : await requestResolvedCommit(repo, ref);
      const payload: JobRequest = {
        repo,
        commit: resolvedCommit.commit,
      };

      const response = await fetch(INDEXING_TRIGGER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
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
        repo: data.repo ?? repo,
        ref,
        status: data.status ?? DEFAULT_JOB_STATUS,
        progress: data.progress ?? 0,
        total_files: getTotalFiles(data) ?? 0,
        processed_files: getProcessedFiles(data) ?? 0,
        created_at: getCreatedAt(data) ?? "",
        updated_at: getUpdatedAt(data) ?? "",
        error: data.error,
        filesLoaded: 0,
        filesUrl: buildJobFilesUrl(data.id),
        historyEntryId,
        inputRefName: ref,
        resolvedCommit: extractResolvedCommit(data) || resolvedCommit.commit,
      };

      if (side === "left") {
        setLeftPinnedCommit(nextJob.resolvedCommit);
      } else {
        setRightPinnedCommit(nextJob.resolvedCommit);
      }

      updateIndexingHistoryEntry(historyEntryId, side, nextJob);

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

  const buildDownloadUrl = useCallback(
    (jobId: string, entry: DiffEntry): string => {
      if (!jobId || entry.fileType === "d" || !entry.hash || entry.hash === "N/A") {
        return "";
      }

      return buildJobFileDownloadUrl(jobId, entry.hash);
    },
    []
  );


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
          <span>{job.repo}</span>
        </div>
        <div className="indexing-job-status__row">
          <span className="indexing-job-status__label">Ref</span>
          <span>{job.inputRefName || job.ref || "—"}</span>
        </div>
        <div className="indexing-job-status__row">
          <span className="indexing-job-status__label">Commit</span>
          {job.resolvedCommit ? <code>{job.resolvedCommit}</code> : <span>—</span>}
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
        {job.error ? (
          <div className="indexing-job-status__row" role="alert">
            <span className="indexing-job-status__label">Error</span>
            <span>{job.error}</span>
          </div>
        ) : null}
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
              onChange={(e) => {
                setLeftRepo(e.target.value);
                setLeftPinnedCommit("");
                setLeftEndpoint("");
                setLeftJob(null);
              }}
              placeholder="Arkiv-Network/arkiv-op-geth"
              spellCheck={false}
            />
            <input
              id="left-ref"
              type="text"
              value={leftRef}
              list="left-ref-options"
              onChange={(e) => {
                setLeftRef(e.target.value);
                setLeftPinnedCommit("");
                setLeftEndpoint("");
                setLeftJob(null);
              }}
              placeholder="main"
              spellCheck={false}
            />
            <input
              id="left-commit"
              type="text"
              value={leftCurrentCommit}
              placeholder="Resolved commit SHA"
              readOnly
              spellCheck={false}
            />
            <datalist id="left-ref-options">
              {leftRefsState.refs.map((refOption) => (
                <option
                  key={refOption.ref}
                  value={refOption.name}
                  label={`${refOption.name} (${refOption.type}${refOption.commitShort ? ` · ${refOption.commitShort}` : ""})`}
                />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => void handleStartIndexing("left")}
              disabled={leftIsStarting}
            >
              {leftIsStarting ? "Starting..." : "Start indexing"}
            </button>
          </div>
          <div className="indexing-controls__hint" aria-live="polite">
            {leftResolvedCommitState.isLoading
                ? "Resolving full commit SHA…"
              : leftResolvedCommitState.error
                ? leftResolvedCommitState.error
                : leftCurrentCommit
                  ? formatCommitSummary(leftCurrentCommit)
                  : leftRefsState.isLoading
                    ? "Loading available refs…"
                    : leftRefsState.error
                      ? "Unable to load available refs for this repository."
                      : leftRefsState.refs.length > 0
                        ? `Select from ${leftRefsState.refs.length} branches and tags or enter any ref manually.`
                        : "Enter any branch, tag, or commit. Matching refs will appear here when available."}
          </div>
          {renderJobStatus(leftJob)}
          <label htmlFor="left-endpoint">Left API endpoint</label>
          <input
            id="left-endpoint"
            type="url"
            value={leftEndpoint}
            onChange={(e) => setLeftEndpoint(e.target.value)}
            placeholder={`${JOBS_API_URL}/<left-job-id>/files`}
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
              onChange={(e) => {
                setRightRepo(e.target.value);
                setRightPinnedCommit("");
                setRightEndpoint("");
                setRightJob(null);
              }}
              placeholder="Arkiv-Network/arkiv-op-geth"
              spellCheck={false}
            />
            <input
              id="right-ref"
              type="text"
              value={rightRef}
              list="right-ref-options"
              onChange={(e) => {
                setRightRef(e.target.value);
                setRightPinnedCommit("");
                setRightEndpoint("");
                setRightJob(null);
              }}
              placeholder="main"
              spellCheck={false}
            />
            <input
              id="right-commit"
              type="text"
              value={rightCurrentCommit}
              placeholder="Resolved commit SHA"
              readOnly
              spellCheck={false}
            />
            <datalist id="right-ref-options">
              {rightRefsState.refs.map((refOption) => (
                <option
                  key={refOption.ref}
                  value={refOption.name}
                  label={`${refOption.name} (${refOption.type}${refOption.commitShort ? ` · ${refOption.commitShort}` : ""})`}
                />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => void handleStartIndexing("right")}
              disabled={rightIsStarting}
            >
              {rightIsStarting ? "Starting..." : "Start indexing"}
            </button>
          </div>
          <div className="indexing-controls__hint" aria-live="polite">
            {rightResolvedCommitState.isLoading
                ? "Resolving full commit SHA…"
              : rightResolvedCommitState.error
                ? rightResolvedCommitState.error
                : rightCurrentCommit
                  ? formatCommitSummary(rightCurrentCommit)
                  : rightRefsState.isLoading
                    ? "Loading available refs…"
                    : rightRefsState.error
                      ? "Unable to load available refs for this repository."
                      : rightRefsState.refs.length > 0
                        ? `Select from ${rightRefsState.refs.length} branches and tags or enter any ref manually.`
                        : "Enter any branch, tag, or commit. Matching refs will appear here when available."}
          </div>
          {renderJobStatus(rightJob)}
          <label htmlFor="right-endpoint">Right API endpoint</label>
          <input
            id="right-endpoint"
            type="url"
            value={rightEndpoint}
            onChange={(e) => setRightEndpoint(e.target.value)}
            placeholder={`${JOBS_API_URL}/<right-job-id>/files`}
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
            slots={diff}
            leftLabel={leftLabel}
            rightLabel={rightLabel}
            getLeftDownloadUrl={(entry) => buildDownloadUrl(leftDownloadJobId, entry)}
            getRightDownloadUrl={(entry) =>
              buildDownloadUrl(rightDownloadJobId, entry)
            }
          />
        </div>
      )}
    </div>
  );
}
