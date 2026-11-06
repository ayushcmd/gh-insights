import { endpoint, username } from "../api-helpers.js";
import { getActivityAnalysis } from "../github.js";

export default endpoint(async (req) => {
  return getActivityAnalysis(username(req));
}, { methods: ["GET"], rateLimit: 20 });
