import assert from "node:assert/strict";
import test from "node:test";
import {
  buildApplicationDecisionMap,
  buildApplicationDeliveryTimeline,
  buildDeliveryChronologyLinks,
  buildDeliveryGraphView,
  decisionMapRows,
  seedDecisionMapLayout
} from "../src/components/agentic-system/applicationDecisionMapModel.js";

test("progressive delivery view aggregates repetitive leaves and preserves their source IDs and relationships", () => {
  const nodes = [
    { id: "build:1", kind: "build-event", label: "Build one", width: 220, height: 78, x: 0, y: 0 },
    { id: "function:1", kind: "functionality", label: "Checkout", width: 220, height: 72, x: 250, y: 0 },
    { id: "decision:1", kind: "decision-option", label: "Stripe", state: "selected", width: 62, height: 62, x: 500, y: 0 },
    { id: "decision:2", kind: "decision-option", label: "Adyen", state: "selected", width: 62, height: 62, x: 500, y: 80 },
    { id: "agent:1", kind: "agent", label: "Payments agent", width: 84, height: 84, x: 750, y: 0 },
    { id: "agent:2", kind: "agent", label: "Review agent", width: 84, height: 84, x: 750, y: 100 },
    { id: "service:1", kind: "service", label: "Payment API", status: "active", width: 238, height: 52, x: 1000, y: 0 },
    { id: "service:2", kind: "service", label: "Legacy API", status: "inactive", width: 238, height: 52, x: 1000, y: 80 }
  ];
  const links = [
    { id: "build-function", source: "build:1", target: "function:1", kind: "build-event-functionality" },
    { id: "function-decision-1", source: "function:1", target: "decision:1", kind: "functionality-decision-option" },
    { id: "function-decision-2", source: "function:1", target: "decision:2", kind: "functionality-decision-option" },
    { id: "agent-function-1", source: "agent:1", target: "function:1", kind: "ownership" },
    { id: "agent-function-2", source: "agent:2", target: "function:1", kind: "ownership" },
    { id: "function-service-1", source: "function:1", target: "service:1", kind: "dependency" },
    { id: "function-service-2", source: "function:1", target: "service:2", kind: "dependency" }
  ];
  const source = { nodeById: new Map(nodes.map((node) => [node.id, node])), links, width: 1320, height: 720, rows: [], groups: [] };
  const primary = buildDeliveryGraphView(source);

  assert.equal(primary.sourceNodeCount, 8);
  assert.equal(primary.visibleNodeCount, 5);
  assert.equal(primary.hiddenNodeGroups.get("agent:1"), "agent:agent");
  assert.deepEqual(primary.aggregateByGroup.get("agent:agent").childIds, ["agent:1", "agent:2"]);
  const decisionEdge = primary.links.find((link) => link.target === "delivery-aggregate:decision-option%3Aselected");
  assert.equal(decisionEdge.relationshipCount, 2);
  assert.deepEqual(decisionEdge.memberLinkIds, ["function-decision-1", "function-decision-2"]);
  assert.equal(primary.links.some((link) => link.kind === "dependency"), false);

  const expanded = buildDeliveryGraphView(source, { expandedGroups: ["agent:agent"] });
  assert.ok(expanded.nodeById.has("agent:1"));
  assert.ok(expanded.nodeById.has("agent:2"));
  assert.equal(expanded.aggregateByGroup.get("agent:agent").expanded, true);
  assert.deepEqual(nodes.map((node) => node.id), ["build:1", "function:1", "decision:1", "decision:2", "agent:1", "agent:2", "service:1", "service:2"]);
});

test("delivery view filters relationships, hop depth, and inactive nodes without changing backend-shaped records", () => {
  const nodes = [
    { id: "build", kind: "build-event", label: "Build", width: 220, height: 78 },
    { id: "function", kind: "functionality", label: "Checkout", width: 220, height: 72 },
    { id: "service:active", kind: "service", label: "API", status: "active", width: 238, height: 52 },
    { id: "service:inactive", kind: "service", label: "Old API", status: "inactive", width: 238, height: 52 }
  ];
  const links = [
    { id: "primary", source: "build", target: "function", kind: "build-event-functionality" },
    { id: "dependency-1", source: "function", target: "service:active", kind: "dependency" },
    { id: "dependency-2", source: "function", target: "service:inactive", kind: "dependency" }
  ];
  const source = { nodeById: new Map(nodes.map((node) => [node.id, node])), links, rows: [], groups: [] };
  const dependencies = buildDeliveryGraphView(source, { relationshipFilter: "dependencies" });
  assert.ok(dependencies.links.every((link) => link.kind === "dependency"));

  const activeOnly = buildDeliveryGraphView(source, { relationshipFilter: "all", showInactive: false });
  assert.equal(activeOnly.nodeById.has("service:inactive"), false);
  assert.deepEqual(links.map((link) => link.id), ["primary", "dependency-1", "dependency-2"]);

  const oneHop = buildDeliveryGraphView(source, { relationshipFilter: "all", depth: "1", selectedId: "build" });
  assert.deepEqual([...oneHop.nodeById.keys()].sort(), ["build", "function"]);
});

test("dense delivery lanes wrap vertically aligned nodes across stable horizontal subcolumns", () => {
  const nodes = Array.from({ length: 14 }, (_, index) => ({
    id: `decision-functionality:${index + 1}`,
    kind: "functionality",
    label: `Functionality ${index + 1}`,
    timelineRank: index + 1,
    width: 220,
    height: 72,
    x: 0,
    y: index * 100
  }));
  const source = { nodeById: new Map(nodes.map((node) => [node.id, node])), links: [], rows: [], groups: [], width: 1420, height: 1800 };
  const view = buildDeliveryGraphView(source);
  const functionalities = [...view.nodeById.values()];
  const xPositions = new Set(functionalities.map((node) => node.x));
  const yPositions = new Set(functionalities.map((node) => node.y));

  assert.equal(xPositions.size, 3);
  assert.equal(yPositions.size, 5);
  assert.equal(view.height, 720);
  assert.ok(view.width > 1420);
  assert.ok(functionalities.every((node) => node.x >= 0 && node.x + node.width <= view.width));
});

const project = { id: "checkout", name: "Checkout" };
const architectureAnalysisReport = {
  projectId: "checkout",
  functionalities: [
    {
      id: "checkout-ui",
      label: "Checkout form",
      category: "ui",
      evidence: [{ reference: "src/CheckoutForm.jsx:1" }]
    }
  ],
  majorFunctionalities: [
    {
      id: "major-checkout",
      label: "Complete checkout",
      category: "ui",
      sourceEntityId: "checkout-ui",
      sourceEntityIds: ["checkout-ui"],
      features: [{ id: "checkout-ui", label: "Checkout form", evidence: [{ reference: "src/CheckoutForm.jsx:1" }] }],
      evidence: [{ reference: "src/CheckoutForm.jsx:1" }]
    }
  ]
};

const topology = {
  nodes: [
    { id: "agent:ui", type: "agent", label: "Experience Agent", status: "active", metadata: { responsibility: "Owns checkout UI." } },
    { id: "entity:ui", type: "ui_element", label: "Checkout form", metadata: { projectId: "checkout", evidence: [{ reference: "src/CheckoutForm.jsx:1" }] } },
    { id: "entity:api", type: "api", label: "Create payment intent", metadata: { projectId: "checkout", evidence: [{ reference: "src/payment.js:1" }] } },
    { id: "entity:payments", type: "service", label: "Payment provider", metadata: { projectId: "checkout", evidence: [{ reference: "src/payments.js:1" }] } }
  ],
  links: [
    { source: "agent:ui", target: "entity:ui", type: "implements" },
    { source: "entity:ui", target: "entity:api", type: "ui_calls_api" },
    { source: "entity:api", target: "entity:payments", type: "api_calls_service" }
  ]
};

const timelineArchitectureReport = {
  projectId: "checkout",
  majorFunctionalities: [
    {
      id: "checkout-ui",
      label: "Checkout form",
      category: "ui",
      evidence: [{ reference: "src/CheckoutForm.jsx:1" }],
      chronology: { deliveryOrder: 1, deliveryPhase: "User experience", basis: "dependency_aware_delivery_inference", confidence: 0.72 }
    },
    {
      id: "checkout-persistence",
      label: "Persist checkout",
      category: "data",
      evidence: [{ reference: "src/checkoutStore.js:1" }],
      chronology: { deliveryOrder: 2, deliveryPhase: "Data foundation", basis: "dependency_aware_delivery_inference", confidence: 0.72 }
    },
    {
      id: "checkout-review",
      label: "Review checkout",
      category: "quality",
      evidence: [{ reference: "src/checkoutReview.js:1" }],
      chronology: { deliveryOrder: 3, deliveryPhase: "Verification", basis: "dependency_aware_delivery_inference", confidence: 0.72 }
    }
  ]
};

test("maps a decision branch to recorded agent ownership and two-hop supporting services", () => {
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport, topology });
  const functionality = map.nodes.find((node) => node.kind === "functionality");
  assert.equal(map.summary.functionalityCount, 1);
  assert.equal(map.summary.agentCount, 1);
  assert.equal(map.summary.serviceCount, 2);
  assert.ok(map.links.some((link) => link.kind === "ownership" && link.target === functionality.id));
  assert.ok(map.links.some((link) => link.kind === "dependency" && link.target.endsWith("entity:payments")));
});

test("derives agent visuals and insight fields from explicit topology metadata", () => {
  const explicitAgentTopology = {
    ...topology,
    nodes: topology.nodes.map((node) => node.id === "agent:ui"
      ? {
          ...node,
          cluster_id: "experience-composition",
          group: "reusable-agent",
          agent_id: "experience-agent",
          metadata: {
            ...node.metadata,
            agentType: "data-contract",
            role: "data-contract",
            responsibility: "Owns persisted checkout contract.",
            description: "Structured contract owner."
          }
        }
      : node)
  };
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport, topology: explicitAgentTopology });
  const agent = map.nodes.find((node) => node.kind === "agent");

  assert.deepEqual(
    {
      agentId: agent.agentId,
      role: agent.role,
      responsibility: agent.responsibility,
      description: agent.description,
      clusterId: agent.clusterId,
      group: agent.group,
      agentType: agent.agentType,
      agentCategory: agent.agentCategory,
      iconKey: agent.iconKey,
      colorKey: agent.colorKey
    },
    {
      agentId: "experience-agent",
      role: "data-contract",
      responsibility: "Owns persisted checkout contract.",
      description: "Structured contract owner.",
      clusterId: "experience-composition",
      group: "reusable-agent",
      agentType: "data-contract",
      agentCategory: "data",
      iconKey: "database",
      colorKey: "data"
    }
  );
  assert.deepEqual(agent.metadataProvenance, {
    role: "topology_metadata_role",
    responsibility: "topology_metadata_responsibility",
    description: "topology_metadata_description",
    clusterId: "topology_cluster_id",
    group: "topology_group"
  });
  assert.deepEqual(agent.visualProvenance, {
    source: "topology_metadata_agent_type",
    rawType: "data-contract",
    explicit: true
  });
});

test("keeps orchestrator and QAgent controller category icons distinct", () => {
  const categoryTopology = {
    ...topology,
    nodes: [
      ...topology.nodes.filter((node) => node.id !== "agent:ui"),
      { id: "agent:orchestrator", type: "agent", label: "Delivery lead", metadata: { agentType: "project-orchestrator" } },
      { id: "agent:qagent", type: "agent", label: "Quality controller", metadata: { agentType: "qagent-controller" } }
    ],
    links: [
      ...topology.links.filter((link) => link.source !== "agent:ui"),
      { source: "agent:orchestrator", target: "entity:ui", type: "implements" },
      { source: "agent:qagent", target: "entity:ui", type: "implements" }
    ]
  };
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport, topology: categoryTopology });
  const agents = new Map(map.nodes.filter((node) => node.kind === "agent").map((node) => [node.agentType, node]));

  assert.equal(agents.get("project-orchestrator")?.agentCategory, "orchestration");
  assert.equal(agents.get("project-orchestrator")?.iconKey, "orchestrator");
  assert.equal(agents.get("qagent-controller")?.agentCategory, "orchestration");
  assert.equal(agents.get("qagent-controller")?.iconKey, "controller");
});

test("uses an explicit assignment role for an agent visual when topology metadata is unavailable", () => {
  const map = buildApplicationDecisionMap({
    project,
    architectureAnalysisReport: {
      ...architectureAnalysisReport,
      assignments: [{
        functionalityId: "major-checkout",
        agentId: "security-assignment-agent",
        role: "governance-security",
        projectResponsibility: "Review checkout access boundaries.",
        assignment: "reused"
      }]
    },
    topology: null
  });
  const agent = map.nodes.find((node) => node.kind === "agent");

  assert.equal(agent.agentType, "governance-security");
  assert.equal(agent.agentCategory, "security");
  assert.equal(agent.iconKey, "shield");
  assert.equal(agent.colorKey, "security");
  assert.equal(agent.role, "governance-security");
  assert.equal(agent.responsibility, "Review checkout access boundaries.");
  assert.equal(agent.visualProvenance.source, "assignment_role");
  assert.equal(agent.metadataProvenance.role, "assignment_role");
});

test("matches the raw assignment agent id to a prefixed topology node for visual context", () => {
  const assignmentBackedTopology = {
    ...topology,
    nodes: topology.nodes.map((node) => node.id === "agent:ui"
      ? { ...node, agent_id: "ui-assignment-agent", metadata: {} }
      : node)
  };
  const map = buildApplicationDecisionMap({
    project,
    architectureAnalysisReport: {
      ...architectureAnalysisReport,
      assignments: [{
        functionalityId: "major-checkout",
        agentId: "ui-assignment-agent",
        responsibilityMatch: "experience-composition"
      }]
    },
    topology: assignmentBackedTopology
  });
  const agent = map.nodes.find((node) => node.kind === "agent");

  assert.equal(agent.associationBasis, "direct_topology_link");
  assert.equal(agent.agentType, "experience-composition");
  assert.equal(agent.iconKey, "design");
  assert.equal(agent.visualProvenance.source, "assignment_responsibility_match");
});

test("does not infer agent visual type from its display label", () => {
  const untypedLabelTopology = {
    ...topology,
    nodes: topology.nodes.map((node) => node.id === "agent:ui"
      ? { ...node, label: "Data Contract Agent", metadata: {} }
      : node)
  };
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport, topology: untypedLabelTopology });
  const agent = map.nodes.find((node) => node.kind === "agent");

  assert.equal(agent.label, "Data Contract Agent");
  assert.equal(agent.agentType, "general");
  assert.equal(agent.agentCategory, "general");
  assert.equal(agent.iconKey, "agent");
  assert.equal(agent.colorKey, "general");
  assert.deepEqual(agent.visualProvenance, { source: "fallback", rawType: "", explicit: false });
});

test("does not invent owners when the topology has no implementation link", () => {
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport, topology: { ...topology, links: topology.links.slice(1) } });
  assert.equal(map.summary.agentCount, 0);
  assert.equal(map.summary.unassignedFunctionalityCount, 1);
});

test("does not turn a label-only topology coincidence into recorded ownership", () => {
  const labelCollisionTopology = {
    ...topology,
    nodes: topology.nodes.map((node) => node.id === "entity:ui"
      ? { ...node, metadata: { ...node.metadata, evidence: [{ reference: "src/UnrelatedCheckout.jsx:1" }] } }
      : node)
  };
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport, topology: labelCollisionTopology });

  assert.equal(map.summary.agentCount, 0);
  assert.equal(map.links.some((link) => link.kind === "ownership"), false);
  assert.equal(map.summary.unassignedFunctionalityCount, 1);
});

test("matches a dynamic topology entity through its exact project-scoped source ID", () => {
  const sourceOnlyReport = {
    ...architectureAnalysisReport,
    majorFunctionalities: [{
      ...architectureAnalysisReport.majorFunctionalities[0],
      evidence: [],
      features: []
    }]
  };
  const sourceOnlyTopology = {
    nodes: [
      topology.nodes[0],
      { id: "functionality:checkout:checkout-ui", type: "ui_element", label: "Renamed independently", metadata: { projectId: "checkout" } }
    ],
    links: [{ source: "agent:ui", target: "functionality:checkout:checkout-ui", type: "implements" }]
  };
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: sourceOnlyReport, topology: sourceOnlyTopology });

  assert.equal(map.summary.agentCount, 1);
  assert.ok(map.links.some((link) => link.kind === "ownership" && link.associationBasis === "direct_topology_link"));
});

test("matches recorded owners and dependencies when equivalent source paths use different separators", () => {
  const pathVariantReport = {
    ...architectureAnalysisReport,
    majorFunctionalities: [{
      ...architectureAnalysisReport.majorFunctionalities[0],
      evidence: [{ reference: "./src/CheckoutForm.jsx:1" }],
      features: [{
        ...architectureAnalysisReport.majorFunctionalities[0].features[0],
        evidence: [{ reference: "./src/CheckoutForm.jsx:1" }]
      }]
    }]
  };
  const pathVariantTopology = {
    ...topology,
    nodes: topology.nodes.map((node) => node.id === "entity:ui"
      ? { ...node, metadata: { ...node.metadata, evidence: [{ reference: "src\\CheckoutForm.jsx:1" }] } }
      : node)
  };
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: pathVariantReport, topology: pathVariantTopology });

  assert.equal(map.summary.agentCount, 1);
  assert.equal(map.summary.serviceCount, 2);
  assert.equal(map.summary.unassignedFunctionalityCount, 0);
});

test("seeds deterministic column positions for canvas rendering", () => {
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport, topology });
  const nodes = seedDecisionMapLayout(map, 1000, 500);
  assert.ok(nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.ok(nodes.find((node) => node.kind === "agent").x > nodes.find((node) => node.kind === "functionality").x);
  assert.ok(nodes.find((node) => node.kind === "service").x > nodes.find((node) => node.kind === "agent").x);
});

test("groups recorded owners and supporting services beneath their decision branch", () => {
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport, topology });
  const [row] = decisionMapRows(map);
  assert.equal(row.functionality.label, "Complete checkout");
  assert.deepEqual(row.agents.map((agent) => agent.label), ["Experience Agent"]);
  assert.deepEqual(row.services.map((service) => service.label), ["Create payment intent", "Payment provider"]);
});

test("projects recorded and anticipated decision options only onto their exact functionality", () => {
  const map = buildApplicationDecisionMap({
    project,
    architectureAnalysisReport,
    topology,
    decisionBranches: [
      { id: "ledger-deferred", functionalityId: "major-checkout", title: "Defer express checkout", status: "deferred", __recordSource: "decision_ledger" },
      { id: "source-option", functionalityId: "major-checkout", title: "Offer a hosted payment alternative", status: "candidate", inferenceRole: "anticipated_alternative", historicalClaim: false },
      { id: "unmapped-same-label", functionalityId: "checkout-ui", title: "Checkout form", status: "rejected", __recordSource: "decision_ledger" }
    ]
  });
  const [row] = decisionMapRows(map);

  assert.equal(map.summary.decisionOptionCount, 2);
  assert.deepEqual(row.options.map((option) => [option.branchId, option.state]), [
    ["ledger-deferred", "deferred"],
    ["source-option", "anticipated"]
  ]);
  assert.ok(map.links.every((link) => link.kind !== "decision-option" || link.source === row.functionality.id));
  assert.equal(map.nodes.some((node) => node.branchId === "unmapped-same-label"), false, "a source-entity id or matching label cannot attach a branch option");
});

test("keeps an explicit analysis assignment distinct from recorded topology ownership", () => {
  const map = buildApplicationDecisionMap({
    project,
    architectureAnalysisReport: {
      ...architectureAnalysisReport,
      assignments: [{ functionalityId: "major-checkout", agentId: "architecture-agent", assignment: "reused" }]
    },
    topology: null
  });
  const [row] = decisionMapRows(map);

  assert.equal(map.summary.agentCount, 1);
  assert.equal(row.agents[0].label, "architecture-agent");
  assert.equal(row.agents[0].associationBasis, "analysis_assignment");
  assert.ok(map.links.some((link) => link.kind === "analysis-assignment" && link.target === row.functionality.id));
  assert.equal(map.summary.unassignedFunctionalityCount, 0);
});

test("matches an analysis assignment through an exact source functionality ID", () => {
  const map = buildApplicationDecisionMap({
    project,
    architectureAnalysisReport: {
      ...architectureAnalysisReport,
      assignments: [{ functionalityId: "checkout-ui", agentId: "source-ui-agent", assignment: "source capability owner" }]
    },
    topology: null
  });
  const [row] = decisionMapRows(map);

  assert.equal(row.agents.length, 1);
  assert.equal(row.agents[0].label, "source-ui-agent");
  assert.equal(row.agents[0].associationBasis, "analysis_assignment");
  assert.ok(map.links.some((link) => link.kind === "analysis-assignment" && link.target === row.functionality.id));
});

test("projects direct topology relationships between exact functionality entities", () => {
  const connectedReport = {
    projectId: "checkout",
    majorFunctionalities: [
      architectureAnalysisReport.majorFunctionalities[0],
      {
        id: "major-payment-intent",
        label: "Create payment intent",
        category: "api",
        sourceEntityId: "entity:api",
        sourceEntityIds: ["entity:api"],
        evidence: [{ reference: "src/payment.js:1" }]
      }
    ]
  };
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: connectedReport, topology });

  assert.equal(map.summary.functionalityDependencyCount, 1);
  assert.ok(map.links.some((link) =>
    link.kind === "functionality-dependency"
      && link.source === "decision-functionality:major-checkout"
      && link.target === "decision-functionality:major-payment-intent"
      && link.associationBasis === "direct_topology_link"
  ));
});

test("branches recorded selections, deferrals, and rejections from their build event without historicizing anticipated options", () => {
  const map = buildApplicationDecisionMap({
    project,
    architectureAnalysisReport: timelineArchitectureReport,
    decisionBranches: [
      { id: "selected-at-build", functionalityId: "checkout-ui", title: "Use embedded checkout", status: "selected", buildId: "checkout-ui-build", __recordSource: "decision_ledger" },
      { id: "deferred-at-build", functionalityId: "checkout-ui", title: "Defer hosted checkout", status: "deferred", __recordSource: "decision_ledger" },
      { id: "rejected-at-build", functionalityId: "checkout-ui", title: "Reject an unsafe checkout rewrite", status: "rejected", __recordSource: "decision_ledger" },
      { id: "anticipated-option", functionalityId: "checkout-ui", title: "Consider a future checkout path", status: "candidate", inferenceRole: "anticipated_alternative", historicalClaim: false }
    ]
  });
  const timeline = buildApplicationDeliveryTimeline({
    map,
    instructionTimeline: [{
      status: "succeeded",
      buildId: "checkout-ui-build",
      completedAt: "2026-08-18T12:00:00.000Z",
      changedFiles: ["src/CheckoutForm.jsx"]
    }]
  });
  const selected = map.nodes.find((node) => node.branchId === "selected-at-build");
  const buildEvent = timeline.eventNodes.find((node) => node.buildId === "checkout-ui-build");
  const decisionLinks = timeline.eventLinks.filter((link) => link.kind === "build-decision-option");

  assert.equal(map.summary.selectedOptionCount, 1);
  assert.ok(selected);
  assert.ok(buildEvent);
  assert.deepEqual(decisionLinks.map((link) => link.state).sort(), ["deferred", "rejected", "selected"]);
  assert.ok(decisionLinks.every((link) => link.source === buildEvent.id && link.historicalClaim));
  assert.equal(decisionLinks.find((link) => link.state === "selected").associationBasis, "direct_branch_build_reference");
  assert.equal(decisionLinks.find((link) => link.state === "selected").chronologyClaim, true);
  assert.ok(decisionLinks.filter((link) => link.state !== "selected").every((link) => link.associationBasis === "functionality_build_event_context" && !link.chronologyClaim));
  assert.equal(timeline.eventLinks.some((link) => link.target === "decision-option:anticipated-option"), false);
  assert.deepEqual(timeline.anticipatedOptionLinks.map((link) => [link.target, link.historicalClaim]), [["decision-option:anticipated-option", false]]);
  assert.equal(timeline.summary.branchedSelectedOptionCount, 1);
  assert.equal(timeline.summary.branchedDeferredOptionCount, 1);
  assert.equal(timeline.summary.branchedRejectedOptionCount, 1);
});

test("creates direct segue chronology links without using an anticipated-plan hub or sequencing unknown records", () => {
  const rows = [
    { functionality: { id: "functionality:recorded-one" }, timeline: { mode: "recorded_build", historicalClaim: true, occurredAt: "2026-08-18T10:00:00.000Z", order: 1 } },
    { functionality: { id: "functionality:recorded-two" }, timeline: { mode: "recorded_scope", historicalClaim: true, occurredAt: "2026-08-19T10:00:00.000Z", order: 2 } },
    { functionality: { id: "functionality:unknown" }, timeline: { mode: "unsequenced", historicalClaim: true, occurredAt: "", order: 3 } },
    { functionality: { id: "functionality:anticipated-one" }, timeline: { mode: "anticipated_delivery", historicalClaim: false, sourceOrder: 4, order: 4 } },
    { functionality: { id: "functionality:anticipated-two" }, timeline: { mode: "anticipated_delivery", historicalClaim: false, sourceOrder: 5, order: 5 } }
  ];

  assert.deepEqual(buildDeliveryChronologyLinks(rows), [
    {
      id: "functionality:recorded-one->functionality:recorded-two:chronology-segue",
      source: "functionality:recorded-one",
      target: "functionality:recorded-two",
      kind: "chronology-segue",
      chronologyMode: "recorded",
      chronologyClaim: true,
      historicalClaim: true,
      associationBasis: "recorded_delivery_chronology",
      fromOrder: 1,
      toOrder: 2
    },
    {
      id: "functionality:recorded-two->functionality:anticipated-one:chronology-segue",
      source: "functionality:recorded-two",
      target: "functionality:anticipated-one",
      kind: "chronology-segue",
      chronologyMode: "anticipated",
      chronologyClaim: false,
      historicalClaim: false,
      associationBasis: "anticipated_source_delivery_order",
      fromOrder: 2,
      toOrder: 4
    },
    {
      id: "functionality:anticipated-one->functionality:anticipated-two:chronology-segue",
      source: "functionality:anticipated-one",
      target: "functionality:anticipated-two",
      kind: "chronology-segue",
      chronologyMode: "anticipated",
      chronologyClaim: false,
      historicalClaim: false,
      associationBasis: "anticipated_source_delivery_order",
      fromOrder: 4,
      toOrder: 5
    }
  ]);
});

test("orders directly evidenced completed builds by recorded time before anticipated capability steps", () => {
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: timelineArchitectureReport });
  const timeline = buildApplicationDeliveryTimeline({
    map,
    instructionTimeline: [
      {
        status: "succeeded",
        buildId: "checkout-ui-later",
        completedAt: "2026-08-20T12:00:00.000Z",
        changedFiles: ["src/CheckoutForm.jsx"]
      },
      {
        status: "succeeded",
        buildId: "checkout-store-first",
        completedAt: "2026-08-19T12:00:00.000Z",
        flowPath: { featureActions: [{ id: "store-change", type: "modify", target: "src/checkoutStore.js" }] }
      }
    ]
  });

  assert.deepEqual(timeline.rows.map((row) => row.functionality.label), ["Persist checkout", "Checkout form", "Review checkout"]);
  assert.deepEqual(timeline.rows.slice(0, 2).map((row) => row.timeline.mode), ["recorded_build", "recorded_build"]);
  assert.equal(timeline.rows[0].timeline.buildId, "checkout-store-first");
  assert.equal(timeline.rows[0].timeline.label, "Recorded source change");
  assert.equal(timeline.rows[2].timeline.mode, "anticipated_delivery");
  assert.equal(timeline.rows[2].timeline.historicalClaim, false);
});

test("uses exact recorded scope only when a successful build names the functionality", () => {
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: timelineArchitectureReport });
  const timeline = buildApplicationDeliveryTimeline({
    map,
    instructionTimeline: [{
      status: "succeeded",
      buildId: "review-scope",
      completedAt: "2026-08-21T08:00:00.000Z",
      flowPath: { functionalityGraph: { nodes: [{ id: "functionality-node-1", sourceId: "checkout-review", type: "functionality" }] } }
    }]
  });
  const review = timeline.rows.find((row) => row.functionality.sourceFunctionalityId === "checkout-review");

  assert.equal(review.timeline.mode, "recorded_scope");
  assert.equal(review.timeline.basis, "recorded_flow_scope");
  assert.equal(review.timeline.label, "Recorded build scope");
});

test("keeps source-only delivery order anticipated and never upgrades failed build attempts", () => {
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: timelineArchitectureReport });
  const timeline = buildApplicationDeliveryTimeline({
    map,
    instructionTimeline: [{
      status: "failed",
      buildId: "failed-checkout-ui",
      completedAt: "2026-08-18T12:00:00.000Z",
      changedFiles: ["src/CheckoutForm.jsx"]
    }]
  });

  assert.deepEqual(timeline.rows.map((row) => row.functionality.label), ["Checkout form", "Persist checkout", "Review checkout"]);
  assert.ok(timeline.rows.every((row) => row.timeline.mode === "anticipated_delivery"));
  assert.ok(timeline.rows.every((row) => row.timeline.historicalClaim === false && !row.timeline.occurredAt));
  assert.equal(timeline.summary.completedBuildCount, 0);
});

test("does not attach a build to a capability from a matching label alone", () => {
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: timelineArchitectureReport });
  const timeline = buildApplicationDeliveryTimeline({
    map,
    instructionTimeline: [{
      status: "succeeded",
      buildId: "unrelated-checkout-copy",
      completedAt: "2026-08-18T12:00:00.000Z",
      flowPath: { functionalities: [{ id: "unrelated-id", label: "Checkout form", state: "completed" }] },
      changedFiles: ["src/unrelated-copy.js"]
    }]
  });
  const checkout = timeline.rows.find((row) => row.functionality.sourceFunctionalityId === "checkout-ui");

  assert.equal(checkout.timeline.mode, "anticipated_delivery");
  assert.equal(checkout.timeline.historicalClaim, false);
});

test("fails closed when a failed instruction conflicts with nested success metadata", () => {
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: timelineArchitectureReport });
  const timeline = buildApplicationDeliveryTimeline({
    map,
    instructionTimeline: [{
      status: "failed",
      buildId: "contradictory-build",
      completedAt: "2026-08-18T12:00:00.000Z",
      orchestrationSnapshot: { validation: { status: "passed" } },
      changedFiles: ["src/CheckoutForm.jsx"]
    }]
  });
  const checkout = timeline.rows.find((row) => row.functionality.sourceFunctionalityId === "checkout-ui");

  assert.equal(checkout.timeline.mode, "anticipated_delivery");
  assert.equal(timeline.summary.completedBuildCount, 0);
});

test("does not treat a validation pass as completion while the instruction is still running", () => {
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: timelineArchitectureReport });
  const timeline = buildApplicationDeliveryTimeline({
    map,
    instructionTimeline: [{
      status: "running",
      buildId: "running-build",
      completedAt: "2026-08-18T12:00:00.000Z",
      orchestrationSnapshot: { validation: { status: "passed" } },
      changedFiles: ["src/CheckoutForm.jsx"]
    }]
  });
  const checkout = timeline.rows.find((row) => row.functionality.sourceFunctionalityId === "checkout-ui");

  assert.equal(checkout.timeline.mode, "anticipated_delivery");
  assert.equal(timeline.summary.completedBuildCount, 0);
});

test("keeps matching build evidence without a timestamp explicitly unsequenced", () => {
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: timelineArchitectureReport });
  const timeline = buildApplicationDeliveryTimeline({
    map,
    instructionTimeline: [{
      status: "succeeded",
      buildId: "undated-checkout-ui",
      changedFiles: ["src/CheckoutForm.jsx"]
    }]
  });
  const checkout = timeline.rows.find((row) => row.functionality.sourceFunctionalityId === "checkout-ui");

  assert.equal(checkout.timeline.mode, "unsequenced");
  assert.equal(checkout.timeline.historicalClaim, true);
  assert.equal(timeline.summary.hasRecordedEvidence, true);
  assert.equal(timeline.summary.hasRecordedChronology, false);
  assert.equal(timeline.summary.unmatchedBuildCount, 0);
});

test("does not mark a later recorded edit of the same capability as unmatched", () => {
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: timelineArchitectureReport });
  const timeline = buildApplicationDeliveryTimeline({
    map,
    instructionTimeline: [
      { status: "succeeded", buildId: "checkout-ui-first", completedAt: "2026-08-18T12:00:00.000Z", changedFiles: ["src/CheckoutForm.jsx"] },
      { status: "succeeded", buildId: "checkout-ui-later", completedAt: "2026-08-19T12:00:00.000Z", changedFiles: ["src/CheckoutForm.jsx"] }
    ]
  });
  const checkout = timeline.rows.find((row) => row.functionality.sourceFunctionalityId === "checkout-ui");

  assert.equal(checkout.timeline.buildId, "checkout-ui-first");
  assert.equal(timeline.summary.completedBuildCount, 2);
  assert.equal(timeline.summary.unmatchedBuildCount, 0);
});

test("keeps the earliest matching recorded scope ahead of a later source-file edit", () => {
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: timelineArchitectureReport });
  const timeline = buildApplicationDeliveryTimeline({
    map,
    instructionTimeline: [
      {
        status: "succeeded",
        buildId: "checkout-ui-scope-first",
        completedAt: "2026-08-18T12:00:00.000Z",
        flowPath: { functionalities: [{ id: "checkout-ui", state: "completed" }] }
      },
      {
        status: "succeeded",
        buildId: "checkout-ui-file-later",
        completedAt: "2026-08-19T12:00:00.000Z",
        changedFiles: ["src/CheckoutForm.jsx"]
      }
    ]
  });
  const checkout = timeline.rows.find((row) => row.functionality.sourceFunctionalityId === "checkout-ui");

  assert.equal(checkout.timeline.mode, "recorded_scope");
  assert.equal(checkout.timeline.buildId, "checkout-ui-scope-first");
});

test("preserves case-sensitive scope IDs and distinct Windows source paths", () => {
  const exactnessReport = {
    projectId: "checkout",
    majorFunctionalities: [
      { id: "CaseSensitiveId", label: "Case-sensitive scope", evidence: [{ reference: "C:\\repo\\CaseScope.jsx:1" }], chronology: { deliveryOrder: 1 } },
      { id: "windows-a", label: "Windows A", evidence: [{ reference: "C:\\repo\\A.jsx:1" }], chronology: { deliveryOrder: 2 } },
      { id: "windows-b", label: "Windows B", evidence: [{ reference: "C:\\repo\\B.jsx:1" }], chronology: { deliveryOrder: 3 } }
    ]
  };
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: exactnessReport });
  const scopeOnly = buildApplicationDeliveryTimeline({
    map,
    instructionTimeline: [{
      status: "succeeded",
      buildId: "wrong-case-scope",
      completedAt: "2026-08-18T12:00:00.000Z",
      flowPath: { functionalities: [{ id: "casesensitiveid", state: "completed" }] }
    }]
  });
  const sourcePath = buildApplicationDeliveryTimeline({
    map,
    instructionTimeline: [{
      status: "succeeded",
      buildId: "windows-b-build",
      completedAt: "2026-08-18T12:00:00.000Z",
      changedFiles: ["C:\\repo\\B.jsx"]
    }]
  });

  assert.equal(scopeOnly.rows.find((row) => row.functionality.sourceFunctionalityId === "CaseSensitiveId").timeline.mode, "anticipated_delivery");
  assert.equal(sourcePath.rows.find((row) => row.functionality.sourceFunctionalityId === "windows-a").timeline.mode, "anticipated_delivery");
  assert.equal(sourcePath.rows.find((row) => row.functionality.sourceFunctionalityId === "windows-b").timeline.mode, "recorded_build");
});

test("filters delivery history to the requested application before matching capability evidence", () => {
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: timelineArchitectureReport });
  const timeline = buildApplicationDeliveryTimeline({
    map,
    projectId: "checkout",
    instructionTimeline: [{
      projectId: "other-application",
      status: "succeeded",
      buildId: "other-app-checkout-file",
      completedAt: "2026-08-18T12:00:00.000Z",
      changedFiles: ["src/CheckoutForm.jsx"]
    }]
  });
  const checkout = timeline.rows.find((row) => row.functionality.sourceFunctionalityId === "checkout-ui");

  assert.equal(checkout.timeline.mode, "anticipated_delivery");
  assert.equal(timeline.summary.completedBuildCount, 0);
});

test("retains source-backed functionality and service facts for node insight details", () => {
  const report = {
    ...architectureAnalysisReport,
    majorFunctionalities: [{
      ...architectureAnalysisReport.majorFunctionalities[0],
      description: "Collects and validates a customer checkout submission.",
      features: [{
        ...architectureAnalysisReport.majorFunctionalities[0].features[0],
        sourceHints: { route: { sourcePath: "src/CheckoutForm.jsx" } }
      }]
    }]
  };
  const detailedTopology = {
    ...topology,
    nodes: topology.nodes.map((node) => node.id === "entity:payments"
      ? {
          ...node,
          metadata: {
            ...node.metadata,
            description: "Routes payment authorization to the configured provider.",
            sourceHints: { route: { sourcePath: "src/payments.js" } }
          }
        }
      : node)
  };
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: report, topology: detailedTopology });
  const functionality = map.nodes.find((node) => node.kind === "functionality");
  const service = map.nodes.find((node) => node.kind === "service" && node.label === "Payment provider");

  assert.equal(functionality.description, "Collects and validates a customer checkout submission.");
  assert.deepEqual(functionality.evidence, [{ reference: "src/CheckoutForm.jsx:1" }]);
  assert.equal(functionality.features[0].sourceHints.route.sourcePath, "src/CheckoutForm.jsx");
  assert.equal(service.description, "Routes payment authorization to the configured provider.");
  assert.equal(service.sourceEntityId, "entity:payments");
  assert.equal(service.sourceHints.route.sourcePath, "src/payments.js");
});

test("retains sanitized recorded build actions, changed files, and scopes for node insight details", () => {
  const map = buildApplicationDecisionMap({ project, architectureAnalysisReport: timelineArchitectureReport });
  const timeline = buildApplicationDeliveryTimeline({
    map,
    instructionTimeline: [{
      status: "succeeded",
      buildId: "checkout-insight-build",
      completedAt: "2026-08-18T12:00:00.000Z",
      parentWorkflowId: "workflow-checkout-insight",
      changedFiles: ["src/CheckoutForm.jsx"],
      flowPath: {
        featureActions: [{ type: "modify", target: "src/CheckoutForm.jsx", status: "completed" }],
        functionalities: [{ id: "checkout-ui", label: "Checkout form" }]
      }
    }]
  });
  const event = timeline.eventNodes.find((node) => node.buildId === "checkout-insight-build");

  assert.equal(event.parentWorkflowId, "workflow-checkout-insight");
  assert.deepEqual(event.buildDetails.actions, [{ type: "modify", target: "src/CheckoutForm.jsx", status: "completed" }]);
  assert.deepEqual(event.buildDetails.changedFiles, ["src/CheckoutForm.jsx"]);
  assert.deepEqual(event.buildDetails.scopes, [{ id: "checkout-ui", label: "Checkout form", sourceEntityIds: [] }]);
  assert.ok(event.evidence.some((item) => item.kind === "build_action" && item.value === "src/CheckoutForm.jsx"));
});
