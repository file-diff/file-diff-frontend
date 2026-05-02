import express from "express";
import { rateLimit } from "express-rate-limit";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "redis";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = parseInt(process.env.PORT || "3000", 10);
const apiBaseUrl = (
  process.env.API_BASE_URL || "https://filediff.org/api"
).replace(/\/+$/, "");
const redisUrl = process.env.REDIS_URL?.trim();
const ssrHealthCacheKey = `ssr-health:${Buffer.from(apiBaseUrl).toString(
  "base64url"
)}`;
const ssrHealthCacheTtlSeconds = 10;
const codexStatsTimeoutMs = 30_000;
const codexStatsCommand = "npx";
const codexStatsArgs = [
  "-y",
  "@ccusage/codex@latest",
  "daily",
  "--compact",
  "--noColor",
];
const ansiPattern =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

const clientDir = resolve(__dirname, "dist/client");
const indexHtml = readFileSync(resolve(clientDir, "index.html"), "utf-8");

/** @type {{ render: (apiBaseUrl: string) => Promise<string> }} */
const ssrModule = await import("./dist/server/entry-server.js");

/** @type {import("redis").RedisClientType | undefined} */
let redisClient;

if (redisUrl) {
  try {
    redisClient = createClient({ url: redisUrl });
    redisClient.on("error", (err) => {
      console.warn("Redis cache error:", err);
    });
    await redisClient.connect();
    console.log("Redis cache connected");
  } catch (err) {
    console.warn("Redis unavailable, SSR cache disabled:", err);
    redisClient = undefined;
  }
}

const app = express();
const ssrHealthRateLimiter = rateLimit({
  windowMs: 10_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

function runCodexStats() {
  return new Promise((resolve, reject) => {
    const child = spawn(codexStatsCommand, codexStatsArgs, {
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (callback) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      callback();
    };

    const timeoutHandle = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => {
        reject({
          message: `Timed out after ${codexStatsTimeoutMs} ms while generating Codex usage stats.`,
          statusCode: 504,
        });
      });
    }, codexStatsTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finish(() => {
        reject({
          message:
            error.code === "ENOENT"
              ? "The Codex usage analyzer is unavailable because `npx` is not installed."
              : `Failed to start the Codex usage analyzer: ${error.message}`,
          statusCode: 503,
        });
      });
    });

    child.on("close", (code) => {
      finish(() => {
        const trimmedStdout = stdout.replace(ansiPattern, "").trimEnd();
        const trimmedStderr = stderr.replace(ansiPattern, "").trim();

        if (code === 0) {
          resolve(trimmedStdout || "No Codex usage data available.");
          return;
        }

        const detail = trimmedStderr || trimmedStdout || `Process exited with code ${String(code)}.`;
        reject({
          message: `Failed to generate Codex usage stats.\n\n${detail}`,
          statusCode: 502,
        });
      });
    });
  });
}

// Serve static client assets (do not serve index.html for /)
app.use(express.static(clientDir, { index: false }));

app.get("/api/codex/stats", async (_req, res) => {
  try {
    const output = await runCodexStats();
    res
      .status(200)
      .set({ "Content-Type": "text/plain; charset=utf-8" })
      .send(output);
  } catch (error) {
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    const message =
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : "Failed to generate Codex usage stats.";

    console.error("Codex stats error:", error);
    res
      .status(statusCode)
      .set({ "Content-Type": "text/plain; charset=utf-8" })
      .send(message);
  }
});

// SSR-rendered health page
app.get("/ssr-health", ssrHealthRateLimiter, async (_req, res) => {
  try {
    if (redisClient?.isReady) {
      try {
        const cachedHtml = await redisClient.get(ssrHealthCacheKey);
        if (cachedHtml) {
          res.status(200).set({ "Content-Type": "text/html" }).send(cachedHtml);
          return;
        }
      } catch (err) {
        console.warn("Failed to read SSR health cache:", err);
      }
    }

    const html = await ssrModule.render(apiBaseUrl);

    if (redisClient?.isReady) {
      try {
        await redisClient.set(ssrHealthCacheKey, html, {
          EX: ssrHealthCacheTtlSeconds,
        });
      } catch (err) {
        console.warn("Failed to write SSR health cache:", err);
      }
    }

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
