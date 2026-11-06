# GH-Insights

### GitHub personality and developer intelligence analyzer

**Explore the story behind any GitHub developer.**

GH-Insights turns public GitHub profile, repository, language, and activity data into an interactive report. Optional Google Gemini perspectives add context to those signals; they are clearly distinguished from measured statistics.

<p align="center">
  <a href="https://github.com/ayushcmd/gh-insights">
    <img src="https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub repository">
  </a>
  <img src="https://img.shields.io/badge/Frontend-Vanilla%20JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="Vanilla JavaScript">
  <img src="https://img.shields.io/badge/Runtime-Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Deploy%20target-Vercel-black?style=for-the-badge&logo=vercel" alt="Vercel deployment target">
</p>

---

## What it does

Enter a public GitHub username to explore a structured profile report. Switch to **V/S** mode to compare two public profiles side by side. GH-Insights focuses on observable public data and explains the limits of each signal.

### Developer insights

- Explore public profile and repository information.
- Review primary-language distribution, stars, forks, and recent public events.
- See repository coverage and pagination limits in the report.
- Explore explainable development patterns and application-specific indicators.
- Open notable repositories on GitHub.

### Profile comparison

Compare repository statistics, language signals, public activity, and other available report data. The comparison presents differences without declaring an overall winner.

### Optional Gemini perspectives

When configured, Gemini can generate a developer summary, a gentle roast, or a neutral comparison verdict. Summary responses use a validated structured format when available, while existing Markdown responses remain supported. AI interpretations are presented separately from measured GitHub statistics.

### Interface

- Light and dark themes.
- Responsive desktop and mobile layouts.
- Recent profile history.
- Printable reports and downloadable language-chart images.

## How it is built

| Area | Implementation |
| --- | --- |
| Frontend | HTML, CSS, and browser JavaScript modules |
| Local server | Native Node.js HTTP modules |
| Production API | Four Vercel Function entrypoints |
| GitHub data | GitHub REST API |
| Optional AI | Google Gemini API |
| Runtime dependencies | None |

The 13 existing public API paths are preserved. Vercel rewrites group related paths through `/api/health`, `/api/github`, `/api/insights`, and `/api/ai`. Local development dispatches those paths to the same route-specific handlers; it does not require Vercel CLI, account login, or project linking.

```text
Browser ──► local Node server or Vercel Functions
                         │
              shared route handlers
                  ┌──────┴──────┐
                GitHub       Gemini
                 REST          API
```

## Run locally

### Requirements

- Node.js 20 or newer.
- Git, if cloning the repository.

The project has no runtime npm dependencies, so installing packages is not required for development.

### Start the app

```bash
git clone https://github.com/ayushcmd/gh-insights.git
cd gh-insights
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `npm start` launches the same server.

Public GitHub analysis works without credentials, subject to GitHub's lower unauthenticated rate limits. Gemini is optional and remains unavailable until its server-side key and model are configured.

### Configure optional credentials

Copy `.env.example` to `.env.local` in the project root, then add values as needed. The local server loads this ignored file without printing its contents.

| Variable | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Optional server-side token for higher GitHub API limits. Public data only; do not grant private repository access. |
| `GEMINI_API_KEY` | Optional server-side Gemini API key. |
| `GEMINI_MODEL` | Gemini model ID for the configured project; the example uses `gemini-3.8-flash`. |
| `ALLOWED_ORIGINS` | Optional comma-separated list of exact origins for a separately hosted frontend. |

Keep credentials out of frontend code, URLs, and committed files. See [Environment Setup](docs/ENVIRONMENT_SETUP.md) for details.

### Run checks

```bash
npm run check
```

The checks cover JavaScript syntax, analysis and validation, structured and legacy Gemini responses, API routing, and local HTTP behavior. Upstream GitHub and Gemini responses are mocked; the checks do not make live API calls.

## API routes

All endpoints return JSON. See [API Documentation](docs/API_DOCUMENTATION.md) for request formats, responses, and error behavior.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Service and safe Gemini configuration status |
| GET | `/api/github/profile` | Public profile fields |
| GET | `/api/github/repositories` | Public repositories and coverage metadata |
| GET | `/api/github/activity` | Recent available public activity |
| GET | `/api/github/languages` | Repository primary-language distribution |
| POST | `/api/insights/analyze` | Full developer report |
| POST | `/api/insights/personality` | Explainable public activity patterns |
| POST | `/api/insights/score` | Application-specific indicator and formula |
| POST | `/api/insights/deep` | Detailed report with collected repository metadata |
| POST | `/api/insights/compare` | Two-profile comparison |
| POST | `/api/ai/summary` | Optional Gemini summary |
| POST | `/api/ai/roast` | Optional gentle roast |
| POST | `/api/ai/verdict` | Optional comparison perspective |

## Deploy

GH-Insights is configured for Vercel. Follow the [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) and add optional secrets through Vercel Project Settings. The application keeps API keys on the server and does not expose them to browser code.

## Data and interpretation limits

- Only public GitHub data is used; private repositories and private contributions are not included.
- Repository collection is bounded at 1,000 repositories per report. Coverage metadata indicates when collection is incomplete.
- Language distribution counts GitHub's primary-language label per repository; it is not a measure of code volume or proficiency.
- Public events are a limited recent feed, not a lifetime contribution history.
- Scores and pattern labels are explainable application signals, not official GitHub ratings or skill assessments.
- Repository metadata alone cannot establish code quality, architecture, testing practices, or professional experience.
- Gemini output is an interpretation of the available data, not a verified fact about a developer's skills or personality.

GH-Insights is an independent project and is not an official GitHub product.

## Project documentation

- [API Documentation](docs/API_DOCUMENTATION.md)
- [Deployment Guide](docs/DEPLOYMENT_GUIDE.md)
- [Environment Setup](docs/ENVIRONMENT_SETUP.md)
- [Security](SECURITY.md)
