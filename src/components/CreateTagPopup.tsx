import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  requestCreateTag,
  requestRepositoryTags,
} from "../utils/repositorySelection";
import type { RepositoryTag } from "../utils/repositorySelection";
import { proposeNextTagName } from "../utils/proposeNextTagName";
import "./OrganizationBrowserPopup.css";
import "./CreateTagPopup.css";

const RECENT_TAGS_LIMIT = 10;

export interface CreateTagPopupResult {
  repo: string;
  tag: string;
  commit: string;
}

interface CreateTagPopupProps {
  open: boolean;
  repo: string;
  commit: string;
  bearerToken: string;
  onBearerTokenChange?: (value: string) => void;
  onClose: () => void;
  onCreated: (result: CreateTagPopupResult) => void;
}

export default function CreateTagPopup({
  open,
  repo,
  commit,
  bearerToken,
  onBearerTokenChange,
  onClose,
  onCreated,
}: CreateTagPopupProps) {
  const [recentTags, setRecentTags] = useState<RepositoryTag[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [tagName, setTagName] = useState("");
  const [hasUserEditedTagName, setHasUserEditedTagName] = useState(false);
  const [tokenInput, setTokenInput] = useState(bearerToken);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const dialogRef = useRef<HTMLDialogElement>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
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
  }, [onClose, isSubmitting]);

  // Reset state when the popup opens.
  useEffect(() => {
    if (!open) {
      loadAbortRef.current?.abort();
      submitAbortRef.current?.abort();
      setRecentTags([]);
      setIsLoadingTags(false);
      setTagName("");
      setHasUserEditedTagName(false);
      setError("");
      setIsSubmitting(false);
      return;
    }
    setTokenInput(bearerToken);
  }, [open, bearerToken]);

  // Load the most recent tags whenever the popup opens for a repository.
  useEffect(() => {
    if (!open || !repo) {
      return;
    }

    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;

    setIsLoadingTags(true);
    setError("");

    void (async () => {
      try {
        const tags = await requestRepositoryTags(
          repo,
          RECENT_TAGS_LIMIT,
          controller.signal
        );
        if (controller.signal.aborted) return;
        setRecentTags(tags);
        setTagName((prev) => {
          if (hasUserEditedTagName && prev) {
            return prev;
          }
          return proposeNextTagName(tags[0]?.name);
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Unable to load recent tags."
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingTags(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
    // hasUserEditedTagName intentionally omitted: we only want to reload tags
    // when the popup opens or the repo changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, repo]);

  const trimmedTag = tagName.trim();
  const trimmedToken = tokenInput.trim();
  const shortCommit = useMemo(() => commit.slice(0, 7), [commit]);

  const handleSubmit = useCallback(async () => {
    if (!trimmedTag || !repo || !commit) {
      return;
    }
    if (!trimmedToken) {
      setError("A bearer token is required to create tags.");
      return;
    }

    submitAbortRef.current?.abort();
    const controller = new AbortController();
    submitAbortRef.current = controller;

    setIsSubmitting(true);
    setError("");

    try {
      await requestCreateTag(
        repo,
        trimmedTag,
        commit,
        trimmedToken,
        controller.signal
      );
      if (controller.signal.aborted) return;
      onCreated({ repo, tag: trimmedTag, commit });
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Unable to create tag."
      );
    } finally {
      if (!controller.signal.aborted) {
        setIsSubmitting(false);
      }
    }
  }, [trimmedTag, trimmedToken, repo, commit, onCreated]);

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
          <h2>Create tag</h2>
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
          {error && <div className="create-tag-popup__error">{error}</div>}

          <div className="org-browser__step">
            <label>Commit</label>
            <div className="org-browser__commit-info">
              <code>
                {repo} @ {shortCommit}
              </code>
            </div>
          </div>

          <div className="org-browser__step">
            <label>
              Recent tags
              {isLoadingTags && (
                <span className="org-browser__refreshing"> — loading…</span>
              )}
            </label>
            {recentTags.length > 0 ? (
              <ul className="create-tag-popup__tag-list">
                {recentTags.map((tag) => (
                  <li key={tag.ref} className="create-tag-popup__tag-item">
                    <span className="create-tag-popup__tag-name">
                      {tag.name}
                    </span>
                    <span className="create-tag-popup__tag-commit">
                      {tag.commitShort}
                    </span>
                  </li>
                ))}
              </ul>
            ) : !isLoadingTags ? (
              <div className="org-browser__list-empty">
                No existing tags found.
              </div>
            ) : null}
          </div>

          <div className="org-browser__step">
            <label htmlFor="create-tag-popup-name">New tag name</label>
            <div className="org-browser__input-row">
              <input
                id="create-tag-popup-name"
                type="text"
                value={tagName}
                onChange={(event) => {
                  setTagName(event.target.value);
                  setHasUserEditedTagName(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder="e.g. v0.2.4-test-7"
                spellCheck={false}
                autoFocus
                disabled={isSubmitting}
              />
            </div>
            <div className="org-browser__hint">
              Proposed from the most recent tag. You can edit it before
              creating.
            </div>
          </div>

          <div className="org-browser__step">
            <label htmlFor="create-tag-popup-token">Bearer token</label>
            <div className="org-browser__input-row">
              <input
                id="create-tag-popup-token"
                type="password"
                value={tokenInput}
                onChange={(event) => {
                  setTokenInput(event.target.value);
                  onBearerTokenChange?.(event.target.value);
                }}
                placeholder="Required to create tags"
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
            disabled={isSubmitting || !trimmedTag || !trimmedToken}
          >
            {isSubmitting ? "Creating…" : "Create tag"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
