import assert from "node:assert/strict";
import test from "node:test";
import { buildFunctionalityGraph } from "../src/functionalityGraph.js";

const activeAgents = [
  {
    id: "plutomix-fullstack-agent",
    name: "PlutoMix Fullstack Agent",
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
    id: "plutomix-independent-reviewer",
    name: "PlutoMix Independent Reviewer",
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
  assert.deepEqual(validationNode.responsibleAgentIds, ["plutomix-independent-reviewer"]);

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

test("preserves major functionality descendants and attaches unmatched actions beneath an implementation branch", () => {
  const graph = buildFunctionalityGraph({
    projectName: "Nested product",
    functionalities: [
      { id: "product", label: "Build the product" },
      { id: "catalog", label: "Catalog management", parentFunctionalityId: "product" },
      { id: "search", label: "Product search", parentFunctionalityId: "catalog" }
    ],
    actions: [
      { id: "search-api", target: "backend/search.js", reason: "Implement product search." },
      { id: "config", target: "config/runtime.js", reason: "Changed by current Gotham CLI workflow." }
    ],
    activeAgents
  });

  const product = graph.nodes.find((node) => node.sourceId === "product");
  const catalog = graph.nodes.find((node) => node.sourceId === "catalog");
  const search = graph.nodes.find((node) => node.sourceId === "search");
  const implementation = graph.nodes.find((node) => node.sourceId === "implementation-work");
  const searchAction = graph.nodes.find((node) => node.sourceId === "search-api");
  const configAction = graph.nodes.find((node) => node.sourceId === "config");

  assert.equal(catalog.parentId, product.id);
  assert.equal(search.parentId, catalog.id);
  assert.equal(searchAction.parentId, search.id);
  assert.equal(implementation.parentId, product.id);
  assert.equal(configAction.parentId, implementation.id);
  assert.equal(graph.links.filter((link) => link.source === graph.rootId).length, 1);
  assert.ok(graph.summary.maximumDepth >= 3);
});
