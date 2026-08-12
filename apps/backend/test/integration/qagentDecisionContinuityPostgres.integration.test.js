import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PostgresDecisionContinuityStore } from "../../src/decisionContinuityPostgres.js";
import { QAgentDecisionContinuityService, resolveQAgentDecisionContinuityConfig } from "../../src/qagentDecisionContinuity.js";

const databaseUrl = process.env.DECISION_CONTINUITY_TEST_DATABASE_URL;
const options = databaseUrl ? {} : { skip: "Set DECISION_CONTINUITY_TEST_DATABASE_URL." };
const run = `${process.pid}-${Date.now()}`;
const tenantId = `qagent-postgres-${run}`;
const workspaceId = "qagent-postgres-workspace";
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const actor = { type: "service", id: "qagent-postgres-planner" };

function config() {
  const base = resolveQAgentDecisionContinuityConfig({ QAGENT_DECISION_CONTINUITY_ENABLED: "true", QAGENT_DECISION_CONTINUITY_ENABLED_TENANTS: tenantId });
  return { ...base, limits: { ...base.limits } };
}

function proposal(branchIds) {
  return {
    question: "Does the authorized fixture distinguish the two recovery branches?",
    hypothesis: "A fresh authorized measurement changes a provisional fitness dimension.",
    experiment: "Read the deterministic fixture once.",
    affectedBranches: branchIds.map((branchId, index) => ({ branchId, relevance: index ? "comparative" : "direct", evidenceGap: index ? "Comparative fixture evidence is missing." : "Direct fixture evidence is missing." })),
    expectedInformationGain: { score: 0.7, proxy: "fixture", calibrationVersion: "v1" },
    requestedEvidence: [{ source: "deterministic_fixture", toolId: "deterministic_fixture", type: "metric", freshnessMs: 60_000, purpose: "Compare the two branches." }],
    estimate: { tokens: 10, modelCalls: 1, toolCalls: 1, latencyMs: 1, monetaryCostUsd: 0, computeUnits: 0, evidenceBytes: 100, risk: "low" },
    stopCondition: "sufficient_evidence"
  };
}

const collector = {
  capability: "read_only",
  async collect() {
    const content = "fixture_route_failure_rate=0.01";
    return { status: "available", evidence: [{ content, provenance: { source: "deterministic_fixture", collectorId: "postgres-fixture", readOnlyToolId: "deterministic_fixture", authorizationId: "fixture-authorized", authorized: true, collectedAt: new Date().toISOString(), digest: digest(content) } }], usage: { tokens: 0, modelCalls: 0, toolCalls: 1, latencyMs: 1, monetaryCostUsd: 0, computeUnits: 0 } };
  }
};

const independentEvaluator = {
  async evaluate({ run: qagentRun }) {
    return { evaluatorId: "postgres-independent-evaluator", evaluatorVersion: "v1", status: "accepted", explanation: "Fixture evidence changes a provisional fitness measure only.", provisionalFitnessChanges: [{ branchId: qagentRun.branchIds[0], dimension: "reliability", before: 0.4, after: 0.8, attribution: "evidence_associated" }], provisionalRanking: { changed: true, method: "fixture/v1", attribution: "evidence_associated" }, constraintStates: [{ branchId: qagentRun.branchIds[0], constraintId: "safety", state: "unknown", reason: "Evidence does not clear constraints." }] };
  }
};

test("PostgreSQL persists tenant-scoped QAgent runs/effects in the existing Decision Continuity ledger", options, async (context) => {
  const store = new PostgresDecisionContinuityStore({ databaseUrl, reconsiderationCooldownMs: 0 });
  context.after(async () => store.pool?.end());
  const first = await store.createBranch({ workspaceId, decisionId: `qagent-decision-${run}`, objective: "Choose recovery behavior.", producedBy: { agentId: "planner", actorId: "operator" }, constraintExpression: { constraintId: "safety" }, revisitTriggers: ["safety"] }, { tenantId, actor: { type: "user", id: "operator" } });
  const second = await store.createBranch({ workspaceId, decisionId: `qagent-decision-${run}`, objective: "Choose recovery behavior.", producedBy: { agentId: "planner-2", actorId: "operator" } }, { tenantId, actor: { type: "user", id: "operator" } });
  await store.setDisposition({ branchId: first.id, status: "deferred" }, { tenantId, actor: { type: "user", id: "operator" } });
  const condition = await store.ingestConditionEvent({ eventId: `qagent-postgres-condition-${run}`, workspaceId, source: "monitor", observations: [{ constraintId: "safety", state: "cleared", source: "monitor", trusted: true, authorized: true }] }, { tenantId, actor: { type: "service", id: "monitor" } });
  const reconsideration = condition.requests[0];
  const service = new QAgentDecisionContinuityService({ store, config: config(), collector, independentEvaluator });
  const created = await service.createInvestigation({ iteration: 1, reconsiderationId: reconsideration.id, branchIds: [first.id, second.id], triggeringEvaluation: { id: "trigger", evaluatorId: "validator", evaluatorVersion: "v1" }, workflow: { correlationId: `qagent-postgres-workflow-${run}` }, model: { provider: "fixture", modelId: "fixture-planner", modelVersion: "v1", promptVersion: "v1" }, proposal: proposal([first.id, second.id]) }, { tenantId, workspaceId, actor });
  await service.collectAuthorizedEvidence({ runId: created.qagentRun.id, idempotencyKey: `qagent-postgres-effect-${run}` }, { tenantId, workspaceId, actor });
  const restarted = new PostgresDecisionContinuityStore({ databaseUrl });
  context.after(async () => restarted.pool?.end());
  const reopened = new QAgentDecisionContinuityService({ store: restarted, config: config(), collector, independentEvaluator });
  const runs = await reopened.listRuns({ tenantId, workspaceId });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "completed");
  assert.equal((await reopened.listRuns({ tenantId: `other-${run}`, workspaceId })).length, 0);
  const entities = await restarted.database().then((pool) => pool.query("SELECT entity_type, count(*)::int AS count FROM decision_continuity_current_state WHERE tenant_id = $1 GROUP BY entity_type", [tenantId]));
  const counts = Object.fromEntries(entities.rows.map((row) => [row.entity_type, row.count]));
  assert.equal(counts.qagent_run, 1);
  assert.equal(counts.qagent_effect, 1);
  const branch = await restarted.getBranch(first.id, { tenantId, workspaceId });
  assert.equal(branch.qagentEvidence[0].runId, created.qagentRun.id);
  assert.equal((await restarted.getReconsideration(reconsideration.id, { tenantId, workspaceId })).status, "pending_evaluation");
});
