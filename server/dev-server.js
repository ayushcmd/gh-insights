import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { errorPayload, json, setSecurityHeaders } from "../lib/security.js";
import { HttpError } from "../lib/validation.js";
import { loadLocalEnvironment } from "./env.js";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BODY_LIMIT_BYTES = 64 * 1024;
const API_PREFIX = "/api/";
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"]
]);

const STATIC_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://avatars.githubusercontent.com; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://github.com"
};

export async function loadApiRoutes(apiDirectory = join(PROJECT_ROOT, "api")) {
  const projectRoot = resolve(apiDirectory, "..");
  const registryUrl = pathToFileURL(join(projectRoot, "lib", "api-routes.js")).href;
  const registry = await import(registryUrl);
  if (!(registry.API_ROUTE_HANDLERS instanceof Map)) throw new Error("API route registry is not available.");

  const routes = new Map();
  for (const [routePath, handler] of registry.API_ROUTE_HANDLERS) {
    if (!routePath.startsWith(API_PREFIX) || typeof handler !== "function") {
      throw new Error(`Invalid API route registry entry: ${routePath}`);
    }
    routes.set(routePath, handler);
    routes.set(`${routePath}.js`, handler);
  }
  return routes;
}

function makeVercelRequest(incoming, url) {
  const query = {};
  for (const name of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(name);
    query[name] = values.length > 1 ? values : values[0];
  }
  return {
    method: incoming.method,
    url: incoming.url,
    headers: incoming.headers,
    query,
    socket: incoming.socket,
    body: undefined
  };
}

function makeVercelResponse(outgoing) {
  const response = {
    get writableEnded() { return outgoing.writableEnded; },
    status(code) { outgoing.statusCode = code; return response; },
    setHeader(name, value) { outgoing.setHeader(name, value); return response; },
    send(value) { outgoing.end(value); return response; },
    json(value) {
      if (!outgoing.hasHeader("Content-Type")) outgoing.setHeader("Content-Type", "application/json; charset=utf-8");
      outgoing.end(JSON.stringify(value));
      return response;
    },
    end(value) { outgoing.end(value); return response; }
  };
  return response;
}

async function readJsonBody(incoming) {
  const contentType = String(incoming.headers["content-type"] || "").toLowerCase();
  if (contentType && !contentType.includes("application/json")) {
    throw new HttpError(415, "unsupported_content_type", "Send request data as application/json.");
  }
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of incoming) {
    size += chunk.length;
    if (size > BODY_LIMIT_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    if (!tooLarge) chunks.push(chunk);
  }
  if (tooLarge) throw new HttpError(413, "payload_too_large", "Request body exceeds the local server limit.");
  if (!size) return {};
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object.");
  }
  return value;
}

function sendLocalError(error, response) {
  const { status, payload } = errorPayload(error);
  if (status === 429 && payload.error.details?.retryAfterSeconds) {
    response.setHeader("Retry-After", String(payload.error.details.retryAfterSeconds));
  }
  if (!response.writableEnded) json(response, status, payload);
}

function isWithin(root, path) {
  return path === root || path.startsWith(`${root}${sep}`);
}

async function serveStatic(incoming, outgoing, url, publicRoot) {
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) outgoing.setHeader(name, value);
  outgoing.setHeader("Cache-Control", "no-store");
  if (incoming.method !== "GET" && incoming.method !== "HEAD") {
    outgoing.setHeader("Allow", "GET, HEAD");
    outgoing.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    outgoing.end("Method not allowed");
    return;
  }

  let decodedPath;
  try { decodedPath = decodeURIComponent(url.pathname); }
  catch {
    outgoing.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    outgoing.end("Invalid path");
    return;
  }
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const candidate = resolve(publicRoot, relativePath);
  if (!isWithin(publicRoot, candidate)) {
    outgoing.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    outgoing.end("Not found");
    return;
  }

  let file;
  let info;
  try {
    file = await realpath(candidate);
    if (!isWithin(publicRoot, file)) throw new Error("Outside public directory");
    info = await stat(file);
    if (!info.isFile()) throw new Error("Not a file");
  } catch {
    outgoing.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    outgoing.end("Not found");
    return;
  }

  outgoing.writeHead(200, {
    "Content-Type": MIME_TYPES.get(extname(file).toLowerCase()) || "application/octet-stream",
    "Content-Length": info.size
  });
  if (incoming.method === "HEAD") {
    outgoing.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on("error", () => {
    if (!outgoing.headersSent) {
      outgoing.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      outgoing.end("Unable to serve file");
    } else outgoing.destroy();
  });
  stream.pipe(outgoing);
}

async function buildDevServer(projectRoot) {
  const publicRoot = await realpath(join(projectRoot, "public"));
  const routes = await loadApiRoutes(join(projectRoot, "api"));

  const server = createServer(async (incoming, outgoing) => {
    let url;
    try { url = new URL(incoming.url || "/", "http://localhost"); }
    catch {
      outgoing.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      outgoing.end("Invalid request URL");
      return;
    }

    const routePath = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    if (routePath === "/api" || routePath.startsWith(API_PREFIX)) {
      const handler = routes.get(routePath);
      if (!handler) {
        outgoing.writeHead(404, { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" });
        outgoing.end(JSON.stringify({ error: { code: "not_found", message: "API route not found." } }));
        return;
      }
      const request = makeVercelRequest(incoming, url);
      const response = makeVercelResponse(outgoing);
      setSecurityHeaders(request, response);
      try {
        if (incoming.method === "POST") request.body = await readJsonBody(incoming);
        await handler(request, response);
        if (!outgoing.writableEnded) sendLocalError(new Error("API handler returned without a response"), response);
      } catch (error) {
        sendLocalError(error, response);
      }
      return;
    }
    await serveStatic(incoming, outgoing, url, publicRoot);
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.apiRoutePaths = [...new Set([...routes.keys()].map((route) => route.replace(/\.js$/i, "")))];
  return server;
}

export async function createDevServer({ projectRoot = PROJECT_ROOT } = {}) {
  await loadLocalEnvironment(projectRoot);
  return buildDevServer(projectRoot);
}

export async function startDevServer({ port = 3000, host = "localhost", projectRoot = PROJECT_ROOT } = {}) {
  const env = await loadLocalEnvironment(projectRoot);
  const server = await buildDevServer(projectRoot);
  server.listen(port, host, () => {
    // Only announce the URL and whether a local file was found; never print names or values.
    console.log(`GH-Insights local server listening at http://localhost:${port}`);
    if (env.found) console.log("Loaded local environment settings from .env.local.");
  });
  server.on("error", (error) => {
    console.error(`Unable to start the local server (${error.code || "server error"}).`);
    process.exitCode = 1;
  });
  return server;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) await startDevServer();
