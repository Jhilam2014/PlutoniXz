import assert from "node:assert/strict";
import test from "node:test";
import { isTransientWorkflowError, selectAdaptiveRoute } from "../src/adaptiveOrchestration.js";

const managedProject = { id: "project-1", name: "MediaAnalyser", isDefault: false };

test("keeps simple managed-project work on the single-call path", () => {
  const route = selectAdaptiveRoute({
    instruction: "Fix the spacing in one report card.",
    taskType: "Simple",
    project: managedProject
  });
  assert.equal(route.mode, "single");
  assert.equal(route.plannedModelCalls, 1);
  assert.equal(route.executionAgent, "plutonix-fullstack-agent");
});

test("delegates ordinary medium work without paying for a reviewer", () => {
  const route = selectAdaptiveRoute({
    instruction: "Add media duration metadata to the analysis report.",
    taskType: "Medium",
    project: managedProject
  });
  assert.equal(route.mode, "delegated");
  assert.equal(route.plannedModelCalls, 1);
  assert.equal(route.executionAgent, "project-orchestrator");
});

test("adds independent review for hard or high-risk managed work", () => {
  const route = selectAdaptiveRoute({
    instruction: "Add authentication, API permissions, and a database migration.",
    taskType: "Hard",
    project: managedProject
  });
  assert.equal(route.mode, "delegated_reviewed");
  assert.equal(route.requiresIndependentReview, true);
  assert.equal(route.plannedModelCalls, 2);
  assert.equal(route.riskLevel, "high");
});

test("honors the model-call ceiling", () => {
  const route = selectAdaptiveRoute({
    instruction: "Deploy a security-sensitive database migration.",
    taskType: "Hard",
    project: managedProject,
    maxModelCalls: 1
  });
  assert.equal(route.mode, "delegated");
  assert.equal(route.plannedModelCalls, 1);
});

test("retries only transient workflow failures", () => {
  assert.equal(isTransientWorkflowError(new Error("produced no output for 60 seconds")), true);
  assert.equal(isTransientWorkflowError(new Error("gotham_models_manager::cache: failed to load models cache: missing field `supports_reasoning_summaries`")), true);
  assert.equal(isTransientWorkflowError(new Error("workflow exited with code 1: syntax error")), false);
  assert.equal(isTransientWorkflowError(new Error("completed but did not change any files")), false);
});
