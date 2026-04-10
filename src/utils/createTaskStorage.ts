import {
  PULL_REQUEST_COMPLETION_MODE_VALUES,
  type PullRequestCompletionMode,
} from "./repositorySelection";

export const CREATE_TASK_DRAFT_STORAGE_KEY = "create-task-draft";

const DEFAULT_PULL_REQUEST_COMPLETION_MODE: PullRequestCompletionMode = "None";

export interface CreateTaskDraft {
  repoInput: string;
  eventContent: string;
  problemStatement: string;
  model: string;
  createPullRequest: boolean;
  pullRequestCompletionMode: PullRequestCompletionMode;
  baseRef: string;
  taskDelayEnabled: boolean;
  taskDelayMinutes: string;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isPullRequestCompletionMode(
  value: unknown
): value is PullRequestCompletionMode {
  return (
    typeof value === "string" &&
    PULL_REQUEST_COMPLETION_MODE_VALUES.includes(
      value as PullRequestCompletionMode
    )
  );
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
    if (
      typeof candidate.repoInput !== "string" ||
      typeof candidate.eventContent !== "string" ||
      typeof candidate.problemStatement !== "string" ||
      typeof candidate.model !== "string" ||
      !isBoolean(candidate.createPullRequest) ||
      typeof candidate.baseRef !== "string"
    ) {
      return null;
    }

    const pullRequestCompletionMode = isPullRequestCompletionMode(
      candidate.pullRequestCompletionMode
    )
      ? candidate.pullRequestCompletionMode
      : DEFAULT_PULL_REQUEST_COMPLETION_MODE;

    return {
      repoInput: candidate.repoInput,
      eventContent: candidate.eventContent,
      problemStatement: candidate.problemStatement,
      model: candidate.model,
      createPullRequest: candidate.createPullRequest,
      pullRequestCompletionMode,
      baseRef: candidate.baseRef,
      taskDelayEnabled: isBoolean(candidate.taskDelayEnabled)
        ? candidate.taskDelayEnabled
        : false,
      taskDelayMinutes:
        typeof candidate.taskDelayMinutes === "string"
          ? candidate.taskDelayMinutes
          : "",
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
