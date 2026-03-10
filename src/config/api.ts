export const DEFAULT_API_BASE_URL = "https://filediff.org/api";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

const configuredJobsApiUrl = import.meta.env.VITE_JOBS_API_URL?.trim();

export const JOBS_API_URL = trimTrailingSlash(
  configuredJobsApiUrl || `${DEFAULT_API_BASE_URL}/jobs`
);

export const HEALTH_API_URL = `${DEFAULT_API_BASE_URL}/health`;
export const VERSION_API_URL = `${DEFAULT_API_BASE_URL}/version`;
