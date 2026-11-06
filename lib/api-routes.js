import health from "./api-routes/health.js";
import githubActivity from "./api-routes/github-activity.js";
import githubLanguages from "./api-routes/github-languages.js";
import githubProfile from "./api-routes/github-profile.js";
import githubRepositories from "./api-routes/github-repositories.js";
import insightsAnalyze from "./api-routes/insights-analyze.js";
import insightsCompare from "./api-routes/insights-compare.js";
import insightsDeep from "./api-routes/insights-deep.js";
import insightsPersonality from "./api-routes/insights-personality.js";
import insightsScore from "./api-routes/insights-score.js";
import aiRoast from "./api-routes/ai-roast.js";
import aiSummary from "./api-routes/ai-summary.js";
import aiVerdict from "./api-routes/ai-verdict.js";

export const API_ROUTE_HANDLERS = new Map([
  ["/api/health", health],
  ["/api/github/activity", githubActivity],
  ["/api/github/languages", githubLanguages],
  ["/api/github/profile", githubProfile],
  ["/api/github/repositories", githubRepositories],
  ["/api/insights/analyze", insightsAnalyze],
  ["/api/insights/compare", insightsCompare],
  ["/api/insights/deep", insightsDeep],
  ["/api/insights/personality", insightsPersonality],
  ["/api/insights/score", insightsScore],
  ["/api/ai/roast", aiRoast],
  ["/api/ai/summary", aiSummary],
  ["/api/ai/verdict", aiVerdict]
]);

export const API_ROUTE_PATHS = Object.freeze([...API_ROUTE_HANDLERS.keys()]);
