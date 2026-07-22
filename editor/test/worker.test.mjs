import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { parseFrontmatter, sanitizePostHtml, serializePost, validateImageData, validatePostPath } from "../src/worker.js";
import worker from "../src/worker.js";

test("HTML sanitizer strips scripts, handlers, and javascript URLs", () => {
  const result = sanitizePostHtml('<p onclick="steal()">안녕<script>alert(1)</script><a href="javascript:alert(2)">링크</a><img src="/safe.png" onerror="steal()"></p>');
  assert.equal(result.includes("script"), false);
  assert.equal(result.includes("onclick"), false);
  assert.equal(result.includes("javascript:"), false);
  assert.equal(result.includes("onerror"), false);
  assert.match(result, /src="\/safe.png"/);
});

test("HTML sanitizer keeps only the editor's font classes", () => {
  const result = sanitizePostHtml('<p><span class="text-serif">명조</span><span class="text-mono evil" style="position:fixed">코드</span></p>');
  assert.match(result, /<span class="text-serif">명조<\/span>/);
  assert.match(result, /<span class="text-mono">코드<\/span>/);
  assert.equal(result.includes("evil"), false);
  assert.equal(result.includes("style="), false);
});

test("frontmatter survives a serialize and parse cycle", () => {
  const markdown = serializePost({
    title: "시트를 데이터베이스로 복사하지 않았다",
    description: "설명: 콜론도 안전해야 한다",
    author: "MYSC AX팀",
    date: "2026-07-22",
    series: "Building the Ledger",
    seriesNo: 1,
    tags: ["MYSCube", "Backend"],
    readingTime: 18,
    published: false,
    body: "<p>안녕하세요. <strong>본문</strong>입니다.</p>"
  });
  const parsed = parseFrontmatter(markdown);
  assert.equal(parsed.attributes.title, "시트를 데이터베이스로 복사하지 않았다");
  assert.equal(parsed.attributes.description, "설명: 콜론도 안전해야 한다");
  assert.deepEqual(parsed.attributes.tags, ["MYSCube", "Backend"]);
  assert.equal(parsed.attributes.published, false);
  assert.match(parsed.bodyMarkdown, /<strong>본문<\/strong>/);
});

test("post path validation blocks traversal and arbitrary files", () => {
  assert.equal(validatePostPath("_posts/2026-07-22-safe-post.md"), "_posts/2026-07-22-safe-post.md");
  assert.throws(() => validatePostPath("../_config.yml"), /올바르지 않은 글 경로/);
  assert.throws(() => validatePostPath("_posts/2026-07-22-a.md"), /올바르지 않은 글 경로/);
  assert.throws(() => validatePostPath("assets/script.js"), /올바르지 않은 글 경로/);
});

test("image validation checks file signatures instead of trusting MIME type", () => {
  assert.equal(validateImageData(Uint8Array.of(0x89, 0x50, 0x4e, 0x47), "image/png"), true);
  assert.equal(validateImageData(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0), "image/jpeg"), true);
  assert.throws(() => validateImageData(Uint8Array.of(0x3c, 0x73, 0x76, 0x67), "image/png"), /파일 내용과 이미지 형식/);
  assert.throws(() => validateImageData(Uint8Array.of(0x89, 0x50, 0x4e, 0x47), "image/svg+xml"), /파일 내용과 이미지 형식/);
});

test("auth status is quiet for visitors while protected APIs remain unauthorized", async () => {
  const env = { SESSION_SECRET: "test-only", ALLOWED_LOGINS: "writer" };
  const status = await worker.fetch(new Request("https://editor.example/auth/me"), env);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { authenticated: false });

  const protectedResponse = await worker.fetch(new Request("https://editor.example/api/posts"), env);
  assert.equal(protectedResponse.status, 401);
  assert.deepEqual(await protectedResponse.json(), { error: "로그인이 필요해요." });
});

test("runtime configuration ignores accidental surrounding whitespace", async () => {
  const response = await worker.fetch(new Request("https://editor.example/auth/login"), {
    GITHUB_CLIENT_ID: "client-id-without-newline\n",
    SESSION_SECRET: "test-only\n"
  });
  const location = new URL(response.headers.get("location"));
  assert.equal(location.searchParams.get("client_id"), "client-id-without-newline");
});

test("Vercel rewrite path does not masquerade as a post path", async () => {
  const secret = "test-only";
  const payload = Buffer.from(JSON.stringify({ login: "writer", exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  const response = await worker.fetch(new Request("https://editor.example/api/posts?path=posts", {
    headers: { Cookie: `mysc_editor_session=${payload}.${signature}` }
  }), { SESSION_SECRET: secret, ALLOWED_LOGINS: "writer" });
  assert.equal(response.status, 503);
});
