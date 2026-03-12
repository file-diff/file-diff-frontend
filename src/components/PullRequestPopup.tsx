import { useCallback, useEffect, useRef, useState } from "react";
import { requestResolvedPullRequest } from "../utils/repositorySelection";
import type { ResolvePullRequestResponse } from "../utils/repositorySelection";
import "./OrganizationBrowserPopup.css";

export interface PullRequestPopupResult {
  pullRequestUrl: string;
  repo: string;
  sourceCommit: string;
  sourceCommitShort: string;
  targetCommit: string;
  targetCommitShort: string;
}

interface PullRequestPopupProps {
  open: boolean;
  onClose: () => void;
  onSelect: (result: PullRequestPopupResult) => void;
}

export default function PullRequestPopup({
  open,
  onClose,
  onSelect,
}: PullRequestPopupProps) {
  const [pullRequestUrl, setPullRequestUrl] = useState("");
  const [resolvedPullRequest, setResolvedPullRequest] =
    useState<ResolvePullRequestResponse | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  const resetState = useCallback(() => {
    setPullRequestUrl("");
    setResolvedPullRequest(null);
    setIsResolving(false);
    setError("");
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  const handleResolve = useCallback(async () => {
    const trimmedUrl = pullRequestUrl.trim();
    if (!trimmedUrl) {
      setError("Paste a pull request URL.");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setResolvedPullRequest(null);
    setError("");
    setIsResolving(true);

    try {
      const result = await requestResolvedPullRequest(
        trimmedUrl,
        controller.signal
      );
      setResolvedPullRequest(result);
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }

      setError(
        err instanceof Error && err.message
          ? err.message
          : "Unable to resolve pull request."
      );
    } finally {
      if (!controller.signal.aborted) {
        setIsResolving(false);
      }
    }
  }, [pullRequestUrl]);

  const handleConfirm = () => {
    if (!resolvedPullRequest) {
      return;
    }

    onSelect({
      pullRequestUrl: pullRequestUrl.trim(),
      repo: resolvedPullRequest.repo,
      sourceCommit: resolvedPullRequest.sourceCommit,
      sourceCommitShort: resolvedPullRequest.sourceCommitShort,
      targetCommit: resolvedPullRequest.targetCommit,
      targetCommitShort: resolvedPullRequest.targetCommitShort,
    });
  };

  const handleBackdropClick = (
    event: React.MouseEvent<HTMLDialogElement>
  ) => {
    if (event.target === dialogRef.current) {
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
          <h2>Resolve Pull Request</h2>
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
            <label htmlFor="pull-request-url-input">Pull request URL</label>
            <div className="org-browser__input-row">
              <input
                id="pull-request-url-input"
                type="url"
                value={pullRequestUrl}
                onChange={(event) => {
                  setPullRequestUrl(event.target.value);
                  setResolvedPullRequest(null);
                  setError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleResolve();
                  }
                }}
                placeholder="https://github.com/owner/repo/pull/123"
                spellCheck={false}
                autoFocus
              />
              <button
                type="button"
                onClick={() => void handleResolve()}
                disabled={isResolving || !pullRequestUrl.trim()}
              >
                {isResolving ? "Resolving…" : "Resolve"}
              </button>
            </div>
            <div className="org-browser__hint">
              The left side uses the pull request target commit. The right side
              uses the pull request source commit.
            </div>
          </div>

          {isResolving && (
            <div className="org-browser__loading">Resolving pull request…</div>
          )}

          {resolvedPullRequest && (
            <div className="org-browser__step">
              <label>Resolved comparison</label>
              <dl className="org-browser__summary-list">
                <div className="org-browser__summary-row">
                  <dt>Repository</dt>
                  <dd>{resolvedPullRequest.repo}</dd>
                </div>
                <div className="org-browser__summary-row">
                  <dt>Left target commit</dt>
                  <dd>
                    <code>{resolvedPullRequest.targetCommit}</code>
                  </dd>
                </div>
                <div className="org-browser__summary-row">
                  <dt>Right source commit</dt>
                  <dd>
                    <code>{resolvedPullRequest.sourceCommit}</code>
                  </dd>
                </div>
              </dl>
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
            disabled={!resolvedPullRequest}
          >
            Resolve & Start Both Sides
          </button>
        </div>
      </div>
    </dialog>
  );
}
