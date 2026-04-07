import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  parseRepositoryLocation,
  requestAgentTasks,
  requestAgentTask,
} from "../utils/repositorySelection";
import { loadBearerToken, saveBearerToken } from "../utils/bearerTokenStorage";
import "./AgentTaskInfoPage.css";

const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const MAX_TASK_ID_DISPLAY_LENGTH = 12;
const MAX_DESCRIPTION_DISPLAY_LENGTH = 120;

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

function asNumberLike(value: unknown): number | undefined {
  const numericValue = asNumber(value);
  if (numericValue !== undefined) return numericValue;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readStringField(
  value: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const candidate = asString(value[key]);
    if (candidate !== undefined) {
      return candidate;
    }
  }

  return undefined;
}

interface TaskCreator {
  login: string;
  profileUrl: string;
}

interface TaskSummary {
  id: string;
  name: string;
  status: string;
  state: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  pullRequestNumber: number | undefined;
  pullRequestUrl: string | undefined;
  branch: string;
  headRef: string;
  htmlUrl: string;
  creator: TaskCreator | undefined;
  sessionCount: number | undefined;
  archivedAt: string;
}

function extractArtifacts(artifacts: unknown): {
  pullRequestNumber: number | undefined;
  pullRequestUrl: string | undefined;
  headRef: string;
  baseRef: string;
} {
  let pullRequestNumber: number | undefined;
  let pullRequestUrl: string | undefined;
  let headRef = "";
  let baseRef = "";

  if (!Array.isArray(artifacts)) return { pullRequestNumber, pullRequestUrl, headRef, baseRef };

  for (const artifact of artifacts) {
    if (!isRecord(artifact)) continue;
    const artType = asString(artifact.type);
    const data = isRecord(artifact.data) ? artifact.data : undefined;
    if (!data) continue;

    if (
      artType === "github_resource" &&
      ["pull", "pull_request"].includes(asString(data.type) ?? "")
    ) {
      pullRequestNumber = asNumberLike(data.id);
      pullRequestUrl =
        readStringField(data, "html_url", "htmlUrl", "url") ?? pullRequestUrl;
    }

    if (artType === "branch") {
      headRef = readStringField(data, "head_ref", "headRef") ?? headRef;
      baseRef = readStringField(data, "base_ref", "baseRef") ?? baseRef;
    }
  }

  return { pullRequestNumber, pullRequestUrl, headRef, baseRef };
}

function extractCreator(creator: unknown): TaskCreator | undefined {
  if (!isRecord(creator)) return undefined;
  const login = asString(creator.login);
  const profileUrl = readStringField(
    creator,
    "html_url",
    "htmlUrl",
    "profile_url",
    "profileUrl",
    "url"
  );
  if (!login) return undefined;
  return { login, profileUrl: profileUrl ?? "" };
}

function extractTaskSummaries(data: unknown): TaskSummary[] {
  let items: unknown[];

  if (Array.isArray(data)) {
    items = data;
  } else if (isRecord(data)) {
    const nestedData = isRecord(data.data) ? data.data : null;
    const taskCollection =
      data.tasks ??
      data.items ??
      nestedData?.tasks ??
      nestedData?.items;
    items = Array.isArray(taskCollection) ? taskCollection : [];
  } else {
    items = [];
  }

  const summaries: TaskSummary[] = [];

  for (const item of items) {
    if (!isRecord(item)) continue;

    const id = asString(item.id) ?? asString(item.task_id) ?? "";
    if (!id) continue;

    const name = asString(item.name) ?? "";
    const status = asString(item.status) ?? "unknown";
    const state = asString(item.state) ?? "";
    const description =
      asString(item.description) ??
      asString(item.event_content) ??
      asString(item.title) ??
      name;
    const createdAt = readStringField(item, "created_at", "createdAt") ?? "";
    const updatedAt = readStringField(item, "updated_at", "updatedAt") ?? "";
    const archivedAt =
      readStringField(item, "archived_at", "archivedAt") ?? "";
    const model = asString(item.model) ?? "";
    const htmlUrl = readStringField(item, "html_url", "htmlUrl", "url") ?? "";
    const sessionCount =
      asNumber(item.session_count) ?? asNumber(item.sessionCount);

    const creator = extractCreator(item.creator);

    const {
      pullRequestNumber: artPrNumber,
      pullRequestUrl: artPrUrl,
      headRef: artHeadRef,
      baseRef: artBaseRef,
    } = extractArtifacts(item.artifacts);

    let pullRequestNumber: number | undefined = artPrNumber;
    let pullRequestUrl: string | undefined = artPrUrl;

    const pr = item.pull_request ?? item.pullRequest;
    if (isRecord(pr)) {
      pullRequestNumber = asNumberLike(pr.number) ?? pullRequestNumber;
      pullRequestUrl =
        readStringField(pr, "html_url", "htmlUrl", "url") ?? pullRequestUrl;
    }

    const branch =
      readStringField(item, "branch", "head_branch", "headBranch", "base_ref", "baseRef") ??
      artBaseRef;

    const headRef = artHeadRef || readStringField(item, "head_ref", "headRef") || "";

    summaries.push({
      id,
      name,
      status,
      state,
      description,
      createdAt,
      updatedAt,
      model,
      pullRequestNumber,
      pullRequestUrl,
      branch,
      headRef,
      htmlUrl,
      creator,
      sessionCount,
      archivedAt,
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
  if (lower === "cancelled" || lower === "canceled") return "agent-task-info-page__status--cancelled";
  return "";
}

export default function AgentTaskInfoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryRepo = searchParams.get("repo") ?? "";
  const queryTaskId = searchParams.get("taskId") ?? "";

  const [repoInput, setRepoInput] = useState(queryRepo);
  const [bearerToken, setBearerToken] = useState(loadBearerToken);
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

  const handleBearerTokenChange = useCallback((value: string) => {
    setBearerToken(value);
    saveBearerToken(value);
  }, []);

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
          onChange={(e) => handleBearerTokenChange(e.target.value)}
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
                    <span>
                      PR{" "}
                      {task.pullRequestUrl ? (
                        <a
                          href={task.pullRequestUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="agent-task-info-page__meta-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          #{task.pullRequestNumber}
                        </a>
                      ) : (
                        `#${task.pullRequestNumber}`
                      )}
                    </span>
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
