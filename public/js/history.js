import { state } from "./state.js";
import { validUsername } from "./api.js";

export function renderHistory(onSelect) {
  const row = document.querySelector("#recent-row");
  const list = document.querySelector("#recent-list");
  list.replaceChildren();
  const history = state.getHistory().filter(validUsername);
  row.hidden = history.length === 0;
  for (const username of history) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-chip";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const mark = document.createElementNS("http://www.w3.org/2000/svg", "path");
    mark.setAttribute("d", "M12 .8a11.2 11.2 0 0 0-3.54 21.82c.56.1.77-.24.77-.54v-2.08c-3.13.68-3.79-1.33-3.79-1.33-.5-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.73 1.16 1.73 1.16 1 .1.75 1.8 2.98 1.38.1-.73.4-1.23.72-1.52-2.5-.28-5.13-1.25-5.13-5.58 0-1.24.44-2.25 1.16-3.05-.12-.29-.5-1.45.11-3.02 0 0 .95-.3 3.08 1.16a10.7 10.7 0 0 1 5.6 0c2.14-1.45 3.08-1.16 3.08-1.16.61 1.57.23 2.73.11 3.02.72.8 1.16 1.81 1.16 3.05 0 4.34-2.63 5.3-5.14 5.58.4.35.76 1.04.76 2.1v3.11c0 .3.2.65.77.54A11.2 11.2 0 0 0 12 .8Z");
    icon.append(mark);
    const label = document.createElement("span");
    label.textContent = username;
    button.append(icon, label);
    button.addEventListener("click", () => onSelect(username));
    list.append(button);
  }
}
