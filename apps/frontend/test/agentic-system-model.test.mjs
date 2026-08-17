import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  NODE_TYPE_REGISTRY,
  applyArchitectureSavedPositions,
  applyGraphFilters,
  architectureNodeRadius,
  buildClusters,
  buildArchitectureBranchSummary,
  buildDependencyLens,
  createDependencyLayout,
  createArchitectureFreeForceSeedLayout,
  createArchitectureForceSeedLayout,
  createArchitectureTreeLayout,
  createArchitectureEdgePlan,
  createArchitectureZoneLayout,
  dedupeGraphLinks,
  createOverviewLayout,
  focusNeighborhood,
  layoutBoundsIntersect,
  layoutNodeBounds,
  layoutNodeRadius,
  materializeSourceBackedHierarchy,
  nodeVisualType,
  normalizeGraph,
  preserveSelectionThroughFilters,
  relationshipStyle,
  selectDependencyAnchor,
  savePositions,
  selectRenderStrategy,
  loadPositions,
  storageKey,
  visibleGraphForState
} from "../public/agentic-system/d3/agentic-system-model.js";

function sampleGraph() {
  return normalizeGraph({
    nodes: [
      {
        id: "project:alpha",
        type: "project",
        label: "Alpha",
        group: "project",
        status: "managed",
        metadata: { projectName: "Alpha" }
      },
      {
        id: "agent:alpha-orch",
        type: "agent",
        label: "Alpha Orchestrator",
        group: "project-agent",
        status: "active",
        cluster_id: "project-orchestrator",
        metadata: { projectName: "Alpha", role: "orchestrator", domain: "planning", runtimeStatus: "running" }
      },
      {
        id: "agent:alpha-worker",
        type: "agent",
        label: "Alpha Worker",
        group: "worker-agent",
        status: "ready",
        cluster_id: "build",
        metadata: { projectName: "Alpha", domain: "build", capabilityScore: 91, runtimeStatus: "running" }
      },
      {
        id: "agent:alpha-reviewer",
        type: "agent",
        label: "Alpha QAgent",
        group: "review-agent",
        status: "pending",
        cluster_id: "quality",
        metadata: { projectName: "Alpha", supportAgent: true, domain: "quality", runtimeStatus: "waiting" }
      },
      {
        id: "memory:alpha",
        type: "vector_store",
        label: "Alpha Memory",
        group: "memory",
        status: "failed",
        metadata: { projectName: "Alpha" }
      },
      {
        id: "functionality:alpha:orders-api",
        type: "application_functionality",
        label: "Orders API",
        group: "functionality-api",
        status: "observed_current",
        metadata: { projectName: "Alpha", projectId: "alpha", category: "api" }
      },
      {
        id: "branch:alpha:orders-async",
        type: "branch",
        label: "Process orders asynchronously",
        group: "architecture-branch",
        status: "deferred",
        metadata: { projectName: "Alpha", projectId: "alpha", functionalityId: "orders-api", inferenceRole: "deferred_alternative", score: 0.71 }
      },
      {
        id: "agent:beta-worker",
        type: "agent",
        label: "Beta Worker",
        group: "worker-agent",
        status: "idle",
        cluster_id: "build",
        metadata: { projectName: "Beta", domain: "build" }
      }
    ],
    links: [
      { source: "agent:alpha-orch", target: "agent:alpha-worker", type: "delegates_to" },
      { source: "agent:alpha-worker", target: "agent:alpha-reviewer", type: "invokes" },
      { source: "agent:alpha-worker", target: "memory:alpha", type: "memory_access" },
      { source: "project:alpha", target: "agent:alpha-orch", type: "has_orchestrator" },
      { source: "project:alpha", target: "functionality:alpha:orders-api", type: "contains_functionality" },
      { source: "agent:alpha-worker", target: "functionality:alpha:orders-api", type: "implements" },
      { source: "functionality:alpha:orders-api", target: "branch:alpha:orders-async", type: "has_architecture_branch" }
    ]
  });
}

test("groups agents into project/domain/type clusters with health counts", () => {
  const graph = sampleGraph();
  const { clusters } = buildClusters(graph.nodes, graph.links);
  const memory = clusters.find((cluster) => cluster.label === "Alpha Memory");
  const qagent = clusters.find((cluster) => cluster.label === "Alpha QAgents");
  const worker = clusters.find((cluster) => cluster.label.includes("Alpha") && cluster.label.includes("build"));

  assert.ok(memory, "memory/database cluster is present");
  assert.equal(memory.counts.failed, 1);
  assert.ok(qagent, "QAgent cluster is present");
  assert.equal(qagent.counts.warning, 1);
  assert.ok(worker, "domain capability cluster is present");
  assert.equal(worker.counts.running, 1);
});

test("filters by project, type, status, search, and relationship style", () => {
  const graph = sampleGraph();
  const byProject = applyGraphFilters(graph, { project: "Alpha", agentType: "all", status: "all", relationshipType: "all" });
  assert.equal(byProject.nodes.length, 7);

  const byType = applyGraphFilters(graph, { project: "Alpha", agentType: "qagent", status: "all", relationshipType: "all" });
  assert.deepEqual(byType.nodes.map((node) => node.id), ["agent:alpha-reviewer"]);

  const byStatus = applyGraphFilters(graph, { project: "Alpha", agentType: "all", status: "failed", relationshipType: "all" });
  assert.deepEqual(byStatus.nodes.map((node) => node.id), ["memory:alpha"]);

  const bySearch = applyGraphFilters(graph, { search: "qagent", project: "all", agentType: "all", status: "all", relationshipType: "all" });
  assert.deepEqual(bySearch.nodes.map((node) => node.id), ["agent:alpha-reviewer"]);

  const byRelation = applyGraphFilters(graph, { project: "Alpha", agentType: "all", status: "all", relationshipType: "memory" });
  assert.deepEqual(new Set(byRelation.nodes.map((node) => node.id)), new Set(["agent:alpha-worker", "memory:alpha"]));

  const withoutProject = applyGraphFilters(graph, { project: "", agentType: "all", status: "all", relationshipType: "all" });
  assert.deepEqual(withoutProject, { nodes: [], links: [] }, "an unselected Project menu never becomes an implicit all-project view");
});

test("project filters retain reusable agents through their multi-project assignments", () => {
  const graph = normalizeGraph({
    nodes: [
      { id: "project:alpha", type: "project", label: "Alpha", metadata: { projectId: "alpha", projectName: "Alpha" } },
      { id: "page:alpha:home", type: "page", label: "Home", metadata: { projectId: "alpha", projectName: "Alpha", applicationTopology: true } },
      { id: "agent:shared-ui", type: "agent", label: "Shared UI Agent", metadata: { projectIds: ["alpha", "beta"], projectAssignments: [{ projectId: "alpha" }] } }
    ],
    links: [
      { source: "project:alpha", target: "page:alpha:home", type: "contains_application_entity" },
      { source: "agent:shared-ui", target: "page:alpha:home", type: "implements" }
    ]
  });
  const filtered = applyGraphFilters(graph, { project: "Alpha", agentType: "all", status: "all", relationshipType: "all" });
  assert.ok(filtered.nodes.some((node) => node.id === "agent:shared-ui"));
  assert.ok(filtered.links.some((link) => link.source === "agent:shared-ui" && link.target === "page:alpha:home"));
  const architecture = buildArchitectureBranchSummary(filtered.nodes, filtered.links);
  assert.ok(architecture.nodes.some((node) => node.id === "agent:shared-ui"));
  assert.ok(architecture.links.some((link) => link.type === "implements" && link.metadata?.agentOwnership));
});

test("selection focus returns only direct incoming and outgoing relationships", () => {
  const graph = sampleGraph();
  const workerFocus = focusNeighborhood(graph, "agent:alpha-worker");
  assert.deepEqual(workerFocus.ids, new Set(["agent:alpha-worker", "agent:alpha-orch", "agent:alpha-reviewer", "memory:alpha", "functionality:alpha:orders-api"]));
  assert.ok(workerFocus.upstream.has("agent:alpha-orch"));
  assert.ok(workerFocus.downstream.has("agent:alpha-reviewer"));

  const reviewerFocus = focusNeighborhood(graph, "agent:alpha-reviewer");
  assert.deepEqual(reviewerFocus.ids, new Set(["agent:alpha-reviewer", "agent:alpha-worker"]));
  assert.equal(reviewerFocus.ids.has("agent:alpha-orch"), false, "selection highlighting does not expand through the worker");
  assert.equal(reviewerFocus.ids.has("memory:alpha"), false, "selection highlighting excludes sibling relationships");
});

test("layout persistence saves and reloads positions per project and view mode", () => {
  const storage = new Map();
  const fakeStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value)
  };
  const items = [
    { id: "cluster:a", x: 100.4, y: 210.7 },
    { id: "agent:a", x: 300, y: 440 }
  ];
  savePositions(fakeStorage, "Alpha", "overview", items);
  assert.ok(storage.has(storageKey("Alpha", "overview")));
  const loaded = loadPositions(fakeStorage, "Alpha", "overview");
  assert.deepEqual(loaded.get("cluster:a"), { x: 100, y: 211 });
  assert.equal(loadPositions(fakeStorage, "Beta", "overview").size, 0);
});

test("selection persists while filters change and overview starts under object limit", () => {
  const graph = sampleGraph();
  const selected = preserveSelectionThroughFilters(graph, "agent:alpha-worker", {
    project: "Beta",
    agentType: "all",
    status: "all",
    relationshipType: "all"
  });
  assert.equal(selected, "agent:alpha-worker");

  const visible = visibleGraphForState(
    graph,
    {
      filters: { project: "all", agentType: "all", status: "all", relationshipType: "all" },
      viewMode: "overview",
      expandedClusters: new Set(),
      selectedId: "",
      storage: null
    },
    1200,
    760
  );
  assert.ok(visible.items.length <= 24, "collapsed overview keeps the initial graph under the 25-object acceptance limit");
  assert.ok(visible.items.every((item) => item.clusterLevel === "project"), "collapsed overview starts at project level");
});

test("Explore renders the source-backed feature and branch canvas", () => {
  const graph = sampleGraph();
  const visible = visibleGraphForState(
    graph,
    {
      filters: { project: "Alpha", agentType: "all", status: "all", relationshipType: "all" },
      viewMode: "explore",
      expandedClusters: new Set(),
      selectedId: "",
      storage: null
    },
    1200,
    760
  );
  const ids = new Set(visible.items.map((item) => item.id));
  assert.deepEqual(ids, new Set(["functionality:alpha:orders-api", "branch:alpha:orders-async"]));
  assert.equal(visible.items.some((item) => item.type === "project"), false, "project context is not presented as an Architecture feature");
  const functionality = visible.items.find((item) => item.agentType === "functionality");
  const branch = visible.items.find((item) => item.agentType === "branch");
  assert.equal(functionality.metadata.functionalityCount, 1);
  assert.equal(functionality.metadata.implementingAgentCount, 1);
  assert.equal(functionality.metadata.functionalityDetails[0].label, "Orders API");
  assert.equal(functionality.metadata.assignedAgents[0].name, "Alpha Worker");
  assert.equal(branch.metadata.branchCount, 1);
  assert.equal(branch.metadata.futureEnhancement, true);
  assert.deepEqual(branch.metadata.branchIds, ["branch:alpha:orders-async"]);
  assert.ok(visible.links.some((link) => link.source === functionality.id && link.target === branch.id && link.type === "has_architecture_branch"));
});

test("architecture branch view keeps every code unit visible and keeps static flows dashed", () => {
  const functionality = {
    id: "functionality:alpha:orders",
    type: "application_functionality",
    label: "Orders",
    status: "observed_current",
    metadata: { projectId: "alpha", projectName: "Alpha", category: "api", evidence: [{ id: "function-evidence" }] }
  };
  const subfunctionalities = Array.from({ length: 6 }, (_, index) => ({
    id: `subfunctionality:alpha:orders:${index + 1}`,
    type: "application_subfunctionality",
    label: `Code unit ${index + 1}`,
    status: "observed_current",
    metadata: {
      projectId: "alpha",
      projectName: "Alpha",
      parentFunctionalityId: functionality.id,
      sourceOffset: index,
      kind: "callable",
      reference: `src/orders.js:${index + 1}`,
      evidence: [{ id: `unit-evidence-${index + 1}` }]
    }
  }));
  const branch = {
    id: "branch:alpha:orders",
    type: "branch",
    label: "Queue orders",
    status: "deferred",
    metadata: { projectId: "alpha", projectName: "Alpha", inferenceRole: "deferred_alternative" }
  };
  const nodes = normalizeGraph({
    nodes: [
      { id: "project:alpha", type: "project", label: "Alpha", status: "managed", metadata: { projectId: "alpha", projectName: "Alpha" } },
      functionality,
      ...subfunctionalities,
      branch
    ],
    links: [
      { source: "project:alpha", target: functionality.id, type: "contains_functionality" },
      ...subfunctionalities.map((subfunctionality) => ({ source: functionality.id, target: subfunctionality.id, type: "contains_subfunctionality" })),
      { source: subfunctionalities[0].id, target: branch.id, type: "supports_architecture_branch" },
      { source: subfunctionalities[0].id, target: subfunctionalities[1].id, type: "static_inferred_flow", metadata: { confidence: 0.95 } }
    ]
  });

  const visible = buildArchitectureBranchSummary(nodes.nodes, nodes.links);
  assert.equal(visible.nodes.filter((node) => node.agentType === "subfunctionality").length, 6);
  assert.equal(visible.nodes.find((node) => node.id === functionality.id).metadata.hiddenSubfunctionalityCount, 0);
  assert.ok(visible.links.some((link) => link.type === "supports_architecture_branch" && link.source === subfunctionalities[0].id));
  assert.equal(relationshipStyle(visible.links.find((link) => link.type === "static_inferred_flow")).className, "static-inferred");
});

test("architecture tree grows vertically through sibling branches and scales circular node radii", () => {
  const items = [
    { id: "project", type: "project", label: "Project", metadata: { architectureLens: true, architectureLevel: 0, functionalityCount: 6, complexity: 0.7 } },
    { id: "ui", type: "application_functionality", agentType: "functionality", label: "UI", metadata: { architectureLens: true, architectureLevel: 1, functionalityCount: 1, branchCount: 2, complexity: 0.35 } },
    { id: "api", type: "application_functionality", agentType: "functionality", label: "API", metadata: { architectureLens: true, architectureLevel: 1, functionalityCount: 6, branchCount: 8, complexity: 0.9 } },
    { id: "ui-branch", type: "branch", agentType: "branch", label: "UI branch", metadata: { architectureLens: true, architectureLevel: 2, functionalityCount: 1, branchCount: 1, complexity: 0.35 } },
    { id: "api-branch", type: "branch", agentType: "branch", label: "API branch", metadata: { architectureLens: true, architectureLevel: 2, functionalityCount: 1, branchCount: 1, complexity: 0.9 } }
  ];
  const links = [
    { source: "project", target: "ui" },
    { source: "project", target: "api" },
    { source: "ui", target: "ui-branch" },
    { source: "api", target: "api-branch" }
  ];
  const positioned = createArchitectureTreeLayout(items, links, 1200, 760);
  const byId = new Map(positioned.map((item) => [item.id, item]));

  assert.ok(byId.get("project").y < byId.get("ui").y && byId.get("ui").y < byId.get("ui-branch").y, "tree levels flow downward from root");
  assert.notEqual(byId.get("ui").x, byId.get("api").x, "sibling functions occupy separate tree columns");
  assert.ok(architectureNodeRadius(byId.get("api")) > architectureNodeRadius(byId.get("ui")));
});

test("architecture functionality radius follows relative cyclomatic complexity", () => {
  const base = {
    type: "application_functionality",
    agentType: "functionality",
    metadata: { architectureLens: true, branchCount: 2, surfaceFunctionalityCount: 1, complexity: 0.4 }
  };
  const simple = { ...base, id: "simple", metadata: { ...base.metadata, cyclomaticComplexity: 2, relativeCyclomaticComplexity: 0.15 } };
  const complex = { ...base, id: "complex", metadata: { ...base.metadata, cyclomaticComplexity: 18, relativeCyclomaticComplexity: 0.9 } };
  assert.ok(architectureNodeRadius(complex) > architectureNodeRadius(simple));
});

test("architecture node locations persist without a visual-zone drag constraint", () => {
  const item = {
    id: "functionality:ui",
    type: "application_functionality",
    agentType: "functionality",
    metadata: {
      architectureLens: true,
      architectureZoneBounds: { x: 100, y: 200, width: 420, height: 340 },
      complexity: 0.4
    }
  };
  const positioned = applyArchitectureSavedPositions([item], new Map([[item.id, { x: 9999, y: -9999 }]]))[0];
  assert.equal(positioned.saved, true);
  assert.equal(positioned.x, 9999);
  assert.equal(positioned.y, -9999);
});

test("architecture tree puts landing surfaces before lower-interaction domains and scales shared surfaces", () => {
  const root = { id: "project", type: "project", label: "Project", metadata: { architectureLens: true, functionalityCount: 4, complexity: 0.5 } };
  const landing = {
    id: "landing",
    type: "application_functionality",
    agentType: "functionality",
    label: "Landing workspace",
    metadata: { architectureLens: true, interactionPriority: 0, surfaceKey: "ui:src/App.jsx", surfaceFunctionalityCount: 4, branchCount: 1, complexity: 0.45 }
  };
  const api = {
    id: "api",
    type: "application_functionality",
    agentType: "functionality",
    label: "Background API",
    metadata: { architectureLens: true, interactionPriority: 4, surfaceKey: "api:src/api.ts", surfaceFunctionalityCount: 1, branchCount: 1, complexity: 0.45 }
  };
  const items = [root, landing, api];
  const positioned = createArchitectureTreeLayout(items, [
    { source: "project", target: "landing" },
    { source: "project", target: "api" }
  ], 1200, 760);
  const byId = new Map(positioned.map((item) => [item.id, item]));

  assert.ok(byId.get("landing").y < byId.get("api").y, "landing UI is placed on an earlier tree level");
  assert.ok(architectureNodeRadius(byId.get("landing")) > architectureNodeRadius(byId.get("api")), "a denser shared surface earns a larger circular node");
});

test("architecture landscape keeps a central genesis and separates source zones into non-overlapping draggable space", () => {
  const items = [
    { id: "project", type: "project", label: "Project genesis", metadata: { architectureLens: true, functionalityCount: 3, complexity: 0.5 } },
    { id: "landing", type: "application_functionality", agentType: "functionality", label: "Landing screen", metadata: { architectureLens: true, architectureZone: "ui", architectureZoneLabel: "Ui", interactionPriority: 0, branchCount: 1, complexity: 0.5 } },
    { id: "settings", type: "application_functionality", agentType: "functionality", label: "Settings screen", metadata: { architectureLens: true, architectureZone: "ui", architectureZoneLabel: "Ui", interactionPriority: 1, branchCount: 1, complexity: 0.5 } },
    { id: "api", type: "application_functionality", agentType: "functionality", label: "API gateway", metadata: { architectureLens: true, architectureZone: "api", architectureZoneLabel: "Api", interactionPriority: 4, branchCount: 1, complexity: 0.5 } },
    { id: "landing-branch", type: "branch", agentType: "branch", label: "Landing enhancement", metadata: { architectureLens: true, futureEnhancement: true, complexity: 0.4 } },
    { id: "settings-branch", type: "branch", agentType: "branch", label: "Settings enhancement", metadata: { architectureLens: true, futureEnhancement: true, complexity: 0.4 } },
    { id: "api-branch", type: "branch", agentType: "branch", label: "API enhancement", metadata: { architectureLens: true, futureEnhancement: true, complexity: 0.4 } }
  ];
  const positioned = createArchitectureZoneLayout(items, [
    { source: "project", target: "landing" },
    { source: "project", target: "settings" },
    { source: "project", target: "api" },
    { source: "landing", target: "landing-branch" },
    { source: "settings", target: "settings-branch" },
    { source: "api", target: "api-branch" }
  ], 1200, 760);
  const byId = new Map(positioned.map((item) => [item.id, item]));
  const uiBounds = byId.get("landing").metadata.architectureZoneBounds;
  const apiBounds = byId.get("api").metadata.architectureZoneBounds;

  assert.equal(byId.get("project").metadata.architectureZone, "genesis");
  assert.equal(byId.get("landing-branch").metadata.architectureZoneBounds.id, uiBounds.id);
  assert.notEqual(uiBounds.id, apiBounds.id, "different source categories receive distinct visual zones");
  assert.ok(uiBounds.x + uiBounds.width < apiBounds.x || apiBounds.x + apiBounds.width < uiBounds.x || uiBounds.y + uiBounds.height < apiBounds.y || apiBounds.y + apiBounds.height < uiBounds.y, "zone bounds do not overlap");
  assert.ok(Math.hypot(byId.get("project").x - byId.get("landing").x, byId.get("project").y - byId.get("landing").y) > 450, "functionality uses the larger navigable map around genesis");
});

test("architecture flow opens forward from genesis while retaining every circular child tier", () => {
  const items = [
    { id: "project", type: "project", label: "Project", metadata: { architectureLens: true, functionalityCount: 2, complexity: 0.5 } },
    { id: "ui", type: "application_functionality", agentType: "functionality", label: "Workspace", metadata: { architectureLens: true, architectureZone: "ui", architectureZoneLabel: "UI", interactionPriority: 0, branchCount: 1, complexity: 0.5 } },
    { id: "api", type: "application_functionality", agentType: "functionality", label: "Orders API", metadata: { architectureLens: true, architectureZone: "api", architectureZoneLabel: "API", interactionPriority: 4, branchCount: 1, complexity: 0.5 } },
    { id: "ui-code", type: "application_subfunctionality", agentType: "subfunctionality", label: "Order form", metadata: { architectureLens: true, complexity: 0.3 } },
    { id: "api-branch", type: "branch", agentType: "branch", label: "Queue fallback", metadata: { architectureLens: true, complexity: 0.4 } }
  ];
  const positioned = createArchitectureZoneLayout(items, [
    { source: "project", target: "ui", type: "contains_functionality" },
    { source: "project", target: "api", type: "contains_functionality" },
    { source: "ui", target: "ui-code", type: "contains_subfunctionality" },
    { source: "api", target: "api-branch", type: "has_architecture_branch" }
  ], 640, 760);
  const byId = new Map(positioned.map((item) => [item.id, item]));
  const root = byId.get("project");

  assert.equal(root.metadata.architectureFlow, "forward");
  assert.equal(byId.get("ui").metadata.architectureFlowTier, "functionality");
  assert.equal(byId.get("ui-code").metadata.architectureFlowTier, "code-unit");
  assert.equal(byId.get("api-branch").metadata.architectureFlowTier, "branch");
  assert.ok(byId.get("ui").x > root.x && byId.get("api").x > root.x, "all functionality zones fan forward from genesis");
  for (let left = 0; left < positioned.length; left += 1) {
    for (let right = left + 1; right < positioned.length; right += 1) {
      assert.equal(layoutBoundsIntersect(positioned[left], positioned[right], 12), false, "forward hierarchy preserves visual bounds at narrow width");
    }
  }
});

test("architecture tree visually preserves each rejected branch as a disabled node", () => {
  const graph = sampleGraph();
  const nodes = [
    ...graph.nodes,
    {
      id: "branch:alpha:orders-retired",
      type: "branch",
      label: "Retired orders branch",
      status: "rejected",
      metadata: { projectName: "Alpha", projectId: "alpha", inferenceRole: "deferred_alternative" }
    }
  ];
  const links = [
    ...graph.links,
    { source: "functionality:alpha:orders-api", target: "branch:alpha:orders-retired", type: "has_architecture_branch" }
  ];
  const lens = buildArchitectureBranchSummary(nodes, links);
  const rejectedBranch = lens.nodes.find((node) => node.id === "branch:alpha:orders-retired");

  assert.ok(rejectedBranch);
  assert.equal(rejectedBranch.agentType, "branch");
  assert.equal(rejectedBranch.metadata.disabled, true);
  assert.deepEqual(rejectedBranch.metadata.branchIds, ["branch:alpha:orders-retired"]);
  assert.ok(lens.links.some((link) => link.target === rejectedBranch.id && link.type === "rejected_architecture_branch" && link.metadata.disabled));
});

test("architecture branch lens keeps unlinked prior-analysis records visible as unmapped evidence", () => {
  const graph = sampleGraph();
  const nodes = [
    ...graph.nodes,
    {
      id: "branch:alpha:legacy-evidence",
      type: "branch",
      label: "Legacy source-backed branch",
      status: "deferred",
      metadata: { projectName: "Alpha", projectId: "alpha", inferenceRole: "deferred_alternative" }
    }
  ];
  const lens = buildArchitectureBranchSummary(nodes, graph.links);
  const unresolvedFunctionality = lens.nodes.find((node) => node.agentType === "functionality" && node.metadata.unresolvedEvidence);
  const unresolvedBranch = lens.nodes.find((node) => node.id === "branch:alpha:legacy-evidence");

  assert.equal(unresolvedFunctionality.label, "Unmapped branch evidence");
  assert.equal(unresolvedFunctionality.metadata.functionalityCount, 1);
  assert.equal(unresolvedBranch.metadata.branchCount, 1);
});

test("overview layout keeps unrelated clusters stable when a cluster expands", () => {
  const clusters = [
    { id: "cluster:a", kind: "cluster", label: "Alpha A", project: "Alpha" },
    { id: "cluster:b", kind: "cluster", label: "Alpha B", project: "Alpha" },
    { id: "cluster:c", kind: "cluster", label: "Beta C", project: "Beta" }
  ];
  const collapsed = createOverviewLayout(clusters, 1200, 760);
  const expanded = createOverviewLayout(
    [...clusters, { id: "agent:a1", label: "Alpha Worker", project: "Alpha", clusterParentId: "cluster:a" }],
    1200,
    760
  );

  for (const clusterId of ["cluster:b", "cluster:c"]) {
    const before = collapsed.find((item) => item.id === clusterId);
    const after = expanded.find((item) => item.id === clusterId);
    assert.deepEqual({ x: after.x, y: after.y }, { x: before.x, y: before.y });
  }
});

test("dependency lens keeps directed upstream and downstream data in distinct causal lanes", () => {
  const graph = sampleGraph();
  const filtered = applyGraphFilters(graph, { project: "Alpha", agentType: "all", status: "all", relationshipType: "all" });
  const lens = buildDependencyLens(filtered.nodes, filtered.links, "agent:alpha-worker");
  const laidOut = createDependencyLayout(lens.nodes, lens.links, 1200, 760);
  const byId = new Map(laidOut.map((node) => [node.id, node]));

  assert.equal(lens.anchorId, "agent:alpha-worker");
  assert.equal(byId.get("agent:alpha-orch").dependencyRole, "upstream");
  assert.equal(byId.get("agent:alpha-reviewer").dependencyRole, "downstream");
  assert.ok(byId.get("agent:alpha-orch").x < byId.get("agent:alpha-worker").x);
  assert.ok(byId.get("agent:alpha-reviewer").x > byId.get("agent:alpha-worker").x);
  assert.ok(lens.links.every((link) => byId.has(link.source) && byId.has(link.target)));
  assert.equal(selectDependencyAnchor(filtered.nodes, filtered.links, ""), "agent:alpha-worker");
});

test("dependency view defaults to a measurable topology anchor and retains its complete reachable chain", () => {
  const graph = sampleGraph();
  const visible = visibleGraphForState(
    graph,
    {
      filters: { project: "Alpha", agentType: "all", status: "all", relationshipType: "all" },
      viewMode: "dependency",
      expandedClusters: new Set(),
      selectedId: "",
      storage: null
    },
    1200,
    760
  );

  assert.equal(visible.lens.anchorId, "agent:alpha-worker");
  assert.ok(visible.items.every((node) => ["upstream", "focus", "downstream", "shared"].includes(node.dependencyRole)));
  assert.equal(visible.items.length, 7, "the dependency view keeps the full reachable component");
});

test("Explore preserves every source-backed feature while dependency inspection retains every descendant level", () => {
  const graph = normalizeGraph({
    nodes: [
      { id: "project:tree", type: "project", label: "Tree", metadata: { projectName: "Tree" } },
      { id: "functionality:tree:root", type: "application_functionality", label: "Major function", metadata: { projectName: "Tree" } },
      { id: "subfunctionality:tree:a", type: "application_subfunctionality", label: "Child A", metadata: { projectName: "Tree", parentFunctionalityId: "functionality:tree:root" } },
      { id: "subfunctionality:tree:b", type: "application_subfunctionality", label: "Child B", metadata: { projectName: "Tree", parentFunctionalityId: "functionality:tree:root" } },
      { id: "subfunctionality:tree:a:leaf", type: "application_subfunctionality", label: "Grandchild", metadata: { projectName: "Tree", parentFunctionalityId: "subfunctionality:tree:a" } }
    ],
    links: [
      { source: "project:tree", target: "functionality:tree:root", type: "contains_functionality" },
      { source: "functionality:tree:root", target: "subfunctionality:tree:a", type: "contains_subfunctionality" },
      { source: "functionality:tree:root", target: "subfunctionality:tree:b", type: "contains_subfunctionality" },
      { source: "subfunctionality:tree:a", target: "subfunctionality:tree:a:leaf", type: "contains_subfunctionality" }
    ]
  });
  const selectedExplore = visibleGraphForState(graph, {
    filters: { project: "all", agentType: "all", status: "all", relationshipType: "all" },
    viewMode: "explore",
    expandedClusters: new Set(),
    selectedId: "functionality:tree:root",
    storage: null
  }, 900, 560);
  assert.deepEqual(new Set(selectedExplore.items.map((item) => item.id)), new Set(graph.nodes.filter((node) => node.type !== "project").map((node) => node.id)), "selection preserves the full Explore feature canvas instead of filtering it");
  assert.ok(selectedExplore.links.every((link) => selectedExplore.items.some((item) => item.id === link.source) && selectedExplore.items.some((item) => item.id === link.target)));

  const dependency = buildDependencyLens(graph.nodes, graph.links, "functionality:tree:root");
  assert.deepEqual(new Set(dependency.nodes.map((node) => node.id)), new Set(graph.nodes.map((node) => node.id)), "dependency inspection retains every hierarchy descendant");
  assert.ok(dependency.nodes.find((node) => node.id === "subfunctionality:tree:a:leaf"));
});

test("selection never removes filtered nodes outside the dependency lens", () => {
  const graph = sampleGraph();
  const baseState = {
    filters: { project: "Alpha", agentType: "all", status: "all", relationshipType: "all" },
    expandedClusters: new Set(),
    storage: null
  };

  for (const viewMode of ["overview", "explore", "live"]) {
    const withoutSelection = visibleGraphForState(graph, { ...baseState, viewMode, selectedId: "" }, 1200, 760);
    const withSelection = visibleGraphForState(graph, { ...baseState, viewMode, selectedId: "agent:alpha-worker" }, 1200, 760);
    assert.deepEqual(
      new Set(withSelection.items.map((item) => item.id)),
      new Set(withoutSelection.items.map((item) => item.id)),
      `${viewMode} selection preserves its complete filtered node set`
    );
    assert.deepEqual(
      new Set(withSelection.links.map((link) => `${link.source}->${link.target}:${link.type}`)),
      new Set(withoutSelection.links.map((link) => `${link.source}->${link.target}:${link.type}`)),
      `${viewMode} selection preserves its complete filtered edge set`
    );
  }
});

test("architecture projection retains nested child functionality chains below their immediate parent", () => {
  const graph = normalizeGraph({
    nodes: [
      { id: "project:nested", type: "project", label: "Nested", metadata: { projectName: "Nested" } },
      { id: "functionality:nested:root", type: "application_functionality", label: "Major function", metadata: { projectName: "Nested", category: "api" } },
      { id: "subfunctionality:nested:child", type: "application_subfunctionality", label: "Child function", metadata: { projectName: "Nested", parentFunctionalityId: "functionality:nested:root" } },
      { id: "subfunctionality:nested:grandchild", type: "application_subfunctionality", label: "Grandchild function", metadata: { projectName: "Nested", parentFunctionalityId: "subfunctionality:nested:child" } },
      { id: "branch:nested:leaf", type: "branch", label: "Leaf implementation", metadata: { projectName: "Nested" } }
    ],
    links: [
      { source: "project:nested", target: "functionality:nested:root", type: "contains_functionality" },
      { source: "functionality:nested:root", target: "subfunctionality:nested:child", type: "contains_subfunctionality" },
      { source: "subfunctionality:nested:child", target: "subfunctionality:nested:grandchild", type: "contains_subfunctionality" },
      { source: "subfunctionality:nested:grandchild", target: "branch:nested:leaf", type: "supports_architecture_branch" }
    ]
  });
  const architecture = buildArchitectureBranchSummary(graph.nodes, graph.links);
  const ids = new Set(architecture.nodes.map((node) => node.id));
  assert.deepEqual(ids, new Set(graph.nodes.filter((node) => node.type !== "project").map((node) => node.id)));
  assert.ok(architecture.links.some((link) => link.source === "functionality:nested:root" && link.target === "subfunctionality:nested:child"));
  assert.ok(architecture.links.some((link) => link.source === "subfunctionality:nested:child" && link.target === "subfunctionality:nested:grandchild"));
  assert.ok(architecture.links.some((link) => link.source === "subfunctionality:nested:grandchild" && link.target === "branch:nested:leaf"));

  const laidOut = createArchitectureForceSeedLayout(architecture.nodes, architecture.links, 1200, 760);
  for (let leftIndex = 0; leftIndex < laidOut.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < laidOut.length; rightIndex += 1) {
      assert.equal(layoutBoundsIntersect(laidOut[leftIndex], laidOut[rightIndex], 12), false, "nested architecture nodes do not overlap");
    }
  }
});

test("architecture relation planning preserves every feature relationship without project spokes", () => {
  const graph = normalizeGraph({
    nodes: [
      { id: "project:rails", type: "project", label: "Rails", metadata: { projectName: "Rails" } },
      ...["landing", "settings", "billing"].map((id, index) => ({
        id: `functionality:rails:${id}`,
        type: "application_functionality",
        label: id,
        metadata: { projectName: "Rails", category: "ui", interactionPriority: index }
      })),
      { id: "subfunctionality:rails:settings-form", type: "application_subfunctionality", label: "Settings form", metadata: { projectName: "Rails", parentFunctionalityId: "functionality:rails:settings" } },
      ...Array.from({ length: 13 }, (_, index) => ({
        id: `branch:rails:billing:${index}`,
        type: "branch",
        label: `Billing branch ${index}`,
        metadata: { projectName: "Rails" }
      }))
    ],
    links: [
      ...["landing", "settings", "billing"].map((id) => ({ source: "project:rails", target: `functionality:rails:${id}`, type: "contains_functionality" })),
      { source: "functionality:rails:settings", target: "subfunctionality:rails:settings-form", type: "contains_subfunctionality" },
      ...Array.from({ length: 13 }, (_, index) => ({ source: "functionality:rails:billing", target: `branch:rails:billing:${index}`, type: "has_architecture_branch" }))
    ]
  });
  const architecture = buildArchitectureBranchSummary(graph.nodes, graph.links);
  const laidOut = createArchitectureZoneLayout(architecture.nodes, architecture.links, 1200, 760);
  const plan = createArchitectureEdgePlan(laidOut, architecture.links);
  const allLinkIds = new Set(architecture.links.map((link) => link.id));
  const coveredLinkIds = new Set([...plan.semanticMembership.keys()]);

  assert.deepEqual(coveredLinkIds, allLinkIds, "every semantic relationship belongs to exactly one visual routing record");
  assert.deepEqual(plan.missingLinkIds, []);
  assert.deepEqual(plan.duplicatedLinkIds, []);
  assert.equal(architecture.nodes.some((node) => node.type === "project"), false, "project context is omitted from the feature projection");
  assert.equal(architecture.links.some((link) => String(link.source).startsWith("project:") || String(link.target).startsWith("project:")), false, "project membership does not become a feature relationship");
  assert.equal(plan.visualLinks.filter((link) => link.kind === "zone-rail").length, 0, "project-zone rails are unnecessary without project spokes");
  assert.ok(plan.visualLinks.some((link) => link.kind === "fanout-rail" && link.relationCount === 13), "a high-fanout parent gets a contained, typed child rail");
  assert.ok(plan.visualLinks.some((link) => link.kind === "local-tree" && link.source === "functionality:rails:settings" && link.target === "subfunctionality:rails:settings-form"), "ordinary child hierarchy remains a direct local twig");
});

test("source-backed legacy evidence becomes a visible child hierarchy without inventing functionality", () => {
  const graph = normalizeGraph({
    nodes: [
      { id: "project:legacy", type: "project", label: "Legacy", metadata: { projectName: "Legacy" } },
      {
        id: "functionality:legacy:orders",
        type: "application_functionality",
        label: "Orders",
        metadata: {
          projectName: "Legacy",
          evidence: [{ id: "orders-source", reference: "src/orders.ts:42", source: "project_source_scan" }]
        }
      },
      { id: "branch:legacy:orders", type: "branch", label: "Orders branch", metadata: { projectName: "Legacy" } }
    ],
    links: [
      { source: "project:legacy", target: "functionality:legacy:orders", type: "contains_functionality" },
      { source: "functionality:legacy:orders", target: "branch:legacy:orders", type: "has_architecture_branch" },
      { source: "functionality:legacy:orders", target: "branch:legacy:orders", type: "has_architecture_branch" }
    ]
  });
  const children = graph.nodes.filter((node) => node.type === "application_subfunctionality");
  assert.equal(children.length, 1);
  assert.equal(children[0].metadata.sourceBackedProjection, true);
  assert.equal(children[0].metadata.parentFunctionalityId, "functionality:legacy:orders");
  assert.ok(graph.links.some((link) => link.source === "functionality:legacy:orders" && link.target === children[0].id && link.type === "contains_subfunctionality"));
  assert.ok(graph.links.some((link) => link.source === children[0].id && link.target === "branch:legacy:orders" && link.type === "supports_architecture_branch"));
  assert.equal(dedupeGraphLinks(graph.links).length, graph.links.length, "source/target/type dedupe removes duplicate source facts");
});

test("source-backed UI, API, and database entities preserve legacy page evidence without API-only collapse", () => {
  const graph = normalizeGraph({
    nodes: [
      { id: "project:commerce", type: "project", label: "Commerce", metadata: { projectId: "commerce", projectName: "Commerce" } },
      { id: "functionality:commerce:legacy-ui", type: "application_functionality", label: "UI surface in src/Legacy.jsx", metadata: { projectId: "commerce", projectName: "Commerce", evidence: [{ reference: "src/Legacy.jsx:1" }] } },
      { id: "subfunctionality:commerce:legacy", type: "application_subfunctionality", label: "Source unit: src/Legacy.jsx:1", metadata: { parentFunctionalityId: "legacy-ui", sourcePath: "src/Legacy.jsx" } },
      { id: "agent:commerce-legacy", type: "agent", label: "Legacy UI Agent", metadata: { responsibility: "Own the detected ui functionality “UI surface in src/Legacy.jsx” using only its cited source boundary." } },
      { id: "page:commerce:orders", type: "page", label: "Orders page", metadata: { applicationTopology: true, applicationEntityType: "ui_surface", projectId: "commerce", projectName: "Commerce", evidence: [{ reference: "src/Orders.jsx:8" }], sourceHints: { ui: { component: "OrdersPage", sourcePath: "src/Orders.jsx" } } } },
      { id: "api:commerce:orders", type: "application_functionality", label: "GET /api/orders", metadata: { projectId: "commerce", projectName: "Commerce", evidence: [{ reference: "src/server.js:12" }] } },
      { id: "database:commerce:orders", type: "database", label: "app database (postgresql)", metadata: { applicationTopology: true, applicationEntityType: "database_connection", projectId: "commerce", projectName: "Commerce", evidence: [{ reference: "src/db.ts:3" }], sourceHints: { database: { connection: "app", provider: "postgresql", sourcePath: "src/db.ts" } } } }
    ],
    links: [
      { source: "project:commerce", target: "functionality:commerce:legacy-ui", type: "contains_functionality" },
      { source: "functionality:commerce:legacy-ui", target: "subfunctionality:commerce:legacy", type: "contains_subfunctionality" },
      { source: "agent:commerce-legacy", target: "functionality:commerce:legacy-ui", type: "implements" },
      { source: "project:commerce", target: "page:commerce:orders", type: "contains_application_entity" },
      { source: "project:commerce", target: "api:commerce:orders", type: "contains_application_entity" },
      { source: "project:commerce", target: "database:commerce:orders", type: "contains_application_entity" },
      { source: "page:commerce:orders", target: "api:commerce:orders", type: "ui_calls_api" },
      { source: "api:commerce:orders", target: "database:commerce:orders", type: "api_uses_database" }
    ]
  });
  const retainedIds = new Set(graph.nodes.map((node) => node.id));
  assert.equal(retainedIds.has("functionality:commerce:legacy-ui"), true);
  assert.equal(retainedIds.has("subfunctionality:commerce:legacy"), false);
  assert.equal(retainedIds.has("agent:commerce-legacy"), false);
  assert.deepEqual(new Set(graph.links.map((link) => link.type)), new Set(["contains_functionality", "contains_application_entity", "ui_calls_api", "api_uses_database"]));
  assert.equal(nodeVisualType(graph.nodeById.get("functionality:commerce:legacy-ui")), "page");
  assert.equal(nodeVisualType(graph.nodeById.get("database:commerce:orders")), "database");
  assert.equal(nodeVisualType(graph.nodeById.get("api:commerce:orders")), "api", "recorded legacy routes migrate to the same API identity");

  const filters = { project: "all", agentType: "all", status: "all", relationshipType: "all" };
  const explore = visibleGraphForState(graph, { filters, viewMode: "explore", expandedClusters: new Set(), selectedId: "page:commerce:orders", storage: null }, 1200, 760);
  assert.deepEqual(new Set(explore.items.map((item) => item.id)), new Set([...retainedIds].filter((id) => id !== "project:commerce")), "Explore keeps all application topology after selection without a project-root node");
  const dependency = visibleGraphForState(graph, { filters, viewMode: "dependency", expandedClusters: new Set(), selectedId: "page:commerce:orders", storage: null }, 1200, 760);
  assert.ok(dependency.items.some((item) => item.id === "database:commerce:orders"), "Dependencies reaches the database through the recorded API path");
  const architecture = buildArchitectureBranchSummary(graph.nodes, graph.links);
  const architectureEntityIds = new Set([...retainedIds].filter((id) => id !== "project:commerce"));
  assert.deepEqual(new Set(architecture.nodes.map((node) => node.id)), architectureEntityIds, "Architecture uses real application entities and omits project context");
  assert.ok(architecture.links.some((link) => link.type === "ui_calls_api"));
  assert.ok(architecture.links.some((link) => link.type === "api_uses_database"));
});

test("source-backed architecture keeps feature relationships, agent ownership, and chronology-free force seeds", () => {
  const graph = normalizeGraph({
    nodes: [
      { id: "project:shop", type: "project", label: "Shop", metadata: { projectId: "shop", projectName: "Shop" } },
      { id: "agent:experience", type: "agent", label: "Experience Agent", metadata: { role: "experience-composition", description: "Owns the storefront experience." } },
      { id: "page:shop:main", type: "page", label: "Main page", metadata: { applicationTopology: true, applicationEntityType: "ui_surface", projectId: "shop", projectName: "Shop", chronologyOrder: 0, hierarchyDepth: 1, metrics: { cyclomaticComplexity: 18, relativeCyclomaticComplexity: 1, connectorCount: 3 } } },
      { id: "page:shop:orders", type: "page", label: "Orders page", metadata: { applicationTopology: true, applicationEntityType: "ui_surface", projectId: "shop", projectName: "Shop", parentEntityNodeId: "page:shop:main", chronologyOrder: 1, hierarchyDepth: 2, metrics: { cyclomaticComplexity: 5, relativeCyclomaticComplexity: 0.3, connectorCount: 2 } } },
      { id: "ui-element:shop:load-orders", type: "ui_element", label: "Load orders", metadata: { applicationTopology: true, applicationEntityType: "ui_element", projectId: "shop", projectName: "Shop", parentEntityNodeId: "page:shop:orders", chronologyOrder: 2, hierarchyDepth: 3, metrics: { connectorCount: 3 } } },
      { id: "feature:shop:load-orders", type: "feature", label: "Load orders feature", metadata: { applicationTopology: true, applicationEntityType: "ui_feature", projectId: "shop", projectName: "Shop", parentEntityNodeId: "ui-element:shop:load-orders", chronologyOrder: 3, hierarchyDepth: 4, metrics: { connectorCount: 3 } } },
      { id: "api:shop:orders", type: "api", label: "GET /api/orders", metadata: { applicationTopology: true, applicationEntityType: "api_route", projectId: "shop", projectName: "Shop", parentEntityNodeId: "feature:shop:load-orders", chronologyOrder: 4, hierarchyDepth: 5, metrics: { connectorCount: 2 } } },
      { id: "service:shop:orders", type: "service", label: "Order service", metadata: { applicationTopology: true, applicationEntityType: "service", projectId: "shop", projectName: "Shop", parentEntityNodeId: "api:shop:orders", chronologyOrder: 5, hierarchyDepth: 6, metrics: { connectorCount: 2 } } },
      { id: "database:shop:orders", type: "database", label: "Orders database", metadata: { applicationTopology: true, applicationEntityType: "database_connection", projectId: "shop", projectName: "Shop", parentEntityNodeId: "service:shop:orders", chronologyOrder: 6, hierarchyDepth: 7, metrics: { connectorCount: 1 } } }
    ],
    links: [
      { source: "project:shop", target: "page:shop:main", type: "contains_application_entity" },
      { source: "agent:experience", target: "page:shop:main", type: "implements" },
      { source: "agent:experience", target: "ui-element:shop:load-orders", type: "implements" },
      { source: "page:shop:main", target: "page:shop:orders", type: "contains_feature", metadata: { hierarchy: true } },
      { source: "page:shop:orders", target: "ui-element:shop:load-orders", type: "contains_ui_element", metadata: { hierarchy: true } },
      { source: "ui-element:shop:load-orders", target: "feature:shop:load-orders", type: "has_ui_feature", metadata: { hierarchy: true } },
      { source: "feature:shop:load-orders", target: "api:shop:orders", type: "ui_calls_api", metadata: { hierarchy: true } },
      { source: "feature:shop:load-orders", target: "service:shop:orders", type: "ui_uses_service" },
      { source: "api:shop:orders", target: "service:shop:orders", type: "api_calls_service", metadata: { hierarchy: true } },
      { source: "service:shop:orders", target: "database:shop:orders", type: "service_uses_database", metadata: { hierarchy: true } }
    ]
  });
  const architecture = buildArchitectureBranchSummary(graph.nodes, graph.links);
  const laidOut = createArchitectureFreeForceSeedLayout(architecture.nodes, architecture.links, 1200, 760);
  const reorderedChronology = createArchitectureFreeForceSeedLayout(
    architecture.nodes.map((node) => ({ ...node, metadata: { ...node.metadata, chronologyOrder: 999 - Number(node.metadata?.chronologyOrder || 0) } })),
    architecture.links,
    1200,
    760
  );
  const byId = new Map(laidOut.map((item) => [item.id, item]));
  const reorderedById = new Map(reorderedChronology.map((item) => [item.id, item]));

  assert.deepEqual(architecture.nodes.map((node) => node.label), ["Main page", "Orders page", "Load orders", "Load orders feature", "GET /api/orders", "Order service", "Orders database", "Experience Agent"]);
  assert.equal(architecture.nodes.some((node) => node.type === "project"), false, "Project genesis is not an Architecture feature");
  assert.deepEqual(architecture.links.map((link) => link.type), ["implements", "implements", "contains_feature", "contains_ui_element", "has_ui_feature", "ui_calls_api", "ui_uses_service", "api_calls_service", "service_uses_database"]);
  assert.equal(byId.get("agent:experience").metadata.assignedFunctionalityCount, 2);
  assert.equal(byId.get("agent:experience").metadata.assignmentScope, "project-exclusive", "an agent serving one project is explicitly marked project-exclusive");
  assert.ok(architecture.links.some((link) => link.source === "agent:experience" && link.target === "page:shop:main" && link.metadata.agentOwnership));
  assert.equal(architecture.links.some((link) => link.source === "project:shop" || link.target === "project:shop"), false, "project membership is represented by the project filter rather than a graph edge");
  for (const child of architecture.nodes.filter((node) => node.metadata?.parentEntityNodeId)) {
    assert.ok(
      architecture.links.some((link) => link.source === child.metadata.parentEntityNodeId && link.target === child.id),
      `${child.label} retains its evidenced parent relationship`
    );
  }
  for (const node of laidOut) {
    assert.equal(node.x, reorderedById.get(node.id).x, `${node.label} x seed ignores chronology`);
    assert.equal(node.y, reorderedById.get(node.id).y, `${node.label} y seed ignores chronology`);
  }
  assert.equal(byId.get("database:shop:orders").metadata.architectureLevel, 7);
  assert.ok(architectureNodeRadius(byId.get("page:shop:main")) > architectureNodeRadius(byId.get("database:shop:orders")), "complexity and connectors produce a larger major-feature node");
});

test("render strategy progressively reveals large graphs and promotes dense edges to Canvas", () => {
  assert.deepEqual(selectRenderStrategy({ nodeCount: 82, linkCount: 106, lastFrameMs: 8 }), {
    mode: "svg",
    progressive: false,
    canvasEdges: false,
    frameBudgetMs: 32,
    initialNodeLimit: 82,
    batchSize: 100
  });
  assert.equal(selectRenderStrategy({ nodeCount: 220, linkCount: 180, lastFrameMs: 10 }).mode, "progressive-svg");
  assert.equal(selectRenderStrategy({ nodeCount: 160, linkCount: 280, lastFrameMs: 10 }).mode, "progressive-hybrid");
  assert.equal(selectRenderStrategy({ nodeCount: 150, linkCount: 150, lastFrameMs: 48 }).mode, "hybrid-canvas");
  assert.equal(selectRenderStrategy({ nodeCount: 360, linkCount: 420, lastFrameMs: 20 }).mode, "progressive-hybrid");
});

test("the production topology renders the Explore feature clusters and every service chain", () => {
  const rawTopology = JSON.parse(
    fs.readFileSync(new URL("../../../topology/d3/agentic-system-graph.json", import.meta.url), "utf8")
  );
  const graph = normalizeGraph(rawTopology);
  const baseState = {
    filters: { project: "all", agentType: "all", status: "all", relationshipType: "all" },
    expandedClusters: new Set(),
    storage: null
  };
  const visualTypes = new Set(graph.nodes.map(nodeVisualType));
  assert.ok([...visualTypes].every((type) => NODE_TYPE_REGISTRY[type]), "every production node resolves through the shared visual type registry");
  assert.ok(graph.nodes.some((node) => node.metadata?.applicationTopology && node.type === "page"), "legacy UI evidence is preserved as a visible feature/page node");
  assert.ok(graph.nodes.some((node) => node.metadata?.applicationTopology && ["service", "database"].includes(node.type)), "non-API project feature boundaries remain visible");

  const selection = graph.nodes.find((node) => node.agentType === "functionality")?.id;
  const selectedExplore = visibleGraphForState(graph, { ...baseState, viewMode: "explore", selectedId: selection }, 1280, 760);
  assert.ok(selectedExplore.items.length > 0, "Explore renders source-backed feature clusters");
  assert.ok(selectedExplore.links.length > 0, "Explore retains feature and ownership relationships");

  const assertNoVisualOverlap = (items, label) => {
    for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
        assert.equal(
          layoutBoundsIntersect(items[leftIndex], items[rightIndex], 12),
          false,
          `${label}: ${items[leftIndex].id} and ${items[rightIndex].id} do not overlap`
        );
      }
    }
  };

  for (const [viewport, graphWidth] of [["desktop", 1280], ["narrow", 640]]) {
    const explore = visibleGraphForState(graph, { ...baseState, viewMode: "explore", selectedId: selection }, graphWidth, 760);
    assert.ok(explore.items.every((item) => Number.isFinite(item.x) && Number.isFinite(item.y)), `Explore ${viewport} provides deterministic force seeds`);
    assert.ok(explore.links.every((link) => explore.items.some((item) => item.id === link.source) && explore.items.some((item) => item.id === link.target)));
  }

  for (const viewMode of ["overview"]) {
    const visible = visibleGraphForState(graph, { ...baseState, viewMode, selectedId: "" }, 1280, 760);
    assert.equal(new Set(visible.items.map((item) => item.id)).size, visible.items.length, `${viewMode} does not duplicate rendered entities`);
    assertNoVisualOverlap(visible.items, viewMode);
  }

  assert.equal(selectedExplore.items.some((item) => item.type === "project"), false, "Explore omits project roots because the project filter already scopes the canvas");
  assert.ok(selectedExplore.items.some((item) => item.type === "agent"), "Explore includes agents assigned to application nodes");
  assert.ok(selectedExplore.links.some((link) => link.type === "implements" && link.metadata?.agentOwnership), "Explore connects assigned agents to the nodes they implement");
  assert.ok(selectedExplore.links.every((link) => !String(link.source).startsWith("project:") && !String(link.target).startsWith("project:")), "Explore links connect features to their evidenced feature dependencies only");
  for (const child of selectedExplore.items.filter((item) => item.metadata?.parentEntityNodeId)) {
    assert.ok(
      selectedExplore.links.some((link) => link.source === child.metadata.parentEntityNodeId && link.target === child.id),
      `${child.id} retains its source-backed parent edge`
    );
  }

  const services = graph.nodes.filter((node) => nodeVisualType(node) === "service");
  assert.ok(services.length > 0, "the production topology contains service anchors");
  let deepestServiceChain = 0;
  for (const service of services) {
    const lens = buildDependencyLens(graph.nodes, graph.links, service.id);
    const laidOut = createDependencyLayout(lens.nodes, lens.links, 1280, 760);
    deepestServiceChain = Math.max(deepestServiceChain, ...lens.nodes.map((node) => Number(node.dependencyDepth) || 0));
    assertNoVisualOverlap(laidOut, `${service.label} dependency lens`);
    assert.ok(lens.links.every((link) => laidOut.some((item) => item.id === link.source) && laidOut.some((item) => item.id === link.target)), `${service.label} keeps every connected endpoint`);
  }
  assert.ok(deepestServiceChain > 2, "at least one real service chain has more than two dependency levels");
});

test("the inspector contract exposes functionality hierarchy, factual efficiency, and agent profile deep links", () => {
  const renderer = fs.readFileSync(new URL("../public/agentic-system/d3/agentic-system-d3.js", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../public/agentic-system/d3/index.html", import.meta.url), "utf8");
  for (const requiredText of [
    "Open agent profile",
    "Efficiency not reported",
    "Functionality hierarchy",
    "Connected agents",
    "Connected APIs, services & data",
    "Relationship details",
    "agentProfileHref",
    "constrainNodeDrag",
    "layoutNodeBounds",
    "const completeTopologyView = [\"explore\", \"dependency\"].includes(state.viewMode)",
    "createArchitectureEdgePlan",
    "architectureRailNetwork",
    "renderArchitectureScaffold",
    "data-member-link-ids"
  ]) {
    assert.ok(renderer.includes(requiredText), `renderer includes ${requiredText}`);
  }
  assert.equal(renderer.includes('.classed("muted", (row)'), false, "selection does not apply a muted class to context links");
  assert.equal(renderer.includes("state.depth"), false, "renderer has no depth state");
  assert.equal(renderer.includes("controls.depth"), false, "renderer has no depth handler");
  assert.equal(page.includes("depth-filter"), false, "page has no neighborhood-depth selector");
  assert.equal(page.includes("1 hop") || page.includes("2 hops"), false, "page has no hop labels");
  assert.equal(renderer.includes("runConstrainedArchitectureLayout(visible.items, visible.links)"), true, "Explore runs the bounded D3 force pass before rendering");
  assert.ok(renderer.includes("architectureClusterGravity") && renderer.includes('.force("clusterGravity", architectureClusterGravity(0.14))'), "Explore applies category-aware gravity alongside collision and link forces");
  const forceStart = renderer.indexOf("function runConstrainedArchitectureLayout");
  const forceEnd = renderer.indexOf("function fitAfterPassiveUpdate", forceStart);
  const architectureForce = renderer.slice(forceStart, forceEnd);
  assert.equal(architectureForce.includes('force("x"'), false, "Architecture has no hierarchy-depth X anchor");
  assert.equal(architectureForce.includes('force("y"'), false, "Architecture has no chronology Y anchor");
  assert.ok(renderer.includes('mode: isExploreArchitecture() ? "force-canvas"'), "Explore uses the Canvas edge renderer");
  assert.equal(renderer.includes("selectedRelationshipLabels"), false, "Architecture Canvas does not render relationship labels");
  assert.ok(renderer.includes("if (!isExploreArchitecture())"), "Explore Canvas omits directional arrowheads");
  assert.ok(renderer.includes("if (isExploreArchitecture()) return null;"), "Explore SVG fallback also omits directional markers");
  assert.ok(renderer.includes("link.metadata?.evidence || link.evidence"), "relationship type, direction, and source evidence remain available in Insight");
  const stylesheet = fs.readFileSync(new URL("../public/agentic-system/d3/agentic-system.css", import.meta.url), "utf8");
  for (const requiredText of ["architecture-zone-board", "architecture-zone-rail", "architecture-fanout-rail", "architecture-local-tree"]) {
    assert.ok(stylesheet.includes(requiredText), `stylesheet includes ${requiredText}`);
  }
  assert.ok(renderer.includes("project-exclusive-agent") && renderer.includes("shared-agent"), "Explore assigns distinct visual scope classes to exclusive and shared agents");
  assert.ok(renderer.includes("architectureSelectedLink ? 4.2") && renderer.includes(": 0.7"), "Explore keeps selected connectors emphatic while thinning the default connector");
});

test("Architecture analysis is owned by the PlutoniX page instead of project tools", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const projectToolsStart = app.indexOf('<div className="project-tools">');
  const projectToolsEnd = app.indexOf("</details>", projectToolsStart);
  const projectTools = app.slice(projectToolsStart, projectToolsEnd);
  assert.equal(projectTools.includes("analyzeArchitectureBranches"), false, "project tools no longer mount Architecture analysis");
  assert.ok(app.includes('className="plutonix-architecture-toolbar"'), "the PlutoniX page owns the Architecture analysis control");
  assert.ok(app.includes('requestedFrom: "plutonix-page"'), "analysis telemetry records the PlutoniX surface");
  assert.ok(app.includes("disabled={!selectedProject || isAnalyzingArchitecture}"), "an already analysed selected project remains eligible for re-analysis");
  assert.equal(app.includes("disabled={!selectedProject || selectedProject.isDefault || isAnalyzingArchitecture}"), false, "the shared project is not blocked by the retired managed-project restriction");
});

test("development hot reload preserves the in-memory authorization used by Architecture analysis", () => {
  const authClient = fs.readFileSync(new URL("../src/authClient.js", import.meta.url), "utf8");
  assert.ok(authClient.includes("import.meta.hot?.data?.authState"), "auth state is restored from Vite's in-memory HMR data");
  assert.ok(authClient.includes("import.meta.hot.dispose"), "auth state is handed to the replacement module");
  assert.equal(authClient.includes("localStorage.setItem"), false, "authorization credentials are not persisted to local storage");
  assert.equal(authClient.includes("sessionStorage.setItem"), false, "authorization credentials are not persisted to session storage");
});

test("Explore uses the circular feature-cluster grammar and invalidates the retired matrix positions", () => {
  const renderer = fs.readFileSync(new URL("../public/agentic-system/d3/agentic-system-d3.js", import.meta.url), "utf8");
  const style = fs.readFileSync(new URL("../public/agentic-system/d3/agentic-system.css", import.meta.url), "utf8");
  const architectureStart = renderer.indexOf("if (node.metadata?.architectureLens)");
  const architectureEnd = renderer.indexOf('    if (type === "project")', architectureStart);
  const architectureShape = renderer.slice(architectureStart, architectureEnd);

  assert.ok(architectureShape.includes('append("circle").attr("class", "node-shape architecture-tree-shape")'), "Architecture has one circular base glyph");
  assert.equal(architectureShape.includes('.append("path")'), false, "Architecture does not mix folder, hexagon, or chevron glyphs into the hierarchy");
  assert.equal(architectureShape.includes("node-acronym"), false, "Architecture circles do not compete with a center acronym");
  assert.ok(renderer.includes('className: "architecture-node-icon"'), "Architecture has a dedicated centered icon treatment");
  assert.ok(renderer.includes("x: -iconSize / 2, y: -iconSize / 2"), "Architecture category icons are centered in their circles");
  assert.ok(renderer.includes("architecture-zone-gate"), "Architecture renders open flow gates instead of filled boards");
  assert.ok(renderer.includes('fitItems(visible.items);'), "Architecture opens with the complete branch map in frame");
  assert.ok(style.includes("architecture-node-rim") && style.includes("architecture-zone-gate"), "type and flow cues are conveyed by circular rim and gate styling");
  assert.match(storageKey("Alpha", "explore"), /explore-feature-clusters-v1$/, "retired matrix positions cannot constrain the feature-cluster canvas");
});
