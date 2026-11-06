import { cacheGet, cacheSet } from "./cache.js";
import { HttpError, normalizeUsername } from "./validation.js";

const API = "https://api.github.com";
const TIMEOUT_MS = 5_000;
const MAX_REPO_PAGES = 10;
const MAX_EVENT_PAGES = 3;

function headers() {
  const result = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "GH-Insights/1.0"
  };
  if (process.env.GITHUB_TOKEN) result.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return result;
}

async function githubJson(url, { cacheTtl = 120_000 } = {}) {
  const hit = cacheGet(url);
  if (hit) return hit;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: headers(), signal: controller.signal });
    if (!response.ok) {
      const error = new Error("GitHub request failed");
      error.status = response.status;
      if (response.status === 422) throw new HttpError(422, "github_unavailable", "GitHub could not return public information for this account.");
      throw error;
    }
    const data = await response.json();
    cacheSet(url, data, cacheTtl);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function parseNext(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] || null;
}

function parseLastPage(linkHeader) {
  const match = String(linkHeader || "").match(/<([^>]+)>;\s*rel="last"/);
  if (!match) return null;
  const page = Number(new URL(match[1]).searchParams.get("page"));
  return Number.isInteger(page) && page > 0 ? page : null;
}

async function githubPage(url) {
  const response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    const error = new Error("GitHub request failed");
    error.status = response.status;
    throw error;
  }
  const link = response.headers.get("link");
  return { data: await response.json(), next: parseNext(link), lastPage: parseLastPage(link) };
}

export async function getProfile(username) {
  const clean = normalizeUsername(username);
  return githubJson(`${API}/users/${encodeURIComponent(clean)}`);
}

function normalizeRepo(repo) {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    url: repo.html_url,
    description: repo.description,
    language: repo.language,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.watchers_count,
    createdAt: repo.created_at,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
    defaultBranch: repo.default_branch,
    sizeKb: repo.size,
    topics: repo.topics || [],
    archived: repo.archived,
    fork: repo.fork,
    hasIssues: repo.has_issues,
    hasPages: repo.has_pages,
    hasWiki: repo.has_wiki,
    homepage: repo.homepage,
    license: repo.license?.spdx_id || null
  };
}

export async function getRepositories(username) {
  const clean = normalizeUsername(username);
  const cacheKey = `${API}/users/${encodeURIComponent(clean)}/repos?per_page=100&sort=updated&direction=desc`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;
  const firstUrl = `${API}/users/${encodeURIComponent(clean)}/repos?per_page=100&sort=updated&direction=desc&page=1`;
  const first = await githubPage(firstUrl);
  if (!Array.isArray(first.data)) throw new HttpError(502, "github_response_invalid", "GitHub returned an unexpected repository response.");
  const pageResults = [first];
  let capped = false;
  if (first.lastPage) {
    const targetPage = Math.min(first.lastPage, MAX_REPO_PAGES);
    const urls = Array.from({ length: Math.max(0, targetPage - 1) }, (_, index) => {
      const url = new URL(firstUrl);
      url.searchParams.set("page", String(index + 2));
      return url.href;
    });
    for (let index = 0; index < urls.length; index += 9) {
      pageResults.push(...await Promise.all(urls.slice(index, index + 9).map(githubPage)));
    }
    capped = first.lastPage > MAX_REPO_PAGES;
  } else {
    let next = first.next;
    while (next && pageResults.length < MAX_REPO_PAGES) {
      const result = await githubPage(next);
      pageResults.push(result);
      next = result.next;
    }
    capped = Boolean(next);
  }
  const repos = pageResults.flatMap((result) => {
    if (!Array.isArray(result.data)) throw new HttpError(502, "github_response_invalid", "GitHub returned an unexpected repository response.");
    return result.data.filter((repo) => repo.private !== true).map(normalizeRepo);
  });
  const result = {
    repositories: repos,
    pagesFetched: pageResults.length,
    complete: !capped,
    capped,
    cap: MAX_REPO_PAGES * 100
  };
  cacheSet(cacheKey, result, 180_000);
  return result;
}

export async function getEvents(username) {
  const clean = normalizeUsername(username);
  const cacheKey = `${API}/users/${encodeURIComponent(clean)}/events/public?per_page=100&page=1`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;
  const firstUrl = `${API}/users/${encodeURIComponent(clean)}/events/public?per_page=100&page=1`;
  const first = await githubPage(firstUrl);
  if (!Array.isArray(first.data)) throw new HttpError(502, "github_response_invalid", "GitHub returned an unexpected activity response.");
  const pageResults = [first];
  let capped = false;
  if (first.lastPage) {
    const targetPage = Math.min(first.lastPage, MAX_EVENT_PAGES);
    const urls = Array.from({ length: Math.max(0, targetPage - 1) }, (_, index) => {
      const url = new URL(firstUrl);
      url.searchParams.set("page", String(index + 2));
      return url.href;
    });
    pageResults.push(...await Promise.all(urls.map(githubPage)));
    capped = first.lastPage > MAX_EVENT_PAGES;
  } else {
    let next = first.next;
    while (next && pageResults.length < MAX_EVENT_PAGES) {
      const result = await githubPage(next);
      pageResults.push(result);
      next = result.next;
    }
    capped = Boolean(next);
  }
  const events = pageResults.flatMap((result) => {
    if (!Array.isArray(result.data)) throw new HttpError(502, "github_response_invalid", "GitHub returned an unexpected activity response.");
    return result.data;
  });
  const result = { events, pagesFetched: pageResults.length, capped };
  cacheSet(cacheKey, result, 90_000);
  return result;
}

export async function getActivityAnalysis(username) {
  const result = await getEvents(username);
  return normalizeEvents(result.events, result);
}

export async function getLanguageAnalysis(username) {
  const result = await getRepositories(username);
  const counts = {};
  for (const repo of result.repositories) if (repo.language) counts[repo.language] = (counts[repo.language] || 0) + 1;
  return {
    basis: "GitHub repository primary-language metadata; one primary language per repository.",
    distribution: Object.entries(counts).map(([name, repositoryCount]) => ({ name, repositoryCount })).sort((a, b) => b.repositoryCount - a.repositoryCount),
    coverage: { fetched: result.repositories.length, cap: result.cap, complete: result.complete }
  };
}

export function publicProfile(profile) {
  return {
    username: profile.login,
    name: profile.name,
    avatarUrl: profile.avatar_url,
    bio: profile.bio,
    company: profile.company,
    location: profile.location,
    blog: profile.blog,
    profileUrl: profile.html_url,
    followers: profile.followers,
    following: profile.following,
    publicRepos: profile.public_repos,
    publicGists: profile.public_gists,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
    hireable: profile.hireable
  };
}

export async function collectDeveloper(username) {
  const clean = normalizeUsername(username);
  const [profileRaw, repoResult, eventResult] = await Promise.all([
    getProfile(clean), getRepositories(clean), getEvents(clean)
  ]);
  const profile = publicProfile(profileRaw);
  const repositories = repoResult.repositories;
  const primaryLanguages = {};
  const topicCounts = {};
  let totalStars = 0;
  let totalForks = 0;
  for (const repo of repositories) {
    totalStars += repo.stars || 0;
    totalForks += repo.forks || 0;
    if (repo.language) primaryLanguages[repo.language] = (primaryLanguages[repo.language] || 0) + 1;
    for (const topic of repo.topics) topicCounts[topic] = (topicCounts[topic] || 0) + 1;
  }
  return {
    profile,
    repositories,
    repositoryCoverage: {
      fetched: repositories.length,
      reportedPublicTotal: profile.publicRepos,
      complete: repoResult.complete && repositories.length >= profile.publicRepos,
      capped: repoResult.capped,
      cap: repoResult.cap
    },
    activity: normalizeEvents(eventResult.events, eventResult),
    languages: {
      basis: "GitHub repository primary-language metadata; one primary language per repository.",
      distribution: Object.entries(primaryLanguages).map(([name, repositoryCount]) => ({ name, repositoryCount })).sort((a, b) => b.repositoryCount - a.repositoryCount),
      topicCounts: Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, count]) => ({ name, repositoryCount: count }))
    },
    totals: { stars: totalStars, forks: totalForks },
    collectedAt: new Date().toISOString(),
    source: {
      api: "GitHub REST API",
      rateLimitNote: "GitHub API rate limits depend on the server-side deployment configuration."
    }
  };
}

function normalizeEvents(events, coverage) {
  const counts = {};
  const days = {};
  for (const event of events) {
    const type = event.type || "OtherEvent";
    counts[type] = (counts[type] || 0) + 1;
    const day = String(event.created_at || "").slice(0, 10);
    if (day) days[day] = (days[day] || 0) + 1;
  }
  const dates = events.map((event) => event.created_at).filter(Boolean).sort();
  const first = dates[0] || null;
  const last = dates.at(-1) || null;
  return {
    eventCount: events.length,
    eventTypes: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count })),
    timeline: Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    firstObservedAt: first,
    lastObservedAt: last,
    pagesFetched: coverage.pagesFetched,
    capped: coverage.capped,
    limitation: `GitHub public events are a limited recent window and do not represent a complete contribution history.${coverage.capped ? " The 300-event retrieval bound was reached." : ""}`
  };
}
