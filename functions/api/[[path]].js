const API_PROXY_BASE_URL = "http://65.109.154.126:12986";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const targetUrl = `http://65.109.154.126:12986${url.pathname}${url.search}`;

  // Create a new request based on the original one
  // This ensures Method (POST), Headers, and Body are preserved
  const newRequest = new Request(targetUrl, context.request);

  // CRITICAL: Some backends reject requests if the Host header
  // doesn't match the destination IP/Port.
  newRequest.headers.set("Host", "65.109.154.126:12986");

  try {
    return await fetch(newRequest);
  } catch (err) {
    return new Response(`Proxy Error: ${err.message}`, { status: 502 });
  }
}