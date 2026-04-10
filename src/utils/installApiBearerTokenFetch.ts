import { DEFAULT_API_BASE_URL } from "../config/api";
import { loadBearerToken } from "./bearerTokenStorage";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

const configuredApiBaseUrl = trimTrailingSlash(
  import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL
);
const configuredJobsApiUrl = trimTrailingSlash(
  import.meta.env.VITE_JOBS_API_URL?.trim() || `${configuredApiBaseUrl}/jobs`
);
const protectedApiPrefixes = [configuredApiBaseUrl, configuredJobsApiUrl].map(
  (url) => `${url}/`
);

let isInstalled = false;

function isProtectedApiRequest(url: string): boolean {
  return (
    url === configuredApiBaseUrl ||
    url === configuredJobsApiUrl ||
    protectedApiPrefixes.some((prefix) => url.startsWith(prefix))
  );
}

export function installApiBearerTokenFetch(): void {
  if (isInstalled || typeof window === "undefined") {
    return;
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = (input, init) => {
    const request = new Request(input, init);

    if (!isProtectedApiRequest(request.url)) {
      return originalFetch(request);
    }

    const bearerToken = (loadBearerToken() ?? "").trim();

    if (!bearerToken) {
      return originalFetch(request);
    }

    const headers = new Headers(request.headers);

    if (headers.has("Authorization")) {
      return originalFetch(request);
    }

    headers.set("Authorization", `Bearer ${bearerToken}`);

    return originalFetch(new Request(request, { headers }));
  };

  isInstalled = true;
}
