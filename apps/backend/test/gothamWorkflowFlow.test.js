import assert from "node:assert/strict";
import test from "node:test";

process.env.PLUTONIX_SERVER_AUTOSTART = "false";

const { activeGothamExecutionStatus, gothamInstructionFlowPath, hydratePersistedWorkflowRoute } = await import("../src/server.js");

test("active Gotham execution status supports owner-scoped browser reattachment", () => {
  const active = new Map([
    ["user-a:project-a", {
      controller: new AbortController(),
      parentWorkflowId: "workflow-a",
      projectId: "project-a",
      projectName: "Project A",
      instruction: "Add the requested transcript filter.",
      taskType: "Auto",
      resolvedTaskType: "Simple",
      workflowMode: "executor",
      executionMode: "direct",
      startedAt: "2026-08-29T10:00:00.000Z"
    }],
    ["user-b:project-b", { controller: new AbortController(), parentWorkflowId: "workflow-b", projectId: "project-b" }]
  ]);
  const status = activeGothamExecutionStatus(active, { userId: "user-a", projectId: "project-a" });
  assert.equal(status.status, "running");
  assert.equal(status.execution.parentWorkflowId, "workflow-a");
  assert.equal(status.execution.instruction, "Add the requested transcript filter.");
  assert.equal(status.execution.resolvedTaskType, "Simple");
  assert.equal(status.executions.some((execution) => execution.parentWorkflowId === "workflow-b"), false);
  assert.equal(activeGothamExecutionStatus(active, { userId: "user-a", projectId: "project-b" }).status, "idle");
});

test("keeps the selected adaptive route when Gotham fails before returning a result", () => {
  const adaptiveRoute = {
    mode: "delegated_reviewed",
    reasons: ["Managed database work requires independent review."],
    routeScore: 4,
    riskLevel: "high",
    plannedModelCalls: 2,
    modelCallBudget: 2,
    requiresIndependentReview: true
  };
  const flowPath = gothamInstructionFlowPath({
    projectName: "DatabricksX",
    taskType: "Medium",
    workflowMode: "executor",
    useProjectOrchestrator: true,
    error: "Gotham completed but did not change any meaningful project or requested artifact files.",
    orchestrated: {
      structuredRequest: {
        sourceInstruction: "Add a SQL database explorer.",
        orchestrationEnvelope: { adaptiveRoute }
      }
    }
  });

  const routing = flowPath.decisionTree.children.find((node) => node.id === "adaptive-routing");
  const humanChoice = flowPath.nodes.find((node) => node.id === "human-choice-review");

  assert.equal(flowPath.adaptiveRoute.mode, "delegated_reviewed");
  assert.equal(flowPath.decisionTree.state, "selected");
  assert.equal(routing.state, "selected");
  assert.equal(routing.children.find((choice) => choice.id === "delegated_reviewed").state, "selected");
  assert.equal(flowPath.activeAgents.find((agent) => agent.id === "plutonix-fullstack-agent").status, "completed");
  assert.equal(flowPath.activeAgents.find((agent) => agent.id === "plutonix-independent-reviewer").status, "skipped");
  assert.equal(flowPath.selectedPath, "plutonix-global-orchestration");
  assert.equal(humanChoice.state, "pending");
});

test("hydrates legacy failed history from its recorded adaptive route", () => {
  const adaptiveRoute = {
    mode: "delegated_reviewed",
    reasons: ["Database work crossed multiple system boundaries."],
    routeScore: 5,
    riskLevel: "high",
    plannedModelCalls: 2,
    modelCallBudget: 2,
    requiresIndependentReview: true
  };
  const hydrated = hydratePersistedWorkflowRoute({
    projectId: "databricksx-n7lCNf",
    projectName: "DatabricksX",
    taskType: "Medium",
    status: "failed",
    instruction: "Add a SQL database explorer.",
    error: "Gotham completed but did not change any meaningful project or requested artifact files.",
    adaptiveRoute,
    flowPath: { adaptiveRoute: null },
    orchestrationSnapshot: {
      route: null,
      validation: { status: "failed" },
      decisionTree: { id: "legacy" }
    }
  });

  assert.equal(hydrated.flowPath.adaptiveRoute.mode, "delegated_reviewed");
  assert.equal(hydrated.orchestrationSnapshot.route.mode, "delegated_reviewed");
  assert.equal(
    hydrated.orchestrationSnapshot.decisionTree.children
      .find((node) => node.id === "adaptive-routing")
      .children.find((choice) => choice.id === "delegated_reviewed").state,
    "selected"
  );
});
