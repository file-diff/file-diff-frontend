import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { JOBS_API_URL } from "../config/api";
import {
  parseRepositoryLocation,
  requestRepositoryCommits,
} from "../utils/repositorySelection";
import type { RepositoryCommit } from "../utils/repositorySelection";
import { buildTreeComparisonLink } from "../utils/storage";
import "./RepositoryBrowserPage.css";

const DEFAULT_COMMIT_LIMIT = 50;
const MAX_COMMIT_LIMIT = 200;
const INDEXING_TRIGGER_URL = JOBS_API_URL;

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

export default function RepositoryBrowserPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryRepo = searchParams.get("repo") ?? "";

  const [repoInput, setRepoInput] = useState(queryRepo);
  const [commits, setCommits] = useState<RepositoryCommit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedRepo, setLoadedRepo] = useState("");

  const [leftCommit, setLeftCommit] = useState<string | null>(null);
  const [rightCommit, setRightCommit] = useState<string | null>(null);
  const [hoveredParentCommit, setHoveredParentCommit] = useState<string | null>(
    null
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  const autoLoadedRepoRef = useRef<string>("");
  const currentSearchRef = useRef(searchParams.toString());
  const startedIndexingKeysRef = useRef<Set<string>>(new Set());

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

  const loadCommitsForRepo = useCallback(async (repo: string) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError("");
    setCommits([]);
    setLeftCommit(null);
    setRightCommit(null);
    setLoadedRepo("");

    try {
      const result = await requestRepositoryCommits(
        repo,
        DEFAULT_COMMIT_LIMIT,
        controller.signal
      );
      setCommits(result);
      setLoadedRepo(repo);

      const params = new URLSearchParams(currentSearchRef.current);
      params.set("repo", repo);
      setSearchParams(params, { replace: true });
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
  }, [setSearchParams]);

  useEffect(() => {
    currentSearchRef.current = searchParams.toString();
  }, [searchParams]);

  const handleLoadCommits = useCallback(async () => {
    const repo = resolveRepoInput(repoInput);
    if (!repo) {
      setError("Please enter a repository in owner/repo format.");
      return;
    }

    autoLoadedRepoRef.current = repo;
    await loadCommitsForRepo(repo);
  }, [loadCommitsForRepo, repoInput, resolveRepoInput]);

  useEffect(() => {
    const repo = resolveRepoInput(queryRepo);
    if (!repo || autoLoadedRepoRef.current === repo) {
      return;
    }

    autoLoadedRepoRef.current = repo;
    setRepoInput(repo);
    void loadCommitsForRepo(repo);
  }, [loadCommitsForRepo, queryRepo, resolveRepoInput]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

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
      const indexingKey = `${repo}\n${commit}`;
      if (startedIndexingKeysRef.current.has(indexingKey)) {
        return;
      }

      startedIndexingKeysRef.current.add(indexingKey);

      const request: JobRequest = { repo, commit };
      void fetch(INDEXING_TRIGGER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      }).then((response) => {
        if (!response.ok) {
          throw new Error("Unable to start indexing job");
        }
      }).catch((error: unknown) => {
        startedIndexingKeysRef.current.delete(indexingKey);
        console.error("[RepositoryBrowserPage] failed to start indexing job", {
          repo,
          commit,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      });
    });
  }, [leftCommit, loadedRepo, rightCommit]);

  const handleLoadMore = useCallback(async () => {
    const repo = resolveRepoInput(repoInput);
    if (!repo) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const nextLimit = Math.min(commits.length + DEFAULT_COMMIT_LIMIT, MAX_COMMIT_LIMIT);

    setIsLoading(true);
    setError("");

    try {
      const result = await requestRepositoryCommits(
        repo,
        nextLimit,
        controller.signal
      );
      setCommits(result);
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
  }, [repoInput, resolveRepoInput, commits.length]);

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

  return (
    <div className="repo-browser-page">
      <div className="page-header">
        <h1>🔀 Repository Browser</h1>
        <p className="page-subtitle">
          Browse recent commits of a repository and select two to compare.
        </p>
        <div className="repo-browser__header-actions">
          <Link
            to={`/commits/graph${loadedRepo ? `?repo=${encodeURIComponent(loadedRepo)}` : ""}`}
            className="repo-browser__graph-link"
          >
            Open DAG view
          </Link>
        </div>
      </div>

      <div className="repo-browser__input-section">
        <label htmlFor="repo-browser-input">Repository</label>
        <div className="repo-browser__input-row">
          <input
            id="repo-browser-input"
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleLoadCommits();
            }}
            placeholder="owner/repo or paste full GitHub URL"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => void handleLoadCommits()}
            disabled={isLoading || !repoInput.trim()}
          >
            {isLoading && commits.length === 0 ? "Loading…" : "Load commits"}
          </button>
        </div>
      </div>

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
              <Link to={compareLink} className="repo-browser__compare-btn">
                Compare selected commits
              </Link>
            )}
            <button
              type="button"
              className="repo-browser__clear-btn"
              onClick={() => {
                setLeftCommit(null);
                setRightCommit(null);
              }}
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
              <span className="repo-browser__commits-count">
                {commits.length} commit{commits.length !== 1 ? "s" : ""}
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
                          {entry.parents.map((parent) => (
                            <a
                              key={parent}
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
                          ))}
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

          {commits.length >= DEFAULT_COMMIT_LIMIT &&
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
