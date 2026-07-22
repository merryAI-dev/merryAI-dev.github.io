import sanitizeHtmlLibrary from "sanitize-html";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SESSION_COOKIE = "mysc_editor_session";
const STATE_COOKIE = "mysc_editor_oauth_state";
const POST_PATH = /^_posts\/\d{4}-\d{2}-\d{2}-[a-z0-9-]{3,80}\.md$/;
const IMAGE_PATH = /^assets\/images\/posts\/\d{4}\/\d{2}\/[a-z0-9-]+\.(?:png|jpe?g|webp|gif)$/;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const CONFIG_KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_PRIVATE_KEY",
  "GITHUB_INSTALLATION_ID",
  "GITHUB_OWNER",
  "GITHUB_REPO",
  "GITHUB_BRANCH",
  "SESSION_SECRET",
  "ALLOWED_LOGINS",
  "POST_AUTHOR"
];
let installationTokenCache = null;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function base64Url(bytesOrString) {
  const bytes = typeof bytesOrString === "string" ? encoder.encode(bytesOrString) : bytesOrString;
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function utf8ToBase64(value) {
  const encoded = base64Url(encoder.encode(value)).replace(/-/g, "+").replace(/_/g, "/");
  return encoded + "=".repeat((4 - encoded.length % 4) % 4);
}

function base64ToUtf8(value) {
  return decoder.decode(fromBase64(value.replace(/\s/g, "")));
}

function parseCookies(request) {
  const result = {};
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0) result[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return result;
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

async function signedValue(secret, payload) {
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${await hmac(secret, encoded)}`;
}

async function verifySignedValue(secret, value) {
  if (!value || !value.includes(".")) return null;
  const [payload, signature] = value.split(".");
  const expected = await hmac(secret, payload);
  if (signature.length !== expected.length) return null;
  let mismatch = 0;
  for (let index = 0; index < signature.length; index += 1) mismatch |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  if (mismatch) return null;
  try {
    return JSON.parse(decoder.decode(fromBase64(payload)));
  } catch {
    return null;
  }
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function required(env, keys) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) throw new HttpError(503, "편집기 연결 설정을 마무리하고 있어요.");
}

function normalizeConfig(env) {
  const normalized = { ...env };
  for (const key of CONFIG_KEYS) {
    if (typeof normalized[key] === "string") normalized[key] = normalized[key].trim();
  }
  return normalized;
}

function allowedLogins(env) {
  return String(env.ALLOWED_LOGINS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
}

async function readSession(request, env) {
  required(env, ["SESSION_SECRET", "ALLOWED_LOGINS"]);
  const payload = await verifySignedValue(env.SESSION_SECRET, parseCookies(request)[SESSION_COOKIE]);
  if (!payload || payload.exp < Math.floor(Date.now() / 1000) || !allowedLogins(env).includes(String(payload.login).toLowerCase())) return null;
  return payload;
}

async function requireSession(request, env) {
  const payload = await readSession(request, env);
  if (!payload) throw new HttpError(401, "로그인이 필요해요.");
  return payload;
}

function verifySameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) throw new HttpError(403, "안전하지 않은 요청을 차단했어요.");
}

function derLength(length) {
  if (length < 128) return Uint8Array.of(length);
  const bytes = [];
  while (length > 0) { bytes.unshift(length & 255); length >>= 8; }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function derSequence(...parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(1 + derLength(size).length + size);
  result[0] = 0x30;
  result.set(derLength(size), 1);
  let offset = 1 + derLength(size).length;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function pkcs1ToPkcs8(pkcs1) {
  const rsaAlgorithm = Uint8Array.of(0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00);
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const octetLength = derLength(pkcs1.length);
  const octet = new Uint8Array(1 + octetLength.length + pkcs1.length);
  octet[0] = 0x04;
  octet.set(octetLength, 1);
  octet.set(pkcs1, 1 + octetLength.length);
  return derSequence(version, rsaAlgorithm, octet);
}

function pemBytes(pem) {
  const pkcs1 = pem.includes("BEGIN RSA PRIVATE KEY");
  const body = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, "");
  const bytes = fromBase64(body);
  return pkcs1 ? pkcs1ToPkcs8(bytes) : bytes;
}

async function appJwt(env) {
  required(env, ["GITHUB_APP_ID", "GITHUB_PRIVATE_KEY"]);
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(env.GITHUB_APP_ID) }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(env.GITHUB_PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned)));
  return `${unsigned}.${base64Url(signature)}`;
}

async function githubRequest(url, options = {}, token) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "MYSC-native-editor",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status === 409 || response.status === 422 ? 409 : response.status;
    throw new HttpError(status, status === 409 ? "다른 수정 내용과 충돌했어요." : "GitHub 저장소 요청을 처리하지 못했어요.");
  }
  return data;
}

async function installationToken(env) {
  if (installationTokenCache?.expiresAt > Date.now() + 60_000) return installationTokenCache.token;
  required(env, ["GITHUB_INSTALLATION_ID"]);
  const jwt = await appJwt(env);
  const data = await githubRequest(`https://api.github.com/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`, { method: "POST" }, jwt);
  installationTokenCache = { token: data.token, expiresAt: new Date(data.expires_at).getTime() };
  return data.token;
}

function repoUrl(env, path = "") {
  required(env, ["GITHUB_OWNER", "GITHUB_REPO", "GITHUB_BRANCH"]);
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
}

async function getContent(env, path) {
  const token = await installationToken(env);
  return githubRequest(`${repoUrl(env, path)}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`, {}, token);
}

export function validatePostPath(path) {
  if (!POST_PATH.test(String(path || ""))) throw new HttpError(400, "올바르지 않은 글 경로예요.");
  return path;
}

function scalar(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export function parseFrontmatter(markdown) {
  const match = String(markdown).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new HttpError(422, "글 머리말을 읽을 수 없어요.");
  const attributes = parseYaml(match[1]) || {};
  return { attributes, bodyMarkdown: match[2].trim() };
}

export function sanitizePostHtml(html) {
  return sanitizeHtmlLibrary(String(html || ""), {
    allowedTags: ["p", "br", "h2", "h3", "strong", "b", "em", "i", "u", "s", "mark", "span", "blockquote", "pre", "code", "a", "ul", "ol", "li", "figure", "figcaption", "img", "table", "thead", "tbody", "tr", "th", "td", "hr"],
    allowedAttributes: { a: ["href", "title", "rel"], img: ["src", "alt", "title"], span: ["class"] },
    allowedClasses: { span: ["text-serif", "text-sans", "text-mono"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attributes) => ({ tagName, attribs: { ...attributes, ...(attributes.href?.startsWith("http") ? { rel: "noopener noreferrer" } : {}) } })
    }
  });
}

function koreaDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function normalizePost(input, env) {
  const title = scalar(input.title);
  const description = scalar(input.description);
  const slug = scalar(input.slug).toLowerCase();
  const series = scalar(input.series, "Building the Ledger");
  const tags = Array.isArray(input.tags) ? input.tags.map((tag) => scalar(tag)).filter(Boolean).slice(0, 12) : [];
  const seriesNo = Math.max(1, Math.min(999, Number(input.seriesNo) || 1));
  const readingTime = Math.max(1, Math.min(120, Number(input.readingTime) || 1));
  if (!title || title.length > 120) throw new HttpError(400, "제목은 1~120자로 입력해주세요.");
  if (description.length > 240) throw new HttpError(400, "한 줄 요약은 240자 이하로 입력해주세요.");
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) throw new HttpError(400, "영문 주소 형식이 올바르지 않아요.");
  const body = sanitizePostHtml(input.body);
  if (!body.replace(/<[^>]*>/g, "").trim() && !body.includes("<img")) throw new HttpError(400, "본문을 입력해주세요.");
  const path = input.path ? validatePostPath(input.path) : `_posts/${koreaDate()}-${slug}.md`;
  return {
    title, description, slug, series, seriesNo, tags, readingTime, body, path,
    sha: scalar(input.sha), published: input.published === true,
    cardImage: scalar(input.cardImage),
    nextTitle: scalar(input.nextTitle),
    nextUrl: scalar(input.nextUrl),
    author: scalar(env.POST_AUTHOR, "MYSC AX팀"),
    date: path.slice(7, 17)
  };
}

export function serializePost(post) {
  const attributes = {
    title: post.title,
    description: post.description,
    author: post.author,
    date: post.date,
    series: post.series,
    series_no: post.seriesNo,
    tags: post.tags,
    reading_time: post.readingTime,
    published: Boolean(post.published)
  };
  if (post.cardImage) attributes.card_image = post.cardImage;
  if (post.nextTitle) attributes.next_title = post.nextTitle;
  if (post.nextUrl) attributes.next_url = post.nextUrl;
  const yaml = stringifyYaml(attributes, { lineWidth: 0 }).trim();
  return `---\n${yaml}\n---\n\n${post.body.trim()}\n`;
}

function postFromContent(path, sha, markdown) {
  const { attributes, bodyMarkdown } = parseFrontmatter(markdown);
  return {
    path,
    sha,
    title: scalar(attributes.title),
    description: scalar(attributes.description),
    author: scalar(attributes.author),
    date: String(attributes.date || path.slice(7, 17)).slice(0, 10),
    series: scalar(attributes.series),
    seriesNo: Number(attributes.series_no) || 1,
    tags: Array.isArray(attributes.tags) ? attributes.tags.map(String) : [],
    readingTime: Number(attributes.reading_time) || 1,
    published: attributes.published !== false,
    cardImage: scalar(attributes.card_image),
    nextTitle: scalar(attributes.next_title),
    nextUrl: scalar(attributes.next_url),
    bodyMarkdown
  };
}

async function listPosts(env) {
  const listing = await getContent(env, "_posts");
  const files = (Array.isArray(listing) ? listing : []).filter((item) => item.type === "file" && POST_PATH.test(item.path));
  const posts = await Promise.all(files.map(async (item) => {
    try {
      const content = await getContent(env, item.path);
      const post = postFromContent(item.path, content.sha, base64ToUtf8(content.content));
      return { path: post.path, title: post.title, date: post.date, published: post.published };
    } catch {
      return null;
    }
  }));
  return posts.filter(Boolean).sort((a, b) => b.path.localeCompare(a.path));
}

async function savePost(request, env) {
  verifySameOrigin(request);
  const input = await request.json().catch(() => { throw new HttpError(400, "글 데이터를 읽을 수 없어요."); });
  const post = normalizePost(input, env);
  const token = await installationToken(env);
  const payload = {
    message: `${post.published ? "publish" : "draft"}: ${post.title}`,
    content: utf8ToBase64(serializePost(post)),
    branch: env.GITHUB_BRANCH,
    ...(post.sha ? { sha: post.sha } : {})
  };
  const saved = await githubRequest(repoUrl(env, post.path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, token);
  return json({ post: { path: post.path, sha: saved.content.sha, published: post.published } });
}

function safeImageName(name, type) {
  const extensionByType = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
  const extension = extensionByType[type];
  if (!extension) throw new HttpError(400, "PNG, JPEG, WebP, GIF 이미지만 올릴 수 있어요.");
  const stem = String(name || "image").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45) || "image";
  return `${stem}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
}

export function validateImageData(bytes, type) {
  const signatures = {
    "image/png": (value) => value[0] === 0x89 && value[1] === 0x50 && value[2] === 0x4e && value[3] === 0x47,
    "image/jpeg": (value) => value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff,
    "image/gif": (value) => decoder.decode(value.subarray(0, 6)) === "GIF87a" || decoder.decode(value.subarray(0, 6)) === "GIF89a",
    "image/webp": (value) => decoder.decode(value.subarray(0, 4)) === "RIFF" && decoder.decode(value.subarray(8, 12)) === "WEBP"
  };
  if (!signatures[type] || !signatures[type](bytes)) throw new HttpError(400, "파일 내용과 이미지 형식이 일치하지 않아요.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, "이미지는 5MB 이하만 올릴 수 있어요.");
  return true;
}

async function saveImage(request, env) {
  verifySameOrigin(request);
  const input = await request.json().catch(() => { throw new HttpError(400, "이미지 데이터를 읽을 수 없어요."); });
  const data = scalar(input.data).replace(/\s/g, "");
  if (!data || Math.floor(data.length * 0.75) > MAX_IMAGE_BYTES + 2) throw new HttpError(413, "이미지는 5MB 이하만 올릴 수 있어요.");
  let bytes;
  try { bytes = fromBase64(data); } catch { throw new HttpError(400, "이미지 데이터가 올바르지 않아요."); }
  validateImageData(bytes, input.type);
  const date = koreaDate();
  const path = `assets/images/posts/${date.slice(0, 4)}/${date.slice(5, 7)}/${safeImageName(input.name, input.type)}`;
  if (!IMAGE_PATH.test(path)) throw new HttpError(400, "이미지 경로가 올바르지 않아요.");
  const token = await installationToken(env);
  await githubRequest(repoUrl(env, path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: `media: add ${path.split("/").pop()}`, content: data, branch: env.GITHUB_BRANCH })
  }, token);
  return json({ path: `/${path}` }, 201);
}

async function login(request, env) {
  required(env, ["GITHUB_CLIENT_ID", "SESSION_SECRET"]);
  const nonce = crypto.randomUUID();
  const state = await signedValue(env.SESSION_SECRET, { nonce, exp: Math.floor(Date.now() / 1000) + 600 });
  const callback = `${new URL(request.url).origin}/auth/callback`;
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("state", nonce);
  return redirect(url.toString(), [cookie(STATE_COOKIE, state, 600)]);
}

async function callback(request, env) {
  required(env, ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "SESSION_SECRET", "ALLOWED_LOGINS"]);
  const url = new URL(request.url);
  const savedState = await verifySignedValue(env.SESSION_SECRET, parseCookies(request)[STATE_COOKIE]);
  if (!savedState || savedState.exp < Math.floor(Date.now() / 1000) || savedState.nonce !== url.searchParams.get("state")) {
    throw new HttpError(403, "로그인 확인 정보가 만료됐어요. 다시 로그인해주세요.");
  }
  const code = url.searchParams.get("code");
  if (!code) throw new HttpError(400, "GitHub 로그인 코드를 받지 못했어요.");
  const tokenResponse = await githubRequest("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code })
  });
  const user = await githubRequest("https://api.github.com/user", {}, tokenResponse.access_token);
  if (!allowedLogins(env).includes(String(user.login).toLowerCase())) throw new HttpError(403, "이 편집기를 사용할 권한이 없어요.");
  const session = await signedValue(env.SESSION_SECRET, { login: user.login, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 });
  return redirect("/", [cookie(SESSION_COOKIE, session, 60 * 60 * 12), cookie(STATE_COOKIE, "", 0)]);
}

async function route(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/auth/login" && request.method === "GET") return login(request, env);
  if (url.pathname === "/auth/callback" && request.method === "GET") return callback(request, env);
  if (url.pathname === "/auth/logout" && request.method === "GET") return redirect("/", [cookie(SESSION_COOKIE, "", 0)]);
  if (url.pathname === "/auth/me" && request.method === "GET") {
    const session = await readSession(request, env);
    return json(session ? { authenticated: true, login: session.login } : { authenticated: false });
  }
  if (url.pathname.startsWith("/api/")) await requireSession(request, env);
  if (url.pathname === "/api/posts" && request.method === "GET") {
    const path = url.searchParams.get("post");
    if (!path) return json({ posts: await listPosts(env) });
    validatePostPath(path);
    const content = await getContent(env, path);
    return json({ post: postFromContent(path, content.sha, base64ToUtf8(content.content)) });
  }
  if (url.pathname === "/api/posts" && request.method === "PUT") return savePost(request, env);
  if (url.pathname === "/api/images" && request.method === "POST") return saveImage(request, env);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) throw new HttpError(404, "요청한 기능을 찾을 수 없어요.");
  throw new HttpError(404, "요청한 페이지를 찾을 수 없어요.");
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, normalizeConfig(env));
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      return json({ error: status === 500 ? "잠시 문제가 생겼어요. 다시 시도해주세요." : error.message }, status);
    }
  }
};
