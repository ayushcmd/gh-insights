# Environment setup

For deployed environments, put variables in **Vercel Project Settings → Environment Variables**. For standalone local development, put optional values in the ignored `.env.local` file at the repository root. The local server loads that file without printing values. Never put credentials in `public/`, browser JavaScript, query strings, or committed files.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | No | Server-side GitHub token to improve API rate limits. Use a fine-grained token with only public repository metadata read access; do not enable private repository access. Without it, public unauthenticated GitHub requests still work under the lower API limit. |
| `GEMINI_API_KEY` | No | Server-side Google Gemini API key, sent only in the `x-goog-api-key` header from a Vercel function. |
| `GEMINI_MODEL` | No | Gemini model identifier available to the configured API key/project. Must be set with `GEMINI_API_KEY`; the app does not hard-code a model. |
| `ALLOWED_ORIGINS` | No | Optional comma-separated list of exact frontend origins when using a separate frontend host. Leave empty for the default same-origin deployment. |

Gemini integration is enabled only when both `GEMINI_API_KEY` and `GEMINI_MODEL` are present. Missing or unavailable Gemini configuration never disables GitHub analysis. Health status exposes only whether Gemini is configured, never a credential or environment value.

After changing any Vercel environment value, redeploy the affected environment. `.env.example` contains empty placeholders; replace them only in the secure local or Vercel settings interface.
