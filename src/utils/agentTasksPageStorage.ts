import type { TaskSummary } from "./agentTasks";

const TASKS_STORAGE_PREFIX = "agent-tasks-page-tasks-";
const LAST_REPO_STORAGE_KEY = "agent-tasks-page-last-repo";
const AUTO_REFRESH_ENABLED_STORAGE_KEY = "agent-tasks-page-auto-refresh-enabled";

interface CachedTasksPayload {
  tasks: TaskSummary[];
  fetchedAt?: string;
}

function repositoryKey(repo: string): string {
  return repo.trim().toLowerCase();
}

function parseCachedTasksPayload(raw: string | null): CachedTasksPayload | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    return {
      tasks: Array.isArray(candidate.tasks)
        ? (candidate.tasks as TaskSummary[])
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

export function hasCachedTasks(repo: string): boolean {
  try {
    return (
      parseCachedTasksPayload(
        localStorage.getItem(TASKS_STORAGE_PREFIX + repositoryKey(repo))
      ) !== null
    );
  } catch {
    return false;
  }
}

export function loadCachedTasks(repo: string): TaskSummary[] {
  try {
    const payload = parseCachedTasksPayload(
      localStorage.getItem(TASKS_STORAGE_PREFIX + repositoryKey(repo))
    );
    return payload?.tasks ?? [];
  } catch {
    return [];
  }
}

export function loadCachedTasksFetchedAt(repo: string): string {
  try {
    const payload = parseCachedTasksPayload(
      localStorage.getItem(TASKS_STORAGE_PREFIX + repositoryKey(repo))
    );
    return payload?.fetchedAt ?? "";
  } catch {
    return "";
  }
}

export function saveCachedTasks(repo: string, tasks: TaskSummary[]): void {
  try {
    localStorage.setItem(
      TASKS_STORAGE_PREFIX + repositoryKey(repo),
      JSON.stringify({
        tasks,
        fetchedAt: new Date().toISOString(),
      } satisfies CachedTasksPayload)
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
