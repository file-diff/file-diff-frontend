import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  requestRevertToCommit,
} from "../utils/repositorySelection";
import type { RevertToCommitResponse } from "../utils/repositorySelection";
import "./OrganizationBrowserPopup.css";
import "./RevertCommitPopup.css";

interface RevertCommitPopupProps {
  open: boolean;
  repo: string;
  commit: string;
  initialBranch: string;
  bearerToken: string;
  onBearerTokenChange?: (value: string) => void;
  onClose: () => void;
  onCreated: (result: RevertToCommitResponse) => void;
}

export default function RevertCommitPopup({
  open,
  repo,
  commit,
  initialBranch,
  bearerToken,
  onBearerTokenChange,
  onClose,
  onCreated,
}: RevertCommitPopupProps) {
  const [branchName, setBranchName] = useState(initialBranch);
  const [tokenInput, setTokenInput] = useState(bearerToken);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const dialogRef = useRef<HTMLDialogElement>(null);
  const submitAbortRef = useRef<AbortController | null>(null);

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

    const handleClose = () => {
      if (!isSubmitting) {
        onClose();
      }
    };
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [isSubmitting, onClose]);

  useEffect(() => {
    if (!open) {
      submitAbortRef.current?.abort();
      setBranchName(initialBranch);
      setTokenInput(bearerToken);
      setIsSubmitting(false);
      setError("");
      return;
    }

    setBranchName(initialBranch);
    setTokenInput(bearerToken);
    setError("");
  }, [bearerToken, initialBranch, open]);

  const trimmedBranch = branchName.trim();
  const trimmedToken = tokenInput.trim();
  const shortCommit = useMemo(() => commit.slice(0, 7), [commit]);

  const handleSubmit = useCallback(async () => {
    if (!repo || !commit || !trimmedBranch) {
      return;
    }
    if (!trimmedToken) {
      setError("A bearer token is required to create the revert pull request.");
      return;
    }

    submitAbortRef.current?.abort();
    const controller = new AbortController();
    submitAbortRef.current = controller;

    setIsSubmitting(true);
    setError("");

    try {
      const result = await requestRevertToCommit(
        repo,
        commit,
        trimmedBranch,
        trimmedToken,
        controller.signal
      );
      if (controller.signal.aborted) return;
      onCreated(result);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Unable to create revert pull request."
      );
    } finally {
      if (!controller.signal.aborted) {
        setIsSubmitting(false);
      }
    }
  }, [commit, onCreated, repo, trimmedBranch, trimmedToken]);

  const handleBackdropClick = (
    event: React.MouseEvent<HTMLDialogElement>
  ) => {
    if (event.target === dialogRef.current && !isSubmitting) {
      onClose();
    }
  };

  if (!open) {
    return null;
  }

  return (
    <dialog
      ref={dialogRef}
      className="org-browser-dialog"
      onClick={handleBackdropClick}
    >
      <div className="org-browser">
        <div className="org-browser__header">
          <h2>Revert to commit</h2>
          <button
            type="button"
            className="org-browser__close"
            onClick={onClose}
            aria-label="Close"
            disabled={isSubmitting}
          >
            ✕
          </button>
        </div>

        <div className="org-browser__content">
          {error && <div className="revert-commit-popup__error">{error}</div>}

          <div className="org-browser__step">
            <label>Commit</label>
            <div className="org-browser__commit-info">
              <code>
                {repo} @ {shortCommit}
              </code>
            </div>
            <div className="org-browser__hint">
              This creates a restore branch and opens a pull request back into the
              selected target branch.
            </div>
          </div>

          <div className="org-browser__step">
            <label htmlFor="revert-commit-popup-branch">Target branch</label>
            <div className="org-browser__input-row">
              <input
                id="revert-commit-popup-branch"
                type="text"
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder="main"
                spellCheck={false}
                autoFocus
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="org-browser__step">
            <label htmlFor="revert-commit-popup-token">Bearer token</label>
            <div className="org-browser__input-row">
              <input
                id="revert-commit-popup-token"
                type="password"
                value={tokenInput}
                onChange={(event) => {
                  setTokenInput(event.target.value);
                  onBearerTokenChange?.(event.target.value);
                }}
                placeholder="Required to create the revert PR"
                spellCheck={false}
                autoComplete="off"
                disabled={isSubmitting}
              />
            </div>
          </div>
        </div>

        <div className="org-browser__actions">
          <button
            type="button"
            className="org-browser__cancel"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="org-browser__confirm"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || !trimmedBranch || !trimmedToken}
          >
            {isSubmitting ? "Creating…" : "Create revert PR"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
