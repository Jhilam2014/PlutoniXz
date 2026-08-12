import crypto from "node:crypto";
import { z } from "zod";
import { DecisionContinuityError } from "./decisionContinuity.js";
import { DECISION_PERMISSIONS } from "./identityAccess.js";

/**
 * Bounded QAgent adapter for Decision Continuity.
 *
 * QAgent is deliberately an evidence planner. It can create one structured
 * investigation and use one registered read-only collector, but cannot change
 * a constraint to cleared, determine a final fitness/policy outcome, approve,
 * promote, install a capability, or invoke arbitrary tools.
 */
export const QAGENT_RUN_SCHEMA_VERSION = "qagent-decision-continuity/v1";
export const QAGENT_DEDUPLICATION_VERSION = "qagent-semantic-dedup/calibrated-token-overlap-v1";
export const QAGENT_STOP_REASONS = Object.freeze([
  "sufficient_evidence",
  "low_expected_value",
  "evidence_unavailable",
  "policy_denied",
  "repeated_question",
  "budget_exhausted",
  "timeout",
  "cancelled",
  "loop_detected",
  "invalid_evidence",
  "independent_evaluator_unavailable",
  "no_decision_effect",
  "recovery_required"
]);

const DEFAULT_LIMITS = Object.freeze({
  maxIterations: 1,
  maxRecursion: 0,
  maxFanOut: 4,
  maxTokens: 4_000,
  maxModelCalls: 1,
  maxToolCalls: 1,
  maxElapsedMs: 60_000,
  maxCostUsd: 0.25,
  maxComputeUnits: 1,
  maxEvidenceBytes: 64 * 1024
});
const ABSOLUTE_LIMITS = Object.freeze({
  maxIterations: 4,
  maxRecursion: 0,
  maxFanOut: 8,
  maxTokens: 12_000,
  maxModelCalls: 2,
  maxToolCalls: 2,
  maxElapsedMs: 5 * 60_000,
  maxCostUsd: 1,
  maxComputeUnits: 4,
  maxEvidenceBytes: 256 * 1024
});
const ACTIVE_RUN_STATES = new Set(["proposed", "collecting", "awaiting_independent_evaluation", "completed"]);
const SAFE_DEFAULT_TOOLS = ["deterministic_fixture"];
const SAFE_DEFAULT_SOURCES = ["deterministic_fixture", "authorized_catalog"];
const STOP_WORDS = new Set(["a", "an", "and", "are", "be", "can", "could", "do", "does", "for", "from", "how", "if", "in", "is", "of", "on", "or", "the", "to", "what", "when", "with"]);
const TOKEN_NORMALIZATION = new Map([
  ["error", "failure"], ["errors", "failure"], ["failures", "failure"], ["failed", "failure"],
  ["metric", "measure"], ["metrics", "measure"], ["rate", "measure"], ["rates", "measure"],
  ["navigation", "route"], ["routing", "route"], ["routes", "route"], ["users", "user"]
]);

function now() { return new Date().toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function createId(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: canonicalize(value[key]) }), {});
  return value;
}
function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex"); }
function textDigest(value) { return crypto.createHash("sha256").update(String(value || "")).digest("hex"); }
function boundedNumber(raw, fallback, maximum, minimum = 0) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, minimum), maximum);
}
function csv(value, fallback = []) {
  const values = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  return values.length ? [...new Set(values)] : fallback;
}
function enabled(value) { return String(value || "").trim().toLowerCase() === "true"; }
function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function semanticTokens(value) {
  return new Set(normalizeText(value).split(" ").filter(Boolean).map((token) => TOKEN_NORMALIZATION.get(token) || token).filter((token) => !STOP_WORDS.has(token)));
}
function tokenSimilarity(left, right) {
  const a = semanticTokens(left);
  const b = semanticTokens(right);
  const union = new Set([...a, ...b]);
  if (!union.size) return 1;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap / union.size;
}
function redactText(value, max = 480) {
  return String(value || "")
    .replace(/(?:api[_-]?key|authorization|bearer|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "<redacted>")
    .slice(0, max);
}
function event({ tenantId, workspaceId, type, actor, correlationId, payload }) {
  return {
    id: createId("dce"), schemaVersion: QAGENT_RUN_SCHEMA_VERSION, type, occurredAt: now(), tenantId, workspaceId,
    actor: actor || { type: "service", id: "qagent" }, correlationId: correlationId || null, payload: clone(payload || {})
  };
}
function ensureQAgentState(state) {
  state.qagentRuns ||= {};
  state.qagentEffects ||= {};
  state.branches ||= {};
  state.reconsiderations ||= {};
}
function isQAgentIdentity(id) { return /(?:^|[-_:])qagent(?:[-_:]|$)|qagent/i.test(String(id || "")); }

const BranchRelevanceSchema = z.object({
  branchId: z.string().min(1).max(160),
  relevance: z.enum(["direct", "comparative", "context_only"]),
  evidenceGap: z.string().min(8).max(1200)
}).strict();

export const QAgentProposalSchema = z.object({
  question: z.string().min(8).max(1600),
  hypothesis: z.string().min(1).max(1600),
  experiment: z.string().min(1).max(1600),
  affectedBranches: z.array(BranchRelevanceSchema).min(1).max(ABSOLUTE_LIMITS.maxFanOut),
  expectedInformationGain: z.object({
    score: z.number().min(0).max(1),
    proxy: z.string().min(1).max(160),
    calibrationVersion: z.string().min(1).max(160)
  }).strict(),
  requestedEvidence: z.array(z.object({
    source: z.string().min(1).max(160),
    toolId: z.string().min(1).max(160),
    type: z.enum(["metric", "test", "artifact", "research", "catalog"]),
    freshnessMs: z.number().int().min(0).max(7 * 24 * 60 * 60 * 1000),
    purpose: z.string().min(1).max(800)
  }).strict()).min(1).max(1),
  estimate: z.object({
    tokens: z.number().int().min(0).max(ABSOLUTE_LIMITS.maxTokens),
    modelCalls: z.number().int().min(0).max(ABSOLUTE_LIMITS.maxModelCalls),
    toolCalls: z.number().int().min(0).max(ABSOLUTE_LIMITS.maxToolCalls),
    latencyMs: z.number().int().min(0).max(ABSOLUTE_LIMITS.maxElapsedMs),
    monetaryCostUsd: z.number().min(0).max(ABSOLUTE_LIMITS.maxCostUsd),
    computeUnits: z.number().min(0).max(ABSOLUTE_LIMITS.maxComputeUnits),
    evidenceBytes: z.number().int().min(0).max(ABSOLUTE_LIMITS.maxEvidenceBytes),
    risk: z.enum(["low", "medium", "high"])
  }).strict(),
  stopCondition: z.enum(["sufficient_evidence", "low_expected_value", "evidence_unavailable", "timeout"])
}).strict();

const QAgentCreateInputSchema = z.object({
  iteration: z.number().int().min(1).max(ABSOLUTE_LIMITS.maxIterations),
  reconsiderationId: z.string().min(1).max(160),
  branchIds: z.array(z.string().min(1).max(160)).min(1).max(ABSOLUTE_LIMITS.maxFanOut),
  triggeringEvaluation: z.object({
    id: z.string().min(1).max(160),
    evaluatorId: z.string().min(1).max(160),
    evaluatorVersion: z.string().min(1).max(160)
  }).strict(),
  workflow: z.object({
    correlationId: z.string().min(1).max(160),
    requestId: z.string().max(160).optional(),
    jobId: z.string().max(160).optional()
  }).strict(),
  model: z.object({
    provider: z.string().min(1).max(120),
    modelId: z.string().min(1).max(240),
    modelVersion: z.string().min(1).max(240),
    promptVersion: z.string().min(1).max(160)
  }).strict(),
  proposal: QAgentProposalSchema
}).strict();

const CollectorEvidenceSchema = z.object({
  content: z.string().min(1).max(ABSOLUTE_LIMITS.maxEvidenceBytes),
  provenance: z.object({
    source: z.string().min(1).max(160),
    collectorId: z.string().min(1).max(160),
    readOnlyToolId: z.string().min(1).max(160),
    authorizationId: z.string().min(1).max(240),
    authorized: z.boolean(),
    collectedAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    digest: z.string().regex(/^[a-f0-9]{64}$/)
  }).strict()
}).strict();

const CollectorResultSchema = z.object({
  status: z.enum(["available", "unavailable"]),
  evidence: z.array(CollectorEvidenceSchema).max(8).default([]),
  usage: z.object({
    tokens: z.number().int().min(0).default(0),
    modelCalls: z.number().int().min(0).default(0),
    toolCalls: z.number().int().min(0).default(1),
    latencyMs: z.number().int().min(0).default(0),
    monetaryCostUsd: z.number().min(0).default(0),
    computeUnits: z.number().min(0).default(0)
  }).strict().default({})
}).strict();

export const QAgentIndependentEvaluationSchema = z.object({
  evaluatorId: z.string().min(1).max(160),
  evaluatorVersion: z.string().min(1).max(160),
  status: z.enum(["accepted", "rejected", "no_decision_effect"]),
  explanation: z.string().min(1).max(2400),
  provisionalFitnessChanges: z.array(z.object({
    branchId: z.string().min(1).max(160),
    dimension: z.string().min(1).max(120),
    before: z.number().finite().nullable(),
    after: z.number().finite().nullable(),
    attribution: z.enum(["evidence_associated", "not_established"])
  }).strict()).max(40).default([]),
  provisionalRanking: z.object({
    changed: z.boolean(),
    method: z.string().max(160),
    attribution: z.enum(["evidence_associated", "not_established"])
  }).strict().default({ changed: false, method: "not_calculated", attribution: "not_established" }),
  constraintStates: z.array(z.object({
    branchId: z.string().min(1).max(160),
    constraintId: z.string().min(1).max(160),
    state: z.enum(["unknown", "blocking"]),
    reason: z.string().min(1).max(800)
  }).strict()).max(40).default([])
}).strict();

export function resolveQAgentDecisionContinuityConfig(env = process.env) {
  const limits = Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => [key, boundedNumber(env[`QAGENT_DECISION_CONTINUITY_${key.replace(/[A-Z]/g, (part) => `_${part}`).toUpperCase()}`], fallback, ABSOLUTE_LIMITS[key]) ]));
  // Explicit environment names keep deployment configuration readable; only a
  // lower value is honored, so neither prompt text nor a loose env value can
  // expand the absolute server-side envelope.
  limits.maxIterations = boundedNumber(env.QAGENT_DECISION_CONTINUITY_MAX_ITERATIONS, DEFAULT_LIMITS.maxIterations, ABSOLUTE_LIMITS.maxIterations, 1);
  limits.maxRecursion = 0;
  limits.maxFanOut = boundedNumber(env.QAGENT_DECISION_CONTINUITY_MAX_FAN_OUT, DEFAULT_LIMITS.maxFanOut, ABSOLUTE_LIMITS.maxFanOut, 1);
  limits.maxTokens = boundedNumber(env.QAGENT_DECISION_CONTINUITY_MAX_TOKENS, DEFAULT_LIMITS.maxTokens, ABSOLUTE_LIMITS.maxTokens, 1);
  limits.maxModelCalls = boundedNumber(env.QAGENT_DECISION_CONTINUITY_MAX_MODEL_CALLS, DEFAULT_LIMITS.maxModelCalls, ABSOLUTE_LIMITS.maxModelCalls, 0);
  limits.maxToolCalls = boundedNumber(env.QAGENT_DECISION_CONTINUITY_MAX_TOOL_CALLS, DEFAULT_LIMITS.maxToolCalls, ABSOLUTE_LIMITS.maxToolCalls, 0);
  limits.maxElapsedMs = boundedNumber(env.QAGENT_DECISION_CONTINUITY_MAX_ELAPSED_MS, DEFAULT_LIMITS.maxElapsedMs, ABSOLUTE_LIMITS.maxElapsedMs, 1);
  limits.maxCostUsd = boundedNumber(env.QAGENT_DECISION_CONTINUITY_MAX_COST_USD, DEFAULT_LIMITS.maxCostUsd, ABSOLUTE_LIMITS.maxCostUsd, 0);
  limits.maxComputeUnits = boundedNumber(env.QAGENT_DECISION_CONTINUITY_MAX_COMPUTE_UNITS, DEFAULT_LIMITS.maxComputeUnits, ABSOLUTE_LIMITS.maxComputeUnits, 0);
  limits.maxEvidenceBytes = boundedNumber(env.QAGENT_DECISION_CONTINUITY_MAX_EVIDENCE_BYTES, DEFAULT_LIMITS.maxEvidenceBytes, ABSOLUTE_LIMITS.maxEvidenceBytes, 1);
  const enabledTenants = new Set(csv(env.QAGENT_DECISION_CONTINUITY_ENABLED_TENANTS));
  return {
    enabled: enabled(env.QAGENT_DECISION_CONTINUITY_ENABLED),
    enabledTenants,
    allowedTools: csv(env.QAGENT_DECISION_CONTINUITY_READ_ONLY_TOOLS, SAFE_DEFAULT_TOOLS),
    allowedSources: csv(env.QAGENT_DECISION_CONTINUITY_EVIDENCE_SOURCES, SAFE_DEFAULT_SOURCES),
    minExpectedInformationGain: boundedNumber(env.QAGENT_DECISION_CONTINUITY_MIN_EXPECTED_INFORMATION_GAIN, 0.1, 1, 0),
    deduplicationThreshold: boundedNumber(env.QAGENT_DECISION_CONTINUITY_DEDUPLICATION_THRESHOLD, 0.72, 1, 0.5),
    limits
  };
}

function budgetExceeded(usage, limits) {
  return Object.entries(limits).some(([key, limit]) => {
    const usageKey = key.replace(/^max/, "").replace(/^[A-Z]/, (part) => part.toLowerCase());
    return Number(usage[usageKey] || 0) > Number(limit);
  });
}
function proposalWithinLimits(proposal, limits) {
  return proposal.estimate.tokens <= limits.maxTokens && proposal.estimate.modelCalls <= limits.maxModelCalls && proposal.estimate.toolCalls <= limits.maxToolCalls && proposal.estimate.latencyMs <= limits.maxElapsedMs && proposal.estimate.monetaryCostUsd <= limits.maxCostUsd && proposal.estimate.computeUnits <= limits.maxComputeUnits && proposal.estimate.evidenceBytes <= limits.maxEvidenceBytes;
}
function usageFromProposal(proposal) {
  return { iterations: 1, recursion: 0, fanOut: proposal.affectedBranches.length, tokens: proposal.estimate.tokens, modelCalls: proposal.estimate.modelCalls, toolCalls: 0, elapsedMs: 0, monetaryCostUsd: 0, computeUnits: 0, evidenceBytes: 0 };
}
function assertScope(record, { tenantId, workspaceId }) {
  if (!record || record.tenantId !== tenantId || (workspaceId && record.workspaceId !== workspaceId)) throw new DecisionContinuityError("QAgent record is not available in this tenant scope.", { code: "not_found", status: 404 });
}
function appendBranchImpact(state, run, evaluation, evidenceSummaries, events, actor) {
  for (const relevance of run.branchRelevance) {
    const branch = state.branches[relevance.branchId];
    if (!branch) continue;
    const impact = {
      runId: run.id, evidenceGap: relevance.evidenceGap, relevance: relevance.relevance,
      provenance: evidenceSummaries.map((item) => item.provenance),
      deterministicValidation: run.deterministicValidation,
      independentEvaluation: { status: evaluation.status, evaluatorId: evaluation.evaluatorId, evaluatorVersion: evaluation.evaluatorVersion },
      decisionImpact: evaluation.status === "accepted" ? "provisional_change_recorded" : "no_final_decision_change",
      recordedAt: now()
    };
    const next = {
      ...branch,
      qagentEvidence: [...(branch.qagentEvidence || []).filter((item) => item.runId !== run.id), impact].slice(-20),
      qagentProvisionalFitness: evaluation.provisionalFitnessChanges.filter((item) => item.branchId === branch.id),
      revision: Number(branch.revision || 0) + 1,
      updatedAt: now()
    };
    next.contentHash = digest({ ...next, contentHash: undefined, updatedAt: undefined });
    state.branches[branch.id] = next;
    events.push(event({ tenantId: run.tenantId, workspaceId: run.workspaceId, type: "qagent.evidence_attached", actor, correlationId: run.workflow.correlationId, payload: { branchId: branch.id, runId: run.id, impact } }));
  }
  const reconsideration = state.reconsiderations[run.reconsiderationId];
  if (reconsideration) {
    reconsideration.qagentRunIds = [...new Set([...(reconsideration.qagentRunIds || []), run.id])];
    reconsideration.qagentDecisionImpact = run.decisionImpact;
    reconsideration.updatedAt = now();
  }
}

export class QAgentDecisionContinuityService {
  constructor({ store, env = process.env, config = resolveQAgentDecisionContinuityConfig(env), collector = null, independentEvaluator = null, identityAccess = null } = {}) {
    if (!store) throw new Error("A Decision Continuity store is required for QAgent evidence planning.");
    this.store = store;
    this.env = env;
    this.config = config;
    this.collector = collector;
    this.independentEvaluator = independentEvaluator;
    this.identityAccess = identityAccess;
  }

  isEnabledForTenant(tenantId) {
    return Boolean(this.config.enabled && this.config.enabledTenants.has(tenantId));
  }

  async assertInvestigationAuthority({ tenantId, workspaceId, actor }) {
    if (!actor?.id || actor.type !== "service") throw new DecisionContinuityError("QAgent investigation requires a scoped service identity.", { code: "qagent_identity_required", status: 403 });
    if (!this.identityAccess) {
      if (String(this.env.NODE_ENV || "").toLowerCase() === "production") throw new DecisionContinuityError("QAgent identity authority is unavailable.", { code: "authorization_unavailable", status: 503 });
      return true;
    }
    await this.identityAccess.assertPrincipalPermission({ principalId: actor.id, tenantId, workspaceId, permission: DECISION_PERMISSIONS.QAGENT_INVESTIGATE, principalTypes: ["service"] });
    return true;
  }

  async createInvestigation(input, { tenantId, workspaceId, actor } = {}) {
    if (!this.isEnabledForTenant(tenantId)) return { status: "baseline", reason: "feature_disabled", qagentRun: null };
    await this.assertInvestigationAuthority({ tenantId, workspaceId, actor });
    const parsed = QAgentCreateInputSchema.parse(input);
    const requestedBranchIds = [...new Set(parsed.branchIds)];
    if (requestedBranchIds.length !== parsed.branchIds.length || requestedBranchIds.length > this.config.limits.maxFanOut) {
      throw new DecisionContinuityError("QAgent branch fan-out exceeds the server-side limit.", { code: "qagent_fanout_limit", status: 409 });
    }
    if (parsed.proposal.affectedBranches.length !== requestedBranchIds.length || new Set(parsed.proposal.affectedBranches.map((item) => item.branchId)).size !== requestedBranchIds.length || parsed.proposal.affectedBranches.some((item) => !requestedBranchIds.includes(item.branchId))) {
      throw new DecisionContinuityError("Every affected branch must receive exactly one scoped QAgent relevance record.", { code: "invalid_qagent_scope" });
    }
    if (parsed.iteration > this.config.limits.maxIterations) {
      return this.persistStopped(parsed, { tenantId, workspaceId, actor, stopReason: "loop_detected", detail: "The server-side QAgent iteration cap was reached." });
    }
    if (!proposalWithinLimits(parsed.proposal, this.config.limits)) {
      return this.persistStopped(parsed, { tenantId, workspaceId, actor, stopReason: "budget_exhausted", detail: "Proposal estimate exceeded immutable server-side limits." });
    }
    if (parsed.proposal.expectedInformationGain.score < this.config.minExpectedInformationGain) {
      return this.persistStopped(parsed, { tenantId, workspaceId, actor, stopReason: "low_expected_value", detail: "Expected information gain was below the tenant policy threshold." });
    }
    if (parsed.proposal.requestedEvidence.some((item) => !this.config.allowedTools.includes(item.toolId) || !this.config.allowedSources.includes(item.source))) {
      return this.persistStopped(parsed, { tenantId, workspaceId, actor, stopReason: "policy_denied", detail: "Requested evidence source or tool is not explicitly read-only allowlisted." });
    }

    return this.store.mutate((state, events) => {
      ensureQAgentState(state);
      const reconsideration = state.reconsiderations[parsed.reconsiderationId];
      assertScope(reconsideration, { tenantId, workspaceId });
      if (reconsideration.status !== "pending_evaluation") throw new DecisionContinuityError("QAgent investigation requires an eligible reconsideration awaiting evaluation.", { code: "invalid_lifecycle_state", status: 409 });
      const branches = requestedBranchIds.map((branchId) => {
        const branch = state.branches[branchId];
        assertScope(branch, { tenantId, workspaceId: reconsideration.workspaceId });
        return branch;
      });
      if (!requestedBranchIds.includes(reconsideration.branchId)) throw new DecisionContinuityError("The reconsideration branch must be included in the QAgent investigation scope.", { code: "invalid_qagent_scope" });
      const evidenceGap = normalizeText(parsed.proposal.affectedBranches.map((item) => item.evidenceGap).sort().join(" "));
      const questionFingerprint = digest({ evidenceGap, question: normalizeText(parsed.proposal.question), branchDecisionIds: branches.map((branch) => branch.decisionId).sort() });
      const duplicate = Object.values(state.qagentRuns).find((candidate) => candidate.tenantId === tenantId && candidate.workspaceId === reconsideration.workspaceId && ACTIVE_RUN_STATES.has(candidate.status) && candidate.deduplication?.evidenceGap === evidenceGap && candidate.branchIds.some((branchId) => requestedBranchIds.includes(branchId)) && tokenSimilarity(candidate.proposal.question, parsed.proposal.question) >= this.config.deduplicationThreshold);
      const run = {
        id: createId("qagent_run"), schemaVersion: QAGENT_RUN_SCHEMA_VERSION, tenantId, workspaceId: reconsideration.workspaceId,
        objective: { decisionId: branches[0].decisionId, summary: redactText(branches[0].objective?.summary || ""), digest: textDigest(branches[0].objective?.summary || "") },
        branchIds: requestedBranchIds, branchRelevance: parsed.proposal.affectedBranches, reconsiderationId: parsed.reconsiderationId,
        triggeringEvaluation: parsed.triggeringEvaluation, workflow: parsed.workflow, model: parsed.model, proposal: parsed.proposal,
        limits: clone(this.config.limits), budget: { allocated: clone(this.config.limits), consumed: usageFromProposal(parsed.proposal) },
        deduplication: { fingerprint: questionFingerprint, evaluator: "calibrated-token-overlap", model: "deterministic", version: QAGENT_DEDUPLICATION_VERSION, threshold: this.config.deduplicationThreshold, evidenceGap, similarity: duplicate ? tokenSimilarity(duplicate.proposal.question, parsed.proposal.question) : 0, duplicateOfRunId: duplicate?.id || null },
        deterministicValidation: null, independentEvaluation: null, evidence: [], decisionImpact: { status: "not_evaluated", attributionMethod: "independent_evaluator/v1", finalLifecycleAuthority: "policy_and_human_approval_required" },
        status: duplicate ? "duplicate" : "proposed", stopReason: duplicate ? "repeated_question" : null, createdAt: now(), updatedAt: now(), revision: 1
      };
      state.qagentRuns[run.id] = run;
      events.push(event({ tenantId, workspaceId: run.workspaceId, type: duplicate ? "qagent.run.deduplicated" : "qagent.run.proposed", actor, correlationId: parsed.workflow.correlationId, payload: { runId: run.id, reconsiderationId: run.reconsiderationId, branchIds: run.branchIds, duplicateOfRunId: duplicate?.id || null, deduplication: run.deduplication } }));
      return { status: duplicate ? "duplicate" : "proposed", qagentRun: clone(run) };
    });
  }

  async persistStopped(parsed, { tenantId, workspaceId, actor, stopReason, detail }) {
    return this.store.mutate((state, events) => {
      ensureQAgentState(state);
      const reconsideration = state.reconsiderations[parsed.reconsiderationId];
      assertScope(reconsideration, { tenantId, workspaceId });
      const run = {
        id: createId("qagent_run"), schemaVersion: QAGENT_RUN_SCHEMA_VERSION, tenantId, workspaceId: reconsideration.workspaceId,
        objective: { decisionId: "", summary: "", digest: "" }, branchIds: parsed.branchIds, branchRelevance: parsed.proposal.affectedBranches,
        reconsiderationId: parsed.reconsiderationId, triggeringEvaluation: parsed.triggeringEvaluation, workflow: parsed.workflow, model: parsed.model, proposal: parsed.proposal,
        limits: clone(this.config.limits), budget: { allocated: clone(this.config.limits), consumed: usageFromProposal(parsed.proposal) },
        deduplication: { fingerprint: digest({ question: parsed.proposal.question, branches: parsed.branchIds }), evaluator: "not_run", model: "not_run", version: QAGENT_DEDUPLICATION_VERSION, threshold: this.config.deduplicationThreshold, evidenceGap: "", similarity: 0, duplicateOfRunId: null },
        deterministicValidation: null, independentEvaluation: null, evidence: [], decisionImpact: { status: "not_evaluated", attributionMethod: "not_applicable", finalLifecycleAuthority: "policy_and_human_approval_required" },
        status: "stopped", stopReason, stopDetail: detail, createdAt: now(), updatedAt: now(), revision: 1
      };
      state.qagentRuns[run.id] = run;
      events.push(event({ tenantId, workspaceId: run.workspaceId, type: "qagent.run.stopped", actor, correlationId: run.workflow.correlationId, payload: { runId: run.id, stopReason, detail } }));
      return { status: "stopped", qagentRun: clone(run) };
    });
  }

  async listRuns({ tenantId, workspaceId, reconsiderationId, limit = 100 } = {}) {
    const state = await this.store.readState();
    return Object.values(state.qagentRuns || {}).filter((run) => run.tenantId === tenantId && (!workspaceId || run.workspaceId === workspaceId) && (!reconsiderationId || run.reconsiderationId === reconsiderationId)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, Math.max(1, Math.min(Number(limit) || 100, 250))).map(clone);
  }

  async getRun(runId, { tenantId, workspaceId } = {}) {
    const state = await this.store.readState();
    const run = state.qagentRuns?.[runId];
    assertScope(run, { tenantId, workspaceId });
    return clone(run);
  }

  async collectAuthorizedEvidence({ runId, idempotencyKey }, { tenantId, workspaceId, actor } = {}) {
    if (!this.isEnabledForTenant(tenantId)) return { status: "baseline", reason: "feature_disabled" };
    await this.assertInvestigationAuthority({ tenantId, workspaceId, actor });
    if (!idempotencyKey || String(idempotencyKey).length > 240) throw new DecisionContinuityError("QAgent evidence collection requires an idempotency key.", { code: "idempotency_key_required" });
    const claim = await this.claimEffect({ runId, idempotencyKey, tenantId, workspaceId, actor });
    if (claim.status === "completed") return { status: "idempotent", qagentRun: claim.run };
    if (claim.status === "recovery_required") return this.stop(runId, { tenantId, workspaceId, actor, stopReason: "recovery_required", detail: "The prior collector effect is pending and cannot be safely replayed." });
    const run = claim.run;
    const request = run.proposal.requestedEvidence[0];
    if (!this.collector || this.collector.capability !== "read_only" || typeof this.collector.collect !== "function") {
      return this.stop(runId, { tenantId, workspaceId, actor, stopReason: "policy_denied", detail: "No registered read-only evidence collector is available." });
    }
    // Recheck the principal immediately before the only collector call. A
    // revoked QAgent service cannot use a previously admitted run/effect.
    await this.assertInvestigationAuthority({ tenantId, workspaceId: run.workspaceId, actor });
    let collected;
    try {
      collected = CollectorResultSchema.parse(await this.collector.collect({ tenantId, workspaceId: run.workspaceId, toolId: request.toolId, request: clone(request), idempotencyKey }));
    } catch (error) {
      return this.stop(runId, { tenantId, workspaceId, actor, stopReason: "evidence_unavailable", detail: redactText(error.message || "collector unavailable") });
    }
    if (collected.status !== "available" || !collected.evidence.length) return this.stop(runId, { tenantId, workspaceId, actor, stopReason: "evidence_unavailable", detail: "The authorized source did not return evidence." });
    const validation = this.validateEvidence(collected, run, request);
    if (validation.status !== "passed") return this.finishRejectedEvidence(runId, { tenantId, workspaceId, actor, collected, validation, stopReason: "invalid_evidence" });
    if (!this.independentEvaluator || typeof this.independentEvaluator.evaluate !== "function") return this.stop(runId, { tenantId, workspaceId, actor, stopReason: "independent_evaluator_unavailable", detail: "Accepted evidence awaits an independently provisioned evaluator." });
    let evaluation;
    try {
      evaluation = QAgentIndependentEvaluationSchema.parse(await this.independentEvaluator.evaluate({ run: clone(run), evidence: validation.evidence.map((item) => ({ ...item, content: item.content })), deterministicValidation: validation.record }));
    } catch (error) {
      return this.stop(runId, { tenantId, workspaceId, actor, stopReason: "independent_evaluator_unavailable", detail: redactText(error.message || "independent evaluator unavailable") });
    }
    if (evaluation.evaluatorId === actor?.id || evaluation.evaluatorId === run.model.modelId || isQAgentIdentity(evaluation.evaluatorId)) {
      throw new DecisionContinuityError("QAgent cannot act as its own independent evaluator.", { code: "qagent_self_evaluation_denied", status: 403 });
    }
    return this.completeEvidence(runId, { tenantId, workspaceId, actor, collected, validation, evaluation, idempotencyKey });
  }

  async claimEffect({ runId, idempotencyKey, tenantId, workspaceId, actor }) {
    return this.store.mutate((state, events) => {
      ensureQAgentState(state);
      const run = state.qagentRuns[runId];
      assertScope(run, { tenantId, workspaceId });
      const effectId = `${run.id}:collect:${idempotencyKey}`;
      const existing = state.qagentEffects[effectId];
      if (existing?.status === "completed") return { status: "completed", run: clone(run) };
      if (existing?.status === "pending") {
        // A collector must support a read-only recovery lookup before a pending
        // effect can ever be retried. Calling it again would risk paid/tool
        // duplication after a worker restart.
        return { status: "recovery_required", run: clone(run) };
      }
      if (run.status !== "proposed") throw new DecisionContinuityError("QAgent evidence can only be collected for a proposed investigation.", { code: "invalid_lifecycle_state", status: 409 });
      const elapsedMs = Date.now() - new Date(run.createdAt).getTime();
      if (elapsedMs > run.limits.maxElapsedMs || budgetExceeded(run.budget.consumed, run.limits)) return { status: "recovery_required", run: clone(run) };
      const effect = { id: effectId, tenantId, workspaceId: run.workspaceId, runId: run.id, idempotencyKey, type: "read_only_evidence_collection", status: "pending", createdAt: now(), revision: 1 };
      state.qagentEffects[effectId] = effect;
      run.status = "collecting";
      run.budget.consumed.toolCalls += 1;
      run.updatedAt = now();
      run.revision += 1;
      events.push(event({ tenantId, workspaceId: run.workspaceId, type: "qagent.effect.claimed", actor, correlationId: run.workflow.correlationId, payload: { runId: run.id, effectId, toolId: run.proposal.requestedEvidence[0].toolId } }));
      return { status: "claimed", run: clone(run) };
    });
  }

  validateEvidence(collected, run, request) {
    const accepted = [];
    const rejected = [];
    for (const item of collected.evidence) {
      const bytes = Buffer.byteLength(item.content, "utf8");
      const expiration = item.provenance.expiresAt ? new Date(item.provenance.expiresAt).getTime() : null;
      const stale = !Number.isFinite(new Date(item.provenance.collectedAt).getTime()) || Date.now() - new Date(item.provenance.collectedAt).getTime() > request.freshnessMs || (expiration !== null && expiration <= Date.now());
      const valid = bytes <= run.limits.maxEvidenceBytes && item.provenance.authorized === true && item.provenance.source === request.source && item.provenance.readOnlyToolId === request.toolId && item.provenance.digest === textDigest(item.content) && !stale;
      (valid ? accepted : rejected).push({ ...item, bytes, stale });
    }
    return {
      status: accepted.length && !rejected.length ? "passed" : "failed",
      evidence: accepted,
      record: {
        validatorId: "qagent-evidence-provenance/v1", validatorVersion: "1.0.0", status: accepted.length && !rejected.length ? "passed" : "failed",
        acceptedCount: accepted.length, rejectedCount: rejected.length, checkedAt: now(), checks: ["read_only_tool_allowlist", "authorization", "freshness", "digest", "evidence_size"],
        rejectedReasons: rejected.map((item) => ({ source: item.provenance.source, stale: item.stale, authorized: item.provenance.authorized, digestMatches: item.provenance.digest === textDigest(item.content), bytes: item.bytes }))
      }
    };
  }

  async finishRejectedEvidence(runId, { tenantId, workspaceId, actor, collected, validation, stopReason }) {
    return this.store.mutate((state, events) => {
      ensureQAgentState(state);
      const run = state.qagentRuns[runId];
      assertScope(run, { tenantId, workspaceId });
      run.deterministicValidation = validation.record;
      run.evidence = collected.evidence.map((item) => ({ contentDigest: textDigest(item.content), contentBytes: Buffer.byteLength(item.content, "utf8"), excerpt: redactText(item.content), provenance: { ...item.provenance, authorizationId: redactText(item.provenance.authorizationId, 120) }, accepted: false }));
      run.status = "stopped";
      run.stopReason = stopReason;
      run.stopDetail = "Evidence was retained as untrusted metadata and did not change any constraint.";
      run.updatedAt = now(); run.revision += 1;
      const effect = Object.values(state.qagentEffects).find((item) => item.runId === run.id && item.status === "pending");
      if (effect) { effect.status = "completed"; effect.outcome = { accepted: false, stopReason }; effect.completedAt = now(); effect.revision += 1; }
      events.push(event({ tenantId, workspaceId: run.workspaceId, type: "qagent.evidence.rejected", actor, correlationId: run.workflow.correlationId, payload: { runId: run.id, validation: validation.record, stopReason } }));
      return { status: "stopped", qagentRun: clone(run) };
    });
  }

  async completeEvidence(runId, { tenantId, workspaceId, actor, collected, validation, evaluation, idempotencyKey }) {
    return this.store.mutate((state, events) => {
      ensureQAgentState(state);
      const run = state.qagentRuns[runId];
      assertScope(run, { tenantId, workspaceId });
      const usage = collected.usage;
      const nextUsage = {
        ...run.budget.consumed,
        tokens: run.budget.consumed.tokens + usage.tokens,
        modelCalls: run.budget.consumed.modelCalls + usage.modelCalls,
        toolCalls: Math.max(run.budget.consumed.toolCalls, usage.toolCalls),
        elapsedMs: Date.now() - new Date(run.createdAt).getTime(),
        monetaryCostUsd: run.budget.consumed.monetaryCostUsd + usage.monetaryCostUsd,
        computeUnits: run.budget.consumed.computeUnits + usage.computeUnits,
        evidenceBytes: validation.evidence.reduce((sum, item) => sum + item.bytes, 0)
      };
      run.budget.consumed = nextUsage;
      run.deterministicValidation = validation.record;
      run.evidence = validation.evidence.map((item) => ({ contentDigest: textDigest(item.content), contentBytes: item.bytes, excerpt: redactText(item.content), provenance: { ...item.provenance, authorizationId: redactText(item.provenance.authorizationId, 120) }, accepted: true }));
      run.independentEvaluation = clone(evaluation);
      run.decisionImpact = {
        status: evaluation.status === "accepted" ? "provisional_branch_evaluation_changed" : "no_decision_effect",
        attributionMethod: "independent_evaluator/v1; association_only",
        provisionalFitnessChanges: evaluation.provisionalFitnessChanges,
        provisionalRanking: evaluation.provisionalRanking,
        constraintStates: evaluation.constraintStates,
        finalLifecycleAuthority: "deterministic_evaluation_then_policy_and_human_approval_required"
      };
      const exceeded = budgetExceeded(nextUsage, run.limits);
      run.status = exceeded || evaluation.status === "no_decision_effect" ? "stopped" : "completed";
      run.stopReason = exceeded ? "budget_exhausted" : evaluation.status === "no_decision_effect" ? "no_decision_effect" : "sufficient_evidence";
      run.updatedAt = now(); run.revision += 1;
      const effectId = `${run.id}:collect:${idempotencyKey}`;
      const effect = state.qagentEffects[effectId];
      if (!effect || effect.status !== "pending") throw new DecisionContinuityError("QAgent effect claim is unavailable for completion.", { code: "qagent_effect_not_found", status: 409 });
      effect.status = "completed"; effect.outcome = { accepted: true, evaluationStatus: evaluation.status, stopReason: run.stopReason }; effect.completedAt = now(); effect.revision += 1;
      appendBranchImpact(state, run, evaluation, run.evidence, events, actor);
      events.push(event({ tenantId, workspaceId: run.workspaceId, type: "qagent.evidence.evaluated", actor, correlationId: run.workflow.correlationId, payload: { runId: run.id, deterministicValidation: validation.record, independentEvaluation: { evaluatorId: evaluation.evaluatorId, evaluatorVersion: evaluation.evaluatorVersion, status: evaluation.status }, decisionImpact: run.decisionImpact, nextGovernedState: "decision_continuity_evaluation_required" } }));
      return { status: run.status, qagentRun: clone(run) };
    });
  }

  async stop(runId, { tenantId, workspaceId, actor, stopReason, detail }) {
    if (!QAGENT_STOP_REASONS.includes(stopReason)) throw new DecisionContinuityError("QAgent stop reason is invalid.", { code: "invalid_qagent_stop_reason" });
    return this.store.mutate((state, events) => {
      ensureQAgentState(state);
      const run = state.qagentRuns[runId];
      assertScope(run, { tenantId, workspaceId });
      if (run.status === "duplicate") return { status: "duplicate", qagentRun: clone(run) };
      run.status = "stopped"; run.stopReason = stopReason; run.stopDetail = redactText(detail, 800); run.updatedAt = now(); run.revision += 1;
      events.push(event({ tenantId, workspaceId: run.workspaceId, type: "qagent.run.stopped", actor, correlationId: run.workflow.correlationId, payload: { runId: run.id, stopReason, detail: run.stopDetail } }));
      return { status: "stopped", qagentRun: clone(run) };
    });
  }

  async metrics({ tenantId, workspaceId } = {}) {
    const runs = await this.listRuns({ tenantId, workspaceId, limit: 250 });
    const evidence = runs.flatMap((run) => run.evidence || []);
    const accepted = runs.filter((run) => run.decisionImpact?.status === "provisional_branch_evaluation_changed");
    const cost = runs.reduce((sum, run) => sum + Number(run.budget?.consumed?.monetaryCostUsd || 0), 0);
    return {
      tenantId, workspaceId: workspaceId || null, runCount: runs.length, activeRunCount: runs.filter((run) => ACTIVE_RUN_STATES.has(run.status)).length,
      duplicateRunCount: runs.filter((run) => run.status === "duplicate").length, acceptedEvidenceCount: evidence.filter((item) => item.accepted).length,
      untrustedOrRejectedEvidenceCount: evidence.filter((item) => !item.accepted).length, provisionalDecisionImpactCount: accepted.length,
      noDecisionEffectCount: runs.filter((run) => run.stopReason === "no_decision_effect").length, totalCostUsd: cost,
      costPerProvisionalAcceptedImprovement: accepted.length ? cost / accepted.length : null,
      attribution: "operational counts only; no causal improvement claim"
    };
  }
}
