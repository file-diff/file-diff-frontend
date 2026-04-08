import type { ReactNode } from "react";
import "./RepositorySelector.css";

interface RepositorySelectorProps {
  inputId: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  buttonLabel: string;
  loadingButtonLabel?: string;
  isLoading?: boolean;
  disabled?: boolean;
  footer?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export default function RepositorySelector({
  inputId,
  value,
  onChange,
  onSubmit,
  buttonLabel,
  loadingButtonLabel = "Loading…",
  isLoading = false,
  disabled = false,
  footer,
  actions,
  className = "",
}: RepositorySelectorProps) {
  return (
    <div className={`repository-selector${className ? ` ${className}` : ""}`}>
      <label htmlFor={inputId}>Repository</label>
      <div className="repository-selector__input-row">
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onSubmit();
          }}
          placeholder="owner/repo or paste full GitHub URL"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={disabled}
        >
          {isLoading ? loadingButtonLabel : buttonLabel}
        </button>
        {actions}
      </div>
      {footer}
    </div>
  );
}
