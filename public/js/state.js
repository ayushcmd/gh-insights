const HISTORY_KEY = "gh-insights.recent.v1";
const THEME_KEY = "gh-insights.theme.v1";

function read(key, fallback) {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

export const state = {
  mode: "insights",
  activeUsername: "",
  lastComparison: null,
  getHistory() {
    const value = read(HISTORY_KEY, []);
    return Array.isArray(value) ? value.filter((name) => typeof name === "string").slice(0, 6) : [];
  },
  addHistory(username) {
    const next = [username, ...this.getHistory().filter((entry) => entry.toLowerCase() !== username.toLowerCase())].slice(0, 6);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
    return next;
  },
  clearHistory() { try { localStorage.removeItem(HISTORY_KEY); } catch {} },
  getTheme() { return read(THEME_KEY, null); },
  setTheme(theme) { try { localStorage.setItem(THEME_KEY, JSON.stringify(theme)); } catch {} }
};
