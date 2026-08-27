import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDecisionBranchLandscape,
  buildDecisionObjectiveLedger,
  buildDecisionTimelineFlow,
  buildDecisionBranchTree,
  decisionBranchLineageIds,
  decisionBranchDeferredComplexity,
  decisionBranchReviewSignal,
  decisionBranchProjectionState,
  decisionBranchStateLabel,
  decisionBranchVisualKind,
  hasHeavyDeferredComplexity,
  normalizeDecisionTimelineBranches,
  decisionBranchWorkshopSummary,
  isDisabledDecisionBranch
} from "../src/decisionBranchTreeModel.js";

test("builds a project genesis tree from branch lineage without merging projects", () => {
  const tree = buildDecisionBranchTree({
    projectId: "orders",
    projectName: "Orders",
    branches: [
      { id: "current", status: "candidate", createdAt: "2026-01-01T00:00:00.000Z", objective: { summary: "Observed Orders API" } },
      { id: "async", parentBranchId: "current", status: "deferred", createdAt: "2026-01-02T00:00:00.000Z", objective: { summary: "Queue orders" } },
      { id: "orphan", parentBranchId: "not-loaded", status: "candidate", createdAt: "2026-01-03T00:00:00.000Z", objective: { summary: "Preserved imported branch" } }
    ]
  });

  assert.equal(tree.genesis.id, "genesis:orders");
  assert.deepEqual(tree.genesis.children.map((node) => node.id), ["current", "orphan"]);
  assert.deepEqual(tree.genesis.children[0].children.map((node) => node.id), ["async"]);
  assert.equal(tree.genesis.children[1].parentMissing, true);
  assert.equal(tree.activeCount, 3);
});

test("only terminally disabled branch states receive disabled tree treatment", () => {
  assert.equal(isDisabledDecisionBranch({ status: "deferred" }), false);
  assert.equal(isDisabledDecisionBranch({ status: "rejected" }), true);
  assert.equal(isDisabledDecisionBranch({ status: "superseded" }), true);
  assert.equal(isDisabledDecisionBranch({ status: "retired" }), true);
  assert.equal(decisionBranchStateLabel({ status: "rejected" }), "recorded rejected · dormant");
  assert.equal(decisionBranchStateLabel({ status: "reconsidering" }), "reconsidering");
});

test("workshop cues distinguish current implementation, governed possibilities, and dormant provenance without granting authority", () => {
  const current = { id: "current", status: "candidate", candidate: { inferenceRole: "observed_current" }, evidence: [{ id: "source-1" }] };
  const possibility = { id: "future", status: "deferred", autoReconsideration: true, evidence: [{ id: "source-2" }, { id: "source-3" }] };
  const dormant = { id: "retired", status: "rejected", allowRejectedReconsideration: true, evidence: [{ id: "source-4" }] };

  assert.equal(decisionBranchVisualKind(current), "current");
  assert.equal(decisionBranchVisualKind(possibility), "possibility");
  assert.equal(decisionBranchVisualKind(dormant), "dormant");
  assert.equal(decisionBranchReviewSignal(dormant).label, "Recorded rejected / reconsiderable");

  const summary = decisionBranchWorkshopSummary([current, possibility, dormant]);
  assert.deepEqual(summary.current.map((entry) => entry.branch.id), ["current"]);
  assert.deepEqual(summary.possibilities.map((entry) => entry.branch.id), ["future"]);
  assert.deepEqual(summary.dormant.map((entry) => entry.branch.id), ["retired"]);
  assert.ok(summary.reviewQueue.every((entry) => !entry.signal.disabled), "disabled provenance is kept out of the live review queue");
  assert.deepEqual(summary.dormantQueue.map((entry) => entry.branch.id), ["retired"]);
});

test("lays out source functionality zones around a project genesis while preserving active and dormant branch lineage", () => {
  const landscape = buildDecisionBranchLandscape({
    projectId: "orders",
    projectName: "Orders",
    analysisReport: {
      functionalities: [
        { id: "ui-landing", label: "Landing interface", category: "ui", evidence: [{ id: "ui-source" }] },
        { id: "data-orders", label: "Order data boundary", category: "data", evidence: [{ id: "data-source" }] }
      ]
    },
    branches: [
      { id: "landing-current", status: "candidate", candidate: { inferenceRole: "observed_current", functionalityId: "ui-landing" }, evidence: [{ id: "ui-source" }] },
      { id: "landing-alt", parentBranchId: "landing-current", status: "deferred", autoReconsideration: true, candidate: { functionalityId: "ui-landing" }, objective: { summary: "Progressive landing delivery" }, evidence: [{ id: "ui-source" }, { id: "ui-route" }] },
      { id: "data-current", status: "candidate", candidate: { inferenceRole: "observed_current", functionalityId: "data-orders" }, evidence: [{ id: "data-source" }] },
      { id: "data-retired", parentBranchId: "data-current", status: "rejected", candidate: { functionalityId: "data-orders" }, objective: { summary: "Retired schema strategy" }, evidence: [{ id: "data-source" }] }
    ]
  });

  assert.equal(landscape.functionalityCount, 2);
  assert.equal(landscape.genesis.x, landscape.canvas.width / 2);
  assert.equal(landscape.zones.length, 2);
  assert.ok(landscape.canvas.width >= 1200, "the landscape reserves a broad canvas instead of inflating node size");
  assert.ok(landscape.zones.every((zone) => zone.width >= 360 && zone.height >= 324));
  assert.ok(landscape.links.some((link) => link.sourceBranchId === "landing-current" && link.targetBranchId === "landing-alt"));

  const current = landscape.nodes.find((node) => node.branchId === "landing-current");
  const alternative = landscape.nodes.find((node) => node.branchId === "landing-alt");
  const dormant = landscape.nodes.find((node) => node.branchId === "data-retired");
  assert.equal(current.visualKind, "current");
  assert.ok(current.radius > alternative.radius, "current source functionality remains the largest node in its zone");
  assert.ok(landscape.nodes.every((node) => node.radius >= 19 && node.radius <= 34), "node radii remain compact enough for spaced canvas navigation");
  const currentZone = landscape.zones.find((zone) => zone.id === current.zoneId);
  assert.ok(current.y - current.radius > currentZone.y + 70, "root nodes clear the functionality-zone header and connector ingress");
  assert.ok(alternative.y > current.y, "lineage grows downward from observed current implementation");
  assert.equal(dormant.visualKind, "dormant");
  assert.equal(dormant.signal.disabled, true);

  const [first, second] = landscape.zones;
  assert.ok(first.x + first.width <= second.x || second.x + second.width <= first.x || first.y + first.height <= second.y || second.y + second.height <= first.y, "functionality zones do not overlap");
});

test("adds a visual-only impact-review stage only for a deferred branch with recorded heavy change and risk dimensions", () => {
  const heavyDeferred = {
    id: "heavy-deferred",
    status: "deferred",
    autoReconsideration: true,
    candidate: {
      functionalityId: "data-orders",
      scoreBreakdown: {
        estimatedChangeCost: 0.82,
        dataMigrationRisk: 0.78,
        dependencyOperationalRisk: 0.61
      }
    },
    objective: { summary: "Migrate order storage" },
    evidence: [{ id: "order-model" }]
  };
  const incompleteDeferred = {
    id: "incomplete-deferred",
    status: "deferred",
    autoReconsideration: true,
    candidate: { functionalityId: "data-orders", scoreBreakdown: { estimatedChangeCost: 0.94 } },
    objective: { summary: "Unscored storage option" }
  };
  const landscape = buildDecisionBranchLandscape({
    projectId: "orders",
    analysisReport: { functionalities: [{ id: "data-orders", label: "Order data", category: "data" }] },
    branches: [heavyDeferred, incompleteDeferred]
  });

  assert.equal(decisionBranchDeferredComplexity(heavyDeferred), 0.764);
  assert.equal(hasHeavyDeferredComplexity(heavyDeferred), true);
  assert.equal(decisionBranchDeferredComplexity(incompleteDeferred), null, "incomplete scoring never creates a guessed stage");
  assert.equal(landscape.deferredReviewStageCount, 1);
  const stage = landscape.nodes.find((node) => node.kind === "deferred-review-stage");
  const source = landscape.nodes.find((node) => node.branchId === "heavy-deferred");
  assert.equal(stage.lineageBranchId, heavyDeferred.id);
  assert.equal(stage.branchId, "", "a visual review stage is never a decision ledger branch");
  assert.ok(stage.y > source.y, "the additional review stage is below its deferred alternative");
  assert.ok(landscape.links.some((link) => link.kind === "review-stage" && link.sourceBranchId === heavyDeferred.id));
});

test("focuses the full connected provenance lineage without merging unrelated functionality records", () => {
  const branches = [
    { id: "current", status: "candidate" },
    { id: "deferred", parentBranchId: "current", status: "deferred" },
    { id: "dormant", parentBranchId: "current", status: "rejected" },
    { id: "unrelated", status: "candidate" },
    { id: "orphan", parentBranchId: "missing", status: "rejected" }
  ];
  assert.deepEqual([...decisionBranchLineageIds(branches, "deferred")].sort(), ["current", "deferred", "dormant"].sort());
  assert.deepEqual([...decisionBranchLineageIds(branches, "orphan")], ["orphan"]);
  assert.deepEqual([...decisionBranchLineageIds(branches, "missing")], []);
});

test("builds an objective-first ledger and preserves why current and alternative paths are not equivalent", () => {
  const analysisReport = {
    objectives: [{ id: "objective-orders", label: "Deliver order retrieval", majorFunctionalityIds: ["major-orders"], featureCount: 3 }],
    majorFunctionalities: [{
      id: "major-orders",
      objectiveId: "objective-orders",
      label: "Orders retrieval",
      category: "ui",
      evidence: [{ id: "page-source" }],
      features: [{ id: "button", label: "Load orders", entityType: "ui_element" }, { id: "route", label: "GET /api/orders", entityType: "api_route" }]
    }]
  };
  const current = {
    id: "current-orders",
    status: "candidate",
    candidate: { inferenceRole: "observed_current", functionalityId: "major-orders", decisionRationale: "Source evidence confirms the current retrieval flow; it does not prove a historical selection reason." },
    objective: { summary: "Observed orders retrieval" }
  };
  const alternative = {
    id: "alternative-orders",
    status: "deferred",
    candidate: { inferenceRole: "deferred_alternative", functionalityId: "major-orders", decisionRationale: "Not selected: this possibility still needs governed validation and approval." },
    objective: { summary: "Introduce a route-level lazy-loading boundary" }
  };
  analysisReport.suppressedCandidates = [{
    id: "suppressed-migration",
    functionalityId: "major-orders",
    title: "Use a forward-compatible data migration path",
    score: 0.42,
    suppressionReason: "below_branch_value_threshold",
    dimensions: { estimatedChangeCost: 0.7, dataMigrationRisk: 0.66 }
  }];
  const ledger = buildDecisionObjectiveLedger({ analysisReport, branches: [current, alternative] });
  assert.equal(ledger.objectiveCount, 1);
  assert.equal(ledger.majorFunctionalityCount, 1);
  assert.equal(ledger.featureCount, 2);
  assert.equal(ledger.objectives[0].functionalities[0].selectedPath.branch.id, current.id);
  assert.equal(ledger.objectives[0].functionalities[0].selectedPath.confirmed, false, "source observation is never presented as a confirmed historical selection");
  assert.equal(ledger.objectives[0].functionalities[0].alternatives[0].disposition, "not_selected");
  assert.match(ledger.objectives[0].functionalities[0].alternatives[0].reason, /needs governed validation/i);
  assert.match(ledger.objectives[0].functionalities[0].suppressedAlternatives[0].reason, /did not meet the publication threshold.*estimated change cost/i);
});

test("collapses legacy elementary source branches instead of presenting them as decision-sized paths", () => {
  const analysisReport = {
    sourceDigest: "same-source",
    objectives: [{ id: "objective", label: "Deliver orders", majorFunctionalityIds: ["major-orders"] }],
    majorFunctionalities: [{ id: "major-orders", objectiveId: "objective", label: "Orders", features: [], evidence: [] }]
  };
  const ledger = buildDecisionObjectiveLedger({ analysisReport, branches: [
    { id: "major-current", status: "candidate", candidate: { inferenceRole: "observed_current", functionalityId: "major-orders", sourceDigest: "same-source" } },
    { id: "legacy-button", status: "candidate", candidate: { inferenceRole: "observed_current", functionalityId: "ui-button", sourceDigest: "same-source" } },
    { id: "operator-branch", status: "deferred", candidate: { functionalityId: "operator-choice" } }
  ] });
  assert.equal(ledger.featureObservationCount, 1);
  assert.deepEqual(ledger.decisionBranches.map((branch) => branch.id).sort(), ["major-current", "operator-branch"]);
  assert.deepEqual(ledger.unmappedBranches.map((branch) => branch.id), ["operator-branch"]);
});

test("uses recorded ledger events for decision-flow timeline order and labels missing sequence as anticipated", () => {
  const analysisReport = {
    objectives: [{ id: "objective-orders", label: "Deliver orders", majorFunctionalityIds: ["major-orders"] }],
    majorFunctionalities: [{ id: "major-orders", objectiveId: "objective-orders", label: "Orders", category: "ui", features: [], evidence: [] }]
  };
  const current = { id: "current", status: "candidate", candidate: { inferenceRole: "observed_current", functionalityId: "major-orders" }, objective: { summary: "Observed orders" } };
  const option = { id: "option", parentBranchId: "current", status: "deferred", autoReconsideration: true, candidate: { inferenceRole: "deferred_alternative", functionalityId: "major-orders" }, objective: { summary: "Use an asynchronous order path" } };
  const flow = buildDecisionTimelineFlow({
    projectId: "orders",
    projectName: "Orders",
    analysisReport,
    branches: [current, option],
    graph: {
      nodes: [{ id: "event:create-current", kind: "event", eventType: "branch.created", occurredAt: "2026-01-01T00:00:00.000Z" }],
      edges: [{ id: "recorded", kind: "recorded_for", source: "event:create-current", target: "branch:current" }]
    }
  });
  const currentNode = flow.nodes.find((node) => node.branchId === "current");
  const optionNode = flow.nodes.find((node) => node.branchId === "option");
  assert.equal(flow.layout, "timeline");
  assert.equal(currentNode.timelineKind, "known");
  assert.match(currentNode.timelineLabel, /branch\.created/i);
  assert.equal(optionNode.timelineKind, "anticipated");
  assert.match(optionNode.timelineLabel, /anticipated/i);
  assert.ok(optionNode.x > currentNode.x, "the anticipated option follows the known current decision in the lane");
  assert.ok(flow.links.some((link) => link.kind === "lineage" && link.sourceBranchId === "current" && link.targetBranchId === "option"));
});

test("projects normalized source alternatives and rejections as non-historical anticipated timeline nodes", () => {
  const analysisReport = {
    objectives: [{ id: "objective-orders", label: "Deliver orders", majorFunctionalityIds: ["major-orders"] }],
    majorFunctionalities: [{ id: "major-orders", objectiveId: "objective-orders", label: "Orders", category: "ui", features: [], evidence: [] }]
  };
  const sourceAlternative = {
    id: "anticipated-alt",
    functionalityId: "major-orders",
    label: "Introduce a reversible asynchronous order boundary",
    state: "anticipated",
    status: "deferred",
    inferenceRole: "deferred_alternative",
    recordSource: "architecture_report",
    recordClassification: "anticipated",
    historicalClaim: false,
    temporal: { createdAt: "2026-01-03T00:00:00.000Z" },
    branch: {
      id: "anticipated-alt",
      functionalityId: "major-orders",
      status: "deferred",
      createdAt: "2026-01-03T00:00:00.000Z",
      candidate: { functionalityId: "major-orders", inferenceRole: "deferred_alternative" }
    }
  };
  const sourceRejection = {
    id: "anticipated-rejection",
    functionalityId: "major-orders",
    label: "Break the published Orders response contract",
    state: "anticipated_rejected",
    status: "rejected",
    inferenceRole: "anticipated_rejected",
    recordSource: "architecture_report",
    recordClassification: "anticipated",
    historicalClaim: false,
    temporal: { createdAt: "2026-01-04T00:00:00.000Z" },
    branch: {
      id: "anticipated-rejection",
      functionalityId: "major-orders",
      status: "rejected",
      createdAt: "2026-01-04T00:00:00.000Z",
      candidate: { functionalityId: "major-orders", inferenceRole: "anticipated_rejected" }
    }
  };
  const normalized = normalizeDecisionTimelineBranches([sourceAlternative, sourceRejection]);

  assert.equal(normalized[0].status, "anticipated");
  assert.equal(normalized[0].candidate.functionalityId, "major-orders");
  assert.equal(normalized[1].status, "anticipated_rejected");
  assert.equal(decisionBranchProjectionState(sourceAlternative), "anticipated");
  assert.equal(decisionBranchProjectionState(sourceRejection), "anticipated_rejected");
  assert.equal(decisionBranchVisualKind(sourceAlternative), "anticipated");
  assert.equal(decisionBranchVisualKind(sourceRejection), "anticipated_rejected");
  assert.equal(decisionBranchStateLabel(sourceRejection), "anticipated rejection");
  assert.equal(isDisabledDecisionBranch(sourceRejection), false, "a source-projected rejection remains an anticipated constraint, not dormant history");
  assert.equal(decisionBranchProjectionState({
    id: "source-deferred",
    status: "deferred",
    __recordSource: "architecture_report",
    candidate: { inferenceRole: "deferred_alternative" }
  }), "anticipated", "a raw source-report alternative is adapted even before it is wrapped as a branch row");
  assert.equal(decisionBranchProjectionState({
    id: "ledger-deferred",
    status: "deferred",
    __recordSource: "decision_ledger",
    candidate: { inferenceRole: "deferred_alternative" }
  }), "deferred", "the same role on a persisted ledger branch stays governed");

  const flow = buildDecisionTimelineFlow({
    projectId: "orders",
    projectName: "Orders",
    analysisReport,
    branches: [
      {
        id: "selected-orders",
        functionalityId: "major-orders",
        status: "selected",
        createdAt: "2026-01-01T00:00:00.000Z",
        objective: { summary: "Selected Orders delivery" },
        candidate: { functionalityId: "major-orders" }
      },
      sourceAlternative,
      sourceRejection
    ],
    graph: {
      nodes: [
        { id: "event:selected", kind: "event", eventType: "branch.created", occurredAt: "2026-01-01T00:00:00.000Z" },
        { id: "event:source-alt", kind: "event", eventType: "source.parsed", occurredAt: "2026-01-03T00:00:00.000Z" },
        { id: "event:source-rejection", kind: "event", eventType: "source.parsed", occurredAt: "2026-01-04T00:00:00.000Z" }
      ],
      edges: [
        { id: "selected-event", kind: "recorded_for", source: "event:selected", target: "branch:selected-orders" },
        { id: "source-alt-event", kind: "recorded_for", source: "event:source-alt", target: "branch:anticipated-alt" },
        { id: "source-rejection-event", kind: "recorded_for", source: "event:source-rejection", target: "branch:anticipated-rejection" }
      ]
    }
  });
  const alternativeNode = flow.nodes.find((node) => node.branchId === "anticipated-alt");
  const rejectionNode = flow.nodes.find((node) => node.branchId === "anticipated-rejection");

  assert.equal(flow.knownCount, 1, "source timestamps and graph events never upgrade anticipated rows to historical steps");
  assert.equal(flow.anticipatedCount, 2);
  assert.equal(alternativeNode.visualKind, "anticipated");
  assert.equal(rejectionNode.visualKind, "anticipated_rejected");
  assert.equal(alternativeNode.timelineKind, "anticipated");
  assert.equal(rejectionNode.timelineKind, "anticipated");
  assert.match(alternativeNode.timelineLabel, /anticipated: evaluate alternative/i);
  assert.match(rejectionNode.timelineLabel, /anticipated: constraint-based rejection/i);
});

test("projects explicit analysis assignments only onto exact functionality lanes without claiming topology ownership", () => {
  const analysisReport = {
    objectives: [{ id: "objective-delivery", label: "Deliver orders and inventory", majorFunctionalityIds: ["major-orders", "major-inventory"] }],
    majorFunctionalities: [
      { id: "major-orders", objectiveId: "objective-delivery", label: "Orders", category: "ui", features: [], evidence: [] },
      { id: "major-inventory", objectiveId: "objective-delivery", label: "Inventory", category: "data", features: [], evidence: [] }
    ]
  };
  const flow = buildDecisionTimelineFlow({
    projectId: "delivery",
    projectName: "Delivery",
    analysisReport,
    branches: [
      { id: "orders-current", status: "candidate", candidate: { inferenceRole: "observed_current", functionalityId: "major-orders" }, objective: { summary: "Observed orders delivery" } },
      { id: "orders-option", parentBranchId: "orders-current", status: "deferred", candidate: { functionalityId: "major-orders" }, objective: { summary: "Queue orders" } },
      { id: "inventory-current", status: "candidate", candidate: { inferenceRole: "observed_current", functionalityId: "major-inventory" }, objective: { summary: "Observed inventory delivery" } }
    ],
    assignments: [
      { functionalityId: "major-orders", agentId: "delivery-agent", assignment: "implementation", responsibilityMatch: "order flow" },
      { functionalityId: "major-orders", agentId: "delivery-agent", assignment: "validation" },
      { functionalityId: "major-inventory", agentId: "data-agent", assignment: "data boundary", responsibilityMatch: "inventory storage" },
      { functionalityId: "major-order", agentId: "wrong-agent", assignment: "must not attach" },
      { functionalityId: "major-orders", agentId: "", assignment: "invalid" }
    ]
  });

  assert.equal(flow.assignmentCount, 3, "only assignment rows with an exact rendered functionality lane are attached");
  assert.equal(flow.agentCount, 2);
  assert.equal(flow.agentNodeCount, 2, "duplicate assignments for an agent/functionality pair share one visual agent node");
  assert.equal(flow.unmatchedAssignmentCount, 1);
  assert.equal(flow.invalidAssignmentCount, 1);
  assert.equal(flow.agentLinks.length, 2);

  const ordersAgent = flow.agentNodes.find((node) => node.agentId === "delivery-agent");
  assert.equal(ordersAgent.functionalityId, "major-orders");
  assert.equal(ordersAgent.assignmentCount, 2);
  assert.match(ordersAgent.assignment, /implementation/);
  assert.match(ordersAgent.assignment, /validation/);
  assert.equal(ordersAgent.associationBasis, "analysis_assignment");
  assert.equal(ordersAgent.historicalClaim, false);
  assert.equal(ordersAgent.recordedTopologyOwnership, false);
  assert.equal(ordersAgent.provenance.source, "architecture_analysis_report.assignments");

  assert.ok(flow.agentLinks.every((link) => link.kind === "analysis-assignment"));
  assert.ok(flow.agentLinks.every((link) => link.associationBasis === "analysis_assignment"));
  assert.ok(flow.agentLinks.every((link) => link.recordedTopologyOwnership === false));
  assert.ok(flow.agentLinks.every((link) => link.target.functionalityId === link.functionalityId), "an assignment edge anchors only to an exact functionality lane");
  assert.equal(flow.agentLinks.some((link) => link.sourceAgentId === "wrong-agent"), false, "partial functionality IDs never create a visual association");
  assert.equal(flow.links.some((link) => link.kind === "analysis-assignment"), false, "analysis assignments remain separate from decision lineage links");
});

test("expands dense analysis-assignment stacks within their timeline lane", () => {
  const analysisReport = {
    objectives: [{ id: "objective-delivery", label: "Deliver orders and inventory", majorFunctionalityIds: ["major-orders", "major-inventory"] }],
    majorFunctionalities: [
      { id: "major-orders", objectiveId: "objective-delivery", label: "Orders", category: "ui", features: [], evidence: [] },
      { id: "major-inventory", objectiveId: "objective-delivery", label: "Inventory", category: "data", features: [], evidence: [] }
    ]
  };
  const flow = buildDecisionTimelineFlow({
    projectId: "delivery",
    projectName: "Delivery",
    analysisReport,
    branches: [
      { id: "orders-current", status: "candidate", candidate: { inferenceRole: "observed_current", functionalityId: "major-orders" }, objective: { summary: "Observed orders delivery" } },
      { id: "inventory-current", status: "candidate", candidate: { inferenceRole: "observed_current", functionalityId: "major-inventory" }, objective: { summary: "Observed inventory delivery" } }
    ],
    assignments: Array.from({ length: 6 }, (_, index) => ({
      functionalityId: "major-orders",
      agentId: `orders-agent-${index + 1}`,
      assignment: "implementation"
    }))
  });

  const zone = flow.zones.find((item) => item.id === "objective:objective-delivery");
  const ordersNode = flow.nodes.find((node) => node.branchId === "orders-current");
  const inventoryNode = flow.nodes.find((node) => node.branchId === "inventory-current");
  const agents = flow.agentNodes
    .filter((node) => node.functionalityId === "major-orders")
    .sort((left, right) => left.y - right.y);

  assert.equal(agents.length, 6);
  assert.equal(ordersNode.assignmentAgentNodeCount, 6);
  assert.ok(ordersNode.laneHeight > 142, "a five-plus agent stack expands its source functionality lane");
  assert.ok(agents.every((node) => node.stackCount === 6));
  for (let index = 1; index < agents.length; index += 1) {
    const previous = agents[index - 1];
    const current = agents[index];
    assert.ok(current.y - previous.y >= previous.radius + current.radius + 1, "adjacent agent circles retain a visible gap");
  }
  assert.ok(agents.every((node) => node.y - node.radius >= zone.y + 34 && node.y + node.radius <= zone.y + zone.height - 34), "the complete agent stack remains inside the objective zone");
  assert.ok(Math.max(...agents.map((node) => node.y + node.radius)) < inventoryNode.y - inventoryNode.radius, "the expanded stack clears the next functionality lane");
  assert.ok(flow.canvas.height >= zone.y + zone.height + 38, "canvas height grows with the expanded objective zone");
});
