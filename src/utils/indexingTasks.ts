import { INDEX_TASK_API_URL } from "../config/api";

export type IndexingTaskStatus =
  | "waiting"
  | "active"
  | "completed"
  | "failed"
  | "unknown";

export interface IndexingTaskSummary {
  id: string;
  repo: string;
  ref: string;
  status: IndexingTaskStatus;
  progress?: number;
  totalFiles?: number;
  processedFiles?: number;
  error?: string;
  commit: string;
  commitShort: string;
  createdAt: string;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(
  value: Record<string, unknown>,
  keys: string[]
): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

function pickNumber(
  value: Record<string, unknown>,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function normalizeIndexingTaskStatus(value: unknown): IndexingTaskStatus {
  if (typeof value !== "string") {
    return "unknown";
  }

  const lower = value.trim().toLowerCase();

  if (
    lower === "waiting" ||
    lower === "queued" ||
    lower === "pending" ||
    lower === "requested"
  ) {
    return "waiting";
  }

  if (
    lower === "active" ||
    lower === "running" ||
    lower === "in_progress" ||
    lower === "processing"
  ) {
    return "active";
  }

  if (lower === "completed" || lower === "complete" || lower === "done") {
    return "completed";
  }

  if (
    lower === "failed" ||
    lower === "error" ||
    lower === "errored" ||
    lower === "cancelled" ||
    lower === "canceled"
  ) {
    return "failed";
  }

  return "unknown";
}

function extractTasksPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return [];
  }

  const candidates = [
    value.tasks,
    value.items,
    value.data,
    value.indexingTasks,
    value.indexing_tasks,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

export function normalizeIndexingTaskSummary(
  value: unknown
): IndexingTaskSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = pickString(value, ["id", "jobId", "job_id", "taskId", "task_id"]);

  if (!id) {
    return null;
  }

  const commit = pickString(value, [
    "resolvedCommit",
    "resolved_commit",
    "commitSha",
    "commit_sha",
    "commit",
    "sha",
  ]);
  const commitShort =
    pickString(value, ["commitShort", "commit_short"]) ||
    (commit ? commit.slice(0, 7) : "");

  return {
    id,
    repo: pickString(value, ["repo", "repository"]),
    ref: pickString(value, ["ref", "inputRefName", "input_ref_name", "branch"]),
    status: normalizeIndexingTaskStatus(value.status),
    progress: pickNumber(value, ["progress"]),
    totalFiles: pickNumber(value, ["totalFiles", "total_files"]),
    processedFiles: pickNumber(value, ["processedFiles", "processed_files"]),
    error: pickString(value, ["error"]),
    commit,
    commitShort,
    createdAt: pickString(value, ["createdAt", "created_at"]),
    updatedAt: pickString(value, ["updatedAt", "updated_at"]),
  };
}

function taskTimestamp(task: IndexingTaskSummary): number {
  const timestamp = Date.parse(task.updatedAt || task.createdAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function parseIndexingTasksResponse(value: unknown): IndexingTaskSummary[] {
  return extractTasksPayload(value)
    .map(normalizeIndexingTaskSummary)
    .filter((task): task is IndexingTaskSummary => task !== null)
    .sort((a, b) => {
      const timestampDiff = taskTimestamp(b) - taskTimestamp(a);
      if (timestampDiff !== 0) {
        return timestampDiff;
      }

      return a.id.localeCompare(b.id);
    });
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as unknown;
    if (isRecord(body)) {
      const message = pickString(body, ["error", "message"]);
      if (message) {
        return message;
      }
    }
  } catch {
    // Fall through to the status-based message.
  }

  return `HTTP ${String(response.status)} ${response.statusText}`.trim();
}

export async function requestIndexingTasks(
  signal?: AbortSignal
): Promise<IndexingTaskSummary[]> {
  const response = await fetch(INDEX_TASK_API_URL, { signal });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return parseIndexingTasksResponse(await response.json());
}
