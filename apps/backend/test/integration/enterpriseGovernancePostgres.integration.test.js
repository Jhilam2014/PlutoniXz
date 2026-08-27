import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PostgresDecisionContinuityStore } from "../../src/decisionContinuityPostgres.js";
import { EnterpriseGovernanceService } from "../../src/enterpriseGovernance.js";

const databaseUrl = process.env.DECISION_CONTINUITY_TEST_DATABASE_URL;
const options = databaseUrl ? {} : { skip: "Set DECISION_CONTINUITY_TEST_DATABASE_URL to run Enterprise BrainX PostgreSQL integration tests." };
const run = `${process.pid}-${Date.now()}`;
const tenantId = `enterprise-governance-postgres-${run}`;
const workspaceId = "enterprise-governance-workspace";
const timestamp = "2026-08-22T10:00:00.000Z";
const actor = { id: "enterprise-governance-operator", type: "human" };
const scope = { tenantId, workspaceId, actor };
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function policy() {
  return {
    enterpriseId: "enterprise-acme",
    policyVersion: `postgres-policy-${run}`,
    controls: {
      budget: { currency: "USD", maxReservationAmount: 5, requireReservation: true },
      dataClassification: { allowed: ["public", "internal", "confidential"], evidenceRequired: true },
      residency: { allowedRegions: ["in"], evidenceRequired: true },
      egress: { allowedDestinations: ["isolated"], evidenceRequired: true },
      retention: { maxDays: 30, evidenceRequired: true },
      transformations: { allowed: ["redact"], evidenceRequired: true, requireSanitizationFor: ["confidential", "restricted"] },
      compliance: { requiredControlIds: [], evidenceRequired: true },
      humanApproval: { requiredFor: ["high", "critical"] }
    },
    evidence: { maxAgeHours: 24, requireAuthorized: true },
    idempotencyKey: `policy-${run}`
  };
}

function evidence(controlIds, id = `evidence-${controlIds.join("-")}-${run}`) {
  return {
    id,
    controlIds,
    status: "verified",
    authorized: true,
    observedAt: timestamp,
    tenantId,
    workspaceId
  };
}

function reuseEvidence() {
  return [
    evidence(["data_classification"]),
    evidence(["residency"]),
    evidence(["egress"]),
    evidence(["retention"]),
    evidence(["transformations"]),
    evidence(["sanitization"], `sanitization-${run}`)
  ];
}

test("PostgreSQL durably projects Enterprise BrainX governance records through migration 011 without tenant leakage", options, async (context) => {
  const store = new PostgresDecisionContinuityStore({ databaseUrl });
  context.after(async () => store.pool?.end());
  const service = new EnterpriseGovernanceService({ store, clock: () => new Date(timestamp) });

  const sourceBinding = await service.bindApplication({
    applicationId: "app-source",
    enterpriseId: "enterprise-acme",
    applicationName: "Source application",
    dataClassification: "internal",
    homeRegion: "in",
    idempotencyKey: `bind-source-${run}`
  }, scope);
  const targetBinding = await service.bindApplication({
    applicationId: "app-target",
    enterpriseId: "enterprise-acme",
    applicationName: "Target application",
    dataClassification: "internal",
    homeRegion: "in",
    idempotencyKey: `bind-target-${run}`
  }, scope);
  assert.equal(sourceBinding.status, "bound");
  assert.equal(targetBinding.status, "bound");

  const createdPolicy = await service.setPolicy(policy(), scope);
  const budget = await service.createBudget({
    budgetKey: `aix-budget-${run}`,
    enterpriseId: "enterprise-acme",
    applicationId: "app-source",
    policySnapshotId: createdPolicy.policy.id,
    currency: "USD",
    limitAmount: 10,
    idempotencyKey: `budget-${run}`
  }, scope);
  const reserved = await service.reserveBudget({
    budgetId: budget.budget.id,
    applicationId: "app-source",
    amount: 2,
    currency: "USD",
    purpose: "aix_model_route",
    policySnapshotId: createdPolicy.policy.id,
    idempotencyKey: `reserve-${run}`
  }, scope);

  const route = await service.recordModelRouteReceipt({
    applicationId: "app-source",
    routeId: `route-${run}`,
    policySnapshotId: createdPolicy.policy.id,
    budgetReservationId: reserved.reservation.id,
    registrationId: `registry-${run}`,
    provider: "openai",
    modelId: "gpt-fixture",
    immutableRevision: "fixture-revision-v1",
    taskRole: "generation",
    status: "routed",
    reasonCodes: ["policy_permitted"],
    eligibleCandidates: [{ registrationId: `registry-${run}`, provider: "openai", modelId: "gpt-fixture", immutableRevision: "fixture-revision-v1", estimatedCost: 2, reasonCodes: ["eligible"] }],
    excludedCandidates: [],
    estimatedCost: 2,
    actualCost: null,
    idempotencyKey: `route-receipt-${run}`
  }, scope);
  const decision = await service.createDecisionContext({
    applicationId: "app-source",
    decisionKey: `decision-${run}`,
    workflowId: `workflow-${run}`,
    decisionType: "generation_path",
    policySnapshotId: createdPolicy.policy.id,
    budgetReservationId: reserved.reservation.id,
    affectedConnectionIds: ["connection-primary"],
    evidenceIds: ["route-validation"],
    paths: [
      { id: "path-proposed", disposition: "proposed", evidenceIds: [] },
      { id: "path-selected", disposition: "selected", evidenceIds: ["route-validation"] }
    ],
    selectedPathId: "path-selected",
    validation: { status: "passed", evidenceIds: ["route-validation"] },
    outcome: "completed",
    impactLevel: "low",
    idempotencyKey: `decision-${run}`
  }, scope);

  const knowledge = await service.registerAgenticXKnowledge({
    applicationId: "app-source",
    knowledgeId: `knowledge-${run}`,
    classification: "internal",
    region: "in",
    digest: hash(`knowledge-${run}`),
    retentionDays: 1,
    transformIds: ["redact"],
    evidenceIds: [`sanitization-${run}`],
    expiresAt: "2026-08-23T10:00:00.000Z",
    idempotencyKey: `knowledge-${run}`
  }, scope);
  const knowledgeReuse = await service.requestKnowledgeReuse({
    sourceApplicationId: "app-source",
    targetApplicationId: "app-target",
    purpose: "agent_reuse",
    policySnapshotId: createdPolicy.policy.id,
    data: {
      classification: "internal",
      region: "in",
      egress: "isolated",
      retentionDays: 1,
      transformations: ["redact"],
      complianceControlIds: []
    },
    evidence: reuseEvidence(),
    knowledgeReferences: [{ id: `knowledge-${run}`, digest: hash(`knowledge-${run}`), classification: "internal" }],
    sanitization: { status: "sanitized", contentIncluded: false, transformIds: ["redact"], evidenceId: `sanitization-${run}` },
    idempotencyKey: `knowledge-reuse-${run}`
  }, scope);
  const gatewayReceipt = await service.recordAgenticXReuseReceipt({
    status: "allowed",
    purpose: "agent_reuse",
    region: "in",
    egress: "isolated",
    transformation: "redact",
    maxClassification: "internal",
    targetApplicationId: "app-target",
    policySnapshotId: createdPolicy.policy.id,
    allowedKnowledgeIds: [knowledge.knowledge.id],
    deniedCandidates: [],
    denialReasons: [],
    policyReceiptIds: [knowledgeReuse.receipt.id],
    idempotencyKey: `agenticx-receipt-${run}`
  }, scope);

  assert.equal(route.receipt.status, "routed");
  assert.equal(decision.decisionContext.selectedPathId, "path-selected");
  assert.equal(knowledgeReuse.status, "allowed");
  assert.equal(gatewayReceipt.receipt.status, "allowed");

  const restartedStore = new PostgresDecisionContinuityStore({ databaseUrl });
  context.after(async () => restartedStore.pool?.end());
  const restarted = new EnterpriseGovernanceService({ store: restartedStore, clock: () => new Date(timestamp) });

  assert.equal((await restarted.listApplicationBindings({}, scope)).length, 2);
  assert.equal((await restarted.getPolicy({ policySnapshotId: createdPolicy.policy.id }, scope)).policyDigest, createdPolicy.policy.policyDigest);
  assert.equal((await restarted.getBudget({ budgetId: budget.budget.id }, scope)).totals.reservedAmount, 2);
  assert.equal((await restarted.listReservations({ budgetId: budget.budget.id }, scope))[0].id, reserved.reservation.id);
  assert.equal((await restarted.listModelRouteReceipts({ routeId: `route-${run}` }, scope))[0].id, route.receipt.id);
  assert.equal((await restarted.listDecisionContexts({ decisionKey: `decision-${run}` }, scope))[0].id, decision.decisionContext.id);
  assert.equal((await restarted.listAgenticXKnowledge({ applicationId: "app-source" }, scope))[0].id, knowledge.knowledge.id);
  const persistedReuse = await restarted.listKnowledgeReuseReceipts({ targetApplicationId: "app-target" }, scope);
  assert.ok(persistedReuse.some((record) => record.id === knowledgeReuse.receipt.id));
  assert.ok(persistedReuse.some((record) => record.id === gatewayReceipt.receipt.id));

  const otherScope = { tenantId: `other-${tenantId}`, workspaceId, actor };
  assert.deepEqual(await restarted.listApplicationBindings({}, otherScope), []);
  await assert.rejects(
    () => restarted.getBudget({ budgetId: budget.budget.id }, otherScope),
    (error) => error.code === "budget_not_found"
  );
  assert.deepEqual(await restarted.listModelRouteReceipts({}, otherScope), []);

  const database = await restartedStore.database();
  const migrations = await database.query(
    "SELECT count(*)::int AS count FROM decision_continuity_schema_migrations WHERE migration_name = '011_enterprise_brainx_governance.sql'"
  );
  assert.equal(migrations.rows[0].count, 1);
  const result = await database.query(
    `SELECT entity_type, count(*)::int AS count
       FROM decision_continuity_current_state
      WHERE tenant_id = $1
      GROUP BY entity_type`,
    [tenantId]
  );
  const counts = Object.fromEntries(result.rows.map((row) => [row.entity_type, row.count]));
  assert.equal(counts.enterprise_governance_binding, 2);
  assert.equal(counts.enterprise_governance_policy, 1);
  assert.equal(counts.enterprise_governance_budget, 1);
  assert.equal(counts.enterprise_governance_reservation, 1);
  assert.equal(counts.enterprise_governance_decision_context, 2);
  assert.equal(counts.enterprise_governance_knowledge_receipt, 1);
  assert.equal(counts.agenticx_knowledge, 1);
  assert.equal(counts.agenticx_reuse_receipt, 1);
  assert.ok(counts.enterprise_governance_idempotency >= 10);
});
