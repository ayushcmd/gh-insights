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

export function monthlyActivityBarChart(container, items) {
  container.replaceChildren();
  const months = Array.isArray(items) ? items : [];
  const total = months.reduce((sum, m) => sum + (m.total || 0), 0);
  if (!months.length || !total) {
    const empty = document.createElement("div");
    empty.className = "activity-empty";
    empty.textContent = "No contribution activity was recorded for the selected time range.";
    container.append(empty);
    return;
  }

  const max = Math.max(1, ...months.map((m) => m.total || 0));
  const svg = svgElement("svg", {
    viewBox: "0 0 600 180",
    class: "activity-tracker-chart",
    role: "img",
    "aria-label": `Monthly activity across ${months.length} months with ${total} total contributions`
  });

  // Base axis line
  svg.append(svgElement("line", { x1: 20, y1: 145, x2: 580, y2: 145, class: "activity-axis" }));

  const slotWidth = 540 / months.length;
  const barWidth = Math.max(6, Math.min(28, slotWidth * 0.65));
  const chartHeight = 115;

  months.forEach((m, idx) => {
    const x = 30 + idx * slotWidth + (slotWidth - barWidth) / 2;
    const group = svgElement("g", { class: "activity-month-group" });
    const gTitle = svgElement("title");
    gTitle.textContent = `${m.label || m.month}: ${m.total} total (${m.commits || 0} commits, ${m.issues || 0} issues, ${m.reviews || 0} reviews, ${m.mergedPRs || 0} merged PRs)`;
    group.append(gTitle);

    let currentY = 144;
    const segments = [
      { count: m.commits || 0, color: "#58a6ff", class: "bar-commits" },
      { count: m.issues || 0, color: "#e8ba69", class: "bar-issues" },
      { count: m.reviews || 0, color: "#d2a8ff", class: "bar-reviews" },
      { count: m.mergedPRs || 0, color: "#56d4a4", class: "bar-merged-prs" }
    ];

    segments.forEach((seg) => {
      if (!seg.count) return;
      const h = Math.max(2, (seg.count / max) * chartHeight);
      currentY -= h;
      const rect = svgElement("rect", {
        x,
        y: currentY,
        width: barWidth,
        height: h,
        fill: seg.color,
        rx: 1.5,
        class: `bar-segment ${seg.class}`
      });
      group.append(rect);
    });

    // Month label
    if (months.length <= 16 || idx % 2 === 0) {
      const text = svgElement("text", {
        x: x + barWidth / 2,
        y: 162,
        class: "chart-axis-label",
        "text-anchor": "middle"
      });
      const shortLabel = (m.label || m.month).split(" ")[0];
      text.textContent = shortLabel;
      group.append(text);
    }

    svg.append(group);
  });

  // Chart Legend
  const legend = document.createElement("div");
  legend.className = "tracker-chart-legend";
  const legendItems = [
    { label: "Commits", color: "#58a6ff" },
    { label: "Issues", color: "#e8ba69" },
    { label: "Reviews", color: "#d2a8ff" },
    { label: "Merged PRs", color: "#56d4a4" }
  ];
  legendItems.forEach((item) => {
    const itemEl = document.createElement("span");
    itemEl.className = "tracker-legend-item";
    const dot = document.createElement("span");
    dot.className = "tracker-legend-dot";
    dot.style.backgroundColor = item.color;
    const txt = document.createElement("span");
    txt.textContent = item.label;
    itemEl.append(dot, txt);
    legend.append(itemEl);
  });

  container.append(svg, legend);
}

export function contributionTrendLineChart(container, trend) {
  container.replaceChildren();
  const items = Array.isArray(trend) ? trend : [];
  const max = Math.max(1, ...items.map((i) => i.cumulative || i.count || 0));
  if (!items.length || max <= 1) {
    const empty = document.createElement("div");
    empty.className = "activity-empty";
    empty.textContent = "No trajectory trend data was available for this period.";
    container.append(empty);
    return;
  }

  const svg = svgElement("svg", {
    viewBox: "0 0 600 160",
    class: "activity-trend-chart",
    role: "img",
    "aria-label": "Cumulative contribution trend over time"
  });

  // Defs for gradient
  const defs = svgElement("defs");
  const grad = svgElement("linearGradient", { id: "trend-area-grad", x1: 0, y1: 0, x2: 0, y2: 1 });
  const stop1 = svgElement("stop", { offset: "0%", "stop-color": "#58a6ff", "stop-opacity": "0.38" });
  const stop2 = svgElement("stop", { offset: "100%", "stop-color": "#58a6ff", "stop-opacity": "0.02" });
  grad.append(stop1, stop2);
  defs.append(grad);
  svg.append(defs);

  // Baseline
  svg.append(svgElement("line", { x1: 20, y1: 135, x2: 580, y2: 135, class: "activity-axis" }));

  const paddingLeft = 35;
  const paddingRight = 35;
  const usableWidth = 600 - paddingLeft - paddingRight;
  const usableHeight = 105;
  const baseY = 135;

  const points = items.map((item, index) => {
    const x = paddingLeft + (items.length > 1 ? (index / (items.length - 1)) * usableWidth : usableWidth / 2);
    const val = item.cumulative || item.count || 0;
    const y = baseY - (val / max) * usableHeight;
    return { x, y, val, label: item.label || item.date };
  });

  // Construct path
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L ${points.at(-1).x.toFixed(1)} ${baseY} L ${points[0].x.toFixed(1)} ${baseY} Z`;

  svg.append(svgElement("path", { d: areaD, fill: "url(#trend-area-grad)" }));
  svg.append(svgElement("path", { d: pathD, fill: "none", stroke: "#58a6ff", "stroke-width": "2.5", "stroke-linecap": "round", "stroke-linejoin": "round" }));

  // Draw points
  points.forEach((p, idx) => {
    const circle = svgElement("circle", { cx: p.x, cy: p.y, r: 3.5, fill: "#58a6ff", stroke: "var(--card)", "stroke-width": 1.5, class: "trend-dot" });
    const cTitle = svgElement("title");
    cTitle.textContent = `${p.label}: ${p.val} cumulative contributions`;
    circle.append(cTitle);
    svg.append(circle);

    if (items.length <= 12 || idx === 0 || idx === items.length - 1 || idx % 2 === 0) {
      const text = svgElement("text", { x: p.x, y: 152, class: "chart-axis-label", "text-anchor": "middle" });
      text.textContent = (p.label || "").split(" ")[0];
      svg.append(text);
    }
  });

  container.append(svg);
}

export function contributionDistributionChart(container, distribution) {
  container.replaceChildren();
  const items = Array.isArray(distribution) ? distribution : [];
  const total = items.reduce((sum, i) => sum + (i.count || 0), 0);

  if (!items.length || !total) {
    const empty = document.createElement("div");
    empty.className = "activity-empty";
    empty.textContent = "No contribution activity distribution to show.";
    container.append(empty);
    return;
  }

  const svg = svgElement("svg", {
    viewBox: "0 0 220 220",
    class: "language-chart distribution-chart",
    role: "img",
    "aria-label": `Contribution distribution across ${total} total contributions`
  });

  const title = svgElement("title");
  title.textContent = `Contribution distribution across ${total} total contributions`;
  svg.append(title, svgElement("circle", { cx: 110, cy: 110, r: 76, class: "chart-track" }));

  const circumference = 2 * Math.PI * 76;
  let offset = 0;

  items.forEach((item) => {
    const ratio = item.count / total;
    if (ratio <= 0) return;
    const segment = svgElement("circle", {
      cx: 110,
      cy: 110,
      r: 76,
      class: "chart-segment",
      stroke: item.color || "#58a6ff",
      "stroke-dasharray": `${Math.max(0.1, ratio * circumference)} ${circumference}`,
      "stroke-dashoffset": -offset
    });
    segment.setAttribute("aria-label", `${item.type}: ${item.count} (${Math.round(ratio * 100)}%)`);
    svg.append(segment);
    offset += ratio * circumference;
  });

  const center = svgElement("text", { x: 110, y: 106, class: "chart-center-value" });
  center.textContent = String(total);
  const centerLabel = svgElement("text", { x: 110, y: 125, class: "chart-center-label" });
  centerLabel.textContent = "CONTRIBUTIONS";
  svg.append(center, centerLabel);

  const legend = document.createElement("div");
  legend.className = "legend";
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "legend-item";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.backgroundColor = item.color || "#58a6ff";
    const name = document.createElement("span");
    name.className = "legend-name";
    name.textContent = item.type;
    const value = document.createElement("span");
    value.className = "legend-value";
    const pct = total ? Math.round((item.count / total) * 100) : 0;
    value.textContent = `${item.count} · ${pct}%`;
    row.append(dot, name, value);
    legend.append(row);
  });

  const wrap = document.createElement("div");
  wrap.className = "chart-layout";
  wrap.append(svg, legend);
  container.append(wrap);
}

export function repositoryBreakdownChart(container, repositories) {
  container.replaceChildren();
  const repos = (Array.isArray(repositories) ? repositories : []).slice(0, 8);
  if (!repos.length) {
    const empty = document.createElement("div");
    empty.className = "activity-empty";
    empty.textContent = "No repository-specific contributions were recorded.";
    container.append(empty);
    return;
  }

  const max = Math.max(1, ...repos.map((r) => r.total || r.count || 0));
  const list = document.createElement("div");
  list.className = "repo-breakdown-list";

  repos.forEach((repo) => {
    const row = document.createElement("div");
    row.className = "repo-breakdown-row";

    const top = document.createElement("div");
    top.className = "repo-breakdown-header";

    const nameLink = document.createElement("a");
    nameLink.className = "repo-breakdown-name";
    nameLink.href = repo.url || `https://github.com/${repo.name}`;
    nameLink.target = "_blank";
    nameLink.rel = "noopener noreferrer";
    nameLink.textContent = repo.name;

    const count = document.createElement("span");
    count.className = "repo-breakdown-count";
    count.textContent = `${repo.total || repo.count} contributions`;

    top.append(nameLink, count);

    const barBg = document.createElement("div");
    barBg.className = "repo-breakdown-bar-bg";

    const totalVal = repo.total || repo.count || 0;
    const pct = Math.min(100, Math.max(2, (totalVal / max) * 100));

    const bar = document.createElement("div");
    bar.className = "repo-breakdown-bar";
    bar.style.width = `${pct}%`;

    // Segmented bar if breakdown is available
    if (repo.commits || repo.issues || repo.reviews || repo.mergedPRs) {
      if (repo.commits) {
        const seg = document.createElement("span");
        seg.style.width = `${(repo.commits / totalVal) * 100}%`;
        seg.style.backgroundColor = "#58a6ff";
        bar.append(seg);
      }
      if (repo.issues) {
        const seg = document.createElement("span");
        seg.style.width = `${(repo.issues / totalVal) * 100}%`;
        seg.style.backgroundColor = "#e8ba69";
        bar.append(seg);
      }
      if (repo.reviews) {
        const seg = document.createElement("span");
        seg.style.width = `${(repo.reviews / totalVal) * 100}%`;
        seg.style.backgroundColor = "#d2a8ff";
        bar.append(seg);
      }
      if (repo.mergedPRs) {
        const seg = document.createElement("span");
        seg.style.width = `${(repo.mergedPRs / totalVal) * 100}%`;
        seg.style.backgroundColor = "#56d4a4";
        bar.append(seg);
      }
    }

    barBg.append(bar);
    row.append(top, barBg);
    list.append(row);
  });

  container.append(list);
}
