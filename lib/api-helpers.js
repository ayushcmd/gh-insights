import { createHandler } from "./security.js";
import { readJsonBody, requestUsername } from "./validation.js";

export function endpoint(action, options = {}) {
  return createHandler(options, action);
}

export function body(req) {
  return readJsonBody(req);
}

export function username(req, payload) {
  return requestUsername(req, payload);
}
