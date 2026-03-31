import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Fuse from "fuse.js";
import {
  requestOrganizationRepositories,
} from "../utils/repositorySelection";
import type {
  OrganizationRepository,
} from "../utils/repositorySelection";
import {
  addOrganization,
  clearCachedRepositories,
  getRepositoryOrganization,
  loadCachedRepositories,
  loadCombinedCachedRepositories,
  loadLatestCachedRepositoriesFetchedAt,
  loadSavedOrganizations,
  removeOrganization,
  saveCachedRepositories,
} from "../utils/organizationBrowserStorage";
import {
  formatAbsoluteDateTime,
  formatRelativeDateTime,
  sortByUpdatedAtDesc,
} from "../utils/organizationBrowserPresentation";
import "./OrganizationBrowserPage.css";

function loadInitialRepositories(): OrganizationRepository[] {
  const cachedRepositories = loadCombinedCachedRepositories(loadSavedOrganizations());
  cachedRepositories.sort(sortByUpdatedAtDesc);
  return cachedRepositories;
}

export default function OrganizationBrowserPage() {
  const [organization, setOrganization] = useState("");
  const [organizations, setOrganizations] = useState<string[]>(() =>
    loadSavedOrganizations()
  );
  const [repositories, setRepositories] = useState<OrganizationRepository[]>(() =>
    loadInitialRepositories()
  );
  const [selectedRepo, setSelectedRepo] = useState("");
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [error, setError] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState(() =>
    loadLatestCachedRepositoriesFetchedAt(loadSavedOrganizations())
  );

  const abortRef = useRef<AbortController | null>(null);
  const organizationsRef = useRef(organizations);

  useEffect(() => {
    organizationsRef.current = organizations;
  }, [organizations]);

  const handleRefreshRepositories = useCallback(
    async (organizationValues?: string[]) => {
      const nextOrganizations = (organizationValues ?? organizationsRef.current)
        .map((org) => org.trim())
        .filter(Boolean);
      if (nextOrganizations.length === 0) {
        setError("Add at least one organization.");
        setRepositories([]);
        setIsLoadingRepos(false);
        setLastFetchedAt("");
        return;
      }

      setError("");
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const cachedRepositories = loadCombinedCachedRepositories(nextOrganizations);
      cachedRepositories.sort(sortByUpdatedAtDesc);
      setRepositories(cachedRepositories);
      setIsLoadingRepos(true);

      const results = await Promise.allSettled(
        nextOrganizations.map(async (org) => {
          const repos = await requestOrganizationRepositories(org, controller.signal);
          repos.sort(sortByUpdatedAtDesc);
          saveCachedRepositories(org, repos);
          return repos;
        })
      );

      if (controller.signal.aborted) return;

      const loadedRepositories: OrganizationRepository[] = [];
      const failedOrganizations: string[] = [];

      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          loadedRepositories.push(...result.value);
          return;
        }

        const failedOrganization = nextOrganizations[index];
        failedOrganizations.push(failedOrganization);
        loadedRepositories.push(...loadCachedRepositories(failedOrganization));
      });

      loadedRepositories.sort(sortByUpdatedAtDesc);
      setRepositories(loadedRepositories);
      setLastFetchedAt(loadLatestCachedRepositoriesFetchedAt(nextOrganizations));
      setSelectedRepo((currentSelectedRepo) =>
        loadedRepositories.some((repo) => repo.repo === currentSelectedRepo)
          ? currentSelectedRepo
          : ""
      );

      if (failedOrganizations.length > 0) {
        setError(
          `Unable to refresh repositories for: ${failedOrganizations.join(", ")}. Showing cached data where available.`
        );
      } else if (loadedRepositories.length === 0) {
        setError("No repositories found for the saved organizations.");
      }

      setIsLoadingRepos(false);
    },
    []
  );

  useEffect(() => {
    if (organizationsRef.current.length === 0) {
      return;
    }

    const refreshTimer = window.setTimeout(() => {
      void handleRefreshRepositories();
    }, 0);

    return () => {
      window.clearTimeout(refreshTimer);
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [handleRefreshRepositories]);

  const repoFuse = useMemo(() => {
    if (repositories.length === 0) return null;
    return new Fuse(repositories, {
      keys: [{ name: "name", weight: 1 }],
      threshold: 0.4,
    });
  }, [repositories]);

  const filteredRepositories = useMemo(() => {
    if (!filterQuery.trim() || !repoFuse) return repositories;
    return repoFuse.search(filterQuery).map((result) => result.item);
  }, [filterQuery, repoFuse, repositories]);

  const handleSelectRepository = (repo: OrganizationRepository) => {
    setSelectedRepo(repo.repo);
  };

  const repoInputValue = selectedRepo
    ? selectedRepo.includes("/")
      ? organizations.length === 1 &&
        selectedRepo.toLowerCase().startsWith(`${organizations[0].toLowerCase()}/`)
        ? selectedRepo.split("/").slice(1).join("/")
        : selectedRepo
      : selectedRepo
    : "";

  const handleRepoInputChange = (value: string) => {
    const repoName = value.trim();
    if (!repoName) {
      setSelectedRepo("");
      return;
    }

    if (repoName.includes("/")) {
      setSelectedRepo(repoName);
      return;
    }

    const exactMatches = repositories.filter(
      (repo) => repo.name.toLowerCase() === repoName.toLowerCase()
    );

    if (exactMatches.length === 1) {
      setSelectedRepo(exactMatches[0].repo);
      return;
    }

    setSelectedRepo(
      organizations.length === 1 ? `${organizations[0]}/${repoName}` : repoName
    );
  };

  const handleAddOrganization = async () => {
    const nextOrganization = organization.trim();
    if (!nextOrganization) {
      setError("Enter an organization name.");
      return;
    }

    const nextOrganizations = addOrganization(organizations, nextOrganization);
    setOrganizations(nextOrganizations);
    setOrganization("");
    await handleRefreshRepositories(nextOrganizations);
  };

  const handleRemoveOrganization = (organizationToRemove: string) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoadingRepos(false);

    const nextOrganizations = removeOrganization(organizations, organizationToRemove);
    const nextRepositories = loadCombinedCachedRepositories(nextOrganizations);
    nextRepositories.sort(sortByUpdatedAtDesc);
    clearCachedRepositories(organizationToRemove);
    setOrganizations(nextOrganizations);
    setRepositories(nextRepositories);
    setLastFetchedAt(loadLatestCachedRepositoriesFetchedAt(nextOrganizations));
    setSelectedRepo((currentSelectedRepo) =>
      currentSelectedRepo.toLowerCase().startsWith(
        `${organizationToRemove.toLowerCase()}/`
      )
        ? ""
        : currentSelectedRepo
    );
    setError("");
  };

  const statusMessage = error
    ? error
    : lastFetchedAt
      ? `Last updated ${formatRelativeDateTime(lastFetchedAt)}`
      : organizations.length > 0
        ? "Showing cached repositories until the next refresh finishes."
        : "";
  const statusTone = error ? "error" : "info";
  const statusIcon = error ? "⚠" : isLoadingRepos ? "↻" : "ℹ";
  const statusTitle = lastFetchedAt
    ? `Last updated ${formatAbsoluteDateTime(lastFetchedAt)}`
    : undefined;

  return (
    <div className="org-page">
      <h1 className="org-page__title">Browse Organization</h1>

      <div className="org-page__content">
        <div className="org-page__step">
          <label htmlFor="org-page-name-input">
            Organizations
            {organizations.length > 0 ? ` (${organizations.length} saved)` : ""}
          </label>
          <div className="org-page__input-row">
            <input
              id="org-page-name-input"
              type="text"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAddOrganization();
              }}
              placeholder="e.g. facebook"
              spellCheck={false}
              autoFocus
            />
            <button
              type="button"
              onClick={() => void handleAddOrganization()}
              disabled={isLoadingRepos || !organization.trim()}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => void handleRefreshRepositories()}
              disabled={isLoadingRepos || organizations.length === 0}
            >
              {isLoadingRepos ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {organizations.length > 0 && (
            <ul className="org-page__organization-list">
              {organizations.map((savedOrganization) => (
                <li key={savedOrganization} className="org-page__organization-item">
                  <span>{savedOrganization}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveOrganization(savedOrganization)}
                    aria-label={`Remove ${savedOrganization}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="org-page__hint">
            Saved organizations are stored in local storage for this browser.
          </div>
          {statusMessage && (
            <div
              className={`org-page__status org-page__status--${statusTone}`}
              role={error ? "alert" : "status"}
              title={statusTitle}
            >
              <span className="org-page__status-icon" aria-hidden="true">
                {statusIcon}
              </span>
              <span>
                {statusMessage}
                {isLoadingRepos && !error ? " Refreshing…" : ""}
              </span>
            </div>
          )}
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
              placeholder="repo name or org/repo"
              spellCheck={false}
            />
          </div>
          <div className="org-page__hint">
            Search suggestions match repository names only. Use org/repo to
            disambiguate duplicates.
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

        <div className="org-page__step">
          <label>
            Repository list
            {repositories.length > 0
              ? ` (${filteredRepositories.length}/${repositories.length})`
              : ""}
            {isLoadingRepos && (
              <span className="org-page__refreshing"> ↻ refreshing</span>
            )}
          </label>
          {repositories.length > 0 && (
            <input
              type="text"
              className="org-page__filter-input"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter repositories…"
              spellCheck={false}
            />
          )}
          <ul className="org-page__list" role="listbox">
            {filteredRepositories.length === 0 && !isLoadingRepos && (
              <li className="org-page__list-empty">
                {repositories.length === 0
                  ? "No repositories loaded."
                  : "No repositories match the filter."}
              </li>
            )}
            {filteredRepositories.map((repo) => (
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
                  <span className="org-page__repo-organization">
                    {getRepositoryOrganization(repo.repo)}
                  </span>
                </div>
                  <div className="org-page__list-item-meta">
                    {repo.updatedAt && (
                      <span
                        className="org-page__repo-updated"
                        title={formatAbsoluteDateTime(repo.updatedAt)}
                      >
                        Updated {formatRelativeDateTime(repo.updatedAt)}
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
      </div>
    </div>
  );
}
