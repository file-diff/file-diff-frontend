import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, JOBS_API_URL } from "../config/api";
import "./HealthCheckPage.css";

type BackendCheckState = "idle" | "loading" | "healthy" | "reachable" | "error";

interface BackendCheckResult {
  checkedAt: string;
  durationMs: number;
  message: string;
  state: BackendCheckState;
  status?: number;
  targetUrl: string;
}

export default function HealthCheckPage() {
  const [isChecking, setIsChecking] = useState(true);
  const [result, setResult] = useState<BackendCheckResult | null>(null);

  const runCheck = useCallback(async () => {
    const startedAt = performance.now();

    try {
      const response = await fetch(JOBS_API_URL, {
        headers: {
          Accept: "application/json, text/plain, */*",
        },
      });
      const durationMs = Math.round(performance.now() - startedAt);

      setResult({
        checkedAt: new Date().toLocaleString(),
        durationMs,
        message: response.ok
          ? "The default jobs API responded successfully."
          : "The default jobs API is reachable, but it did not return a success response for this GET check.",
        state: response.ok ? "healthy" : "reachable",
        status: response.status,
        targetUrl: JOBS_API_URL,
      });
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      const message =
        error instanceof Error
          ? error.message
          : "Unknown error while contacting the default backend.";

      setResult({
        checkedAt: new Date().toLocaleString(),
        durationMs,
        message,
        state: "error",
        targetUrl: JOBS_API_URL,
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
          The frontend now defaults to <code>{JOBS_API_URL}</code>. Use this
          page to confirm whether that backend is reachable from your browser.
        </p>
      </div>

      <div className="health-check-card">
        <div className="health-check-config">
          <div>
            <span className="health-check-label">API base</span>
            <code>{API_BASE_URL}</code>
          </div>
          <div>
            <span className="health-check-label">Jobs API</span>
            <code>{JOBS_API_URL}</code>
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
            Checking the default backend…
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
                <dt>Checked URL</dt>
                <dd>{result.targetUrl}</dd>
              </div>
              {typeof result.status === "number" && (
                <div>
                  <dt>HTTP status</dt>
                  <dd>{result.status}</dd>
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
              A non-2xx response still proves the service answered the request.
              This screen is intended as a quick connectivity check for the
              default backend.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
