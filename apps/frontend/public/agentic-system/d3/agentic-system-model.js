export const VIEW_MODES = {
  overview: "System Overview",
  dependency: "Dependency View",
  flow: "Functionality Flow",
  explore: "Explore"
};

/**
 * One registry drives the visual identity used by every lens.  A node's
 * runtime status is intentionally not encoded here: it is shown by the
 * status dot, leaving shape and icon free to communicate what the node is.
 */
export const NODE_TYPE_REGISTRY = Object.freeze({
  project: { label: "Project", shape: "folder", icon: "folder-kanban" },
  cluster: { label: "Capability group", shape: "cluster", icon: "layers-3" },
  capability: { label: "Capability group", shape: "cluster", icon: "layers-3" },
  orchestrator: { label: "Orchestrator", shape: "rounded", icon: "route" },
  worker: { label: "Worker agent", shape: "circle", icon: "bot" },
  qagent: { label: "QAgent", shape: "diamond", icon: "sparkles" },
  reviewer: { label: "Reviewer", shape: "shield", icon: "shield-check" },
  human: { label: "Human review", shape: "person", icon: "user-round-check" },
  memory: { label: "Memory / database", shape: "database", icon: "database" },
  database: { label: "Database", shape: "database", icon: "database" },
  service: { label: "Service", shape: "service", icon: "server-cog" },
  api: { label: "API", shape: "hexagon", icon: "braces" },
  functionality: { label: "Functionality", shape: "hexagon", icon: "blocks" },
  subfunctionality: { label: "Subfunctionality", shape: "hexagon", icon: "git-fork" },
  feature: { label: "Feature", shape: "hexagon", icon: "puzzle" },
  ui_element: { label: "UI element", shape: "circle", icon: "mouse-pointer-click" },
  workflow: { label: "Workflow", shape: "flow", icon: "git-branch" },
  page: { label: "Page", shape: "panel", icon: "panel-top" },
  validation: { label: "Validation", shape: "shield", icon: "badge-check" },
  branch: { label: "Architecture branch", shape: "chevron", icon: "git-branch" },
  architectureCategory: { label: "Architecture category", shape: "cluster", icon: "layers-2" },
  architectureBranchSummary: { label: "Architecture summary", shape: "chevron", icon: "git-branch" },
  deadBranchSummary: { label: "Retired branch summary", shape: "chevron", icon: "archive" },
  investigation: { label: "Investigation", shape: "panel", icon: "search-check" },
  knowledge: { label: "Knowledge", shape: "database", icon: "book-open-check" },
  milestone: { label: "Milestone", shape: "diamond", icon: "milestone" },
  "approval-gate": { label: "Approval gate", shape: "shield", icon: "gate" },
  "monetary-approval": { label: "Budget approval", shape: "shield", icon: "badge-dollar-sign" },
  objective: { label: "Objective", shape: "panel", icon: "target" },
  pattern: { label: "Pattern", shape: "panel", icon: "wand-sparkles" },
  promotion: { label: "Promotion", shape: "chevron", icon: "rocket" },
  proposal: { label: "Proposal", shape: "panel", icon: "file-text" },
  "research-budget": { label: "Research budget", shape: "database", icon: "wallet-cards" },
  system: { label: "System", shape: "rounded", icon: "network" },
  "tool-plan": { label: "Tool plan", shape: "panel", icon: "wrench" },
  artifact: { label: "Artifact", shape: "circle", icon: "box" }
});

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
  const text = String(value || "Unnamed").replace(/\b(agent|project|system|plutomix)\b/gi, "").replace(/\s+/g, " ").trim() || String(value || "Unnamed");
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
  if (node?.type === "application_functionality") return "functionality";
  if (node?.type === "application_subfunctionality") return "subfunctionality";
  if (node?.type === "branch") return "branch";
  if (node?.type === "architecture_category") return "architectureCategory";
  if (node?.type === "architecture_branch_summary") return node?.metadata?.disabled ? "deadBranchSummary" : "architectureBranchSummary";
  if (node?.type === "database") return "database";
  if (node?.type === "vector_store" || node?.type === "graph_store" || haystack.includes("memory") || haystack.includes("database")) return "memory";
  if (node?.type === "human_review" || haystack.includes("human")) return "human";
  // QAgents are their own visual role: they remain reviewers functionally, but must not blend into standard review nodes.
  if (node?.type === "agent" && haystack.includes("qagent")) return "qagent";
  if (node?.type === "agent" && (node?.metadata?.supportAgent || haystack.includes("review"))) return "reviewer";
  if (node?.type === "agent" && (haystack.includes("orchestrator") || haystack.includes("global-plutomix"))) return "orchestrator";
  if (node?.type === "agent") return "worker";
  if (node?.type === "cluster") return "capability";
  if (["service", "api", "page", "ui_element", "workflow", "feature", "validation", "database"].includes(node?.type)) return node.type;
  return node?.type || "artifact";
}

export function nodeVisualType(node = {}) {
  const candidate = node?.clusterLevel === "project"
    ? "project"
    : node?.kind === "cluster"
      ? "cluster"
      : node?.agentType || inferAgentType(node);
  return NODE_TYPE_REGISTRY[candidate] ? candidate : "artifact";
}

export function nodeTypeLabel(node = {}) {
  return NODE_TYPE_REGISTRY[nodeVisualType(node)]?.label || "Artifact";
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

export function buildArchitectureBranchModel(nodes = [], links = []) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const functionalityIds = new Set(nodes.filter((node) => node.type === "application_functionality").map((node) => node.id));
  const selectedIds = new Set(
    nodes
      .filter((node) => ["project", "application_functionality", "application_subfunctionality", "branch"].includes(node.type))
      .map((node) => node.id)
  );

  for (const link of links) {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    if (!functionalityIds.has(target)) continue;
    if (String(link.type || "").toLowerCase() === "implements" && nodeById.get(source)?.type === "agent") {
      selectedIds.add(source);
    }
    if (String(link.type || "").toLowerCase() === "contains_functionality" && nodeById.get(source)?.type === "project") {
      selectedIds.add(source);
    }
  }

  const architectureNodes = nodes.filter((node) => selectedIds.has(node.id));
  const architectureIds = new Set(architectureNodes.map((node) => node.id));
  return {
    nodes: architectureNodes,
    links: links.filter((link) => architectureIds.has(nodeId(link.source)) && architectureIds.has(nodeId(link.target)))
  };
}

const TERMINAL_BRANCH_STATUSES = new Set(["rejected", "superseded", "archived", "retired", "disabled", "dead", "abandoned", "expired", "withdrawn"]);

function titleCase(value = "") {
  return String(value || "other")
    .replaceAll(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function branchSummaryBucket(branch = {}) {
  const inferenceRole = branch.metadata?.inferenceRole || branch.inferenceRole;
  const status = String(branch.status || "candidate").toLowerCase();
  if (TERMINAL_BRANCH_STATUSES.has(status)) return "disabled";
  if (inferenceRole === "observed_current") return "observed";
  return "candidate";
}

export function isSourceBackedApplicationEntity(node = {}) {
  return Boolean(node?.metadata?.applicationTopology)
    && ["feature", "page", "ui_element", "api", "service", "database"].includes(node.type);
}

function sourceBackedArchitectureZone(node = {}) {
  if (node.type === "page") return { key: "ui", label: "Pages", priority: 0 };
  if (node.type === "ui_element") return { key: "ui-element", label: "UI elements", priority: 1 };
  if (node.type === "feature") return { key: "feature", label: "Interaction features", priority: 2 };
  if (node.type === "api") return { key: "api", label: "API routes", priority: 3 };
  if (node.type === "service") return { key: "service", label: "Services & cloud functions", priority: 4 };
  return { key: "data", label: "Database connections", priority: 5 };
}

function sourceBackedEvidenceCount(node = {}) {
  return Array.isArray(node.metadata?.evidence) ? node.metadata.evidence.length : 0;
}

/**
 * Projects source-backed application entities without inventing a generic
 * “functionality” layer. Project membership scopes the view but is not itself
 * rendered as a feature; only source-backed application relationships appear.
 */
function buildSourceBackedApplicationArchitecture(nodes = [], links = []) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const entities = nodes.filter(isSourceBackedApplicationEntity);
  const entityIds = new Set(entities.map((node) => node.id));
  const projectForEntity = new Map();
  const ownerIdsByEntity = new Map();
  const incomingByEntity = new Map();
  const connectorCountByEntity = new Map(entities.map((entity) => [entity.id, 0]));
  for (const link of links) {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    const type = String(link.type || "").toLowerCase();
    if (type === "contains_application_entity" && entityIds.has(target)) projectForEntity.set(target, source);
    if (type === "implements" && entityIds.has(target) && nodeById.get(source)?.type === "agent") {
      const owners = ownerIdsByEntity.get(target) || new Set();
      owners.add(source);
      ownerIdsByEntity.set(target, owners);
    }
    if (entityIds.has(source) && entityIds.has(target)) {
      const incoming = incomingByEntity.get(target) || [];
      incoming.push({ source, type, hierarchy: Boolean(link.metadata?.hierarchy) });
      incomingByEntity.set(target, incoming);
      connectorCountByEntity.set(source, (connectorCountByEntity.get(source) || 0) + 1);
      connectorCountByEntity.set(target, (connectorCountByEntity.get(target) || 0) + 1);
    }
  }
  const hierarchyPriority = { contains_subpage: 0, contains_feature: 1, contains_ui_element: 2, has_ui_feature: 3, ui_calls_api: 4, api_calls_service: 5, ui_uses_service: 5.5, service_uses_service: 5.75, service_uses_database: 6, api_uses_database: 6, database_contains_table: 7 };
  const primaryParentByEntity = new Map();
  for (const entity of entities) {
    const explicitParent = entity.metadata?.parentEntityNodeId;
    if (explicitParent && entityIds.has(explicitParent)) {
      primaryParentByEntity.set(entity.id, explicitParent);
      continue;
    }
    const parent = (incomingByEntity.get(entity.id) || []).slice().sort((left, right) =>
      Number(right.hierarchy) - Number(left.hierarchy)
      || (hierarchyPriority[left.type] ?? 99) - (hierarchyPriority[right.type] ?? 99)
      || Number(nodeById.get(left.source)?.metadata?.chronologyOrder ?? 999999) - Number(nodeById.get(right.source)?.metadata?.chronologyOrder ?? 999999)
      || left.source.localeCompare(right.source))[0];
    if (parent) primaryParentByEntity.set(entity.id, parent.source);
  }
  const depthMemo = new Map();
  const hierarchyDepth = (entityId, visited = new Set()) => {
    if (depthMemo.has(entityId)) return depthMemo.get(entityId);
    const parentId = primaryParentByEntity.get(entityId);
    if (!parentId || visited.has(entityId)) return 1;
    visited.add(entityId);
    const depth = 1 + hierarchyDepth(parentId, visited);
    depthMemo.set(entityId, depth);
    return depth;
  };
  const projects = new Map();
  const ensureProject = (projectId, entity) => {
    const candidate = nodeById.get(projectId)
      || nodes.find((node) => node.type === "project" && (node.metadata?.projectId === entity.metadata?.projectId || node.id === entity.metadata?.projectId));
    const root = candidate || enrichNode({
      id: `project:${entity.metadata?.projectId || "application"}`,
      type: "project",
      label: entity.metadata?.projectName || entity.metadata?.projectId || "Application project",
      metadata: { projectId: entity.metadata?.projectId, projectName: entity.metadata?.projectName }
    });
    if (!projects.has(root.id)) projects.set(root.id, { root, entities: [], owners: new Set() });
    return projects.get(root.id);
  };

  const projectedEntities = entities.slice().sort((left, right) =>
    Number(left.metadata?.chronologyOrder ?? 999999) - Number(right.metadata?.chronologyOrder ?? 999999)
    || String(left.metadata?.sourceReference || left.label).localeCompare(String(right.metadata?.sourceReference || right.label)))
    .map((entity) => {
    const projectRow = ensureProject(projectForEntity.get(entity.id), entity);
    const zone = sourceBackedArchitectureZone(entity);
    const ownerIds = [...(ownerIdsByEntity.get(entity.id) || new Set())];
    const assignedAgents = ownerIds.map((id) => nodeById.get(id)).filter(Boolean).map((agent) => ({
      id: agent.id,
      name: agent.label,
      role: agent.metadata?.role || agent.domain || "implementation"
    }));
    const evidenceCount = sourceBackedEvidenceCount(entity);
    const sourceHints = entity.metadata?.sourceHints || {};
    const sourceReference = entity.metadata?.evidence?.[0]?.reference || sourceHints.ui?.sourcePath || sourceHints.route?.sourcePath || sourceHints.database?.sourcePath || "cited source";
    const entityLabel = entity.type === "page"
      ? "Page"
      : entity.type === "ui_element"
        ? "UI element"
        : entity.type === "feature"
          ? "Interaction feature"
          : entity.type === "api"
            ? "API route"
            : entity.type === "service"
              ? "Service / cloud function"
              : "Database connection";
    const connectorCount = connectorCountByEntity.get(entity.id) || Number(entity.metadata?.metrics?.connectorCount || 0);
    const childFeatureCount = [...primaryParentByEntity.values()].filter((parentId) => parentId === entity.id).length;
    const projected = enrichNode({
      ...entity,
      metadata: {
        ...(entity.metadata || {}),
        architectureLens: true,
        architectureLevel: hierarchyDepth(entity.id),
        projectId: entity.metadata?.projectId || projectRow.root.metadata?.projectId || projectRow.root.id,
        projectRootId: projectRow.root.id,
        architectureZone: zone.key,
        architectureZoneLabel: zone.label,
        surfaceKey: `${zone.key}:${sourceReference}`,
        surfaceLabel: zone.label,
        surfaceFunctionalityCount: 1,
        interactionPriority: zone.priority,
        applicationEntityLabel: entityLabel,
        parentFeatureId: primaryParentByEntity.get(entity.id) || "",
        childFeatureCount,
        connectorCount,
        chronologyOrder: Number(entity.metadata?.chronologyOrder ?? 0),
        chronologyBasis: entity.metadata?.chronologyBasis || "source_modified_at_then_stable_source_order",
        functionalityCount: 1,
        functionalityIds: [entity.id],
        functionalityDetails: [{ id: entity.id, label: entity.label, category: zone.key, description: entity.metadata?.observedCurrent?.description || entity.metadata?.description || `${entityLabel} recorded from source.`, evidenceCount }],
        assignedAgents,
        implementingAgentCount: assignedAgents.length,
        subfunctionalityCount: 0,
        branchCount: 0,
        evidenceCount,
        complexity: Math.min(1, 0.22 + evidenceCount * 0.08 + assignedAgents.length * 0.06 + connectorCount * 0.08 + Number(entity.metadata?.relativeCyclomaticComplexity || 0) * 0.45),
        sourceReference,
        description: entity.metadata?.observedCurrent?.description || entity.metadata?.description || `${entityLabel} recorded from ${sourceReference}.`
      }
    });
    projectRow.entities.push(projected);
    ownerIds.forEach((id) => projectRow.owners.add(id));
    return projected;
  });
  const projectedIds = new Set(projectedEntities.map((node) => node.id));
  const ownerEntityIds = new Map();
  for (const [entityId, ownerIds] of ownerIdsByEntity) {
    for (const ownerId of ownerIds) {
      const assigned = ownerEntityIds.get(ownerId) || [];
      assigned.push(entityId);
      ownerEntityIds.set(ownerId, assigned);
    }
  }
  const projectedAgents = [...ownerEntityIds.entries()].map(([ownerId, assignedEntityIds]) => {
    const agent = nodeById.get(ownerId);
    if (!agent) return null;
    const assignedEntities = assignedEntityIds.map((id) => nodeById.get(id)).filter(Boolean);
    const projectIds = [...new Set(assignedEntities.map((entity) => entity.metadata?.projectId).filter(Boolean))];
    const assignmentScope = projectIds.length > 1 ? "shared" : "project-exclusive";
    return enrichNode({
      ...agent,
      metadata: {
        ...(agent.metadata || {}),
        architectureLens: true,
        architectureZone: "agents",
        architectureZoneLabel: "Assigned agents",
        projectId: projectIds.length === 1 ? projectIds[0] : "shared-agents",
        assignmentScope,
        assignedProjectIds: projectIds,
        assignedFunctionalityCount: assignedEntityIds.length,
        functionalityCount: assignedEntityIds.length,
        functionalityIds: assignedEntityIds,
        functionalityDetails: assignedEntities.map((entity) => ({
          id: entity.id,
          label: entity.label,
          category: entity.metadata?.category || entity.type,
          description: `Agent assignment to ${entity.label}.`,
          evidenceCount: sourceBackedEvidenceCount(entity)
        })),
        connectorCount: assignedEntityIds.length,
        complexity: Math.min(1, 0.2 + Math.log2(assignedEntityIds.length + 1) * 0.18),
        description: agent.metadata?.description || agent.metadata?.responsibility || `${agent.label} acts on ${assignedEntityIds.length} architecture node${assignedEntityIds.length === 1 ? "" : "s"}.`
      }
    });
  }).filter(Boolean);
  const architectureNodeIds = new Set([...projectedIds, ...projectedAgents.map((agent) => agent.id)]);
  const architectureLinks = links
    .filter((link) => {
      const source = nodeId(link.source);
      const target = nodeId(link.target);
      const implementationLink = String(link.type || "").toLowerCase() === "implements"
        && ownerEntityIds.has(source)
        && projectedIds.has(target);
      return (projectedIds.has(source) && projectedIds.has(target)) || implementationLink;
    })
    .map((link) => {
      const source = nodeId(link.source);
      const target = nodeId(link.target);
      return {
        ...link,
        source,
        target,
        metadata: {
          ...(link.metadata || {}),
          architectureLens: true,
          sourceBacked: true,
          hierarchy: projectedIds.has(source) && primaryParentByEntity.get(target) === source,
          agentOwnership: ownerEntityIds.has(source) && projectedIds.has(target)
        }
      };
    });
  return {
    nodes: [...projectedEntities, ...projectedAgents].filter((node) => architectureNodeIds.has(node.id)),
    links: architectureLinks
  };
}

/**
 * Builds a presentation-only architecture tree from the source topology.
 * Unlike the ledger summary, this intentionally keeps each discovered
 * functionality and each branch as a separate node so their relationships are
 * visible in the canvas. It never converts an observed branch into a claim of
 * historical selection.
 */
export function buildArchitectureBranchSummary(nodes = [], links = [], _options = {}) {
  if (nodes.some(isSourceBackedApplicationEntity)) return buildSourceBackedApplicationArchitecture(nodes, links);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const functionalities = nodes.filter((node) => node.type === "application_functionality");
  const subfunctionalities = nodes.filter((node) => node.type === "application_subfunctionality");
  const branches = nodes.filter((node) => node.type === "branch");
  const branchesByFunctionality = new Map();
  const subfunctionalitiesByParent = new Map();
  const branchesBySubfunctionality = new Map();
  const projectByFunctionality = new Map();
  const ownerIdsByFunctionality = new Map();
  const linkedBranchIds = new Set();

  for (const subfunctionality of subfunctionalities) {
    const parentId = String(subfunctionality.metadata?.parentFunctionalityId || "");
    const rows = subfunctionalitiesByParent.get(parentId) || [];
    rows.push(subfunctionality);
    subfunctionalitiesByParent.set(parentId, rows);
  }

  for (const link of links) {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    if (String(link.type || "").toLowerCase() === "has_architecture_branch") {
      const rows = branchesByFunctionality.get(source) || [];
      const branch = nodeById.get(target);
      if (branch?.type === "branch") {
        rows.push(branch);
        linkedBranchIds.add(branch.id);
      }
      branchesByFunctionality.set(source, rows);
    }
    if (String(link.type || "").toLowerCase() === "supports_architecture_branch") {
      const rows = branchesBySubfunctionality.get(source) || [];
      const branch = nodeById.get(target);
      if (branch?.type === "branch") {
        rows.push(branch);
        linkedBranchIds.add(branch.id);
      }
      branchesBySubfunctionality.set(source, rows);
    }
    if (String(link.type || "").toLowerCase() === "contains_functionality") {
      projectByFunctionality.set(target, source);
    }
    if (String(link.type || "").toLowerCase() === "implements") {
      const owners = ownerIdsByFunctionality.get(target) || new Set();
      if (nodeById.get(source)?.type === "agent") owners.add(source);
      ownerIdsByFunctionality.set(target, owners);
    }
  }

  const resolveProject = (projectId, projectName) =>
    nodeById.get(projectId) ||
    nodes.find(
      (node) =>
        node.type === "project" &&
        (node.metadata?.projectId === projectId || node.id === projectId || (projectName && node.label === projectName))
    ) ||
    null;
  const evidenceCountFor = (node) => {
    if (Array.isArray(node?.metadata?.evidence)) return node.metadata.evidence.length;
    if (Array.isArray(node?.evidence)) return node.evidence.length;
    return 0;
  };
  const interactionProfileFor = (functionality) => {
    const category = String(functionality.metadata?.category || functionality.domain || "other").toLowerCase();
    const reference = functionality.metadata?.evidence?.[0]?.reference || functionality.evidence?.[0]?.reference || "";
    const sourcePath = String(reference).split(":")[0] || "unknown surface";
    const text = `${functionality.label || ""} ${sourcePath}`.toLowerCase();
    const landingSurface = /(^|\/)(app|index|main|home|landing|dashboard|page)\.(jsx?|tsx?|vue|svelte|html)$/i.test(sourcePath)
      || /\b(home|landing|dashboard|overview|main page)\b/.test(text);
    const uiSurface = category === "ui" || /\b(ui|page|screen|view|component|frontend)\b/.test(text);
    const basePriority = landingSurface ? 0 : uiSurface ? 1 : category === "api" ? 4 : category === "integration" ? 5 : category === "security" ? 6 : category === "data" ? 7 : category === "test" ? 8 : category === "runtime" ? 9 : 6;
    return {
      category,
      surfaceKey: `${category}:${sourcePath}`,
      surfaceLabel: landingSurface ? "Landing surface" : uiSurface ? `UI · ${sourcePath}` : `${titleCase(category)} · ${sourcePath}`,
      landingSurface,
      basePriority
    };
  };
  const interactionProfiles = new Map(functionalities.map((functionality) => [functionality.id, interactionProfileFor(functionality)]));
  const surfaceCounts = new Map();
  for (const profile of interactionProfiles.values()) surfaceCounts.set(profile.surfaceKey, (surfaceCounts.get(profile.surfaceKey) || 0) + 1);
  const compareFunctionalities = (left, right) => {
    const leftProfile = interactionProfiles.get(left.id);
    const rightProfile = interactionProfiles.get(right.id);
    const leftCount = surfaceCounts.get(leftProfile.surfaceKey) || 1;
    const rightCount = surfaceCounts.get(rightProfile.surfaceKey) || 1;
    return leftProfile.basePriority - rightProfile.basePriority
      || rightCount - leftCount
      || leftProfile.surfaceKey.localeCompare(rightProfile.surfaceKey)
      || left.label.localeCompare(right.label);
  };
  const compareSubfunctionalities = (left, right) =>
    Number(left.metadata?.sourceOffset || 0) - Number(right.metadata?.sourceOffset || 0)
    || left.label.localeCompare(right.label);
  const descendantsFor = (parentId) => {
    const descendants = [];
    const visited = new Set([parentId]);
    const visit = (currentId) => {
      const children = (subfunctionalitiesByParent.get(currentId) || []).slice().sort(compareSubfunctionalities);
      for (const child of children) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        descendants.push(child);
        visit(child.id);
      }
    };
    visit(parentId);
    return descendants;
  };
  const projectRows = new Map();
  const ensureProject = (projectId, projectName) => {
    const project = resolveProject(projectId, projectName) || {
      id: `project:${projectId}`,
      type: "project",
      label: projectName || projectId,
      metadata: { projectId, projectName: projectName || projectId }
    };
    // Several legacy links can name the same project by either its source id
    // or metadata id.  The rendered root is authoritative, so key by that
    // root id and never place two visual copies at the same coordinates.
    const canonicalProjectId = project.id || projectId;
    const existing = projectRows.get(canonicalProjectId);
    if (existing) return existing;
    const row = { projectId: canonicalProjectId, project, functionalities: [], functionalityDetails: [], ownerIds: new Set(), branches: [] };
    projectRows.set(canonicalProjectId, row);
    return row;
  };
  const treeNodes = [];
  const treeLinks = [];
  const projectedSubfunctionalityIds = new Set();
  const branchNode = (branch, functionality, projectRow, assignedAgents, unresolvedEvidence = false, supportingSubfunctionality = null) => {
    const disabled = TERMINAL_BRANCH_STATUSES.has(String(branch.status || "").toLowerCase());
    const inferenceRole = branch.metadata?.inferenceRole || branch.inferenceRole || "deferred_alternative";
    const profile = interactionProfiles.get(functionality.id) || {
      category: "unmapped_evidence",
      surfaceKey: "unmapped:project evidence",
      surfaceLabel: "Unmapped project evidence",
      basePriority: 10,
      landingSurface: false
    };
    const evidenceCount = evidenceCountFor(branch);
    const functionalityDetail = {
      id: functionality.id,
      label: functionality.label,
      category: functionality.metadata?.category || functionality.domain || "other",
      description: functionality.metadata?.description || functionality.metadata?.responsibility || "No additional source description was recorded.",
      evidenceCount: evidenceCountFor(functionality),
      cyclomaticComplexity: Number(functionality.metadata?.cyclomaticComplexity ?? functionality.metadata?.metrics?.cyclomaticComplexity ?? 0)
    };
    const projection = enrichNode({
      ...branch,
      metadata: {
        ...(branch.metadata || {}),
        architectureLens: true,
        architectureLevel: supportingSubfunctionality ? 3 : 2,
        projectId: projectRow.projectId,
        projectRootId: projectRow.project.id,
        functionalityId: functionality.id,
        parentSubfunctionalityId: supportingSubfunctionality?.id || "",
        architectureZone: profile.category || "other",
        architectureZoneLabel: titleCase(profile.category || "other"),
        surfaceKey: profile.surfaceKey,
        surfaceLabel: profile.surfaceLabel,
        surfaceFunctionalityCount: surfaceCounts.get(profile.surfaceKey) || 1,
        interactionPriority: profile.basePriority,
        landingSurface: profile.landingSurface,
        functionalityCount: 1,
        functionalityIds: [functionality.id],
        functionalityDetails: [functionalityDetail],
        assignedAgents,
        branchId: branch.id,
        branchCount: 1,
        branchIds: [branch.id],
        branchDetails: [{ id: branch.id, label: branch.label, status: branch.status, inferenceRole, evidenceCount }],
        cyclomaticComplexity: Number(functionality.metadata?.cyclomaticComplexity ?? functionality.metadata?.metrics?.cyclomaticComplexity ?? 0),
        relativeCyclomaticComplexity: Number(functionality.metadata?.relativeCyclomaticComplexity ?? functionality.metadata?.metrics?.relativeCyclomaticComplexity ?? 0),
        evidenceCount,
        complexity: Math.min(1, 0.25 + evidenceCount * 0.08 + (disabled ? 0.04 : 0.12)),
        disabled,
        futureEnhancement: !disabled && inferenceRole !== "observed_current",
        unresolvedEvidence,
        description: branch.metadata?.description || branch.disposition?.reason || (disabled ? "A rejected or retired architecture branch retained for provenance." : "A source-supported architecture branch retained for governed reconsideration.")
      }
    });
    treeNodes.push(projection);
    projectRow.branches.push(projection);
    treeLinks.push({
      id: `architecture-functionality-branch:${functionality.id}:${branch.id}`,
      source: supportingSubfunctionality?.id || functionality.id,
      target: branch.id,
      type: disabled ? "rejected_architecture_branch" : supportingSubfunctionality ? "supports_architecture_branch" : "has_architecture_branch",
      metadata: { architectureLens: true, disabled }
    });
  };

  for (const functionality of functionalities.slice().sort(compareFunctionalities)) {
    const projectId = projectByFunctionality.get(functionality.id) || functionality.metadata?.projectId || functionality.project || "project";
    const projectRow = ensureProject(projectId, functionality.project || functionality.metadata?.projectName);
    const profile = interactionProfiles.get(functionality.id);
    const category = profile.category;
    const directSubfunctionalities = (subfunctionalitiesByParent.get(functionality.id) || []).slice().sort(compareSubfunctionalities);
    const allSubfunctionalities = descendantsFor(functionality.id);
    // A child functionality is topology, not a preview detail.  Keeping the
    // full child set visible avoids creating an apparent direct edge from the
    // project root to every branch when an intermediate functionality exists.
    const visibleSubfunctionalities = allSubfunctionalities;
    const supportingSubfunctionalityByBranchId = new Map();
    allSubfunctionalities.forEach((subfunctionality) => {
      (branchesBySubfunctionality.get(subfunctionality.id) || []).forEach((branch) => supportingSubfunctionalityByBranchId.set(branch.id, subfunctionality));
    });
    const linkedBranches = [...new Map([
      ...(branchesByFunctionality.get(functionality.id) || []).map((branch) => [branch.id, branch]),
      ...allSubfunctionalities.flatMap((subfunctionality) => (branchesBySubfunctionality.get(subfunctionality.id) || []).map((branch) => [branch.id, branch]))
    ]).values()];
    const assignedAgents = [...(ownerIdsByFunctionality.get(functionality.id) || new Set())]
      .map((id) => nodeById.get(id))
      .filter(Boolean)
      .map((agent) => ({ id: agent.id, name: agent.label, role: agent.metadata?.role || agent.domain || "implementation" }));
    const observedCount = linkedBranches.filter((branch) => branchSummaryBucket(branch) === "observed").length;
    const disabledCount = linkedBranches.filter((branch) => branchSummaryBucket(branch) === "disabled").length;
    const deferredCount = linkedBranches.length - observedCount - disabledCount;
    const functionalityEvidenceCount = evidenceCountFor(functionality);
    const branchEvidenceCount = linkedBranches.reduce((total, branch) => total + evidenceCountFor(branch), 0);
    const functionalityDetail = {
      id: functionality.id,
      label: functionality.label,
      category,
      description: functionality.metadata?.description || functionality.metadata?.responsibility || "No additional source description was recorded.",
      evidenceCount: functionalityEvidenceCount,
      cyclomaticComplexity: Number(functionality.metadata?.cyclomaticComplexity ?? functionality.metadata?.metrics?.cyclomaticComplexity ?? 0)
    };
    const projection = enrichNode({
      ...functionality,
      metadata: {
        ...(functionality.metadata || {}),
        architectureLens: true,
        architectureLevel: 1,
        projectId,
        projectRootId: projectRow.project.id,
        category,
        architectureZone: category || "other",
        architectureZoneLabel: titleCase(category || "other"),
        surfaceKey: profile.surfaceKey,
        surfaceLabel: profile.surfaceLabel,
        surfaceFunctionalityCount: surfaceCounts.get(profile.surfaceKey) || 1,
        interactionPriority: profile.basePriority,
        landingSurface: profile.landingSurface,
        functionalityCount: 1,
        functionalityIds: [functionality.id],
        functionalityDetails: [functionalityDetail],
        assignedAgents,
        implementingAgentCount: assignedAgents.length,
        subfunctionalityCount: allSubfunctionalities.length,
        hiddenSubfunctionalityCount: 0,
        branchCount: linkedBranches.length,
        branchIds: linkedBranches.map((branch) => branch.id),
        observedCount,
        deferredCount,
        disabledCount,
        evidenceCount: functionalityEvidenceCount + branchEvidenceCount,
        cyclomaticComplexity: Number(functionality.metadata?.cyclomaticComplexity ?? functionality.metadata?.metrics?.cyclomaticComplexity ?? 0),
        relativeCyclomaticComplexity: Number(functionality.metadata?.relativeCyclomaticComplexity ?? functionality.metadata?.metrics?.relativeCyclomaticComplexity ?? 0),
        complexity: Math.min(1, 0.32 + linkedBranches.length * 0.035 + assignedAgents.length * 0.09 + (functionalityEvidenceCount + branchEvidenceCount) * 0.035 + Math.min(0.2, (surfaceCounts.get(profile.surfaceKey) || 1) * 0.022)),
        description: functionalityDetail.description
      }
    });
    treeNodes.push(projection);
    projectRow.functionalities.push(projection);
    projectRow.functionalityDetails.push(functionalityDetail);
    assignedAgents.forEach((agent) => projectRow.ownerIds.add(agent.id));
    const appendSubfunctionality = (subfunctionality, parentId, architectureLevel, ancestry = new Set()) => {
      if (projectedSubfunctionalityIds.has(subfunctionality.id) || ancestry.has(subfunctionality.id)) return;
      projectedSubfunctionalityIds.add(subfunctionality.id);
      const subfunctionalityEvidenceCount = evidenceCountFor(subfunctionality);
      const projection = enrichNode({
        ...subfunctionality,
        metadata: {
          ...(subfunctionality.metadata || {}),
          architectureLens: true,
          architectureLevel,
          projectId,
          projectRootId: projectRow.project.id,
          category,
          architectureZone: category || "other",
          architectureZoneLabel: titleCase(category || "other"),
          surfaceKey: profile.surfaceKey,
          surfaceLabel: profile.surfaceLabel,
          surfaceFunctionalityCount: surfaceCounts.get(profile.surfaceKey) || 1,
          interactionPriority: profile.basePriority,
          parentFunctionalityId: parentId,
          functionalityCount: 1,
          functionalityIds: [functionality.id],
          subfunctionalityCount: 1,
          branchCount: (branchesBySubfunctionality.get(subfunctionality.id) || []).length,
          evidenceCount: subfunctionalityEvidenceCount,
          assignedAgents,
          sourceReference: subfunctionality.metadata?.reference || subfunctionality.reference || "",
          sourceKind: subfunctionality.metadata?.kind || subfunctionality.kind || "source_unit",
          complexity: Math.min(0.7, 0.2 + subfunctionalityEvidenceCount * 0.1),
          description: `Cited ${subfunctionality.metadata?.kind || subfunctionality.kind || "source"} unit in ${subfunctionality.metadata?.sourcePath || subfunctionality.sourcePath || "the project source"}.`
        }
      });
      treeNodes.push(projection);
      treeLinks.push({
        id: `architecture-subfunctionality:${parentId}:${subfunctionality.id}`,
        source: parentId,
        target: subfunctionality.id,
        type: "contains_subfunctionality",
        metadata: { architectureLens: true }
      });
      const nextAncestry = new Set(ancestry);
      nextAncestry.add(subfunctionality.id);
      (subfunctionalitiesByParent.get(subfunctionality.id) || [])
        .slice()
        .sort(compareSubfunctionalities)
        .forEach((child) => appendSubfunctionality(child, subfunctionality.id, architectureLevel + 1, nextAncestry));
    };
    directSubfunctionalities.forEach((subfunctionality) => appendSubfunctionality(subfunctionality, functionality.id, 2));
    const visibleSubfunctionalityIds = new Set(visibleSubfunctionalities.map((subfunctionality) => subfunctionality.id));
    linkedBranches.forEach((branch) => {
      const supportingSubfunctionality = supportingSubfunctionalityByBranchId.get(branch.id);
      branchNode(branch, functionality, projectRow, assignedAgents, false, visibleSubfunctionalityIds.has(supportingSubfunctionality?.id) ? supportingSubfunctionality : null);
    });
  }

  // Orphaned evidence is retained in an explicit synthetic functionality node
  // instead of being silently omitted from the canvas.
  const orphanedBranchesByProject = new Map();
  for (const branch of branches) {
    if (linkedBranchIds.has(branch.id)) continue;
    const projectId = branch.metadata?.projectId || branch.project || "project";
    const rows = orphanedBranchesByProject.get(projectId) || [];
    rows.push(branch);
    orphanedBranchesByProject.set(projectId, rows);
  }
  for (const [projectId, orphanedBranches] of orphanedBranchesByProject) {
    const projectRow = ensureProject(projectId, orphanedBranches[0]?.metadata?.projectName || orphanedBranches[0]?.project || projectId);
    const functionality = {
      id: `architecture-functionality:${projectId}:unmapped_evidence`,
      type: "application_functionality",
      label: "Unmapped branch evidence",
      status: "observed_current",
      metadata: { projectId, projectName: projectRow.project.label, category: "unmapped_evidence", description: "Branch evidence retained because its original functionality node is unavailable in the active projection." }
    };
    const projection = enrichNode({
      ...functionality,
      metadata: {
        ...functionality.metadata,
        architectureLens: true,
        architectureLevel: 1,
        projectRootId: projectRow.project.id,
        architectureZone: "unmapped_evidence",
        architectureZoneLabel: "Unmapped evidence",
        functionalityCount: 1,
        functionalityIds: [functionality.id],
        functionalityDetails: [{ id: functionality.id, label: functionality.label, category: "unmapped_evidence", description: functionality.metadata.description, evidenceCount: 0 }],
        assignedAgents: [],
        branchCount: orphanedBranches.length,
        branchIds: orphanedBranches.map((branch) => branch.id),
        observedCount: orphanedBranches.filter((branch) => branchSummaryBucket(branch) === "observed").length,
        deferredCount: orphanedBranches.filter((branch) => branchSummaryBucket(branch) === "candidate").length,
        disabledCount: orphanedBranches.filter((branch) => branchSummaryBucket(branch) === "disabled").length,
        evidenceCount: orphanedBranches.reduce((total, branch) => total + evidenceCountFor(branch), 0),
        complexity: Math.min(1, 0.32 + orphanedBranches.length * 0.04),
        unresolvedEvidence: true
      }
    });
    treeNodes.push(projection);
    projectRow.functionalities.push(projection);
    projectRow.functionalityDetails.push(projection.metadata.functionalityDetails[0]);
    orphanedBranches.forEach((branch) => branchNode(branch, functionality, projectRow, [], true));
  }

  const projectedNodes = treeNodes;
  const projectedIds = new Set(projectedNodes.map((node) => node.id));
  const inferredLinks = links
    .filter((link) => String(link.type || "").toLowerCase() === "static_inferred_flow")
    .filter((link) => projectedIds.has(nodeId(link.source)) && projectedIds.has(nodeId(link.target)))
    .map((link) => ({
      ...link,
      source: nodeId(link.source),
      target: nodeId(link.target),
      metadata: { ...(link.metadata || {}), architectureLens: true, inferred: true }
    }));
  return {
    nodes: projectedNodes,
    links: [...treeLinks, ...inferredLinks]
  };
}

export function dedupeGraphLinks(links = []) {
  const seen = new Set();
  return links.filter((link) => {
    const key = `${nodeId(link.source)}->${nodeId(link.target)}:${String(link.type || "related_to").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isHierarchyLink(link = {}) {
  const type = String(link.type || "").toLowerCase();
  return type === "contains" || type === "contains_ui_element" || type === "has_ui_feature" || type.includes("contains_functionality") || type.includes("contains_application_entity") || type.includes("contains_subfunctionality") || type.includes("parent_") || type.includes("child_");
}

function sourcePathFromReference(reference = "") {
  const separator = String(reference).lastIndexOf(":");
  return separator > 0 ? String(reference).slice(0, separator) : String(reference || "");
}

function stableShortHash(value = "") {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Older topology snapshots record a functionality's source evidence but not
 * the intermediate source-unit nodes.  Projecting those cited units makes the
 * real hierarchy visible without inventing functionality: each added child is
 * explicitly marked as a source-backed projection and contains its evidence.
 */
export function materializeSourceBackedHierarchy(nodes = [], links = []) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const childIdsByFunctionality = new Map();
  for (const node of nodes) {
    const parentId = String(node.metadata?.parentFunctionalityId || "");
    if (node.type !== "application_subfunctionality" || !parentId) continue;
    const childIds = childIdsByFunctionality.get(parentId) || [];
    childIds.push(node.id);
    childIdsByFunctionality.set(parentId, childIds);
  }
  for (const link of links) {
    if (!String(link.type || "").toLowerCase().includes("contains_subfunctionality")) continue;
    const child = nodeById.get(link.target);
    if (!child || child.type !== "application_subfunctionality") continue;
    const childIds = childIdsByFunctionality.get(link.source) || [];
    if (!childIds.includes(child.id)) childIds.push(child.id);
    childIdsByFunctionality.set(link.source, childIds);
  }

  const projectedNodes = [];
  const projectedLinks = [];
  const sourceChildrenByFunctionality = new Map();
  for (const functionality of nodes.filter((node) => node.type === "application_functionality")) {
    if ((childIdsByFunctionality.get(functionality.id) || []).length) continue;
    const evidence = Array.from(new Map(
      (Array.isArray(functionality.metadata?.evidence) ? functionality.metadata.evidence : [])
        .filter((item) => item?.reference)
        .map((item) => [`${item.id || ""}:${item.reference}`, item])
    ).values()).slice(0, 4);
    if (!evidence.length) continue;
    const childIds = [];
    evidence.forEach((item, index) => {
      const reference = String(item.reference);
      const childId = `subfunctionality:source-backed:${stableShortHash(`${functionality.id}:${reference}:${index}`)}`;
      const child = enrichNode({
        id: childId,
        type: "application_subfunctionality",
        label: `Source unit: ${reference}`,
        group: "subfunctionality-source",
        risk_level: functionality.risk_level || "low",
        status: functionality.status || "observed_current",
        agent_id: functionality.agent_id || "",
        cluster_id: "source-unit",
        metadata: {
          ...(functionality.metadata || {}),
          parentFunctionalityId: functionality.id,
          kind: "source_unit",
          sourcePath: sourcePathFromReference(reference),
          sourceOffset: index,
          reference,
          evidence: [item],
          parentEvidenceIds: item.id ? [item.id] : [],
          sourceBackedProjection: true,
          description: `Source-backed child unit cited at ${reference}.`
        }
      });
      projectedNodes.push(child);
      childIds.push(childId);
      projectedLinks.push({
        id: `contains-subfunctionality:${functionality.id}:${childId}`,
        source: functionality.id,
        target: childId,
        type: "contains_subfunctionality",
        weight: 2,
        metadata: { sourceBackedProjection: true, evidenceIds: item.id ? [item.id] : [] }
      });
    });
    sourceChildrenByFunctionality.set(functionality.id, childIds);
  }

  const rewrittenLinks = links.map((link) => {
    const children = sourceChildrenByFunctionality.get(link.source) || [];
    // A legacy branch that has exactly one cited source unit can be placed
    // beneath that unit. Multiple evidence units remain attached to their
    // functionality rather than implying a more precise source relationship.
    if (String(link.type || "").toLowerCase() === "has_architecture_branch" && children.length === 1) {
      return {
        ...link,
        source: children[0],
        type: "supports_architecture_branch",
        metadata: { ...(link.metadata || {}), sourceBackedProjection: true, relationshipBasis: "single_cited_source_unit" }
      };
    }
    return link;
  });
  return {
    nodes: [...nodes, ...projectedNodes],
    links: dedupeGraphLinks([...rewrittenLinks, ...projectedLinks])
  };
}

function legacyFunctionalitySignal(node = {}) {
  if (node.type !== "application_functionality") return false;
  const label = String(node.label || "");
  const reference = String(node.metadata?.evidence?.[0]?.reference || node.metadata?.sourcePath || "").toLowerCase();
  return /^(?:UI surface|Data boundary|Integration boundary|Security boundary|Test coverage|Runtime configuration|API contract) in\b/i.test(label)
    || /(?:^|\/)(?:\.venv(?:[-/]|$)|venv(?:[-/]|$)|site-packages\/)/.test(reference);
}

function promoteRecordedRouteNode(node = {}) {
  if (node.type !== "application_functionality" || node.metadata?.applicationTopology) return node;
  const route = /^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)$/i.exec(String(node.label || "").trim());
  if (!route) return node;
  const evidence = Array.isArray(node.metadata?.evidence) ? node.metadata.evidence : [];
  const sourcePath = sourcePathFromReference(evidence[0]?.reference || "");
  return {
    ...node,
    type: "api",
    metadata: {
      ...(node.metadata || {}),
      applicationTopology: true,
      applicationEntityType: "api_route",
      sourceHints: {
        ...(node.metadata?.sourceHints || {}),
        route: { method: route[1].toUpperCase(), path: route[2], sourcePath }
      }
    }
  };
}

function promoteLegacySourceFeatureNode(node = {}) {
  if (node.type !== "application_functionality" || node.metadata?.applicationTopology) return node;
  const match = /^(UI surface|Data boundary|Integration boundary) in\s+(.+)$/i.exec(String(node.label || "").trim());
  if (!match) return node;
  const sourcePath = sourcePathFromReference(node.metadata?.evidence?.[0]?.reference || match[2]);
  const filename = String(sourcePath || match[2]).split("/").at(-1)?.replace(/\.[^.]+$/, "") || "source feature";
  const category = match[1].toLowerCase();
  const type = category.startsWith("ui") ? "page" : category.startsWith("data") ? "database" : "service";
  const entityType = type === "page" ? "ui_surface" : type === "database" ? "database_connection" : "service";
  const label = type === "page"
    ? filename.replace(/[^A-Za-z0-9]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : `${type === "database" ? "Data" : "Service"}: ${filename}`;
  return {
    ...node,
    type,
    label,
    metadata: {
      ...(node.metadata || {}),
      applicationTopology: true,
      applicationEntityType: entityType,
      legacySourceBacked: true,
      sourceReference: node.metadata?.evidence?.[0]?.reference || match[2],
      sourceHints: {
        ...(node.metadata?.sourceHints || {}),
        ...(type === "page" ? { ui: { component: label, sourcePath, role: /(?:app|main|home|dashboard|index)/i.test(filename) ? "major_feature" : "page", routePath: "" } } : {}),
        ...(type === "service" ? { service: { kind: "service", sourcePath } } : {}),
        ...(type === "database" ? { database: { sourcePath } } : {})
      }
    }
  };
}

function withoutLegacyFunctionalitySignals(nodes = [], rawLinks = []) {
  const legacyIds = new Set(nodes.filter(legacyFunctionalitySignal).map((node) => node.id));
  const promotedLegacyIds = new Set(nodes.filter((node) => node.metadata?.legacySourceBacked).map((node) => node.id));
  const obsoleteDetailParentIds = new Set([...legacyIds, ...promotedLegacyIds]);
  const legacySourceIds = new Set([...obsoleteDetailParentIds].map((id) => String(id).replace(/^functionality:[^:]+:/, "")));
  const genericAgentIds = new Set();
  for (const link of rawLinks) {
    if (String(link.type || "").toLowerCase() !== "implements") continue;
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    if (obsoleteDetailParentIds.has(target)) genericAgentIds.add(source);
  }
  const retainedAgents = new Set();
  for (const agentId of genericAgentIds) {
    const outgoing = rawLinks.filter((link) => nodeId(link.source) === agentId);
    if (outgoing.some((link) => String(link.type || "").toLowerCase() === "implements" && !obsoleteDetailParentIds.has(nodeId(link.target)))) retainedAgents.add(agentId);
  }
  const filteredNodes = nodes.filter((node) => {
    if (legacyIds.has(node.id)) return false;
    if (genericAgentIds.has(node.id) && !retainedAgents.has(node.id)) return false;
    const parentId = String(node.metadata?.parentFunctionalityId || node.metadata?.functionalityId || "");
    if (["application_subfunctionality", "branch"].includes(node.type) && legacySourceIds.has(parentId)) return false;
    const reference = String(node.metadata?.sourcePath || node.metadata?.reference || node.metadata?.evidence?.[0]?.reference || "").toLowerCase();
    return !/(?:^|\/)(?:\.venv(?:[-/]|$)|venv(?:[-/]|$)|site-packages\/)/.test(reference);
  });
  const retainedIds = new Set(filteredNodes.map((node) => node.id));
  return { nodes: filteredNodes, links: rawLinks.filter((link) => retainedIds.has(nodeId(link.source)) && retainedIds.has(nodeId(link.target))) };
}

export function normalizeGraph(graph) {
  const allSourceNodes = (graph?.nodes || []).map(promoteRecordedRouteNode).map(promoteLegacySourceFeatureNode).map(enrichNode);
  const allSourceNodeById = new Map(allSourceNodes.map((node) => [node.id, node]));
  const allSourceLinks = dedupeGraphLinks((graph?.links || [])
    .map((link) => ({
      ...link,
      source: nodeId(link.source),
      target: nodeId(link.target),
      metadata: { ...(link.metadata || {}) }
    }))
    .filter((link) => allSourceNodeById.has(link.source) && allSourceNodeById.has(link.target)));
  const cleaned = withoutLegacyFunctionalitySignals(allSourceNodes, allSourceLinks);
  const sourceNodes = cleaned.nodes;
  const sourceLinks = cleaned.links;
  const materialized = materializeSourceBackedHierarchy(sourceNodes, sourceLinks);
  const nodes = materialized.nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const links = materialized.links.filter((link) => nodeById.has(link.source) && nodeById.has(link.target));

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

export function buildProjectClusters(nodes, links = [], inventoryNodes = nodes) {
  const capabilityModel = buildClusters(nodes, links);
  const projectMap = new Map();
  const nodeToProjectCluster = new Map();
  const inventoryByProject = new Map();
  for (const node of inventoryNodes) {
    const project = node.project || "Core Platform";
    const inventory = inventoryByProject.get(project) || {
      total: 0,
      features: 0,
      apis: 0,
      services: 0,
      dataStores: 0,
      attention: 0
    };
    inventory.total += 1;
    if (["application_functionality", "functionality", "feature", "page"].includes(node.type)) inventory.features += 1;
    if (node.type === "api") inventory.apis += 1;
    if (node.type === "service") inventory.services += 1;
    if (["database", "memory", "vector_store", "graph_store"].includes(node.type)) inventory.dataStores += 1;
    if (["failed", "waiting"].includes(node.statusGroup)) inventory.attention += 1;
    inventoryByProject.set(project, inventory);
  }
  const ensureProjectCluster = (project) => {
    if (projectMap.has(project)) return projectMap.get(project);
    const cluster = {
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
    };
    projectMap.set(project, cluster);
    return cluster;
  };
  for (const node of nodes) {
    const project = node.project || "Core Platform";
    const cluster = ensureProjectCluster(project);
    cluster.nodes.push(node);
    cluster.counts.total += 1;
    if (node.type === "agent") cluster.counts.agents += 1;
    else cluster.counts.resources += 1;
    cluster.counts[node.statusGroup] = (cluster.counts[node.statusGroup] || 0) + 1;
    if (node.statusGroup === "waiting") cluster.counts.warning += 1;
    nodeToProjectCluster.set(node.id, cluster.id);
  }
  for (const project of inventoryByProject.keys()) ensureProjectCluster(project);

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
    cluster.inventory = inventoryByProject.get(cluster.project) || { total: 0, features: 0, apis: 0, services: 0, dataStores: 0, attention: 0 };
    cluster.description = `${cluster.inventory.features} features · ${cluster.inventory.apis} APIs · ${cluster.inventory.dataStores} data stores${cluster.inventory.attention ? ` · ${cluster.inventory.attention} need attention` : ""}.`;
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
  if (type === "ui_calls_api") return { className: "application-flow", label: "UI calls API", dash: "" };
  if (["ui_uses_service", "api_calls_service", "service_uses_service"].includes(type)) return { className: "application-flow", label: "Application service relationship", dash: "" };
  if (type === "api_uses_database") return { className: "application-data", label: "API uses database", dash: "" };
  if (["service_uses_database", "database_contains_table"].includes(type)) return { className: "application-data", label: "Application data relationship", dash: "" };
  if (type === "static_inferred_flow") return { className: "static-inferred", label: "static-inferred code flow", dash: "8 5" };
  if (type.includes("summarizes_disabled")) return { className: "architecture-disabled", label: "disabled branch provenance", dash: "6 5" };
  if (type.includes("summarizes_observed")) return { className: "architecture-observed", label: "observed current implementation", dash: "" };
  if (type.includes("summarizes_deferred")) return { className: "architecture-deferred", label: "deferred architecture alternatives", dash: "" };
  if (type.includes("contains_architecture_category")) return { className: "architecture-category", label: "functionality analysis group", dash: "" };
  if (type.includes("architecture") || type.includes("summarizes_") || type.includes("contains_functionality") || type.includes("contains_application_entity") || type.includes("contains_subfunctionality") || type === "contains_ui_element" || type === "has_ui_feature" || type.includes("supports_architecture_branch")) {
    return { className: "architecture", label: "architecture branch model", dash: "" };
  }
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
  const project = Object.hasOwn(filters, "project") ? String(filters.project || "") : "all";
  const agentType = filters.agentType || "all";
  const status = filters.status || "all";
  const relationshipType = filters.relationshipType || "all";

  const selectedProjectIds = new Set();
  if (project !== "all") {
    for (const node of model.nodes) {
      if (node.project !== project) continue;
      if (node.metadata?.projectId) selectedProjectIds.add(String(node.metadata.projectId));
      if (node.type === "project") selectedProjectIds.add(String(node.id).replace(/^project:/, ""));
    }
  }
  const belongsToSelectedProject = (node) => {
    if (project === "all" || node.project === project) return true;
    const memberships = [
      ...(Array.isArray(node.metadata?.projectIds) ? node.metadata.projectIds : []),
      ...(Array.isArray(node.metadata?.projectAssignments) ? node.metadata.projectAssignments.map((assignment) => assignment?.projectId) : [])
    ].filter(Boolean).map(String);
    return memberships.some((projectId) => selectedProjectIds.has(projectId));
  };

  let nodes = model.nodes.filter((node) => {
    if (!project) return false;
    if (!belongsToSelectedProject(node)) return false;
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

export function focusNeighborhood(model, selectedId) {
  if (!selectedId || !model.nodeById.has(selectedId)) {
    return { ids: new Set(), upstream: new Set(), downstream: new Set(), links: [], breadcrumb: [] };
  }
  const ids = new Set([selectedId]);
  const upstream = new Set();
  const downstream = new Set();
  const focusLinks = [];
  for (const link of model.links) {
    if (link.source === selectedId) {
      ids.add(link.target);
      downstream.add(link.target);
      focusLinks.push(link);
    } else if (link.target === selectedId) {
      ids.add(link.source);
      upstream.add(link.source);
      focusLinks.push(link);
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
  // The Architecture camera and coordinate system changed from the retired
  // radial landscape to the forward flow map. Version this one layout key so
  // an old saved genesis-only arrangement cannot hide the new branch map on
  // a returning user's first render. New drags continue to persist normally.
  const suffix = viewMode === "explore" ? "explore-feature-clusters-v1" : viewMode || "overview";
  return `agentic-system-layout:${project || "all"}:${suffix}`;
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

/** Preserve user-positioned architecture nodes without imposing visual zones. */
export function applyArchitectureSavedPositions(items, savedPositions) {
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
    // Project cards include labels and status summaries. Their visual bounds
    // are taller than the old centre-only grid gap allowed for.
    minGapY: 268,
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
  if (item.metadata?.architectureLens) return architectureNodeRadius(item);
  if (item.type === "project" || item.agentType === "project" || item.clusterLevel === "project") return 122;
  if (item.kind === "cluster") return item.clusterLevel === "project" ? 118 : 108;
  if (item.agentType === "architectureCategory") return 118;
  if (item.agentType === "architectureBranchSummary" || item.agentType === "deadBranchSummary") return 144;
  if (item.agentType === "orchestrator") return 96;
  if (item.agentType === "qagent" || item.agentType === "reviewer" || item.agentType === "memory") return 92;
  return 88;
}

/**
 * Conservative rendered bounds: geometry, the status dot, labels/subtitles,
 * and a little breathing room.  Layouts use these rectangles instead of
 * centre-to-centre distances so mixed node types cannot visually collide.
 */
export function layoutNodeBounds(item = {}) {
  const type = nodeVisualType(item);
  if (item.metadata?.architectureLens) {
    const radius = architectureNodeRadius(item);
    return { halfWidth: radius + 14, halfHeight: radius + 54 };
  }
  if (item.kind === "cluster") {
    return item.clusterLevel === "project"
      ? { halfWidth: 96, halfHeight: 118 }
      : { halfWidth: 106, halfHeight: 62 };
  }
  if (type === "architectureBranchSummary" || type === "deadBranchSummary") return { halfWidth: 118, halfHeight: 88 };
  if (type === "architectureCategory") return { halfWidth: 64, halfHeight: 64 };
  const maxLabelCharacters = type === "service" ? 24 : type === "project" ? 24 : 18;
  const labelHalfWidth = maxLabelCharacters * 3.2;
  const shapeHalfWidth = type === "service" ? 54 : type === "project" ? 56 : type === "workflow" || type === "branch" ? 42 : 40;
  const lowerLabelExtent = 78;
  return {
    halfWidth: Math.max(shapeHalfWidth, labelHalfWidth) + 12,
    halfHeight: lowerLabelExtent + 12
  };
}

export function layoutBoundsIntersect(left = {}, right = {}, clearance = 0) {
  const leftBounds = layoutNodeBounds(left);
  const rightBounds = layoutNodeBounds(right);
  return Math.abs((left.x || 0) - (right.x || 0)) < leftBounds.halfWidth + rightBounds.halfWidth + clearance
    && Math.abs((left.y || 0) - (right.y || 0)) < leftBounds.halfHeight + rightBounds.halfHeight + clearance;
}

/**
 * Architecture nodes stay circular, but their radius communicates the amount
 * of source-supported responsibility represented by that node.
 */
export function architectureNodeRadius(item = {}) {
  const metadata = item.metadata || {};
  const functionalityCount = Math.max(0, Number(metadata.functionalityCount || 0));
  const surfaceFunctionalityCount = Math.max(0, Number(metadata.surfaceFunctionalityCount || 0));
  const branchCount = Math.max(0, Number(metadata.branchCount || 0));
  const complexity = Math.max(0, Math.min(1, Number(metadata.complexity || 0)));
  const rawCyclomaticComplexity = Math.max(0, Number(metadata.cyclomaticComplexity ?? metadata.metrics?.cyclomaticComplexity ?? 0));
  const connectorCount = Math.max(0, Number(metadata.connectorCount ?? metadata.metrics?.connectorCount ?? 0));
  const childFeatureCount = Math.max(0, Number(metadata.childFeatureCount || 0));
  const codeLineCount = Math.max(0, Number(metadata.metrics?.codeLineCount || 0));
  const relativeCyclomaticComplexity = Number(metadata.relativeCyclomaticComplexity ?? metadata.metrics?.relativeCyclomaticComplexity);
  const cyclomaticSignal = Number.isFinite(relativeCyclomaticComplexity) && relativeCyclomaticComplexity > 0
    ? Math.max(0, Math.min(1, relativeCyclomaticComplexity))
    : rawCyclomaticComplexity
      ? Math.min(1, Math.log2(rawCyclomaticComplexity + 1) / Math.log2(22))
      : 0;
  if (item.metadata?.applicationTopology && ["feature", "page", "api", "service", "database"].includes(item.type)) {
    return Math.round(Math.min(98,
      32
      + complexity * 13
      + cyclomaticSignal * 25
      + Math.sqrt(connectorCount) * 7
      + Math.sqrt(childFeatureCount) * 8
      + Math.min(8, Math.log2(codeLineCount + 1))
      + Math.sqrt(functionalityCount || 1) * 3));
  }
  if (item.agentType === "functionality") {
    return Math.round(Math.min(90, 36 + Math.sqrt(branchCount) * 5 + Math.sqrt(surfaceFunctionalityCount) * 5 + complexity * 11 + cyclomaticSignal * 28));
  }
  if (item.agentType === "subfunctionality") return Math.round(Math.min(38, 22 + complexity * 8 + cyclomaticSignal * 5));
  if (item.agentType === "branch") {
    return Math.round(Math.min(54, 29 + complexity * 11 + cyclomaticSignal * 8 + (metadata.disabled ? 2 : 6)));
  }
  if (item.type === "project" || item.agentType === "project") {
    return Math.round(Math.min(92, 52 + Math.sqrt(functionalityCount) * 9 + complexity * 13));
  }
  return 46;
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

export function selectDependencyAnchor(items = [], links = [], selectedId = "") {
  const nodeById = new Map(items.map((item) => [item.id, item]));
  if (selectedId && nodeById.has(selectedId)) return selectedId;
  const degree = new Map(items.map((item) => [item.id, 0]));
  for (const link of links) {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    if (degree.has(source)) degree.set(source, degree.get(source) + 1);
    if (degree.has(target)) degree.set(target, degree.get(target) + 1);
  }
  const anchorPriority = (item) => {
    if (["application_functionality", "functionality", "feature", "page", "api", "service", "database"].includes(item.type)) return 0;
    if (item.type === "agent") return 2;
    if (item.type === "project") return 4;
    return 1;
  };
  return items
    .slice()
    .sort((left, right) =>
      anchorPriority(left) - anchorPriority(right) ||
      (degree.get(right.id) || 0) - (degree.get(left.id) || 0) ||
      left.label.localeCompare(right.label)
    )[0]?.id || "";
}

export function buildDependencyLens(items = [], links = [], selectedId = "") {
  const normalizedLinks = dedupeGraphLinks(links.map((link) => ({ ...link, source: nodeId(link.source), target: nodeId(link.target) })));
  const nodeById = new Map(items.map((item) => [item.id, item]));
  const anchorId = selectDependencyAnchor(items, normalizedLinks, selectedId);
  const visibleIds = new Set(items.map((item) => item.id));
  // Dependency inspection is an ownership/dependency explanation, so a
  // selected service or functionality must retain its complete reachable
  // dependency chain. The retired neighborhood cap hid real descendants.
  const maximumDepth = Math.max(1, items.length);
  const trace = (direction) => {
    const distances = new Map(anchorId ? [[anchorId, 0]] : []);
    const frontier = anchorId ? [anchorId] : [];
    while (frontier.length) {
      const current = frontier.shift();
      const currentDistance = distances.get(current) || 0;
      if (currentDistance >= maximumDepth) continue;
      for (const link of normalizedLinks) {
        const next = direction === "upstream"
          ? link.target === current ? link.source : ""
          : link.source === current ? link.target : "";
        if (!next || !visibleIds.has(next) || distances.has(next)) continue;
        distances.set(next, currentDistance + 1);
        frontier.push(next);
      }
    }
    return distances;
  };
  const upstream = trace("upstream");
  const downstream = trace("downstream");
  const ids = new Set([...upstream.keys(), ...downstream.keys()]);
  const hierarchyParents = new Set();
  const hierarchyChildren = new Set();
  const hierarchyFrontier = [...ids];
  const hierarchyVisited = new Set(hierarchyFrontier);
  while (hierarchyFrontier.length) {
    const current = hierarchyFrontier.shift();
    for (const link of normalizedLinks) {
      if (!isHierarchyLink(link)) continue;
      let adjacent = "";
      if (link.source === current) {
        adjacent = link.target;
        hierarchyChildren.add(adjacent);
      } else if (link.target === current) {
        adjacent = link.source;
        hierarchyParents.add(adjacent);
      }
      if (!adjacent || !visibleIds.has(adjacent) || hierarchyVisited.has(adjacent)) continue;
      hierarchyVisited.add(adjacent);
      ids.add(adjacent);
      hierarchyFrontier.push(adjacent);
    }
  }
  // Ownership is not a causal dependency, but it is essential context for a
  // feature taxonomy. Keep agents that explicitly implement any reachable
  // feature in the same dependency canvas without expanding unrelated agent
  // delegation chains.
  const ownershipIds = new Set();
  for (const link of normalizedLinks) {
    if (String(link.type || "").toLowerCase() !== "implements" || !ids.has(link.target)) continue;
    const owner = nodeById.get(link.source);
    if (!owner || owner.type !== "agent") continue;
    ids.add(owner.id);
    ownershipIds.add(owner.id);
  }
  const roleFor = (id) => {
    if (id === anchorId) return "focus";
    if (ownershipIds.has(id)) return "shared";
    if (upstream.has(id) && downstream.has(id)) return "shared";
    return upstream.has(id) ? "upstream" : "downstream";
  };
  const lensNodes = items
    .filter((item) => ids.has(item.id))
    .map((item) => ({
      ...item,
      dependencyRole: roleFor(item.id),
      dependencyRoleDetail: item.id !== anchorId && hierarchyChildren.has(item.id) && !downstream.has(item.id)
        ? "descendant"
        : item.id !== anchorId && hierarchyParents.has(item.id) && !upstream.has(item.id)
          ? "ancestor"
          : "",
      dependencyDepth: Math.min(upstream.get(item.id) ?? Infinity, downstream.get(item.id) ?? Infinity),
      // Delivery data is derived from literal dependencies by the backend.
      // It may be inferred for an imported project, so preserve that fact in
      // the canvas rather than presenting an invented implementation history.
      deliveryOrder: Number(item.metadata?.deliveryOrder || item.metadata?.chronologyOrder || 0) || 0,
      deliveryPhase: item.metadata?.deliveryPhase || "",
      deliveryPhaseRank: Number(item.metadata?.deliveryPhaseRank ?? 99),
      timelineInferred: Boolean(item.metadata?.timelineInferred),
      projectOrigin: item.metadata?.projectOrigin || ""
    }));
  const lensIds = new Set(lensNodes.map((node) => node.id));
  return {
    anchorId,
    nodes: lensNodes,
    links: normalizedLinks.filter((link) => lensIds.has(link.source) && lensIds.has(link.target))
  };
}

function createHorizontalFeatureTimelineLayout(items = [], links = [], width = 1200, height = 760) {
  const featureTypes = new Set(["functionality", "application_functionality", "feature", "page", "ui_element"]);
  // Discovery/dependency ordering is useful context, but it is not an
  // execution sequence. A timeline is reserved for an explicit source-backed
  // control-flow sequence so the canvas never implies runtime history.
  const deliveryNodes = items.filter((item) => item.deliveryOrder > 0 && item.metadata?.controlFlowSequence === true);
  const featureTimeline = deliveryNodes.filter((item) => featureTypes.has(item.type) || featureTypes.has(item.agentType));
  const timeline = (featureTimeline.length >= 2 ? featureTimeline : deliveryNodes)
    .slice()
    .sort((left, right) => left.deliveryOrder - right.deliveryOrder || left.label.localeCompare(right.label));
  if (timeline.length < 2) return null;

  const stepGap = 340;
  const virtualWidth = Math.max(width, 180 + (timeline.length - 1) * stepGap + 180);
  const adjacency = new Map(items.map((item) => [item.id, new Set()]));
  for (const link of links) {
    if (!adjacency.has(link.source) || !adjacency.has(link.target)) continue;
    adjacency.get(link.source).add(link.target);
    adjacency.get(link.target).add(link.source);
  }
  const timelineIds = new Set(timeline.map((item) => item.id));
  const closestCheckpoint = (startId) => {
    if (timelineIds.has(startId)) return startId;
    const visited = new Set([startId]);
    const queue = [startId];
    while (queue.length) {
      const current = queue.shift();
      for (const next of adjacency.get(current) || []) {
        if (visited.has(next)) continue;
        if (timelineIds.has(next)) return next;
        visited.add(next);
        queue.push(next);
      }
    }
    return "";
  };
  const supportByCheckpoint = new Map(timeline.map((item) => [item.id, []]));
  const unanchored = [];
  for (const item of items) {
    if (timelineIds.has(item.id)) continue;
    const checkpointId = closestCheckpoint(item.id);
    if (checkpointId) supportByCheckpoint.get(checkpointId).push(item);
    else unanchored.push(item);
  }
  const largestSupportGroup = Math.max(0, ...[...supportByCheckpoint.values()].map((rows) => rows.length));
  const unanchoredHeight = unanchored.reduce((total, item) => total + layoutNodeBounds(item).halfHeight * 2 + 34, 110);
  const virtualHeight = Math.max(height, 560 + Math.ceil(largestSupportGroup / 2) * 250, unanchoredHeight + 80);
  const timelineY = Math.round(virtualHeight / 2);
  const positioned = new Map();
  timeline.forEach((item, index) => {
    positioned.set(item.id, {
      ...item,
      dependencyLayout: "feature-timeline",
      dependencyTimelineCheckpoint: true,
      dependencyTimelineStep: index + 1,
      dependencyVirtualWidth: virtualWidth,
      dependencyVirtualHeight: virtualHeight,
      x: 180 + index * stepGap,
      y: timelineY
    });
  });
  for (const [checkpointId, rows] of supportByCheckpoint) {
    const checkpoint = positioned.get(checkpointId);
    rows
      .slice()
      .sort((left, right) => left.deliveryOrder - right.deliveryOrder || left.label.localeCompare(right.label))
      .forEach((item, index) => {
        const ring = Math.floor(index / 2);
        const side = index % 2 ? 1 : -1;
        const horizontalOffset = ring % 2 ? -74 : 74;
        positioned.set(item.id, {
          ...item,
          dependencyLayout: "feature-timeline",
          dependencyTimelineCheckpointId: checkpointId,
          dependencyVirtualWidth: virtualWidth,
          dependencyVirtualHeight: virtualHeight,
          x: checkpoint.x + horizontalOffset + Math.floor(ring / 2) * (ring % 2 ? -40 : 40),
          y: timelineY + side * (210 + ring * 240)
        });
      });
  }
  let unanchoredCursor = 60;
  unanchored.forEach((item) => {
    const upstream = item.dependencyRole === "upstream";
    const bounds = layoutNodeBounds(item);
    positioned.set(item.id, {
      ...item,
      dependencyLayout: "feature-timeline",
      dependencyVirtualWidth: virtualWidth,
      dependencyVirtualHeight: virtualHeight,
      x: upstream ? 64 : virtualWidth - 64,
      y: unanchoredCursor + bounds.halfHeight
    });
    unanchoredCursor += bounds.halfHeight * 2 + 34;
  });
  return items.map((item) => positioned.get(item.id) || item);
}

/** A horizontal feature timeline when source-backed delivery order exists,
 * otherwise a directional three-lane layout for causal dependency inspection. */
export function createDependencyLayout(items = [], links = [], width = 1200, height = 760) {
  items = items.map((item) => ({
    ...item,
    deliveryOrder: Number(item.deliveryOrder || item.metadata?.deliveryOrder || item.metadata?.chronologyOrder || 0) || 0,
    deliveryPhase: item.deliveryPhase || item.metadata?.deliveryPhase || "",
    deliveryPhaseRank: Number(item.deliveryPhaseRank ?? item.metadata?.deliveryPhaseRank ?? 99)
  }));
  const timelineLayout = createHorizontalFeatureTimelineLayout(items, links, width, height);
  if (timelineLayout) return timelineLayout;
  const groups = new Map(["upstream", "shared", "focus", "downstream"].map((role) => [role, []]));
  items.forEach((item) => groups.get(item.dependencyRole || "focus")?.push(item));
  const sortRows = (rows) => rows
    .slice()
    .sort((left, right) =>
      Number(Boolean(right.deliveryOrder)) - Number(Boolean(left.deliveryOrder))
      || left.deliveryOrder - right.deliveryOrder
      || left.deliveryPhaseRank - right.deliveryPhaseRank
      || left.dependencyDepth - right.dependencyDepth
      || left.label.localeCompare(right.label));
  const columns = {
    upstream: sortRows(groups.get("upstream") || []),
    focus: sortRows([...(groups.get("focus") || []), ...(groups.get("shared") || [])]),
    downstream: sortRows(groups.get("downstream") || [])
  };
  const verticalGap = 28;
  const columnHeight = (rows) => rows.reduce((total, row) => total + layoutNodeBounds(row).halfHeight * 2, 0) + Math.max(0, rows.length - 1) * verticalGap;
  const virtualHeight = Math.max(height, 124 + Math.max(...Object.values(columns).map(columnHeight)) + 124);
  const columnWidth = (rows) => Math.max(136, ...rows.map((row) => layoutNodeBounds(row).halfWidth * 2));
  const widths = Object.fromEntries(Object.entries(columns).map(([key, rows]) => [key, columnWidth(rows)]));
  const horizontalGap = 116;
  const virtualWidth = Math.max(width, 96 + widths.upstream + horizontalGap + widths.focus + horizontalGap + widths.downstream + 96);
  const centers = {
    upstream: 96 + widths.upstream / 2,
    focus: 96 + widths.upstream + horizontalGap + widths.focus / 2,
    downstream: 96 + widths.upstream + horizontalGap + widths.focus + horizontalGap + widths.downstream / 2
  };
  const positioned = new Map();
  for (const [column, rows] of Object.entries(columns)) {
    let cursorY = (virtualHeight - columnHeight(rows)) / 2;
    for (const row of rows) {
      const bounds = layoutNodeBounds(row);
      positioned.set(row.id, {
        ...row,
        dependencyColumn: column,
        dependencyVirtualWidth: virtualWidth,
        dependencyVirtualHeight: virtualHeight,
        x: centers[column],
        y: cursorY + bounds.halfHeight
      });
      cursorY += bounds.halfHeight * 2 + verticalGap;
    }
  }
  return items.map((item) => positioned.get(item.id) || item);
}

function functionalityFlowStage(item = {}) {
  const type = item.type || item.agentType;
  if (type === "agent") return { id: "control-0", label: "Agent assignment", index: 0 };
  if (["functionality", "application_functionality", "feature", "page"].includes(type)) return { id: "control-1", label: "Application control", index: 1 };
  if (type === "ui_element") return { id: "control-2", label: "User action", index: 2 };
  if (type === "api") return { id: "control-3", label: "API boundary", index: 3 };
  if (type === "service") return { id: "control-4", label: "Domain operation", index: 4 };
  if (type === "database" || type === "memory") return { id: "control-5", label: "State change", index: 5 };
  return { id: "control-6", label: "Supporting control", index: 6 };
}

/** Projects one literal major feature, its child functionality, and its
 * explicitly connected delivery architecture into a compact flow. */
export function buildFunctionalityFlow(items = [], links = [], selectedMajorFeatureId = "") {
  const sourceEntities = items.filter((item) =>
    Boolean(item.metadata?.applicationTopology)
    || ["application_functionality", "functionality", "feature", "page", "ui_element", "api", "service", "database"].includes(item.type)
  );
  const entityIds = new Set(sourceEntities.map((item) => item.id));
  const majorTypes = new Set(["application_functionality", "functionality", "feature", "page"]);
  const hierarchyTypes = new Set(["contains_feature", "contains_subpage", "contains_ui_element", "has_ui_feature"]);
  const parentById = new Map();
  for (const entity of sourceEntities) {
    const parentId = entity.metadata?.parentEntityNodeId || entity.metadata?.parentFeatureId;
    if (parentId && entityIds.has(parentId)) parentById.set(entity.id, parentId);
  }
  for (const link of links) {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    const type = String(link.type || "").toLowerCase();
    if (!entityIds.has(source) || !entityIds.has(target) || parentById.has(target)) continue;
    if (link.metadata?.hierarchy || isHierarchyLink(link) || hierarchyTypes.has(type)) parentById.set(target, source);
  }
  let majorFeatures = sourceEntities.filter((item) => majorTypes.has(item.type) && !parentById.has(item.id));
  // Imported projects can lack explicit hierarchy links. In that case each
  // feature-like entity remains independently explorable rather than being
  // collapsed into one unbounded canvas.
  if (!majorFeatures.length) majorFeatures = sourceEntities.filter((item) => majorTypes.has(item.type));
  if (!majorFeatures.length) majorFeatures = sourceEntities.slice();
  majorFeatures = majorFeatures
    .slice()
    .sort((left, right) =>
      Number(left.deliveryOrder || left.metadata?.deliveryOrder || left.metadata?.chronologyOrder || 0)
        - Number(right.deliveryOrder || right.metadata?.deliveryOrder || right.metadata?.chronologyOrder || 0)
      || left.label.localeCompare(right.label));
  const selectedMajor = majorFeatures.find((item) => item.id === selectedMajorFeatureId) || majorFeatures[0] || null;
  const majorIds = new Set(majorFeatures.map((item) => item.id));
  const adjacency = new Map(sourceEntities.map((item) => [item.id, new Set()]));
  for (const link of links) {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    if (!entityIds.has(source) || !entityIds.has(target)) continue;
    adjacency.get(source).add(target);
    adjacency.get(target).add(source);
  }
  const selectedEntityIds = new Set();
  if (selectedMajor) {
    const queue = [selectedMajor.id];
    selectedEntityIds.add(selectedMajor.id);
    while (queue.length) {
      const current = queue.shift();
      for (const connectedId of adjacency.get(current) || []) {
        // A connected peer feature starts its own focused view; its shared
        // dependencies will still appear in the currently selected flow.
        if (connectedId !== selectedMajor.id && majorIds.has(connectedId)) continue;
        if (selectedEntityIds.has(connectedId)) continue;
        selectedEntityIds.add(connectedId);
        queue.push(connectedId);
      }
    }
  }
  const ownerIds = new Set(
    links
      .filter((link) => String(link.type || "").toLowerCase() === "implements" && selectedEntityIds.has(nodeId(link.target)))
      .map((link) => nodeId(link.source))
  );
  const nodes = items.filter((item) => selectedEntityIds.has(item.id) || ownerIds.has(item.id));
  const nodeIds = new Set(nodes.map((item) => item.id));
  const selectedLinks = links
    .filter((link) => nodeIds.has(nodeId(link.source)) && nodeIds.has(nodeId(link.target)))
    .map((link) => ({ ...link, source: nodeId(link.source), target: nodeId(link.target), kind: "functionality-flow" }));
  const controlRelationshipTypes = new Set(["ui_calls_api", "ui_uses_service", "api_calls_service", "service_uses_service"]);
  const controlRelationshipCount = selectedLinks.filter((link) => controlRelationshipTypes.has(String(link.type || "").toLowerCase())).length;
  return {
    nodes,
    links: selectedLinks,
    majorFeatures: majorFeatures.map((item) => ({
      id: item.id,
      label: item.label,
      type: item.type,
      deliveryOrder: item.deliveryOrder || item.metadata?.deliveryOrder || item.metadata?.chronologyOrder || 0
    })),
    selectedMajorFeatureId: selectedMajor?.id || "",
    controlRelationshipCount,
    evidenceLabel: controlRelationshipCount
      ? "Source-derived application map with recorded control relationships"
      : "Source-derived application map · no end-to-end control path recorded"
  };
}

export function createFunctionalityFlowLayout(items = [], links = [], width = 1200, height = 760) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const predecessors = new Map(items.map((item) => [item.id, []]));
  const ownershipTargetsByAgent = new Map();
  links.forEach((link) => {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    if (!itemById.has(source) || !itemById.has(target)) return;
    if (String(link.type || "").toLowerCase() === "implements") {
      const targets = ownershipTargetsByAgent.get(source) || [];
      targets.push(target);
      ownershipTargetsByAgent.set(source, targets);
      return;
    }
    predecessors.get(target).push(source);
  });
  const rankMemo = new Map();
  const controlRankFor = (id, visiting = new Set()) => {
    if (rankMemo.has(id)) return rankMemo.get(id);
    const item = itemById.get(id);
    const baseRank = functionalityFlowStage(item).index;
    // Cycles are valid in real application graphs. A cycle keeps its semantic
    // stage rather than escalating indefinitely through the left-to-right map.
    if (visiting.has(id)) return baseRank;
    const nextVisiting = new Set(visiting).add(id);
    const rank = Math.max(baseRank, ...(predecessors.get(id) || []).map((parentId) => controlRankFor(parentId, nextVisiting) + 1));
    rankMemo.set(id, rank);
    return rank;
  };
  const stages = new Map();
  items.forEach((item) => {
    const ownershipTargets = ownershipTargetsByAgent.get(item.id) || [];
    const rank = item.type === "agent" && ownershipTargets.length
      ? Math.min(...ownershipTargets.map((targetId) => controlRankFor(targetId)))
      : controlRankFor(item.id);
    const rows = stages.get(rank) || [];
    rows.push(item);
    stages.set(rank, rows);
  });
  const activeStages = [...stages.entries()].sort(([left], [right]) => left - right);
  const rowGap = 34;
  const stageHeight = (rows) => rows.reduce((total, item) => total + layoutNodeBounds(item).halfHeight * 2, 0) + Math.max(0, rows.length - 1) * rowGap;
  const virtualHeight = Math.max(height, 150 + Math.max(0, ...activeStages.map(([, rows]) => stageHeight(rows))) + 150);
  const columnGap = 278;
  const virtualWidth = Math.max(width, 130 + Math.max(0, ...activeStages.map(([rank]) => rank)) * columnGap + 230);
  const positioned = new Map();
  activeStages.forEach(([rank, rows]) => {
    const ordered = rows.slice().sort((left, right) => {
      const parentY = (item) => {
        const values = (predecessors.get(item.id) || []).map((id) => positioned.get(id)?.y).filter(Number.isFinite);
        return values.length ? values.reduce((total, value) => total + value, 0) / values.length : Number.POSITIVE_INFINITY;
      };
      return Number(left.type === "agent") - Number(right.type === "agent")
        || parentY(left) - parentY(right)
        || Number(left.deliveryOrder || left.metadata?.deliveryOrder || 0) - Number(right.deliveryOrder || right.metadata?.deliveryOrder || 0)
        || left.label.localeCompare(right.label);
    });
    let cursorY = (virtualHeight - stageHeight(ordered)) / 2;
    ordered.forEach((item) => {
      const bounds = layoutNodeBounds(item);
      const defaultStage = functionalityFlowStage(item);
      positioned.set(item.id, {
        ...item,
        functionalityFlow: true,
        functionalityFlowStage: `control-${rank}`,
        functionalityFlowStageLabel: item.type === "agent"
          ? "Implemented by"
          : rank === defaultStage.index ? defaultStage.label : `Control step ${rank + 1} · ${defaultStage.label}`,
        functionalityFlowStageIndex: rank,
        functionalityFlowVirtualWidth: virtualWidth,
        functionalityFlowVirtualHeight: virtualHeight,
        x: 130 + rank * columnGap,
        y: cursorY + bounds.halfHeight
      });
      cursorY += bounds.halfHeight * 2 + rowGap;
    });
  });
  return items.map((item) => positioned.get(item.id) || item);
}

export function createDagreLayout(items, links, width = 1200, height = 760, dagreApi) {
  if (!dagreApi?.graphlib?.Graph) return stableGridLayout(items, width, height);
  const graph = new dagreApi.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", ranksep: 110, nodesep: 70, marginx: 40, marginy: 40 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const item of items) {
    const isCluster = item.kind === "cluster";
    const isArchitectureSummary = item.agentType === "architectureBranchSummary" || item.agentType === "deadBranchSummary";
    const isArchitectureCategory = item.agentType === "architectureCategory";
    graph.setNode(item.id, {
      width: isCluster ? 190 : isArchitectureSummary ? 248 : isArchitectureCategory ? 150 : 120,
      height: isCluster ? 96 : isArchitectureSummary ? 104 : isArchitectureCategory ? 96 : 80
    });
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

function stableArchitectureSeed(id = "") {
  let hash = 2166136261;
  for (const character of String(id)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Gives the force simulation a neutral, deterministic starting scatter. It
 * deliberately ignores chronology and hierarchy coordinates: recorded links,
 * charge, collision, and cluster gravity own the final spatial structure.
 */
export function createArchitectureFreeForceSeedLayout(items = [], _links = [], width = 1200, height = 760) {
  if (!items.length) return items;
  const centerX = Math.max(220, width / 2);
  const centerY = Math.max(180, height / 2);
  const spread = Math.max(260, Math.sqrt(items.length) * 105);
  return items.map((item) => {
    const seed = stableArchitectureSeed(item.id);
    const angle = ((seed % 3600) / 3600) * Math.PI * 2;
    const radius = 70 + (((seed >>> 12) % 1000) / 1000) * spread;
    return {
      ...item,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      metadata: {
        ...item.metadata,
        architectureForceSeed: "deterministic_unordered_scatter"
      }
    };
  });
}

/**
 * Produces deterministic anchors for the live D3 force pass. Horizontal depth
 * expresses the feature hierarchy; vertical order follows the source-backed
 * chronology. These are force targets, not fixed coordinates.
 */
export function createArchitectureForceSeedLayout(items = [], links = [], width = 1200, height = 760) {
  if (!items.length) return items;
  const itemById = new Map(items.map((item) => [item.id, item]));
  const roots = items
    .filter((item) => item.type === "project" || item.agentType === "project")
    .sort((left, right) => left.label.localeCompare(right.label));
  const parentById = new Map();
  for (const item of items) {
    const explicit = item.metadata?.parentFeatureId;
    if (explicit && itemById.has(explicit)) parentById.set(item.id, explicit);
  }
  for (const link of links) {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    if (!itemById.has(source) || !itemById.has(target) || parentById.has(target)) continue;
    if (link.metadata?.hierarchy || isHierarchyLink(link)) parentById.set(target, source);
  }
  const depthMemo = new Map(roots.map((root) => [root.id, 0]));
  const depthFor = (id, visiting = new Set()) => {
    if (depthMemo.has(id)) return depthMemo.get(id);
    if (visiting.has(id)) return 1;
    visiting.add(id);
    const parentId = parentById.get(id);
    const depth = parentId && itemById.has(parentId) ? depthFor(parentId, visiting) + 1 : Math.max(1, Number(itemById.get(id)?.metadata?.architectureLevel || 1));
    depthMemo.set(id, depth);
    return depth;
  };
  items.forEach((item) => depthFor(item.id));
  const positioned = new Map();
  let projectStartY = 140;
  if (!roots.length) {
    const projectGroups = new Map();
    for (const item of items) {
      const projectKey = item.metadata?.projectId || item.project || item.metadata?.projectName || "project";
      const group = projectGroups.get(projectKey) || [];
      group.push(item);
      projectGroups.set(projectKey, group);
    }
    for (const [, projectItems] of [...projectGroups.entries()].sort(([left], [right]) => String(left).localeCompare(String(right)))) {
      const ordered = projectItems.slice().sort((left, right) =>
        Number(left.metadata?.chronologyOrder ?? 999999) - Number(right.metadata?.chronologyOrder ?? 999999)
        || depthFor(left.id) - depthFor(right.id)
        || left.label.localeCompare(right.label));
      ordered.forEach((item, index) => {
        const depth = depthFor(item.id);
        const x = Math.max(180, width * 0.12) + Math.max(0, depth - 1) * 290;
        const y = projectStartY + 150 + index * 320;
        positioned.set(item.id, {
          ...item,
          x,
          y,
          metadata: {
            ...item.metadata,
            architectureFlowTier: item.type === "page" ? "feature" : item.type,
            architectureHierarchyDepth: depth,
            architectureForceSeedX: x,
            architectureForceSeedY: y
          }
        });
      });
      projectStartY += Math.max(height, ordered.length * 320 + 260) + 260;
    }
  }
  for (const root of roots) {
    const projectId = root.metadata?.projectId || root.id;
    const projectItems = items.filter((item) => item.id === root.id || item.metadata?.projectRootId === root.id || item.metadata?.projectId === projectId);
    const descendants = projectItems.filter((item) => item.id !== root.id).sort((left, right) =>
      Number(left.metadata?.chronologyOrder ?? 999999) - Number(right.metadata?.chronologyOrder ?? 999999)
      || depthFor(left.id) - depthFor(right.id)
      || left.label.localeCompare(right.label));
    const rowsByDepth = new Map();
    descendants.forEach((item) => {
      const depth = depthFor(item.id);
      const rows = rowsByDepth.get(depth) || [];
      rows.push(item);
      rowsByDepth.set(depth, rows);
    });
    const maxRows = Math.max(1, ...[...rowsByDepth.values()].map((rows) => rows.length));
    const projectHeight = Math.max(height, maxRows * 310 + 220);
    const rootX = Math.max(150, width * 0.12);
    const rootY = projectStartY + projectHeight / 2;
    positioned.set(root.id, {
      ...root,
      x: rootX,
      y: rootY,
      metadata: { ...root.metadata, architectureFlowTier: "project", architectureHierarchyDepth: 0, architectureForceSeedX: rootX, architectureForceSeedY: rootY }
    });
    for (const [depth, rows] of [...rowsByDepth.entries()].sort((left, right) => left[0] - right[0])) {
      rows.forEach((item, index) => {
        const x = rootX + depth * 290;
        const y = projectStartY + 150 + index * Math.max(290, Math.min(340, (projectHeight - 260) / Math.max(1, rows.length - 1)));
        positioned.set(item.id, {
          ...item,
          x,
          y,
          metadata: {
            ...item.metadata,
            architectureFlowTier: item.type === "page" ? "feature" : item.type,
            architectureHierarchyDepth: depth,
            architectureForceSeedX: x,
            architectureForceSeedY: y
          }
        });
      });
    }
    projectStartY += projectHeight + 260;
  }
  const fallback = items.map((item, index) => positioned.get(item.id) || {
    ...item,
    x: Math.max(180, width / 2) + depthFor(item.id) * 240,
    y: projectStartY + index * 320,
    metadata: { ...item.metadata, architectureHierarchyDepth: depthFor(item.id) }
  });
  return resolveLayoutOverlaps(fallback, { padding: 22, iterations: 128 });
}

/**
 * Places the project root above its functionality and branch descendants.
 * Functionality columns descend from the root and their branch nodes stack in
 * compact rows underneath, so the graph grows down the canvas rather than
 * sideways as a left-to-right flow.
 */
export function createArchitectureTreeLayout(items = [], links = [], width = 1200, height = 760) {
  if (!items.length) return items;
  const itemById = new Map(items.map((item) => [item.id, item]));
  const childrenById = new Map(items.map((item) => [item.id, []]));
  for (const link of links) {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    if (!itemById.has(source) || !itemById.has(target)) continue;
    childrenById.get(source).push(target);
  }
  const compareArchitectureChildren = (leftId, rightId) => {
    const left = itemById.get(leftId);
    const right = itemById.get(rightId);
    const leftPriority = Number(left?.metadata?.interactionPriority ?? 99);
    const rightPriority = Number(right?.metadata?.interactionPriority ?? 99);
    const leftSurfaceCount = Number(left?.metadata?.surfaceFunctionalityCount || 0);
    const rightSurfaceCount = Number(right?.metadata?.surfaceFunctionalityCount || 0);
    return leftPriority - rightPriority
      || rightSurfaceCount - leftSurfaceCount
      || String(left?.metadata?.surfaceKey || "").localeCompare(String(right?.metadata?.surfaceKey || ""))
      || String(left?.label || "").localeCompare(String(right?.label || ""));
  };
  for (const childIds of childrenById.values()) childIds.sort(compareArchitectureChildren);
  const positioned = new Map();
  const roots = items
    .filter((item) => item.type === "project" || item.agentType === "project")
    .sort((left, right) => left.label.localeCompare(right.label));
  let projectStartX = 180;

  for (const root of roots) {
    const functionalityIds = (childrenById.get(root.id) || [])
      .filter((id) => itemById.get(id)?.agentType === "functionality")
      .sort(compareArchitectureChildren);
    const functionalColumns = functionalityIds.map((id) => {
      const functionality = itemById.get(id);
      const branchIds = (childrenById.get(id) || [])
        .filter((branchId) => itemById.get(branchId)?.agentType === "branch")
        .sort(compareArchitectureChildren);
      const branchColumns = Math.max(1, Math.min(2, Math.ceil(Math.sqrt(branchIds.length || 1))));
      const branchRadius = Math.max(42, ...branchIds.map((branchId) => architectureNodeRadius(itemById.get(branchId))));
      const naturalWidth = Math.max(240, branchColumns * (branchRadius * 2 + 42) + 38, architectureNodeRadius(functionality) * 2 + 62);
      return { functionality, branchIds, branchColumns, branchRadius, naturalWidth, columnWidth: naturalWidth };
    });
    // Use the available canvas width before adding vertical depth. This keeps a
    // project recognisably tree-shaped while avoiding the old narrow, tall
    // column that made wide canvases look nearly empty.
    const usableWidth = Math.max(920, width - 80);
    const columnsPerRow = Math.max(3, Math.min(6, Math.floor(usableWidth / 270)));
    const functionalityRows = [];
    const priorityGroups = new Map();
    for (const column of functionalColumns) {
      const priority = Number(column.functionality.metadata?.interactionPriority ?? 99);
      const group = priorityGroups.get(priority) || [];
      group.push(column);
      priorityGroups.set(priority, group);
    }
    for (const group of priorityGroups.values()) {
      for (let index = 0; index < group.length; index += columnsPerRow) {
        const row = group.slice(index, index + columnsPerRow);
        const gap = 24;
        const widthBudget = Math.max(230, (usableWidth - Math.max(0, row.length - 1) * gap) / Math.max(1, row.length));
        row.forEach((column) => {
          column.columnWidth = Math.max(220, Math.min(column.naturalWidth, widthBudget));
        });
        functionalityRows.push(row);
      }
    }
    const rowGap = 24;
    const rowWidthFor = (row) => row.reduce((total, column) => total + column.columnWidth, 0) + Math.max(0, row.length - 1) * rowGap;
    const projectWidth = Math.max(320, ...functionalityRows.map(rowWidthFor));
    const rootX = projectStartX + projectWidth / 2;
    positioned.set(root.id, { ...root, x: rootX, y: 132 });
    let functionY = 360;

    for (const row of functionalityRows) {
      const rowWidth = rowWidthFor(row);
      let columnStartX = projectStartX + (projectWidth - rowWidth) / 2;
      let tallestBranchStack = 0;
      for (const column of row) {
        const functionX = columnStartX + column.columnWidth / 2;
        positioned.set(column.functionality.id, { ...column.functionality, x: functionX, y: functionY });
        const branchGapY = column.branchRadius * 2 + 58;
        const firstBranchY = functionY + 220;
        column.branchIds.forEach((branchId, branchIndex) => {
          const branch = itemById.get(branchId);
          const branchColumn = branchIndex % column.branchColumns;
          const branchRow = Math.floor(branchIndex / column.branchColumns);
          const branchX = columnStartX + ((branchColumn + 0.5) * column.columnWidth) / column.branchColumns;
          positioned.set(branchId, { ...branch, x: branchX, y: firstBranchY + branchRow * branchGapY });
        });
        tallestBranchStack = Math.max(tallestBranchStack, column.branchIds.length ? Math.ceil(column.branchIds.length / column.branchColumns) * branchGapY : 0);
        columnStartX += column.columnWidth + rowGap;
      }
      functionY += Math.max(280, 250 + tallestBranchStack);
    }
    projectStartX += projectWidth + 330;
  }

  const fallbackX = Math.max(160, width / 2);
  const fallbackY = Math.max(180, height / 2);
  return items.map((item) => positioned.get(item.id) || { ...item, x: fallbackX, y: fallbackY });
}

function architectureOrder(left, right) {
  const leftPriority = Number(left?.metadata?.interactionPriority ?? 99);
  const rightPriority = Number(right?.metadata?.interactionPriority ?? 99);
  const leftSurfaceCount = Number(left?.metadata?.surfaceFunctionalityCount || 0);
  const rightSurfaceCount = Number(right?.metadata?.surfaceFunctionalityCount || 0);
  return leftPriority - rightPriority
    || rightSurfaceCount - leftSurfaceCount
    || String(left?.metadata?.surfaceKey || "").localeCompare(String(right?.metadata?.surfaceKey || ""))
    || String(left?.label || "").localeCompare(String(right?.label || ""));
}

function architecturePod(functionality, subfunctionalityIds, branchIds, itemById) {
  // Architecture nodes carry labels below their glyphs. Size pods from the
  // same rendered-bounds contract used in Explore and Dependencies, rather
  // than from the glyph radii alone.
  const functionalityBounds = layoutNodeBounds(functionality);
  const branchBounds = branchIds.reduce(
    (largest, branchId) => {
      const bounds = layoutNodeBounds(itemById.get(branchId));
      return { halfWidth: Math.max(largest.halfWidth, bounds.halfWidth), halfHeight: Math.max(largest.halfHeight, bounds.halfHeight) };
    },
    { halfWidth: 54, halfHeight: 92 }
  );
  const subfunctionalityBounds = subfunctionalityIds.reduce(
    (largest, subfunctionalityId) => {
      const bounds = layoutNodeBounds(itemById.get(subfunctionalityId));
      return { halfWidth: Math.max(largest.halfWidth, bounds.halfWidth), halfHeight: Math.max(largest.halfHeight, bounds.halfHeight) };
    },
    { halfWidth: 42, halfHeight: 82 }
  );
  const subfunctionalityColumns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(subfunctionalityIds.length || 1))));
  const subfunctionalityRows = Math.ceil(subfunctionalityIds.length / subfunctionalityColumns);
  // A retained-evidence parent can legitimately own hundreds of recorded
  // branches. Use a wider local grid for those leaves so one honest fan-out
  // does not make the complete map thousands of pixels taller than every
  // other source-backed zone.
  const branchColumns = Math.max(1, Math.min(12, Math.ceil(Math.sqrt(branchIds.length || 1))));
  const branchRows = Math.ceil(branchIds.length / branchColumns);
  const clearance = 28;
  const subfunctionalityCellWidth = subfunctionalityBounds.halfWidth * 2 + clearance;
  const subfunctionalityCellHeight = subfunctionalityBounds.halfHeight * 2 + clearance;
  const branchCellWidth = branchBounds.halfWidth * 2 + clearance;
  const branchCellHeight = branchBounds.halfHeight * 2 + clearance;
  const horizontalPadding = 72;
  const verticalPadding = 42;
  return {
    functionality,
    subfunctionalityIds,
    functionalityBounds,
    subfunctionalityBounds,
    subfunctionalityColumns,
    subfunctionalityRows,
    subfunctionalityCellWidth,
    subfunctionalityCellHeight,
    branchIds,
    branchBounds,
    branchColumns,
    branchRows,
    branchCellWidth,
    branchCellHeight,
    width: Math.max(
      functionalityBounds.halfWidth * 2 + horizontalPadding,
      subfunctionalityColumns * subfunctionalityCellWidth + horizontalPadding,
      branchColumns * branchCellWidth + horizontalPadding
    ),
    height: verticalPadding
      + functionalityBounds.halfHeight * 2
      + (subfunctionalityIds.length ? clearance + subfunctionalityRows * subfunctionalityCellHeight : 0)
      + (branchRows ? clearance + branchRows * branchCellHeight : 0)
      + verticalPadding
  };
}

function architectureZoneGeometry(functionalities, childrenById, itemById, key) {
  const descendantSubfunctionalityIds = (parentId) => {
    const result = [];
    const visited = new Set([parentId]);
    const visit = (currentId) => {
      const children = (childrenById.get(currentId) || [])
        .filter((id) => itemById.get(id)?.agentType === "subfunctionality")
        .sort((left, right) => String(itemById.get(left)?.label || "").localeCompare(String(itemById.get(right)?.label || "")));
      for (const childId of children) {
        if (visited.has(childId)) continue;
        visited.add(childId);
        result.push(childId);
        visit(childId);
      }
    };
    visit(parentId);
    return result;
  };
  const pods = functionalities
    .slice()
    .sort(architectureOrder)
    .map((functionality) => {
      const subfunctionalityIds = descendantSubfunctionalityIds(functionality.id);
      const branchIds = [...new Set([
        ...(childrenById.get(functionality.id) || []).filter((id) => itemById.get(id)?.agentType === "branch"),
        ...subfunctionalityIds.flatMap((id) => (childrenById.get(id) || []).filter((childId) => itemById.get(childId)?.agentType === "branch"))
      ])]
        .sort((left, right) => String(itemById.get(left)?.label || "").localeCompare(String(itemById.get(right)?.label || "")));
      return architecturePod(functionality, subfunctionalityIds, branchIds, itemById);
    });
  const columns = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(pods.length * 1.25))));
  const rows = Math.max(1, Math.ceil(pods.length / columns));
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);
  pods.forEach((pod, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column], pod.width);
    rowHeights[row] = Math.max(rowHeights[row], pod.height);
  });
  const padding = 88;
  const gapX = 78;
  const gapY = 104;
  const width = padding * 2 + columnWidths.reduce((total, item) => total + item, 0) + Math.max(0, columns - 1) * gapX;
  const height = padding * 2 + rowHeights.reduce((total, item) => total + item, 0) + Math.max(0, rows - 1) * gapY;
  return {
    key,
    label: functionalities[0]?.metadata?.architectureZoneLabel || titleCase(key),
    priority: Math.min(...functionalities.map((item) => Number(item.metadata?.interactionPriority ?? 99))),
    pods,
    columns,
    columnWidths,
    rowHeights,
    padding,
    gapX,
    gapY,
    width,
    height,
    functionalityCount: functionalities.length,
    branchCount: pods.reduce((total, pod) => total + pod.branchIds.length, 0)
  };
}

function boxesOverlap(left, right, gap = 150) {
  return !(
    left.x + left.width + gap < right.x ||
    right.x + right.width + gap < left.x ||
    left.y + left.height + gap < right.y ||
    right.y + right.height + gap < left.y
  );
}

/**
 * Builds a large, draggable architecture landscape for source-backed
 * functionality zones and their local child pods. Project membership scopes
 * the projection but is not represented as a feature node.
 */
export function createArchitectureZoneLayout(items = [], links = [], width = 1200, height = 760) {
  if (!items.length) return items;
  const itemById = new Map(items.map((item) => [item.id, item]));
  const childrenById = new Map(items.map((item) => [item.id, []]));
  for (const link of links) {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    if (childrenById.has(source) && itemById.has(target)) childrenById.get(source).push(target);
  }
  const roots = items
    .filter((item) => item.type === "project" || item.agentType === "project")
    .sort((left, right) => left.label.localeCompare(right.label));
  const positioned = new Map();
  let islandStartX = Math.max(360, width * 0.28);

  roots.forEach((root, rootIndex) => {
    const functionalityIds = (childrenById.get(root.id) || []).filter((id) => {
      const child = itemById.get(id);
      return child?.agentType === "functionality" || isSourceBackedApplicationEntity(child);
    });
    const grouped = new Map();
    functionalityIds.forEach((id) => {
      const functionality = itemById.get(id);
      const key = functionality.metadata?.architectureZone || functionality.metadata?.category || "other";
      const group = grouped.get(key) || [];
      group.push(functionality);
      grouped.set(key, group);
    });
    const zones = [...grouped.entries()]
      .map(([key, functionalities]) => architectureZoneGeometry(functionalities, childrenById, itemById, key))
      .sort((left, right) => left.priority - right.priority || right.functionalityCount - left.functionalityCount || left.key.localeCompare(right.key));
    const largestZoneWidth = Math.max(900, ...zones.map((zone) => zone.width));
    const largestZoneHeight = Math.max(700, ...zones.map((zone) => zone.height));
    // The canvas intentionally has enough virtual room for the full forward
    // fan. We expand rather than squeeze pods, preserving the same bounds
    // contract used for child labels and status markers.
    const islandWidth = Math.max(width * 3.2, largestZoneWidth * 3.2 + 2500);
    const islandHeight = Math.max(height * 3.4, largestZoneHeight * 3.1 + 2200);
    const origin = { x: islandStartX + 330, y: islandHeight / 2 };
    const rootRadius = architectureNodeRadius(root);
    positioned.set(root.id, {
      ...root,
      x: origin.x,
      y: origin.y,
      metadata: {
        ...root.metadata,
        architectureZone: "genesis",
        architectureZoneBounds: null,
        architectureIsland: rootIndex,
        architectureFlow: "forward",
        architectureFlowTier: "project"
      }
    });

    const placedBoxes = [];
    zones.forEach((zone, zoneIndex) => {
      // The source-order sequence is projected into a forward 140° fan.
      // Keeping all zone centres to the right of genesis is the important
      // constraint: shared ancestry rails now read left → right instead of
      // radiating across unrelated pods.
      const ratio = zones.length <= 1 ? 0.5 : zoneIndex / (zones.length - 1);
      const angle = -1.18 + ratio * 2.36;
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      let radius = rootRadius + Math.max(zone.width, zone.height) * 0.54 + 540 + zone.priority * 70;
      let box;
      for (let attempt = 0; attempt < 36; attempt += 1) {
        const centerX = origin.x + direction.x * radius;
        const centerY = origin.y + direction.y * radius;
        box = { x: centerX - zone.width / 2, y: centerY - zone.height / 2, width: zone.width, height: zone.height };
        const overlapsRoot = boxesOverlap(box, { x: origin.x - rootRadius, y: origin.y - rootRadius, width: rootRadius * 2, height: rootRadius * 2 }, 260);
        if (!overlapsRoot && !placedBoxes.some((placed) => boxesOverlap(box, placed, 170))) break;
        radius += Math.max(300, Math.min(720, Math.max(zone.width, zone.height) * 0.2));
      }
      placedBoxes.push(box);
      const zoneBounds = {
        id: `${root.id}:${zone.key}`,
        key: zone.key,
        label: zone.label,
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(zone.width),
        height: Math.round(zone.height),
        functionalityCount: zone.functionalityCount,
        branchCount: zone.branchCount,
        index: zoneIndex,
        flowAngle: angle,
        flowDirection: "forward"
      };
      const columnOffsets = [];
      let nextX = box.x + zone.padding;
      zone.columnWidths.forEach((columnWidth) => {
        columnOffsets.push(nextX);
        nextX += columnWidth + zone.gapX;
      });
      const rowOffsets = [];
      let nextY = box.y + zone.padding;
      zone.rowHeights.forEach((rowHeight) => {
        rowOffsets.push(nextY);
        nextY += rowHeight + zone.gapY;
      });
      zone.pods.forEach((pod, podIndex) => {
        const column = podIndex % zone.columns;
        const naturalRow = Math.floor(podIndex / zone.columns);
        // For an upper zone, high-priority UI pods begin on the edge nearest
        // genesis and branch away from it. This keeps interaction surfaces
        // close to the centre and prevents root connectors crossing their own
        // branch descendants.
        const row = direction.y < -0.45 ? zone.rowHeights.length - 1 - naturalRow : naturalRow;
        const podX = columnOffsets[column] + (zone.columnWidths[column] - pod.width) / 2;
        const podY = rowOffsets[row] + (zone.rowHeights[row] - pod.height) / 2;
        const functionX = podX + pod.width / 2;
        const branchesGrowUpward = direction.y < -0.45;
        const functionY = branchesGrowUpward
          ? podY + pod.height - pod.functionalityBounds.halfHeight - 42
          : podY + pod.functionalityBounds.halfHeight + 42;
        const placement = {
          architectureZoneBounds: zoneBounds,
          architectureZoneIndex: zoneIndex,
          architectureZoneMemberIndex: podIndex,
          architectureZoneMemberCount: zone.pods.length,
          architectureIsland: rootIndex,
          architectureFlow: "forward"
        };
        positioned.set(pod.functionality.id, {
          ...pod.functionality,
          x: functionX,
          y: functionY,
          metadata: { ...pod.functionality.metadata, ...placement, architectureFlowTier: "functionality" }
        });
        const directionSign = branchesGrowUpward ? -1 : 1;
        const firstSubfunctionalityY = functionY + directionSign * (
          pod.functionalityBounds.halfHeight + pod.subfunctionalityBounds.halfHeight + 28
        );
        pod.subfunctionalityIds.forEach((subfunctionalityId, subfunctionalityIndex) => {
          const subfunctionality = itemById.get(subfunctionalityId);
          const childColumn = subfunctionalityIndex % pod.subfunctionalityColumns;
          const childRow = Math.floor(subfunctionalityIndex / pod.subfunctionalityColumns);
          const childX = podX + ((childColumn + 0.5) * pod.width) / pod.subfunctionalityColumns;
          positioned.set(subfunctionalityId, {
            ...subfunctionality,
            x: childX,
            y: firstSubfunctionalityY + directionSign * childRow * pod.subfunctionalityCellHeight,
            metadata: {
              ...subfunctionality.metadata,
              ...placement,
              architecturePodId: pod.functionality.id,
              architectureFlowTier: "code-unit"
            }
          });
        });
        const firstBranchY = pod.subfunctionalityIds.length
          ? firstSubfunctionalityY + directionSign * (
            Math.max(0, pod.subfunctionalityRows - 1) * pod.subfunctionalityCellHeight
            + pod.subfunctionalityBounds.halfHeight + pod.branchBounds.halfHeight + 28
          )
          : functionY + directionSign * (pod.functionalityBounds.halfHeight + pod.branchBounds.halfHeight + 28);
        pod.branchIds.forEach((branchId, branchIndex) => {
          const branch = itemById.get(branchId);
          const branchColumn = branchIndex % pod.branchColumns;
          const branchRow = Math.floor(branchIndex / pod.branchColumns);
          const branchX = podX + ((branchColumn + 0.5) * pod.width) / pod.branchColumns;
          positioned.set(branchId, {
            ...branch,
            x: branchX,
            y: firstBranchY + directionSign * branchRow * pod.branchCellHeight,
            metadata: {
              ...branch.metadata,
              ...placement,
              architecturePodId: pod.functionality.id,
              architectureFlowTier: "branch"
            }
          });
        });
      });
    });
    islandStartX += islandWidth + Math.max(900, largestZoneWidth * 0.45);
  });

  const fallbackX = Math.max(180, width / 2);
  const fallbackY = Math.max(180, height / 2);
  return items.map((item) => positioned.get(item.id) || { ...item, x: fallbackX, y: fallbackY });
}

function isArchitectureProjectNode(node = {}) {
  return node.type === "project" || node.agentType === "project";
}

function isArchitectureFunctionalityNode(node = {}) {
  return node.type === "application_functionality" || node.agentType === "functionality" || isSourceBackedApplicationEntity(node);
}

function isArchitectureTreeLink(link = {}) {
  const type = String(link.type || "").toLowerCase();
  return isHierarchyLink(link)
    || type.includes("architecture_branch")
    || type.includes("supports_architecture_branch")
    || type.includes("rejected_architecture_branch");
}

function edgePlanLinkId(link = {}, index = 0) {
  return link.id || `architecture-link:${nodeId(link.source)}:${nodeId(link.target)}:${String(link.type || "relationship").toLowerCase()}:${index}`;
}

/**
 * Turns a complete Architecture projection into a visual routing plan without
 * changing its meaning. Project-to-functionality relationships share one
 * labelled zone rail, and unusually wide evidence parents share one ordered
 * fan-out rail. Every source relationship remains in exactly one semantic
 * membership list; the additional spine and stub records are visual routing
 * segments, not inferred graph edges.
 */
export function createArchitectureEdgePlan(items = [], links = [], options = {}) {
  const fanoutThreshold = Math.max(4, Number(options.fanoutThreshold || 12));
  const nodeById = new Map(items.map((item) => [item.id, item]));
  const records = links
    .map((link, index) => ({
      ...link,
      id: edgePlanLinkId(link, index),
      source: nodeId(link.source),
      target: nodeId(link.target),
      index
    }))
    .filter((link) => nodeById.has(link.source) && nodeById.has(link.target));
  const zoneGroups = new Map();
  const outgoingTreeLinks = new Map();

  records.forEach((link) => {
    const source = nodeById.get(link.source);
    const target = nodeById.get(link.target);
    if (isArchitectureProjectNode(source) && isArchitectureFunctionalityNode(target) && isArchitectureTreeLink(link)) {
      const bounds = target.metadata?.architectureZoneBounds;
      const key = bounds?.id || `${source.id}:${target.metadata?.architectureZone || target.metadata?.category || "other"}`;
      const group = zoneGroups.get(key) || {
        id: key,
        sourceId: source.id,
        zoneKey: bounds?.key || target.metadata?.architectureZone || target.metadata?.category || "other",
        zoneLabel: bounds?.label || target.metadata?.architectureZoneLabel || titleCase(target.metadata?.architectureZone || target.metadata?.category || "other"),
        zoneBounds: bounds || null,
        links: []
      };
      group.links.push(link);
      zoneGroups.set(key, group);
      return;
    }
    if (!isArchitectureProjectNode(source) && isArchitectureTreeLink(link)) {
      // Fan-out is safe only inside one parent pod and one relationship
      // meaning/status family. A visible rail must never merge an observed
      // branch with a disabled one (or a child record with a branch record).
      const targetStatus = target.metadata?.disabled ? "disabled" : target.metadata?.bucket || target.statusGroup || "active";
      const groupKey = `${source.id}:${String(link.type || "relationship").toLowerCase()}:${targetStatus}:${source.metadata?.architecturePodId || source.id}`;
      const group = outgoingTreeLinks.get(groupKey) || [];
      group.push(link);
      outgoingTreeLinks.set(groupKey, group);
    }
  });

  const highFanoutByLinkId = new Map();
  outgoingTreeLinks.forEach((outgoing) => {
    if (outgoing.length <= fanoutThreshold) return;
    const sourceId = outgoing[0].source;
    const source = nodeById.get(sourceId);
    const ordered = outgoing.slice().sort((left, right) => {
      const leftNode = nodeById.get(left.target);
      const rightNode = nodeById.get(right.target);
      return Number(leftNode?.metadata?.sourceOffset || 0) - Number(rightNode?.metadata?.sourceOffset || 0)
        || String(leftNode?.label || "").localeCompare(String(rightNode?.label || ""));
    });
    const type = String(ordered[0]?.type || "relationship").toLowerCase();
    const targetStatus = nodeById.get(ordered[0]?.target)?.metadata?.disabled ? "disabled" : nodeById.get(ordered[0]?.target)?.metadata?.bucket || nodeById.get(ordered[0]?.target)?.statusGroup || "active";
    const groupId = `architecture-fanout:${sourceId}:${type}:${targetStatus}`;
    ordered.forEach((link) => highFanoutByLinkId.set(link.id, { id: groupId, sourceId, links: ordered, source }));
  });

  const visualLinks = [];
  const semanticMembership = new Map();
  const addSemantic = (link, record) => {
    if (!semanticMembership.has(link.id)) semanticMembership.set(link.id, []);
    semanticMembership.get(link.id).push(record.id);
  };

  [...zoneGroups.values()]
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId) || left.zoneLabel.localeCompare(right.zoneLabel))
    .forEach((group) => {
      const targetIds = group.links.map((link) => link.target);
      const unresolvedEvidence = group.links.every((link) => nodeById.get(link.target)?.metadata?.unresolvedEvidence);
      const rail = {
        id: `architecture-zone-rail:${group.id}`,
        kind: "zone-rail",
        source: group.sourceId,
        target: targetIds[0],
        targetIds,
        sourceLinkIds: group.links.map((link) => link.id),
        relationCount: group.links.length,
        type: "contains_application_entity",
        zoneId: group.id,
        zoneKey: group.zoneKey,
        zoneLabel: group.zoneLabel,
        zoneBounds: group.zoneBounds,
        label: unresolvedEvidence
          ? `${group.zoneLabel} · ${group.links.length} retained ${group.links.length === 1 ? "record" : "records"}`
          : `${group.zoneLabel} · ${group.links.length} ${group.links.length === 1 ? "entity" : "entities"}`,
        metadata: { architectureLens: true, bundled: true, unresolvedEvidence, routing: "zone-rail" }
      };
      visualLinks.push(rail);
      group.links.forEach((link) => addSemantic(link, rail));
      visualLinks.push({
        id: `architecture-zone-spine:${group.id}`,
        kind: "zone-spine",
        source: group.sourceId,
        target: targetIds[0],
        targetIds,
        zoneId: group.id,
        zoneKey: group.zoneKey,
        zoneLabel: group.zoneLabel,
        zoneBounds: group.zoneBounds,
        relationCount: group.links.length,
        type: "contains_application_entity",
        metadata: { architectureLens: true, bundled: true, unresolvedEvidence, routing: "zone-spine" }
      });
      group.links.forEach((link) => {
        visualLinks.push({
          id: `architecture-zone-stub:${link.id}`,
          kind: "zone-stub",
          source: link.source,
          target: link.target,
          sourceLinkId: link.id,
          targetIds,
          relationCount: group.links.length,
          type: link.type,
          zoneId: group.id,
          zoneKey: group.zoneKey,
          zoneBounds: group.zoneBounds,
          metadata: { ...(link.metadata || {}), architectureLens: true, bundled: true, unresolvedEvidence, routing: "zone-stub" }
        });
      });
    });

  const emittedFanoutGroups = new Set();
  records.forEach((link) => {
    const source = nodeById.get(link.source);
    const target = nodeById.get(link.target);
    const zoneKey = source && isArchitectureProjectNode(source) && isArchitectureFunctionalityNode(target)
      ? (target.metadata?.architectureZoneBounds?.id || `${source.id}:${target.metadata?.architectureZone || target.metadata?.category || "other"}`)
      : "";
    if (zoneKey && zoneGroups.has(zoneKey)) return;
    const fanout = highFanoutByLinkId.get(link.id);
    if (fanout) {
      if (emittedFanoutGroups.has(fanout.id)) return;
      emittedFanoutGroups.add(fanout.id);
      const targetIds = fanout.links.map((member) => member.target);
      const rail = {
        id: `${fanout.id}:rail`,
        kind: "fanout-rail",
        source: fanout.sourceId,
        target: targetIds[0],
        targetIds,
        sourceLinkIds: fanout.links.map((member) => member.id),
        relationCount: fanout.links.length,
        type: fanout.links[0]?.type || "relationship",
        label: fanout.source?.metadata?.unresolvedEvidence
          ? `${fanout.links.length} unmapped branch records`
          : `${fanout.links.length} recorded child relationships`,
        metadata: { architectureLens: true, bundled: true, routing: "fanout-rail" }
      };
      visualLinks.push(rail);
      fanout.links.forEach((member) => addSemantic(member, rail));
      visualLinks.push({
        id: `${fanout.id}:spine`,
        kind: "fanout-spine",
        source: fanout.sourceId,
        target: targetIds[0],
        targetIds,
        relationCount: fanout.links.length,
        type: fanout.links[0]?.type || "relationship",
        metadata: { architectureLens: true, bundled: true, routing: "fanout-spine" }
      });
      fanout.links.forEach((member) => {
        visualLinks.push({
          id: `${fanout.id}:stub:${member.id}`,
          kind: "fanout-stub",
          source: member.source,
          target: member.target,
          sourceLinkId: member.id,
          targetIds,
          relationCount: fanout.links.length,
          type: member.type,
          metadata: { ...(member.metadata || {}), architectureLens: true, bundled: true, routing: "fanout-stub" }
        });
      });
      return;
    }
    const inferred = String(link.type || "").toLowerCase() === "static_inferred_flow";
    const visual = {
      ...link,
      id: `architecture-link:${link.id}`,
      sourceLinkIds: [link.id],
      kind: inferred ? "evidence-flow" : "local-tree",
      metadata: { ...(link.metadata || {}), architectureLens: true, routing: inferred ? "evidence-gutter" : "local-twig" }
    };
    visualLinks.push(visual);
    addSemantic(link, visual);
  });

  const missingLinkIds = records.filter((link) => !semanticMembership.has(link.id)).map((link) => link.id);
  const duplicatedLinkIds = [...semanticMembership.entries()]
    .filter(([, memberships]) => memberships.length !== 1)
    .map(([linkId]) => linkId);
  const relationTypeCounts = records.reduce((counts, link) => {
    const type = String(link.type || "relationship");
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  return {
    visualLinks,
    sourceLinks: records,
    semanticMembership,
    railCount: visualLinks.filter((link) => link.kind === "zone-rail" || link.kind === "fanout-rail").length,
    relationTypeCounts,
    missingLinkIds,
    duplicatedLinkIds
  };
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
  const viewMode = state.viewMode || "overview";
  const requestedProject = String(state.filters?.project || "");
  const rawFiltered = applyGraphFilters(model, state.filters);
  const portfolioOverview = viewMode === "overview" && !requestedProject;
  const requiresProjectScope = ["dependency", "flow", "explore"].includes(viewMode) && !requestedProject;
  const source = portfolioOverview ? { nodes: model.nodes, links: model.links } : rawFiltered;
  const filtered = requiresProjectScope ? { nodes: [], links: [] } : source;
  const overviewNodes = source.nodes.filter(isOverviewEntity);
  const overviewIds = new Set(overviewNodes.map((node) => node.id));
  const overviewLinks = source.links.filter((link) => overviewIds.has(link.source) && overviewIds.has(link.target));
  const projectModel = buildProjectClusters(overviewNodes, overviewLinks, source.nodes);
  const clustersModel = projectModel.capabilityModel;
  const expanded = state.expandedClusters || new Set();
  const selectedId = preserveSelectionThroughFilters(model, state.selectedId, state.filters);
  const focus = focusNeighborhood(model, selectedId);
  let items = [];
  let links = [];
  let hiddenClusterCount = 0;
  let lens = null;
  let flow = null;

  if (viewMode === "explore") {
    const architecture = buildArchitectureBranchSummary(filtered.nodes, filtered.links);
    items = architecture.nodes;
    links = architecture.links;
  } else if (viewMode === "flow") {
    flow = buildFunctionalityFlow(filtered.nodes, filtered.links, state.flowMajorFeatureId);
    items = flow.nodes;
    links = flow.links;
  } else if (viewMode === "overview") {
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
    // Overview is a Finder-style portfolio outline. It intentionally draws
    // only disclosure relationships, never cross-project topology spaghetti.
    links = hierarchyLinks.filter((link) => ids.has(link.source) && ids.has(link.target));
    if (!expanded.size && !selectedId) {
      hiddenClusterCount = Math.max(0, items.length - 24);
      items = items.slice(0, 24);
      const kept = new Set(items.map((item) => item.id));
      links = links.filter((link) => kept.has(link.source) && kept.has(link.target));
    }
  } else if (viewMode === "dependency") {
    lens = buildDependencyLens(filtered.nodes, filtered.links, selectedId);
    items = lens.nodes;
    links = lens.links;
  } else {
    items = filtered.nodes;
    links = filtered.links;
    // The remaining views retain their complete filtered topology; selection
    // only changes visual emphasis.
  }

  const saved = loadPositions(state.storage, state.filters?.project || "all", viewMode);
  const layoutLinks = links.map((link) => ({ ...link, source: nodeId(link.source), target: nodeId(link.target) }));
  const laidOut =
    viewMode === "overview"
      ? createOverviewLayout(items, width, height)
      : viewMode === "explore"
      ? createArchitectureFreeForceSeedLayout(items, layoutLinks, width, height)
      : viewMode === "dependency"
        ? createDependencyLayout(items, layoutLinks, width, height)
      : viewMode === "flow"
        ? createFunctionalityFlowLayout(items, layoutLinks, width, height)
      : createDagreLayout(items, layoutLinks, width, height, dagreApi);
  items = viewMode === "dependency"
    ? laidOut
    : viewMode === "explore"
      ? applyArchitectureSavedPositions(laidOut, saved)
      : applySavedPositions(laidOut, saved);

  return { items, links: layoutLinks, clusters: projectModel.clusters, focus, selectedId, hiddenClusterCount, lens, flow };
}
