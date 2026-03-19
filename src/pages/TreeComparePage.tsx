import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { parseCsv, diffCsv, jobFilesResponseToCsv } from "../utils/csvParser";
import type { DiffEntry, JobFilesResponse } from "../utils/csvParser";
import RepositoryCommitSelector from "../components/RepositoryCommitSelector";
import OrganizationBrowserPopup from "../components/OrganizationBrowserPopup";
import type { OrganizationBrowserResult } from "../components/OrganizationBrowserPopup";
import PullRequestPopup from "../components/PullRequestPopup";
import type { PullRequestPopupResult } from "../components/PullRequestPopup";
import {
  requestResolvedCommit,
  useRepositoryRefs,
  useResolvedCommit,
} from "../utils/repositorySelection";
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
const POLL_INTERVAL_MS = 2000;
const DEFAULT_JOB_STATUS = "waiting";
const DEFAULT_LEFT_REF = "main";
const DEFAULT_RIGHT_REF = "main";
const DEFAULT_LEFT_REPO = "file-diff/file-diff-test-data";
const DEFAULT_RIGHT_REPO = "file-diff/file-diff-test-data";

const DEFAULT_LEFT_ROOT = "/";
const DEFAULT_RIGHT_ROOT = "/";

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
      permalink: buildComparePermalink(updatedEntry.left, updatedEntry.right, {
        useDifferentRoots: entry.useDifferentRoots,
        useNaturalSort: entry.useNaturalSort,
      }),
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

function setBooleanQueryParam(
  params: URLSearchParams,
  key: string,
  value: boolean
): void {
  if (!value) {
    params.delete(key);
    return;
  }

  params.set(key, "1");
}

function readBooleanQueryParam(value: string | null): boolean | undefined {
  if (value === null) {
    return undefined;
  }

  if (value === "1" || value.toLowerCase() === "true") {
    return true;
  }

  if (value === "0" || value.toLowerCase() === "false") {
    return false;
  }

  return undefined;
}

export default function TreeComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isClearRequest = searchParams.get("clear") === "1";
  const currentSearch = searchParams.toString();
  const { leftProvider, rightProvider } = useMemo(() => {
    const params = new URLSearchParams(currentSearch);
    const defaultProvider = params.get("provider")?.trim() ?? "";

    return {
      leftProvider: params.get("leftProvider")?.trim() || defaultProvider,
      rightProvider: params.get("rightProvider")?.trim() || defaultProvider,
    };
  }, [currentSearch]);
  const savedParams = useRef(isClearRequest ? null : readLastSelectedParams());
  const initialLeftRoot =
    searchParams.get("leftRoot")?.trim() ||
    savedParams.current?.leftRoot ||
    DEFAULT_LEFT_ROOT;
  const initialRightRoot =
    searchParams.get("rightRoot")?.trim() ||
    savedParams.current?.rightRoot ||
    DEFAULT_RIGHT_ROOT;
  const [leftInput, setLeftInput] = useState(isClearRequest ? "" : sampleCsvLeft);
  const [rightInput, setRightInput] = useState(isClearRequest ? "" : sampleCsvRight);
  const [leftEndpoint, setLeftEndpoint] = useState("");
  const [rightEndpoint, setRightEndpoint] = useState("");
  const [leftRepo, setLeftRepo] = useState(
    () =>
      isClearRequest
        ? ""
        : searchParams.get("leftRepo")?.trim() ||
          savedParams.current?.leftRepo ||
          DEFAULT_LEFT_REPO
  );
  const [rightRepo, setRightRepo] = useState(
    () =>
      isClearRequest
        ? ""
        : searchParams.get("rightRepo")?.trim() ||
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
  const [leftRoot, setLeftRoot] = useState(() => initialLeftRoot);
  const [rightRoot, setRightRoot] = useState(() => initialRightRoot);
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
  const [orgBrowserSide, setOrgBrowserSide] = useState<CompareSide | null>(null);
  const [isPullRequestPopupOpen, setIsPullRequestPopupOpen] = useState(false);
  const [pendingPullRequestSelection, setPendingPullRequestSelection] =
    useState<PullRequestPopupResult | null>(null);
  const [apiError, setApiError] = useState("");
  const [useNaturalSort, setUseNaturalSort] = useState(() => {
    if (isClearRequest) {
      return false;
    }

    return (
      readBooleanQueryParam(searchParams.get("useNaturalSort")) ??
      savedParams.current?.useNaturalSort ??
      false
    );
  });
  const [useDifferentRoots, setUseDifferentRoots] = useState(() => {
    if (isClearRequest) {
      return false;
    }

    const initialParamValue = readBooleanQueryParam(
      searchParams.get("useDifferentRoots")
    );
    if (typeof initialParamValue === "boolean") {
      return initialParamValue;
    }

    if (typeof savedParams.current?.useDifferentRoots === "boolean") {
      return savedParams.current.useDifferentRoots;
    }

    return (
      initialLeftRoot !== DEFAULT_LEFT_ROOT ||
      initialRightRoot !== DEFAULT_RIGHT_ROOT
    );
  });
  const [showDetails, setShowDetails] = useState(false);
  const skipInitialPersistRef = useRef(isClearRequest);
  const initialAutoIndexTargets = useRef({
    left: {
      repo: isClearRequest
        ? ""
        : (
            searchParams.get("leftRepo")?.trim() ||
            savedParams.current?.leftRepo ||
            DEFAULT_LEFT_REPO
          ).trim(),
      ref: isClearRequest
        ? DEFAULT_LEFT_REF
        : (
            searchParams.get("leftRef")?.trim() ||
            savedParams.current?.leftRef ||
            DEFAULT_LEFT_REF
          ).trim(),
    },
    right: {
      repo: isClearRequest
        ? ""
        : (
            searchParams.get("rightRepo")?.trim() ||
            savedParams.current?.rightRepo ||
            DEFAULT_RIGHT_REPO
          ).trim(),
      ref: isClearRequest
        ? DEFAULT_RIGHT_REF
        : (
            searchParams.get("rightRef")?.trim() ||
            savedParams.current?.rightRef ||
            DEFAULT_RIGHT_REF
          ).trim(),
    },
  });
  const autoIndexStartedKeys = useRef<{ left: string | null; right: string | null }>({
    left: null,
    right: null,
  });
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
  const activeLeftRoot = useDifferentRoots ? leftRoot : DEFAULT_LEFT_ROOT;
  const activeRightRoot = useDifferentRoots ? rightRoot : DEFAULT_RIGHT_ROOT;

  const diff = useMemo(() => {
    try {
      const leftEntries = parseCsv(leftInput, useNaturalSort);
      const rightEntries = parseCsv(rightInput, useNaturalSort);
      return diffCsv(
        leftEntries,
        rightEntries,
        activeLeftRoot,
        activeRightRoot,
        useNaturalSort
      );
    } catch {
      return null;
    }
  }, [activeLeftRoot, activeRightRoot, leftInput, rightInput, useNaturalSort]);

  useEffect(() => {
    const nextParams = new URLSearchParams(currentSearch);
    nextParams.delete("clear");
    setQueryParam(nextParams, "leftRepo", leftRepo);
    setQueryParam(nextParams, "rightRepo", rightRepo);
    setQueryParam(nextParams, "leftRef", leftRef, DEFAULT_LEFT_REF);
    setQueryParam(nextParams, "rightRef", rightRef, DEFAULT_RIGHT_REF);
    setQueryParam(nextParams, "leftCommit", leftCurrentCommit);
    setQueryParam(nextParams, "rightCommit", rightCurrentCommit);
    setQueryParam(nextParams, "leftRoot", activeLeftRoot, DEFAULT_LEFT_ROOT);
    setQueryParam(nextParams, "rightRoot", activeRightRoot, DEFAULT_RIGHT_ROOT);
    setBooleanQueryParam(nextParams, "useDifferentRoots", useDifferentRoots);
    setBooleanQueryParam(nextParams, "useNaturalSort", useNaturalSort);

    if (nextParams.toString() !== currentSearch) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    currentSearch,
    leftCurrentCommit,
    leftRepo,
    leftRef,
    activeLeftRoot,
    rightCurrentCommit,
    rightRepo,
    rightRef,
    activeRightRoot,
    setSearchParams,
    useDifferentRoots,
    useNaturalSort,
  ]);

  useEffect(() => {
    if (skipInitialPersistRef.current) {
      skipInitialPersistRef.current = false;
      return;
    }

    writeLastSelectedParams({
      leftRepo,
      rightRepo,
      leftRef,
      rightRef,
      leftRoot: activeLeftRoot,
      rightRoot: activeRightRoot,
      useDifferentRoots,
      useNaturalSort,
    });
  }, [
    activeLeftRoot,
    activeRightRoot,
    leftRef,
    leftRepo,
    rightRef,
    rightRepo,
    useDifferentRoots,
    useNaturalSort,
  ]);

  const loadSample = () => {
    setLeftInput(sampleCsvLeft);
    setRightInput(sampleCsvRight);
    setLeftEndpoint("");
    setRightEndpoint("");
    setLeftJob(null);
    setRightJob(null);
    setLeftRoot(DEFAULT_LEFT_ROOT);
    setRightRoot(DEFAULT_RIGHT_ROOT);
    setUseDifferentRoots(false);
    setLeftPinnedCommit("");
    setRightPinnedCommit("");
    setLeftLabel("Left");
    setRightLabel("Right");
    setApiError("");
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


  const handleStartIndexing = useCallback(
    async (
      side: CompareSide,
      override?: { repo: string; ref: string; commit: string }
    ) => {
      const repo = override?.repo ?? (side === "left" ? leftRepo : rightRepo).trim();
      const ref = override?.ref ?? (side === "left" ? leftRef : rightRef).trim();
      const currentCommit =
        override?.commit ?? (side === "left" ? leftCurrentCommit : rightCurrentCommit);

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
        root: activeLeftRoot,
        resolvedCommit: leftCurrentCommit,
        endpoint: side === "left" ? "" : leftEndpoint,
        job: side === "left" ? null : leftJob,
      });
      const rightHistorySide = buildStoredIndexingSideParams({
        repo: rightRepo,
        inputRefName: rightRef,
        provider: rightProvider,
        root: activeRightRoot,
        resolvedCommit: rightCurrentCommit,
        endpoint: side === "right" ? "" : rightEndpoint,
        job: side === "right" ? null : rightJob,
      });
      appendIndexingHistoryEntry({
        id: historyEntryId,
        permalink: buildComparePermalink(leftHistorySide, rightHistorySide, {
          useDifferentRoots,
          useNaturalSort,
        }),
        storedAt: new Date().toISOString(),
        startedSide: side,
        useDifferentRoots,
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
    },
    [
      leftCurrentCommit,
      leftEndpoint,
      leftJob,
      leftProvider,
      leftRef,
      leftRepo,
      activeLeftRoot,
      pollIndexingJob,
      rightCurrentCommit,
      rightEndpoint,
      rightJob,
      rightProvider,
      rightRef,
      rightRepo,
      activeRightRoot,
      useDifferentRoots,
      useNaturalSort,
    ]
  );

  useEffect(() => {
    const initialTarget = initialAutoIndexTargets.current.left;
    const currentRepo = leftRepo.trim();
    const currentRef = leftRef.trim();
    const currentCommit = leftCurrentCommit.trim();
    const autoIndexKey =
      initialTarget.repo && initialTarget.ref && currentCommit
        ? `${initialTarget.repo}\n${initialTarget.ref}\n${currentCommit}`
        : "";

    if (
      !autoIndexKey ||
      autoIndexStartedKeys.current.left === autoIndexKey ||
      leftIsStarting ||
      leftJob ||
      currentRepo !== initialTarget.repo ||
      currentRef !== initialTarget.ref
    ) {
      return;
    }

    autoIndexStartedKeys.current.left = autoIndexKey;
    void handleStartIndexing("left", {
      repo: currentRepo,
      ref: currentRef,
      commit: currentCommit,
    });
  }, [handleStartIndexing, leftCurrentCommit, leftIsStarting, leftJob, leftRef, leftRepo]);

  useEffect(() => {
    const initialTarget = initialAutoIndexTargets.current.right;
    const currentRepo = rightRepo.trim();
    const currentRef = rightRef.trim();
    const currentCommit = rightCurrentCommit.trim();
    const autoIndexKey =
      initialTarget.repo && initialTarget.ref && currentCommit
        ? `${initialTarget.repo}\n${initialTarget.ref}\n${currentCommit}`
        : "";

    if (
      !autoIndexKey ||
      autoIndexStartedKeys.current.right === autoIndexKey ||
      rightIsStarting ||
      rightJob ||
      currentRepo !== initialTarget.repo ||
      currentRef !== initialTarget.ref
    ) {
      return;
    }

    autoIndexStartedKeys.current.right = autoIndexKey;
    void handleStartIndexing("right", {
      repo: currentRepo,
      ref: currentRef,
      commit: currentCommit,
    });
  }, [
    handleStartIndexing,
    rightCurrentCommit,
    rightIsStarting,
    rightJob,
    rightRef,
    rightRepo,
  ]);

  useEffect(() => {
    if (!pendingPullRequestSelection) {
      return;
    }

    setPendingPullRequestSelection(null);

    void handleStartIndexing("left", {
      repo: pendingPullRequestSelection.repo,
      ref: pendingPullRequestSelection.targetCommit,
      commit: pendingPullRequestSelection.targetCommit,
    });
    void handleStartIndexing("right", {
      repo: pendingPullRequestSelection.repo,
      ref: pendingPullRequestSelection.sourceCommit,
      commit: pendingPullRequestSelection.sourceCommit,
    });
  }, [handleStartIndexing, pendingPullRequestSelection]);

  const buildDownloadUrl = useCallback(
    (jobId: string, entry: DiffEntry): string => {
      if (!jobId || entry.fileType === "d" || !entry.hash || entry.hash === "N/A") {
        return "";
      }

      return buildJobFileDownloadUrl(jobId, entry.hash);
    },
    []
  );

  const handleOrgBrowserSelect = (result: OrganizationBrowserResult) => {
    const side = orgBrowserSide;
    if (!side) return;

    setOrgBrowserSide(null);

    if (side === "left") {
      setLeftRepo(result.repo);
      setLeftRef(result.ref);
      setLeftPinnedCommit(result.commit);
      setLeftEndpoint("");
      setLeftJob(null);
    } else {
      setRightRepo(result.repo);
      setRightRef(result.ref);
      setRightPinnedCommit(result.commit);
      setRightEndpoint("");
      setRightJob(null);
    }

    void handleStartIndexing(side, {
      repo: result.repo,
      ref: result.ref,
      commit: result.commit,
    });
  };

  const handlePullRequestSelect = (result: PullRequestPopupResult) => {
    setIsPullRequestPopupOpen(false);
    setApiError("");
    setLeftRepo(result.repo);
    setRightRepo(result.repo);
    setLeftRef(result.targetCommit);
    setRightRef(result.sourceCommit);
    setLeftPinnedCommit(result.targetCommit);
    setRightPinnedCommit(result.sourceCommit);
    setLeftEndpoint("");
    setRightEndpoint("");
    setLeftJob(null);
    setRightJob(null);
    setLeftInput("");
    setRightInput("");
    setLeftLabel(`Left (${result.targetCommitShort})`);
    setRightLabel(`Right (${result.sourceCommitShort})`);
    setPendingPullRequestSelection(result);
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

      <div className="action-buttons">
        <button
          type="button"
          className="browse-org-button"
          onClick={() => setOrgBrowserSide("left")}
        >
          Browse left repository…
        </button>
        <button
          type="button"
          className="browse-org-button"
          onClick={() => setOrgBrowserSide("right")}
        >
          Browse right repository…
        </button>
        <button type="button" onClick={() => setIsPullRequestPopupOpen(true)}>
          Resolve pull request…
        </button>
      </div>

      <div className="compare-summary">
        <div className="compare-summary__side">
          <span className="compare-summary__label">Left</span>
          <span className="compare-summary__repo">{leftRepo || "—"}</span>
          <code className="compare-summary__commit">
            {leftCurrentCommit ? leftCurrentCommit.slice(0, 12) : "—"}
          </code>
        </div>
        <div className="compare-summary__side">
          <span className="compare-summary__label">Right</span>
          <span className="compare-summary__repo">{rightRepo || "—"}</span>
          <code className="compare-summary__commit">
            {rightCurrentCommit ? rightCurrentCommit.slice(0, 12) : "—"}
          </code>
        </div>
      </div>

      <label className="sort-option" htmlFor="show-details">
        <input
          id="show-details"
          type="checkbox"
          checked={showDetails}
          onChange={(e) => setShowDetails(e.target.checked)}
        />
        Show details
      </label>

      {showDetails && (
        <>
          <div className="sample-buttons">
            <button onClick={loadSample}>Load Sample</button>
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
              <RepositoryCommitSelector
                label="Left repository"
                repoInputId="left-repo"
                refInputId="left-ref"
                commitInputId="left-commit"
                refOptionsId="left-ref-options"
                repoValue={leftRepo}
                refValue={leftRef}
                currentCommit={leftCurrentCommit}
                refsState={leftRefsState}
                resolvedCommitState={leftResolvedCommitState}
                isStarting={leftIsStarting}
                job={leftJob}
                repoPlaceholder="Arkiv-Network/arkiv-op-geth"
                onRepoChange={(value) => {
                  setLeftRepo(value);
                  setLeftPinnedCommit("");
                  setLeftEndpoint("");
                  setLeftJob(null);
                }}
                onRefChange={(value) => {
                  setLeftRef(value);
                  setLeftPinnedCommit("");
                  setLeftEndpoint("");
                  setLeftJob(null);
                }}
                onStartIndexing={() => void handleStartIndexing("left")}
              />
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
              <RepositoryCommitSelector
                label="Right repository"
                repoInputId="right-repo"
                refInputId="right-ref"
                commitInputId="right-commit"
                refOptionsId="right-ref-options"
                repoValue={rightRepo}
                refValue={rightRef}
                currentCommit={rightCurrentCommit}
                refsState={rightRefsState}
                resolvedCommitState={rightResolvedCommitState}
                isStarting={rightIsStarting}
                job={rightJob}
                repoPlaceholder="Arkiv-Network/arkiv-op-geth"
                onRepoChange={(value) => {
                  setRightRepo(value);
                  setRightPinnedCommit("");
                  setRightEndpoint("");
                  setRightJob(null);
                }}
                onRefChange={(value) => {
                  setRightRef(value);
                  setRightPinnedCommit("");
                  setRightEndpoint("");
                  setRightJob(null);
                }}
                onStartIndexing={() => void handleStartIndexing("right")}
              />
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
        </>
      )}

      {diff && (
        <div className="diff-result">
          <h2>Comparison Result</h2>
          <label
            className="sort-option compare-roots__toggle"
            htmlFor="use-different-roots"
          >
            <input
              id="use-different-roots"
              type="checkbox"
              checked={useDifferentRoots}
              onChange={(e) => {
                const { checked } = e.target;
                setUseDifferentRoots(checked);
                if (!checked) {
                  setLeftRoot(DEFAULT_LEFT_ROOT);
                  setRightRoot(DEFAULT_RIGHT_ROOT);
                }
              }}
            />
            Use different roots
          </label>
          {useDifferentRoots && (
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
          )}
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

      <OrganizationBrowserPopup
        open={orgBrowserSide !== null}
        onClose={() => setOrgBrowserSide(null)}
        onSelect={handleOrgBrowserSelect}
      />
      <PullRequestPopup
        open={isPullRequestPopupOpen}
        onClose={() => setIsPullRequestPopupOpen(false)}
        onSelect={handlePullRequestSelect}
      />
    </div>
  );
}
