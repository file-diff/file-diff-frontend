import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  resolveRepositoryInput,
  requestRepositoryActions,
  requestDeleteActionRun,
} from "../utils/repositorySelection";
import type { RepositoryActionRun } from "../utils/repositorySelection";
import {
  loadCachedActions,
  loadCachedActionsFetchedAt,
  saveCachedActions,
  loadLastRepo,
  saveLastRepo,
  loadActionLimit,
  saveActionLimit,
  loadAutoRefreshEnabled,
  saveAutoRefreshEnabled,
} from "../utils/actionsPageStorage";
import {
  loadBearerToken,
  saveBearerToken,
} from "../utils/bearerTokenStorage";
import {
  formatRelativeDateTime,
  formatAbsoluteDateTime,
} from "../utils/organizationBrowserPresentation";
import RepositorySelector from "../components/RepositorySelector";
import "./ActionsPage.css";

const AUTO_REFRESH_INTERVAL_MS = 30_000;
const DEFAULT_ACTION_LIMIT = 20;
const ACTION_LIMIT_OPTIONS = [20, 50, 100, 200] as const;

interface ActionResult {
  run: string;
  success: boolean;
  message: string;
}

interface LoadActionsOptions {
  clearActionResults?: boolean;
  useCachedActions?: boolean;
}

function buildGitHubCommitUrl(repo: string, commit: string): string {
  const parts = repo.split("/");
  if (parts.length !== 2) return "";
  return `https://github.com/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/commit/${encodeURIComponent(commit)}`;
}

function formatRunDate(isoDate: string): string {
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

function formatConfirmList(items: string[], maxDisplay: number = 10): string {
  if (items.length <= maxDisplay) {
    return items.join("\n");
  }
  const shown = items.slice(0, maxDisplay);
  const remaining = items.length - maxDisplay;
  return `${shown.join("\n")}\n... and ${String(remaining)} more`;
}

function getRunStatusTone(
  run: RepositoryActionRun
):
  | "completed"
  | "failed"
  | "active"
  | "waiting"
  | "cancelled"
  | "neutral" {
  const status = run.status.toLowerCase();
  const conclusion = (run.conclusion ?? "").toLowerCase();
  if (status === "completed") {
    if (conclusion === "success") return "completed";
    if (conclusion === "failure" || conclusion === "timed_out") return "failed";
    if (conclusion === "cancelled" || conclusion === "skipped")
      return "cancelled";
    return "neutral";
  }
  if (status === "in_progress" || status === "running") return "active";
  if (
    status === "queued" ||
    status === "waiting" ||
    status === "pending" ||
    status === "requested"
  ) {
    return "waiting";
  }
  return "neutral";
}

function getRunStatusLabel(run: RepositoryActionRun): string {
  const status = run.status.toLowerCase();
  const conclusion = (run.conclusion ?? "").toLowerCase();
  if (status === "completed" && conclusion) {
    return conclusion;
  }
  return status || "unknown";
}

function resolveInitialRepo(queryRepo: string): string {
  if (queryRepo) return queryRepo;
  return loadLastRepo();
}

function loadInitialRuns(repo: string): RepositoryActionRun[] {
  if (!repo) return [];
  return loadCachedActions(repo);
}

interface ActionsPageProps {
  showRepositorySelector?: boolean;
  refreshIntervalMs?: number;
  bearerToken?: string;
}

export default function ActionsPage({
  showRepositorySelector = true,
  refreshIntervalMs,
  bearerToken: bearerTokenProp,
}: ActionsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryRepo = searchParams.get("repo") ?? "";
  const initialRepo = resolveInitialRepo(queryRepo);

  const [repoInput, setRepoInput] = useState(initialRepo);
  const [runs, setRuns] = useState<RepositoryActionRun[]>(() =>
    loadInitialRuns(initialRepo)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedRepo, setLoadedRepo] = useState(() =>
    loadInitialRuns(initialRepo).length > 0 ? initialRepo : ""
  );
  const [lastFetchedAt, setLastFetchedAt] = useState(() =>
    initialRepo ? loadCachedActionsFetchedAt(initialRepo) : ""
  );
  const [actionLimit, setActionLimit] = useState(() =>
    loadActionLimit(DEFAULT_ACTION_LIMIT)
  );

  const [selectedRuns, setSelectedRuns] = useState<Set<number>>(new Set());
  const [localBearerToken, setLocalBearerToken] = useState(loadBearerToken);
  const bearerToken = bearerTokenProp ?? localBearerToken;
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [actionResults, setActionResults] = useState<ActionResult[]>([]);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(
    loadAutoRefreshEnabled
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  const autoLoadedRepoRef = useRef<string>("");
  const currentSearchRef = useRef(searchParams.toString());

  const loadActionsForRepo = useCallback(
    async (
      repo: string,
      limit: number,
      options: LoadActionsOptions = {}
    ) => {
      const { clearActionResults: clearResults = true, useCachedActions = true } =
        options;
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError("");
      if (clearResults) {
        setActionResults([]);
      }

      const cached = useCachedActions ? loadCachedActions(repo) : [];
      if (useCachedActions) {
        if (cached.length > 0) {
          setRuns(cached);
          setLoadedRepo(repo);
        } else {
          setRuns([]);
          setLoadedRepo("");
          setSelectedRuns(new Set());
        }
      }

      try {
        const result = await requestRepositoryActions(
          repo,
          limit,
          controller.signal
        );

        setRuns(result);
        setLoadedRepo(repo);
        saveCachedActions(repo, result);
        saveLastRepo(repo);
        setLastFetchedAt(loadCachedActionsFetchedAt(repo));

        setSelectedRuns((prev) => {
          const validIds = new Set(result.map((r) => r.id));
          const next = new Set<number>();
          for (const id of prev) {
            if (validIds.has(id)) next.add(id);
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
            : "Unable to load workflow runs"
        );
        if (cached.length > 0) {
          setError(
            (err instanceof Error && err.message
              ? err.message
              : "Unable to refresh workflow runs") + " — showing cached data."
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [setSearchParams]
  );

  useEffect(() => {
    currentSearchRef.current = searchParams.toString();
  }, [searchParams]);

  const handleLoadActions = useCallback(async () => {
    const repo = resolveRepositoryInput(repoInput);
    if (!repo) {
      setError("Please enter a repository in owner/repo format.");
      return;
    }

    autoLoadedRepoRef.current = repo;
    await loadActionsForRepo(repo, actionLimit);
  }, [loadActionsForRepo, repoInput, actionLimit]);

  useEffect(() => {
    const repo = resolveRepositoryInput(initialRepo);
    if (!repo || autoLoadedRepoRef.current === repo) {
      return;
    }

    autoLoadedRepoRef.current = repo;
    setRepoInput(repo);

    const refreshTimer = window.setTimeout(() => {
      void loadActionsForRepo(repo, actionLimit);
    }, 0);

    return () => {
      window.clearTimeout(refreshTimer);
    };
    // actionLimit intentionally not in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadActionsForRepo, initialRepo]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const effectiveInterval =
      refreshIntervalMs ?? (autoRefreshEnabled ? AUTO_REFRESH_INTERVAL_MS : 0);
    if (!loadedRepo || !effectiveInterval) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (isLoading || actionInProgress) {
        return;
      }

      void loadActionsForRepo(loadedRepo, actionLimit, {
        clearActionResults: false,
        useCachedActions: false,
      });
    }, effectiveInterval);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    actionInProgress,
    autoRefreshEnabled,
    isLoading,
    loadActionsForRepo,
    loadedRepo,
    refreshIntervalMs,
    actionLimit,
  ]);

  const toggleRunSelection = useCallback((id: number) => {
    setSelectedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedRuns((prev) => {
      if (prev.size === runs.length) {
        return new Set();
      }
      return new Set(runs.map((r) => r.id));
    });
  }, [runs]);

  const selectedRunObjects = useMemo(
    () => runs.filter((r) => selectedRuns.has(r.id)),
    [runs, selectedRuns]
  );

  const handleAutoRefreshChange = useCallback((value: boolean) => {
    setAutoRefreshEnabled(value);
    saveAutoRefreshEnabled(value);
  }, []);

  const handleBearerTokenChange = useCallback((value: string) => {
    setLocalBearerToken(value);
    saveBearerToken(value);
  }, []);

  const handleActionLimitChange = useCallback(
    (limit: number) => {
      setActionLimit(limit);
      saveActionLimit(limit);
      if (loadedRepo) {
        void loadActionsForRepo(loadedRepo, limit, {
          clearActionResults: false,
          useCachedActions: false,
        });
      }
    },
    [loadActionsForRepo, loadedRepo]
  );

  const handleDeleteRuns = useCallback(async () => {
    if (!loadedRepo || selectedRunObjects.length === 0) return;
    if (!bearerToken.trim()) {
      setShowTokenInput(true);
      return;
    }

    const runLabels = selectedRunObjects.map(
      (r) => `${r.name} #${String(r.runNumber)}`
    );
    const confirmed = window.confirm(
      `Delete ${String(runLabels.length)} workflow run${runLabels.length !== 1 ? "s" : ""}?\n\n${formatConfirmList(runLabels)}\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;

    setActionInProgress(true);
    setActionResults([]);
    const results: ActionResult[] = [];
    const deletedRunIds = new Set<number>();

    for (const run of selectedRunObjects) {
      const runLabel = `${run.name} #${String(run.runNumber)}`;

      try {
        await requestDeleteActionRun(loadedRepo, run.id, bearerToken.trim());
        deletedRunIds.add(run.id);
        results.push({ run: runLabel, success: true, message: "Deleted" });
      } catch (err) {
        results.push({
          run: runLabel,
          success: false,
          message: err instanceof Error ? err.message : "Failed to delete",
        });
      }
    }

    setActionResults(results);
    setActionInProgress(false);

    if (deletedRunIds.size > 0) {
      setRuns((prev) => prev.filter((run) => !deletedRunIds.has(run.id)));
      setSelectedRuns((prev) => {
        const next = new Set(prev);
        for (const runId of deletedRunIds) {
          next.delete(runId);
        }
        return next;
      });
    }

    void loadActionsForRepo(loadedRepo, actionLimit, {
      clearActionResults: false,
      useCachedActions: false,
    });
  }, [
    actionLimit,
    bearerToken,
    loadActionsForRepo,
    loadedRepo,
    selectedRunObjects,
  ]);

  const clearActionResults = useCallback(() => {
    setActionResults([]);
  }, []);

  const runListStatusMessage = isLoading
    ? "↻ refreshing"
    : lastFetchedAt
      ? `updated ${formatRelativeDateTime(lastFetchedAt)}`
      : "";
  const runListStatusTitle = lastFetchedAt
    ? `Last updated ${formatAbsoluteDateTime(lastFetchedAt)}`
    : undefined;

  const hasSelection = selectedRuns.size > 0;
  const allSelected = runs.length > 0 && selectedRuns.size === runs.length;
  const actionBar = hasSelection ? (
    <div
      className={
        "actions-page__action-bar" +
        (showRepositorySelector ? "" : " actions-page__action-bar--inline")
      }
    >
      <span className="actions-page__action-bar-count">
        {String(selectedRuns.size)} selected
      </span>
      <div className="actions-page__action-bar-actions">
        <button
          type="button"
          className="actions-page__action-btn actions-page__action-btn--delete"
          onClick={() => void handleDeleteRuns()}
          disabled={actionInProgress}
          title="Delete selected workflow runs"
        >
          {actionInProgress ? "Working…" : "Delete"}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="actions-page">
      <div className="page-header">
        <h1>⚙️ Actions</h1>
        <p className="page-subtitle">
          Browse GitHub Actions workflow runs of a repository, newest first.
        </p>
      </div>

      {showRepositorySelector && (
        <RepositorySelector
          inputId="actions-page-input"
          value={repoInput}
          onChange={setRepoInput}
          onSubmit={handleLoadActions}
          buttonLabel="Load runs"
          loadingButtonLabel="Loading…"
          isLoading={isLoading && !loadedRepo}
          disabled={isLoading || !repoInput.trim()}
          actions={
            loadedRepo ? (
              <button
                type="button"
                onClick={() => void loadActionsForRepo(loadedRepo, actionLimit)}
                disabled={isLoading}
              >
                {isLoading ? "Refreshing…" : "Refresh"}
              </button>
            ) : null
          }
        />
      )}
      <div className="actions-page__input-section">
        {loadedRepo && showRepositorySelector && (
          <div className="actions-page__nav-links">
            <label className="actions-page__auto-refresh-toggle">
              <input
                type="checkbox"
                checked={autoRefreshEnabled}
                onChange={(e) => handleAutoRefreshChange(e.target.checked)}
              />
              Auto-refresh every 30s
            </label>
            {bearerTokenProp === undefined && (
              <button
                type="button"
                className="actions-page__token-toggle"
                onClick={() => setShowTokenInput((v) => !v)}
              >
                {showTokenInput ? "Hide token" : "🔑 API token"}
              </button>
            )}
          </div>
        )}
        {bearerTokenProp === undefined && showTokenInput && (
          <div className="actions-page__token-section">
            <label htmlFor="actions-page-token">Bearer Token</label>
            <input
              id="actions-page-token"
              type="password"
              value={bearerToken}
              onChange={(e) => handleBearerTokenChange(e.target.value)}
              placeholder="Required for delete operations"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        )}
      </div>

      {error && <div className="actions-page__error">{error}</div>}

      {actionResults.length > 0 && (
        <div className="actions-page__action-results">
          <div className="actions-page__action-results-header">
            <span>Action Results</span>
            <button
              type="button"
              className="actions-page__action-results-close"
              onClick={clearActionResults}
            >
              ✕
            </button>
          </div>
          {actionResults.map((result, i) => (
            <div
              key={`${result.run}-${String(i)}`}
              className={
                "actions-page__action-result" +
                (result.success
                  ? " actions-page__action-result--success"
                  : " actions-page__action-result--error")
              }
            >
              {result.run && (
                <span className="actions-page__action-result-run">
                  {result.run}:
                </span>
              )}{" "}
              {result.message}
            </div>
          ))}
        </div>
      )}

      {runs.length > 0 && (
        <div className="actions-page__runs">
          <div className="actions-page__runs-header">
            <div className="actions-page__runs-header-left">
              <label className="actions-page__select-all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                />
              </label>
              <span className="actions-page__runs-title">
                Workflow runs in{" "}
                <a
                  href={`https://github.com/${loadedRepo}/actions`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="actions-page__repo-link"
                >
                  {loadedRepo}
                </a>
              </span>
            </div>
            <div className="actions-page__runs-header-right">
              <label className="actions-page__limit-label">
                Show
                <select
                  className="actions-page__limit-select"
                  value={actionLimit}
                  onChange={(e) =>
                    handleActionLimitChange(Number(e.target.value))
                  }
                  disabled={isLoading}
                >
                  {ACTION_LIMIT_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                runs
              </label>
              <span className="actions-page__runs-count">
                {hasSelection
                  ? `${String(selectedRuns.size)} of ${String(runs.length)} selected`
                  : `${String(runs.length)} run${runs.length !== 1 ? "s" : ""}`}
                {runListStatusMessage && (
                  <span
                    className="actions-page__refreshing"
                    title={runListStatusTitle}
                  >
                    {" "}
                    — {runListStatusMessage}
                  </span>
                )}
              </span>
            </div>
          </div>
          {!showRepositorySelector && actionBar}

          <div className="actions-page__run-list">
            {runs.map((run) => {
              const isSelected = selectedRuns.has(run.id);
              const tone = getRunStatusTone(run);
              const label = getRunStatusLabel(run);
              return (
                <div
                  key={run.id}
                  className={
                    "actions-page__run" +
                    (isSelected ? " actions-page__run--selected" : "")
                  }
                >
                  <label className="actions-page__run-checkbox">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRunSelection(run.id)}
                    />
                  </label>
                  <div className="actions-page__run-main">
                    <div className="actions-page__run-name-row">
                      <a
                        href={run.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="actions-page__run-name"
                      >
                        {run.name} #{run.runNumber}
                      </a>
                      <span
                        className={
                          "actions-page__run-status actions-page__run-status--" +
                          tone
                        }
                      >
                        {label}
                      </span>
                      <span className="actions-page__run-event">
                        {run.event}
                      </span>
                    </div>
                    <div className="actions-page__run-commit-info">
                      <span className="actions-page__run-branch">
                        {run.branch}
                      </span>
                      <a
                        href={buildGitHubCommitUrl(loadedRepo, run.commit)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="actions-page__commit-sha"
                      >
                        {run.commitShort}
                      </a>
                    </div>
                    <div className="actions-page__run-meta">
                      <span
                        className="actions-page__run-date"
                        title={formatRunDate(run.updatedAt || run.createdAt)}
                      >
                        {formatRelativeTime(run.updatedAt || run.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showRepositorySelector && actionBar}

      {!isLoading && runs.length === 0 && !error && loadedRepo === "" && (
        <div className="actions-page__empty">
          <div className="actions-page__empty-icon">⚙️</div>
          <h2>Enter a repository</h2>
          <p>
            Type a repository name (e.g. <code>facebook/react</code>) and click
            &quot;Load runs&quot; to browse its workflow runs.
          </p>
        </div>
      )}
    </div>
  );
}
