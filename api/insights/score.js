import { endpoint, body, username } from "../../lib/api-helpers.js";
import { collectDeveloper } from "../../lib/github.js";
import { scoreDeveloper } from "../../lib/analysis.js";

export default endpoint(async (req) => scoreDeveloper(await collectDeveloper(username(req, body(req)))), { methods: ["POST"], rateLimit: 18 });
