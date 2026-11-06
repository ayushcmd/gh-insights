const MAX_ENTRIES = 200;
const cache = new Map();

function prune(now) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

export function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

export function cacheSet(key, value, ttlMs = 120_000) {
  const now = Date.now();
  prune(now);
  cache.delete(key);
  cache.set(key, { value, expiresAt: now + ttlMs });
}

export function cacheStats() {
  return { entries: cache.size, scope: "serverless-instance" };
}
