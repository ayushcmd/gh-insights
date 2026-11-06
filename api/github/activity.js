import { endpoint, username } from "../../lib/api-helpers.js";
import { getActivityAnalysis } from "../../lib/github.js";

export default endpoint(async (req) => {
  return getActivityAnalysis(username(req));
}, { methods: ["GET"], rateLimit: 20 });
