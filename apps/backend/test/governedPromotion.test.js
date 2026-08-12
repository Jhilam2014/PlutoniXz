import assert from "node:assert/strict";
import test from "node:test";
import {
  GovernedPromotionController,
  GovernedPromotionError,
  GovernedSelfImprovementRuntimeAdapter,
  MemoryGovernedPromotionStore,
  contentDigest,
  validateSelfImprovementCandidate
} from "../src/governedPromotion.js";

const scope = { tenantId: "platform", workspaceId: "self-improvement-runtime" };
const proposer = { type: "user", id: "proposer" };
const evaluator = { type: "user", id: "evaluator" };
const reviewer = "reviewer";
const approver = { type: "user", id: "approver" };
const operator = { type: "user", id: "operator" };
const monitor = { type: "service", id: "independent-monitor" };

function candidate(overrides = {}) {
  return {
    schemaVersion: "plutonix-self-improvement-runtime-policy/v1",
    targetKey: "self-improvement-runtime-policy",
    policy: {
      enabled: true, mode: "sandbox", maxCallsPerCycle: 2, maxTokensPerCycle: 1000, maxCostPerDay: 0.1,
      minSignalCount: 3, minConfidence: 0.8, postPromotionWindowMs: 60_000, autoRollback: true, autoPromoteMaxRisk: "low",
      eventCheckEnabled: true, eventTriggerMinScore: 0.8, eventWindowMs: 60_000, eventMinRelatedSignals: 3, eventTriggerCooldownMs: 60_000,
      researchEnabled: false, researchAllowNetwork: false, toolBuildEnabled: false, toolPlanAutoTrigger: false,
      ...overrides
    }
  };
}

function metrics(overrides = {}) {
  return { quality: 0.95, regressionRate: 0.01, latencyMs: 100, costUsd: 0.01, correctionRate: 0.01, reliability: 0.99, securityFindings: 0, confidence: 0.95, sampleCount: 2, ...overrides };
}

function policy(overrides = {}) {
  return {
    schemaVersion: "governed-promotion-policy/v1", policyVersion: "test-policy/v1", allowPromotion: true, approvalTtlMs: 60_000, requiredApprovals: 1,
    thresholds: { maxQualityDrop: 0.02, maxRegressionRate: 0.02, maxLatencyMultiplier: 1.1, maxCostMultiplier: 1.1, maxCorrectionRate: 0.05, minReliability: 0.98, maxSecurityFindings: 0, minConfidence: 0.8, minSampleCount: 2 },
    canary: { populationPercent: 5, maxWorkItems: 2, maxDurationMs: 60_000, observationWindowMs: 60_000, stopOnSecurityFinding: true, maxFailures: 0, maxRegressionRate: 0.03, maxLatencyMultiplier: 1.15, maxCostMultiplier: 1.15, minReliability: 0.98, minConfidence: 0.8 },
    ...overrides
  };
}

function fixture() {
  return { schemaVersion: "fixture/v1", version: "fixed-2026-08-10", cases: [{ id: "normal-1", input: { kind: "health" }, expected: { action: "observe" } }, { id: "normal-2", input: { kind: "signal" }, expected: { action: "sandbox" } }] };
}

function controller() {
  const runtimeAdapter = new GovernedSelfImprovementRuntimeAdapter({ env: { GOVERNED_PROMOTIONS_ENABLED: "true", GOVERNED_PROMOTION_SELF_IMPROVEMENT_ENABLED: "true" } });
  return { runtimeAdapter, controller: new GovernedPromotionController({ store: new MemoryGovernedPromotionStore(), runtimeAdapter, baseConfig: () => candidate().policy }) };
}

async function evaluatedRequest(instance, overrides = {}) {
  const request = await instance.controller.createCandidate({ scope, candidate: candidate(overrides.candidate), baseline: metrics(), fixtureDataset: fixture(), proposer });
  const evaluated = await instance.controller.recordEvaluation({
    scope, requestId: request.requestId, evaluator, reviewerId: reviewer, evaluatorVersion: "independent-evaluator/2026.08", fixtureDigest: request.fixtureDigest,
    evaluation: { metrics: metrics(overrides.metrics), uncertainty: 0.03, conflictOfInterest: "none", outputDigest: contentDigest({ output: "fixed" }), notes: "fixed fixture" }
  });
  return evaluated;
}

test("deterministic candidate validators reject unsafe runtime expansion and secret-shaped fields", () => {
  const unsafe = candidate({ mode: "advanced_auto" });
  unsafe.policy.apiToken = "not-allowed";
  const result = validateSelfImprovementCandidate(unsafe);
  assert.equal(result.status, "failed");
  assert.ok(result.checks.some((check) => check.id === "schema" && check.status === "failed"));
  assert.ok(result.checks.some((check) => check.id === "forbidden-secrets" && check.status === "failed"));
});

test("full governed lifecycle activates a bounded canary, promotes through the real resolver, and records immutable evidence", async () => {
  const instance = controller();
  const evaluated = await evaluatedRequest(instance);
  const policyApplied = await instance.controller.evaluatePolicy({ scope, requestId: evaluated.requestId, policy: policy(), actor: evaluator });
  const approved = await instance.controller.approve({ scope, requestId: evaluated.requestId, actor: approver, candidateDigest: policyApplied.candidateDigest, policyDigest: policyApplied.policyDigest, note: "approved exact digest" });
  assert.equal(approved.status, "approved");
  const started = await instance.controller.startCanary({ scope, requestId: approved.requestId, actor: operator, idempotencyKey: "canary-1" });
  assert.equal(started.request.status, "canary_running");
  const canaryKey = Array.from({ length: 500 }, (_, index) => `work-${index}`).find((workItemKey) => instance.runtimeAdapter.resolve({ ...scope, workItemKey }).source === "canary");
  assert.ok(canaryKey, "the bounded canary must select a deterministic subset");
  assert.equal(instance.runtimeAdapter.resolve({ ...scope, workItemKey: canaryKey }).policy.mode, "sandbox");
  const promoted = await instance.controller.recordCanaryObservation({ scope, requestId: approved.requestId, actor: monitor, metrics: metrics(), idempotencyKey: "promotion-1" });
  assert.equal(promoted.request.status, "promoted");
  assert.equal(instance.runtimeAdapter.resolve(scope).source, "active");
  const status = await instance.controller.status({ scope, requestId: approved.requestId });
  assert.equal(status.currentDigest, approved.candidateDigest);
  assert.equal(status.previousDigest, approved.knownGoodDigest);
  assert.ok((await instance.controller.store.listEvents({ ...scope, targetKey: "self-improvement-runtime-policy" }, approved.requestId)).length >= 5);
});

test("evaluation, policy, approval, mutation, and expiry fail closed when provenance is invalid", async () => {
  const instance = controller();
  const request = await instance.controller.createCandidate({ scope, candidate: candidate(), baseline: metrics(), fixtureDataset: fixture(), proposer });
  await assert.rejects(
    instance.controller.recordEvaluation({ scope, requestId: request.requestId, evaluator: proposer, reviewerId: reviewer, evaluatorVersion: "v1", fixtureDigest: request.fixtureDigest, evaluation: { metrics: metrics(), uncertainty: 0.02, conflictOfInterest: "none", outputDigest: contentDigest({}), notes: "" } }),
    (error) => error instanceof GovernedPromotionError && error.code === "separation_of_duties_denied"
  );
  const evaluated = await instance.controller.recordEvaluation({ scope, requestId: request.requestId, evaluator, reviewerId: reviewer, evaluatorVersion: "v1", fixtureDigest: request.fixtureDigest, evaluation: { metrics: metrics(), uncertainty: 0.02, conflictOfInterest: "none", outputDigest: contentDigest({}), notes: "" } });
  const policyApplied = await instance.controller.evaluatePolicy({ scope, requestId: evaluated.requestId, policy: policy(), actor: evaluator });
  await assert.rejects(instance.controller.approve({ scope, requestId: evaluated.requestId, actor: approver, candidateDigest: "0".repeat(64), policyDigest: policyApplied.policyDigest }), (error) => error.code === "approval_digest_mismatch");
  const approved = await instance.controller.approve({ scope, requestId: evaluated.requestId, actor: approver, candidateDigest: policyApplied.candidateDigest, policyDigest: policyApplied.policyDigest });
  const amended = await instance.controller.amendCandidate({ scope, requestId: approved.requestId, candidate: candidate({ minSignalCount: 4 }), baseline: metrics(), fixtureDataset: fixture(), actor: proposer });
  assert.equal(amended.status, "awaiting_evaluation");
  assert.equal(amended.approvals.length, 0);
  const second = await evaluatedRequest(instance);
  const secondPolicy = await instance.controller.evaluatePolicy({ scope, requestId: second.requestId, policy: policy(), actor: evaluator });
  const secondApproved = await instance.controller.approve({ scope, requestId: second.requestId, actor: approver, candidateDigest: secondPolicy.candidateDigest, policyDigest: secondPolicy.policyDigest });
  secondApproved.approvals[0].expiresAt = "2000-01-01T00:00:00.000Z";
  await instance.controller.store.saveRequest(secondApproved);
  await assert.rejects(instance.controller.startCanary({ scope, requestId: second.requestId, actor: operator }), (error) => error.code === "approval_expired_or_missing");
});

test("threshold breach or kill switch performs an idempotent operational rollback to the known-good digest", async () => {
  const instance = controller();
  const evaluated = await evaluatedRequest(instance);
  const policyApplied = await instance.controller.evaluatePolicy({ scope, requestId: evaluated.requestId, policy: policy(), actor: evaluator });
  const approved = await instance.controller.approve({ scope, requestId: evaluated.requestId, actor: approver, candidateDigest: policyApplied.candidateDigest, policyDigest: policyApplied.policyDigest });
  await instance.controller.startCanary({ scope, requestId: approved.requestId, actor: operator, idempotencyKey: "canary-rollback" });
  const rolled = await instance.controller.recordCanaryObservation({ scope, requestId: approved.requestId, actor: monitor, metrics: metrics({ securityFindings: 1 }), idempotencyKey: "monitor-fail" });
  assert.equal(rolled.request.status, "rolled_back");
  assert.equal(instance.runtimeAdapter.resolve(scope).source, "active");
  assert.equal(instance.runtimeAdapter.resolve(scope).digest, approved.knownGoodDigest);
  const replay = await instance.controller.rollback({ scope, requestId: approved.requestId, actor: operator, reason: "repeat", idempotencyKey: "monitor-fail" });
  assert.equal(replay.idempotent, true);

  const second = await evaluatedRequest(instance, { candidate: { minSignalCount: 4 } });
  const secondPolicy = await instance.controller.evaluatePolicy({ scope, requestId: second.requestId, policy: policy(), actor: evaluator });
  const secondApproved = await instance.controller.approve({ scope, requestId: second.requestId, actor: approver, candidateDigest: secondPolicy.candidateDigest, policyDigest: secondPolicy.policyDigest });
  await instance.controller.startCanary({ scope, requestId: second.requestId, actor: operator, idempotencyKey: "canary-kill" });
  await instance.controller.setKillSwitch({ scope, actor: operator, halted: true, reason: "operator drill" });
  const status = await instance.controller.status({ scope, requestId: second.requestId });
  assert.equal(status.halted, true);
  assert.equal(status.requests[0].status, "rolled_back");
});
