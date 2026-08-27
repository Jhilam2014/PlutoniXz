import assert from "node:assert/strict";
import test from "node:test";
import { enterpriseBrainMetricRows, normalizeEnterpriseBrainOverview } from "../src/components/agentic-system/enterpriseBrainGovernanceModel.js";

test("normalizes governed Enterprise Brain receipts without assuming missing values", () => {
  const overview = normalizeEnterpriseBrainOverview({
    policy: { id: "policy-1", policyVersion: "v3", controls: ["privacy", "residency"] },
    budgets: [{ id: "budget-1", scope: "aix", limitUsd: 10, reservedUsd: 2, settledUsd: 3 }],
    modelRouteReceipts: [{ id: "route-1", provider: "openai", modelId: "gpt-5", status: "routed", estimatedCostUsd: 0.12 }],
    researchRuns: [{ id: "research-1", status: "completed", citations: [{ id: "citation-1" }] }],
    reuseReceipts: [{ id: "reuse-1", status: "allowed", knowledgeIds: ["knowledge-1"] }],
    decisionContexts: [{ id: "context-1", applicationId: "app-1", branchId: "branch-1" }]
  });
  assert.equal(overview.policy.version, "v3");
  assert.equal(overview.budgets[0].availableUsd, 5);
  assert.equal(overview.routeReceipts[0].provider, "openai");
  assert.equal(overview.researchRuns[0].sourceCount, 1);
  assert.equal(overview.reuseReceipts[0].resultCount, 1);
  assert.deepEqual(enterpriseBrainMetricRows(overview).map((row) => row.value), [1, 1, 1, 1, 1]);
});

test("uses safe empty states for permission-aware partial payloads", () => {
  const overview = normalizeEnterpriseBrainOverview({ notice: "Read permission is required." });
  assert.equal(overview.policy.status, "not_provisioned");
  assert.equal(overview.budgets.length, 0);
  assert.equal(overview.notice, "Read permission is required.");
});
