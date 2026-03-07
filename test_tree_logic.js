// Simple test to understand the sorting logic
const csvText = `d;cmd;0;1772817450;N/A
d;cmd/golembase;0;1772817450;N/A
t;cmd/golembase/main.go;444;1772817450;abc123
d;common;0;1772817450;N/A
t;common/helper.txt;222;1772817450;def456`;

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

function parseCsvLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^([dtbxs])[;:](.*)/);
  if (!match) return null;

  const fileType = match[1];
  const rest = match[2].split(";");
  if (rest.length < 4) return null;

  const path = normalizePath(rest[0]);
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

function parseCsv(input) {
  const lines = input.split("\n");
  const entries = [];

  for (const line of lines) {
    const entry = parseCsvLine(line);
    if (entry) {
      entries.push(entry);
    }
  }

  // Collect all explicit paths
  const explicitPaths = new Set(entries.map((e) => e.path));

  // Infer missing parent directories from file paths
  const inferred = [];
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

const result = parseCsv(csvText);
console.log("Parsed and sorted entries:");
result.forEach(e => {
  console.log(`  ${e.path} (depth=${e.depth}, type=${e.fileType})`);
});
