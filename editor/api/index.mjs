import app from "../src/worker.js";

function requestUrl(request) {
  const protocol = request.headers["x-forwarded-proto"] || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  const original = request.headers["x-vercel-original-url"] || request.url;
  return new URL(original, `${protocol}://${host}`).toString();
}

function requestBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  if (typeof request.body === "string" || request.body instanceof Uint8Array) return request.body;
  return JSON.stringify(request.body ?? {});
}

export default async function handler(request, response) {
  const webRequest = new Request(requestUrl(request), {
    method: request.method,
    headers: request.headers,
    body: requestBody(request)
  });
  const webResponse = await app.fetch(webRequest, process.env);

  response.statusCode = webResponse.status;
  for (const [key, value] of webResponse.headers) {
    if (key !== "set-cookie") response.setHeader(key, value);
  }
  const cookies = webResponse.headers.getSetCookie?.() || [];
  if (cookies.length) response.setHeader("Set-Cookie", cookies);
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}
