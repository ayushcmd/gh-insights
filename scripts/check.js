import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { normalizeUsername, HttpError } from "../lib/validation.js";
import { analyzePersonality, scoreDeveloper, summarizeDeveloper } from "../lib/analysis.js";
import { collectDeveloper } from "../lib/github.js";
import { generateInsight } from "../lib/gemini.js";

const roots = ["api", "lib", "public/js", "scripts", "server"];
const files = [];

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".js")) files.push(path);
  }
}

for (const root of roots) walk(root);
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`${relative(process.cwd(), file)}\n${result.stderr || result.stdout}`);
  }
}

try {
  assert.equal(normalizeUsername(" octocat "), "octocat");
  for (const value of ["", "-bad", "bad-", "bad--name", "bad/name", "a".repeat(40)]) {
    assert.throws(() => normalizeUsername(value), HttpError);
  }

  const recent = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const old = new Date(Date.now() - 500 * 86_400_000).toISOString();
  const fixture = {
    profile: { username: "fixture-user", name: "Fixture User", publicRepos: 3, followers: 5, createdAt: "2021-01-01T00:00:00Z" },
    repositories: [
      { id: 1, name: "alpha", url: "https://github.com/fixture-user/alpha", stars: 10, forks: 2, language: "JavaScript", createdAt: old, updatedAt: recent, pushedAt: recent, archived: false, fork: false, description: "A sample project", topics: ["web"], homepage: "", hasWiki: false, hasPages: false, license: "MIT" },
      { id: 2, name: "beta", url: "https://github.com/fixture-user/beta", stars: 5, forks: 0, language: "Python", createdAt: recent, updatedAt: recent, pushedAt: recent, archived: false, fork: false, description: "Another sample", topics: ["data"], homepage: "", hasWiki: true, hasPages: false, license: null },
      { id: 3, name: "archive", url: "https://github.com/fixture-user/archive", stars: 0, forks: 0, language: "JavaScript", createdAt: old, updatedAt: old, pushedAt: old, archived: true, fork: false, description: null, topics: [], homepage: "", hasWiki: false, hasPages: false, license: null }
    ],
    languages: { distribution: [{ name: "JavaScript", repositoryCount: 2 }, { name: "Python", repositoryCount: 1 }] },
    totals: { stars: 15, forks: 2 },
    activity: { eventCount: 3, eventTypes: [{ type: "PullRequestEvent", count: 2 }, { type: "PushEvent", count: 1 }], timeline: [], firstObservedAt: recent, lastObservedAt: recent, pagesFetched: 1, capped: false, limitation: "Fixture only" },
    repositoryCoverage: { fetched: 3, reportedPublicTotal: 3, complete: true, capped: false, cap: 1000 },
    source: { api: "Fixture only", rateLimitNote: "Fixture only" },
    collectedAt: new Date().toISOString()
  };
  const score = scoreDeveloper(fixture);
  assert.ok(score.value >= 0 && score.value <= 100);
  assert.equal(analyzePersonality(fixture).headline, "Builder");
  const report = summarizeDeveloper(fixture);
  assert.equal(report.statistics.repositoriesRetrieved, 3);
  assert.equal(report.portfolioSignals.withLicense, 1);
  assert.equal(report.statistics.languageDiversityPercent > 0, true);
  const noActivity = structuredClone(fixture);
  noActivity.activity = { eventCount: 0, eventTypes: [], timeline: [], pagesFetched: 0, capped: false };
  assert.equal(scoreDeveloper(noActivity).components.find((item) => item.key === "activity").value, null);

  const realFetch = globalThis.fetch;
  const mockRepo = (id, name, language, isPrivate = false) => ({
    id, name, full_name: `fixture-user/${name}`, html_url: `https://github.com/fixture-user/${name}`,
    description: "Fixture repository", language, stargazers_count: id, forks_count: 0,
    watchers_count: 0, created_at: recent, updated_at: recent, pushed_at: recent,
    default_branch: "main", size: 10, topics: [], archived: false, fork: false,
    private: isPrivate, has_issues: true, has_pages: false, has_wiki: false,
    homepage: null, license: { spdx_id: "MIT" }
  });
  const pageOne = "https://api.github.com/users/fixture-user/repos?per_page=100&sort=updated&direction=desc&page=1";
  const pageTwo = "https://api.github.com/users/fixture-user/repos?per_page=100&sort=updated&direction=desc&page=2";
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/users/fixture-user") {
      return new Response(JSON.stringify({ login: "fixture-user", name: "Fixture User", public_repos: 2, followers: 5, following: 1, public_gists: 0, created_at: "2021-01-01T00:00:00Z", updated_at: recent, html_url: "https://github.com/fixture-user", avatar_url: "https://avatars.githubusercontent.com/u/1", bio: null, company: null, location: null, blog: null, hireable: null }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/users/fixture-user/repos") {
      if (url.searchParams.get("page") === "2") return new Response(JSON.stringify([mockRepo(2, "second", "Rust"), mockRepo(99, "private", "Secret", true)]), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify([mockRepo(1, "first", "JavaScript")]), { status: 200, headers: { "content-type": "application/json", link: `<${pageTwo}>; rel="next", <${pageTwo}>; rel="last"` } });
    }
    if (url.pathname === "/users/fixture-user/events/public") {
      return new Response(JSON.stringify([{ type: "PushEvent", created_at: recent }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
  try {
    const collected = await collectDeveloper("fixture-user");
    assert.equal(collected.repositories.length, 2, "repository pagination excludes private records");
    assert.equal(collected.repositoryCoverage.complete, true);
    assert.equal(collected.totals.stars, 3);
    assert.equal(collected.activity.eventCount, 1);
    assert.deepEqual(collected.languages.distribution.map((item) => item.name), ["JavaScript", "Rust"]);
  } finally { globalThis.fetch = realFetch; }

  const originalFetch = globalThis.fetch;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalGeminiModel = process.env.GEMINI_MODEL;
  let geminiRequest;
  process.env.GEMINI_API_KEY = "local-placeholder-key";
  process.env.GEMINI_MODEL = "local-test-model";
  globalThis.fetch = async (input, init) => {
    geminiRequest = { url: String(input), headers: init.headers };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Simulated profile summary." }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const generated = await generateInsight("summary", { profile: { username: "fixture-user" } });
    assert.equal(generated.available, true);
    assert.equal(generated.text, "Simulated profile summary.");
    assert.equal(geminiRequest.headers["x-goog-api-key"], "local-placeholder-key");
    assert.equal(geminiRequest.url.includes("local-placeholder-key"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
    if (originalGeminiModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalGeminiModel;
  }
  const savedFetch = globalThis.fetch;
  const savedKey = process.env.GEMINI_API_KEY;
  const savedModel = process.env.GEMINI_MODEL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
  globalThis.fetch = async () => { throw new Error("Gemini should remain idle when unconfigured"); };
  try {
    const unavailable = await generateInsight("summary", {});
    assert.equal(unavailable.available, false);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
    if (savedModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = savedModel;
  }

  const html = readFileSync("public/index.html", "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "HTML element IDs must be unique");
  for (const [, file] of html.matchAll(/(?:src|href)="\/((?:js|css)\/[^\"]+)"/g)) {
    assert.ok(statSync(join("public", file)).isFile(), `Referenced asset exists: ${file}`);
  }
  const browserCode = readFileSync("public/js/app.js", "utf8") + readFileSync("public/js/charts.js", "utf8");
  assert.doesNotMatch(browserCode, /\.innerHTML\s*=|insertAdjacentHTML\s*\(/);
  assert.doesNotMatch(browserCode, /GEMINI_API_KEY|GITHUB_TOKEN/);
  const styles = ["public/css/main.css", "public/css/responsive.css"].map((file) => readFileSync(file, "utf8")).join("\n");
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /max-width:\s*650px/);

  const apiFiles = files.filter((file) => file.replaceAll("\\", "/").startsWith("api/"));
  const routes = new Map();
  for (const file of apiFiles) {
    const route = await import(pathToFileURL(resolve(file)).href);
    assert.equal(typeof route.default, "function", `${file} exports a Vercel handler`);
    routes.set(file.replaceAll("\\", "/"), route.default);
  }
  function responseStub() {
    return {
      statusCode: 200,
      headers: {},
      writableEnded: false,
      setHeader(key, value) { this.headers[key] = value; return this; },
      status(value) { this.statusCode = value; return this; },
      send(value) { this.body = value; this.writableEnded = true; return this; },
      end() { this.writableEnded = true; return this; }
    };
  }
  const healthResponse = responseStub();
  await routes.get("api/health.js")({ method: "GET", headers: { host: "localhost:3000" }, query: {}, socket: { remoteAddress: "test-health" } }, healthResponse);
  assert.equal(healthResponse.statusCode, 200);
  assert.equal(JSON.parse(healthResponse.body).status, "ok");
  const invalidProfileResponse = responseStub();
  await routes.get("api/github/profile.js")({ method: "GET", headers: { host: "localhost:3000" }, query: { username: "../private" }, socket: { remoteAddress: "test-invalid" } }, invalidProfileResponse);
  assert.equal(invalidProfileResponse.statusCode, 400);
  const invalidCompareResponse = responseStub();
  await routes.get("api/insights/compare.js")({ method: "POST", headers: { host: "localhost:3000" }, body: { usernameA: "octocat", usernameB: "bad/name" }, socket: { remoteAddress: "test-compare" } }, invalidCompareResponse);
  assert.equal(invalidCompareResponse.statusCode, 400);
  JSON.parse(readFileSync("vercel.json", "utf8"));
  if (!failed) process.stdout.write(`JavaScript syntax, validation/analysis smoke checks, simulated GitHub pagination and Gemini authentication, static assets, and ${apiFiles.length} Vercel handler imports passed. Mocked fixtures only; no external APIs or credentials were used.\n`);
} catch (error) {
  failed = true;
  process.stderr.write(`Local check failed: ${error.stack || error}\n`);
}

if (failed) process.exitCode = 1;
