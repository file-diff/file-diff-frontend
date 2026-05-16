import { useEffect, useRef } from "react";
import "./CreateTaskConfirmPopup.css";

export interface CreateTaskConfirmPopupProps {
  open: boolean;
  variantLabel: string;
  repo: string;
  branch: string;
  existingSessionLabel?: string;
  isContinuingExistingSession?: boolean;
  pullRequestCompletionModeLabel: string;
  problemStatement: string;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function CreateTaskConfirmPopup({
  open,
  variantLabel,
  repo,
  branch,
  existingSessionLabel,
  isContinuingExistingSession = false,
  pullRequestCompletionModeLabel,
  problemStatement,
  isSubmitting,
  onConfirm,
  onCancel,
}: CreateTaskConfirmPopupProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const taskLabel = variantLabel === "task" ? "task" : `${variantLabel} task`;
  const actionLabel = isContinuingExistingSession
    ? `continue ${taskLabel}`
    : `create ${taskLabel}`;

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
        onCancel();
      }
    };
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onCancel, isSubmitting]);

  const handleBackdropClick = (
    event: React.MouseEvent<HTMLDialogElement>
  ) => {
    if (event.target === dialogRef.current && !isSubmitting) {
      onCancel();
    }
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="create-task-confirm-dialog"
      onClick={handleBackdropClick}
      aria-labelledby="create-task-confirm-title"
    >
      <div className="create-task-confirm">
        <div className="create-task-confirm__header">
          <h2 id="create-task-confirm-title">⚠️ Confirm task creation</h2>
        </div>

        <div className="create-task-confirm__content">
          <p className="create-task-confirm__lead">
            Are you sure you want to {isContinuingExistingSession ? "continue" : "create"}{" "}
            <strong className="create-task-confirm__variant">{taskLabel}</strong>{" "}
            in repository
          </p>
          <p className="create-task-confirm__repo">{repo || "(no repository)"}</p>
          {isContinuingExistingSession ? (
            <>
              <p className="create-task-confirm__branch">
                existing session{" "}
                <strong>{existingSessionLabel || "(no session selected)"}</strong>
              </p>
              <p className="create-task-confirm__branch">
                branch title and target branch will be ignored
              </p>
            </>
          ) : (
            <p className="create-task-confirm__branch">
              on branch <strong>{branch || "(default)"}</strong>
            </p>
          )}
          <p className="create-task-confirm__branch">
            pull request completion{" "}
            <strong>{pullRequestCompletionModeLabel}</strong>
          </p>

          <label
            className="create-task-confirm__problem-label"
            htmlFor="create-task-confirm-problem"
          >
            Problem statement
          </label>
          <textarea
            id="create-task-confirm-problem"
            className="create-task-confirm__problem"
            value={problemStatement}
            readOnly
            rows={8}
            spellCheck={false}
          />
        </div>

        <div className="create-task-confirm__actions">
          <button
            type="button"
            className="create-task-confirm__cancel"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="create-task-confirm__confirm"
            onClick={onConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating task…" : `Yes, ${actionLabel}`}
          </button>
        </div>
      </div>
    </dialog>
  );
}
