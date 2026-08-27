import crypto from "node:crypto";

/**
 * AIX is the generation-seam selector for the existing executor. It does not
 * invoke a provider, download an artifact, allocate hardware, or infer a
 * budget. A routed OpenAI/Codex registration may supply the current CLI's
 * explicit model name; Hugging Face registrations are evaluated and recorded
 * but remain unavailable until a separately approved local inference adapter
 * exists.
 */
export const AIX_ROUTING_VERSION = "aix-governed-routing/v1";
export const AIX_ROUTE_FAILURE_CODES = Object.freeze([
  "governed_context_required", "enterprise_policy_missing", "enterprise_policy_denied",
  "policy_evaluation_unavailable", "budget_authority_required", "budget_exhausted",
  "no_eligible_model", "artifact_unpinned", "license_denied", "health_denied",
  "data_policy_denied", "region_denied", "egress_denied", "latency_objective_denied",
  "task_role_missing", "tenant_not_allowed", "huggingface_live_inference_not_enabled",
  "executor_not_configured", "registration_disabled", "governed_receipt_unavailable"
]);

const SENSITIVITIES = new Set(["public", "internal", "confidential", "restricted"]);
const EXECUTOR_PROVIDERS = /(?:^|[-_\s])(openai|codex)(?:$|[-_\s])/i;
const HUGGING_FACE_PROVIDER = /hugging\s*face|huggingface|(^|[-_\s])hf($|[-_\s])/i;

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function number(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function list(value, fallback = []) {
  const result = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  return result.length ? [...new Set(result)] : fallback;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function digest(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value || {})).digest("hex");
}

function text(value, max = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function statusOf(value) {
  return String(value?.status || "").toLowerCase();
}

function normalizeBudgetResponse(value) {
  const record = value && typeof value === "object" ? value : {};
  const status = statusOf(record);
  const reservation = record.reservation && typeof record.reservation === "object" ? record.reservation : record;
  const id = record.reservationId || reservation.id || record.id || null;
  return {
    allowed: record.allowed !== false && !["denied", "rejected", "exhausted", "failed"].includes(status) && Boolean(id),
    reservationId: id ? String(id) : null,
    receipt: clone(value || null)
  };
}

function normalizedObjective(value = {}, input = "") {
  const estimate = Math.max(1, Math.ceil(Buffer.byteLength(String(input || ""), "utf8") / 4));
  return {
    maxLatencyMs: number(value.maxLatencyMs, 60_000, 1, 120_000),
    estimatedInputTokens: number(value.estimatedInputTokens, estimate, 0, 1_000_000),
    estimatedOutputTokens: number(value.estimatedOutputTokens, Math.min(Math.max(256, estimate), 8_192), 0, 1_000_000),
    maxCostUsd: number(value.maxCostUsd, 1, 0, 10_000)
  };
}

function modelCost(registration, objective) {
  const pricing = registration?.pricing || {};
  const input = number(pricing.inputUsdPer1k, 0, 0, 100_000);
  const output = number(pricing.outputUsdPer1k, 0, 0, 100_000);
  return Number((((objective.estimatedInputTokens / 1000) * input) + ((objective.estimatedOutputTokens / 1000) * output)).toFixed(6));
}

function has(listValue, expected) {
  return Array.isArray(listValue) && listValue.includes(expected);
}

function providerSelectionReason(registration) {
  const provider = text(registration?.provider, 120);
  if (HUGGING_FACE_PROVIDER.test(provider)) return "huggingface_live_inference_not_enabled";
  if (!EXECUTOR_PROVIDERS.test(provider)) return "executor_not_configured";
  return null;
}

function candidateBase(registration, objective) {
  return {
    registrationId: registration.id,
    registrationKey: registration.registrationKey,
    registrationVersion: registration.registrationVersion,
    provider: registration.provider,
    modelId: registration.modelId,
    immutableRevision: registration.immutableRevision,
    estimatedCostUsd: modelCost(registration, objective)
  };
}

function candidateEligibility({ registration, tenantId, taskRole, data, objective, brainxPolicy }) {
  const reasons = [];
  const governance = registration.governance || {};
  if (!registration.enabled || registration.health?.status !== "healthy") reasons.push(registration.health?.status === "unhealthy" ? "health_denied" : "registration_disabled");
  if (!has(registration.taskRoles, taskRole)) reasons.push("task_role_missing");
  if (!has(governance.tenantAllowlist, tenantId)) reasons.push("tenant_not_allowed");
  if (!has(governance.allowedDataSensitivity, data.classification) || !has(brainxPolicy?.allowedSensitivity, data.classification)) reasons.push("data_policy_denied");
  if (!has(governance.approvedRegions, data.region) || !has(brainxPolicy?.approvedRegions, data.region)) reasons.push("region_denied");
  if (!has(governance.approvedEgress, data.egress) || !has(brainxPolicy?.allowedEgress, data.egress)) reasons.push("egress_denied");
  if (data.commercialUse && (!brainxPolicy?.allowCommercialUse || registration.licence?.commercialUse !== "allowed")) reasons.push("license_denied");
  if (!registration.immutableRevision || !registration.artifact?.checksum) reasons.push("artifact_unpinned");
  if (Number(registration.performance?.p95LatencyMs || Infinity) > Math.min(Number(brainxPolicy?.maxLatencyMs || 0), objective.maxLatencyMs)) reasons.push("latency_objective_denied");
  const estimatedCostUsd = modelCost(registration, objective);
  if (estimatedCostUsd > Math.min(Number(brainxPolicy?.maxCostUsdPerRoute || 0), objective.maxCostUsd)) reasons.push("budget_exhausted");
  const providerReason = providerSelectionReason(registration);
  if (providerReason) reasons.push(providerReason);
  return { reasons: [...new Set(reasons)].sort(), estimatedCostUsd };
}

function routeId({ tenantId, workspaceId, idempotencyKey }) {
  return `aix_route_${digest({ tenantId, workspaceId, idempotencyKey }).slice(0, 32)}`;
}

function contextError(reason) {
  return { allowed: false, denialReasons: [reason], policySnapshotId: null, budgetId: null, context: null, receipt: null };
}

function isEnterpriseIdentifier(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(String(value || ""));
}

function enterpriseCandidate(candidate = {}) {
  const result = {
    registrationId: String(candidate.registrationId || ""),
    reasonCodes: Array.isArray(candidate.reasonCodes) ? candidate.reasonCodes : []
  };
  for (const key of ["provider", "modelId", "immutableRevision"]) {
    if (candidate[key] && isEnterpriseIdentifier(candidate[key])) result[key] = String(candidate[key]);
  }
  if (Number.isFinite(Number(candidate.estimatedCostUsd))) result.estimatedCost = Number(candidate.estimatedCostUsd);
  return result;
}

function enterprisePolicyInput(input = {}, { policySnapshotId, budgetId } = {}) {
  const data = input.data;
  if (!input.applicationId || !data || !data.classification || !data.region || !data.egress
    || !Number.isInteger(data.retentionDays) || !Array.isArray(data.transformations)
    || !Array.isArray(data.complianceControlIds)) return null;
  return {
    applicationId: input.applicationId,
    action: "aix_model_route",
    ...(policySnapshotId || input.policySnapshotId ? { policySnapshotId: policySnapshotId || input.policySnapshotId } : {}),
    ...(budgetId || input.budgetId ? { budgetId: budgetId || input.budgetId } : {}),
    data: {
      classification: data.classification,
      region: data.region,
      egress: data.egress,
      retentionDays: data.retentionDays,
      transformations: data.transformations,
      complianceControlIds: data.complianceControlIds,
      ...(data.commercialUse === undefined ? {} : { commercialUse: Boolean(data.commercialUse) })
    },
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    impactLevel: input.impactLevel || "low",
    ...(input.approval ? { approval: input.approval } : {})
  };
}

export function resolveAIXConfig(env = process.env) {
  return {
    // Routing is additive. Existing executor behavior remains the default
    // until an operator explicitly enables the governed seam.
    enabled: bool(env.AIX_GOVERNED_ROUTING_ENABLED, false),
    allowHuggingFaceInference: false,
    maxRouteCostUsd: number(env.AIX_MAX_ROUTE_COST_USD, 1, 0, 10_000),
    maxLatencyMs: number(env.AIX_MAX_LATENCY_MS, 60_000, 1, 120_000),
    permittedTaskRoles: new Set(list(env.AIX_PERMITTED_TASK_ROLES, ["generation"])),
    receiptRetention: text(env.AIX_RECEIPT_RETENTION || "decision_continuity", 120)
  };
}

/**
 * This deliberately requires a governance context when BrainX is enabled.
 * A missing application binding, policy snapshot, evidence, or budget cannot
 * degrade into an ungoverned model route.
 */
export class GovernedAIXRouter {
  constructor({ registry, governance, config = resolveAIXConfig(), now = () => new Date() } = {}) {
    if (!registry) throw new Error("AIX requires the existing BrainX model registry.");
    this.registry = registry;
    this.governance = governance || null;
    this.config = config;
    this.now = now;
  }

  isEnabledForTenant(tenantId) {
    return Boolean(this.config.enabled && this.registry.isEnabledForTenant?.(tenantId));
  }

  async #routingContext(input) {
    if (!input.applicationId || !this.governance) return contextError("governed_context_required");
    const resolver = this.governance.resolveAIXContext || this.governance.resolveRoutingContext || this.governance.getRoutingContext;
    if (typeof resolver !== "function") return contextError("policy_evaluation_unavailable");
    const evaluationInput = enterprisePolicyInput(input);
    if (!evaluationInput) return contextError("governed_context_required");
    try {
      const result = await resolver.call(this.governance, evaluationInput, {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        actor: input.actor
      });
      if (!result || result.allowed === false || ["denied", "missing", "stale", "expired"].includes(statusOf(result))) {
        return { allowed: false, denialReasons: result?.denialReasons || result?.reasonCodes || ["enterprise_policy_denied"], policySnapshotId: result?.policySnapshotId || null, budgetId: result?.budgetId || null, context: null, receipt: clone(result || null) };
      }
      const context = result.context || result;
      if (!context.policySnapshotId || !context.budgetId || !context.data?.classification || !context.data?.region || !context.data?.egress) return contextError("governed_context_required");
      return { allowed: true, denialReasons: [], policySnapshotId: context.policySnapshotId, budgetId: context.budgetId, context, receipt: clone(result) };
    } catch {
      return contextError("policy_evaluation_unavailable");
    }
  }

  async #evaluateEnterprisePolicy(input, context) {
    const evaluator = this.governance?.evaluateModelRoute || this.governance?.evaluatePolicy;
    if (typeof evaluator !== "function") return contextError("policy_evaluation_unavailable");
    const evaluationInput = enterprisePolicyInput({ ...input, data: context.context?.data || input.data }, {
      policySnapshotId: context.policySnapshotId,
      budgetId: context.budgetId
    });
    if (!evaluationInput) return contextError("governed_context_required");
    try {
      const outcome = await evaluator.call(this.governance, evaluationInput, {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        actor: input.actor
      });
      if (outcome === false || outcome?.allowed === false || statusOf(outcome) === "denied") {
        return { allowed: false, denialReasons: outcome?.denialReasons || outcome?.reasonCodes || ["enterprise_policy_denied"], receipt: clone(outcome || null) };
      }
      return { allowed: true, denialReasons: [], receipt: clone(outcome || null) };
    } catch {
      return contextError("policy_evaluation_unavailable");
    }
  }

  async #recordReceipt(receipt, scope) {
    const writer = this.governance?.recordModelRouteReceipt || this.governance?.persistModelRouteReceipt || this.governance?.saveModelRouteReceipt;
    if (typeof writer !== "function") return { persisted: false, receipt: { ...receipt, persistence: "unavailable" } };
    if (!receipt.applicationId || !isEnterpriseIdentifier(receipt.applicationId)) {
      throw new Error("A governed route receipt requires an application binding identifier.");
    }
    const persistedReceipt = {
      applicationId: receipt.applicationId,
      routeId: receipt.id,
      ...(receipt.policySnapshotId ? { policySnapshotId: receipt.policySnapshotId } : {}),
      ...(receipt.budgetReservationId ? { budgetReservationId: receipt.budgetReservationId } : {}),
      ...(receipt.registrationId ? { registrationId: receipt.registrationId } : {}),
      ...(receipt.provider && isEnterpriseIdentifier(receipt.provider) ? { provider: receipt.provider } : {}),
      ...(receipt.modelId && isEnterpriseIdentifier(receipt.modelId) ? { modelId: receipt.modelId } : {}),
      ...(receipt.immutableRevision && isEnterpriseIdentifier(receipt.immutableRevision) ? { immutableRevision: receipt.immutableRevision } : {}),
      taskRole: receipt.taskRole,
      status: receipt.status,
      reasonCodes: receipt.denialReasons || [],
      eligibleCandidates: (receipt.eligibleCandidates || []).map(enterpriseCandidate),
      excludedCandidates: (receipt.excludedCandidates || []).map(enterpriseCandidate),
      estimatedCost: Number(receipt.estimatedCostUsd || 0),
      actualCost: null,
      idempotencyKey: receipt.idempotencyKey
    };
    const result = await writer.call(this.governance, persistedReceipt, scope);
    return { persisted: true, receipt: result?.receipt || result || receipt };
  }

  async #reserveBudget({ context, input, estimatedCostUsd, idempotencyKey }) {
    if (estimatedCostUsd <= 0) return { allowed: true, reservationId: null, receipt: null };
    const reserve = this.governance?.reserveModelBudget || this.governance?.reserveBudget;
    if (typeof reserve !== "function") return { allowed: false, denialReasons: ["budget_authority_required"], reservationId: null, receipt: null };
    try {
      const result = await reserve.call(this.governance, {
        budgetId: context.budgetId,
        amount: estimatedCostUsd,
        currency: "USD",
        purpose: "aix_model_route",
        policySnapshotId: context.policySnapshotId,
        applicationId: input.applicationId,
        idempotencyKey: `${idempotencyKey}:reserve`
      }, { tenantId: input.tenantId, workspaceId: input.workspaceId, actor: input.actor });
      const normalized = normalizeBudgetResponse(result);
      return normalized.allowed ? { allowed: true, ...normalized } : { allowed: false, denialReasons: ["budget_exhausted"], ...normalized };
    } catch (error) {
      return { allowed: false, denialReasons: [error?.code === "budget_exhausted" ? "budget_exhausted" : "budget_authority_required"], reservationId: null, receipt: null };
    }
  }

  async route(input = {}) {
    const tenantId = text(input.tenantId, 160);
    const workspaceId = text(input.workspaceId || "default", 160);
    const taskRole = text(input.taskRole || "generation", 120);
    const idempotencyKey = text(input.idempotencyKey || `aix:${digest({ tenantId, workspaceId, input: input.input, workflow: input.workflow }).slice(0, 48)}`, 240);
    if (!this.isEnabledForTenant(tenantId)) return { status: "baseline", reason: "brainx_feature_disabled", route: null };
    if (!this.config.permittedTaskRoles.has(taskRole)) return this.#finalizeDenied({ tenantId, workspaceId, taskRole, idempotencyKey, input, denialReasons: ["task_role_missing"] });
    const context = await this.#routingContext({ ...input, tenantId, workspaceId, taskRole });
    if (!context.allowed) return this.#finalizeDenied({ tenantId, workspaceId, taskRole, idempotencyKey, input, denialReasons: context.denialReasons, context });
    const enterpriseEvaluation = await this.#evaluateEnterprisePolicy({ ...input, tenantId, workspaceId, taskRole }, context);
    if (!enterpriseEvaluation.allowed) return this.#finalizeDenied({ tenantId, workspaceId, taskRole, idempotencyKey, input, denialReasons: enterpriseEvaluation.denialReasons, context, enterpriseEvaluation });
    const objective = normalizedObjective({ ...input.objective, maxCostUsd: Math.min(Number(input.objective?.maxCostUsd ?? this.config.maxRouteCostUsd), this.config.maxRouteCostUsd), maxLatencyMs: Math.min(Number(input.objective?.maxLatencyMs ?? this.config.maxLatencyMs), this.config.maxLatencyMs) }, input.input);
    const brainxPolicy = await this.registry.getPolicy({ tenantId, workspaceId }).catch(() => null);
    if (!brainxPolicy) return this.#finalizeDenied({ tenantId, workspaceId, taskRole, idempotencyKey, input, denialReasons: ["enterprise_policy_missing"], context, enterpriseEvaluation });
    const registrations = await this.registry.listRegistrations({ tenantId, workspaceId, limit: 250 });
    const eligible = [];
    const excluded = [];
    const data = context.context.data;
    for (const registration of registrations) {
      const candidate = candidateBase(registration, objective);
      const result = candidateEligibility({ registration, tenantId, taskRole, data, objective, brainxPolicy });
      if (result.reasons.length) excluded.push({ ...candidate, reasonCodes: result.reasons });
      else eligible.push({ ...candidate, score: Number(((Number(registration.evaluationEvidence?.outcomeScore || 0) * 100) - (Number(registration.performance?.p95LatencyMs || 0) / 1000) - result.estimatedCostUsd * 5).toFixed(6)) });
    }
    eligible.sort((left, right) => right.score - left.score || String(left.registrationId).localeCompare(String(right.registrationId)));
    const selected = eligible[0] || null;
    if (!selected) return this.#finalizeDenied({ tenantId, workspaceId, taskRole, idempotencyKey, input, denialReasons: ["no_eligible_model"], context, enterpriseEvaluation, objective, excluded });
    const reservation = await this.#reserveBudget({ context, input: { ...input, tenantId, workspaceId }, estimatedCostUsd: selected.estimatedCostUsd, idempotencyKey });
    if (!reservation.allowed) return this.#finalizeDenied({ tenantId, workspaceId, taskRole, idempotencyKey, input, denialReasons: reservation.denialReasons, context, enterpriseEvaluation, objective, excluded, reservation });
    const receipt = {
      id: routeId({ tenantId, workspaceId, idempotencyKey }),
      schemaVersion: AIX_ROUTING_VERSION,
      tenantId,
      workspaceId,
      applicationId: input.applicationId,
      enterpriseId: input.enterpriseId || null,
      taskRole,
      status: "routed",
      provider: selected.provider,
      modelId: selected.modelId,
      registrationId: selected.registrationId,
      immutableRevision: selected.immutableRevision,
      policySnapshotId: context.policySnapshotId,
      policyReceipt: enterpriseEvaluation.receipt || context.receipt || null,
      budgetId: context.budgetId,
      budgetReservationId: reservation.reservationId,
      budgetReservationReceipt: reservation.receipt || null,
      estimatedCostUsd: selected.estimatedCostUsd,
      actualCostUsd: null,
      actualCostStatus: "usage_evidence_required",
      inputDigest: digest(String(input.input || "")),
      objective,
      // Carry the already-authorized control inputs forward to AgenticX and
      // DecisionX. These are policy facts, never a substitute for the
      // immutable snapshot/evidence checks performed at their own seams.
      data: {
        classification: data.classification,
        region: data.region,
        egress: data.egress,
        retentionDays: data.retentionDays,
        transformations: [...data.transformations],
        complianceControlIds: [...data.complianceControlIds],
        commercialUse: Boolean(data.commercialUse)
      },
      eligibleCandidates: eligible.map(({ score, ...candidate }) => candidate),
      excludedCandidates: excluded,
      denialReasons: [],
      execution: { adapter: "current_codex_cli", liveProviderInvocation: false, huggingFaceInference: false },
      idempotencyKey,
      createdAt: this.now().toISOString()
    };
    try {
      const persisted = await this.#recordReceipt(receipt, { tenantId, workspaceId, actor: input.actor });
      // The authority intentionally retains a compact receipt. Keep the
      // local route rationale alongside its authoritative receipt ID for the
      // generation response, without pretending it is provider usage data.
      const finalReceipt = {
        ...receipt,
        ...(persisted.receipt || {}),
        estimatedCostUsd: receipt.estimatedCostUsd,
        actualCostUsd: null,
        actualCostStatus: "usage_evidence_required",
        denialReasons: receipt.denialReasons
      };
      return {
        status: "routed",
        route: {
          ...finalReceipt,
          selectedRegistrationId: selected.registrationId,
          selectedProvider: selected.provider,
          selectedModelId: selected.modelId,
          executionModel: selected.modelId,
          receiptId: finalReceipt.id || receipt.id
        }
      };
    } catch {
      return this.#finalizeDenied({ tenantId, workspaceId, taskRole, idempotencyKey, input, denialReasons: ["governed_receipt_unavailable"], context, enterpriseEvaluation, objective, excluded, reservation });
    }
  }

  async #finalizeDenied({ tenantId, workspaceId, taskRole, idempotencyKey, input, denialReasons, context = null, enterpriseEvaluation = null, objective = null, excluded = [], reservation = null } = {}) {
    const reasons = [...new Set((denialReasons || ["no_eligible_model"]).map((reason) => text(reason, 120)).filter(Boolean))];
    const receipt = {
      id: routeId({ tenantId, workspaceId, idempotencyKey }),
      schemaVersion: AIX_ROUTING_VERSION,
      tenantId,
      workspaceId,
      applicationId: input?.applicationId || null,
      enterpriseId: input?.enterpriseId || null,
      taskRole,
      status: "no_eligible_model",
      provider: "",
      modelId: "",
      registrationId: null,
      policySnapshotId: context?.policySnapshotId || null,
      policyReceipt: enterpriseEvaluation?.receipt || context?.receipt || null,
      budgetId: context?.budgetId || null,
      budgetReservationId: reservation?.reservationId || null,
      estimatedCostUsd: 0,
      actualCostUsd: null,
      actualCostStatus: "not_incurred",
      inputDigest: digest(String(input?.input || "")),
      objective: objective || null,
      excludedCandidates: excluded,
      denialReasons: reasons,
      execution: { adapter: "none", liveProviderInvocation: false, huggingFaceInference: false },
      idempotencyKey,
      createdAt: this.now().toISOString()
    };
    try {
      const persisted = await this.#recordReceipt(receipt, { tenantId, workspaceId, actor: input?.actor });
      const finalReceipt = {
        ...receipt,
        ...(persisted.receipt || {}),
        estimatedCostUsd: 0,
        actualCostUsd: null,
        actualCostStatus: "not_incurred",
        denialReasons: reasons
      };
      return { status: "no_eligible_model", failureCode: "no_eligible_model", route: { ...finalReceipt, receiptId: finalReceipt.id || receipt.id, failureCode: "no_eligible_model" } };
    } catch {
      return { status: "no_eligible_model", failureCode: "no_eligible_model", route: { ...receipt, receiptId: receipt.id, failureCode: "no_eligible_model", persistence: "unavailable" } };
    }
  }
}

export const AIXRouter = GovernedAIXRouter;
