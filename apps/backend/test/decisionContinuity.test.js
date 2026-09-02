import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDecisionContinuityStore, evaluateConstraintExpression } from "../src/decisionContinuity.js";
import { buildDecisionContinuityGraph, compareDecisionBranches } from "../src/decisionContinuityProjection.js";

async function createStore(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-decision-continuity-"));
  context.after(async () => fs.rm(root, { recursive: true, force: true }));
  return createDecisionContinuityStore({
    root,
    reconsiderationCooldownMs: 0,
    maxReconsiderationsPerTenantPerDay: 5
  });
}

function branchInput(overrides = {}) {
  return {
    workspaceId: "workspace-a",
    decisionId: "decision-ui-retry",
    objective: "Reduce repeated user retry paths without adding duplicate controls.",
    candidate: { approach: "guided recovery" },
    evidence: [{ id: "evidence-1", type: "test", source: "unit-test" }],
    producedBy: { agentId: "planner-agent", source: "planner" },
    ...overrides
  };
}

const tenantA = "tenant-a";
const tenantB = "tenant-b";
const operator = { type: "user", id: "operator-a" };
const trustedService = { type: "service", id: "condition-ingestor" };

test("persists an immutable branch lineage with evidence and a journaled disposition", async (context) => {
  const store = await createStore(context);
  const root = await store.createBranch(branchInput(), { tenantId: tenantA, actor: operator });
  const child = await store.createBranch(branchInput({ parentBranchId: root.id, candidate: { approach: "guided recovery with retry diagnostics" } }), { tenantId: tenantA, actor: operator });
  const deferred = await store.setDisposition({ branchId: child.id, status: "deferred", reason: "Await production telemetry." }, { tenantId: tenantA, actor: operator });

  assert.equal(child.rootLineageId, root.id);
  assert.equal(child.parentBranchId, root.id);
  assert.equal(deferred.status, "deferred");
  assert.equal(deferred.revision, 2);
  assert.equal(deferred.evidence[0].id, "evidence-1");
  const events = await store.listEvents({ tenantId: tenantA, branchId: child.id });
  assert.ok(events.some((event) => event.type === "branch.created"));
  assert.ok(events.some((event) => event.type === "branch.disposition_set"));
  const disposition = events.find((event) => event.type === "branch.disposition_set");
  assert.equal(disposition.payload.before.revision, 1);
  assert.equal(disposition.payload.after.revision, 2);
  await assert.rejects(
    store.setDisposition({ branchId: child.id, status: "archived", expectedRevision: 1 }, { tenantId: tenantA, actor: operator }),
    /changed before/i
  );
});

test("reopens the local snapshot without rewriting its append-only branch history", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-decision-continuity-restart-"));
  context.after(async () => fs.rm(root, { recursive: true, force: true }));
  const store = createDecisionContinuityStore({ root });
  const branch = await store.createBranch(branchInput(), { tenantId: tenantA, actor: operator });
  await store.setDisposition({ branchId: branch.id, status: "deferred", reason: "Await restart characterization." }, { tenantId: tenantA, actor: operator });

  const journalPath = path.join(root, "runtime", "decision-continuity", "events", "domain-events.jsonl");
  const beforeRestartJournal = await fs.readFile(journalPath, "utf8");
  const restartedStore = createDecisionContinuityStore({ root });
  const reopened = await restartedStore.getBranch(branch.id, { tenantId: tenantA });
  const history = await restartedStore.listEvents({ tenantId: tenantA, branchId: branch.id });
  const afterRestartJournal = await fs.readFile(journalPath, "utf8");

  assert.equal(reopened.status, "deferred");
  assert.equal(reopened.revision, 2);
  assert.equal(afterRestartJournal, beforeRestartJournal);
  assert.deepEqual(history.map((event) => event.type).sort(), ["branch.created", "branch.disposition_set"]);
});

test("compound constraints fail closed and condition replay remains idempotent", async (context) => {
  const store = await createStore(context);
  const branch = await store.createBranch(branchInput({
    constraintExpression: { all: [{ constraintId: "capacity-ready" }, { constraintId: "security-reviewed" }] },
    revisitTriggers: ["capacity-ready", "security-reviewed"]
  }), { tenantId: tenantA, actor: operator });
  await store.setDisposition({ branchId: branch.id, status: "deferred", reason: "Blocked by capacity and security." }, { tenantId: tenantA, actor: operator });

  const first = await store.ingestConditionEvent({
    eventId: "condition-1", workspaceId: "workspace-a", source: "trusted-monitor",
    observations: [{ constraintId: "capacity-ready", state: "cleared", source: "trusted-monitor", trusted: true, authorized: true }]
  }, { tenantId: tenantA, actor: trustedService });
  assert.equal(first.requests.length, 0);
  assert.equal(first.blocked[0].reason, "unknown");

  const second = await store.ingestConditionEvent({
    eventId: "condition-2", workspaceId: "workspace-a", source: "trusted-monitor",
    observations: [{ constraintId: "security-reviewed", state: "cleared", source: "trusted-monitor", trusted: true, authorized: true }]
  }, { tenantId: tenantA, actor: trustedService });
  assert.equal(second.requests.length, 1);
  const replay = await store.ingestConditionEvent({
    eventId: "condition-2", workspaceId: "workspace-a", source: "trusted-monitor",
    observations: [{ constraintId: "security-reviewed", state: "cleared", source: "trusted-monitor", trusted: true, authorized: true }]
  }, { tenantId: tenantA, actor: trustedService });
  assert.equal(replay.idempotent, true);
  assert.equal((await store.listReconsiderations({ tenantId: tenantA })).length, 1);
});

test("untrusted, expired, and unknown observations cannot reactivate a branch", async (context) => {
  const store = await createStore(context);
  const branch = await store.createBranch(branchInput({ constraintExpression: { constraintId: "safety-clearance" } }), { tenantId: tenantA, actor: operator });
  await store.setDisposition({ branchId: branch.id, status: "deferred" }, { tenantId: tenantA, actor: operator });
  const result = await store.ingestConditionEvent({
    eventId: "unsafe-clearance", workspaceId: "workspace-a", source: "spoofed-monitor",
    observations: [{ constraintId: "safety-clearance", state: "cleared", source: "spoofed-monitor", trusted: false, authorized: false, expiresAt: "2020-01-01T00:00:00.000Z" }]
  }, { tenantId: tenantA, actor: trustedService });
  assert.equal(result.requests.length, 0);
  assert.equal((await store.getBranch(branch.id, { tenantId: tenantA })).status, "deferred");
  assert.equal(evaluateConstraintExpression({ constraintId: "missing" }, {}).state, "unknown");
});

test("evaluation, independent approval, and bounded canary gate selection and preserve the selected alternative", async (context) => {
  const store = await createStore(context);
  const selectedAlternative = await store.createBranch(branchInput({
    decisionId: "decision-alternative", producedBy: { agentId: "alt-producer" },
    constraintExpression: { constraintId: "alternative-evidence" }, revisitTriggers: ["alternative-evidence"]
  }), { tenantId: tenantA, actor: operator });
  await store.setDisposition({ branchId: selectedAlternative.id, status: "deferred" }, { tenantId: tenantA, actor: operator });
  const selectedCondition = await store.ingestConditionEvent({
    eventId: "alternative-evidence-event", workspaceId: "workspace-a", source: "trusted-monitor",
    observations: [{ constraintId: "alternative-evidence", state: "cleared", source: "trusted-monitor", trusted: true, authorized: true }]
  }, { tenantId: tenantA, actor: trustedService });
  const selectedRequestId = selectedCondition.requests[0].id;
  await store.recordEvaluation({
    reconsiderationId: selectedRequestId, evaluatorId: "alternative-evaluator", reviewerId: "alternative-reviewer", validator: { status: "passed", deterministic: true }
  }, { tenantId: tenantA, actor: trustedService });
  await store.recordPolicyDecision({ reconsiderationId: selectedRequestId, policyVersion: "policy-v1", decision: "permitted", reasons: ["low-risk fixture"] }, { tenantId: tenantA, actor: trustedService });
  await store.recordApproval({ reconsiderationId: selectedRequestId, decision: "approved", approverId: "alternative-approver" }, { tenantId: tenantA, actor: { type: "user", id: "alternative-approver" } });
  const canary = await store.startCanary({ reconsiderationId: selectedRequestId, trafficPercent: 5, durationMinutes: 15, monitoringWindowMinutes: 15, successCriteria: ["error rate stays below baseline"], failureCriteria: ["error rate exceeds baseline by 25%"], rollbackPlan: "Restore selected predecessor and stop traffic." }, { tenantId: tenantA, actor: trustedService });
  await store.recordCanaryOutcome({ canaryId: canary.id, status: "passed", metrics: { errorRate: 0.01 } }, { tenantId: tenantA, actor: trustedService });
  assert.equal((await store.getBranch(selectedAlternative.id, { tenantId: tenantA })).status, "selected");

  const candidate = await store.createBranch(branchInput({
    decisionId: "decision-alternative",
    constraintExpression: { constraintId: "new-evidence" },
    revisitTriggers: ["new-evidence"]
  }), { tenantId: tenantA, actor: operator });
  await store.setDisposition({ branchId: candidate.id, status: "deferred" }, { tenantId: tenantA, actor: operator });
  const condition = await store.ingestConditionEvent({
    eventId: "new-evidence-event", workspaceId: "workspace-a", source: "trusted-monitor",
    observations: [{ constraintId: "new-evidence", state: "cleared", source: "trusted-monitor", trusted: true, authorized: true }]
  }, { tenantId: tenantA, actor: trustedService });
  const requestId = condition.requests[0].id;

  const failed = await store.recordEvaluation({
    reconsiderationId: requestId, evaluatorId: "evaluation-agent", reviewerId: "independent-reviewer", validator: { status: "failed", deterministic: true, checks: ["regression"] }
  }, { tenantId: tenantA, actor: trustedService });
  assert.equal(failed.status, "deferred");
  assert.equal((await store.getBranch(candidate.id, { tenantId: tenantA })).status, "deferred");
  assert.equal((await store.getBranch(selectedAlternative.id, { tenantId: tenantA })).status, "selected");

  await assert.rejects(
    store.recordEvaluation({ reconsiderationId: requestId, evaluatorId: "evaluation-agent", reviewerId: "evaluation-agent", validator: { status: "passed", deterministic: true } }, { tenantId: tenantA, actor: trustedService }),
    /not awaiting evaluation|independent/i
  );
});

test("tenant scoping prevents cross-tenant reads and branch mutation", async (context) => {
  const store = await createStore(context);
  const branch = await store.createBranch(branchInput(), { tenantId: tenantA, actor: operator });
  assert.equal((await store.listBranches({ tenantId: tenantB })).length, 0);
  await assert.rejects(store.getBranch(branch.id, { tenantId: tenantB }), /tenant scope/i);
  await assert.rejects(
    store.setDisposition({ branchId: branch.id, status: "deferred" }, { tenantId: tenantB, actor: { id: "operator-b" } }),
    /tenant scope/i
  );
});

test("a severe canary regression records a rollback and retains branch history", async (context) => {
  const store = await createStore(context);
  const branch = await store.createBranch(branchInput({
    constraintExpression: { constraintId: "rollback-evidence" }, revisitTriggers: ["rollback-evidence"]
  }), { tenantId: tenantA, actor: operator });
  await store.setDisposition({ branchId: branch.id, status: "deferred" }, { tenantId: tenantA, actor: operator });
  const condition = await store.ingestConditionEvent({
    eventId: "rollback-evidence-event", workspaceId: "workspace-a", source: "trusted-monitor",
    observations: [{ constraintId: "rollback-evidence", state: "cleared", source: "trusted-monitor", trusted: true, authorized: true }]
  }, { tenantId: tenantA, actor: trustedService });
  const requestId = condition.requests[0].id;
  await store.recordEvaluation({ reconsiderationId: requestId, evaluatorId: "evaluator", reviewerId: "reviewer", validator: { status: "passed", deterministic: true } }, { tenantId: tenantA, actor: trustedService });
  await store.recordPolicyDecision({ reconsiderationId: requestId, policyVersion: "policy-v1", decision: "permitted" }, { tenantId: tenantA, actor: trustedService });
  await store.recordApproval({ reconsiderationId: requestId, decision: "approved", approverId: "approver" }, { tenantId: tenantA, actor: { type: "user", id: "approver" } });
  const canary = await store.startCanary({ reconsiderationId: requestId, trafficPercent: 5, durationMinutes: 5, monitoringWindowMinutes: 5, successCriteria: ["No new critical errors"], failureCriteria: ["Any new critical error"], rollbackPlan: "Return traffic to the prior selected branch." }, { tenantId: tenantA, actor: operator });
  const outcome = await store.recordCanaryOutcome({ canaryId: canary.id, status: "passed", severeRegression: true, metrics: { criticalFailures: 1 } }, { tenantId: tenantA, actor: trustedService });
  assert.equal(outcome.status, "rolled_back");
  assert.equal((await store.getBranch(branch.id, { tenantId: tenantA })).status, "deferred");
  const events = await store.listEvents({ tenantId: tenantA, branchId: branch.id });
  assert.ok(events.some((event) => event.type === "branch.rolled_back"));
  assert.ok(events.some((event) => event.type === "branch.created"));
});

test("graph projections are rebuildable and comparison keeps materially distinct branches", async (context) => {
  const store = await createStore(context);
  const root = await store.createBranch(branchInput({
    objective: "Improve operator retry diagnostics", constraintDefinitions: [{ id: "security-review", version: "1", type: "security", scope: "workspace", field: "security.review", operator: "approved" }],
    decisionSignature: { version: "v1", structuralFingerprint: "implementation-a" }
  }), { tenantId: tenantA, actor: operator });
  const child = await store.createBranch(branchInput({
    parentBranchId: root.id, objective: "Improve retry diagnostics with guided recovery", candidate: { approach: "guided-recovery" },
    decisionSignature: { version: "v1", structuralFingerprint: "implementation-b" }
  }), { tenantId: tenantA, actor: operator });
  const [branches, events] = await Promise.all([
    store.listBranches({ tenantId: tenantA }),
    store.listEvents({ tenantId: tenantA })
  ]);
  const graph = buildDecisionContinuityGraph({ branches, events });
  assert.ok(graph.nodes.some((node) => node.id === `branch:${root.id}` && node.authoritative));
  assert.ok(graph.edges.some((edge) => edge.kind === "lineage" && edge.source === `branch:${root.id}` && edge.target === `branch:${child.id}`));
  const comparison = compareDecisionBranches(root, child);
  assert.equal(comparison.signals.semantic.status, "unavailable");
  assert.equal(comparison.signals.structural.status, "distinct");
  assert.equal(comparison.relation, "materially_distinct_or_unproven");
});
