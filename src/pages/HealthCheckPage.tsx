import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_API_BASE_URL,
  HEALTH_API_URL,
  JOBS_CACHE_API_URL,
  STATS_API_URL,
  VERSION_API_URL,
} from "../config/api";
import "./HealthCheckPage.css";

type BackendCheckState = "idle" | "loading" | "healthy" | "reachable" | "error";

interface BackendCheckResult {
  backendVersion?: string;
  checkedAt: string;
  jobsCache?: JobsCacheSummary;
  cacheStatus?: number;
  durationMs: number;
  healthStatus?: number;
  message: string;
  state: BackendCheckState;
  stats?: StorageStatsSummary;
  statsStatus?: number;
  versionStatus?: number;
}

interface CacheFolderSize {
  name: string;
  size: number;
}

interface JobsCacheSummary {
  count: number;
  totalSize: number;
  folders: CacheFolderSize[];
}

interface StorageStatsSummary {
  jobsStored: number;
  filesStored: number;
  sizeStored: number;
}

const BYTES_PER_UNIT = 1024;
const BYTE_PRECISION_THRESHOLD = 10;

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
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

function parseFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseJobsCacheSummary(payload: unknown): JobsCacheSummary | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const count = parseFiniteNumber(record.count);
  const totalSize = parseFiniteNumber(record.totalSize);
  const folders = Array.isArray(record.folders)
    ? record.folders
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return undefined;
          }

          const folder = entry as Record<string, unknown>;
          const name = asTrimmedString(folder.name);
          const size = parseFiniteNumber(folder.size);

          if (!name || typeof size !== "number") {
            return undefined;
          }

          return { name, size };
        })
        .filter((entry): entry is CacheFolderSize => Boolean(entry))
    : undefined;

  if (
    typeof count !== "number" ||
    typeof totalSize !== "number" ||
    !Array.isArray(folders)
  ) {
    return undefined;
  }

  return { count, totalSize, folders };
}

function parseStorageStatsSummary(payload: unknown): StorageStatsSummary | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const jobsStored = parseFiniteNumber(record.jobsStored);
  const filesStored = parseFiniteNumber(record.filesStored);
  const sizeStored = parseFiniteNumber(record.sizeStored);

  if (
    typeof jobsStored !== "number" ||
    typeof filesStored !== "number" ||
    typeof sizeStored !== "number"
  ) {
    return undefined;
  }

  return { jobsStored, filesStored, sizeStored };
}

async function parseJsonResponse<T>(
  response: Response,
  parsePayload: (payload: unknown) => T | undefined
): Promise<T | undefined> {
  try {
    const responseText = await response.text();
    return parsePayload(JSON.parse(responseText) as unknown);
  } catch {
    return undefined;
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let normalizedValue = value;
  let unitIndex = 0;

  while (
    Math.abs(normalizedValue) >= BYTES_PER_UNIT &&
    unitIndex < units.length - 1
  ) {
    normalizedValue /= BYTES_PER_UNIT;
    unitIndex += 1;
  }

  const formattedValue =
    unitIndex === 0
      ? formatNumber(normalizedValue)
      : new Intl.NumberFormat(undefined, {
          maximumFractionDigits:
            normalizedValue >= BYTE_PRECISION_THRESHOLD ? 1 : 2,
        }).format(normalizedValue);

  return unitIndex === 0
    ? `${formattedValue} B`
    : `${formattedValue} ${units[unitIndex]} (${formatNumber(value)} B)`;
}

export default function HealthCheckPage() {
  const [isChecking, setIsChecking] = useState(true);
  const [result, setResult] = useState<BackendCheckResult | null>(null);

  const runCheck = useCallback(async () => {
    const startedAt = performance.now();

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
        fetch(JOBS_CACHE_API_URL, {
          headers: {
            Accept: "application/json, text/plain, */*",
          },
        }),
        fetch(STATS_API_URL, {
          headers: {
            Accept: "application/json, text/plain, */*",
          },
        }),
      ]);
      const healthResponse =
        healthResult.status === "fulfilled" ? healthResult.value : undefined;
      const versionResponse =
        versionResult.status === "fulfilled" ? versionResult.value : undefined;
      const cacheResponse =
        cacheResult.status === "fulfilled" ? cacheResult.value : undefined;
      const statsResponse =
        statsResult.status === "fulfilled" ? statsResult.value : undefined;
      const backendVersion = versionResponse?.ok
        ? await parseVersionResponse(versionResponse)
        : undefined;
      const jobsCache = cacheResponse?.ok
        ? await parseJsonResponse(cacheResponse, parseJobsCacheSummary)
        : undefined;
      const stats = statsResponse?.ok
        ? await parseJsonResponse(statsResponse, parseStorageStatsSummary)
        : undefined;
      const isHealthy = Boolean(healthResponse?.ok);
      const isReachable = Boolean(
        healthResponse || versionResponse || cacheResponse || statsResponse
      );
      const supplementalEndpointsHealthy = Boolean(
        versionResponse?.ok && cacheResponse?.ok && statsResponse?.ok
      );
      const durationMs = Math.round(performance.now() - startedAt);
      const rejectedResults = [
        healthResult,
        versionResult,
        cacheResult,
        statsResult,
      ].filter(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      const networkMessage = rejectedResults
        .map((result) =>
          result.reason instanceof Error ? result.reason.message : "Failed to fetch"
        )
        .join(" | ");

      setResult({
        backendVersion,
        cacheStatus: cacheResponse?.status,
        checkedAt: new Date().toLocaleString(),
        durationMs,
        healthStatus: healthResponse?.status,
        message: isHealthy
          ? supplementalEndpointsHealthy
            ? "The public health, version, cache, and stats endpoints all responded successfully."
            : "The public health endpoint responded successfully, but at least one additional version, cache, or stats endpoint did not return a success response."
          : isReachable
            ? "The backend is reachable, but at least one health, version, cache, or stats endpoint did not return a success response."
            : networkMessage || "Failed to fetch",
        jobsCache,
        state: isHealthy ? "healthy" : isReachable ? "reachable" : "error",
        stats,
        statsStatus: statsResponse?.status,
        versionStatus: versionResponse?.status,
      });
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
          <div>
            <span className="health-check-label">Jobs cache endpoint</span>
            <code>{JOBS_CACHE_API_URL}</code>
          </div>
          <div>
            <span className="health-check-label">Stats endpoint</span>
            <code>{STATS_API_URL}</code>
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
              {result.state === "reachable" && "Reachable"}
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
              <div>
                <dt>Jobs cache endpoint</dt>
                <dd>{JOBS_CACHE_API_URL}</dd>
              </div>
              {typeof result.cacheStatus === "number" && (
                <div>
                  <dt>Cache status</dt>
                  <dd>{result.cacheStatus}</dd>
                </div>
              )}
              {result.backendVersion && (
                <div>
                  <dt>Backend version</dt>
                  <dd>{result.backendVersion}</dd>
                </div>
              )}
              <div>
                <dt>Stats endpoint</dt>
                <dd>{STATS_API_URL}</dd>
              </div>
              {typeof result.statsStatus === "number" && (
                <div>
                  <dt>Stats status</dt>
                  <dd>{result.statsStatus}</dd>
                </div>
              )}
              {result.jobsCache && (
                <>
                  <div>
                    <dt>Cache folders</dt>
                    <dd>{formatNumber(result.jobsCache.count)}</dd>
                  </div>
                  <div>
                    <dt>Cache size</dt>
                    <dd>{formatBytes(result.jobsCache.totalSize)}</dd>
                  </div>
                </>
              )}
              {result.stats && (
                <>
                  <div>
                    <dt>Jobs stored</dt>
                    <dd>{formatNumber(result.stats.jobsStored)}</dd>
                  </div>
                  <div>
                    <dt>Files stored</dt>
                    <dd>{formatNumber(result.stats.filesStored)}</dd>
                  </div>
                  <div>
                    <dt>Stored size</dt>
                    <dd>{formatBytes(result.stats.sizeStored)}</dd>
                  </div>
                </>
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
            {result.jobsCache && (
              <div className="health-check-section">
                <h3>Git cache folders on disk</h3>
                {result.jobsCache.folders.length > 0 ? (
                  <ul className="health-check-folder-list">
                    {result.jobsCache.folders.map((folder) => (
                      <li key={folder.name}>
                        <code>{folder.name}</code>
                        <span>{formatBytes(folder.size)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="health-check-empty">No cache folders reported.</p>
                )}
              </div>
            )}
            <p className="health-check-note">
              A non-2xx response still proves the service answered the request,
              and the version, cache, and storage statistics are included when
              those endpoints provide valid data.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
