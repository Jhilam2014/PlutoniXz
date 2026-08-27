import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { createGothamAccountUsageService, sanitizeGothamAccountUsage } from "../src/gothamAccountUsage.js";

const owner = { issuer: "https://identity.example", subject: "user-1", displayName: "Ada", email: "ada@example.test", authMode: "JWT" };
const ownerKey = crypto.createHash("sha256").update(`${owner.issuer}:${owner.subject}`).digest("hex").slice(0, 32);

function service(rows, { now = () => Date.UTC(2026, 0, 1), probes = {} } = {}) {
  return createGothamAccountUsageService({
    readRows: async () => rows,
    probeCodex: async () => probes.codex || { available: true, version: "codex 1.2.3" },
    probeCopilot: async () => probes.copilot || { available: false, error: "not installed" },
    now,
    cacheMs: 30_000
  });
}

test("Gotham usage is owner-scoped and keeps a PlutoniX profile distinct from provider identity", async () => {
  const snapshot = await service([{
    gothamUsageOwnerKey: ownerKey,
    provider: "codex",
    executionModel: "gpt-5.5",
    projectId: "project-a",
    buildId: "build-a",
    inputTokens: 0,
    outputTokens: 44,
    totalTokens: 44,
    estimatedUsd: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    source: "plutonix-codex-workflow",
    estimationMethod: "chars_div_4_local_estimate"
  }]).read({ owner, projectId: "project-a" });

  assert.equal(snapshot.profile.id, "https://identity.example:user-1");
  assert.equal(snapshot.providers[0].account.providerAccountId, null);
  assert.equal(snapshot.providers[0].account.providerAccountIdReason.includes("does not expose"), true);
  assert.equal(snapshot.providers[0].conversation.inputTokens, 0);
  assert.equal(snapshot.providers[0].conversation.totalTokens, 44);
  assert.equal(snapshot.providers[0].conversation.cost.amount, 0);
});

test("Gotham usage does not leak another owner or project rows", async () => {
  const snapshot = await service([{
    gothamUsageOwnerKey: "other-owner",
    provider: "codex",
    projectId: "project-a",
    inputTokens: 4,
    outputTokens: 5,
    totalTokens: 9,
    createdAt: "2026-01-01T00:00:00.000Z"
  }, {
    gothamUsageOwnerKey: ownerKey,
    provider: "codex",
    projectId: "project-b",
    inputTokens: 4,
    outputTokens: 5,
    totalTokens: 9,
    createdAt: "2026-01-01T00:00:00.000Z"
  }]).read({ owner, projectId: "project-a" });

  assert.equal(snapshot.providers[0].conversation.availability, "unavailable");
  assert.equal(snapshot.providers[0].conversation.totalTokens, null);
});

test("the latest cumulative run replaces older snapshots and manual refresh is throttled", async () => {
  let timestamp = Date.UTC(2026, 0, 1);
  const usage = service([{
    gothamUsageOwnerKey: ownerKey, provider: "codex", projectId: "project-a", inputTokens: 4, outputTokens: 5, totalTokens: 9, buildId: "older", createdAt: "2026-01-01T00:00:00.000Z"
  }, {
    gothamUsageOwnerKey: ownerKey, provider: "codex", projectId: "project-a", inputTokens: 10, outputTokens: 12, totalTokens: 22, buildId: "latest", createdAt: "2026-01-01T00:01:00.000Z"
  }], { now: () => timestamp });
  const first = await usage.read({ owner, projectId: "project-a" });
  const refreshed = await usage.read({ owner, projectId: "project-a", refresh: true });
  assert.equal(first.providers[0].conversation.buildId, "latest");
  assert.equal(first.providers[0].conversation.totalTokens, 22);
  assert.equal(refreshed.refresh.status, "throttled");
  timestamp += 31_000;
  assert.equal((await usage.read({ owner, projectId: "project-a" })).refresh.status, "refreshed");
});

test("credential-shaped account payloads are rejected before they can reach a browser", () => {
  assert.throws(() => sanitizeGothamAccountUsage({ access_token: "do-not-return" }), /restricted credential/i);
  assert.throws(() => sanitizeGothamAccountUsage({ identity: "sk-secretvalue" }), /restricted credential/i);
});
