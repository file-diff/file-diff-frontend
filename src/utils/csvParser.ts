export type FileType = "d" | "t" | "b";

export interface CsvEntry {
  fileType: FileType;
  path: string;
  name: string;
  size: number;
  lastModified: number;
  hash: string;
  depth: number;
}

export type DiffStatus = "same" | "added" | "removed" | "modified";

export interface DiffEntry {
  path: string;
  name: string;
  depth: number;
  fileType: FileType;
  size: number;
  lastModified: number;
  hash: string;
  status: DiffStatus;
}

/**
 * Parse a single CSV line.
 * Format: type;path;size;timestamp;hash  (separator after type may be ; or :)
 */
function parseCsvLine(line: string): CsvEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^([dtb])[;:](.*)/);
  if (!match) return null;

  const fileType = match[1] as FileType;
  const rest = match[2].split(";");
  if (rest.length < 4) return null;

  const path = rest[0];
  const segments = path.split("/");
  const name = segments[segments.length - 1];
  const depth = segments.length - 1;

  return {
    fileType,
    path,
    name,
    size: parseInt(rest[1], 10),
    lastModified: parseInt(rest[2], 10),
    hash: rest[3],
    depth,
  };
}

/**
 * Parse CSV input into a sorted list of entries with inferred parent directories.
 */
export function parseCsv(input: string): CsvEntry[] {
  const lines = input.split("\n");
  const entries: CsvEntry[] = [];

  for (const line of lines) {
    const entry = parseCsvLine(line);
    if (entry) {
      entries.push(entry);
    }
  }

  // Collect all explicit paths
  const explicitPaths = new Set(entries.map((e) => e.path));

  // Infer missing parent directories from file paths
  const inferred: CsvEntry[] = [];
  for (const entry of entries) {
    const segments = entry.path.split("/");
    for (let i = 1; i < segments.length; i++) {
      const parentPath = segments.slice(0, i).join("/");
      if (!explicitPaths.has(parentPath)) {
        explicitPaths.add(parentPath);
        inferred.push({
          fileType: "d",
          path: parentPath,
          name: segments[i - 1],
          size: 0,
          lastModified: 0,
          hash: "N/A",
          depth: i - 1,
        });
      }
    }
  }

  const all = [...entries, ...inferred];

  // Sort in tree order: by path segments, directories first at each level
  const dirPaths = new Set(
    all.filter((e) => e.fileType === "d").map((e) => e.path)
  );

  all.sort((a, b) => {
    const aParts = a.path.split("/");
    const bParts = b.path.split("/");
    const minLen = Math.min(aParts.length, bParts.length);

    for (let i = 0; i < minLen; i++) {
      if (aParts[i] !== bParts[i]) {
        // At this level, check if either is a directory prefix
        const aPrefix = aParts.slice(0, i + 1).join("/");
        const bPrefix = bParts.slice(0, i + 1).join("/");
        const aIsDir = dirPaths.has(aPrefix) || i < aParts.length - 1;
        const bIsDir = dirPaths.has(bPrefix) || i < bParts.length - 1;

        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        return aParts[i].localeCompare(bParts[i]);
      }
    }

    // Shorter path (directory) comes before longer path (its children)
    return aParts.length - bParts.length;
  });

  return all;
}

/**
 * Compare two CSV entry lists and produce aligned diff entries for left and right.
 * Detects modifications by comparing hashes for entries at the same path.
 */
export function diffCsv(
  leftEntries: CsvEntry[],
  rightEntries: CsvEntry[]
): { left: (DiffEntry | null)[]; right: (DiffEntry | null)[] } {
  const leftMap = new Map(leftEntries.map((e) => [e.path, e]));
  const rightMap = new Map(rightEntries.map((e) => [e.path, e]));

  const leftPaths = new Set(leftEntries.map((e) => e.path));
  const rightPaths = new Set(rightEntries.map((e) => e.path));

  // Collect all unique paths maintaining stable order
  const allPaths: string[] = [];
  const seen = new Set<string>();

  let li = 0,
    ri = 0;
  while (li < leftEntries.length || ri < rightEntries.length) {
    if (li < leftEntries.length && !seen.has(leftEntries[li].path)) {
      allPaths.push(leftEntries[li].path);
      seen.add(leftEntries[li].path);
    }
    if (ri < rightEntries.length && !seen.has(rightEntries[ri].path)) {
      allPaths.push(rightEntries[ri].path);
      seen.add(rightEntries[ri].path);
    }
    li++;
    ri++;
  }

  const left: (DiffEntry | null)[] = [];
  const right: (DiffEntry | null)[] = [];

  for (const p of allPaths) {
    const inLeft = leftPaths.has(p);
    const inRight = rightPaths.has(p);

    if (inLeft && inRight) {
      const le = leftMap.get(p)!;
      const re = rightMap.get(p)!;
      // Directories don't have meaningful hashes, only files can be "modified"
      const status: DiffStatus =
        le.hash !== re.hash && le.fileType !== "d" ? "modified" : "same";
      left.push({ ...le, status });
      right.push({ ...re, status });
    } else if (inLeft && !inRight) {
      const le = leftMap.get(p)!;
      left.push({ ...le, status: "removed" });
      right.push(null);
    } else {
      const re = rightMap.get(p)!;
      left.push(null);
      right.push({ ...re, status: "added" });
    }
  }

  return { left, right };
}
