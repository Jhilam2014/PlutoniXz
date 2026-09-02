import assert from "node:assert/strict";
import test from "node:test";
import {
  extractInstructionFunctionalityHierarchy,
  functionalityNodeInsights,
  layoutFunctionalityGraph,
  normalizeFunctionalityGraph
} from "../src/functionalityGraphModel.js";

const flowPath = {
  projectName: "Investor Finder",
  status: "succeeded",
  activeAgents: [
    { id: "plutomix-fullstack-agent", name: "PlutoMix", role: "Authority" },
    { id: "investor-orchestrator", name: "Investor Orchestrator", role: "Executor" }
  ],
  functionalities: [
    { id: "search", label: "Country investor search", detail: "Search investors by country.", state: "completed" }
  ],
  featureActions: [
    { id: "search-api", target: "backend/search.js", reason: "Connect the country search endpoint.", status: "completed" }
  ]
};

test("normalizes legacy flow evidence without inventing responsible agents", () => {
  const graph = normalizeFunctionalityGraph(flowPath, "project-1");
  assert.equal(graph.nodes.filter((node) => node.type === "functionality").length, 1);
  assert.equal(graph.nodes.filter((node) => node.type === "subfunctionality").length, 1);
  const subfunction = graph.nodes.find((node) => node.type === "subfunctionality");
  assert.deepEqual(subfunction.responsibleAgentIds, ["investor-orchestrator"]);

  const noAgents = normalizeFunctionalityGraph({
    projectName: "Unassigned",
    functionalities: [{ id: "one", label: "One" }]
  });
  assert.deepEqual(noAgents.nodes.flatMap((node) => node.responsibleAgentIds), []);
});

test("lays out functionality graph with force spacing and no node overlap", () => {
  const graph = normalizeFunctionalityGraph(flowPath, "project-1");
  const layout = layoutFunctionalityGraph(graph);
  const root = layout.nodes.find((node) => node.type === "project");
  const functionality = layout.nodes.find((node) => node.type === "functionality");
  const subfunction = layout.nodes.find((node) => node.type === "subfunctionality");

  assert.ok(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.ok(Math.hypot(functionality.x - root.x, functionality.y - root.y) > 100);
  assert.ok(Math.hypot(subfunction.x - root.x, subfunction.y - root.y) > 240);
  for (let leftIndex = 0; leftIndex < layout.nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < layout.nodes.length; rightIndex += 1) {
      const left = layout.nodes[leftIndex];
      const right = layout.nodes[rightIndex];
      assert.ok(Math.hypot(left.x - right.x, left.y - right.y) > left.radius + right.radius + 80);
    }
  }
  assert.equal(layout.links.length, 2);
});

test("returns only agents explicitly assigned to the selected node", () => {
  const graph = normalizeFunctionalityGraph(flowPath, "project-1");
  const subfunction = graph.nodes.find((node) => node.type === "subfunctionality");
  const insights = functionalityNodeInsights(graph, subfunction.id);
  assert.deepEqual(insights.agents.map((agent) => agent.id), ["investor-orchestrator"]);
  assert.equal(insights.node.label, "Connect the country search endpoint");
});

test("recovers legacy project nodes from the latest instruction and changed files", () => {
  const graph = normalizeFunctionalityGraph({
    projectName: "Legacy Investor Finder",
    status: "succeeded",
    sourceInstruction: "Upload product details. Search verified investors by selected country. Review each proposal before outreach.",
    changedFiles: ["src/search.jsx", "backend/investors.js"]
  });
  assert.equal(graph.nodes.filter((node) => node.type === "functionality").length, 3);
  assert.equal(graph.nodes.filter((node) => node.type === "subfunctionality").length, 2);
  assert.deepEqual(graph.nodes.flatMap((node) => node.responsibleAgentIds), []);
});

test("decomposes every capability in the first project instruction", () => {
  const hierarchy = extractInstructionFunctionalityHierarchy(
    "Create a web app where I can upload product details. " +
    "Then select business type, product type, core technologies, audience. " +
    "After users provide information then it should analyze the inputs and understand the audience and get verified investor email IDs in India and USA. " +
    "These VCs must have revenue between 10 million and 500 million dollars."
  );
  const labels = hierarchy.map((item) => item.label);
  const subfunctionalities = hierarchy.flatMap((item) => item.subfunctionalities);

  assert.deepEqual(labels, [
    "Upload product details",
    "Select business type, product type, core technologies, audience",
    "Analyze the inputs and understand the audience and get verified investor email IDs in India and USA",
    "Filter VCs by revenue between 10 million and 500 million dollars"
  ]);
  for (const expected of [
    "Select business type",
    "Select product type",
    "Select core technologies",
    "Select audience",
    "Analyze the inputs",
    "Understand the audience",
    "Get verified investor email IDs in India and USA",
    "Limit results to India and USA"
  ]) {
    assert.ok(subfunctionalities.includes(expected), `${expected} is represented`);
  }
});

test("keeps first-instruction functions when a later execution flow is merged", () => {
  const graph = normalizeFunctionalityGraph({
    ...flowPath,
    initialInstruction: "Upload a product brief. Search investors by country. Review proposals before outreach.",
    initialFlowPath: {
      status: "succeeded",
      activeAgents: [
        { id: "plutomix-fullstack-agent", name: "PlutoMix", role: "Authority" },
        { id: "initial-orchestrator", name: "Initial Orchestrator", role: "Executor" }
      ]
    }
  });
  const initialNodes = graph.nodes.filter((node) => node.origin === "initial_instruction" && node.type === "functionality");

  assert.equal(graph.summary.initialFunctionalityCount, 3);
  assert.deepEqual(initialNodes.map((node) => node.label), [
    "Upload a product brief",
    "Search investors by country",
    "Review proposals before outreach"
  ]);
  assert.ok(graph.nodes.some((node) => node.label === "Country investor search"), "later functionality remains visible");
  assert.ok(graph.agents.some((agent) => agent.id === "initial-orchestrator"), "initial agent evidence is retained");
  assert.ok(graph.agents.some((agent) => agent.id === "investor-orchestrator"), "later agent evidence is retained");
});

test("preserves previous execution flows before adding the latest functionality", () => {
  const graph = normalizeFunctionalityGraph({
    projectName: "Investor Finder",
    status: "succeeded",
    previousFlowPaths: [
      {
        projectName: "Investor Finder",
        status: "succeeded",
        activeAgents: [{ id: "plutomix-fullstack-agent", name: "PlutoMix", role: "Authority" }],
        functionalities: [
          { id: "upload", label: "Upload product details", detail: "Capture product context.", state: "completed" }
        ],
        featureActions: [
          { id: "upload-ui", target: "src/upload.jsx", reason: "Add upload interface.", status: "completed" }
        ]
      },
      {
        projectName: "Investor Finder",
        status: "succeeded",
        activeAgents: [{ id: "investor-orchestrator", name: "Investor Orchestrator", role: "Executor" }],
        functionalities: [
          { id: "country", label: "Country investor filters", detail: "Filter investors by country.", state: "completed" }
        ],
        featureActions: [
          { id: "country-filter", target: "src/filters.jsx", reason: "Add country filter.", status: "completed" }
        ]
      }
    ],
    activeAgents: [{ id: "outreach-orchestrator", name: "Outreach Orchestrator", role: "Executor" }],
    functionalities: [
      { id: "outreach", label: "Review outreach proposals", detail: "Review proposals before sending.", state: "completed" }
    ],
    featureActions: [
      { id: "proposal-review", target: "src/outreach.jsx", reason: "Add proposal review flow.", status: "completed" }
    ]
  }, "project-1");

  const labels = graph.nodes.filter((node) => node.type === "functionality").map((node) => node.label);
  assert.ok(labels.includes("Upload product details"));
  assert.ok(labels.includes("Country investor filters"));
  assert.ok(labels.includes("Review outreach proposals"));
  assert.ok(graph.nodes.some((node) => node.origin === "previous_execution" && node.label === "Country investor filters"));
  assert.ok(graph.agents.some((agent) => agent.id === "investor-orchestrator"));
  assert.ok(graph.agents.some((agent) => agent.id === "outreach-orchestrator"));
});

test("spreads dense functionality graphs across a larger force canvas", () => {
  const graph = normalizeFunctionalityGraph({
    projectName: "Dense workflow",
    functionalityGraph: {
      rootId: "root",
      nodes: [
        { id: "root", type: "project", label: "Dense workflow", parentId: "" },
        ...Array.from({ length: 10 }, (_, index) => ({
          id: `function-${index}`,
          type: "functionality",
          label: `Functionality ${index}`,
          parentId: "root"
        })),
        ...Array.from({ length: 24 }, (_, index) => ({
          id: `subfunction-${index}`,
          type: "subfunctionality",
          label: `Subfunction ${index}`,
          parentId: `function-${index % 10}`
        }))
      ],
      links: [
        ...Array.from({ length: 10 }, (_, index) => ({
          id: `root-function-${index}`,
          source: "root",
          target: `function-${index}`,
          type: "contains_functionality"
        })),
        ...Array.from({ length: 24 }, (_, index) => ({
          id: `function-subfunction-${index}`,
          source: `function-${index % 10}`,
          target: `subfunction-${index}`,
          type: "contains_subfunctionality"
        }))
      ]
    }
  });
  const layout = layoutFunctionalityGraph(graph, 620, 520);

  assert.ok(layout.width > 1200 || layout.height > 900, "dense graph gets a larger canvas");
  for (let leftIndex = 0; leftIndex < layout.nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < layout.nodes.length; rightIndex += 1) {
      const left = layout.nodes[leftIndex];
      const right = layout.nodes[rightIndex];
      assert.ok(Math.hypot(left.x - right.x, left.y - right.y) > left.radius + right.radius + 58, `${left.id} and ${right.id} are separated`);
    }
  }
});

test("keeps nested functionality chains away from genesis and lays out every descendant", () => {
  const graph = normalizeFunctionalityGraph({
    projectName: "Nested workflow",
    functionalityGraph: {
      rootId: "root",
      nodes: [
        { id: "root", type: "project", label: "Nested workflow", parentId: "" },
        { id: "major", type: "functionality", label: "Commerce", parentId: "root" },
        { id: "catalog", type: "subfunctionality", label: "Catalog", parentId: "major" },
        { id: "search", type: "subfunctionality", label: "Search", parentId: "catalog" },
        { id: "index", type: "subfunctionality", label: "Search index", parentId: "search" },
        { id: "filters", type: "subfunctionality", label: "Search filters", parentId: "search" }
      ],
      links: []
    }
  });
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const layout = layoutFunctionalityGraph(graph);
  const positioned = new Map(layout.nodes.map((node) => [node.id, node]));

  assert.equal(byId.get("catalog").parentId, "major");
  assert.equal(byId.get("search").parentId, "catalog");
  assert.equal(graph.links.filter((link) => link.source === "root").length, 1);
  assert.ok(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.ok(Math.hypot(positioned.get("catalog").x - positioned.get("major").x, positioned.get("catalog").y - positioned.get("major").y) > 100);
  assert.ok(Math.hypot(positioned.get("search").x - positioned.get("root").x, positioned.get("search").y - positioned.get("root").y) > 260);
});

test("upgrades recorded flat route and section nodes into the major functionality hierarchy", () => {
  const graph = normalizeFunctionalityGraph({
    projectName: "Recorded workflow",
    functionalityGraph: {
      rootId: "root",
      nodes: [
        { id: "root", type: "project", label: "Recorded workflow", parentId: "" },
        { id: "objective", sourceId: "functionality-1", type: "functionality", label: "Build a product", parentId: "root", detail: "Requested project functionality selected for implementation." },
        { id: "catalog", sourceId: "functionality-2", type: "functionality", label: "Section: catalog", parentId: "root", detail: "Included by the PlutoMix feature and route plan." },
        { id: "search", sourceId: "functionality-3", type: "functionality", label: "Route: Search", parentId: "root", detail: "Included by the PlutoMix feature and route plan." }
      ]
    }
  });

  assert.equal(graph.nodes.find((node) => node.id === "catalog").parentId, "objective");
  assert.equal(graph.nodes.find((node) => node.id === "search").parentId, "objective");
  assert.equal(graph.links.filter((link) => link.source === "root").length, 1);
});
