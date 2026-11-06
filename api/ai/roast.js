import { endpoint, body, username } from "../../lib/api-helpers.js";
import { collectDeveloper } from "../../lib/github.js";
import { summarizeDeveloper } from "../../lib/analysis.js";
import { generateInsight, geminiStatus } from "../../lib/gemini.js";

export default endpoint(async (req) => {
  const payload = body(req);
  const clean = username(req, payload);
  if (!geminiStatus().configured) return generateInsight("roast", {});
  const data = await collectDeveloper(clean);
  const report = summarizeDeveloper(data);
  return generateInsight("roast", { profile: report.profile, statistics: report.statistics, repositories: report.highlights, languages: report.languages.distribution });
}, { methods: ["POST"], rateLimit: 3 });
