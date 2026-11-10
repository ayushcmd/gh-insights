import assert from "node:assert/strict";
import { resolveDateRange, getActivityTracker, githubGraphQL } from "../lib/github.js";
import { normalizeUsername, HttpError } from "../lib/validation.js";
import githubActivityTrackerHandler from "../lib/api-routes/github-activity-tracker.js";

// 1. Date Range Resolution Tests
{
  const now = new Date();
  const range30d = resolveDateRange({ range: "30d" });
  assert.equal(range30d.key, "30d");
  assert.ok(range30d.startDate.getTime() < range30d.endDate.getTime());
  assert.ok(range30d.endDate.getTime() - range30d.startDate.getTime() <= 31 * 86_400_000);

  const range6m = resolveDateRange({ range: "6m" });
  assert.equal(range6m.key, "6m");
  assert.ok(range6m.startDate.getTime() < range6m.endDate.getTime());

  const rangeYear = resolveDateRange({ range: "year" });
  assert.equal(rangeYear.key, "year");
  assert.equal(rangeYear.startDate.getUTCMonth(), 0);
  assert.equal(rangeYear.startDate.getUTCDate(), 1);

  const range12m = resolveDateRange({ range: "12m" });
  assert.equal(range12m.key, "12m");

  const rangeAll = resolveDateRange({ range: "all" }, "2018-05-10T12:00:00Z");
  assert.equal(rangeAll.key, "all");
  assert.equal(rangeAll.startDate.toISOString(), "2018-05-10T12:00:00.000Z");

  // Custom with valid dates
  const rangeCustom = resolveDateRange({ range: "custom", from: "2024-01-01", to: "2024-06-30" });
  assert.equal(rangeCustom.key, "custom");
  assert.equal(rangeCustom.startDate.toISOString().slice(0, 10), "2024-01-01");
  assert.equal(rangeCustom.endDate.toISOString().slice(0, 10), "2024-06-30");

  // Custom with reversed dates (should auto-swap)
  const rangeReversed = resolveDateRange({ range: "custom", from: "2024-12-31", to: "2024-01-01" });
  assert.ok(rangeReversed.startDate.getTime() <= rangeReversed.endDate.getTime());
}

// 2. Data Compilation & Metric Calculations via Mock Upstream
{
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-token";

  const recent = new Date().toISOString();
  const mockGraphQLResponse = {
    data: {
      user: {
        login: "active-dev",
        name: "Active Developer",
        avatarUrl: "https://avatars.githubusercontent.com/u/100",
        bio: "Full stack open source contributor",
        createdAt: "2019-01-01T00:00:00Z",
        contributionsCollection: {
          startedAt: "2025-01-01T00:00:00Z",
          endedAt: recent,
          totalCommitContributions: 145,
          totalIssueContributions: 22,
          totalPullRequestReviewContributions: 37,
          totalPullRequestContributions: 19,
          restrictedContributionsCount: 15,
          contributionCalendar: {
            totalContributions: 219,
            weeks: [
              {
                contributionDays: [
                  { date: "2026-01-15", contributionCount: 12 },
                  { date: "2026-02-10", contributionCount: 20 }
                ]
              }
            ]
          },
          commitContributionsByRepository: [
            { repository: { nameWithOwner: "active-dev/core-lib", name: "core-lib", url: "https://github.com/active-dev/core-lib", isPrivate: false }, contributions: { totalCount: 110 } },
            { repository: { nameWithOwner: "active-dev/secret-project", name: "secret-project", url: "https://github.com/active-dev/secret-project", isPrivate: true }, contributions: { totalCount: 35 } }
          ],
          issueContributionsByRepository: [
            { repository: { nameWithOwner: "active-dev/core-lib", name: "core-lib", url: "https://github.com/active-dev/core-lib", isPrivate: false }, contributions: { totalCount: 22 } }
          ],
          pullRequestReviewContributionsByRepository: [
            { repository: { nameWithOwner: "upstream/framework", name: "framework", url: "https://github.com/upstream/framework", isPrivate: false }, contributions: { totalCount: 37 } }
          ]
        }
      },
      mergedPRs: {
        issueCount: 14,
        nodes: [
          { title: "Improve HTTP parser efficiency", number: 101, url: "https://github.com/upstream/framework/pull/101", mergedAt: "2026-02-01T12:00:00Z", createdAt: "2026-01-20T10:00:00Z", repository: { nameWithOwner: "upstream/framework", name: "framework", url: "https://github.com/upstream/framework" } }
        ]
      },
      createdIssues: {
        issueCount: 22,
        nodes: [
          { title: "Support chunked transfer encoding", number: 89, url: "https://github.com/active-dev/core-lib/issues/89", createdAt: "2026-01-10T09:00:00Z", repository: { nameWithOwner: "active-dev/core-lib", name: "core-lib", url: "https://github.com/active-dev/core-lib" } }
        ]
      }
    }
  };

  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    if (url.pathname === "/graphql") {
      return Response.json(mockGraphQLResponse);
    }
    return Response.json({ message: "Not found" }, { status: 404 });
  };

  try {
    const tracker = await getActivityTracker("active-dev", { range: "12m" });
    assert.equal(tracker.username, "active-dev");
    assert.equal(tracker.profile.name, "Active Developer");

    // Verify Metric A: Commits
    assert.equal(tracker.metrics.commits.total, 145);
    assert.equal(tracker.metrics.commits.label, "Total Commits");
    assert.ok(tracker.metrics.commits.repositories.length > 0);

    // Verify Private repo name protection: "secret-project" is private and must not be exposed
    const secretRepo = tracker.metrics.commits.repositories.find((r) => r.name === "active-dev/secret-project");
    assert.equal(secretRepo, undefined, "Private repository names must never be exposed");
    const privatePlaceholder = tracker.charts.repositoryBreakdown.find((r) => r.name === "Private repository");
    assert.ok(privatePlaceholder, "Private repositories are masked as Private repository");

    // Verify Metric B: Issues (strictly excluding PRs)
    assert.equal(tracker.metrics.issues.total, 22);
    assert.equal(tracker.metrics.issues.label, "Issues Created");

    // Verify Metric C: Reviews (submitted code reviews)
    assert.equal(tracker.metrics.reviews.total, 37);
    assert.equal(tracker.metrics.reviews.label, "Code Reviews");

    // Verify Metric D: Merged PRs (authored & merged)
    assert.equal(tracker.metrics.mergedPullRequests.total, 14);
    assert.equal(tracker.metrics.mergedPullRequests.label, "Pull Requests Merged");
    assert.notEqual(tracker.metrics.mergedPullRequests.total, tracker.totals.totalPRsOpened, "Merged PRs and opened PRs are distinct metrics");

    // Verify Totals and Restricted
    assert.equal(tracker.totals.restrictedContributions, 15);
    assert.equal(tracker.totals.hasRestrictedContributions, true);
    assert.equal(tracker.totals.totalContributions, 145 + 22 + 37 + 14);

    // Verify Highlights
    assert.ok(tracker.highlights.mostActiveRepo);
    assert.ok(tracker.highlights.averageMonthlyContributions > 0);

    // Verify Charts
    assert.ok(tracker.charts.monthlyActivity.length > 0);
    assert.ok(tracker.charts.cumulativeTrend.length > 0);
    assert.equal(tracker.charts.contributionDistribution.length, 4);

    // Verify Recent Activity
    assert.equal(tracker.recentActivity.mergedPullRequests.length, 1);
    assert.equal(tracker.recentActivity.mergedPullRequests[0].number, 101);
    assert.equal(tracker.recentActivity.issues.length, 1);
    assert.equal(tracker.recentActivity.issues[0].number, 89);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  }
}

// 3. Empty Activity Scenario
{
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-token";

  const emptyGraphQLResponse = {
    data: {
      user: {
        login: "idle-dev",
        name: "Idle Developer",
        avatarUrl: "https://avatars.githubusercontent.com/u/101",
        bio: null,
        createdAt: "2023-01-01T00:00:00Z",
        contributionsCollection: {
          startedAt: "2025-01-01T00:00:00Z",
          endedAt: new Date().toISOString(),
          totalCommitContributions: 0,
          totalIssueContributions: 0,
          totalPullRequestReviewContributions: 0,
          totalPullRequestContributions: 0,
          restrictedContributionsCount: 0,
          contributionCalendar: { totalContributions: 0, weeks: [] },
          commitContributionsByRepository: [],
          issueContributionsByRepository: [],
          pullRequestReviewContributionsByRepository: []
        }
      },
      mergedPRs: { issueCount: 0, nodes: [] },
      createdIssues: { issueCount: 0, nodes: [] }
    }
  };

  globalThis.fetch = async () => Response.json(emptyGraphQLResponse);

  try {
    const idleTracker = await getActivityTracker("idle-dev", { range: "30d" });
    assert.equal(idleTracker.totals.totalContributions, 0);
    assert.equal(idleTracker.metrics.commits.total, 0);
    assert.equal(idleTracker.metrics.issues.total, 0);
    assert.equal(idleTracker.metrics.reviews.total, 0);
    assert.equal(idleTracker.metrics.mergedPullRequests.total, 0);
    assert.equal(idleTracker.highlights.mostActiveRepo, null);
    assert.equal(idleTracker.recentActivity.mergedPullRequests.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  }
}

// 4. REST Fallback (Unauthenticated / No Token)
{
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;

  const recent = new Date().toISOString();
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/users/rest-dev") {
      return Response.json({
        login: "rest-dev",
        name: "REST Developer",
        avatar_url: "https://avatars.githubusercontent.com/u/102",
        bio: "Fallback tester",
        created_at: "2022-01-01T00:00:00Z",
        updated_at: recent,
        html_url: "https://github.com/rest-dev",
        followers: 3,
        following: 1,
        public_repos: 2,
        public_gists: 0
      });
    }
    if (url.pathname === "/search/issues") {
      const q = url.searchParams.get("q") || "";
      if (q.includes("type:pr") && q.includes("is:merged")) {
        return Response.json({
          total_count: 5,
          items: [
            { id: 1, title: "Merged REST PR", number: 7, html_url: "https://github.com/rest-dev/demo/pull/7", closed_at: recent, repository_url: "https://api.github.com/repos/rest-dev/demo" }
          ]
        });
      }
      if (q.includes("type:issue")) {
        return Response.json({
          total_count: 3,
          items: [
            { id: 2, title: "Opened REST Issue", number: 14, html_url: "https://github.com/rest-dev/demo/issues/14", created_at: recent, repository_url: "https://api.github.com/repos/rest-dev/demo" }
          ]
        });
      }
      return Response.json({ total_count: 0, items: [] });
    }
    if (url.pathname === "/users/rest-dev/events/public") {
      return Response.json([
        { type: "PushEvent", created_at: recent, repo: { name: "rest-dev/demo" }, payload: { size: 3 } },
        { type: "PullRequestReviewEvent", created_at: recent, repo: { name: "rest-dev/demo" } }
      ]);
    }
    if (url.pathname === "/users/rest-dev/repos") {
      return Response.json([
        { id: 10, name: "demo", full_name: "rest-dev/demo", html_url: "https://github.com/rest-dev/demo", pushed_at: recent, private: false }
      ]);
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  };

  try {
    const restTracker = await getActivityTracker("rest-dev", { range: "6m" });
    assert.equal(restTracker.username, "rest-dev");
    assert.equal(restTracker.metrics.mergedPullRequests.total, 5);
    assert.equal(restTracker.metrics.issues.total, 3);
    assert.ok(restTracker.metrics.commits.total >= 3);
    assert.equal(restTracker.metrics.reviews.total, 1);
    assert.equal(restTracker.dataCompleteness.dataSource, "GitHub REST API (Search API & Events)");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  }
}

// 5. Validation and Error Handling
{
  function responseStub() {
    return {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(s) { this.statusCode = s; return this; },
      send(b) { this.body = b; return this; }
    };
  }

  // Invalid username throws 400
  for (const bad of ["", "-invalid", "bad--name", "has/slash", "a".repeat(45)]) {
    const res = responseStub();
    await githubActivityTrackerHandler({ method: "GET", url: `/api/github/activity-tracker?username=${encodeURIComponent(bad)}`, query: { username: bad }, headers: { host: "localhost:3000" } }, res);
    assert.equal(res.statusCode, 400, `bad username "${bad}" must return 400`);
  }

  // Method not allowed
  const delRes = responseStub();
  await githubActivityTrackerHandler({ method: "DELETE", url: "/api/github/activity-tracker", query: { username: "octocat" }, headers: { host: "localhost:3000" } }, delRes);
  assert.equal(delRes.statusCode, 405);
}

process.stdout.write("Activity Tracker unit, GraphQL compilation, REST fallback, date filters, metric isolation, and validation checks passed.\n");
