import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { normalizeUsername, HttpError } from "../lib/validation.js";
import { analyzePersonality, scoreDeveloper, summarizeDeveloper } from "../lib/analysis.js";
import { collectDeveloper } from "../lib/github.js";
import { generateInsight, parseStructuredInsight, validateStructuredInsight } from "../lib/gemini.js";
import { API_ROUTE_HANDLERS } from "../lib/api-routes.js";
import { markdownFallbackText, parseMarkdown, renderAiOutput } from "../public/js/ai-render.js";

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
    assert.equal(generated.format, "markdown", "legacy Gemini Markdown/text responses remain supported");
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

  const fixtureRepo = { name: "alpha", fullName: "fixture-user/alpha", description: "Verified repository description", language: "JavaScript" };
  const minimalStructured = validateStructuredInsight({ overview: "A brief evidence-based overview." });
  assert.ok(minimalStructured, "empty sections and missing optional fields normalize safely");
  assert.deepEqual(minimalStructured.strengths, []);
  assert.deepEqual(minimalStructured.technologyPreferences, { languages: [], frameworks: [], tools: [] });
  assert.equal(parseStructuredInsight("{ malformed JSON", {}), null, "malformed JSON falls back to the legacy Markdown path");
  const validatedStructured = validateStructuredInsight({
    overview: "A concise overview.",
    strengths: [{ title: "Broad portfolio", explanation: "Several public projects span different topics." }],
    projectPatterns: [{ title: "Small tools", explanation: "Several projects are focused utilities.", repositories: ["fixture-user/alpha", "attacker/fake"] }],
    notableRepositories: [{ name: "fixture-user/alpha", rationale: "Frequently updated.", url: "https://evil.example/repo" }, { name: "attacker/fake", rationale: "Hallucinated." }]
  }, { repositoryCatalog: [fixtureRepo] });
  assert.equal(validatedStructured.projectPatterns[0].repositories.length, 1, "project references must match retrieved repository records");
  assert.equal(validatedStructured.notableRepositories.length, 1, "unknown AI repository names are removed");
  assert.equal(validatedStructured.notableRepositories[0].url, "https://github.com/fixture-user/alpha", "repository links are derived from GitHub data, not model URLs");

  const markdown = parseMarkdown("### Developer Overview\n\nA **clear** summary.\n\n#### Strengths\n\n- Broad range\n- [alpha](https://github.com/fixture-user/alpha)\n- [fake](https://github.com/attacker/fake)\n\n---\n\n**unfinished", { allowedLinks: ["https://github.com/fixture-user/alpha"] });
  assert.deepEqual(markdown.map((block) => block.type), ["heading", "paragraph", "heading", "unorderedList", "rule", "paragraph"]);
  const markdownText = JSON.stringify(markdown);
  assert.equal(markdownText.includes("**"), false, "unmatched and matched Markdown delimiters are parsed away");
  assert.equal(markdownText.includes("###"), false, "heading markers are represented as semantic nodes");
  assert.equal((markdownText.match(/"type":"link"/g) || []).length, 1, "only the listed, retrieved repository is rendered as a link");
  const linkedMarkdown = parseMarkdown("[alpha](https://github.com/fixture-user/alpha) [fake](https://github.com/attacker/fake)", { allowedLinks: ["https://github.com/fixture-user/alpha"] });
  assert.equal(JSON.stringify(linkedMarkdown).includes("https://github.com/fixture-user/alpha"), true);
  assert.equal(JSON.stringify(linkedMarkdown).includes("https://github.com/attacker/fake"), false, "only retrieved repository links become active links");
  const malformedMarkdown = parseMarkdown("###\n\n**unfinished\n\n- still readable\n\n---");
  assert.equal(JSON.stringify(malformedMarkdown).includes("**"), false);
  const parserFailureFallback = parseMarkdown("### **Readable fallback", null);
  assert.equal(parserFailureFallback[0].children[0].value, "Readable fallback", "parser failures degrade to safe readable text");
  assert.match(markdownFallbackText("### **Readable** fallback"), /Readable fallback/);

  class TestNode {
    constructor(tagName, value = "") { this.tagName = tagName; this.value = value; this.children = []; this.attributes = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; this.value = ""; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    get childNodes() { return this.children; }
    get lastChild() { return this.children.at(-1); }
    get textContent() { return this.value + this.children.map((child) => child.textContent).join(""); }
    set textContent(value) { this.value = String(value); this.children = []; }
  }
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => new TestNode(tagName),
    createTextNode: (value) => new TestNode("#text", String(value)),
    createElementNS: (_namespace, tagName) => new TestNode(tagName)
  };
  try {
    const renderedStructured = new TestNode("div");
    renderAiOutput(renderedStructured, {
      structured: {
        overview: "A short overview.", keySignals: ["Several repositories"],
        strengths: [{ title: "Breadth", explanation: "Projects use multiple languages." }],
        projectPatterns: [{ title: "Small tools", explanation: "Several repositories are utilities.", repositories: [{ fullName: "fixture-user/alpha", url: "https://github.com/fixture-user/alpha" }] }],
        technologyPreferences: { languages: ["JavaScript"], frameworks: [], tools: [] },
        notableRepositories: [{ fullName: "fixture-user/alpha", url: "https://github.com/fixture-user/alpha", description: "Verified project", language: "JavaScript" }],
        growthAreas: [{ title: "Document releases", recommendation: "Add concise release notes." }],
        limitations: ["Only fetched public data is represented."]
      }, repositoryLinks: ["https://github.com/fixture-user/alpha"]
    });
    for (const heading of ["Developer Overview", "Observed Strengths", "Project Patterns", "Technology Preferences", "Notable Repositories", "Growth Opportunities", "Methodology and limitations"]) {
      assert.ok(renderedStructured.textContent.includes(heading), `structured UI renders the ${heading} section`);
    }
    assert.ok(renderedStructured.textContent.includes("Measured GitHub statistics"), "structured UI distinguishes measured stats from AI interpretation");

    const renderedEmpty = new TestNode("div");
    renderAiOutput(renderedEmpty, { structured: { overview: "Overview only." } });
    assert.ok(renderedEmpty.textContent.includes("Overview only."), "empty optional sections render safely");

    const renderedMalformed = new TestNode("div");
    renderAiOutput(renderedMalformed, { text: "### **Readable fallback" });
    assert.ok(renderedMalformed.textContent.includes("Readable fallback"));
    assert.doesNotMatch(renderedMalformed.textContent, /(?:\*\*|###)/, "malformed Markdown markers are not shown raw");

    const renderedUnsafe = new TestNode("div");
    renderAiOutput(renderedUnsafe, { text: "<script>alert(1)</script><img src=x onerror=run()> **safe**" });
    const renderedTags = [];
    const collectTags = (node) => { renderedTags.push(node.tagName); for (const child of node.childNodes) collectTags(child); };
    collectTags(renderedUnsafe);
    assert.equal(renderedTags.some((tag) => ["script", "img"].includes(tag)), false, "raw HTML never creates executable or unsafe elements");
    assert.ok(renderedUnsafe.textContent.includes("safe"));
  } finally { globalThis.document = originalDocument; }

  const structuredPriorKey = process.env.GEMINI_API_KEY;
  const structuredPriorModel = process.env.GEMINI_MODEL;
  const structuredPriorFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "local-test-gemini-key";
  process.env.GEMINI_MODEL = "gemini-3.8-flash";
  let capturedGeminiRequest;
  globalThis.fetch = async (input, init) => {
    capturedGeminiRequest = { url: String(input), headers: init.headers, body: JSON.parse(init.body) };
    const response = {
      overview: "A short evidence-led overview.",
      keySignals: ["Several small tools"],
      strengths: [{ title: "Focus", explanation: "Projects show a recurring utility theme." }],
      projectPatterns: [{ title: "Small tools", explanation: "Several repos are focused utilities.", repositories: ["fixture-user/alpha", "not-in-catalog"] }],
      technologyPreferences: { languages: ["JavaScript"], frameworks: [], tools: [] },
      notableRepositories: [{ name: "fixture-user/alpha", rationale: "Useful public project.", url: "https://evil.example/repo" }],
      growthAreas: [],
      limitations: ["Only fetched public data is assessed."]
    };
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(response) }] } }] });
  };
  try {
    const structuredResult = await generateInsight("summary", { profile: { username: "structured-fixture-user" }, repositoryCatalog: [fixtureRepo] });
    assert.equal(structuredResult.format, "structured");
    assert.equal(structuredResult.structured.notableRepositories[0].url, "https://github.com/fixture-user/alpha");
    assert.equal(structuredResult.repositoryLinks.includes("https://github.com/fixture-user/alpha"), true);
    assert.equal(capturedGeminiRequest.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    assert.equal(capturedGeminiRequest.headers["x-goog-api-key"], "local-test-gemini-key");
    assert.equal(capturedGeminiRequest.body.generationConfig.temperature, undefined, "Gemini 3.8 request omits deprecated sampling configuration");
    assert.equal(capturedGeminiRequest.body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(Object.keys(capturedGeminiRequest.body.generationConfig.responseJsonSchema.properties).sort(), ["growthAreas", "keySignals", "limitations", "notableRepositories", "overview", "projectPatterns", "strengths", "technologyPreferences"]);
  } finally {
    globalThis.fetch = structuredPriorFetch;
    if (structuredPriorKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = structuredPriorKey;
    if (structuredPriorModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = structuredPriorModel;
  }

  const diagnosisPriorKey = process.env.GEMINI_API_KEY;
  const diagnosisPriorModel = process.env.GEMINI_MODEL;
  const diagnosisPriorFetch = globalThis.fetch;
  const diagnosisPriorConsoleError = console.error;
  const diagnosisLogs = [];
  const diagnosticKeyFixture = `AQ.${"A".repeat(36)}`;
  process.env.GEMINI_API_KEY = diagnosticKeyFixture;
  process.env.GEMINI_MODEL = "gemini-3.8-flash";
  console.error = (entry) => diagnosisLogs.push(String(entry));
  const geminiErrorResponse = (status, message, errorStatus = "API_ERROR", headers = {}) => Response.json({ error: { status: errorStatus, message } }, { status, headers });
  try {
    for (const [status, errorStatus, expectedCode] of [
      [400, "INVALID_ARGUMENT", "gemini_invalid_request"],
      [401, "UNAUTHENTICATED", "gemini_authentication"],
      [403, "PERMISSION_DENIED", "gemini_permission_denied"],
      [404, "NOT_FOUND", "gemini_model_not_found"],
      [500, "INTERNAL", "gemini_internal_error"]
    ]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return geminiErrorResponse(status, status === 401 ? `Invalid API key ${diagnosticKeyFixture}` : "Mocked provider diagnostic", errorStatus);
      };
      const result = await generateInsight("summary", { profile: { username: `diagnostic-status-${status}` } });
      assert.equal(result.code, expectedCode);
      assert.equal(calls, 1, `permanent HTTP ${status} failure does not retry`);
    }

    let quotaCalls = 0;
    globalThis.fetch = async () => {
      quotaCalls += 1;
      return geminiErrorResponse(429, "Per-minute request limit exceeded", "RESOURCE_EXHAUSTED", { "retry-after": "0" });
    };
    const quotaResult = await generateInsight("summary", { profile: { username: "diagnostic-quota-fixture" } });
    assert.equal(quotaResult.code, "gemini_quota_or_rate_limit");
    assert.equal(quotaCalls, 3, "transient 429 receives at most two retries");

    let dailyQuotaCalls = 0;
    globalThis.fetch = async () => {
      dailyQuotaCalls += 1;
      return geminiErrorResponse(429, "Daily quota exceeded; quota resets tomorrow", "RESOURCE_EXHAUSTED");
    };
    const dailyQuotaResult = await generateInsight("roast", { profile: { username: "diagnostic-daily-quota-fixture" } });
    assert.equal(dailyQuotaResult.code, "gemini_daily_quota_exhausted");
    assert.equal(dailyQuotaCalls, 1, "known daily quota exhaustion is not pointlessly retried");

    for (const [errorStatus, message] of [
      ["quota_exceeded", "Project daily quota reached"],
      ["RESOURCE_EXHAUSTED", "Quota exceeded for metric: generate_content_free_tier_requests"]
    ]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return geminiErrorResponse(429, message, errorStatus);
      };
      const result = await generateInsight("roast", { profile: { username: `daily-${calls}-${errorStatus}` } });
      assert.equal(result.code, "gemini_daily_quota_exhausted", "Gemini daily quota markers are classified without relying on prose wording");
      assert.equal(calls, 1, "Gemini daily quota markers do not retry");
    }

    let overloadCalls = 0;
    globalThis.fetch = async () => {
      overloadCalls += 1;
      if (overloadCalls === 1) return geminiErrorResponse(503, "Temporary overload", "UNAVAILABLE", { "retry-after": "0" });
      return Response.json({ candidates: [{ content: { parts: [{ text: "Recovered response" }] } }] });
    };
    const recoveredResult = await generateInsight("verdict", { profile: { username: "diagnostic-overload-fixture" } });
    assert.equal(recoveredResult.available, true);
    assert.equal(overloadCalls, 2, "503 retries with backoff and can recover");

    let longRetryAfterCalls = 0;
    globalThis.fetch = async () => {
      longRetryAfterCalls += 1;
      return geminiErrorResponse(429, "Too many requests", "RESOURCE_EXHAUSTED", { "retry-after": "30" });
    };
    const longWaitResult = await generateInsight("roast", { profile: { username: "diagnostic-long-retry-fixture" } });
    assert.equal(longRetryAfterCalls, 1, "Retry-After is not violated when its requested wait exceeds the retry cap");
    assert.match(longWaitResult.message, /at least 30 seconds/);

    const serializedLogs = diagnosisLogs.join("\n");
    assert.match(serializedLogs, /"httpStatus":401/);
    assert.match(serializedLogs, /"geminiErrorStatus":"PERMISSION_DENIED"/);
    assert.match(serializedLogs, /"requestedModel":"gemini-3\.8-flash"/);
    assert.match(serializedLogs, /"action":"summary"/);
    assert.match(serializedLogs, /"retryDelayMs":\d+/);
    assert.equal(serializedLogs.includes(diagnosticKeyFixture), false, "failure logs redact keys");
    assert.equal(serializedLogs.includes("diagnostic-quota-fixture"), false, "failure logs omit profile prompts and personal data");
  } finally {
    globalThis.fetch = diagnosisPriorFetch;
    console.error = diagnosisPriorConsoleError;
    if (diagnosisPriorKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = diagnosisPriorKey;
    if (diagnosisPriorModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = diagnosisPriorModel;
  }

  const html = readFileSync("public/index.html", "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "HTML element IDs must be unique");
  for (const [, file] of html.matchAll(/(?:src|href)="\/((?:js|css|images)\/[^\"]+)"/g)) {
    assert.ok(statSync(join("public", file)).isFile(), `Referenced asset exists: ${file}`);
  }
  assert.match(html, /<image class="hero-cat-mascot" href="\/images\/github-cat-mascot\.png" x="0" y="135" width="310" height="310" preserveAspectRatio="xMidYMid meet"\/>/);
  assert.match(html, /<rect x="84" y="382" width="230" height="204" rx="27" fill="url\(#left-tile\)"/, "the original Java card remains in place above the cat's lower body");
  assert.match(html, /<svg class="hero-art-right"/, "the existing terminal illustration remains present");
  const mascotAsset = readFileSync("public/images/github-cat-mascot.png");
  assert.equal(mascotAsset.toString("hex", 0, 8), "89504e470d0a1a0a", "the mascot asset is a valid PNG");
  assert.ok([4, 6].includes(mascotAsset[25]), "the mascot PNG retains an alpha channel");
  const browserCode = readFileSync("public/js/app.js", "utf8") + readFileSync("public/js/charts.js", "utf8") + readFileSync("public/js/ai-render.js", "utf8");
  assert.doesNotMatch(browserCode, /\.innerHTML\s*=|insertAdjacentHTML\s*\(/);
  assert.doesNotMatch(browserCode, /GEMINI_API_KEY|GITHUB_TOKEN/);
  const styles = ["public/css/main.css", "public/css/dashboard.css", "public/css/responsive.css", "public/css/redesign.css"].map((file) => readFileSync(file, "utf8")).join("\n");
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /max-width:\s*650px/);
  assert.match(styles, /ai-insight-card/);
  assert.match(styles, /\.ai-card-grid, \.ai-tech-groups\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(styles, /:root\[data-theme='light'\]/);
  assert.match(styles, /:root\[data-theme='dark'\]/);

  const apiFiles = files.filter((file) => file.replaceAll("\\", "/").startsWith("api/"));
  const functionNames = apiFiles.map((file) => file.replaceAll("\\", "/")).sort();
  assert.deepEqual(functionNames, ["api/ai.js", "api/github.js", "api/health.js", "api/insights.js"]);
  assert.ok(apiFiles.length <= 10, "Vercel function count stays within the requested budget");
  assert.equal(API_ROUTE_HANDLERS.size, 15, "all public API routes remain registered");
  const functions = new Map();
  for (const file of apiFiles) {
    const route = await import(pathToFileURL(resolve(file)).href);
    assert.equal(typeof route.default, "function", `${file} exports a Vercel handler`);
    functions.set(file.replaceAll("\\", "/"), route.default);
  }
  for (const [path, handler] of API_ROUTE_HANDLERS) assert.equal(typeof handler, "function", `${path} has a handler`);
  function responseStub() {
    return {
      statusCode: 200,
      headers: {},
      writableEnded: false,
      setHeader(key, value) { this.headers[key] = value; return this; },
      status(value) { this.statusCode = value; return this; },
      send(value) { this.body = value; this.writableEnded = true; return this; },
      end(value) { this.body = value; this.writableEnded = true; return this; }
    };
  }
  const healthResponse = responseStub();
  await functions.get("api/health.js")({ method: "GET", url: "/api/health", headers: { host: "localhost:3000" }, query: {}, socket: { remoteAddress: "test-health" } }, healthResponse);
  assert.equal(healthResponse.statusCode, 200);
  const healthPayload = JSON.parse(healthResponse.body);
  assert.equal(healthPayload.status, "ok");
  assert.equal(healthPayload.diagnostics.gemini.upstreamChecked, false, "health diagnostics do not make an upstream request");
  assert.equal(JSON.stringify(healthPayload).includes("GEMINI_API_KEY"), false, "health diagnostics never reveal credentials");
  const invalidProfileResponse = responseStub();
  await API_ROUTE_HANDLERS.get("/api/github/profile")({ method: "GET", url: "/api/github/profile", headers: { host: "localhost:3000" }, query: { username: "../private" }, socket: { remoteAddress: "test-invalid" } }, invalidProfileResponse);
  assert.equal(invalidProfileResponse.statusCode, 400);
  const invalidTrackerResponse = responseStub();
  await API_ROUTE_HANDLERS.get("/api/github/activity-tracker")({ method: "GET", url: "/api/github/activity-tracker", headers: { host: "localhost:3000" }, query: { username: "../private" }, socket: { remoteAddress: "test-invalid-tracker" } }, invalidTrackerResponse);
  assert.equal(invalidTrackerResponse.statusCode, 400);
  const invalidCompareResponse = responseStub();
  await API_ROUTE_HANDLERS.get("/api/insights/compare")({ method: "POST", url: "/api/insights/compare", headers: { host: "localhost:3000" }, body: { usernameA: "octocat", usernameB: "bad/name" }, socket: { remoteAddress: "test-compare" } }, invalidCompareResponse);
  assert.equal(invalidCompareResponse.statusCode, 400);
  const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8"));
  for (const group of ["github", "insights", "ai"]) {
    assert.ok(vercelConfig.rewrites.some((rule) => rule.source === `/api/${group}/:__ghinsightsRoute` && rule.destination === `/api/${group}`), `${group} routes rewrite to their shared function`);
  }
  for (const routePath of API_ROUTE_HANDLERS.keys()) {
    if (routePath === "/api/health") continue;
    const [, , group, operation] = routePath.split("/");
    assert.ok(operation && functions.has(`api/${group}.js`), `${routePath} maps to a deployed group function`);
    assert.ok(vercelConfig.rewrites.some((rule) => rule.source === `/api/${group}/:__ghinsightsRoute` && rule.destination === `/api/${group}`), `${routePath} has a matching Vercel rewrite`);
  }
  assert.equal(vercelConfig.rewrites.some((rule) => rule.source === "/api/health"), false, "health remains directly routed");
  const groupedGithubError = responseStub();
  await functions.get("api/github.js")({ method: "GET", url: "/api/github?__ghinsightsRoute=profile&username=bad%2Fname", headers: { host: "localhost:3000" }, query: { __ghinsightsRoute: "profile", username: "bad/name" }, socket: { remoteAddress: "test-group-route" } }, groupedGithubError);
  assert.equal(groupedGithubError.statusCode, 400, "group function dispatches to the original GitHub handler");
  const groupedTrackerError = responseStub();
  await functions.get("api/github.js")({ method: "GET", url: "/api/github?__ghinsightsRoute=activity-tracker&username=bad%2Fname", headers: { host: "localhost:3000" }, query: { __ghinsightsRoute: "activity-tracker", username: "bad/name" }, socket: { remoteAddress: "test-group-tracker" } }, groupedTrackerError);
  assert.equal(groupedTrackerError.statusCode, 400, "group function dispatches to the activity tracker handler");
  const unknownGroupRoute = responseStub();
  await functions.get("api/ai.js")({ method: "GET", url: "/api/ai?__ghinsightsRoute=missing", headers: { host: "localhost:3000" }, query: { __ghinsightsRoute: "missing" }, socket: { remoteAddress: "test-unknown-group-route" } }, unknownGroupRoute);
  assert.equal(unknownGroupRoute.statusCode, 404);
  const wrongGroupMethod = responseStub();
  await functions.get("api/github.js")({ method: "POST", url: "/api/github?__ghinsightsRoute=profile", headers: { host: "localhost:3000" }, query: { __ghinsightsRoute: "profile" }, socket: { remoteAddress: "test-group-method" } }, wrongGroupMethod);
  assert.equal(wrongGroupMethod.statusCode, 405);
  if (!failed) process.stdout.write(`JavaScript syntax, GitHub analysis, Gemini structured/Markdown compatibility, error diagnosis and retries, static assets, light/dark and mobile AI styles, 4 Vercel function entrypoints, and ${API_ROUTE_HANDLERS.size} public route handlers passed. Mocked fixtures only; no external APIs or credentials were used.\n`);
} catch (error) {
  failed = true;
  process.stderr.write(`Local check failed: ${error.stack || error}\n`);
}

if (failed) process.exitCode = 1;
