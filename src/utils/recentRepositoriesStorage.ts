import { removeRepositoryColor } from "./repositoryColors";
import { removeRepoProblemStatement } from "./repoProblemStatementStorage";

const RECENT_REPOSITORIES_STORAGE_KEY = "recent-repositories";
const MAX_RECENT_REPOSITORIES = 10;

export { RECENT_REPOSITORIES_STORAGE_KEY };

export function readRecentRepositories(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_REPOSITORIES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item): item is string => typeof item === "string" && item.trim() !== ""
    );
  } catch {
    return [];
  }
}

export function addRecentRepository(repo: string): string[] {
  const trimmed = repo.trim();
  if (!trimmed) {
    return readRecentRepositories();
  }

  const current = readRecentRepositories();
  const filtered = current.filter(
    (r) => r.toLowerCase() !== trimmed.toLowerCase()
  );
  const updated = [trimmed, ...filtered].slice(0, MAX_RECENT_REPOSITORIES);

  try {
    localStorage.setItem(
      RECENT_REPOSITORIES_STORAGE_KEY,
      JSON.stringify(updated)
    );
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }

  return updated;
}

export function removeRecentRepository(repo: string): string[] {
  const trimmed = repo.trim();
  if (!trimmed) {
    return readRecentRepositories();
  }

  const current = readRecentRepositories();
  const updated = current.filter(
    (r) => r.toLowerCase() !== trimmed.toLowerCase()
  );

  try {
    localStorage.setItem(
      RECENT_REPOSITORIES_STORAGE_KEY,
      JSON.stringify(updated)
    );
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }

  removeRepositoryColor(trimmed);
  removeRepoProblemStatement(trimmed);

  return updated;
}
