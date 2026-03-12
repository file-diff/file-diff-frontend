import { useCallback, useEffect, useRef, useState } from "react";
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

  const abortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

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

  const resetState = useCallback(() => {
    setOrganization("");
    setRepositories([]);
    setSelectedRepo("");
    setRefs([]);
    setSelectedRef("");
    setResolvedCommit(null);
    setIsLoadingRepos(false);
    setIsLoadingRefs(false);
    setIsResolvingCommit(false);
    setError("");
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  const handleLoadRepositoriesForParsedLocation = useCallback(
    async (organizationValue: string) => {
      const org = organizationValue.trim();
      if (!org) {
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError("");
      setRepositories([]);
      setIsLoadingRefs(false);
      setIsResolvingCommit(false);
      setIsLoadingRepos(true);

      try {
        const repos = await requestOrganizationRepositories(org, controller.signal);
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
    []
  );

  const handleLoadRepositories = async () => {
    const org = organization.trim();
    if (!org) {
      setError("Enter an organization name.");
      return;
    }

    setError("");
    setSelectedRepo("");
    setRefs([]);
    setSelectedRef("");
    setResolvedCommit(null);
    await handleLoadRepositoriesForParsedLocation(org);
  };

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

    abortRef.current?.abort();
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

    abortRef.current?.abort();
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
    const nextRepo = parsedLocation ? parsedLocation.repo : value;
    const nextRef = parsedLocation?.ref ?? "";

    abortRef.current?.abort();
    abortRef.current = null;
    setSelectedRepo(nextRepo);
    setRefs([]);
    setSelectedRef(nextRef);
    setResolvedCommit(null);
    setIsLoadingRepos(false);
    setIsLoadingRefs(false);
    setIsResolvingCommit(false);
    setError("");

    if (!parsedLocation) {
      return;
    }

    setOrganization(parsedLocation.organization);

    void (async () => {
      await handleLoadRepositoriesForParsedLocation(parsedLocation.organization);
      await handleLoadRefs(parsedLocation.repo);

      if (parsedLocation.ref) {
        await handleResolveCommit(parsedLocation.ref, parsedLocation.repo);
      }
    })();
  };

  const handleSelectRepository = async (repo: string) => {
    await handleLoadRefs(repo);
  };

  const handleSelectRef = async (refName: string) => {
    await handleResolveCommit(refName);
  };

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
          {error && <div className="org-browser__error">{error}</div>}

          <div className="org-browser__step">
            <label htmlFor="org-name-input">Organization</label>
            <div className="org-browser__input-row">
              <input
                id="org-name-input"
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

          <div className="org-browser__step">
            <label htmlFor="org-browser-repository-input">
              Repository
              {repositories.length > 0
                ? ` (${repositories.length} suggestions)`
                : ""}
            </label>
            <div className="org-browser__input-row">
              <input
                id="org-browser-repository-input"
                type="text"
                value={selectedRepo}
                list={REPOSITORY_OPTIONS_ID}
                onChange={(e) => handleRepositoryInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleLoadRefs();
                }}
                placeholder="owner/repo or paste full GitHub URL"
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
                <option key={repo.repo} value={repo.repo} label={repo.name} />
              ))}
            </datalist>
            <div className="org-browser__hint">
              Enter any repository manually. Listed organization repositories are
              available as autocomplete suggestions.
            </div>
          </div>

          {repositories.length > 0 && (
            <div className="org-browser__step">
              <label>Repository list</label>
              <ul className="org-browser__list" role="listbox">
                {repositories.map((repo) => (
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
                    <span className="org-browser__repo-name">{repo.name}</span>
                    <span className="org-browser__repo-full">{repo.repo}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
