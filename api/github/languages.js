import { endpoint, username } from "../../lib/api-helpers.js";
import { getLanguageAnalysis } from "../../lib/github.js";

export default endpoint(async (req) => {
  return getLanguageAnalysis(username(req));
}, { methods: ["GET"], rateLimit: 20 });
