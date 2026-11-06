# API documentation

All endpoints return JSON and are hosted on the same Vercel deployment. The frontend uses same-origin requests. `OPTIONS` preflight is supported; cross-origin access is denied unless the request matches the deployment host or an exact origin in `ALLOWED_ORIGINS`.

The 13 public endpoint URLs are backed by four Vercel function entrypoints: `/api/health`, `/api/github/*`, `/api/insights/*`, and `/api/ai/*`. `vercel.json` rewrites the three endpoint groups to shared functions. The route-specific handlers remain in `lib/api-routes/`, so local development and Vercel use the same request, response, method, authentication, rate-limit, cache, and error behavior.

Usernames are trimmed and checked against GitHub username syntax before any upstream request. No endpoint accepts a GitHub URL. API keys are never accepted from clients.

## Endpoints

| Endpoint | Method | Request | Purpose |
| --- | --- | --- | --- |
| `/api/health` | GET | None | Service health and a safe Gemini configuration diagnostic. Reports whether both variables are present and the configured model, but does not call Gemini or validate credentials, model access, project eligibility, or quota. |
| `/api/github/profile?username=octocat` | GET | `username` query parameter | Public profile fields only. |
| `/api/github/repositories?username=octocat` | GET | `username` query parameter | Repositories and pagination coverage metadata, up to 1,000 repos. |
| `/api/github/activity?username=octocat` | GET | `username` query parameter | Public event counts, observed dates, and coverage note. |
| `/api/github/languages?username=octocat` | GET | `username` query parameter | Primary-language counts by repository and coverage. |
| `/api/insights/analyze` | POST | `{"username":"octocat"}` | Full dashboard report, score, pattern labels, repository highlights, and coverage. |
| `/api/insights/personality` | POST | `{"username":"octocat"}` | Explainable public activity pattern labels. |
| `/api/insights/score` | POST | `{"username":"octocat"}` | Weighted public-metadata indicator and formula. |
| `/api/insights/deep` | POST | `{"username":"octocat"}` | Detailed version of the report with all collected repository metadata up to the cap. |
| `/api/insights/compare` | POST | `{"usernameA":"octocat","usernameB":"torvalds"}` | Two complete report summaries and observed comparison data. |
| `/api/ai/summary` | POST | `{"username":"octocat"}` | Optional Gemini summary from server-collected structured data. |
| `/api/ai/roast` | POST | `{"username":"octocat"}` | Optional respectful, evidence-based roast. |
| `/api/ai/verdict` | POST | `{"usernameA":"octocat","usernameB":"torvalds"}` | Optional neutral Gemini comparison perspective. |

The normal success response is the resource object directly. AI endpoints return `{"available":true,"text":"…","format":"structured|markdown","structured":{…},"repositoryLinks":[…]}` or `{"available":false,"code":"…","message":"…"}`. Summary requests ask Gemini GenerateContent for JSON with `generationConfig.responseJsonSchema`; the backend validates and normalizes overview, strengths, project patterns, technology preferences, repository references, growth areas, and limitations. Existing Markdown/text responses from summary, roast, and verdict remain supported. Structured repository links are derived from actual server-retrieved GitHub records; model-generated URLs are discarded. Error responses use `{"error":{"code":"…","message":"…"}}`; validation errors may include a non-sensitive `details` object.

Gemini upstream failures produce structured server logs with HTTP status, Gemini error status/message, configured model, action, and retry attempt/delay details. API keys, authorization headers, request prompts, profile data, and generated text are never logged. Transient HTTP 429 and 503 responses receive at most two exponential-backoff retries; known daily quota exhaustion is not retried. Provider `Retry-After` is honored, and a retry is skipped if the requested wait exceeds the local cap. HTTP 400, 401, 403, 404, and 500 failures are not retried and receive distinct user-facing messages.

## Status codes

- `200`: successful response.
- `204`: accepted OPTIONS preflight.
- `400`: invalid/missing username, malformed JSON, duplicate comparison usernames, or invalid AI request.
- `403`: request origin is not allowed.
- `404`: GitHub profile not found.
- `405`: unsupported HTTP method.
- `422`: GitHub could not provide public data for the requested resource.
- `429`: local per-instance request limit or GitHub rate limit.
- `500`: unexpected server failure; internal stack details are omitted.
- `502`: unexpected upstream response.
- `504`: upstream timeout.

## Collection bounds and caching

Repository pagination requests 100 items per page, fetches later pages with a bounded concurrency of nine, filters private records, and stops at 1,000 items. Event collection requests at most three pages of 100 recent public events. Responses expose coverage indicators where applicable. Per-process memory caching uses short TTLs and a bounded entry count; Vercel may invoke another instance with an empty cache.

## Rate limits

Best-effort per-process windows are configured by endpoint: health 60/minute; standard profile and insight endpoints 18–24/minute; deep and compare 8–10/minute; Gemini summary 5/minute; roast and verdict 3/minute. Vercel's multi-instance deployment does not share these counters. They are not distributed abuse protection; use a durable rate-limit service only if the deployment's threat model requires one.
