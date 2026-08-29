import assert from "node:assert/strict";
import test from "node:test";
import { classifyGothamTask } from "../src/gothamTaskClassifier.js";

const project = { id: "project-1", name: "Existing", isDefault: false };

test("Auto resolves a bounded existing-project correction to Simple", () => {
  const result = classifyGothamTask({ instruction: "Fix spacing in the header component.", project });
  assert.equal(result.resolvedTaskType, "Simple");
  assert.equal(result.projectLifecycle, "runtime-development");
  assert.equal(result.plannedExecutionCalls, 1);
  assert.equal(result.plannedReviewCalls, 0);
});

test("Auto escalates cross-boundary and security work deterministically", () => {
  const result = classifyGothamTask({ instruction: "Add authentication permissions across the frontend, API, backend, and database.", project });
  assert.equal(result.resolvedTaskType, "Hard");
  assert.equal(result.riskLevel, "high");
  assert.ok(result.reasonCodes.includes("security_sensitive"));
  assert.ok(result.reasonCodes.includes("cross_boundary_change"));
});

test("explicit overrides are respected except mandatory risk escalation", () => {
  assert.equal(classifyGothamTask({ instruction: "Rename one label.", requestedTaskType: "Medium", project }).resolvedTaskType, "Medium");
  const escalated = classifyGothamTask({ instruction: "Deploy a destructive authentication migration to production.", requestedTaskType: "Simple", project });
  assert.equal(escalated.resolvedTaskType, "Hard");
  assert.equal(escalated.overrideStatus, "safety_escalated");
});

test("new-project classification selects project initiation independently of call accounting", () => {
  const result = classifyGothamTask({ instruction: "Create a small portfolio site.", requestedTaskType: "Auto" });
  assert.equal(result.projectLifecycle, "project-init");
  assert.equal(result.maximumModelCallBudget, result.plannedExecutionCalls + result.plannedReviewCalls);
  assert.equal(result.infrastructureReplayLimit, 1);
  assert.equal(result.repairCallLimit, 1);
});
