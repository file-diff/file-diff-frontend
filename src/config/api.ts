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
export const STATS_API_URL = `${trimmedDefaultApiBaseUrl}/stats`;

export function buildCommitFilesUrl(commit: string, format?: string): string {
  const base = `${trimmedDefaultApiBaseUrl}/commit/${encodeURIComponent(commit)}/files`;
  if (format) {
    return `${base}?format=${encodeURIComponent(format)}`;
  }
  return base;
}

export function buildJobFileDownloadUrl(jobId: string, hash: string): string {
  return `${JOBS_API_URL}/${encodeURIComponent(
    jobId
  )}/files/hash/${encodeURIComponent(hash)}/download`;
}

export function buildJobFileDiffUrl(leftHash: string, rightHash: string): string {
  return `${JOBS_API_URL}/files/hash/${encodeURIComponent(
    leftHash
  )}/diff/${encodeURIComponent(rightHash)}`;
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
