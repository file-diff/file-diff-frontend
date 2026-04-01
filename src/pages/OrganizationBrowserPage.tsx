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
  getOrganizationColor,
  getRepositoryOrganization,
  loadCachedRepositories,
  loadCombinedCachedRepositories,
  loadOrganizationEnabledMap,
  loadLatestCachedRepositoriesFetchedAt,
  loadOrganizationColors,
  loadSavedOrganizations,
  removeOrganization,
  setOrganizationEnabled,
  saveCachedRepositories,
} from "../utils/organizationBrowserStorage";
import type { OrganizationColorDefinition } from "../utils/organizationBrowserStorage";
import {
  formatAbsoluteDateTime,
  formatRelativeDateTime,
  getOrganizationToggleId,
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
  const [organizationEnabledMap, setOrganizationEnabledMap] = useState<
    Record<string, boolean>
  >(() => loadOrganizationEnabledMap(loadSavedOrganizations()));
  const [organizationColors, setOrganizationColors] = useState<
    Record<string, OrganizationColorDefinition>
  >(() => loadOrganizationColors(loadSavedOrganizations()));

  const abortRef = useRef<AbortController | null>(null);
  const organizationsRef = useRef(organizations);
  const organizationEnabledMapRef = useRef<Record<string, boolean>>({});
  const abortPendingRequest = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    organizationsRef.current = organizations;
  }, [organizations]);

  useEffect(() => {
    organizationEnabledMapRef.current = organizationEnabledMap;
  }, [organizationEnabledMap]);

  const handleRefreshRepositories = useCallback(
    async (
      organizationValues?: string[],
      enabledValues?: Record<string, boolean>
    ) => {
      const nextOrganizations = (organizationValues ?? organizationsRef.current)
        .map((org) => org.trim())
        .filter(Boolean);
      if (nextOrganizations.length === 0) {
        abortPendingRequest();
        setError("Add at least one organization.");
        setRepositories([]);
        setIsLoadingRepos(false);
        setLastFetchedAt("");
        return;
      }

      const nextEnabledOrganizations = nextOrganizations.filter(
        (org) => (enabledValues ?? organizationEnabledMapRef.current)[org] ?? true
      );
      if (nextEnabledOrganizations.length === 0) {
        abortPendingRequest();
        setError("Enable at least one organization.");
        setRepositories([]);
        setSelectedRepo("");
        setIsLoadingRepos(false);
        setLastFetchedAt("");
        return;
      }

      setError("");
      abortPendingRequest();
      const controller = new AbortController();
      abortRef.current = controller;

      const cachedRepositories = loadCombinedCachedRepositories(nextOrganizations);
      cachedRepositories.sort(sortByUpdatedAtDesc);
      setRepositories(cachedRepositories);
      setIsLoadingRepos(true);

      const results = await Promise.allSettled(
        nextEnabledOrganizations.map(async (org) => {
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

        const failedOrganization = nextEnabledOrganizations[index];
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
        setError("No repositories found for the enabled organizations.");
      }

      setIsLoadingRepos(false);
    },
    [abortPendingRequest]
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

  const enabledOrganizations = useMemo(
    () =>
      organizations.filter((org) => organizationEnabledMap[org] ?? true),
    [organizationEnabledMap, organizations]
  );

  const handleSelectRepository = (repo: OrganizationRepository) => {
    setSelectedRepo(repo.repo);
  };

  const handleAddOrganization = async () => {
    const nextOrganization = organization.trim();
    if (!nextOrganization) {
      setError("Enter an organization name.");
      return;
    }

    const nextOrganizations = addOrganization(organizations, nextOrganization);
    const nextEnabledMap = loadOrganizationEnabledMap(nextOrganizations);
    setOrganizationEnabledMap(nextEnabledMap);
    setOrganizationColors(loadOrganizationColors(nextOrganizations));
    setOrganizations(nextOrganizations);
    setOrganization("");
    await handleRefreshRepositories(nextOrganizations, nextEnabledMap);
  };

  const handleRemoveOrganization = (organizationToRemove: string) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoadingRepos(false);

    const nextOrganizations = removeOrganization(organizations, organizationToRemove);
    const nextEnabledMap = loadOrganizationEnabledMap(nextOrganizations);
    const nextRepositories = loadCombinedCachedRepositories(nextOrganizations);
    nextRepositories.sort(sortByUpdatedAtDesc);
    clearCachedRepositories(organizationToRemove);
    setOrganizationEnabledMap(nextEnabledMap);
    setOrganizationColors(loadOrganizationColors(nextOrganizations));
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

  const handleToggleOrganization = async (
    organizationToToggle: string,
    enabled: boolean
  ) => {
    setOrganizationEnabled(organizationToToggle, enabled);
    const nextEnabledMap = {
      ...organizationEnabledMapRef.current,
      [organizationToToggle]: enabled,
    };

    setOrganizationEnabledMap(nextEnabledMap);
    if (
      !enabled &&
      selectedRepo.toLowerCase().startsWith(`${organizationToToggle.toLowerCase()}/`)
    ) {
      setSelectedRepo("");
    }

    await handleRefreshRepositories(organizations, nextEnabledMap);
  };

  const repositoryListStatusMessage = isLoadingRepos
    ? "↻ refreshing"
    : lastFetchedAt
      ? `updated ${formatRelativeDateTime(lastFetchedAt)}`
      : "";
  const repositoryListStatusTitle = lastFetchedAt
    ? `Last updated ${formatAbsoluteDateTime(lastFetchedAt)}`
    : undefined;

  return (
    <div className="org-page">
      <h1 className="org-page__title">Browse Organization</h1>

      <div className="org-page__content">
        <div className="org-page__step">
          <label htmlFor="org-page-name-input">
            Organizations
            {organizations.length > 0
              ? ` (${enabledOrganizations.length}/${organizations.length} enabled)`
              : ""}
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
              className="org-page__add-button"
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
                  <li
                    key={savedOrganization}
                  className={
                    "org-page__organization-item" +
                    ((organizationEnabledMap[savedOrganization] ?? true)
                      ? ""
                      : " org-page__organization-item--disabled")
                  }
                  style={getOrganizationColor(savedOrganization, organizationColors)}
                >
                  <label
                    className="org-page__organization-label"
                    htmlFor={getOrganizationToggleId(
                      "org-page-toggle",
                      savedOrganization
                    )}
                  >
                    <input
                      id={getOrganizationToggleId(
                        "org-page-toggle",
                        savedOrganization
                      )}
                      type="checkbox"
                      className="org-page__organization-toggle"
                      checked={organizationEnabledMap[savedOrganization] ?? true}
                      onChange={(event) =>
                        void handleToggleOrganization(
                          savedOrganization,
                          event.target.checked
                        )
                      }
                    />
                    <div style={{padding: "0px 0px 2px 0px"}}>{savedOrganization}</div>
                    <span className="org-page__sr-only">
                      {organizationEnabledMap[savedOrganization] ?? true
                        ? "Click to disable"
                        : "Click to enable"}
                    </span>
                  </label>
                  <button
                    type="button"
                    style={{padding: "2px 8px 0px 7px"}}
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
            Saved organizations stay in local storage for this browser even when
            disabled.
          </div>
          {error && (
            <div
              className="org-page__status org-page__status--error"
              role="alert"
            >
              <span className="org-page__status-icon" aria-hidden="true">
                ⚠
              </span>
              <span>
                {error}
              </span>
            </div>
          )}
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
            {repositoryListStatusMessage && (
              <span
                className="org-page__refreshing"
                title={repositoryListStatusTitle}
              >
                {" "}
                — {repositoryListStatusMessage}
              </span>
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
                  <a
                    href={repo.repositoryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="org-page__repo-name"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {repo.name}
                  </a>
                  <span
                    className="org-page__repo-organization"
                    style={getOrganizationColor(
                      getRepositoryOrganization(repo.repo),
                      organizationColors
                    )}
                  >
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
