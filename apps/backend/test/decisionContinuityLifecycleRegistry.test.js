import assert from "node:assert/strict";
import test from "node:test";
import {
  DECISION_CONTINUITY_LIFECYCLE_ROUTES,
  assertDecisionContinuityHttpSecurityCoverage,
  assertDecisionContinuityLifecycleCoverage,
  decisionContinuityHttpSecurityMatrix
} from "../src/decisionContinuityLifecycleRegistry.js";
import { DecisionContinuityWorkflowQueue } from "../src/decisionContinuityWorkflow.js";

test("lifecycle registry inventories every decision-continuity endpoint with classification and test linkage", () => {
  const entries = Object.entries(DECISION_CONTINUITY_LIFECYCLE_ROUTES);
  assert.equal(entries.length, 19);
  assert.equal(entries.filter(([, route]) => route.kind === "read_only").length, 10);
  assert.equal(entries.filter(([, route]) => route.kind === "durably_asynchronous").length, 8);
  assert.equal(entries.filter(([, route]) => route.kind === "transactionally_synchronous").length, 1);
  assert.deepEqual(assertDecisionContinuityLifecycleCoverage(entries.map(([key, route]) => ({ key, method: route.method, path: route.path }))), { inventory: 19, registered: 19 });
  const matrix = decisionContinuityHttpSecurityMatrix();
  assert.deepEqual(assertDecisionContinuityHttpSecurityCoverage(matrix), { inventory: 19, matrixCases: 19 });
  assert.throws(() => assertDecisionContinuityHttpSecurityCoverage(matrix.slice(1)), /missing routes/i);
  assert.throws(() => assertDecisionContinuityHttpSecurityCoverage([...matrix, matrix[0]]), /more than once/i);
  assert.throws(() => assertDecisionContinuityLifecycleCoverage([{ key: "unknown", method: "post", path: "/unknown" }]));
});

test("every durable lifecycle row has an executable workflow handler", async () => {
  const calls = [];
  const names = {
    branch_create: "createBranch", condition_event: "ingestConditionEvent", evaluation: "recordEvaluation", policy: "recordPolicyDecision",
    approval: "recordApproval", canary_start: "startCanary", canary_outcome: "recordCanaryOutcome", disposition: "setDisposition"
  };
  const store = Object.fromEntries(Object.values(names).map((name) => [name, async (...args) => { calls.push({ name, args }); return { ok: true }; }]));
  const queue = new DecisionContinuityWorkflowQueue({ databaseUrl: "postgres://unused", store });
  for (const [, route] of Object.entries(DECISION_CONTINUITY_LIFECYCLE_ROUTES).filter(([, route]) => route.kind === "durably_asynchronous")) {
    const job = { jobId: `job-${route.jobType}`, jobType: route.jobType, tenantId: "tenant", workspaceId: "workspace", branchId: "branch", reconsiderationId: "request", payload: { __workflow: { actor: { type: "service", id: "trusted" } }, canaryId: "canary" } };
    await queue.workflowHandler(job, store);
  }
  assert.deepEqual(calls.map((item) => item.name).sort(), Object.values(names).sort());
});
