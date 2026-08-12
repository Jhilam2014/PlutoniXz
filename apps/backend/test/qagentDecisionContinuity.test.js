import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDecisionContinuityStore, evaluateConstraintExpression } from "../src/decisionContinuity.js";
import { QAgentDecisionContinuityService, resolveQAgentDecisionContinuityConfig } from "../src/qagentDecisionContinuity.js";

const tenantId = "qagent-tenant";
const workspaceId = "qagent-workspace";
const operator = { type: "user", id: "operator" };
const qagent = { type: "service", id: "qagent-evidence-planner" };
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function config(overrides = {}) {
  return {
    ...resolveQAgentDecisionContinuityConfig({
      QAGENT_DECISION_CONTINUITY_ENABLED: "true",
      QAGENT_DECISION_CONTINUITY_ENABLED_TENANTS: tenantId
    }),
    ...overrides,
    limits: { ...resolveQAgentDecisionContinuityConfig({}).limits, ...(overrides.limits || {}) }
  };
}

function proposal(branchIds, overrides = {}) {
  return {
    question: "Does the authorized route failure measure distinguish the recovery alternatives?",
    hypothesis: "A fresh route-failure measurement differentiates the branches.",
    experiment: "Read the approved deterministic route-failure fixture once.",
    affectedBranches: branchIds.map((branchId, index) => ({
      branchId,
      relevance: index === 0 ? "direct" : "comparative",
      evidenceGap: index === 0 ? "Fresh route failure evidence is missing for the reconsidered branch." : "Comparative route failure evidence is missing for the alternative branch."
    })),
    expectedInformationGain: { score: 0.7, proxy: "calibrated fixture uncertainty reduction", calibrationVersion: "fixture-calibration/v1" },
    requestedEvidence: [{ source: "deterministic_fixture", toolId: "deterministic_fixture", type: "metric", freshnessMs: 60_000, purpose: "Compare route failure evidence without changing constraints." }],
    estimate: { tokens: 100, modelCalls: 1, toolCalls: 1, latencyMs: 500, monetaryCostUsd: 0.01, computeUnits: 1, evidenceBytes: 1024, risk: "low" },
    stopCondition: "sufficient_evidence",
    ...overrides
  };
}

function input(reconsiderationId, branchIds, overrides = {}) {
  return {
    iteration: 1,
    reconsiderationId,
    branchIds,
    triggeringEvaluation: { id: "trigger-evaluation-1", evaluatorId: "deterministic-validator", evaluatorVersion: "validator/v1" },
    workflow: { correlationId: "workflow-qagent-1", requestId: "request-qagent-1" },
    model: { provider: "fixture", modelId: "fixture-planner", modelVersion: "v1", promptVersion: "qagent-prompt/v1" },
    proposal: proposal(branchIds),
    ...overrides
  };
}

function collector({ content = "route_failure_rate=0.01 api_key=do-not-persist", authorized = true, collectedAt = new Date().toISOString(), toolId = "deterministic_fixture", source = "deterministic_fixture" } = {}) {
  const calls = [];
  return {
    capability: "read_only",
    calls,
    async collect(request) {
      calls.push(request);
      return {
        status: "available",
        evidence: [{ content, provenance: { source, collectorId: "fixture-reader", readOnlyToolId: toolId, authorizationId: "fixture-token=do-not-persist", authorized, collectedAt, digest: digest(content) } }],
        usage: { tokens: 0, modelCalls: 0, toolCalls: 1, latencyMs: 1, monetaryCostUsd: 0, computeUnits: 0 }
      };
    }
  };
}

function evaluator({ status = "accepted", evaluatorId = "independent-evaluator", changes = true } = {}) {
  return {
    async evaluate({ run }) {
      return {
        evaluatorId,
        evaluatorVersion: "independent-evaluator/v1",
        status,
        explanation: status === "no_decision_effect" ? "The evidence does not distinguish the alternatives." : "The evidence changes only a provisional branch fitness assessment.",
        provisionalFitnessChanges: changes ? [{ branchId: run.branchIds[0], dimension: "reliability", before: 0.4, after: 0.8, attribution: "evidence_associated" }] : [],
        provisionalRanking: { changed: changes, method: "fixture-comparison/v1", attribution: changes ? "evidence_associated" : "not_established" },
        constraintStates: [{ branchId: run.branchIds[0], constraintId: "safety-clearance", state: "unknown", reason: "QAgent evidence cannot clear a constraint." }]
      };
    }
  };
}

async function seeded(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-qagent-decision-"));
  context.after(async () => fs.rm(root, { recursive: true, force: true }));
  const store = createDecisionContinuityStore({ root, reconsiderationCooldownMs: 0 });
  const first = await store.createBranch({
    workspaceId, decisionId: "decision-qagent", objective: "Select a safe route recovery behavior.", producedBy: { agentId: "planner", actorId: "operator" },
    constraintExpression: { constraintId: "safety-clearance" }, revisitTriggers: ["safety-clearance"], candidate: { strategy: "guided" }
  }, { tenantId, actor: operator });
  const second = await store.createBranch({
    workspaceId, decisionId: "decision-qagent", objective: "Select a safe route recovery behavior.", producedBy: { agentId: "planner-2", actorId: "operator" },
    candidate: { strategy: "diagnostic" }
  }, { tenantId, actor: operator });
  await store.setDisposition({ branchId: first.id, status: "deferred", reason: "Awaiting safety clearance." }, { tenantId, actor: operator });
  const reconsidered = await store.ingestConditionEvent({
    eventId: "qagent-clearance", workspaceId, source: "trusted-monitor",
    observations: [{ constraintId: "safety-clearance", state: "cleared", source: "trusted-monitor", trusted: true, authorized: true }]
  }, { tenantId, actor: { type: "service", id: "trusted-monitor" } });
  return { store, first, second, reconsideration: reconsidered.requests[0] };
}

test("materially different branches receive one appropriately scoped, tenant-scoped QAgent investigation", async (context) => {
  const { store, first, second, reconsideration } = await seeded(context);
  const service = new QAgentDecisionContinuityService({ store, config: config(), collector: collector(), independentEvaluator: evaluator() });
  const result = await service.createInvestigation(input(reconsideration.id, [first.id, second.id]), { tenantId, workspaceId, actor: qagent });
  assert.equal(result.status, "proposed");
  assert.deepEqual(result.qagentRun.branchRelevance.map((item) => item.relevance), ["direct", "comparative"]);
  assert.equal((await service.listRuns({ tenantId, workspaceId })).length, 1);
  assert.equal((await service.listRuns({ tenantId: "other-tenant", workspaceId })).length, 0);
});

test("semantic duplicate proposals retain a duplicate record linked to one active investigation", async (context) => {
  const { store, first, second, reconsideration } = await seeded(context);
  const service = new QAgentDecisionContinuityService({ store, config: config({ deduplicationThreshold: 0.5 }), collector: collector(), independentEvaluator: evaluator() });
  const firstResult = await service.createInvestigation(input(reconsideration.id, [first.id, second.id]), { tenantId, workspaceId, actor: qagent });
  const duplicateProposal = proposal([first.id, second.id], {
    question: "Can the authorized navigation errors rate distinguish recovery alternatives?"
  });
  duplicateProposal.affectedBranches = duplicateProposal.affectedBranches.map((item, index) => ({ ...item, evidenceGap: index === 0 ? "Fresh route failure evidence is missing for the reconsidered branch." : "Comparative route failure evidence is missing for the alternative branch." }));
  const duplicate = await service.createInvestigation(input(reconsideration.id, [first.id, second.id], { proposal: duplicateProposal }), { tenantId, workspaceId, actor: qagent });
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.qagentRun.deduplication.duplicateOfRunId, firstResult.qagentRun.id);
  assert.equal((await service.listRuns({ tenantId, workspaceId })).length, 2);
});

test("model output cannot expand hard limits, and loop or budget exhaustion stops without a side effect", async (context) => {
  const { store, first, second, reconsideration } = await seeded(context);
  const service = new QAgentDecisionContinuityService({ store, config: config({ limits: { ...config().limits, maxTokens: 50, maxIterations: 1 } }), collector: collector(), independentEvaluator: evaluator() });
  await assert.rejects(
    service.createInvestigation(input(reconsideration.id, [first.id, second.id], { proposal: { ...proposal([first.id, second.id]), limitOverrides: { maxTokens: 999999 } } }), { tenantId, workspaceId, actor: qagent }),
    /unrecognized|invalid/i
  );
  const exhausted = await service.createInvestigation(input(reconsideration.id, [first.id, second.id], { proposal: proposal([first.id, second.id], { estimate: { tokens: 100, modelCalls: 1, toolCalls: 1, latencyMs: 1, monetaryCostUsd: 0, computeUnits: 0, evidenceBytes: 1, risk: "low" } }) }), { tenantId, workspaceId, actor: qagent });
  assert.equal(exhausted.qagentRun.stopReason, "budget_exhausted");
  const loop = await service.createInvestigation(input(reconsideration.id, [first.id, second.id], { iteration: 2 }), { tenantId, workspaceId, actor: qagent });
  assert.equal(loop.qagentRun.stopReason, "loop_detected");
});

test("QAgent investigation fails closed without a provisioned scoped service authority", async (context) => {
  const { store, first, second, reconsideration } = await seeded(context);
  const productionService = new QAgentDecisionContinuityService({
    store, env: { NODE_ENV: "production" }, config: config(), collector: collector(), independentEvaluator: evaluator()
  });
  await assert.rejects(
    productionService.createInvestigation(input(reconsideration.id, [first.id, second.id]), { tenantId, workspaceId, actor: qagent }),
    /identity authority is unavailable/i
  );

  let checks = 0;
  const deniedService = new QAgentDecisionContinuityService({
    store,
    config: config(),
    collector: collector(),
    independentEvaluator: evaluator(),
    identityAccess: {
      async assertPrincipalPermission({ principalId, tenantId: scopedTenant, workspaceId: scopedWorkspace, permission, principalTypes }) {
        checks += 1;
        assert.equal(principalId, qagent.id);
        assert.equal(scopedTenant, tenantId);
        assert.equal(scopedWorkspace, workspaceId);
        assert.equal(permission, "qagent:investigate");
        assert.deepEqual(principalTypes, ["service"]);
        throw new Error("membership denied");
      }
    }
  });
  await assert.rejects(
    deniedService.createInvestigation(input(reconsideration.id, [first.id, second.id]), { tenantId, workspaceId, actor: qagent }),
    /membership denied/i
  );
  await assert.rejects(
    deniedService.createInvestigation(input(reconsideration.id, [first.id, second.id]), { tenantId, workspaceId, actor: { type: "user", id: "operator" } }),
    /scoped service identity/i
  );
  assert.equal(checks, 1);
});

test("stale or unauthorized evidence stays untrusted and cannot clear a branch constraint", async (context) => {
  const { store, first, second, reconsideration } = await seeded(context);
  const stale = new Date(Date.now() - 120_000).toISOString();
  const service = new QAgentDecisionContinuityService({ store, config: config(), collector: collector({ authorized: false, collectedAt: stale }), independentEvaluator: evaluator() });
  const created = await service.createInvestigation(input(reconsideration.id, [first.id, second.id]), { tenantId, workspaceId, actor: qagent });
  const result = await service.collectAuthorizedEvidence({ runId: created.qagentRun.id, idempotencyKey: "stale-evidence" }, { tenantId, workspaceId, actor: qagent });
  assert.equal(result.qagentRun.stopReason, "invalid_evidence");
  const branch = await store.getBranch(first.id, { tenantId, workspaceId });
  assert.equal(branch.status, "reconsidering");
  assert.equal(evaluateConstraintExpression({ constraintId: "qagent-untrusted" }, {}).state, "unknown");
  assert.equal(branch.qagentEvidence, undefined);
});

test("QAgent has no forbidden-tool, policy, approval, promotion, or self-evaluation path", async (context) => {
  const { store, first, second, reconsideration } = await seeded(context);
  const service = new QAgentDecisionContinuityService({ store, config: config(), collector: collector(), independentEvaluator: evaluator({ evaluatorId: "qagent-independent-evaluator" }) });
  const forbidden = await service.createInvestigation(input(reconsideration.id, [first.id, second.id], { proposal: proposal([first.id, second.id], { requestedEvidence: [{ source: "internet", toolId: "shell", type: "research", freshnessMs: 1, purpose: "try a shell" }] }) }), { tenantId, workspaceId, actor: qagent });
  assert.equal(forbidden.qagentRun.stopReason, "policy_denied");
  const created = await service.createInvestigation(input(reconsideration.id, [first.id, second.id]), { tenantId, workspaceId, actor: qagent });
  await assert.rejects(service.collectAuthorizedEvidence({ runId: created.qagentRun.id, idempotencyKey: "self-evaluation" }, { tenantId, workspaceId, actor: qagent }), /cannot act as its own independent evaluator/i);
  assert.equal(typeof service.approve, "undefined");
  assert.equal(typeof service.promote, "undefined");
  assert.equal(typeof service.changePolicy, "undefined");
});

test("duplicate delivery and a fresh service instance do not repeat the read-only tool effect", async (context) => {
  const { store, first, second, reconsideration } = await seeded(context);
  const readOnlyCollector = collector();
  const firstService = new QAgentDecisionContinuityService({ store, config: config(), collector: readOnlyCollector, independentEvaluator: evaluator() });
  const created = await firstService.createInvestigation(input(reconsideration.id, [first.id, second.id]), { tenantId, workspaceId, actor: qagent });
  await firstService.collectAuthorizedEvidence({ runId: created.qagentRun.id, idempotencyKey: "collect-once" }, { tenantId, workspaceId, actor: qagent });
  const restartedService = new QAgentDecisionContinuityService({ store, config: config(), collector: readOnlyCollector, independentEvaluator: evaluator() });
  const replay = await restartedService.collectAuthorizedEvidence({ runId: created.qagentRun.id, idempotencyKey: "collect-once" }, { tenantId, workspaceId, actor: qagent });
  assert.equal(replay.status, "idempotent");
  assert.equal(readOnlyCollector.calls.length, 1);
});

test("disabled QAgent restores the non-QAgent baseline and non-impacting evidence is recorded honestly", async (context) => {
  const { store, first, second, reconsideration } = await seeded(context);
  const disabled = new QAgentDecisionContinuityService({ store, config: config({ enabled: false }), collector: collector(), independentEvaluator: evaluator() });
  const baseline = await disabled.createInvestigation(input(reconsideration.id, [first.id, second.id]), { tenantId, workspaceId, actor: qagent });
  assert.equal(baseline.status, "baseline");
  assert.equal((await disabled.listRuns({ tenantId, workspaceId })).length, 0);

  const service = new QAgentDecisionContinuityService({ store, config: config(), collector: collector(), independentEvaluator: evaluator({ status: "no_decision_effect", changes: false }) });
  const created = await service.createInvestigation(input(reconsideration.id, [first.id, second.id]), { tenantId, workspaceId, actor: qagent });
  const finished = await service.collectAuthorizedEvidence({ runId: created.qagentRun.id, idempotencyKey: "honest-no-effect" }, { tenantId, workspaceId, actor: qagent });
  assert.equal(finished.qagentRun.stopReason, "no_decision_effect");
  assert.equal(finished.qagentRun.decisionImpact.status, "no_decision_effect");
});

test("deterministic fixture changes only provisional branch evaluation and leaves policy plus human approval required", async (context) => {
  const { store, first, second, reconsideration } = await seeded(context);
  const service = new QAgentDecisionContinuityService({ store, config: config(), collector: collector(), independentEvaluator: evaluator() });
  const created = await service.createInvestigation(input(reconsideration.id, [first.id, second.id]), { tenantId, workspaceId, actor: qagent });
  const completed = await service.collectAuthorizedEvidence({ runId: created.qagentRun.id, idempotencyKey: "provisional-change" }, { tenantId, workspaceId, actor: qagent });
  const branch = await store.getBranch(first.id, { tenantId, workspaceId });
  const request = await store.getReconsideration(reconsideration.id, { tenantId, workspaceId });
  assert.equal(completed.qagentRun.status, "completed");
  assert.equal(branch.qagentProvisionalFitness[0].after, 0.8);
  assert.equal(branch.status, "reconsidering");
  assert.equal(request.status, "pending_evaluation");
  assert.match(completed.qagentRun.decisionImpact.finalLifecycleAuthority, /policy_and_human_approval_required/);
  const metric = await service.metrics({ tenantId, workspaceId });
  assert.equal(metric.provisionalDecisionImpactCount, 1);
  assert.equal(metric.attribution, "operational counts only; no causal improvement claim");
  assert.doesNotMatch(JSON.stringify(completed.qagentRun), /do-not-persist/);
});
