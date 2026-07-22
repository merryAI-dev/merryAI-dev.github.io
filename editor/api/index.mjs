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

function requestHeaders(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers || {})) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, String(value));
  }
  return headers;
}

export default async function handler(request, response) {
  try {
    const webRequest = new Request(requestUrl(request), {
      method: request.method,
      headers: requestHeaders(request),
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
  } catch (error) {
    console.error("Vercel adapter failure", error instanceof Error ? error.stack : String(error));
    response.statusCode = 500;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify({ error: "잠시 문제가 생겼어요. 다시 시도해주세요." }));
  }
}
