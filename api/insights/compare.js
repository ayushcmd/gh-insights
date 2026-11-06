import { endpoint, body, username } from "../../lib/api-helpers.js";
import { collectDeveloper } from "../../lib/github.js";
import { summarizeDeveloper } from "../../lib/analysis.js";
import { HttpError } from "../../lib/validation.js";

export default endpoint(async (req) => {
  const payload = body(req);
  const first = username(req, { username: payload.usernameA });
  const second = username(req, { username: payload.usernameB });
  if (first.toLowerCase() === second.toLowerCase()) throw new HttpError(400, "duplicate_usernames", "Choose two different GitHub usernames to compare.");
  const [a, b] = await Promise.all([collectDeveloper(first), collectDeveloper(second)]);
  return { developers: [summarizeDeveloper(a), summarizeDeveloper(b)], collectedAt: new Date().toISOString(), comparisonNote: "This comparison describes available public metadata and does not rank professional ability." };
}, { methods: ["POST"], rateLimit: 8 });
