import crypto from "node:crypto";

function positiveInteger(value, fallback, { min, max, name }) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

export function createIdentityLoginRateLimiter({
  limit = 30,
  windowMs = 5 * 60 * 1000,
  maxEntries = 10_000,
  now = () => Date.now()
} = {}) {
  const boundedLimit = positiveInteger(limit, 30, { min: 1, max: 1_000, name: "limit" });
  const boundedWindowMs = positiveInteger(windowMs, 5 * 60 * 1000, { min: 1_000, max: 60 * 60 * 1000, name: "windowMs" });
  const boundedMaxEntries = positiveInteger(maxEntries, 10_000, { min: 100, max: 100_000, name: "maxEntries" });
  const attempts = new Map();

  function identityKey(identity = {}) {
    const issuer = String(identity.issuer || "").trim();
    const subject = String(identity.subject || "").trim();
    if (!issuer || !subject) throw new Error("A verified identity is required for login rate limiting.");
    return crypto.createHash("sha256").update(`${issuer}:${subject}`).digest("hex");
  }

  function prune(timestamp) {
    for (const [key, entry] of attempts) {
      if (timestamp - entry.windowStartedAt >= boundedWindowMs) attempts.delete(key);
    }
    while (attempts.size >= boundedMaxEntries) attempts.delete(attempts.keys().next().value);
  }

  return {
    consume(identity) {
      const timestamp = now();
      prune(timestamp);
      const key = identityKey(identity);
      const current = attempts.get(key);
      if (!current || timestamp - current.windowStartedAt >= boundedWindowMs) {
        attempts.set(key, { count: 1, windowStartedAt: timestamp });
        return { allowed: true, remaining: boundedLimit - 1, retryAfterSeconds: 0 };
      }
      if (current.count >= boundedLimit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((boundedWindowMs - (timestamp - current.windowStartedAt)) / 1000))
        };
      }
      current.count += 1;
      return { allowed: true, remaining: boundedLimit - current.count, retryAfterSeconds: 0 };
    }
  };
}
