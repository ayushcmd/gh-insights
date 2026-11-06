export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function normalizeUsername(value) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_username", "Enter a GitHub username.");
  const username = value.trim();
  if (!username) throw new HttpError(400, "invalid_username", "Enter a GitHub username.");
  if (username.length > 39 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(username) || username.includes("--")) {
    throw new HttpError(400, "invalid_username", "Use a valid GitHub username with up to 39 letters, numbers, or single hyphens.");
  }
  return username;
}

export function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { throw new HttpError(400, "invalid_json", "Request body must be valid JSON."); }
  }
  return {};
}

export function requestUsername(req, body = readJsonBody(req)) {
  const value = req.method === "GET" ? req.query?.username : body.username;
  return normalizeUsername(value);
}

export function requestLimit(req, fallback = 5) {
  const raw = req.method === "GET" ? req.query?.limit : readJsonBody(req).limit;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? Math.min(20, Math.max(1, parsed)) : fallback;
}
