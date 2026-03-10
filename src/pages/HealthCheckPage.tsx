import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_API_BASE_URL,
  HEALTH_API_URL,
  VERSION_API_URL,
} from "../config/api";
import "./HealthCheckPage.css";

type BackendCheckState = "idle" | "loading" | "healthy" | "reachable" | "error";

interface BackendCheckResult {
  backendVersion?: string;
  checkedAt: string;
  durationMs: number;
  healthStatus?: number;
  message: string;
  state: BackendCheckState;
  versionStatus?: number;
}

function formatVersionPayload(payload: unknown): string | undefined {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed || undefined;
  }

  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const versionParts = [
    record.version,
    record.buildVersion,
    record.tag,
    record.commit && `(${record.commit})`,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

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

  if (contentType.includes("application/json")) {
    return formatVersionPayload((await response.json()) as unknown);
  }

  return formatVersionPayload(await response.text());
}

export default function HealthCheckPage() {
  const [isChecking, setIsChecking] = useState(true);
  const [result, setResult] = useState<BackendCheckResult | null>(null);

  const runCheck = useCallback(async () => {
    const startedAt = performance.now();

    try {
      const [healthResponse, versionResponse] = await Promise.all([
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
      ]);
      const backendVersion = versionResponse.ok
        ? await parseVersionResponse(versionResponse)
        : undefined;
      const isHealthy = healthResponse.ok && versionResponse.ok;
      const durationMs = Math.round(performance.now() - startedAt);

      setResult({
        backendVersion,
        checkedAt: new Date().toLocaleString(),
        durationMs,
        healthStatus: healthResponse.status,
        message: isHealthy
          ? "The public health and version endpoints both responded successfully."
          : "The backend is reachable, but at least one healthcheck endpoint did not return a success response.",
        state: isHealthy ? "healthy" : "reachable",
        versionStatus: versionResponse.status,
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
              {result.backendVersion && (
                <div>
                  <dt>Backend version</dt>
                  <dd>{result.backendVersion}</dd>
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
              but a healthy result requires both the health and version
              endpoints to succeed.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
