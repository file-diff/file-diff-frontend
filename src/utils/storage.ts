import { CREATE_TASK_DRAFT_STORAGE_KEY } from "./createTaskStorage";

const LAST_PARAMS_STORAGE_KEY = "last-selected-params";
const INDEXING_HISTORY_STORAGE_KEY = "indexing-parameter-history";
const FONT_PREFERENCE_STORAGE_KEY = "code-font-preference";
const TREE_COMPARE2_FILES_CACHE = "tree-compare2-files-v1";
const TREE_COMPARE2_SHOW_UNCHANGED_STORAGE_KEY =
  "tree-compare2-show-unchanged";
const FILE_COMPARE_SHOW_ONLY_CHANGED_STORAGE_KEY =
  "file-compare-show-only-changed";
const TREE_COMPARE2_FILE_NAME_FILTER_ENABLED_STORAGE_KEY =
  "tree-compare2-file-name-filter-enabled";
const TREE_COMPARE2_FILE_NAME_FILTER_VALUE_STORAGE_KEY =
  "tree-compare2-file-name-filter-value";
const TREE_COMPARE2_SCROLL_PATH_STORAGE_KEY =
  "tree-compare2-scroll-path";

export interface LastSelectedParams {
  leftRepo: string;
  rightRepo: string;
  leftRef: string;
  rightRef: string;
  leftRoot: string;
  rightRoot: string;
  useDifferentRoots: boolean;
  useNaturalSort: boolean;
}

export type CompareSide = "left" | "right";

export interface StoredIndexingSideParams {
  endpoint: string;
  inputRefName: string;
  jobId: string;
  provider: string;
  repo: string;
  resolvedCommit: string;
  root: string;
  status: string;
}

export interface IndexingHistoryEntry {
  id: string;
  left: StoredIndexingSideParams;
  permalink?: string;
  right: StoredIndexingSideParams;
  startedSide: CompareSide;
  storedAt: string;
  useDifferentRoots: boolean;
  useNaturalSort: boolean;
}

interface ComparePermalinkOptions {
  useDifferentRoots?: boolean;
  useNaturalSort?: boolean;
}

type ComparePermalinkSide = Pick<
  StoredIndexingSideParams,
  "inputRefName" | "repo" | "resolvedCommit" | "root"
>;

function isCompareSide(value: unknown): value is CompareSide {
  return value === "left" || value === "right";
}

function isStoredIndexingSideParams(
  value: unknown
): value is StoredIndexingSideParams {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.endpoint === "string" &&
    typeof candidate.inputRefName === "string" &&
    typeof candidate.jobId === "string" &&
    typeof candidate.provider === "string" &&
    typeof candidate.repo === "string" &&
    typeof candidate.resolvedCommit === "string" &&
    typeof candidate.root === "string" &&
    typeof candidate.status === "string"
  );
}

function setCompareQueryParam(
  params: URLSearchParams,
  key: string,
  value: string,
  defaultValue = ""
): void {
  const normalizedValue = value.trim();

  if (!normalizedValue || normalizedValue === defaultValue) {
    params.delete(key);
    return;
  }

  params.set(key, normalizedValue);
}

function setCompareBooleanQueryParam(
  params: URLSearchParams,
  key: string,
  value: boolean
): void {
  if (!value) {
    params.delete(key);
    return;
  }

  params.set(key, "1");
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function hasCustomCompareRoot(root: string): boolean {
  const normalizedRoot = root.trim();
  return normalizedRoot !== "/" && normalizedRoot !== "";
}

function normalizeUseDifferentRoots(
  leftRoot: string,
  rightRoot: string,
  value: unknown
): boolean {
  return isBoolean(value)
    ? value
    : hasCustomCompareRoot(leftRoot) || hasCustomCompareRoot(rightRoot);
}

function applyComparePermalinkParams(
  params: URLSearchParams,
  left: ComparePermalinkSide,
  right: ComparePermalinkSide,
  options: ComparePermalinkOptions
): void {
  setCompareQueryParam(params, "leftRepo", left.repo);
  setCompareQueryParam(params, "rightRepo", right.repo);
  setCompareQueryParam(params, "leftRef", left.inputRefName);
  setCompareQueryParam(params, "rightRef", right.inputRefName);
  setCompareQueryParam(params, "leftCommit", left.resolvedCommit);
  setCompareQueryParam(params, "rightCommit", right.resolvedCommit);
  if (options.useDifferentRoots) {
    setCompareQueryParam(params, "leftRoot", left.root, "/");
    setCompareQueryParam(params, "rightRoot", right.root, "/");
  } else {
    params.delete("leftRoot");
    params.delete("rightRoot");
  }
  setCompareBooleanQueryParam(
    params,
    "useDifferentRoots",
    options.useDifferentRoots ?? false
  );
  setCompareBooleanQueryParam(
    params,
    "useNaturalSort",
    options.useNaturalSort ?? false
  );
}

export function buildComparePermalink(
  left: ComparePermalinkSide,
  right: ComparePermalinkSide,
  options: ComparePermalinkOptions = {}
): string {
  const params = new URLSearchParams();
  applyComparePermalinkParams(params, left, right, options);

  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export function buildTreeComparisonLink(
  left: ComparePermalinkSide,
  right: ComparePermalinkSide,
): string {
  const params = new URLSearchParams();
  const leftRepo = left.repo.trim();
  const rightRepo = right.repo.trim();

  if (leftRepo && leftRepo === rightRepo) {
    params.set("b", leftRepo);
  } else {
    if (leftRepo) {
      params.set("lr", leftRepo);
    }
    if (rightRepo) {
      params.set("rr", rightRepo);
    }
  }

  const leftCommit =
    (left.resolvedCommit ?? "").trim() || (left.inputRefName ?? "").trim();
  const rightCommit =
    (right.resolvedCommit ?? "").trim() || (right.inputRefName ?? "").trim();

  if (leftCommit) {
    params.set("lc", leftCommit);
  }
  if (rightCommit) {
    params.set("rc", rightCommit);
  }

  return params.toString();
}

export function buildHistoryEntryPermalink(
  entry: IndexingHistoryEntry
): string {
  const options = {
    useDifferentRoots: entry.useDifferentRoots,
    useNaturalSort: entry.useNaturalSort,
  };
  const existingPermalink = entry.permalink?.trim();

  if (!existingPermalink) {
    return buildComparePermalink(entry.left, entry.right, options);
  }

  try {
    const existingUrl = new URL(existingPermalink, "https://filediff.local");
    const params = new URLSearchParams(existingUrl.search);
    applyComparePermalinkParams(params, entry.left, entry.right, options);
    const query = params.toString();
    return query ? `/?${query}` : "/";
  } catch {
    return buildComparePermalink(entry.left, entry.right, options);
  }
}

function normalizeLastSelectedParams(value: unknown): LastSelectedParams | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.leftRepo !== "string" ||
    typeof candidate.rightRepo !== "string" ||
    typeof candidate.leftRef !== "string" ||
    typeof candidate.rightRef !== "string" ||
    typeof candidate.leftRoot !== "string" ||
    typeof candidate.rightRoot !== "string" ||
    !isBoolean(candidate.useNaturalSort)
  ) {
    return null;
  }

  return {
    leftRepo: candidate.leftRepo,
    rightRepo: candidate.rightRepo,
    leftRef: candidate.leftRef,
    rightRef: candidate.rightRef,
    leftRoot: candidate.leftRoot,
    rightRoot: candidate.rightRoot,
    useDifferentRoots: normalizeUseDifferentRoots(
      candidate.leftRoot,
      candidate.rightRoot,
      candidate.useDifferentRoots
    ),
    useNaturalSort: candidate.useNaturalSort,
  };
}

function normalizeIndexingHistoryEntry(value: unknown): IndexingHistoryEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    !isStoredIndexingSideParams(candidate.left) ||
    !isStoredIndexingSideParams(candidate.right) ||
    (typeof candidate.permalink !== "undefined" &&
      typeof candidate.permalink !== "string") ||
    !isCompareSide(candidate.startedSide) ||
    typeof candidate.storedAt !== "string" ||
    !isBoolean(candidate.useNaturalSort)
  ) {
    return null;
  }

  return {
    id: candidate.id,
    left: candidate.left,
    permalink: candidate.permalink,
    right: candidate.right,
    startedSide: candidate.startedSide,
    storedAt: candidate.storedAt,
    useDifferentRoots: normalizeUseDifferentRoots(
      candidate.left.root,
      candidate.right.root,
      candidate.useDifferentRoots
    ),
    useNaturalSort: candidate.useNaturalSort,
  };
}

export function readLastSelectedParams(): LastSelectedParams | null {
  try {
    const raw = window.localStorage.getItem(LAST_PARAMS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    return normalizeLastSelectedParams(parsed);
  } catch {
    return null;
  }
}

export function writeLastSelectedParams(params: LastSelectedParams): void {
  try {
    window.localStorage.setItem(
      LAST_PARAMS_STORAGE_KEY,
      JSON.stringify(params)
    );
  } catch {
    return;
  }
}

export function readIndexingHistory(): IndexingHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(INDEXING_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .map((entry) => normalizeIndexingHistoryEntry(entry))
          .filter((entry): entry is IndexingHistoryEntry => entry !== null)
      : [];
  } catch {
    return [];
  }
}

export function writeIndexingHistory(history: IndexingHistoryEntry[]): void {
  try {
    window.localStorage.setItem(
      INDEXING_HISTORY_STORAGE_KEY,
      JSON.stringify(history)
    );
  } catch {
    return;
  }
}

export function clearIndexingHistory(): void {
  try {
    window.localStorage.removeItem(INDEXING_HISTORY_STORAGE_KEY);
  } catch {
    return;
  }
}

export async function clearAllStoredData(): Promise<void> {
  try {
    window.localStorage.removeItem(LAST_PARAMS_STORAGE_KEY);
    window.localStorage.removeItem(INDEXING_HISTORY_STORAGE_KEY);
    window.localStorage.removeItem(FONT_PREFERENCE_STORAGE_KEY);
    window.localStorage.removeItem(TREE_COMPARE2_SHOW_UNCHANGED_STORAGE_KEY);
    window.localStorage.removeItem(FILE_COMPARE_SHOW_ONLY_CHANGED_STORAGE_KEY);
    window.localStorage.removeItem(
      TREE_COMPARE2_FILE_NAME_FILTER_ENABLED_STORAGE_KEY
    );
    window.localStorage.removeItem(TREE_COMPARE2_FILE_NAME_FILTER_VALUE_STORAGE_KEY);
    window.localStorage.removeItem(TREE_COMPARE2_SCROLL_PATH_STORAGE_KEY);
    window.localStorage.removeItem(CREATE_TASK_DRAFT_STORAGE_KEY);
  } catch {
    return;
  }

  if (!window.caches) {
    return;
  }

  try {
    await window.caches.delete(TREE_COMPARE2_FILES_CACHE);
  } catch {
    return;
  }
}

export function readFontPreference(): string | null {
  try {
    return window.localStorage.getItem(FONT_PREFERENCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeFontPreference(fontId: string): void {
  try {
    window.localStorage.setItem(FONT_PREFERENCE_STORAGE_KEY, fontId);
  } catch {
    return;
  }
}

export function readTreeCompare2ShowUnchanged(): boolean | null {
  try {
    const raw = window.localStorage.getItem(
      TREE_COMPARE2_SHOW_UNCHANGED_STORAGE_KEY
    );

    if (raw === "true") {
      return true;
    }
    if (raw === "false") {
      return false;
    }

    return null;
  } catch {
    return null;
  }
}

export function writeTreeCompare2ShowUnchanged(value: boolean): void {
  try {
    window.localStorage.setItem(
      TREE_COMPARE2_SHOW_UNCHANGED_STORAGE_KEY,
      String(value)
    );
  } catch {
    return;
  }
}

export function readFileCompareShowOnlyChanged(): boolean | null {
  try {
    const raw = window.localStorage.getItem(
      FILE_COMPARE_SHOW_ONLY_CHANGED_STORAGE_KEY
    );

    if (raw === "true") {
      return true;
    }
    if (raw === "false") {
      return false;
    }

    return null;
  } catch {
    return null;
  }
}

export function writeFileCompareShowOnlyChanged(value: boolean): void {
  try {
    window.localStorage.setItem(
      FILE_COMPARE_SHOW_ONLY_CHANGED_STORAGE_KEY,
      String(value)
    );
  } catch {
    return;
  }
}

export function readTreeCompare2FileNameFilterEnabled(): boolean | null {
  try {
    const raw = window.localStorage.getItem(
      TREE_COMPARE2_FILE_NAME_FILTER_ENABLED_STORAGE_KEY
    );

    if (raw === "true") {
      return true;
    }
    if (raw === "false") {
      return false;
    }

    return null;
  } catch {
    return null;
  }
}

export function writeTreeCompare2FileNameFilterEnabled(value: boolean): void {
  try {
    window.localStorage.setItem(
      TREE_COMPARE2_FILE_NAME_FILTER_ENABLED_STORAGE_KEY,
      String(value)
    );
  } catch {
    return;
  }
}

export function readTreeCompare2FileNameFilterValue(): string | null {
  try {
    return window.localStorage.getItem(
      TREE_COMPARE2_FILE_NAME_FILTER_VALUE_STORAGE_KEY
    );
  } catch {
    return null;
  }
}

export function writeTreeCompare2FileNameFilterValue(value: string): void {
  try {
    window.localStorage.setItem(
      TREE_COMPARE2_FILE_NAME_FILTER_VALUE_STORAGE_KEY,
      value
    );
  } catch {
    return;
  }
}

export function readTreeCompare2ScrollPath(): string | null {
  try {
    return window.localStorage.getItem(TREE_COMPARE2_SCROLL_PATH_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeTreeCompare2ScrollPath(value: string): void {
  try {
    window.localStorage.setItem(
      TREE_COMPARE2_SCROLL_PATH_STORAGE_KEY,
      value
    );
  } catch {
    return;
  }
}
