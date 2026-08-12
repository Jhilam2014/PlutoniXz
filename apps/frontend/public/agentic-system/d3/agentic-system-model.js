export const VIEW_MODES = {
  overview: "System Overview",
  dependency: "Dependency View",
  live: "Live Execution",
  explore: "Explore"
};

export const STATUS_GROUPS = {
  running: new Set(["active", "running", "ready", "managed", "bootstrapped", "implemented", "complete", "available", "watching", "validated"]),
  waiting: new Set(["waiting", "pending", "pending_install", "queued", "paused", "gated", "proposed", "required"]),
  failed: new Set(["failed", "error", "unhealthy", "blocked", "rejected"]),
  idle: new Set(["idle", "unknown", "inactive", "skipped"])
};

export function humanize(value) {
  return String(value || "unknown").replaceAll(/[_-]/g, " ");
}

export function shortName(value, max = 18) {
  const text = String(value || "Unnamed").replace(/\b(agent|project|system|plutonix)\b/gi, "").replace(/\s+/g, " ").trim() || String(value || "Unnamed");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function nodeId(value) {
  return typeof value === "object" && value ? value.id : value;
}

export function normalizeStatus(value) {
  const status = String(value || "unknown").toLowerCase();
  if (STATUS_GROUPS.failed.has(status)) return "failed";
  if (STATUS_GROUPS.waiting.has(status)) return "waiting";
  if (STATUS_GROUPS.running.has(status)) return "running";
  if (STATUS_GROUPS.idle.has(status)) return "idle";
  if (status.includes("fail") || status.includes("error")) return "failed";
  if (status.includes("pending") || status.includes("wait")) return "waiting";
  if (status.includes("active") || status.includes("ready") || status.includes("run")) return "running";
  return "idle";
}

export function inferAgentType(node) {
  const haystack = [
    node?.label,
    node?.type,
    node?.group,
    node?.cluster_id,
    node?.agent_id,
    node?.metadata?.role,
    node?.metadata?.domain,
    node?.metadata?.responsibility,
    node?.metadata?.description
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (node?.type === "project" || node?.group === "project") return "project";
  if (node?.type === "vector_store" || node?.type === "graph_store" || haystack.includes("memory") || haystack.includes("database")) return "memory";
  if (node?.type === "human_review" || haystack.includes("human")) return "human";
  // QAgents are their own visual role: they remain reviewers functionally, but must not blend into standard review nodes.
  if (node?.type === "agent" && haystack.includes("qagent")) return "qagent";
  if (node?.type === "agent" && (node?.metadata?.supportAgent || haystack.includes("review"))) return "reviewer";
  if (node?.type === "agent" && (haystack.includes("orchestrator") || haystack.includes("global-plutonix"))) return "orchestrator";
  if (node?.type === "agent") return "worker";
  if (node?.type === "cluster") return "capability";
  if (["service", "api", "page", "workflow", "feature", "validation"].includes(node?.type)) return node.type;
  return node?.type || "artifact";
}

export function inferProject(node) {
  return (
    node?.metadata?.projectName ||
    node?.metadata?.project_name ||
    node?.metadata?.projectId ||
    (node?.type === "project" ? node.label : "") ||
    "Core Platform"
  );
}

export function inferDomain(node) {
  return node?.metadata?.domain || node?.group || node?.cluster_id || node?.type || "system";
}

export function inferCapability(node) {
  return node?.cluster_id || node?.metadata?.capability || node?.metadata?.role || node?.group || node?.type || "general";
}

export function enrichNode(node) {
  const agentType = inferAgentType(node);
  const lifecycleStatus = node.status || node.metadata?.lifecycle || "unknown";
  const explicitRuntimeStates = new Set([
    "running",
    "waiting",
    "failed",
    "error",
    "unhealthy",
    "blocked",
    "idle",
    "queued",
    "paused",
    "pending",
    "pending_install",
    "gated",
    "rejected"
  ]);
  const runtimeStatus =
    node.metadata?.runtimeStatus ||
    node.metadata?.healthStatus ||
    node.runtime_status ||
    node.health_status ||
    (explicitRuntimeStates.has(String(node.status || "").toLowerCase()) ? node.status : "");
  const statusGroup = normalizeStatus(runtimeStatus || "unknown");
  const project = inferProject(node);
  const domain = inferDomain(node);
  const capability = inferCapability(node);
  return {
    ...node,
    metadata: { ...(node.metadata || {}) },
    agentType,
    statusGroup,
    lifecycleStatus,
    runtimeStatus: runtimeStatus || "",
    hasRuntimeSignal: Boolean(runtimeStatus),
    project,
    domain,
    capability,
    searchable: [
      node.id,
      node.label,
      node.type,
      node.group,
      node.agent_id,
      node.cluster_id,
      project,
      domain,
      capability,
      node.metadata?.description,
      node.metadata?.responsibility
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
  };
}

export function isOverviewEntity(node) {
  return node?.type === "agent" || ["vector_store", "graph_store", "human_review", "approval-gate"].includes(node?.type);
}

export function normalizeGraph(graph) {
  const nodes = (graph?.nodes || []).map(enrichNode);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const links = (graph?.links || [])
    .map((link) => ({
      ...link,
      source: nodeId(link.source),
      target: nodeId(link.target),
      metadata: { ...(link.metadata || {}) }
    }))
    .filter((link) => nodeById.has(link.source) && nodeById.has(link.target));

  return { metadata: graph?.metadata || {}, nodes, links, nodeById };
}

function clusterKeyFor(node) {
  const project = inferProject(node);
  if (node.agentType === "orchestrator") return `${project}::orchestrators`;
  if (node.agentType === "qagent") return `${project}::qagents`;
  if (node.agentType === "reviewer") return `${project}::reviewers`;
  if (node.agentType === "memory") return `${project}::memory`;
  if (node.agentType === "human") return `${project}::human`;
  if (node.agentType === "worker") return `${project}::${node.domain || node.capability}`;
  return `${project}::${node.capability || node.domain || node.agentType}`;
}

function clusterTitle(node, key) {
  const [, group] = key.split("::");
  if (group === "orchestrators") return `${node.project} Orchestrators`;
  if (group === "qagents") return `${node.project} QAgents`;
  if (group === "reviewers") return `${node.project} Reviewers`;
  if (group === "memory") return `${node.project} Memory`;
  if (group === "human") return `${node.project} Human Review`;
  return `${node.project} · ${humanize(group)}`;
}

export function buildClusters(nodes, links = []) {
  const clusterMap = new Map();
  for (const node of nodes) {
    const key = clusterKeyFor(node);
    if (!clusterMap.has(key)) {
      clusterMap.set(key, {
        id: `cluster:${key}`,
        key,
        kind: "cluster",
        clusterLevel: "capability",
        label: clusterTitle(node, key),
        project: node.project,
        domain: node.domain,
        capability: node.capability,
        agentType: "cluster",
        statusGroup: "idle",
        nodes: [],
        counts: { total: 0, agents: 0, resources: 0, running: 0, warning: 0, failed: 0, waiting: 0, idle: 0 },
        description: ""
      });
    }
    const cluster = clusterMap.get(key);
    cluster.nodes.push(node);
    cluster.counts.total += 1;
    if (node.type === "agent") cluster.counts.agents += 1;
    else cluster.counts.resources += 1;
    cluster.counts[node.statusGroup] = (cluster.counts[node.statusGroup] || 0) + 1;
    if (node.statusGroup === "waiting") cluster.counts.warning += 1;
  }

  for (const cluster of clusterMap.values()) {
    const domains = Array.from(new Set(cluster.nodes.map((node) => humanize(node.domain)).filter(Boolean))).slice(0, 3);
    const types = Array.from(new Set(cluster.nodes.map((node) => humanize(node.agentType)).filter(Boolean))).slice(0, 3);
    cluster.description = `${domains.join(", ") || "System"} capability group with ${types.join(", ") || "agent"} coverage.`;
    cluster.statusGroup = cluster.counts.failed ? "failed" : cluster.counts.warning ? "waiting" : cluster.counts.running ? "running" : "idle";
  }

  const nodeToCluster = new Map();
  for (const cluster of clusterMap.values()) {
    cluster.nodes.forEach((node) => nodeToCluster.set(node.id, cluster.id));
  }

  const clusterLinks = [];
  const seen = new Set();
  for (const link of links) {
    const source = nodeToCluster.get(link.source);
    const target = nodeToCluster.get(link.target);
    if (!source || !target || source === target) continue;
    const key = `${source}->${target}:${relationshipStyle(link).className}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clusterLinks.push({
      id: `cluster-link:${key}`,
      source,
      target,
      type: link.type,
      clusterLink: true,
      style: relationshipStyle(link)
    });
  }

  return {
    clusters: Array.from(clusterMap.values()).sort((a, b) => {
      const severity = { failed: 0, waiting: 1, running: 2, idle: 3 };
      return severity[a.statusGroup] - severity[b.statusGroup] || a.project.localeCompare(b.project) || a.label.localeCompare(b.label);
    }),
    nodeToCluster,
    clusterLinks
  };
}

export function buildProjectClusters(nodes, links = []) {
  const capabilityModel = buildClusters(nodes, links);
  const projectMap = new Map();
  const nodeToProjectCluster = new Map();
  for (const node of nodes) {
    const project = node.project || "Core Platform";
    if (!projectMap.has(project)) {
      projectMap.set(project, {
        id: `project-cluster:${project}`,
        key: project,
        kind: "cluster",
        clusterLevel: "project",
        label: project,
        project,
        domain: "project",
        capability: "system",
        agentType: "cluster",
        statusGroup: "idle",
        nodes: [],
        counts: { total: 0, agents: 0, resources: 0, running: 0, warning: 0, failed: 0, waiting: 0, idle: 0 },
        description: ""
      });
    }
    const cluster = projectMap.get(project);
    cluster.nodes.push(node);
    cluster.counts.total += 1;
    if (node.type === "agent") cluster.counts.agents += 1;
    else cluster.counts.resources += 1;
    cluster.counts[node.statusGroup] = (cluster.counts[node.statusGroup] || 0) + 1;
    if (node.statusGroup === "waiting") cluster.counts.warning += 1;
    nodeToProjectCluster.set(node.id, cluster.id);
  }

  const capabilitiesByProject = new Map();
  for (const capability of capabilityModel.clusters) {
    const projectCluster = projectMap.get(capability.project);
    if (!projectCluster) continue;
    const children = capabilitiesByProject.get(capability.project) || [];
    children.push({ ...capability, clusterParentId: projectCluster.id });
    capabilitiesByProject.set(capability.project, children);
  }

  for (const cluster of projectMap.values()) {
    const capabilities = capabilitiesByProject.get(cluster.project) || [];
    cluster.capabilityClusters = capabilities;
    cluster.description = `${capabilities.length} capability groups across ${cluster.counts.agents} agents${cluster.counts.resources ? ` and ${cluster.counts.resources} system resources` : ""}.`;
    cluster.statusGroup = cluster.counts.failed ? "failed" : cluster.counts.warning ? "waiting" : cluster.counts.running ? "running" : "idle";
  }

  const projectLinks = [];
  const seen = new Set();
  for (const link of links) {
    const source = nodeToProjectCluster.get(link.source);
    const target = nodeToProjectCluster.get(link.target);
    if (!source || !target || source === target) continue;
    const key = `${source}->${target}:${relationshipStyle(link).className}`;
    if (seen.has(key)) continue;
    seen.add(key);
    projectLinks.push({
      id: `project-link:${key}`,
      source,
      target,
      type: link.type,
      clusterLink: true,
      style: relationshipStyle(link)
    });
  }

  const severity = { failed: 0, waiting: 1, running: 2, idle: 3 };
  return {
    clusters: Array.from(projectMap.values()).sort(
      (a, b) => severity[a.statusGroup] - severity[b.statusGroup] || a.label.localeCompare(b.label)
    ),
    projectLinks,
    capabilityModel,
    nodeToProjectCluster
  };
}

export function relationshipStyle(link) {
  const type = String(link?.type || "").toLowerCase();
  if (
    type.includes("memory") ||
    type.includes("data") ||
    type.includes("store") ||
    type.includes("read") ||
    type.includes("write") ||
    type.includes("record") ||
    type.includes("stream") ||
    type.includes("feed") ||
    type.includes("sync")
  ) {
    return { className: "memory", label: "memory/data access", dash: "7 5" };
  }
  if (
    type.includes("optional") ||
    type.includes("infer") ||
    type.includes("observe") ||
    type.includes("reference") ||
    type.startsWith("may_") ||
    type.startsWith("can_") ||
    type.includes("review") ||
    type.includes("validat") ||
    type.includes("detect") ||
    type.includes("signal") ||
    type.includes("gate") ||
    type.includes("require") ||
    type.includes("affect")
  ) {
    return { className: "optional", label: "optional/inferred", dash: "2 6" };
  }
  return { className: "invocation", label: "invocation/delegation", dash: "" };
}

export function applyGraphFilters(model, filters = {}) {
  const search = String(filters.search || "").trim().toLowerCase();
  const project = filters.project || "all";
  const agentType = filters.agentType || "all";
  const status = filters.status || "all";
  const relationshipType = filters.relationshipType || "all";

  let nodes = model.nodes.filter((node) => {
    if (project !== "all" && node.project !== project) return false;
    if (agentType !== "all" && node.agentType !== agentType) return false;
    if (status !== "all" && node.statusGroup !== status) return false;
    if (search && !node.searchable.includes(search)) return false;
    return true;
  });

  const visibleIds = new Set(nodes.map((node) => node.id));
  let links = model.links.filter((link) => visibleIds.has(link.source) && visibleIds.has(link.target));
  if (relationshipType !== "all") {
    links = links.filter((link) => relationshipStyle(link).className === relationshipType || link.type === relationshipType);
    const linkedIds = new Set(links.flatMap((link) => [link.source, link.target]));
    nodes = nodes.filter((node) => linkedIds.has(node.id));
  }

  return { nodes, links };
}

export function focusNeighborhood(model, selectedId, depth = 1) {
  if (!selectedId || !model.nodeById.has(selectedId)) {
    return { ids: new Set(), upstream: new Set(), downstream: new Set(), links: [], breadcrumb: [] };
  }
  const maxDepth = Math.max(1, Math.min(2, Number(depth) || 1));
  const ids = new Set([selectedId]);
  const upstream = new Set();
  const downstream = new Set();
  const focusLinks = [];
  const frontier = [{ id: selectedId, distance: 0 }];
  const visitedDistance = new Map([[selectedId, 0]]);

  while (frontier.length) {
    const current = frontier.shift();
    if (current.distance >= maxDepth) continue;
    for (const link of model.links) {
      let nextId = "";
      let direction = "";
      if (link.source === current.id) {
        nextId = link.target;
        direction = "downstream";
      } else if (link.target === current.id) {
        nextId = link.source;
        direction = "upstream";
      }
      if (!nextId) continue;
      ids.add(nextId);
      focusLinks.push(link);
      if (direction === "downstream") downstream.add(nextId);
      if (direction === "upstream") upstream.add(nextId);
      const nextDistance = current.distance + 1;
      if (!visitedDistance.has(nextId) || visitedDistance.get(nextId) > nextDistance) {
        visitedDistance.set(nextId, nextDistance);
        frontier.push({ id: nextId, distance: nextDistance });
      }
    }
  }

  const selected = model.nodeById.get(selectedId);
  const breadcrumb = [selected.project, humanize(selected.domain), selected.label].filter(Boolean);
  return { ids, upstream, downstream, links: focusLinks, breadcrumb };
}

export function preserveSelectionThroughFilters(model, selectedId, filters = {}) {
  if (!selectedId || !model.nodeById.has(selectedId)) return "";
  const filtered = applyGraphFilters(model, filters);
  if (filtered.nodes.some((node) => node.id === selectedId)) return selectedId;
  return selectedId;
}

export function storageKey(project, viewMode) {
  return `agentic-system-layout:${project || "all"}:${viewMode || "overview"}`;
}

export function loadPositions(storage, project, viewMode) {
  if (!storage?.getItem) return new Map();
  try {
    const saved = JSON.parse(storage.getItem(storageKey(project, viewMode)) || "{}");
    return new Map(Object.entries(saved).filter(([, value]) => Number.isFinite(value?.x) && Number.isFinite(value?.y)));
  } catch {
    return new Map();
  }
}

export function savePositions(storage, project, viewMode, items) {
  if (!storage?.setItem) return;
  const payload = {};
  for (const item of items) {
    if (Number.isFinite(item.x) && Number.isFinite(item.y)) payload[item.id] = { x: Math.round(item.x), y: Math.round(item.y) };
  }
  storage.setItem(storageKey(project, viewMode), JSON.stringify(payload));
}

export function applySavedPositions(items, savedPositions) {
  return items.map((item) => {
    const saved = savedPositions?.get(item.id);
    return saved ? { ...item, x: saved.x, y: saved.y, saved: true } : item;
  });
}

export function stableGridLayout(items, width = 1200, height = 760, options = {}) {
  const columns = options.columns || Math.max(1, Math.ceil(Math.sqrt(items.length || 1)));
  const gapX = Math.max(options.minGapX || 220, width / (columns + 0.5));
  const rows = Math.max(1, Math.ceil((items.length || 1) / columns));
  const gapY = Math.max(options.minGapY || 150, height / (rows + 0.5));
  const sorted = [...items].sort((a, b) => String(a.project || "").localeCompare(String(b.project || "")) || a.label.localeCompare(b.label));
  return sorted.map((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      ...item,
      x: (options.startX ?? 120) + column * gapX,
      y: (options.startY ?? 110) + row * gapY
    };
  });
}

export function createOverviewLayout(items, width = 1200, height = 760) {
  const clusters = items.filter((item) => item.kind === "cluster" && !item.clusterParentId);
  const descendants = items.filter((item) => item.clusterParentId);
  const columns = Math.max(2, Math.min(6, Math.floor(width / 225)));
  const clusterLayout = stableGridLayout(clusters, width, height, {
    columns,
    minGapX: 220,
    minGapY: 138,
    startX: 120,
    startY: 82
  });
  const positioned = new Map(clusterLayout.map((cluster) => [cluster.id, cluster]));
  const siblingsByParent = new Map();
  descendants.forEach((child) => {
    const siblings = siblingsByParent.get(child.clusterParentId) || [];
    siblings.push(child);
    siblingsByParent.set(child.clusterParentId, siblings);
  });
  const unresolved = [...descendants];
  let passes = 0;
  while (unresolved.length && passes < 4) {
    passes += 1;
    for (let index = unresolved.length - 1; index >= 0; index -= 1) {
      const child = unresolved[index];
      const parent = positioned.get(child.clusterParentId);
      if (!parent) continue;
      const siblings = siblingsByParent.get(child.clusterParentId) || [];
      const siblingIndex = siblings.findIndex((item) => item.id === child.id);
      const angle = -Math.PI / 2 + (Math.PI * 2 * siblingIndex) / Math.max(1, siblings.length);
      const radius = child.kind === "cluster" ? (siblings.length > 5 ? 154 : 132) : siblings.length > 6 ? 118 : 96;
      positioned.set(child.id, { ...child, x: parent.x + Math.cos(angle) * radius, y: parent.y + Math.sin(angle) * radius });
      unresolved.splice(index, 1);
    }
  }
  unresolved.forEach((item) => positioned.set(item.id, item));
  return items.map((item) => positioned.get(item.id) || item);
}

export function layoutNodeRadius(item = {}) {
  if (item.type === "project" || item.agentType === "project" || item.clusterLevel === "project") return 122;
  if (item.kind === "cluster") return item.clusterLevel === "project" ? 118 : 108;
  if (item.agentType === "orchestrator") return 96;
  if (item.agentType === "qagent" || item.agentType === "reviewer" || item.agentType === "memory") return 92;
  return 88;
}

function resolveLayoutOverlaps(items, { fixedIds = new Set(), padding = 16, iterations = 72 } = {}) {
  const positioned = items.map((item) => ({ ...item }));
  for (let pass = 0; pass < iterations; pass += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < positioned.length; leftIndex += 1) {
      const left = positioned[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < positioned.length; rightIndex += 1) {
        const right = positioned[rightIndex];
        const minDistance = layoutNodeRadius(left) + layoutNodeRadius(right) + padding;
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= minDistance) continue;
        if (!distance) {
          const angle = ((leftIndex * 97 + rightIndex * 53) % 360) * (Math.PI / 180);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const overlap = (minDistance - distance) / distance;
        const leftFixed = fixedIds.has(left.id);
        const rightFixed = fixedIds.has(right.id);
        if (leftFixed && rightFixed) continue;
        const leftWeight = leftFixed ? 0 : rightFixed ? 1 : 0.5;
        const rightWeight = rightFixed ? 0 : leftFixed ? 1 : 0.5;
        left.x -= dx * overlap * leftWeight;
        left.y -= dy * overlap * leftWeight;
        right.x += dx * overlap * rightWeight;
        right.y += dy * overlap * rightWeight;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return positioned;
}

function projectGroupsForExplore(items = []) {
  const groups = new Map();
  for (const item of items) {
    const project = item.project || "Core Platform";
    const group = groups.get(project) || { project, nodes: [] };
    group.nodes.push(item);
    groups.set(project, group);
  }
  return Array.from(groups.values()).sort((left, right) => left.project.localeCompare(right.project));
}

export function createExploreLayout(items, links, width = 1200, height = 760) {
  if (!items.length) return items;
  const densityScale = Math.max(1, Math.sqrt(items.length / 36));
  const projectGroups = projectGroupsForExplore(items);
  const largestProject = Math.max(1, ...projectGroups.map((group) => group.nodes.length));
  const extentScale = Math.min(4.8, 1.45 + densityScale * 0.68 + Math.sqrt(projectGroups.length) * 0.18);
  const virtualWidth = Math.max(width, Math.min(5600, width * extentScale));
  const virtualHeight = Math.max(height, Math.min(4600, height * extentScale));
  const nodeById = new Map(items.map((item) => [item.id, item]));
  const degree = new Map(items.map((item) => [item.id, 0]));
  links.forEach((link) => {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    if (!nodeById.has(source) || !nodeById.has(target)) return;
    degree.set(source, (degree.get(source) || 0) + 1);
    degree.set(target, (degree.get(target) || 0) + 1);
  });
  const positioned = new Map();
  const fixedIds = new Set();
  const columns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(projectGroups.length))));
  const rows = Math.max(1, Math.ceil(projectGroups.length / columns));
  const projectGapX = Math.max(620, virtualWidth / (columns + 0.35), Math.sqrt(largestProject) * 225);
  const projectGapY = Math.max(520, virtualHeight / (rows + 0.35), Math.sqrt(largestProject) * 210);
  const startX = Math.max(260, (virtualWidth - (columns - 1) * projectGapX) / 2);
  const startY = Math.max(250, (virtualHeight - (rows - 1) * projectGapY) / 2);

  projectGroups.forEach((group, groupIndex) => {
    const column = groupIndex % columns;
    const row = Math.floor(groupIndex / columns);
    const clusterCenterX = startX + column * projectGapX;
    const clusterCenterY = startY + row * projectGapY;
    const projectNode =
      group.nodes.find((item) => item.type === "project" || item.agentType === "project") ||
      group.nodes
        .slice()
        .sort((left, right) => {
          const typeScore = (item) => item.agentType === "orchestrator" ? 2 : item.agentType === "reviewer" ? 1 : 0;
          return typeScore(right) - typeScore(left) || (degree.get(right.id) || 0) - (degree.get(left.id) || 0) || left.label.localeCompare(right.label);
        })[0];
    positioned.set(projectNode.id, {
      ...projectNode,
      orbitAnchor: true,
      projectClusterCenter: true,
      x: clusterCenterX,
      y: clusterCenterY
    });
    fixedIds.add(projectNode.id);

    const children = group.nodes
      .filter((item) => item.id !== projectNode.id)
      .sort(
        (left, right) =>
          String(left.agentType || left.type || "").localeCompare(String(right.agentType || right.type || "")) ||
          (degree.get(right.id) || 0) - (degree.get(left.id) || 0) ||
          left.label.localeCompare(right.label)
      );
    const nodesPerRing = Math.max(6, Math.min(12, Math.ceil(Math.sqrt(children.length || 1) * 2.4)));
    children.forEach((child, index) => {
      const ring = Math.floor(index / nodesPerRing);
      const ringIndex = index % nodesPerRing;
      const ringSize = Math.min(nodesPerRing, children.length - ring * nodesPerRing);
      const angleOffset = ring % 2 ? Math.PI / Math.max(1, ringSize) : 0;
      const angle = -Math.PI / 2 + angleOffset + (Math.PI * 2 * ringIndex) / Math.max(1, ringSize);
      const typeOffset = child.agentType === "memory" || child.type?.includes("store") ? 52 : child.agentType === "reviewer" ? 28 : 0;
      const radius = 330 + ring * 240 + typeOffset;
      positioned.set(child.id, {
        ...child,
        orbitParentId: projectNode.id,
        projectClusterCenterId: projectNode.id,
        x: clusterCenterX + Math.cos(angle) * radius,
        y: clusterCenterY + Math.sin(angle) * radius
      });
    });
  });

  return resolveLayoutOverlaps(
    items.map((item) => positioned.get(item.id) || item),
    { fixedIds, padding: 24, iterations: 120 }
  );
}

export function createDagreLayout(items, links, width = 1200, height = 760, dagreApi) {
  if (!dagreApi?.graphlib?.Graph) return stableGridLayout(items, width, height);
  const graph = new dagreApi.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", ranksep: 110, nodesep: 70, marginx: 40, marginy: 40 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const item of items) {
    const isCluster = item.kind === "cluster";
    graph.setNode(item.id, { width: isCluster ? 190 : 120, height: isCluster ? 96 : 80 });
  }
  for (const link of links) {
    if (graph.hasNode(link.source) && graph.hasNode(link.target)) graph.setEdge(link.source, link.target);
  }
  dagreApi.layout(graph);
  const laidOut = items.map((item) => {
    const position = graph.node(item.id) || {};
    return { ...item, x: position.x || width / 2, y: position.y || height / 2 };
  });
  const bounds = laidOut.reduce(
    (acc, item) => ({
      minX: Math.min(acc.minX, item.x),
      maxX: Math.max(acc.maxX, item.x),
      minY: Math.min(acc.minY, item.y),
      maxY: Math.max(acc.maxY, item.y)
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  const offsetX = Math.max(80, (width - (bounds.maxX - bounds.minX)) / 2) - bounds.minX;
  const offsetY = Math.max(80, (height - (bounds.maxY - bounds.minY)) / 2) - bounds.minY;
  return laidOut.map((item) => ({ ...item, x: item.x + offsetX, y: item.y + offsetY }));
}

export function selectRenderStrategy({ nodeCount = 0, linkCount = 0, lastFrameMs = 0 } = {}) {
  const graphObjectCount = nodeCount + linkCount;
  const progressive = nodeCount > 180 || graphObjectCount > 320;
  const canvasEdges =
    linkCount > 260 ||
    graphObjectCount > 650 ||
    (lastFrameMs > 32 && linkCount > 120);
  return {
    mode: canvasEdges ? (progressive ? "progressive-hybrid" : "hybrid-canvas") : progressive ? "progressive-svg" : "svg",
    progressive,
    canvasEdges,
    frameBudgetMs: 32,
    initialNodeLimit: progressive ? 140 : nodeCount,
    batchSize: 100
  };
}

export function visibleGraphForState(model, state, width = 1200, height = 760, dagreApi) {
  const filtered = applyGraphFilters(model, state.filters);
  const overviewNodes = filtered.nodes.filter(isOverviewEntity);
  const overviewIds = new Set(overviewNodes.map((node) => node.id));
  const overviewLinks = filtered.links.filter((link) => overviewIds.has(link.source) && overviewIds.has(link.target));
  const projectModel = buildProjectClusters(overviewNodes, overviewLinks);
  const clustersModel = projectModel.capabilityModel;
  const expanded = state.expandedClusters || new Set();
  const selectedId = preserveSelectionThroughFilters(model, state.selectedId, state.filters);
  const focus = focusNeighborhood(model, selectedId, state.depth);
  const viewMode = state.viewMode || "overview";
  let items = [];
  let links = [];
  let hiddenClusterCount = 0;

  if (viewMode === "overview") {
    items = projectModel.clusters.flatMap((projectCluster) => {
      if (!expanded.has(projectCluster.id)) return [projectCluster];
      const capabilities = projectCluster.capabilityClusters || [];
      return [
        projectCluster,
        ...capabilities.flatMap((capability) => {
          if (!expanded.has(capability.id)) return [capability];
          return [capability, ...capability.nodes.map((node) => ({ ...node, clusterParentId: capability.id }))];
        })
      ];
    });
    const ids = new Set(items.map((item) => item.id));
    const hierarchyLinks = items
      .filter((item) => item.clusterParentId && ids.has(item.clusterParentId))
      .map((item) => ({
        id: `hierarchy:${item.clusterParentId}->${item.id}`,
        source: item.clusterParentId,
        target: item.id,
        type: "contains",
        clusterLink: true
      }));
    links = [
      ...projectModel.projectLinks,
      ...hierarchyLinks,
      ...filtered.links.filter((link) => ids.has(link.source) && ids.has(link.target))
    ].filter((link) => ids.has(link.source) && ids.has(link.target));
    if (!expanded.size && !selectedId) {
      hiddenClusterCount = Math.max(0, items.length - 24);
      items = items.slice(0, 24);
      const kept = new Set(items.map((item) => item.id));
      links = links.filter((link) => kept.has(link.source) && kept.has(link.target));
    }
  } else {
    items = filtered.nodes;
    links = filtered.links;
    if (viewMode === "live") {
      items = items.filter((node) => node.hasRuntimeSignal && node.statusGroup !== "idle");
      const ids = new Set(items.map((item) => item.id));
      links = links.filter((link) => ids.has(link.source) && ids.has(link.target));
    }
    if (selectedId && focus.ids.size) {
      items = items.filter((node) => focus.ids.has(node.id) || node.id === selectedId);
      const ids = new Set(items.map((item) => item.id));
      links = links.filter((link) => ids.has(link.source) && ids.has(link.target));
    }
  }

  const saved = loadPositions(state.storage, state.filters?.project || "all", viewMode);
  const layoutLinks = links.map((link) => ({ ...link, source: nodeId(link.source), target: nodeId(link.target) }));
  const laidOut =
    viewMode === "overview"
      ? createOverviewLayout(items, width, height)
      : viewMode === "explore"
      ? createExploreLayout(items, layoutLinks, width, height)
      : createDagreLayout(items, layoutLinks, width, height, dagreApi);
  items = viewMode === "explore" ? laidOut : applySavedPositions(laidOut, saved);

  return { items, links: layoutLinks, clusters: projectModel.clusters, focus, selectedId, hiddenClusterCount };
}
