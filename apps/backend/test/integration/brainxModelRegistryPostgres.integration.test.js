import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PostgresDecisionContinuityStore } from "../../src/decisionContinuityPostgres.js";
import { BrainXModelRegistry, resolveBrainXConfig } from "../../src/brainxModelRegistry.js";

const databaseUrl = process.env.DECISION_CONTINUITY_TEST_DATABASE_URL;
const options = databaseUrl ? {} : { skip: "Set DECISION_CONTINUITY_TEST_DATABASE_URL." };
const run = `${process.pid}-${Date.now()}`;
const tenantId = `brainx-postgres-${run}`;
const workspaceId = "brainx-postgres-workspace";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const admin = { type: "user", id: "brainx-postgres-operator" };
const brainx = { type: "service", id: "brainx-postgres-router" };

function config() { return resolveBrainXConfig({ BRAINX_ENABLED: "true", BRAINX_ENABLED_TENANTS: tenantId, BRAINX_AVAILABLE_HARDWARE: "fixture" }); }
function registration() {
  return {
    registrationKey: "postgres-fixture", registrationVersion: "1.0.0", provider: "fixture-postgres", modelId: "fixture-postgres-model", immutableRevision: "b".repeat(40),
    artifact: { checksum: hash(`postgres-${run}`), provenance: "deterministic-fixture", formats: ["safetensors"], verifiedAt: "2026-08-10T00:00:00.000Z", trustRemoteCode: false },
    adapter: { id: "postgres-fixture-adapter", version: "v1", tokenizer: "fixture", quantization: "none", executionMode: "isolated_fixture" }, taskRoles: ["generation"], limits: { contextTokens: 4096, inputTokens: 2048, outputTokens: 512 }, health: { status: "healthy", checkedAt: "2026-08-10T00:00:00.000Z", source: "fixture" },
    licence: { spdx: "Apache-2.0", commercialUse: "allowed", attribution: "fixture", dataUsePolicy: "fixture only" }, governance: { allowedDataSensitivity: ["internal"], approvedRegions: ["in"], approvedEgress: ["isolated"], tenantAllowlist: [tenantId] }, resources: { hardware: ["fixture"], memoryMb: 32, storageMb: 32 }, pricing: { version: "v1", source: "fixture", inputUsdPer1k: 0.01, outputUsdPer1k: 0.02 }, performance: { p95LatencyMs: 100, throughputTokensPerSecond: 50 }, evaluationEvidence: { version: "v1", measuredAt: "2026-08-10T00:00:00.000Z", outcomeScore: 0.8, sampleCount: 10, provenance: "fixture" }, knownFailureModes: [], enabled: true
  };
}

test("PostgreSQL persists BrainX registrations, routes, execution effects, and tenant isolation in Decision Continuity", options, async (context) => {
  const store = new PostgresDecisionContinuityStore({ databaseUrl });
  context.after(async () => store.pool?.end());
  let calls = 0;
  const service = new BrainXModelRegistry({ store, config: config(), adapter: { async execute() { calls += 1; return { type: "text", content: "postgres fixture output", confidence: 0.8 }; } } });
  await service.setPolicy({ policyVersion: "postgres-policy/v1", allowCommercialUse: true, maxCostUsdPerRoute: 0.2, maxLatencyMs: 1000, allowedSensitivity: ["internal"], allowedEgress: ["isolated"], approvedRegions: ["in"], requiredIndependence: true }, { tenantId, workspaceId, actor: admin });
  const registered = await service.register(registration(), { tenantId, workspaceId, actor: admin });
  const routed = await service.route({ taskRole: "generation", data: { sensitivity: "internal", region: "in", egress: "isolated", commercialUse: true }, objective: { maxLatencyMs: 500, estimatedInputTokens: 100, estimatedOutputTokens: 20, maxCostUsd: 0.1 }, input: "postgres fixture input", workflow: { correlationId: `brainx-postgres-workflow-${run}` } }, { tenantId, workspaceId, actor: brainx });
  const executed = await service.execute({ routeId: routed.route.id, input: "postgres fixture input", idempotencyKey: `brainx-postgres-effect-${run}` }, { tenantId, workspaceId, actor: brainx });
  assert.equal(executed.status, "completed");
  assert.equal(calls, 1);
  const restarted = new PostgresDecisionContinuityStore({ databaseUrl });
  context.after(async () => restarted.pool?.end());
  const recovered = new BrainXModelRegistry({ store: restarted, config: config() });
  assert.equal((await recovered.listRegistrations({ tenantId, workspaceId }))[0].id, registered.registration.id);
  assert.equal((await recovered.listRoutes({ tenantId, workspaceId }))[0].id, routed.route.id);
  assert.equal((await recovered.metrics({ tenantId, workspaceId })).completed, 1);
  assert.equal((await recovered.listRoutes({ tenantId: `other-${run}`, workspaceId })).length, 0);
  const result = await restarted.database().then((pool) => pool.query("SELECT entity_type, count(*)::int AS count FROM decision_continuity_current_state WHERE tenant_id = $1 GROUP BY entity_type", [tenantId]));
  const counts = Object.fromEntries(result.rows.map((row) => [row.entity_type, row.count]));
  for (const entityType of ["brainx_registration", "brainx_policy", "brainx_route", "brainx_execution", "brainx_effect"]) assert.equal(counts[entityType], 1);
});
