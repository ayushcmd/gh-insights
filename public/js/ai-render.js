const MAX_MARKDOWN_LENGTH = 12_000;

function safeRepositoryHref(value, allowedLinks) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) return null;
    const canonical = `https://github.com/${parts.map(encodeURIComponent).join("/")}`;
    return allowedLinks.has(canonical) ? canonical : null;
  } catch {
    return null;
  }
}

function safeRepositoryLinkSet(values) {
  return new Set(values.map((value) => {
    try {
      const url = new URL(String(value));
      if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash) return null;
      const parts = url.pathname.split("/").filter(Boolean);
      return parts.length === 2 ? `https://github.com/${parts.map(encodeURIComponent).join("/")}` : null;
    } catch { return null; }
  }).filter(Boolean));
}

function closingMarker(source, marker, start) {
  const index = source.indexOf(marker, start);
  if (index < 0 || index === start) return -1;
  if ((marker === "*" || marker === "_") && /\s/.test(source[index - 1] || "")) return -1;
  if (marker === "_" && /[\p{L}\p{N}]/u.test(source[index - 1] || "") && /[\p{L}\p{N}]/u.test(source[index + 1] || "")) return -1;
  return index;
}

function parseInline(value, allowedLinks) {
  const source = String(value || "").slice(0, MAX_MARKDOWN_LENGTH);
  const nodes = [];
  let buffer = "";
  const flush = () => {
    if (buffer) nodes.push({ type: "text", value: buffer });
    buffer = "";
  };
  const addNested = (type, content) => {
    flush();
    nodes.push({ type, children: parseInline(content, allowedLinks) });
  };

  for (let index = 0; index < source.length;) {
    const rest = source.slice(index);
    const image = rest.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (image) {
      buffer += image[1];
      index += image[0].length;
      continue;
    }
    const link = rest.match(/^\[([^\]]+)\]\((https:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/);
    if (link) {
      const href = safeRepositoryHref(link[2], allowedLinks);
      if (href) {
        flush();
        nodes.push({ type: "link", href, children: parseInline(link[1], allowedLinks) });
      } else {
        flush();
        nodes.push(...parseInline(link[1], allowedLinks));
      }
      index += link[0].length;
      continue;
    }
    const rawUrl = rest.match(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/);
    if (rawUrl) {
      const href = safeRepositoryHref(rawUrl[0], allowedLinks);
      if (href) {
        flush();
        nodes.push({ type: "link", href, children: [{ type: "text", value: rawUrl[0] }] });
      } else buffer += rawUrl[0];
      index += rawUrl[0].length;
      continue;
    }
    const htmlTag = rest.match(/^<\/?[A-Za-z][^>]*>/);
    if (htmlTag) {
      index += htmlTag[0].length;
      continue;
    }

    const marker = rest.startsWith("**") ? "**" : rest.startsWith("__") ? "__" : rest.startsWith("`") ? "`" : rest.startsWith("*") ? "*" : rest.startsWith("_") ? "_" : null;
    if (marker) {
      const end = closingMarker(source, marker, index + marker.length);
      if (end >= 0) {
        addNested(marker === "`" ? "code" : marker.length === 2 ? "strong" : "emphasis", source.slice(index + marker.length, end));
        index = end + marker.length;
      } else if (marker === "**" || marker === "__" || marker === "`") {
        index += marker.length;
      } else if (marker === "*") {
        index += 1;
      } else if (marker === "_" && (index === 0 || /\s/.test(source[index - 1]) || index === source.length - 1)) {
        index += 1;
      } else {
        buffer += marker;
        index += marker.length;
      }
      continue;
    }
    if (source[index] === "[" || source[index] === "]") {
      index += 1;
      continue;
    }
    buffer += source[index];
    index += 1;
  }
  flush();
  return nodes;
}

function isRule(line) {
  return /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);
}

function blockKind(line) {
  if (/^\s{0,3}#{1,6}\s+/.test(line) || /^\s{0,3}#{1,6}$/.test(line)) return "heading";
  if (isRule(line)) return "rule";
  if (/^\s{0,3}[-+*]\s+/.test(line)) return "unordered";
  if (/^\s{0,3}\d+[.)]\s+/.test(line)) return "ordered";
  if (/^\s{0,3}```/.test(line)) return "fence";
  return null;
}

function parseMarkdownInternal(markdown, { allowedLinks = [] } = {}) {
  const source = String(markdown || "").slice(0, MAX_MARKDOWN_LENGTH).replace(/\r\n?/g, "\n");
  const allowed = new Set(allowedLinks.map((link) => {
    try {
      const url = new URL(String(link));
      if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash) return null;
      const parts = url.pathname.split("/").filter(Boolean);
      return parts.length === 2 ? `https://github.com/${parts.map(encodeURIComponent).join("/")}` : null;
    } catch { return null; }
  }).filter(Boolean));
  const lines = source.split("\n");
  const blocks = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const fence = line.match(/^\s{0,3}```\s*([\w+-]*)\s*$/);
    if (fence) {
      index += 1;
      const code = [];
      while (index < lines.length && !/^\s{0,3}```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ type: "codeBlock", value: code.join("\n") });
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s*(.*?)\s*#*\s*$/);
    if (heading) {
      if (heading[2].trim()) blocks.push({ type: "heading", level: Math.min(4, Math.max(2, heading[1].length)), children: parseInline(heading[2], allowed) });
      index += 1;
      continue;
    }
    if (isRule(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }
    const list = line.match(/^\s{0,3}([-+*]|\d+[.)])\s+(.*)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]);
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s{0,3}([-+*]|\d+[.)])\s+(.*)$/);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push({ type: "listItem", children: parseInline(item[2], allowed) });
        index += 1;
      }
      blocks.push({ type: ordered ? "orderedList" : "unorderedList", items });
      continue;
    }

    const firstLine = line.replace(/^\s{0,3}#{1,6}(?!\s)/, "").replace(/^\s{0,3}>\s?/, "");
    const paragraph = [firstLine];
    index += 1;
    while (index < lines.length && lines[index].trim() && !blockKind(lines[index])) paragraph.push(lines[index++]);
    const children = parseInline(paragraph.join(" "), allowed);
    if (children.length) blocks.push({ type: "paragraph", children });
  }
  return blocks;
}

export function parseMarkdown(markdown, options = {}) {
  try { return parseMarkdownInternal(markdown, options); }
  catch {
    const fallback = markdownFallbackText(markdown);
    return fallback ? [{ type: "paragraph", children: [{ type: "text", value: fallback }] }] : [];
  }
}

function element(tag, className = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function appendInline(parent, nodes) {
  for (const node of nodes) {
    if (node.type === "text") parent.append(document.createTextNode(node.value));
    else if (node.type === "link") {
      const anchor = element("a", "ai-markdown-link");
      anchor.href = node.href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      appendInline(anchor, node.children);
      parent.append(anchor);
    } else {
      const tag = node.type === "strong" ? "strong" : node.type === "emphasis" ? "em" : "code";
      const child = element(tag, node.type === "code" ? "ai-inline-code" : "");
      appendInline(child, node.children);
      parent.append(child);
    }
  }
}

export function renderMarkdown(parent, markdown, options = {}) {
  const nodes = parseMarkdown(markdown, options);
  for (const block of nodes) {
    if (block.type === "rule") { parent.append(element("hr", "ai-markdown-rule")); continue; }
    if (block.type === "codeBlock") {
      const pre = element("pre", "ai-code-block");
      const code = element("code");
      code.textContent = block.value;
      pre.append(code);
      parent.append(pre);
      continue;
    }
    if (block.type === "unorderedList" || block.type === "orderedList") {
      const list = element(block.type === "unorderedList" ? "ul" : "ol", "ai-markdown-list");
      for (const item of block.items) {
        const li = element("li");
        appendInline(li, item.children);
        list.append(li);
      }
      parent.append(list);
      continue;
    }
    const node = block.type === "heading" ? element(`h${block.level}`, "ai-markdown-heading") : element("p", "ai-markdown-paragraph");
    appendInline(node, block.children);
    parent.append(node);
  }
  if (!nodes.length) {
    const fallback = markdownFallbackText(markdown);
    if (fallback) parent.append(element("p", "ai-markdown-paragraph"));
    if (fallback) parent.lastChild.textContent = fallback;
  }
}

export function markdownFallbackText(markdown) {
  return String(markdown || "").replace(/[*_`#>]+/g, " ").replace(/\s+/g, " ").trim();
}

const iconPaths = {
  sparkle: "M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3zm6 11l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14z",
  pattern: "M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v5H4zM14 15h6v5h-6zM10 8h4M7 11v4m10-4v4",
  technology: "M8 5L3 12l5 7M16 5l5 7-5 7M14 3l-4 18",
  repository: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
  growth: "M4 18l5-5 3 3 8-9M14 7h6v6",
  limitation: "M12 3l9 17H3L12 3zm0 6v5m0 3h.01"
};

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", iconPaths[name] || iconPaths.sparkle);
  svg.append(shape);
  return svg;
}

function iconHeading(title, iconName) {
  const heading = element("div", "ai-section-heading");
  const mark = element("span", "ai-icon");
  mark.append(icon(iconName));
  const label = element("h4", "");
  label.textContent = title;
  heading.append(mark, label);
  return heading;
}

function renderPills(container, values, className = "ai-chip", allowedLinks = new Set()) {
  for (const value of values) {
    const pill = element("span", className);
    appendInline(pill, parseInline(String(value), allowedLinks));
    container.append(pill);
  }
}

function safeStructuredRepository(repo, allowedLinks) {
  const href = safeRepositoryHref(repo?.url, allowedLinks);
  return href ? { ...repo, href } : null;
}

function renderStructured(container, value, allowedLinks) {
  const root = element("div", "ai-structured");
  const overview = element("section", "ai-overview");
  const overviewHeading = iconHeading("Developer Overview", "sparkle");
  const overviewText = element("p", "ai-overview-copy");
  appendInline(overviewText, parseInline(value.overview, allowedLinks));
  overview.append(overviewHeading, overviewText);
  if (value.keySignals?.length) {
    const signalLabel = element("p", "ai-sub-label");
    signalLabel.textContent = "Signals cited by Gemini";
    const signals = element("div", "ai-key-signals");
    renderPills(signals, value.keySignals, "ai-signal-chip", allowedLinks);
    overview.append(signalLabel, signals);
  }
  root.append(overview);

  const note = element("p", "ai-interpretation-note");
  note.textContent = "Measured GitHub statistics remain in the dashboard above. These cards are Gemini’s interpretation of public signals, not measured scores or skill levels.";
  root.append(note);

  if (value.strengths?.length) {
    const section = element("section", "ai-content-section");
    section.append(iconHeading("Observed Strengths", "sparkle"));
    const grid = element("div", "ai-card-grid");
    for (const item of value.strengths) {
      const card = element("article", "ai-insight-card ai-strength-card");
      const title = element("h5", "ai-card-title");
      appendInline(title, parseInline(item.title, allowedLinks));
      const copy = element("p", "ai-card-copy");
      appendInline(copy, parseInline(item.explanation, allowedLinks));
      card.append(icon("sparkle"), title, copy);
      grid.append(card);
    }
    section.append(grid);
    root.append(section);
  }

  if (value.projectPatterns?.length) {
    const section = element("section", "ai-content-section");
    section.append(iconHeading("Project Patterns", "pattern"));
    const grid = element("div", "ai-card-grid");
    for (const item of value.projectPatterns) {
      const card = element("article", "ai-insight-card ai-pattern-card");
      const title = element("h5", "ai-card-title");
      appendInline(title, parseInline(item.title, allowedLinks));
      const copy = element("p", "ai-card-copy");
      appendInline(copy, parseInline(item.explanation, allowedLinks));
      card.append(icon("pattern"), title, copy);
      const references = (item.repositories || []).map((repo) => safeStructuredRepository(repo, allowedLinks)).filter(Boolean);
      if (references.length) {
        const refList = element("div", "ai-repo-references");
        for (const repo of references) {
          const link = element("a", "ai-reference-link");
          link.href = repo.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = repo.fullName;
          refList.append(link);
        }
        card.append(refList);
      }
      grid.append(card);
    }
    section.append(grid);
    root.append(section);
  }

  const preferences = value.technologyPreferences || {};
  const techGroups = [["Languages", preferences.languages], ["Frameworks", preferences.frameworks], ["Tools", preferences.tools]].filter(([, values]) => values?.length);
  if (techGroups.length) {
    const section = element("section", "ai-content-section");
    section.append(iconHeading("Technology Preferences", "technology"));
    const groups = element("div", "ai-tech-groups");
    for (const [label, values] of techGroups) {
      const group = element("div", "ai-tech-group");
      const groupLabel = element("span", "ai-sub-label");
      groupLabel.textContent = label;
      const chips = element("div", "ai-chip-list");
      renderPills(chips, values, "ai-chip", allowedLinks);
      group.append(groupLabel, chips);
      groups.append(group);
    }
    section.append(groups);
    root.append(section);
  }

  if (value.notableRepositories?.length) {
    const section = element("section", "ai-content-section");
    section.append(iconHeading("Notable Repositories", "repository"));
    const grid = element("div", "ai-repository-grid");
    for (const item of value.notableRepositories) {
      const repo = safeStructuredRepository(item, allowedLinks);
      if (!repo) continue;
      const card = element("article", "ai-repository-card");
      const title = element("a", "ai-repository-name");
      title.href = repo.href;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
      title.textContent = repo.fullName;
      const description = element("p", "ai-card-copy");
      appendInline(description, parseInline(repo.description || item.rationale || "Public repository", allowedLinks));
      card.append(icon("repository"), title, description);
      if (repo.language) {
        const language = element("span", "ai-language-badge");
        language.textContent = repo.language;
        card.append(language);
      }
      grid.append(card);
    }
    if (grid.childNodes.length) {
      section.append(grid);
      root.append(section);
    }
  }

  if (value.growthAreas?.length) {
    const section = element("section", "ai-content-section");
    section.append(iconHeading("Growth Opportunities", "growth"));
    const grid = element("div", "ai-card-grid");
    for (const item of value.growthAreas) {
      const card = element("article", "ai-insight-card ai-growth-card");
      card.append(icon("growth"));
      const title = element("h5", "ai-card-title");
      appendInline(title, parseInline(item.title, allowedLinks));
      const copy = element("p", "ai-card-copy");
      appendInline(copy, parseInline(item.recommendation, allowedLinks));
      card.append(title, copy);
      grid.append(card);
    }
    section.append(grid);
    root.append(section);
  }

  const limitations = element("details", "ai-limitations");
  const summary = element("summary");
  summary.append(icon("limitation"));
  const summaryText = element("span");
  summaryText.textContent = "Methodology and limitations";
  summary.append(summaryText);
  limitations.append(summary);
  const measured = element("p", "ai-measured-note");
  measured.textContent = "GitHub profile fields, repository counts, primary languages, and public events are measured from the fetched public API data. The overview and recommendations above are generated interpretations and may be incomplete.";
  limitations.append(measured);
  if (value.limitations?.length) {
    const list = element("ul", "ai-limitations-list");
    for (const item of value.limitations) {
      const row = element("li");
      appendInline(row, parseInline(item, allowedLinks));
      list.append(row);
    }
    limitations.append(list);
  }
  root.append(limitations);
  container.append(root);
}

export function renderAiOutput(container, result) {
  container.replaceChildren();
  const allowedLinkValues = Array.isArray(result?.repositoryLinks) ? result.repositoryLinks : [];
  const allowedLinks = safeRepositoryLinkSet(allowedLinkValues);
  if (result?.structured && typeof result.structured === "object") {
    try {
      renderStructured(container, result.structured, allowedLinks);
      return;
    } catch {
      container.replaceChildren();
    }
  }
  const markdown = element("div", "ai-markdown");
  const readableText = result?.text || result?.message || "Gemini returned no readable response.";
  try { renderMarkdown(markdown, readableText, { allowedLinks: allowedLinkValues }); }
  catch {
    const paragraph = element("p", "ai-markdown-paragraph");
    paragraph.textContent = markdownFallbackText(readableText);
    markdown.append(paragraph);
  }
  container.append(markdown);
}
