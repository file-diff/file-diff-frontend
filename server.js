import express from "express";
import { rateLimit } from "express-rate-limit";
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

// Serve static client assets (do not serve index.html for /)
app.use(express.static(clientDir, { index: false }));

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

    const html = await ssrModule.render(apiBaseUrl, Boolean(redisClient?.isReady));

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
