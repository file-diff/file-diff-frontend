// Test the diff logic
const csvTextLeft = `d;cmd;0;1772817450;N/A
d;cmd/golembase;0;1772817450;N/A
t;cmd/golembase/main.go;444;1772817450;abc123
d;common;0;1772817450;N/A
t;common/helper.txt;222;1772817450;def456`;

const csvTextRight = `d;cmd;0;1772817450;N/A
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

  const explicitPaths = new Set(entries.map((e) => e.path));
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
  const dirPaths = new Set(
    all.filter((e) => e.fileType === "d").map((e) => e.path)
  );

  all.sort((a, b) => {
    const aParts = a.path.split("/");
    const bParts = b.path.split("/");
    const minLen = Math.min(aParts.length, bParts.length);

    for (let i = 0; i < minLen; i++) {
      if (aParts[i] !== bParts[i]) {
        const aPrefix = aParts.slice(0, i + 1).join("/");
        const bPrefix = bParts.slice(0, i + 1).join("/");
        const aIsDir = dirPaths.has(aPrefix) || i < aParts.length - 1;
        const bIsDir = dirPaths.has(bPrefix) || i < bParts.length - 1;

        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        return aParts[i].localeCompare(bParts[i]);
      }
    }

    return aParts.length - bParts.length;
  });

  return all;
}

function diffCsv(leftEntries, rightEntries) {
  const leftMap = new Map(leftEntries.map((e) => [e.path, e]));
  const rightMap = new Map(rightEntries.map((e) => [e.path, e]));

  const leftPaths = new Set(leftEntries.map((e) => e.path));
  const rightPaths = new Set(rightEntries.map((e) => e.path));

  // Collect all unique paths maintaining stable order
  const allPaths = [];
  const seen = new Set();

  let li = 0, ri = 0;
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

  const left = [];
  const right = [];

  for (const p of allPaths) {
    const inLeft = leftPaths.has(p);
    const inRight = rightPaths.has(p);

    if (inLeft && inRight) {
      const le = leftMap.get(p);
      const re = rightMap.get(p);
      const status = le.hash !== re.hash && le.fileType !== "d" ? "modified" : "same";
      left.push({ ...le, status });
      right.push({ ...re, status });
    } else if (inLeft && !inRight) {
      const le = leftMap.get(p);
      left.push({ ...le, status: "removed" });
      right.push(null);
    } else {
      const re = rightMap.get(p);
      left.push(null);
      right.push({ ...re, status: "added" });
    }
  }

  return { left, right };
}

const leftEntries = parseCsv(csvTextLeft);
const rightEntries = parseCsv(csvTextRight);

console.log("Left entries:");
leftEntries.forEach((e, i) => console.log(`  [${i}] ${e.path} (${e.status || 'N/A'})`));

console.log("\nRight entries:");
rightEntries.forEach((e, i) => console.log(`  [${i}] ${e.path} (${e.status || 'N/A'})`));

const diff = diffCsv(leftEntries, rightEntries);

console.log("\nDiff result:");
console.log("Left column:");
diff.left.forEach((e, i) => {
  if (e) console.log(`  [${i}] ${e.path} (${e.status})`);
  else console.log(`  [${i}] [NULL]`);
});

console.log("\nRight column:");
diff.right.forEach((e, i) => {
  if (e) console.log(`  [${i}] ${e.path} (${e.status})`);
  else console.log(`  [${i}] [NULL]`);
});
