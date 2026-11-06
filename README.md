# GH-Insights

GH-Insights is a GitHub Developer Intelligence & Personality Analyzer. Enter a public GitHub username to explore repository patterns, primary languages, public activity, and transparent profile signals. V/S mode places two public profiles side by side without declaring an overall winner.

## Features

- Public GitHub profile and repository collection through Vercel serverless functions.
- Paginated repository collection, bounded at 1,000 repositories with visible coverage status.
- Primary-language distribution, repository portfolio, stars, forks, and recent public events.
- Explainable developer pattern labels and an application-specific weighted indicator.
- Two-profile comparison and optional Gemini summary, gentle roast, and comparison verdict.
- Dark/light themes, responsive layout, recent usernames, print/PDF through the browser, SVG chart export, and GitHub profile links.
- Same-origin API by default, server-only credentials, strict username validation, safe text rendering, bounded requests, and security headers.

No production deployment URL is configured yet.

## Technology

Vanilla HTML, CSS, and JavaScript ES modules; Node.js 20+; Vercel Functions; GitHub REST API; optional Gemini API. There are no runtime npm dependencies and no database.

## Project structure

```text
api/                 Vercel serverless HTTP endpoints
lib/                 GitHub collection, scoring, security, cache, and Gemini logic
public/              Static HTML, CSS, and browser ES modules
server/              Native Node.js local development server and .env.local loader
scripts/              Syntax, logic, and mocked local HTTP checks
docs/                API, deployment, and environment documentation
.env.example         Placeholder environment variable names
vercel.json          Static deployment and security headers
```

## Local setup

1. Install Node.js 20 or newer.
2. Optionally copy `.env.example` to `.env.local` and enter credentials there. `.env.local` is ignored by Git.
3. Run `npm run dev` (or `npm start`) from the project root.
4. Open `http://localhost:3000`. Public GitHub analysis works without credentials, with lower unauthenticated API limits. Gemini features remain unavailable until both Gemini variables are configured.

Run `npm run check` for JavaScript syntax, local analysis/validation smoke checks, mocked GitHub pagination and Gemini-header checks, Vercel route imports, and local HTTP route tests. All upstream requests in these checks are mocked; no live API calls are made. Live integrations must be checked after deployment configuration.

## Deploy

Follow [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md), then configure the variables from [ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md). Add secrets using Vercel's project environment-variable settings, never in source files.

## Limitations

- Only public profile and repository data is collected. No private repository scope is requested.
- Repository collection is bounded to 1,000 repositories per report. Coverage is labeled when that bound is reached.
- Language distribution counts GitHub's primary-language label once per repository; it is not a byte share or skill estimate.
- Public events are a limited recent feed (up to 300 returned events here), not a full contribution history.
- Documentation presence and source-code quality are not measured. Maintenance signals use public push dates and archive state.
- Scores and archetypes are explainable application signals, not official GitHub ratings, certifications, or psychological claims.
- Cache and rate limits are in-memory best effort per serverless instance. They are not shared across deployments or instances.
- Gemini is optional. The app's core GitHub analysis works without it.
