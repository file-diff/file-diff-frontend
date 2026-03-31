import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  requestOrganizationRepositories,
} from "../utils/repositorySelection";
import type {
  OrganizationRepository,
} from "../utils/repositorySelection";
import "./OrganizationBrowserPage.css";

function formatUpdatedAt(isoDate: string | undefined): string {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return isoDate;
  return date.toLocaleString();
}

function sortByUpdatedAtDesc(
  a: OrganizationRepository,
  b: OrganizationRepository
): number {
  const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  return dateB - dateA;
}

export default function OrganizationBrowserPage() {
  const [organization, setOrganization] = useState("");
  const [repositories, setRepositories] = useState<OrganizationRepository[]>(
    []
  );
  const [selectedRepo, setSelectedRepo] = useState("");
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [error, setError] = useState("");

  const abortRef = useRef<AbortController | null>(null);

  const handleLoadRepositories = useCallback(
    async (orgValue?: string) => {
      const org = (orgValue ?? organization).trim();
      if (!org) {
        setError("Enter an organization name.");
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError("");
      setRepositories([]);
      setSelectedRepo("");
      setIsLoadingRepos(true);

      try {
        const repos = await requestOrganizationRepositories(
          org,
          controller.signal
        );
        repos.sort(sortByUpdatedAtDesc);
        setRepositories(repos);
        if (repos.length === 0) {
          setError("No repositories found for this organization.");
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Unable to list repositories."
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingRepos(false);
        }
      }
    },
    [organization]
  );

  const handleSelectRepository = (repo: OrganizationRepository) => {
    setSelectedRepo(repo.repo);
  };

  const repoInputValue = selectedRepo
    ? selectedRepo.includes("/")
      ? selectedRepo.split("/").slice(1).join("/")
      : selectedRepo
    : "";

  const handleRepoInputChange = (value: string) => {
    const repoName = value.trim();
    const org = organization.trim();
    if (!repoName) {
      setSelectedRepo("");
      return;
    }
    setSelectedRepo(org ? `${org}/${repoName}` : repoName);
  };

  return (
    <div className="org-page">
      <h1 className="org-page__title">Browse Organization</h1>

      <div className="org-page__content">
        {error && <div className="org-page__error">{error}</div>}

        <div className="org-page__step">
          <label htmlFor="org-page-name-input">Organization</label>
          <div className="org-page__input-row">
            <input
              id="org-page-name-input"
              type="text"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleLoadRepositories();
              }}
              placeholder="e.g. facebook"
              spellCheck={false}
              autoFocus
            />
            <button
              type="button"
              onClick={() => void handleLoadRepositories()}
              disabled={isLoadingRepos || !organization.trim()}
            >
              {isLoadingRepos ? "Loading…" : "List repos"}
            </button>
          </div>
        </div>

        <div className="org-page__step">
          <label htmlFor="org-page-repository-input">
            Repository
            {repositories.length > 0
              ? ` (${repositories.length} found)`
              : ""}
          </label>
          <div className="org-page__input-row">
            <input
              id="org-page-repository-input"
              type="text"
              value={repoInputValue}
              onChange={(e) => handleRepoInputChange(e.target.value)}
              placeholder="repo name"
              spellCheck={false}
            />
          </div>
          <div className="org-page__hint">
            Enter the repository name only (without organization prefix).
          </div>
        </div>

        {selectedRepo && (
          <div className="org-page__step">
            <label>Selected repository</label>
            <div className="org-page__selected-repo">
              <code>{selectedRepo}</code>
              <Link
                to={`/commits?repo=${encodeURIComponent(selectedRepo)}`}
                className="org-page__commits-link"
              >
                View commits →
              </Link>
            </div>
          </div>
        )}

        {isLoadingRepos && (
          <div className="org-page__loading">Loading repositories…</div>
        )}

        {repositories.length > 0 && (
          <div className="org-page__step">
            <label>Repository list</label>
            <ul className="org-page__list" role="listbox">
              {repositories.map((repo) => (
                <li
                  key={repo.repo}
                  role="option"
                  aria-selected={selectedRepo === repo.repo}
                  className={
                    "org-page__list-item" +
                    (selectedRepo === repo.repo
                      ? " org-page__list-item--selected"
                      : "")
                  }
                  onClick={() => handleSelectRepository(repo)}
                >
                  <div className="org-page__list-item-main">
                    <span className="org-page__repo-name">{repo.name}</span>
                    <span className="org-page__repo-full">{repo.repo}</span>
                  </div>
                  <div className="org-page__list-item-meta">
                    {repo.updatedAt && (
                      <span className="org-page__repo-updated">
                        Updated: {formatUpdatedAt(repo.updatedAt)}
                      </span>
                    )}
                    <Link
                      to={`/commits?repo=${encodeURIComponent(repo.repo)}`}
                      className="org-page__repo-commits-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Commits
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
