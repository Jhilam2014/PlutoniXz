import assert from "node:assert/strict";
import test from "node:test";
import { buildFunctionalityGraph } from "../src/functionalityGraph.js";

const activeAgents = [
  {
    id: "plutonix-fullstack-agent",
    name: "PlutoniX Fullstack Agent",
    role: "Canonical authority",
    status: "completed"
  },
  {
    id: "sample-orchestrator-agent",
    name: "Sample Orchestrator Agent",
    role: "Bounded project executor",
    status: "completed"
  },
  {
    id: "plutonix-independent-reviewer",
    name: "PlutoniX Independent Reviewer",
    role: "Read-only validator",
    status: "completed"
  }
];

test("builds project, functionality, and subfunctionality nodes from recorded flow evidence", () => {
  const graph = buildFunctionalityGraph({
    projectId: "project-1",
    projectName: "Sample",
    structuredRequest: { objective: "Build an investor workflow." },
    functionalities: [
      { id: "objective", label: "Investor workflow", detail: "Primary workflow.", state: "completed" },
      { id: "search", label: "Investor search", detail: "Country-specific search.", state: "completed" }
    ],
    actions: [
      {
        id: "search-api",
        type: "modify",
        label: "Modify search API",
        target: "backend/search.js",
        reason: "Implement investor search by selected country.",
        status: "completed"
      }
    ],
    activeAgents,
    status: "succeeded"
  });

  assert.equal(graph.nodes.filter((node) => node.type === "project").length, 1);
  assert.equal(graph.nodes.filter((node) => node.type === "functionality").length, 2);
  assert.equal(graph.nodes.filter((node) => node.type === "subfunctionality").length, 1);
  const searchNode = graph.nodes.find((node) => node.label === "Investor search");
  const actionNode = graph.nodes.find((node) => node.type === "subfunctionality");
  assert.equal(actionNode.parentId, searchNode.id);
  assert.deepEqual(actionNode.responsibleAgentIds, ["sample-orchestrator-agent"]);
});

test("assigns validation evidence to a recorded reviewer and never invents an agent", () => {
  const graph = buildFunctionalityGraph({
    projectName: "Review sample",
    functionalities: [{ id: "objective", label: "Export workflow" }],
    actions: [{ id: "test", target: "tests/export.test.js", reason: "Validate export behavior." }],
    activeAgents
  });
  const validationNode = graph.nodes.find((node) => node.type === "subfunctionality");
  assert.deepEqual(validationNode.responsibleAgentIds, ["plutonix-independent-reviewer"]);

  const unassigned = buildFunctionalityGraph({
    projectName: "No agents",
    functionalities: [{ id: "objective", label: "Unassigned capability" }]
  });
  assert.deepEqual(unassigned.nodes.flatMap((node) => node.responsibleAgentIds), []);
  assert.deepEqual(unassigned.agents, []);
});

test("separates numbered requirements into distinct functionality nodes", () => {
  const graph = buildFunctionalityGraph({
    projectName: "Editor",
    functionalities: [{
      id: "request",
      label: "1. Add sign in and user memory. 2. Add a crop tool with horizontal and vertical handles. 3. Fit the canvas to the available workspace."
    }],
    activeAgents
  });
  assert.equal(graph.nodes.filter((node) => node.type === "functionality").length, 3);
});
