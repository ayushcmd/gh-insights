import { apiRequest, compactNumber, formatDate, safeGithubUrl, validUsername } from "./api.js";
import { state } from "./state.js";
import { initializeTheme } from "./theme.js";
import { renderHistory } from "./history.js";
import {
  activityChart,
  downloadLanguageChart,
  languageChart,
  monthlyActivityBarChart,
  contributionTrendLineChart,
  contributionDistributionChart,
  repositoryBreakdownChart
} from "./charts.js";
import { renderAiOutput } from "./ai-render.js";

const $ = (selector, root = document) => root.querySelector(selector);
const reportRoot = $("#report-root");
const comparisonRoot = $("#comparison-root");
const activityRoot = $("#activity-root");
const loadingPanel = $("#loading-panel");
const errorPanel = $("#error-panel");
let lastRequest = null;
let viewRevision = 0;

function el(tag, className = "", text = null) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== null) item.textContent = String(text);
  return item;
}

function externalLink(url, label, className = "") {
  const anchor = el("a", className, label);
  anchor.href = safeGithubUrl(url);
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

function sectionHeading(kicker, title, description = "") {
  const heading = el("div", "section-heading");
  const wrap = document.createElement("div");
  wrap.append(el("div", "section-kicker", kicker), el("h3", "", title));
  if (description) wrap.append(el("p", "", description));
  heading.append(wrap);
  return heading;
}

function metric(label, value, help) {
  const card = el("article", "stat-card");
  card.append(el("div", "stat-label", label), el("div", "stat-value", value), el("div", "stat-help", help));
  return card;
}

function panel(kicker, title, description = "", wide = false) {
  const item = el("section", `panel${wide ? " panel-wide" : ""}`);
  item.append(sectionHeading(kicker, title, description));
  return item;
}

function accountAge(createdAt) {
  const years = (Date.now() - Date.parse(createdAt)) / (365.2425 * 86_400_000);
  if (!Number.isFinite(years) || years < 0) return "Unavailable";
  if (years < 1) return `${Math.max(1, Math.round(years * 12))} mo`;
  return `${years.toFixed(1)} yrs`;
}

function setBusy(busy, title = "Reading public profile", copy = "Collecting repositories and recent activity from GitHub.") {
  loadingPanel.hidden = !busy;
  if (busy) {
    $("#loading-title").textContent = title;
    $("#loading-copy").textContent = copy;
  }
  for (const form of [$("#explore-form"), $("#compare-form"), $("#activity-form")].filter(Boolean)) {
    for (const button of form.querySelectorAll("button[type=submit]")) button.disabled = busy;
  }
}

function showError(error, modeOrComparison = false) {
  const isComparison = modeOrComparison === true || modeOrComparison === "compare";
  const isActivity = modeOrComparison === "activity";
  $("#input-error").hidden = true;
  $("#compare-error").hidden = true;
  const actErr = $("#activity-input-error");
  if (actErr) actErr.hidden = true;
  if (isActivity && actErr) {
    actErr.hidden = false;
    actErr.textContent = error.message || "Could not load activity for this profile.";
  } else if (isComparison) {
    $("#compare-error").hidden = false;
    $("#compare-error").textContent = error.message || "Could not compare these profiles.";
  } else {
    $("#input-error").hidden = false;
    $("#input-error").textContent = error.message || "Could not load this profile.";
  }

  errorPanel.hidden = false;
  $("#error-title").textContent = error.status === 404 ? "GitHub account not found" : "Could not load this report";
  $("#error-copy").textContent = error.message || "The request could not be completed. Please retry.";
}

function dismissError() {
  errorPanel.hidden = true;
  $("#input-error").hidden = true;
  $("#compare-error").hidden = true;
  const actErr = $("#activity-input-error");
  if (actErr) actErr.hidden = true;
}

function profileCard(data, showArchetype = true) {
  const profile = data.profile;
  const card = el("section", "profile-card");
  const avatar = el("img", "avatar");
  avatar.src = profile.avatarUrl;
  avatar.alt = `${profile.username} profile avatar`;
  avatar.loading = "lazy";
  avatar.referrerPolicy = "no-referrer";
  avatar.addEventListener("error", () => avatar.removeAttribute("src"), { once: true });
  const main = el("div", "profile-main");
  const nameLine = el("div", "profile-name-line");
  nameLine.append(el("h2", "profile-name", profile.name || profile.username), externalLink(profile.profileUrl, `@${profile.username}`, "profile-handle"));
  main.append(nameLine);
  if (profile.bio) main.append(el("p", "profile-bio", profile.bio));
  const meta = el("div", "profile-meta");
  meta.append(el("span", "", `Member since ${formatDate(profile.createdAt, { year: "numeric", month: "short" })}`));
  meta.append(el("span", "", `Profile updated ${formatDate(profile.updatedAt, { year: "numeric", month: "short" })}`));
  if (profile.location) meta.append(el("span", "", profile.location));
  if (profile.company) meta.append(el("span", "", profile.company));
  meta.append(el("span", "", `${compactNumber(profile.followers)} followers`));
  main.append(meta);
  card.append(avatar, main);
  if (showArchetype && data.personality?.headline) card.append(el("span", "archetype-pill", data.personality.headline));
  return card;
}

function reportTopline(data) {
  const line = el("div", "report-topline");
  line.append(el("span", "", `COLLECTED ${formatDate(data.collectedAt, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`));
  const actions = el("div", "report-actions");
  const profileUrl = safeGithubUrl(data.profile.profileUrl);
  actions.append(externalLink(profileUrl, "Open GitHub profile", "button button-secondary"));
  const printButton = el("button", "button button-secondary", "Print / Save PDF");
  printButton.type = "button";
  printButton.addEventListener("click", () => window.print());
  actions.append(printButton);
  const copyButton = el("button", "button button-secondary", "Copy profile link");
  copyButton.type = "button";
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(profileUrl);
      copyButton.textContent = "Link copied";
      setTimeout(() => { copyButton.textContent = "Copy profile link"; }, 1800);
    } catch { copyButton.textContent = profileUrl; }
  });
  actions.append(copyButton);
  line.append(actions);
  return line;
}

function statistics(data) {
  const values = data.statistics;
  const grid = el("section", "stats-grid");
  grid.setAttribute("aria-label", "Developer statistics");
  grid.append(
    metric("Public repositories", compactNumber(values.repositoriesReported), "Reported by GitHub profile"),
    metric("Stars received", compactNumber(values.totalStars), "Across retrieved public repositories"),
    metric("Forks received", compactNumber(values.totalForks), "Across retrieved public repositories"),
    metric("Followers", compactNumber(values.followers), "Current public profile count"),
    metric("Dominant language", values.dominantLanguage || "—", "Most common primary language"),
    metric("Language diversity", `${values.languageDiversityPercent}%`, "Normalized primary-language entropy"),
    metric("Recently active", compactNumber(values.activeRepositories), "Non-archived repos pushed in 12 months"),
    metric("Account age", `${values.accountAgeYears} yrs`, "Based on public account creation date")
  );
  return grid;
}

function languagesPanel(data) {
  const card = panel("TECH STACK", "Programming languages", "Primary language label per repository. This is not a measure of skill or time spent.");
  const chart = el("div", "chart-layout");
  languageChart(chart, data.languages.distribution);
  card.append(chart);
  const note = el("p", "chart-note", `${data.languages.distribution.length} distinct primary languages found in ${data.languages.distribution.reduce((sum, item) => sum + item.repositoryCount, 0)} language-tagged repositories. ${data.languages.basis}`);
  card.append(note);
  const download = el("button", "button button-secondary chart-download", "Download chart as SVG");
  download.type = "button";
  download.addEventListener("click", () => downloadLanguageChart(chart));
  card.append(download);
  return card;
}

function eventTypeName(type) {
  return String(type || "Event").replace(/Event$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function activityPanel(data) {
  const activity = data.activity;
  const card = panel("PUBLIC ACTIVITY", "Recent development signals", "Public events are a limited recent window, not a lifetime contribution graph.");
  const summary = el("div", "activity-summary");
  const totalWrap = document.createElement("div");
  totalWrap.append(el("div", "activity-number", compactNumber(activity.eventCount)), el("div", "activity-label", "events returned"));
  const range = el("div", "activity-range", activity.firstObservedAt ? `${formatDate(activity.firstObservedAt)} → ${formatDate(activity.lastObservedAt)}` : "No observed dates");
  summary.append(totalWrap, range);
  card.append(summary);
  const chart = el("div", "activity-chart-wrap");
  activityChart(chart, activity.timeline);
  card.append(chart, el("p", "chart-note", "The timeline plots observed event dates across their actual calendar spacing; it shows up to 35 dates."));
  if (activity.eventTypes.length) {
    const tags = el("div", "event-tags");
    for (const event of activity.eventTypes.slice(0, 7)) tags.append(el("span", "event-tag", `${eventTypeName(event.type)} ${event.count}`));
    card.append(tags);
  }
  const notice = el("div", "data-notice");
  notice.append(el("span", "notice-mark", "i"), el("span", "", activity.limitation));
  card.append(notice);
  return card;
}

function repoCard(repo) {
  const card = el("article", "repo-card");
  const title = el("div", "repo-title-row");
  title.append(externalLink(repo.url, repo.name, "repo-name"), el("span", "repo-stars", `${compactNumber(repo.stars)} stars`));
  card.append(title);
  card.append(el("p", "repo-description", repo.description || "No description provided."));
  const meta = el("div", "repo-meta");
  if (repo.language) {
    const language = el("span");
    language.append(el("i", "repo-language-dot"), document.createTextNode(repo.language));
    meta.append(language);
  }
  meta.append(el("span", "", `Updated ${formatDate(repo.updatedAt, { year: "numeric", month: "short" })}`));
  meta.append(el("span", "", `${compactNumber(repo.forks)} forks`));
  const flags = el("span", "repo-flags");
  if (repo.archived) flags.append(el("span", "repo-flag", "Archived"));
  if (repo.fork) flags.append(el("span", "repo-flag", "Fork"));
  if (repo.license) flags.append(el("span", "repo-flag", repo.license));
  meta.append(flags);
  card.append(meta);
  return card;
}

function repositoriesPanel(data) {
  const card = panel("PROJECT PORTFOLIO", "Repository intelligence", "Popularity and recency signals from public repository metadata.", true);
  const controls = el("div", "repo-controls");
  const coverage = data.coverage;
  controls.append(el("span", "coverage-line", `${compactNumber(coverage.fetched)} of ${compactNumber(coverage.reportedPublicTotal)} repositories retrieved${coverage.complete ? " · complete" : " · partial coverage"}`));
  const sort = el("div", "sort-toggle");
  const starButton = el("button", "is-active", "Most starred");
  const updatedButton = el("button", "", "Recently updated");
  starButton.type = updatedButton.type = "button";
  sort.append(starButton, updatedButton);
  controls.append(sort);
  const grid = el("div", "repo-grid");
  function draw(by) {
    const repos = [...data.repositories].sort(by === "updated" ? (a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0) : (a, b) => b.stars - a.stars).slice(0, 6);
    grid.replaceChildren();
    if (!repos.length) grid.append(el("div", "repo-empty", "No public repositories were returned."));
    for (const repo of repos) grid.append(repoCard(repo));
    starButton.classList.toggle("is-active", by === "stars");
    updatedButton.classList.toggle("is-active", by === "updated");
  }
  starButton.addEventListener("click", () => draw("stars"));
  updatedButton.addEventListener("click", () => draw("updated"));
  draw("stars");
  card.append(controls, grid);
  if (!coverage.complete) {
    const notice = el("div", "data-notice");
    const reason = coverage.capped
      ? `Collection stopped at the ${coverage.cap.toLocaleString()} repository safety bound.`
      : "GitHub's reported public repository total did not match the repositories returned in this request.";
    notice.append(el("span", "notice-mark", "i"), el("span", "", `${reason} Totals and portfolio details may be incomplete.`));
    card.append(notice);
  }
  return card;
}

function scorePanel(data) {
  const score = data.score;
  const card = panel("TRANSPARENT INDICATOR", "Developer intelligence", "An application-specific summary of available public signals.");
  const layout = el("div", "score-layout");
  const circle = el("div", "score-circle");
  circle.append(el("span", "score-number", score.value === null ? "—" : score.value), el("span", "score-outof", "OUT OF 100"));
  layout.append(circle);
  const list = el("div", "score-list");
  for (const item of score.components) {
    const component = el("div", "score-component");
    const row = el("div", "score-row");
    row.append(el("span", "", item.label));
    const track = el("progress", "score-progress");
    track.max = 100;
    track.value = item.value === null ? 0 : item.value;
    track.setAttribute("aria-label", `${item.label}: ${item.value === null ? "not available" : item.value} out of 100`);
    row.append(track, el("span", "score-value", item.value === null ? "n/a" : item.value));
    component.append(row, el("p", "score-evidence", item.evidence));
    list.append(component);
  }
  layout.append(list);
  card.append(layout);
  const formula = el("details", "score-formula");
  formula.append(el("summary", "", "How the score is calculated"), el("p", "chart-note", score.formula));
  card.append(formula);
  card.append(el("p", "chart-note", score.limitation));
  return card;
}

function personalityPanel(data) {
  const personality = data.personality;
  const card = panel("OBSERVED PATTERNS", "Developer profile signals", "The labels describe public work patterns, not private personality.");
  const list = el("div", "personality-list");
  for (const trait of personality.traits) {
    const row = el("div", "trait");
    row.append(el("span", "trait-dot"));
    const content = document.createElement("div");
    const name = el("strong", "", trait.name);
    name.append(el("span", "confidence", `${trait.confidence} confidence`));
    content.append(name, el("p", "", trait.evidence));
    row.append(content);
    list.append(row);
  }
  card.append(list, el("p", "chart-note", personality.limitation));
  return card;
}

function portfolioSignalsPanel(data) {
  const signals = data.portfolioSignals;
  const card = panel("PORTFOLIO METADATA", "Repository discovery signals", "These GitHub metadata fields can help people find and understand projects; README contents and code quality are not evaluated.");
  const grid = el("div", "metadata-grid");
  const rows = [
    ["Descriptions", signals.described], ["Topics", signals.withTopics], ["Homepage links", signals.withHomepage],
    ["Licenses", signals.withLicense], ["Wikis enabled", signals.withWiki], ["GitHub Pages", signals.withPages],
    ["Archived projects", signals.archived], ["Forked projects", signals.forked]
  ];
  for (const [label, value] of rows) {
    const item = el("div", "metadata-item");
    item.append(el("span", "metadata-label", label), el("strong", "metadata-value", `${value} / ${signals.ownedRepositories}`));
    grid.append(item);
  }
  card.append(grid, el("p", "chart-note", `${signals.distinctTopics} distinct repository topics across non-fork projects. Counts are limited to retrieved repositories.`));
  return card;
}

function techEvolutionPanel(data) {
  const card = panel("TECHNOLOGY EVOLUTION", "Portfolio timeline", "Earliest and newest repository dates reveal observed portfolio changes, not technology adoption dates.", true);
  const repos = [...data.repositories].filter((repo) => repo.createdAt).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const midpoint = Math.ceil(repos.length / 2);
  const groups = [repos.slice(0, midpoint), repos.slice(midpoint)];
  const layout = el("div", "evolution-layout");
  groups.forEach((group, index) => {
    const side = el("div", "evolution-side");
    side.append(el("h4", "", index === 0 ? "EARLIER PUBLIC REPOSITORIES" : "MORE RECENT PUBLIC REPOSITORIES"));
    side.append(el("div", "evolution-date", group.length ? `${formatDate(group[0].createdAt)} — ${formatDate(group.at(-1).createdAt)}` : "No repositories in this period"));
    const langs = new Map();
    for (const repo of group) if (repo.language) langs.set(repo.language, (langs.get(repo.language) || 0) + 1);
    const chips = el("div", "tech-chips");
    for (const [name, count] of [...langs].sort((a, b) => b[1] - a[1]).slice(0, 8)) chips.append(el("span", "tech-chip", `${name} · ${count}`));
    if (!langs.size) chips.append(el("span", "chart-note", "No language labels in this group."));
    side.append(chips);
    layout.append(side);
    if (index === 0) layout.append(el("span", "evolution-arrow", "→"));
  });
  if (!repos.length) layout.append(el("div", "evolution-side", "No creation dates were returned."));
  card.append(layout);
  return card;
}

async function runAi(button, output, endpoint, username, unavailableLabel) {
  button.disabled = true;
  button.dataset.originalLabel ||= button.textContent;
  button.textContent = "Generating…";
  output.textContent = "Preparing an evidence-based response from the collected public profile data.";
  try {
    const result = await apiRequest(endpoint, { username }, { timeoutMs: 32_000, timeoutMessage: "Gemini took longer than expected. Check the status at /api/health and retry." });
    if (result.available) renderAiOutput(output, result);
    else output.textContent = result.message || unavailableLabel;
  } catch (error) {
    output.textContent = error.message || unavailableLabel;
  } finally {
    button.disabled = false;
    button.textContent = button.dataset.originalLabel;
  }
}

function aiPanel(username) {
  const card = panel("OPTIONAL GEMINI", "AI-generated perspective", "Generated from structured profile data. AI interpretation is separate from measured statistics.", true);
  const actions = el("div", "ai-actions");
  const summaryButton = el("button", "button button-secondary", "Generate summary");
  const roastButton = el("button", "button button-secondary", "A gentle roast");
  summaryButton.type = roastButton.type = "button";
  const output = el("div", "ai-output", "AI insight has not been requested.");
  output.setAttribute("aria-live", "polite");
  summaryButton.addEventListener("click", () => runAi(summaryButton, output, "/api/ai/summary", username, "AI is unavailable."));
  roastButton.addEventListener("click", () => runAi(roastButton, output, "/api/ai/roast", username, "AI is unavailable."));
  actions.append(summaryButton, roastButton);
  card.append(actions, output);
  return card;
}

function detailsPanel(data, username) {
  const details = el("details", "report-details");
  details.append(el("summary", "", `Detailed report and repository list (${compactNumber(data.coverage.fetched)} retrieved)`));
  const info = el("p", "chart-note", "Loading full detail adds no inferred claims: repository documentation presence and source-code quality are not assessed here.");
  details.append(info);
  const list = el("ul", "detail-repo-list");
  details.append(list);
  let loaded = false;
  details.addEventListener("toggle", async () => {
    if (!details.open || loaded) return;
    loaded = true;
    info.textContent = "Refreshing the detailed public repository report…";
    try {
      const deep = await apiRequest("/api/insights/deep", { username }, { timeoutMs: 32_000 });
      info.textContent = `${deep.detail.allRepositories.length.toLocaleString()} repositories are included up to the collection cap. Documentation presence and code quality are not measured. ${deep.detail.interpretation}`;
      const maxVisible = 150;
      for (const repo of deep.detail.allRepositories.slice(0, maxVisible)) {
        const row = document.createElement("li");
        const link = externalLink(repo.url, `${repo.name} · ${repo.language || "language not set"} · ${compactNumber(repo.stars)} stars`, "");
        row.append(link);
        list.append(row);
      }
      if (deep.detail.allRepositories.length > maxVisible) info.textContent += ` Showing the first ${maxVisible} in this view.`;
    } catch (error) {
      info.textContent = `${error.message} The overview report above remains available.`;
      loaded = false;
    }
  });
  return details;
}

function renderInsights(data) {
  reportRoot.replaceChildren();
  comparisonRoot.replaceChildren();
  activityRoot.replaceChildren();
  const root = el("article", "report");
  root.append(reportTopline(data), profileCard(data), statistics(data));
  const firstRow = el("div", "dashboard-grid");
  firstRow.append(languagesPanel(data), activityPanel(data));
  root.append(firstRow);
  root.append(repositoriesPanel(data));
  const signals = el("div", "dashboard-grid");
  signals.append(scorePanel(data), personalityPanel(data), portfolioSignalsPanel(data), techEvolutionPanel(data), aiPanel(data.profile.username));
  root.append(signals, detailsPanel(data, data.profile.username));
  const notices = el("div", "report-disclaimer");
  notices.textContent = `${data.notes.join(" ")} Data collected ${formatDate(data.collectedAt)}. ${data.source.rateLimitNote}`;
  root.append(notices);
  reportRoot.append(root);
}

function compareMetric(label, key, a, b, formatter = compactNumber) {
  const item = el("div", "compare-metric");
  item.append(el("div", "compare-metric-label", label));
  const values = el("div", "compare-metric-values");
  values.append(el("span", "", formatter(a.statistics[key])), el("span", "", formatter(b.statistics[key])));
  item.append(values);
  return item;
}

function comparisonReposPanel(data, label) {
  const card = panel("PROJECT PORTFOLIO", `${label} notable projects`, "Highest-starred repositories in the collected public portfolio.");
  const repos = [...data.repositories].sort((a, b) => b.stars - a.stars).slice(0, 4);
  if (!repos.length) card.append(el("div", "repo-empty", "No public repositories were returned."));
  for (const repo of repos) {
    const row = el("div", "comparison-repo-row");
    row.append(externalLink(repo.url, repo.name, "repo-name"), el("span", "repo-stars", `${compactNumber(repo.stars)} stars · ${repo.language || "language not set"}`));
    card.append(row);
  }
  return card;
}

function compareProfileCard(data) {
  const profile = data.profile;
  const card = el("section", "compare-profile");
  const avatar = el("img", "avatar");
  avatar.src = profile.avatarUrl;
  avatar.alt = `${profile.username} profile avatar`;
  avatar.loading = "lazy";
  avatar.referrerPolicy = "no-referrer";
  avatar.addEventListener("error", () => avatar.removeAttribute("src"), { once: true });
  const text = el("div", "compare-profile-text");
  const archetypes = data.personality.traits.slice(0, 3).map((trait) => trait.name).join(" · ");
  text.append(el("h3", "", profile.name || profile.username), externalLink(profile.profileUrl, `@${profile.username}`), el("span", "compare-archetype", archetypes));
  const score = el("div", "compare-score");
  score.append(el("strong", "", data.score.value === null ? "—" : data.score.value), el("span", "", "signal indicator"));
  card.append(avatar, text, score);
  return card;
}

function compareChartPanel(data, label) {
  const card = panel("TECH STACK", `${label} languages`, "Primary language label by repository.");
  const chart = el("div", "chart-layout");
  languageChart(chart, data.languages.distribution);
  card.append(chart);
  return card;
}

function comparisonActivityPanel(data, label) {
  const card = panel("PUBLIC ACTIVITY", `${label} activity`, "Limited public events window.");
  const host = el("div", "activity-chart-wrap");
  activityChart(host, data.activity.timeline);
  card.append(el("div", "activity-summary", `${data.activity.eventCount} events observed`), host, el("p", "chart-note", "Timeline shows up to 35 observed event dates at their calendar spacing."));
  if (data.activity.eventTypes.length) {
    const tags = el("div", "event-tags");
    for (const event of data.activity.eventTypes.slice(0, 6)) tags.append(el("span", "event-tag", `${eventTypeName(event.type)} ${event.count}`));
    card.append(tags);
  }
  card.append(el("p", "chart-note", data.activity.limitation));
  return card;
}

function renderComparison(result) {
  reportRoot.replaceChildren();
  comparisonRoot.replaceChildren();
  activityRoot.replaceChildren();
  const [a, b] = result.developers;
  const root = el("article", "comparison-report");
  const heading = el("div", "comparison-heading");
  const headingText = el("div");
  headingText.append(el("h2", "", "Developer comparison"), el("span", "comparison-note", `${result.comparisonNote} Collected ${formatDate(result.collectedAt)}.`));
  const printButton = el("button", "button button-secondary", "Print / Save PDF");
  printButton.type = "button";
  printButton.addEventListener("click", () => window.print());
  heading.append(headingText, printButton);
  root.append(heading);
  const profiles = el("div", "compare-profiles");
  profiles.append(compareProfileCard(a), compareProfileCard(b));
  root.append(profiles);
  const metrics = el("div", "compare-metrics");
  metrics.append(
    compareMetric("Public repositories", "repositoriesReported", a, b),
    compareMetric("Stars received", "totalStars", a, b),
    compareMetric("Forks received", "totalForks", a, b),
    compareMetric("Followers", "followers", a, b),
    compareMetric("Recently active repos", "activeRepositories", a, b),
    compareMetric("Account age", "accountAgeYears", a, b, (value) => `${value} yrs`),
    compareMetric("Distinct languages", "languageCount", a, b),
    compareMetric("Language diversity", "languageDiversityPercent", a, b, (value) => `${value}%`)
  );
  root.append(metrics);
  const panels = el("div", "compare-panels");
  panels.append(compareChartPanel(a, a.profile.username), compareChartPanel(b, b.profile.username), comparisonReposPanel(a, a.profile.username), comparisonReposPanel(b, b.profile.username), comparisonActivityPanel(a, a.profile.username), comparisonActivityPanel(b, b.profile.username));
  root.append(panels);
  const ai = panel("OPTIONAL GEMINI", "Comparison perspective", "Evidence-based summary of observed differences; AI output may be incomplete.", true);
  const button = el("button", "button button-secondary", "Generate comparison verdict");
  button.type = "button";
  const output = el("div", "ai-output", "AI verdict has not been requested.");
  output.setAttribute("aria-live", "polite");
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Generating…";
    output.textContent = "Comparing structured public profile data.";
    try {
      const verdict = await apiRequest("/api/ai/verdict", { usernameA: a.profile.username, usernameB: b.profile.username }, { timeoutMs: 38_000, timeoutMessage: "Gemini took longer than expected. Check the status at /api/health and retry." });
      if (verdict.available) renderAiOutput(output, verdict);
      else output.textContent = verdict.message;
    } catch (error) { output.textContent = error.message; }
    button.disabled = false;
    button.textContent = "Generate comparison verdict";
  });
  const aiActions = el("div", "ai-actions");
  aiActions.append(button);
  ai.append(aiActions, output);
  root.append(ai);
  root.append(el("p", "report-disclaimer", `${result.comparisonNote} Events cover a limited recent public window. Language counts use repository primary-language labels. Scores are application-specific indicators, not skill assessments.`));
  comparisonRoot.append(root);
}

async function explore(username) {
  const clean = username.trim();
  $("#username-input").value = clean;
  if (state.mode !== "insights") setMode("insights");
  const revision = ++viewRevision;
  setBusy(false);
  lastRequest = { mode: "insights", username: clean };
  dismissError();
  if (!validUsername(clean)) {
    $("#input-error").textContent = "Enter a valid GitHub username using letters, numbers, or single hyphens.";
    $("#input-error").hidden = false;
    $("#username-input").focus();
    return;
  }
  setBusy(true);
  try {
    const data = await apiRequest("/api/insights/analyze", { username: clean });
    if (revision !== viewRevision) return;
    state.activeUsername = data.profile.username;
    renderInsights(data);
    renderHistory((name) => explore(name));
    state.addHistory(data.profile.username);
    renderHistory((name) => explore(name));
    reportRoot.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    if (revision === viewRevision) showError(error);
  } finally { if (revision === viewRevision) setBusy(false); }
}

async function compare(firstValue, secondValue) {
  const first = firstValue.trim();
  const second = secondValue.trim();
  $("#username-a").value = first;
  $("#username-b").value = second;
  if (state.mode !== "compare") setMode("compare");
  const revision = ++viewRevision;
  setBusy(false);
  lastRequest = { mode: "compare", first, second };
  dismissError();
  if (!validUsername(first) || !validUsername(second)) {
    $("#compare-error").textContent = "Enter two valid GitHub usernames using letters, numbers, or single hyphens.";
    $("#compare-error").hidden = false;
    (!validUsername(first) ? $("#username-a") : $("#username-b")).focus();
    return;
  }
  if (first.toLowerCase() === second.toLowerCase()) {
    $("#compare-error").textContent = "Choose two different GitHub usernames to compare.";
    $("#compare-error").hidden = false;
    return;
  }
  setBusy(true, "Comparing public profiles", "Collecting repository and activity data for both developers.");
  try {
    const result = await apiRequest("/api/insights/compare", { usernameA: first, usernameB: second }, { timeoutMs: 45_000 });
    if (revision !== viewRevision) return;
    state.lastComparison = result;
    renderComparison(result);
    state.addHistory(result.developers[0].profile.username);
    state.addHistory(result.developers[1].profile.username);
    renderHistory((name) => explore(name));
    comparisonRoot.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    if (revision === viewRevision) showError(error, true);
  } finally { if (revision === viewRevision) setBusy(false); }
}

function renderActivityDashboard(data, currentOptions = {}) {
  activityRoot.replaceChildren();

  const wrap = el("article", "report activity-report");

  // 1. Topline
  const topline = el("div", "report-topline");
  const scopeTag = el("span", "archetype-pill", data.dataCompleteness?.scopeLabel || "Public GitHub activity");
  const timeInfo = el("span", "activity-time-info", `${data.timeRange?.label || "Activity"} · Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"}`);
  topline.append(scopeTag, timeInfo);
  wrap.append(topline);

  // 2. Profile Card
  const profileCardEl = el("section", "profile-card");
  const avatar = el("img", "avatar");
  avatar.src = data.profile?.avatarUrl || "";
  avatar.alt = `${data.username} avatar`;
  avatar.loading = "lazy";
  avatar.referrerPolicy = "no-referrer";
  avatar.addEventListener("error", () => avatar.removeAttribute("src"), { once: true });

  const main = el("div", "profile-main");
  const nameLine = el("div", "profile-name-line");
  nameLine.append(
    el("h2", "profile-name", data.profile?.name || data.username),
    externalLink(data.profile?.profileUrl || `https://github.com/${data.username}`, `@${data.username}`, "profile-handle")
  );
  main.append(nameLine);
  if (data.profile?.bio) main.append(el("p", "profile-bio", data.profile.bio));

  const meta = el("div", "profile-meta");
  if (data.profile?.createdAt) {
    meta.append(el("span", "", `Joined GitHub ${formatDate(data.profile.createdAt, { year: "numeric", month: "short" })}`));
  }
  const totalCount = data.totals?.totalContributions || 0;
  meta.append(el("span", "", `${compactNumber(totalCount)} total contributions in window`));
  if (data.totals?.hasRestrictedContributions) {
    meta.append(el("span", "private-contributions-badge", `+ ${compactNumber(data.totals.restrictedContributions)} private contributions`));
  }
  main.append(meta);
  profileCardEl.append(avatar, main);
  wrap.append(profileCardEl);

  // 3. Time Filter Toolbar
  const filterToolbar = el("div", "activity-filter-toolbar");
  const filterGroup = el("div", "filter-pill-group");
  const filterRanges = [
    { key: "all", label: "All time" },
    { key: "year", label: "Current year" },
    { key: "12m", label: "Last 12 months" },
    { key: "6m", label: "Last 6 months" },
    { key: "30d", label: "Last 30 days" },
    { key: "custom", label: "Custom range" }
  ];

  const activeKey = currentOptions.range || data.timeRange?.key || "12m";

  // Custom date picker form row
  const customRow = el("div", "custom-date-row");
  customRow.hidden = activeKey !== "custom";

  const fromLabel = el("label", "custom-date-label", "From: ");
  const fromInput = el("input", "custom-date-input");
  fromInput.type = "date";
  fromInput.value = (currentOptions.from || data.timeRange?.from || "").slice(0, 10);
  fromLabel.append(fromInput);

  const toLabel = el("label", "custom-date-label", "To: ");
  const toInput = el("input", "custom-date-input");
  toInput.type = "date";
  toInput.value = (currentOptions.to || data.timeRange?.to || "").slice(0, 10);
  toLabel.append(toInput);

  const applyBtn = el("button", "button button-secondary custom-date-apply", "Apply Range");
  applyBtn.type = "button";
  applyBtn.addEventListener("click", () => {
    if (fromInput.value) {
      analyzeActivity(data.username, { range: "custom", from: fromInput.value, to: toInput.value || undefined });
    }
  });

  customRow.append(fromLabel, toLabel, applyBtn);

  filterRanges.forEach((range) => {
    const btn = el("button", `filter-pill${activeKey === range.key ? " is-active" : ""}`, range.label);
    btn.type = "button";
    btn.addEventListener("click", () => {
      if (range.key === "custom") {
        customRow.hidden = !customRow.hidden;
        for (const b of filterGroup.querySelectorAll(".filter-pill")) b.classList.remove("is-active");
        btn.classList.add("is-active");
      } else {
        customRow.hidden = true;
        analyzeActivity(data.username, { range: range.key });
      }
    });
    filterGroup.append(btn);
  });

  filterToolbar.append(filterGroup, customRow);
  wrap.append(filterToolbar);

  // 4. Empty state notice if totalCount === 0
  if (totalCount === 0) {
    const emptyCard = el("section", "panel activity-empty-panel");
    const emptyTitle = el("h3", "", "No Activity Recorded");
    const emptyCopy = el("p", "", `No public contributions were found for @${data.username} in the ${data.timeRange?.label || "selected"} window. Try switching to "All time" or selecting another date filter.`);
    emptyCard.append(emptyTitle, emptyCopy);
    wrap.append(emptyCard);
  }

  // 5. Four Primary Metric Cards
  const cardsGrid = el("div", "stats-grid activity-metrics-grid");

  function createActivityMetricCard(metricData, typeClass, iconPath) {
    const card = el("article", `stat-card activity-metric-card ${typeClass}`);
    const topRow = el("div", "activity-card-top");
    const label = el("div", "stat-label", metricData.label);
    topRow.append(label);

    const iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    iconSvg.setAttribute("viewBox", "0 0 24 24");
    iconSvg.setAttribute("aria-hidden", "true");
    iconSvg.setAttribute("class", "metric-card-icon");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", iconPath);
    iconSvg.append(p);
    topRow.append(iconSvg);

    const value = el("div", "stat-value", compactNumber(metricData.total));
    const help = el("div", "stat-help", metricData.description);
    card.append(topRow, value, help);

    // Repository badge if available
    const topRepo = metricData.repositories?.[0];
    if (topRepo) {
      const repoPill = el("div", "activity-top-repo");
      repoPill.append(
        el("span", "repo-pill-label", "Top repo: "),
        externalLink(topRepo.url, topRepo.name, "repo-pill-name"),
        el("span", "repo-pill-count", ` (${compactNumber(topRepo.count)})`)
      );
      card.append(repoPill);
    }

    // Expandable details for monthly and repository breakdown
    if ((metricData.monthly && metricData.monthly.length > 0) || (metricData.repositories && metricData.repositories.length > 0)) {
      const details = el("details", "metric-breakdown-details");
      const summary = el("summary", "", "View breakdown");
      const detailsContent = el("div", "metric-details-content");

      // Monthly breakdown table
      if (metricData.monthly?.length) {
        const mHeading = el("strong", "details-subhead", "Monthly activity");
        const mList = el("div", "details-chips-list");
        for (const m of metricData.monthly) {
          if (m.count > 0) {
            const chip = el("span", "details-chip", `${m.label || m.month}: ${m.count}`);
            mList.append(chip);
          }
        }
        if (!mList.childNodes.length) mList.append(el("span", "details-chip-empty", "0 recorded in active months"));
        detailsContent.append(mHeading, mList);
      }

      // Repository breakdown list
      if (metricData.repositories?.length) {
        const rHeading = el("strong", "details-subhead", "Repository breakdown");
        const rList = el("div", "details-repo-list");
        for (const r of metricData.repositories.slice(0, 5)) {
          const row = el("div", "details-repo-row");
          row.append(externalLink(r.url, r.name, "details-repo-link"), el("span", "details-repo-count", String(r.count)));
          rList.append(row);
        }
        detailsContent.append(rHeading, rList);
      }

      details.append(summary, detailsContent);
      card.append(details);
    }

    return card;
  }

  // Card A: Commits
  cardsGrid.append(createActivityMetricCard(
    data.metrics.commits,
    "metric-commits",
    "M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0M3 12h6m6 0h6"
  ));
  // Card B: Issues
  cardsGrid.append(createActivityMetricCard(
    data.metrics.issues,
    "metric-issues",
    "M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"
  ));
  // Card C: Reviews
  cardsGrid.append(createActivityMetricCard(
    data.metrics.reviews,
    "metric-reviews",
    "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"
  ));
  // Card D: Merged PRs
  cardsGrid.append(createActivityMetricCard(
    data.metrics.mergedPullRequests,
    "metric-prs",
    "M18 11.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z M6 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M6 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 9v3m0 3v-3m0 0h5.5"
  ));

  wrap.append(cardsGrid);

  // 6. Highlights Strip
  const highlightsPanel = el("section", "panel activity-highlights-panel");
  highlightsPanel.append(sectionHeading("OVERVIEW", "Collaboration Highlights", "Key velocity and contribution focus indicators."));

  const hlGrid = el("div", "activity-highlights-grid");

  // Most active repo
  const hlRepo = el("div", "highlight-item");
  hlRepo.append(el("div", "highlight-label", "Most Active Repository"));
  if (data.highlights?.mostActiveRepo) {
    const val = el("div", "highlight-value");
    val.append(externalLink(data.highlights.mostActiveRepo.url, data.highlights.mostActiveRepo.name));
    hlRepo.append(val, el("div", "highlight-sub", `${data.highlights.mostActiveRepo.count} contributions`));
  } else {
    hlRepo.append(el("div", "highlight-value", "None recorded"));
  }
  hlGrid.append(hlRepo);

  // Most active month
  const hlMonth = el("div", "highlight-item");
  hlMonth.append(el("div", "highlight-label", "Most Active Month"));
  if (data.highlights?.mostActiveMonth) {
    hlMonth.append(
      el("div", "highlight-value", data.highlights.mostActiveMonth.label),
      el("div", "highlight-sub", `${data.highlights.mostActiveMonth.count} contributions`)
    );
  } else {
    hlMonth.append(el("div", "highlight-value", "None recorded"));
  }
  hlGrid.append(hlMonth);

  // Average monthly contributions
  const hlAvg = el("div", "highlight-item");
  hlAvg.append(
    el("div", "highlight-label", "Monthly Average"),
    el("div", "highlight-value", `${data.highlights?.averageMonthlyContributions || 0} / mo`),
    el("div", "highlight-sub", `Across ${data.charts?.monthlyActivity?.length || 0} observed months`)
  );
  hlGrid.append(hlAvg);

  highlightsPanel.append(hlGrid);
  wrap.append(highlightsPanel);

  // 7. Visualizations Grid
  const vizGrid = el("div", "dashboard-grid activity-viz-grid");

  // Monthly Activity Chart Panel (Wide)
  const monthlyPanel = panel("ACTIVITY OVER TIME", "Monthly Activity Breakdown", "Contributions per month categorized by commits, issues, reviews, and merged PRs.", true);
  const monthlyChartWrap = el("div", "monthly-chart-wrap");
  monthlyActivityBarChart(monthlyChartWrap, data.charts?.monthlyActivity || []);
  monthlyPanel.append(monthlyChartWrap);
  vizGrid.append(monthlyPanel);

  // Contribution Trend Line Chart
  const trendPanel = panel("MOMENTUM", "Contribution Trajectory Trend", "Cumulative contribution volume progression across this period.");
  const trendChartWrap = el("div", "trend-chart-wrap");
  contributionTrendLineChart(trendChartWrap, data.charts?.cumulativeTrend || []);
  trendPanel.append(trendChartWrap);
  vizGrid.append(trendPanel);

  // Contribution Distribution Donut Chart
  const distPanel = panel("DISTRIBUTION", "Collaboration Distribution", "Proportion of work divided between commits, issues, code reviews, and merged PRs.");
  const distChartWrap = el("div", "distribution-chart-wrap");
  contributionDistributionChart(distChartWrap, data.charts?.contributionDistribution || []);
  distPanel.append(distChartWrap);
  vizGrid.append(distPanel);

  // Repository-wise Activity Breakdown (Wide)
  const repoPanel = panel("REPOSITORIES", "Repository Activity Breakdown", "Top repositories by direct contribution volume.", true);
  const repoChartWrap = el("div", "repo-breakdown-wrap");
  repositoryBreakdownChart(repoChartWrap, data.charts?.repositoryBreakdown || []);
  repoPanel.append(repoChartWrap);
  vizGrid.append(repoPanel);

  wrap.append(vizGrid);

  // 8. Recent Activity Section
  const recentSection = el("section", "panel panel-wide activity-recent-panel");
  recentSection.append(sectionHeading("RECENT WORK", "Recent Contributions & Collaboration", "Recent merged pull requests, created issues, and pull request reviews."));

  const recentGrid = el("div", "activity-recent-grid");

  // Merged PRs Column
  const prsCol = el("div", "recent-activity-col");
  prsCol.append(el("h4", "recent-col-heading", "Merged Pull Requests"));
  const prList = el("div", "recent-items-list");
  const prs = data.recentActivity?.mergedPullRequests || [];
  if (!prs.length) {
    prList.append(el("div", "recent-empty-item", "No merged PRs recorded in this range."));
  } else {
    prs.forEach((pr) => {
      const item = el("div", "recent-activity-card");
      const titleLink = externalLink(pr.url, pr.title, "recent-item-title");
      const sub = el("div", "recent-item-meta");
      sub.append(
        el("span", "recent-badge badge-merged", `PR #${pr.number}`),
        el("span", "recent-item-repo", pr.repo),
        el("span", "recent-item-date", pr.mergedAt ? formatDate(pr.mergedAt) : "")
      );
      item.append(titleLink, sub);
      prList.append(item);
    });
  }
  prsCol.append(prList);
  recentGrid.append(prsCol);

  // Issues Column
  const issuesCol = el("div", "recent-activity-col");
  issuesCol.append(el("h4", "recent-col-heading", "Issues Created"));
  const issueList = el("div", "recent-items-list");
  const issues = data.recentActivity?.issues || [];
  if (!issues.length) {
    issueList.append(el("div", "recent-empty-item", "No issues opened in this range."));
  } else {
    issues.forEach((iss) => {
      const item = el("div", "recent-activity-card");
      const titleLink = externalLink(iss.url, iss.title, "recent-item-title");
      const sub = el("div", "recent-item-meta");
      sub.append(
        el("span", "recent-badge badge-issue", `Issue #${iss.number}`),
        el("span", "recent-item-repo", iss.repo),
        el("span", "recent-item-date", iss.createdAt ? formatDate(iss.createdAt) : "")
      );
      item.append(titleLink, sub);
      issueList.append(item);
    });
  }
  issuesCol.append(issueList);
  recentGrid.append(issuesCol);

  // Reviews Column
  const reviewsCol = el("div", "recent-activity-col");
  reviewsCol.append(el("h4", "recent-col-heading", "Code Reviews"));
  const reviewList = el("div", "recent-items-list");
  const revs = data.recentActivity?.reviews || [];
  if (!revs.length) {
    reviewList.append(el("div", "recent-empty-item", "No submitted code reviews recorded."));
  } else {
    revs.forEach((rev) => {
      const item = el("div", "recent-activity-card");
      const titleLink = externalLink(rev.url, rev.repo, "recent-item-title");
      const sub = el("div", "recent-item-meta");
      sub.append(
        el("span", "recent-badge badge-review", "Review"),
        el("span", "recent-item-repo", `${rev.count} review${rev.count === 1 ? "" : "s"} submitted`)
      );
      item.append(titleLink, sub);
      reviewList.append(item);
    });
  }
  reviewsCol.append(reviewList);
  recentGrid.append(reviewsCol);

  recentSection.append(recentGrid);
  wrap.append(recentSection);

  // 9. Data Notice Panel
  const noticePanel = el("section", "data-notice activity-notice-panel");
  const noticeMark = el("span", "notice-mark", "i");
  const noticeContent = el("div", "notice-content");
  noticeContent.append(el("strong", "", `Data source: ${data.dataCompleteness?.dataSource || "GitHub API"}`));
  const ul = el("ul", "notice-list");
  for (const lim of data.dataCompleteness?.limitations || []) {
    ul.append(el("li", "", lim));
  }
  noticeContent.append(ul);
  noticePanel.append(noticeMark, noticeContent);
  wrap.append(noticePanel);

  activityRoot.append(wrap);
  activityRoot.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function analyzeActivity(rawUsername, options = {}) {
  const username = String(rawUsername || "").trim();
  if (!validUsername(username)) {
    showError(new Error("Use a valid GitHub username with up to 39 letters, numbers, or single hyphens."), "activity");
    return;
  }
  dismissError();
  setBusy(true, "Analyzing GitHub activity", `Collecting contribution records, pull requests, issues, and reviews for @${username}.`);
  const revision = ++viewRevision;
  lastRequest = { mode: "activity", username, options };

  try {
    const range = options.range || "12m";
    const params = new URLSearchParams({ username, range });
    if (options.from) params.set("from", options.from);
    if (options.to) params.set("to", options.to);

    const data = await apiRequest(`/api/github/activity-tracker?${params.toString()}`, null, { method: "GET" });
    if (revision !== viewRevision) return;

    state.activeUsername = username;
    state.addHistory(username);
    renderHistory((name) => {
      if (state.mode === "activity") analyzeActivity(name);
      else explore(name);
    });

    renderActivityDashboard(data, options);
  } catch (error) {
    if (revision === viewRevision) showError(error, "activity");
  } finally {
    if (revision === viewRevision) setBusy(false);
  }
}

function setMode(mode) {
  if (mode === state.mode) return;
  viewRevision += 1;
  setBusy(false);
  state.mode = mode;
  const insights = mode === "insights";
  const compare = mode === "compare";
  const activity = mode === "activity";
  $("#mode-insights").classList.toggle("is-active", insights);
  $("#mode-compare").classList.toggle("is-active", compare);
  $("#mode-activity").classList.toggle("is-active", activity);
  $("#mode-insights").setAttribute("aria-selected", String(insights));
  $("#mode-compare").setAttribute("aria-selected", String(compare));
  $("#mode-activity").setAttribute("aria-selected", String(activity));
  $("#insights-view").hidden = !insights;
  $("#compare-view").hidden = !compare;
  $("#activity-view").hidden = !activity;
  reportRoot.replaceChildren();
  comparisonRoot.replaceChildren();
  activityRoot.replaceChildren();
  dismissError();
}

function initializeConstellation() {
  const canvas = $("#constellation");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const points = [];
  let width = 0, height = 0, frame = 0, lastDraw = 0, visible = true;
  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    points.length = 0;
    const count = Math.min(65, Math.max(25, Math.round(width * height / 26000)));
    for (let i = 0; i < count; i++) points.push({ x: Math.random() * width, y: Math.random() * height, dx: (Math.random() - .5) * .09, dy: (Math.random() - .5) * .09 });
    draw(performance.now(), true);
  };
  const draw = (now, force = false) => {
    if (!visible) return;
    if (!force && now - lastDraw < 70) { if (!reduce.matches) frame = requestAnimationFrame(draw); return; }
    lastDraw = now;
    context.clearRect(0, 0, width, height);
    const light = document.documentElement.dataset.theme === "light";
    const line = light ? "54, 104, 164" : "105, 147, 199";
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (!reduce.matches) {
        point.x += point.dx; point.y += point.dy;
        if (point.x < 0 || point.x > width) point.dx *= -1;
        if (point.y < 0 || point.y > height) point.dy *= -1;
      }
      for (let j = i + 1; j < points.length; j++) {
        const other = points[j];
        const distance = Math.hypot(point.x - other.x, point.y - other.y);
        if (distance < 135) {
          context.strokeStyle = `rgba(${line}, ${(1 - distance / 135) * (light ? .08 : .1)})`;
          context.lineWidth = .7;
          context.beginPath(); context.moveTo(point.x, point.y); context.lineTo(other.x, other.y); context.stroke();
        }
      }
      context.fillStyle = `rgba(${line}, ${light ? .16 : .25})`;
      context.beginPath(); context.arc(point.x, point.y, 1.1, 0, Math.PI * 2); context.fill();
    }
    if (!reduce.matches) frame = requestAnimationFrame(draw);
  };
  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
    if (visible) { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); }
  });
  reduce.addEventListener("change", () => {
    cancelAnimationFrame(frame);
    draw(performance.now(), true);
  });
  window.addEventListener("resize", resize, { passive: true });
  resize();
}

function initialize() {
  initializeTheme();
  initializeConstellation();
  const handleSelect = (username) => {
    if (state.mode === "activity") analyzeActivity(username);
    else explore(username);
  };
  renderHistory(handleSelect);
  $("#explore-form").addEventListener("submit", (event) => { event.preventDefault(); explore($("#username-input").value); });
  $("#compare-form").addEventListener("submit", (event) => { event.preventDefault(); compare($("#username-a").value, $("#username-b").value); });
  $("#activity-form").addEventListener("submit", (event) => { event.preventDefault(); analyzeActivity($("#activity-username-input").value); });
  $("#mode-insights").addEventListener("click", () => setMode("insights"));
  $("#mode-compare").addEventListener("click", () => setMode("compare"));
  $("#mode-activity").addEventListener("click", () => setMode("activity"));
  $("#clear-history").addEventListener("click", () => { state.clearHistory(); renderHistory(handleSelect); });
  $("#retry-button").addEventListener("click", () => {
    errorPanel.hidden = true;
    if (lastRequest?.mode === "compare") compare(lastRequest.first, lastRequest.second);
    else if (lastRequest?.mode === "activity") analyzeActivity(lastRequest.username, lastRequest.options);
    else if (lastRequest?.username) explore(lastRequest.username);
  });
}

initialize();
