import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  resolveRepositoryInput,
  requestAgentTasks,
  requestAgentTask,
} from "../utils/repositorySelection";
import {
  extractTaskSummaries,
  splitOwnerRepo,
  type TaskSummary,
} from "../utils/agentTasks";
import { loadBearerToken, saveBearerToken } from "../utils/bearerTokenStorage";
import {
  hasCachedTasks,
  loadCachedTasks,
  loadCachedTasksFetchedAt,
  loadLastRepo,
  loadAutoRefreshEnabled,
  saveCachedTasks,
  saveAutoRefreshEnabled,
  saveLastRepo,
} from "../utils/agentTasksPageStorage";
import { formatRelativeDateTime } from "../utils/organizationBrowserPresentation";
import RepositorySelector from "../components/RepositorySelector";
import "./AgentTaskInfoPage.css";

const AUTO_REFRESH_INTERVAL_MS = 30_000;
const MAX_TASK_ID_DISPLAY_LENGTH = 12;
const MAX_DESCRIPTION_DISPLAY_LENGTH = 200;

interface ActionFeedback {
  tone: "success" | "error";
  message: string;
}

interface TaskLogSection {
  label: string;
  value: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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

function getTaskDescription(task: TaskSummary): string {
  if (task.error) return task.error;
  if (task.output) return task.output;
  return "";
}

function decodeEscapedText(value: string): string {
  return value.replace(
    /\\u([0-9a-fA-F]{4})|\\([\\'"bfnrtv])/g,
    (_match, unicodeHex: string | undefined, escapedChar: string | undefined) => {
      if (unicodeHex) {
        return String.fromCharCode(Number.parseInt(unicodeHex, 16));
      }

      switch (escapedChar) {
        case "\\":
          return "\\";
        case "'":
          return "'";
        case '"':
          return '"';
        case "b":
          return "\b";
        case "f":
          return "\f";
        case "n":
          return "\n";
        case "r":
          return "\r";
        case "t":
          return "\t";
        case "v":
          return "\v";
        default:
          return _match;
      }
    }
  );
}

function getTaskLogSections(taskDetail: unknown): TaskLogSection[] {
  if (!isRecord(taskDetail)) return [];

  const sections: TaskLogSection[] = [];
  const output = asString(taskDetail.output)?.trim() ?? "";
  const stdout = asString(taskDetail.stdout)?.trim() ?? "";
  const stderr = asString(taskDetail.stderr)?.trim() ?? "";
  const decodedOutput = output ? decodeEscapedText(output) : "";
  const decodedStdout = stdout ? decodeEscapedText(stdout) : "";
  const decodedStderr = stderr ? decodeEscapedText(stderr) : "";
  const hasSplitLogs = Boolean(decodedStdout || decodedStderr);

  if (decodedStdout) {
    sections.push({ label: "Stdout", value: decodedStdout });
  }
  if (decodedStderr) {
    sections.push({ label: "Stderr", value: decodedStderr });
  }
  if (
    decodedOutput &&
    (!hasSplitLogs || decodedOutput !== `${decodedStdout}${decodedStderr}`)
  ) {
    sections.push({
      label: hasSplitLogs ? "Combined output" : "Output",
      value: decodedOutput,
    });
  }

  return sections;
}

function resolveInitialRepo(queryRepo: string): string {
  if (queryRepo) return queryRepo;
  return loadLastRepo();
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
  const initialRepo = resolveInitialRepo(queryRepo);

  const [repoInput, setRepoInput] = useState(initialRepo);
  const [localBearerToken, setLocalBearerToken] = useState(loadBearerToken);
  const bearerToken = bearerTokenProp ?? localBearerToken;
  const [showToken, setShowToken] = useState(false);

  const [tasks, setTasks] = useState<TaskSummary[]>(() =>
    initialRepo ? loadCachedTasks(initialRepo) : []
  );
  const [tasksRaw, setTasksRaw] = useState<unknown>(() =>
    initialRepo && hasCachedTasks(initialRepo)
      ? { tasks: loadCachedTasks(initialRepo) }
      : null
  );
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState(() =>
    initialRepo ? loadCachedTasksFetchedAt(initialRepo) : ""
  );
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
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
  const hasLoadedTaskData = tasksRaw !== null;
  const taskLogSections = useMemo(() => getTaskLogSections(taskDetail), [taskDetail]);

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
      options: { preserveState?: boolean; useCachedTasks?: boolean } = {}
    ) => {
      const { preserveState = false, useCachedTasks = true } = options;

      if (!bearerToken.trim()) {
        setTasksError("Please enter a bearer token.");
        return;
      }

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setTasksLoading(true);
      setTasksError("");
      const cachedTasks = useCachedTasks ? loadCachedTasks(repo) : [];
      const cachedTasksFetchedAt = useCachedTasks
        ? loadCachedTasksFetchedAt(repo)
        : "";
      const hasCachedTaskData = useCachedTasks && hasCachedTasks(repo);
      if (!preserveState) {
        setActionFeedback(null);
        setSelectedTaskIds(new Set());
        setSelectedTaskId("");
        setTaskDetail(null);
        setTaskDetailError("");
        if (hasCachedTaskData) {
          setTasks(cachedTasks);
          setTasksRaw({ tasks: cachedTasks });
          setLastFetchedAt(cachedTasksFetchedAt);
        } else {
          setTasks([]);
          setTasksRaw(null);
          setLastFetchedAt("");
        }
      }

      try {
        const result = await requestAgentTasks(
          currentOwnerRepo.owner,
          currentOwnerRepo.name,
          bearerToken.trim(),
          controller.signal
        );
        if (controller.signal.aborted) return;
        const nextTasks = extractTaskSummaries(result);
        const nextTaskIds = new Set(nextTasks.map((task) => task.id));
        const nextSelectedTaskId =
          selectedTaskId && nextTaskIds.has(selectedTaskId) ? selectedTaskId : "";
        setTasksRaw(result);
        setTasks(nextTasks);
        const fetchedAt = saveCachedTasks(repo, nextTasks);
        saveLastRepo(repo);
        setSelectedTaskIds((prev) => {
          const next = new Set<string>();
          for (const taskId of prev) {
            if (nextTaskIds.has(taskId)) {
              next.add(taskId);
            }
          }
          return next;
        });
        if (selectedTaskId && !nextSelectedTaskId) {
          setSelectedTaskId("");
          setTaskDetail(null);
          setTaskDetailTaskId("");
          setTaskDetailError("");
        }
        setLastFetchedAt(fetchedAt);

        updateSearchParams((params) => {
          params.set("repo", repo);
          if (nextSelectedTaskId) {
            params.set("taskId", nextSelectedTaskId);
          } else {
            params.delete("taskId");
          }
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setTasksError(
          err instanceof Error && err.message
            ? err.message
            : "Unable to fetch agent tasks"
        );
        if (hasCachedTaskData) {
          setTasksError(
            (err instanceof Error && err.message
              ? err.message
              : "Unable to refresh agent tasks") + " — showing cached data."
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setTasksLoading(false);
        }
      }
    },
    [
      bearerToken,
      selectedTaskId,
      setSelectedTaskId,
      setTaskDetail,
      setTaskDetailTaskId,
      setTaskDetailError,
      updateSearchParams,
    ]
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

  useEffect(() => {
    currentSearchRef.current = searchParams.toString();
  }, [searchParams]);

  useEffect(() => {
    if (initialRepo && initialRepo !== repoInput) {
      setRepoInput(initialRepo);
    }
  }, [initialRepo, repoInput]);

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
      if (tasksLoading) {
        return;
      }

      void loadTasksForRepo(resolvedRepo, ownerRepo, { preserveState: true });
    }, effectiveInterval);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
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
          View locally-managed agent tasks for a repository.
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
          isLoading={tasksLoading && !hasLoadedTaskData}
          disabled={tasksLoading || !repoInput.trim() || !bearerToken.trim()}
          actions={
            hasLoadedTaskData ? (
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={tasksLoading || !repoInput.trim() || !bearerToken.trim()}
              >
                Refresh
              </button>
            ) : null
          }
        />
      )}

      <div className="agent-task-info-page__input-section">
        {showRepositorySelector && hasLoadedTaskData && (
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

      {hasLoadedTaskData && (
        <div className="agent-task-info-page__tasks">
          <div className="agent-task-info-page__tasks-header">
            <div className="agent-task-info-page__tasks-header-left">
              {tasks.length > 0 && (
                <label className="agent-task-info-page__select-all">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={tasks.length > 0 && selectedTaskIds.size === tasks.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all tasks"
                  />
                </label>
              )}
              <span className="agent-task-info-page__tasks-title">
                Tasks for {resolvedRepo}
              </span>
            </div>
            <div className="agent-task-info-page__tasks-header-right">
              <span className="agent-task-info-page__tasks-count">
                {selectedTaskIds.size > 0
                  ? `${String(selectedTaskIds.size)} of ${String(tasks.length)} selected`
                  : `${String(tasks.length)} task${tasks.length !== 1 ? "s" : ""}`}
              </span>
              {tasksLoading && (
                <span
                  className="agent-task-info-page__tasks-status"
                  aria-live="polite"
                >
                  Refreshing…
                </span>
              )}
            </div>
          </div>
          <div className="agent-task-info-page__task-list">
            {tasks.length > 0 ? (
              tasks.map((task) => (
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
                      {task.pullRequestUrl && (
                        <a
                          href={task.pullRequestUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="agent-task-info-page__task-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          🔗 PR
                          {task.pullRequestNumber !== undefined
                            ? ` #${String(task.pullRequestNumber)}`
                            : ""}
                        </a>
                      )}
                    </div>
                    {(() => {
                      const description = getTaskDescription(task);
                      if (!description) return null;
                      return (
                        <div className="agent-task-info-page__task-description">
                          {description.length > MAX_DESCRIPTION_DISPLAY_LENGTH
                            ? `${description.slice(0, MAX_DESCRIPTION_DISPLAY_LENGTH)}…`
                            : description}
                        </div>
                      );
                    })()}
                    <div className="agent-task-info-page__task-meta">
                      {task.model && <span>Model: {task.model}</span>}
                      {task.branch && <span>Branch: {task.branch}</span>}
                      {task.baseRef && <span>Base: {task.baseRef}</span>}
                      {task.taskStatus && (
                        <span>Remote status: {task.taskStatus}</span>
                      )}
                      {task.scheduledAt && (
                        <span>
                          Scheduled: {formatDateSafe(task.scheduledAt)}
                        </span>
                      )}
                      {task.createdAt && (
                        <span>Created: {formatDateSafe(task.createdAt)}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="agent-task-info-page__task agent-task-info-page__task--empty">
                <div className="agent-task-info-page__task-main">
                  <div className="agent-task-info-page__empty-row">
                    <span className="agent-task-info-page__empty-message">
                      No tasks found for <code>{resolvedRepo}</code>.
                    </span>
                    <div className="agent-task-info-page__empty-actions">
                      {lastFetchedAt && (
                        <span className="agent-task-info-page__empty-updated">
                          Updated {formatRelativeDateTime(lastFetchedAt)}
                        </span>
                      )}
                      <details className="agent-task-info-page__raw-toggle agent-task-info-page__raw-toggle--compact">
                        <summary>Raw response</summary>
                        <pre className="agent-task-info-page__raw-json">
                          {JSON.stringify(tasksRaw, null, 2)}
                        </pre>
                      </details>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedTaskIds.size > 0 && (
        <div className="agent-task-info-page__action-bar">
          <span className="agent-task-info-page__action-bar-count">
            {String(selectedTaskIds.size)} selected
          </span>
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
            <div className="agent-task-info-page__detail-body">
              {taskLogSections.length > 0 && (
                <div className="agent-task-info-page__detail-logs">
                  {taskLogSections.map((section) => (
                    <div
                      key={section.label}
                      className="agent-task-info-page__detail-log-section"
                    >
                      <label>{section.label}</label>
                      <textarea
                        className="agent-task-info-page__detail-textarea"
                        value={section.value}
                        readOnly
                        rows={10}
                        spellCheck={false}
                      />
                    </div>
                  ))}
                </div>
              )}
              <details className="agent-task-info-page__raw-toggle">
                <summary>Raw task response</summary>
                <pre className="agent-task-info-page__detail-json">
                  {JSON.stringify(taskDetail, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
