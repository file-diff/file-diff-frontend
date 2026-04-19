const AUTO_REFRESH_ENABLED_STORAGE_KEY = "agent-tasks-page-auto-refresh-enabled";

export function loadAutoRefreshEnabled(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_REFRESH_ENABLED_STORAGE_KEY);
    if (raw === "false") {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

export function saveAutoRefreshEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_REFRESH_ENABLED_STORAGE_KEY, String(enabled));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}
