export const DEFAULT_API_BASE_URL = "http://localhost:5173/api";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

const configuredJobsApiUrl = import.meta.env.VITE_JOBS_API_URL?.trim();
const trimmedDefaultApiBaseUrl = trimTrailingSlash(import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL);

export const JOBS_API_URL = trimTrailingSlash(
  configuredJobsApiUrl || `${trimmedDefaultApiBaseUrl}/jobs`
);

export const HEALTH_API_URL = `${trimmedDefaultApiBaseUrl}/health`;
export const VERSION_API_URL = `${trimmedDefaultApiBaseUrl}/version`;
export const CACHE_API_URL = `${JOBS_API_URL}/cache`;
export const COMMITS_API_URL = `${JOBS_API_URL}/commits`;
export const BRANCHES_API_URL = `${JOBS_API_URL}/branches`;
export const STATS_API_URL = `${trimmedDefaultApiBaseUrl}/stats`;
export const CREATE_TASK_API_URL = `${JOBS_API_URL}/create-task`;
export const REVERT_TO_COMMIT_API_URL = `${JOBS_API_URL}/revert-to-commit`;
export const DELETE_REMOTE_BRANCH_API_URL = `${JOBS_API_URL}/delete-remote-branch`;
export const PULL_REQUEST_READY_API_URL = `${JOBS_API_URL}/pull-request/ready`;
export const PULL_REQUEST_MERGE_API_URL = `${JOBS_API_URL}/pull-request/merge`;
export const PULL_REQUEST_OPEN_API_URL = `${JOBS_API_URL}/pull-request/open`;
export const TAGS_API_URL = `${JOBS_API_URL}/tags`;
export const ACTIONS_API_URL = `${JOBS_API_URL}/actions`;
export const DELETE_TAG_API_URL = `${JOBS_API_URL}/delete-tag`;
export const CREATE_TAG_API_URL = `${JOBS_API_URL}/create-tag`;
export const DELETE_ACTION_RUN_API_URL = `${JOBS_API_URL}/delete-action-run`;

export function buildCreateTaskJobUrl(taskId: string): string {
  return `${CREATE_TASK_API_URL}/${encodeURIComponent(taskId)}`;
}

export function buildCommitFilesUrl(commit: string, format?: string): string {
  const base = `${trimmedDefaultApiBaseUrl}/commit/${encodeURIComponent(commit)}/files`;
  if (format) {
    return `${base}?format=${encodeURIComponent(format)}`;
  }
  return base;
}

function buildFileDownloadUrl(fileLocatorPath: string): string {
  return `${JOBS_API_URL}/${fileLocatorPath}/download`;
}

export function buildJobFileDownloadUrl(jobId: string, hash: string): string {
  return buildFileDownloadUrl(
    `${encodeURIComponent(jobId)}/files/hash/${encodeURIComponent(hash)}`
  );
}

export function buildHashFileDownloadUrl(hash: string): string {
  return buildFileDownloadUrl(`files/hash/${encodeURIComponent(hash)}`);
}

export function buildJobFileDiffUrl(leftHash: string, rightHash: string): string {
  return `${JOBS_API_URL}/files/hash/${encodeURIComponent(
    leftHash
  )}/diff/${encodeURIComponent(rightHash)}`;
}

export function buildGrepUrl(commit: string, query: string): string {
  const url = new URL(
    `${trimmedDefaultApiBaseUrl}/commit/${encodeURIComponent(commit)}/grep`
  );
  url.searchParams.set("query", query);
  return url.toString();
}

export function buildTokenizeUrl(hash: string, theme?: string): string {
  const url = new URL(
    `${JOBS_API_URL}/files/hash/${encodeURIComponent(hash)}/tokenize`
  );
  const normalizedTheme = theme?.trim();

  if (normalizedTheme) {
    url.searchParams.set("theme", normalizedTheme);
  }

  return url.toString();
}

export function buildOrganizationRepositoriesUrl(
  organization: string
): string {
  return `${JOBS_API_URL}/organizations/${encodeURIComponent(
    organization
  )}/repositories`;
}


export function buildAgentTasksUrl(owner: string, repo: string): string {
  return `${trimmedDefaultApiBaseUrl}/agents/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tasks`;
}

export function buildAgentTaskUrl(owner: string, repo: string, taskId: string): string {
  return `${trimmedDefaultApiBaseUrl}/agents/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tasks/${encodeURIComponent(taskId)}`;
}
