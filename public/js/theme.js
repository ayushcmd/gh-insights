import { state } from "./state.js";

const root = document.documentElement;
const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)");

export function applyTheme(theme, persist = true) {
  const selected = theme === "light" || theme === "dark" ? theme : (systemDark?.matches ? "dark" : "light");
  root.dataset.theme = selected;
  document.querySelector("#theme-toggle")?.setAttribute("aria-label", `Switch to ${selected === "dark" ? "light" : "dark"} theme`);
  if (persist) state.setTheme(selected);
}

export function initializeTheme() {
  const stored = state.getTheme();
  applyTheme(stored || "light", false);
  document.querySelector("#theme-toggle")?.addEventListener("click", () => applyTheme(root.dataset.theme === "dark" ? "light" : "dark"));
  systemDark?.addEventListener?.("change", (event) => { if (!state.getTheme()) applyTheme(event.matches ? "dark" : "light", false); });
}
