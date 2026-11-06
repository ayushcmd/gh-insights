import { endpoint, body, username } from "../api-helpers.js";
import { collectDeveloper } from "../github.js";
import { analyzePersonality } from "../analysis.js";

export default endpoint(async (req) => analyzePersonality(await collectDeveloper(username(req, body(req)))), { methods: ["POST"], rateLimit: 18 });
