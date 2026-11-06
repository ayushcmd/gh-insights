import { endpoint, body, username } from "../../lib/api-helpers.js";
import { collectDeveloper } from "../../lib/github.js";
import { analyzePersonality } from "../../lib/analysis.js";

export default endpoint(async (req) => analyzePersonality(await collectDeveloper(username(req, body(req)))), { methods: ["POST"], rateLimit: 18 });
