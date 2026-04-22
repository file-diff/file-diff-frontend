import type { RepositoryTag } from "./repositorySelection";

const TAGS_STORAGE_PREFIX = "tags-page-tags-";
const LAST_REPO_STORAGE_KEY = "tags-page-last-repo";
const TAG_LIMIT_STORAGE_KEY = "tags-page-tag-limit";
const AUTO_REFRESH_ENABLED_STORAGE_KEY = "tags-page-auto-refresh-enabled";

interface CachedTagsPayload {
  tags: RepositoryTag[];
  fetchedAt?: string;
}

function repositoryKey(repo: string): string {
  return repo.trim().toLowerCase();
}

function parseCachedTagsPayload(raw: string | null): CachedTagsPayload | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    return {
      tags: Array.isArray(candidate.tags)
        ? (candidate.tags as RepositoryTag[])
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

export function loadCachedTags(repo: string): RepositoryTag[] {
  try {
    const payload = parseCachedTagsPayload(
      localStorage.getItem(TAGS_STORAGE_PREFIX + repositoryKey(repo))
    );
    return payload?.tags ?? [];
  } catch {
    return [];
  }
}

export function loadCachedTagsFetchedAt(repo: string): string {
  try {
    const payload = parseCachedTagsPayload(
      localStorage.getItem(TAGS_STORAGE_PREFIX + repositoryKey(repo))
    );
    return payload?.fetchedAt ?? "";
  } catch {
    return "";
  }
}

export function saveCachedTags(repo: string, tags: RepositoryTag[]): void {
  try {
    localStorage.setItem(
      TAGS_STORAGE_PREFIX + repositoryKey(repo),
      JSON.stringify({
        tags,
        fetchedAt: new Date().toISOString(),
      } satisfies CachedTagsPayload)
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

export function loadTagLimit(defaultLimit: number): number {
  try {
    const raw = localStorage.getItem(TAG_LIMIT_STORAGE_KEY);
    if (!raw) return defaultLimit;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultLimit;
  } catch {
    return defaultLimit;
  }
}

export function saveTagLimit(limit: number): void {
  try {
    localStorage.setItem(TAG_LIMIT_STORAGE_KEY, String(limit));
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
