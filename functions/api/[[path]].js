export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const targetUrl = `http://65.109.154.126:12986${url.pathname}${url.search}`;

  // 1. Prepare the proxy request
  const proxyRequest = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'manual'
  });

  // 2. Force the Host header (Backend servers often 405 if this is wrong)
  proxyRequest.headers.set("Host", "65.109.154.126:12986");

  try {
    const response = await fetch(proxyRequest);

    // If the response is an error (405, 404, 500), let's intercept it for debugging
    if (!response.ok && response.status === 405) {
      const errorData = {
        debug_message: "Your backend server returned a 405 Method Not Allowed.",
        attempted_url: targetUrl,
        sent_method: request.method,
        sent_headers: Object.fromEntries(proxyRequest.headers),
        received_status: response.status,
        received_headers: Object.fromEntries(response.headers)
      };

      return new Response(JSON.stringify(errorData, null, 2), {
        status: 405,
        headers: { "Content-Type": "application/json" }
      });
    }

    return response;

  } catch (err) {
    // This catches connection timeouts or refused connections
    return new Response(JSON.stringify({
      error: "Cloudflare could not reach your IP/Port",
      details: err.message,
      target: targetUrl
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}