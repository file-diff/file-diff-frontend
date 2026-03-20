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

const PAGE_STYLES = `
  :root { color-scheme: dark; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    background: #121212;
    color: #d4d4d4;
    min-height: 100vh;
  }
  .ssr-health-page { max-width: 820px; margin: 0 auto; padding: 24px; }
  .page-header { margin-bottom: 24px; }
  .page-header h1 { font-size: 1.5rem; color: #e0e0e0; margin-bottom: 8px; }
  .page-subtitle { color: #8b949e; font-size: 0.95rem; line-height: 1.5; }
  .ssr-badge {
    display: inline-block;
    margin-top: 8px;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 600;
    background: rgba(88, 166, 255, 0.15);
    color: #58a6ff;
    border: 1px solid rgba(88, 166, 255, 0.3);
  }
  .health-card {
    padding: 24px;
    border: 1px solid #333;
    border-radius: 12px;
    background: #191a1c;
  }
  .health-config { display: grid; gap: 16px; margin-bottom: 20px; }
  .health-label {
    display: block;
    margin-bottom: 6px;
    color: #8b949e;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .health-config code {
    display: block;
    padding: 10px 12px;
    border: 1px solid #3b4a5a;
    border-radius: 6px;
    background: rgba(88, 166, 255, 0.08);
    color: #7ee787;
    word-break: break-all;
  }
  .health-status {
    padding: 16px;
    border-radius: 8px;
  }
  .health-status h2 { margin: 0 0 8px; color: #e0e0e0; }
  .health-status p { margin: 0; color: #d4d4d4; line-height: 1.5; }
  .health-status--healthy {
    border: 1px solid rgba(46, 160, 67, 0.4);
    background: rgba(46, 160, 67, 0.12);
  }
  .health-status--reachable {
    border: 1px solid rgba(46, 160, 67, 0.4);
    background: rgba(46, 160, 67, 0.12);
  }
  .health-status--error {
    border: 1px solid rgba(218, 54, 51, 0.4);
    background: rgba(218, 54, 51, 0.12);
  }
  .health-details {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin: 16px 0 0;
  }
  .health-details div {
    padding: 10px 12px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.04);
  }
  .health-details dt {
    margin-bottom: 4px;
    color: #8b949e;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .health-details dd { margin: 0; color: #e0e0e0; word-break: break-word; }
  .health-note {
    margin-top: 16px;
    color: #8b949e;
    font-size: 0.85rem;
  }
  .back-link {
    display: inline-block;
    margin-top: 20px;
    color: #58a6ff;
    text-decoration: none;
    font-size: 0.9rem;
  }
  .back-link:hover { text-decoration: underline; }
`;

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
        <style dangerouslySetInnerHTML={{ __html: PAGE_STYLES }} />
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
