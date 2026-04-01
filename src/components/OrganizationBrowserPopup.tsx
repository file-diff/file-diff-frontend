import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Fuse from "fuse.js";
import {
  parseRepositoryLocation,
  requestOrganizationRepositories,
  requestRepositoryRefs,
  requestResolvedCommit,
} from "../utils/repositorySelection";
import type {
  GitRefSummary,
  OrganizationRepository,
  ResolveCommitResponse,
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
import "./OrganizationBrowserPopup.css";

const REPOSITORY_OPTIONS_ID = "org-browser-repository-options";
const REF_OPTIONS_ID = "org-browser-ref-options";

export interface OrganizationBrowserResult {
  repo: string;
  ref: string;
  commit: string;
  commitShort: string;
}

interface OrganizationBrowserPopupProps {
  open: boolean;
  onClose: () => void;
  onSelect: (result: OrganizationBrowserResult) => void;
}

export default function OrganizationBrowserPopup({
  open,
  onClose,
  onSelect,
}: OrganizationBrowserPopupProps) {
  const [organization, setOrganization] = useState("");
  const [organizations, setOrganizations] = useState<string[]>([]);
  const [repositories, setRepositories] = useState<OrganizationRepository[]>(
    []
  );
  const [selectedRepo, setSelectedRepo] = useState("");
  const [refs, setRefs] = useState<GitRefSummary[]>([]);
  const [selectedRef, setSelectedRef] = useState("");
  const [resolvedCommit, setResolvedCommit] =
    useState<ResolveCommitResponse | null>(null);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [isLoadingRefs, setIsLoadingRefs] = useState(false);
  const [isResolvingCommit, setIsResolvingCommit] = useState(false);
  const [error, setError] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState("");
  const [organizationEnabledMap, setOrganizationEnabledMap] = useState<
    Record<string, boolean>
  >(() => loadOrganizationEnabledMap(loadSavedOrganizations()));
  const [organizationColors, setOrganizationColors] = useState<
    Record<string, OrganizationColorDefinition>
  >(() => loadOrganizationColors(loadSavedOrganizations()));

  const abortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const organizationsRef = useRef<string[]>([]);
  const organizationEnabledMapRef = useRef<Record<string, boolean>>({});
  const selectedRepoRef = useRef("");
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

  useEffect(() => {
    selectedRepoRef.current = selectedRepo;
  }, [selectedRepo]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  const enabledOrganizations = useMemo(
    () =>
      organizations.filter((org) => organizationEnabledMap[org] ?? true),
    [organizationEnabledMap, organizations]
  );

  const resetState = useCallback(() => {
    setOrganization("");
    setOrganizations([]);
    setOrganizationEnabledMap({});
    setRepositories([]);
    setSelectedRepo("");
    setRefs([]);
    setSelectedRef("");
    setResolvedCommit(null);
    setIsLoadingRepos(false);
    setIsLoadingRefs(false);
    setIsResolvingCommit(false);
    setError("");
    setFilterQuery("");
    setLastFetchedAt("");
    abortPendingRequest();
  }, [abortPendingRequest]);

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
        setRefs([]);
        setSelectedRef("");
        setResolvedCommit(null);
        setIsLoadingRepos(false);
        setLastFetchedAt("");
        return;
      }

      abortPendingRequest();
      const controller = new AbortController();
      abortRef.current = controller;

      setError("");
      setIsLoadingRefs(false);
      setIsResolvingCommit(false);

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

      const isSelectedRepoAvailable = loadedRepositories.some(
        (repo) => repo.repo === selectedRepoRef.current
      );
      if (!isSelectedRepoAvailable) {
        setSelectedRepo("");
        setRefs([]);
        setSelectedRef("");
        setResolvedCommit(null);
      }

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
    if (!open) {
      resetState();
      return;
    }

    const savedOrganizations = loadSavedOrganizations();
    const cachedRepositories = loadCombinedCachedRepositories(savedOrganizations);
    cachedRepositories.sort(sortByUpdatedAtDesc);

    setOrganizationEnabledMap(loadOrganizationEnabledMap(savedOrganizations));
    setOrganizationColors(loadOrganizationColors(savedOrganizations));
    setOrganizations(savedOrganizations);
    setRepositories(cachedRepositories);
    setLastFetchedAt(loadLatestCachedRepositoriesFetchedAt(savedOrganizations));
    if (savedOrganizations.length > 0) {
      const refreshTimer = window.setTimeout(() => {
        void handleRefreshRepositories(savedOrganizations);
      }, 0);

      return () => {
        window.clearTimeout(refreshTimer);
      };
    }
  }, [handleRefreshRepositories, open, resetState]);

  const handleAddOrganization = async () => {
    const org = organization.trim();
    if (!org) {
      setError("Enter an organization name.");
      return;
    }

    const nextOrganizations = addOrganization(organizations, org);
    const nextEnabledMap = loadOrganizationEnabledMap(nextOrganizations);
    setOrganizationEnabledMap(nextEnabledMap);
    setOrganizationColors(loadOrganizationColors(nextOrganizations));
    setOrganizations(nextOrganizations);
    setOrganization("");
    await handleRefreshRepositories(nextOrganizations, nextEnabledMap);
  };

  const handleRemoveOrganization = (organizationToRemove: string) => {
    abortPendingRequest();
    setIsLoadingRepos(false);
    setIsLoadingRefs(false);
    setIsResolvingCommit(false);

    const nextOrganizations = removeOrganization(organizations, organizationToRemove);
    const nextEnabledMap = loadOrganizationEnabledMap(nextOrganizations);
    clearCachedRepositories(organizationToRemove);
    const nextRepositories = loadCombinedCachedRepositories(nextOrganizations);
    nextRepositories.sort(sortByUpdatedAtDesc);
    setOrganizationEnabledMap(nextEnabledMap);
    setOrganizationColors(loadOrganizationColors(nextOrganizations));
    setOrganizations(nextOrganizations);
    setRepositories(nextRepositories);
    setLastFetchedAt(loadLatestCachedRepositoriesFetchedAt(nextOrganizations));

    if (
      selectedRepo
        .toLowerCase()
        .startsWith(`${organizationToRemove.toLowerCase()}/`)
    ) {
      setSelectedRepo("");
      setRefs([]);
      setSelectedRef("");
      setResolvedCommit(null);
    }

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
      setRefs([]);
      setSelectedRef("");
      setResolvedCommit(null);
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

  const handleLoadRefs = async (repoValue = selectedRepo) => {
    const repo = repoValue.trim();
    if (!repo) {
      setError("Enter a repository.");
      return;
    }

    setSelectedRepo(repo);
    setRefs([]);
    setSelectedRef("");
    setResolvedCommit(null);
    setError("");

    abortPendingRequest();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoadingRepos(false);
    setIsResolvingCommit(false);
    setIsLoadingRefs(true);

    try {
      const sortedRefs = await requestRepositoryRefs(repo, controller.signal);
      setRefs(sortedRefs);

      if (sortedRefs.length === 0) {
        setError("No refs found for this repository.");
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Unable to load refs."
      );
    } finally {
      if (!controller.signal.aborted) {
        setIsLoadingRefs(false);
      }
    }
  };

  const handleResolveCommit = async (
    refValue = selectedRef,
    repoValue = selectedRepo
  ) => {
    const repo = repoValue.trim();
    const refName = refValue.trim();

    if (!repo) {
      setError("Enter a repository.");
      return;
    }

    if (!refName) {
      setError("Enter a ref.");
      return;
    }

    setSelectedRef(refName);
    setResolvedCommit(null);
    setError("");

    abortPendingRequest();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoadingRepos(false);
    setIsLoadingRefs(false);
    setIsResolvingCommit(true);

    try {
      const result = await requestResolvedCommit(repo, refName, controller.signal);
      setResolvedCommit(result);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Unable to resolve commit."
      );
    } finally {
      if (!controller.signal.aborted) {
        setIsResolvingCommit(false);
      }
    }
  };

  const handleRepositoryInputChange = (value: string) => {
    const parsedLocation = parseRepositoryLocation(value);

    if (parsedLocation) {
      const nextRef = parsedLocation.ref ?? "";
      const nextOrganizations = addOrganization(
        organizations,
        parsedLocation.organization
      );
      const nextEnabledMap = loadOrganizationEnabledMap(nextOrganizations);

      abortPendingRequest();
      setSelectedRepo(parsedLocation.repo);
      setRefs([]);
      setSelectedRef(nextRef);
      setResolvedCommit(null);
      setIsLoadingRepos(false);
      setIsLoadingRefs(false);
      setIsResolvingCommit(false);
      setError("");

      setOrganization(parsedLocation.organization);
      setOrganizationEnabledMap(nextEnabledMap);
      setOrganizationColors(loadOrganizationColors(nextOrganizations));
      setOrganizations(nextOrganizations);

      void (async () => {
        await handleRefreshRepositories(nextOrganizations, nextEnabledMap);
        await handleLoadRefs(parsedLocation.repo);

        if (parsedLocation.ref) {
          await handleResolveCommit(parsedLocation.ref, parsedLocation.repo);
        }
      })();
      return;
    }

    const repoName = value.trim();
    const exactMatches = repositories.filter(
      (repo) => repo.name.toLowerCase() === repoName.toLowerCase()
    );
    const nextRepo = repoName.includes("/")
      ? repoName
      : exactMatches.length === 1
        ? exactMatches[0].repo
        : enabledOrganizations.length === 1 && repoName
          ? `${enabledOrganizations[0]}/${repoName}`
          : value;

    abortPendingRequest();
    setSelectedRepo(nextRepo);
    setRefs([]);
    setSelectedRef("");
    setResolvedCommit(null);
    setIsLoadingRepos(false);
    setIsLoadingRefs(false);
    setIsResolvingCommit(false);
    setError("");
  };

  const handleSelectRepository = async (repo: string) => {
    await handleLoadRefs(repo);
  };

  const handleSelectRef = async (refName: string) => {
    await handleResolveCommit(refName);
  };

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

  const repoInputValue = selectedRepo
    ? selectedRepo.includes("/")
      ? enabledOrganizations.length === 1 &&
        selectedRepo
          .toLowerCase()
          .startsWith(`${enabledOrganizations[0].toLowerCase()}/`)
        ? selectedRepo.split("/").slice(1).join("/")
        : selectedRepo
      : selectedRepo
    : "";

  const handleConfirm = () => {
    if (!resolvedCommit || !selectedRepo || !selectedRef) return;

    onSelect({
      repo: selectedRepo,
      ref: selectedRef,
      commit: resolvedCommit.commit,
      commitShort: resolvedCommit.commitShort,
    });
  };

  const handleBackdropClick = (
    event: React.MouseEvent<HTMLDialogElement>
  ) => {
    if (event.target === dialogRef.current) {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="org-browser-dialog"
      onClick={handleBackdropClick}
    >
      <div className="org-browser">
        <div className="org-browser__header">
          <h2>Browse Organization</h2>
          <button
            type="button"
            className="org-browser__close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="org-browser__content">
          <div className="org-browser__step">
            <label htmlFor="org-name-input">
              Organizations
              {organizations.length > 0
                ? ` (${enabledOrganizations.length}/${organizations.length} enabled)`
                : ""}
            </label>
            <div className="org-browser__input-row">
              <input
                id="org-name-input"
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
              <ul className="org-browser__organization-list">
                {organizations.map((savedOrganization) => (
                  <li
                    key={savedOrganization}
                    className={
                      "org-browser__organization-item" +
                      ((organizationEnabledMap[savedOrganization] ?? true)
                        ? ""
                        : " org-browser__organization-item--disabled")
                    }
                    style={getOrganizationColor(savedOrganization, organizationColors)}
                  >
                    <label
                      className="org-browser__organization-label"
                      htmlFor={getOrganizationToggleId(
                        "org-browser-toggle",
                        savedOrganization
                      )}
                    >
                      <input
                        id={getOrganizationToggleId(
                          "org-browser-toggle",
                          savedOrganization
                        )}
                        type="checkbox"
                        className="org-browser__organization-toggle"
                        checked={organizationEnabledMap[savedOrganization] ?? true}
                        onChange={(event) =>
                          void handleToggleOrganization(
                            savedOrganization,
                            event.target.checked
                          )
                        }
                      />
                      <span>{savedOrganization}</span>
                    </label>
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
            <div className="org-browser__hint">
              Saved organizations stay in local storage for this browser even when
              disabled.
            </div>
            {error && (
              <div
                className="org-browser__status org-browser__status--error"
                role="alert"
              >
                <span className="org-browser__status-icon" aria-hidden="true">
                  ⚠
                </span>
                <span>
                  {error}
                </span>
              </div>
            )}
          </div>

          <div className="org-browser__step">
            <label htmlFor="org-browser-repository-input">Repository</label>
            <div className="org-browser__input-row">
              <input
                id="org-browser-repository-input"
                type="text"
                value={repoInputValue}
                list={REPOSITORY_OPTIONS_ID}
                onChange={(e) => handleRepositoryInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleLoadRefs();
                }}
                placeholder="repo name or org/repo"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => void handleLoadRefs()}
                disabled={isLoadingRefs || !selectedRepo.trim()}
              >
                {isLoadingRefs ? "Loading…" : "Load refs"}
              </button>
            </div>
            <datalist id={REPOSITORY_OPTIONS_ID}>
              {repositories.map((repo) => (
                <option
                  key={repo.repo}
                  value={repo.repo}
                  label={`${repo.name} (${getRepositoryOrganization(repo.repo)})`}
                />
              ))}
            </datalist>
          </div>

          <div className="org-browser__step">
            <label>
              Repository list
              {repositories.length > 0
                ? ` (${filteredRepositories.length}/${repositories.length})`
                : ""}
              {repositoryListStatusMessage && (
                <span
                  className="org-browser__refreshing"
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
                className="org-browser__filter-input"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter repositories…"
                spellCheck={false}
              />
            )}
            <ul className="org-browser__list" role="listbox">
              {filteredRepositories.length === 0 && !isLoadingRepos && (
                <li className="org-browser__list-empty">
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
                    "org-browser__list-item" +
                    (selectedRepo === repo.repo
                      ? " org-browser__list-item--selected"
                      : "")
                  }
                  onClick={() => void handleSelectRepository(repo.repo)}
                >
                  <div className="org-browser__list-item-main">
                    <span className="org-browser__repo-name">{repo.name}</span>
                    <span
                      className="org-browser__repo-organization"
                      style={getOrganizationColor(
                        getRepositoryOrganization(repo.repo),
                        organizationColors
                      )}
                    >
                      {getRepositoryOrganization(repo.repo)}
                    </span>
                  </div>
                  <div className="org-browser__list-item-meta">
                    {repo.updatedAt && (
                      <span
                        className="org-browser__repo-updated"
                        title={formatAbsoluteDateTime(repo.updatedAt)}
                      >
                        Updated {formatRelativeDateTime(repo.updatedAt)}
                      </span>
                    )}
                    <Link
                      to={`/commits?repo=${encodeURIComponent(repo.repo)}`}
                      className="org-browser__repo-commits-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Commits
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {isLoadingRefs && (
            <div className="org-browser__loading">Loading refs…</div>
          )}

          {(selectedRepo.trim() || refs.length > 0) && (
            <div className="org-browser__step">
              <label htmlFor="org-browser-ref-input">
                Ref
                {refs.length > 0 ? ` (${refs.length} suggestions)` : ""} —{" "}
                <span className="org-browser__repo-context">{selectedRepo}</span>
              </label>
              <div className="org-browser__input-row">
                <input
                  id="org-browser-ref-input"
                  type="text"
                  value={selectedRef}
                  list={REF_OPTIONS_ID}
                  onChange={(e) => {
                    abortRef.current?.abort();
                    abortRef.current = null;
                    setSelectedRef(e.target.value);
                    setResolvedCommit(null);
                    setIsResolvingCommit(false);
                    setError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleResolveCommit();
                  }}
                  placeholder="main"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => void handleResolveCommit()}
                  disabled={isResolvingCommit || !selectedRef.trim()}
                >
                  {isResolvingCommit ? "Resolving…" : "Resolve commit"}
                </button>
              </div>
              <datalist id={REF_OPTIONS_ID}>
                {refs.map((gitRef) => (
                  <option
                    key={gitRef.ref}
                    value={gitRef.name}
                    label={`${gitRef.name} (${gitRef.type}${gitRef.commitShort ? ` · ${gitRef.commitShort}` : ""})`}
                  />
                ))}
              </datalist>
              <div className="org-browser__hint">
                Enter any ref manually. Loaded branches and tags are available
                as autocomplete suggestions.
              </div>

              {refs.length > 0 && (
                <ul className="org-browser__list" role="listbox">
                  {refs.map((gitRef) => (
                    <li
                      key={gitRef.ref}
                      role="option"
                      aria-selected={selectedRef === gitRef.name}
                      className={
                        "org-browser__list-item" +
                        (selectedRef === gitRef.name
                          ? " org-browser__list-item--selected"
                          : "")
                      }
                      onClick={() => void handleSelectRef(gitRef.name)}
                    >
                      <span className="org-browser__ref-name">
                        {gitRef.name}
                      </span>
                      <span className="org-browser__ref-type">
                        {gitRef.type}
                      </span>
                      {gitRef.commitShort && (
                        <code className="org-browser__ref-commit">
                          {gitRef.commitShort}
                        </code>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {isResolvingCommit && (
            <div className="org-browser__loading">Resolving commit…</div>
          )}

          {resolvedCommit && (
            <div className="org-browser__step">
              <label>Resolved commit</label>
              <div className="org-browser__commit-info">
                <code>{resolvedCommit.commit}</code>
              </div>
            </div>
          )}
        </div>

        <div className="org-browser__actions">
          <button type="button" className="org-browser__cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="org-browser__confirm"
            onClick={handleConfirm}
            disabled={!resolvedCommit}
          >
            Select & Start Indexing
          </button>
        </div>
      </div>
    </dialog>
  );
}
