import { endpoint, body, username } from "../../lib/api-helpers.js";
import { collectDeveloper } from "../../lib/github.js";
import { summarizeDeveloper } from "../../lib/analysis.js";

export default endpoint(async (req) => {
  const payload = body(req);
  return summarizeDeveloper(await collectDeveloper(username(req, payload)));
}, { methods: ["POST"], rateLimit: 18 });
