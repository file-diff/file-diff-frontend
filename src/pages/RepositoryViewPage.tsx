import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  parseRepositoryLocation,
  requestRepositoryCommits,
  requestRepositoryBranches,
  requestAgentTasks,
} from "../utils/repositorySelection";
import type {
  RepositoryCommit,
  RepositoryBranch,
} from "../utils/repositorySelection";
import {
  extractTaskSummaries,
  splitOwnerRepo,
  type TaskSummary,
} from "../utils/agentTasks";
import { loadBearerToken, saveBearerToken } from "../utils/bearerTokenStorage";
import CreateTaskForm from "../components/CreateTaskForm";
import "./RepositoryViewPage.css";

const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const DEFAULT_COMMIT_LIMIT = 50;
const MAX_COMMIT_LIMIT = 200;
const MAX_TASK_ID_DISPLAY_LENGTH = 12;
const MAX_DESCRIPTION_DISPLAY_LENGTH = 100;

function resolveRepoInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const parsed = parseRepositoryLocation(trimmed);
  if (parsed) return parsed.repo;
  if (REPO_PATTERN.test(trimmed)) return trimmed;
  return trimmed;
}

function formatCommitDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return isoDate;
  return date.toLocaleString();
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return "";
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 30) {
    const diffMonths = Math.floor(diffDays / 30);
    return diffMonths === 1 ? "1 month ago" : `${String(diffMonths)} months ago`;
  }
  if (diffDays > 0) return diffDays === 1 ? "1 day ago" : `${String(diffDays)} days ago`;
  if (diffHours > 0) return diffHours === 1 ? "1 hour ago" : `${String(diffHours)} hours ago`;
  if (diffMinutes > 0) return diffMinutes === 1 ? "1 minute ago" : `${String(diffMinutes)} minutes ago`;
  return "just now";
}

function buildGitHubCommitUrl(repo: string, commit: string): string {
  const parts = repo.split("/");
  return `https://github.com/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/commit/${encodeURIComponent(commit)}`;
}

function buildGitHubBranchUrl(repo: string, branchName: string): string {
  const parts = repo.split("/");
  return `https://github.com/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/tree/${encodeURIComponent(branchName)}`;
}

function sortBranchesByNewestCommit(branches: RepositoryBranch[]): RepositoryBranch[] {
  return [...branches].sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    if (isNaN(dateA) && isNaN(dateB)) return 0;
    if (isNaN(dateA)) return 1;
    if (isNaN(dateB)) return -1;
    return dateB - dateA;
  });
}

function statusClassName(status: string): string {
  const lower = status.toLowerCase();
  if (lower === "completed" || lower === "succeeded") return "repo-view-page__task-status--completed";
  if (lower === "failed" || lower === "error") return "repo-view-page__task-status--failed";
  if (lower === "active" || lower === "in_progress" || lower === "running") return "repo-view-page__task-status--active";
  if (lower === "waiting" || lower === "queued" || lower === "pending") return "repo-view-page__task-status--waiting";
  if (lower === "cancelled" || lower === "canceled") return "repo-view-page__task-status--cancelled";
  return "";
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

export default function RepositoryViewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryRepo = searchParams.get("repo") ?? "";

  const [repoInput, setRepoInput] = useState(queryRepo);
  const [bearerToken, setBearerToken] = useState(loadBearerToken);
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [loadedRepo, setLoadedRepo] = useState("");

  const [branches, setBranches] = useState<RepositoryBranch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState("");

  const [commits, setCommits] = useState<RepositoryCommit[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsError, setCommitsError] = useState("");

  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState("");

  const [createTaskOpen, setCreateTaskOpen] = useState(false);

  const branchAbortRef = useRef<AbortController | null>(null);
  const commitAbortRef = useRef<AbortController | null>(null);
  const taskAbortRef = useRef<AbortController | null>(null);
  const autoLoadedRepoRef = useRef<string>("");

  const handleBearerTokenChange = useCallback((value: string) => {
    setBearerToken(value);
    saveBearerToken(value);
  }, []);

  const loadAll = useCallback(
    async (repo: string) => {
      setLoadedRepo(repo);
      setBranchesError("");
      setCommitsError("");
      setTasksError("");

      // Load branches
      branchAbortRef.current?.abort();
      const branchController = new AbortController();
      branchAbortRef.current = branchController;
      setBranchesLoading(true);
      setBranches([]);

      // Load commits
      commitAbortRef.current?.abort();
      const commitController = new AbortController();
      commitAbortRef.current = commitController;
      setCommitsLoading(true);
      setCommits([]);

      // Load tasks
      taskAbortRef.current?.abort();
      const taskController = new AbortController();
      taskAbortRef.current = taskController;
      setTasksLoading(true);
      setTasks([]);

      const branchPromise = requestRepositoryBranches(repo, branchController.signal)
        .then((result) => {
          if (!branchController.signal.aborted) {
            setBranches(sortBranchesByNewestCommit(result));
          }
        })
        .catch((err: unknown) => {
          if (!branchController.signal.aborted) {
            setBranchesError(
              err instanceof Error && err.message
                ? err.message
                : "Unable to load branches"
            );
          }
        })
        .finally(() => {
          if (!branchController.signal.aborted) setBranchesLoading(false);
        });

      const commitPromise = requestRepositoryCommits(repo, DEFAULT_COMMIT_LIMIT, commitController.signal)
        .then((result) => {
          if (!commitController.signal.aborted) {
            setCommits(result);
          }
        })
        .catch((err: unknown) => {
          if (!commitController.signal.aborted) {
            setCommitsError(
              err instanceof Error && err.message
                ? err.message
                : "Unable to load commits"
            );
          }
        })
        .finally(() => {
          if (!commitController.signal.aborted) setCommitsLoading(false);
        });

      const ownerRepo = splitOwnerRepo(repo);
      const token = bearerToken.trim();
      let taskPromise: Promise<void> = Promise.resolve();
      if (ownerRepo && token) {
        taskPromise = requestAgentTasks(ownerRepo.owner, ownerRepo.name, token, taskController.signal)
          .then((result) => {
            if (!taskController.signal.aborted) {
              setTasks(extractTaskSummaries(result));
            }
          })
          .catch((err: unknown) => {
            if (!taskController.signal.aborted) {
              setTasksError(
                err instanceof Error && err.message
                  ? err.message
                  : "Unable to load tasks"
              );
            }
          })
          .finally(() => {
            if (!taskController.signal.aborted) setTasksLoading(false);
          });
      } else {
        setTasks([]);
        setTasksLoading(false);
        if (!token) {
          setTasksError("Set a bearer token to load agent tasks.");
        }
      }

      await Promise.all([branchPromise, commitPromise, taskPromise]);
    },
    [bearerToken]
  );

  const handleLoad = useCallback(async () => {
    const repo = resolveRepoInput(repoInput);
    if (!repo) return;

    autoLoadedRepoRef.current = repo;

    const params = new URLSearchParams();
    params.set("repo", repo);
    setSearchParams(params, { replace: true });

    await loadAll(repo);
  }, [loadAll, repoInput, setSearchParams]);

  useEffect(() => {
    const repo = resolveRepoInput(queryRepo);
    if (!repo || autoLoadedRepoRef.current === repo) return;
    autoLoadedRepoRef.current = repo;
    setRepoInput(repo);
    void loadAll(repo);
  }, [loadAll, queryRepo]);

  useEffect(() => {
    return () => {
      branchAbortRef.current?.abort();
      commitAbortRef.current?.abort();
      taskAbortRef.current?.abort();
    };
  }, []);

  const handleLoadMoreCommits = useCallback(async () => {
    const repo = resolveRepoInput(repoInput);
    if (!repo) return;

    commitAbortRef.current?.abort();
    const controller = new AbortController();
    commitAbortRef.current = controller;

    const nextLimit = Math.min(commits.length + DEFAULT_COMMIT_LIMIT, MAX_COMMIT_LIMIT);
    setCommitsLoading(true);
    setCommitsError("");

    try {
      const result = await requestRepositoryCommits(repo, nextLimit, controller.signal);
      if (!controller.signal.aborted) setCommits(result);
    } catch (err) {
      if (!controller.signal.aborted) {
        setCommitsError(
          err instanceof Error && err.message ? err.message : "Unable to load commits"
        );
      }
    } finally {
      if (!controller.signal.aborted) setCommitsLoading(false);
    }
  }, [repoInput, commits.length]);

  const isAnyLoading = branchesLoading || commitsLoading || tasksLoading;
  const resolvedRepo = useMemo(() => resolveRepoInput(repoInput), [repoInput]);

  return (
    <div className="repo-view-page">
      <div className="page-header">
        <h1>📦 Repository</h1>
        <p className="page-subtitle">
          Overview of branches, commits, and agent tasks for a repository.
        </p>
      </div>

      <div className="repo-view-page__input-section">
        <label htmlFor="repo-view-input">Repository</label>
        <div className="repo-view-page__input-row">
          <input
            id="repo-view-input"
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleLoad();
            }}
            placeholder="owner/repo or paste full GitHub URL"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => void handleLoad()}
            disabled={isAnyLoading || !repoInput.trim()}
          >
            {isAnyLoading ? "Loading…" : "Load"}
          </button>
        </div>
        <div className="repo-view-page__controls">
          <button
            type="button"
            className="repo-view-page__token-toggle"
            onClick={() => setShowTokenInput((v) => !v)}
          >
            {showTokenInput ? "Hide token" : "🔑 API token"}
          </button>
        </div>
        {showTokenInput && (
          <div className="repo-view-page__token-section">
            <label htmlFor="repo-view-token">Bearer Token</label>
            <input
              id="repo-view-token"
              type="password"
              value={bearerToken}
              onChange={(e) => handleBearerTokenChange(e.target.value)}
              placeholder="Required for agent tasks and creating tasks"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        )}
      </div>

      {(branchesError || commitsError || tasksError) && (
        <div className="repo-view-page__error">
          {[branchesError, commitsError, tasksError].filter(Boolean).join(" · ")}
        </div>
      )}

      {loadedRepo && (
        <>
          <div className="repo-view-page__panels">
            {/* Branches panel */}
            <div className="repo-view-page__panel">
              <div className="repo-view-page__panel-header">
                <span className="repo-view-page__panel-title">🌿 Branches</span>
                <span className="repo-view-page__panel-count">
                  {branchesLoading
                    ? "loading…"
                    : `${String(branches.length)} branch${branches.length !== 1 ? "es" : ""}`}
                </span>
              </div>
              <div className="repo-view-page__panel-list">
                {branches.length === 0 && !branchesLoading && (
                  <div className="repo-view-page__panel-empty">No branches found</div>
                )}
                {branches.map((branch) => (
                  <div key={branch.ref} className="repo-view-page__branch-item">
                    <div>
                      <a
                        href={buildGitHubBranchUrl(loadedRepo, branch.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="repo-view-page__branch-name"
                      >
                        {branch.name}
                      </a>
                      {branch.isDefault && (
                        <span className="repo-view-page__branch-default-badge">
                          default
                        </span>
                      )}
                      {branch.pullRequest && (
                        <a
                          href={branch.pullRequest.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="repo-view-page__branch-pr"
                          style={{ marginLeft: 6 }}
                        >
                          PR #{branch.pullRequest.number}
                        </a>
                      )}
                    </div>
                    <div className="repo-view-page__branch-meta">
                      <a
                        href={buildGitHubCommitUrl(loadedRepo, branch.commit)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="repo-view-page__branch-commit"
                      >
                        {branch.commitShort}
                      </a>
                      <span className="repo-view-page__branch-title">{branch.title}</span>
                      <span>{formatRelativeTime(branch.date)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Commits panel */}
            <div className="repo-view-page__panel">
              <div className="repo-view-page__panel-header">
                <span className="repo-view-page__panel-title">🔀 Commits</span>
                <span className="repo-view-page__panel-count">
                  {commitsLoading
                    ? "loading…"
                    : `${String(commits.length)} commit${commits.length !== 1 ? "s" : ""}`}
                </span>
              </div>
              <div className="repo-view-page__panel-list">
                {commits.length === 0 && !commitsLoading && (
                  <div className="repo-view-page__panel-empty">No commits found</div>
                )}
                {commits.map((entry) => (
                  <div key={entry.commit} className="repo-view-page__commit-item">
                    <div className="repo-view-page__commit-title">{entry.title}</div>
                    <div className="repo-view-page__commit-meta">
                      <a
                        href={buildGitHubCommitUrl(loadedRepo, entry.commit)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="repo-view-page__commit-sha"
                      >
                        {entry.commit.slice(0, 7)}
                      </a>
                      <span className="repo-view-page__commit-author">{entry.author}</span>
                      <span className="repo-view-page__commit-date">
                        {formatCommitDate(entry.date)}
                      </span>
                    </div>
                    {(entry.branch || entry.tags.length > 0) && (
                      <div className="repo-view-page__commit-badges">
                        {entry.branch && (
                          <span className="repo-view-page__commit-branch-badge">
                            {entry.branch}
                          </span>
                        )}
                        {entry.tags.map((tag) => (
                          <span key={tag} className="repo-view-page__commit-tag-badge">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {commits.length >= DEFAULT_COMMIT_LIMIT &&
                commits.length < MAX_COMMIT_LIMIT && (
                  <div className="repo-view-page__load-more">
                    <button
                      type="button"
                      onClick={() => void handleLoadMoreCommits()}
                      disabled={commitsLoading}
                    >
                      {commitsLoading ? "Loading…" : "Load more"}
                    </button>
                  </div>
                )}
            </div>

            {/* Agent Tasks panel */}
            <div className="repo-view-page__panel">
              <div className="repo-view-page__panel-header">
                <span className="repo-view-page__panel-title">📋 Agent Tasks</span>
                <span className="repo-view-page__panel-count">
                  {tasksLoading
                    ? "loading…"
                    : `${String(tasks.length)} task${tasks.length !== 1 ? "s" : ""}`}
                </span>
              </div>
              <div className="repo-view-page__panel-list">
                {tasks.length === 0 && !tasksLoading && (
                  <div className="repo-view-page__panel-empty">
                    {tasksError ? "Unable to load tasks" : "No agent tasks found"}
                  </div>
                )}
                {tasks.map((task) => (
                  <div key={task.id} className="repo-view-page__task-item">
                    <div className="repo-view-page__task-top-row">
                      <code className="repo-view-page__task-id">
                        {task.id.length > MAX_TASK_ID_DISPLAY_LENGTH
                          ? `${task.id.slice(0, MAX_TASK_ID_DISPLAY_LENGTH)}…`
                          : task.id}
                      </code>
                      <span
                        className={`repo-view-page__task-status ${statusClassName(task.status)}`}
                      >
                        {task.status}
                      </span>
                      {task.htmlUrl && (
                        <a
                          href={task.htmlUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="repo-view-page__task-link"
                        >
                          🔗
                        </a>
                      )}
                    </div>
                    {(task.name || task.description) && (
                      <div className="repo-view-page__task-description">
                        {(() => {
                          const displayText = task.name || task.description;
                          return displayText.length > MAX_DESCRIPTION_DISPLAY_LENGTH
                            ? `${displayText.slice(0, MAX_DESCRIPTION_DISPLAY_LENGTH)}…`
                            : displayText;
                        })()}
                      </div>
                    )}
                    <div className="repo-view-page__task-meta">
                      {task.creator && (
                        <span>
                          {task.creator.profileUrl ? (
                            <a
                              href={task.creator.profileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {task.creator.login}
                            </a>
                          ) : (
                            task.creator.login
                          )}
                        </span>
                      )}
                      {task.headRef && <span>↳ {task.headRef}</span>}
                      {task.createdAt && (
                        <span>{formatDateSafe(task.createdAt)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Create Task collapsible section */}
          <div className="repo-view-page__create-task">
            <button
              type="button"
              className="repo-view-page__create-task-toggle"
              onClick={() => setCreateTaskOpen((v) => !v)}
            >
              <span>🤖 Create Agent Task</span>
              <span
                className={
                  "repo-view-page__create-task-toggle-icon" +
                  (createTaskOpen ? " repo-view-page__create-task-toggle-icon--open" : "")
                }
              >
                ▶
              </span>
            </button>
            {createTaskOpen && (
              <div className="repo-view-page__create-task-body">
                <CreateTaskForm initialRepo={resolvedRepo} />
              </div>
            )}
          </div>
        </>
      )}

      {!isAnyLoading &&
        branches.length === 0 &&
        commits.length === 0 &&
        tasks.length === 0 &&
        !loadedRepo && (
          <div className="repo-view-page__panel-empty" style={{ padding: "60px 24px", textAlign: "center" }}>
            <div style={{ fontSize: "3rem", marginBottom: 12 }}>📦</div>
            <h2 style={{ color: "#e0e0e0", margin: "0 0 8px" }}>Enter a repository</h2>
            <p style={{ color: "#999", margin: 0, lineHeight: 1.5 }}>
              Type a repository name (e.g. <code style={{ color: "#58a6ff" }}>facebook/react</code>) and
              click &quot;Load&quot; to see branches, commits, and agent tasks.
            </p>
          </div>
        )}
    </div>
  );
}
