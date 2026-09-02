/**
 * Presentation-neutral model for the Portfolio Intelligence / BrainX canvas.
 *
 * This deliberately consumes the already-normalized portfolio directory and
 * relationship rows. It never turns an application name, a common agent, or
 * a shared enterprise display name into a portfolio relationship. In
 * particular, applications without an explicit enterprise ID stay private
 * application BrainX nodes; there is no synthetic shared "private" scope.
 */

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, { lower = false } = {}) {
  const normalized = typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : value === undefined || value === null
      ? ""
      : String(value).replace(/\s+/g, " ").trim();
  return lower ? normalized.toLowerCase() : normalized;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumberOr(value, fallback) {
  const parsed = numberOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

function compareText(left, right) {
  const first = text(left);
  const second = text(right);
  return first < second ? -1 : first > second ? 1 : 0;
}

function compareBy(...selectors) {
  return (left, right) => {
    for (const selector of selectors) {
      const difference = compareText(selector(left), selector(right));
      if (difference) return difference;
    }
    return 0;
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")} ]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function firstRecord(candidates) {
  return candidates.map(record).find((candidate) => Object.keys(candidate).length) || {};
}

function applicationId(value) {
  const source = record(value);
  const project = record(source.project);
  const portfolioRecord = record(source.portfolioRecord);
  return text(source.id || source.projectId || source.applicationId || project.id || project.projectId || portfolioRecord.projectId || portfolioRecord.id);
}

function applicationName(value, fallback) {
  const source = record(value);
  const project = record(source.project);
  const portfolioRecord = record(source.portfolioRecord);
  return text(source.name || source.projectName || source.applicationName || project.name || project.projectName || portfolioRecord.projectName || portfolioRecord.name) || fallback;
}

/**
 * Membership requires an explicit identifier. A display name alone is useful
 * in a directory, but it is not an enterprise boundary and must not create a
 * shared scope in this graph.
 */
function explicitEnterprise(value) {
  const source = record(value);
  const project = record(source.project);
  const portfolioRecord = record(source.portfolioRecord);
  const metadata = record(source.metadata);
  const projectMetadata = record(project.metadata);
  const portfolioMetadata = record(portfolioRecord.metadata);
  const embedded = firstRecord([
    source.enterprise,
    source.enterpriseMetadata,
    project.enterprise,
    project.enterpriseMetadata,
    portfolioRecord.enterprise,
    portfolioRecord.enterpriseMetadata,
    metadata.enterprise,
    projectMetadata.enterprise,
    portfolioMetadata.enterprise
  ]);
  const id = text(
    embedded.id
      || embedded.enterpriseId
      || source.enterpriseId
      || source.enterprise_id
      || project.enterpriseId
      || project.enterprise_id
      || portfolioRecord.enterpriseId
      || portfolioRecord.enterprise_id
      || metadata.enterpriseId
      || projectMetadata.enterpriseId
      || portfolioMetadata.enterpriseId,
    { lower: true }
  );
  if (!id) return null;
  return {
    id,
    name: text(
      embedded.name
        || embedded.enterpriseName
        || source.enterpriseName
        || source.enterprise_name
        || project.enterpriseName
        || project.enterprise_name
        || portfolioRecord.enterpriseName
        || portfolioRecord.enterprise_name
        || metadata.enterpriseName
        || projectMetadata.enterpriseName
        || portfolioMetadata.enterpriseName
    )
  };
}

function applicationBrainX(value) {
  const source = record(value);
  const project = record(source.project);
  const portfolioRecord = record(source.portfolioRecord);
  const metadata = record(source.metadata);
  const brainX = firstRecord([
    source.brainX,
    source.brainx,
    project.brainX,
    project.brainx,
    portfolioRecord.brainX,
    portfolioRecord.brainx,
    metadata.brainX,
    metadata.brainx
  ]);
  return {
    label: text(brainX.label || brainX.name),
    scope: text(brainX.scope, { lower: true }),
    summary: text(brainX.summary || brainX.description),
    updatedAt: text(brainX.updatedAt),
    publicationId: text(brainX.publicationId),
    publicationCount: numberOrNull(brainX.publicationCount),
    recorded: brainX.recorded === true || Boolean(text(brainX.updatedAt) || text(brainX.publicationId) || numberOrNull(brainX.publicationCount))
  };
}

function safeImageUrl(value) {
  const url = text(value);
  // Portfolio data can point at a managed media route or a normal HTTPS asset.
  // Do not pass local paths, protocol-relative URLs, or executable schemes to
  // the SVG image element.
  return /^(?:\/(?!\/)|https?:\/\/)/i.test(url) ? url : "";
}

function applicationIcon(value) {
  const source = record(value);
  const project = record(source.project);
  const portfolioRecord = record(source.portfolioRecord);
  const media = [
    ...array(source.media),
    ...array(project.media),
    ...array(portfolioRecord.media)
  ];
  const mediaIcon = media.find((item) => text(record(item).purpose, { lower: true }) === "app-icon") || {};
  const icon = firstRecord([
    source.appIcon,
    source.applicationIcon,
    project.appIcon,
    project.applicationIcon,
    portfolioRecord.appIcon,
    portfolioRecord.applicationIcon,
    mediaIcon
  ]);
  return {
    url: safeImageUrl(icon.urlPath || icon.url || source.appIconUrl || project.appIconUrl || portfolioRecord.appIconUrl),
    name: text(icon.name || icon.filename || icon.alt),
    kind: text(icon.kind || icon.type || icon.iconKey, { lower: true })
  };
}

/**
 * Resolve a managed project icon only against that application's preview
 * origin. A portfolio browser has no global `/uploads` proxy, and a relative
 * URL must never silently point at another application.
 */
export function resolvePortfolioAppIconUrl(application = {}) {
  const source = record(application);
  const project = record(source.project);
  const icon = record(source.appIcon);
  const url = safeImageUrl(icon.resolvedUrl || icon.url || icon.urlPath);
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const previewUrl = text(project.previewUrl);
  if (!/^https?:\/\//i.test(previewUrl)) return "";
  try {
    const resolved = new URL(url, previewUrl);
    return /^https?:$/i.test(resolved.protocol) ? resolved.toString() : "";
  } catch {
    return "";
  }
}

/**
 * Color is a presentation cue, not a relationship or permission signal. The
 * state uses only explicit node facts and deliberately does not inspect names
 * or free-form labels.
 */
export function portfolioAppVisualState(value = {}) {
  const source = record(value);
  const application = record(source.application);
  const attentionCount = numberOrNull(source.attentionCount ?? application.attentionCount);
  const isPrivate = source.isPrivate === true
    ? true
    : source.isPrivate === false
      ? false
      : source.scope === "application-private" || (!source.scope && !explicitEnterprise(application));
  const brainRecorded = source.brainRecorded === true || record(application.brainX).recorded === true;
  if (attentionCount !== null && attentionCount > 0) return "review";
  if (isPrivate) return "private";
  return brainRecorded ? "recorded" : "scope";
}

function applicationVisualType(value) {
  const source = record(value);
  const project = record(source.project);
  const portfolioRecord = record(source.portfolioRecord);
  const metadata = record(source.metadata);
  const projectMetadata = record(project.metadata);
  return text(
    source.iconKey
      || source.appType
      || source.applicationType
      || source.category
      || source.domain
      || project.iconKey
      || project.appType
      || project.applicationType
      || project.category
      || project.domain
      || portfolioRecord.iconKey
      || portfolioRecord.appType
      || portfolioRecord.applicationType
      || portfolioRecord.category
      || portfolioRecord.domain
      || metadata.iconKey
      || metadata.appType
      || projectMetadata.iconKey
      || projectMetadata.appType,
    { lower: true }
  );
}

function applicationCounts(value) {
  const source = record(value);
  const project = record(source.project);
  const portfolioRecord = record(source.portfolioRecord);
  const counts = firstRecord([source.counts, portfolioRecord.counts, project.counts]);
  return {
    features: numberOrNull(counts.features ?? source.featureCount ?? source.majorFunctionalityCount),
    apis: numberOrNull(counts.apis ?? source.apiCount),
    dataStores: numberOrNull(counts.dataStores ?? counts.databases ?? source.databaseCount),
    services: numberOrNull(counts.services ?? source.serviceCount),
    pages: numberOrNull(counts.pages ?? source.pageCount)
  };
}

function applicationAttention(value) {
  const source = record(value);
  const portfolioRecord = record(source.portfolioRecord);
  return numberOrNull(source.attentionCount ?? source.openDecisionCount ?? portfolioRecord.attentionCount ?? portfolioRecord.openDecisionCount);
}

function applicationSnapshot(value) {
  const source = record(value);
  const projectId = applicationId(source);
  const projectName = applicationName(source, projectId);
  const project = record(source.project);
  const portfolioRecord = record(source.portfolioRecord);
  const provenance = record(source.provenance || project.provenance || portfolioRecord.provenance);
  const projectSnapshot = Object.keys(project).length ? project : { id: projectId, name: projectName };
  const appIcon = applicationIcon(source);
  return {
    id: projectId,
    name: projectName,
    // Keep the directory project object for the existing application drill-in
    // route. The fallback is a local identifier only; it is not portfolio
    // evidence and does not create a relationship.
    project: projectSnapshot,
    status: text(source.status || project.status || portfolioRecord.status),
    summary: text(source.summary || project.summary || project.description || portfolioRecord.summary),
    enterprise: explicitEnterprise(source),
    brainX: applicationBrainX(source),
    appIcon: { ...appIcon, resolvedUrl: resolvePortfolioAppIconUrl({ project: projectSnapshot, appIcon }) },
    visualType: applicationVisualType(source),
    counts: applicationCounts(source),
    attentionCount: applicationAttention(source),
    evidenceCoverage: numberOrNull(source.evidenceCoverage ?? source.evidenceCoveragePercent ?? portfolioRecord.evidenceCoverage ?? portfolioRecord.evidenceCoveragePercent),
    origin: text(source.origin || project.origin || portfolioRecord.origin, { lower: true }),
    provenance: {
      origin: text(provenance.origin, { lower: true }),
      source: text(provenance.source),
      recordedAt: text(provenance.recordedAt)
    },
    updatedAt: text(source.updatedAt || project.updatedAt || portfolioRecord.updatedAt || project.createdAt)
  };
}

function applicationCompleteness(application) {
  return [
    application.name,
    application.status,
    application.summary,
    application.enterprise?.id,
    application.enterprise?.name,
    application.brainX.label,
    application.brainX.scope,
    application.brainX.summary,
    application.attentionCount,
    ...Object.values(application.counts)
  ].filter((value) => value !== "" && value !== null && value !== undefined).length;
}

function normalizedApplications(values) {
  const candidates = array(values)
    .map(applicationSnapshot)
    .filter((application) => application.id);
  const byId = new Map();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.id);
    if (!existing) {
      byId.set(candidate.id, candidate);
      continue;
    }
    // Duplicate directory rows can occur while the portfolio is refreshed.
    // Select a richer explicit record deterministically; never merge fields
    // across records because that could manufacture a scope or publication.
    const existingScore = applicationCompleteness(existing);
    const candidateScore = applicationCompleteness(candidate);
    if (candidateScore > existingScore || (candidateScore === existingScore && stableValue(candidate) < stableValue(existing))) byId.set(candidate.id, candidate);
  }
  return [...byId.values()].sort(compareBy((application) => application.name, (application) => application.id));
}

function relationKind(value) {
  const kind = text(record(value).kind, { lower: true });
  if (kind === "causal_dependency") return "causal-dependency";
  if (kind === "authorized_information_sharing") return "authorized-information-sharing";
  return "";
}

function normalizedRelation(value, applicationIds) {
  const source = record(value);
  const kind = relationKind(source);
  // This accepts only the contract emitted by normalizePortfolioRelations.
  // Raw relationship aliases are intentionally not reinterpreted here.
  const sourceProjectId = text(source.sourceProjectId);
  const targetProjectId = text(source.targetProjectId);
  if (!kind || !sourceProjectId || !targetProjectId || sourceProjectId === targetProjectId) return null;
  if (!applicationIds.has(sourceProjectId) || !applicationIds.has(targetProjectId)) return null;
  const type = text(source.type || source.relationship, { lower: true });
  const purpose = text(source.purpose, { lower: true });
  const discriminator = kind === "authorized-information-sharing"
    ? purpose || type || text(source.id)
    : type || text(source.id);
  return {
    id: text(source.id) || `${sourceProjectId}->${targetProjectId}:${discriminator || "relation"}`,
    kind,
    sourceProjectId,
    targetProjectId,
    type,
    purpose,
    label: text(source.label || source.relationshipLabel || source.type || source.purpose),
    description: text(source.description || source.reason),
    evidenceCount: positiveNumberOr(source.evidenceCount, array(source.evidence).length),
    agreementCount: positiveNumberOr(source.agreementCount, array(source.agreementIds).length),
    relationshipCount: positiveNumberOr(source.count, 1),
    recordedAt: text(source.recordedAt || source.updatedAt || source.createdAt),
    discriminator
  };
}

function relationGroupKey(relation) {
  return [relation.kind, relation.sourceProjectId, relation.targetProjectId, relation.discriminator].join("\u0000");
}

function applicationNodeId(applicationId) {
  return `application-brain:${encodeURIComponent(applicationId)}`;
}

function enterpriseNodeId(enterpriseId) {
  return `enterprise-scope:${encodeURIComponent(enterpriseId)}`;
}

function enterpriseBrainMetadata(hierarchy) {
  const source = record(hierarchy);
  const enterprise = record(source.enterprise || source.enterpriseBrain || source.enterprise_brain);
  return {
    label: text(enterprise.label || enterprise.name),
    summary: text(enterprise.summary || enterprise.description),
    updatedAt: text(enterprise.updatedAt),
    recorded: enterprise.recorded === true || Boolean(text(enterprise.updatedAt) || text(enterprise.publicationId) || numberOrNull(enterprise.publicationCount))
  };
}

function summaryMetadata(portfolioSummary) {
  const source = record(portfolioSummary);
  const nested = record(source.summary);
  // Preserve only the passed summary metadata. It is not used to infer graph
  // entities or links.
  return Object.fromEntries(Object.entries(Object.keys(nested).length ? nested : source)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value) || value === null));
}

/**
 * Build the data contract for a Portfolio Intelligence BrainX canvas.
 *
 * - Enterprise scope links come only from a concrete application enterprise
 *   ID.
 * - App-to-app links are projected only from pre-normalized relation rows.
 * - Causal dependency and authorized information sharing remain separate
 *   link kinds even when they connect the same two applications.
 */
export function buildPortfolioIntelligenceMap({ applications = [], relations = [], hierarchy = null, portfolioSummary = null } = {}) {
  const appRows = normalizedApplications(applications);
  const applicationIds = new Set(appRows.map((application) => application.id));
  const rootBrain = enterpriseBrainMetadata(hierarchy);
  const root = {
    id: "enterprise-brain:portfolio",
    kind: "enterprise-brain",
    label: rootBrain.label || "PlutoMix Enterprise Brain",
    summary: rootBrain.summary,
    updatedAt: rootBrain.updatedAt,
    recorded: rootBrain.recorded,
    portfolioSummary: summaryMetadata(portfolioSummary)
  };

  const enterpriseGroups = new Map();
  for (const application of appRows) {
    if (!application.enterprise?.id) continue;
    const current = enterpriseGroups.get(application.enterprise.id) || {
      id: application.enterprise.id,
      names: new Set(),
      applicationIds: []
    };
    if (application.enterprise.name) current.names.add(application.enterprise.name);
    current.applicationIds.push(application.id);
    enterpriseGroups.set(application.enterprise.id, current);
  }
  const enterpriseScopes = [...enterpriseGroups.values()]
    .map((group) => {
      const names = [...group.names].sort(compareText);
      const applicationIdsForScope = [...new Set(group.applicationIds)].sort(compareText);
      return {
        id: group.id,
        name: names[0] || group.id,
        applicationIds: applicationIdsForScope,
        applicationCount: applicationIdsForScope.length
      };
    })
    .sort(compareBy((enterprise) => enterprise.name, (enterprise) => enterprise.id));

  const scopeNodes = enterpriseScopes.map((enterprise) => ({
    id: enterpriseNodeId(enterprise.id),
    kind: "enterprise-scope",
    label: enterprise.name,
    enterprise: {
      id: enterprise.id,
      name: enterprise.name,
      applicationIds: enterprise.applicationIds,
      applicationCount: enterprise.applicationCount
    }
  }));
  const applicationNodes = appRows.map((application) => ({
    id: applicationNodeId(application.id),
    kind: "application-brain",
    label: application.brainX.label || `${application.name} App BrainX`,
    application,
    // This is a property of the individual node, not a shared private scope.
    scope: application.enterprise?.id ? "enterprise-scoped" : "application-private",
    isPrivate: !application.enterprise?.id,
    brainX: application.brainX,
    appIcon: application.appIcon,
    visualType: application.visualType,
    brainRecorded: application.brainX.recorded,
    counts: application.counts,
    attentionCount: application.attentionCount,
    summary: application.summary,
    provenance: application.provenance,
    project: application.project
  }));

  const links = [];
  for (const enterprise of enterpriseScopes) {
    links.push({
      id: `enterprise-scope:${encodeURIComponent(enterprise.id)}`,
      kind: "enterprise-scope",
      source: root.id,
      target: enterpriseNodeId(enterprise.id),
      enterprise: { id: enterprise.id, name: enterprise.name },
      applicationCount: enterprise.applicationCount
    });
    for (const appId of enterprise.applicationIds) {
      links.push({
        id: `application-scope:${encodeURIComponent(enterprise.id)}:${encodeURIComponent(appId)}`,
        kind: "application-scope",
        source: enterpriseNodeId(enterprise.id),
        target: applicationNodeId(appId),
        enterprise: { id: enterprise.id, name: enterprise.name },
        applicationId: appId
      });
    }
  }

  const uniqueRelations = new Map();
  for (const rawRelation of array(relations)) {
    const relation = normalizedRelation(rawRelation, applicationIds);
    if (!relation) continue;
    const identity = [relation.kind, relation.sourceProjectId, relation.targetProjectId, relation.id].join("\u0000");
    const existing = uniqueRelations.get(identity);
    // Normalized relationship IDs are unique. If a refresh supplies the same
    // row twice, keep one deterministic record rather than double-counting a
    // technical dependency or an authorization.
    if (!existing || stableValue(relation) < stableValue(existing)) uniqueRelations.set(identity, relation);
  }

  const groupedRelations = new Map();
  for (const relation of [...uniqueRelations.values()].sort(compareBy(
    (candidate) => candidate.kind,
    (candidate) => candidate.sourceProjectId,
    (candidate) => candidate.targetProjectId,
    (candidate) => candidate.id
  ))) {
    const key = relationGroupKey(relation);
    const group = groupedRelations.get(key) || {
      ...relation,
      relationIds: [],
      records: [],
      evidenceCount: 0,
      agreementCount: 0,
      relationshipCount: 0
    };
    group.relationIds.push(relation.id);
    group.records.push(relation);
    group.evidenceCount += relation.evidenceCount;
    group.agreementCount += relation.agreementCount;
    group.relationshipCount += relation.relationshipCount;
    groupedRelations.set(key, group);
  }
  const relationshipLinks = [...groupedRelations.values()]
    .map((group) => {
      const records = [...group.records].sort(compareBy((relation) => relation.id, (relation) => relation.recordedAt));
      const primary = records[0];
      return {
        id: `${group.kind}:${encodeURIComponent(group.sourceProjectId)}:${encodeURIComponent(group.targetProjectId)}:${encodeURIComponent(group.discriminator || primary.id)}`,
        kind: group.kind,
        source: applicationNodeId(group.sourceProjectId),
        target: applicationNodeId(group.targetProjectId),
        sourceProjectId: group.sourceProjectId,
        targetProjectId: group.targetProjectId,
        type: primary.type,
        purpose: primary.purpose,
        label: primary.label,
        description: primary.description,
        recordedAt: primary.recordedAt,
        relationIds: [...new Set(group.relationIds)].sort(compareText),
        relationshipCount: group.relationshipCount,
        evidenceCount: group.evidenceCount,
        agreementCount: group.agreementCount,
        records
      };
    })
    .sort(compareBy((link) => link.kind, (link) => link.sourceProjectId, (link) => link.targetProjectId, (link) => link.type || link.purpose || link.id));
  links.push(...relationshipLinks);

  const orderedLinks = links.sort(compareBy(
    (link) => ({ "enterprise-scope": "0", "application-scope": "1", "causal-dependency": "2", "authorized-information-sharing": "3" }[link.kind] || "9"),
    (link) => link.source,
    (link) => link.target,
    (link) => link.id
  ));
  const causalLinks = relationshipLinks.filter((link) => link.kind === "causal-dependency");
  const sharingLinks = relationshipLinks.filter((link) => link.kind === "authorized-information-sharing");
  const privateApplicationCount = applicationNodes.filter((node) => node.scope === "application-private").length;

  return {
    root,
    nodes: [root, ...scopeNodes, ...applicationNodes],
    links: orderedLinks,
    summary: {
      applicationCount: applicationNodes.length,
      enterpriseScopeCount: scopeNodes.length,
      privateApplicationCount,
      nodeCount: 1 + scopeNodes.length + applicationNodes.length,
      linkCount: orderedLinks.length,
      enterpriseScopeLinkCount: scopeNodes.length,
      applicationScopeLinkCount: applicationNodes.length - privateApplicationCount,
      causalDependencyCount: causalLinks.length,
      authorizedInformationSharingCount: sharingLinks.length,
      causalRelationshipCount: causalLinks.reduce((total, link) => total + link.relationshipCount, 0),
      authorizedInformationSharingRelationshipCount: sharingLinks.reduce((total, link) => total + link.relationshipCount, 0),
      applicationAttentionCount: applicationNodes.reduce((total, node) => total + (node.application.attentionCount || 0), 0)
    }
  };
}

function finiteDimension(value, fallback, minimum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

function portfolioLayoutPlan(map = {}) {
  const nodes = array(record(map).nodes);
  const root = nodes.find((node) => node?.kind === "enterprise-brain") || null;
  const scopes = nodes.filter((node) => node?.kind === "enterprise-scope");
  const applications = nodes.filter((node) => node?.kind === "application-brain");
  const links = array(record(map).links);
  const appsByScope = new Map(scopes.map((scope) => [scope.id, []]));
  const scopedApplicationIds = new Set();

  for (const link of links) {
    if (link?.kind !== "application-scope" || !appsByScope.has(link.source)) continue;
    const application = applications.find((node) => node.id === link.target);
    if (!application) continue;
    appsByScope.get(link.source).push(application);
    scopedApplicationIds.add(application.id);
  }
  for (const applicationsForScope of appsByScope.values()) {
    applicationsForScope.sort(compareBy((node) => node.application?.name, (node) => node.application?.id));
  }

  const privateApps = applications
    .filter((application) => !scopedApplicationIds.has(application.id))
    .sort(compareBy((node) => node.application?.name, (node) => node.application?.id));
  const scopedApps = scopes.flatMap((scope) => appsByScope.get(scope.id) || []);

  // A chord on a circle is the real visual separation between neighbouring
  // nodes. Deriving radii from that chord keeps the perimeter layout legible
  // as portfolios grow without falling back to a rectangular grid.
  const radiusForCount = (count, separation) => count > 1
    ? separation / (2 * Math.sin(Math.PI / count))
    : 0;
  const scopeRadius = Math.max(230, radiusForCount(scopes.length, 238));
  const scopedApplicationRadius = Math.max(430, radiusForCount(scopedApps.length, 126), scopeRadius + 168);
  const privateApplicationRadius = privateApps.length
    ? Math.max(scopedApps.length ? scopedApplicationRadius + 148 : 430, radiusForCount(privateApps.length, 126))
    : 0;
  const outerRadius = Math.max(scopedApplicationRadius, privateApplicationRadius, scopeRadius);

  return {
    root,
    scopes,
    applications,
    appsByScope,
    privateApps,
    scopedApps,
    scopeRadius,
    scopedApplicationRadius,
    privateApplicationRadius,
    outerRadius
  };
}

/**
 * Calculate a roomy deterministic canvas for concentric portfolio perimeters.
 * The dimensions grow with circumference so dense portfolios keep a useful
 * gap between application icons without introducing a grid.
 */
export function portfolioIntelligenceCanvasDimensions(map = {}, { minWidth = 1120, minHeight = 720 } = {}) {
  const plan = portfolioLayoutPlan(map);
  const safeMinWidth = finiteDimension(minWidth, 1120, 560);
  const safeMinHeight = finiteDimension(minHeight, 720, 420);
  const diameter = Math.ceil((plan.outerRadius + 112) * 2);
  return {
    width: Math.max(safeMinWidth, diameter),
    height: Math.max(safeMinHeight, diameter)
  };
}

/**
 * Stable initial positions for a D3/SVG renderer. Enterprise applications are
 * ordered in contiguous sectors on a shared perimeter; their enterprise-name
 * nodes sit on the inner perimeter at each sector's midpoint. Unassigned apps
 * occupy a slightly more distant perimeter while remaining inside the same
 * viewBox. This is deterministic and encodes no relationship beyond the links
 * already present in the model.
 */
export function seedPortfolioIntelligenceLayout(map = {}, width = 1200, height = 720) {
  const safeWidth = finiteDimension(width, 1200, 560);
  const safeHeight = finiteDimension(height, 720, 420);
  const nodes = array(record(map).nodes);
  const plan = portfolioLayoutPlan(map);
  const {
    root,
    scopes,
    appsByScope,
    privateApps,
    scopedApps,
    scopeRadius,
    scopedApplicationRadius,
    privateApplicationRadius,
    outerRadius
  } = plan;
  const positions = new Map();
  const center = { x: safeWidth / 2, y: safeHeight / 2 };
  const availableRadius = Math.max(1, Math.min(safeWidth, safeHeight) / 2 - 72);
  const radiusScale = Math.min(1, availableRadius / Math.max(1, outerRadius));
  const pointOnPerimeter = (radius, angle) => ({
    x: center.x + radius * radiusScale * Math.cos(angle),
    y: center.y + radius * radiusScale * Math.sin(angle)
  });

  if (root) positions.set(root.id, center);

  const startAngle = -Math.PI / 2;
  const scopedAngles = new Map();
  const scopedStep = scopedApps.length ? (Math.PI * 2) / scopedApps.length : 0;
  for (const [index, application] of scopedApps.entries()) {
    const angle = startAngle + index * scopedStep;
    scopedAngles.set(application.id, angle);
    positions.set(application.id, pointOnPerimeter(scopedApplicationRadius, angle));
  }

  for (const [index, scope] of scopes.entries()) {
    const scopeApps = appsByScope.get(scope.id) || [];
    let angle = startAngle + (index * Math.PI * 2) / Math.max(1, scopes.length);
    if (scopeApps.length) {
      const firstApplicationIndex = scopedApps.findIndex((application) => application.id === scopeApps[0].id);
      // A single enterprise owns the full outer perimeter, whose vector mean
      // is zero; anchor its name at twelve o'clock. Otherwise use the exact
      // midpoint of the enterprise's contiguous perimeter sector.
      angle = scopeApps.length === scopedApps.length
        ? startAngle
        : startAngle + (firstApplicationIndex + (scopeApps.length - 1) / 2) * scopedStep;
    }
    positions.set(scope.id, pointOnPerimeter(scopeRadius, angle));
  }

  const privateStep = privateApps.length ? (Math.PI * 2) / privateApps.length : 0;
  for (const [index, application] of privateApps.entries()) {
    // Offset the outer ring so unassigned nodes do not sit directly behind
    // enterprise-scoped nodes even when both rings contain the same count.
    const angle = startAngle + privateStep / 2 + index * privateStep;
    positions.set(application.id, pointOnPerimeter(privateApplicationRadius, angle));
  }

  return nodes.map((node) => ({
    ...node,
    ...(positions.get(node.id) || { x: safeWidth / 2, y: safeHeight / 2 })
  }));
}
