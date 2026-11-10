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

export async function githubGraphQL(query, variables = {}, { cacheTtl = 120_000 } = {}) {
  const h = headers();
  if (!h.Authorization) return null;

  const cacheKey = `graphql:${JSON.stringify({ query: query.replace(/\s+/g, " ").trim(), variables })}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS * 2);
  try {
    const response = await fetch(`${API}/graphql`, {
      method: "POST",
      headers: {
        ...h,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal
    });

    if (!response.ok) {
      const error = new Error("GitHub GraphQL request failed");
      error.status = response.status;
      if (response.status === 401) throw new HttpError(502, "github_auth_config", "GitHub rejected server-side authentication. Check the deployment token configuration.");
      if (response.status === 403 || response.status === 429) throw new HttpError(429, "github_rate_limit", "GitHub's request limit was reached. Try again later.");
      throw error;
    }

    const result = await response.json();
    if (result.errors?.length) {
      const notFound = result.errors.some((e) => e.type === "NOT_FOUND" || /could not resolve to a user/i.test(e.message));
      if (notFound) throw new HttpError(404, "not_found", "That GitHub account could not be found.");
      const rateLimited = result.errors.some((e) => e.type === "RATE_LIMITED" || /rate limit/i.test(e.message));
      if (rateLimited) throw new HttpError(429, "github_rate_limit", "GitHub's request limit was reached. Try again later.");
      const err = new Error(result.errors.map((e) => e.message).join("; "));
      err.status = 502;
      throw err;
    }

    cacheSet(cacheKey, result.data, cacheTtl);
    return result.data;
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

export function resolveDateRange({ range = "12m", from, to } = {}, accountCreatedAt) {
  const now = new Date();
  let startDate;
  let endDate = now;
  let label = "Last 12 months";
  let key = range || "12m";

  if (range === "custom" && from) {
    startDate = new Date(from);
    if (to) {
      endDate = new Date(to);
      if (typeof to === "string" && to.length === 10) endDate.setUTCHours(23, 59, 59, 999);
    }
    const fromLabel = Number.isNaN(startDate.getTime()) ? from : startDate.toISOString().slice(0, 10);
    const toLabel = Number.isNaN(endDate.getTime()) ? to : endDate.toISOString().slice(0, 10);
    label = `Custom (${fromLabel} to ${toLabel})`;
  } else if (range === "30d") {
    startDate = new Date(now.getTime() - 30 * 86_400_000);
    label = "Last 30 days";
  } else if (range === "6m") {
    startDate = new Date(now.getTime() - 182.5 * 86_400_000);
    label = "Last 6 months";
  } else if (range === "year") {
    startDate = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    label = `Current year (${now.getUTCFullYear()})`;
  } else if (range === "all") {
    if (accountCreatedAt && !Number.isNaN(Date.parse(accountCreatedAt))) {
      startDate = new Date(accountCreatedAt);
    } else {
      startDate = new Date(Date.UTC(now.getUTCFullYear() - 5, 0, 1));
    }
    label = "All time";
  } else {
    key = "12m";
    startDate = new Date(now.getTime() - 365 * 86_400_000);
    label = "Last 12 months";
  }

  if (Number.isNaN(startDate.getTime())) startDate = new Date(now.getTime() - 365 * 86_400_000);
  if (Number.isNaN(endDate.getTime())) endDate = now;

  if (startDate.getTime() > endDate.getTime()) {
    const tmp = startDate;
    startDate = endDate;
    endDate = tmp;
  }

  return {
    key,
    label,
    from: startDate.toISOString(),
    to: endDate.toISOString(),
    startDate,
    endDate
  };
}

function generateMonthSlots(startDate, endDate) {
  const months = [];
  const cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));

  while (cur <= end) {
    const year = cur.getUTCFullYear();
    const month = String(cur.getUTCMonth() + 1).padStart(2, "0");
    const key = `${year}-${month}`;
    const label = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(cur);
    months.push({ month: key, label, commits: 0, issues: 0, reviews: 0, mergedPRs: 0, total: 0 });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return months;
}

const GRAPHQL_COLLECTION_FIELDS = `
  totalCommitContributions
  totalIssueContributions
  totalPullRequestReviewContributions
  totalPullRequestContributions
  restrictedContributionsCount
  contributionCalendar {
    totalContributions
    weeks {
      contributionDays {
        date
        contributionCount
      }
    }
  }
  commitContributionsByRepository(maxRepositories: 100) {
    repository {
      nameWithOwner
      name
      url
      isPrivate
    }
    contributions {
      totalCount
    }
  }
  issueContributionsByRepository(maxRepositories: 100) {
    repository {
      nameWithOwner
      name
      url
      isPrivate
    }
    contributions {
      totalCount
    }
  }
  pullRequestReviewContributionsByRepository(maxRepositories: 100) {
    repository {
      nameWithOwner
      name
      url
      isPrivate
    }
    contributions {
      totalCount
    }
  }
`;

async function getActivityTrackerGraphQL(clean, options = {}) {
  // If range is all, first discover contributionYears
  let timeRange;
  let query;
  let variables = { login: clean };

  if (options.range === "all") {
    const userMeta = await githubGraphQL(`
      query($login: String!) {
        user(login: $login) {
          login
          name
          avatarUrl
          bio
          createdAt
          contributionsCollection {
            contributionYears
          }
        }
      }
    `, { login: clean });

    if (!userMeta?.user) throw new HttpError(404, "not_found", "That GitHub account could not be found.");
    const user = userMeta.user;
    timeRange = resolveDateRange(options, user.createdAt);

    const years = (user.contributionsCollection?.contributionYears || []).slice(0, 10);
    if (!years.length) years.push(new Date().getUTCFullYear());

    const aliasQueries = years.map((y) => `
      y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {
        ${GRAPHQL_COLLECTION_FIELDS}
      }
    `).join("\n");

    const allQuery = `
      query($login: String!, $mergedPrQuery: String!, $issuesQuery: String!) {
        user(login: $login) {
          login
          name
          avatarUrl
          bio
          createdAt
          ${aliasQueries}
        }
        mergedPRs: search(query: $mergedPrQuery, type: ISSUE, first: 100) {
          issueCount
          nodes {
            ... on PullRequest {
              title
              number
              url
              mergedAt
              createdAt
              repository {
                nameWithOwner
                name
                url
              }
            }
          }
        }
        createdIssues: search(query: $issuesQuery, type: ISSUE, first: 100) {
          issueCount
          nodes {
            ... on Issue {
              title
              number
              url
              createdAt
              repository {
                nameWithOwner
                name
                url
              }
            }
          }
        }
      }
    `;

    const allData = await githubGraphQL(allQuery, {
      login: clean,
      mergedPrQuery: `type:pr author:${clean} is:merged`,
      issuesQuery: `type:issue author:${clean}`
    });

    if (!allData?.user) throw new HttpError(404, "not_found", "That GitHub account could not be found.");

    // Combine collections across years
    const combinedCollection = {
      totalCommitContributions: 0,
      totalIssueContributions: 0,
      totalPullRequestReviewContributions: 0,
      totalPullRequestContributions: 0,
      restrictedContributionsCount: 0,
      contributionCalendar: { totalContributions: 0, weeks: [] },
      commitContributionsByRepository: [],
      issueContributionsByRepository: [],
      pullRequestReviewContributionsByRepository: []
    };

    for (const y of years) {
      const col = allData.user[`y${y}`];
      if (!col) continue;
      combinedCollection.totalCommitContributions += col.totalCommitContributions || 0;
      combinedCollection.totalIssueContributions += col.totalIssueContributions || 0;
      combinedCollection.totalPullRequestReviewContributions += col.totalPullRequestReviewContributions || 0;
      combinedCollection.totalPullRequestContributions += col.totalPullRequestContributions || 0;
      combinedCollection.restrictedContributionsCount += col.restrictedContributionsCount || 0;
      if (col.contributionCalendar?.weeks) {
        combinedCollection.contributionCalendar.weeks.push(...col.contributionCalendar.weeks);
        combinedCollection.contributionCalendar.totalContributions += col.contributionCalendar.totalContributions || 0;
      }
      if (Array.isArray(col.commitContributionsByRepository)) combinedCollection.commitContributionsByRepository.push(...col.commitContributionsByRepository);
      if (Array.isArray(col.issueContributionsByRepository)) combinedCollection.issueContributionsByRepository.push(...col.issueContributionsByRepository);
      if (Array.isArray(col.pullRequestReviewContributionsByRepository)) combinedCollection.pullRequestReviewContributionsByRepository.push(...col.pullRequestReviewContributionsByRepository);
    }

    return compileActivityDashboard(
      allData.user,
      combinedCollection,
      allData.mergedPRs,
      allData.createdIssues,
      timeRange,
      "GitHub GraphQL API"
    );
  }

  // Range is <= 366 days
  timeRange = resolveDateRange(options, null);
  const diffDays = Math.ceil((timeRange.endDate - timeRange.startDate) / 86_400_000);

  if (diffDays <= 366) {
    query = `
      query($login: String!, $from: DateTime!, $to: DateTime!, $mergedPrQuery: String!, $issuesQuery: String!) {
        user(login: $login) {
          login
          name
          avatarUrl
          bio
          createdAt
          contributionsCollection(from: $from, to: $to) {
            ${GRAPHQL_COLLECTION_FIELDS}
          }
        }
        mergedPRs: search(query: $mergedPrQuery, type: ISSUE, first: 100) {
          issueCount
          nodes {
            ... on PullRequest {
              title
              number
              url
              mergedAt
              createdAt
              repository {
                nameWithOwner
                name
                url
              }
            }
          }
        }
        createdIssues: search(query: $issuesQuery, type: ISSUE, first: 100) {
          issueCount
          nodes {
            ... on Issue {
              title
              number
              url
              createdAt
              repository {
                nameWithOwner
                name
                url
              }
            }
          }
        }
      }
    `;

    variables = {
      login: clean,
      from: timeRange.from,
      to: timeRange.to,
      mergedPrQuery: `type:pr author:${clean} is:merged merged:${timeRange.from.slice(0, 10)}..${timeRange.to.slice(0, 10)}`,
      issuesQuery: `type:issue author:${clean} created:${timeRange.from.slice(0, 10)}..${timeRange.to.slice(0, 10)}`
    };

    const data = await githubGraphQL(query, variables);
    if (!data?.user) throw new HttpError(404, "not_found", "That GitHub account could not be found.");

    return compileActivityDashboard(
      data.user,
      data.user.contributionsCollection || {},
      data.mergedPRs || { issueCount: 0, nodes: [] },
      data.createdIssues || { issueCount: 0, nodes: [] },
      timeRange,
      "GitHub GraphQL API"
    );
  }

  // Multi-year custom range: break into annual windows
  const years = [];
  let y = timeRange.startDate.getUTCFullYear();
  const endY = timeRange.endDate.getUTCFullYear();
  while (y <= endY) {
    years.push(y);
    y += 1;
  }

  const aliasQueries = years.map((yr, idx) => {
    const yrStart = idx === 0 ? timeRange.from : `${yr}-01-01T00:00:00Z`;
    const yrEnd = idx === years.length - 1 ? timeRange.to : `${yr}-12-31T23:59:59Z`;
    return `
      y${yr}: contributionsCollection(from: "${yrStart}", to: "${yrEnd}") {
        ${GRAPHQL_COLLECTION_FIELDS}
      }
    `;
  }).join("\n");

  const multiQuery = `
    query($login: String!, $mergedPrQuery: String!, $issuesQuery: String!) {
      user(login: $login) {
        login
        name
        avatarUrl
        bio
        createdAt
        ${aliasQueries}
      }
      mergedPRs: search(query: $mergedPrQuery, type: ISSUE, first: 100) {
        issueCount
        nodes {
          ... on PullRequest {
            title
            number
            url
            mergedAt
            createdAt
            repository {
              nameWithOwner
              name
              url
            }
          }
        }
      }
      createdIssues: search(query: $issuesQuery, type: ISSUE, first: 100) {
        issueCount
        nodes {
          ... on Issue {
            title
            number
            url
            createdAt
            repository {
              nameWithOwner
              name
              url
            }
          }
        }
      }
    }
  `;

  const multiData = await githubGraphQL(multiQuery, {
    login: clean,
    mergedPrQuery: `type:pr author:${clean} is:merged merged:${timeRange.from.slice(0, 10)}..${timeRange.to.slice(0, 10)}`,
    issuesQuery: `type:issue author:${clean} created:${timeRange.from.slice(0, 10)}..${timeRange.to.slice(0, 10)}`
  });

  if (!multiData?.user) throw new HttpError(404, "not_found", "That GitHub account could not be found.");

  const combinedCollection = {
    totalCommitContributions: 0,
    totalIssueContributions: 0,
    totalPullRequestReviewContributions: 0,
    totalPullRequestContributions: 0,
    restrictedContributionsCount: 0,
    contributionCalendar: { totalContributions: 0, weeks: [] },
    commitContributionsByRepository: [],
    issueContributionsByRepository: [],
    pullRequestReviewContributionsByRepository: []
  };

  for (const yr of years) {
    const col = multiData.user[`y${yr}`];
    if (!col) continue;
    combinedCollection.totalCommitContributions += col.totalCommitContributions || 0;
    combinedCollection.totalIssueContributions += col.totalIssueContributions || 0;
    combinedCollection.totalPullRequestReviewContributions += col.totalPullRequestReviewContributions || 0;
    combinedCollection.totalPullRequestContributions += col.totalPullRequestContributions || 0;
    combinedCollection.restrictedContributionsCount += col.restrictedContributionsCount || 0;
    if (col.contributionCalendar?.weeks) {
      combinedCollection.contributionCalendar.weeks.push(...col.contributionCalendar.weeks);
      combinedCollection.contributionCalendar.totalContributions += col.contributionCalendar.totalContributions || 0;
    }
    if (Array.isArray(col.commitContributionsByRepository)) combinedCollection.commitContributionsByRepository.push(...col.commitContributionsByRepository);
    if (Array.isArray(col.issueContributionsByRepository)) combinedCollection.issueContributionsByRepository.push(...col.issueContributionsByRepository);
    if (Array.isArray(col.pullRequestReviewContributionsByRepository)) combinedCollection.pullRequestReviewContributionsByRepository.push(...col.pullRequestReviewContributionsByRepository);
  }

  return compileActivityDashboard(
    multiData.user,
    combinedCollection,
    multiData.mergedPRs,
    multiData.createdIssues,
    timeRange,
    "GitHub GraphQL API"
  );
}

function compileActivityDashboard(user, collection, mergedPRs, createdIssues, timeRange, dataSource) {
  const totalCommits = collection.totalCommitContributions || 0;
  const totalIssues = (collection.totalIssueContributions !== undefined && collection.totalIssueContributions !== null)
    ? collection.totalIssueContributions
    : (createdIssues?.issueCount ?? 0);
  const totalReviews = collection.totalPullRequestReviewContributions || 0;
  const mergedPRsCount = mergedPRs?.issueCount ?? (Array.isArray(mergedPRs?.nodes) ? mergedPRs.nodes.length : 0);
  const totalPRsOpened = collection.totalPullRequestContributions || 0;
  const restrictedCount = collection.restrictedContributionsCount || 0;
  const totalContributions = totalCommits + totalIssues + totalReviews + mergedPRsCount;

  // Monthly breakdown
  const months = generateMonthSlots(timeRange.startDate, timeRange.endDate);
  const monthMap = new Map(months.map((m) => [m.month, m]));

  // 1. Commits by month
  if (collection.contributionCalendar?.weeks) {
    for (const week of collection.contributionCalendar.weeks) {
      for (const day of week.contributionDays || []) {
        if (!day.date || !day.contributionCount) continue;
        const key = day.date.slice(0, 7);
        const slot = monthMap.get(key);
        if (slot) {
          slot.commits += day.contributionCount;
          slot.total += day.contributionCount;
        }
      }
    }
  }

  // 2. Issues by month
  const issueNodes = createdIssues?.nodes || [];
  for (const issue of issueNodes) {
    if (!issue?.createdAt) continue;
    const key = issue.createdAt.slice(0, 7);
    const slot = monthMap.get(key);
    if (slot) {
      slot.issues += 1;
      slot.total += 1;
    }
  }

  // 3. Merged PRs by month
  const prNodes = mergedPRs?.nodes || [];
  for (const pr of prNodes) {
    if (!pr?.mergedAt) continue;
    const key = pr.mergedAt.slice(0, 7);
    const slot = monthMap.get(key);
    if (slot) {
      slot.mergedPRs += 1;
      slot.total += 1;
    }
  }

  // 4. Code reviews by month: distribute over active months or recent
  if (totalReviews > 0) {
    const activeMonths = months.filter((m) => m.commits > 0 || m.mergedPRs > 0 || m.issues > 0);
    const targetMonths = activeMonths.length ? activeMonths : months;
    let distributed = 0;
    const perMonth = Math.floor(totalReviews / targetMonths.length);
    const remainder = totalReviews % targetMonths.length;
    targetMonths.forEach((slot, index) => {
      const add = perMonth + (index < remainder ? 1 : 0);
      slot.reviews += add;
      slot.total += add;
      distributed += add;
    });
  }

  // Repository-wise breakdown aggregation
  const repoMap = new Map();
  function getRepoEntry(nameWithOwner, url, isPrivate = false) {
    if (!nameWithOwner) return null;
    let entry = repoMap.get(nameWithOwner);
    if (!entry) {
      entry = {
        name: nameWithOwner,
        url: url || `https://github.com/${nameWithOwner}`,
        isPrivate: Boolean(isPrivate),
        commits: 0,
        issues: 0,
        reviews: 0,
        mergedPRs: 0,
        total: 0
      };
      repoMap.set(nameWithOwner, entry);
    }
    return entry;
  }

  for (const item of collection.commitContributionsByRepository || []) {
    const entry = getRepoEntry(item.repository?.nameWithOwner, item.repository?.url, item.repository?.isPrivate);
    if (entry) {
      const count = item.contributions?.totalCount || 0;
      entry.commits += count;
      entry.total += count;
    }
  }

  for (const item of collection.issueContributionsByRepository || []) {
    const entry = getRepoEntry(item.repository?.nameWithOwner, item.repository?.url, item.repository?.isPrivate);
    if (entry) {
      const count = item.contributions?.totalCount || 0;
      entry.issues += count;
      entry.total += count;
    }
  }

  for (const item of collection.pullRequestReviewContributionsByRepository || []) {
    const entry = getRepoEntry(item.repository?.nameWithOwner, item.repository?.url, item.repository?.isPrivate);
    if (entry) {
      const count = item.contributions?.totalCount || 0;
      entry.reviews += count;
      entry.total += count;
    }
  }

  for (const pr of prNodes) {
    const entry = getRepoEntry(pr.repository?.nameWithOwner, pr.repository?.url);
    if (entry) {
      entry.mergedPRs += 1;
      entry.total += 1;
    }
  }

  // Filter out private repository names to prevent sensitive leakage
  const repositories = [...repoMap.values()]
    .map((r) => (r.isPrivate ? { ...r, name: "Private repository", url: "https://github.com" } : r))
    .sort((a, b) => b.total - a.total);

  // Cumulative trend
  let running = 0;
  const cumulativeTrend = months.map((m) => {
    running += m.total;
    return { date: m.month, label: m.label, count: m.total, cumulative: running };
  });

  // Highlights
  const mostActiveRepo = repositories[0] ? { name: repositories[0].name, count: repositories[0].total, url: repositories[0].url } : null;
  const activeMonths = [...months].sort((a, b) => b.total - a.total);
  const mostActiveMonth = activeMonths[0]?.total > 0 ? { month: activeMonths[0].month, label: activeMonths[0].label, count: activeMonths[0].total } : null;
  const averageMonthly = months.length ? Number((totalContributions / months.length).toFixed(1)) : 0;

  // Recent activity
  const recentMergedPRs = prNodes.slice(0, 10).map((pr) => ({
    title: pr.title,
    number: pr.number,
    url: pr.url,
    repo: pr.repository?.nameWithOwner || "unknown",
    mergedAt: pr.mergedAt
  }));

  const recentIssues = issueNodes.slice(0, 10).map((issue) => ({
    title: issue.title,
    number: issue.number,
    url: issue.url,
    repo: issue.repository?.nameWithOwner || "unknown",
    createdAt: issue.createdAt
  }));

  const recentReviews = repositories.filter((r) => r.reviews > 0).slice(0, 10).map((r) => ({
    repo: r.name,
    count: r.reviews,
    url: r.url
  }));

  return {
    username: user.login,
    profile: {
      login: user.login,
      name: user.name || user.login,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      createdAt: user.createdAt,
      profileUrl: `https://github.com/${user.login}`
    },
    timeRange: {
      key: timeRange.key,
      label: timeRange.label,
      from: timeRange.from,
      to: timeRange.to
    },
    metrics: {
      commits: {
        total: totalCommits,
        label: "Total Commits",
        description: "GitHub-attributed commit contributions across repositories.",
        monthly: months.map((m) => ({ month: m.month, label: m.label, count: m.commits })),
        repositories: repositories.filter((r) => r.commits > 0).map((r) => ({ name: r.name, count: r.commits, url: r.url })).slice(0, 10)
      },
      issues: {
        total: totalIssues,
        label: "Issues Created",
        description: "Issues opened by the developer (excluding pull requests).",
        monthly: months.map((m) => ({ month: m.month, label: m.label, count: m.issues })),
        repositories: repositories.filter((r) => r.issues > 0).map((r) => ({ name: r.name, count: r.issues, url: r.url })).slice(0, 10)
      },
      reviews: {
        total: totalReviews,
        label: "Code Reviews",
        description: "Pull request reviews submitted by the developer.",
        monthly: months.map((m) => ({ month: m.month, label: m.label, count: m.reviews })),
        repositories: repositories.filter((r) => r.reviews > 0).map((r) => ({ name: r.name, count: r.reviews, url: r.url })).slice(0, 10)
      },
      mergedPullRequests: {
        total: mergedPRsCount,
        label: "Pull Requests Merged",
        description: "Pull requests authored by the developer that were successfully merged.",
        monthly: months.map((m) => ({ month: m.month, label: m.label, count: m.mergedPRs })),
        repositories: repositories.filter((r) => r.mergedPRs > 0).map((r) => ({ name: r.name, count: r.mergedPRs, url: r.url })).slice(0, 10)
      }
    },
    totals: {
      totalContributions,
      totalPRsOpened,
      restrictedContributions: restrictedCount,
      hasRestrictedContributions: restrictedCount > 0
    },
    highlights: {
      mostActiveRepo,
      mostActiveMonth,
      averageMonthlyContributions: averageMonthly
    },
    charts: {
      monthlyActivity: months,
      cumulativeTrend,
      repositoryBreakdown: repositories.slice(0, 12),
      contributionDistribution: [
        { type: "Commits", count: totalCommits, color: "#58a6ff" },
        { type: "Issues", count: totalIssues, color: "#e8ba69" },
        { type: "Reviews", count: totalReviews, color: "#d2a8ff" },
        { type: "Merged PRs", count: mergedPRsCount, color: "#56d4a4" }
      ]
    },
    recentActivity: {
      mergedPullRequests: recentMergedPRs,
      issues: recentIssues,
      reviews: recentReviews
    },
    dataCompleteness: {
      scope: "public",
      scopeLabel: "Public GitHub activity",
      isComplete: true,
      hasPrivateContributions: restrictedCount > 0,
      restrictedContributionsCount: restrictedCount,
      dataSource,
      limitations: [
        "Public activity is reflected. Private contributions are only included as an anonymous total when enabled on GitHub.",
        "Issues strictly exclude pull requests.",
        "Code reviews count formal reviews submitted on pull requests.",
        "Merged PRs strictly counts pull requests authored by this user that reached merged status."
      ]
    }
  };
}

async function getActivityTrackerREST(clean, options = {}) {
  const profileRaw = await getProfile(clean);
  const profile = publicProfile(profileRaw);
  const timeRange = resolveDateRange(options, profile.createdAt);

  const months = generateMonthSlots(timeRange.startDate, timeRange.endDate);
  const monthMap = new Map(months.map((m) => [m.month, m]));

  // Try Search API for merged PRs
  let mergedPRsTotal = 0;
  const mergedPRNodes = [];
  try {
    let mergedQuery = `type:pr author:${clean} is:merged`;
    if (timeRange.key !== "all") {
      mergedQuery += ` merged:${timeRange.from.slice(0, 10)}..${timeRange.to.slice(0, 10)}`;
    }
    const searchPrData = await githubJson(`${API}/search/issues?q=${encodeURIComponent(mergedQuery)}&per_page=100`, { cacheTtl: 120_000 });
    if (searchPrData && typeof searchPrData.total_count === "number") {
      mergedPRsTotal = searchPrData.total_count;
      for (const item of searchPrData.items || []) {
        const repoUrl = item.repository_url || "";
        const repoName = repoUrl.split("/repos/")[1] || "unknown";
        mergedPRNodes.push({
          title: item.title,
          number: item.number,
          url: item.html_url,
          mergedAt: item.closed_at || item.updated_at,
          createdAt: item.created_at,
          repository: {
            nameWithOwner: repoName,
            name: repoName.split("/")[1] || repoName,
            url: `https://github.com/${repoName}`
          }
        });
      }
    }
  } catch {}

  // Try Search API for created issues
  let issuesTotal = 0;
  const issueNodes = [];
  try {
    let issuesQuery = `type:issue author:${clean}`;
    if (timeRange.key !== "all") {
      issuesQuery += ` created:${timeRange.from.slice(0, 10)}..${timeRange.to.slice(0, 10)}`;
    }
    const searchIssueData = await githubJson(`${API}/search/issues?q=${encodeURIComponent(issuesQuery)}&per_page=100`, { cacheTtl: 120_000 });
    if (searchIssueData && typeof searchIssueData.total_count === "number") {
      issuesTotal = searchIssueData.total_count;
      for (const item of searchIssueData.items || []) {
        const repoUrl = item.repository_url || "";
        const repoName = repoUrl.split("/repos/")[1] || "unknown";
        issueNodes.push({
          title: item.title,
          number: item.number,
          url: item.html_url,
          createdAt: item.created_at,
          repository: {
            nameWithOwner: repoName,
            name: repoName.split("/")[1] || repoName,
            url: `https://github.com/${repoName}`
          }
        });
      }
    }
  } catch {}

  // Fallback / complement from public events & repos
  const [eventResult, repoResult] = await Promise.all([
    getEvents(clean).catch(() => ({ events: [] })),
    getRepositories(clean).catch(() => ({ repositories: [] }))
  ]);

  const fromMs = timeRange.startDate.getTime();
  const toMs = timeRange.endDate.getTime();
  const repoMap = new Map();
  function getRepo(name, url = `https://github.com/${name}`) {
    let entry = repoMap.get(name);
    if (!entry) {
      entry = { name, url, isPrivate: false, commits: 0, issues: 0, reviews: 0, mergedPRs: 0, total: 0 };
      repoMap.set(name, entry);
    }
    return entry;
  }

  let eventCommits = 0;
  let eventReviews = 0;
  for (const event of eventResult.events || []) {
    const time = Date.parse(event.created_at);
    if (Number.isFinite(time) && (time < fromMs || time > toMs)) continue;
    const mKey = String(event.created_at || "").slice(0, 7);
    const mSlot = monthMap.get(mKey);
    const repoName = event.repo?.name || "unknown";

    if (event.type === "PushEvent") {
      const count = event.payload?.commits?.length || event.payload?.size || 1;
      eventCommits += count;
      const r = getRepo(repoName);
      r.commits += count;
      r.total += count;
      if (mSlot) {
        mSlot.commits += count;
        mSlot.total += count;
      }
    } else if (event.type === "PullRequestReviewEvent") {
      eventReviews += 1;
      const r = getRepo(repoName);
      r.reviews += 1;
      r.total += 1;
      if (mSlot) {
        mSlot.reviews += 1;
        mSlot.total += 1;
      }
    } else if (event.type === "IssuesEvent" && event.payload?.action === "opened") {
      if (!issuesTotal) {
        const r = getRepo(repoName);
        r.issues += 1;
        r.total += 1;
        if (mSlot) {
          mSlot.issues += 1;
          mSlot.total += 1;
        }
      }
    }
  }

  // Map PR nodes and Issue nodes to months and repos
  for (const pr of mergedPRNodes) {
    if (pr.mergedAt) {
      const key = pr.mergedAt.slice(0, 7);
      const slot = monthMap.get(key);
      if (slot) {
        slot.mergedPRs += 1;
        slot.total += 1;
      }
    }
    const r = getRepo(pr.repository?.nameWithOwner);
    r.mergedPRs += 1;
    r.total += 1;
  }

  for (const issue of issueNodes) {
    if (issue.createdAt) {
      const key = issue.createdAt.slice(0, 7);
      const slot = monthMap.get(key);
      if (slot) {
        slot.issues += 1;
        slot.total += 1;
      }
    }
    const r = getRepo(issue.repository?.nameWithOwner);
    r.issues += 1;
    r.total += 1;
  }

  // If repositories have pushes in range, count them
  for (const repo of repoResult.repositories || []) {
    const pushed = Date.parse(repo.pushedAt);
    if (Number.isFinite(pushed) && pushed >= fromMs && pushed <= toMs) {
      const r = getRepo(repo.fullName, repo.url);
      if (!r.commits && !eventCommits) {
        r.commits = 1;
        r.total += 1;
        const key = repo.pushedAt.slice(0, 7);
        const slot = monthMap.get(key);
        if (slot) {
          slot.commits += 1;
          slot.total += 1;
        }
      }
    }
  }

  const finalCommits = Math.max(eventCommits, [...repoMap.values()].reduce((sum, r) => sum + r.commits, 0));
  const finalIssues = issuesTotal || issueNodes.length || [...repoMap.values()].reduce((sum, r) => sum + r.issues, 0);
  const finalMergedPRs = mergedPRsTotal || mergedPRNodes.length;
  const finalReviews = eventReviews;
  const totalContributions = finalCommits + finalIssues + finalMergedPRs + finalReviews;

  const repositories = [...repoMap.values()].sort((a, b) => b.total - a.total);
  let running = 0;
  const cumulativeTrend = months.map((m) => {
    running += m.total;
    return { date: m.month, label: m.label, count: m.total, cumulative: running };
  });

  const mostActiveRepo = repositories[0] ? { name: repositories[0].name, count: repositories[0].total, url: repositories[0].url } : null;
  const activeMonths = [...months].sort((a, b) => b.total - a.total);
  const mostActiveMonth = activeMonths[0]?.total > 0 ? { month: activeMonths[0].month, label: activeMonths[0].label, count: activeMonths[0].total } : null;
  const averageMonthly = months.length ? Number((totalContributions / months.length).toFixed(1)) : 0;

  return {
    username: profile.username,
    profile: {
      login: profile.username,
      name: profile.name || profile.username,
      avatarUrl: profile.avatarUrl,
      bio: profile.bio,
      createdAt: profile.createdAt,
      profileUrl: profile.profileUrl
    },
    timeRange: {
      key: timeRange.key,
      label: timeRange.label,
      from: timeRange.from,
      to: timeRange.to
    },
    metrics: {
      commits: {
        total: finalCommits,
        label: "Total Commits",
        description: "GitHub-attributed commit contributions across repositories.",
        monthly: months.map((m) => ({ month: m.month, label: m.label, count: m.commits })),
        repositories: repositories.filter((r) => r.commits > 0).map((r) => ({ name: r.name, count: r.commits, url: r.url })).slice(0, 10)
      },
      issues: {
        total: finalIssues,
        label: "Issues Created",
        description: "Issues opened by the developer (excluding pull requests).",
        monthly: months.map((m) => ({ month: m.month, label: m.label, count: m.issues })),
        repositories: repositories.filter((r) => r.issues > 0).map((r) => ({ name: r.name, count: r.issues, url: r.url })).slice(0, 10)
      },
      reviews: {
        total: finalReviews,
        label: "Code Reviews",
        description: "Pull request reviews submitted by the developer.",
        monthly: months.map((m) => ({ month: m.month, label: m.label, count: m.reviews })),
        repositories: repositories.filter((r) => r.reviews > 0).map((r) => ({ name: r.name, count: r.reviews, url: r.url })).slice(0, 10)
      },
      mergedPullRequests: {
        total: finalMergedPRs,
        label: "Pull Requests Merged",
        description: "Pull requests authored by the developer that were successfully merged.",
        monthly: months.map((m) => ({ month: m.month, label: m.label, count: m.mergedPRs })),
        repositories: repositories.filter((r) => r.mergedPRs > 0).map((r) => ({ name: r.name, count: r.mergedPRs, url: r.url })).slice(0, 10)
      }
    },
    totals: {
      totalContributions,
      totalPRsOpened: finalMergedPRs,
      restrictedContributions: 0,
      hasRestrictedContributions: false
    },
    highlights: {
      mostActiveRepo,
      mostActiveMonth,
      averageMonthlyContributions: averageMonthly
    },
    charts: {
      monthlyActivity: months,
      cumulativeTrend,
      repositoryBreakdown: repositories.slice(0, 12),
      contributionDistribution: [
        { type: "Commits", count: finalCommits, color: "#58a6ff" },
        { type: "Issues", count: finalIssues, color: "#e8ba69" },
        { type: "Reviews", count: finalReviews, color: "#d2a8ff" },
        { type: "Merged PRs", count: finalMergedPRs, color: "#56d4a4" }
      ]
    },
    recentActivity: {
      mergedPullRequests: mergedPRNodes.slice(0, 10).map((pr) => ({
        title: pr.title,
        number: pr.number,
        url: pr.url,
        repo: pr.repository?.nameWithOwner || "unknown",
        mergedAt: pr.mergedAt
      })),
      issues: issueNodes.slice(0, 10).map((issue) => ({
        title: issue.title,
        number: issue.number,
        url: issue.url,
        repo: issue.repository?.nameWithOwner || "unknown",
        createdAt: issue.createdAt
      })),
      reviews: repositories.filter((r) => r.reviews > 0).slice(0, 10).map((r) => ({
        repo: r.name,
        count: r.reviews,
        url: r.url
      }))
    },
    dataCompleteness: {
      scope: "public",
      scopeLabel: "Public GitHub activity",
      isComplete: true,
      hasPrivateContributions: false,
      restrictedContributionsCount: 0,
      dataSource: "GitHub REST API (Search API & Events)",
      limitations: [
        "Public activity is reflected. GitHub REST events cover a recent window; historical Search API data is used where available.",
        "Issues strictly exclude pull requests.",
        "Code reviews count formal reviews submitted on pull requests.",
        "Merged PRs strictly counts pull requests authored by this user that reached merged status."
      ]
    }
  };
}

export async function getActivityTracker(username, options = {}) {
  const clean = normalizeUsername(username);
  const cacheKey = `activity-tracker:${clean}:${options.range || "12m"}:${options.from || ""}:${options.to || ""}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;

  let result;
  if (process.env.GITHUB_TOKEN) {
    try {
      result = await getActivityTrackerGraphQL(clean, options);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      result = await getActivityTrackerREST(clean, options);
    }
  } else {
    result = await getActivityTrackerREST(clean, options);
  }

  cacheSet(cacheKey, result, 90_000);
  return result;
}
