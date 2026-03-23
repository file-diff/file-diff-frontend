import natsort from "natsort";

export type FileType = "d" | "t" | "b" | "x" | "s";

export interface JobFilesResponse {
  job_id?: string;
  jobId?: string;
  commit?: string;
  commitShort?: string;
  status?: string;
  progress?: number;
  files?: Array<{
    t: FileType;
    path: string;
    s: number;
    update: string;
    commit?: string;
    hash: string;
  }>;
}

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

export interface ComparisonSlot {
  no: number;
  left: DiffEntry | null;
  right: DiffEntry | null;
}

const naturalSort = natsort();

function comparePathsInTreeOrder(
  aPath: string,
  bPath: string,
  dirPaths: Set<string>,
  useNaturalSort = false
): number {
  const aParts = aPath.split("/");
  const bParts = bPath.split("/");
  const minLen = Math.min(aParts.length, bParts.length);

  for (let i = 0; i < minLen; i++) {
    if (aParts[i] !== bParts[i]) {
      const aPrefix = aParts.slice(0, i + 1).join("/");
      const bPrefix = bParts.slice(0, i + 1).join("/");
      const aIsDir = dirPaths.has(aPrefix) || i < aParts.length - 1;
      const bIsDir = dirPaths.has(bPrefix) || i < bParts.length - 1;

      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return useNaturalSort
        ? naturalSort(aParts[i], bParts[i])
        : aParts[i].localeCompare(bParts[i]);
    }
  }

  return aParts.length - bParts.length;
}

/**
 * Parse a single CSV line.
 * Format: type;path;size;timestamp;hash  (separator after type may be ; or :)
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function normalizeCompareRoot(rootPath: string): string {
  return normalizePath(rootPath.trim()).replace(/^\/+|\/+$/g, "");
}

function rebaseEntries(entries: CsvEntry[], rootPath: string): CsvEntry[] {
  const normalizedRoot = normalizeCompareRoot(rootPath);

  if (!normalizedRoot) {
    return entries;
  }

  const prefix = `${normalizedRoot}/`;

  return entries.flatMap((entry) => {
    const normalizedPath = normalizeCompareRoot(entry.path);

    if (normalizedPath === normalizedRoot) {
      if (entry.fileType === "d") {
        return [];
      }

      const rebasedPath = entry.name;

      return [
        {
          ...entry,
          path: rebasedPath,
          name: rebasedPath,
          depth: 0,
        },
      ];
    }

    if (!normalizedPath.startsWith(prefix)) {
      return [];
    }

    const rebasedPath = normalizedPath.slice(prefix.length);
    const segments = rebasedPath.split("/");

    return [
      {
        ...entry,
        path: rebasedPath,
        name: segments[segments.length - 1],
        depth: segments.length - 1,
      },
    ];
  });
}

function parseApiTimestamp(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

/**
 * Convert a JobFilesResponse directly into a sorted list of CsvEntry objects,
 * bypassing the intermediate CSV string representation.
 */
export function parseJobFilesResponse(
  response: JobFilesResponse,
  useNaturalSort = false
): CsvEntry[] {
  if (!Array.isArray(response.files)) {
    throw new Error("Invalid files response");
  }

  const entries: CsvEntry[] = response.files.map((entry) => {
    const path = normalizePath(entry.path);
    const segments = path.split("/");
    const name = segments[segments.length - 1];
    const depth = segments.length - 1;

    return {
      fileType: entry.t,
      path,
      name,
      size: Number.isFinite(entry.s) ? entry.s : 0,
      lastModified: parseApiTimestamp(entry.update),
      hash: entry.hash ?? "",
      depth,
    };
  });

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

  all.sort((a, b) =>
    comparePathsInTreeOrder(a.path, b.path, dirPaths, useNaturalSort)
  );

  return all;
}

/**
 * Compare two CSV entry lists and produce aligned diff entry slots.
 * Detects modifications by comparing hashes for entries at the same path.
 */
export function diffCsv(
  leftEntries: CsvEntry[],
  rightEntries: CsvEntry[],
  leftRootPath = "/",
  rightRootPath = "/",
  useNaturalSort = false
): ComparisonSlot[] {
  const rebasedLeftEntries = rebaseEntries(leftEntries, leftRootPath);
  const rebasedRightEntries = rebaseEntries(rightEntries, rightRootPath);

  const leftMap = new Map(rebasedLeftEntries.map((e) => [e.path, e]));
  const rightMap = new Map(rebasedRightEntries.map((e) => [e.path, e]));

  const leftPaths = new Set(rebasedLeftEntries.map((e) => e.path));
  const rightPaths = new Set(rebasedRightEntries.map((e) => e.path));

  // Collect all unique paths maintaining stable order
  const allPaths: string[] = [];
  const seen = new Set<string>();
  const dirPaths = new Set(
    [...rebasedLeftEntries, ...rebasedRightEntries]
      .filter((entry) => entry.fileType === "d")
      .map((entry) => entry.path)
  );

  const addPath = (path: string) => {
    if (!seen.has(path)) {
      allPaths.push(path);
      seen.add(path);
    }
  };

  let li = 0,
    ri = 0;
  while (li < rebasedLeftEntries.length && ri < rebasedRightEntries.length) {
    const leftPath = rebasedLeftEntries[li].path;
    const rightPath = rebasedRightEntries[ri].path;

    if (leftPath === rightPath) {
      addPath(leftPath);
      li++;
      ri++;
      continue;
    }

    if (
      comparePathsInTreeOrder(leftPath, rightPath, dirPaths, useNaturalSort) < 0
    ) {
      addPath(leftPath);
      li++;
      continue;
    }

    addPath(rightPath);
    ri++;
  }

  while (li < rebasedLeftEntries.length) {
    addPath(rebasedLeftEntries[li].path);
    li++;
  }

  while (ri < rebasedRightEntries.length) {
    addPath(rebasedRightEntries[ri].path);
    ri++;
  }

  const slots: ComparisonSlot[] = [];

  for (const p of allPaths) {
    const inLeft = leftPaths.has(p);
    const inRight = rightPaths.has(p);

    if (inLeft && inRight) {
      const le = leftMap.get(p)!;
      const re = rightMap.get(p)!;
      // Directories don't have meaningful hashes, only files can be "modified"
      const status: DiffStatus =
        le.hash !== re.hash && le.fileType !== "d" ? "modified" : "same";
      slots.push({
        no: slots.length + 1,
        left: { ...le, status },
        right: { ...re, status },
      });
    } else if (inLeft && !inRight) {
      const le = leftMap.get(p)!;
      slots.push({
        no: slots.length + 1,
        left: { ...le, status: "removed" },
        right: null,
      });
    } else {
      const re = rightMap.get(p)!;
      slots.push({
        no: slots.length + 1,
        left: null,
        right: { ...re, status: "added" },
      });
    }
  }

  return slots;
}
