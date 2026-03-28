import { useCallback, useEffect, useState } from "react";
import {
  CACHE_API_URL,
  DEFAULT_API_BASE_URL,
  HEALTH_API_URL,
  STATS_API_URL,
  VERSION_API_URL,
} from "../config/api";
import "./HealthCheckPage.css";

type BackendCheckState = "idle" | "loading" | "healthy" | "reachable" | "error";

interface BackendCheckResult {
  backendVersion?: string;
  checkedAt: string;
  durationMs: number;
  github?: GitHubHealthInfo;
  healthStatus?: number;
  message: string;
  state: BackendCheckState;
  versionStatus?: number;
}

interface GitHubRateLimitInfo {
  limit?: number;
  remaining?: number;
  reset?: number;
  resource?: string;
  used?: number;
}

interface GitHubHealthInfo {
  configured?: boolean;
  rateLimit?: GitHubRateLimitInfo;
  status?: string;
}

interface CacheFolder {
  name: string;
  size: number;
}

interface CacheData {
  count: number;
  totalSize: number;
  folders: CacheFolder[];
}

interface StatsData {
  jobsStored: number;
  filesStored: number;
  sizeStored: number;
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatVersionPayload(payload: unknown): string | undefined {
  const stringPayload = asTrimmedString(payload);

  if (stringPayload) {
    return stringPayload;
  }

  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const versionParts = [
    asTrimmedString(record.version),
    asTrimmedString(record.buildVersion),
    asTrimmedString(record.tag),
  ].filter((value): value is string => Boolean(value));
  const commit = asTrimmedString(record.commit);

  if (commit) {
    versionParts.push(`(${commit})`);
  }

  if (versionParts.length > 0) {
    return versionParts.join(" ");
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return undefined;
  }
}

async function parseVersionResponse(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type") ?? "";

  try {
    const responseText = await response.text();

    if (contentType.includes("application/json")) {
      return formatVersionPayload(JSON.parse(responseText) as unknown);
    }

    return formatVersionPayload(responseText);
  } catch {
    return undefined;
  }
}

function parseHealthPayload(payload: unknown): GitHubHealthInfo | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const github = (payload as Record<string, unknown>).github;

  if (!github || typeof github !== "object") {
    return undefined;
  }

  const githubRecord = github as Record<string, unknown>;
  const rawRateLimit = githubRecord.rateLimit;
  let rateLimit: GitHubRateLimitInfo | undefined;

  if (rawRateLimit && typeof rawRateLimit === "object") {
    const rateLimitRecord = rawRateLimit as Record<string, unknown>;
    const parsedRateLimit: GitHubRateLimitInfo = {
      limit: asFiniteNumber(rateLimitRecord.limit),
      remaining: asFiniteNumber(rateLimitRecord.remaining),
      reset: asFiniteNumber(rateLimitRecord.reset),
      resource: asTrimmedString(rateLimitRecord.resource),
      used: asFiniteNumber(rateLimitRecord.used),
    };

    if (
      typeof parsedRateLimit.limit === "number" ||
      typeof parsedRateLimit.remaining === "number" ||
      typeof parsedRateLimit.reset === "number" ||
      typeof parsedRateLimit.used === "number" ||
      parsedRateLimit.resource
    ) {
      rateLimit = parsedRateLimit;
    }
  }

  const healthInfo: GitHubHealthInfo = {
    configured: asBoolean(githubRecord.configured),
    rateLimit,
    status: asTrimmedString(githubRecord.status),
  };

  if (
    healthInfo.configured === undefined &&
    !healthInfo.status &&
    !healthInfo.rateLimit
  ) {
    return undefined;
  }

  return healthInfo;
}

async function parseHealthResponse(
  response: Response
): Promise<GitHubHealthInfo | undefined> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return undefined;
  }

  try {
    return parseHealthPayload((await response.json()) as unknown);
  } catch {
    return undefined;
  }
}

function formatRelativeTime(targetTimeMs: number): string {
  const diffSeconds = Math.round((targetTimeMs - Date.now()) / 1000);
  const absoluteSeconds = Math.abs(diffSeconds);

  if (absoluteSeconds < 60) {
    return relativeTimeFormatter.format(diffSeconds, "second");
  }

  if (absoluteSeconds < 60 * 60) {
    return relativeTimeFormatter.format(Math.round(diffSeconds / 60), "minute");
  }

  if (absoluteSeconds < 60 * 60 * 24) {
    return relativeTimeFormatter.format(
      Math.round(diffSeconds / (60 * 60)),
      "hour"
    );
  }

  return relativeTimeFormatter.format(
    Math.round(diffSeconds / (60 * 60 * 24)),
    "day"
  );
}

function formatRateLimitReset(resetAtUnixSeconds: number): string {
  const resetAt = new Date(resetAtUnixSeconds * 1000);
  return `${formatRelativeTime(resetAt.getTime())} (${resetAt.toLocaleString()})`;
}

function describeSettledError(result: PromiseSettledResult<Response>): string {
  if (result.status === "rejected") {
    return "Failed to fetch";
  }
  return `HTTP ${String(result.value.status)}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

export default function HealthCheckPage() {
  const [isChecking, setIsChecking] = useState(true);
  const [result, setResult] = useState<BackendCheckResult | null>(null);
  const [cacheData, setCacheData] = useState<CacheData | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [statsData, setStatsData] = useState<StatsData | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    const startedAt = performance.now();

    setCacheData(null);
    setCacheError(null);
    setStatsData(null);
    setStatsError(null);

    try {
      const [healthResult, versionResult, cacheResult, statsResult] =
        await Promise.allSettled([
          fetch(HEALTH_API_URL, {
            headers: {
              Accept: "application/json, text/plain, */*",
            },
          }),
          fetch(VERSION_API_URL, {
            headers: {
              Accept: "application/json, text/plain, */*",
            },
          }),
          fetch(CACHE_API_URL, {
            headers: { Accept: "application/json" },
          }),
          fetch(STATS_API_URL, {
            headers: { Accept: "application/json" },
          }),
        ]);
      const healthResponse =
        healthResult.status === "fulfilled" ? healthResult.value : undefined;
      const versionResponse =
        versionResult.status === "fulfilled" ? versionResult.value : undefined;
      const github = healthResponse
        ? await parseHealthResponse(healthResponse)
        : undefined;
      const backendVersion = versionResponse?.ok
        ? await parseVersionResponse(versionResponse)
        : undefined;
      const isHealthy = Boolean(healthResponse?.ok);
      const isReachable = Boolean(healthResponse || versionResponse);
      const durationMs = Math.round(performance.now() - startedAt);
      const rejectedResults = [healthResult, versionResult].filter(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      const networkMessage = rejectedResults
        .map((result) =>
          result.reason instanceof Error ? result.reason.message : "Failed to fetch"
        )
        .join(" | ");

      setResult({
        backendVersion,
        checkedAt: new Date().toLocaleString(),
        durationMs,
        github,
        healthStatus: healthResponse?.status,
        message: isHealthy
          ? versionResponse?.ok
            ? "The public health and version endpoints both responded successfully."
            : "The public health endpoint responded successfully."
          : isReachable
            ? "The backend is reachable, but at least one healthcheck endpoint did not return a success response."
            : networkMessage || "Failed to fetch",
        state: isHealthy ? "healthy" : isReachable ? "reachable" : "error",
        versionStatus: versionResponse?.status,
      });

      // Process cache response
      if (cacheResult.status === "fulfilled" && cacheResult.value.ok) {
        try {
          setCacheData((await cacheResult.value.json()) as CacheData);
        } catch {
          setCacheError("Failed to parse cache response");
        }
      } else {
        setCacheError(describeSettledError(cacheResult));
      }

      // Process stats response
      if (statsResult.status === "fulfilled" && statsResult.value.ok) {
        try {
          setStatsData((await statsResult.value.json()) as StatsData);
        } catch {
          setStatsError("Failed to parse stats response");
        }
      } else {
        setStatsError(describeSettledError(statsResult));
      }
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      const message =
        error instanceof Error
          ? error.message
          : "Unknown error while contacting the public backend health endpoints.";

      setResult({
        checkedAt: new Date().toLocaleString(),
        durationMs,
        message,
        state: "error",
      });
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    const executeInitialCheck = async () => {
      await runCheck();
    };

    void executeInitialCheck();
  }, [runCheck]);

  return (
    <div className="health-check-page">
      <div className="page-header">
        <h1>🩺 Backend Check</h1>
        <p className="page-subtitle">
          Use this page to confirm whether the public backend health endpoints
          are reachable from your browser.
        </p>
      </div>

      <div className="health-check-card">
        <div className="health-check-config">
          <div>
            <span className="health-check-label">Default API base</span>
            <code>{DEFAULT_API_BASE_URL}</code>
          </div>
          <div>
            <span className="health-check-label">Health endpoint</span>
            <code>{HEALTH_API_URL}</code>
          </div>
          <div>
            <span className="health-check-label">Version endpoint</span>
            <code>{VERSION_API_URL}</code>
          </div>
        </div>

        <div className="health-check-actions">
          <button
            type="button"
            onClick={() => {
              setIsChecking(true);
              setResult(null);
              void runCheck();
            }}
          >
            Run check again
          </button>
        </div>

        {isChecking && !result && (
          <div className="health-check-status health-check-status--loading">
            Checking the public health endpoints…
          </div>
        )}

        {result && (
          <div
            className={`health-check-status health-check-status--${result.state}`}
          >
            <h2>
              {result.state === "healthy" && "Healthy"}
              {result.state === "reachable" && "Backend failed"}
              {result.state === "error" && "Unavailable"}
            </h2>
            <p>{result.message}</p>
            <dl className="health-check-details">
              <div>
                <dt>Health endpoint</dt>
                <dd>{HEALTH_API_URL}</dd>
              </div>
              {typeof result.healthStatus === "number" && (
                <div>
                  <dt>Health status</dt>
                  <dd>{result.healthStatus}</dd>
                </div>
              )}
              <div>
                <dt>Version endpoint</dt>
                <dd>{VERSION_API_URL}</dd>
              </div>
              {typeof result.versionStatus === "number" && (
                <div>
                  <dt>Version status</dt>
                  <dd>{result.versionStatus}</dd>
                </div>
              )}
              {result.backendVersion && (
                <div>
                  <dt>Backend version</dt>
                  <dd>{result.backendVersion}</dd>
                </div>
              )}
              {result.github?.configured !== undefined && (
                <div>
                  <dt>GitHub configured</dt>
                  <dd>{result.github.configured ? "Yes" : "No"}</dd>
                </div>
              )}
              {result.github?.status && (
                <div>
                  <dt>GitHub status</dt>
                  <dd>{result.github.status}</dd>
                </div>
              )}
              {result.github?.rateLimit && (
                <div>
                  <dt>GitHub rate limit</dt>
                  <dd>
                    {typeof result.github.rateLimit.remaining === "number" &&
                    typeof result.github.rateLimit.limit === "number"
                      ? `${result.github.rateLimit.remaining.toLocaleString()} / ${result.github.rateLimit.limit.toLocaleString()} available`
                      : "Available"}
                    {(result.github.rateLimit.resource ||
                      typeof result.github.rateLimit.used === "number" ||
                      typeof result.github.rateLimit.reset === "number") && (
                      <span className="health-check-detail-secondary">
                        {result.github.rateLimit.resource && (
                          <span>
                            resource: {result.github.rateLimit.resource}
                          </span>
                        )}
                        {result.github.rateLimit.resource &&
                          typeof result.github.rateLimit.used === "number" &&
                          " · "}
                        {typeof result.github.rateLimit.used === "number" && (
                          <span>
                            used:{" "}
                            {result.github.rateLimit.used.toLocaleString()}
                          </span>
                        )}
                        {typeof result.github.rateLimit.reset === "number" && (
                          <>
                            {(result.github.rateLimit.resource ||
                              typeof result.github.rateLimit.used ===
                                "number") &&
                              " · "}
                            <span>
                              resets {formatRateLimitReset(result.github.rateLimit.reset)}
                            </span>
                          </>
                        )}
                      </span>
                    )}
                  </dd>
                </div>
              )}
              <div>
                <dt>Checked at</dt>
                <dd>{result.checkedAt}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{result.durationMs} ms</dd>
              </div>
            </dl>
            <p className="health-check-note">
              A non-2xx response still proves the service answered the request,
              and the version endpoint is included as additional backend build
              information when available.
            </p>
          </div>
        )}
      </div>

      {(statsData || statsError) && (
        <div className="health-check-card health-check-stats-card">
          <h2>📊 Storage Statistics</h2>
          {statsError ? (
            <p className="health-check-stats-error">
              Unable to load storage statistics: {statsError}
            </p>
          ) : statsData ? (
            <dl className="health-check-details">
              <div>
                <dt>Jobs stored</dt>
                <dd>{statsData.jobsStored.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Files stored</dt>
                <dd>{statsData.filesStored.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Total size stored</dt>
                <dd>{formatBytes(statsData.sizeStored)}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      )}

      {(cacheData || cacheError) && (
        <div className="health-check-card health-check-stats-card">
          <h2>🗂️ Git Cache</h2>
          {cacheError ? (
            <p className="health-check-stats-error">
              Unable to load cache data: {cacheError}
            </p>
          ) : cacheData ? (
            <>
              <dl className="health-check-details">
                <div>
                  <dt>Cache folders</dt>
                  <dd>{cacheData.count.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Total cache size</dt>
                  <dd>{formatBytes(cacheData.totalSize)}</dd>
                </div>
              </dl>
              {cacheData.folders.length > 0 && (
                <table className="health-check-cache-table">
                  <thead>
                    <tr>
                      <th>Folder name</th>
                      <th>Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cacheData.folders.map((folder) => (
                      <tr key={folder.name}>
                        <td>
                          <code>{folder.name}</code>
                        </td>
                        <td>{formatBytes(folder.size)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : null}
        </div>
      )}

    </div>
  );
}
