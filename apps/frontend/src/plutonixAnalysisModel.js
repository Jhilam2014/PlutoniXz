const REJECTED_BRANCH_STATUSES = new Set([
  "rejected",
  "superseded",
  "archived",
  "retired",
  "disabled",
  "dead",
  "abandoned",
  "expired",
  "withdrawn"
]);

const APPLICATION_ORIGINS = new Set(["plutonix_created", "imported", "unknown_legacy"]);

const ANTICIPATED_REJECTION_BY_CATEGORY = {
  ui: {
    title: "Replace the interface without compatibility and accessibility validation",
    reason: "Anticipated as unsuitable because an unvalidated interface replacement can break established user flows and accessibility behavior.",
    constraints: ["Compatibility evidence is required", "Accessibility validation is required"]
  },
  api: {
    title: "Replace the API contract without a compatibility boundary",
    reason: "Anticipated as unsuitable because existing callers may depend on the observed request and response contract.",
    constraints: ["Backward compatibility must be preserved", "Consumer migration evidence is not recorded"]
  },
  data: {
    title: "Use a destructive data-model replacement",
    reason: "Anticipated as unsuitable because destructive replacement creates avoidable migration and data-loss risk.",
    constraints: ["Existing data must remain recoverable", "A verified migration and rollback path is required"]
  },
  integration: {
    title: "Call the provider without an isolation or failure boundary",
    reason: "Anticipated as unsuitable because unbounded provider failures can propagate into the application workflow.",
    constraints: ["Provider failure must remain contained", "Timeout and retry behavior must be bounded"]
  },
  security: {
    title: "Bypass the observed authorization boundary",
    reason: "Anticipated as unsuitable because convenience cannot override recorded access and audit requirements.",
    constraints: ["Authorization policy must remain enforced", "Access outcomes must remain auditable"]
  },
  test: {
    title: "Rely only on manual verification",
    reason: "Anticipated as unsuitable because manual-only verification cannot provide repeatable regression evidence.",
    constraints: ["Repeatable validation evidence is required", "Regression coverage must be reviewable"]
  },
  runtime: {
    title: "Operate without health or recovery boundaries",
    reason: "Anticipated as unsuitable because failures would be difficult to detect and recover safely.",
    constraints: ["Runtime health must be observable", "Recovery behavior must be bounded"]
  },
  other: {
    title: "Rewrite the capability without an evidence-backed boundary",
    reason: "Anticipated as unsuitable because the source scan does not establish a safe compatibility or rollback path.",
    constraints: ["Compatibility evidence is required", "A reversible validation path is required"]
  }
};

function array(value) {
  return Array.isArray(value) ? value : [];
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value).trim();
}

function idFor(value = {}) {
  return text(value.id || value.projectId || value.workspaceId || value.applicationId);
}

function labelFor(value = {}, fallback = "Unnamed application") {
  return text(value.name || value.label || value.projectName || value.applicationName) || fallback;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validTimestamp(value) {
  const normalized = text(value);
  const timestamp = Date.parse(normalized);
  return normalized && Number.isFinite(timestamp) ? { value: normalized, timestamp } : { value: "", timestamp: null };
}

function uniqueStrings(values) {
  return [...new Set(array(values).map(text).filter(Boolean))];
}

function enterpriseAssignment(value = {}) {
  const source = record(value);
  const metadata = record(source.metadata);
  const enterprise = record(source.enterprise || metadata.enterprise);
  return {
    id: text(enterprise.id || source.enterpriseId || source.enterprise_id || metadata.enterpriseId),
    name: text(enterprise.name || source.enterpriseName || source.enterprise_name || metadata.enterpriseName)
  };
}

export function applicationOrigin(value = {}) {
  const source = record(value);
  const project = record(source.project || source);
  const portfolioRecord = record(source.portfolioRecord);
  const candidates = [
    record(project.provenance),
    record(source.provenance),
    record(portfolioRecord.provenance)
  ];
  let explicitOrigin = [
    ...candidates.map((candidate) => text(candidate.origin).toLowerCase()),
    text(project.origin).toLowerCase(),
    text(source.origin).toLowerCase(),
    text(portfolioRecord.origin).toLowerCase()
  ].find((candidate) => APPLICATION_ORIGINS.has(candidate)) || "unknown_legacy";
  const legacyProductDecision = record(project.productDecision);
  if (explicitOrigin === "unknown_legacy" && Object.keys(legacyProductDecision).length) explicitOrigin = "plutonix_created";
  const provenance = candidates.find((candidate) => text(candidate.origin).toLowerCase() === explicitOrigin) || {};
  return {
    kind: explicitOrigin,
    label: explicitOrigin === "plutonix_created"
      ? "PlutoniX-created"
      : explicitOrigin === "imported"
        ? "Imported application"
        : "Application origin not recorded",
    recordedAt: text(provenance.recordedAt || (Object.keys(legacyProductDecision).length ? project.createdAt : "")),
    source: text(provenance.source) || (Object.keys(legacyProductDecision).length ? "legacy_plutonix_product_decision" : explicitOrigin === "unknown_legacy" ? "provenance_not_recorded" : "project_record"),
    recorded: explicitOrigin !== "unknown_legacy"
  };
}

function portfolioApplications(portfolio) {
  const source = record(portfolio);
  return array(source.applications).length
    ? array(source.applications)
    : array(source.projects).length
      ? array(source.projects)
      : array(record(source.portfolio).applications);
}

function portfolioRelations(portfolio) {
  const source = record(portfolio);
  const nested = record(source.portfolio);
  const typedRows = (rows, portfolioRelationKind) => array(rows).map((row) => ({
    ...record(row),
    __portfolioRelationKind: portfolioRelationKind
  }));
  return [
    ...typedRows(source.causalRelationships, "causal_dependency"),
    ...typedRows(source.relationships, "causal_dependency"),
    ...typedRows(source.relations, "recorded_relationship"),
    ...typedRows(source.applicationRelations, "recorded_relationship"),
    ...typedRows(source.sharingRelationships, "authorized_information_sharing"),
    ...typedRows(nested.causalRelationships, "causal_dependency"),
    ...typedRows(nested.relationships, "causal_dependency"),
    ...typedRows(nested.relations, "recorded_relationship"),
    ...typedRows(nested.applicationRelations, "recorded_relationship"),
    ...typedRows(nested.sharingRelationships, "authorized_information_sharing")
  ];
}

function projectReference(value = {}) {
  return text(value.projectId || value.workspaceId || value.applicationId || value.id);
}

function relationEndpoint(value = {}, direction) {
  const source = record(value);
  const candidates = direction === "source"
    ? [source.sourceProjectId, source.sourceApplicationId, source.fromProjectId, source.fromApplicationId, source.producerProjectId, source.producerApplicationId, source.sourceId, source.from, source.producer]
    : [source.targetProjectId, source.targetApplicationId, source.toProjectId, source.toApplicationId, source.recipientProjectId, source.recipientApplicationId, source.targetId, source.to, source.recipient];
  return text(candidates.find((candidate) => text(candidate)));
}

function evidenceRows(value = {}) {
  const source = record(value);
  const candidate = record(source.candidate);
  return [
    source.evidence,
    source.evidenceReferences,
    source.references,
    source.evidenceIds,
    candidate.evidence,
    candidate.evidenceReferences,
    candidate.evidenceIds
  ].find((entry) => array(entry).length) || [];
}

function functionalityId(value = {}) {
  const source = record(value);
  return text(source.functionalityId || record(source.candidate).functionalityId || source.majorFunctionalityId);
}

function branchStatus(value = {}) {
  return text(record(value).status).toLowerCase();
}

function branchInferenceRole(value = {}) {
  const source = record(value);
  return text(source.inferenceRole || record(source.candidate).inferenceRole).toLowerCase();
}

function isObservedCurrent(value = {}) {
  return branchStatus(value) !== "selected" && branchInferenceRole(value) === "observed_current";
}

export function decisionState(value = {}) {
  const status = branchStatus(value);
  if (status === "selected") return "selected";
  if (isObservedCurrent(value)) return "observed_current";
  if (REJECTED_BRANCH_STATUSES.has(status)) return "rejected";
  const candidateRole = branchInferenceRole(value);
  const disposition = record(record(value).disposition);
  const dispositionState = text(disposition.status || disposition.state).toLowerCase();
  if (status === "deferred" || dispositionState === "deferred" || candidateRole === "deferred_alternative") return "deferred";
  return "recorded";
}

export function decisionStateLabel(state, recordClassification = "") {
  return ({
    selected: "Selected by record",
    observed_current: recordClassification === "source_observed" ? "Source-observed current implementation" : "Observed current implementation",
    deferred: "Deferred / reviewable",
    rejected: "Rejected or dormant record",
    anticipated: "Anticipated alternative",
    anticipated_rejected: "Anticipated rejection",
    recorded: "Recorded decision"
  })[state] || "Recorded decision";
}

export function branchReason(value = {}) {
  const source = record(value);
  return text(record(source.disposition).reason || record(source.candidate).decisionRationale || source.decisionRationale || source.rationale || source.dispositionReason || source.reason);
}

export function branchConstraints(value = {}) {
  const source = record(value);
  const candidate = record(source.candidate);
  const definitions = array(source.constraintDefinitions).map((constraint) => {
    const row = record(constraint);
    const identity = [text(row.id), text(row.version) ? `v${text(row.version)}` : ""].filter(Boolean).join(" ");
    const rule = [text(row.type), text(row.field), text(row.operator), row.expected === undefined ? "" : text(row.expected)].filter(Boolean).join(" · ");
    return [identity, rule].filter(Boolean).join(": ");
  }).filter(Boolean);
  const raw = source.constraints ?? candidate.constraints ?? candidate.constraintSummary;
  if (typeof raw === "string") return uniqueStrings([raw, ...definitions]);
  if (Array.isArray(raw)) return uniqueStrings([...raw.map((entry) => typeof entry === "string" ? entry.trim() : text(record(entry).label || record(entry).reason || entry)).filter(Boolean), ...definitions]);
  if (raw && typeof raw === "object") {
    return uniqueStrings([...Object.entries(raw)
      .filter(([, entry]) => entry !== null && entry !== undefined && text(entry))
      .map(([key, entry]) => `${key}: ${text(entry)}`), ...definitions]);
  }
  return definitions;
}

export function normalizePortfolioRelations(portfolio) {
  const seen = new Set();
  return portfolioRelations(portfolio).flatMap((raw, index) => {
    const source = relationEndpoint(raw, "source");
    const target = relationEndpoint(raw, "target");
    if (!source || !target || source === target) return [];
    const relation = record(raw);
    const relationType = text(relation.type || relation.relationship || relation.sharingRelationshipType || relation.purpose);
    const kind = text(relation.kind || relation.__portfolioRelationKind).toLowerCase() || "recorded_relationship";
    const id = text(relation.id) || `${source}->${target}:${relationType || index}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const evidence = evidenceRows(relation);
    const agreementIds = uniqueStrings(relation.agreementIds);
    const explicitEvidenceCount = numberOrNull(relation.evidenceCount);
    return [{
      id,
      sourceProjectId: source,
      targetProjectId: target,
      kind,
      type: relationType || "recorded_relationship",
      label: text(relation.label || relation.relationshipLabel || relationType) || "Recorded relationship",
      kindLabel: kind === "causal_dependency"
        ? "Causal dependency"
        : kind === "authorized_information_sharing"
          ? "Authorized information sharing"
          : "Recorded relationship",
      description: text(relation.description || relation.reason),
      purpose: text(relation.purpose),
      evidence,
      evidenceCount: explicitEvidenceCount ?? evidence.length,
      agreementCount: numberOrNull(relation.agreementCount) ?? agreementIds.length,
      recordedAt: text(relation.recordedAt || relation.updatedAt || relation.createdAt)
    }];
  });
}

export function relationsForProject(relations = [], projectId = "") {
  const id = text(projectId);
  if (!id) return [];
  return array(relations).filter((relation) => relation?.sourceProjectId === id || relation?.targetProjectId === id);
}

export function buildPortfolioDirectory({ projects = [], portfolio = null, query = "", status = "all" } = {}) {
  const projectRows = array(projects).filter((project) => idFor(project));
  const portfolioByProjectId = new Map(portfolioApplications(portfolio)
    .map((application) => [projectReference(application), application])
    .filter(([id]) => id));
  const sourceRows = projectRows.length ? projectRows : portfolioApplications(portfolio);
  const normalizedQuery = text(query).toLowerCase();
  const requestedStatus = text(status).toLowerCase() || "all";

  return sourceRows
    .map((project) => {
      const id = idFor(project);
      const portfolioRecord = record(portfolioByProjectId.get(id));
      const projectMetadata = record(project.metadata);
      const portfolioMetadata = record(portfolioRecord.metadata);
      const projectEnterprise = enterpriseAssignment(project);
      const portfolioEnterprise = enterpriseAssignment(portfolioRecord);
      const explicitStatus = text(portfolioRecord.status || project.analysisStatus || project.status || projectMetadata.analysisStatus);
      const portfolioCounts = record(portfolioRecord.counts);
      const explicitAttention = numberOrNull(portfolioRecord.attentionCount ?? portfolioRecord.openDecisionCount ?? project.attentionCount);
      const explicitFunctionalityCount = numberOrNull(portfolioRecord.majorFunctionalityCount ?? portfolioRecord.functionalityCount ?? portfolioCounts.features ?? project.majorFunctionalityCount);
      const explicitEvidenceCoverage = numberOrNull(portfolioRecord.evidenceCoverage ?? portfolioRecord.evidenceCoveragePercent);
      const origin = applicationOrigin({ ...project, portfolioRecord, project });
      return {
        id,
        name: labelFor(project, labelFor(portfolioRecord)),
        project,
        status: explicitStatus || "unknown",
        summary: text(portfolioRecord.summary || project.summary || project.description || portfolioMetadata.summary),
        origin: origin.kind,
        provenance: origin,
        enterprise: {
          id: projectEnterprise.id || portfolioEnterprise.id,
          name: projectEnterprise.name || portfolioEnterprise.name
        },
        attentionCount: explicitAttention,
        majorFunctionalityCount: explicitFunctionalityCount,
        counts: {
          features: numberOrNull(portfolioCounts.features ?? portfolioRecord.featureCount ?? project.featureCount),
          apis: numberOrNull(portfolioCounts.apis ?? portfolioRecord.apiCount ?? project.apiCount),
          dataStores: numberOrNull(portfolioCounts.databases ?? portfolioCounts.dataStores ?? portfolioRecord.databaseCount ?? project.databaseCount),
          services: numberOrNull(portfolioCounts.services ?? portfolioRecord.serviceCount ?? project.serviceCount),
          pages: numberOrNull(portfolioCounts.pages ?? portfolioRecord.pageCount ?? project.pageCount)
        },
        evidenceCoverage: explicitEvidenceCoverage,
        updatedAt: text(portfolioRecord.updatedAt || project.updatedAt || project.createdAt),
        brainX: record(portfolioRecord.brainX || portfolioRecord.brainx || project.brainX || project.brainx),
        portfolioRecord
      };
    })
    .filter((project) => {
      if (requestedStatus !== "all" && project.status.toLowerCase() !== requestedStatus) return false;
      if (!normalizedQuery) return true;
      return [project.name, project.summary, project.status, project.enterprise.name]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .sort((left, right) => {
      const leftAttention = left.attentionCount ?? -1;
      const rightAttention = right.attentionCount ?? -1;
      return rightAttention - leftAttention || left.name.localeCompare(right.name);
    });
}

export function buildBrainHierarchy({ portfolio = null, directory = [] } = {}) {
  const source = record(portfolio);
  const enterpriseBrain = record(source.enterpriseBrain || source.enterprise_brain || record(source.portfolio).enterpriseBrain);
  return {
    enterprise: {
      label: text(enterpriseBrain.label || enterpriseBrain.name) || "PlutoniX Enterprise Brain",
      summary: text(enterpriseBrain.summary || enterpriseBrain.description) || "Curated portfolio knowledge is available only through explicit enterprise publication and sharing agreements.",
      updatedAt: text(enterpriseBrain.updatedAt),
      recorded: Boolean(text(enterpriseBrain.updatedAt) || text(enterpriseBrain.publicationId) || Number(enterpriseBrain.publicationCount) > 0)
    },
    applications: array(directory).map((application) => ({
      projectId: application.id,
      projectName: application.name,
      label: text(application.brainX.label || application.brainX.name) || "App BrainX",
      summary: text(application.brainX.summary || application.brainX.description),
      updatedAt: text(application.brainX.updatedAt),
      recorded: Boolean(text(application.brainX.updatedAt) || text(application.brainX.publicationId) || Number(application.brainX.publicationCount) > 0)
    }))
  };
}

export function analysisFunctionalities(architectureAnalysisReport) {
  const report = record(architectureAnalysisReport);
  const source = array(report.majorFunctionalities).length ? array(report.majorFunctionalities) : array(report.functionalities);
  const sourceEntities = new Map(array(report.functionalities).map((functionality) => [text(functionality?.id), functionality]));
  return source
    .filter((functionality) => text(functionality?.id))
    .map((functionality) => {
      const entityIds = uniqueStrings([functionality.sourceEntityId, ...array(functionality.sourceEntityIds)]);
      const chronologySources = [functionality, ...entityIds.map((id) => sourceEntities.get(id)).filter(Boolean)]
        .map((entry) => record(record(entry).chronology));
      const ranked = chronologySources
        .map((chronology) => ({
          deliveryOrder: numberOrNull(chronology.deliveryOrder ?? chronology.order),
          deliveryPhase: text(chronology.deliveryPhase || chronology.phase),
          sourceModifiedAt: text(chronology.sourceModifiedAt),
          sourcePath: text(chronology.sourcePath),
          basis: text(chronology.basis),
          confidence: numberOrNull(chronology.confidence)
        }))
        .sort((left, right) => (left.deliveryOrder ?? Number.MAX_SAFE_INTEGER) - (right.deliveryOrder ?? Number.MAX_SAFE_INTEGER)
          || left.sourcePath.localeCompare(right.sourcePath));
      const sequence = ranked[0] || {};
      return {
        id: text(functionality.id),
        label: labelFor(functionality, text(functionality.id)),
        description: text(functionality.description || functionality.summary || functionality.observedCurrent?.description),
        objectiveId: text(functionality.objectiveId),
        category: text(functionality.category) || "other",
        evidence: evidenceRows(functionality),
        features: array(functionality.features),
        sourceEntityId: text(functionality.sourceEntityId),
        sourceEntityIds: entityIds,
        sequence: {
          order: sequence.deliveryOrder,
          deliveryPhase: sequence.deliveryPhase || "",
          basis: sequence.basis || (sequence.deliveryOrder !== null && sequence.deliveryOrder !== undefined ? "source_inferred_delivery" : "unsequenced_source_analysis"),
          confidence: sequence.confidence,
          sourceModifiedAt: sequence.sourceModifiedAt || "",
          historicalClaim: false
        }
      };
    })
    .sort((left, right) => (left.sequence.order ?? Number.MAX_SAFE_INTEGER) - (right.sequence.order ?? Number.MAX_SAFE_INTEGER)
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id));
}

export function analysisObjectives(architectureAnalysisReport) {
  return array(record(architectureAnalysisReport).objectives)
    .filter((objective) => text(objective?.id))
    .map((objective) => ({
      id: text(objective.id),
      label: labelFor(objective, text(objective.id)),
      description: text(objective.description || objective.summary),
      majorFunctionalityIds: uniqueStrings(objective.majorFunctionalityIds)
    }));
}

function sourceBranchKey(branch = {}) {
  return `${functionalityId(branch)}\u0000${text(branch.objective?.summary || branch.label || branch.title).toLowerCase()}`;
}

function genericAnticipatedAlternative(functionality, sourceDigest) {
  return {
    id: `anticipated-alternative:${sourceDigest.slice(0, 12) || "live"}:${functionality.id}`,
    functionalityId: functionality.id,
    title: "Introduce an evidence-backed compatibility boundary",
    status: "anticipated",
    inferenceRole: "anticipated_alternative",
    sourceDigest,
    evidence: functionality.evidence,
    historicalClaim: false,
    candidate: {
      inferenceRole: "anticipated_alternative",
      functionalityId: functionality.id,
      description: "A reversible boundary is a possible future option for this source-observed capability, pending compatibility and validation evidence.",
      decisionRationale: "This is a source-derived possibility, not a recorded historical deferral.",
      generatedBy: "deterministic_source_pattern"
    },
    constraints: ["Compatibility evidence is not recorded", "Validation outcome is not recorded"],
    __recordSource: "architecture_report"
  };
}

function anticipatedRejectedBranch(functionality, sourceDigest) {
  const pattern = ANTICIPATED_REJECTION_BY_CATEGORY[functionality.category] || ANTICIPATED_REJECTION_BY_CATEGORY.other;
  return {
    id: `anticipated-rejected:${sourceDigest.slice(0, 12) || "live"}:${functionality.id}`,
    functionalityId: functionality.id,
    title: pattern.title,
    status: "anticipated_rejected",
    inferenceRole: "anticipated_rejected",
    sourceDigest,
    evidence: functionality.evidence,
    historicalClaim: false,
    reason: pattern.reason,
    constraints: pattern.constraints,
    candidate: {
      inferenceRole: "anticipated_rejected",
      functionalityId: functionality.id,
      description: pattern.reason,
      decisionRationale: pattern.reason,
      generatedBy: "constraint_counterfactual"
    },
    __recordSource: "architecture_report"
  };
}

export function sourceDecisionBranches({ architectureAnalysisReport = null, project = null } = {}) {
  const report = record(architectureAnalysisReport);
  if (!text(report.sourceDigest) && !array(report.majorFunctionalities).length && !array(report.functionalities).length) return [];
  const sourceDigest = text(report.sourceDigest);
  const functionalities = analysisFunctionalities(report);
  const origin = applicationOrigin(project || { origin: report.projectOrigin });
  const rows = array(report.branches).map((branch) => ({ ...record(branch), __recordSource: "architecture_report" }));
  const keys = new Set(rows.map(sourceBranchKey));
  const addUniqueSourceBranch = (branch) => {
    const key = sourceBranchKey(branch);
    if (keys.has(key)) return false;
    rows.push(branch);
    keys.add(key);
    return true;
  };

  for (const functionality of functionalities) {
    const currentExists = rows.some((branch) => functionalityId(branch) === functionality.id && branchInferenceRole(branch) === "observed_current");
    if (!currentExists) {
      const current = {
        id: `source-observed:${sourceDigest.slice(0, 12) || "live"}:${functionality.id}`,
        functionalityId: functionality.id,
        title: functionality.label,
        status: "observed",
        inferenceRole: "observed_current",
        sourceDigest,
        evidence: functionality.evidence,
        historicalClaim: false,
        candidate: {
          inferenceRole: "observed_current",
          functionalityId: functionality.id,
          description: functionality.description || "The current implementation is observed in source.",
          decisionRationale: "Source evidence establishes what exists, not who selected it or why."
        },
        __recordSource: "architecture_report"
      };
      addUniqueSourceBranch(current);
    }
  }

  for (const candidate of array(report.publishedCandidates)) {
    const normalized = {
      ...record(candidate),
      id: text(candidate?.id) || `anticipated:${sourceDigest.slice(0, 12)}:${rows.length + 1}`,
      title: text(candidate?.title) || "Anticipated alternative",
      status: "anticipated",
      inferenceRole: "anticipated_alternative",
      sourceDigest,
      historicalClaim: false,
      candidate: {
        ...record(candidate),
        inferenceRole: "anticipated_alternative",
        decisionRationale: text(candidate?.rationale) || "This is an evidence-supported possibility, not a recorded historical deferral."
      },
      __recordSource: "architecture_report"
    };
    addUniqueSourceBranch(normalized);
  }

  if (origin.kind !== "plutonix_created") {
    for (const functionality of functionalities) {
      const hasAlternative = rows.some((branch) => functionalityId(branch) === functionality.id
        && ["deferred_alternative", "anticipated_alternative"].includes(branchInferenceRole(branch)));
      if (!hasAlternative) addUniqueSourceBranch(genericAnticipatedAlternative(functionality, sourceDigest));
      addUniqueSourceBranch(anticipatedRejectedBranch(functionality, sourceDigest));
    }
  }
  return rows;
}

function branchRecordSource(value = {}) {
  const source = record(value);
  const explicit = text(source.__recordSource || source.recordSource || record(source.provenance).kind).toLowerCase();
  if (["decision_ledger", "architecture_report"].includes(explicit)) return explicit;
  return text(source.decisionId) && validTimestamp(source.createdAt).value ? "decision_ledger" : "architecture_report";
}

function governedLedgerDispositionState(value = {}, recordSource = "") {
  if (recordSource !== "decision_ledger") return "";
  const status = branchStatus(value);
  const disposition = record(record(value).disposition);
  const dispositionState = text(disposition.status || disposition.state).toLowerCase();
  if (REJECTED_BRANCH_STATUSES.has(status) || REJECTED_BRANCH_STATUSES.has(dispositionState)) return "rejected";
  if (status === "deferred" || dispositionState === "deferred") return "deferred";
  return "";
}

export function branchRows(branches = []) {
  return array(branches)
    .filter((branch) => text(branch?.id))
    .map((branch) => {
      const evidence = evidenceRows(branch);
      const inferenceRole = branchInferenceRole(branch);
      const recordSource = branchRecordSource(branch);
      const governedDispositionState = governedLedgerDispositionState(branch, recordSource);
      const anticipated = !governedDispositionState && ["deferred_alternative", "anticipated_alternative", "anticipated_rejected"].includes(inferenceRole);
      const sourceState = decisionState(branch);
      const state = governedDispositionState || (inferenceRole === "anticipated_rejected" ? "anticipated_rejected" : anticipated ? "anticipated" : sourceState);
      const recordClassification = governedDispositionState
        ? "governed_disposition"
        : inferenceRole === "observed_current"
          ? "source_observed"
          : anticipated
            ? "anticipated"
            : recordSource === "architecture_report" && ["selected", "deferred", "rejected"].includes(state)
              ? "recorded_summary"
              : ["selected", "deferred", "rejected"].includes(state)
            ? "governed_disposition"
            : "recorded";
      const created = validTimestamp(branch.createdAt);
      const updated = validTimestamp(branch.updatedAt);
      return {
        id: text(branch.id),
        functionalityId: functionalityId(branch),
        label: text(branch.objective?.summary || branch.label || branch.title || branch.id),
        state,
        status: branchStatus(branch) || "not reported",
        inferenceRole,
        recordSource,
        recordClassification,
        recordBasis: recordClassification === "source_observed"
          ? "Source-observed implementation evidence; this does not assert a historical selection."
          : recordClassification === "anticipated"
            ? "Anticipated from source evidence; this is not a historical decision or governed disposition."
            : recordClassification === "recorded_summary"
              ? "A disposition summary is stored in the source-analysis report, but lineage and decision time are unavailable."
          : recordClassification === "governed_disposition"
            ? "Governed disposition recorded in the decision ledger."
            : "Recorded decision-continuity entry.",
        reason: branchReason(branch),
        constraints: branchConstraints(branch),
        evidence,
        evidenceCount: evidence.length,
        sourceDigest: text(branch.sourceDigest || record(branch.candidate).sourceDigest),
        score: numberOrNull(branch.score ?? record(branch.candidate).score),
        autoReconsideration: branch.autoReconsideration === true,
        historicalClaim: branch.historicalClaim !== false && recordClassification !== "source_observed" && recordClassification !== "anticipated",
        decisionId: text(branch.decisionId),
        rootLineageId: text(branch.rootLineageId),
        parentBranchId: text(branch.parentBranchId),
        branchType: text(branch.branchType),
        temporal: {
          createdAt: created.value,
          updatedAt: updated.value,
          status: created.value ? "recorded" : "unavailable"
        },
        branch
      };
    });
}

export function mergeDecisionBranches({ architectureAnalysisReport = null, branches = [], project = null } = {}) {
  const merged = new Map();
  for (const branch of sourceDecisionBranches({ architectureAnalysisReport, project })) {
    const id = text(branch?.id);
    if (id) merged.set(id, branch);
  }
  // The persisted decision ledger is authoritative for a branch id it shares
  // with a source report. Historical ledger records remain available even
  // after the source digest changes; the current source map filters them.
  for (const branch of array(branches)) {
    const id = text(branch?.id);
    if (!id) continue;
    merged.set(id, { ...record(branch), __recordSource: "decision_ledger" });
  }
  return [...merged.values()];
}

function reconsiderationBranchId(value = {}) {
  const source = record(value);
  return text(source.branchId || source.decisionBranchId || source.candidateBranchId || source.branch?.id);
}

export function realReconsiderationSignals(reconsiderations = [], branchId = "") {
  const requestedBranchId = text(branchId);
  if (!requestedBranchId) return [];
  return array(reconsiderations)
    .filter((signal) => reconsiderationBranchId(signal) === requestedBranchId)
    .map((signal) => ({
      id: text(signal.id) || `${requestedBranchId}:${text(signal.createdAt || signal.updatedAt)}`,
      status: text(signal.status) || "recorded",
      reason: text(signal.reason || signal.summary || signal.message),
      createdAt: text(signal.createdAt || signal.updatedAt),
      signal
    }));
}

function decisionGraphEvents(graph = null) {
  const source = record(graph);
  const nodes = new Map(array(source.nodes).map((node) => [text(node?.id), node]));
  const events = new Map();
  for (const edge of array(source.edges)) {
    if (text(edge?.kind) !== "recorded_for") continue;
    const target = text(edge?.target);
    const branchId = target.startsWith("branch:") ? target.slice(7) : "";
    const event = nodes.get(text(edge?.source));
    if (!branchId || event?.kind !== "event") continue;
    const rows = events.get(branchId) || [];
    rows.push({
      id: text(event.id),
      type: text(event.eventType || event.label) || "recorded event",
      occurredAt: validTimestamp(event.occurredAt).value,
      correlationId: text(event.correlationId)
    });
    events.set(branchId, rows);
  }
  for (const rows of events.values()) rows.sort((left, right) => (Date.parse(left.occurredAt || "") || Number.MAX_SAFE_INTEGER) - (Date.parse(right.occurredAt || "") || Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id));
  return events;
}

function statePriority(state) {
  return ({ selected: 0, observed_current: 1, recorded: 2, deferred: 3, rejected: 4, anticipated: 5, anticipated_rejected: 6 })[state] ?? 9;
}

export function buildDecisionLineages({ branches = [], decisionGraph = null } = {}) {
  const normalized = array(branches).every((branch) => branch?.recordClassification)
    ? array(branches)
    : branchRows(branches);
  const rows = normalized.filter((branch) => branch.recordSource === "decision_ledger");
  const byId = new Map(rows.map((branch) => [branch.id, branch]));
  const eventsByBranch = decisionGraphEvents(decisionGraph);
  const invalidIds = new Set();
  const validParentById = new Map();

  for (const branch of rows) {
    if (!branch.parentBranchId) continue;
    const parent = byId.get(branch.parentBranchId);
    if (!parent
      || (branch.functionalityId && parent.functionalityId && branch.functionalityId !== parent.functionalityId)
      || (branch.rootLineageId && parent.rootLineageId && branch.rootLineageId !== parent.rootLineageId)) {
      invalidIds.add(branch.id);
      continue;
    }
    const seen = new Set([branch.id]);
    let cursor = parent;
    let cyclic = false;
    while (cursor) {
      if (seen.has(cursor.id)) { cyclic = true; break; }
      seen.add(cursor.id);
      cursor = cursor.parentBranchId ? byId.get(cursor.parentBranchId) : null;
    }
    if (cyclic) invalidIds.add(branch.id);
    else validParentById.set(branch.id, parent.id);
  }

  const childrenById = new Map(rows.map((branch) => [branch.id, []]));
  for (const [childId, parentId] of validParentById) childrenById.get(parentId)?.push(childId);
  const roots = rows.filter((branch) => !branch.parentBranchId && !invalidIds.has(branch.id));
  const visited = new Set();
  const lineages = roots.map((root) => {
    const nodes = [];
    const edges = [];
    const queue = [{ id: root.id, depth: 0 }];
    while (queue.length) {
      const item = queue.shift();
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      const branch = byId.get(item.id);
      if (!branch) continue;
      const events = eventsByBranch.get(branch.id) || [];
      nodes.push({ ...branch, depth: item.depth, events });
      const children = (childrenById.get(branch.id) || [])
        .map((id) => byId.get(id))
        .filter(Boolean)
        .sort((left, right) => (left.temporal.createdAt ? Date.parse(left.temporal.createdAt) : Number.MAX_SAFE_INTEGER)
          - (right.temporal.createdAt ? Date.parse(right.temporal.createdAt) : Number.MAX_SAFE_INTEGER)
          || statePriority(left.state) - statePriority(right.state)
          || left.id.localeCompare(right.id));
      for (const child of children) {
        edges.push({ id: `lineage:${branch.id}:${child.id}`, sourceId: branch.id, targetId: child.id, recorded: true });
        queue.push({ id: child.id, depth: item.depth + 1 });
      }
    }
    nodes.sort((left, right) => left.depth - right.depth
      || (left.temporal.createdAt ? Date.parse(left.temporal.createdAt) : Number.MAX_SAFE_INTEGER)
        - (right.temporal.createdAt ? Date.parse(right.temporal.createdAt) : Number.MAX_SAFE_INTEGER)
      || statePriority(left.state) - statePriority(right.state)
      || left.id.localeCompare(right.id));
    const timestampCount = nodes.filter((node) => node.temporal.status === "recorded").length;
    return {
      id: root.rootLineageId || root.id,
      label: root.label,
      rootId: root.id,
      nodes,
      edges,
      chronologyStatus: timestampCount === nodes.length ? "recorded" : timestampCount ? "partial" : "unavailable",
      earliestRecordedAt: nodes.map((node) => node.temporal.createdAt).filter(Boolean).sort()[0] || "",
      selectedCount: nodes.filter((node) => node.state === "selected").length,
      deferredCount: nodes.filter((node) => node.state === "deferred").length,
      rejectedCount: nodes.filter((node) => node.state === "rejected").length
    };
  }).sort((left, right) => right.selectedCount - left.selectedCount
    || (Date.parse(left.earliestRecordedAt || "") || Number.MAX_SAFE_INTEGER) - (Date.parse(right.earliestRecordedAt || "") || Number.MAX_SAFE_INTEGER)
    || left.label.localeCompare(right.label)
    || left.id.localeCompare(right.id));

  const unlinked = rows
    .filter((branch) => invalidIds.has(branch.id) || !visited.has(branch.id))
    .map((branch) => ({ ...branch, events: eventsByBranch.get(branch.id) || [], lineageIssue: invalidIds.has(branch.id) ? "Recorded parent is missing, incompatible, or cyclic." : "No recorded root connects this branch." }))
    .sort((left, right) => statePriority(left.state) - statePriority(right.state) || left.id.localeCompare(right.id));
  return { lineages, unlinked, recordedBranchCount: rows.length };
}

export function buildSourceDecisionMap({ functionalities = [], branches = [], currentSourceDigest = "" } = {}) {
  const requestedDigest = text(currentSourceDigest);
  const rows = (array(branches).every((branch) => branch?.recordClassification) ? array(branches) : branchRows(branches))
    .filter((branch) => !requestedDigest
      || !["source_observed", "anticipated"].includes(branch.recordClassification)
      || !branch.sourceDigest
      || branch.sourceDigest === requestedDigest);
  const checkpoints = array(functionalities).map((functionality, index) => {
    const choices = rows
      .filter((branch) => branch.functionalityId === functionality.id)
      .sort((left, right) => statePriority(left.state) - statePriority(right.state) || left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
    return {
      ...functionality,
      displayOrder: index + 1,
      choices,
      observedCurrent: choices.filter((branch) => branch.state === "observed_current"),
      anticipated: choices.filter((branch) => branch.state === "anticipated"),
      anticipatedRejected: choices.filter((branch) => branch.state === "anticipated_rejected"),
      recorded: choices.filter((branch) => !["source_observed", "anticipated"].includes(branch.recordClassification))
    };
  });
  const hasDeliveryOrder = checkpoints.some((checkpoint) => Number.isFinite(checkpoint.sequence?.order));
  return {
    checkpoints,
    sequenceBasis: hasDeliveryOrder ? "source_inferred_delivery" : "unsequenced_source_analysis",
    historicalClaim: false
  };
}

export function buildDecisionPathBoard({ functionalityId: requestedFunctionalityId = "", branches = [], reconsiderations = [], selectedCheckpointId = "" } = {}) {
  const functionalityIdValue = text(requestedFunctionalityId);
  const checkpoints = branchRows(branches).filter((branch) => branch.functionalityId === functionalityIdValue);
  const requestedCheckpoint = text(selectedCheckpointId);
  const selectedCheckpoint = checkpoints.find((branch) => branch.id === requestedCheckpoint)
    || checkpoints.find((branch) => branch.state === "selected")
    || checkpoints.find((branch) => branch.state === "observed_current")
    || checkpoints[0]
    || null;
  return {
    functionalityId: functionalityIdValue,
    checkpoints,
    selectedCheckpoint,
    confirmedSelections: checkpoints.filter((branch) => branch.state === "selected"),
    observedCurrent: checkpoints.filter((branch) => branch.state === "observed_current"),
    deferred: checkpoints.filter((branch) => branch.state === "deferred"),
    rejected: checkpoints.filter((branch) => branch.state === "rejected"),
    anticipated: checkpoints.filter((branch) => branch.state === "anticipated"),
    anticipatedRejected: checkpoints.filter((branch) => branch.state === "anticipated_rejected"),
    recorded: checkpoints.filter((branch) => branch.state === "recorded"),
    reconsiderations: selectedCheckpoint ? realReconsiderationSignals(reconsiderations, selectedCheckpoint.id) : []
  };
}

export function applicationDecisionSummary({ architectureAnalysisReport = null, branches = [], reconsiderations = [], decisionGraph = null, project = null } = {}) {
  const functionalityRows = analysisFunctionalities(architectureAnalysisReport);
  const reportBranches = array(record(architectureAnalysisReport).branches);
  const rows = branchRows(mergeDecisionBranches({ architectureAnalysisReport, branches, project }));
  const signals = array(reconsiderations);
  const lineages = buildDecisionLineages({ branches: rows, decisionGraph });
  const sourceMap = buildSourceDecisionMap({
    functionalities: functionalityRows,
    branches: rows,
    currentSourceDigest: text(record(architectureAnalysisReport).sourceDigest)
  });
  return {
    functionalities: functionalityRows,
    objectives: analysisObjectives(architectureAnalysisReport),
    branchRows: rows,
    selectedCount: rows.filter((branch) => branch.state === "selected").length,
    observedCurrentCount: rows.filter((branch) => branch.state === "observed_current").length,
    deferredCount: rows.filter((branch) => branch.state === "deferred").length,
    rejectedCount: rows.filter((branch) => branch.state === "rejected").length,
    anticipatedCount: rows.filter((branch) => branch.state === "anticipated").length,
    anticipatedRejectedCount: rows.filter((branch) => branch.state === "anticipated_rejected").length,
    reportBranchCount: reportBranches.length,
    reconsiderationCount: signals.length,
    reconsiderations: signals,
    lineages: lineages.lineages,
    unlinkedBranches: lineages.unlinked,
    recordedBranchCount: lineages.recordedBranchCount,
    sourceMap,
    applicationOrigin: applicationOrigin(project || { origin: record(architectureAnalysisReport).projectOrigin })
  };
}

export function portfolioDecisionSummary(portfolio = null) {
  const source = record(portfolio);
  const nested = record(source.portfolio);
  const summary = record(nested.summary || source.summary);
  const agreementRegistry = record(source.agreementRegistry || nested.agreementRegistry);
  const reportedStatus = text(agreementRegistry.status).toLowerCase();
  const agreementStatus = ["configured", "unconfigured", "invalid"].includes(reportedStatus) ? reportedStatus : "not_reported";
  const causalRelationships = array(nested.causalRelationships).length ? array(nested.causalRelationships) : array(source.causalRelationships);
  const sharingRelationships = array(nested.sharingRelationships).length ? array(nested.sharingRelationships) : array(source.sharingRelationships);
  return {
    explanation: text(source.explanation || nested.explanation),
    agreementStatus,
    agreementError: text(agreementRegistry.error),
    causalDependencyCount: numberOrNull(summary.causalRelationshipCount) ?? causalRelationships.length,
    authorizedSharingCount: numberOrNull(summary.sharingRelationshipCount) ?? sharingRelationships.length
  };
}

export function enterprisePatch(project, enterprise = {}) {
  const source = record(project);
  return {
    name: text(source.name),
    workspaceName: text(source.folderName || source.workspaceName),
    enterpriseId: text(record(enterprise).id),
    enterpriseName: text(record(enterprise).name)
  };
}

export function enterpriseAssignmentDraft(enterprise = {}) {
  const source = record(enterprise);
  const id = text(source.id);
  const name = text(source.name);
  const hasId = Boolean(id);
  const hasName = Boolean(name);
  const isRemoval = !hasId && !hasName;
  const validId = id.length >= 2 && id.length <= 80 && /^[a-z0-9][a-z0-9-]*$/.test(id);
  const validName = name.length >= 2 && name.length <= 80;
  const isAssignment = hasId && hasName && validId && validName;
  return {
    enterprise: { id, name },
    hasId,
    hasName,
    isRemoval,
    isAssignment,
    isInvalid: !isRemoval && !isAssignment,
    isSubmittable: isRemoval || isAssignment
  };
}

export function planEnterpriseAssignments({ applications = [], selectedIds = [], enterprise = {} } = {}) {
  const selected = new Set(array(selectedIds).map(text).filter(Boolean));
  const requestedEnterprise = {
    id: text(record(enterprise).id),
    name: text(record(enterprise).name)
  };

  return array(applications)
    .map((application) => {
      const source = record(application);
      const project = record(source.project || source);
      const projectId = text(source.id || project.id || project.projectId);
      const currentEnterprise = enterpriseAssignment(source);
      return {
        projectId,
        project,
        projectName: text(source.name || project.name) || projectId,
        currentEnterprise,
        enterprise: requestedEnterprise,
        patch: enterprisePatch(project, requestedEnterprise)
      };
    })
    .filter((item) => selected.has(item.projectId))
    .filter((item) => item.currentEnterprise.id !== requestedEnterprise.id || item.currentEnterprise.name !== requestedEnterprise.name);
}
