const LAST_PARAMS_STORAGE_KEY = "last-selected-params";
const INDEXING_HISTORY_STORAGE_KEY = "indexing-parameter-history";
const FONT_PREFERENCE_STORAGE_KEY = "code-font-preference";

export interface LastSelectedParams {
  leftRepo: string;
  rightRepo: string;
  leftRef: string;
  rightRef: string;
  leftRoot: string;
  rightRoot: string;
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
  useNaturalSort: boolean;
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

function isIndexingHistoryEntry(value: unknown): value is IndexingHistoryEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    isStoredIndexingSideParams(candidate.left) &&
    isStoredIndexingSideParams(candidate.right) &&
    (typeof candidate.permalink === "undefined" ||
      typeof candidate.permalink === "string") &&
    isCompareSide(candidate.startedSide) &&
    typeof candidate.storedAt === "string" &&
    typeof candidate.useNaturalSort === "boolean"
  );
}

function setCompareQueryParam(
  params: URLSearchParams,
  key: string,
  value: string
): void {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    params.delete(key);
    return;
  }

  params.set(key, normalizedValue);
}

export function buildComparePermalink(
  left: ComparePermalinkSide,
  right: ComparePermalinkSide
): string {
  const params = new URLSearchParams();

  setCompareQueryParam(params, "leftRepo", left.repo);
  setCompareQueryParam(params, "rightRepo", right.repo);
  setCompareQueryParam(params, "leftRef", left.inputRefName);
  setCompareQueryParam(params, "rightRef", right.inputRefName);
  setCompareQueryParam(params, "leftCommit", left.resolvedCommit);
  setCompareQueryParam(params, "rightCommit", right.resolvedCommit);
  setCompareQueryParam(params, "leftRoot", left.root);
  setCompareQueryParam(params, "rightRoot", right.root);

  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export function buildHistoryEntryPermalink(
  entry: IndexingHistoryEntry
): string {
  return entry.permalink?.trim() || buildComparePermalink(entry.left, entry.right);
}

function isLastSelectedParams(value: unknown): value is LastSelectedParams {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.leftRepo === "string" &&
    typeof candidate.rightRepo === "string" &&
    typeof candidate.leftRef === "string" &&
    typeof candidate.rightRef === "string" &&
    typeof candidate.leftRoot === "string" &&
    typeof candidate.rightRoot === "string" &&
    typeof candidate.useNaturalSort === "boolean"
  );
}

export function readLastSelectedParams(): LastSelectedParams | null {
  try {
    const raw = window.localStorage.getItem(LAST_PARAMS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    return isLastSelectedParams(parsed) ? parsed : null;
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
      ? parsed.filter(isIndexingHistoryEntry)
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
