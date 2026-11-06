import { HttpError } from "./validation.js";

const windows = new Map();
const WINDOW_MS = 60_000;

function configuredOrigins() {
  return (process.env.ALLOWED_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean);
}

function isAllowedOrigin(req, origin) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const host = String(req.headers?.host || "").toLowerCase();
    if (host && parsed.host.toLowerCase() === host) return true;
    return configuredOrigins().includes(parsed.origin);
  } catch {
    return false;
  }
}

export function setSecurityHeaders(req, res) {
  const origin = req.headers?.origin;
  if (isAllowedOrigin(req, origin)) {
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export function enforceOrigin(req) {
  if (!isAllowedOrigin(req, req.headers?.origin)) throw new HttpError(403, "origin_not_allowed", "This request origin is not allowed.");
}

export function enforceMethod(req, allowed) {
  if (req.method === "OPTIONS") return;
  if (!allowed.includes(req.method)) throw new HttpError(405, "method_not_allowed", "This HTTP method is not supported.");
}

export function enforceRateLimit(req, { limit = 24, windowMs = WINDOW_MS } = {}) {
  const forwarded = String(req.headers?.["x-real-ip"] || req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = (forwarded || req.socket?.remoteAddress || "unknown").slice(0, 128);
  const route = String(req.url || "/").split(/[?#]/, 1)[0].slice(0, 256);
  const key = `${ip}:${route}`;
  const now = Date.now();
  let entry = windows.get(key);
  if (!entry || now - entry.startedAt >= windowMs) entry = { startedAt: now, count: 0 };
  entry.count += 1;
  windows.set(key, entry);
  if (windows.size > 5000) {
    for (const [key, value] of windows) if (now - value.startedAt >= windowMs) windows.delete(key);
    while (windows.size > 5000) windows.delete(windows.keys().next().value);
  }
  if (entry.count > limit) throw new HttpError(429, "rate_limited", "Too many requests. Wait a minute and try again.", { retryAfterSeconds: Math.ceil((entry.startedAt + windowMs - now) / 1000) });
}

export function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(payload));
}

export function errorPayload(error) {
  if (error instanceof HttpError) return { status: error.status, payload: { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } } };
  const status = Number(error?.status) || 500;
  if (status === 404) return { status: 404, payload: { error: { code: "not_found", message: "That GitHub account could not be found." } } };
  if (status === 403 || status === 429) return { status: 429, payload: { error: { code: "github_rate_limit", message: "GitHub's request limit was reached. Add a server-side GITHUB_TOKEN or try again later." } } };
  if (status === 401) return { status: 502, payload: { error: { code: "github_auth_config", message: "GitHub rejected server-side authentication. Check the deployment token configuration." } } };
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return { status: 504, payload: { error: { code: "upstream_timeout", message: "GitHub took too long to respond. Please retry." } } };
  return { status, payload: { error: { code: "request_failed", message: "The request could not be completed. Please try again." } } };
}

export function createHandler({ methods = ["POST"], rateLimit = 24, rateWindowMs = WINDOW_MS } = {}, action) {
  return async function handler(req, res) {
    setSecurityHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).end();
    try {
      enforceOrigin(req);
      enforceMethod(req, methods);
      enforceRateLimit(req, { limit: rateLimit, windowMs: rateWindowMs });
      const result = await action(req, res);
      if (result !== undefined && !res.writableEnded) json(res, 200, result);
    } catch (error) {
      const { status, payload } = errorPayload(error);
      if (status === 429 && payload.error.details?.retryAfterSeconds) res.setHeader("Retry-After", String(payload.error.details.retryAfterSeconds));
      if (!res.writableEnded) json(res, status, payload);
    }
  };
}
