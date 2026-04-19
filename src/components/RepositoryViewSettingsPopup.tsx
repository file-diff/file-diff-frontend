import { useEffect, useRef, useState } from "react";
import {
  REFRESH_INTERVAL_OPTIONS,
  type RefreshIntervalMs,
} from "../utils/repositoryViewStorage";
import "./RepositoryViewSettingsPopup.css";

interface RepositoryViewSettingsPopupProps {
  open: boolean;
  onClose: () => void;
  refreshIntervalMs: RefreshIntervalMs;
  onRefreshIntervalChange: (value: RefreshIntervalMs) => void;
  bearerToken: string;
  onBearerTokenChange: (value: string) => void;
}

export default function RepositoryViewSettingsPopup({
  open,
  onClose,
  refreshIntervalMs,
  onRefreshIntervalChange,
  bearerToken,
  onBearerTokenChange,
}: RepositoryViewSettingsPopupProps) {
  const [showToken, setShowToken] = useState(false);
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
      className="repo-view-settings-dialog"
      onClick={handleBackdropClick}
    >
      <div className="repo-view-settings">
        <div className="repo-view-settings__header">
          <h2>⚙️ Settings</h2>
          <button
            type="button"
            className="repo-view-settings__close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="repo-view-settings__content">
          <div className="repo-view-settings__field">
            <span className="repo-view-settings__field-label">
              Auto-refresh interval
            </span>
            <div className="repo-view-settings__options">
              {REFRESH_INTERVAL_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={
                    "repo-view-settings__option" +
                    (refreshIntervalMs === option.value
                      ? " repo-view-settings__option--active"
                      : "")
                  }
                  onClick={() => onRefreshIntervalChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="repo-view-settings__field">
            <div className="repo-view-settings__token-label-row">
              <span className="repo-view-settings__field-label">
                Bearer token
              </span>
              <button
                type="button"
                className="repo-view-settings__token-toggle"
                onClick={() => setShowToken((prev) => !prev)}
              >
                {showToken ? "Hide" : "Show"}
              </button>
            </div>
            <input
              id="repo-view-settings-token"
              className="repo-view-settings__token-input"
              type={showToken ? "text" : "password"}
              value={bearerToken}
              onChange={(e) => onBearerTokenChange(e.target.value)}
              placeholder="Authorization token"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </div>
      </div>
    </dialog>
  );
}
