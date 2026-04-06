import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  parseRepositoryLocation,
  requestAgentTasks,
  requestAgentTask,
} from "../utils/repositorySelection";
import "./AgentTaskInfoPage.css";

const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

function resolveRepoInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const parsed = parseRepositoryLocation(trimmed);
  if (parsed) return parsed.repo;
  if (REPO_PATTERN.test(trimmed)) return trimmed;
  return trimmed;
}

function splitOwnerRepo(repo: string): { owner: string; name: string } | null {
  const parts = repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], name: parts[1] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

interface TaskSummary {
  id: string;
  status: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  pullRequestNumber: number | undefined;
  pullRequestUrl: string | undefined;
  branch: string;
}

function extractTaskSummaries(data: unknown): TaskSummary[] {
  const items = Array.isArray(data) ? data : [];
  const summaries: TaskSummary[] = [];

  for (const item of items) {
    if (!isRecord(item)) continue;

    const id = asString(item.id) ?? asString(item.task_id) ?? "";
    if (!id) continue;

    const status = asString(item.status) ?? "unknown";
    const description =
      asString(item.description) ??
      asString(item.event_content) ??
      asString(item.title) ??
      "";
    const createdAt =
      asString(item.created_at) ?? asString(item.createdAt) ?? "";
    const updatedAt =
      asString(item.updated_at) ?? asString(item.updatedAt) ?? "";
    const model = asString(item.model) ?? "";

    let pullRequestNumber: number | undefined;
    let pullRequestUrl: string | undefined;
    let branch = "";

    const pr = item.pull_request ?? item.pullRequest;
    if (isRecord(pr)) {
      pullRequestNumber = asNumber(pr.number);
      pullRequestUrl = asString(pr.html_url) ?? asString(pr.url);
    }

    branch =
      asString(item.branch) ??
      asString(item.head_branch) ??
      asString(item.base_ref) ??
      "";

    summaries.push({
      id,
      status,
      description,
      createdAt,
      updatedAt,
      model,
      pullRequestNumber,
      pullRequestUrl,
      branch,
    });
  }

  return summaries;
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
  return "";
}

export default function AgentTaskInfoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryRepo = searchParams.get("repo") ?? "";
  const queryTaskId = searchParams.get("taskId") ?? "";

  const [repoInput, setRepoInput] = useState(queryRepo);
  const [bearerToken, setBearerToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [tasksRaw, setTasksRaw] = useState<unknown>(null);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState("");

  const [selectedTaskId, setSelectedTaskId] = useState(queryTaskId);
  const [taskDetail, setTaskDetail] = useState<unknown>(null);
  const [taskDetailLoading, setTaskDetailLoading] = useState(false);
  const [taskDetailError, setTaskDetailError] = useState("");

  const abortControllerRef = useRef<AbortController | null>(null);

  const resolvedRepo = useMemo(() => resolveRepoInput(repoInput), [repoInput]);
  const ownerRepo = useMemo(() => splitOwnerRepo(resolvedRepo), [resolvedRepo]);

  const handleLoadTasks = useCallback(async () => {
    if (!ownerRepo) {
      setTasksError("Please enter a repository in owner/repo format.");
      return;
    }
    if (!bearerToken.trim()) {
      setTasksError("Please enter a bearer token.");
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setTasksLoading(true);
    setTasksError("");
    setTasks([]);
    setTasksRaw(null);
    setSelectedTaskId("");
    setTaskDetail(null);
    setTaskDetailError("");

    try {
      const result = await requestAgentTasks(
        ownerRepo.owner,
        ownerRepo.name,
        bearerToken.trim(),
        controller.signal
      );
      if (controller.signal.aborted) return;
      setTasksRaw(result);
      setTasks(extractTaskSummaries(result));

      const params = new URLSearchParams();
      params.set("repo", resolvedRepo);
      setSearchParams(params, { replace: true });
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
  }, [ownerRepo, bearerToken, resolvedRepo, setSearchParams]);

  const handleSelectTask = useCallback(
    async (taskId: string) => {
      if (!ownerRepo || !bearerToken.trim()) return;

      setSelectedTaskId(taskId);
      setTaskDetail(null);
      setTaskDetailError("");
      setTaskDetailLoading(true);

      const params = new URLSearchParams();
      params.set("repo", resolvedRepo);
      params.set("taskId", taskId);
      setSearchParams(params, { replace: true });

      try {
        const result = await requestAgentTask(
          ownerRepo.owner,
          ownerRepo.name,
          taskId,
          bearerToken.trim()
        );
        setTaskDetail(result);
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
    [ownerRepo, bearerToken, resolvedRepo, setSearchParams]
  );

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return (
    <div className="agent-task-info-page">
      <div className="page-header">
        <h1>📋 Agent Tasks</h1>
        <p className="page-subtitle">
          View GitHub Copilot agent tasks for a repository.
        </p>
      </div>

      <div className="agent-task-info-page__input-section">
        <label htmlFor="agent-task-repo">Repository</label>
        <div className="agent-task-info-page__input-row">
          <input
            id="agent-task-repo"
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleLoadTasks();
            }}
            placeholder="owner/repo or paste full GitHub URL"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => void handleLoadTasks()}
            disabled={tasksLoading || !repoInput.trim() || !bearerToken.trim()}
          >
            {tasksLoading ? "Loading…" : "Load tasks"}
          </button>
        </div>
      </div>

      <div className="agent-task-info-page__input-section">
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
          onChange={(e) => setBearerToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleLoadTasks();
          }}
          placeholder="Authorization token"
          spellCheck={false}
        />
      </div>

      {tasksError && (
        <div className="agent-task-info-page__error">{tasksError}</div>
      )}

      {tasks.length > 0 && (
        <div className="agent-task-info-page__tasks">
          <div className="agent-task-info-page__tasks-header">
            <span className="agent-task-info-page__tasks-title">
              Tasks for {resolvedRepo}
            </span>
            <span className="agent-task-info-page__tasks-count">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="agent-task-info-page__task-list">
            {tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                className={`agent-task-info-page__task${
                  selectedTaskId === task.id
                    ? " agent-task-info-page__task--selected"
                    : ""
                }`}
                onClick={() => void handleSelectTask(task.id)}
              >
                <div className="agent-task-info-page__task-top-row">
                  <code className="agent-task-info-page__task-id">
                    {task.id.length > 12
                      ? `${task.id.slice(0, 12)}…`
                      : task.id}
                  </code>
                  <span
                    className={`agent-task-info-page__status ${statusClassName(task.status)}`}
                  >
                    {task.status}
                  </span>
                </div>
                {task.description && (
                  <div className="agent-task-info-page__task-description">
                    {task.description.length > 120
                      ? `${task.description.slice(0, 120)}…`
                      : task.description}
                  </div>
                )}
                <div className="agent-task-info-page__task-meta">
                  {task.model && <span>Model: {task.model}</span>}
                  {task.branch && <span>Branch: {task.branch}</span>}
                  {task.createdAt && (
                    <span>{formatDateSafe(task.createdAt)}</span>
                  )}
                  {task.pullRequestNumber !== undefined && (
                    <span>PR #{task.pullRequestNumber}</span>
                  )}
                </div>
              </button>
            ))}
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

          {taskDetail !== null && (
            <pre className="agent-task-info-page__detail-json">
              {JSON.stringify(taskDetail, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
