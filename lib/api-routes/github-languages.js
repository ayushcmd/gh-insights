import { endpoint, username } from "../api-helpers.js";
import { getLanguageAnalysis } from "../github.js";

export default endpoint(async (req) => {
  return getLanguageAnalysis(username(req));
}, { methods: ["GET"], rateLimit: 20 });
