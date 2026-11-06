import { endpoint, body } from "../api-helpers.js";
import { normalizeUsername, HttpError } from "../validation.js";
import { collectDeveloper } from "../github.js";
import { summarizeDeveloper } from "../analysis.js";
import { generateInsight, geminiStatus } from "../gemini.js";

export default endpoint(async (req) => {
  const payload = body(req);
  const first = normalizeUsername(payload.usernameA);
  const second = normalizeUsername(payload.usernameB);
  if (first.toLowerCase() === second.toLowerCase()) throw new HttpError(400, "duplicate_usernames", "Choose two different GitHub usernames to compare.");
  if (!geminiStatus().configured) return generateInsight("verdict", {});
  const [a, b] = await Promise.all([collectDeveloper(first), collectDeveloper(second)]);
  const compact = (data) => {
    const report = summarizeDeveloper(data);
    return { profile: report.profile, statistics: report.statistics, repositories: report.highlights, languages: report.languages.distribution, personality: report.personality, score: report.score, limitations: report.notes };
  };
  return generateInsight("verdict", { developerA: compact(a), developerB: compact(b) });
}, { methods: ["POST"], rateLimit: 3 });
