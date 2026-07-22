import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/index.mjs";

function invoke(request) {
  return new Promise((resolve) => {
    const headers = new Map();
    const response = {
      statusCode: 200,
      setHeader(name, value) { headers.set(name.toLowerCase(), value); },
      end(body) { resolve({ status: this.statusCode, headers, body: Buffer.from(body).toString("utf8") }); }
    };
    handler(request, response);
  });
}

test("Vercel adapter preserves the original auth route and JSON response", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  const previousLogins = process.env.ALLOWED_LOGINS;
  process.env.SESSION_SECRET = "test-only";
  process.env.ALLOWED_LOGINS = "writer";
  try {
    const result = await invoke({
      method: "GET",
      url: "/api/index",
      headers: {
        host: "editor.example",
        "x-forwarded-proto": "https",
        "x-vercel-original-url": "/auth/me"
      }
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(JSON.parse(result.body), { authenticated: false });
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
    if (previousLogins === undefined) delete process.env.ALLOWED_LOGINS;
    else process.env.ALLOWED_LOGINS = previousLogins;
  }
});
