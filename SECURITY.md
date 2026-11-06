# Security notes

## Secrets and upstream requests

- `GITHUB_TOKEN` and `GEMINI_API_KEY` are read only by server-side modules. Neither value is returned from any endpoint.
- Gemini authentication uses the `x-goog-api-key` header; credentials are not put in URLs or browser code.
- `GITHUB_TOKEN` is optional and only needed for higher GitHub API limits. The app asks for no private repository permissions.
- `.env` and `.env.*` are ignored by Git; `.env.example` is the only committed environment template.

## Request and response safety

- Usernames are normalized and validated against the GitHub username pattern, capped at 39 characters, and URL-encoded before upstream use.
- Repository results with a private flag are filtered before analysis, even if an operator supplies a token with broader access than recommended.
- Methods, request origins, JSON payloads, request timeouts, page counts, response sizes, and per-instance request rates are bounded.
- CORS is same-origin unless an exact origin is listed in `ALLOWED_ORIGINS`; wildcard access is not used.
- GitHub text is rendered with `textContent` and DOM node creation. Repository links are restricted to HTTPS `github.com` hosts, and external links use `noopener noreferrer`.
- Response errors avoid exposing upstream bodies, stack traces, or environment values.
- Vercel headers include a restrictive Content Security Policy, frame denial, content-type sniffing protection, and a strict referrer policy.

## Gemini prompt handling

Only structured, bounded data collected by the server is passed to Gemini. Profile names, bios, repository names, descriptions, and topics are treated as untrusted data. System instructions say to ignore instructions embedded in those values. The model output is length-checked and shown as text, never interpreted as HTML. Gemini outages, malformed responses, timeouts, and quota errors do not affect core GitHub analysis.

## Known security limitations

- Rate limiting and cache state are in-memory and per serverless instance. They can reset between invocations and are not a shared abuse-control boundary.
- Public endpoints can still be called directly; no user accounts or authenticated application sessions are required.
- Vercel plan limits and upstream API policies apply. Add durable distributed rate limiting only if production traffic requires it; no database or paid cache is included.
- A GitHub token with broader permissions than recommended remains an operator configuration risk. Use a least-privilege token and configure it only in Vercel's environment settings.
