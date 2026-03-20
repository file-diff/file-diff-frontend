const SSR_HEALTH_STYLESHEET_PATH = "/ssr-health.css";

interface SSRHealthData {
  status: "healthy" | "reachable" | "error";
  message: string;
  healthEndpoint: string;
  versionEndpoint: string;
  healthStatus?: number;
  versionStatus?: number;
  backendVersion?: string;
  checkedAt: string;
  durationMs: number;
}

export default function SSRHealthPage({ data }: { data: SSRHealthData }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>SSR Health Check - Git Diff Online</title>
        <link
          rel="icon"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌳</text></svg>"
        />
        <link rel="stylesheet" href={SSR_HEALTH_STYLESHEET_PATH} />
      </head>
      <body>
        <div className="ssr-health-page">
          <div className="page-header">
            <h1>🩺 SSR Health Check</h1>
            <p className="page-subtitle">
              This page is rendered entirely on the server. The backend health
              data was fetched server-side and embedded into the HTML response.
            </p>
            <span className="ssr-badge">Server-Side Rendered</span>
          </div>

          <div className="health-card">
            <div className="health-config">
              <div>
                <span className="health-label">Health endpoint</span>
                <code>{data.healthEndpoint}</code>
              </div>
              <div>
                <span className="health-label">Version endpoint</span>
                <code>{data.versionEndpoint}</code>
              </div>
            </div>

            <div className={`health-status health-status--${data.status}`}>
              <h2>
                {data.status === "healthy" && "Healthy"}
                {data.status === "reachable" && "Backend failed"}
                {data.status === "error" && "Unavailable"}
              </h2>
              <p>{data.message}</p>
              <dl className="health-details">
                <div>
                  <dt>Health endpoint</dt>
                  <dd>{data.healthEndpoint}</dd>
                </div>
                {typeof data.healthStatus === "number" && (
                  <div>
                    <dt>Health status</dt>
                    <dd>{data.healthStatus}</dd>
                  </div>
                )}
                <div>
                  <dt>Version endpoint</dt>
                  <dd>{data.versionEndpoint}</dd>
                </div>
                {typeof data.versionStatus === "number" && (
                  <div>
                    <dt>Version status</dt>
                    <dd>{data.versionStatus}</dd>
                  </div>
                )}
                {data.backendVersion && (
                  <div>
                    <dt>Backend version</dt>
                    <dd>{data.backendVersion}</dd>
                  </div>
                )}
                <div>
                  <dt>Checked at</dt>
                  <dd>{data.checkedAt}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{data.durationMs} ms</dd>
                </div>
              </dl>
              <p className="health-note">
                This health check was performed server-side. A non-2xx response
                still proves the service answered the request.
              </p>
            </div>
          </div>

          <a href="/" className="back-link">
            ← Back to application
          </a>
        </div>
      </body>
    </html>
  );
}
