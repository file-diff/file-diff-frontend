const REFRESH_INTERVAL_STORAGE_KEY = "repository-view-refresh-interval-ms";

const DEFAULT_REFRESH_INTERVAL_MS = 30_000;

export const REFRESH_INTERVAL_OPTIONS = [
  { label: "10s", value: 10_000 },
  { label: "20s", value: 20_000 },
  { label: "30s", value: 30_000 },
  { label: "1m", value: 60_000 },
  { label: "2m", value: 120_000 },
  { label: "5m", value: 300_000 },
  { label: "Never", value: 0 },
] as const;

export type RefreshIntervalMs = (typeof REFRESH_INTERVAL_OPTIONS)[number]["value"];

export function loadRefreshIntervalMs(): RefreshIntervalMs {
  try {
    const raw = localStorage.getItem(REFRESH_INTERVAL_STORAGE_KEY);
    if (raw === null) return DEFAULT_REFRESH_INTERVAL_MS;
    const parsed = Number(raw);
    if (REFRESH_INTERVAL_OPTIONS.some((o) => o.value === parsed)) {
      return parsed as RefreshIntervalMs;
    }
    return DEFAULT_REFRESH_INTERVAL_MS;
  } catch {
    return DEFAULT_REFRESH_INTERVAL_MS;
  }
}

export function saveRefreshIntervalMs(intervalMs: RefreshIntervalMs): void {
  try {
    localStorage.setItem(REFRESH_INTERVAL_STORAGE_KEY, String(intervalMs));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}
