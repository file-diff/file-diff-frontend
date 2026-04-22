const REPO_PROBLEM_STATEMENTS_STORAGE_KEY = "repo-problem-statements";

export { REPO_PROBLEM_STATEMENTS_STORAGE_KEY };

function normalizeKey(repo: string): string {
  return repo.trim().toLowerCase();
}

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(REPO_PROBLEM_STATEMENTS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(
      REPO_PROBLEM_STATEMENTS_STORAGE_KEY,
      JSON.stringify(map)
    );
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

export function loadRepoProblemStatement(repo: string): string {
  const key = normalizeKey(repo);
  if (!key) {
    return "";
  }
  const map = readMap();
  return map[key] ?? "";
}

export function saveRepoProblemStatement(repo: string, value: string): void {
  const key = normalizeKey(repo);
  if (!key) {
    return;
  }

  const map = readMap();
  if (value === "") {
    if (!(key in map)) {
      return;
    }
    delete map[key];
  } else {
    if (map[key] === value) {
      return;
    }
    map[key] = value;
  }
  writeMap(map);
}

export function removeRepoProblemStatement(repo: string): void {
  saveRepoProblemStatement(repo, "");
}
