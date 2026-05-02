import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Fuse from "fuse.js";
import type { RepositoryBranch } from "../utils/repositorySelection";
import "./BranchAutocomplete.css";

export interface BranchAutocompleteProps {
  inputId: string;
  value: string;
  onChange: (value: string) => void;
  branches: RepositoryBranch[];
  placeholder?: string;
  disabled?: boolean;
  maxSuggestions?: number;
}

const DEFAULT_MAX_SUGGESTIONS = 8;

function buildInitialSuggestions(
  branches: RepositoryBranch[],
  limit: number
): RepositoryBranch[] {
  if (branches.length === 0) return [];
  const seen = new Set<string>();
  const result: RepositoryBranch[] = [];
  const defaultBranch = branches.find((b) => b.isDefault);
  if (defaultBranch) {
    result.push(defaultBranch);
    seen.add(defaultBranch.name);
  }
  for (const branch of branches) {
    if (result.length >= limit) break;
    if (seen.has(branch.name)) continue;
    result.push(branch);
    seen.add(branch.name);
  }
  return result;
}

export default function BranchAutocomplete({
  inputId,
  value,
  onChange,
  branches,
  placeholder = "main",
  disabled = false,
  maxSuggestions = DEFAULT_MAX_SUGGESTIONS,
}: BranchAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const fuse = useMemo(() => {
    if (branches.length === 0) return null;
    return new Fuse(branches, {
      keys: [{ name: "name", weight: 1 }],
      threshold: 0.4,
      ignoreLocation: true,
    });
  }, [branches]);

  const suggestions = useMemo(() => {
    if (branches.length === 0) return [];
    const trimmed = value.trim();
    if (!trimmed) {
      return buildInitialSuggestions(branches, maxSuggestions);
    }
    if (!fuse) return [];
    return fuse
      .search(trimmed, { limit: maxSuggestions })
      .map((result) => result.item);
  }, [branches, fuse, maxSuggestions, value]);

  const safeHighlightedIndex =
    suggestions.length > 0
      ? Math.min(Math.max(highlightedIndex, 0), suggestions.length - 1)
      : 0;

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target as Node)) return;
      setIsOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isOpen]);

  const handleSelect = useCallback(
    (branch: RepositoryBranch) => {
      onChange(branch.name);
      setIsOpen(false);
    },
    [onChange]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex(
        (prev) => (prev - 1 + suggestions.length) % suggestions.length
      );
      return;
    }
    if (event.key === "Enter") {
      if (!isOpen || suggestions.length === 0) return;
      const choice = suggestions[safeHighlightedIndex] ?? suggestions[0];
      if (choice) {
        event.preventDefault();
        handleSelect(choice);
      }
      return;
    }
    if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
      }
    }
  };

  const showList = isOpen && suggestions.length > 0;
  const activeId = showList
    ? `${listboxId}-option-${safeHighlightedIndex}`
    : undefined;

  return (
    <div className="branch-autocomplete" ref={containerRef}>
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
          setHighlightedIndex(0);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        role="combobox"
        aria-expanded={showList}
        aria-controls={showList ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
      />
      {showList && (
        <ul
          id={listboxId}
          className="branch-autocomplete__list"
          role="listbox"
        >
          {suggestions.map((branch, index) => {
            const isActive = index === safeHighlightedIndex;
            return (
              <li
                key={branch.ref || branch.name}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={isActive}
                className={
                  "branch-autocomplete__item" +
                  (isActive ? " branch-autocomplete__item--active" : "")
                }
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleSelect(branch);
                }}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <span className="branch-autocomplete__name">{branch.name}</span>
                <span className="branch-autocomplete__meta">
                  {branch.isDefault && (
                    <span className="branch-autocomplete__tag">default</span>
                  )}
                  {branch.commitShort && (
                    <code className="branch-autocomplete__commit">
                      {branch.commitShort}
                    </code>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
