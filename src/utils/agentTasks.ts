function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function splitOwnerRepo(
  repo: string
): { owner: string; name: string } | null {
  const parts = repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], name: parts[1] };
}

export interface TaskSummary {
  id: string;
  status: string;
  branch: string;
  baseRef: string;
  model: string;
  pullRequestNumber: number | undefined;
  pullRequestUrl: string | undefined;
  taskId: string;
  taskStatus: string;
  taskDelayMs: number | undefined;
  scheduledAt: string;
  error: string;
  output: string;
  createdAt: string;
  updatedAt: string;
}

export function extractTaskSummaries(data: unknown): TaskSummary[] {
  let items: unknown[];

  if (Array.isArray(data)) {
    items = data;
  } else if (isRecord(data) && Array.isArray(data.tasks)) {
    items = data.tasks as unknown[];
  } else {
    items = [];
  }

  const summaries: TaskSummary[] = [];

  for (const item of items) {
    if (!isRecord(item)) continue;

    const id = asString(item.id) ?? "";
    if (!id) continue;

    const status = asString(item.status) ?? "unknown";
    const branch = asString(item.branch) ?? "";
    const baseRef = asString(item.baseRef) ?? "";
    const model = asString(item.model) ?? "";
    const pullRequestUrl = asString(item.pullRequestUrl);
    const pullRequestNumber = asNumber(item.pullRequestNumber);
    const taskId = asString(item.taskId) ?? "";
    const taskStatus = asString(item.taskStatus) ?? "";
    const taskDelayMs = asNumber(item.taskDelayMs);
    const scheduledAt = asString(item.scheduledAt) ?? "";
    const error = asString(item.error) ?? "";
    const output = asString(item.output) ?? "";
    const createdAt = asString(item.createdAt) ?? "";
    const updatedAt = asString(item.updatedAt) ?? "";

    summaries.push({
      id,
      status,
      branch,
      baseRef,
      model,
      pullRequestNumber,
      pullRequestUrl,
      taskId,
      taskStatus,
      taskDelayMs,
      scheduledAt,
      error,
      output,
      createdAt,
      updatedAt,
    });
  }

  return summaries;
}
