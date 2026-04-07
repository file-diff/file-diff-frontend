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

export interface TaskCreator {
  login: string;
  profileUrl: string;
}

export interface TaskSummary {
  id: string;
  name: string;
  status: string;
  state: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  pullRequestNumber: number | undefined;
  pullRequestUrl: string | undefined;
  branch: string;
  headRef: string;
  htmlUrl: string;
  creator: TaskCreator | undefined;
  sessionCount: number | undefined;
  archivedAt: string;
}

function extractArtifacts(artifacts: unknown): {
  pullRequestNumber: number | undefined;
  pullRequestUrl: string | undefined;
  headRef: string;
  baseRef: string;
} {
  let pullRequestNumber: number | undefined;
  let pullRequestUrl: string | undefined;
  let headRef = "";
  let baseRef = "";

  if (!Array.isArray(artifacts)) {
    return { pullRequestNumber, pullRequestUrl, headRef, baseRef };
  }

  for (const artifact of artifacts) {
    if (!isRecord(artifact)) continue;
    const artType = asString(artifact.type);
    const data = isRecord(artifact.data) ? artifact.data : undefined;
    if (!data) continue;

    if (artType === "github_resource" && asString(data.type) === "pull") {
      pullRequestNumber = asNumber(data.id);
      pullRequestUrl = asString(data.html_url);
    }

    if (artType === "branch") {
      headRef = asString(data.head_ref) ?? headRef;
      baseRef = asString(data.base_ref) ?? baseRef;
    }
  }

  return { pullRequestNumber, pullRequestUrl, headRef, baseRef };
}

function extractCreator(creator: unknown): TaskCreator | undefined {
  if (!isRecord(creator)) return undefined;
  const login = asString(creator.login);
  const profileUrl = asString(creator.url);
  if (!login) return undefined;
  return { login, profileUrl: profileUrl ?? "" };
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

    const id = asString(item.id) ?? asString(item.task_id) ?? "";
    if (!id) continue;

    const name = asString(item.name) ?? "";
    const status = asString(item.status) ?? "unknown";
    const state = asString(item.state) ?? "";
    const description =
      asString(item.description) ??
      asString(item.event_content) ??
      asString(item.title) ??
      name;
    const createdAt =
      asString(item.created_at) ?? asString(item.createdAt) ?? "";
    const updatedAt =
      asString(item.updated_at) ?? asString(item.updatedAt) ?? "";
    const archivedAt = asString(item.archived_at) ?? "";
    const model = asString(item.model) ?? "";
    const htmlUrl = asString(item.html_url) ?? "";
    const sessionCount = asNumber(item.session_count);

    const creator = extractCreator(item.creator);

    const {
      pullRequestNumber: artPrNumber,
      pullRequestUrl: artPrUrl,
      headRef: artHeadRef,
      baseRef: artBaseRef,
    } = extractArtifacts(item.artifacts);

    let pullRequestNumber: number | undefined = artPrNumber;
    let pullRequestUrl: string | undefined = artPrUrl;

    const pr = item.pull_request ?? item.pullRequest;
    if (isRecord(pr)) {
      pullRequestNumber = asNumber(pr.number) ?? pullRequestNumber;
      pullRequestUrl =
        asString(pr.html_url) ?? asString(pr.url) ?? pullRequestUrl;
    }

    const branch =
      asString(item.branch) ??
      asString(item.head_branch) ??
      asString(item.base_ref) ??
      artBaseRef;

    summaries.push({
      id,
      name,
      status,
      state,
      description,
      createdAt,
      updatedAt,
      model,
      pullRequestNumber,
      pullRequestUrl,
      branch,
      headRef: artHeadRef,
      htmlUrl,
      creator,
      sessionCount,
      archivedAt,
    });
  }

  return summaries;
}
