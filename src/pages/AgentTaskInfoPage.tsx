import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  resolveRepositoryInput,
  requestAgentTasks,
  requestAgentTask,
  requestArchiveAgentTask,
} from "../utils/repositorySelection";
import {
  extractTaskSummaries,
  splitOwnerRepo,
  type TaskSummary,
} from "../utils/agentTasks";
import { loadBearerToken, saveBearerToken } from "../utils/bearerTokenStorage";
import {
  loadAutoRefreshEnabled,
  saveAutoRefreshEnabled,
} from "../utils/agentTasksPageStorage";
import { formatRelativeDateTime } from "../utils/organizationBrowserPresentation";
import RepositorySelector from "../components/RepositorySelector";
import "./AgentTaskInfoPage.css";

const AUTO_REFRESH_INTERVAL_MS = 30_000;
const MAX_TASK_ID_DISPLAY_LENGTH = 12;
const MAX_DESCRIPTION_DISPLAY_LENGTH = 120;
const MAX_CONFIRM_LIST_LENGTH = 10;

interface ActionFeedback {
  tone: "success" | "error";
  message: string;
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

function statusClassName(status: string): string {
  const lower = status.toLowerCase();
  if (lower === "completed" || lower === "succeeded") return "agent-task-info-page__status--completed";
  if (lower === "failed" || lower === "error") return "agent-task-info-page__status--failed";
  if (lower === "active" || lower === "in_progress" || lower === "running") return "agent-task-info-page__status--active";
  if (lower === "waiting" || lower === "queued" || lower === "pending") return "agent-task-info-page__status--waiting";
  if (lower === "cancelled" || lower === "canceled") return "agent-task-info-page__status--cancelled";
  return "";
}

function formatConfirmList(items: string[]): string {
  if (items.length <= MAX_CONFIRM_LIST_LENGTH) {
    return items.join("\n");
  }

  const visibleItems = items.slice(0, MAX_CONFIRM_LIST_LENGTH);
  const remainingCount = items.length - MAX_CONFIRM_LIST_LENGTH;
  return `${visibleItems.join("\n")}\n... and ${String(remainingCount)} more`;
}

function getTaskDisplayLabel(task: TaskSummary): string {
  return task.name || task.description || task.id;
}

interface AgentTaskInfoPageProps {
  showRepositorySelector?: boolean;
  refreshIntervalMs?: number;
  bearerToken?: string;
}

export default function AgentTaskInfoPage({
  showRepositorySelector = true,
  refreshIntervalMs,
  bearerToken: bearerTokenProp,
}: AgentTaskInfoPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryRepo = searchParams.get("repo") ?? "";
  const queryTaskId = searchParams.get("taskId") ?? "";

  const [repoInput, setRepoInput] = useState(queryRepo);
  const [localBearerToken, setLocalBearerToken] = useState(loadBearerToken);
  const bearerToken = bearerTokenProp ?? localBearerToken;
  const [showToken, setShowToken] = useState(false);

  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [tasksRaw, setTasksRaw] = useState<unknown>(null);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState("");
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [archiveInProgress, setArchiveInProgress] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(
    loadAutoRefreshEnabled
  );

  const [selectedTaskId, setSelectedTaskId] = useState(queryTaskId);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [taskDetail, setTaskDetail] = useState<unknown>(null);
  const [taskDetailTaskId, setTaskDetailTaskId] = useState("");
  const [taskDetailLoading, setTaskDetailLoading] = useState(false);
  const [taskDetailError, setTaskDetailError] = useState("");

  const abortControllerRef = useRef<AbortController | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const currentSearchRef = useRef("");
  const autoLoadedRepoRef = useRef("");

  const resolvedRepo = useMemo(() => resolveRepositoryInput(repoInput), [repoInput]);
  const ownerRepo = useMemo(() => splitOwnerRepo(resolvedRepo), [resolvedRepo]);

  const handleBearerTokenChange = useCallback((value: string) => {
    setLocalBearerToken(value);
    saveBearerToken(value);
  }, []);

  const updateSearchParams = useCallback(
    (update: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(currentSearchRef.current);
      update(params);

      const nextSearch = params.toString();
      if (nextSearch === currentSearchRef.current) {
        return;
      }

      currentSearchRef.current = nextSearch;
      setSearchParams(params, { replace: true });
    },
    [setSearchParams]
  );

  const loadTasksForRepo = useCallback(
    async (
      repo: string,
      currentOwnerRepo: { owner: string; name: string },
      options: { preserveState?: boolean } = {}
    ) => {
      const { preserveState = false } = options;

      if (!bearerToken.trim()) {
        setTasksError("Please enter a bearer token.");
        return;
      }

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setTasksLoading(true);
      setTasksError("");
      if (!preserveState) {
        setTasks([]);
        setTasksRaw(null);
        setActionFeedback(null);
        setSelectedTaskIds(new Set());
        setSelectedTaskId("");
        setTaskDetail(null);
        setTaskDetailError("");
      }

      try {
        const result = await requestAgentTasks(
          currentOwnerRepo.owner,
          currentOwnerRepo.name,
          bearerToken.trim(),
          controller.signal
        );
        if (controller.signal.aborted) return;
        setTasksRaw(result);
        setTasks(extractTaskSummaries(result));
        setLastFetchedAt(new Date().toISOString());

        updateSearchParams((params) => {
          params.set("repo", repo);
          params.delete("taskId");
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setTasksError(
          err instanceof Error && err.message
            ? err.message
            : "Unable to fetch agent tasks"
        );
      } finally {
        if (!controller.signal.aborted) {
          setTasksLoading(false);
        }
      }
    },
    [bearerToken, updateSearchParams]
  );

  const handleLoadTasks = useCallback(async () => {
    if (!ownerRepo) {
      setTasksError("Please enter a repository in owner/repo format.");
      return;
    }
    if (!bearerToken.trim()) {
      setTasksError("Please enter a bearer token.");
      return;
    }

    await loadTasksForRepo(resolvedRepo, ownerRepo);
  }, [ownerRepo, bearerToken, resolvedRepo, loadTasksForRepo]);

  const handleAutoRefreshChange = useCallback((value: boolean) => {
    setAutoRefreshEnabled(value);
    saveAutoRefreshEnabled(value);
  }, []);

  const handleRefresh = useCallback(() => {
    if (!ownerRepo) return;
    void loadTasksForRepo(resolvedRepo, ownerRepo, { preserveState: true });
  }, [loadTasksForRepo, resolvedRepo, ownerRepo]);

  const handleSelectTask = useCallback(
    async (taskId: string) => {
      if (!ownerRepo || !bearerToken.trim()) return;

      setSelectedTaskId(taskId);
      setTaskDetail(null);
      setTaskDetailTaskId("");
      setTaskDetailError("");
      setTaskDetailLoading(true);

      updateSearchParams((params) => {
        params.set("repo", resolvedRepo);
        params.set("taskId", taskId);
      });

      try {
        const result = await requestAgentTask(
          ownerRepo.owner,
          ownerRepo.name,
          taskId,
          bearerToken.trim()
        );
        setTaskDetail(result);
        setTaskDetailTaskId(taskId);
      } catch (err) {
        setTaskDetailError(
          err instanceof Error && err.message
            ? err.message
            : "Unable to fetch task details"
        );
      } finally {
        setTaskDetailLoading(false);
      }
    },
    [ownerRepo, bearerToken, resolvedRepo, updateSearchParams]
  );

  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedTaskIds((prev) => {
      if (prev.size === tasks.length) {
        return new Set();
      }
      return new Set(tasks.map((task) => task.id));
    });
  }, [tasks]);

  const selectedTasks = tasks.filter((task) => selectedTaskIds.has(task.id));

  const handleArchiveTasks = useCallback(async () => {
    if (!ownerRepo || selectedTasks.length === 0) {
      return;
    }
    if (!bearerToken.trim()) {
      setActionFeedback({
        tone: "error",
        message: "Please enter a bearer token.",
      });
      return;
    }

    const archivableTasks = selectedTasks.filter((task) => !task.archivedAt);
    if (archivableTasks.length === 0) {
      setActionFeedback({
        tone: "error",
        message: "All selected tasks are already archived.",
      });
      return;
    }

    const confirmed = window.confirm(
      `Archive ${String(archivableTasks.length)} task${archivableTasks.length !== 1 ? "s" : ""}?\n\n${formatConfirmList(
        archivableTasks.map(getTaskDisplayLabel)
      )}`
    );
    if (!confirmed) {
      return;
    }

    setArchiveInProgress(true);
    setActionFeedback(null);

    const archivedTaskIds = new Set<string>();
    const failedTaskLabels: string[] = [];

    for (const task of archivableTasks) {
      try {
        await requestArchiveAgentTask(
          ownerRepo.owner,
          ownerRepo.name,
          task.id,
          bearerToken.trim()
        );
        archivedTaskIds.add(task.id);
      } catch (error) {
        const errorMessage =
          error instanceof Error && error.message
            ? ` (${error.message})`
            : "";
        failedTaskLabels.push(`${getTaskDisplayLabel(task)}${errorMessage}`);
      }
    }

    if (archivedTaskIds.size > 0) {
      setTasks((prev) => prev.filter((task) => !archivedTaskIds.has(task.id)));
      setSelectedTaskIds((prev) => {
        const next = new Set(prev);
        for (const taskId of archivedTaskIds) {
          next.delete(taskId);
        }
        return next;
      });

      if (selectedTaskId && archivedTaskIds.has(selectedTaskId)) {
        setSelectedTaskId("");
        setTaskDetail(null);
        setTaskDetailTaskId("");
        setTaskDetailError("");
        updateSearchParams((params) => {
          params.set("repo", resolvedRepo);
          params.delete("taskId");
        });
      }
    }

    setActionFeedback({
      tone: failedTaskLabels.length === 0 ? "success" : "error",
      message:
        failedTaskLabels.length === 0
          ? `Archived ${String(archivedTaskIds.size)} task${archivedTaskIds.size !== 1 ? "s" : ""}.`
          : `Archived ${String(archivedTaskIds.size)} task${archivedTaskIds.size !== 1 ? "s" : ""}. Failed to archive ${String(failedTaskLabels.length)}: ${failedTaskLabels.join("; ")}`,
    });
    setArchiveInProgress(false);
  }, [
    bearerToken,
    ownerRepo,
    resolvedRepo,
    selectedTaskId,
    selectedTasks,
    updateSearchParams,
  ]);

  useEffect(() => {
    currentSearchRef.current = searchParams.toString();
  }, [searchParams]);

  useEffect(() => {
    if (queryRepo && queryRepo !== repoInput) {
      setRepoInput(queryRepo);
    }
  }, [queryRepo, repoInput]);

  useEffect(() => {
    setSelectedTaskId(queryTaskId);
    setTaskDetailError("");
    if (!queryTaskId) {
      setTaskDetail(null);
      setTaskDetailTaskId("");
    }
  }, [queryTaskId]);

  useEffect(() => {
    if (!ownerRepo || !bearerToken.trim()) {
      return;
    }

    if (autoLoadedRepoRef.current === resolvedRepo) {
      return;
    }

    autoLoadedRepoRef.current = resolvedRepo;
    void loadTasksForRepo(resolvedRepo, ownerRepo);
  }, [ownerRepo, bearerToken, resolvedRepo, loadTasksForRepo]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const effectiveInterval = refreshIntervalMs ?? (autoRefreshEnabled ? AUTO_REFRESH_INTERVAL_MS : 0);
    if (!ownerRepo || !resolvedRepo || !effectiveInterval || !bearerToken.trim()) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (tasksLoading || archiveInProgress) {
        return;
      }

      void loadTasksForRepo(resolvedRepo, ownerRepo, { preserveState: true });
    }, effectiveInterval);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    archiveInProgress,
    autoRefreshEnabled,
    bearerToken,
    loadTasksForRepo,
    ownerRepo,
    refreshIntervalMs,
    resolvedRepo,
    tasksLoading,
  ]);

  useEffect(() => {
    if (!selectAllRef.current) {
      return;
    }

    selectAllRef.current.indeterminate =
      selectedTaskIds.size > 0 && selectedTaskIds.size < tasks.length;
  }, [selectedTaskIds, tasks.length]);

  return (
    <div className="agent-task-info-page">
      <div className="page-header">
        <h1>📋 Agent Tasks</h1>
        <p className="page-subtitle">
          View GitHub Copilot agent tasks for a repository.
        </p>
      </div>

      {showRepositorySelector && (
        <RepositorySelector
          inputId="agent-task-repo"
          value={repoInput}
          onChange={setRepoInput}
          onSubmit={handleLoadTasks}
          buttonLabel="Load tasks"
          loadingButtonLabel="Loading…"
          isLoading={tasksLoading && tasks.length === 0}
          disabled={tasksLoading || !repoInput.trim() || !bearerToken.trim()}
          actions={
            tasks.length > 0 ? (
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={tasksLoading}
              >
                {tasksLoading ? "Refreshing…" : "Refresh"}
              </button>
            ) : null
          }
        />
      )}

      <div className="agent-task-info-page__input-section">
        {showRepositorySelector && tasks.length > 0 && (
          <label className="agent-task-info-page__auto-refresh-toggle">
            <input
              type="checkbox"
              checked={autoRefreshEnabled}
              onChange={(e) => handleAutoRefreshChange(e.target.checked)}
            />
            Auto-refresh every 30s
          </label>
        )}
        {bearerTokenProp === undefined && (
          <>
            <div className="agent-task-info-page__token-label-row">
              <label htmlFor="agent-task-token">Bearer token</label>
              <button
                type="button"
                className="agent-task-info-page__token-toggle"
                onClick={() => setShowToken((prev) => !prev)}
              >
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
            <input
              id="agent-task-token"
              type={showToken ? "text" : "password"}
              value={bearerToken}
              onChange={(e) => handleBearerTokenChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleLoadTasks();
              }}
              placeholder="Authorization token"
              spellCheck={false}
            />
          </>
        )}
      </div>

      {tasksError && (
        <div className="agent-task-info-page__error">{tasksError}</div>
      )}

      {actionFeedback && (
        <div
          className={`agent-task-info-page__notice agent-task-info-page__notice--${actionFeedback.tone}`}
        >
          {actionFeedback.message}
        </div>
      )}

      {tasks.length > 0 && (
        <div className="agent-task-info-page__tasks">
          <div className="agent-task-info-page__tasks-header">
            <div className="agent-task-info-page__tasks-header-left">
              <label className="agent-task-info-page__select-all">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={tasks.length > 0 && selectedTaskIds.size === tasks.length}
                  onChange={toggleSelectAll}
                  aria-label="Select all tasks"
                />
              </label>
              <span className="agent-task-info-page__tasks-title">
                Tasks for {resolvedRepo}
              </span>
            </div>
            <span className="agent-task-info-page__tasks-count">
              {selectedTaskIds.size > 0
                ? `${String(selectedTaskIds.size)} of ${String(tasks.length)} selected`
                : `${String(tasks.length)} task${tasks.length !== 1 ? "s" : ""}`}
            </span>
          </div>
          <div className="agent-task-info-page__task-list">
            {tasks.map((task) => (
              <div
                key={task.id}
                className={`agent-task-info-page__task${
                  selectedTaskId === task.id || selectedTaskIds.has(task.id)
                    ? " agent-task-info-page__task--selected"
                    : ""
                }`}
              >
                <label className="agent-task-info-page__task-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedTaskIds.has(task.id)}
                    onChange={() => toggleTaskSelection(task.id)}
                    aria-label={`Select task ${task.id}`}
                  />
                </label>
                <div
                  className="agent-task-info-page__task-main"
                  role="button"
                  tabIndex={0}
                  aria-label={`View details for task ${task.id}`}
                  onClick={() => void handleSelectTask(task.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void handleSelectTask(task.id);
                    }
                  }}
                >
                  <div className="agent-task-info-page__task-top-row">
                    <code className="agent-task-info-page__task-id">
                      {task.id.length > MAX_TASK_ID_DISPLAY_LENGTH
                        ? `${task.id.slice(0, MAX_TASK_ID_DISPLAY_LENGTH)}…`
                        : task.id}
                    </code>
                    <span
                      className={`agent-task-info-page__status ${statusClassName(task.status)}`}
                    >
                      {task.status}
                    </span>
                    {task.htmlUrl && (
                      <a
                        href={task.htmlUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="agent-task-info-page__task-link"
                        onClick={(e) => e.stopPropagation()}
                      >
                        🔗 GitHub
                      </a>
                    )}
                  </div>
                  {(task.name || task.description) && (
                    <div className="agent-task-info-page__task-description">
                      {(() => {
                        const displayText = task.name || task.description;
                        return displayText.length > MAX_DESCRIPTION_DISPLAY_LENGTH
                          ? `${displayText.slice(0, MAX_DESCRIPTION_DISPLAY_LENGTH)}…`
                          : displayText;
                      })()}
                    </div>
                  )}
                  <div className="agent-task-info-page__task-meta">
                    {task.creator && (
                      <span>
                        Creator:{" "}
                        {task.creator.profileUrl ? (
                          <a
                            href={task.creator.profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="agent-task-info-page__meta-link"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {task.creator.login}
                          </a>
                        ) : (
                          task.creator.login
                        )}
                      </span>
                    )}
                    {task.model && <span>Model: {task.model}</span>}
                    {task.headRef && <span>Branch: {task.headRef}</span>}
                    {!task.headRef && task.branch && (
                      <span>Base: {task.branch}</span>
                    )}
                    {task.sessionCount !== undefined && (
                      <span>Sessions: {task.sessionCount}</span>
                    )}
                    {task.createdAt && (
                      <span>Created: {formatDateSafe(task.createdAt)}</span>
                    )}
                    {task.pullRequestNumber !== undefined && (
                      <span>PR #{task.pullRequestNumber}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedTaskIds.size > 0 && (
        <div className="agent-task-info-page__action-bar">
          <span className="agent-task-info-page__action-bar-count">
            {String(selectedTaskIds.size)} selected
          </span>
          <div className="agent-task-info-page__action-bar-actions">
            <button
              type="button"
              className="agent-task-info-page__action-btn agent-task-info-page__action-btn--archive"
              onClick={() => void handleArchiveTasks()}
              disabled={archiveInProgress}
              title="Archive selected tasks"
            >
              {archiveInProgress ? "Archiving…" : "Archive"}
            </button>
          </div>
        </div>
      )}

      {tasksRaw !== null && tasks.length === 0 && !tasksLoading && (
        <div className="agent-task-info-page__empty">
          <div className="agent-task-info-page__empty-icon">📭</div>
          <h2>No tasks found</h2>
          <p>
            No agent tasks were found for <code>{resolvedRepo}</code>. The
            response may use a different format.
          </p>
          {lastFetchedAt && (
            <p className="agent-task-info-page__empty-updated">
              Updated {formatRelativeDateTime(lastFetchedAt)}
            </p>
          )}
          <details className="agent-task-info-page__raw-toggle">
            <summary>Show raw response</summary>
            <pre className="agent-task-info-page__raw-json">
              {JSON.stringify(tasksRaw, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {selectedTaskId && (
        <div className="agent-task-info-page__detail">
          <div className="agent-task-info-page__detail-header">
            <h2>Task details</h2>
            <code>{selectedTaskId}</code>
          </div>

          {taskDetailLoading && (
            <div className="agent-task-info-page__detail-loading">
              Loading task details…
            </div>
          )}

          {taskDetailError && (
            <div className="agent-task-info-page__error">{taskDetailError}</div>
          )}

          {taskDetail !== null && taskDetailTaskId === selectedTaskId && (
            <pre className="agent-task-info-page__detail-json">
              {JSON.stringify(taskDetail, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
