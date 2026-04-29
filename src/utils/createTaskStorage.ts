import {
  CREATE_TASK_RUNNER_VALUES,
  type CreateTaskRunner,
} from "./repositorySelection";

export const CREATE_TASK_DRAFT_STORAGE_KEY = "create-task-draft";
export const REPO_CREATE_TASK_DRAFTS_STORAGE_KEY = "repo-create-task-drafts";

const DEFAULT_CREATE_TASK_RUNNER: CreateTaskRunner = "codex";

export interface CreateTaskDraft {
  repoInput: string;
  problemStatement: string;
  model: string;
  task: CreateTaskRunner;
  baseRef: string;
  taskDelayEnabled: boolean;
  taskDelayMinutes: string;
  githubKey: string;
}

export type RepoCreateTaskDraft = Omit<CreateTaskDraft, "repoInput">;

function isCreateTaskRunner(value: unknown): value is CreateTaskRunner {
  return (
    typeof value === "string" &&
    CREATE_TASK_RUNNER_VALUES.includes(value as CreateTaskRunner)
  );
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function normalizeRepoKey(repo: string): string {
  return repo.trim().toLowerCase();
}

function parseRepoCreateTaskDraft(value: unknown): RepoCreateTaskDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.problemStatement !== "string" ||
    typeof candidate.model !== "string" ||
    typeof candidate.baseRef !== "string"
  ) {
    return null;
  }

  return {
    problemStatement: candidate.problemStatement,
    model: candidate.model,
    task: isCreateTaskRunner(candidate.task)
      ? candidate.task
      : DEFAULT_CREATE_TASK_RUNNER,
    baseRef: candidate.baseRef,
    taskDelayEnabled: isBoolean(candidate.taskDelayEnabled)
      ? candidate.taskDelayEnabled
      : false,
    taskDelayMinutes:
      typeof candidate.taskDelayMinutes === "string"
        ? candidate.taskDelayMinutes
        : "",
    githubKey:
      typeof candidate.githubKey === "string" ? candidate.githubKey : "",
  };
}

function readRepoDraftMap(): Record<string, RepoCreateTaskDraft> {
  try {
    const raw = localStorage.getItem(REPO_CREATE_TASK_DRAFTS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, RepoCreateTaskDraft> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const draft = parseRepoCreateTaskDraft(value);
      if (draft) {
        result[key] = draft;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeRepoDraftMap(map: Record<string, RepoCreateTaskDraft>): void {
  try {
    localStorage.setItem(
      REPO_CREATE_TASK_DRAFTS_STORAGE_KEY,
      JSON.stringify(map)
    );
  } catch {
    // Ignore storage failures.
  }
}

export function loadCreateTaskDraft(): CreateTaskDraft | null {
  try {
    const raw = localStorage.getItem(CREATE_TASK_DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.repoInput !== "string") {
      return null;
    }

    const repoDraft = parseRepoCreateTaskDraft(candidate);
    if (!repoDraft) {
      return null;
    }

    return {
      repoInput: candidate.repoInput,
      ...repoDraft,
    };
  } catch {
    return null;
  }
}

export function saveCreateTaskDraft(draft: CreateTaskDraft): void {
  try {
    localStorage.setItem(CREATE_TASK_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Ignore storage failures.
  }
}

export function clearCreateTaskDraft(): void {
  try {
    localStorage.removeItem(CREATE_TASK_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function loadRepoCreateTaskDraft(repo: string): RepoCreateTaskDraft | null {
  const key = normalizeRepoKey(repo);
  if (!key) {
    return null;
  }

  const map = readRepoDraftMap();
  return map[key] ?? null;
}

export function saveRepoCreateTaskDraft(
  repo: string,
  draft: RepoCreateTaskDraft
): void {
  const key = normalizeRepoKey(repo);
  if (!key) {
    return;
  }

  const map = readRepoDraftMap();
  map[key] = draft;
  writeRepoDraftMap(map);
}

export function removeRepoCreateTaskDraft(repo: string): void {
  const key = normalizeRepoKey(repo);
  if (!key) {
    return;
  }

  const map = readRepoDraftMap();
  if (!(key in map)) {
    return;
  }

  delete map[key];
  writeRepoDraftMap(map);
}
