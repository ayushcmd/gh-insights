function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function languageSignals(data) {
  const counts = data.languages.distribution;
  const total = counts.reduce((sum, item) => sum + item.repositoryCount, 0);
  if (!total || counts.length < 2) return { diversity: 0, entropy: 0, total };
  const probabilities = counts.map((item) => item.repositoryCount / total);
  const entropy = -probabilities.reduce((sum, p) => sum + p * Math.log(p), 0);
  const normalized = entropy / Math.log(counts.length);
  return { diversity: Math.round(normalized * 100), entropy: Number(normalized.toFixed(2)), total };
}

export function scoreDeveloper(data) {
  const repos = data.repositories;
  const owned = repos.filter((repo) => !repo.fork);
  const activeOwned = owned.filter((repo) => !repo.archived);
  const now = Date.now();
  const maintained = activeOwned.filter((repo) => repo.pushedAt && now - Date.parse(repo.pushedAt) < 365 * 86_400_000).length;
  const language = languageSignals(data);
  const engagement = clamp(Math.round(Math.log10(1 + data.totals.stars + data.totals.forks * 2) * 25));
  const diversity = clamp(Math.round(Math.min(owned.length, 12) / 12 * 100));
  const maintenance = activeOwned.length ? Math.round(maintained / activeOwned.length * 100) : 0;
  const collaborationEvents = (data.activity.eventTypes || []).filter((item) => ["PullRequestEvent", "IssuesEvent", "IssueCommentEvent", "PullRequestReviewEvent", "ForkEvent"].includes(item.type)).reduce((sum, item) => sum + item.count, 0);
  const collaboration = clamp(Math.round(Math.log2(collaborationEvents + 1) * 20));
  const hasActivity = data.activity.eventCount > 0;
  const activity = hasActivity ? clamp(Math.round(Math.log2(data.activity.eventCount + 1) * 15)) : null;
  const components = [
    { key: "portfolio", label: "Project portfolio", weight: 20, value: diversity, evidence: `${owned.length} non-fork repositories were retrieved.` },
    { key: "engagement", label: "Community engagement", weight: 20, value: engagement, evidence: `${data.totals.stars.toLocaleString()} stars and ${data.totals.forks.toLocaleString()} forks across retrieved repositories.` },
    { key: "maintenance", label: "Recent maintenance", weight: 20, value: maintenance, evidence: `${maintained} of ${activeOwned.length} active, non-archived repositories show a push in the last 12 months.` },
    { key: "languages", label: "Language range", weight: 15, value: language.diversity, evidence: `${data.languages.distribution.length} primary languages across ${language.total} repositories; normalized entropy ${language.entropy}.` },
    { key: "collaboration", label: "Collaboration signals", weight: 10, value: collaboration, evidence: `${collaborationEvents} public collaboration-related events in the available event window.` },
    { key: "activity", label: "Observed activity", weight: 15, value: activity, evidence: hasActivity ? `${data.activity.eventCount} events in the limited public events window.` : "No public events were returned; this component is excluded rather than treated as zero." }
  ];
  const available = components.filter((component) => component.value !== null);
  const weight = available.reduce((sum, component) => sum + component.weight, 0);
  const value = weight ? Math.round(available.reduce((sum, component) => sum + component.value * component.weight, 0) / weight) : null;
  return {
    value,
    label: "GH-Insights indicator",
    formula: "Subscores are 0–100: portfolio = min(non-fork repos ÷ 12, 1) × 100; engagement = min(log10(1 + stars + 2 × forks) × 25, 100); maintenance = recently pushed, non-archived owned repos ÷ non-archived owned repos × 100; language range = normalized Shannon entropy of primary-language repo counts × 100 (0 for zero or one known language); collaboration = min(log2(1 + public pull request, issue, review, or fork events) × 20, 100); observed activity = min(log2(1 + returned public events) × 15, 100). Weighted average: portfolio 20%, engagement 20%, maintenance 20%, language range 15%, collaboration 10%, observed activity 15%. If no events are returned, activity is excluded and remaining weights are rescaled.",
    components,
    limitation: "This application-specific indicator describes public metadata signals. It is not a GitHub score, skill assessment, or scientific measure."
  };
}

export function analyzePersonality(data) {
  const repos = data.repositories;
  const owned = repos.filter((repo) => !repo.fork);
  const languages = data.languages.distribution;
  const events = data.activity.eventTypes || [];
  const traits = [];
  const add = (name, evidence, confidence) => traits.push({ name, evidence, confidence });
  if (owned.length >= 5 && languages.length >= 4) add("Explorer", `${owned.length} non-fork repositories span ${languages.length} primary languages.`, "moderate");
  if (owned.length >= 5 && languages.length <= 2 && languages.length > 0) add("Specialist", `${languages.length} primary language${languages.length === 1 ? "" : "s"} recur across ${owned.length} non-fork repositories.`, "moderate");
  if (owned.length >= 3) add("Builder", `${owned.length} non-fork public repositories show a recurring pattern of project creation.`, "moderate");
  const recentMaintained = owned.filter((repo) => !repo.archived && repo.pushedAt && Date.now() - Date.parse(repo.pushedAt) < 365 * 86_400_000).length;
  if (recentMaintained >= 2) add("Maintainer", `${recentMaintained} non-archived repositories have recent push activity.`, "moderate");
  const collaborationCount = events.filter((item) => ["PullRequestEvent", "IssuesEvent", "IssueCommentEvent", "PullRequestReviewEvent"].includes(item.type)).reduce((sum, item) => sum + item.count, 0);
  if (collaborationCount >= 2) add("Collaborator", `${collaborationCount} public pull request, issue, or review events were observed.`, "low");
  if (!traits.length) add("Emerging portfolio", `The available public metadata is too limited for a stronger pattern; ${repos.length} repositories were retrieved.`, "low");
  return {
    headline: traits[0].name,
    traits,
    evidenceBasis: "Public repository metadata and the limited public-events window.",
    limitation: "These are labels for observable GitHub activity patterns, not claims about someone's private psychology or personality."
  };
}

export function summarizeDeveloper(data) {
  const repoCounts = data.languages.distribution;
  const starred = [...data.repositories].sort((a, b) => b.stars - a.stars).slice(0, 5);
  const updated = [...data.repositories].sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0)).slice(0, 5);
  const owned = data.repositories.filter((repo) => !repo.fork);
  const active = owned.filter((repo) => !repo.archived && repo.pushedAt && Date.now() - Date.parse(repo.pushedAt) < 365 * 86_400_000).length;
  const portfolioSignals = {
    ownedRepositories: owned.length,
    described: owned.filter((repo) => Boolean(repo.description)).length,
    withTopics: owned.filter((repo) => repo.topics.length > 0).length,
    withHomepage: owned.filter((repo) => Boolean(repo.homepage)).length,
    withWiki: owned.filter((repo) => repo.hasWiki).length,
    withPages: owned.filter((repo) => repo.hasPages).length,
    withLicense: owned.filter((repo) => Boolean(repo.license)).length,
    archived: owned.filter((repo) => repo.archived).length,
    forked: data.repositories.filter((repo) => repo.fork).length,
    distinctTopics: new Set(owned.flatMap((repo) => repo.topics)).size
  };
  const created = owned.map((repo) => Date.parse(repo.createdAt)).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    profile: data.profile,
    statistics: {
      repositoriesRetrieved: data.repositories.length,
      repositoriesReported: data.profile.publicRepos,
      totalStars: data.totals.stars,
      totalForks: data.totals.forks,
      followers: data.profile.followers,
      activeRepositories: active,
      dominantLanguage: repoCounts[0]?.name || null,
      languageCount: repoCounts.length,
      languageDiversityPercent: languageSignals(data).diversity,
      accountAgeYears: Number(((Date.now() - Date.parse(data.profile.createdAt)) / (365.2425 * 86_400_000)).toFixed(1))
    },
    repositories: data.repositories,
    highlights: { mostStarred: starred, recentlyUpdated: updated },
    portfolioSignals,
    portfolioTimeline: { oldestRepository: created.length ? new Date(created[0]).toISOString() : null, newestRepository: created.length ? new Date(created.at(-1)).toISOString() : null },
    languages: data.languages,
    activity: data.activity,
    personality: analyzePersonality(data),
    score: scoreDeveloper(data),
    coverage: data.repositoryCoverage,
    source: data.source,
    collectedAt: data.collectedAt,
    notes: [
      "Stars and forks are counted only across repositories retrieved in this report.",
      "Language counts use each repository's GitHub primary-language field, not bytes of source code or time spent.",
      "Public events cover a limited recent window and are not lifetime contributions.",
      "Documentation and code quality are not evaluated from repository metadata alone."
    ]
  };
}
