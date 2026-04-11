import type { RepositoryCommit } from "./repositorySelection";

const COMMITS_STORAGE_PREFIX = "commit-view-commits-";
const LAST_REPO_STORAGE_KEY = "commit-view-last-repo";
const COMMIT_LIMIT_STORAGE_KEY = "commit-view-commit-limit";
const AUTO_REFRESH_ENABLED_STORAGE_KEY = "commit-view-auto-refresh-enabled";

interface CachedCommitsPayload {
  commits: RepositoryCommit[];
  fetchedAt?: string;
}

function repositoryKey(repo: string): string {
  return repo.trim().toLowerCase();
}

function parseCachedCommitsPayload(
  raw: string | null
): CachedCommitsPayload | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    return {
      commits: Array.isArray(candidate.commits)
        ? (candidate.commits as RepositoryCommit[])
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

export function loadCachedCommits(repo: string): RepositoryCommit[] {
  try {
    const payload = parseCachedCommitsPayload(
      localStorage.getItem(COMMITS_STORAGE_PREFIX + repositoryKey(repo))
    );
    return payload?.commits ?? [];
  } catch {
    return [];
  }
}

export function loadCachedCommitsFetchedAt(repo: string): string {
  try {
    const payload = parseCachedCommitsPayload(
      localStorage.getItem(COMMITS_STORAGE_PREFIX + repositoryKey(repo))
    );
    return payload?.fetchedAt ?? "";
  } catch {
    return "";
  }
}

export function saveCachedCommits(
  repo: string,
  commits: RepositoryCommit[]
): void {
  try {
    localStorage.setItem(
      COMMITS_STORAGE_PREFIX + repositoryKey(repo),
      JSON.stringify({
        commits,
        fetchedAt: new Date().toISOString(),
      } satisfies CachedCommitsPayload)
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

export function loadCommitLimit(defaultLimit: number): number {
  try {
    const raw = localStorage.getItem(COMMIT_LIMIT_STORAGE_KEY);
    if (!raw) return defaultLimit;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultLimit;
  } catch {
    return defaultLimit;
  }
}

export function saveCommitLimit(limit: number): void {
  try {
    localStorage.setItem(COMMIT_LIMIT_STORAGE_KEY, String(limit));
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
