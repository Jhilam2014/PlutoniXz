import crypto from "node:crypto";

export const DECISION_SIMILARITY_THRESHOLDS = Object.freeze({
  lexicalNearDuplicate: 0.86,
  semanticNearDuplicate: 0.9,
  structuralNearDuplicate: 0.95,
  behavioralNearDuplicate: 0.95,
  outcomeNearDuplicate: 0.95
});

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value || {})).digest("hex");
}

function words(value = "") {
  return new Set(String(value).toLowerCase().match(/[a-z0-9]{2,}/g) || []);
}

function jaccard(left, right) {
  const union = new Set([...left, ...right]);
  if (!union.size) return null;
  let common = 0;
  for (const item of left) if (right.has(item)) common += 1;
  return common / union.size;
}

function vectorFor(branch) {
  return Object.fromEntries((branch.fitnessVector?.dimensions || [])
    .filter((dimension) => !dimension.missing && Number.isFinite(dimension.normalizedValue))
    .map((dimension) => [dimension.name, Number(dimension.normalizedValue)]));
}

function cosine(left, right) {
  const keys = Object.keys(left).filter((key) => Number.isFinite(right[key]));
  if (!keys.length) return null;
  const dot = keys.reduce((total, key) => total + left[key] * right[key], 0);
  const leftMagnitude = Math.sqrt(keys.reduce((total, key) => total + left[key] ** 2, 0));
  const rightMagnitude = Math.sqrt(keys.reduce((total, key) => total + right[key] ** 2, 0));
  return leftMagnitude && rightMagnitude ? dot / (leftMagnitude * rightMagnitude) : null;
}

function signal({ value, threshold, evaluatorVersion, source, unavailableReason = "" }) {
  if (value === null || value === undefined) {
    return { status: "unavailable", value: null, threshold, evaluatorVersion, source, explanation: unavailableReason || "No comparable evidence is available." };
  }
  return {
    status: value >= threshold ? "near_duplicate" : "distinct",
    value: Number(value.toFixed(4)),
    threshold,
    evaluatorVersion,
    source,
    explanation: value >= threshold ? "The configured threshold is met or exceeded." : "The configured threshold is not met."
  };
}

/**
 * A derived comparison only. It never changes a branch or discards a candidate.
 * Semantic comparison is available only when upstream writes a versioned,
 * tenant-scoped semantic fingerprint; this module never sends content to a model.
 */
export function compareDecisionBranches(left, right, { thresholds = DECISION_SIMILARITY_THRESHOLDS } = {}) {
  const lexical = jaccard(words(left.objective?.summary), words(right.objective?.summary));
  const leftSignature = left.decisionSignature || {};
  const rightSignature = right.decisionSignature || {};
  const semantic = leftSignature.semanticFingerprint && rightSignature.semanticFingerprint
    ? (leftSignature.semanticFingerprint === rightSignature.semanticFingerprint ? 1 : 0)
    : null;
  const structural = leftSignature.structuralFingerprint && rightSignature.structuralFingerprint
    ? (leftSignature.structuralFingerprint === rightSignature.structuralFingerprint ? 1 : 0)
    : (stableHash(left.candidate) === stableHash(right.candidate) ? 1 : 0);
  const behavioral = leftSignature.behavioralFingerprint && rightSignature.behavioralFingerprint
    ? (leftSignature.behavioralFingerprint === rightSignature.behavioralFingerprint ? 1 : 0)
    : cosine(vectorFor(left), vectorFor(right));
  const outcome = leftSignature.outcomeFingerprint && rightSignature.outcomeFingerprint
    ? (leftSignature.outcomeFingerprint === rightSignature.outcomeFingerprint ? 1 : 0)
    : jaccard(words(JSON.stringify(left.realizedOutcome || left.expectedOutcome || {})), words(JSON.stringify(right.realizedOutcome || right.expectedOutcome || {})));
  const evaluatorVersion = leftSignature.similarityEvaluatorVersion || rightSignature.similarityEvaluatorVersion || "decision-continuity-projection-v1";
  const signals = {
    lexical: signal({ value: lexical, threshold: thresholds.lexicalNearDuplicate, evaluatorVersion, source: "objective token Jaccard" }),
    semantic: signal({ value: semantic, threshold: thresholds.semanticNearDuplicate, evaluatorVersion, source: "versioned semantic fingerprint", unavailableReason: "No common versioned semantic fingerprint is recorded." }),
    structural: signal({ value: structural, threshold: thresholds.structuralNearDuplicate, evaluatorVersion, source: "structural fingerprint or candidate content hash" }),
    behavioral: signal({ value: behavioral, threshold: thresholds.behavioralNearDuplicate, evaluatorVersion, source: "behavioral fingerprint or normalized fitness vector cosine" }),
    outcome: signal({ value: outcome, threshold: thresholds.outcomeNearDuplicate, evaluatorVersion, source: "outcome fingerprint or outcome token Jaccard" })
  };
  const duplicateSignals = Object.values(signals).filter((item) => item.status === "near_duplicate").length;
  return {
    derived: true,
    authoritativeSource: "decision-continuity-ledger",
    comparedBranchIds: [left.id, right.id],
    thresholds,
    signals,
    relation: duplicateSignals >= 2 ? "possibly_equivalent" : "materially_distinct_or_unproven",
    explanation: "This projection retains both branches. Similarity is evidence for an operator or policy, never a deletion instruction."
  };
}

export function buildDecisionContinuityGraph({ branches = [], events = [] } = {}) {
  const nodes = [];
  const edges = [];
  const seenNodes = new Set();
  const addNode = (node) => {
    if (seenNodes.has(node.id)) return;
    seenNodes.add(node.id);
    nodes.push(node);
  };
  for (const branch of branches) {
    addNode({ id: `branch:${branch.id}`, kind: "branch", label: branch.objective?.summary || branch.id, authoritative: true, branchId: branch.id, status: branch.status, revision: branch.revision, tenantId: branch.tenantId, workspaceId: branch.workspaceId });
    if (branch.parentBranchId) edges.push({ id: `lineage:${branch.parentBranchId}:${branch.id}`, kind: "lineage", source: `branch:${branch.parentBranchId}`, target: `branch:${branch.id}`, authoritative: true });
    for (const evidence of branch.evidence || []) {
      const id = `evidence:${branch.id}:${evidence.id}`;
      addNode({ id, kind: "evidence", label: evidence.source, authoritative: true, branchId: branch.id, evidenceType: evidence.type, observedAt: evidence.observedAt || null, expiresAt: evidence.expiresAt || null, accessPolicy: evidence.accessPolicy });
      edges.push({ id: `supports:${id}:${branch.id}`, kind: "supports", source: id, target: `branch:${branch.id}`, authoritative: true });
    }
    for (const constraint of branch.constraintDefinitions || []) {
      const id = `constraint:${branch.workspaceId}:${constraint.id}:${constraint.version}`;
      addNode({ id, kind: "constraint", label: constraint.id, authoritative: true, constraintId: constraint.id, version: constraint.version, type: constraint.type, scope: constraint.scope, sensitivity: constraint.sensitivity });
      edges.push({ id: `constrains:${id}:${branch.id}`, kind: "constrains", source: id, target: `branch:${branch.id}`, authoritative: true });
    }
  }
  for (const event of events) {
    const branchId = event.payload?.branchId || event.payload?.branch?.id || event.payload?.request?.branchId || null;
    if (!branchId) continue;
    const id = `event:${event.id}`;
    addNode({ id, kind: "event", label: event.type, authoritative: true, eventType: event.type, occurredAt: event.occurredAt, correlationId: event.correlationId || null });
    edges.push({ id: `recorded:${id}:${branchId}`, kind: "recorded_for", source: id, target: `branch:${branchId}`, authoritative: true });
  }
  return {
    generatedAt: new Date().toISOString(),
    derived: true,
    authoritativeSource: "decision-continuity-ledger",
    nodes,
    edges,
    explanation: "This graph is rebuildable from the tenant-scoped ledger and domain event journal. It cannot authorize lifecycle transitions."
  };
}
