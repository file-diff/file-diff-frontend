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
let originalFetch: typeof window.fetch | null = null;

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

  const fetchImpl = originalFetch ?? window.fetch.bind(window);
  originalFetch = fetchImpl;

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);

    if (!isProtectedApiRequest(request.url)) {
      return fetchImpl(request);
    }

    const bearerToken = (loadBearerToken() ?? "").trim();

    if (!bearerToken) {
      return fetchImpl(request);
    }

    const headers = new Headers(request.headers);

    if (headers.has("Authorization")) {
      return fetchImpl(request);
    }

    headers.set("Authorization", `Bearer ${bearerToken}`);

    return fetchImpl(new Request(request, { headers }));
  };

  isInstalled = true;
}
