const API_PROXY_BASE_URL = "http://65.109.154.126:12986";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const proxyUrl = `${API_PROXY_BASE_URL}${url.pathname}${url.search}`;

  return fetch(proxyUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
    redirect: "manual",
  });
}
