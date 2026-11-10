import { body, endpoint, username } from "../api-helpers.js";
import { getActivityTracker } from "../github.js";

export default endpoint(async (req) => {
  const payload = req.method === "POST" ? body(req) : {};
  const user = username(req, payload);
  const range = (req.method === "GET" ? req.query?.range : payload.range) || req.query?.range || "12m";
  const from = (req.method === "GET" ? req.query?.from : payload.from) || req.query?.from;
  const to = (req.method === "GET" ? req.query?.to : payload.to) || req.query?.to;

  return getActivityTracker(user, { range, from, to });
}, { methods: ["GET", "POST"], rateLimit: 24 });
