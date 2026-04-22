const REPOSITORY_COLORS_STORAGE_KEY = "recent-repository-colors";

// Visually distinct, high-contrast colors that work well on the dark UI
// background. Order matters: colors are assigned sequentially to new
// repositories and persisted, so the assignment is stable over time.
export const REPOSITORY_COLOR_PALETTE: readonly string[] = [
  "#58a6ff", // blue
  "#f78166", // orange
  "#7ee787", // green
  "#d2a8ff", // purple
  "#ffa657", // amber
  "#ff7b72", // red
  "#ffdf5d", // yellow
  "#79c0ff", // light blue
  "#bc8cff", // violet
  "#ff9bce", // pink
  "#39c5cf", // cyan
  "#e3b341", // gold
  "#85e89d", // mint
  "#ff6e6e", // coral
  "#a5d6ff", // pale blue
  "#56d364", // bright green
];

const FALLBACK_COLOR = REPOSITORY_COLOR_PALETTE[0];

export { REPOSITORY_COLORS_STORAGE_KEY };

function normalizeKey(repo: string): string {
  return repo.trim().toLowerCase();
}

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(REPOSITORY_COLORS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim() !== "") {
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
    localStorage.setItem(REPOSITORY_COLORS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

function pickNextColor(map: Record<string, string>): string {
  const used = new Set(Object.values(map));
  for (const color of REPOSITORY_COLOR_PALETTE) {
    if (!used.has(color)) {
      return color;
    }
  }
  // Palette exhausted: cycle by count to keep some variety.
  const index = Object.keys(map).length % REPOSITORY_COLOR_PALETTE.length;
  return REPOSITORY_COLOR_PALETTE[index] ?? FALLBACK_COLOR;
}

export function getRepositoryColor(repo: string): string {
  const key = normalizeKey(repo);
  if (!key) {
    return FALLBACK_COLOR;
  }

  const map = readMap();
  const existing = map[key];
  if (existing) {
    return existing;
  }

  const next = pickNextColor(map);
  map[key] = next;
  writeMap(map);
  return next;
}

export function getRepositoryColorMap(repos: readonly string[]): Record<string, string> {
  const map = readMap();
  let mutated = false;
  const result: Record<string, string> = {};

  for (const repo of repos) {
    const key = normalizeKey(repo);
    if (!key) {
      continue;
    }
    const existing = map[key];
    if (existing) {
      result[key] = existing;
    } else {
      const next = pickNextColor(map);
      map[key] = next;
      result[key] = next;
      mutated = true;
    }
  }

  if (mutated) {
    writeMap(map);
  }

  return result;
}

export function removeRepositoryColor(repo: string): void {
  const key = normalizeKey(repo);
  if (!key) {
    return;
  }
  const map = readMap();
  if (key in map) {
    delete map[key];
    writeMap(map);
  }
}
