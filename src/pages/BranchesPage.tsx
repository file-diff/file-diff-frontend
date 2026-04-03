import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  parseRepositoryLocation,
  requestRepositoryBranches,
} from "../utils/repositorySelection";
import type { RepositoryBranch } from "../utils/repositorySelection";
import "./BranchesPage.css";

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

export default function BranchesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryRepo = searchParams.get("repo") ?? "";

  const [repoInput, setRepoInput] = useState(queryRepo);
  const [branches, setBranches] = useState<RepositoryBranch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedRepo, setLoadedRepo] = useState("");

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
    async (repo: string) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError("");
      setBranches([]);
      setLoadedRepo("");

      try {
        const result = await requestRepositoryBranches(
          repo,
          controller.signal
        );
        setBranches(sortBranchesByNewestCommit(result));
        setLoadedRepo(repo);

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
    const repo = resolveRepoInput(queryRepo);
    if (!repo || autoLoadedRepoRef.current === repo) {
      return;
    }

    autoLoadedRepoRef.current = repo;
    setRepoInput(repo);
    void loadBranchesForRepo(repo);
  }, [loadBranchesForRepo, queryRepo, resolveRepoInput]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

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
            {isLoading ? "Loading…" : "Load branches"}
          </button>
        </div>
        {loadedRepo && (
          <div className="branches-page__nav-links">
            <Link
              to={`/commits?repo=${encodeURIComponent(loadedRepo)}`}
              className="branches-page__nav-link"
            >
              View commits →
            </Link>
          </div>
        )}
      </div>

      {error && <div className="branches-page__error">{error}</div>}

      {branches.length > 0 && (
        <div className="branches-page__branches">
          <div className="branches-page__branches-header">
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
            <span className="branches-page__branches-count">
              {branches.length} branch{branches.length !== 1 ? "es" : ""}
            </span>
          </div>

          <div className="branches-page__branch-list">
            {branches.map((branch) => (
              <div
                key={branch.ref}
                className={
                  "branches-page__branch" +
                  (branch.isDefault ? " branches-page__branch--default" : "")
                }
              >
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
                </div>
              </div>
            ))}
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
