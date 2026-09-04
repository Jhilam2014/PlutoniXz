import assert from "node:assert/strict";
import test from "node:test";
import { createIdentityLoginRateLimiter } from "../src/identityLoginRateLimit.js";

test("verified identity login attempts are bounded per subject and reset after the fixed window", () => {
  let timestamp = 1_000;
  const limiter = createIdentityLoginRateLimiter({ limit: 2, windowMs: 1_000, maxEntries: 100, now: () => timestamp });
  const firstIdentity = { issuer: "https://accounts.google.com", subject: "100" };
  const secondIdentity = { issuer: "https://accounts.google.com", subject: "200" };

  assert.deepEqual(limiter.consume(firstIdentity), { allowed: true, remaining: 1, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.consume(firstIdentity), { allowed: true, remaining: 0, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.consume(firstIdentity), { allowed: false, remaining: 0, retryAfterSeconds: 1 });
  assert.equal(limiter.consume(secondIdentity).allowed, true);

  timestamp += 1_000;
  assert.deepEqual(limiter.consume(firstIdentity), { allowed: true, remaining: 1, retryAfterSeconds: 0 });
});

test("identity login rate limiter rejects unsafe bounds and missing verified identity keys", () => {
  assert.throws(() => createIdentityLoginRateLimiter({ limit: 0 }), /limit/);
  const limiter = createIdentityLoginRateLimiter();
  assert.throws(() => limiter.consume({ issuer: "https://accounts.google.com" }), /verified identity/);
});
