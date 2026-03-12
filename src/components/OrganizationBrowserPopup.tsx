import { useCallback, useEffect, useRef, useState } from "react";
import {
  requestOrganizationRepositories,
  requestResolvedCommit,
} from "../utils/repositorySelection";
import type {
  GitRefSummary,
  OrganizationRepository,
  ResolveCommitResponse,
} from "../utils/repositorySelection";
import { JOBS_API_URL } from "../config/api";
import "./OrganizationBrowserPopup.css";

const LIST_REFS_URL = `${JOBS_API_URL}/refs`;

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

function sortGitRefs(a: GitRefSummary, b: GitRefSummary): number {
  if (a.type !== b.type) {
    return a.type.localeCompare(b.type);
  }

  return a.name.localeCompare(b.name);
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

  const handleLoadRepositories = async () => {
    const org = organization.trim();
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
    setRefs([]);
    setSelectedRef("");
    setResolvedCommit(null);
    setIsLoadingRepos(true);

    try {
      const repos = await requestOrganizationRepositories(
        org,
        controller.signal
      );
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
  };

  const handleSelectRepository = async (repo: string) => {
    setSelectedRepo(repo);
    setRefs([]);
    setSelectedRef("");
    setResolvedCommit(null);
    setError("");

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoadingRefs(true);

    try {
      const response = await fetch(LIST_REFS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error("Unable to load refs");
      }

      const data = (await response.json()) as {
        refs: GitRefSummary[];
      };
      const sortedRefs = Array.isArray(data.refs)
        ? [...data.refs].sort(sortGitRefs)
        : [];
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

  const handleSelectRef = async (refName: string) => {
    setSelectedRef(refName);
    setResolvedCommit(null);
    setError("");

    if (!selectedRepo) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsResolvingCommit(true);

    try {
      const result = await requestResolvedCommit(
        selectedRepo,
        refName,
        controller.signal
      );
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

        {repositories.length > 0 && (
          <div className="org-browser__step">
            <label>Repository ({repositories.length})</label>
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

        {refs.length > 0 && (
          <div className="org-browser__step">
            <label>
              Ref ({refs.length}) —{" "}
              <span className="org-browser__repo-context">{selectedRepo}</span>
            </label>
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
                  <span className="org-browser__ref-name">{gitRef.name}</span>
                  <span className="org-browser__ref-type">{gitRef.type}</span>
                  {gitRef.commitShort && (
                    <code className="org-browser__ref-commit">
                      {gitRef.commitShort}
                    </code>
                  )}
                </li>
              ))}
            </ul>
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
            Select &amp; Start Indexing
          </button>
        </div>
      </div>
    </dialog>
  );
}
