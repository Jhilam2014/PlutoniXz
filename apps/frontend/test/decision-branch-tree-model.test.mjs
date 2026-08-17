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
  decisionBranchStateLabel,
  decisionBranchVisualKind,
  hasHeavyDeferredComplexity,
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
  assert.equal(decisionBranchStateLabel({ status: "rejected" }), "disabled");
  assert.equal(decisionBranchStateLabel({ status: "reconsidering" }), "reconsidering");
});

test("workshop cues distinguish current implementation, governed possibilities, and dormant provenance without granting authority", () => {
  const current = { id: "current", status: "candidate", candidate: { inferenceRole: "observed_current" }, evidence: [{ id: "source-1" }] };
  const possibility = { id: "future", status: "deferred", autoReconsideration: true, evidence: [{ id: "source-2" }, { id: "source-3" }] };
  const dormant = { id: "retired", status: "rejected", allowRejectedReconsideration: true, evidence: [{ id: "source-4" }] };

  assert.equal(decisionBranchVisualKind(current), "current");
  assert.equal(decisionBranchVisualKind(possibility), "possibility");
  assert.equal(decisionBranchVisualKind(dormant), "dormant");
  assert.equal(decisionBranchReviewSignal(dormant).label, "Dormant / reconsiderable");

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
