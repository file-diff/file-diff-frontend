import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./CommitActionsMenu.css";

export interface CommitActionsMenuProps {
  commit: string;
  grepUrl: string;
  isLeft: boolean;
  isRight: boolean;
  onSelectLeft: () => void;
  onSelectRight: () => void;
  onRevert: () => void;
  onCreateTag: () => void;
}

export default function CommitActionsMenu({
  commit,
  grepUrl,
  isLeft,
  isRight,
  onSelectLeft,
  onSelectRight,
  onRevert,
  onCreateTag,
}: CommitActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const shortSha = commit.slice(0, 7);

  const close = () => setOpen(false);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      const node = containerRef.current;
      if (node && !node.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div className="commit-actions-menu" ref={containerRef}>
      <button
        type="button"
        className="commit-actions-menu__toggle"
        aria-label={`Actions for commit ${shortSha}`}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`Actions for ${shortSha}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        ☰
      </button>
      {open && (
        <div className="commit-actions-menu__popup" role="menu">
          <Link
            to={grepUrl}
            className="commit-actions-menu__item"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              close();
            }}
          >
            Grep
          </Link>
          <button
            type="button"
            className={
              "commit-actions-menu__item commit-actions-menu__item--button" +
              (isLeft ? " commit-actions-menu__item--active-left" : "")
            }
            role="menuitemcheckbox"
            aria-checked={isLeft}
            onClick={(e) => {
              e.stopPropagation();
              onSelectLeft();
              close();
            }}
          >
            {isLeft ? "✓ Selected as Left" : "Select as Left"}
          </button>
          <button
            type="button"
            className={
              "commit-actions-menu__item commit-actions-menu__item--button" +
              (isRight ? " commit-actions-menu__item--active-right" : "")
            }
            role="menuitemcheckbox"
            aria-checked={isRight}
            onClick={(e) => {
              e.stopPropagation();
              onSelectRight();
              close();
            }}
          >
            {isRight ? "✓ Selected as Right" : "Select as Right"}
          </button>
          <div className="commit-actions-menu__separator" role="separator" />
          <button
            type="button"
            className="commit-actions-menu__item commit-actions-menu__item--button commit-actions-menu__item--danger"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              onRevert();
              close();
            }}
          >
            Revert to This Commit
          </button>
          <button
            type="button"
            className="commit-actions-menu__item commit-actions-menu__item--button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              onCreateTag();
              close();
            }}
          >
            Create Tag
          </button>
        </div>
      )}
    </div>
  );
}
