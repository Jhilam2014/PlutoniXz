import test from "node:test";
import assert from "node:assert/strict";
import {
  applyGraphFilters,
  buildClusters,
  createExploreLayout,
  createOverviewLayout,
  focusNeighborhood,
  layoutNodeRadius,
  normalizeGraph,
  preserveSelectionThroughFilters,
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
      { source: "project:alpha", target: "agent:alpha-orch", type: "has_orchestrator" }
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
  assert.equal(byProject.nodes.length, 5);

  const byType = applyGraphFilters(graph, { project: "Alpha", agentType: "qagent", status: "all", relationshipType: "all" });
  assert.deepEqual(byType.nodes.map((node) => node.id), ["agent:alpha-reviewer"]);

  const byStatus = applyGraphFilters(graph, { project: "Alpha", agentType: "all", status: "failed", relationshipType: "all" });
  assert.deepEqual(byStatus.nodes.map((node) => node.id), ["memory:alpha"]);

  const bySearch = applyGraphFilters(graph, { search: "qagent", project: "all", agentType: "all", status: "all", relationshipType: "all" });
  assert.deepEqual(bySearch.nodes.map((node) => node.id), ["agent:alpha-reviewer"]);

  const byRelation = applyGraphFilters(graph, { project: "Alpha", agentType: "all", status: "all", relationshipType: "memory" });
  assert.deepEqual(new Set(byRelation.nodes.map((node) => node.id)), new Set(["agent:alpha-worker", "memory:alpha"]));
});

test("focus depth returns one-hop and two-hop neighborhoods with direction sets", () => {
  const graph = sampleGraph();
  const oneHop = focusNeighborhood(graph, "agent:alpha-worker", 1);
  assert.deepEqual(oneHop.ids, new Set(["agent:alpha-worker", "agent:alpha-orch", "agent:alpha-reviewer", "memory:alpha"]));
  assert.ok(oneHop.upstream.has("agent:alpha-orch"));
  assert.ok(oneHop.downstream.has("agent:alpha-reviewer"));

  const twoHop = focusNeighborhood(graph, "agent:alpha-reviewer", 2);
  assert.ok(twoHop.ids.has("agent:alpha-orch"), "two-hop focus includes upstream orchestrator through worker");
  assert.ok(twoHop.ids.has("memory:alpha"), "two-hop focus includes sibling downstream memory path through worker");
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
      depth: 1,
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

test("explore layout prefers readable spacing over fitting every node into the viewport", () => {
  const nodes = Array.from({ length: 49 }, (_, index) => ({
    id: `agent:${index}`,
    type: "agent",
    label: `Explore Agent ${index}`,
    agentType: index < 7 ? "orchestrator" : "worker",
    project: "Explore",
    statusGroup: "idle"
  }));
  const links = nodes.slice(1).map((node, index) => ({
    source: nodes[index % 7].id,
    target: node.id,
    type: "delegates_to"
  }));
  const laidOut = createExploreLayout(nodes, links, 1200, 760);
  const xs = laidOut.map((node) => node.x);
  const ys = laidOut.map((node) => node.y);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadY = Math.max(...ys) - Math.min(...ys);

  assert.ok(spreadX > 1200 || spreadY > 760, "explore uses a larger virtual canvas for readable nodes");
  assert.ok(laidOut.some((node) => node.orbitAnchor), "explore keeps main nodes as orbit anchors");
  assert.ok(laidOut.some((node) => node.orbitParentId), "explore places child nodes around anchors");
});

test("explore layout centers each project cluster and prevents node overlap", () => {
  const nodes = normalizeGraph({
    nodes: [
      { id: "project:alpha", type: "project", label: "Alpha", metadata: { projectName: "Alpha" } },
      { id: "project:beta", type: "project", label: "Beta", metadata: { projectName: "Beta" } },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `agent:alpha-${index}`,
        type: "agent",
        label: `Alpha Agent ${index}`,
        group: index % 3 === 0 ? "review-agent" : "worker-agent",
        metadata: {
          projectName: "Alpha",
          supportAgent: index % 3 === 0,
          domain: index % 2 === 0 ? "build" : "quality"
        }
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `agent:beta-${index}`,
        type: "agent",
        label: `Beta Agent ${index}`,
        group: index % 4 === 0 ? "project-agent" : "worker-agent",
        cluster_id: index % 4 === 0 ? "project-orchestrator" : "data",
        metadata: { projectName: "Beta", domain: index % 2 === 0 ? "data" : "workflow" }
      }))
    ],
    links: [
      ...Array.from({ length: 12 }, (_, index) => ({ source: "project:alpha", target: `agent:alpha-${index}`, type: "owns" })),
      ...Array.from({ length: 10 }, (_, index) => ({ source: "project:beta", target: `agent:beta-${index}`, type: "owns" }))
    ]
  });
  const laidOut = createExploreLayout(nodes.nodes, nodes.links, 1200, 760);
  const byId = new Map(laidOut.map((node) => [node.id, node]));

  for (const projectId of ["project:alpha", "project:beta"]) {
    const project = byId.get(projectId);
    assert.equal(project.projectClusterCenter, true);
    const children = laidOut.filter((node) => node.project === project.project && node.id !== project.id);
    assert.ok(children.every((node) => node.projectClusterCenterId === project.id));
    const average = children.reduce(
      (acc, node) => ({ x: acc.x + node.x / children.length, y: acc.y + node.y / children.length }),
      { x: 0, y: 0 }
    );
    assert.ok(Math.hypot(average.x - project.x, average.y - project.y) < 90, `${project.label} is centered in its cluster`);
  }

  for (let leftIndex = 0; leftIndex < laidOut.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < laidOut.length; rightIndex += 1) {
      const left = laidOut[leftIndex];
      const right = laidOut[rightIndex];
      const distance = Math.hypot(left.x - right.x, left.y - right.y);
      const minimum = layoutNodeRadius(left) + layoutNodeRadius(right) + 12;
      assert.ok(distance >= minimum, `${left.id} and ${right.id} do not overlap`);
    }
  }
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
