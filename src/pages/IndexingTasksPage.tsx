import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildIndexTaskStatusUrl } from "../config/api";
import {
  buildHistoryEntryPermalink,
  readIndexingHistory,
  clearIndexingHistory,
} from "../utils/storage";
import type {
  IndexingHistoryEntry,
  StoredIndexingSideParams,
} from "../utils/storage";
import "./IndexingTasksPage.css";

const AUTO_REFRESH_INTERVAL_MS = 15_000;
const SHORT_ID_LENGTH = 12;

type IndexingTaskStatus =
  | "waiting"
  | "active"
  | "completed"
  | "failed"
  | "unknown";

type StatusFilter = "all" | IndexingTaskStatus;

interface KnownIndexingTask {
  jobId: string;
  repo: string;
  inputRefName: string;
  resolvedCommit: string;
  storedStatus: string;
  storedAt: string;
  historyEntry: IndexingHistoryEntry;
}

interface LiveTaskState {
  status: IndexingTaskStatus;
  progress?: number;
  totalFiles?: number;
  processedFiles?: number;
  error?: string;
  commitShort?: string;
  repo?: string;
  fetchError?: string;
  notFound?: boolean;
  fetchedAt: string;
}

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "failed", label: "Failed" },
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "waiting", label: "Waiting" },
  { value: "completed", label: "Completed" },
  { value: "unknown", label: "Unknown" },
];

function normalizeStatus(value: unknown): IndexingTaskStatus {
  if (typeof value !== "string") {
    return "unknown";
  }
  const lower = value.trim().toLowerCase();
  if (
    lower === "waiting" ||
    lower === "active" ||
    lower === "completed" ||
    lower === "failed"
  ) {
    return lower;
  }
  return "unknown";
}

function statusClassName(status: IndexingTaskStatus): string {
  return `indexing-tasks-page__status indexing-tasks-page__status--${status}`;
}

function formatDateSafe(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return dateStr;
    return date.toLocaleString();
  } catch {
    return dateStr;
  }
}

function formatProgress(state: LiveTaskState | undefined): string {
  if (!state) return "—";
  const { processedFiles, totalFiles, progress } = state;
  if (typeof processedFiles === "number" && typeof totalFiles === "number") {
    return `${String(processedFiles)} / ${String(totalFiles)}`;
  }
  if (typeof progress === "number" && Number.isFinite(progress)) {
    const pct = progress <= 1 ? progress * 100 : progress;
    return `${pct.toFixed(0)}%`;
  }
  return "—";
}

function shortHash(value: string): string {
  return value && value.length > SHORT_ID_LENGTH
    ? `${value.slice(0, SHORT_ID_LENGTH)}…`
    : value;
}

function collectKnownTasks(
  history: IndexingHistoryEntry[]
): KnownIndexingTask[] {
  const seen = new Map<string, KnownIndexingTask>();
  for (const entry of history) {
    for (const side of [entry.left, entry.right] as StoredIndexingSideParams[]) {
      const jobId = side.jobId?.trim();
      if (!jobId) continue;
      const existing = seen.get(jobId);
      const candidate: KnownIndexingTask = {
        jobId,
        repo: side.repo,
        inputRefName: side.inputRefName,
        resolvedCommit: side.resolvedCommit,
        storedStatus: side.status,
        storedAt: entry.storedAt,
        historyEntry: entry,
      };
      if (!existing || existing.storedAt < entry.storedAt) {
        seen.set(jobId, candidate);
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.storedAt === b.storedAt) {
      return a.jobId.localeCompare(b.jobId);
    }
    return a.storedAt < b.storedAt ? 1 : -1;
  });
}

async function fetchTaskStatus(
  jobId: string,
  signal: AbortSignal
): Promise<LiveTaskState> {
  const fetchedAt = new Date().toISOString();
  try {
    const response = await fetch(buildIndexTaskStatusUrl(jobId), { signal });
    if (response.status === 404) {
      return {
        status: "unknown",
        notFound: true,
        fetchedAt,
      };
    }
    if (!response.ok) {
      return {
        status: "unknown",
        fetchError: `HTTP ${String(response.status)} ${response.statusText}`.trim(),
        fetchedAt,
      };
    }
    const body = (await response.json()) as Record<string, unknown>;
    const state: LiveTaskState = {
      status: normalizeStatus(body.status),
      fetchedAt,
    };
    if (typeof body.progress === "number") state.progress = body.progress;
    if (typeof body.totalFiles === "number") state.totalFiles = body.totalFiles;
    if (typeof body.processedFiles === "number") {
      state.processedFiles = body.processedFiles;
    }
    if (typeof body.error === "string" && body.error.trim()) {
      state.error = body.error.trim();
    }
    if (typeof body.commitShort === "string") state.commitShort = body.commitShort;
    if (typeof body.repo === "string") state.repo = body.repo;
    return state;
  } catch (err) {
    if (signal.aborted) throw err;
    return {
      status: "unknown",
      fetchError:
        err instanceof Error && err.message
          ? err.message
          : "Unable to fetch task status",
      fetchedAt,
    };
  }
}

export default function IndexingTasksPage() {
  const [history, setHistory] = useState<IndexingHistoryEntry[]>(() =>
    readIndexingHistory()
  );
  const [liveStates, setLiveStates] = useState<Record<string, LiveTaskState>>(
    {}
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("failed");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const knownTasks = useMemo(() => collectKnownTasks(history), [history]);

  const refresh = useCallback(async () => {
    // Defer any state updates past the current render so synchronous
    // callers (e.g. effects) don't trigger cascading renders.
    await Promise.resolve();
    abortRef.current?.abort();
    if (knownTasks.length === 0) {
      setLiveStates({});
      setLastRefreshedAt(new Date().toISOString());
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);

    const results = await Promise.all(
      knownTasks.map(async (task) => {
        try {
          const state = await fetchTaskStatus(task.jobId, controller.signal);
          return [task.jobId, state] as const;
        } catch {
          return null;
        }
      })
    );

    if (controller.signal.aborted) {
      return;
    }

    setLiveStates(() => {
      const next: Record<string, LiveTaskState> = {};
      for (const result of results) {
        if (!result) continue;
        next[result[0]] = result[1];
      }
      return next;
    });
    setLastRefreshedAt(new Date().toISOString());
    setIsLoading(false);
  }, [knownTasks]);

  useEffect(() => {
    // refresh() defers all state updates via `await Promise.resolve()`,
    // so this trigger never causes synchronous cascading renders.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      void refresh();
    }, AUTO_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, refresh]);

  const handleClearHistory = useCallback(() => {
    const confirmed = window.confirm(
      "Remove all locally-recorded indexing tasks? This only clears the history stored in this browser."
    );
    if (!confirmed) return;
    clearIndexingHistory();
    setHistory([]);
    setLiveStates({});
  }, []);

  const handleRefreshClick = useCallback(() => {
    setHistory(readIndexingHistory());
    void refresh();
  }, [refresh]);

  const filteredTasks = useMemo(() => {
    if (statusFilter === "all") return knownTasks;
    return knownTasks.filter((task) => {
      const live = liveStates[task.jobId];
      const status = live ? live.status : normalizeStatus(task.storedStatus);
      return status === statusFilter;
    });
  }, [knownTasks, liveStates, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<IndexingTaskStatus, number> = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      unknown: 0,
    };
    for (const task of knownTasks) {
      const live = liveStates[task.jobId];
      const status = live ? live.status : normalizeStatus(task.storedStatus);
      counts[status] += 1;
    }
    return counts;
  }, [knownTasks, liveStates]);

  return (
    <div className="indexing-tasks-page">
      <div className="page-header">
        <h1>🧩 Indexing Tasks</h1>
        <p className="page-subtitle">
          Live status of file-indexing tasks recorded by this browser. Helpful
          for diagnosing failing indexing jobs.
        </p>
      </div>

      <div className="indexing-tasks-page__toolbar">
        <div className="indexing-tasks-page__filters">
          {STATUS_FILTERS.map((filter) => {
            const count =
              filter.value === "all"
                ? knownTasks.length
                : statusCounts[filter.value];
            const isActive = filter.value === statusFilter;
            return (
              <button
                key={filter.value}
                type="button"
                className={
                  "indexing-tasks-page__filter-btn" +
                  (isActive
                    ? " indexing-tasks-page__filter-btn--active"
                    : "")
                }
                onClick={() => setStatusFilter(filter.value)}
              >
                {filter.label}
                <span className="indexing-tasks-page__filter-count">
                  {String(count)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="indexing-tasks-page__actions">
          <label className="indexing-tasks-page__auto-refresh">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh every 15s
          </label>
          <button
            type="button"
            className="indexing-tasks-page__refresh-btn"
            onClick={handleRefreshClick}
            disabled={isLoading}
          >
            {isLoading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="indexing-tasks-page__clear-btn"
            onClick={handleClearHistory}
            disabled={knownTasks.length === 0}
          >
            Clear history
          </button>
        </div>
      </div>

      {lastRefreshedAt && (
        <div className="indexing-tasks-page__last-refreshed">
          Last refreshed: {formatDateSafe(lastRefreshedAt)}
        </div>
      )}

      {knownTasks.length === 0 ? (
        <div className="indexing-tasks-page__empty">
          <div className="indexing-tasks-page__empty-icon">📭</div>
          <h2>No indexing tasks recorded</h2>
          <p>
            Start a directory comparison to enqueue indexing jobs. This page
            polls each known task’s live status from the backend.
          </p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="indexing-tasks-page__empty indexing-tasks-page__empty--compact">
          <p>
            No tasks match the <strong>{statusFilter}</strong> filter.
          </p>
        </div>
      ) : (
        <div className="indexing-tasks-page__list">
          {filteredTasks.map((task) => {
            const live = liveStates[task.jobId];
            const status: IndexingTaskStatus = live
              ? live.status
              : normalizeStatus(task.storedStatus);
            const permalink = buildHistoryEntryPermalink(task.historyEntry);
            const repo = live?.repo || task.repo;
            const commitShort =
              live?.commitShort ||
              (task.resolvedCommit
                ? task.resolvedCommit.slice(0, 7)
                : task.jobId.slice(0, 7));

            return (
              <div
                key={task.jobId}
                className={
                  "indexing-tasks-page__row" +
                  (status === "failed"
                    ? " indexing-tasks-page__row--failed"
                    : "")
                }
              >
                <div className="indexing-tasks-page__row-main">
                  <div className="indexing-tasks-page__row-header">
                    <span className={statusClassName(status)}>{status}</span>
                    <span className="indexing-tasks-page__repo">
                      {repo || "—"}
                    </span>
                    {task.inputRefName && (
                      <span className="indexing-tasks-page__ref">
                        @{task.inputRefName}
                      </span>
                    )}
                    <code className="indexing-tasks-page__commit">
                      {commitShort}
                    </code>
                  </div>
                  <div className="indexing-tasks-page__row-meta">
                    <span title={task.jobId}>
                      Job: <code>{shortHash(task.jobId)}</code>
                    </span>
                    <span>Progress: {formatProgress(live)}</span>
                    <span>Recorded: {formatDateSafe(task.storedAt)}</span>
                    {live?.fetchedAt && (
                      <span>Checked: {formatDateSafe(live.fetchedAt)}</span>
                    )}
                  </div>
                  {live?.error && (
                    <div className="indexing-tasks-page__error">
                      <strong>Error:</strong> {live.error}
                    </div>
                  )}
                  {live?.fetchError && (
                    <div className="indexing-tasks-page__warning">
                      Status request failed: {live.fetchError}
                    </div>
                  )}
                  {live?.notFound && (
                    <div className="indexing-tasks-page__warning">
                      Task not found on the backend (it may have been
                      deleted).
                    </div>
                  )}
                </div>
                <div className="indexing-tasks-page__row-actions">
                  <a
                    className="indexing-tasks-page__row-link"
                    href={permalink}
                  >
                    Open compare
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
