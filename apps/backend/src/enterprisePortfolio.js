/**
 * A deliberately read-only portfolio projection. It does not infer that two
 * applications are related merely because PlutoMix created them, an agent
 * implemented them, or they have the same enterprise tag.
 */

const CAUSAL_RELATIONSHIP_TYPES = new Set([
  "depends_on",
  "calls",
  "invokes",
  "requests",
  "consumes",
  "uses_api",
  "ui_calls_api",
  "api_calls_service",
  "ui_uses_service",
  "service_uses_service",
  "service_uses_database",
  "api_uses_database"
]);

const NON_CAUSAL_RELATIONSHIP_TYPES = new Set([
  "creates_project",
  "implements",
  "owns",
  "assigned_to",
  "assigns_agent",
  "has_agent",
  "has_agent_assignment",
  "contains",
  "contains_application_entity",
  "contains_feature",
  "contains_ui_element",
  "has_ui_feature"
]);

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, { lower = false, maxLength = 160 } = {}) {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (lower ? normalized.toLowerCase() : normalized).slice(0, maxLength);
}

function endpointId(value) {
  return text(typeof value === "object" && value ? value.id : value, { maxLength: 240 });
}

function projectId(project) {
  const value = record(project);
  return text(value.id || value.projectId || value.metadata?.projectId, { maxLength: 240 });
}

function projectName(project, fallback = "Application") {
  const value = record(project);
  return text(value.name || value.projectName || value.label || value.metadata?.projectName, { maxLength: 240 }) || fallback;
}

function enterpriseTagFor(project) {
  const value = record(project);
  const metadata = record(value.metadata);
  const embedded = value.enterprise || value.enterpriseMetadata || metadata.enterprise || metadata.enterpriseMetadata;
  // A project ID/name is not an enterprise boundary. Only an explicit
  // enterprise object or explicitly named enterprise fields may establish
  // one; otherwise untagged projects stay unassigned and cannot participate
  // in cross-application sharing.
  return normalizeEnterpriseTag(embedded || {
    enterpriseId: value.enterpriseId || value.enterprise_id || metadata.enterpriseId || metadata.enterprise_id,
    enterpriseName: value.enterpriseName || value.enterprise_name || metadata.enterpriseName || metadata.enterprise_name
  });
}

function publicEnterprise(tag) {
  return tag.enterpriseId ? { id: tag.enterpriseId, name: tag.enterpriseName } : null;
}

function brainXFor(project, fallbackName) {
  const value = record(project);
  const metadata = record(value.metadata);
  const configured = record(value.brainX || value.brainx || metadata.brainX || metadata.brainx);
  return {
    label: text(configured.label || value.brainXLabel || value.brainxLabel || metadata.brainXLabel || metadata.brainxLabel, { maxLength: 240 }) || `${fallbackName} App BrainX`,
    scope: text(configured.scope || value.brainXScope || value.brainxScope || metadata.brainXScope || metadata.brainxScope, { lower: true, maxLength: 160 }) || "application-private"
  };
}

function provenanceFor(project) {
  const value = record(project);
  const provenance = record(value.provenance);
  const requestedOrigin = text(provenance.origin || value.origin, { lower: true, maxLength: 80 });
  const origin = ["plutomix_created", "imported", "unknown_legacy"].includes(requestedOrigin)
    ? requestedOrigin
    : "unknown_legacy";
  return {
    origin,
    recordedAt: text(provenance.recordedAt, { maxLength: 80 }),
    source: text(provenance.source, { lower: true, maxLength: 120 }) || "provenance_not_recorded"
  };
}

function normalizedPurpose(value) {
  return text(value, { lower: true, maxLength: 160 });
}

function agreementProjectIds(agreement, role) {
  const source = record(agreement);
  const key = role === "source" ? "sourceProjectId" : "recipientProjectId";
  const id = text(source[key], { maxLength: 240 });
  return id ? [id] : [];
}

function approvalIsExplicit(value) {
  const candidate = record(value);
  const principalId = typeof candidate.principalId === "string" && candidate.principalId.length <= 160
    ? text(candidate.principalId, { maxLength: 160 })
    : "";
  const decidedAt = typeof candidate.decidedAt === "string" ? Date.parse(candidate.decidedAt) : Number.NaN;
  return candidate.approved === true && Boolean(principalId) && Number.isFinite(decidedAt) && decidedAt <= Date.now();
}

function agreementApprovedBy(agreement, party) {
  const value = record(agreement);
  const approvals = record(value.approvals);
  return approvalIsExplicit(approvals[party]);
}

function activeAgreement(agreement) {
  const value = record(agreement);
  // Status is the authoritative lifecycle state. A stale legacy `active`
  // flag must never override a suspended, revoked, or expired agreement.
  if (value.status !== "active") return false;
  const now = Date.now();
  for (const key of ["startsAt"]) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const timestamp = typeof value[key] === "string" ? Date.parse(value[key]) : Number.NaN;
    if (!Number.isFinite(timestamp) || timestamp > now) return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, "expiresAt")) {
    const timestamp = typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : Number.NaN;
    if (!Number.isFinite(timestamp) || timestamp <= now) return false;
  }
  return true;
}

function agreementCoversPurpose(agreement, purpose) {
  const rawPurposes = record(agreement).purposes;
  if (!Array.isArray(rawPurposes) || !rawPurposes.length) return false;
  const purposes = rawPurposes.map(normalizedPurpose).filter(Boolean);
  return purposes.includes(normalizedPurpose(purpose));
}

function agreementCoversDirection(agreement, sourceId, targetId) {
  const value = record(agreement);
  if (value.direction !== "source_to_recipient") return false;
  return agreementProjectIds(value, "source").includes(sourceId)
    && agreementProjectIds(agreement, "recipient").includes(targetId);
}

function agreementHasRequiredContract(agreement) {
  const value = record(agreement);
  const enterpriseId = typeof value.enterpriseId === "string" ? value.enterpriseId : "";
  const validEnterpriseId = /^[a-z0-9][a-z0-9-]{1,79}$/.test(enterpriseId);
  const validId = typeof value.id === "string" && value.id.length >= 2 && value.id.length <= 160;
  const validProjectId = (project) => typeof project === "string" && project.length > 0 && project.length <= 160;
  const validPurpose = (purpose) => typeof purpose === "string" && purpose.length > 0 && purpose.length <= 160;
  const purposes = Array.isArray(value.purposes) ? value.purposes : [];
  const uniquePurposes = new Set(purposes).size === purposes.length;
  return validId
    && validEnterpriseId
    && validProjectId(value.sourceProjectId)
    && validProjectId(value.recipientProjectId)
    && value.direction === "source_to_recipient"
    && Array.isArray(value.purposes)
    && purposes.length > 0
    && purposes.length <= 20
    && purposes.every(validPurpose)
    && uniquePurposes;
}

function relationshipType(link) {
  return text(record(link).type, { lower: true, maxLength: 160 });
}

function isExplicitCausalRelationship(link) {
  const relation = relationshipType(link);
  if (!relation || NON_CAUSAL_RELATIONSHIP_TYPES.has(relation)) return false;
  if (record(link).metadata?.causal === true) return true;
  return CAUSAL_RELATIONSHIP_TYPES.has(relation);
}

function graphProjectId(node, knownProjectIds) {
  const value = record(node);
  const direct = text(value.metadata?.projectId || value.projectId, { maxLength: 240 });
  if (knownProjectIds.has(direct)) return direct;
  if (value.type === "project") {
    const fromNodeId = text(value.id, { maxLength: 240 }).replace(/^project:/, "");
    if (knownProjectIds.has(fromNodeId)) return fromNodeId;
  }
  return "";
}

function countEvidence(link) {
  const value = record(link);
  if (Array.isArray(value.evidence)) return value.evidence.length;
  if (Array.isArray(value.metadata?.evidence)) return value.metadata.evidence.length;
  return 0;
}

function emptyCounts() {
  return {
    nodes: 0,
    links: 0,
    features: 0,
    pages: 0,
    uiElements: 0,
    apis: 0,
    services: 0,
    databases: 0,
    inboundCausalRelationships: 0,
    outboundCausalRelationships: 0,
    sharingRelationships: 0
  };
}

function appTypeCountKey(type) {
  return {
    feature: "features",
    functionality: "features",
    application_functionality: "features",
    page: "pages",
    ui_element: "uiElements",
    api: "apis",
    service: "services",
    database: "databases"
  }[type] || "";
}

/**
 * Normalizes optional project enterprise metadata. An enterprise name is never
 * retained without an enterprise id, because a display name is not an access
 * boundary. Explicit values win; missing values may be filled from `existing`.
 */
export function normalizeEnterpriseTag(tag = {}, existing = {}) {
  const incoming = record(tag);
  const fallbackRoot = record(existing);
  const fallback = record(
    fallbackRoot.enterprise || fallbackRoot.enterpriseMetadata || fallbackRoot.metadata?.enterprise || fallbackRoot.metadata?.enterpriseMetadata
  );
  const enterpriseId = text(incoming.enterpriseId || incoming.id || fallback.enterpriseId || fallback.id, { lower: true, maxLength: 160 });
  const enterpriseName = enterpriseId
    ? text(incoming.enterpriseName || incoming.name || fallback.enterpriseName || fallback.name, { maxLength: 240 })
    : "";
  return { enterpriseId, enterpriseName };
}

/**
 * Information sharing is deny-by-default. Both projects must belong to the
 * same identified enterprise and the exact direction/purpose must be covered
 * by one active agreement with all three explicit approvals.
 */
export function canShareApplicationInformation({ sourceProject, targetProject, agreement, purpose } = {}) {
  const sourceId = projectId(sourceProject);
  const targetId = projectId(targetProject);
  const sourceEnterprise = enterpriseTagFor(sourceProject);
  const targetEnterprise = enterpriseTagFor(targetProject);
  const agreementEnterpriseId = record(agreement).enterpriseId;
  if (!sourceId || !targetId || sourceId === targetId || !sourceEnterprise.enterpriseId || sourceEnterprise.enterpriseId !== targetEnterprise.enterpriseId) return false;
  if (!agreementHasRequiredContract(agreement) || agreementEnterpriseId !== sourceEnterprise.enterpriseId) return false;
  if (!normalizedPurpose(purpose) || !activeAgreement(agreement)) return false;
  if (!agreementCoversDirection(agreement, sourceId, targetId) || !agreementCoversPurpose(agreement, purpose)) return false;
  return ["account", "source", "recipient"].every((party) => agreementApprovedBy(agreement, party));
}

/**
 * Produces a bounded, presentation-neutral portfolio read model. Only literal
 * causal graph edges can produce dependencies; agreements only produce an
 * authorized-information-sharing relation after every sharing gate passes.
 */
export function buildEnterprisePortfolioAnalysis({ projects = [], graph = {}, agreements = [] } = {}) {
  const sourceProjects = Array.isArray(projects) ? projects : [];
  const applications = sourceProjects
    .map((project) => {
      const id = projectId(project);
      if (!id) return null;
      return {
        projectId: id,
        projectName: projectName(project, id),
        origin: provenanceFor(project).origin,
        provenance: provenanceFor(project),
        enterprise: publicEnterprise(enterpriseTagFor(project)),
        brainX: brainXFor(project, projectName(project, id)),
        counts: emptyCounts()
      };
    })
    .filter(Boolean);
  const applicationById = new Map(applications.map((application) => [application.projectId, application]));
  const knownProjectIds = new Set(applicationById.keys());
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const links = Array.isArray(graph?.links) ? graph.links : [];
  const nodeById = new Map(nodes.map((node) => [endpointId(node?.id), node]));
  const nodeProjectById = new Map(nodes.map((node) => [endpointId(node?.id), graphProjectId(node, knownProjectIds)]));

  for (const node of nodes) {
    const ownerId = graphProjectId(node, knownProjectIds);
    const application = applicationById.get(ownerId);
    if (!application) continue;
    application.counts.nodes += 1;
    const typeKey = appTypeCountKey(text(node?.type, { lower: true }));
    if (typeKey) application.counts[typeKey] += 1;
  }

  const causalGroups = new Map();
  for (const [index, link] of links.entries()) {
    const sourceNodeId = endpointId(link?.source);
    const targetNodeId = endpointId(link?.target);
    const sourceProjectId = nodeProjectById.get(sourceNodeId) || graphProjectId(nodeById.get(sourceNodeId), knownProjectIds);
    const targetProjectId = nodeProjectById.get(targetNodeId) || graphProjectId(nodeById.get(targetNodeId), knownProjectIds);
    if (!sourceProjectId || !targetProjectId) continue;
    if (sourceProjectId === targetProjectId) {
      applicationById.get(sourceProjectId).counts.links += 1;
      continue;
    }
    if (!isExplicitCausalRelationship(link)) continue;
    const type = relationshipType(link);
    const key = `${sourceProjectId}\u0000${targetProjectId}\u0000${type}`;
    const group = causalGroups.get(key) || {
      id: `causal:${sourceProjectId}:${targetProjectId}:${type}`,
      kind: "causal_dependency",
      sourceProjectId,
      targetProjectId,
      type,
      count: 0,
      evidenceCount: 0,
      linkIds: [],
      sourceNodeIds: [],
      targetNodeIds: []
    };
    group.count += 1;
    group.evidenceCount += countEvidence(link);
    group.linkIds.push(text(link?.id, { maxLength: 240 }) || `link:${index + 1}`);
    group.sourceNodeIds.push(sourceNodeId);
    group.targetNodeIds.push(targetNodeId);
    causalGroups.set(key, group);
  }
  const causalRelationships = [...causalGroups.values()]
    .map((group) => ({
      ...group,
      linkIds: [...new Set(group.linkIds)].sort(),
      sourceNodeIds: [...new Set(group.sourceNodeIds)].sort(),
      targetNodeIds: [...new Set(group.targetNodeIds)].sort()
    }))
    .sort((left, right) => left.sourceProjectId.localeCompare(right.sourceProjectId)
      || left.targetProjectId.localeCompare(right.targetProjectId)
      || left.type.localeCompare(right.type));
  for (const relationship of causalRelationships) {
    applicationById.get(relationship.sourceProjectId).counts.outboundCausalRelationships += relationship.count;
    applicationById.get(relationship.targetProjectId).counts.inboundCausalRelationships += relationship.count;
  }

  const sharingGroups = new Map();
  for (const [index, agreement] of (Array.isArray(agreements) ? agreements : []).entries()) {
    const sourceIds = agreementProjectIds(agreement, "source");
    const targetIds = agreementProjectIds(agreement, "recipient");
    const purposes = (Array.isArray(agreement?.purposes) ? agreement.purposes : []).map(normalizedPurpose).filter(Boolean);
    for (const sourceProjectId of sourceIds) {
      for (const targetProjectId of targetIds) {
        const sourceProject = sourceProjects.find((project) => projectId(project) === sourceProjectId);
        const targetProject = sourceProjects.find((project) => projectId(project) === targetProjectId);
        if (!sourceProject || !targetProject) continue;
        for (const purpose of purposes) {
          if (!canShareApplicationInformation({ sourceProject, targetProject, agreement, purpose })) continue;
          const key = `${sourceProjectId}\u0000${targetProjectId}\u0000${purpose}`;
          const group = sharingGroups.get(key) || {
            id: `sharing:${sourceProjectId}:${targetProjectId}:${purpose}`,
            kind: "authorized_information_sharing",
            sourceProjectId,
            targetProjectId,
            purpose,
            count: 0,
            agreementIds: []
          };
          group.count += 1;
          group.agreementIds.push(text(agreement?.id, { maxLength: 240 }) || `agreement:${index + 1}`);
          sharingGroups.set(key, group);
        }
      }
    }
  }
  const sharingRelationships = [...sharingGroups.values()]
    .map((group) => ({ ...group, agreementIds: [...new Set(group.agreementIds)].sort() }))
    .sort((left, right) => left.sourceProjectId.localeCompare(right.sourceProjectId)
      || left.targetProjectId.localeCompare(right.targetProjectId)
      || left.purpose.localeCompare(right.purpose));
  for (const relationship of sharingRelationships) {
    applicationById.get(relationship.sourceProjectId).counts.sharingRelationships += relationship.count;
    applicationById.get(relationship.targetProjectId).counts.sharingRelationships += relationship.count;
  }

  const enterprises = [...new Map(applications
    .filter((application) => application.enterprise)
    .map((application) => [application.enterprise.id, {
      id: application.enterprise.id,
      name: application.enterprise.name,
      applicationIds: applications
        .filter((candidate) => candidate.enterprise?.id === application.enterprise.id)
        .map((candidate) => candidate.projectId)
        .sort()
    }]))
    .values()]
    .map((enterprise) => ({ ...enterprise, applicationCount: enterprise.applicationIds.length }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

  const originCounts = applications.reduce((counts, application) => {
    counts[application.origin] = (counts[application.origin] || 0) + 1;
    return counts;
  }, { plutomix_created: 0, imported: 0, unknown_legacy: 0 });
  return {
    applications: applications.sort((left, right) => left.projectName.localeCompare(right.projectName) || left.projectId.localeCompare(right.projectId)),
    causalRelationships,
    sharingRelationships,
    // `relationships` deliberately exposes causal edges only. Sharing consent
    // is separate from a runtime or technical dependency.
    relationships: causalRelationships,
    enterprises,
    sharingPolicy: {
      default: "deny",
      sameEnterpriseRequired: true,
      activeAgreementRequired: true,
      requiredApprovals: ["account", "source", "recipient"],
      directionAndPurposeRequired: true
    },
    generatedAt: new Date().toISOString(),
    summary: {
      applicationCount: applications.length,
      causalRelationshipCount: causalRelationships.length,
      sharingRelationshipCount: sharingRelationships.length,
      originCounts
    }
  };
}
