# Vercel deployment guide

1. Push this repository to a Git provider when you are ready. GH-Insights does not commit or push changes for you.
2. In Vercel, create a project and import the repository.
3. Set the **Root Directory** to the repository root containing `vercel.json`, `api/`, `lib/`, and `public/`.
4. Use the Node.js runtime supported by the project (`package.json` requests Node.js 20 or newer). No build command or framework preset is required; leave the output directory unset.
5. Deploy once. The frontend is served from `public/`, and files under `api/` become serverless functions.
6. In **Project Settings → Environment Variables**, add the optional variables listed in [ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md). Use encrypted Vercel values for API keys.
7. Select the environments where each variable applies (Production, Preview, and/or Development), save, then redeploy so functions receive the updated settings.
8. Open `/api/health` on the deployment. It reports application availability and whether optional Gemini integration is configured; it never returns secret values.
9. Test a public GitHub profile in Insights, then compare two profiles in V/S. Gemini buttons return a clear unavailable message until both Gemini variables are valid.

The deployment requires no database, paid cache, separate backend host, or background worker. Vercel's plan-specific function duration and request limits still apply; repository pagination and event collection are bounded in code.

## Custom frontend origin

The API is same-origin by default. If the frontend must run on a different exact origin, set `ALLOWED_ORIGINS` to a comma-separated list of full origins such as `https://insights.example.com`. Do not use wildcard origins. The deployment's host is always allowed for same-origin requests.

## Standalone local development

Use Node.js 20 or newer and run `npm run dev` (or `npm start`) from the project root. The native Node.js server serves `public/` and routes API requests through the same handlers used by Vercel. No Vercel CLI, account login, project linking, or npm runtime packages are needed. GitHub and Gemini requests still need network access when those features are used. Optional local credentials can be placed in `.env.local`; it is ignored by Git and its values are never printed by the server.
