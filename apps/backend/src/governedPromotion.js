import crypto from "node:crypto";
import { z } from "zod";

export const GOVERNED_PROMOTION_TARGET = "self-improvement-runtime-policy";
export const GOVERNED_PROMOTION_SCHEMA_VERSION = "governed-promotion/v1";
const PLATFORM_SCOPE = Object.freeze({ tenantId: "platform", workspaceId: "self-improvement-runtime" });
const LOCK_ID = 712_810_047;

export class GovernedPromotionError extends Error {
  constructor(message, { code = "governed_promotion_failed", status = 409, details } = {}) {
    super(message);
    this.name = "GovernedPromotionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: canonicalize(value[key]) }), {});
  return value;
}

export function contentDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function scopeKey({ tenantId, workspaceId, targetKey = GOVERNED_PROMOTION_TARGET }) {
  if (!tenantId || !workspaceId || !targetKey) throw new GovernedPromotionError("A tenant, workspace, and target are required.", { code: "scope_required", status: 400 });
  return `${tenantId}:${workspaceId}:${targetKey}`;
}

function assertScope(scope = {}) {
  const tenantId = String(scope.tenantId || "").trim();
  const workspaceId = String(scope.workspaceId || "").trim();
  const targetKey = String(scope.targetKey || GOVERNED_PROMOTION_TARGET).trim();
  if (!tenantId || tenantId.length > 160 || !workspaceId || workspaceId.length > 160 || targetKey !== GOVERNED_PROMOTION_TARGET) {
    throw new GovernedPromotionError("This governed promotion target requires a valid tenant/workspace scope.", { code: "invalid_scope", status: 400 });
  }
  return { tenantId, workspaceId, targetKey };
}

function trustedHuman(actor = {}) {
  return actor?.type === "user" && actor?.id && !/(?:qagent|brainx)/i.test(String(actor.id));
}

function independentIdentity(value, label) {
  const idValue = String(value || "").trim();
  if (!idValue || /(?:qagent|brainx)/i.test(idValue)) throw new GovernedPromotionError(`${label} must be an independently identified non-autonomous evaluator.`, { code: "independent_identity_required", status: 403 });
  return idValue;
}

const RuntimePolicySchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["observe_only", "recommend", "sandbox"]),
  maxCallsPerCycle: z.number().int().min(0).max(10),
  maxTokensPerCycle: z.number().int().min(0).max(40_000),
  maxCostPerDay: z.number().min(0).max(10),
  minSignalCount: z.number().int().min(1).max(50),
  minConfidence: z.number().min(0.5).max(1),
  postPromotionWindowMs: z.number().int().min(60_000).max(86_400_000),
  autoRollback: z.literal(true),
  autoPromoteMaxRisk: z.literal("low"),
  eventCheckEnabled: z.boolean(),
  eventTriggerMinScore: z.number().min(0.5).max(1),
  eventWindowMs: z.number().int().min(60_000).max(86_400_000),
  eventMinRelatedSignals: z.number().int().min(1).max(100),
  eventTriggerCooldownMs: z.number().int().min(60_000).max(86_400_000),
  researchEnabled: z.literal(false),
  researchAllowNetwork: z.literal(false),
  toolBuildEnabled: z.literal(false),
  toolPlanAutoTrigger: z.literal(false)
}).strict();

const CandidateSchema = z.object({
  schemaVersion: z.literal("plutomix-self-improvement-runtime-policy/v1"),
  targetKey: z.literal(GOVERNED_PROMOTION_TARGET),
  policy: RuntimePolicySchema
}).strict();

const MetricSchema = z.object({
  quality: z.number().min(0).max(1),
  regressionRate: z.number().min(0).max(1),
  latencyMs: z.number().min(0),
  costUsd: z.number().min(0),
  correctionRate: z.number().min(0).max(1),
  reliability: z.number().min(0).max(1),
  securityFindings: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
  sampleCount: z.number().int().min(1)
}).strict();

const EvaluationSchema = z.object({
  metrics: MetricSchema,
  uncertainty: z.number().min(0).max(1),
  conflictOfInterest: z.literal("none"),
  outputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  notes: z.string().max(2_000).default("")
}).strict();

const PolicySchema = z.object({
  schemaVersion: z.literal("governed-promotion-policy/v1"),
  policyVersion: z.string().min(3).max(120),
  allowPromotion: z.literal(true),
  approvalTtlMs: z.number().int().min(60_000).max(86_400_000),
  requiredApprovals: z.number().int().min(1).max(5),
  thresholds: z.object({
    maxQualityDrop: z.number().min(0).max(0.2),
    maxRegressionRate: z.number().min(0).max(1),
    maxLatencyMultiplier: z.number().min(1).max(2),
    maxCostMultiplier: z.number().min(1).max(2),
    maxCorrectionRate: z.number().min(0).max(1),
    minReliability: z.number().min(0).max(1),
    maxSecurityFindings: z.number().int().min(0),
    minConfidence: z.number().min(0).max(1),
    minSampleCount: z.number().int().min(1)
  }).strict(),
  canary: z.object({
    populationPercent: z.number().int().min(1).max(10),
    maxWorkItems: z.number().int().min(1).max(1_000),
    maxDurationMs: z.number().int().min(60_000).max(3_600_000),
    observationWindowMs: z.number().int().min(60_000).max(3_600_000),
    stopOnSecurityFinding: z.literal(true),
    maxFailures: z.number().int().min(0).max(20),
    maxRegressionRate: z.number().min(0).max(1),
    maxLatencyMultiplier: z.number().min(1).max(2),
    maxCostMultiplier: z.number().min(1).max(2),
    minReliability: z.number().min(0).max(1),
    minConfidence: z.number().min(0).max(1)
  }).strict()
}).strict();

function unsafePaths(value, path = "$") {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const next = `${path}.${key}`;
    const normalized = String(key).replace(/[_-]/g, "").toLowerCase();
    const unsafe = new Set(["secret", "password", "credential", "privatekey", "authorization", "apitoken", "accesstoken", "bearertoken", "clientsecret"]).has(normalized) ? [next] : [];
    return [...unsafe, ...unsafePaths(child, next)];
  });
}

export function validateSelfImprovementCandidate(candidate) {
  const checks = [];
  const parsed = CandidateSchema.safeParse(candidate);
  checks.push({ id: "schema", deterministic: true, status: parsed.success ? "passed" : "failed", version: "candidate-schema/v1", detail: parsed.success ? "Candidate schema is exact." : parsed.error.issues.map((issue) => issue.message).join(" ") });
  const digest = contentDigest(candidate);
  checks.push({ id: "integrity", deterministic: true, status: /^[a-f0-9]{64}$/.test(digest) ? "passed" : "failed", version: "canonical-sha256/v1", detail: digest });
  const forbidden = unsafePaths(candidate);
  checks.push({ id: "forbidden-secrets", deterministic: true, status: forbidden.length ? "failed" : "passed", version: "forbidden-paths/v1", detail: forbidden.length ? forbidden.join(", ") : "No secret-bearing fields are permitted." });
  const safe = parsed.success && parsed.data.policy.mode !== "advanced_auto" && parsed.data.policy.autoRollback === true && parsed.data.policy.researchAllowNetwork === false && parsed.data.policy.toolBuildEnabled === false;
  checks.push({ id: "safety-invariants", deterministic: true, status: safe ? "passed" : "failed", version: "runtime-safety/v1", detail: safe ? "No autonomous promotion, network research, or tool build capability is introduced." : "Candidate expands a forbidden runtime capability." });
  return { schemaVersion: "governed-validator/v1", candidateDigest: digest, status: checks.every((check) => check.status === "passed") ? "passed" : "failed", checks };
}

function defaultRuntimeCandidate(config = {}) {
  return {
    schemaVersion: "plutomix-self-improvement-runtime-policy/v1",
    targetKey: GOVERNED_PROMOTION_TARGET,
    policy: {
      enabled: Boolean(config.enabled),
      mode: ["observe_only", "recommend", "sandbox"].includes(config.mode) ? config.mode : "sandbox",
      maxCallsPerCycle: Math.min(10, Math.max(0, Number(config.maxCallsPerCycle ?? 2))),
      maxTokensPerCycle: Math.min(40_000, Math.max(0, Number(config.maxTokensPerCycle ?? 12_000))),
      maxCostPerDay: Math.min(10, Math.max(0, Number(config.maxCostPerDay ?? 1))),
      minSignalCount: Math.min(50, Math.max(1, Number(config.minSignalCount ?? 3))),
      minConfidence: Math.min(1, Math.max(0.5, Number(config.minConfidence ?? 0.65))),
      postPromotionWindowMs: Math.min(86_400_000, Math.max(60_000, Number(config.postPromotionWindowMs ?? 1_800_000))),
      autoRollback: true,
      autoPromoteMaxRisk: "low",
      eventCheckEnabled: Boolean(config.eventCheckEnabled ?? true),
      eventTriggerMinScore: Math.min(1, Math.max(0.5, Number(config.eventTriggerMinScore ?? 0.78))),
      eventWindowMs: Math.min(86_400_000, Math.max(60_000, Number(config.eventWindowMs ?? 600_000))),
      eventMinRelatedSignals: Math.min(100, Math.max(1, Number(config.eventMinRelatedSignals ?? 3))),
      eventTriggerCooldownMs: Math.min(86_400_000, Math.max(60_000, Number(config.eventTriggerCooldownMs ?? 900_000))),
      researchEnabled: false,
      researchAllowNetwork: false,
      toolBuildEnabled: false,
      toolPlanAutoTrigger: false
    }
  };
}

function defaultPromotionPolicy() {
  return {
    schemaVersion: "governed-promotion-policy/v1", policyVersion: "self-improvement-runtime-policy/2026-08-10", allowPromotion: true,
    approvalTtlMs: 30 * 60 * 1000, requiredApprovals: 1,
    thresholds: { maxQualityDrop: 0.02, maxRegressionRate: 0.02, maxLatencyMultiplier: 1.1, maxCostMultiplier: 1.1, maxCorrectionRate: 0.05, minReliability: 0.98, maxSecurityFindings: 0, minConfidence: 0.8, minSampleCount: 20 },
    canary: { populationPercent: 5, maxWorkItems: 100, maxDurationMs: 30 * 60 * 1000, observationWindowMs: 5 * 60 * 1000, stopOnSecurityFinding: true, maxFailures: 0, maxRegressionRate: 0.03, maxLatencyMultiplier: 1.15, maxCostMultiplier: 1.15, minReliability: 0.98, minConfidence: 0.8 }
  };
}

function evaluatePolicy(policy, baseline, evaluation) {
  const p = PolicySchema.parse(policy);
  const m = MetricSchema.parse(evaluation.metrics);
  const b = MetricSchema.parse(baseline);
  const t = p.thresholds;
  const reasons = [];
  if (m.quality < b.quality - t.maxQualityDrop) reasons.push("quality_regression");
  if (m.regressionRate > t.maxRegressionRate) reasons.push("regression_rate_exceeded");
  if (m.latencyMs > b.latencyMs * t.maxLatencyMultiplier) reasons.push("latency_regression");
  if (m.costUsd > b.costUsd * t.maxCostMultiplier) reasons.push("cost_regression");
  if (m.correctionRate > t.maxCorrectionRate) reasons.push("correction_rate_exceeded");
  if (m.reliability < t.minReliability) reasons.push("reliability_below_threshold");
  if (m.securityFindings > t.maxSecurityFindings) reasons.push("security_findings_exceeded");
  if (m.confidence < t.minConfidence || evaluation.uncertainty > 1 - t.minConfidence) reasons.push("confidence_or_uncertainty_insufficient");
  if (m.sampleCount < t.minSampleCount) reasons.push("sample_count_insufficient");
  return { policy: p, permitted: reasons.length === 0, reasons };
}

function failureReasons(policy, baseline, metrics) {
  const c = policy.canary;
  const reasons = [];
  if (c.stopOnSecurityFinding && metrics.securityFindings > 0) reasons.push("security_finding");
  if (metrics.failures > c.maxFailures) reasons.push("failure_threshold");
  if (metrics.regressionRate > c.maxRegressionRate) reasons.push("regression_threshold");
  if (metrics.latencyMs > baseline.latencyMs * c.maxLatencyMultiplier) reasons.push("latency_threshold");
  if (metrics.costUsd > baseline.costUsd * c.maxCostMultiplier) reasons.push("cost_threshold");
  if (metrics.reliability < c.minReliability) reasons.push("reliability_threshold");
  if (metrics.confidence < c.minConfidence) reasons.push("confidence_threshold");
  return reasons;
}

function enabled(env = process.env) {
  return String(env.GOVERNED_PROMOTIONS_ENABLED || "").toLowerCase() === "true" && String(env.GOVERNED_PROMOTION_SELF_IMPROVEMENT_ENABLED || "").toLowerCase() === "true";
}

export class GovernedSelfImprovementRuntimeAdapter {
  constructor({ env = process.env, platformScope = PLATFORM_SCOPE } = {}) {
    this.env = env;
    this.platformScope = platformScope;
    this.selectors = new Map();
    this.artifacts = new Map();
  }

  isEnabled() { return enabled(this.env); }
  supports(scope) { return scope.tenantId === this.platformScope.tenantId && scope.workspaceId === this.platformScope.workspaceId; }
  setArtifact(digest, artifact) { this.artifacts.set(digest, clone(artifact)); }
  setSelector(scope, selector) {
    if (!this.supports(scope)) return;
    this.selectors.set(scopeKey(scope), clone(selector));
  }
  clearSelector(scope) { this.selectors.delete(scopeKey(scope)); }
  resolve({ tenantId = PLATFORM_SCOPE.tenantId, workspaceId = PLATFORM_SCOPE.workspaceId, workItemKey = "" } = {}) {
    const scope = { tenantId, workspaceId, targetKey: GOVERNED_PROMOTION_TARGET };
    if (!this.isEnabled() || !this.supports(scope)) return { source: "environment", policy: null, halted: false };
    const selector = this.selectors.get(scopeKey(scope));
    if (!selector || selector.halted) return { source: selector?.halted ? "halted" : "environment", policy: null, halted: Boolean(selector?.halted), selector: selector || null };
    let digest = selector.activeDigest || "";
    if (selector.canaryDigest && workItemKey && selector.canary?.populationPercent > 0) {
      const bucket = Number.parseInt(crypto.createHash("sha256").update(String(workItemKey)).digest("hex").slice(0, 8), 16) % 100;
      if (bucket < selector.canary.populationPercent) digest = selector.canaryDigest;
    }
    const artifact = this.artifacts.get(digest);
    return artifact ? { source: digest === selector.canaryDigest ? "canary" : "active", policy: clone(artifact.policy), digest, selector: clone(selector), halted: false } : { source: "environment", policy: null, halted: false, selector: clone(selector) };
  }
}

export const governedSelfImprovementRuntime = new GovernedSelfImprovementRuntimeAdapter();

export function resolveGovernedSelfImprovementRuntimePolicy(scope = {}) {
  return governedSelfImprovementRuntime.resolve(scope);
}

export class MemoryGovernedPromotionStore {
  constructor() {
    this.artifacts = new Map(); this.requests = new Map(); this.events = []; this.selectors = new Map(); this.effects = new Map(); this.switches = new Map();
  }
  async transaction(work) { return work(this); }
  artifactKey(scope, digest) { return `${scopeKey(scope)}:${digest}`; }
  async putArtifact(scope, artifact) { const key = this.artifactKey(scope, artifact.digest); const current = this.artifacts.get(key); if (current && contentDigest(current.content) !== artifact.digest) throw new GovernedPromotionError("Artifact digest collision.", { code: "artifact_integrity_failed" }); this.artifacts.set(key, clone(artifact)); return clone(this.artifacts.get(key)); }
  async getArtifact(scope, digest) { const artifact = this.artifacts.get(this.artifactKey(scope, digest)); if (!artifact) throw new GovernedPromotionError("Artifact is unavailable in this scope.", { code: "artifact_not_found", status: 404 }); return clone(artifact); }
  async createRequest(request) { if (this.requests.has(request.requestId)) throw new GovernedPromotionError("Request already exists.", { code: "request_exists" }); this.requests.set(request.requestId, clone(request)); return clone(request); }
  async getRequest(scope, requestId) { const request = this.requests.get(requestId); if (!request || request.tenantId !== scope.tenantId || request.workspaceId !== scope.workspaceId || request.targetKey !== scope.targetKey) throw new GovernedPromotionError("Promotion request is unavailable in this scope.", { code: "request_not_found", status: 404 }); return clone(request); }
  async saveRequest(request) { this.requests.set(request.requestId, clone(request)); return clone(request); }
  async listRequests(scope, limit = 50) { return [...this.requests.values()].filter((request) => request.tenantId === scope.tenantId && request.workspaceId === scope.workspaceId && request.targetKey === scope.targetKey).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit).map(clone); }
  async appendEvent(event) { this.events.push(clone(event)); return clone(event); }
  async listEvents(scope, requestId) { return this.events.filter((event) => event.tenantId === scope.tenantId && event.workspaceId === scope.workspaceId && event.targetKey === scope.targetKey && (!requestId || event.requestId === requestId)).map(clone); }
  async getSelector(scope) { return clone(this.selectors.get(scopeKey(scope)) || { ...scope, activeDigest: "", previousDigest: "", canaryDigest: "", selector: {}, revision: 0, halted: false }); }
  async saveSelector(scope, selector) { this.selectors.set(scopeKey(scope), clone(selector)); return clone(selector); }
  effectKey(scope, requestId, effectType, idempotencyKey) { return `${scopeKey(scope)}:${requestId}:${effectType}:${idempotencyKey}`; }
  async claimEffect(scope, requestId, effectType, idempotencyKey) { const key = this.effectKey(scope, requestId, effectType, idempotencyKey); const current = this.effects.get(key); if (current) return { effect: clone(current), claimed: false }; const effect = { tenantId: scope.tenantId, workspaceId: scope.workspaceId, requestId, effectType, idempotencyKey, status: "pending", outcome: {}, createdAt: now() }; this.effects.set(key, effect); return { effect: clone(effect), claimed: true }; }
  async completeEffect(scope, requestId, effectType, idempotencyKey, outcome) { const key = this.effectKey(scope, requestId, effectType, idempotencyKey); const effect = this.effects.get(key); if (!effect) throw new GovernedPromotionError("Effect claim is unavailable.", { code: "effect_not_found" }); effect.status = "completed"; effect.outcome = clone(outcome); effect.completedAt = now(); return clone(effect); }
  async getKillSwitch(scope) { return clone(this.switches.get(scopeKey(scope)) || { ...scope, halted: false, reason: "", revision: 0 }); }
  async saveKillSwitch(scope, value) { this.switches.set(scopeKey(scope), clone(value)); return clone(value); }
}

export class PostgresGovernedPromotionStore {
  constructor({ databaseUrl = process.env.DECISION_CONTINUITY_DATABASE_URL || process.env.DATABASE_URL } = {}) { this.databaseUrl = databaseUrl; this.pool = null; }
  async database() {
    if (!this.databaseUrl) throw new GovernedPromotionError("The governed promotion authority is unavailable.", { code: "authoritative_store_unavailable", status: 503 });
    if (!this.pool) { const { default: pg } = await import("pg"); this.pool = new pg.Pool({ connectionString: this.databaseUrl, max: 6, idleTimeoutMillis: 10_000 }); }
    return this.pool;
  }
  async transaction(work) { const pool = await this.database(); const client = await pool.connect(); try { await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_ID]); const tx = new PostgresGovernedPromotionStore({ databaseUrl: this.databaseUrl }); tx.pool = { query: (...args) => client.query(...args) }; const result = await work(tx); await client.query("COMMIT"); return result; } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); } }
  async query(sql, params = []) { const pool = await this.database(); return pool.query(sql, params); }
  async putArtifact(scope, artifact) { const existing = await this.query("SELECT content FROM governed_promotion_artifacts WHERE tenant_id=$1 AND workspace_id=$2 AND target_key=$3 AND artifact_digest=$4", [scope.tenantId, scope.workspaceId, scope.targetKey, artifact.digest]); if (existing.rowCount && contentDigest(existing.rows[0].content) !== artifact.digest) throw new GovernedPromotionError("Artifact digest collision.", { code: "artifact_integrity_failed" }); if (!existing.rowCount) await this.query("INSERT INTO governed_promotion_artifacts (tenant_id,workspace_id,target_key,artifact_digest,artifact_kind,schema_version,content,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)", [scope.tenantId, scope.workspaceId, scope.targetKey, artifact.digest, artifact.kind, artifact.schemaVersion, JSON.stringify(artifact.content), artifact.createdBy]); return clone(artifact); }
  async getArtifact(scope, digest) { const result = await this.query("SELECT artifact_digest,artifact_kind,schema_version,content,created_by,created_at FROM governed_promotion_artifacts WHERE tenant_id=$1 AND workspace_id=$2 AND target_key=$3 AND artifact_digest=$4", [scope.tenantId, scope.workspaceId, scope.targetKey, digest]); if (!result.rowCount) throw new GovernedPromotionError("Artifact is unavailable in this scope.", { code: "artifact_not_found", status: 404 }); const row = result.rows[0]; return { digest: row.artifact_digest, kind: row.artifact_kind, schemaVersion: row.schema_version, content: row.content, createdBy: row.created_by, createdAt: row.created_at }; }
  async createRequest(request) { await this.query("INSERT INTO governed_promotion_requests (request_id,tenant_id,workspace_id,target_key,status,revision,record) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)", [request.requestId, request.tenantId, request.workspaceId, request.targetKey, request.status, request.revision, JSON.stringify(request)]); return clone(request); }
  async getRequest(scope, requestId) { const result = await this.query("SELECT record FROM governed_promotion_requests WHERE request_id=$1 AND tenant_id=$2 AND workspace_id=$3 AND target_key=$4", [requestId, scope.tenantId, scope.workspaceId, scope.targetKey]); if (!result.rowCount) throw new GovernedPromotionError("Promotion request is unavailable in this scope.", { code: "request_not_found", status: 404 }); return result.rows[0].record; }
  async saveRequest(request) { await this.query("UPDATE governed_promotion_requests SET status=$5,revision=$6,record=$7::jsonb,updated_at=clock_timestamp() WHERE request_id=$1 AND tenant_id=$2 AND workspace_id=$3 AND target_key=$4", [request.requestId, request.tenantId, request.workspaceId, request.targetKey, request.status, request.revision, JSON.stringify(request)]); return clone(request); }
  async listRequests(scope, limit = 50) { const result = await this.query("SELECT record FROM governed_promotion_requests WHERE tenant_id=$1 AND workspace_id=$2 AND target_key=$3 ORDER BY updated_at DESC LIMIT $4", [scope.tenantId, scope.workspaceId, scope.targetKey, limit]); return result.rows.map((row) => row.record); }
  async appendEvent(event) { await this.query("INSERT INTO governed_promotion_events (event_id,request_id,tenant_id,workspace_id,target_key,event_type,actor,payload,previous_hash,event_hash,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)", [event.eventId, event.requestId, event.tenantId, event.workspaceId, event.targetKey, event.type, JSON.stringify(event.actor), JSON.stringify(event.payload), event.previousHash, event.eventHash, event.occurredAt]); return clone(event); }
  async listEvents(scope, requestId) { const result = await this.query("SELECT event_id,request_id,event_type,actor,payload,previous_hash,event_hash,occurred_at FROM governed_promotion_events WHERE tenant_id=$1 AND workspace_id=$2 AND target_key=$3 AND ($4::text IS NULL OR request_id=$4) ORDER BY occurred_at,event_id", [scope.tenantId, scope.workspaceId, scope.targetKey, requestId || null]); return result.rows.map((row) => ({ eventId: row.event_id, requestId: row.request_id, type: row.event_type, actor: row.actor, payload: row.payload, previousHash: row.previous_hash, eventHash: row.event_hash, occurredAt: row.occurred_at })); }
  async getSelector(scope) { const result = await this.query("SELECT active_digest,previous_digest,canary_digest,selector,revision FROM governed_promotion_runtime_selectors WHERE tenant_id=$1 AND workspace_id=$2 AND target_key=$3", [scope.tenantId, scope.workspaceId, scope.targetKey]); if (!result.rowCount) return { ...scope, activeDigest: "", previousDigest: "", canaryDigest: "", selector: {}, revision: 0, halted: false }; const row = result.rows[0]; return { ...scope, activeDigest: row.active_digest || "", previousDigest: row.previous_digest || "", canaryDigest: row.canary_digest || "", selector: row.selector || {}, revision: row.revision, halted: Boolean(row.selector?.halted) }; }
  async saveSelector(scope, selector) { await this.query("INSERT INTO governed_promotion_runtime_selectors (tenant_id,workspace_id,target_key,active_digest,previous_digest,canary_digest,selector,revision) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (tenant_id,workspace_id,target_key) DO UPDATE SET active_digest=EXCLUDED.active_digest,previous_digest=EXCLUDED.previous_digest,canary_digest=EXCLUDED.canary_digest,selector=EXCLUDED.selector,revision=EXCLUDED.revision,updated_at=clock_timestamp()", [scope.tenantId, scope.workspaceId, scope.targetKey, selector.activeDigest || null, selector.previousDigest || null, selector.canaryDigest || null, JSON.stringify(selector.selector || {}), selector.revision || 0]); return clone(selector); }
  async claimEffect(scope, requestId, effectType, idempotencyKey) { const inserted = await this.query("INSERT INTO governed_promotion_effects (tenant_id,workspace_id,request_id,effect_type,idempotency_key,status) VALUES ($1,$2,$3,$4,$5,'pending') ON CONFLICT DO NOTHING RETURNING *", [scope.tenantId, scope.workspaceId, requestId, effectType, idempotencyKey]); if (inserted.rowCount) return { effect: inserted.rows[0], claimed: true }; const existing = await this.query("SELECT * FROM governed_promotion_effects WHERE tenant_id=$1 AND workspace_id=$2 AND request_id=$3 AND effect_type=$4 AND idempotency_key=$5", [scope.tenantId, scope.workspaceId, requestId, effectType, idempotencyKey]); return { effect: existing.rows[0], claimed: false }; }
  async completeEffect(scope, requestId, effectType, idempotencyKey, outcome) { await this.query("UPDATE governed_promotion_effects SET status='completed',outcome=$6::jsonb,completed_at=clock_timestamp() WHERE tenant_id=$1 AND workspace_id=$2 AND request_id=$3 AND effect_type=$4 AND idempotency_key=$5", [scope.tenantId, scope.workspaceId, requestId, effectType, idempotencyKey, JSON.stringify(outcome)]); return { status: "completed", outcome: clone(outcome) }; }
  async getKillSwitch(scope) { const result = await this.query("SELECT halted,reason,updated_by,revision,updated_at FROM governed_promotion_kill_switches WHERE tenant_id=$1 AND workspace_id=$2 AND target_key=$3", [scope.tenantId, scope.workspaceId, scope.targetKey]); return result.rowCount ? { ...scope, halted: result.rows[0].halted, reason: result.rows[0].reason, updatedBy: result.rows[0].updated_by, revision: result.rows[0].revision, updatedAt: result.rows[0].updated_at } : { ...scope, halted: false, reason: "", revision: 0 }; }
  async saveKillSwitch(scope, value) { await this.query("INSERT INTO governed_promotion_kill_switches (tenant_id,workspace_id,target_key,halted,reason,updated_by,revision) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id,workspace_id,target_key) DO UPDATE SET halted=EXCLUDED.halted,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,revision=EXCLUDED.revision,updated_at=clock_timestamp()", [scope.tenantId, scope.workspaceId, scope.targetKey, value.halted, value.reason || "", value.updatedBy || "", value.revision || 0]); return clone(value); }
}

export class GovernedPromotionController {
  constructor({ store = new PostgresGovernedPromotionStore(), runtimeAdapter = governedSelfImprovementRuntime, baseConfig = () => ({}) } = {}) { this.store = store; this.runtimeAdapter = runtimeAdapter; this.baseConfig = baseConfig; }
  async artifact(scope, kind, content, actorId = "system") { const digest = contentDigest(content); return this.store.putArtifact(scope, { digest, kind, schemaVersion: content.schemaVersion || GOVERNED_PROMOTION_SCHEMA_VERSION, content: clone(content), createdBy: actorId, createdAt: now() }); }
  async event(store, request, type, actor, payload) { const events = await store.listEvents({ tenantId: request.tenantId, workspaceId: request.workspaceId, targetKey: request.targetKey }, request.requestId); const previousHash = events.at(-1)?.eventHash || null; const base = { requestId: request.requestId, tenantId: request.tenantId, workspaceId: request.workspaceId, targetKey: request.targetKey, type, actor: actor || { type: "system", id: "governed-promotion" }, payload, previousHash, occurredAt: now() }; return store.appendEvent({ ...base, eventId: id("gpe"), eventHash: contentDigest(base) }); }
  async createCandidate({ scope: rawScope, candidate, baseline, fixtureDataset, proposer } = {}) {
    const scope = assertScope(rawScope); const actorId = independentIdentity(proposer?.id, "Proposer"); const validator = validateSelfImprovementCandidate(candidate); const baselineMetrics = MetricSchema.parse(baseline); if (!fixtureDataset || !Array.isArray(fixtureDataset.cases) || !fixtureDataset.cases.length) throw new GovernedPromotionError("An immutable evaluator fixture dataset is required.", { code: "fixture_required", status: 400 });
    return this.store.transaction(async (store) => {
      const candidateArtifact = await this.artifact(scope, "candidate-runtime-policy", candidate, actorId); const baselineArtifact = await this.artifact(scope, "baseline-metrics", baselineMetrics, actorId); const fixtureArtifact = await this.artifact(scope, "evaluator-fixture", fixtureDataset, actorId); const validatorArtifact = await this.artifact(scope, "deterministic-validator-report", validator, "governed-validator");
      const request = { requestId: id("gpr"), ...scope, status: validator.status === "passed" ? "awaiting_evaluation" : "rejected", revision: 1, candidateDigest: candidateArtifact.digest, knownGoodDigest: (await this.artifact(scope, "known-good-runtime-policy", defaultRuntimeCandidate(this.baseConfig()), "runtime-baseline")).digest, baselineDigest: baselineArtifact.digest, fixtureDigest: fixtureArtifact.digest, validatorDigest: validatorArtifact.digest, proposerId: actorId, evaluator: null, policyDigest: "", approvals: [], canary: null, createdAt: now(), updatedAt: now() };
      await store.createRequest(request); await this.event(store, request, "candidate.created", proposer, { candidateDigest: request.candidateDigest, baselineDigest: request.baselineDigest, fixtureDigest: request.fixtureDigest, validatorDigest: request.validatorDigest, validationStatus: validator.status }); return request;
    });
  }
  async amendCandidate({ scope: rawScope, requestId, candidate, baseline, fixtureDataset, actor } = {}) { const scope = assertScope(rawScope); return this.store.transaction(async (store) => { const request = await store.getRequest(scope, requestId); if (request.proposerId !== actor?.id || !["awaiting_evaluation", "rejected", "awaiting_approval", "approved"].includes(request.status)) throw new GovernedPromotionError("Only the original proposer may amend a non-running candidate.", { code: "candidate_mutation_denied", status: 403 }); const validator = validateSelfImprovementCandidate(candidate); const candidateArtifact = await this.artifact(scope, "candidate-runtime-policy", candidate, actor.id); const baselineArtifact = await this.artifact(scope, "baseline-metrics", MetricSchema.parse(baseline), actor.id); const fixtureArtifact = await this.artifact(scope, "evaluator-fixture", fixtureDataset, actor.id); const validatorArtifact = await this.artifact(scope, "deterministic-validator-report", validator, "governed-validator"); Object.assign(request, { candidateDigest: candidateArtifact.digest, baselineDigest: baselineArtifact.digest, fixtureDigest: fixtureArtifact.digest, validatorDigest: validatorArtifact.digest, evaluator: null, policyDigest: "", approvals: [], canary: null, status: validator.status === "passed" ? "awaiting_evaluation" : "rejected", revision: request.revision + 1, updatedAt: now() }); await store.saveRequest(request); await this.event(store, request, "candidate.amended", actor, { candidateDigest: request.candidateDigest, approvalsInvalidated: true }); return request; }); }
  async recordEvaluation({ scope: rawScope, requestId, evaluator, reviewerId, evaluatorVersion, fixtureDigest, evaluation } = {}) { const scope = assertScope(rawScope); const evaluatorId = independentIdentity(evaluator?.id, "Evaluator"); const reviewId = independentIdentity(reviewerId, "Reviewer"); return this.store.transaction(async (store) => { const request = await store.getRequest(scope, requestId); if (request.status !== "awaiting_evaluation") throw new GovernedPromotionError("This request is not awaiting an independent evaluation.", { code: "invalid_lifecycle_state" }); if (new Set([request.proposerId, evaluatorId, reviewId]).size !== 3) throw new GovernedPromotionError("Producer, evaluator, and reviewer must be distinct identities.", { code: "separation_of_duties_denied", status: 403 }); if (fixtureDigest !== request.fixtureDigest) throw new GovernedPromotionError("Evaluation must use the request's immutable fixture digest.", { code: "fixture_digest_mismatch" }); const parsed = EvaluationSchema.parse(evaluation); const record = { schemaVersion: "independent-evaluation/v1", evaluatorId, reviewerId: reviewId, evaluatorVersion: String(evaluatorVersion || "").trim(), fixtureDigest, ...parsed, evaluatedAt: now() }; if (!record.evaluatorVersion) throw new GovernedPromotionError("Evaluator version is required.", { code: "evaluator_version_required", status: 400 }); const artifact = await this.artifact(scope, "independent-evaluation", record, evaluatorId); request.evaluator = { digest: artifact.digest, evaluatorId, reviewerId: reviewId, evaluatorVersion: record.evaluatorVersion }; request.status = "awaiting_policy"; request.revision += 1; request.updatedAt = now(); await store.saveRequest(request); await this.event(store, request, "evaluation.recorded", evaluator, { evaluatorDigest: artifact.digest, fixtureDigest, reviewerId: reviewId }); return request; }); }
  async evaluatePolicy({ scope: rawScope, requestId, policy = defaultPromotionPolicy(), actor } = {}) { const scope = assertScope(rawScope); independentIdentity(actor?.id, "Policy evaluator"); return this.store.transaction(async (store) => { const request = await store.getRequest(scope, requestId); if (request.status !== "awaiting_policy") throw new GovernedPromotionError("This request is not awaiting policy.", { code: "invalid_lifecycle_state" }); const baseline = (await store.getArtifact(scope, request.baselineDigest)).content; const evaluation = (await store.getArtifact(scope, request.evaluator.digest)).content; const decision = evaluatePolicy(policy, baseline, evaluation); const policyRecord = { schemaVersion: "governed-policy-decision/v1", policy: decision.policy, permitted: decision.permitted, reasons: decision.reasons, candidateDigest: request.candidateDigest, evaluatorDigest: request.evaluator.digest, decidedAt: now(), decidedBy: actor.id }; const artifact = await this.artifact(scope, "policy-decision", policyRecord, actor.id); request.policyDigest = artifact.digest; request.status = decision.permitted ? "awaiting_approval" : "rejected"; request.revision += 1; request.updatedAt = now(); await store.saveRequest(request); await this.event(store, request, "policy.evaluated", actor, { policyDigest: artifact.digest, permitted: decision.permitted, reasons: decision.reasons }); return request; }); }
  async approve({ scope: rawScope, requestId, actor, candidateDigest, policyDigest, note = "" } = {}) { const scope = assertScope(rawScope); if (!trustedHuman(actor)) throw new GovernedPromotionError("A human approver is required.", { code: "human_approval_required", status: 403 }); return this.store.transaction(async (store) => { const request = await store.getRequest(scope, requestId); if (request.status !== "awaiting_approval") throw new GovernedPromotionError("This request is not awaiting approval.", { code: "invalid_lifecycle_state" }); if (actor.id === request.proposerId || actor.id === request.evaluator?.evaluatorId || actor.id === request.evaluator?.reviewerId) throw new GovernedPromotionError("The proposer, evaluator, and reviewer cannot approve this candidate.", { code: "separation_of_duties_denied", status: 403 }); if (candidateDigest !== request.candidateDigest || policyDigest !== request.policyDigest) throw new GovernedPromotionError("Approval must bind the exact current candidate and policy digests.", { code: "approval_digest_mismatch" }); const policyRecord = (await store.getArtifact(scope, request.policyDigest)).content; const existing = request.approvals.find((approval) => approval.approverId === actor.id && approval.candidateDigest === candidateDigest && approval.policyDigest === policyDigest && new Date(approval.expiresAt) > new Date()); if (!existing) request.approvals.push({ approvalId: id("gpa"), approverId: actor.id, candidateDigest, policyDigest, note: String(note).slice(0, 1_000), approvedAt: now(), expiresAt: new Date(Date.now() + policyRecord.policy.approvalTtlMs).toISOString() }); const current = request.approvals.filter((approval) => approval.candidateDigest === request.candidateDigest && approval.policyDigest === request.policyDigest && new Date(approval.expiresAt) > new Date()); if (current.length >= policyRecord.policy.requiredApprovals) request.status = "approved"; request.revision += 1; request.updatedAt = now(); await store.saveRequest(request); await this.event(store, request, "approval.recorded", actor, { candidateDigest, policyDigest, approvalCount: current.length, quorum: policyRecord.policy.requiredApprovals, expiresAt: current.at(-1)?.expiresAt || "" }); return request; }); }
  async requireFreshApproval(store, scope, request) { const policyRecord = (await store.getArtifact(scope, request.policyDigest)).content; const valid = request.approvals.filter((approval) => approval.candidateDigest === request.candidateDigest && approval.policyDigest === request.policyDigest && new Date(approval.expiresAt) > new Date()); if (valid.length < policyRecord.policy.requiredApprovals) throw new GovernedPromotionError("A fresh human approval quorum for the exact digests is required.", { code: "approval_expired_or_missing" }); return policyRecord; }
  async effect(store, scope, request, type, key, execute) { const claimed = await store.claimEffect(scope, request.requestId, type, key); if (!claimed.claimed && claimed.effect.status === "completed") return { idempotent: true, outcome: claimed.effect.outcome }; const outcome = await execute(); await store.completeEffect(scope, request.requestId, type, key, outcome); return { idempotent: false, outcome }; }
  async startCanary({ scope: rawScope, requestId, actor, idempotencyKey } = {}) { const scope = assertScope(rawScope); if (!trustedHuman(actor)) throw new GovernedPromotionError("A human operator is required to start a canary.", { code: "human_operator_required", status: 403 }); return this.store.transaction(async (store) => { const request = await store.getRequest(scope, requestId); if (!["approved", "canary_running"].includes(request.status)) throw new GovernedPromotionError("An approved request is required before a canary starts.", { code: "approval_required" }); if (!this.runtimeAdapter.isEnabled() || !this.runtimeAdapter.supports(scope)) throw new GovernedPromotionError("The real runtime target is disabled or unconfigured; no production selector was changed.", { code: "runtime_target_disabled", status: 503 }); const kill = await store.getKillSwitch(scope); if (kill.halted) throw new GovernedPromotionError("The target kill switch is engaged.", { code: "target_halted", status: 409 }); const policyRecord = await this.requireFreshApproval(store, scope, request); const key = String(idempotencyKey || `canary:${request.requestId}:${request.candidateDigest}`); const candidate = (await store.getArtifact(scope, request.candidateDigest)).content; const result = await this.effect(store, scope, request, "start_canary", key, async () => { const selector = await store.getSelector(scope); const next = { ...selector, activeDigest: selector.activeDigest || request.knownGoodDigest, previousDigest: selector.activeDigest || request.knownGoodDigest, canaryDigest: request.candidateDigest, selector: { halted: false, canary: { requestId: request.requestId, candidateDigest: request.candidateDigest, populationPercent: policyRecord.policy.canary.populationPercent, maxWorkItems: policyRecord.policy.canary.maxWorkItems, startedAt: now() } }, revision: selector.revision + 1, halted: false }; await store.saveSelector(scope, next); this.runtimeAdapter.setArtifact(request.candidateDigest, candidate); const known = await store.getArtifact(scope, next.activeDigest); this.runtimeAdapter.setArtifact(next.activeDigest, known.content); this.runtimeAdapter.setSelector(scope, { ...next.selector, activeDigest: next.activeDigest, previousDigest: next.previousDigest, canaryDigest: next.canaryDigest, halted: false }); return { selectorRevision: next.revision, canaryDigest: next.canaryDigest }; }); if (request.status !== "canary_running") { request.status = "canary_running"; request.canary = { canaryId: id("gpc"), startedAt: now(), policyDigest: request.policyDigest, candidateDigest: request.candidateDigest, observations: [], workItems: 0 }; request.revision += 1; request.updatedAt = now(); await store.saveRequest(request); await this.event(store, request, "canary.started", actor, { canaryId: request.canary.canaryId, candidateDigest: request.candidateDigest, bounds: policyRecord.policy.canary, effect: result.outcome }); } return { request, ...result }; }); }
  async rollbackWithin(store, scope, request, actor, reason, key) { const knownGood = (await store.getArtifact(scope, request.knownGoodDigest)).content; const result = await this.effect(store, scope, request, "rollback", key, async () => { const selector = await store.getSelector(scope); const next = { ...selector, activeDigest: request.knownGoodDigest, previousDigest: selector.activeDigest || request.candidateDigest, canaryDigest: "", selector: { halted: Boolean(selector.selector?.halted), rollbackReason: reason, rolledBackRequestId: request.requestId }, revision: selector.revision + 1, halted: Boolean(selector.selector?.halted) }; await store.saveSelector(scope, next); this.runtimeAdapter.setArtifact(request.knownGoodDigest, knownGood); this.runtimeAdapter.setSelector(scope, { ...next.selector, activeDigest: next.activeDigest, previousDigest: next.previousDigest, canaryDigest: "", halted: next.halted }); return { activeDigest: next.activeDigest, previousDigest: next.previousDigest, selectorRevision: next.revision }; }); request.status = "rolled_back"; request.canary = { ...(request.canary || {}), completedAt: now(), outcome: "rolled_back", rollbackReason: reason }; request.revision += 1; request.updatedAt = now(); await store.saveRequest(request); await this.event(store, request, "rollback.executed", actor, { reason, effect: result.outcome }); return { request, ...result }; }
  async recordCanaryObservation({ scope: rawScope, requestId, actor, metrics, idempotencyKey } = {}) { const scope = assertScope(rawScope); independentIdentity(actor?.id, "Canary monitor"); return this.store.transaction(async (store) => { const request = await store.getRequest(scope, requestId); if (request.status !== "canary_running") throw new GovernedPromotionError("This request has no running canary.", { code: "invalid_lifecycle_state" }); const policyRecord = (await store.getArtifact(scope, request.policyDigest)).content; const baseline = (await store.getArtifact(scope, request.baselineDigest)).content; const observation = { ...MetricSchema.parse(metrics), failures: Number(metrics.failures || 0), observedAt: now() }; if (!Number.isInteger(observation.failures) || observation.failures < 0) throw new GovernedPromotionError("Canary failures must be a non-negative integer.", { code: "invalid_canary_metrics", status: 400 }); request.canary.observations.push(observation); request.canary.workItems += observation.sampleCount; const failures = failureReasons(policyRecord.policy, baseline, observation); if (failures.length) return this.rollbackWithin(store, scope, request, actor, failures.join(","), String(idempotencyKey || `rollback:${request.requestId}:${request.canary.workItems}`)); const elapsed = Date.now() - new Date(request.canary.startedAt).getTime(); const done = request.canary.workItems >= policyRecord.policy.canary.maxWorkItems || elapsed >= policyRecord.policy.canary.maxDurationMs; if (!done) { request.revision += 1; request.updatedAt = now(); await store.saveRequest(request); await this.event(store, request, "canary.observed", actor, { workItems: request.canary.workItems, observation }); return { request, status: "running" }; } const key = String(idempotencyKey || `promote:${request.requestId}:${request.candidateDigest}`); const candidate = (await store.getArtifact(scope, request.candidateDigest)).content; const effect = await this.effect(store, scope, request, "promote", key, async () => { const selector = await store.getSelector(scope); const next = { ...selector, activeDigest: request.candidateDigest, previousDigest: selector.activeDigest || request.knownGoodDigest, canaryDigest: "", selector: { halted: false, promotedRequestId: request.requestId, promotedAt: now() }, revision: selector.revision + 1, halted: false }; await store.saveSelector(scope, next); this.runtimeAdapter.setArtifact(request.candidateDigest, candidate); this.runtimeAdapter.setSelector(scope, { ...next.selector, activeDigest: next.activeDigest, previousDigest: next.previousDigest, canaryDigest: "", halted: false }); return { activeDigest: next.activeDigest, previousDigest: next.previousDigest, selectorRevision: next.revision }; }); request.status = "promoted"; request.canary = { ...request.canary, completedAt: now(), outcome: "promoted" }; request.revision += 1; request.updatedAt = now(); await store.saveRequest(request); await this.event(store, request, "promotion.completed", actor, { effect: effect.outcome, workItems: request.canary.workItems }); return { request, ...effect }; }); }
  async rollback({ scope: rawScope, requestId, actor, reason, idempotencyKey } = {}) { const scope = assertScope(rawScope); if (!trustedHuman(actor)) throw new GovernedPromotionError("A human operator is required to roll back.", { code: "human_operator_required", status: 403 }); return this.store.transaction(async (store) => this.rollbackWithin(store, scope, await store.getRequest(scope, requestId), actor, String(reason || "operator_requested"), String(idempotencyKey || `rollback:${requestId}:operator`))); }
  async setKillSwitch({ scope: rawScope, actor, halted, reason = "" } = {}) { const scope = assertScope(rawScope); if (!trustedHuman(actor)) throw new GovernedPromotionError("A human operator is required to operate the kill switch.", { code: "human_operator_required", status: 403 }); return this.store.transaction(async (store) => { const current = await store.getKillSwitch(scope); const next = { ...scope, halted: Boolean(halted), reason: String(reason).slice(0, 1_000), updatedBy: actor.id, revision: current.revision + 1, updatedAt: now() }; await store.saveKillSwitch(scope, next); const selector = await store.getSelector(scope); const updatedSelector = { ...selector, canaryDigest: halted ? "" : selector.canaryDigest, selector: { ...(selector.selector || {}), halted: Boolean(halted), haltReason: next.reason }, revision: selector.revision + 1, halted: Boolean(halted) }; await store.saveSelector(scope, updatedSelector); this.runtimeAdapter.setSelector(scope, { ...updatedSelector.selector, activeDigest: updatedSelector.activeDigest, previousDigest: updatedSelector.previousDigest, canaryDigest: updatedSelector.canaryDigest, halted: Boolean(halted) });
    if (halted) {
      const activeRequest = (await store.listRequests(scope, 250)).find((request) => ["canary_running", "promoted"].includes(request.status) && [updatedSelector.activeDigest, selector.canaryDigest].includes(request.candidateDigest));
      if (activeRequest) await this.rollbackWithin(store, scope, activeRequest, actor, `kill_switch:${next.reason || "operator"}`, `kill-switch:${next.revision}`);
    }
    return next; }); }
  async status({ scope: rawScope, requestId = "" } = {}) { const scope = assertScope(rawScope); const [selector, killSwitch, requests] = await Promise.all([this.store.getSelector(scope), this.store.getKillSwitch(scope), requestId ? this.store.getRequest(scope, requestId).then((item) => [item]) : this.store.listRequests(scope)]); return { scope, target: { key: GOVERNED_PROMOTION_TARGET, runtimePath: "readSelfImprovementConfig", productionEnabled: this.runtimeAdapter.isEnabled(), productionScope: PLATFORM_SCOPE }, currentDigest: selector.activeDigest || "", previousDigest: selector.previousDigest || "", canaryDigest: selector.canaryDigest || "", halted: Boolean(killSwitch.halted), haltReason: killSwitch.reason || "", requests, selector }; }
  async hydrateRuntime() { if (!this.runtimeAdapter.isEnabled()) return { hydrated: false, reason: "runtime_target_disabled" }; const scope = { ...PLATFORM_SCOPE, targetKey: GOVERNED_PROMOTION_TARGET }; const selector = await this.store.getSelector(scope); for (const digest of [selector.activeDigest, selector.previousDigest, selector.canaryDigest].filter(Boolean)) this.runtimeAdapter.setArtifact(digest, (await this.store.getArtifact(scope, digest)).content); this.runtimeAdapter.setSelector(scope, { ...(selector.selector || {}), activeDigest: selector.activeDigest, previousDigest: selector.previousDigest, canaryDigest: selector.canaryDigest, halted: Boolean(selector.selector?.halted) }); return { hydrated: true, selector }; }
}
