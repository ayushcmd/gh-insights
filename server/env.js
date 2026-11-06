import { readFile } from "node:fs/promises";
import { join } from "node:path";

function decodeDoubleQuoted(value) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

export function parseEnvContent(source) {
  const values = new Map();
  const lines = String(source || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, name] = match;
    let value = match[2] || "";
    if (value.startsWith('"')) {
      const quoted = value.match(/^"((?:\\.|[^"\\])*)"\s*(?:#.*)?$/);
      if (quoted) value = decodeDoubleQuoted(quoted[1]);
    } else if (value.startsWith("'")) {
      const quoted = value.match(/^'([^']*)'\s*(?:#.*)?$/);
      if (quoted) value = quoted[1];
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values.set(name, value);
  }
  return values;
}

export async function loadLocalEnvironment(projectRoot) {
  const path = join(projectRoot, ".env.local");
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { found: false, loaded: 0 };
    throw new Error("Unable to read the local environment file.");
  }
  const values = parseEnvContent(content);
  let loaded = 0;
  for (const [name, value] of values) {
    if (process.env[name] === undefined) {
      process.env[name] = value;
      loaded += 1;
    }
  }
  return { found: true, loaded };
}
