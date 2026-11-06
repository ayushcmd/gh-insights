import { endpoint, body, username } from "../api-helpers.js";
import { collectDeveloper } from "../github.js";
import { summarizeDeveloper } from "../analysis.js";
import { generateInsight, geminiStatus } from "../gemini.js";

export default endpoint(async (req) => {
  const payload = body(req);
  const clean = username(req, payload);
  if (!geminiStatus().configured) return generateInsight("roast", {});
  const data = await collectDeveloper(clean);
  const report = summarizeDeveloper(data);
  return generateInsight("roast", { profile: report.profile, statistics: report.statistics, repositories: report.highlights, languages: report.languages.distribution });
}, { methods: ["POST"], rateLimit: 3 });
