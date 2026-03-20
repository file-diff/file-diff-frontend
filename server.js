import express from "express";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = parseInt(process.env.PORT || "3000", 10);
const apiBaseUrl = (
  process.env.API_BASE_URL || "https://filediff.org/api"
).replace(/\/+$/, "");

const clientDir = resolve(__dirname, "dist/client");
const indexHtml = readFileSync(resolve(clientDir, "index.html"), "utf-8");

/** @type {{ render: (apiBaseUrl: string) => Promise<string> }} */
const ssrModule = await import("./dist/server/entry-server.js");

const app = express();

// Serve static client assets (do not serve index.html for /)
app.use(express.static(clientDir, { index: false }));

// SSR-rendered health page
app.get("/ssr-health", async (_req, res) => {
  try {
    const html = await ssrModule.render(apiBaseUrl);
    res.status(200).set({ "Content-Type": "text/html" }).send(html);
  } catch (err) {
    console.error("SSR render error:", err);
    res.status(500).send("Internal Server Error");
  }
});

// SPA fallback – serve index.html for all other routes
app.get("/{*splat}", (_req, res) => {
  res.status(200).set({ "Content-Type": "text/html" }).send(indexHtml);
});

app.listen(port, () => {
  console.log(`Frontend server listening on http://localhost:${port}`);
});
