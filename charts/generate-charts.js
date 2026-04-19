import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const chartsDir = dirname(__filename);

const PLOTLY_CDN = "https://cdn.plot.ly/plotly-2.35.0.min.js";

const COLORS = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#7f7f7f",
  "#bcbd22",
  "#17becf",
];

function parseCsv(text) {
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) =>
    line.split(",").map((v) => {
      const n = Number(v.trim());
      return Number.isNaN(n) ? v.trim() : n;
    }),
  );

  return { headers, rows };
}

function normalizeTime(headers, rows) {
  const tIndex = headers.indexOf("t");
  if (tIndex === -1) {
    throw new Error('CSV must contain a "t" column');
  }

  const tValues = rows.map((r) => r[tIndex]);
  const tMin = Math.min(...tValues);

  const normalizedRows = rows.map((r) => {
    const copy = [...r];
    copy[tIndex] = Math.round((copy[tIndex] - tMin) * 1e6) / 1e6;
    return copy;
  });

  return { tMin, normalizedRows };
}

function formatTitle(filename) {
  return basename(filename, extname(filename))
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatAxisLabel(header) {
  return header
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function generateHtml(csvFile, headers, normalizedRows) {
  const tIndex = headers.indexOf("t");
  const tValues = normalizedRows.map((r) => r[tIndex]);
  const valueHeaders = headers.filter((_, i) => i !== tIndex);
  const title = formatTitle(csvFile);

  const traces = valueHeaders.map((header, i) => {
    const colIndex = headers.indexOf(header);
    const yValues = normalizedRows.map((r) => r[colIndex]);
    return {
      x: tValues,
      y: yValues,
      mode: "lines+markers",
      name: formatAxisLabel(header),
      line: { color: COLORS[i % COLORS.length], width: 2 },
      marker: { size: 5 },
    };
  });

  const layout = {
    title: { text: title, font: { size: 20 } },
    xaxis: {
      title: { text: "Time (s)", font: { size: 14 } },
      zeroline: true,
    },
    yaxis: {
      title: { text: "Value", font: { size: 14 } },
      zeroline: true,
    },
    legend: {
      orientation: "h",
      y: -0.2,
      x: 0.5,
      xanchor: "center",
    },
    template: "plotly_white",
    hovermode: "x unified",
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="${PLOTLY_CDN}"></script>
  <style>
    body { margin: 0; padding: 20px; font-family: sans-serif; background: #fafafa; }
    #chart { width: 100%; height: 80vh; }
    h1 { text-align: center; color: #333; margin-bottom: 4px; }
    p.meta { text-align: center; color: #888; font-size: 0.85em; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="meta">Source: ${csvFile} &mdash; t normalized to 0</p>
  <div id="chart"></div>
  <script>
    const traces = ${JSON.stringify(traces, null, 2)};
    const layout = ${JSON.stringify(layout, null, 2)};
    Plotly.newPlot("chart", traces, layout, { responsive: true });
  </script>
</body>
</html>`;
}

function main() {
  const csvFiles = readdirSync(chartsDir).filter(
    (f) => extname(f).toLowerCase() === ".csv",
  );

  if (csvFiles.length === 0) {
    console.log("No CSV files found in", chartsDir);
    return;
  }

  console.log(`Found ${csvFiles.length} CSV file(s) in ${chartsDir}`);

  for (const csvFile of csvFiles) {
    const csvPath = join(chartsDir, csvFile);
    const text = readFileSync(csvPath, "utf-8");
    const { headers, rows } = parseCsv(text);
    const { normalizedRows } = normalizeTime(headers, rows);

    const html = generateHtml(csvFile, headers, normalizedRows);
    const outName = basename(csvFile, extname(csvFile)) + ".html";
    const outPath = join(chartsDir, outName);
    writeFileSync(outPath, html, "utf-8");
    console.log(`  ${csvFile} -> ${outName}`);
  }

  console.log("Done.");
}

main();
