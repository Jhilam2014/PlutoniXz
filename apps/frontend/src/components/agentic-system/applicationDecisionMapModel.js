import { analysisFunctionalities, branchRows } from "../../plutonixAnalysisModel.js";

// A selected ledger branch is a decision outcome too. It used to be omitted
// from the application map because the first version only rendered alternative
// options. Keep the complete branch set here so the delivery projection can
// place selected, deferred, and rejected outcomes on the recorded build event
// that establishes their functionality.
const DECISION_OPTION_STATES = new Set(["selected", "deferred", "rejected", "anticipated", "anticipated_rejected"]);
const RECORDED_BUILD_DECISION_STATES = new Set(["selected", "deferred", "rejected"]);

function text(value) {
  return String(value || "").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sourcePath(reference = "") {
  return text(reference).replace(/:\d+(?::\d+)?$/, "");
}

function normalizedFilePath(value = "") {
  return sourcePath(text(value))
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
}

function validDate(value = "") {
  const source = text(value);
  const timestamp = source ? Date.parse(source) : Number.NaN;
  return Number.isFinite(timestamp) ? { value: new Date(timestamp).toISOString(), timestamp } : { value: "", timestamp: Number.NaN };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function evidencePaths(row = {}) {
  return unique([
    ...asArray(row.evidence).map((item) => sourcePath(item?.reference || item)),
    ...asArray(row.features).flatMap((feature) => asArray(feature?.evidence).map((item) => sourcePath(item?.reference || item))),
    ...asArray(row.features).map((feature) => feature?.sourceHints?.ui?.sourcePath || feature?.sourceHints?.route?.sourcePath),
    row?.sourceHints?.ui?.sourcePath,
    row?.sourceHints?.route?.sourcePath
  ]);
}

function normalizedPaths(values = []) {
  return unique(values.map(normalizedFilePath).filter(Boolean));
}

function entityPaths(node = {}) {
  const metadata = node.metadata || {};
  const sourceHints = metadata.sourceHints || {};
  return unique([
    sourceHints.ui?.sourcePath,
    sourceHints.route?.sourcePath,
    sourceHints.database?.sourcePath,
    ...asArray(metadata.evidence).map((item) => sourcePath(item?.reference || item))
  ]);
}

function nodeId(value) {
  return typeof value === "object" && value ? value.id : value;
}

function graphEntitiesForProject(graph = {}, projectId = "") {
  return asArray(graph.nodes).filter((node) => text(node?.metadata?.projectId) === text(projectId));
}

function entitiesForFunctionality(functionality, entities, projectId = "") {
  const paths = new Set(normalizedPaths(evidencePaths(functionality)));
  const rawSourceEntityIds = unique([
    functionality.sourceEntityId,
    ...asArray(functionality.sourceEntityIds)
  ]);
  // Dynamic project topology scopes source entity IDs as
  // `functionality:<projectId>:<sourceEntityId>`; preserve the raw ID too for
  // imported/static topology. Both are deterministic exact IDs, never labels.
  const sourceEntityIds = new Set(unique([
    ...rawSourceEntityIds,
    ...rawSourceEntityIds.map((id) => projectId ? `functionality:${projectId}:${id}` : "")
  ]));
  return entities.filter((entity) => {
    const candidatePaths = normalizedPaths(entityPaths(entity));
    // Ownership is a factual topology relationship only where the report and
    // entity share an exact source entity ID or normalized source path. A
    // same-labelled node is useful for search, but is not enough evidence to
    // claim that an agent implements this functionality.
    return sourceEntityIds.has(text(entity.id)) || candidatePaths.some((path) => paths.has(path));
  });
}

function supportingEntities(entityIds, entitiesById, links) {
  const candidates = new Map();
  const visited = new Set(entityIds);
  let frontier = [...entityIds];
  // A UI node commonly reaches a service through an API. Two bounded hops
  // preserve that useful chain without turning the decision map into a full
  // application dependency explorer.
  for (let depth = 0; depth < 2 && frontier.length; depth += 1) {
    const next = [];
    for (const currentId of frontier) for (const link of links) {
      const source = text(nodeId(link.source));
      const target = text(nodeId(link.target));
      const peerId = source === currentId ? target : target === currentId ? source : "";
      const peer = entitiesById.get(peerId);
      if (!peer) continue;
      if (["api", "service", "database"].includes(peer.type)) candidates.set(peer.id, peer);
      if (!visited.has(peerId)) {
        visited.add(peerId);
        next.push(peerId);
      }
    }
    frontier = next;
  }
  return [...candidates.values()];
}

function normalizedDecisionBranches(value = []) {
  const rows = asArray(value).filter((branch) => branch && typeof branch === "object");
  return rows.every((branch) => branch.recordClassification) ? rows : branchRows(rows);
}

function decisionOptionsByFunctionality(decisionBranches = []) {
  const options = new Map();
  for (const branch of normalizedDecisionBranches(decisionBranches)) {
    const functionalityId = text(branch.functionalityId);
    if (!functionalityId || !DECISION_OPTION_STATES.has(text(branch.state))) continue;
    const rows = options.get(functionalityId) || [];
    rows.push(branch);
    options.set(functionalityId, rows);
  }
  for (const rows of options.values()) {
    rows.sort((left, right) => String(left.label || left.id).localeCompare(String(right.label || right.id)) || String(left.id).localeCompare(String(right.id)));
  }
  return options;
}

/**
 * Human-readable option provenance for each renderer. This deliberately keeps
 * source-derived alternatives distinct from a ledger disposition or a report
 * summary that has no verifiable lineage/time.
 */
export function decisionOptionPresentation(option = {}) {
  const state = text(option.state);
  const classification = text(option.recordClassification);
  if (state === "selected") {
    return classification === "recorded_summary"
      ? { label: "REPORTED SELECTED", detail: "Report disposition · lineage/time unavailable", tone: "recorded" }
      : { label: "RECORDED SELECTED", detail: "Governed ledger selection", tone: "recorded" };
  }
  if (state === "anticipated_rejected") return { label: "ANTICIPATED REJECTION", detail: "Source-derived possibility · not historical", tone: "anticipated_rejected" };
  if (state === "anticipated") return { label: "ANTICIPATED OPTION", detail: "Source-derived possibility · not historical", tone: "anticipated" };
  if (state === "deferred") {
    return classification === "recorded_summary"
      ? { label: "REPORTED DEFERRED", detail: "Report disposition · lineage/time unavailable", tone: "deferred" }
      : { label: "RECORDED DEFERRED", detail: "Governed ledger disposition", tone: "deferred" };
  }
  if (state === "rejected") {
    return classification === "recorded_summary"
      ? { label: "REPORTED REJECTED", detail: "Report disposition · lineage/time unavailable", tone: "rejected" }
      : { label: "RECORDED REJECTED", detail: "Governed ledger disposition", tone: "rejected" };
  }
  return { label: "DECISION OPTION", detail: "Recorded decision context", tone: "recorded" };
}

function analysisAssignmentsByFunctionality(architectureAnalysisReport = null) {
  const rows = new Map();
  for (const assignment of asArray(architectureAnalysisReport?.assignments)) {
    const functionalityId = text(assignment?.functionalityId);
    const agentId = text(assignment?.agentId);
    if (!functionalityId || !agentId) continue;
    const assignments = rows.get(functionalityId) || [];
    assignments.push(assignment);
    rows.set(functionalityId, assignments);
  }
  return rows;
}

function functionalityAssignmentKeys(functionality = {}) {
  return unique([
    functionality.id,
    functionality.sourceEntityId,
    ...asArray(functionality.sourceEntityIds)
  ]);
}

function agentIdentityKeys(...values) {
  return new Set(unique(values.flatMap((value) => {
    const id = text(value);
    if (!id) return [];
    return id.startsWith("agent:") ? [id, id.slice("agent:".length)] : [id, `agent:${id}`];
  })));
}

// Analysis assignments can originate from the source functionality while the
// decision report groups it into a major functionality. Those are exact IDs
// in the same source record, so they are valid associations; display names are
// deliberately never used as a fallback.
function assignmentsForFunctionality(assignmentsByFunctionality, functionality = {}) {
  const seen = new Set();
  return functionalityAssignmentKeys(functionality)
    .flatMap((key) => asArray(assignmentsByFunctionality.get(key)))
    .filter((assignment) => {
      const identity = [text(assignment?.agentId), text(assignment?.assignment || assignment?.responsibilityMatch), text(assignment?.id)].join("\u001f");
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
}

// Agent visuals are a rendering aid, not a new ownership claim.  Keep their
// type provenance constrained to structured topology or assignment fields so
// a convenient display label never becomes an invented responsibility.
const AGENT_VISUAL_TYPES = Object.freeze({
  "project-orchestrator": { category: "orchestration", iconKey: "orchestrator", colorKey: "orchestration" },
  "qagent-controller": { category: "orchestration", iconKey: "controller", colorKey: "orchestration" },
  "project-execution": { category: "engineering", iconKey: "code", colorKey: "engineering" },
  "fullstack": { category: "engineering", iconKey: "code", colorKey: "engineering" },
  "application-architecture": { category: "architecture", iconKey: "architecture", colorKey: "architecture" },
  "service-runtime": { category: "engineering", iconKey: "runtime", colorKey: "engineering" },
  "runtime-packaging": { category: "engineering", iconKey: "package", colorKey: "engineering" },
  "service-validation": { category: "validation", iconKey: "check", colorKey: "validation" },
  "experience-composition": { category: "experience", iconKey: "design", colorKey: "experience" },
  "design-workshop-review": { category: "experience", iconKey: "review", colorKey: "experience" },
  "ui-functionality-mapper": { category: "experience", iconKey: "layout", colorKey: "experience" },
  "data-contract": { category: "data", iconKey: "database", colorKey: "data" },
  "governance-security": { category: "security", iconKey: "shield", colorKey: "security" },
  "commerce-catalog": { category: "commerce", iconKey: "catalog", colorKey: "commerce" },
  "pricing-conversion": { category: "commerce", iconKey: "pricing", colorKey: "commerce" },
  "analytics-dashboard": { category: "analytics", iconKey: "chart", colorKey: "analytics" },
  "media-asset": { category: "media", iconKey: "media", colorKey: "media" },
  "artifact-production": { category: "artifact", iconKey: "document", colorKey: "artifact" },
  "independent-reviewer": { category: "review", iconKey: "review", colorKey: "review" },
  "general": { category: "general", iconKey: "agent", colorKey: "general" }
});

const AGENT_VISUAL_TYPE_ALIASES = Object.freeze({
  "project-execution-fallback": "project-execution",
  "plutonix-fullstack": "fullstack",
  "global-plutonix-orchestrator": "project-orchestrator",
  "adaptive-review": "independent-reviewer",
  "review-agent": "independent-reviewer",
  "independent-review": "independent-reviewer",
  ui: "experience-composition",
  frontend: "experience-composition",
  api: "application-architecture",
  backend: "application-architecture",
  service: "service-runtime",
  data: "data-contract",
  security: "governance-security",
  quality: "service-validation",
  test: "service-validation",
  analytics: "analytics-dashboard",
  media: "media-asset"
});

const GENERIC_AGENT_VISUAL_TYPES = new Set([
  "agent",
  "reusable-agent",
  "global-agent",
  "project-agent-assignment",
  "system-support-agent",
  "unknown",
  "none"
]);

function normalizedAgentVisualType(value = "") {
  return text(value)
    .toLowerCase()
    .replace(/[_\s/]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function agentVisualCandidate(value, source) {
  const rawType = normalizedAgentVisualType(value);
  if (!rawType || GENERIC_AGENT_VISUAL_TYPES.has(rawType)) return null;
  return {
    rawType,
    agentType: AGENT_VISUAL_TYPE_ALIASES[rawType] || rawType,
    source
  };
}

function agentVisualPresentation({ source = null, assignment = null } = {}) {
  const metadata = source?.metadata || {};
  const candidates = [
    [metadata.agentType, "topology_metadata_agent_type"],
    [metadata.agent_type, "topology_metadata_agent_type"],
    [metadata.agentCategory, "topology_metadata_agent_category"],
    [metadata.agent_category, "topology_metadata_agent_category"],
    [metadata.agentRole, "topology_metadata_agent_role"],
    [metadata.agent_role, "topology_metadata_agent_role"],
    [metadata.role, "topology_metadata_role"],
    [source?.agentType, "topology_agent_type"],
    [source?.agent_type, "topology_agent_type"],
    [source?.agentRole, "topology_agent_role"],
    [source?.agent_role, "topology_agent_role"],
    [source?.role, "topology_role"],
    [source?.cluster_id, "topology_cluster_id"],
    [source?.group, "topology_group"],
    [assignment?.agentType, "assignment_agent_type"],
    [assignment?.agent_type, "assignment_agent_type"],
    [assignment?.agentCategory, "assignment_agent_category"],
    [assignment?.agent_category, "assignment_agent_category"],
    [assignment?.agentRole, "assignment_agent_role"],
    [assignment?.agent_role, "assignment_agent_role"],
    [assignment?.role, "assignment_role"],
    [assignment?.responsibilityMatch, "assignment_responsibility_match"]
  ];
  const resolved = candidates
    .map(([value, sourceName]) => agentVisualCandidate(value, sourceName))
    .find(Boolean)
    || { rawType: "", agentType: "general", source: "fallback" };
  const visual = AGENT_VISUAL_TYPES[resolved.agentType] || AGENT_VISUAL_TYPES.general;
  return {
    agentType: resolved.agentType,
    agentCategory: visual.category,
    iconKey: visual.iconKey,
    colorKey: visual.colorKey,
    visualProvenance: {
      source: resolved.source,
      rawType: resolved.rawType,
      explicit: resolved.source !== "fallback"
    }
  };
}

function firstExplicitAgentField(candidates = []) {
  for (const [value, source] of candidates) {
    const resolved = text(value);
    if (resolved) return { value: resolved, source };
  }
  return { value: "", source: "unavailable" };
}

function agentInsightMetadata({ agentId, source = null, assignment = null } = {}) {
  const metadata = source?.metadata || {};
  const role = firstExplicitAgentField([
    [metadata.agentRole, "topology_metadata_agent_role"],
    [metadata.agent_role, "topology_metadata_agent_role"],
    [metadata.role, "topology_metadata_role"],
    [source?.agentRole, "topology_agent_role"],
    [source?.agent_role, "topology_agent_role"],
    [source?.role, "topology_role"],
    [source?.cluster_id, "topology_cluster_id"],
    [assignment?.agentRole, "assignment_agent_role"],
    [assignment?.agent_role, "assignment_agent_role"],
    [assignment?.role, "assignment_role"],
    [assignment?.responsibilityMatch, "assignment_responsibility_match"]
  ]);
  const responsibility = firstExplicitAgentField([
    [metadata.responsibility, "topology_metadata_responsibility"],
    [source?.responsibility, "topology_responsibility"],
    [assignment?.projectResponsibility, "assignment_project_responsibility"],
    [assignment?.responsibility, "assignment_responsibility"]
  ]);
  const description = firstExplicitAgentField([
    [metadata.description, "topology_metadata_description"],
    [source?.description, "topology_description"],
    [assignment?.description, "assignment_description"]
  ]);
  const clusterId = firstExplicitAgentField([
    [source?.cluster_id, "topology_cluster_id"],
    [metadata.clusterId, "topology_metadata_cluster_id"],
    [metadata.cluster_id, "topology_metadata_cluster_id"]
  ]);
  const group = firstExplicitAgentField([
    [source?.group, "topology_group"],
    [metadata.group, "topology_metadata_group"]
  ]);
  return {
    agentId: text(source?.agent_id || agentId),
    role: role.value,
    responsibility: responsibility.value,
    description: description.value,
    clusterId: clusterId.value,
    group: group.value,
    metadataProvenance: {
      role: role.source,
      responsibility: responsibility.source,
      description: description.source,
      clusterId: clusterId.source,
      group: group.source
    }
  };
}

function agentNode({ agentId, source = null, assignment = null, associationBasis = "analysis_assignment" } = {}) {
  const sourceMetadata = source?.metadata || {};
  const analysisDetail = text(assignment?.assignment || assignment?.responsibilityMatch);
  const recorded = associationBasis === "direct_topology_link";
  const visual = agentVisualPresentation({ source, assignment });
  const insight = agentInsightMetadata({ agentId, source, assignment });
  return {
    id: `decision-agent:${agentId}`,
    kind: "agent",
    label: source?.label || source?.agent_id || agentId || "Assigned agent",
    detail: recorded
      ? sourceMetadata.responsibility || sourceMetadata.description || "Recorded implementation owner."
      : analysisDetail ? `Analysis assignment · ${analysisDetail}` : "Analysis assignment for this functionality.",
    status: source?.status || (recorded ? "recorded" : "analysis_assignment"),
    associationBasis,
    ...insight,
    ...visual,
    category: visual.agentCategory,
    column: "agent"
  };
}

/**
 * Projects a source-backed application report into a compact decision map.
 * The map deliberately uses only topology relationships already present in
 * the graph: an absent ownership or dependency is shown as absent, not guessed.
 */
export function buildApplicationDecisionMap({ project = {}, architectureAnalysisReport = null, topology = null, decisionBranches = [] } = {}) {
  const projectId = text(project.id || architectureAnalysisReport?.projectId);
  const projectName = text(project.name) || "Application";
  const functionalities = analysisFunctionalities(architectureAnalysisReport || {});
  const projectEntities = graphEntitiesForProject(topology || {}, projectId);
  const projectEntityIds = new Set(projectEntities.map((entity) => entity.id));
  const entitiesById = new Map(projectEntities.map((entity) => [entity.id, entity]));
  const allNodesById = new Map(asArray(topology?.nodes).map((node) => [node.id, node]));
  const graphLinks = asArray(topology?.links).filter((link) => projectEntityIds.has(text(nodeId(link.source))) || projectEntityIds.has(text(nodeId(link.target))));
  const optionsByFunctionality = decisionOptionsByFunctionality(decisionBranches);
  const assignmentsByFunctionality = analysisAssignmentsByFunctionality(architectureAnalysisReport);
  const root = {
    id: `decision-project:${projectId || "current"}`,
    kind: "project",
    label: projectName,
    detail: "Application decision root",
    applicationOrigin: architectureAnalysisReport?.applicationOrigin || null,
    projectId,
    column: "root"
  };
  const nodes = [root];
  const links = [];
  const agents = new Map();
  const services = new Map();
  const options = new Map();
  const entityIdsByFunctionality = new Map();

  for (const functionality of functionalities) {
    const functionalityNode = {
      id: `decision-functionality:${functionality.id}`,
      kind: "functionality",
      label: functionality.label,
      detail: functionality.description || "Source-observed application capability.",
      description: functionality.description || "",
      category: functionality.category,
      evidenceCount: functionality.evidence.length,
      evidence: asArray(functionality.evidence),
      evidencePaths: normalizedPaths(evidencePaths(functionality)),
      sourceFunctionalityId: functionality.id,
      sourceEntityId: functionality.sourceEntityId || "",
      sourceEntityIds: unique([functionality.sourceEntityId, ...asArray(functionality.sourceEntityIds)]),
      features: asArray(functionality.features),
      sourceSequence: functionality.sequence || {},
      column: "functionality"
    };
    nodes.push(functionalityNode);
    links.push({ id: `${root.id}->${functionalityNode.id}`, source: root.id, target: functionalityNode.id, kind: "decision" });

    // A branch is related only through an exact major-functionality ID. We do
    // not use labels/evidence as a surrogate decision relationship.
    for (const branch of optionsByFunctionality.get(functionality.id) || []) {
      const id = `decision-option:${branch.id}`;
      if (!options.has(id)) {
        const presentation = decisionOptionPresentation(branch);
        options.set(id, {
          id,
          kind: "decision-option",
          branchId: branch.id,
          parentFunctionalityId: functionalityNode.id,
          sourceFunctionalityId: branch.functionalityId,
          label: branch.label || branch.id,
          detail: branch.reason || presentation.detail,
          state: branch.state,
          status: branch.status,
          recordClassification: branch.recordClassification,
          recordBasis: branch.recordBasis,
          historicalClaim: branch.historicalClaim === true,
          temporal: branch.temporal || {},
          constraints: asArray(branch.constraints),
          evidenceCount: Number(branch.evidenceCount || 0),
          evidence: asArray(branch.evidence),
          branch: branch.branch || null,
          presentation,
          column: "option"
        });
      }
      links.push({
        id: `${functionalityNode.id}->${id}`,
        source: functionalityNode.id,
        target: id,
        kind: "decision-option",
        state: branch.state,
        historicalClaim: branch.historicalClaim === true
      });
    }

    const matchedEntities = entitiesForFunctionality(functionality, projectEntities, projectId);
    const matchedIds = new Set(matchedEntities.map((entity) => entity.id));
    entityIdsByFunctionality.set(functionality.id, matchedIds);
    const functionalityAssignments = assignmentsForFunctionality(assignmentsByFunctionality, functionality);
    const ownerIds = new Set();
    for (const link of graphLinks) {
      if (text(link.type).toLowerCase() !== "implements" || !matchedIds.has(text(nodeId(link.target)))) continue;
      const owner = allNodesById.get(text(nodeId(link.source)));
      if (owner?.type === "agent") ownerIds.add(owner.id);
    }
    for (const agentId of ownerIds) {
      const source = allNodesById.get(agentId);
      if (!source) continue;
      const id = `decision-agent:${source.id}`;
      const sourceAgentIds = agentIdentityKeys(source.id, source.agent_id, agentId);
      const matchingAssignment = functionalityAssignments.find((assignment) => sourceAgentIds.has(text(assignment.agentId))) || null;
      agents.set(id, agentNode({ agentId: source.id, source, assignment: matchingAssignment, associationBasis: "direct_topology_link" }));
      links.push({
        id: `${id}->${functionalityNode.id}`,
        source: id,
        target: functionalityNode.id,
        kind: "ownership",
        associationBasis: "direct_topology_link",
        sourceEntityIds: [...matchedIds]
      });
    }

    // Static analysis may name an exact functionality/agent assignment even
    // when the global topology is unavailable. It is useful context, but it
    // remains visually and semantically separate from a recorded implements
    // edge.
    for (const assignment of functionalityAssignments) {
      const assignedAgentId = text(assignment.agentId);
      const id = `decision-agent:${assignedAgentId}`;
      const recordedLink = links.some((link) => link.kind === "ownership" && link.source === id && link.target === functionalityNode.id);
      if (recordedLink) continue;
      if (!agents.has(id)) {
        const source = allNodesById.get(assignedAgentId);
        agents.set(id, agentNode({ agentId: assignedAgentId, source: source?.type === "agent" ? source : null, assignment }));
      }
      links.push({
        id: `${id}->${functionalityNode.id}:analysis-assignment`,
        source: id,
        target: functionalityNode.id,
        kind: "analysis-assignment",
        associationBasis: "analysis_assignment",
        assignment: text(assignment.assignment || assignment.responsibilityMatch),
        sourceEntityIds: [functionality.id]
      });
    }

    for (const service of supportingEntities(matchedIds, entitiesById, graphLinks)) {
      const id = `decision-service:${service.id}`;
      if (!services.has(id)) {
        services.set(id, {
          id,
          kind: "service",
          label: service.label || "Supporting service",
          detail: service.metadata?.observedCurrent?.description || service.metadata?.description || "Source-observed dependency.",
          description: service.metadata?.observedCurrent?.description || service.metadata?.description || "",
          sourceEntityId: service.id,
          serviceType: service.type,
          status: service.status || "observed_current",
          evidence: asArray(service.metadata?.evidence),
          sourceHints: service.metadata?.sourceHints || {},
          column: "service"
        });
      }
      links.push({ id: `${functionalityNode.id}->${id}`, source: functionalityNode.id, target: id, kind: "dependency" });
    }
  }

  // Preserve direct topology relationships between major functionalities. This
  // is intentionally based on the same exact entity/path matching used for
  // owners above, so two similarly named capabilities never become connected
  // merely because their labels happen to match.
  for (const graphLink of graphLinks) {
    const sourceEntityId = text(nodeId(graphLink.source));
    const targetEntityId = text(nodeId(graphLink.target));
    if (!sourceEntityId || !targetEntityId || sourceEntityId === targetEntityId) continue;
    for (const sourceFunctionality of functionalities) {
      if (!entityIdsByFunctionality.get(sourceFunctionality.id)?.has(sourceEntityId)) continue;
      for (const targetFunctionality of functionalities) {
        if (sourceFunctionality.id === targetFunctionality.id || !entityIdsByFunctionality.get(targetFunctionality.id)?.has(targetEntityId)) continue;
        links.push({
          id: `decision-functionality:${sourceFunctionality.id}->decision-functionality:${targetFunctionality.id}:topology-dependency`,
          source: `decision-functionality:${sourceFunctionality.id}`,
          target: `decision-functionality:${targetFunctionality.id}`,
          kind: "functionality-dependency",
          associationBasis: "direct_topology_link",
          topologyLinkType: text(graphLink.type) || "topology_dependency",
          sourceEntityId,
          targetEntityId
        });
      }
    }
  }

  nodes.push(...options.values(), ...agents.values(), ...services.values());
  const nodeIds = new Set(nodes.map((node) => node.id));
  const uniqueLinks = links.filter((link, index, rows) =>
    nodeIds.has(link.source) && nodeIds.has(link.target)
    && rows.findIndex((candidate) => candidate.source === link.source && candidate.target === link.target && candidate.kind === link.kind) === index
  );
  return {
    projectId,
    projectName,
    nodes,
    links: uniqueLinks,
    summary: {
      functionalityCount: functionalities.length,
      decisionOptionCount: options.size,
      selectedOptionCount: [...options.values()].filter((option) => option.state === "selected").length,
      deferredOptionCount: [...options.values()].filter((option) => option.state === "deferred").length,
      rejectedOptionCount: [...options.values()].filter((option) => option.state === "rejected").length,
      anticipatedOptionCount: [...options.values()].filter((option) => option.state === "anticipated").length,
      anticipatedRejectedOptionCount: [...options.values()].filter((option) => option.state === "anticipated_rejected").length,
      agentCount: agents.size,
      serviceCount: services.size,
      functionalityDependencyCount: uniqueLinks.filter((link) => link.kind === "functionality-dependency").length,
      unassignedFunctionalityCount: functionalities.filter((functionality) => !uniqueLinks.some((link) => ["ownership", "analysis-assignment"].includes(link.kind) && link.target === `decision-functionality:${functionality.id}`)).length
    }
  };
}

export function seedDecisionMapLayout(map = {}, width = 1160, height = 560) {
  const columns = { root: 96, functionality: Math.round(width * 0.33), option: Math.round(width * 0.52), agent: Math.round(width * 0.72), service: width - 110 };
  const buckets = new Map(Object.keys(columns).map((column) => [column, []]));
  for (const node of asArray(map.nodes)) buckets.get(node.column || "functionality")?.push(node);
  return asArray(map.nodes).map((node) => {
    const bucket = buckets.get(node.column || "functionality") || [];
    const index = Math.max(0, bucket.findIndex((item) => item.id === node.id));
    const spacing = Math.min(104, Math.max(64, (height - 92) / Math.max(1, bucket.length)));
    return {
      ...node,
      x: columns[node.column] || columns.functionality,
      y: Math.max(52, Math.min(height - 52, 68 + index * spacing)),
      radius: node.kind === "project" ? 31 : node.kind === "functionality" ? 25 : node.kind === "decision-option" ? 19 : 21
    };
  });
}

export function decisionMapRows(map = {}) {
  const nodesById = new Map(asArray(map.nodes).map((node) => [node.id, node]));
  return asArray(map.nodes)
    .filter((node) => node.kind === "functionality")
    .map((functionality) => ({
      functionality,
      options: asArray(map.links)
        .filter((link) => link.kind === "decision-option" && link.source === functionality.id)
        .map((link) => nodesById.get(link.target))
        .filter(Boolean),
      agents: [...asArray(map.links)
        .filter((link) => ["ownership", "analysis-assignment"].includes(link.kind) && link.target === functionality.id)
        .map((link) => {
          const agent = nodesById.get(link.source);
          return agent ? { ...agent, associationBasis: link.associationBasis || agent.associationBasis, assignment: link.assignment || "" } : null;
        })
        .filter(Boolean)
        .reduce((agents, agent) => {
          const previous = agents.get(agent.id);
          if (!previous || agent.associationBasis === "direct_topology_link") agents.set(agent.id, agent);
          return agents;
        }, new Map()).values()],
      services: asArray(map.links)
        .filter((link) => link.kind === "dependency" && link.source === functionality.id)
        .map((link) => nodesById.get(link.target))
        .filter(Boolean)
    }));
}

const DELIVERY_PRIMARY_LINK_KINDS = new Set([
  "build-event-functionality",
  "functionality-decision-option",
  "anticipated-decision-option",
  "recorded-decision-option",
  "chronology-segue",
  "ownership"
]);
const DELIVERY_DEPENDENCY_LINK_KINDS = new Set(["dependency", "functionality-dependency"]);
const DELIVERY_EVIDENCE_LINK_KINDS = new Set(["analysis-assignment", "build-decision-option"]);
const DELIVERY_INACTIVE_STATES = new Set(["inactive", "disabled", "blocked", "failed"]);

function deliveryLinkVisible(kind, filter) {
  if (filter === "all") return true;
  if (filter === "dependencies") return DELIVERY_DEPENDENCY_LINK_KINDS.has(kind);
  if (filter === "evidence") return DELIVERY_EVIDENCE_LINK_KINDS.has(kind);
  return DELIVERY_PRIMARY_LINK_KINDS.has(kind);
}

function deliveryAggregateGroup(node, links, groupBy) {
  if (!["decision-option", "agent", "service"].includes(node?.kind)) return null;
  const incident = links.filter((link) => link.source === node.id || link.target === node.id);
  const functionalityLink = incident.find((link) => {
    const peerId = link.source === node.id ? link.target : link.source;
    return String(peerId).startsWith("decision-functionality:");
  });
  const functionalityId = functionalityLink
    ? functionalityLink.source === node.id ? functionalityLink.target : functionalityLink.source
    : "unassigned";
  const status = String(node.state || node.status || "active").toLowerCase();
  const discriminator = node.kind === "decision-option" ? status : node.kind;
  if (groupBy === "module") return `${functionalityId}:${discriminator}`;
  if (groupBy === "status") return `${node.kind}:${status}`;
  return `${node.kind}:${discriminator}`;
}

function deliveryAggregateLabel(kind, members) {
  if (kind === "decision-option") {
    const state = String(members[0]?.state || members[0]?.status || "decision").replaceAll("_", " ");
    return `${state.replace(/(^|\s)\S/g, (value) => value.toUpperCase())} · ${members.length}`;
  }
  if (kind === "agent") return `Agents · ${members.length}`;
  return `Tools / APIs · ${members.length}`;
}

function deliveryLane(node = {}) {
  const kind = node.kind === "aggregate" ? node.aggregateKind : node.kind;
  if (kind === "build-event") return 0;
  if (kind === "functionality") return 1;
  if (kind === "decision-option") return 2;
  if (kind === "agent") return 3;
  if (kind === "service") return 4;
  return 1;
}

/**
 * Progressive-disclosure adapter for the delivery graph. It never mutates or
 * discards the source graph: repetitive leaf nodes are represented by stable
 * aggregate nodes and every visible aggregate edge retains its member IDs.
 */
export function buildDeliveryGraphView(graph = {}, {
  expandedGroups = [],
  groupBy = "type",
  relationshipFilter = "primary",
  depth = "all",
  showInactive = true,
  selectedId = ""
} = {}) {
  const sourceNodes = [...(graph.nodeById instanceof Map ? graph.nodeById.values() : asArray(graph.nodes))];
  const sourceLinks = asArray(graph.links);
  const expanded = new Set(expandedGroups);
  const eligibleNodes = sourceNodes.filter((node) => showInactive || !DELIVERY_INACTIVE_STATES.has(String(node.status || "").toLowerCase()));
  const eligibleIds = new Set(eligibleNodes.map((node) => node.id));
  const groups = new Map();
  for (const node of eligibleNodes) {
    const key = deliveryAggregateGroup(node, sourceLinks, groupBy);
    if (!key) continue;
    const members = groups.get(key) || [];
    members.push(node);
    groups.set(key, members);
  }

  const visibleNodes = new Map();
  const replacementById = new Map();
  const hiddenNodeGroups = new Map();
  const aggregateByGroup = new Map();
  for (const node of eligibleNodes) {
    const key = deliveryAggregateGroup(node, sourceLinks, groupBy);
    const members = key ? groups.get(key) || [] : [];
    if (!key || members.length < 2) {
      visibleNodes.set(node.id, key ? { ...node, aggregateGroupKey: key } : node);
      continue;
    }
    const aggregateId = `delivery-aggregate:${encodeURIComponent(key)}`;
    if (!aggregateByGroup.has(key)) {
      const kind = node.kind;
      const centerX = members.reduce((total, member) => total + Number(member.x || 0) + Number(member.width || 0) / 2, 0) / members.length;
      const centerY = members.reduce((total, member) => total + Number(member.y || 0) + Number(member.height || 0) / 2, 0) / members.length;
      const aggregate = {
        id: aggregateId,
        kind: "aggregate",
        aggregateKind: kind,
        aggregateGroupKey: key,
        label: deliveryAggregateLabel(kind, members),
        detail: `${members.length} ${kind.replaceAll("-", " ")} nodes are ${expanded.has(key) ? "expanded" : "collapsed"} in this view.`,
        childIds: members.map((member) => member.id),
        childLabels: members.map((member) => member.label),
        expanded: expanded.has(key),
        status: "grouped",
        shape: "rounded-rect",
        width: 176,
        height: 58,
        x: centerX - 88,
        y: centerY - 29
      };
      aggregateByGroup.set(key, aggregate);
      visibleNodes.set(aggregateId, aggregate);
    }
    if (expanded.has(key)) visibleNodes.set(node.id, { ...node, aggregateGroupKey: key });
    else {
      replacementById.set(node.id, aggregateId);
      hiddenNodeGroups.set(node.id, key);
    }
  }

  const filteredLinks = sourceLinks
    .filter((link) => eligibleIds.has(link.source) && eligibleIds.has(link.target))
    .filter((link) => deliveryLinkVisible(link.kind, relationshipFilter));
  const groupedLinks = new Map();
  for (const link of filteredLinks) {
    const source = replacementById.get(link.source) || link.source;
    const target = replacementById.get(link.target) || link.target;
    if (source === target || !visibleNodes.has(source) || !visibleNodes.has(target)) continue;
    const key = `${source}\u001f${target}\u001f${link.kind}`;
    const previous = groupedLinks.get(key);
    if (previous) {
      previous.memberLinkIds.push(link.id);
      previous.relationshipCount += 1;
    } else {
      groupedLinks.set(key, {
        ...link,
        id: source === link.source && target === link.target ? link.id : `delivery-aggregate-link:${encodeURIComponent(key)}`,
        source,
        target,
        memberLinkIds: [link.id],
        relationshipCount: 1,
        aggregated: source !== link.source || target !== link.target
      });
    }
  }

  let links = [...groupedLinks.values()];
  if (selectedId && depth !== "all" && visibleNodes.has(selectedId)) {
    const hopLimit = depth === "2" || depth === 2 ? 2 : 1;
    const included = new Set([selectedId]);
    let frontier = [selectedId];
    for (let hop = 0; hop < hopLimit && frontier.length; hop += 1) {
      const next = [];
      for (const link of links) {
        if (!frontier.includes(link.source) && !frontier.includes(link.target)) continue;
        const peerIds = [link.source, link.target];
        for (const id of peerIds) if (!included.has(id)) {
          included.add(id);
          next.push(id);
        }
      }
      frontier = next;
    }
    for (const id of [...visibleNodes.keys()]) if (!included.has(id)) visibleNodes.delete(id);
    links = links.filter((link) => visibleNodes.has(link.source) && visibleNodes.has(link.target));
  }

  const lanes = new Map(Array.from({ length: 5 }, (_, index) => [index, []]));
  for (const node of visibleNodes.values()) lanes.get(deliveryLane(node)).push(node);
  for (const nodes of lanes.values()) nodes.sort((left, right) => Number(left.timelineRank || 0) - Number(right.timelineRank || 0)
    || Number(left.y || 0) - Number(right.y || 0)
    || String(left.label || left.id).localeCompare(String(right.label || right.id)));

  // Dense semantic lanes should use the available width instead of becoming
  // one very tall stack. Keep each delivery stage intact, but wrap at most
  // three stable subcolumns with roughly six nodes per column.
  const lanePlans = [...lanes].map(([lane, nodes]) => {
    const columnCount = nodes.length ? Math.min(3, Math.max(1, Math.ceil(nodes.length / 6))) : 1;
    const rowCount = Math.max(1, Math.ceil(nodes.length / columnCount));
    const nodeWidth = Math.max(150, ...nodes.map((node) => Number(node.width || 72)));
    return {
      lane,
      nodes,
      columnCount,
      rowCount,
      nodeWidth,
      width: columnCount * nodeWidth + Math.max(0, columnCount - 1) * 52
    };
  });
  const maximumRowCount = Math.max(1, ...lanePlans.map((plan) => plan.rowCount));
  const height = Math.max(720, maximumRowCount * 112 + 112);
  const laneGap = 76;
  const horizontalInset = 52;
  let cursorX = horizontalInset;
  for (const plan of lanePlans) {
    plan.x = cursorX;
    cursorX += plan.width + laneGap;
  }
  const width = Math.max(1420, cursorX - laneGap + horizontalInset);
  const positionedNodes = new Map();
  for (const plan of lanePlans) {
    const spacing = Math.min(126, Math.max(104, (height - 128) / Math.max(1, plan.rowCount)));
    const occupiedHeight = Math.max(0, plan.rowCount - 1) * spacing;
    const startY = (height - occupiedHeight) / 2;
    plan.nodes.forEach((node, index) => {
      const column = Math.floor(index / plan.rowCount);
      const row = index % plan.rowCount;
      positionedNodes.set(node.id, {
        ...node,
        x: plan.x + column * (plan.nodeWidth + 52) + (plan.nodeWidth - Number(node.width || 72)) / 2,
        y: startY + row * spacing - Number(node.height || 52) / 2
      });
    });
  }

  return {
    ...graph,
    width,
    height,
    groups: [],
    links,
    nodeById: positionedNodes,
    functionalityById: new Map([...positionedNodes].filter(([, node]) => node.kind === "functionality")),
    optionById: new Map([...positionedNodes].filter(([, node]) => node.kind === "decision-option")),
    hiddenNodeGroups,
    aggregateByGroup,
    sourceNodeCount: sourceNodes.length,
    visibleNodeCount: positionedNodes.size
  };
}

function instructionTimestamp(instruction = {}) {
  const snapshot = instruction.orchestrationSnapshot || {};
  for (const value of [instruction.completedAt, snapshot.completedAt, instruction.recordedAt, instruction.startedAt, snapshot.startedAt]) {
    const timestamp = validDate(value);
    if (timestamp.value) return timestamp;
  }
  return { value: "", timestamp: Number.NaN };
}

function completedInstruction(instruction = {}) {
  const snapshot = instruction.orchestrationSnapshot || {};
  const statuses = [instruction.status, snapshot.status, snapshot.validation?.status]
    .map((value) => text(value).toLowerCase());
  if (statuses.some((status) => ["failed", "error", "blocked", "cancelled", "canceled", "rejected"].includes(status))) return false;
  const buildStatuses = [instruction.status, snapshot.status]
    .map((value) => text(value).toLowerCase());
  const terminalSuccess = new Set(["succeeded", "completed", "passed"]);
  if (buildStatuses.some((status) => status && !terminalSuccess.has(status))) return false;
  return buildStatuses.some((status) => terminalSuccess.has(status));
}

function instructionId(instruction = {}, index = 0) {
  const snapshot = instruction.orchestrationSnapshot || {};
  return text(instruction.buildId || snapshot.buildId || snapshot.snapshotBuildId || instruction.parentWorkflowId || `record-${index + 1}`);
}

function pathsForValue(value) {
  if (typeof value === "string") return normalizedPaths([value]);
  if (!value || typeof value !== "object") return [];
  return normalizedPaths([value.path, value.target, value.filePath, value.sourcePath, value.reference]);
}

function instructionActions(instruction = {}) {
  const flowPath = instruction.flowPath || {};
  return [
    ...asArray(flowPath.featureActions),
    ...asArray(flowPath.actions)
  ].filter((action) => action && typeof action === "object");
}

function instructionScopes(instruction = {}) {
  const flowPath = instruction.flowPath || {};
  const snapshot = instruction.orchestrationSnapshot || {};
  return [
    ...asArray(flowPath.functionalities),
    ...asArray(snapshot.generatedFeatures),
    ...asArray(flowPath.functionalityGraph?.nodes)
  ].filter((item) => item && typeof item === "object");
}

function scopeIdentifiers(scope = {}) {
  return unique([
    scope.id,
    scope.sourceId,
    scope.functionalityId,
    scope.sourceEntityId,
    ...asArray(scope.sourceEntityIds)
  ]);
}

function actionCreatesSource(action = {}) {
  return /^(add|create|new|insert|generate)$/i.test(text(action.type || action.action));
}

function normalizedInstructionTimeline(instructionTimeline = []) {
  const rows = asArray(instructionTimeline)
    .filter(completedInstruction)
    .map((instruction, inputIndex) => {
      const occurred = instructionTimestamp(instruction);
      return {
        instruction,
        inputIndex,
        buildId: instructionId(instruction, inputIndex),
        occurredAt: occurred.value,
        timestamp: occurred.timestamp,
        actions: instructionActions(instruction),
        scopes: instructionScopes(instruction),
        changedPaths: asArray(instruction.changedFiles)
          .flatMap(pathsForValue)
      };
    });
  const uniqueRows = rows.filter((row, index, candidates) => candidates.findIndex((candidate) =>
    candidate.buildId === row.buildId
      && candidate.occurredAt === row.occurredAt
      && text(candidate.instruction.parentWorkflowId) === text(row.instruction.parentWorkflowId)
  ) === index);
  const chronological = uniqueRows
    .filter((row) => Number.isFinite(row.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp
      || left.buildId.localeCompare(right.buildId)
      || left.inputIndex - right.inputIndex)
    .map((row, index) => ({ ...row, buildIndex: index + 1 }));
  const unsequenced = uniqueRows
    .filter((row) => !Number.isFinite(row.timestamp))
    .sort((left, right) => left.buildId.localeCompare(right.buildId) || left.inputIndex - right.inputIndex)
    .map((row) => ({ ...row, buildIndex: null }));
  return [...chronological, ...unsequenced];
}

function buildWorkflowId(build = {}) {
  return text(build?.instruction?.parentWorkflowId || build?.instruction?.flowPath?.decisionTree?.id);
}

function deliveryBuildEventKey(build = {}) {
  return [text(build.buildId), text(build.occurredAt) || "time-unavailable", buildWorkflowId(build)].join("\u001f");
}

function deliveryBuildEventId(build = {}) {
  return `delivery-build-event:${encodeURIComponent(deliveryBuildEventKey(build))}`;
}

function eventModeForTimeline(timeline = {}) {
  if (timeline.mode === "recorded_build" || timeline.mode === "recorded_scope") return timeline.mode;
  return timeline.basis === "recorded_flow_scope" ? "recorded_scope" : "recorded_build";
}

function buildEventNode(build = {}) {
  const timestamped = Number.isFinite(build.timestamp);
  const actionDetails = build.actions.map((action) => ({
    type: text(action?.type || action?.action) || "action",
    target: text(action?.target || action?.path || action?.filePath || action?.sourcePath),
    status: text(action?.status)
  })).filter((action) => action.type || action.target || action.status);
  const scopeDetails = build.scopes.map((scope) => ({
    id: text(scope?.id || scope?.sourceId || scope?.functionalityId || scope?.sourceEntityId),
    label: text(scope?.label || scope?.name || scope?.title),
    sourceEntityIds: unique(asArray(scope?.sourceEntityIds))
  })).filter((scope) => scope.id || scope.label || scope.sourceEntityIds.length);
  return {
    id: deliveryBuildEventId(build),
    kind: "build-event",
    label: build.buildId || "Recorded build",
    detail: timestamped
      ? `Recorded build ${build.buildIndex || ""}${build.buildId ? ` · ${build.buildId}` : ""}`.trim()
      : "Recorded build evidence · time unavailable",
    buildId: build.buildId,
    occurredAt: build.occurredAt,
    status: text(build?.instruction?.status) || "succeeded",
    mode: timestamped ? "recorded_build" : "unsequenced",
    historicalClaim: true,
    buildIndex: build.buildIndex,
    parentWorkflowId: buildWorkflowId(build),
    evidence: [
      ...build.changedPaths.map((value) => ({ kind: "changed_file", value })),
      ...actionDetails.filter((action) => action.target).map((action) => ({ kind: "build_action", value: action.target, action: action.type })),
      ...scopeDetails.map((scope) => ({ kind: "recorded_scope", value: scope.id || scope.label }))
    ],
    buildDetails: {
      actions: actionDetails,
      changedFiles: [...build.changedPaths],
      scopes: scopeDetails,
      parentWorkflowId: buildWorkflowId(build)
    },
    functionalityIds: []
  };
}

function firstRecordedEvidence(functionality = {}, build = {}) {
  const functionalityPaths = new Set(asArray(functionality.evidencePaths));
  const functionalityIds = new Set(unique([
    functionality.sourceFunctionalityId,
    ...asArray(functionality.sourceEntityIds)
  ]));
  const actionMatches = build.actions
    .map((action, index) => ({ action, index, paths: pathsForValue(action) }))
    .filter(({ paths }) => paths.some((path) => functionalityPaths.has(path)));
  const changedMatches = build.changedPaths
    .map((path, index) => ({ path, index }))
    .filter(({ path }) => functionalityPaths.has(path));

  if (actionMatches.length || changedMatches.length) {
    const firstAction = actionMatches[0];
    const firstChanged = changedMatches[0];
    const evidence = [
      ...actionMatches.map(({ action, paths }) => ({ kind: "build_action", value: text(action.target || action.path || paths[0]), action: text(action.type || action.action) })),
      ...changedMatches.map(({ path }) => ({ kind: "changed_file", value: path }))
    ];
    return {
      kind: "recorded_build",
      activity: firstAction && actionCreatesSource(firstAction.action) ? "created" : "changed",
      withinBuildOrder: firstAction ? firstAction.index + 1 : 10_000 + (firstChanged?.index || 0),
      evidence
    };
  }

  const scopeMatch = build.scopes
    .map((scope, index) => ({ scope, index, ids: scopeIdentifiers(scope) }))
    .find(({ ids }) => ids.some((id) => functionalityIds.has(id)));
  if (!scopeMatch) return null;
  return {
    kind: "recorded_scope",
    activity: "scoped",
    withinBuildOrder: 20_000 + scopeMatch.index,
    evidence: [{ kind: "recorded_scope", value: text(scopeMatch.scope.sourceId || scopeMatch.scope.functionalityId || scopeMatch.scope.id) }]
  };
}

function anticipatedTimeline(functionality = {}) {
  const sequence = functionality.sourceSequence || {};
  const sourceOrder = finiteNumber(sequence.order);
  const confidence = finiteNumber(sequence.confidence);
  const phase = text(sequence.deliveryPhase || sequence.phase);
  const basis = text(sequence.basis) || (sourceOrder === null ? "unsequenced_source_analysis" : "source_inferred_delivery");
  const sequenced = sourceOrder !== null;
  return {
    mode: sequenced ? "anticipated_delivery" : "unsequenced",
    sourceOrder,
    buildIndex: null,
    withinBuildOrder: null,
    occurredAt: "",
    buildId: "",
    buildEventId: "",
    status: "anticipated",
    label: sequenced ? "Anticipated delivery order" : "Order unavailable",
    detail: sequenced
      ? [phase || "Dependency-aware source plan", confidence === null ? "" : `${Math.round(confidence * 100)}% confidence`].filter(Boolean).join(" · ")
      : "No recorded functionality event or source delivery order is available.",
    basis,
    confidence,
    historicalClaim: false,
    evidence: asArray(functionality.evidencePaths).map((value) => ({ kind: "source_path", value }))
  };
}

function timelineForRow(row = {}, builds = []) {
  const matches = builds
    .map((build) => ({ build, evidence: firstRecordedEvidence(row.functionality, build) }))
    .filter((candidate) => candidate.evidence);
  const recorded = matches
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.build.timestamp) ? left.build.timestamp : Number.MAX_SAFE_INTEGER;
      const rightTime = Number.isFinite(right.build.timestamp) ? right.build.timestamp : Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime
        || (left.evidence.kind === "recorded_build" ? 0 : 1) - (right.evidence.kind === "recorded_build" ? 0 : 1)
        || left.evidence.withinBuildOrder - right.evidence.withinBuildOrder
        || left.build.buildId.localeCompare(right.build.buildId);
    })[0];
  if (!recorded) return anticipatedTimeline(row.functionality);

  const sequenced = Number.isFinite(recorded.build.timestamp);
  const activityLabel = recorded.evidence.kind === "recorded_scope"
    ? "Recorded build scope"
    : recorded.evidence.activity === "created"
      ? "Recorded source addition"
      : "Recorded source change";
  return {
    mode: sequenced ? recorded.evidence.kind : "unsequenced",
    sourceOrder: finiteNumber(row.functionality.sourceSequence?.order),
    buildIndex: recorded.build.buildIndex,
    withinBuildOrder: recorded.evidence.withinBuildOrder,
    occurredAt: recorded.build.occurredAt,
    buildId: recorded.build.buildId,
    buildEventId: deliveryBuildEventId(recorded.build),
    status: text(recorded.build.instruction.status) || "succeeded",
    label: sequenced ? activityLabel : `${activityLabel} · time unavailable`,
    detail: sequenced
      ? `Build ${recorded.build.buildIndex}${recorded.build.buildId ? ` · ${recorded.build.buildId}` : ""}`
      : "The project ledger contains matching evidence, but no usable event time.",
    basis: recorded.evidence.kind === "recorded_scope" ? "recorded_flow_scope" : "project_instruction_ledger",
    confidence: null,
    historicalClaim: true,
    evidence: recorded.evidence.evidence
  };
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function decisionOptionBuildReferences(option = {}) {
  const branch = object(option.branch);
  const metadata = object(branch.metadata);
  const provenance = object(branch.provenance);
  const execution = object(branch.execution);
  const build = object(branch.build);
  return unique([
    branch.buildId,
    branch.instructionBuildId,
    branch.executionBuildId,
    metadata.buildId,
    provenance.buildId,
    execution.buildId,
    build.id
  ]);
}

function decisionOptionWorkflowReferences(option = {}) {
  const branch = object(option.branch);
  const metadata = object(branch.metadata);
  const provenance = object(branch.provenance);
  const execution = object(branch.execution);
  return unique([
    branch.parentWorkflowId,
    branch.workflowId,
    branch.executionId,
    branch.correlationId,
    metadata.parentWorkflowId,
    metadata.workflowId,
    provenance.parentWorkflowId,
    provenance.workflowId,
    execution.id,
    execution.workflowId
  ]);
}

function buildReferences(build = {}) {
  const instruction = object(build.instruction);
  const snapshot = object(instruction.orchestrationSnapshot);
  return {
    buildIds: unique([build.buildId, instruction.buildId, snapshot.buildId, snapshot.snapshotBuildId]),
    workflowIds: unique([
      buildWorkflowId(build),
      ...asArray(instruction.childExecutionIds),
      snapshot.workflowId,
      snapshot.executionId,
      snapshot.correlationId
    ])
  };
}

function includesSharedValue(left = [], right = []) {
  const candidates = new Set(asArray(left));
  return asArray(right).some((value) => candidates.has(value));
}

function directDecisionBuildAssociation(option = {}, build = {}) {
  const references = buildReferences(build);
  if (includesSharedValue(decisionOptionBuildReferences(option), references.buildIds)) return "direct_branch_build_reference";
  if (includesSharedValue(decisionOptionWorkflowReferences(option), references.workflowIds)) return "direct_branch_workflow_reference";
  return "";
}

/**
 * A build event and a governed decision are separate records. An exact build
 * or workflow reference is treated as a direct association. Otherwise a
 * decision can still be shown beside the build that first establishes its
 * exact functionality, but that visual relationship is explicitly contextual
 * and never claims the disposition happened at that build's timestamp.
 */
function buildEventProjection({ rows = [], builds = [] } = {}) {
  const eventNodes = new Map();
  const eventLinks = new Map();
  const eventByBuildId = new Map();
  const eventById = new Map();
  const unbranchedRecordedOptions = [];
  const anticipatedOptionLinks = [];

  for (const build of builds) {
    const node = buildEventNode(build);
    eventNodes.set(node.id, node);
    eventById.set(node.id, { node, build });
    const rowsForBuild = eventByBuildId.get(build.buildId) || [];
    rowsForBuild.push({ node, build });
    eventByBuildId.set(build.buildId, rowsForBuild);
  }

  const addLink = (link) => {
    if (!eventLinks.has(link.id)) eventLinks.set(link.id, link);
  };

  for (const row of rows) {
    const timeline = row.timeline || {};
    const contextual = eventById.get(text(timeline.buildEventId)) || null;
    if (contextual) {
      const sourceFunctionalityId = text(row.functionality?.sourceFunctionalityId);
      if (sourceFunctionalityId && !contextual.node.functionalityIds.includes(sourceFunctionalityId)) contextual.node.functionalityIds.push(sourceFunctionalityId);
      addLink({
        id: `${contextual.node.id}->${row.functionality.id}:build-event-functionality`,
        source: contextual.node.id,
        target: row.functionality.id,
        kind: "build-event-functionality",
        associationBasis: "recorded_functionality_build_evidence",
        historicalClaim: true,
        chronologyClaim: true,
        mode: eventModeForTimeline(timeline)
      });
    }

    for (const option of asArray(row.options)) {
      if (["anticipated", "anticipated_rejected"].includes(option.state) || option.historicalClaim === false) {
        anticipatedOptionLinks.push({
          id: `${row.functionality.id}->${option.id}:nonhistorical-option`,
          source: row.functionality.id,
          target: option.id,
          kind: "anticipated-decision-option",
          state: option.state,
          historicalClaim: false,
          chronologyClaim: false
        });
        continue;
      }
      if (!RECORDED_BUILD_DECISION_STATES.has(option.state) || !option.historicalClaim) continue;

      const direct = builds
        .map((build) => ({ build, associationBasis: directDecisionBuildAssociation(option, build) }))
        .filter((candidate) => candidate.associationBasis)
        .sort((left, right) => {
          const leftTime = Number.isFinite(left.build.timestamp) ? left.build.timestamp : Number.MAX_SAFE_INTEGER;
          const rightTime = Number.isFinite(right.build.timestamp) ? right.build.timestamp : Number.MAX_SAFE_INTEGER;
          return leftTime - rightTime || left.build.buildId.localeCompare(right.build.buildId);
        })[0] || null;
      const event = direct
        ? eventById.get(deliveryBuildEventId(direct.build))
        : contextual;
      if (!event) {
        unbranchedRecordedOptions.push({
          optionId: option.id,
          branchId: option.branchId,
          functionalityId: row.functionality.id,
          state: option.state,
          reason: "No recorded build event establishes this functionality or directly references this decision."
        });
        continue;
      }
      const associationBasis = direct?.associationBasis || "functionality_build_event_context";
      addLink({
        id: `${event.node.id}->${option.id}:build-decision-option`,
        source: event.node.id,
        target: option.id,
        kind: "build-decision-option",
        state: option.state,
        historicalClaim: true,
        associationBasis,
        chronologyClaim: Boolean(direct),
        detail: direct
          ? "An exact recorded build or workflow reference connects this decision to the build event."
          : "The build event establishes the same functionality; this is context, not a claim that the decision occurred at the build timestamp."
      });
    }
  }

  return {
    eventNodes: [...eventNodes.values()],
    eventLinks: [...eventLinks.values()],
    anticipatedOptionLinks,
    unbranchedRecordedOptions
  };
}

/**
 * Build one directional scene-to-scene chronology chain. Recorded rows are
 * connected only when they have usable build chronology; source rows are
 * connected only when they have an explicit anticipated delivery order.
 * Unsequenced records are deliberately omitted so the graph never invents an
 * order from labels or array position.
 */
export function buildDeliveryChronologyLinks(rows = []) {
  const sequencedRows = asArray(rows).filter((row) => {
    const timeline = row?.timeline || {};
    if (["recorded_build", "recorded_scope"].includes(timeline.mode)) return Boolean(timeline.occurredAt);
    return timeline.mode === "anticipated_delivery" && timeline.historicalClaim === false && finiteNumber(timeline.sourceOrder) !== null;
  });
  const links = [];
  for (let index = 1; index < sequencedRows.length; index += 1) {
    const previous = sequencedRows[index - 1];
    const current = sequencedRows[index];
    const source = text(previous?.functionality?.id);
    const target = text(current?.functionality?.id);
    if (!source || !target || source === target) continue;
    const recorded = previous.timeline.historicalClaim === true
      && current.timeline.historicalClaim === true
      && Boolean(previous.timeline.occurredAt)
      && Boolean(current.timeline.occurredAt);
    links.push({
      id: `${source}->${target}:chronology-segue`,
      source,
      target,
      kind: "chronology-segue",
      chronologyMode: recorded ? "recorded" : "anticipated",
      chronologyClaim: recorded,
      historicalClaim: recorded,
      associationBasis: recorded ? "recorded_delivery_chronology" : "anticipated_source_delivery_order",
      fromOrder: previous.timeline.order ?? null,
      toOrder: current.timeline.order ?? null
    });
  }
  return links;
}

/**
 * Combines trustworthy build evidence with the source-derived delivery plan.
 * A recorded build is only attached to a capability through exact file-path
 * or exact recorded-scope identifiers. Everything else stays anticipated.
 */
export function buildApplicationDeliveryTimeline({ map = {}, instructionTimeline = [], projectId = "" } = {}) {
  const requestedProjectId = text(projectId);
  const scopedInstructionTimeline = requestedProjectId
    ? asArray(instructionTimeline).filter((instruction) => text(instruction?.projectId) === requestedProjectId)
    : instructionTimeline;
  const builds = normalizedInstructionTimeline(scopedInstructionTimeline);
  const rawRows = decisionMapRows(map).map((row) => ({
    ...row,
    timeline: timelineForRow(row, builds)
  }));
  const eventProjection = buildEventProjection({ rows: rawRows, builds });
  const eventNodesById = new Map(eventProjection.eventNodes.map((node) => [node.id, node]));
  const buildDecisionLinksByFunctionality = new Map();
  for (const link of eventProjection.eventLinks.filter((link) => link.kind === "build-decision-option")) {
    const row = rawRows.find((candidate) => asArray(candidate.options).some((option) => option.id === link.target));
    if (!row) continue;
    const links = buildDecisionLinksByFunctionality.get(row.functionality.id) || [];
    links.push(link);
    buildDecisionLinksByFunctionality.set(row.functionality.id, links);
  }
  const anticipatedLinksByFunctionality = new Map();
  for (const link of eventProjection.anticipatedOptionLinks) {
    const links = anticipatedLinksByFunctionality.get(link.source) || [];
    links.push(link);
    anticipatedLinksByFunctionality.set(link.source, links);
  }
  const recorded = rawRows
    .filter((row) => ["recorded_build", "recorded_scope"].includes(row.timeline.mode))
    .sort((left, right) => Date.parse(left.timeline.occurredAt) - Date.parse(right.timeline.occurredAt)
      || left.timeline.withinBuildOrder - right.timeline.withinBuildOrder
      || left.functionality.label.localeCompare(right.functionality.label)
      || left.functionality.id.localeCompare(right.functionality.id));
  const unsequenced = rawRows
    .filter((row) => row.timeline.mode === "unsequenced" && row.timeline.historicalClaim)
    .sort((left, right) => left.functionality.label.localeCompare(right.functionality.label) || left.functionality.id.localeCompare(right.functionality.id));
  const anticipated = rawRows
    .filter((row) => !row.timeline.historicalClaim)
    .sort((left, right) => (left.timeline.sourceOrder ?? Number.MAX_SAFE_INTEGER) - (right.timeline.sourceOrder ?? Number.MAX_SAFE_INTEGER)
      || left.functionality.label.localeCompare(right.functionality.label)
      || left.functionality.id.localeCompare(right.functionality.id));
  const rows = [...recorded, ...unsequenced, ...anticipated].map((row, index) => ({
    ...row,
    buildEvent: eventNodesById.get(row.timeline.buildEventId) || null,
    buildDecisionLinks: buildDecisionLinksByFunctionality.get(row.functionality.id) || [],
    anticipatedOptionLinks: anticipatedLinksByFunctionality.get(row.functionality.id) || [],
    timeline: { ...row.timeline, order: index + 1 }
  }));
  const matchedBuildIds = new Set(
    builds
      .filter((build) => rawRows.some((row) => firstRecordedEvidence(row.functionality, build)))
      .map((build) => build.buildId)
      .filter(Boolean)
  );
  return {
    rows,
    summary: {
      completedBuildCount: builds.length,
      recordedEventCount: recorded.length,
      recordedScopeCount: recorded.filter((row) => row.timeline.mode === "recorded_scope").length,
      unsequencedRecordCount: unsequenced.length,
      anticipatedCount: anticipated.length,
      buildEventNodeCount: eventProjection.eventNodes.length,
      buildEventFunctionalityLinkCount: eventProjection.eventLinks.filter((link) => link.kind === "build-event-functionality").length,
      branchedSelectedOptionCount: eventProjection.eventLinks.filter((link) => link.kind === "build-decision-option" && link.state === "selected").length,
      branchedDeferredOptionCount: eventProjection.eventLinks.filter((link) => link.kind === "build-decision-option" && link.state === "deferred").length,
      branchedRejectedOptionCount: eventProjection.eventLinks.filter((link) => link.kind === "build-decision-option" && link.state === "rejected").length,
      unbranchedRecordedDecisionOptionCount: eventProjection.unbranchedRecordedOptions.length,
      anticipatedOptionCount: eventProjection.anticipatedOptionLinks.length,
      unmatchedBuildCount: Math.max(0, builds.length - matchedBuildIds.size),
      hasRecordedChronology: recorded.length > 0,
      hasRecordedEvidence: recorded.length > 0 || unsequenced.length > 0,
      historicalClaim: recorded.length > 0 && anticipated.length === 0
    },
    eventNodes: eventProjection.eventNodes,
    eventLinks: eventProjection.eventLinks,
    anticipatedOptionLinks: eventProjection.anticipatedOptionLinks,
    unbranchedRecordedOptions: eventProjection.unbranchedRecordedOptions
  };
}
