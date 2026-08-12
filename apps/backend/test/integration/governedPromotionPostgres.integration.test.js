import assert from "node:assert/strict";
import test from "node:test";
import {
  GovernedPromotionController,
  GovernedSelfImprovementRuntimeAdapter,
  PostgresGovernedPromotionStore,
  contentDigest
} from "../../src/governedPromotion.js";
import { IdentityAccessStore } from "../../src/identityAccess.js";

const databaseUrl = process.env.DECISION_CONTINUITY_TEST_DATABASE_URL;
const options = databaseUrl ? {} : { skip: "Set DECISION_CONTINUITY_TEST_DATABASE_URL to run PostgreSQL governed-promotion integration tests." };
const scope = { tenantId: "platform", workspaceId: "self-improvement-runtime" };
const runId = `${process.pid}-${Date.now()}`;

function candidate() {
  return { schemaVersion: "plutonix-self-improvement-runtime-policy/v1", targetKey: "self-improvement-runtime-policy", policy: { enabled: true, mode: "sandbox", maxCallsPerCycle: 2, maxTokensPerCycle: 1000, maxCostPerDay: 0.1, minSignalCount: 3, minConfidence: 0.8, postPromotionWindowMs: 60_000, autoRollback: true, autoPromoteMaxRisk: "low", eventCheckEnabled: true, eventTriggerMinScore: 0.8, eventWindowMs: 60_000, eventMinRelatedSignals: 3, eventTriggerCooldownMs: 60_000, researchEnabled: false, researchAllowNetwork: false, toolBuildEnabled: false, toolPlanAutoTrigger: false } };
}
function metrics(overrides = {}) { return { quality: 0.95, regressionRate: 0.01, latencyMs: 100, costUsd: 0.01, correctionRate: 0.01, reliability: 0.99, securityFindings: 0, confidence: 0.95, sampleCount: 2, ...overrides }; }
function policy() { return { schemaVersion: "governed-promotion-policy/v1", policyVersion: `postgres-policy-${runId}`, allowPromotion: true, approvalTtlMs: 60_000, requiredApprovals: 1, thresholds: { maxQualityDrop: 0.02, maxRegressionRate: 0.02, maxLatencyMultiplier: 1.1, maxCostMultiplier: 1.1, maxCorrectionRate: 0.05, minReliability: 0.98, maxSecurityFindings: 0, minConfidence: 0.8, minSampleCount: 2 }, canary: { populationPercent: 5, maxWorkItems: 2, maxDurationMs: 60_000, observationWindowMs: 60_000, stopOnSecurityFinding: true, maxFailures: 0, maxRegressionRate: 0.03, maxLatencyMultiplier: 1.15, maxCostMultiplier: 1.15, minReliability: 0.98, minConfidence: 0.8 } }; }

test("PostgreSQL governed-promotion lifecycle persists content-addressed evidence, selector effects, and tenant isolation", options, async (context) => {
  const store = new PostgresGovernedPromotionStore({ databaseUrl });
  const runtimeAdapter = new GovernedSelfImprovementRuntimeAdapter({ env: { GOVERNED_PROMOTIONS_ENABLED: "true", GOVERNED_PROMOTION_SELF_IMPROVEMENT_ENABLED: "true" } });
  const controller = new GovernedPromotionController({ store, runtimeAdapter, baseConfig: () => candidate().policy });
  context.after(async () => store.pool?.end());
  const proposer = { type: "user", id: `proposer-${runId}` };
  const request = await controller.createCandidate({ scope, candidate: candidate(), baseline: metrics(), fixtureDataset: { schemaVersion: "fixture/v1", cases: [{ id: `fixture-${runId}`, input: { kind: "normal" }, expected: { action: "sandbox" } }] }, proposer });
  const evaluated = await controller.recordEvaluation({ scope, requestId: request.requestId, evaluator: { type: "user", id: `evaluator-${runId}` }, reviewerId: `reviewer-${runId}`, evaluatorVersion: "postgres-independent-evaluator/v1", fixtureDigest: request.fixtureDigest, evaluation: { metrics: metrics(), uncertainty: 0.03, conflictOfInterest: "none", outputDigest: contentDigest({ runId, result: "pass" }), notes: "fixed fixture" } });
  const policyApplied = await controller.evaluatePolicy({ scope, requestId: evaluated.requestId, policy: policy(), actor: { type: "user", id: `policy-${runId}` } });
  const approved = await controller.approve({ scope, requestId: policyApplied.requestId, actor: { type: "user", id: `approver-${runId}` }, candidateDigest: policyApplied.candidateDigest, policyDigest: policyApplied.policyDigest });
  const started = await controller.startCanary({ scope, requestId: approved.requestId, actor: { type: "user", id: `operator-${runId}` }, idempotencyKey: `canary-${runId}` });
  const promoted = await controller.recordCanaryObservation({ scope, requestId: approved.requestId, actor: { type: "service", id: `monitor-${runId}` }, metrics: metrics(), idempotencyKey: `promote-${runId}` });
  assert.equal(promoted.request.status, "promoted");
  assert.equal(runtimeAdapter.resolve(scope).digest, approved.candidateDigest);
  const rows = await store.pool.query("SELECT (SELECT count(*)::int FROM governed_promotion_artifacts WHERE tenant_id=$1) AS artifacts, (SELECT count(*)::int FROM governed_promotion_events WHERE request_id=$2) AS events, (SELECT count(*)::int FROM governed_promotion_effects WHERE request_id=$2 AND status='completed') AS effects", [scope.tenantId, request.requestId]);
  assert.ok(rows.rows[0].artifacts >= 6);
  assert.ok(rows.rows[0].events >= 5);
  assert.equal(rows.rows[0].effects, 2);
  const isolated = await controller.createCandidate({ scope: { tenantId: `other-${runId}`, workspaceId: "other-workspace" }, candidate: candidate(), baseline: metrics(), fixtureDataset: { schemaVersion: "fixture/v1", cases: [{ id: "other", input: {}, expected: {} }] }, proposer: { type: "user", id: `other-proposer-${runId}` } });
  await assert.rejects(controller.status({ scope: { tenantId: `other-${runId}`, workspaceId: "other-workspace" }, requestId: request.requestId }), (error) => error.code === "request_not_found");
  assert.ok(isolated.requestId);
  assert.equal(started.request.candidateDigest, approved.candidateDigest);
});

test("promotion authority is separated by role and services cannot acquire approval or autonomous policy authority", options, async (context) => {
  const identities = new IdentityAccessStore({ databaseUrl });
  context.after(async () => identities.pool?.end());
  const tenantId = `promotion-rbac-${runId}`;
  const operatorId = `promotion-operator-${runId}`;
  const approverId = `promotion-approver-${runId}`;
  const qagentId = `qagent-promotion-${runId}`;
  await identities.provisionPrincipal({ id: operatorId, issuer: "test", subject: operatorId, type: "human" });
  await identities.provisionMembership({ principalId: operatorId, tenantId, workspaceId: "runtime", roles: ["operator"] });
  await identities.provisionPrincipal({ id: approverId, issuer: "test", subject: approverId, type: "human" });
  await identities.provisionMembership({ principalId: approverId, tenantId, workspaceId: "runtime", roles: ["approver"] });
  await identities.assertPrincipalPermission({ principalId: operatorId, tenantId, workspaceId: "runtime", permission: "promotion:operate", principalTypes: ["human"] });
  await assert.rejects(identities.assertPrincipalPermission({ principalId: operatorId, tenantId, workspaceId: "runtime", permission: "promotion:approve", principalTypes: ["human"] }), (error) => error.code === "authorization_denied");
  await identities.assertPrincipalPermission({ principalId: approverId, tenantId, workspaceId: "runtime", permission: "promotion:approve", principalTypes: ["human"] });
  await identities.provisionPrincipal({ id: qagentId, issuer: "test", subject: qagentId, type: "service" });
  await identities.provisionMembership({ principalId: qagentId, tenantId, workspaceId: "runtime", serviceScopes: ["promotion:policy"] });
  await assert.rejects(identities.assertPrincipalPermission({ principalId: qagentId, tenantId, workspaceId: "runtime", permission: "promotion:policy", principalTypes: ["service"] }), (error) => error.code === "authorization_denied");
  await assert.rejects(identities.provisionMembership({ principalId: qagentId, tenantId, workspaceId: "approval", serviceScopes: ["promotion:approve"] }));
});
