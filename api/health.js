import { endpoint } from "../lib/api-helpers.js";
import { geminiStatus } from "../lib/gemini.js";

export default endpoint(async () => ({
  status: "ok",
  service: "GH-Insights",
  timestamp: new Date().toISOString(),
  integrations: { github: "available", gemini: geminiStatus().configured ? "configured" : "optional_unconfigured" },
  note: "Health responses never include credential values."
}), { methods: ["GET"], rateLimit: 60 });
