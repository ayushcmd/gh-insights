import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { createDevServer } from "../server/dev-server.js";
import { parseEnvContent } from "../server/env.js";
import githubFunction from "../api/github.js";
import insightsFunction from "../api/insights.js";
import aiFunction from "../api/ai.js";

class TestResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
    this.headersSent = false;
  }
  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    this.headersSent = true;
    callback();
  }
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; }
  status(code) { this.statusCode = code; return this; }
  send(value) { this.end(value); return this; }
  hasHeader(name) { return Object.hasOwn(this.headers, name.toLowerCase()); }
  writeHead(status, headers = {}) {
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    this.headersSent = true;
    return this;
  }
  get bodyText() { return Buffer.concat(this.chunks).toString("utf8"); }
}

async function dispatchVercelFunction(handler, group, operation, path, { method = "GET", body } = {}) {
  const parsed = new URL(path, "http://localhost");
  const query = {};
  for (const key of new Set(parsed.searchParams.keys())) {
    const values = parsed.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  query.__ghinsightsRoute = operation;
  const incoming = {
    method,
    url: `/api/${group}?__ghinsightsRoute=${encodeURIComponent(operation)}`,
    headers: { host: "127.0.0.1:3000" },
    query,
    socket: { remoteAddress: "127.0.0.1" },
    body
  };
  const outgoing = new TestResponse();
  await handler(incoming, outgoing);
  const text = outgoing.bodyText;
  let json;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: outgoing.statusCode, headers: outgoing.headers, text, json };
}

function request(server, path, { method = "GET", body, rawBody } = {}) {
  const content = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  const headers = { host: "127.0.0.1:3000" };
  if (content !== undefined) headers["content-type"] = "application/json";
  const incoming = Readable.from(content === undefined ? [] : [Buffer.from(content)]);
  incoming.method = method;
  incoming.url = path;
  incoming.headers = headers;
  incoming.socket = { remoteAddress: "127.0.0.1" };
  const outgoing = new TestResponse();
  return new Promise((resolve, reject) => {
    outgoing.once("finish", () => {
      const text = outgoing.bodyText;
      let json;
      try { json = text ? JSON.parse(text) : null; } catch {}
      resolve({ status: outgoing.statusCode, headers: outgoing.headers, text, json });
    });
    outgoing.once("error", reject);
    server.emit("request", incoming, outgoing);
  });
}

function githubProfile(username) {
  return {
    login: username,
    name: `Local Fixture ${username}`,
    avatar_url: "https://avatars.githubusercontent.com/u/7",
    bio: "A mocked local profile",
    company: null,
    location: null,
    blog: null,
    html_url: `https://github.com/${username}`,
    followers: 12,
    following: 4,
    public_repos: 3,
    public_gists: 0,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    hireable: null
  };
}

function githubRepositories(username) {
  const created = "2023-01-01T00:00:00Z";
  const updated = new Date().toISOString();
  return ["JavaScript", "Python", "Rust"].map((language, index) => ({
    id: index + 1,
    name: `project-${index + 1}`,
    full_name: `${username}/project-${index + 1}`,
    html_url: `https://github.com/${username}/project-${index + 1}`,
    description: `Mocked ${language} project`,
    language,
    stargazers_count: 10 - index,
    forks_count: index,
    watchers_count: 5,
    created_at: created,
    updated_at: updated,
    pushed_at: updated,
    default_branch: "main",
    size: 100,
    topics: [language.toLowerCase()],
    archived: false,
    fork: false,
    private: false,
    has_issues: true,
    has_pages: false,
    has_wiki: false,
    homepage: null,
    license: { spdx_id: "MIT" }
  }));
}

function mockUpstreamFetch() {
  const requests = { github: 0, gemini: 0, githubAuth: false, geminiAuth: false };
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === "api.github.com") {
      requests.github += 1;
      requests.githubAuth ||= options.headers?.Authorization === "Bearer local-test-token";
      const profileMatch = url.pathname.match(/^\/users\/([^/]+)$/);
      if (profileMatch && decodeURIComponent(profileMatch[1]) === "auth-failure-user") return Response.json({ message: "Bad credentials" }, { status: 401 });
      if (profileMatch) return Response.json(githubProfile(decodeURIComponent(profileMatch[1])));
      const repoMatch = url.pathname.match(/^\/users\/([^/]+)\/repos$/);
      if (repoMatch) return Response.json(githubRepositories(decodeURIComponent(repoMatch[1])));
      const eventMatch = url.pathname.match(/^\/users\/([^/]+)\/events\/public$/);
      if (eventMatch) {
        const recent = new Date().toISOString();
        return Response.json([
          { type: "PushEvent", created_at: recent },
          { type: "PullRequestEvent", created_at: recent }
        ]);
      }
      return Response.json({ message: "Not Found" }, { status: 404 });
    }
    if (url.hostname === "generativelanguage.googleapis.com") {
      requests.gemini += 1;
      requests.geminiAuth ||= options.headers?.["x-goog-api-key"] === "local-test-gemini-key";
      if (url.pathname.includes("auth-failure-model")) return Response.json({ error: { message: "Invalid API key" } }, { status: 401 });
      return Response.json({ candidates: [{ content: { parts: [{ text: "Mocked local AI insight." }] } }] });
    }
    throw new Error("Local route test blocked an unexpected network destination.");
  };
  return requests;
}

function restoreEnvironment(name, original) {
  if (original === undefined) delete process.env[name];
  else process.env[name] = original;
}

const parsedEnv = parseEnvContent([
  "# local-only test",
  "export SAMPLE_UNQUOTED=plain-value # optional comment",
  'SAMPLE_DOUBLE="two\\nlines"',
  "SAMPLE_SINGLE='literal # value'"
].join("\n"));
assert.equal(parsedEnv.get("SAMPLE_UNQUOTED"), "plain-value");
assert.equal(parsedEnv.get("SAMPLE_DOUBLE"), "two\nlines");
assert.equal(parsedEnv.get("SAMPLE_SINGLE"), "literal # value");
assert.match(readFileSync(".gitignore", "utf8"), /\.env\.local|\.env\.\*/);

const envNames = ["GITHUB_TOKEN", "GEMINI_API_KEY", "GEMINI_MODEL"];
const priorEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
process.env.GITHUB_TOKEN = "local-test-token";
process.env.GEMINI_API_KEY = "local-test-gemini-key";
process.env.GEMINI_MODEL = "local-mock-model";
const priorFetch = globalThis.fetch;
const upstream = mockUpstreamFetch();
let server;

try {
  server = await createDevServer();
  const expectedRoutes = [
    "/api/health",
    "/api/github/profile", "/api/github/repositories", "/api/github/activity", "/api/github/languages",
    "/api/insights/analyze", "/api/insights/personality", "/api/insights/score", "/api/insights/deep", "/api/insights/compare",
    "/api/ai/summary", "/api/ai/roast", "/api/ai/verdict"
  ].sort();
  assert.deepEqual([...server.apiRoutePaths].sort(), expectedRoutes, "local server discovers every API module");

  const home = await request(server, "/");
  assert.equal(home.status, 200);
  assert.match(home.headers["content-type"], /text\/html/);
  assert.match(home.text, /GitHub Personality Analyzer/);
  assert.ok(home.headers["content-security-policy"]);
  assert.equal((await request(server, "/js/app.js")).status, 200);

  const routeCases = [
    ["/api/health", "GET", undefined, (result) => assert.equal(result.json.status, "ok")],
    ["/api/github/profile?username=dev-one", "GET", undefined, (result) => assert.equal(result.json.username, "dev-one")],
    ["/api/github/repositories?username=dev-one", "GET", undefined, (result) => assert.equal(result.json.repositories.length, 3)],
    ["/api/github/activity?username=dev-one", "GET", undefined, (result) => assert.equal(result.json.eventCount, 2)],
    ["/api/github/languages?username=dev-one", "GET", undefined, (result) => assert.equal(result.json.distribution.length, 3)],
    ["/api/insights/analyze", "POST", { username: "dev-one" }, (result) => assert.equal(result.json.statistics.repositoriesRetrieved, 3)],
    ["/api/insights/personality", "POST", { username: "dev-one" }, (result) => assert.ok(result.json.headline)],
    ["/api/insights/score", "POST", { username: "dev-one" }, (result) => assert.ok(result.json.value >= 0)],
    ["/api/insights/deep", "POST", { username: "dev-one" }, (result) => assert.equal(result.json.detail.allRepositories.length, 3)],
    ["/api/insights/compare", "POST", { usernameA: "dev-one", usernameB: "dev-two" }, (result) => assert.equal(result.json.developers.length, 2)],
    ["/api/ai/summary", "POST", { username: "dev-one" }, (result) => assert.equal(result.json.available, true)],
    ["/api/ai/roast", "POST", { username: "dev-one" }, (result) => assert.equal(result.json.available, true)],
    ["/api/ai/verdict", "POST", { usernameA: "dev-one", usernameB: "dev-two" }, (result) => assert.equal(result.json.available, true)]
  ];

  const vercelFunctions = { github: githubFunction, insights: insightsFunction, ai: aiFunction };
  for (const [path, method, body, verify] of routeCases) {
    const parsed = new URL(path, "http://localhost");
    if (parsed.pathname === "/api/health") continue;
    const [, , group, operation] = parsed.pathname.split("/");
    const result = await dispatchVercelFunction(vercelFunctions[group], group, operation, path, { method, body });
    assert.equal(result.status, 200, `Vercel group dispatch ${method} ${path}: ${result.text}`);
    verify(result);
    assert.equal(result.text.includes("local-test-token"), false, "GitHub credentials never appear in API responses");
    assert.equal(result.text.includes("local-test-gemini-key"), false, "Gemini credentials never appear in API responses");
  }

  for (const [path, method, body, verify] of routeCases) {
    const result = await request(server, path, { method, body });
    assert.equal(result.status, 200, `${method} ${path}: ${result.text}`);
    assert.match(result.headers["content-type"], /application\/json/);
    verify(result);
  }

  const preflight = await request(server, "/api/insights/analyze", { method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  const wrongMethod = await request(server, "/api/health", { method: "DELETE" });
  assert.equal(wrongMethod.status, 405);
  const badUsername = await request(server, "/api/github/profile?username=bad%2Fname");
  assert.equal(badUsername.status, 400);
  const authFailure = await request(server, "/api/github/profile?username=auth-failure-user");
  assert.equal(authFailure.status, 502);
  assert.equal(authFailure.json.error.code, "github_auth_config");
  assert.equal(authFailure.text.includes("local-test-token"), false);
  const badJson = await request(server, "/api/insights/analyze", { method: "POST", rawBody: "{" });
  assert.equal(badJson.status, 400);
  const unknown = await request(server, "/api/not-a-route");
  assert.equal(unknown.status, 404);
  const wrongGroupMethod = await dispatchVercelFunction(githubFunction, "github", "profile", "/api/github/profile?username=dev-one", { method: "POST" });
  assert.equal(wrongGroupMethod.status, 405);
  const unknownGroupRoute = await dispatchVercelFunction(aiFunction, "ai", "missing", "/api/ai/missing");
  assert.equal(unknownGroupRoute.status, 404);
  const groupPreflight = await dispatchVercelFunction(insightsFunction, "insights", "analyze", "/api/insights/analyze", { method: "OPTIONS" });
  assert.equal(groupPreflight.status, 204);

  const originalModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_MODEL = "auth-failure-model";
  try {
    const geminiAuthFailure = await dispatchVercelFunction(aiFunction, "ai", "summary", "/api/ai/summary", { method: "POST", body: { username: "dev-one" } });
    assert.equal(geminiAuthFailure.status, 200);
    assert.equal(geminiAuthFailure.json.available, false);
    assert.equal(geminiAuthFailure.text.includes("local-test-gemini-key"), false);
  } finally { process.env.GEMINI_MODEL = originalModel; }

  assert.ok(upstream.github > 0);
  assert.ok(upstream.gemini >= 3);
  assert.equal(upstream.githubAuth, true);
  assert.equal(upstream.geminiAuth, true);
  process.stdout.write("Local native HTTP request routing passed static, error, preflight, and all 13 API route checks with mocked GitHub/Gemini responses. No sockets or live network requests were used.\n");
} finally {
  globalThis.fetch = priorFetch;
  for (const name of envNames) restoreEnvironment(name, priorEnv[name]);
}
