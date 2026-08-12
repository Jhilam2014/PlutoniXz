import assert from "node:assert/strict";
import test from "node:test";
import { PostgresDecisionContinuityStore } from "../../src/decisionContinuityPostgres.js";
import { buildDecisionContinuityGraph } from "../../src/decisionContinuityProjection.js";
import { resolveDecisionContinuityAdapter } from "../../src/decisionContinuity.js";

const databaseUrl = process.env.DECISION_CONTINUITY_TEST_DATABASE_URL;
const options = databaseUrl ? { skip: false } : { skip: "Set DECISION_CONTINUITY_TEST_DATABASE_URL to run PostgreSQL integration tests." };
const actor = { type: "user", id: "db-test-operator" };
const runId = `${process.pid}-${Date.now()}`;
const input = (overrides = {}) => ({
  workspaceId: "workspace-db", decisionId: "decision-db", objective: "Keep a durable decision record.",
  candidate: { approach: "postgres" }, evidence: [{ id: "e-1", type: "test", source: "integration" }],
  producedBy: { agentId: "planner", source: "test" }, ...overrides
});

test("production configuration rejects the file adapter", () => {
  assert.equal(resolveDecisionContinuityAdapter({ adapter: "file", environment: "production" }).adapter, "unavailable");
});

test("PostgreSQL ledger atomically persists state, event hash chain, and outbox", options, async (context) => {
  const store = new PostgresDecisionContinuityStore({ databaseUrl, reconsiderationCooldownMs: 0 });
  context.after(async () => store.pool?.end());
  const tenantId = `tenant-db-${runId}`;
  const branch = await store.createBranch(input(), { tenantId, actor });
  const [left, right] = await Promise.allSettled([
    store.setDisposition({ branchId: branch.id, status: "deferred", reason: "wait", expectedRevision: 1 }, { tenantId, actor }),
    store.setDisposition({ branchId: branch.id, status: "rejected", reason: "no", expectedRevision: 1 }, { tenantId, actor })
  ]);
  assert.equal([left, right].filter((item) => item.status === "fulfilled").length, 1);
  assert.equal([left, right].filter((item) => item.status === "rejected").length, 1);
  const events = await store.listEvents({ tenantId, branchId: branch.id });
  assert.equal(events.length, 2);
  const rows = await store.pool.query("SELECT event_id, previous_hash, event_hash FROM decision_continuity_events WHERE tenant_id = $1 ORDER BY sequence_no", [tenantId]);
  assert.equal(rows.rows.length, 2);
  assert.equal(rows.rows[1].previous_hash, rows.rows[0].event_hash);
  const outbox = await store.pool.query("SELECT count(*)::int AS count FROM decision_continuity_outbox WHERE tenant_id = $1", [tenantId]);
  assert.equal(outbox.rows[0].count, 2);
  const graph = buildDecisionContinuityGraph({ branches: await store.listBranches({ tenantId }), events });
  assert.ok(graph.nodes.some((node) => node.id === `branch:${branch.id}`));
});

test("failed outbox write rolls back the state and event", options, async (context) => {
  const store = new PostgresDecisionContinuityStore({ databaseUrl, failureInjector: (stage) => { if (stage === "before_outbox") throw new Error("injected failure"); } });
  context.after(async () => store.pool?.end());
  const tenantId = `tenant-rollback-${runId}`;
  await assert.rejects(store.createBranch(input({ decisionId: "will-rollback" }), { tenantId, actor }));
  assert.equal((await store.listBranches({ tenantId })).length, 0);
  const eventCount = await store.pool.query("SELECT count(*)::int AS count FROM decision_continuity_events WHERE tenant_id = $1", [tenantId]);
  assert.equal(eventCount.rows[0].count, 0);
});

test("tenant isolation and condition-event idempotency survive database reload", options, async (context) => {
  const first = new PostgresDecisionContinuityStore({ databaseUrl, reconsiderationCooldownMs: 0 });
  context.after(async () => first.pool?.end());
  const tenantId = `tenant-one-${runId}`;
  const otherTenantId = `tenant-two-${runId}`;
  const branch = await first.createBranch(input({ decisionId: "isolated" }), { tenantId, actor });
  await assert.rejects(first.getBranch(branch.id, { tenantId: otherTenantId }));
  const condition = { eventId: `event-idempotent-${runId}`, workspaceId: "workspace-db", source: "monitor", observations: [{ constraintId: "ready", state: "cleared", source: "monitor", trusted: true, authorized: true }] };
  const original = await first.ingestConditionEvent(condition, { tenantId, actor: { type: "service", id: "monitor" } });
  const second = new PostgresDecisionContinuityStore({ databaseUrl, reconsiderationCooldownMs: 0 });
  context.after(async () => second.pool?.end());
  const replay = await second.ingestConditionEvent(condition, { tenantId, actor: { type: "service", id: "monitor" } });
  assert.equal(original.idempotent, false);
  assert.equal(replay.idempotent, true);
  await assert.rejects(first.setDisposition({ branchId: branch.id, status: "deferred", reason: "cross tenant", expectedRevision: 1 }, { tenantId: otherTenantId, actor }));
});

test("legacy import dry-run is non-mutating and rerun is checksum-idempotent", options, async (context) => {
  const store = new PostgresDecisionContinuityStore({ databaseUrl });
  context.after(async () => store.pool?.end());
  const tenantId = `tenant-import-${runId}`;
  const branchId = `import-root-${runId}`;
  const state = {
    schemaVersion: "1.0.0", updatedAt: "2026-01-01T00:00:00.000Z", observations: {}, reconsiderations: {}, approvals: {}, canaries: {}, processedConditionEvents: {},
    branches: { [branchId]: { id: branchId, tenantId, workspaceId: "workspace-import", decisionId: "import-decision", objective: { summary: "Imported root" }, candidate: { approach: "legacy" }, evidence: [], status: "candidate", revision: 1, parentBranchId: null, rootLineageId: branchId, origin: { source: "import" }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } }
  };
  const events = [{ id: `import-event-${runId}`, tenantId, workspaceId: "workspace-import", type: "branch.created", occurredAt: "2026-01-01T00:00:00.000Z", actor: { type: "system", id: "import" }, payload: { branch: state.branches[branchId] } }];
  const dryRun = await store.importLegacy({ state, events, dryRun: true });
  assert.equal(dryRun.dryRun, true);
  assert.equal((await store.listBranches({ tenantId })).length, 0);
  const imported = await store.importLegacy({ state, events });
  const rerun = await store.importLegacy({ state, events });
  assert.equal(imported.idempotent, false);
  assert.equal(rerun.idempotent, true);
  const restored = await store.getBranch(branchId, { tenantId });
  assert.equal(restored.revision, 1);
  assert.equal(restored.origin.source, "import");
});

test("database loss fails closed without accepting a write", async () => {
  const unavailable = new PostgresDecisionContinuityStore({ databaseUrl: "postgres://127.0.0.1:1/unavailable" });
  await assert.rejects(unavailable.createBranch(input(), { tenantId: "tenant-unavailable", actor }), (error) => error.code === "authoritative_store_unavailable");
  await unavailable.pool?.end();
});
