import { endpoint, body, username } from "../../lib/api-helpers.js";
import { collectDeveloper } from "../../lib/github.js";
import { summarizeDeveloper } from "../../lib/analysis.js";
import { generateInsight, geminiStatus } from "../../lib/gemini.js";

export default endpoint(async (req) => {
  const payload = body(req);
  const clean = username(req, payload);
  if (!geminiStatus().configured) return generateInsight("summary", {});
  const data = await collectDeveloper(clean);
  const report = summarizeDeveloper(data);
  return generateInsight("summary", { profile: report.profile, statistics: report.statistics, repositories: report.highlights, languages: report.languages.distribution, activity: report.activity, personality: report.personality, score: report.score, limitations: report.notes });
}, { methods: ["POST"], rateLimit: 5 });
