import { API_ROUTE_HANDLERS } from "./api-routes.js";
import { endpoint } from "./api-helpers.js";
import { HttpError } from "./validation.js";

const ROUTE_QUERY_PARAMETER = "__ghinsightsRoute";
const GROUPS = new Set(["github", "insights", "ai"]);
const notFound = endpoint(async () => {
  throw new HttpError(404, "not_found", "API route not found.");
}, { methods: ["GET", "POST"] });

function requestForRoute(req, routePath) {
  const query = { ...(req.query || {}) };
  delete query[ROUTE_QUERY_PARAMETER];

  const parameters = new URLSearchParams();
  for (const [name, rawValue] of Object.entries(query)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value !== undefined && value !== null) parameters.append(name, String(value));
    }
  }

  const search = parameters.toString();
  const routedRequest = Object.create(req);
  Object.defineProperties(routedRequest, {
    url: { value: `${routePath}${search ? `?${search}` : ""}`, enumerable: true },
    query: { value: query, enumerable: true },
    rateLimitRoute: { value: routePath, enumerable: true }
  });
  return routedRequest;
}

export function createGroupHandler(group) {
  if (!GROUPS.has(group)) throw new TypeError(`Unknown API route group: ${group}`);

  return async function groupedHandler(req, res) {
    const operation = req.query?.[ROUTE_QUERY_PARAMETER];
    if (typeof operation !== "string" || !/^[a-z]+(-[a-z]+)*$/.test(operation)) return notFound(req, res);

    const routePath = `/api/${group}/${operation}`;
    const handler = API_ROUTE_HANDLERS.get(routePath);
    if (!handler) return notFound(req, res);

    return handler(requestForRoute(req, routePath), res);
  };
}
