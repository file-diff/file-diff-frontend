import type { RepositoryBranch } from "./repositorySelection";

const BRANCHES_STORAGE_PREFIX = "branches-page-branches-";
const LAST_REPO_STORAGE_KEY = "branches-page-last-repo";

interface CachedBranchesPayload {
  branches: RepositoryBranch[];
  fetchedAt?: string;
}

function repositoryKey(repo: string): string {
  return repo.trim().toLowerCase();
}

function parseCachedBranchesPayload(
  raw: string | null
): CachedBranchesPayload | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    return {
      branches: Array.isArray(candidate.branches)
        ? (candidate.branches as RepositoryBranch[])
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

export function loadCachedBranches(repo: string): RepositoryBranch[] {
  try {
    const payload = parseCachedBranchesPayload(
      localStorage.getItem(BRANCHES_STORAGE_PREFIX + repositoryKey(repo))
    );
    return payload?.branches ?? [];
  } catch {
    return [];
  }
}

export function loadCachedBranchesFetchedAt(repo: string): string {
  try {
    const payload = parseCachedBranchesPayload(
      localStorage.getItem(BRANCHES_STORAGE_PREFIX + repositoryKey(repo))
    );
    return payload?.fetchedAt ?? "";
  } catch {
    return "";
  }
}

export function saveCachedBranches(
  repo: string,
  branches: RepositoryBranch[]
): void {
  try {
    localStorage.setItem(
      BRANCHES_STORAGE_PREFIX + repositoryKey(repo),
      JSON.stringify({
        branches,
        fetchedAt: new Date().toISOString(),
      } satisfies CachedBranchesPayload)
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
