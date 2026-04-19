import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { JOBS_API_URL } from "../config/api";
import {
  resolveRepositoryInput,
  requestRepositoryCommits,
} from "../utils/repositorySelection";
import type { RepositoryCommit } from "../utils/repositorySelection";
import RepositorySelector from "../components/RepositorySelector";
import { buildTreeComparisonLink } from "../utils/storage";
import {
  loadCachedCommits,
  loadCachedCommitsFetchedAt,
  saveCachedCommits,
  loadLastRepo,
  saveLastRepo,
  loadCommitLimit,
  saveCommitLimit,
  loadAutoRefreshEnabled,
  saveAutoRefreshEnabled,
} from "../utils/commitViewStorage";
import {
  formatRelativeDateTime,
  formatAbsoluteDateTime,
} from "../utils/organizationBrowserPresentation";
import "./RepositoryBrowserPage.css";

const DEFAULT_COMMIT_LIMIT = 20;
const MAX_COMMIT_LIMIT = 200;
const COMMIT_LIMIT_OPTIONS = [20, 50, 100, 200] as const;
const INDEXING_TRIGGER_URL = JOBS_API_URL;
const AUTO_REFRESH_INTERVAL_MS = 30_000;

interface JobRequest {
  repo: string;
  commit: string;
}

function formatCommitDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleString();
}

function buildGitHubCommitUrl(repo: string, commit: string): string {
  const parts = repo.split("/");
  return `https://github.com/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/commit/${encodeURIComponent(commit)}`;
}

function getOptionalQueryParam(
  searchParams: URLSearchParams,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = searchParams.get(key)?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function applySelectedCommitParams(
  params: URLSearchParams,
  leftCommit: string | null,
  rightCommit: string | null
): void {
  if (leftCommit) {
    params.set("leftCommit", leftCommit);
  } else {
    params.delete("leftCommit");
  }

  if (rightCommit) {
    params.set("rightCommit", rightCommit);
  } else {
    params.delete("rightCommit");
  }
}

function resolveInitialRepo(queryRepo: string): string {
  if (queryRepo) return queryRepo;
  return loadLastRepo();
}

function loadInitialCommits(repo: string): RepositoryCommit[] {
  if (!repo) return [];
  return loadCachedCommits(repo);
}

interface RepositoryBrowserPageProps {
  showRepositorySelector?: boolean;
  refreshIntervalMs?: number;
}

export default function RepositoryBrowserPage({
  showRepositorySelector = true,
  refreshIntervalMs,
}: RepositoryBrowserPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryRepo = searchParams.get("repo") ?? "";
  const initialRepo = resolveInitialRepo(queryRepo);
  const queryLeftCommit = getOptionalQueryParam(searchParams, "leftCommit", "lc");
  const queryRightCommit = getOptionalQueryParam(
    searchParams,
    "rightCommit",
    "rc"
  );

  const [repoInput, setRepoInput] = useState(initialRepo);
  const [commits, setCommits] = useState<RepositoryCommit[]>(() =>
    loadInitialCommits(initialRepo)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedRepo, setLoadedRepo] = useState(() =>
    loadInitialCommits(initialRepo).length > 0 ? initialRepo : ""
  );
  const [commitLimit, setCommitLimit] = useState(() =>
    loadCommitLimit(DEFAULT_COMMIT_LIMIT)
  );
  const [isStartingComparison, setIsStartingComparison] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState(() =>
    initialRepo ? loadCachedCommitsFetchedAt(initialRepo) : ""
  );
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(
    loadAutoRefreshEnabled
  );

  const [leftCommit, setLeftCommit] = useState<string | null>(queryLeftCommit);
  const [rightCommit, setRightCommit] = useState<string | null>(queryRightCommit);
  const [hoveredParentCommit, setHoveredParentCommit] = useState<string | null>(
    null
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  const autoLoadedRepoRef = useRef<string>("");
  const currentSearchRef = useRef(searchParams.toString());
  const startedIndexingKeysRef = useRef<Set<string>>(new Set());
  const pendingIndexingRequestsRef = useRef<Map<string, Promise<void>>>(new Map());
  const legacyCommitSelectionSearch =
    searchParams.has("lc") || searchParams.has("rc") ? searchParams.toString() : "";

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

  const loadCommitsForRepo = useCallback(async (
    repo: string,
    limit: number,
    options: { useCachedCommits?: boolean } = {}
  ) => {
    const { useCachedCommits = true } = options;
    const isRefreshingCurrentRepo = loadedRepo === repo;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError("");

    const cachedCommits = useCachedCommits ? loadCachedCommits(repo) : [];
    if (useCachedCommits) {
      if (cachedCommits.length > 0) {
        setCommits(cachedCommits);
        setLoadedRepo(repo);
      } else if (!isRefreshingCurrentRepo) {
        setCommits([]);
        setLoadedRepo("");
      }
    }
    if (!isRefreshingCurrentRepo) {
      setLeftCommit(null);
      setRightCommit(null);
    }

    try {
      const result = await requestRepositoryCommits(
        repo,
        limit,
        controller.signal
      );
      setCommits(result);
      setLoadedRepo(repo);
      saveCachedCommits(repo, result);
      saveLastRepo(repo);
      setLastFetchedAt(loadCachedCommitsFetchedAt(repo));
    } catch (err) {
      if (controller.signal.aborted) return;
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Unable to load commits";
      if (cachedCommits.length > 0) {
        setError(message + " — showing cached data.");
      } else {
        setError(message);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [loadedRepo]);

  useEffect(() => {
    currentSearchRef.current = searchParams.toString();
  }, [searchParams]);

  const handleLoadCommits = useCallback(async () => {
    const repo = resolveRepositoryInput(repoInput);
    if (!repo) {
      setError("Please enter a repository in owner/repo format.");
      return;
    }

    autoLoadedRepoRef.current = repo;
    await loadCommitsForRepo(repo, commitLimit);
  }, [loadCommitsForRepo, repoInput, commitLimit]);

  useEffect(() => {
    const repo = resolveRepositoryInput(initialRepo);
    if (!repo || autoLoadedRepoRef.current === repo) {
      return;
    }

    autoLoadedRepoRef.current = repo;
    setRepoInput(repo);

    const refreshTimer = window.setTimeout(() => {
      void loadCommitsForRepo(repo, commitLimit);
    }, 0);

    return () => {
      window.clearTimeout(refreshTimer);
    };
  }, [loadCommitsForRepo, initialRepo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLeftCommit(queryLeftCommit);
  }, [queryLeftCommit]);

  useEffect(() => {
    setRightCommit(queryRightCommit);
  }, [queryRightCommit]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const effectiveInterval = refreshIntervalMs ?? (autoRefreshEnabled ? AUTO_REFRESH_INTERVAL_MS : 0);
    if (!loadedRepo || !effectiveInterval) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (isLoading) {
        return;
      }

      void loadCommitsForRepo(loadedRepo, commitLimit, {
        useCachedCommits: false,
      });
    }, effectiveInterval);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    autoRefreshEnabled,
    commitLimit,
    isLoading,
    loadCommitsForRepo,
    loadedRepo,
    refreshIntervalMs,
  ]);

  const ensureIndexingJobStarted = useCallback(async (repo: string, commit: string) => {
    const indexingKey = `${repo}\n${commit}`;
    if (startedIndexingKeysRef.current.has(indexingKey)) {
      return;
    }

    const pendingRequest = pendingIndexingRequestsRef.current.get(indexingKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    const request: JobRequest = { repo, commit };
    const requestPromise = fetch(INDEXING_TRIGGER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to start indexing job");
        }

        startedIndexingKeysRef.current.add(indexingKey);
      })
      .finally(() => {
        pendingIndexingRequestsRef.current.delete(indexingKey);
      });

    pendingIndexingRequestsRef.current.set(indexingKey, requestPromise);
    return requestPromise;
  }, []);

  useEffect(() => {
    if (!loadedRepo) {
      return;
    }

    updateSearchParams((params) => {
      params.set("repo", loadedRepo);
      if (legacyCommitSelectionSearch) {
        applySelectedCommitParams(params, queryLeftCommit, queryRightCommit);
        params.delete("lc");
        params.delete("rc");
        return;
      }

      applySelectedCommitParams(params, leftCommit, rightCommit);
    });
  }, [
    leftCommit,
    legacyCommitSelectionSearch,
    loadedRepo,
    queryLeftCommit,
    queryRightCommit,
    rightCommit,
    updateSearchParams,
  ]);

  useEffect(() => {
    const repo = loadedRepo.trim();
    if (!repo) {
      return;
    }

    const selectedCommits = [leftCommit, rightCommit].filter(
      (commit): commit is string => Boolean(commit?.trim())
    );

    if (selectedCommits.length === 0) {
      return;
    }

    const uniqueCommits = new Set(selectedCommits);

    uniqueCommits.forEach((commit) => {
      void ensureIndexingJobStarted(repo, commit).catch((error: unknown) => {
        console.error("[RepositoryBrowserPage] failed to start indexing job", {
          repo,
          commit,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      });
    });
  }, [ensureIndexingJobStarted, leftCommit, loadedRepo, rightCommit]);

  const reloadCommits = useCallback(
    async (limit: number) => {
      const repo = resolveRepositoryInput(repoInput);
      if (!repo || !loadedRepo) return;

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError("");

      try {
        const result = await requestRepositoryCommits(
          repo,
          limit,
          controller.signal
        );
        setCommits(result);
        saveCachedCommits(repo, result);
        setLastFetchedAt(loadCachedCommitsFetchedAt(repo));
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Unable to load commits"
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [repoInput, loadedRepo]
  );

  const handleLoadMore = useCallback(async () => {
    const nextLimit = Math.min(commits.length + commitLimit, MAX_COMMIT_LIMIT);
    await reloadCommits(nextLimit);
  }, [reloadCommits, commits.length, commitLimit]);

  const handleSelectCommit = useCallback(
    (commit: string) => {
      if (leftCommit === commit) {
        setLeftCommit(null);
        return;
      }
      if (rightCommit === commit) {
        setRightCommit(null);
        return;
      }

      if (!leftCommit) {
        setLeftCommit(commit);
      } else if (!rightCommit) {
        setRightCommit(commit);
      } else {
        setLeftCommit(rightCommit);
        setRightCommit(commit);
      }
    },
    [leftCommit, rightCommit]
  );

  const handleCommitLimitChange = useCallback(
    async (newLimit: number) => {
      setCommitLimit(newLimit);
      saveCommitLimit(newLimit);
      await reloadCommits(newLimit);
    },
    [reloadCommits]
  );

  const handleAutoRefreshChange = useCallback((value: boolean) => {
    setAutoRefreshEnabled(value);
    saveAutoRefreshEnabled(value);
  }, []);

  const handleRefresh = useCallback(() => {
    if (!loadedRepo) return;
    void loadCommitsForRepo(loadedRepo, commitLimit, { useCachedCommits: false });
  }, [loadCommitsForRepo, loadedRepo, commitLimit]);

  const compareLink = useMemo(() => {
    if (!leftCommit || !rightCommit || !loadedRepo) return null;
    const query = buildTreeComparisonLink(
      {
        repo: loadedRepo,
        inputRefName: "",
        resolvedCommit: leftCommit,
        root: "/",
      },
      {
        repo: loadedRepo,
        inputRefName: "",
        resolvedCommit: rightCommit,
        root: "/",
      }
    );
    return query ? `/tree?${query}` : null;
  }, [leftCommit, rightCommit, loadedRepo]);

  const startComparisonAndNavigate = useCallback(async (
    leftComparisonCommit: string,
    rightComparisonCommit: string,
    nextLink: string
  ) => {
    const repo = loadedRepo.trim();
    if (!nextLink || !repo || !leftComparisonCommit || !rightComparisonCommit) {
      return;
    }

    setIsStartingComparison(true);
    setError("");

    try {
      await Promise.all(
        Array.from(new Set([leftComparisonCommit, rightComparisonCommit])).map((commit) =>
          ensureIndexingJobStarted(repo, commit)
        )
      );
      window.open(nextLink, "_blank");
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Unable to start indexing jobs for the selected commits."
      );
    } finally {
      setIsStartingComparison(false);
    }
  }, [
    ensureIndexingJobStarted,
    loadedRepo,
  ]);

  const handleCompareSelectedCommits = useCallback(async () => {
    if (!compareLink || !leftCommit || !rightCommit) {
      return;
    }

    await startComparisonAndNavigate(leftCommit, rightCommit, compareLink);
  }, [compareLink, leftCommit, rightCommit, startComparisonAndNavigate]);

  const commitListStatusMessage = isLoading
    ? "↻ refreshing"
    : lastFetchedAt
      ? `updated ${formatRelativeDateTime(lastFetchedAt)}`
      : "";
  const commitListStatusTitle = lastFetchedAt
    ? `Last updated ${formatAbsoluteDateTime(lastFetchedAt)}`
    : undefined;

  return (
    <div className="repo-browser-page">
      <div className="page-header">
        <h1>🔀 Commit View</h1>
        <p className="page-subtitle">
          Browse recent commits of a repository and select two to compare.
        </p>
      </div>

      {showRepositorySelector && (
        <RepositorySelector
          inputId="repo-browser-input"
          value={repoInput}
          onChange={setRepoInput}
          onSubmit={handleLoadCommits}
          buttonLabel="Load commits"
          loadingButtonLabel="Loading…"
          isLoading={isLoading && commits.length === 0}
          disabled={isLoading || !repoInput.trim()}
          actions={
            loadedRepo ? (
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={isLoading}
              >
                {isLoading ? "Refreshing…" : "Refresh"}
              </button>
            ) : null
          }
          footer={
            loadedRepo ? (
              <div className="repo-browser__nav-links">
                {showRepositorySelector && (
                  <Link
                    to={`/branches?repo=${encodeURIComponent(loadedRepo)}`}
                    className="repo-browser__nav-link"
                  >
                    View branches →
                  </Link>
                )}
                {showRepositorySelector && (
                  <label className="repo-browser__auto-refresh-toggle">
                    <input
                      type="checkbox"
                      checked={autoRefreshEnabled}
                      onChange={(e) => handleAutoRefreshChange(e.target.checked)}
                    />
                    Auto-refresh every 30s
                  </label>
                )}
              </div>
            ) : null
          }
        />
      )}

      {error && <div className="repo-browser__error">{error}</div>}

      {leftCommit || rightCommit ? (
        <div className="repo-browser__selection">
          <div className="repo-browser__selection-summary">
            <div className="repo-browser__selection-side">
              <span className="repo-browser__selection-label">Left</span>
              <code className="repo-browser__selection-commit">
                {leftCommit ? leftCommit.slice(0, 12) : "—"}
              </code>
            </div>
            <div className="repo-browser__selection-side">
              <span className="repo-browser__selection-label">Right</span>
              <code className="repo-browser__selection-commit">
                {rightCommit ? rightCommit.slice(0, 12) : "—"}
              </code>
            </div>
          </div>
          <div className="repo-browser__selection-actions">
            {compareLink && (
              <button
                type="button"
                className="repo-browser__compare-btn"
                onClick={() => {
                  void handleCompareSelectedCommits();
                }}
                disabled={isStartingComparison}
              >
                {isStartingComparison ? "Starting comparison…" : "Compare selected commits"}
              </button>
            )}
            <button
              type="button"
              className="repo-browser__clear-btn"
              onClick={() => {
                setLeftCommit(null);
                setRightCommit(null);
              }}
              disabled={isStartingComparison}
            >
              Clear selection
            </button>
          </div>
        </div>
      ) : null}

      {commits.length > 0 && (
        <div className="repo-browser__commits">
          <div className="repo-browser__commits-header">
            <span className="repo-browser__commits-title">
              Commits in{" "}
              <a
                href={`https://github.com/${loadedRepo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="repo-browser__repo-link"
              >
                {loadedRepo}
              </a>
            </span>
            <div className="repo-browser__commits-header-right">
              <label className="repo-browser__limit-label">
                Show
                <select
                  className="repo-browser__limit-select"
                  value={commitLimit}
                  onChange={(e) =>
                    void handleCommitLimitChange(Number(e.target.value))
                  }
                  disabled={isLoading}
                >
                  {COMMIT_LIMIT_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                commits
              </label>
              <span className="repo-browser__commits-count">
                {commits.length} commit{commits.length !== 1 ? "s" : ""}
                {commitListStatusMessage && (
                  <span
                    className="repo-browser__refreshing"
                    title={commitListStatusTitle}
                  >
                    {" "}
                    — {commitListStatusMessage}
                  </span>
                )}
              </span>
            </div>
          </div>

          <div className="repo-browser__commit-list">
            {commits.map((entry) => {
              const isLeft = leftCommit === entry.commit;
              const isRight = rightCommit === entry.commit;
              const isSelected = isLeft || isRight;
              const isHoveredParent = hoveredParentCommit === entry.commit;

              return (
                <div
                  key={entry.commit}
                  className={
                    "repo-browser__commit" +
                    (isSelected ? " repo-browser__commit--selected" : "") +
                    (isLeft ? " repo-browser__commit--left" : "") +
                    (isRight ? " repo-browser__commit--right" : "") +
                    (isHoveredParent
                      ? " repo-browser__commit--parent-highlighted"
                      : "")
                  }
                  onClick={() => handleSelectCommit(entry.commit)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelectCommit(entry.commit);
                    }
                  }}
                >
                  <div className="repo-browser__commit-main">
                    <div className="repo-browser__commit-title-row">
                      {isSelected && (
                        <span className="repo-browser__commit-badge">
                          {isLeft ? "L" : "R"}
                        </span>
                      )}
                      <span className="repo-browser__commit-title">
                        {entry.title}
                      </span>
                    </div>
                    <div className="repo-browser__commit-meta">
                      <a
                        href={buildGitHubCommitUrl(loadedRepo, entry.commit)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="repo-browser__commit-sha"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {entry.commit.slice(0, 7)}
                      </a>
                      <span className="repo-browser__commit-author">
                        {entry.author}
                      </span>
                      <span className="repo-browser__commit-date">
                        {formatCommitDate(entry.date)}
                      </span>
                    </div>
                    {entry.parents.length > 0 && (
                      <div className="repo-browser__commit-parents">
                        <span className="repo-browser__commit-parents-label">
                          Parent{entry.parents.length !== 1 ? "s" : ""}
                        </span>
                        <div className="repo-browser__commit-parents-list">
                          {entry.parents.map((parent) => {
                            const parentCompareQuery = buildTreeComparisonLink(
                              {
                                repo: loadedRepo,
                                inputRefName: "",
                                resolvedCommit: parent,
                                root: "/",
                              },
                              {
                                repo: loadedRepo,
                                inputRefName: "",
                                resolvedCommit: entry.commit,
                                root: "/",
                              }
                            );
                            return (
                              <span
                                key={parent}
                                className="repo-browser__commit-parent-group"
                              >
                                <a
                                  href={buildGitHubCommitUrl(loadedRepo, parent)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="repo-browser__commit-parent"
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseEnter={() => setHoveredParentCommit(parent)}
                                  onMouseLeave={() => setHoveredParentCommit(null)}
                                >
                                  {parent.slice(0, 7)}
                                </a>
                                {parentCompareQuery && (
                                  <button
                                    type="button"
                                    className="repo-browser__compare-parent-btn"
                                    title={`Compare ${parent.slice(0, 7)} → ${entry.commit.slice(0, 7)}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void startComparisonAndNavigate(
                                        parent,
                                        entry.commit,
                                        `/tree?${parentCompareQuery}`
                                      );
                                    }}
                                    disabled={isStartingComparison}
                                  >
                                    ⇔
                                  </button>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="repo-browser__commit-badges">
                    <div className="repo-browser__commit-select-btns">
                      <button
                        type="button"
                        className={
                          "repo-browser__select-btn repo-browser__select-btn--left" +
                          (isLeft ? " repo-browser__select-btn--active" : "")
                        }
                        title="Select as left commit"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isLeft) {
                            setLeftCommit(null);
                          } else {
                            setLeftCommit(entry.commit);
                          }
                        }}
                      >
                        L
                      </button>
                      <button
                        type="button"
                        className={
                          "repo-browser__select-btn repo-browser__select-btn--right" +
                          (isRight ? " repo-browser__select-btn--active" : "")
                        }
                        title="Select as right commit"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isRight) {
                            setRightCommit(null);
                          } else {
                            setRightCommit(entry.commit);
                          }
                        }}
                      >
                        R
                      </button>
                    </div>
                    {entry.branch && (
                      <span className="repo-browser__branch-badge">
                        {entry.branch}
                      </span>
                    )}
                    {entry.tags.map((tag) => (
                      <span key={tag} className="repo-browser__tag-badge">
                        {tag}
                      </span>
                    ))}
                    {entry.pullRequest && (
                      <a
                        href={entry.pullRequest.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="repo-browser__pr-badge"
                        onClick={(e) => e.stopPropagation()}
                      >
                        #{entry.pullRequest.number}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {commits.length >= commitLimit &&
            commits.length < MAX_COMMIT_LIMIT && (
              <div className="repo-browser__load-more">
                <button
                  type="button"
                  onClick={() => void handleLoadMore()}
                  disabled={isLoading}
                >
                  {isLoading ? "Loading…" : "Load more commits"}
                </button>
              </div>
            )}
        </div>
      )}

      {!isLoading && commits.length === 0 && !error && loadedRepo === "" && (
        <div className="repo-browser__empty">
          <div className="repo-browser__empty-icon">🔍</div>
          <h2>Enter a repository</h2>
          <p>
            Type a repository name (e.g. <code>facebook/react</code>) and click
            &quot;Load commits&quot; to browse its recent commit history.
          </p>
        </div>
      )}
    </div>
  );
}
