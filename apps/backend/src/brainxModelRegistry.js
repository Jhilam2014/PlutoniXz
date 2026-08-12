import crypto from "node:crypto";
import { z } from "zod";
import { DecisionContinuityError } from "./decisionContinuity.js";
import { DECISION_PERMISSIONS } from "./identityAccess.js";

/**
 * BrainX is a policy-first model registry and isolated execution boundary.
 * It deliberately records routing/evidence in Decision Continuity instead of
 * making a model provider, prompt, or cache an authority of its own.
 */
export const BRAINX_SCHEMA_VERSION = "brainx-model-registry/v1";
export const BRAINX_POLICY_VERSION = "brainx-routing-policy/v1";
export const BRAINX_ROLES = Object.freeze([
  "generation",
  "evidence_question_planning",
  "semantic_similarity",
  "classification_reranking",
  "independent_critique"
]);
export const BRAINX_FAILURE_CODES = Object.freeze([
  "brainx_feature_disabled", "no_eligible_model", "license_denied", "artifact_unpinned", "data_policy_denied",
  "egress_denied", "health_denied", "hardware_unavailable", "budget_exhausted", "latency_objective_denied",
  "circuit_open", "kill_switch_active", "execution_timeout", "execution_cancelled", "adapter_unavailable",
  "output_validation_failed", "independence_denied", "recovery_required"
]);

const SENSITIVITIES = ["public", "internal", "confidential", "restricted"];
const HEALTH = ["healthy", "degraded", "unhealthy", "disabled"];
const SAFE_HF_FORMATS = new Set(["safetensors", "onnx", "gguf", "tokenizer_json", "config_json"]);
const DEFAULT_LIMITS = Object.freeze({ maxConcurrency: 1, maxFallbacks: 1, maxRetries: 0, maxElapsedMs: 30_000, maxInputBytes: 32 * 1024, maxOutputBytes: 32 * 1024, maxCostUsd: 0.25, circuitFailureThreshold: 2 });
const ABSOLUTE_LIMITS = Object.freeze({ maxConcurrency: 4, maxFallbacks: 2, maxRetries: 1, maxElapsedMs: 120_000, maxInputBytes: 128 * 1024, maxOutputBytes: 64 * 1024, maxCostUsd: 2, circuitFailureThreshold: 5 });

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: canonicalize(value[key]) }), {});
  return value;
}
function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex"); }
function textDigest(value) { return crypto.createHash("sha256").update(String(value || "")).digest("hex"); }
function enabled(value) { return String(value || "").trim().toLowerCase() === "true"; }
function csv(value, fallback = []) { const values = String(value || "").split(",").map((item) => item.trim()).filter(Boolean); return values.length ? [...new Set(values)] : fallback; }
function bounded(raw, fallback, max, min = 0) { const value = Number(raw); return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback; }
function redact(value, max = 360) { return String(value || "").replace(/(?:api[_-]?key|authorization|bearer|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "<redacted>").slice(0, max); }
function sameScope(record, { tenantId, workspaceId }) {
  if (!record || record.tenantId !== tenantId || (workspaceId && record.workspaceId !== workspaceId)) throw new DecisionContinuityError("BrainX record is unavailable in this tenant scope.", { code: "not_found", status: 404 });
}
function event({ tenantId, workspaceId, type, actor, correlationId, payload }) {
  return { id: id("dce"), schemaVersion: BRAINX_SCHEMA_VERSION, type, occurredAt: now(), tenantId, workspaceId, actor: actor || { type: "service", id: "brainx" }, correlationId: correlationId || null, payload: clone(payload || {}) };
}
function ensureState(state) {
  state.brainxRegistrations ||= {}; state.brainxPolicies ||= {}; state.brainxRoutes ||= {}; state.brainxExecutions ||= {};
  state.brainxEffects ||= {}; state.brainxControls ||= {}; state.brainxCircuitBreakers ||= {};
}
function isBrainXIdentity(actor) { return actor?.type === "service" && /brainx/i.test(String(actor.id || "")); }

const ArtifactSchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  provenance: z.string().min(1).max(1000),
  formats: z.array(z.string().min(1).max(80)).min(1).max(16),
  verifiedAt: z.string().datetime(),
  trustRemoteCode: z.literal(false)
}).strict();

export const BrainXRegistrationSchema = z.object({
  registrationKey: z.string().min(3).max(160),
  registrationVersion: z.string().min(1).max(160),
  provider: z.string().min(1).max(120),
  modelId: z.string().min(1).max(240),
  immutableRevision: z.string().min(7).max(160),
  artifact: ArtifactSchema,
  adapter: z.object({ id: z.string().min(1).max(160), version: z.string().min(1).max(120), tokenizer: z.string().min(1).max(160), quantization: z.string().max(120).default("none"), executionMode: z.enum(["isolated_fixture", "isolated_local_worker", "isolated_remote_disabled"]) }).strict(),
  taskRoles: z.array(z.enum(BRAINX_ROLES)).min(1).max(BRAINX_ROLES.length),
  limits: z.object({ contextTokens: z.number().int().min(1).max(2_000_000), inputTokens: z.number().int().min(1).max(1_000_000), outputTokens: z.number().int().min(1).max(1_000_000) }).strict(),
  health: z.object({ status: z.enum(HEALTH), checkedAt: z.string().datetime(), source: z.string().min(1).max(160) }).strict(),
  licence: z.object({ spdx: z.string().min(1).max(160), commercialUse: z.enum(["allowed", "restricted", "denied", "unknown"]), attribution: z.string().max(1000), dataUsePolicy: z.string().min(1).max(1000) }).strict(),
  governance: z.object({ allowedDataSensitivity: z.array(z.enum(SENSITIVITIES)).min(1), approvedRegions: z.array(z.string().min(1).max(80)).min(1), approvedEgress: z.array(z.string().min(1).max(160)).min(1), tenantAllowlist: z.array(z.string().min(1).max(160)).min(1) }).strict(),
  resources: z.object({ hardware: z.array(z.string().min(1).max(120)).max(16).default([]), memoryMb: z.number().int().min(0).max(10_000_000), storageMb: z.number().int().min(0).max(10_000_000) }).strict(),
  pricing: z.object({ version: z.string().min(1).max(160), source: z.string().min(1).max(240), inputUsdPer1k: z.number().min(0).max(100), outputUsdPer1k: z.number().min(0).max(100) }).strict(),
  performance: z.object({ p95LatencyMs: z.number().int().min(1).max(600_000), throughputTokensPerSecond: z.number().min(0).max(1_000_000) }).strict(),
  evaluationEvidence: z.object({ version: z.string().min(1).max(160), measuredAt: z.string().datetime(), outcomeScore: z.number().min(0).max(1), sampleCount: z.number().int().min(0).max(10_000_000), provenance: z.string().min(1).max(1000) }).strict(),
  knownFailureModes: z.array(z.string().min(1).max(400)).max(32).default([]),
  enabled: z.boolean().default(true)
}).strict();

const PolicySchema = z.object({
  policyVersion: z.string().min(1).max(160),
  allowCommercialUse: z.boolean().default(true),
  maxCostUsdPerRoute: z.number().min(0).max(ABSOLUTE_LIMITS.maxCostUsd),
  maxLatencyMs: z.number().int().min(1).max(ABSOLUTE_LIMITS.maxElapsedMs),
  allowedSensitivity: z.array(z.enum(SENSITIVITIES)).min(1),
  allowedEgress: z.array(z.string().min(1).max(160)).min(1),
  approvedRegions: z.array(z.string().min(1).max(80)).min(1),
  requiredIndependence: z.boolean().default(true)
}).strict();

const RouteRequestSchema = z.object({
  taskRole: z.enum(BRAINX_ROLES),
  data: z.object({ sensitivity: z.enum(SENSITIVITIES), region: z.string().min(1).max(80), egress: z.string().min(1).max(160), commercialUse: z.boolean().default(true) }).strict(),
  objective: z.object({ maxLatencyMs: z.number().int().min(1).max(ABSOLUTE_LIMITS.maxElapsedMs), estimatedInputTokens: z.number().int().min(0).max(1_000_000), estimatedOutputTokens: z.number().int().min(0).max(1_000_000), maxCostUsd: z.number().min(0).max(ABSOLUTE_LIMITS.maxCostUsd) }).strict(),
  input: z.string().min(1).max(ABSOLUTE_LIMITS.maxInputBytes),
  workflow: z.object({ correlationId: z.string().min(1).max(160), requestId: z.string().max(160).optional() }).strict(),
  independentOfRouteId: z.string().max(160).optional()
}).strict();

export const BrainXModelOutputSchema = z.object({
  type: z.enum(["text", "classification", "embedding", "critique"]),
  content: z.string().min(1).max(ABSOLUTE_LIMITS.maxOutputBytes),
  confidence: z.number().min(0).max(1).nullable().default(null)
}).strict();

function assertRegistrationSafety(registration) {
  const provider = registration.provider.toLowerCase();
  if (/^(?:main|master|latest)$/i.test(registration.immutableRevision)) {
    throw new DecisionContinuityError("Model registrations require an immutable, non-moving revision.", { code: "artifact_unpinned", status: 409 });
  }
  if (provider.includes("huggingface")) {
    if (!/^[a-f0-9]{40,64}$/i.test(registration.immutableRevision) || /^(main|master)$/i.test(registration.immutableRevision)) throw new DecisionContinuityError("Hugging Face registrations require an immutable commit revision.", { code: "artifact_unpinned", status: 409 });
    if (registration.artifact.formats.some((format) => !SAFE_HF_FORMATS.has(format.toLowerCase()))) throw new DecisionContinuityError("Hugging Face registration contains an unsupported executable artifact format.", { code: "artifact_format_denied", status: 409 });
  }
  if (registration.artifact.trustRemoteCode !== false) throw new DecisionContinuityError("Remote model repository code is never trusted by BrainX.", { code: "trust_remote_code_denied", status: 409 });
}

export function resolveBrainXConfig(env = process.env) {
  const limits = {};
  for (const [key, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const envKey = `BRAINX_${key.replace(/[A-Z]/g, (part) => `_${part}`).toUpperCase()}`;
    limits[key] = bounded(env[envKey], fallback, ABSOLUTE_LIMITS[key], key === "maxConcurrency" || key === "circuitFailureThreshold" ? 1 : 0);
  }
  return { enabled: enabled(env.BRAINX_ENABLED), enabledTenants: new Set(csv(env.BRAINX_ENABLED_TENANTS)), hardware: new Set(csv(env.BRAINX_AVAILABLE_HARDWARE, ["fixture"])), limits, liveProviderEnabled: enabled(env.BRAINX_LIVE_PROVIDER_ENABLED), liveProviderMaxCostUsd: bounded(env.BRAINX_LIVE_PROVIDER_MAX_COST_USD, 0, ABSOLUTE_LIMITS.maxCostUsd) };
}

// This deliberately plans but never performs a live-provider evaluation. It
// makes any future opt-in test prove its pinned artifact and cost cap first.
export function planBrainXLiveProviderEvaluation({ registration, estimatedCostUsd = 0, env = process.env } = {}) {
  const config = resolveBrainXConfig(env);
  if (!config.liveProviderEnabled) return { status: "skipped", reason: "live_provider_opt_in_required" };
  if (!registration) throw new DecisionContinuityError("A pinned registration is required for a live-provider evaluation plan.", { code: "artifact_unpinned", status: 409 });
  assertRegistrationSafety(registration);
  if (Number(estimatedCostUsd) > config.liveProviderMaxCostUsd) throw new DecisionContinuityError("The live-provider evaluation exceeds its explicit cost cap.", { code: "budget_exhausted", status: 409 });
  return { status: "planned", mode: "live_provider_opt_in", provider: registration.provider, modelId: registration.modelId, immutableRevision: registration.immutableRevision, estimatedCostUsd: Number(estimatedCostUsd), maxCostUsd: config.liveProviderMaxCostUsd, execution: "not_implemented_by_this_registry" };
}

function registrationCost(registration, objective) {
  return Number((((Number(objective.estimatedInputTokens) / 1000) * registration.pricing.inputUsdPer1k) + ((Number(objective.estimatedOutputTokens) / 1000) * registration.pricing.outputUsdPer1k)).toFixed(6));
}
function controlKey({ tenantId, provider, registrationId, scope = "" }) { return scope || (registrationId ? `registration:${registrationId}` : provider ? `provider:${provider}` : tenantId ? `tenant:${tenantId}` : "global"); }
function controlDisabled(state, registration, tenantId) {
  const keys = [`global:${tenantId}`, `tenant:${tenantId}`, `provider:${registration.provider}`, `registration:${registration.id}`];
  return keys.map((key) => state.brainxControls[key]).find((item) => item?.enabled === false) || null;
}
function circuitOpen(state, tenantId, registrationId) {
  const breaker = state.brainxCircuitBreakers[`${tenantId}:${registrationId}`];
  return breaker?.status === "open" ? breaker : null;
}
function eligibility({ state, registration, request, tenantId, policy, independentRegistration, config }) {
  const reasons = [];
  const governed = registration.governance;
  if (!registration.enabled || registration.health.status !== "healthy") reasons.push(registration.health.status === "unhealthy" ? "health_denied" : "registration_disabled");
  if (controlDisabled(state, registration, tenantId)) reasons.push("kill_switch_active");
  if (!registration.taskRoles.includes(request.taskRole)) reasons.push("task_role_missing");
  if (!governed.tenantAllowlist.includes(tenantId)) reasons.push("tenant_not_allowed");
  if (!governed.allowedDataSensitivity.includes(request.data.sensitivity) || !policy.allowedSensitivity.includes(request.data.sensitivity)) reasons.push("data_policy_denied");
  if (!governed.approvedRegions.includes(request.data.region) || !policy.approvedRegions.includes(request.data.region)) reasons.push("region_denied");
  if (!governed.approvedEgress.includes(request.data.egress) || !policy.allowedEgress.includes(request.data.egress)) reasons.push("egress_denied");
  if (request.data.commercialUse && (!policy.allowCommercialUse || registration.licence.commercialUse !== "allowed")) reasons.push("license_denied");
  if (!registration.immutableRevision || !registration.artifact.checksum) reasons.push("artifact_unpinned");
  if (registration.adapter.executionMode === "isolated_remote_disabled") reasons.push("execution_disabled");
  if (registration.resources.hardware.length && !registration.resources.hardware.some((hardware) => config.hardware.has(hardware))) reasons.push("hardware_unavailable");
  if (registration.performance.p95LatencyMs > Math.min(policy.maxLatencyMs, request.objective.maxLatencyMs)) reasons.push("latency_objective_denied");
  const cost = registrationCost(registration, request.objective);
  if (cost > Math.min(policy.maxCostUsdPerRoute, request.objective.maxCostUsd)) reasons.push("budget_exhausted");
  if (circuitOpen(state, tenantId, registration.id)) reasons.push("circuit_open");
  if (request.taskRole === "independent_critique" && independentRegistration && policy.requiredIndependence && (independentRegistration.provider === registration.provider || independentRegistration.modelId === registration.modelId || independentRegistration.id === registration.id)) reasons.push("independence_denied");
  return { reasons, estimatedCostUsd: cost };
}

export class BrainXModelRegistry {
  constructor({ store, env = process.env, config = resolveBrainXConfig(env), adapter = null, identityAccess = null } = {}) {
    if (!store) throw new Error("BrainX requires the existing Decision Continuity store.");
    this.store = store; this.env = env; this.config = config; this.adapter = adapter; this.identityAccess = identityAccess;
  }

  isEnabledForTenant(tenantId) { return Boolean(this.config.enabled && this.config.enabledTenants.has(tenantId)); }

  async assertAuthority({ actor, tenantId, workspaceId, permission, principalTypes }) {
    if (!actor?.id || !actor.type) throw new DecisionContinuityError("A BrainX principal is required.", { code: "brainx_identity_required", status: 403 });
    if (!this.identityAccess) {
      if (String(this.env.NODE_ENV || "").toLowerCase() === "production") throw new DecisionContinuityError("BrainX identity authority is unavailable.", { code: "authorization_unavailable", status: 503 });
      return true;
    }
    await this.identityAccess.assertPrincipalPermission({ principalId: actor.id, tenantId, workspaceId, permission, principalTypes });
    return true;
  }

  async assertAdmin(context) { return this.assertAuthority({ ...context, permission: DECISION_PERMISSIONS.BRAINX_ADMIN, principalTypes: ["human"] }); }
  async assertExecution(context) {
    if (!isBrainXIdentity(context.actor)) throw new DecisionContinuityError("BrainX execution requires its distinct scoped service identity.", { code: "brainx_identity_required", status: 403 });
    return this.assertAuthority({ ...context, permission: DECISION_PERMISSIONS.BRAINX_EXECUTE, principalTypes: ["service"] });
  }

  async register(input, { tenantId, workspaceId = "default", actor } = {}) {
    await this.assertAdmin({ tenantId, workspaceId, actor });
    const parsed = BrainXRegistrationSchema.parse(input);
    assertRegistrationSafety(parsed);
    return this.store.mutate((state, events) => {
      ensureState(state);
      const registrationFingerprint = digest(parsed);
      const existing = Object.values(state.brainxRegistrations).find((record) => record.tenantId === tenantId && record.workspaceId === workspaceId && record.registrationKey === parsed.registrationKey && record.registrationVersion === parsed.registrationVersion);
      if (existing && existing.registrationFingerprint !== registrationFingerprint) {
        throw new DecisionContinuityError("Registration versions are immutable; register a new version for a changed provider, revision, artifact, or policy record.", { code: "registration_version_immutable", status: 409 });
      }
      if (existing) return { status: "idempotent", registration: clone(existing) };
      const record = { id: id("brainx_reg"), schemaVersion: BRAINX_SCHEMA_VERSION, tenantId, workspaceId, ...parsed, artifact: { ...parsed.artifact, checksum: parsed.artifact.checksum.toLowerCase() }, registrationFingerprint, status: parsed.enabled ? "registered" : "disabled", createdAt: now(), updatedAt: now(), revision: 1 };
      state.brainxRegistrations[record.id] = record;
      events.push(event({ tenantId, workspaceId, type: "brainx.registration.upserted", actor, payload: { registrationId: record.id, registrationKey: record.registrationKey, registrationVersion: record.registrationVersion, provider: record.provider, modelId: record.modelId, immutableRevision: record.immutableRevision, artifactChecksum: record.artifact.checksum, taskRoles: record.taskRoles, status: record.status } }));
      return { status: existing ? "updated" : "registered", registration: clone(record) };
    });
  }

  async setPolicy(input, { tenantId, workspaceId = "default", actor } = {}) {
    await this.assertAdmin({ tenantId, workspaceId, actor });
    const parsed = PolicySchema.parse(input);
    return this.store.mutate((state, events) => {
      ensureState(state);
      const key = `${tenantId}:${workspaceId}`; const previous = state.brainxPolicies[key] || Object.values(state.brainxPolicies).find((record) => record.tenantId === tenantId && record.workspaceId === workspaceId);
      const policy = { id: previous?.id || id("brainx_policy"), schemaVersion: BRAINX_SCHEMA_VERSION, tenantId, workspaceId, ...parsed, policyDigest: digest(parsed), createdAt: previous?.createdAt || now(), updatedAt: now(), revision: Number(previous?.revision || 0) + 1 };
      state.brainxPolicies[key] = policy;
      if (previous?.id && previous.id !== key) delete state.brainxPolicies[previous.id];
      events.push(event({ tenantId, workspaceId, type: "brainx.policy.updated", actor, payload: { policyId: policy.id, policyVersion: policy.policyVersion, policyDigest: policy.policyDigest } }));
      return clone(policy);
    });
  }

  async setControl(input, { tenantId, workspaceId = "default", actor } = {}) {
    await this.assertAdmin({ tenantId, workspaceId, actor });
    const parsed = z.object({ provider: z.string().max(120).optional(), registrationId: z.string().max(160).optional(), scope: z.enum(["global", "tenant", "provider", "registration"]).optional(), enabled: z.boolean(), reason: z.string().min(3).max(800), idempotencyKey: z.string().min(1).max(240) }).strict().parse(input);
    const scope = parsed.scope || (parsed.registrationId ? "registration" : parsed.provider ? "provider" : "tenant");
    if ((scope === "provider" && (!parsed.provider || parsed.registrationId)) || (scope === "registration" && (!parsed.registrationId || parsed.provider)) || (scope === "global" && (parsed.provider || parsed.registrationId)) || (scope === "tenant" && (parsed.provider || parsed.registrationId))) {
      throw new DecisionContinuityError("BrainX control scope and target do not match.", { code: "invalid_control_scope", status: 400 });
    }
    return this.store.mutate((state, events) => {
      ensureState(state);
      const key = controlKey({ tenantId, provider: parsed.provider, registrationId: parsed.registrationId, scope: scope === "global" ? `global:${tenantId}` : scope === "tenant" ? `tenant:${tenantId}` : "" });
      const existing = state.brainxControls[key];
      if (existing?.idempotencyKey === parsed.idempotencyKey) return { status: "idempotent", control: clone(existing) };
      const control = { id: key, schemaVersion: BRAINX_SCHEMA_VERSION, tenantId, workspaceId, scope, provider: parsed.provider || null, registrationId: parsed.registrationId || null, enabled: parsed.enabled, reason: redact(parsed.reason, 800), idempotencyKey: parsed.idempotencyKey, updatedBy: actor.id, createdAt: existing?.createdAt || now(), updatedAt: now(), revision: Number(existing?.revision || 0) + 1 };
      state.brainxControls[key] = control;
      events.push(event({ tenantId, workspaceId, type: "brainx.control.updated", actor, payload: { controlId: key, scope: control.scope, provider: control.provider, registrationId: control.registrationId, enabled: control.enabled, reason: control.reason } }));
      return { status: "updated", control: clone(control) };
    });
  }

  async setHealth({ registrationId, status, source = "operator", checkedAt = now() }, { tenantId, workspaceId = "default", actor } = {}) {
    await this.assertAdmin({ tenantId, workspaceId, actor });
    const parsed = z.object({ registrationId: z.string().min(1).max(160), status: z.enum(HEALTH), source: z.string().min(1).max(160), checkedAt: z.string().datetime() }).strict().parse({ registrationId, status, source, checkedAt });
    return this.store.mutate((state, events) => {
      ensureState(state); const registration = state.brainxRegistrations[parsed.registrationId]; sameScope(registration, { tenantId, workspaceId });
      registration.health = { status: parsed.status, source: parsed.source, checkedAt: parsed.checkedAt }; registration.status = parsed.status === "disabled" ? "disabled" : registration.enabled ? "registered" : "disabled"; registration.updatedAt = now(); registration.revision += 1;
      events.push(event({ tenantId, workspaceId, type: "brainx.registration.health_changed", actor, payload: { registrationId: registration.id, health: registration.health } }));
      return clone(registration);
    });
  }

  policyFor(state, tenantId, workspaceId) {
    const policy = state.brainxPolicies[`${tenantId}:${workspaceId}`]
      || Object.values(state.brainxPolicies).find((record) => record.tenantId === tenantId && record.workspaceId === workspaceId)
      || state.brainxPolicies[`${tenantId}:default`]
      || Object.values(state.brainxPolicies).find((record) => record.tenantId === tenantId && record.workspaceId === "default");
    if (!policy) throw new DecisionContinuityError("BrainX tenant policy is not provisioned.", { code: "brainx_policy_missing", status: 409 });
    return policy;
  }

  async route(input, { tenantId, workspaceId = "default", actor } = {}) {
    const request = RouteRequestSchema.parse(input);
    if (!this.isEnabledForTenant(tenantId)) return { status: "baseline", reason: "brainx_feature_disabled", route: null };
    await this.assertExecution({ tenantId, workspaceId, actor });
    return this.store.mutate((state, events) => {
      ensureState(state);
      const policy = this.policyFor(state, tenantId, workspaceId);
      const independentRoute = request.independentOfRouteId ? state.brainxRoutes[request.independentOfRouteId] : null;
      if (request.independentOfRouteId) sameScope(independentRoute, { tenantId, workspaceId });
      const independentRegistration = independentRoute?.selectedRegistrationId ? state.brainxRegistrations[independentRoute.selectedRegistrationId] : null;
      const candidates = []; const excluded = [];
      for (const registration of Object.values(state.brainxRegistrations)) {
        if (registration.tenantId !== tenantId || registration.workspaceId !== workspaceId) continue;
        const result = eligibility({ state, registration, request, tenantId, policy, independentRegistration, config: this.config });
        const candidate = { registrationId: registration.id, registrationKey: registration.registrationKey, registrationVersion: registration.registrationVersion, provider: registration.provider, modelId: registration.modelId, immutableRevision: registration.immutableRevision, adapterVersion: registration.adapter.version, evaluationEvidenceVersion: registration.evaluationEvidence.version, estimatedCostUsd: result.estimatedCostUsd };
        if (result.reasons.length) excluded.push({ ...candidate, reasonCodes: result.reasons });
        else candidates.push({ ...candidate, score: Number((registration.evaluationEvidence.outcomeScore * 100 - registration.performance.p95LatencyMs / 1000 - result.estimatedCostUsd * 5).toFixed(6)) });
      }
      candidates.sort((left, right) => right.score - left.score || left.registrationId.localeCompare(right.registrationId));
      const selected = candidates[0] || null;
      const route = { id: id("brainx_route"), schemaVersion: BRAINX_SCHEMA_VERSION, tenantId, workspaceId, taskRole: request.taskRole, input: { digest: textDigest(request.input), bytes: Buffer.byteLength(request.input, "utf8"), sensitivity: request.data.sensitivity }, dataPolicy: request.data, objective: request.objective, workflow: request.workflow, policy: { id: policy.id, version: policy.policyVersion, digest: policy.policyDigest }, independentOfRouteId: request.independentOfRouteId || null, eligibleCandidates: candidates.map(({ score, ...candidate }) => candidate), excludedCandidates: excluded, selectedRegistrationId: selected?.registrationId || null, fallbackRegistrationIds: candidates.slice(1).map((candidate) => candidate.registrationId), routingEvidenceAt: now(), status: selected ? "routed" : "failed", failureCode: selected ? null : "no_eligible_model", createdAt: now(), updatedAt: now(), revision: 1 };
      state.brainxRoutes[route.id] = route;
      events.push(event({ tenantId, workspaceId, type: selected ? "brainx.route.selected" : "brainx.route.denied", actor, correlationId: request.workflow.correlationId, payload: { routeId: route.id, taskRole: route.taskRole, policyVersion: policy.policyVersion, selectedRegistrationId: route.selectedRegistrationId, fallbackRegistrationIds: route.fallbackRegistrationIds, excludedCandidates: route.excludedCandidates.map((item) => ({ registrationId: item.registrationId, reasonCodes: item.reasonCodes })) } }));
      return { status: route.status, route: clone(route) };
    });
  }

  async claimExecution({ routeId, idempotencyKey, tenantId, workspaceId, actor }) {
    return this.store.mutate((state, events) => {
      ensureState(state); const route = state.brainxRoutes[routeId]; sameScope(route, { tenantId, workspaceId });
      const effectId = `${routeId}:execute:${idempotencyKey}`; const existing = state.brainxEffects[effectId];
      if (existing?.status === "completed") return { status: "completed", execution: clone(state.brainxExecutions[existing.executionId]), route: clone(route) };
      if (existing?.status === "pending") return { status: "recovery_required", route: clone(route) };
      if (route.status !== "routed" || !route.selectedRegistrationId) throw new DecisionContinuityError("BrainX cannot execute a route without an eligible selected registration.", { code: "no_eligible_model", status: 409 });
      const registration = state.brainxRegistrations[route.selectedRegistrationId]; const control = controlDisabled(state, registration, tenantId);
      if (control) throw new DecisionContinuityError("BrainX execution is stopped by an operator kill switch.", { code: "kill_switch_active", status: 409 });
      const active = Object.values(state.brainxExecutions).filter((item) => item.tenantId === tenantId && item.status === "running").length;
      if (active >= this.config.limits.maxConcurrency) throw new DecisionContinuityError("BrainX tenant concurrency quota is exhausted.", { code: "brainx_concurrency_exhausted", status: 429 });
      const execution = { id: id("brainx_exec"), schemaVersion: BRAINX_SCHEMA_VERSION, tenantId, workspaceId, routeId, registrationId: registration.id, attemptedRegistrationIds: [registration.id], status: "running", attempts: [], usage: { inputTokens: route.objective.estimatedInputTokens, outputTokens: 0, queueMs: 0, executionLatencyMs: 0, estimatedCostUsd: 0, pricingVersion: registration.pricing.version, pricingSource: registration.pricing.source, cacheUsed: false }, acceptedOutcome: null, correctionEvidence: null, createdAt: now(), updatedAt: now(), revision: 1 };
      const effect = { id: effectId, schemaVersion: BRAINX_SCHEMA_VERSION, tenantId, workspaceId, routeId, executionId: execution.id, idempotencyKey, status: "pending", createdAt: now(), revision: 1 };
      state.brainxExecutions[execution.id] = execution; state.brainxEffects[effect.id] = effect;
      events.push(event({ tenantId, workspaceId, type: "brainx.execution.claimed", actor, correlationId: route.workflow.correlationId, payload: { routeId, executionId: execution.id, registrationId: registration.id, effectId: effect.id } }));
      return { status: "claimed", route: clone(route), execution: clone(execution), registration: clone(registration), effect: clone(effect) };
    });
  }

  async execute({ routeId, input, idempotencyKey, cancellation = null }, { tenantId, workspaceId = "default", actor } = {}) {
    if (!this.isEnabledForTenant(tenantId)) return { status: "baseline", reason: "brainx_feature_disabled" };
    await this.assertExecution({ tenantId, workspaceId, actor });
    const payload = z.object({ routeId: z.string().min(1).max(160), input: z.string().min(1).max(ABSOLUTE_LIMITS.maxInputBytes), idempotencyKey: z.string().min(1).max(240) }).strict().parse({ routeId, input, idempotencyKey });
    const claim = await this.claimExecution({ ...payload, tenantId, workspaceId, actor });
    if (claim.status === "completed") return { status: "idempotent", execution: claim.execution };
    if (claim.status === "recovery_required") return this.recordFailure({ routeId, executionId: null, tenantId, workspaceId, actor, idempotencyKey, failureCode: "recovery_required", detail: "A prior billed execution is pending and cannot be replayed." });
    if (cancellation?.cancelled) return this.recordCancelled(payload.routeId, { executionId: claim.execution.id, tenantId, workspaceId, actor, idempotencyKey, reason: "cancelled_before_execution" });
    return this.executeClaim(claim, payload.input, { tenantId, workspaceId, actor, idempotencyKey, cancellation });
  }

  async invoke(registration, input, cancellation) {
    if (!this.adapter || registration.adapter.executionMode !== "isolated_fixture" || typeof this.adapter.execute !== "function") throw new DecisionContinuityError("No verified isolated adapter is registered for this model.", { code: "adapter_unavailable", status: 503 });
    const controller = new AbortController(); const started = Date.now();
    const timer = setTimeout(() => controller.abort(), this.config.limits.maxElapsedMs);
    try {
      if (cancellation?.cancelled) throw new DecisionContinuityError("BrainX execution was cancelled.", { code: "execution_cancelled", status: 499 });
      const result = await this.adapter.execute({ registration: clone(registration), input, signal: controller.signal, cancellation });
      if (controller.signal.aborted) throw new DecisionContinuityError("BrainX execution timed out.", { code: "execution_timeout", status: 504 });
      return { result: BrainXModelOutputSchema.parse(result), latencyMs: Date.now() - started };
    } catch (error) {
      if (controller.signal.aborted) throw new DecisionContinuityError("BrainX execution timed out.", { code: "execution_timeout", status: 504 });
      throw error;
    } finally { clearTimeout(timer); }
  }

  async executeClaim(claim, input, context) {
    let current = claim.registration; let lastError = null;
    let fallbackCount = 0;
    while (current) {
      let recoverable = false;
      for (let retry = 0; retry <= this.config.limits.maxRetries; retry += 1) {
        try {
          const invoked = await this.invoke(current, input, context.cancellation);
          return this.completeExecution({ claim, registration: current, output: invoked.result, latencyMs: invoked.latencyMs, ...context });
        } catch (error) {
          lastError = error;
          const failureCode = error.code || "adapter_unavailable";
          await this.recordAttempt({ executionId: claim.execution.id, registrationId: current.id, tenantId: context.tenantId, workspaceId: context.workspaceId, actor: context.actor, failureCode, detail: error.message });
          recoverable = ["execution_timeout", "adapter_unavailable", "provider_unhealthy", "transient"].includes(failureCode);
          if (!recoverable || retry >= this.config.limits.maxRetries) break;
        }
      }
      if (!recoverable || fallbackCount >= this.config.limits.maxFallbacks) break;
      const fallbackId = claim.route.fallbackRegistrationIds[fallbackCount];
      fallbackCount += 1;
      current = fallbackId ? await this.registration(fallbackId, context) : null;
    }
    return this.recordFailure({ routeId: claim.route.id, executionId: claim.execution.id, tenantId: context.tenantId, workspaceId: context.workspaceId, actor: context.actor, idempotencyKey: context.idempotencyKey, failureCode: lastError?.code || "adapter_unavailable", detail: lastError?.message || "No independently eligible fallback completed." });
  }

  async registration(registrationId, { tenantId, workspaceId }) { const state = await this.store.readState(); const registration = state.brainxRegistrations?.[registrationId]; sameScope(registration, { tenantId, workspaceId }); return clone(registration); }

  async recordAttempt({ executionId, registrationId, tenantId, workspaceId, actor, failureCode, detail }) {
    return this.store.mutate((state, events) => {
      ensureState(state); const execution = state.brainxExecutions[executionId]; sameScope(execution, { tenantId, workspaceId });
      execution.attemptedRegistrationIds = [...new Set([...execution.attemptedRegistrationIds, registrationId])]; execution.attempts.push({ registrationId, failureCode, detail: redact(detail, 480), at: now() }); execution.updatedAt = now(); execution.revision += 1;
      const key = `${tenantId}:${registrationId}`; const prior = state.brainxCircuitBreakers[key] || { id: key, tenantId, workspaceId, registrationId, failures: 0, status: "closed", revision: 0 };
      const breaker = { ...prior, failures: prior.failures + 1, status: prior.failures + 1 >= this.config.limits.circuitFailureThreshold ? "open" : "closed", lastFailureCode: failureCode, updatedAt: now(), revision: prior.revision + 1 };
      state.brainxCircuitBreakers[key] = breaker;
      events.push(event({ tenantId, workspaceId, type: "brainx.execution.attempt_failed", actor, payload: { executionId, registrationId, failureCode, circuitStatus: breaker.status } }));
      return clone(execution);
    });
  }

  async completeExecution({ claim, registration, output, latencyMs, tenantId, workspaceId, actor, idempotencyKey }) {
    const safety = this.validateOutput(output);
    return this.store.mutate((state, events) => {
      ensureState(state); const execution = state.brainxExecutions[claim.execution.id]; sameScope(execution, { tenantId, workspaceId });
      const effect = state.brainxEffects[`${claim.route.id}:execute:${idempotencyKey}`];
      if (!effect || effect.status !== "pending") throw new DecisionContinuityError("BrainX execution effect claim is unavailable.", { code: "recovery_required", status: 409 });
      execution.status = safety.status === "passed" ? "completed" : "failed";
      execution.registrationId = registration.id; execution.usage = { ...execution.usage, outputTokens: Math.ceil(output.content.length / 4), executionLatencyMs: latencyMs, estimatedCostUsd: registrationCost(registration, { estimatedInputTokens: execution.usage.inputTokens, estimatedOutputTokens: Math.ceil(output.content.length / 4) }) };
      execution.output = { schemaVersion: "brainx-output/v1", type: output.type, contentDigest: textDigest(output.content), contentBytes: Buffer.byteLength(output.content, "utf8"), confidence: output.confidence, deterministicSafety: safety, untrusted: true, validatorOnly: true };
      execution.acceptedOutcome = "untrusted_structured_output_returned_to_validator"; execution.updatedAt = now(); execution.revision += 1;
      effect.status = "completed"; effect.executionId = execution.id; effect.completedAt = now(); effect.revision += 1;
      const key = `${tenantId}:${registration.id}`; const breaker = state.brainxCircuitBreakers[key]; if (breaker) state.brainxCircuitBreakers[key] = { ...breaker, failures: 0, status: "closed", lastSuccessAt: now(), revision: breaker.revision + 1 };
      events.push(event({ tenantId, workspaceId, type: safety.status === "passed" ? "brainx.execution.completed" : "brainx.execution.output_rejected", actor, correlationId: claim.route.workflow.correlationId, payload: { routeId: claim.route.id, executionId: execution.id, registrationId: registration.id, output: execution.output, costUsd: execution.usage.estimatedCostUsd } }));
      return { status: execution.status, execution: clone(execution), untrustedOutput: safety.status === "passed" ? clone(output) : null };
    });
  }

  validateOutput(output) {
    const denied = /(?:\b(?:drop|delete|insert|update)\s+(?:table|from|into)\b|\b(?:sudo|curl|wget|chmod|rm\s+-rf)\b|\b(?:approve|promote|policy)\s*[:=])/i.test(output.content);
    return { validatorId: "brainx-output-boundary/v1", validatorVersion: "1.0.0", status: denied ? "failed" : "passed", checkedAt: now(), checks: ["strict_schema", "no_shell_sql_policy_promotion_handoff"], reason: denied ? "output_contains_forbidden_control_like_text" : "output_remains_untrusted_validator_input" };
  }

  async recordFailure({ routeId, executionId, tenantId, workspaceId, actor, idempotencyKey, failureCode, detail }) {
    return this.store.mutate((state, events) => {
      ensureState(state); const route = state.brainxRoutes[routeId]; sameScope(route, { tenantId, workspaceId });
      const execution = executionId ? state.brainxExecutions[executionId] : null; if (execution) { execution.status = failureCode === "execution_cancelled" ? "cancelled" : "failed"; execution.failure = { code: failureCode, detail: redact(detail, 480) }; execution.updatedAt = now(); execution.revision += 1; }
      const effect = state.brainxEffects[`${routeId}:execute:${idempotencyKey}`]; if (effect) { effect.status = "completed"; effect.outcome = { failureCode }; effect.completedAt = now(); effect.revision += 1; }
      events.push(event({ tenantId, workspaceId, type: "brainx.execution.failed", actor, correlationId: route.workflow.correlationId, payload: { routeId, executionId, failureCode } }));
      return { status: "failed", failureCode, execution: execution ? clone(execution) : null };
    });
  }

  async recordCancelled(routeId, { executionId, tenantId, workspaceId, actor, idempotencyKey, reason }) { return this.recordFailure({ routeId, executionId, tenantId, workspaceId, actor, idempotencyKey, failureCode: "execution_cancelled", detail: reason }); }

  async assertIndependentEvaluation({ generationRouteId, evaluatorRouteId, tenantId, workspaceId }) {
    const state = await this.store.readState(); const generated = state.brainxRoutes?.[generationRouteId]; const evaluator = state.brainxRoutes?.[evaluatorRouteId]; sameScope(generated, { tenantId, workspaceId }); sameScope(evaluator, { tenantId, workspaceId });
    const left = state.brainxRegistrations?.[generated.selectedRegistrationId]; const right = state.brainxRegistrations?.[evaluator.selectedRegistrationId];
    if (!left || !right || left.id === right.id || left.provider === right.provider || left.modelId === right.modelId) throw new DecisionContinuityError("Generation and independent evaluation cannot use the same provider/model registration.", { code: "independence_denied", status: 409 });
    return { status: "independent", generationRegistrationId: left.id, evaluatorRegistrationId: right.id };
  }

  async listRegistrations({ tenantId, workspaceId, limit = 100 } = {}) { const state = await this.store.readState(); return Object.values(state.brainxRegistrations || {}).filter((item) => item.tenantId === tenantId && (!workspaceId || item.workspaceId === workspaceId)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, Math.max(1, Math.min(Number(limit) || 100, 250))).map(clone); }
  async getPolicy({ tenantId, workspaceId = "default" } = {}) { const state = await this.store.readState(); const policy = this.policyForOrNull(state, tenantId, workspaceId); return policy ? clone(policy) : null; }
  policyForOrNull(state, tenantId, workspaceId) { return state.brainxPolicies?.[`${tenantId}:${workspaceId}`] || Object.values(state.brainxPolicies || {}).find((record) => record.tenantId === tenantId && record.workspaceId === workspaceId) || state.brainxPolicies?.[`${tenantId}:default`] || Object.values(state.brainxPolicies || {}).find((record) => record.tenantId === tenantId && record.workspaceId === "default") || null; }
  async listRoutes({ tenantId, workspaceId, limit = 100 } = {}) { const state = await this.store.readState(); return Object.values(state.brainxRoutes || {}).filter((item) => item.tenantId === tenantId && (!workspaceId || item.workspaceId === workspaceId)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, Math.max(1, Math.min(Number(limit) || 100, 250))).map(clone); }
  async listControls({ tenantId, workspaceId } = {}) { const state = await this.store.readState(); return Object.values(state.brainxControls || {}).filter((item) => item.tenantId === tenantId && (!workspaceId || item.workspaceId === workspaceId)).map(clone); }
  async metrics({ tenantId, workspaceId } = {}) {
    const state = await this.store.readState(); const executions = Object.values(state.brainxExecutions || {}).filter((item) => item.tenantId === tenantId && (!workspaceId || item.workspaceId === workspaceId)); const routes = Object.values(state.brainxRoutes || {}).filter((item) => item.tenantId === tenantId && (!workspaceId || item.workspaceId === workspaceId));
    return { tenantId, workspaceId: workspaceId || null, routes: routes.length, noEligible: routes.filter((item) => item.failureCode === "no_eligible_model").length, executions: executions.length, completed: executions.filter((item) => item.status === "completed").length, failed: executions.filter((item) => item.status === "failed").length, cancelled: executions.filter((item) => item.status === "cancelled").length, estimatedCostUsd: Number(executions.reduce((sum, item) => sum + Number(item.usage?.estimatedCostUsd || 0), 0).toFixed(6)), outputContentRetention: "none; digest and bounded metadata only", attribution: "operational routing/execution evidence only; no causal quality claim" };
  }
}
