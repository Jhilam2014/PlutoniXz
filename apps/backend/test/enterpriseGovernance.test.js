import assert from "node:assert/strict";
import test from "node:test";
import {
  EnterpriseGovernanceError,
  EnterpriseGovernanceService
} from "../src/enterpriseGovernance.js";
import { AgenticXKnowledgeGateway } from "../src/agenticXKnowledge.js";

const tenantId = "tenant-acme";
const workspaceId = "workspace-main";
const actor = { id: "operator-1", type: "human" };
const scope = { tenantId, workspaceId, actor };
const timestamp = "2026-08-22T10:00:00.000Z";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MemoryDecisionContinuityStore {
  constructor() {
    this.state = {};
    this.events = [];
    this.tail = Promise.resolve();
  }

  async readState() {
    return clone(this.state);
  }

  async mutate(work) {
    const run = this.tail.then(async () => {
      const draft = clone(this.state);
      const events = [];
      const result = await work(draft, events);
      this.state = draft;
      this.events.push(...events);
      return result;
    });
    this.tail = run.catch(() => {});
    return run;
  }
}

function policy({ enterpriseId = "acme", version = "policy-v1", key = `policy-${version}` } = {}) {
  return {
    enterpriseId,
    policyVersion: version,
    controls: {
      budget: { currency: "USD", maxReservationAmount: 7, requireReservation: true },
      dataClassification: { allowed: ["public", "internal", "confidential"], evidenceRequired: true },
      residency: { allowedRegions: ["in"], evidenceRequired: true },
      egress: { allowedDestinations: ["isolated", "approved-feed"], evidenceRequired: true },
      retention: { maxDays: 30, evidenceRequired: true },
      transformations: { allowed: ["redact", "aggregate", "summary"], evidenceRequired: true, requireSanitizationFor: ["confidential", "restricted"] },
      compliance: { requiredControlIds: [], evidenceRequired: true },
      humanApproval: { requiredFor: ["high", "critical"] }
    },
    evidence: { maxAgeHours: 24, requireAuthorized: true },
    idempotencyKey: key
  };
}

function evidence(controlIds, overrides = {}) {
  return {
    id: overrides.id || `evidence-${controlIds.join("-")}`,
    controlIds,
    status: "verified",
    authorized: true,
    observedAt: timestamp,
    tenantId,
    workspaceId,
    ...overrides
  };
}

function evaluationInput({ applicationId = "app-source", policySnapshotId, budgetId, amount = 2, evidenceRows } = {}) {
  return {
    applicationId,
    action: "aix_model_route",
    policySnapshotId,
    data: {
      classification: "internal",
      region: "in",
      egress: "isolated",
      retentionDays: 1,
      transformations: ["redact"],
      complianceControlIds: [],
      commercialUse: true
    },
    evidence: evidenceRows || [
      evidence(["data_classification"]),
      evidence(["residency"]),
      evidence(["egress"]),
      evidence(["retention"]),
      evidence(["transformations"])
    ],
    budget: { budgetId, amount, currency: "USD" },
    impactLevel: "low"
  };
}

async function fixture() {
  const store = new MemoryDecisionContinuityStore();
  const service = new EnterpriseGovernanceService({ store, clock: () => new Date(timestamp) });
  const bound = await service.bindApplication({ applicationId: "app-source", enterpriseId: "acme", dataClassification: "internal", homeRegion: "in", idempotencyKey: "bind-source" }, scope);
  await service.bindApplication({ applicationId: "app-target", enterpriseId: "acme", dataClassification: "internal", homeRegion: "in", idempotencyKey: "bind-target" }, scope);
  const createdPolicy = await service.setPolicy(policy(), scope);
  const createdBudget = await service.createBudget({ budgetKey: "primary-budget", enterpriseId: "acme", applicationId: "app-source", policySnapshotId: createdPolicy.policy.id, currency: "USD", limitAmount: 10, idempotencyKey: "create-budget" }, scope);
  return { store, service, binding: bound.binding, policy: createdPolicy.policy, budget: createdBudget.budget };
}

test("uses immutable application bindings and versioned policy snapshots while denying stale evidence", async () => {
  const { service, policy: policySnapshot, budget } = await fixture();
  const permitted = await service.evaluatePolicy(evaluationInput({ policySnapshotId: policySnapshot.id, budgetId: budget.id }), scope);
  assert.equal(permitted.status, "permitted");
  assert.equal(permitted.allowed, true);
  assert.equal(permitted.policySnapshotId, policySnapshot.id);

  const stale = await service.evaluatePolicy(evaluationInput({
    policySnapshotId: policySnapshot.id,
    budgetId: budget.id,
    evidenceRows: [
      evidence(["data_classification"], { observedAt: "2026-08-20T00:00:00.000Z" }),
      evidence(["residency"]), evidence(["egress"]), evidence(["retention"]), evidence(["transformations"])
    ]
  }), scope);
  assert.equal(stale.allowed, false);
  assert.ok(stale.reasonCodes.includes("evidence_data_classification_required"));

  await assert.rejects(
    () => service.bindApplication({ applicationId: "app-source", enterpriseId: "other", idempotencyKey: "bind-source-other" }, scope),
    (error) => error instanceof EnterpriseGovernanceError && error.code === "application_binding_immutable"
  );
  await assert.rejects(
    () => service.setPolicy({ ...policy({ version: "policy-v1", key: "policy-v1-change" }), controls: { ...policy().controls, egress: { allowedDestinations: ["other"], evidenceRequired: true } } }, scope),
    (error) => error instanceof EnterpriseGovernanceError && error.code === "policy_version_immutable"
  );
});

test("atomically reserves, settles with provider evidence, releases, and idempotently replays budgets", async () => {
  const { service, policy: policySnapshot, budget } = await fixture();
  const requests = ["reserve-a", "reserve-b"].map((idempotencyKey) => service.reserveBudget({
    budgetId: budget.id,
    applicationId: "app-source",
    amount: 6,
    currency: "USD",
    purpose: "aix_model_route",
    policySnapshotId: policySnapshot.id,
    idempotencyKey
  }, scope));
  const results = await Promise.allSettled(requests);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const reservation = results.find((result) => result.status === "fulfilled").value.reservation;
  assert.equal(reservation.estimatedAmount, 6);

  const replay = await service.reserveBudget({
    budgetId: budget.id, applicationId: "app-source", amount: 6, currency: "USD", purpose: "aix_model_route", policySnapshotId: policySnapshot.id, idempotencyKey: results.find((result) => result.status === "fulfilled").value.reservation.id === reservation.id ? "reserve-a" : "reserve-b"
  }, scope);
  assert.equal(replay.status, "idempotent");

  await assert.rejects(
    () => service.settleBudget({ reservationId: reservation.id, actualAmount: 4, currency: "USD", usageEvidence: { id: "usage-invalid", source: "provider", status: "unknown", authorized: true, observedAt: timestamp }, idempotencyKey: "settle-invalid" }, scope),
    (error) => error instanceof EnterpriseGovernanceError && error.code === "usage_evidence_required"
  );
  const settled = await service.settleBudget({ reservationId: reservation.id, actualAmount: 4, currency: "USD", usageEvidence: { id: "usage-verified", source: "provider", status: "verified", authorized: true, observedAt: timestamp }, idempotencyKey: "settle-verified" }, scope);
  assert.equal(settled.status, "settled");
  assert.equal(settled.reservation.actualAmount, 4);
  assert.equal(settled.budget.totals.availableAmount, 6);

  const next = await service.reserveBudget({ budgetId: budget.id, applicationId: "app-source", amount: 6, currency: "USD", purpose: "research_fetch", policySnapshotId: policySnapshot.id, idempotencyKey: "reserve-after-settlement" }, scope);
  const released = await service.releaseBudget({ reservationId: next.reservation.id, reason: "research_not_fetched", idempotencyKey: "release-after-settlement" }, scope);
  assert.equal(released.status, "released");
  assert.equal("reason" in released.reservation, false);
});

test("records DecisionX and AIX route receipts without auto-promotion or raw model data", async () => {
  const { service, policy: policySnapshot, budget } = await fixture();
  const reservation = await service.reserveBudget({ budgetId: budget.id, applicationId: "app-source", amount: 2, currency: "USD", purpose: "aix_model_route", policySnapshotId: policySnapshot.id, idempotencyKey: "receipt-reserve" }, scope);
  const route = await service.recordModelRouteReceipt({
    applicationId: "app-source",
    routeId: "route-none",
    policySnapshotId: null,
    budgetReservationId: null,
    taskRole: "generation",
    status: "no_eligible_model",
    reasonCodes: ["no_eligible_model"],
    estimatedCost: 0,
    actualCost: null,
    idempotencyKey: "route-none-receipt"
  }, scope);
  assert.equal(route.receipt.status, "no_eligible_model");
  assert.equal(route.receipt.provider, null);

  const context = await service.recordDecisionContext({
    applicationId: "app-source",
    decisionKey: "decision-1",
    workflowId: "workflow-1",
    decisionType: "generation_path",
    policySnapshotId: policySnapshot.id,
    budgetReservationId: reservation.reservation.id,
    affectedConnectionIds: ["connection-1"],
    evidenceIds: ["approval-evidence"],
    paths: [
      { id: "path-candidate", disposition: "deferred", evidenceIds: [] },
      { id: "path-selected", disposition: "selected", evidenceIds: ["approval-evidence"] }
    ],
    selectedPathId: "path-selected",
    validation: { status: "passed", evidenceIds: ["validation-evidence"] },
    outcome: "completed",
    impactLevel: "high",
    approval: { approved: true, approverId: "operator-1", approvedAt: timestamp, evidenceId: "approval-evidence" },
    idempotencyKey: "decision-1-record"
  }, scope);
  assert.equal(context.decisionContext.selectedPathId, "path-selected");
  assert.equal((await service.listModelRouteReceipts({}, scope)).length, 1);
  assert.equal((await service.listDecisionContexts({}, scope)).length, 1);
});

test("shares only registered sanitized AgenticX knowledge within an enterprise and records denied access", async () => {
  const { service, policy: policySnapshot } = await fixture();
  const knowledgeDigest = "a".repeat(64);
  await service.registerAgenticXKnowledge({
    applicationId: "app-source", knowledgeId: "knowledge-1", classification: "internal", region: "in", digest: knowledgeDigest,
    retentionDays: 1, transformIds: ["redact"], evidenceIds: ["sanitization-evidence"], idempotencyKey: "knowledge-register"
  }, scope);
  const receipt = await service.requestKnowledgeReuse({
    sourceApplicationId: "app-source", targetApplicationId: "app-target", purpose: "agent_reuse", policySnapshotId: policySnapshot.id,
    data: { classification: "internal", region: "in", egress: "isolated", retentionDays: 1, transformations: ["redact"], complianceControlIds: [] },
    evidence: [
      evidence(["data_classification"]), evidence(["residency"]), evidence(["egress"]), evidence(["retention"]), evidence(["transformations"]), evidence(["sanitization"], { id: "sanitization-evidence" })
    ],
    knowledgeReferences: [{ id: "knowledge-1", digest: knowledgeDigest, classification: "internal" }],
    sanitization: { status: "sanitized", contentIncluded: false, transformIds: ["redact"], evidenceId: "sanitization-evidence" },
    idempotencyKey: "knowledge-share"
  }, scope);
  assert.equal(receipt.status, "allowed");
  assert.equal("content" in receipt.receipt.knowledgeReferences[0], false);

  await service.bindApplication({ applicationId: "app-other", enterpriseId: "other", dataClassification: "internal", homeRegion: "in", idempotencyKey: "bind-other" }, scope);
  await service.setPolicy(policy({ enterpriseId: "other", version: "policy-other", key: "policy-other" }), scope);
  const denied = await service.requestKnowledgeReuse({
    sourceApplicationId: "app-source", targetApplicationId: "app-other", purpose: "agent_reuse", policySnapshotId: "enterprise_policy_missing",
    data: { classification: "internal", region: "in", egress: "isolated", retentionDays: 1, transformations: ["redact"], complianceControlIds: [] },
    evidence: [evidence(["data_classification"]), evidence(["residency"]), evidence(["egress"]), evidence(["retention"]), evidence(["transformations"]), evidence(["sanitization"], { id: "sanitization-evidence" })],
    knowledgeReferences: [{ id: "knowledge-1", digest: knowledgeDigest, classification: "internal" }],
    sanitization: { status: "sanitized", contentIncluded: false, transformIds: ["redact"], evidenceId: "sanitization-evidence" },
    idempotencyKey: "knowledge-cross-enterprise"
  }, scope);
  assert.equal(denied.status, "denied");
  assert.ok(denied.receipt.reasonCodes.includes("cross_enterprise_knowledge_denied"));
  assert.equal((await service.listKnowledgeReuseReceipts({}, scope)).length, 2);
});

test("persists bounded sanitized AgenticX gateway records and permits an authorized tenant-wide reuse receipt", async () => {
  const { service, policy: policySnapshot } = await fixture();
  const remoteScope = { tenantId, workspaceId: "workspace-remote", actor };
  await service.bindApplication({ applicationId: "app-remote", enterpriseId: "acme", dataClassification: "internal", homeRegion: "in", idempotencyKey: "bind-remote" }, remoteScope);
  const gatewayKnowledge = await service.registerAgenticXKnowledge({
    id: "ak-remote-1",
    tenantId,
    workspaceId: "workspace-remote",
    sourceId: "source-remote",
    sourceApplicationId: "app-remote",
    version: "v1",
    summary: "Sanitized reusable architecture summary.",
    contentDigest: "b".repeat(64),
    sanitized: true,
    immutableFingerprint: "c".repeat(64),
    classification: "internal",
    region: "in",
    allowedPurposes: ["agent_reuse"],
    allowedTransformations: ["redact"],
    retention: { expiresAt: "2026-08-23T10:00:00.000Z" },
    tags: ["architecture"]
  }, remoteScope);
  assert.equal(gatewayKnowledge.knowledge.id, "ak-remote-1");
  assert.equal(gatewayKnowledge.knowledge.contentDigest, "b".repeat(64));
  assert.equal((await service.listAgenticXKnowledge({ tenantId, workspaceId: "workspace-remote" }, remoteScope))[0].summary, "Sanitized reusable architecture summary.");

  const shared = await service.requestKnowledgeReuse({
    sourceApplicationId: "app-remote", targetApplicationId: "app-target", purpose: "agent_reuse", policySnapshotId: policySnapshot.id,
    data: { classification: "internal", region: "in", egress: "isolated", retentionDays: 1, transformations: ["redact"], complianceControlIds: [] },
    evidence: [
      evidence(["data_classification"]), evidence(["residency"]), evidence(["egress"]), evidence(["retention"]), evidence(["transformations"]), evidence(["sanitization"], { id: "remote-sanitization" })
    ],
    knowledgeReferences: [{ id: "ak-remote-1", digest: "b".repeat(64), classification: "internal" }],
    sanitization: { status: "sanitized", contentIncluded: false, transformIds: ["redact"], evidenceId: "remote-sanitization" },
    idempotencyKey: "remote-share"
  }, scope);
  assert.equal(shared.status, "allowed");
  assert.equal(shared.receipt.sourceWorkspaceId, "workspace-remote");

  const retrievalInput = {
    targetApplicationId: "app-target",
    purpose: "agent_reuse",
    policySnapshotId: policySnapshot.id,
    data: { classification: "internal", region: "in", egress: "isolated", retentionDays: 1, transformations: ["redact"], complianceControlIds: [] },
    evidence: [
      evidence(["data_classification"]), evidence(["residency"]), evidence(["egress"]), evidence(["retention"]), evidence(["transformations"]), evidence(["sanitization"], { id: "remote-retrieval-sanitization" })
    ],
    sanitization: { status: "sanitized", contentIncluded: false, transformIds: ["redact"], evidenceId: "remote-retrieval-sanitization" },
    idempotencyKey: "remote-tenant-retrieval"
  };
  const retrieved = await service.retrieveAgenticXKnowledge(retrievalInput, scope);
  assert.equal(retrieved.status, "allowed");
  assert.equal(retrieved.knowledge.length, 1);
  assert.equal(retrieved.knowledge[0].summary, "Sanitized reusable architecture summary.");
  assert.equal(retrieved.knowledge[0].workspaceId, "workspace-remote");
  assert.equal(retrieved.receipt.status, "allowed");
  assert.ok(retrieved.receipts.every((receipt) => receipt.status === "allowed"));

  const denied = await service.retrieveAgenticXKnowledge({
    ...retrievalInput,
    data: { ...retrievalInput.data, egress: "unapproved-egress" },
    idempotencyKey: "remote-tenant-retrieval-denied"
  }, scope);
  assert.equal(denied.status, "denied");
  assert.deepEqual(denied.knowledge, []);
  assert.deepEqual(denied.receipts, []);
  assert.equal(JSON.stringify(denied).includes("ak-remote-1"), false);
  assert.equal(JSON.stringify(denied).includes("Sanitized reusable architecture summary."), false);
  const receipts = await service.listKnowledgeReuseReceipts({ targetApplicationId: "app-target" }, scope);
  assert.ok(receipts.some((receipt) => receipt.recordType === "agenticx_gateway_reuse_receipt"));

  await assert.rejects(
    () => service.registerAgenticXKnowledge({ ...gatewayKnowledge.knowledge, id: "ak-secret", sourceId: "source-secret", summary: "api_key=not-safe", contentDigest: "d".repeat(64), immutableFingerprint: "e".repeat(64) }, remoteScope),
    (error) => error instanceof EnterpriseGovernanceError && error.code === "agenticx_summary_denied"
  );
});

test("accepts the AgenticX gateway's sanitized durable registration contract", async () => {
  const { service } = await fixture();
  const input = {
    tenantId,
    workspaceId,
    sourceId: "gateway-source",
    sourceApplicationId: "app-source",
    version: "v1",
    summary: "Safe bounded summary retained for an authorized future reuse.",
    classification: "internal",
    region: "in",
    allowedPurposes: ["agent_reuse"],
    allowedTransformations: ["summary"],
    retention: { expiresAt: "2026-08-23T10:00:00.000Z" },
    tags: ["architecture"],
    idempotencyKey: "gateway-register"
  };
  const firstGateway = new AgenticXKnowledgeGateway({ governance: service, clock: () => new Date(timestamp) });
  const first = await firstGateway.register(input, scope);
  assert.equal(first.status, "registered");
  assert.equal(first.knowledge.sanitized, true);
  assert.ok(first.knowledge.contentDigest);

  const restartedGateway = new AgenticXKnowledgeGateway({ governance: service, clock: () => new Date(timestamp) });
  const replay = await restartedGateway.register(input, scope);
  assert.equal(replay.status, "idempotent");
  assert.equal(replay.knowledge.id, first.knowledge.id);
  assert.equal(replay.knowledge.summary, first.knowledge.summary);
});

test("the AgenticX gateway uses the authority-only tenant retrieval seam before prompt assembly", async () => {
  const { service, policy: policySnapshot } = await fixture();
  const remoteScope = { tenantId, workspaceId: "workspace-remote", actor };
  await service.bindApplication({
    applicationId: "app-remote-gateway",
    enterpriseId: "acme",
    dataClassification: "internal",
    homeRegion: "in",
    idempotencyKey: "bind-remote-gateway"
  }, remoteScope);

  const sourceGateway = new AgenticXKnowledgeGateway({
    governance: service,
    config: { enabled: true },
    clock: () => new Date(timestamp)
  });
  await sourceGateway.register({
    tenantId,
    workspaceId: "workspace-remote",
    sourceId: "remote-gateway-source",
    sourceApplicationId: "app-remote-gateway",
    version: "v1",
    summary: "Sanitized architecture context that may be reused after authorization.",
    classification: "internal",
    region: "in",
    allowedPurposes: ["application_development"],
    allowedTransformations: ["summary"],
    retention: { expiresAt: "2026-08-23T10:00:00.000Z" },
    tags: ["architecture"]
  }, remoteScope);

  const targetGateway = new AgenticXKnowledgeGateway({
    governance: service,
    config: { enabled: true },
    clock: () => new Date(timestamp)
  });
  const result = await targetGateway.retrieve({
    tenantId,
    workspaceId,
    purpose: "application_development",
    region: "in",
    egress: "isolated",
    maxClassification: "internal",
    transformation: "summary",
    retentionDays: 1,
    targetApplicationId: "app-target",
    policySnapshotId: policySnapshot.id,
    evidence: [
      evidence(["data_classification"]), evidence(["residency"]), evidence(["egress"]), evidence(["retention"]), evidence(["transformations"]), evidence(["sanitization"], { id: "gateway-retrieval-sanitization" })
    ],
    idempotencyKey: "gateway-tenant-wide-retrieval"
  });

  assert.equal(result.status, "allowed");
  assert.equal(result.knowledge.length, 1);
  assert.equal(result.knowledge[0].summary, "Sanitized architecture context that may be reused after authorization.");
  assert.equal("workspaceId" in result.knowledge[0], false);
  assert.ok(result.receipt.policyReceiptIds.length >= 2);
  assert.equal(result.receipt.persistence, "governance");
});
