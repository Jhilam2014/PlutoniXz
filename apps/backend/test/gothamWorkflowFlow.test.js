import assert from "node:assert/strict";
import test from "node:test";

process.env.PLUTONIX_SERVER_AUTOSTART = "false";

const { gothamInstructionFlowPath, hydratePersistedWorkflowRoute } = await import("../src/server.js");

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
