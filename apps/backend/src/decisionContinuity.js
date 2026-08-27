import crypto from "node:crypto";
import fs from "fs-extra";
import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { projectRoot } from "./selfImprovement/constants.js";

/**
 * File-backed decision-continuity development adapter.
 *
 * This is deliberately an additive control-plane foundation: it never performs a
 * deployment, runs a model, or evaluates executable expressions. The JSON
 * snapshot is a compact read model and the JSONL domain journal is the immutable
 * audit trail. It is never selected in production; the PostgreSQL adapter uses
 * the same public domain contract.
 */

export const DECISION_CONTINUITY_SCHEMA_VERSION = "1.0.0";
export const BRANCH_STATUSES = [
  "candidate",
  "selected",
  "deferred",
  "rejected",
  "superseded",
  "reconsidering",
  "archived",
  "retired"
];
export const OBSERVATION_STATES = ["active", "cleared", "unknown", "stale", "expired", "invalid"];
export const DEFAULT_BRANCH_PAGE_SIZE = 100;
export const MAX_BRANCH_PAGE_SIZE = 250;
export const MAX_BRANCH_PAGE_OFFSET = 100_000;

const MAX_CANARY_TRAFFIC_PERCENT = 25;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RECONSIDERATION_LIMIT = 25;
const DEFAULT_RECONSIDERATION_COOLDOWN_MS = 30 * 60 * 1000;
const DEFAULT_LOCK_STALE_MS = 60 * 1000;

export class DecisionContinuityError extends Error {
  constructor(message, { code = "decision_continuity_error", status = 400, details = null } = {}) {
    super(message);
    this.name = "DecisionContinuityError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

function stableHash(value) {
  return hash(JSON.stringify(canonicalize(value)));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function paginationInteger(value, { fallback, minimum, maximum, field }) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new DecisionContinuityError(`${field} must be an integer from ${minimum} to ${maximum}.`, {
      code: "invalid_pagination",
      status: 400
    });
  }
  return parsed;
}

/**
 * A small, bounded offset contract shared by the file and PostgreSQL adapters.
 * Offsets never grant access or override tenant/workspace filtering.
 */
export function normalizeBranchPagination({ limit, offset } = {}) {
  const pageLimit = paginationInteger(limit, {
    fallback: DEFAULT_BRANCH_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_BRANCH_PAGE_SIZE,
    field: "limit"
  });
  const pageOffset = paginationInteger(offset, {
    fallback: 0,
    minimum: 0,
    maximum: MAX_BRANCH_PAGE_OFFSET,
    field: "offset"
  });
  return { limit: pageLimit, offset: pageOffset };
}

export function branchPaginationMetadata({ offset = 0, limit = DEFAULT_BRANCH_PAGE_SIZE, total = 0, returned = 0 } = {}) {
  const nextOffset = offset + returned < total ? offset + returned : null;
  return {
    offset,
    limit,
    returned,
    hasMore: nextOffset !== null,
    nextOffset
  };
}

function orderedBranches(state, { tenantId, workspaceId, decisionId, statuses } = {}) {
  const allowedStatuses = asArray(statuses).filter((status) => BRANCH_STATUSES.includes(status));
  return Object.values(state.branches)
    .filter((branch) => branch.tenantId === tenantId)
    .filter((branch) => !workspaceId || branch.workspaceId === workspaceId)
    .filter((branch) => !decisionId || branch.decisionId === decisionId)
    .filter((branch) => !allowedStatuses.length || allowedStatuses.includes(branch.status))
    .sort((left, right) => {
      const leftUpdatedAt = Number.isFinite(Date.parse(left.updatedAt)) ? Date.parse(left.updatedAt) : 0;
      const rightUpdatedAt = Number.isFinite(Date.parse(right.updatedAt)) ? Date.parse(right.updatedAt) : 0;
      return rightUpdatedAt - leftUpdatedAt || String(right.id).localeCompare(String(left.id));
    });
}

function defaultState() {
  return {
    schemaVersion: DECISION_CONTINUITY_SCHEMA_VERSION,
    updatedAt: nowIso(),
    branches: {},
    observations: {},
    reconsiderations: {},
    approvals: {},
    canaries: {},
    processedConditionEvents: {},
    qagentRuns: {},
    qagentEffects: {},
    brainxRegistrations: {},
    brainxPolicies: {},
    brainxRoutes: {},
    brainxExecutions: {},
    brainxEffects: {},
    brainxControls: {},
    brainxCircuitBreakers: {},
    governedSuggestions: {},
    intelCapabilityProposals: {},
    enterpriseGovernanceBindings: {},
    enterpriseGovernancePolicies: {},
    enterpriseGovernanceBudgets: {},
    enterpriseGovernanceReservations: {},
    enterpriseGovernanceDecisionContexts: {},
    enterpriseGovernanceKnowledgeReceipts: {},
    enterpriseGovernanceIdempotency: {},
    researchXSources: {},
    researchXRuns: {},
    researchXEffects: {},
    agenticXKnowledge: {},
    agenticXReuseReceipts: {}
  };
}

function pathsFor(root = projectRoot()) {
  const runtimeRoot = process.env.DECISION_CONTINUITY_ROOT || path.join(root, "runtime", "decision-continuity");
  return {
    runtimeRoot,
    snapshot: path.join(runtimeRoot, "state", "ledger.json"),
    events: path.join(runtimeRoot, "events", "domain-events.jsonl"),
    deadLetters: path.join(runtimeRoot, "dead-letter", "events.jsonl"),
    lock: path.join(runtimeRoot, "locks", "ledger.lock")
  };
}

async function readJson(filePath, fallback) {
  if (!(await fs.pathExists(filePath))) return clone(fallback);
  try {
    return await fs.readJson(filePath);
  } catch {
    return clone(fallback);
  }
}

async function appendJsonLines(filePath, records) {
  if (!records.length) return;
  await fs.ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

async function writeJsonAtomically(filePath, value) {
  await fs.ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeJson(temporaryPath, value, { spaces: 2 });
  await fsp.rename(temporaryPath, filePath);
}

async function acquireLock(lockPath, staleMs = DEFAULT_LOCK_STALE_MS) {
  await fs.ensureDir(path.dirname(lockPath));
  try {
    const handle = await fsp.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: nowIso() }));
    return async () => {
      await handle.close().catch(() => {});
      await fs.remove(lockPath).catch(() => {});
    };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stats = await fs.stat(lockPath).catch(() => null);
    if (stats && Date.now() - stats.mtimeMs > staleMs) {
      await fs.remove(lockPath).catch(() => {});
      return acquireLock(lockPath, staleMs);
    }
    throw new DecisionContinuityError("Decision ledger is busy. Retry the request.", {
      code: "ledger_busy",
      status: 409
    });
  }
}

const ConstraintExpressionSchema = z.lazy(() => z.union([
  z.object({ constraintId: z.string().min(1).max(160) }).strict(),
  z.object({ all: z.array(ConstraintExpressionSchema).min(1).max(20) }).strict(),
  z.object({ any: z.array(ConstraintExpressionSchema).min(1).max(20) }).strict(),
  z.object({ not: ConstraintExpressionSchema }).strict()
]));

const EvidenceSchema = z.object({
  id: z.string().min(1).max(160),
  type: z.enum(["metric", "test", "incident", "research", "human_review", "artifact", "other"]).default("other"),
  source: z.string().min(1).max(240),
  observedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  confidence: z.number().min(0).max(1).nullable().default(null),
  accessPolicy: z.enum(["tenant", "workspace", "restricted", "public"]).default("workspace"),
  reference: z.string().max(2000).optional(),
  digest: z.string().max(128).optional()
}).strict();

const ConstraintDefinitionSchema = z.object({
  id: z.string().min(1).max(160),
  version: z.string().min(1).max(80),
  type: z.enum(["resource", "cost", "security", "policy", "dependency", "evidence", "custom"]).default("custom"),
  scope: z.enum(["tenant", "workspace", "branch", "environment"]).default("workspace"),
  field: z.string().min(1).max(240),
  operator: z.enum(["equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "available", "approved", "matches"]).default("equals"),
  expected: z.unknown().optional(),
  owner: z.string().max(160).optional(),
  sensitivity: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"),
  accessPolicy: z.enum(["tenant", "workspace", "restricted", "public"]).default("workspace")
}).strict();

const FitnessVectorSchema = z.object({
  evaluatorVersion: z.string().min(1).max(120),
  dimensions: z.array(z.object({
    name: z.string().min(1).max(120),
    value: z.number().finite(),
    direction: z.enum(["maximize", "minimize", "target"]),
    normalizedValue: z.number().min(0).max(1).nullable().default(null),
    confidence: z.number().min(0).max(1).nullable().default(null),
    missing: z.boolean().default(false),
    notes: z.string().max(1000).optional()
  }).strict()).min(1).max(50),
  aggregation: z.object({
    method: z.enum(["weighted_sum", "pareto", "lexicographic", "manual"]),
    version: z.string().min(1).max(120),
    score: z.number().finite().nullable().default(null)
  }).strict()
}).strict();

// Historic branches remain valid without this optional governed context. New
// branches can bind their evidence to an immutable enterprise-policy snapshot.
const EnterpriseDecisionContextSchema = z.object({
  applicationId: z.string().min(1).max(160),
  enterpriseId: z.string().min(1).max(160).optional(),
  affectedApplicationIds: z.array(z.string().min(1).max(160)).max(50).default([]),
  policySnapshotId: z.string().min(1).max(160).optional(),
  budgetScopeId: z.string().min(1).max(160).optional(),
  evidenceRefs: z.array(z.string().min(1).max(240)).max(100).default([]),
  classification: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"),
  region: z.string().min(1).max(80).optional(),
  purpose: z.string().min(1).max(160).optional()
}).strict();

const BranchInputSchema = z.object({
  workspaceId: z.string().min(1).max(160).default("default"),
  decisionId: z.string().min(1).max(160),
  objective: z.union([z.string().min(1).max(4000), z.object({
    summary: z.string().min(1).max(4000),
    successCriteria: z.array(z.string().min(1).max(1000)).max(30).default([])
  }).strict()]),
  branchType: z.enum(["implementation", "investigation", "research", "configuration", "proposal"]).default("implementation"),
  origin: z.object({
    source: z.enum(["operator", "qagent", "intel", "brainx", "self_improvement", "import", "other"]).default("operator"),
    correlationId: z.string().max(160).optional(),
    requestId: z.string().max(160).optional(),
    idempotencyKey: z.string().min(1).max(240).optional()
  }).strict().default({ source: "operator" }),
  decisionSignature: z.object({
    version: z.string().min(1).max(80),
    lexicalFingerprint: z.string().max(256).optional(),
    semanticFingerprint: z.string().max(256).optional(),
    structuralFingerprint: z.string().max(256).optional(),
    behavioralFingerprint: z.string().max(256).optional(),
    outcomeFingerprint: z.string().max(256).optional(),
    similarityEvaluatorVersion: z.string().max(120).optional()
  }).strict().optional(),
  parentBranchId: z.string().min(1).max(160).optional(),
  candidate: z.record(z.unknown()).default({}),
  assumptions: z.array(z.string().min(1).max(1000)).max(50).default([]),
  evidence: z.array(EvidenceSchema).max(100).default([]),
  fitnessVector: FitnessVectorSchema.optional(),
  constraintExpression: ConstraintExpressionSchema.optional(),
  constraintDefinitions: z.array(ConstraintDefinitionSchema).max(100).default([]),
  constraintSnapshot: z.record(z.unknown()).default({}),
  revisitTriggers: z.array(z.string().min(1).max(160)).max(50).default([]),
  autoReconsideration: z.boolean().default(true),
  allowRejectedReconsideration: z.boolean().default(false),
  disposition: z.object({
    reason: z.string().max(2000).optional(),
    alternativesConsidered: z.array(z.string().min(1).max(160)).max(50).default([])
  }).strict().default({ alternativesConsidered: [] }),
  producedBy: z.object({
    agentId: z.string().min(1).max(160).optional(),
    actorId: z.string().min(1).max(160).optional(),
    source: z.string().max(160).optional()
  }).strict().default({}),
  executionProvenance: z.object({
    provider: z.string().max(120).optional(),
    modelId: z.string().max(240).optional(),
    modelRevision: z.string().max(240).optional(),
    promptVersion: z.string().max(160).optional(),
    toolVersions: z.record(z.string().max(160)).default({}),
    codeRevision: z.string().max(160).optional(),
    environment: z.string().max(160).optional()
  }).strict().default({}),
  enterpriseDecisionContext: EnterpriseDecisionContextSchema.optional(),
  expectedOutcome: z.record(z.unknown()).default({}),
  realizedOutcome: z.record(z.unknown()).default({})
}).strict();

const ObservationInputSchema = z.object({
  constraintId: z.string().min(1).max(160),
  state: z.enum(OBSERVATION_STATES),
  source: z.string().min(1).max(240),
  occurredAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  trusted: z.boolean().default(false),
  authorized: z.boolean().default(false),
  evidence: z.array(EvidenceSchema).max(25).default([]),
  note: z.string().max(2000).optional()
}).strict();

const ConditionEventSchema = z.object({
  eventId: z.string().min(1).max(200),
  workspaceId: z.string().min(1).max(160).default("default"),
  source: z.string().min(1).max(240),
  occurredAt: z.string().datetime().optional(),
  observations: z.array(ObservationInputSchema).min(1).max(50),
  authorizeRejectedReconsideration: z.boolean().default(false)
}).strict();

const BranchExecutionOutcomeSchema = z.object({
  status: z.enum(["succeeded", "failed", "stopped", "planned"]),
  buildId: z.string().max(240).optional(),
  changedFiles: z.array(z.string().min(1).max(500)).max(500).default([]),
  validation: z.record(z.unknown()).default({}),
  modelRouteReceiptId: z.string().max(160).optional(),
  error: z.string().max(2000).optional(),
  completedAt: z.string().datetime().optional()
}).strict();

function expressionConstraintIds(expression) {
  if (!expression || typeof expression !== "object") return [];
  if (expression.constraintId) return [expression.constraintId];
  if (Array.isArray(expression.all)) return expression.all.flatMap(expressionConstraintIds);
  if (Array.isArray(expression.any)) return expression.any.flatMap(expressionConstraintIds);
  if (expression.not) return expressionConstraintIds(expression.not);
  return [];
}

function observationKey({ tenantId, workspaceId, constraintId }) {
  return `${tenantId}:${workspaceId}:${constraintId}`;
}

function isExpired(observation, at = Date.now()) {
  return Boolean(observation?.expiresAt) && new Date(observation.expiresAt).getTime() <= at;
}

/**
 * Constraint expressions intentionally contain no executable code. An expression
 * is "cleared" only when its observations are trusted, authorized, fresh and
 * semantically clear; all unknown/stale/invalid evidence fails closed.
 */
export function evaluateConstraintExpression(expression, observations, { at = Date.now() } = {}) {
  const leaf = (constraintId) => {
    const observation = observations[constraintId];
    if (!observation) return { state: "unknown", reasons: [`${constraintId}:missing`] };
    if (!observation.trusted || !observation.authorized) return { state: "unknown", reasons: [`${constraintId}:untrusted`] };
    if (isExpired(observation, at) || ["stale", "expired", "invalid", "unknown"].includes(observation.state)) {
      return { state: "unknown", reasons: [`${constraintId}:stale_or_unknown`] };
    }
    return observation.state === "cleared"
      ? { state: "cleared", reasons: [] }
      : { state: "blocking", reasons: [`${constraintId}:active`] };
  };
  const visit = (node) => {
    if (node.constraintId) return leaf(node.constraintId);
    if (node.all) {
      const children = node.all.map(visit);
      if (children.every((entry) => entry.state === "cleared")) return { state: "cleared", reasons: [] };
      if (children.some((entry) => entry.state === "blocking")) return { state: "blocking", reasons: children.flatMap((entry) => entry.reasons) };
      return { state: "unknown", reasons: children.flatMap((entry) => entry.reasons) };
    }
    if (node.any) {
      const children = node.any.map(visit);
      if (children.some((entry) => entry.state === "cleared")) return { state: "cleared", reasons: [] };
      if (children.every((entry) => entry.state === "blocking")) return { state: "blocking", reasons: children.flatMap((entry) => entry.reasons) };
      return { state: "unknown", reasons: children.flatMap((entry) => entry.reasons) };
    }
    const child = visit(node.not);
    if (child.state === "unknown") return child;
    return child.state === "cleared"
      ? { state: "blocking", reasons: ["not:cleared"] }
      : { state: "cleared", reasons: [] };
  };
  return expression ? visit(expression) : { state: "cleared", reasons: [] };
}

function eventRecord({ tenantId, workspaceId, type, actor, payload, correlationId }) {
  return {
    id: createId("dce"),
    schemaVersion: DECISION_CONTINUITY_SCHEMA_VERSION,
    type,
    occurredAt: nowIso(),
    tenantId,
    workspaceId,
    actor: actor || { type: "system", id: "decision-continuity" },
    correlationId: correlationId || null,
    payload: clone(payload || {})
  };
}

function actorId(actor) {
  return String(actor?.id || actor?.actorId || "");
}

function assertTenant(tenantId) {
  if (!tenantId || typeof tenantId !== "string") {
    throw new DecisionContinuityError("A tenant-scoped identity is required.", { code: "tenant_required", status: 401 });
  }
}

function assertSameScope(record, { tenantId, workspaceId = null }) {
  if (!record || record.tenantId !== tenantId || (workspaceId && record.workspaceId !== workspaceId)) {
    throw new DecisionContinuityError("Decision record is not available in this tenant scope.", { code: "not_found", status: 404 });
  }
}

function assertExpectedRevision(record, expectedRevision) {
  if (expectedRevision === undefined || expectedRevision === null || expectedRevision === "") return;
  if (!Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) !== Number(record.revision)) {
    throw new DecisionContinuityError("The record changed before this request could be applied. Refresh and retry.", {
      code: "revision_conflict",
      status: 409,
      details: { expectedRevision: Number(expectedRevision), actualRevision: Number(record.revision) }
    });
  }
}

function updateBranch(state, branch, changes, { event, events, actor, reason = "" } = {}) {
  const before = clone(branch);
  const next = {
    ...branch,
    ...clone(changes),
    revision: Number(branch.revision || 0) + 1,
    updatedAt: nowIso()
  };
  next.contentHash = stableHash({ ...next, contentHash: undefined, updatedAt: undefined });
  state.branches[branch.id] = next;
  events.push(eventRecord({
    tenantId: next.tenantId,
    workspaceId: next.workspaceId,
    type: event,
    actor,
    payload: { branchId: next.id, reason, before, after: clone(next) }
  }));
  return next;
}

function dailyReconsiderationCount(state, tenantId, at = Date.now()) {
  return Object.values(state.reconsiderations).filter((request) =>
    request.tenantId === tenantId && at - new Date(request.createdAt).getTime() < DAY_MS
  ).length;
}

export class FileDecisionContinuityStore {
  constructor({ root = projectRoot(), maxReconsiderationsPerTenantPerDay = DEFAULT_RECONSIDERATION_LIMIT, reconsiderationCooldownMs = DEFAULT_RECONSIDERATION_COOLDOWN_MS, lockStaleMs = DEFAULT_LOCK_STALE_MS } = {}) {
    this.paths = pathsFor(root);
    this.maxReconsiderationsPerTenantPerDay = maxReconsiderationsPerTenantPerDay;
    this.reconsiderationCooldownMs = reconsiderationCooldownMs;
    this.lockStaleMs = lockStaleMs;
  }

  async ensure() {
    await Promise.all([fs.ensureDir(this.paths.runtimeRoot), fs.ensureDir(path.dirname(this.paths.snapshot))]);
  }

  async health() {
    await this.ensure();
    return { status: "ready", adapter: "file", authoritativeWrites: "development_only" };
  }

  async readState() {
    const state = await readJson(this.paths.snapshot, defaultState());
    return {
      ...defaultState(),
      ...state,
      branches: state.branches || {},
      observations: state.observations || {},
      reconsiderations: state.reconsiderations || {},
      approvals: state.approvals || {},
      canaries: state.canaries || {},
      processedConditionEvents: state.processedConditionEvents || {},
      qagentRuns: state.qagentRuns || {},
      qagentEffects: state.qagentEffects || {},
      brainxRegistrations: state.brainxRegistrations || {},
      brainxPolicies: state.brainxPolicies || {},
      brainxRoutes: state.brainxRoutes || {},
      brainxExecutions: state.brainxExecutions || {},
      brainxEffects: state.brainxEffects || {},
      brainxControls: state.brainxControls || {},
      brainxCircuitBreakers: state.brainxCircuitBreakers || {},
      governedSuggestions: state.governedSuggestions || {},
      intelCapabilityProposals: state.intelCapabilityProposals || {},
      enterpriseGovernanceBindings: state.enterpriseGovernanceBindings || {},
      enterpriseGovernancePolicies: state.enterpriseGovernancePolicies || {},
      enterpriseGovernanceBudgets: state.enterpriseGovernanceBudgets || {},
      enterpriseGovernanceReservations: state.enterpriseGovernanceReservations || {},
      enterpriseGovernanceDecisionContexts: state.enterpriseGovernanceDecisionContexts || {},
      enterpriseGovernanceKnowledgeReceipts: state.enterpriseGovernanceKnowledgeReceipts || {},
      enterpriseGovernanceIdempotency: state.enterpriseGovernanceIdempotency || {},
      researchXSources: state.researchXSources || {},
      researchXRuns: state.researchXRuns || {},
      researchXEffects: state.researchXEffects || {},
      agenticXKnowledge: state.agenticXKnowledge || {},
      agenticXReuseReceipts: state.agenticXReuseReceipts || {}
    };
  }

  async mutate(work) {
    const release = await acquireLock(this.paths.lock, this.lockStaleMs);
    try {
      const state = await this.readState();
      const events = [];
      const result = await work(state, events);
      state.updatedAt = nowIso();
      // Journal first: on an interrupted local write, the immutable fact remains
      // available for explicit recovery instead of silently disappearing.
      await appendJsonLines(this.paths.events, events);
      await writeJsonAtomically(this.paths.snapshot, state);
      return result;
    } catch (error) {
      // Client/policy denials are expected audited outcomes, not poison events.
      // Preserve dead letters for infrastructure or unexpected processing faults.
      if (!(error instanceof DecisionContinuityError) && !(error instanceof z.ZodError)) {
        await appendJsonLines(this.paths.deadLetters, [{
          id: createId("dce_dead"),
          occurredAt: nowIso(),
          error: error.message,
          code: error.code || "unexpected"
        }]).catch(() => {});
      }
      throw error;
    } finally {
      await release();
    }
  }

  async createBranch(input, { tenantId, actor } = {}) {
    assertTenant(tenantId);
    const parsed = BranchInputSchema.parse(input);
    return this.mutate(async (state, events) => {
      if (parsed.origin.idempotencyKey) {
        const existing = Object.values(state.branches).find((branch) =>
          branch.tenantId === tenantId &&
          branch.workspaceId === parsed.workspaceId &&
          branch.origin?.idempotencyKey === parsed.origin.idempotencyKey
        );
        if (existing) return clone(existing);
      }
      let parent = null;
      if (parsed.parentBranchId) {
        parent = state.branches[parsed.parentBranchId];
        assertSameScope(parent, { tenantId, workspaceId: parsed.workspaceId });
      }
      const createdAt = nowIso();
      const branch = {
        id: createId("branch"),
        tenantId,
        workspaceId: parsed.workspaceId,
        decisionId: parsed.decisionId,
        rootLineageId: parent?.rootLineageId || null,
        parentBranchId: parent?.id || null,
        branchType: parsed.branchType,
        origin: parsed.origin,
        decisionSignature: parsed.decisionSignature || null,
        status: "candidate",
        objective: typeof parsed.objective === "string" ? { summary: parsed.objective, successCriteria: [] } : parsed.objective,
        candidate: parsed.candidate,
        assumptions: parsed.assumptions,
        evidence: parsed.evidence,
        fitnessVector: parsed.fitnessVector || null,
        constraintExpression: parsed.constraintExpression || null,
        constraintDefinitions: parsed.constraintDefinitions,
        constraintSnapshot: parsed.constraintSnapshot,
        revisitTriggers: [...new Set([...parsed.revisitTriggers, ...expressionConstraintIds(parsed.constraintExpression)])],
        autoReconsideration: parsed.autoReconsideration,
        allowRejectedReconsideration: parsed.allowRejectedReconsideration,
        disposition: parsed.disposition,
        producedBy: parsed.producedBy,
        executionProvenance: parsed.executionProvenance,
        enterpriseDecisionContext: parsed.enterpriseDecisionContext || null,
        expectedOutcome: parsed.expectedOutcome,
        realizedOutcome: parsed.realizedOutcome,
        revision: 1,
        createdAt,
        updatedAt: createdAt,
        lastReconsideredAt: null
      };
      branch.rootLineageId = parent?.rootLineageId || branch.id;
      branch.contentHash = stableHash({ ...branch, contentHash: undefined, updatedAt: undefined });
      state.branches[branch.id] = branch;
      events.push(eventRecord({
        tenantId,
        workspaceId: branch.workspaceId,
        type: "branch.created",
        actor,
        payload: { branch: clone(branch), contentHash: branch.contentHash }
      }));
      return clone(branch);
    });
  }

  async listBranchesPage({ tenantId, workspaceId, decisionId, statuses, limit, offset } = {}) {
    assertTenant(tenantId);
    const state = await this.readState();
    const pagination = normalizeBranchPagination({ limit, offset });
    const branches = orderedBranches(state, { tenantId, workspaceId, decisionId, statuses });
    const page = branches.slice(pagination.offset, pagination.offset + pagination.limit).map(clone);
    return {
      branches: page,
      pagination: branchPaginationMetadata({
        ...pagination,
        total: branches.length,
        returned: page.length
      })
    };
  }

  async listBranches(options = {}) {
    return (await this.listBranchesPage(options)).branches;
  }

  async getBranch(branchId, { tenantId, workspaceId } = {}) {
    assertTenant(tenantId);
    const state = await this.readState();
    const branch = state.branches[branchId];
    assertSameScope(branch, { tenantId, workspaceId });
    return {
      ...clone(branch),
      childBranchIds: Object.values(state.branches).filter((candidate) => candidate.parentBranchId === branch.id).map((candidate) => candidate.id)
    };
  }

  /**
   * Records observed build evidence without selecting, approving, or promoting
   * a branch.  It gives automatic build capture an append-only audit trail while
   * keeping Decision Continuity's high-risk lifecycle gates intact.
   */
  async recordBranchExecutionOutcome({ branchId, ...input } = {}, { tenantId, workspaceId, actor } = {}) {
    assertTenant(tenantId);
    if (!branchId || typeof branchId !== "string") throw new DecisionContinuityError("A branch ID is required.", { code: "branch_required" });
    const parsed = BranchExecutionOutcomeSchema.parse(input);
    return this.mutate((state, events) => {
      const branch = state.branches[branchId];
      assertSameScope(branch, { tenantId, workspaceId });
      const before = clone(branch);
      const next = {
        ...branch,
        realizedOutcome: {
          ...(branch.realizedOutcome || {}),
          execution: {
            ...parsed,
            completedAt: parsed.completedAt || nowIso()
          }
        },
        revision: Number(branch.revision || 0) + 1,
        updatedAt: nowIso()
      };
      next.contentHash = stableHash({ ...next, contentHash: undefined, updatedAt: undefined });
      state.branches[branchId] = next;
      events.push(eventRecord({
        tenantId,
        workspaceId: next.workspaceId,
        type: "branch.execution_recorded",
        actor,
        correlationId: next.origin?.correlationId,
        payload: { branchId, before, after: clone(next), executionStatus: parsed.status, buildId: parsed.buildId || null }
      }));
      return clone(next);
    });
  }

  /** A human/operator disposition may defer or retire a branch, but may never select it. */
  async setDisposition({ branchId, status, reason = "", expectedRevision }, { tenantId, actor } = {}) {
    assertTenant(tenantId);
    if (!["deferred", "rejected", "superseded", "archived", "retired"].includes(status)) {
      throw new DecisionContinuityError("Only non-promoting branch dispositions may be set directly.", { code: "invalid_disposition" });
    }
    return this.mutate(async (state, events) => {
      const branch = state.branches[branchId];
      assertSameScope(branch, { tenantId });
      assertExpectedRevision(branch, expectedRevision);
      return clone(updateBranch(state, branch, {
        status,
        disposition: { ...branch.disposition, reason: String(reason).slice(0, 2000) || status }
      }, { event: "branch.disposition_set", events, actor, reason: String(reason).slice(0, 2000) || status }));
    });
  }

  async listEvents({ tenantId, workspaceId, branchId, limit = 200 } = {}) {
    assertTenant(tenantId);
    if (!(await fs.pathExists(this.paths.events))) return [];
    const text = await fs.readFile(this.paths.events, "utf8");
    return text.split(/\r?\n/).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean)
      .filter((entry) => entry.tenantId === tenantId && (!workspaceId || entry.workspaceId === workspaceId))
      .filter((entry) => !branchId || entry.payload?.branchId === branchId || entry.payload?.branch?.id === branchId)
      .slice(-Math.max(1, Math.min(Number(limit) || 200, 500)))
      .reverse();
  }

  async recordObservation(input, { tenantId, workspaceId = "default", actor } = {}) {
    assertTenant(tenantId);
    const parsed = ObservationInputSchema.parse(input);
    return this.mutate(async (state, events) => {
      const key = observationKey({ tenantId, workspaceId, constraintId: parsed.constraintId });
      const previous = state.observations[key] || null;
      const observation = {
        id: createId("observation"),
        tenantId,
        workspaceId,
        ...parsed,
        occurredAt: parsed.occurredAt || nowIso(),
        recordedAt: nowIso(),
        revision: Number(previous?.revision || 0) + 1
      };
      state.observations[key] = observation;
      events.push(eventRecord({
        tenantId,
        workspaceId,
        type: "constraint.observed",
        actor,
        payload: { constraintId: parsed.constraintId, previous, observation: clone(observation) }
      }));
      return clone(observation);
    });
  }

  async ingestConditionEvent(input, { tenantId, actor } = {}) {
    assertTenant(tenantId);
    const parsed = ConditionEventSchema.parse(input);
    return this.mutate(async (state, events) => {
      const idempotencyKey = `${tenantId}:${parsed.workspaceId}:${parsed.eventId}`;
      const existing = state.processedConditionEvents[idempotencyKey];
      if (existing) return { ...clone(existing), idempotent: true };

      const currentObservations = {};
      for (const inputObservation of parsed.observations) {
        const key = observationKey({ tenantId, workspaceId: parsed.workspaceId, constraintId: inputObservation.constraintId });
        const previous = state.observations[key] || null;
        const observation = {
          id: createId("observation"), tenantId, workspaceId: parsed.workspaceId, ...inputObservation,
          occurredAt: inputObservation.occurredAt || parsed.occurredAt || nowIso(), recordedAt: nowIso(),
          revision: Number(previous?.revision || 0) + 1
        };
        state.observations[key] = observation;
        currentObservations[inputObservation.constraintId] = observation;
        events.push(eventRecord({ tenantId, workspaceId: parsed.workspaceId, type: "condition_event.observation_recorded", actor, payload: { eventId: parsed.eventId, previous, observation: clone(observation) } }));
      }

      const changedConstraintIds = new Set(parsed.observations.map((item) => item.constraintId));
      const createdRequests = [];
      const blocked = [];
      for (const branch of Object.values(state.branches)) {
        const supportsReconsideration = branch.autoReconsideration && (branch.status === "deferred" || (branch.status === "rejected" && branch.allowRejectedReconsideration && parsed.authorizeRejectedReconsideration));
        if (!supportsReconsideration || branch.tenantId !== tenantId || branch.workspaceId !== parsed.workspaceId) continue;
        if (!branch.revisitTriggers.some((trigger) => changedConstraintIds.has(trigger))) continue;
        const branchObservations = Object.fromEntries(expressionConstraintIds(branch.constraintExpression).map((constraintId) => [
          constraintId,
          state.observations[observationKey({ tenantId, workspaceId: branch.workspaceId, constraintId })] || null
        ]));
        const evaluation = evaluateConstraintExpression(branch.constraintExpression, branchObservations);
        if (evaluation.state !== "cleared") {
          blocked.push({ branchId: branch.id, reason: evaluation.state, details: evaluation.reasons });
          events.push(eventRecord({ tenantId, workspaceId: branch.workspaceId, type: "reconsideration.blocked", actor, payload: { branchId: branch.id, eventId: parsed.eventId, evaluation } }));
          continue;
        }
        const lastReconsideredAt = new Date(branch.lastReconsideredAt || 0).getTime();
        if (Date.now() - lastReconsideredAt < this.reconsiderationCooldownMs) {
          blocked.push({ branchId: branch.id, reason: "cooldown" });
          continue;
        }
        if (dailyReconsiderationCount(state, tenantId) >= this.maxReconsiderationsPerTenantPerDay) {
          blocked.push({ branchId: branch.id, reason: "tenant_budget" });
          continue;
        }
        const request = {
          id: createId("reconsideration"), tenantId, workspaceId: branch.workspaceId, branchId: branch.id,
          sourceEventId: parsed.eventId, status: "pending_evaluation", createdAt: nowIso(), updatedAt: nowIso(),
          evaluation: null, approvalId: null, canaryId: null, loopGuard: { eventKey: idempotencyKey, createdToday: dailyReconsiderationCount(state, tenantId) + 1 }
        };
        state.reconsiderations[request.id] = request;
        const revised = updateBranch(state, branch, { status: "reconsidering", lastReconsideredAt: request.createdAt }, { event: "branch.reconsideration_started", events, actor, reason: `condition_event:${parsed.eventId}` });
        events.push(eventRecord({ tenantId, workspaceId: revised.workspaceId, type: "reconsideration.requested", actor, payload: { request: clone(request), constraintEvaluation: evaluation } }));
        createdRequests.push(clone(request));
      }
      const result = { idempotent: false, eventId: parsed.eventId, requests: createdRequests, blocked };
      // Scope travels with the idempotency result so a database read model can
      // preserve the tenant/workspace uniqueness guarantee after a restart.
      state.processedConditionEvents[idempotencyKey] = { ...clone(result), tenantId, workspaceId: parsed.workspaceId };
      events.push(eventRecord({ tenantId, workspaceId: parsed.workspaceId, type: "condition_event.accepted", actor, payload: { eventId: parsed.eventId, changedConstraintIds: [...changedConstraintIds], requestIds: createdRequests.map((request) => request.id) } }));
      return result;
    });
  }

  async listReconsiderations({ tenantId, workspaceId, branchId, limit = 100 } = {}) {
    assertTenant(tenantId);
    const state = await this.readState();
    return Object.values(state.reconsiderations)
      .filter((item) => item.tenantId === tenantId && (!workspaceId || item.workspaceId === workspaceId) && (!branchId || item.branchId === branchId))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, Math.max(1, Math.min(Number(limit) || 100, 250))).map(clone);
  }

  async getReconsideration(reconsiderationId, { tenantId, workspaceId } = {}) {
    assertTenant(tenantId);
    const state = await this.readState();
    const reconsideration = state.reconsiderations[reconsiderationId];
    assertSameScope(reconsideration, { tenantId, workspaceId });
    return clone(reconsideration);
  }

  async recordEvaluation({ reconsiderationId, validator, reviewerId, evaluatorId, summary = "", fitnessVector, expectedBranchRevision }, { tenantId, actor } = {}) {
    assertTenant(tenantId);
    const parsedFitness = FitnessVectorSchema.optional().parse(fitnessVector);
    if (!reconsiderationId || !reviewerId || !evaluatorId || !validator?.status) throw new DecisionContinuityError("Evaluation requires request, evaluator, independent reviewer, and validator status.", { code: "invalid_evaluation" });
    if (!["passed", "failed"].includes(validator.status)) throw new DecisionContinuityError("Validator status must be passed or failed.", { code: "invalid_evaluation" });
    if (validator.deterministic !== true) throw new DecisionContinuityError("A recorded deterministic validator result is required before independent evaluation.", { code: "deterministic_validation_required", status: 409 });
    return this.mutate(async (state, events) => {
      const request = state.reconsiderations[reconsiderationId];
      assertSameScope(request, { tenantId });
      if (request.status !== "pending_evaluation") throw new DecisionContinuityError("This reconsideration is not awaiting evaluation.", { code: "invalid_lifecycle_state", status: 409 });
      const branch = state.branches[request.branchId];
      assertSameScope(branch, { tenantId, workspaceId: request.workspaceId });
      assertExpectedRevision(branch, expectedBranchRevision);
      if (reviewerId === evaluatorId || reviewerId === branch.producedBy?.agentId || reviewerId === branch.producedBy?.actorId) {
        throw new DecisionContinuityError("The reviewer must be independent of the original producer and evaluator.", { code: "independent_review_required", status: 403 });
      }
      request.evaluation = { evaluatorId, reviewerId, validator: clone(validator), summary: String(summary).slice(0, 4000), fitnessVector: parsedFitness || null, evaluatedAt: nowIso() };
      request.updatedAt = nowIso();
      request.status = validator.status === "passed" ? "awaiting_policy" : "deferred";
      if (validator.status === "failed") updateBranch(state, branch, { status: "deferred", disposition: { ...branch.disposition, reason: "reconsideration_validation_failed" } }, { event: "branch.reconsideration_deferred", events, actor, reason: "validation_failed" });
      else updateBranch(state, branch, { status: "candidate", fitnessVector: parsedFitness || branch.fitnessVector }, { event: "branch.reconsideration_evaluated", events, actor, reason: "validation_passed_awaiting_approval" });
      events.push(eventRecord({ tenantId, workspaceId: request.workspaceId, type: "reconsideration.evaluated", actor, payload: { reconsiderationId, evaluation: clone(request.evaluation), resultingStatus: request.status } }));
      return clone(request);
    });
  }

  async recordPolicyDecision({ reconsiderationId, policyVersion, decision, reasons = [], riskLevel = "unknown", override = null, expectedBranchRevision }, { tenantId, actor } = {}) {
    assertTenant(tenantId);
    if (!reconsiderationId || !policyVersion || !["permitted", "denied"].includes(decision)) {
      throw new DecisionContinuityError("Policy review requires a versioned permitted or denied decision.", { code: "invalid_policy_decision" });
    }
    return this.mutate(async (state, events) => {
      const request = state.reconsiderations[reconsiderationId];
      assertSameScope(request, { tenantId });
      if (request.status !== "awaiting_policy") throw new DecisionContinuityError("This reconsideration is not awaiting policy review.", { code: "invalid_lifecycle_state", status: 409 });
      const branch = state.branches[request.branchId];
      assertExpectedRevision(branch, expectedBranchRevision);
      const policy = {
        id: createId("policy"), tenantId, workspaceId: request.workspaceId, reconsiderationId, policyVersion: String(policyVersion).slice(0, 160),
        decision, reasons: asArray(reasons).map(String).slice(0, 50), riskLevel: String(riskLevel).slice(0, 80), override: override ? clone(override) : null,
        evaluatedAt: nowIso(), actorId: actorId(actor)
      };
      request.policy = policy;
      request.updatedAt = nowIso();
      request.status = decision === "permitted" ? "awaiting_approval" : "deferred";
      if (decision === "denied") updateBranch(state, branch, { status: "deferred", disposition: { ...branch.disposition, reason: "reconsideration_policy_denied" } }, { event: "branch.reconsideration_deferred", events, actor, reason: "policy_denied" });
      events.push(eventRecord({ tenantId, workspaceId: request.workspaceId, type: "reconsideration.policy_evaluated", actor, payload: { reconsiderationId, policy: clone(policy), resultingStatus: request.status } }));
      return clone(request);
    });
  }

  async recordApproval({ reconsiderationId, decision, approverId, note = "", expectedBranchRevision }, { tenantId, actor } = {}) {
    assertTenant(tenantId);
    if (!reconsiderationId || !approverId || !["approved", "rejected"].includes(decision)) throw new DecisionContinuityError("Approval requires a request, an approver, and approved or rejected decision.", { code: "invalid_approval" });
    return this.mutate(async (state, events) => {
      const request = state.reconsiderations[reconsiderationId];
      assertSameScope(request, { tenantId });
      if (request.status !== "awaiting_approval") throw new DecisionContinuityError("This reconsideration is not awaiting approval.", { code: "invalid_lifecycle_state", status: 409 });
      const branch = state.branches[request.branchId];
      assertExpectedRevision(branch, expectedBranchRevision);
      if ([branch.producedBy?.agentId, branch.producedBy?.actorId, request.evaluation?.evaluatorId].includes(approverId)) {
        throw new DecisionContinuityError("Approval must be performed by an actor separate from the proposer and evaluator.", { code: "independent_approval_required", status: 403 });
      }
      const approval = { id: createId("approval"), tenantId, workspaceId: request.workspaceId, reconsiderationId, branchId: branch.id, decision, approverId, note: String(note).slice(0, 4000), decidedAt: nowIso() };
      state.approvals[approval.id] = approval;
      request.approvalId = approval.id;
      request.status = decision === "approved" ? "approved" : "deferred";
      request.updatedAt = nowIso();
      if (decision === "rejected") updateBranch(state, branch, { status: "deferred", disposition: { ...branch.disposition, reason: "reconsideration_approval_rejected" } }, { event: "branch.reconsideration_deferred", events, actor, reason: "approval_rejected" });
      events.push(eventRecord({ tenantId, workspaceId: request.workspaceId, type: "reconsideration.approved", actor, payload: { approval: clone(approval), requestStatus: request.status } }));
      return clone(approval);
    });
  }

  async startCanary({ reconsiderationId, trafficPercent, durationMinutes, monitoringWindowMinutes, rollbackPlan, successCriteria = [], failureCriteria = [], expectedBranchRevision }, { tenantId, actor } = {}) {
    assertTenant(tenantId);
    const percent = Number(trafficPercent);
    const duration = Number(durationMinutes);
    const monitoringWindow = Number(monitoringWindowMinutes);
    if (!Number.isFinite(percent) || percent <= 0 || percent > MAX_CANARY_TRAFFIC_PERCENT || !Number.isInteger(duration) || duration < 1 || duration > 24 * 60 || !Number.isInteger(monitoringWindow) || monitoringWindow < 1 || monitoringWindow > 24 * 60 || !rollbackPlan || !asArray(successCriteria).length || !asArray(failureCriteria).length) {
      throw new DecisionContinuityError(`Canaries require 1-${MAX_CANARY_TRAFFIC_PERCENT}% traffic, bounded duration and monitoring windows, success/failure criteria, and a rollback plan.`, { code: "invalid_canary" });
    }
    return this.mutate(async (state, events) => {
      const request = state.reconsiderations[reconsiderationId];
      assertSameScope(request, { tenantId });
      if (request.status !== "approved") throw new DecisionContinuityError("An approved reconsideration is required before a canary can begin.", { code: "approval_required", status: 409 });
      assertExpectedRevision(state.branches[request.branchId], expectedBranchRevision);
      const canary = { id: createId("canary"), tenantId, workspaceId: request.workspaceId, branchId: request.branchId, reconsiderationId, status: "running", trafficPercent: percent, durationMinutes: duration, monitoringWindowMinutes: monitoringWindow, rollbackPlan: String(rollbackPlan).slice(0, 4000), successCriteria: asArray(successCriteria).map(String).slice(0, 30), failureCriteria: asArray(failureCriteria).map(String).slice(0, 30), startedAt: nowIso(), completedAt: null, outcome: null };
      state.canaries[canary.id] = canary;
      request.canaryId = canary.id;
      request.status = "canary_running";
      request.updatedAt = nowIso();
      events.push(eventRecord({ tenantId, workspaceId: canary.workspaceId, type: "canary.started", actor, payload: { canary: clone(canary), sideEffect: "none; audit-only control-plane record" } }));
      return clone(canary);
    });
  }

  async getCanary(canaryId, { tenantId, workspaceId } = {}) {
    assertTenant(tenantId);
    const state = await this.readState();
    const canary = state.canaries[canaryId];
    assertSameScope(canary, { tenantId, workspaceId });
    return clone(canary);
  }

  async recordCanaryOutcome({ canaryId, status, metrics = {}, summary = "", severeRegression = false, expectedBranchRevision }, { tenantId, actor } = {}) {
    assertTenant(tenantId);
    if (!canaryId || !["passed", "failed", "rolled_back"].includes(status)) throw new DecisionContinuityError("Canary outcome must be passed, failed, or rolled_back.", { code: "invalid_canary_outcome" });
    return this.mutate(async (state, events) => {
      const canary = state.canaries[canaryId];
      assertSameScope(canary, { tenantId });
      if (canary.status !== "running") throw new DecisionContinuityError("This canary is not running.", { code: "invalid_lifecycle_state", status: 409 });
      const request = state.reconsiderations[canary.reconsiderationId];
      const branch = state.branches[canary.branchId];
      assertExpectedRevision(branch, expectedBranchRevision);
      const finalStatus = severeRegression ? "rolled_back" : status;
      canary.status = finalStatus;
      canary.completedAt = nowIso();
      canary.outcome = { metrics: clone(metrics || {}), summary: String(summary).slice(0, 4000), recordedAt: nowIso() };
      request.status = finalStatus === "passed" ? "completed" : "deferred";
      request.updatedAt = nowIso();
      if (finalStatus === "passed") updateBranch(state, branch, { status: "selected", realizedOutcome: { metrics: clone(metrics || {}), summary: String(summary).slice(0, 4000), recordedAt: canary.completedAt }, disposition: { ...branch.disposition, reason: "canary_passed" } }, { event: "branch.selected_after_canary", events, actor, reason: "canary_passed" });
      else updateBranch(state, branch, { status: "deferred", realizedOutcome: { metrics: clone(metrics || {}), summary: String(summary).slice(0, 4000), recordedAt: canary.completedAt }, disposition: { ...branch.disposition, reason: "canary_regression_or_rollback" } }, { event: "branch.rolled_back", events, actor, reason: finalStatus });
      events.push(eventRecord({ tenantId, workspaceId: canary.workspaceId, type: "canary.completed", actor, payload: { canary: clone(canary), resultingRequestStatus: request.status } }));
      return clone(canary);
    });
  }
}

class UnavailableDecisionContinuityStore {
  constructor(reason) {
    this.reason = reason;
  }

  unavailable() {
    throw new DecisionContinuityError(this.reason, {
      code: "authoritative_store_unavailable",
      status: 503
    });
  }

  async health() {
    return { status: "unavailable", adapter: "unavailable", reason: this.reason };
  }
}

for (const method of [
  "ensure", "readState", "mutate", "createBranch", "listBranches", "listBranchesPage", "getBranch", "setDisposition", "listEvents",
  "recordObservation", "ingestConditionEvent", "listReconsiderations", "getReconsideration", "recordEvaluation", "recordPolicyDecision",
  "recordApproval", "startCanary", "getCanary", "recordCanaryOutcome", "importLegacy"
]) {
  UnavailableDecisionContinuityStore.prototype[method] = async function unavailableMethod() {
    return this.unavailable();
  };
}

class LazyPostgresDecisionContinuityStore {
  constructor(options) {
    this.options = options;
    this.delegate = null;
  }

  async store() {
    if (!this.delegate) {
      const { PostgresDecisionContinuityStore } = await import("./decisionContinuityPostgres.js");
      this.delegate = new PostgresDecisionContinuityStore(this.options);
    }
    return this.delegate;
  }
}

for (const method of [
  "ensure", "health", "readState", "mutate", "createBranch", "listBranches", "listBranchesPage", "getBranch", "setDisposition", "listEvents",
  "recordObservation", "ingestConditionEvent", "listReconsiderations", "getReconsideration", "recordEvaluation", "recordPolicyDecision",
  "recordApproval", "startCanary", "getCanary", "recordCanaryOutcome", "importLegacy"
]) {
  LazyPostgresDecisionContinuityStore.prototype[method] = async function delegatedMethod(...args) {
    return (await this.store())[method](...args);
  };
}

export function resolveDecisionContinuityAdapter({ adapter, environment = process.env.NODE_ENV || "development" } = {}) {
  const requested = String(adapter || process.env.DECISION_CONTINUITY_ADAPTER || (environment === "production" ? "postgres" : "file")).toLowerCase();
  if (environment === "production" && requested !== "postgres") {
    return { adapter: "unavailable", reason: "Production decision continuity requires DECISION_CONTINUITY_ADAPTER=postgres." };
  }
  if (!["file", "postgres"].includes(requested)) {
    return { adapter: "unavailable", reason: "Decision continuity adapter must be file or postgres." };
  }
  return { adapter: requested, reason: "" };
}

export function createDecisionContinuityStore(options = {}) {
  const resolution = resolveDecisionContinuityAdapter(options);
  if (resolution.adapter === "file") return new FileDecisionContinuityStore(options);
  if (resolution.adapter === "postgres") return new LazyPostgresDecisionContinuityStore(options);
  return new UnavailableDecisionContinuityStore(resolution.reason);
}
