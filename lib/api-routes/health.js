import { endpoint } from "../api-helpers.js";
import { geminiStatus } from "../gemini.js";

export default endpoint(async () => {
  const gemini = geminiStatus();
  return {
    status: "ok",
    service: "GH-Insights",
    timestamp: new Date().toISOString(),
    integrations: { github: "available", gemini: gemini.configured ? "configured" : "optional_unconfigured" },
    diagnostics: {
      gemini: {
        configured: gemini.configured,
        requestedModel: gemini.model,
        upstreamChecked: false,
        note: "Configuration presence only; this check does not call Gemini or validate key, model access, project eligibility, or quota."
      }
    },
    note: "Health responses never include credential values."
  };
}, { methods: ["GET"], rateLimit: 60 });
