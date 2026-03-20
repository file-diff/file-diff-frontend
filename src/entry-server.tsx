import { renderToString } from "react-dom/server";
import SSRHealthPage from "./pages/SSRHealthPage";

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function formatVersionPayload(payload: unknown): string | undefined {
  const stringPayload = asTrimmedString(payload);
  if (stringPayload) return stringPayload;

  if (!payload || typeof payload !== "object") return undefined;

  const record = payload as Record<string, unknown>;
  const versionParts = [
    asTrimmedString(record.version),
    asTrimmedString(record.buildVersion),
    asTrimmedString(record.tag),
  ].filter((value): value is string => Boolean(value));
  const commit = asTrimmedString(record.commit);

  if (commit) versionParts.push(`(${commit})`);
  if (versionParts.length > 0) return versionParts.join(" ");

  try {
    return JSON.stringify(payload);
  } catch {
    return undefined;
  }
}

async function parseVersionResponse(
  response: Response
): Promise<string | undefined> {
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

export async function render(apiBaseUrl: string): Promise<string> {
  const healthUrl = `${apiBaseUrl}/health`;
  const versionUrl = `${apiBaseUrl}/version`;

  const startTime = Date.now();

  const [healthResult, versionResult] = await Promise.allSettled([
    fetch(healthUrl, {
      headers: { Accept: "application/json, text/plain, */*" },
    }),
    fetch(versionUrl, {
      headers: { Accept: "application/json, text/plain, */*" },
    }),
  ]);

  const durationMs = Date.now() - startTime;

  const healthResponse =
    healthResult.status === "fulfilled" ? healthResult.value : undefined;
  const versionResponse =
    versionResult.status === "fulfilled" ? versionResult.value : undefined;

  const backendVersion = versionResponse?.ok
    ? await parseVersionResponse(versionResponse)
    : undefined;

  const isHealthy = Boolean(healthResponse?.ok);
  const isReachable = Boolean(healthResponse || versionResponse);

  const rejectedResults = [healthResult, versionResult].filter(
    (r): r is PromiseRejectedResult => r.status === "rejected"
  );
  const networkMessage = rejectedResults
    .map((r) =>
      r.reason instanceof Error ? r.reason.message : "Failed to fetch"
    )
    .join(" | ");

  const status = isHealthy ? "healthy" : isReachable ? "reachable" : "error";
  const message = isHealthy
    ? versionResponse?.ok
      ? "The public health and version endpoints both responded successfully."
      : "The public health endpoint responded successfully."
    : isReachable
      ? "The backend is reachable, but at least one healthcheck endpoint did not return a success response."
      : networkMessage || "Failed to fetch";

  const data = {
    status: status as "healthy" | "reachable" | "error",
    message,
    healthEndpoint: healthUrl,
    versionEndpoint: versionUrl,
    healthStatus: healthResponse?.status,
    versionStatus: versionResponse?.status,
    backendVersion,
    checkedAt: new Date().toISOString(),
    durationMs,
  };

  const html = renderToString(<SSRHealthPage data={data} />);
  return `<!DOCTYPE html>\n${html}`;
}
