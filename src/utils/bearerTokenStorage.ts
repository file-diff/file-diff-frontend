const BEARER_TOKEN_STORAGE_KEY = "bearer-token";

export function loadBearerToken(): string {
  try {
    return localStorage.getItem(BEARER_TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveBearerToken(token: string): void {
  try {
    localStorage.setItem(BEARER_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage failures.
  }
}
