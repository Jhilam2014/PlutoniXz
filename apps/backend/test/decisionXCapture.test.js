import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDecisionContinuityStore } from "../src/decisionContinuity.js";
import { DecisionXBuildCapture } from "../src/decisionXCapture.js";

const tenantId = "decisionx-capture-tenant";
const workspaceId = "application-a";
const actor = { type: "user", id: "operator-1" };

async function fixture(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-decisionx-capture-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createDecisionContinuityStore({ root });
  const governanceContexts = [];
  const governance = {
    async recordDecisionContext(input) {
      governanceContexts.push(input);
      return { status: "recorded", id: `ctx-${governanceContexts.length}` };
    }
  };
  return { store, governanceContexts, capture: new DecisionXBuildCapture({ store, governance }) };
}

test("captures only observed build decisions and reuses a stable idempotency key", async (context) => {
  const { capture, store, governanceContexts } = await fixture(context);
  const input = {
    tenantId,
    workspaceId,
    actor,
    project: { id: "application-a", name: "Application A" },
    instruction: "Add an auditable governed decision panel to the existing application.",
    buildKey: "build-123",
    workflow: {
      correlationId: "workflow-123",
      selectedPath: "project-orchestrator",
      flowPath: {
        executedDecisions: [{ id: "selected-path", label: "Selected path", value: "project-orchestrator", reason: "Existing application scope." }],
        rejectedPaths: [{ id: "template-only", reason: "Application-local changes are required." }],
        deferredPaths: [{ id: "cross-region-store", reason: "Enterprise residency constraint remains active." }]
      },
      informationSharingContext: {
        agreementIds: ["sharing-1"],
        blockedPolicies: [{ id: "sharing-draft" }],
        enterpriseConstraints: ["Keep regulated data in India."],
        governanceRules: ["Use only for application development."],
        privacyPolicies: ["Do not render client identifiers."]
      }
    },
    routeResult: {
      status: "routed",
      route: { id: "route-123", selectedRegistrationId: "reg-123", selectedProvider: "openai", selectedModelId: "gpt-fixture", policySnapshotId: "policy-123", budgetReservationId: "reserve-123" }
    },
    enterpriseDecisionContext: {
      applicationId: "application-a",
      enterpriseId: "enterprise-a",
      affectedApplicationIds: ["application-b"],
      policySnapshotId: "policy-123",
      budgetScopeId: "budget-a",
      evidenceRefs: ["route-123"],
      classification: "internal",
      region: "in",
      purpose: "application_development"
    }
  };
  const first = await capture.capturePlanned(input);
  const second = await capture.capturePlanned(input);
  assert.equal(first.status, "recorded");
  assert.equal(second.status, "recorded");
  assert.equal(first.branch.id, second.branch.id);
  assert.equal(first.branch.status, "candidate");
  assert.deepEqual(first.branch.disposition.alternativesConsidered, ["template-only", "cross-region-store"]);
  assert.equal(first.branch.candidate.selectedRoute.selectedRegistrationId, "reg-123");
  assert.equal(first.branch.candidate.observedDecisions.length, 1);
  assert.equal(first.branch.candidate.deferredOrRejectedPaths.find((path) => path.id === "cross-region-store").disposition, "deferred");
  assert.deepEqual(first.branch.constraintSnapshot.sharingAgreementIds, ["sharing-1"]);
  assert.deepEqual(first.branch.constraintSnapshot.enterpriseConstraints, ["Keep regulated data in India."]);
  assert.equal(governanceContexts.length, 2);
  const branches = await store.listBranches({ tenantId, workspaceId });
  assert.equal(branches.length, 1);
});

test("records an observed final outcome without selecting or promoting the branch", async (context) => {
  const { capture } = await fixture(context);
  const planned = await capture.capturePlanned({
    tenantId, workspaceId, actor, project: { id: "application-a" }, instruction: "Make a narrow auditable change for an existing application.", buildKey: "build-outcome", workflow: { correlationId: "workflow-outcome" }
  });
  const result = await capture.captureOutcome({
    tenantId,
    workspaceId,
    actor,
    branchId: planned.branch.id,
    buildKey: "build-outcome",
    status: "succeeded",
    buildId: "build-456",
    changedFiles: ["apps/frontend/src/App.jsx"],
    validation: { status: "passed" },
    routeResult: { route: { id: "route-456" } }
  });
  assert.equal(result.status, "recorded");
  assert.equal(result.branch.status, "candidate");
  assert.equal(result.branch.realizedOutcome.execution.status, "succeeded");
  assert.equal(result.branch.realizedOutcome.execution.modelRouteReceiptId, "route-456");
});

test("safe capture preserves an existing build when strict scope is unavailable", async (context) => {
  const { capture } = await fixture(context);
  const result = await capture.capturePlannedSafely({ instruction: "This normal legacy build continues without enterprise OIDC scope." });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "strict_scope_unavailable");
});
