import { endpoint, body, username } from "../api-helpers.js";
import { collectDeveloper } from "../github.js";
import { summarizeDeveloper } from "../analysis.js";

export default endpoint(async (req) => {
  const payload = body(req);
  return summarizeDeveloper(await collectDeveloper(username(req, payload)));
}, { methods: ["POST"], rateLimit: 18 });
