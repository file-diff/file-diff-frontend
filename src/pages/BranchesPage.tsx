import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  parseRepositoryLocation,
  requestRepositoryBranches,
  requestDeleteRemoteBranch,
  requestPullRequestReady,
  requestPullRequestMerge,
  requestPullRequestOpen,
  requestAgentTasks,
} from "../utils/repositorySelection";
import type { RepositoryBranch } from "../utils/repositorySelection";
import {
  extractTaskSummaries,
  splitOwnerRepo,
  type TaskSummary,
} from "../utils/agentTasks";
import {
  loadCachedBranches,
  loadCachedBranchesFetchedAt,
  saveCachedBranches,
  loadLastRepo,
  saveLastRepo,
  loadAutoRefreshEnabled,
  saveAutoRefreshEnabled,
} from "../utils/branchesPageStorage";
import {
  loadBearerToken,
  saveBearerToken,
} from "../utils/bearerTokenStorage";
import {
  formatRelativeDateTime,
  formatAbsoluteDateTime,
} from "../utils/organizationBrowserPresentation";
import "./BranchesPage.css";

const AUTO_REFRESH_INTERVAL_MS = 30_000;

function formatBranchDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleString();
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) {
    return "";
  }
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
  if (diffDays > 0) {
    return diffDays === 1 ? "1 day ago" : `${String(diffDays)} days ago`;
  }
  if (diffHours > 0) {
    return diffHours === 1 ? "1 hour ago" : `${String(diffHours)} hours ago`;
  }
  if (diffMinutes > 0) {
    return diffMinutes === 1
      ? "1 minute ago"
      : `${String(diffMinutes)} minutes ago`;
  }
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

function getPrStatusClass(status: string): string {
  switch (status) {
    case "open":
      return "branches-page__pr-status--open";
    case "closed":
      return "branches-page__pr-status--closed";
    default:
      return "";
  }
}

function prettifyStatusLabel(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getAgentTaskStatusPresentation(task: TaskSummary): {
  label: string;
  tone: "completed" | "failed" | "active" | "waiting" | "cancelled" | "neutral";
} {
  const normalizedStatus = prettifyStatusLabel(task.status);
  const normalizedState = prettifyStatusLabel(task.state);
  const value = normalizedStatus || normalizedState;

  if (
    value === "completed" ||
    value === "finished" ||
    value === "succeeded" ||
    value === "success"
  ) {
    return { label: "finished", tone: "completed" };
  }
  if (value === "failed" || value === "error") {
    return { label: "failed", tone: "failed" };
  }
  if (
    value === "active" ||
    value === "in progress" ||
    value === "running" ||
    value === "working"
  ) {
    return { label: "working", tone: "active" };
  }
  if (value === "waiting" || value === "queued" || value === "pending") {
    return { label: "queued", tone: "waiting" };
  }
  if (value === "cancelled" || value === "canceled") {
    return { label: "cancelled", tone: "cancelled" };
  }
  return { label: value || "unknown", tone: "neutral" };
}

function getPullRequestReviewState(
  pullRequest: RepositoryBranch["pullRequest"]
):
  | {
      label: string;
      tone: "draft" | "ready";
    }
  | null {
  if (!pullRequest || pullRequest.state !== "open") {
    return null;
  }

  const mergeState = prettifyStatusLabel(pullRequest.mergeStateStatus ?? "");
  if (pullRequest.draft || mergeState === "draft") {
    return { label: "draft", tone: "draft" };
  }

  if (
    pullRequest.readyToMerge === true ||
    mergeState === "ready to merge" ||
    mergeState === "clean" ||
    mergeState === "has hooks" ||
    mergeState === "unstable" ||
    (pullRequest.mergeable === true && !mergeState)
  ) {
    return { label: "ready to merge", tone: "ready" };
  }

  return null;
}

interface ActionResult {
  branch: string;
  success: boolean;
  message: string;
}

interface BranchAgentAssignment {
  taskId: string;
  url: string;
  count: number;
  statusLabel: string;
  statusTone:
    | "completed"
    | "failed"
    | "active"
    | "waiting"
    | "cancelled"
    | "neutral";
}

type MergeMethod = "merge" | "squash" | "rebase";

interface LoadBranchesOptions {
  clearActionResults?: boolean;
  useCachedBranches?: boolean;
}

function formatConfirmList(items: string[], maxDisplay: number = 10): string {
  if (items.length <= maxDisplay) {
    return items.join("\n");
  }
  const shown = items.slice(0, maxDisplay);
  const remaining = items.length - maxDisplay;
  return `${shown.join("\n")}\n... and ${String(remaining)} more`;
}

function getDefaultBranch(branches: RepositoryBranch[]): string {
  const defaultBranch = branches.find((b) => b.isDefault);
  return defaultBranch ? defaultBranch.name : "main";
}

function parseTaskTimestamp(task: TaskSummary): number | undefined {
  const updatedAt = Date.parse(task.updatedAt);
  if (!Number.isNaN(updatedAt)) return updatedAt;
  const createdAt = Date.parse(task.createdAt);
  if (!Number.isNaN(createdAt)) return createdAt;
  return undefined;
}

function buildAssignedTaskUrl(repo: string, task: TaskSummary): string {
  if (task.htmlUrl) return task.htmlUrl;
  return `/agent-tasks?repo=${encodeURIComponent(repo)}&taskId=${encodeURIComponent(task.id)}`;
}

function resolveTaskBranchName(task: TaskSummary): string | undefined {
  const headRef = task.headRef.trim();
  if (headRef) return headRef;

  const branch = task.branch.trim();
  return branch || undefined;
}

function buildBranchAgentAssignments(
  repo: string,
  tasks: TaskSummary[],
  branchNames: Set<string>
): Record<string, BranchAgentAssignment> {
  const assignments = new Map<
    string,
    BranchAgentAssignment & { timestamp: number | undefined }
  >();

  for (const task of tasks) {
    const branchName = resolveTaskBranchName(task);
    if (!branchName || !branchNames.has(branchName)) continue;

    const timestamp = parseTaskTimestamp(task);
    const existing = assignments.get(branchName);
    const nextCount = (existing?.count ?? 0) + 1;
    const shouldReplace =
      !existing ||
      (timestamp !== undefined &&
        (existing.timestamp === undefined || timestamp > existing.timestamp));

    if (shouldReplace) {
      const { label, tone } = getAgentTaskStatusPresentation(task);
      assignments.set(branchName, {
        taskId: task.id,
        url: buildAssignedTaskUrl(repo, task),
        count: nextCount,
        statusLabel: label,
        statusTone: tone,
        timestamp,
      });
      continue;
    }

    assignments.set(branchName, {
      ...existing,
      count: nextCount,
    });
  }

  return Object.fromEntries(
    Array.from(assignments.entries()).map(([branchName, assignment]) => [
      branchName,
      {
        taskId: assignment.taskId,
        url: assignment.url,
        count: assignment.count,
        statusLabel: assignment.statusLabel,
        statusTone: assignment.statusTone,
      },
    ])
  );
}

function resolveInitialRepo(queryRepo: string): string {
  if (queryRepo) return queryRepo;
  return loadLastRepo();
}

function loadInitialBranches(repo: string): RepositoryBranch[] {
  if (!repo) return [];
  const cached = loadCachedBranches(repo);
  return sortBranchesByNewestCommit(cached);
}

export default function BranchesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryRepo = searchParams.get("repo") ?? "";
  const initialRepo = resolveInitialRepo(queryRepo);

  const [repoInput, setRepoInput] = useState(initialRepo);
  const [branches, setBranches] = useState<RepositoryBranch[]>(() =>
    loadInitialBranches(initialRepo)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedRepo, setLoadedRepo] = useState(() =>
    loadInitialBranches(initialRepo).length > 0 ? initialRepo : ""
  );
  const [lastFetchedAt, setLastFetchedAt] = useState(() =>
    initialRepo ? loadCachedBranchesFetchedAt(initialRepo) : ""
  );

  const [selectedBranches, setSelectedBranches] = useState<Set<string>>(new Set());
  const [bearerToken, setBearerToken] = useState(loadBearerToken);
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [actionResults, setActionResults] = useState<ActionResult[]>([]);
  const [branchAgentAssignments, setBranchAgentAssignments] =
    useState<Record<string, BranchAgentAssignment>>({});
  const [mergeMethod, setMergeMethod] = useState<MergeMethod>("merge");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(
    loadAutoRefreshEnabled
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  const autoLoadedRepoRef = useRef<string>("");
  const currentSearchRef = useRef(searchParams.toString());

  const resolveRepoInput = useCallback((input: string): string => {
    const trimmed = input.trim();
    if (!trimmed) return "";

    const parsed = parseRepositoryLocation(trimmed);
    if (parsed) return parsed.repo;

    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(trimmed)) {
      return trimmed;
    }

    return trimmed;
  }, []);

  const loadBranchesForRepo = useCallback(
    async (repo: string, options: LoadBranchesOptions = {}) => {
      const { clearActionResults = true, useCachedBranches = true } = options;
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError("");
      setBranchAgentAssignments({});
      if (clearActionResults) {
        setActionResults([]);
      }

      const cachedBranches = useCachedBranches ? loadCachedBranches(repo) : [];
      if (useCachedBranches) {
        if (cachedBranches.length > 0) {
          setBranches(sortBranchesByNewestCommit(cachedBranches));
          setLoadedRepo(repo);
        } else {
          setBranches([]);
          setBranchAgentAssignments({});
          setLoadedRepo("");
          setSelectedBranches(new Set());
        }
      }

      try {
        const result = await requestRepositoryBranches(
          repo,
          controller.signal
        );
        const sorted = sortBranchesByNewestCommit(result);
        const branchNames = new Set(sorted.map((branch) => branch.name));
        let nextBranchAgentAssignments: Record<string, BranchAgentAssignment> = {};

        const ownerRepo = splitOwnerRepo(repo);
        if (ownerRepo && bearerToken.trim() && branchNames.size > 0) {
          try {
            const agentTasks = await requestAgentTasks(
              ownerRepo.owner,
              ownerRepo.name,
              bearerToken.trim(),
              controller.signal
            );
            if (!controller.signal.aborted) {
              nextBranchAgentAssignments = buildBranchAgentAssignments(
                repo,
                extractTaskSummaries(agentTasks),
                branchNames
              );
            }
          } catch {
            if (!controller.signal.aborted) {
              nextBranchAgentAssignments = {};
            }
          }
        }

        setBranches(sorted);
        setBranchAgentAssignments(nextBranchAgentAssignments);
        setLoadedRepo(repo);
        saveCachedBranches(repo, sorted);
        saveLastRepo(repo);
        setLastFetchedAt(loadCachedBranchesFetchedAt(repo));

        setSelectedBranches((prev) => {
          const validRefs = new Set(sorted.map((b) => b.ref));
          const next = new Set<string>();
          for (const ref of prev) {
            if (validRefs.has(ref)) next.add(ref);
          }
          return next;
        });

        const params = new URLSearchParams(currentSearchRef.current);
        params.set("repo", repo);
        setSearchParams(params, { replace: true });
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Unable to load branches"
        );
        if (cachedBranches.length > 0) {
          setError(
            (err instanceof Error && err.message
              ? err.message
              : "Unable to refresh branches") +
              " — showing cached data."
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [bearerToken, setSearchParams]
  );

  useEffect(() => {
    currentSearchRef.current = searchParams.toString();
  }, [searchParams]);

  const handleLoadBranches = useCallback(async () => {
    const repo = resolveRepoInput(repoInput);
    if (!repo) {
      setError("Please enter a repository in owner/repo format.");
      return;
    }

    autoLoadedRepoRef.current = repo;
    await loadBranchesForRepo(repo);
  }, [loadBranchesForRepo, repoInput, resolveRepoInput]);

  useEffect(() => {
    const repo = resolveRepoInput(initialRepo);
    if (!repo || autoLoadedRepoRef.current === repo) {
      return;
    }

    autoLoadedRepoRef.current = repo;
    setRepoInput(repo);

    const refreshTimer = window.setTimeout(() => {
      void loadBranchesForRepo(repo);
    }, 0);

    return () => {
      window.clearTimeout(refreshTimer);
    };
  }, [loadBranchesForRepo, initialRepo, resolveRepoInput]);

  useEffect(() => {
    if (!bearerToken.trim()) {
      setBranchAgentAssignments({});
    }
  }, [bearerToken]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!loadedRepo || !autoRefreshEnabled) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (isLoading || actionInProgress) {
        return;
      }

      void loadBranchesForRepo(loadedRepo, {
        clearActionResults: false,
        useCachedBranches: false,
      });
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    actionInProgress,
    autoRefreshEnabled,
    isLoading,
    loadBranchesForRepo,
    loadedRepo,
  ]);

  const toggleBranchSelection = useCallback((ref: string) => {
    setSelectedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) {
        next.delete(ref);
      } else {
        next.add(ref);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedBranches((prev) => {
      if (prev.size === branches.length) {
        return new Set();
      }
      return new Set(branches.map((b) => b.ref));
    });
  }, [branches]);

  const selectedBranchObjects = branches.filter((b) =>
    selectedBranches.has(b.ref)
  );

  const handleBearerTokenChange = useCallback((value: string) => {
    setBearerToken(value);
    saveBearerToken(value);
  }, []);

  const handleAutoRefreshChange = useCallback((value: boolean) => {
    setAutoRefreshEnabled(value);
    saveAutoRefreshEnabled(value);
  }, []);

  const handleDeleteBranches = useCallback(async () => {
    if (!loadedRepo || selectedBranchObjects.length === 0) return;
    if (!bearerToken.trim()) {
      setShowTokenInput(true);
      return;
    }

    const branchNames = selectedBranchObjects.map((b) => b.name);
    const confirmed = window.confirm(
      `Delete ${String(branchNames.length)} branch${branchNames.length !== 1 ? "es" : ""}?\n\n${formatConfirmList(branchNames)}\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;

    setActionInProgress(true);
    setActionResults([]);
    const results: ActionResult[] = [];

    for (const branch of selectedBranchObjects) {
      try {
        await requestDeleteRemoteBranch(loadedRepo, branch.name, bearerToken.trim());
        results.push({ branch: branch.name, success: true, message: "Deleted" });
      } catch (err) {
        results.push({
          branch: branch.name,
          success: false,
          message: err instanceof Error ? err.message : "Failed to delete",
        });
      }
    }

    setActionResults(results);
    setActionInProgress(false);

    const deletedNames = new Set(
      results.filter((r) => r.success).map((r) => r.branch)
    );
    if (deletedNames.size > 0) {
      setBranches((prev) => prev.filter((b) => !deletedNames.has(b.name)));
      setSelectedBranches((prev) => {
        const next = new Set(prev);
        for (const b of selectedBranchObjects) {
          if (deletedNames.has(b.name)) {
            next.delete(b.ref);
          }
        }
        return next;
      });
    }

    void loadBranchesForRepo(loadedRepo, {
      clearActionResults: false,
      useCachedBranches: false,
    });
  }, [loadedRepo, selectedBranchObjects, bearerToken, loadBranchesForRepo]);

  const handleReadyForReview = useCallback(async () => {
    if (!loadedRepo || selectedBranchObjects.length === 0) return;
    if (!bearerToken.trim()) {
      setShowTokenInput(true);
      return;
    }

    const branchesWithPr = selectedBranchObjects.filter(
      (b) => b.pullRequest && b.pullRequestStatus === "open"
    );
    if (branchesWithPr.length === 0) {
      setActionResults([
        {
          branch: "",
          success: false,
          message: "No selected branches have an open pull request.",
        },
      ]);
      return;
    }

    setActionInProgress(true);
    setActionResults([]);
    const results: ActionResult[] = [];

    for (const branch of branchesWithPr) {
      try {
        await requestPullRequestReady(
          loadedRepo,
          branch.pullRequest!.number,
          bearerToken.trim()
        );
        results.push({
          branch: branch.name,
          success: true,
          message: `PR #${String(branch.pullRequest!.number)} marked as ready`,
        });
      } catch (err) {
        results.push({
          branch: branch.name,
          success: false,
          message: err instanceof Error ? err.message : "Failed",
        });
      }
    }

    setActionResults(results);
    setActionInProgress(false);
    void loadBranchesForRepo(loadedRepo, {
      clearActionResults: false,
      useCachedBranches: false,
    });
  }, [loadedRepo, selectedBranchObjects, bearerToken, loadBranchesForRepo]);

  const handleMergePullRequests = useCallback(async () => {
    if (!loadedRepo || selectedBranchObjects.length === 0) return;
    if (!bearerToken.trim()) {
      setShowTokenInput(true);
      return;
    }

    const branchesWithPr = selectedBranchObjects.filter(
      (b) => b.pullRequest && b.pullRequestStatus === "open"
    );
    if (branchesWithPr.length === 0) {
      setActionResults([
        {
          branch: "",
          success: false,
          message: "No selected branches have an open pull request to merge.",
        },
      ]);
      return;
    }

    const prNumbers = branchesWithPr.map((b) => `#${String(b.pullRequest!.number)}`);
    const confirmed = window.confirm(
      `Merge ${String(branchesWithPr.length)} pull request${branchesWithPr.length !== 1 ? "s" : ""} (${mergeMethod})?\n\n${formatConfirmList(prNumbers)}`
    );
    if (!confirmed) return;

    setActionInProgress(true);
    setActionResults([]);
    const results: ActionResult[] = [];

    for (const branch of branchesWithPr) {
      try {
        const result = await requestPullRequestMerge(
          loadedRepo,
          branch.pullRequest!.number,
          mergeMethod,
          bearerToken.trim()
        );
        results.push({
          branch: branch.name,
          success: true,
          message: result.merged
            ? `PR #${String(branch.pullRequest!.number)} merged`
            : `PR #${String(branch.pullRequest!.number)}: ${result.message}`,
        });
      } catch (err) {
        results.push({
          branch: branch.name,
          success: false,
          message: err instanceof Error ? err.message : "Failed to merge",
        });
      }
    }

    setActionResults(results);
    setActionInProgress(false);
    void loadBranchesForRepo(loadedRepo, {
      clearActionResults: false,
      useCachedBranches: false,
    });
  }, [
    loadedRepo,
    selectedBranchObjects,
    bearerToken,
    mergeMethod,
    loadBranchesForRepo,
  ]);

  const handleCreatePullRequests = useCallback(async (draft: boolean) => {
    if (!loadedRepo || selectedBranchObjects.length === 0) return;
    if (!bearerToken.trim()) {
      setShowTokenInput(true);
      return;
    }

    const branchesWithoutPr = selectedBranchObjects.filter(
      (b) => b.pullRequestStatus === "none" && !b.isDefault
    );
    if (branchesWithoutPr.length === 0) {
      setActionResults([
        {
          branch: "",
          success: false,
          message:
            "No selected branches are eligible. Branches must not have an existing PR and must not be the default branch.",
        },
      ]);
      return;
    }

    const baseBranch = getDefaultBranch(branches);

    setActionInProgress(true);
    setActionResults([]);
    const results: ActionResult[] = [];

    for (const branch of branchesWithoutPr) {
      try {
        const result = await requestPullRequestOpen(
          loadedRepo,
          branch.name,
          baseBranch,
          draft,
          bearerToken.trim()
        );
        results.push({
          branch: branch.name,
          success: true,
          message: draft
            ? `Draft PR #${String(result.pullNumber)} created: ${result.title}`
            : `PR #${String(result.pullNumber)} opened: ${result.title}`,
        });
      } catch (err) {
        results.push({
          branch: branch.name,
          success: false,
          message: err instanceof Error
            ? err.message
            : draft
              ? "Failed to create draft PR"
              : "Failed to open PR",
        });
      }
    }

    setActionResults(results);
    setActionInProgress(false);
    void loadBranchesForRepo(loadedRepo, {
      clearActionResults: false,
      useCachedBranches: false,
    });
  }, [
    loadedRepo,
    selectedBranchObjects,
    bearerToken,
    branches,
    loadBranchesForRepo,
  ]);

  const clearActionResults = useCallback(() => {
    setActionResults([]);
  }, []);

  const branchListStatusMessage = isLoading
    ? "↻ refreshing"
    : lastFetchedAt
      ? `updated ${formatRelativeDateTime(lastFetchedAt)}`
      : "";
  const branchListStatusTitle = lastFetchedAt
    ? `Last updated ${formatAbsoluteDateTime(lastFetchedAt)}`
    : undefined;

  const hasSelection = selectedBranches.size > 0;
  const allSelected = branches.length > 0 && selectedBranches.size === branches.length;

  return (
    <div className="branches-page">
      <div className="page-header">
        <h1>🌿 Branches</h1>
        <p className="page-subtitle">
          Browse branches of a repository, sorted by most recent commit.
        </p>
      </div>

      <div className="branches-page__input-section">
        <label htmlFor="branches-page-input">Repository</label>
        <div className="branches-page__input-row">
          <input
            id="branches-page-input"
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleLoadBranches();
            }}
            placeholder="owner/repo or paste full GitHub URL"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => void handleLoadBranches()}
            disabled={isLoading || !repoInput.trim()}
          >
            {isLoading && !loadedRepo ? "Loading…" : "Load branches"}
          </button>
          {loadedRepo && (
            <button
              type="button"
              onClick={() => void loadBranchesForRepo(loadedRepo)}
              disabled={isLoading}
            >
              {isLoading ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>
        {loadedRepo && (
          <div className="branches-page__nav-links">
            <Link
              to={`/commits?repo=${encodeURIComponent(loadedRepo)}`}
              className="branches-page__nav-link"
            >
              View commits →
            </Link>
            <label className="branches-page__auto-refresh-toggle">
              <input
                type="checkbox"
                checked={autoRefreshEnabled}
                onChange={(e) => handleAutoRefreshChange(e.target.checked)}
              />
              Auto-refresh every 30s
            </label>
            <button
              type="button"
              className="branches-page__token-toggle"
              onClick={() => setShowTokenInput((v) => !v)}
            >
              {showTokenInput ? "Hide token" : "🔑 API token"}
            </button>
          </div>
        )}
        {showTokenInput && (
          <div className="branches-page__token-section">
            <label htmlFor="branches-page-token">Bearer Token</label>
            <input
              id="branches-page-token"
              type="password"
              value={bearerToken}
              onChange={(e) => handleBearerTokenChange(e.target.value)}
              placeholder="Required for write operations and agent task links"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        )}
      </div>

      {error && <div className="branches-page__error">{error}</div>}

      {actionResults.length > 0 && (
        <div className="branches-page__action-results">
          <div className="branches-page__action-results-header">
            <span>Action Results</span>
            <button
              type="button"
              className="branches-page__action-results-close"
              onClick={clearActionResults}
            >
              ✕
            </button>
          </div>
          {actionResults.map((result, i) => (
            <div
              key={`${result.branch}-${String(i)}`}
              className={
                "branches-page__action-result" +
                (result.success
                  ? " branches-page__action-result--success"
                  : " branches-page__action-result--error")
              }
            >
              {result.branch && (
                <span className="branches-page__action-result-branch">
                  {result.branch}:
                </span>
              )}{" "}
              {result.message}
            </div>
          ))}
        </div>
      )}

      {branches.length > 0 && (
        <div className="branches-page__branches">
          <div className="branches-page__branches-header">
            <div className="branches-page__branches-header-left">
              <label className="branches-page__select-all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                />
              </label>
              <span className="branches-page__branches-title">
                Branches in{" "}
                <a
                  href={`https://github.com/${loadedRepo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="branches-page__repo-link"
                >
                  {loadedRepo}
                </a>
              </span>
            </div>
            <span className="branches-page__branches-count">
              {hasSelection
                ? `${String(selectedBranches.size)} of ${String(branches.length)} selected`
                : `${String(branches.length)} branch${branches.length !== 1 ? "es" : ""}`}
              {branchListStatusMessage && (
                <span
                  className="branches-page__refreshing"
                  title={branchListStatusTitle}
                >
                  {" "}
                  — {branchListStatusMessage}
                </span>
              )}
            </span>
          </div>

          <div className="branches-page__branch-list">
            {branches.map((branch) => {
              const isSelected = selectedBranches.has(branch.ref);
              const agentAssignment = branchAgentAssignments[branch.name];
              const pullRequestReviewState = getPullRequestReviewState(
                branch.pullRequest
              );

              return (
                <div
                  key={branch.ref}
                  className={
                    "branches-page__branch" +
                    (branch.isDefault ? " branches-page__branch--default" : "") +
                    (isSelected ? " branches-page__branch--selected" : "")
                  }
                >
                  <label className="branches-page__branch-checkbox">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleBranchSelection(branch.ref)}
                    />
                  </label>
                  <div className="branches-page__branch-main">
                    <div className="branches-page__branch-name-row">
                      <a
                        href={buildGitHubBranchUrl(loadedRepo, branch.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="branches-page__branch-name"
                      >
                        {branch.name}
                      </a>
                      {branch.isDefault && (
                        <span className="branches-page__default-badge">
                          default
                        </span>
                      )}
                      {branch.pullRequestStatus !== "none" && (
                        <span
                          className={
                            "branches-page__pr-status " +
                            getPrStatusClass(branch.pullRequestStatus)
                          }
                        >
                          PR {branch.pullRequestStatus}
                        </span>
                      )}
                    </div>
                    <div className="branches-page__branch-commit-info">
                      <a
                        href={buildGitHubCommitUrl(loadedRepo, branch.commit)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="branches-page__commit-sha"
                      >
                        {branch.commitShort}
                      </a>
                      <span className="branches-page__commit-title">
                        {branch.title}
                      </span>
                    </div>
                    <div className="branches-page__branch-meta">
                      <span className="branches-page__branch-author">
                        {branch.author}
                      </span>
                      <span
                        className="branches-page__branch-date"
                        title={formatBranchDate(branch.date)}
                      >
                        {formatRelativeTime(branch.date)}
                      </span>
                    </div>
                  </div>
                  <div className="branches-page__branch-badges">
                    {branch.tags.map((tag) => (
                      <span key={tag} className="branches-page__tag-badge">
                        {tag}
                      </span>
                    ))}
                    {branch.pullRequest && (
                      <a
                        href={branch.pullRequest.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="branches-page__pr-badge"
                      >
                        #{branch.pullRequest.number}
                      </a>
                    )}
                    {pullRequestReviewState && (
                      <span
                        className={
                          "branches-page__pr-state-badge branches-page__pr-state-badge--" +
                          pullRequestReviewState.tone
                        }
                      >
                        {pullRequestReviewState.label}
                      </span>
                    )}
                    {agentAssignment && (
                      <a
                        href={agentAssignment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={
                          "branches-page__agent-task-badge branches-page__agent-task-badge--" +
                          agentAssignment.statusTone
                        }
                        title={
                          agentAssignment.count > 1
                            ? `${agentAssignment.count} assigned agent tasks — latest status: ${agentAssignment.statusLabel}`
                            : `Assigned agent task ${agentAssignment.taskId} — status: ${agentAssignment.statusLabel}`
                        }
                      >
                        🤖 {agentAssignment.statusLabel}
                        {agentAssignment.count > 1
                          ? ` · ${agentAssignment.count}`
                          : ""}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {hasSelection && (
        <div className="branches-page__action-bar">
          <span className="branches-page__action-bar-count">
            {String(selectedBranches.size)} selected
          </span>
          <div className="branches-page__action-bar-actions">
            <button
              type="button"
              className="branches-page__action-btn branches-page__action-btn--create"
              onClick={() => void handleCreatePullRequests(true)}
              disabled={actionInProgress}
              title="Create draft pull requests for selected branches"
            >
              Create PR
            </button>
            <button
              type="button"
              className="branches-page__action-btn branches-page__action-btn--open"
              onClick={() => void handleCreatePullRequests(false)}
              disabled={actionInProgress}
              title="Open pull requests for selected branches"
            >
              Open PR
            </button>
            <button
              type="button"
              className="branches-page__action-btn branches-page__action-btn--ready"
              onClick={() => void handleReadyForReview()}
              disabled={actionInProgress}
              title="Mark selected pull requests as ready for review"
            >
              Ready to Review
            </button>
            <button
              type="button"
              className="branches-page__action-btn branches-page__action-btn--merge"
              onClick={() => void handleMergePullRequests()}
              disabled={actionInProgress}
              title="Merge selected pull requests"
            >
              Merge PR
            </button>
            <select
              className="branches-page__merge-method"
              value={mergeMethod}
              onChange={(e) => setMergeMethod(e.target.value as MergeMethod)}
              title="Merge method"
            >
              <option value="merge">merge</option>
              <option value="squash">squash</option>
              <option value="rebase">rebase</option>
            </select>
            <button
              type="button"
              className="branches-page__action-btn branches-page__action-btn--delete"
              onClick={() => void handleDeleteBranches()}
              disabled={actionInProgress}
              title="Delete selected branches"
            >
              {actionInProgress ? "Working…" : "Delete"}
            </button>
          </div>
        </div>
      )}

      {!isLoading && branches.length === 0 && !error && loadedRepo === "" && (
        <div className="branches-page__empty">
          <div className="branches-page__empty-icon">🌿</div>
          <h2>Enter a repository</h2>
          <p>
            Type a repository name (e.g. <code>facebook/react</code>) and click
            &quot;Load branches&quot; to browse its branches.
          </p>
        </div>
      )}
    </div>
  );
}
