import type { RepositoryActionRun } from "./repositorySelection";

const ACTIONS_STORAGE_PREFIX = "actions-page-runs-";
const LAST_REPO_STORAGE_KEY = "actions-page-last-repo";
const ACTION_LIMIT_STORAGE_KEY = "actions-page-action-limit";
const AUTO_REFRESH_ENABLED_STORAGE_KEY = "actions-page-auto-refresh-enabled";

interface CachedActionsPayload {
  runs: RepositoryActionRun[];
  fetchedAt?: string;
}

function repositoryKey(repo: string): string {
  return repo.trim().toLowerCase();
}

function parseCachedActionsPayload(
  raw: string | null
): CachedActionsPayload | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    return {
      runs: Array.isArray(candidate.runs)
        ? (candidate.runs as RepositoryActionRun[])
        : [],
      fetchedAt:
        typeof candidate.fetchedAt === "string"
          ? candidate.fetchedAt
          : undefined,
    };
  } catch {
    return null;
  }
}

export function loadCachedActions(repo: string): RepositoryActionRun[] {
  try {
    const payload = parseCachedActionsPayload(
      localStorage.getItem(ACTIONS_STORAGE_PREFIX + repositoryKey(repo))
    );
    return payload?.runs ?? [];
  } catch {
    return [];
  }
}

export function loadCachedActionsFetchedAt(repo: string): string {
  try {
    const payload = parseCachedActionsPayload(
      localStorage.getItem(ACTIONS_STORAGE_PREFIX + repositoryKey(repo))
    );
    return payload?.fetchedAt ?? "";
  } catch {
    return "";
  }
}

export function saveCachedActions(
  repo: string,
  runs: RepositoryActionRun[]
): void {
  try {
    localStorage.setItem(
      ACTIONS_STORAGE_PREFIX + repositoryKey(repo),
      JSON.stringify({
        runs,
        fetchedAt: new Date().toISOString(),
      } satisfies CachedActionsPayload)
    );
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

export function loadLastRepo(): string {
  try {
    return localStorage.getItem(LAST_REPO_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveLastRepo(repo: string): void {
  try {
    localStorage.setItem(LAST_REPO_STORAGE_KEY, repo);
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

export function loadActionLimit(defaultLimit: number): number {
  try {
    const raw = localStorage.getItem(ACTION_LIMIT_STORAGE_KEY);
    if (!raw) return defaultLimit;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultLimit;
  } catch {
    return defaultLimit;
  }
}

export function saveActionLimit(limit: number): void {
  try {
    localStorage.setItem(ACTION_LIMIT_STORAGE_KEY, String(limit));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

export function loadAutoRefreshEnabled(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_REFRESH_ENABLED_STORAGE_KEY);
    if (raw === "false") {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

export function saveAutoRefreshEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_REFRESH_ENABLED_STORAGE_KEY, String(enabled));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}
