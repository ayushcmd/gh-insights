const REQUEST_TIMEOUT_MS = 25_000;

export function validUsername(value) {
  const username = String(value || "").trim();
  return username.length <= 39 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(username) && !username.includes("--");
}

export async function apiRequest(path, payload, { method = "POST", timeoutMs = REQUEST_TIMEOUT_MS, timeoutMessage = "GitHub is taking longer than expected. Please try again." } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method,
      headers: method === "POST" ? { "Content-Type": "application/json" } : {},
      body: method === "POST" ? JSON.stringify(payload || {}) : undefined,
      signal: controller.signal,
      credentials: "same-origin"
    });
    let data;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) {
      const error = new Error(data?.error?.message || "The request could not be completed.");
      error.code = data?.error?.code || "request_failed";
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error(timeoutMessage);
    if (error instanceof TypeError) throw new Error("Could not reach GH-Insights. Check your connection and retry.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function formatDate(value, options = { year: "numeric", month: "short", day: "numeric" }) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : new Intl.DateTimeFormat(undefined, options).format(date);
}

export function compactNumber(value) {
  const n = Number(value) || 0;
  return new Intl.NumberFormat(undefined, { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
}

export function safeGithubUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.href : "https://github.com";
  } catch { return "https://github.com"; }
}
