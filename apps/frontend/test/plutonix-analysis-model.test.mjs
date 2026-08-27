import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  applicationOrigin,
  applicationDecisionSummary,
  branchRows,
  buildDecisionLineages,
  buildDecisionPathBoard,
  buildPortfolioDirectory,
  decisionState,
  enterpriseAssignmentDraft,
  enterprisePatch,
  mergeDecisionBranches,
  normalizePortfolioRelations,
  planEnterpriseAssignments,
  portfolioDecisionSummary,
  realReconsiderationSignals
} from "../src/plutonixAnalysisModel.js";

function ledgerBranch(id, {
  functionalityId = "checkout",
  parentBranchId = "",
  rootLineageId = "checkout-lineage",
  createdAt = "2026-01-01T00:00:00.000Z",
  status = "candidate",
  autoReconsideration = false
} = {}) {
  return {
    id,
    decisionId: `decision:${functionalityId}`,
    functionalityId,
    rootLineageId,
    ...(parentBranchId ? { parentBranchId } : {}),
    createdAt,
    status,
    autoReconsideration
  };
}

test("portfolio directory preserves explicit enterprise assignment and portfolio relationships", () => {
  const projects = [
    { id: "commerce", name: "Commerce", folderName: "commerce", enterprise: { id: "acme", name: "Acme Group" } },
    { id: "billing", name: "Billing", folderName: "billing", enterprise: { id: "acme", name: "Acme Group" } }
  ];
  const portfolio = {
    applications: [{ projectId: "commerce", attentionCount: 2, status: "review", counts: { features: 4, apis: 2, databases: 1, services: 3, pages: 5 } }],
    relationships: [{ id: "commerce-to-billing", sourceProjectId: "commerce", targetProjectId: "billing", type: "shares_api", evidence: [{ id: "ref-1" }] }],
    sharingRelationships: [{ id: "billing-to-commerce", producerProjectId: "billing", recipientProjectId: "commerce", sharingRelationshipType: "curated_publication", evidenceReferences: ["ref-2"] }]
  };

  const directory = buildPortfolioDirectory({ projects, portfolio, query: "acme" });
  const relations = normalizePortfolioRelations(portfolio);

  assert.equal(directory.length, 2);
  assert.deepEqual(directory[0].enterprise, { id: "acme", name: "Acme Group" });
  assert.equal(directory.find((application) => application.id === "commerce").attentionCount, 2);
  assert.deepEqual(directory.find((application) => application.id === "commerce").counts, { features: 4, apis: 2, dataStores: 1, services: 3, pages: 5 });
  assert.equal(relations.length, 2);
  assert.deepEqual(relations.map((relation) => relation.type), ["shares_api", "curated_publication"]);
  assert.equal(relations[1].sourceProjectId, "billing");
  assert.equal(relations[1].targetProjectId, "commerce");
});

test("portfolio relations never infer a dependency from shared enterprise membership", () => {
  const relations = normalizePortfolioRelations({
    applications: [
      { projectId: "alpha", enterprise: { id: "acme", name: "Acme" } },
      { projectId: "beta", enterprise: { id: "acme", name: "Acme" } }
    ]
  });

  assert.deepEqual(relations, []);
});

test("portfolio relation normalization keeps sharing agreements distinct from causal evidence", () => {
  const relations = normalizePortfolioRelations({
    relationships: [{
      id: "causal-alpha-beta",
      kind: "causal_dependency",
      sourceProjectId: "alpha",
      targetProjectId: "beta",
      type: "calls",
      evidenceCount: 2
    }],
    sharingRelationships: [{
      id: "sharing-alpha-beta",
      kind: "authorized_information_sharing",
      sourceProjectId: "alpha",
      targetProjectId: "beta",
      purpose: "portfolio-analysis",
      agreementIds: ["agreement-1"]
    }]
  });

  assert.equal(relations[0].evidenceCount, 2);
  assert.equal(relations[0].agreementCount, 0);
  assert.equal(relations[1].evidenceCount, 0);
  assert.equal(relations[1].agreementCount, 1);
  assert.equal(relations[1].purpose, "portfolio-analysis");
});

test("decision state keeps generic candidates recorded unless deferment is explicitly recorded", () => {
  assert.equal(decisionState({ status: "candidate" }), "recorded");
  assert.equal(decisionState({ status: "candidate", candidate: { inferenceRole: "deferred_alternative" } }), "deferred");
  assert.equal(decisionState({ status: "recorded", disposition: { state: "deferred" } }), "deferred");
  assert.equal(decisionState({ status: "deferred" }), "deferred");
  assert.equal(decisionState({ status: "candidate", candidate: { inferenceRole: "observed_current" } }), "observed_current");
  assert.equal(decisionState({ status: "candidate", inferenceRole: "observed_current" }), "observed_current");
  assert.equal(decisionState({ status: "candidate", inferenceRole: "deferred_alternative" }), "deferred");
  assert.equal(decisionState({ status: "selected", candidate: { inferenceRole: "observed_current" } }), "selected");
  assert.equal(decisionState({ status: "rejected" }), "rejected");
});

test("keeps an explicit application origin instead of guessing from a source report", () => {
  assert.deepEqual(applicationOrigin({
    provenance: {
      origin: "imported",
      recordedAt: "2026-01-10T10:00:00.000Z",
      source: "project_import"
    }
  }), {
    kind: "imported",
    label: "Imported application",
    recordedAt: "2026-01-10T10:00:00.000Z",
    source: "project_import",
    recorded: true
  });
});

test("frontend origin never treats runtime status as creation provenance", () => {
  assert.equal(applicationOrigin({ status: "running" }).kind, "unknown_legacy");
  assert.equal(applicationOrigin({ status: "stopped" }).kind, "unknown_legacy");
  assert.equal(applicationOrigin({ status: "imported" }).kind, "unknown_legacy");
  assert.equal(applicationOrigin({ status: "running", provenance: { origin: "imported" } }).kind, "imported");
  assert.equal(applicationOrigin({ status: "stopped", provenance: { origin: "plutonix_created" } }).kind, "plutonix_created");
  assert.deepEqual(applicationOrigin({ status: "stopped", createdAt: "2026-01-01T00:00:00.000Z", productDecision: { productShape: "web_app" } }), {
    kind: "plutonix_created",
    label: "PlutoniX-created",
    recordedAt: "2026-01-01T00:00:00.000Z",
    source: "legacy_plutonix_product_decision",
    recorded: true
  });
});

test("source-report alternatives remain anticipated rather than governed dispositions", () => {
  const summary = applicationDecisionSummary({
    architectureAnalysisReport: {
      sourceDigest: "source-report-digest",
      majorFunctionalities: [{ id: "checkout", label: "Checkout", category: "ui" }],
      branches: [
        { id: "source-current", functionalityId: "checkout", title: "Current checkout", status: "candidate", inferenceRole: "observed_current" },
        { id: "source-alternative", functionalityId: "checkout", title: "Add a view model", status: "deferred", inferenceRole: "deferred_alternative", autoReconsideration: true },
        { id: "source-rejected-alternative", functionalityId: "checkout", title: "Replace checkout without validation", status: "rejected", inferenceRole: "deferred_alternative" }
      ]
    }
  });
  const alternative = summary.branchRows.find((branch) => branch.id === "source-alternative");
  const rejectedAlternative = summary.branchRows.find((branch) => branch.id === "source-rejected-alternative");

  assert.equal(alternative.state, "anticipated");
  assert.equal(alternative.recordClassification, "anticipated");
  assert.equal(alternative.historicalClaim, false);
  assert.match(alternative.recordBasis, /not a historical decision/i);
  assert.equal(rejectedAlternative.state, "anticipated");
  assert.equal(rejectedAlternative.recordClassification, "anticipated");
  assert.equal(rejectedAlternative.historicalClaim, false);
  assert.equal(summary.deferredCount, 0);
  assert.equal(summary.rejectedCount, 0);
  assert.equal(summary.anticipatedCount, 2);
});

test("ledger deferred and rejected alternatives retain their governed disposition", () => {
  const rows = branchRows([
    {
      ...ledgerBranch("ledger-deferred-alternative", { status: "deferred" }),
      candidate: { inferenceRole: "deferred_alternative" }
    },
    {
      ...ledgerBranch("ledger-rejected-alternative", { status: "rejected" }),
      candidate: { inferenceRole: "deferred_alternative" }
    }
  ]);
  const deferred = rows.find((branch) => branch.id === "ledger-deferred-alternative");
  const rejected = rows.find((branch) => branch.id === "ledger-rejected-alternative");

  assert.equal(deferred.state, "deferred");
  assert.equal(deferred.recordClassification, "governed_disposition");
  assert.equal(deferred.historicalClaim, true);
  assert.match(deferred.recordBasis, /decision ledger/i);
  assert.equal(rejected.state, "rejected");
  assert.equal(rejected.recordClassification, "governed_disposition");
  assert.equal(rejected.historicalClaim, true);
  assert.match(rejected.recordBasis, /decision ledger/i);
});

test("imported source maps expose current, anticipated, and anticipated-rejected branches without historical claims", () => {
  const summary = applicationDecisionSummary({
    architectureAnalysisReport: {
      sourceDigest: "imported-source-digest",
      majorFunctionalities: [{ id: "orders", label: "Orders API", category: "api", evidence: [{ id: "source-1" }] }]
    },
    project: {
      provenance: {
        origin: "imported",
        recordedAt: "2026-01-10T10:00:00.000Z",
        source: "project_import"
      }
    }
  });
  const checkpoint = summary.sourceMap.checkpoints[0];
  const current = checkpoint.observedCurrent[0];
  const anticipated = checkpoint.anticipated[0];
  const anticipatedRejected = checkpoint.anticipatedRejected[0];

  assert.equal(summary.applicationOrigin.kind, "imported");
  assert.equal(summary.sourceMap.historicalClaim, false);
  assert.equal(current.historicalClaim, false);
  assert.equal(anticipated.historicalClaim, false);
  assert.equal(anticipatedRejected.historicalClaim, false);
  assert.equal(anticipated.state, "anticipated");
  assert.equal(anticipatedRejected.state, "anticipated_rejected");
  assert.deepEqual(anticipatedRejected.constraints, [
    "Backward compatibility must be preserved",
    "Consumer migration evidence is not recorded"
  ]);
});

test("unknown legacy applications receive source-only choices for every discovered checkpoint", () => {
  const summary = applicationDecisionSummary({
    architectureAnalysisReport: {
      sourceDigest: "legacy-source-digest",
      majorFunctionalities: [
        { id: "profile", label: "Profile", category: "ui" },
        { id: "persistence", label: "Profile data", category: "data" }
      ]
    },
    project: { id: "legacy", status: "stopped" }
  });

  assert.equal(summary.applicationOrigin.kind, "unknown_legacy");
  assert.equal(summary.sourceMap.checkpoints.length, 2);
  assert.ok(summary.sourceMap.checkpoints.every((checkpoint) => checkpoint.observedCurrent.length === 1));
  assert.ok(summary.sourceMap.checkpoints.every((checkpoint) => checkpoint.anticipated.length === 1));
  assert.ok(summary.sourceMap.checkpoints.every((checkpoint) => checkpoint.anticipatedRejected.length === 1));
  assert.ok(summary.sourceMap.checkpoints.flatMap((checkpoint) => checkpoint.choices).every((choice) => choice.historicalClaim === false));
});

test("current source maps hide stale source projections without deleting governed ledger history", () => {
  const summary = applicationDecisionSummary({
    architectureAnalysisReport: {
      sourceDigest: "current-digest",
      majorFunctionalities: [{ id: "checkout", label: "Checkout", category: "ui" }]
    },
    branches: [
      {
        ...ledgerBranch("stale-source-alternative"),
        sourceDigest: "stale-digest",
        candidate: { inferenceRole: "anticipated_alternative", sourceDigest: "stale-digest" }
      },
      {
        ...ledgerBranch("governed-selection", { status: "selected" }),
        sourceDigest: "stale-digest"
      }
    ],
    project: { provenance: { origin: "plutonix_created" } }
  });

  assert.ok(summary.branchRows.some((branch) => branch.id === "stale-source-alternative"), "historical ledger record remains inspectable");
  assert.ok(summary.branchRows.some((branch) => branch.id === "governed-selection"), "governed history is retained");
  const sourceChoiceIds = summary.sourceMap.checkpoints[0].choices.map((branch) => branch.id);
  assert.equal(sourceChoiceIds.includes("stale-source-alternative"), false);
  assert.equal(sourceChoiceIds.includes("governed-selection"), true);
});

test("decision board keeps source-anticipated alternatives separate from governed deferments", () => {
  const branches = [
    { id: "selected", status: "selected", functionalityId: "checkout", evidence: [{ id: "source-1" }] },
    { id: "observed", status: "candidate", functionalityId: "checkout", candidate: { inferenceRole: "observed_current" } },
    { id: "deferred", status: "candidate", functionalityId: "checkout", candidate: { inferenceRole: "deferred_alternative" } },
    { id: "other-function", status: "deferred", functionalityId: "profile" }
  ];
  const reconsiderations = [
    { id: "signal-for-deferred", branchId: "deferred", status: "pending_evaluation" },
    { id: "signal-for-other", branchId: "other-function", status: "pending_evaluation" }
  ];

  const board = buildDecisionPathBoard({ functionalityId: "checkout", branches, reconsiderations, selectedCheckpointId: "deferred" });

  assert.deepEqual(board.checkpoints.map((checkpoint) => checkpoint.id), ["selected", "observed", "deferred"]);
  assert.equal(board.confirmedSelections.length, 1);
  assert.equal(board.observedCurrent.length, 1);
  assert.equal(board.deferred.length, 0);
  assert.equal(board.anticipated.length, 1);
  assert.equal(board.rejected.length, 0);
  assert.equal(board.selectedCheckpoint.id, "deferred");
  assert.deepEqual(board.reconsiderations.map((signal) => signal.id), ["signal-for-deferred"]);
  assert.deepEqual(realReconsiderationSignals(reconsiderations, "missing"), []);
});

test("application summaries create source observation without creating alternatives from suppressed candidates", () => {
  const summary = applicationDecisionSummary({
    architectureAnalysisReport: {
      majorFunctionalities: [{ id: "checkout", label: "Checkout" }],
      suppressedCandidates: [{ id: "not-a-branch", functionalityId: "checkout" }]
    },
    branches: [],
    reconsiderations: [],
    project: { provenance: { origin: "plutonix_created" } }
  });

  assert.equal(summary.functionalities.length, 1);
  assert.equal(summary.branchRows.length, 1);
  assert.equal(summary.observedCurrentCount, 1);
  assert.equal(summary.branchRows[0].recordClassification, "source_observed");
  assert.equal(summary.branchRows.some((branch) => branch.id === "not-a-branch"), false);
  assert.equal(summary.deferredCount, 0);
});

test("application summaries retain source-report branches, evidence ids, and ledger precedence", () => {
  const report = {
    projectId: "commerce",
    majorFunctionalities: [{ id: "checkout", label: "Checkout" }],
    branches: [
      { id: "source-current", functionalityId: "checkout", title: "Checkout", inferenceRole: "observed_current", evidenceIds: ["source-a"] },
      { id: "same-id", functionalityId: "checkout", title: "Old report value", inferenceRole: "observed_current", evidenceIds: ["source-b"] }
    ]
  };
  const remoteBranches = [{ id: "same-id", functionalityId: "checkout", title: "Governed value", status: "selected", evidence: [{ id: "ledger-a" }] }];
  const createdProject = { provenance: { origin: "plutonix_created" } };
  const summary = applicationDecisionSummary({ architectureAnalysisReport: report, branches: remoteBranches, project: createdProject });

  assert.deepEqual(summary.branchRows.map((branch) => branch.id), ["source-current", "same-id"]);
  assert.equal(summary.observedCurrentCount, 1);
  assert.equal(summary.selectedCount, 1);
  assert.deepEqual(summary.branchRows.find((branch) => branch.id === "source-current").evidence, ["source-a"]);
  assert.equal(summary.branchRows.find((branch) => branch.id === "source-current").recordClassification, "source_observed");
  assert.equal(summary.branchRows.find((branch) => branch.id === "same-id").label, "Governed value");
  assert.deepEqual(mergeDecisionBranches({ architectureAnalysisReport: report, branches: remoteBranches, project: createdProject }).map((branch) => branch.id), ["source-current", "same-id"]);
});

test("decision lineages draw only valid recorded parent edges", () => {
  const lineages = buildDecisionLineages({
    branches: branchRows([
      ledgerBranch("root", { rootLineageId: "checkout-lineage", createdAt: "2026-01-01T00:00:00.000Z" }),
      ledgerBranch("child", { parentBranchId: "root", rootLineageId: "checkout-lineage", createdAt: "2026-01-02T00:00:00.000Z", status: "deferred" })
    ])
  });

  assert.equal(lineages.lineages.length, 1);
  assert.deepEqual(lineages.lineages[0].nodes.map((node) => node.id), ["root", "child"]);
  assert.deepEqual(lineages.lineages[0].edges, [{
    id: "lineage:root:child",
    sourceId: "root",
    targetId: "child",
    recorded: true
  }]);
  assert.deepEqual(lineages.unlinked, []);
});

test("decision lineages fail closed for missing, cross-function, and cyclic parents", () => {
  const lineages = buildDecisionLineages({
    branches: branchRows([
      ledgerBranch("checkout-root", { rootLineageId: "checkout-lineage" }),
      ledgerBranch("missing-parent", { parentBranchId: "not-recorded" }),
      ledgerBranch("wrong-function", { functionalityId: "profile", parentBranchId: "checkout-root", rootLineageId: "profile-lineage" }),
      ledgerBranch("cycle-a", { parentBranchId: "cycle-b", rootLineageId: "cycle-lineage" }),
      ledgerBranch("cycle-b", { parentBranchId: "cycle-a", rootLineageId: "cycle-lineage" })
    ])
  });

  assert.equal(lineages.lineages.length, 1);
  assert.deepEqual(lineages.lineages[0].nodes.map((node) => node.id), ["checkout-root"]);
  assert.deepEqual(lineages.lineages[0].edges, []);
  assert.deepEqual(new Set(lineages.unlinked.map((branch) => branch.id)), new Set(["missing-parent", "wrong-function", "cycle-a", "cycle-b"]));
  assert.ok(lineages.unlinked.every((branch) => /missing, incompatible, or cyclic/i.test(branch.lineageIssue)));
});

test("decision lineage layout input is deterministic when branch rows arrive shuffled", () => {
  const rows = [
    ledgerBranch("root", { rootLineageId: "checkout-lineage", createdAt: "2026-01-01T00:00:00.000Z" }),
    ledgerBranch("later-child", { parentBranchId: "root", rootLineageId: "checkout-lineage", createdAt: "2026-01-03T00:00:00.000Z" }),
    ledgerBranch("earlier-child", { parentBranchId: "root", rootLineageId: "checkout-lineage", createdAt: "2026-01-02T00:00:00.000Z" })
  ];
  const projection = (input) => buildDecisionLineages({ branches: branchRows(input) }).lineages.map((lineage) => ({
    id: lineage.id,
    nodes: lineage.nodes.map((node) => ({ id: node.id, depth: node.depth, createdAt: node.temporal.createdAt })),
    edges: lineage.edges
  }));

  assert.deepEqual(projection(rows), projection([rows[2], rows[0], rows[1]]));
  assert.deepEqual(projection(rows)[0].nodes.map((node) => node.id), ["root", "earlier-child", "later-child"]);
});

test("decision lineage never invents a timestamp or reconsideration from source analysis metadata", () => {
  const summary = applicationDecisionSummary({
    architectureAnalysisReport: {
      sourceDigest: "source-time-digest",
      analyzedAt: "2026-01-20T12:00:00.000Z",
      majorFunctionalities: [{ id: "checkout", label: "Checkout" }]
    },
    branches: [{
      ...ledgerBranch("ledger-without-time", { autoReconsideration: true }),
      createdAt: undefined
    }]
  });
  const branch = summary.branchRows.find((row) => row.id === "ledger-without-time");
  const lineage = summary.lineages.find((entry) => entry.rootId === "ledger-without-time");

  assert.deepEqual(branch.temporal, { createdAt: "", updatedAt: "", status: "unavailable" });
  assert.equal(lineage.chronologyStatus, "unavailable");
  assert.equal(lineage.earliestRecordedAt, "");
  assert.deepEqual(lineage.nodes[0].events, []);
  assert.deepEqual(realReconsiderationSignals([], "ledger-without-time"), []);
});

test("portfolio summary preserves envelope policy status and keeps causal and sharing relations distinct", () => {
  const envelope = {
    portfolio: {
      summary: { causalRelationshipCount: 1, sharingRelationshipCount: 1 },
      relationships: [{ id: "causal", sourceProjectId: "alpha", targetProjectId: "beta", type: "ui_calls_api" }],
      sharingRelationships: [{ id: "sharing", sourceProjectId: "alpha", targetProjectId: "beta", purpose: "research", agreementIds: ["agreement-1"] }]
    },
    agreementRegistry: { status: "unconfigured", configured: false },
    explanation: "Sharing is denied without an agreement."
  };
  const summary = portfolioDecisionSummary(envelope);
  const relations = normalizePortfolioRelations(envelope);

  assert.equal(summary.agreementStatus, "unconfigured");
  assert.equal(summary.causalDependencyCount, 1);
  assert.equal(summary.authorizedSharingCount, 1);
  assert.equal(summary.explanation, "Sharing is denied without an agreement.");
  assert.deepEqual(relations.map((relation) => relation.kind), ["causal_dependency", "authorized_information_sharing"]);
});

test("enterprise patch sends one explicit enterprise assignment", () => {
  assert.deepEqual(
    enterprisePatch({ id: "commerce", name: "Commerce", folderName: "commerce" }, { id: "acme", name: "Acme Group" }),
    { name: "Commerce", workspaceName: "commerce", enterpriseId: "acme", enterpriseName: "Acme Group" }
  );
});

test("enterprise assignment drafts fail closed for partial input and remove only when both fields are blank", () => {
  const partialId = enterpriseAssignmentDraft({ id: "acme", name: "" });
  const partialName = enterpriseAssignmentDraft({ id: "", name: "Acme Group" });
  const invalidId = enterpriseAssignmentDraft({ id: "Acme Group", name: "Acme Group" });
  const assignment = enterpriseAssignmentDraft({ id: "acme-group", name: "Acme Group" });
  const removal = enterpriseAssignmentDraft({ id: "", name: "" });

  assert.equal(partialId.isSubmittable, false);
  assert.equal(partialName.isSubmittable, false);
  assert.equal(invalidId.isSubmittable, false);
  assert.equal(assignment.isAssignment, true);
  assert.equal(assignment.isSubmittable, true);
  assert.equal(removal.isRemoval, true);
  assert.equal(removal.isSubmittable, true);
});

test("enterprise assignment planning changes only selected applications and supports explicit removal", () => {
  const applications = [
    { id: "commerce", name: "Commerce", project: { id: "commerce", name: "Commerce", folderName: "commerce", enterprise: { id: "legacy", name: "Legacy" } }, enterprise: { id: "legacy", name: "Legacy" } },
    { id: "billing", name: "Billing", project: { id: "billing", name: "Billing", folderName: "billing" }, enterprise: { id: "", name: "" } },
    { id: "support", name: "Support", project: { id: "support", name: "Support", folderName: "support" }, enterprise: { id: "acme", name: "Acme Group" } }
  ];

  const assignment = planEnterpriseAssignments({ applications, selectedIds: ["commerce", "billing"], enterprise: { id: "acme", name: "Acme Group" } });
  assert.deepEqual(assignment.map((item) => item.projectId), ["commerce", "billing"]);
  assert.deepEqual(assignment.map((item) => item.patch), [
    { name: "Commerce", workspaceName: "commerce", enterpriseId: "acme", enterpriseName: "Acme Group" },
    { name: "Billing", workspaceName: "billing", enterpriseId: "acme", enterpriseName: "Acme Group" }
  ]);

  const removal = planEnterpriseAssignments({ applications, selectedIds: ["commerce", "billing"], enterprise: { id: "", name: "" } });
  assert.deepEqual(removal.map((item) => item.projectId), ["commerce"]);
  assert.equal(removal[0].patch.enterpriseId, "");
  assert.equal(removal[0].patch.enterpriseName, "");
});

test("the mounted PlutoniX analysis workspace replaces the retired canvases with document-native flows", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const workspace = fs.readFileSync(new URL("../src/PlutonixAnalysisWorkspace.jsx", import.meta.url), "utf8");
  const server = fs.readFileSync(new URL("../../backend/src/server.js", import.meta.url), "utf8");

  assert.ok(app.includes("<PlutonixAnalysisWorkspace"));
  assert.equal(app.includes('setActiveAgenticSystemTab("brainx")'), false);
  assert.equal(app.includes('setActiveAgenticSystemTab("decision-continuity")'), false);
  assert.equal(/<(?:canvas|svg|iframe)\b/i.test(workspace), false);
  assert.ok(workspace.includes("PortfolioRelationFlow"));
  assert.ok(workspace.includes("DecisionPathBoard"));
  assert.ok(workspace.includes("activeLineage.edges.filter"));
  assert.ok(workspace.includes("Branches from"));
  assert.ok(workspace.includes("EnterprisePortfolioAssignmentPanel"));
  assert.ok(workspace.includes("Membership does not grant information sharing or create a dependency."));
  assert.ok(workspace.includes("Use a new enterprise label…"));
  assert.ok(workspace.includes("Updates are applied to each application individually."));
  assert.ok(workspace.includes("Current application source is unavailable."));
  assert.ok(workspace.includes("/enterprise`"));
  assert.ok(server.includes('app.patch("/api/projects/:projectId/enterprise"'));
  assert.ok(server.includes('"stale_recorded_source_analysis"'));
});
