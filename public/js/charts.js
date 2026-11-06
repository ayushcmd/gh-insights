const NS = "http://www.w3.org/2000/svg";
const COLORS = ["#58a6ff", "#56d4a4", "#d2a8ff", "#e8ba69", "#ff7b72", "#79c0ff", "#f778ba", "#a5d6ff"];

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

export function languageChart(container, items) {
  container.replaceChildren();
  const sorted = [...items].sort((a, b) => b.repositoryCount - a.repositoryCount);
  const visible = sorted.slice(0, 7);
  if (sorted.length > 7) visible.push({ name: "Other", repositoryCount: sorted.slice(7).reduce((sum, item) => sum + item.repositoryCount, 0) });
  const total = visible.reduce((sum, item) => sum + item.repositoryCount, 0);
  if (!total) {
    const empty = document.createElement("div");
    empty.className = "activity-empty";
    empty.textContent = "No primary-language metadata was returned for these repositories.";
    container.append(empty);
    return;
  }
  const svg = svgElement("svg", { viewBox: "0 0 220 220", class: "language-chart", role: "img", "aria-label": `Primary language distribution across ${total} repositories` });
  const title = svgElement("title");
  title.textContent = `Primary language distribution across ${total} repositories`;
  svg.append(title, svgElement("circle", { cx: 110, cy: 110, r: 76, class: "chart-track" }));
  const circumference = 2 * Math.PI * 76;
  let offset = 0;
  visible.forEach((item, index) => {
    const ratio = item.repositoryCount / total;
    const segment = svgElement("circle", {
      cx: 110, cy: 110, r: 76, class: "chart-segment",
      stroke: COLORS[index % COLORS.length],
      "stroke-dasharray": `${Math.max(.01, ratio * circumference)} ${circumference}`,
      "stroke-dashoffset": -offset
    });
    segment.setAttribute("aria-label", `${item.name}: ${item.repositoryCount} repositories`);
    svg.append(segment);
    offset += ratio * circumference;
  });
  const center = svgElement("text", { x: 110, y: 106, class: "chart-center-value" });
  center.textContent = String(total);
  const centerLabel = svgElement("text", { x: 110, y: 125, class: "chart-center-label" });
  centerLabel.textContent = "LANGUAGE TAGGED";
  svg.append(center, centerLabel);
  const legend = document.createElement("div");
  legend.className = "legend";
  visible.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "legend-item";
    const dot = document.createElement("span");
    dot.className = `legend-dot legend-dot-${index % COLORS.length}`;
    const name = document.createElement("span");
    name.className = "legend-name";
    name.textContent = item.name;
    const value = document.createElement("span");
    value.className = "legend-value";
    value.textContent = `${item.repositoryCount} · ${Math.round(item.repositoryCount / total * 100)}%`;
    row.append(dot, name, value);
    legend.append(row);
  });
  container.append(svg, legend);
}

export function activityChart(container, timeline) {
  container.replaceChildren();
  const points = [...timeline].slice(-35);
  if (!points.length) {
    const empty = document.createElement("div");
    empty.className = "activity-empty";
    empty.textContent = "No recent public events were returned. This is not evidence of inactivity.";
    container.append(empty);
    return;
  }
  const svg = svgElement("svg", { viewBox: "0 0 500 100", class: "activity-chart", role: "img", "aria-label": `Public events on ${points.length} observed dates` });
  svg.append(svgElement("line", { x1: 0, y1: 89, x2: 500, y2: 89, class: "activity-axis" }));
  const max = Math.max(1, ...points.map((point) => point.count));
  const dayMs = 86_400_000;
  const start = Date.parse(points[0].date);
  const end = Date.parse(points.at(-1).date);
  const spanDays = Math.max(1, Math.floor((end - start) / dayMs) + 1);
  const slot = 500 / spanDays;
  const barWidth = Math.max(2, Math.min(12, slot * .62));
  points.forEach((point) => {
    const height = Math.max(2, (point.count / max) * 73);
    const dayIndex = Math.max(0, Math.floor((Date.parse(point.date) - start) / dayMs));
    const x = Math.min(500 - barWidth, dayIndex * slot + (slot - barWidth) / 2);
    const bar = svgElement("rect", { x, y: 88 - height, width: barWidth, height, class: "activity-bar" });
    const title = svgElement("title");
    title.textContent = `${point.date}: ${point.count} public event${point.count === 1 ? "" : "s"}`;
    bar.append(title);
    svg.append(bar);
  });
  container.append(svg);
}

export function downloadLanguageChart(container) {
  const svg = container.querySelector("svg.language-chart");
  if (!svg) return;
  const copy = svg.cloneNode(true);
  const style = svgElement("style");
  style.textContent = ".chart-track{fill:none;stroke:#dce2e9;stroke-width:28}.chart-segment{fill:none;stroke-width:28;transform:rotate(-90deg);transform-origin:110px 110px}.chart-center-value{fill:#172233;font:700 26px sans-serif;text-anchor:middle}.chart-center-label{fill:#64748b;font:9px monospace;text-anchor:middle;letter-spacing:.08em}";
  copy.insertBefore(style, copy.firstChild);
  const blob = new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "gh-insights-language-distribution.svg";
  link.click();
  URL.revokeObjectURL(url);
}
