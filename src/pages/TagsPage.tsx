import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  resolveRepositoryInput,
  requestRepositoryTags,
  requestDeleteTag,
} from "../utils/repositorySelection";
import type { RepositoryTag } from "../utils/repositorySelection";
import {
  loadCachedTags,
  loadCachedTagsFetchedAt,
  saveCachedTags,
  loadLastRepo,
  saveLastRepo,
  loadTagLimit,
  saveTagLimit,
  loadAutoRefreshEnabled,
  saveAutoRefreshEnabled,
} from "../utils/tagsPageStorage";
import {
  loadBearerToken,
  saveBearerToken,
} from "../utils/bearerTokenStorage";
import {
  formatRelativeDateTime,
  formatAbsoluteDateTime,
} from "../utils/organizationBrowserPresentation";
import RepositorySelector from "../components/RepositorySelector";
import "./TagsPage.css";

const AUTO_REFRESH_INTERVAL_MS = 30_000;
const DEFAULT_TAG_LIMIT = 50;
const TAG_LIMIT_OPTIONS = [20, 50, 100, 200] as const;

interface ActionResult {
  tag: string;
  success: boolean;
  message: string;
}

interface LoadTagsOptions {
  clearActionResults?: boolean;
  useCachedTags?: boolean;
}

function buildGitHubCommitUrl(repo: string, commit: string): string {
  const parts = repo.split("/");
  if (parts.length !== 2) return "";
  return `https://github.com/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/commit/${encodeURIComponent(commit)}`;
}

function buildGitHubTagUrl(repo: string, tagName: string): string {
  const parts = repo.split("/");
  if (parts.length !== 2) return "";
  return `https://github.com/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/releases/tag/${encodeURIComponent(tagName)}`;
}

function formatConfirmList(items: string[], maxDisplay: number = 10): string {
  if (items.length <= maxDisplay) {
    return items.join("\n");
  }
  const shown = items.slice(0, maxDisplay);
  const remaining = items.length - maxDisplay;
  return `${shown.join("\n")}\n... and ${String(remaining)} more`;
}

function resolveInitialRepo(queryRepo: string): string {
  if (queryRepo) return queryRepo;
  return loadLastRepo();
}

function loadInitialTags(repo: string): RepositoryTag[] {
  if (!repo) return [];
  return loadCachedTags(repo);
}

interface TagsPageProps {
  showRepositorySelector?: boolean;
  refreshIntervalMs?: number;
  bearerToken?: string;
}

export default function TagsPage({
  showRepositorySelector = true,
  refreshIntervalMs,
  bearerToken: bearerTokenProp,
}: TagsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryRepo = searchParams.get("repo") ?? "";
  const initialRepo = resolveInitialRepo(queryRepo);

  const [repoInput, setRepoInput] = useState(initialRepo);
  const [tags, setTags] = useState<RepositoryTag[]>(() =>
    loadInitialTags(initialRepo)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedRepo, setLoadedRepo] = useState(() =>
    loadInitialTags(initialRepo).length > 0 ? initialRepo : ""
  );
  const [lastFetchedAt, setLastFetchedAt] = useState(() =>
    initialRepo ? loadCachedTagsFetchedAt(initialRepo) : ""
  );
  const [tagLimit, setTagLimit] = useState(() => loadTagLimit(DEFAULT_TAG_LIMIT));

  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
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

  const loadTagsForRepo = useCallback(
    async (
      repo: string,
      limit: number,
      options: LoadTagsOptions = {}
    ) => {
      const { clearActionResults: clearResults = true, useCachedTags = true } =
        options;
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError("");
      if (clearResults) {
        setActionResults([]);
      }

      const cached = useCachedTags ? loadCachedTags(repo) : [];
      if (useCachedTags) {
        if (cached.length > 0) {
          setTags(cached);
          setLoadedRepo(repo);
        } else {
          setTags([]);
          setLoadedRepo("");
          setSelectedTags(new Set());
        }
      }

      try {
        const result = await requestRepositoryTags(repo, limit, controller.signal);

        setTags(result);
        setLoadedRepo(repo);
        saveCachedTags(repo, result);
        saveLastRepo(repo);
        setLastFetchedAt(loadCachedTagsFetchedAt(repo));

        setSelectedTags((prev) => {
          const validRefs = new Set(result.map((t) => t.ref));
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
            : "Unable to load tags"
        );
        if (cached.length > 0) {
          setError(
            (err instanceof Error && err.message
              ? err.message
              : "Unable to refresh tags") + " — showing cached data."
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

  const handleLoadTags = useCallback(async () => {
    const repo = resolveRepositoryInput(repoInput);
    if (!repo) {
      setError("Please enter a repository in owner/repo format.");
      return;
    }

    autoLoadedRepoRef.current = repo;
    await loadTagsForRepo(repo, tagLimit);
  }, [loadTagsForRepo, repoInput, tagLimit]);

  useEffect(() => {
    const repo = resolveRepositoryInput(initialRepo);
    if (!repo || autoLoadedRepoRef.current === repo) {
      return;
    }

    autoLoadedRepoRef.current = repo;
    setRepoInput(repo);

    const refreshTimer = window.setTimeout(() => {
      void loadTagsForRepo(repo, tagLimit);
    }, 0);

    return () => {
      window.clearTimeout(refreshTimer);
    };
    // tagLimit intentionally not in deps: limit changes are handled by handleTagLimitChange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTagsForRepo, initialRepo]);

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

      void loadTagsForRepo(loadedRepo, tagLimit, {
        clearActionResults: false,
        useCachedTags: false,
      });
    }, effectiveInterval);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    actionInProgress,
    autoRefreshEnabled,
    isLoading,
    loadTagsForRepo,
    loadedRepo,
    refreshIntervalMs,
    tagLimit,
  ]);

  const toggleTagSelection = useCallback((ref: string) => {
    setSelectedTags((prev) => {
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
    setSelectedTags((prev) => {
      if (prev.size === tags.length) {
        return new Set();
      }
      return new Set(tags.map((t) => t.ref));
    });
  }, [tags]);

  const selectedTagObjects = useMemo(
    () => tags.filter((t) => selectedTags.has(t.ref)),
    [tags, selectedTags]
  );

  const handleBearerTokenChange = useCallback((value: string) => {
    setLocalBearerToken(value);
    saveBearerToken(value);
  }, []);

  const handleAutoRefreshChange = useCallback((value: boolean) => {
    setAutoRefreshEnabled(value);
    saveAutoRefreshEnabled(value);
  }, []);

  const handleTagLimitChange = useCallback(
    (limit: number) => {
      setTagLimit(limit);
      saveTagLimit(limit);
      if (loadedRepo) {
        void loadTagsForRepo(loadedRepo, limit, {
          clearActionResults: false,
          useCachedTags: false,
        });
      }
    },
    [loadTagsForRepo, loadedRepo]
  );

  const handleDeleteTags = useCallback(async () => {
    if (!loadedRepo || selectedTagObjects.length === 0) return;
    if (!bearerToken.trim()) {
      setShowTokenInput(true);
      return;
    }

    const tagNames = selectedTagObjects.map((t) => t.name);
    const confirmed = window.confirm(
      `Delete ${String(tagNames.length)} tag${tagNames.length !== 1 ? "s" : ""}?\n\n${formatConfirmList(tagNames)}\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;

    setActionInProgress(true);
    setActionResults([]);
    const results: ActionResult[] = [];

    for (const tag of selectedTagObjects) {
      try {
        await requestDeleteTag(loadedRepo, tag.name, bearerToken.trim());
        results.push({ tag: tag.name, success: true, message: "Deleted" });
      } catch (err) {
        results.push({
          tag: tag.name,
          success: false,
          message: err instanceof Error ? err.message : "Failed to delete",
        });
      }
    }

    setActionResults(results);
    setActionInProgress(false);

    const deletedNames = new Set(
      results.filter((r) => r.success).map((r) => r.tag)
    );
    if (deletedNames.size > 0) {
      setTags((prev) => prev.filter((t) => !deletedNames.has(t.name)));
      setSelectedTags((prev) => {
        const next = new Set(prev);
        for (const t of selectedTagObjects) {
          if (deletedNames.has(t.name)) {
            next.delete(t.ref);
          }
        }
        return next;
      });
    }

    void loadTagsForRepo(loadedRepo, tagLimit, {
      clearActionResults: false,
      useCachedTags: false,
    });
  }, [
    loadedRepo,
    selectedTagObjects,
    bearerToken,
    loadTagsForRepo,
    tagLimit,
  ]);

  const clearActionResults = useCallback(() => {
    setActionResults([]);
  }, []);

  const tagListStatusMessage = isLoading
    ? "↻ refreshing"
    : lastFetchedAt
      ? `updated ${formatRelativeDateTime(lastFetchedAt)}`
      : "";
  const tagListStatusTitle = lastFetchedAt
    ? `Last updated ${formatAbsoluteDateTime(lastFetchedAt)}`
    : undefined;

  const hasSelection = selectedTags.size > 0;
  const allSelected = tags.length > 0 && selectedTags.size === tags.length;
  const actionBar = hasSelection ? (
    <div
      className={
        "tags-page__action-bar" +
        (showRepositorySelector ? "" : " tags-page__action-bar--inline")
      }
    >
      <span className="tags-page__action-bar-count">
        {String(selectedTags.size)} selected
      </span>
      <div className="tags-page__action-bar-actions">
        <button
          type="button"
          className="tags-page__action-btn tags-page__action-btn--delete"
          onClick={() => void handleDeleteTags()}
          disabled={actionInProgress}
          title="Delete selected tags"
        >
          {actionInProgress ? "Working…" : "Delete"}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="tags-page">
      <div className="page-header">
        <h1>🏷️ Tags</h1>
        <p className="page-subtitle">
          Browse tags of a repository, newest first.
        </p>
      </div>

      {showRepositorySelector && (
        <RepositorySelector
          inputId="tags-page-input"
          value={repoInput}
          onChange={setRepoInput}
          onSubmit={handleLoadTags}
          buttonLabel="Load tags"
          loadingButtonLabel="Loading…"
          isLoading={isLoading && !loadedRepo}
          disabled={isLoading || !repoInput.trim()}
          actions={
            loadedRepo ? (
              <button
                type="button"
                onClick={() => void loadTagsForRepo(loadedRepo, tagLimit)}
                disabled={isLoading}
              >
                {isLoading ? "Refreshing…" : "Refresh"}
              </button>
            ) : null
          }
        />
      )}
      <div className="tags-page__input-section">
        {loadedRepo && (
          <div className="tags-page__nav-links">
            {showRepositorySelector && (
              <label className="tags-page__auto-refresh-toggle">
                <input
                  type="checkbox"
                  checked={autoRefreshEnabled}
                  onChange={(e) => handleAutoRefreshChange(e.target.checked)}
                />
                Auto-refresh every 30s
              </label>
            )}
            {bearerTokenProp === undefined && (
              <button
                type="button"
                className="tags-page__token-toggle"
                onClick={() => setShowTokenInput((v) => !v)}
              >
                {showTokenInput ? "Hide token" : "🔑 API token"}
              </button>
            )}
          </div>
        )}
        {bearerTokenProp === undefined && showTokenInput && (
          <div className="tags-page__token-section">
            <label htmlFor="tags-page-token">Bearer Token</label>
            <input
              id="tags-page-token"
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

      {error && <div className="tags-page__error">{error}</div>}

      {actionResults.length > 0 && (
        <div className="tags-page__action-results">
          <div className="tags-page__action-results-header">
            <span>Action Results</span>
            <button
              type="button"
              className="tags-page__action-results-close"
              onClick={clearActionResults}
            >
              ✕
            </button>
          </div>
          {actionResults.map((result, i) => (
            <div
              key={`${result.tag}-${String(i)}`}
              className={
                "tags-page__action-result" +
                (result.success
                  ? " tags-page__action-result--success"
                  : " tags-page__action-result--error")
              }
            >
              {result.tag && (
                <span className="tags-page__action-result-tag">
                  {result.tag}:
                </span>
              )}{" "}
              {result.message}
            </div>
          ))}
        </div>
      )}

      {tags.length > 0 && (
        <div className="tags-page__tags">
          <div className="tags-page__tags-header">
            <div className="tags-page__tags-header-left">
              <label className="tags-page__select-all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                />
              </label>
              <span className="tags-page__tags-title">
                Tags in{" "}
                <a
                  href={`https://github.com/${loadedRepo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tags-page__repo-link"
                >
                  {loadedRepo}
                </a>
              </span>
            </div>
            <div className="tags-page__tags-header-right">
              <label className="tags-page__limit-label">
                Show
                <select
                  className="tags-page__limit-select"
                  value={tagLimit}
                  onChange={(e) => handleTagLimitChange(Number(e.target.value))}
                  disabled={isLoading}
                >
                  {TAG_LIMIT_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                tags
              </label>
              <span className="tags-page__tags-count">
                {hasSelection
                  ? `${String(selectedTags.size)} of ${String(tags.length)} selected`
                  : `${String(tags.length)} tag${tags.length !== 1 ? "s" : ""}`}
                {tagListStatusMessage && (
                  <span
                    className="tags-page__refreshing"
                    title={tagListStatusTitle}
                  >
                    {" "}
                    — {tagListStatusMessage}
                  </span>
                )}
              </span>
            </div>
          </div>
          {!showRepositorySelector && actionBar}

          <div className="tags-page__tag-list">
            {tags.map((tag) => {
              const isSelected = selectedTags.has(tag.ref);
              return (
                <div
                  key={tag.ref}
                  className={
                    "tags-page__tag" +
                    (isSelected ? " tags-page__tag--selected" : "")
                  }
                >
                  <label className="tags-page__tag-checkbox">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleTagSelection(tag.ref)}
                    />
                  </label>
                  <div className="tags-page__tag-main">
                    <div className="tags-page__tag-name-row">
                      <a
                        href={buildGitHubTagUrl(loadedRepo, tag.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tags-page__tag-name"
                      >
                        {tag.name}
                      </a>
                    </div>
                    <div className="tags-page__tag-commit-info">
                      <a
                        href={buildGitHubCommitUrl(loadedRepo, tag.commit)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tags-page__commit-sha"
                      >
                        {tag.commitShort}
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showRepositorySelector && actionBar}

      {!isLoading && tags.length === 0 && !error && loadedRepo === "" && (
        <div className="tags-page__empty">
          <div className="tags-page__empty-icon">🏷️</div>
          <h2>Enter a repository</h2>
          <p>
            Type a repository name (e.g. <code>facebook/react</code>) and click
            &quot;Load tags&quot; to browse its tags.
          </p>
        </div>
      )}
    </div>
  );
}
