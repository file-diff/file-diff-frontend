import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeIndexingTaskStatus,
  requestIndexingTasks,
} from "../utils/indexingTasks";
import type {
  IndexingTaskStatus,
  IndexingTaskSummary,
} from "../utils/indexingTasks";
import "./IndexingTasksPage.css";

const AUTO_REFRESH_INTERVAL_MS = 15_000;
const SHORT_ID_LENGTH = 12;

type StatusFilter = "all" | IndexingTaskStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "failed", label: "Failed" },
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "waiting", label: "Waiting" },
  { value: "completed", label: "Completed" },
  { value: "unknown", label: "Unknown" },
];

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

function formatProgress(task: IndexingTaskSummary): string {
  const { processedFiles, totalFiles, progress } = task;
  if (typeof processedFiles === "number" && typeof totalFiles === "number") {
    return `${String(processedFiles)} / ${String(totalFiles)}`;
  }
  if (typeof progress === "number" && Number.isFinite(progress)) {
    const pct = progress <= 1 ? progress * 100 : progress;
    return `${pct.toFixed(0)}%`;
  }
  return "-";
}

function shortHash(value: string): string {
  return value && value.length > SHORT_ID_LENGTH
    ? `${value.slice(0, SHORT_ID_LENGTH)}...`
    : value;
}

function getTaskTimestamp(task: IndexingTaskSummary): string {
  return task.updatedAt || task.createdAt;
}

export default function IndexingTasksPage() {
  const [tasks, setTasks] = useState<IndexingTaskSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("failed");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError("");

    try {
      const nextTasks = await requestIndexingTasks(controller.signal);

      if (controller.signal.aborted) {
        return;
      }

      setTasks(nextTasks);
      setLastRefreshedAt(new Date().toISOString());
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }

      setError(
        err instanceof Error && err.message
          ? err.message
          : "Unable to load indexing tasks"
      );
      setTasks([]);
    } finally {
      if (abortRef.current === controller) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
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

  const handleRefreshClick = useCallback(() => {
    void refresh();
  }, [refresh]);

  const filteredTasks = useMemo(() => {
    if (statusFilter === "all") return tasks;
    return tasks.filter((task) => task.status === statusFilter);
  }, [tasks, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<IndexingTaskStatus, number> = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      unknown: 0,
    };

    for (const task of tasks) {
      counts[normalizeIndexingTaskStatus(task.status)] += 1;
    }

    return counts;
  }, [tasks]);

  return (
    <div className="indexing-tasks-page">
      <div className="page-header">
        <h1>🧩 Indexing Tasks</h1>
        <p className="page-subtitle">
          Live file-indexing tasks reported by the backend. Helpful for
          diagnosing failing indexing jobs.
        </p>
      </div>

      <div className="indexing-tasks-page__toolbar">
        <div className="indexing-tasks-page__filters">
          {STATUS_FILTERS.map((filter) => {
            const count =
              filter.value === "all"
                ? tasks.length
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
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {lastRefreshedAt && (
        <div className="indexing-tasks-page__last-refreshed">
          Last refreshed: {formatDateSafe(lastRefreshedAt)}
        </div>
      )}

      {error && (
        <div className="indexing-tasks-page__warning" role="alert">
          Unable to load backend indexing tasks: {error}
        </div>
      )}

      {!error && tasks.length === 0 ? (
        <div className="indexing-tasks-page__empty">
          <div className="indexing-tasks-page__empty-icon">📭</div>
          <h2>No indexing tasks found</h2>
          <p>
            Start a directory comparison to enqueue indexing jobs. This page
            loads the task list from the backend.
          </p>
        </div>
      ) : !error && filteredTasks.length === 0 ? (
        <div className="indexing-tasks-page__empty indexing-tasks-page__empty--compact">
          <p>
            No tasks match the <strong>{statusFilter}</strong> filter.
          </p>
        </div>
      ) : !error ? (
        <div className="indexing-tasks-page__list">
          {filteredTasks.map((task) => {
            const timestamp = getTaskTimestamp(task);
            const commitLabel =
              task.commitShort ||
              (task.commit ? task.commit.slice(0, 7) : task.id.slice(0, 7));

            return (
              <div
                key={task.id}
                className={
                  "indexing-tasks-page__row" +
                  (task.status === "failed"
                    ? " indexing-tasks-page__row--failed"
                    : "")
                }
              >
                <div className="indexing-tasks-page__row-main">
                  <div className="indexing-tasks-page__row-header">
                    <span className={statusClassName(task.status)}>
                      {task.status}
                    </span>
                    <span className="indexing-tasks-page__repo">
                      {task.repo || "-"}
                    </span>
                    {task.ref && (
                      <span className="indexing-tasks-page__ref">
                        @{task.ref}
                      </span>
                    )}
                    <code className="indexing-tasks-page__commit">
                      {commitLabel || "-"}
                    </code>
                  </div>
                  <div className="indexing-tasks-page__row-meta">
                    <span title={task.id}>
                      Job: <code>{shortHash(task.id)}</code>
                    </span>
                    <span>Progress: {formatProgress(task)}</span>
                    {timestamp && (
                      <span>Updated: {formatDateSafe(timestamp)}</span>
                    )}
                    {task.createdAt && task.createdAt !== timestamp && (
                      <span>Created: {formatDateSafe(task.createdAt)}</span>
                    )}
                  </div>
                  {task.error && (
                    <div className="indexing-tasks-page__error">
                      <strong>Error:</strong> {task.error}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
