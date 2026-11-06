import { endpoint, body, username } from "../../lib/api-helpers.js";
import { collectDeveloper } from "../../lib/github.js";
import { summarizeDeveloper } from "../../lib/analysis.js";

export default endpoint(async (req) => {
  const payload = body(req);
  const report = summarizeDeveloper(await collectDeveloper(username(req, payload)));
  return { ...report, detail: {
    allRepositories: report.repositories,
    allLanguageCounts: report.languages.distribution,
    activityCoverage: report.activity,
    interpretation: "Repository timelines show creation and update metadata for retrieved public repositories; they do not establish when a developer learned or adopted a technology."
  } };
}, { methods: ["POST"], rateLimit: 10 });
