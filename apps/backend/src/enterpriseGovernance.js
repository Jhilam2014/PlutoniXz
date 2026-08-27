import crypto from "node:crypto";
import { z } from "zod";
import { DecisionContinuityError } from "./decisionContinuity.js";

/**
 * Enterprise BrainX governance is a control-plane service.  It stores only
 * opaque identifiers, digests, policy facts, and audit receipts; prompts,
 * credentials, research bodies, and reusable-agent content are deliberately
 * outside this boundary.
 */

export const ENTERPRISE_GOVERNANCE_SCHEMA_VERSION = "enterprise-governance/v1";
export const ENTERPRISE_DATA_CLASSIFICATIONS = Object.freeze(["public", "internal", "confidential", "restricted"]);
export const ENTERPRISE_IMPACT_LEVELS = Object.freeze(["low", "medium", "high", "critical"]);
export const ENTERPRISE_EVIDENCE_STATES = Object.freeze(["verified", "unknown", "stale", "expired", "invalid", "unauthorized"]);

export class EnterpriseGovernanceError extends DecisionContinuityError {
  constructor(message, { code = "enterprise_governance_error", status = 400, details = null } = {}) {
    super(message, { code, status, details });
    this.name = "EnterpriseGovernanceError";
  }
}

const IdentifierSchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "must be an opaque identifier");
const OptionalIdentifierSchema = IdentifierSchema.optional();
const OpaqueLabelSchema = z.string().trim().min(1).max(240);
const IdempotencyKeySchema = z.string().trim().min(1).max(240);
const DigestSchema = z.string().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase());
const CurrencySchema = z.string().trim().transform((value) => value.toUpperCase()).pipe(z.string().regex(/^[A-Z]{3}$/));
const MoneySchema = z.number().finite().min(0).max(1_000_000_000_000);
const PositiveMoneySchema = MoneySchema.refine((value) => value > 0, "must be greater than zero");
const TimestampSchema = z.string().datetime();
const ClassificationSchema = z.enum(ENTERPRISE_DATA_CLASSIFICATIONS);
const ImpactLevelSchema = z.enum(ENTERPRISE_IMPACT_LEVELS);
const EvidenceStateSchema = z.enum(ENTERPRISE_EVIDENCE_STATES);

const ScopeSchema = z.object({
  tenantId: IdentifierSchema,
  workspaceId: IdentifierSchema.default("default")
}).passthrough();

const ActorSchema = z.object({
  id: IdentifierSchema,
  type: z.enum(["human", "service", "agent", "system"]).default("service")
}).passthrough();

const PolicyEvidenceSchema = z.object({
  id: IdentifierSchema,
  controlIds: z.array(IdentifierSchema).min(1).max(64),
  status: EvidenceStateSchema,
  authorized: z.boolean(),
  observedAt: TimestampSchema,
  expiresAt: TimestampSchema.optional(),
  tenantId: IdentifierSchema,
  workspaceId: IdentifierSchema
}).strict();

const UsageEvidenceSchema = z.object({
  id: IdentifierSchema,
  source: IdentifierSchema,
  status: EvidenceStateSchema,
  authorized: z.boolean(),
  observedAt: TimestampSchema,
  expiresAt: TimestampSchema.optional(),
  digest: DigestSchema.optional()
}).strict();

const HumanApprovalSchema = z.object({
  approved: z.literal(true),
  approverId: IdentifierSchema,
  approvedAt: TimestampSchema,
  evidenceId: IdentifierSchema
}).strict();

const BudgetControlsSchema = z.object({
  currency: CurrencySchema,
  maxReservationAmount: PositiveMoneySchema,
  requireReservation: z.boolean().default(true)
}).strict();

const DataClassificationControlsSchema = z.object({
  allowed: z.array(ClassificationSchema).min(1).max(ENTERPRISE_DATA_CLASSIFICATIONS.length),
  evidenceRequired: z.boolean().default(true)
}).strict();

const ResidencyControlsSchema = z.object({
  allowedRegions: z.array(IdentifierSchema).min(1).max(64),
  evidenceRequired: z.boolean().default(true)
}).strict();

const EgressControlsSchema = z.object({
  allowedDestinations: z.array(IdentifierSchema).min(1).max(128),
  evidenceRequired: z.boolean().default(true)
}).strict();

const RetentionControlsSchema = z.object({
  maxDays: z.number().int().min(0).max(36_500),
  evidenceRequired: z.boolean().default(true)
}).strict();

const TransformationControlsSchema = z.object({
  allowed: z.array(IdentifierSchema).max(64),
  evidenceRequired: z.boolean().default(true),
  requireSanitizationFor: z.array(ClassificationSchema).default(["confidential", "restricted"])
}).strict();

const ComplianceControlsSchema = z.object({
  requiredControlIds: z.array(IdentifierSchema).max(128).default([]),
  evidenceRequired: z.boolean().default(true)
}).strict();

const HumanApprovalControlsSchema = z.object({
  requiredFor: z.array(ImpactLevelSchema).default(["high", "critical"])
}).strict();

export const EnterprisePolicyInputSchema = z.object({
  enterpriseId: IdentifierSchema,
  policyVersion: IdentifierSchema,
  controls: z.object({
    budget: BudgetControlsSchema,
    dataClassification: DataClassificationControlsSchema,
    residency: ResidencyControlsSchema,
    egress: EgressControlsSchema,
    retention: RetentionControlsSchema,
    transformations: TransformationControlsSchema,
    compliance: ComplianceControlsSchema,
    humanApproval: HumanApprovalControlsSchema.default({ requiredFor: ["high", "critical"] })
  }).strict(),
  evidence: z.object({
    maxAgeHours: z.number().int().min(1).max(8_760).default(24),
    requireAuthorized: z.boolean().default(true)
  }).strict().default({ maxAgeHours: 24, requireAuthorized: true }),
  idempotencyKey: IdempotencyKeySchema
}).strict();

export const EnterpriseApplicationBindingSchema = z.object({
  applicationId: IdentifierSchema,
  enterpriseId: IdentifierSchema,
  applicationName: OpaqueLabelSchema.optional(),
  dataClassification: ClassificationSchema.default("internal"),
  homeRegion: IdentifierSchema.optional(),
  idempotencyKey: IdempotencyKeySchema
}).strict();

export const EnterpriseBudgetInputSchema = z.object({
  budgetKey: IdentifierSchema,
  enterpriseId: IdentifierSchema,
  applicationId: OptionalIdentifierSchema,
  policySnapshotId: OptionalIdentifierSchema,
  currency: CurrencySchema,
  limitAmount: PositiveMoneySchema,
  startsAt: TimestampSchema.optional(),
  endsAt: TimestampSchema.optional(),
  idempotencyKey: IdempotencyKeySchema
}).strict().superRefine((value, context) => {
  if (value.startsAt && value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "must be later than startsAt" });
  }
});

export const EnterprisePolicyEvaluationSchema = z.object({
  applicationId: IdentifierSchema,
  action: IdentifierSchema.optional(),
  operation: IdentifierSchema.optional(),
  policySnapshotId: OptionalIdentifierSchema,
  budgetId: OptionalIdentifierSchema,
  data: z.object({
    classification: ClassificationSchema,
    region: IdentifierSchema,
    egress: IdentifierSchema,
    retentionDays: z.number().int().min(0).max(36_500),
    transformations: z.array(IdentifierSchema).max(64).default([]),
    complianceControlIds: z.array(IdentifierSchema).max(128).default([]),
    commercialUse: z.boolean().optional()
  }).strict(),
  evidence: z.array(PolicyEvidenceSchema).max(256).default([]),
  budget: z.object({
    budgetId: IdentifierSchema,
    amount: PositiveMoneySchema,
    currency: CurrencySchema
  }).strict().optional(),
  impactLevel: ImpactLevelSchema.default("low"),
  approval: HumanApprovalSchema.optional()
}).strict().superRefine((value, context) => {
  if (!value.action && !value.operation) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["action"], message: "action or operation is required" });
  }
});

export const EnterpriseDecisionContextSchema = z.object({
  applicationId: IdentifierSchema,
  decisionKey: IdentifierSchema,
  workflowId: IdentifierSchema,
  decisionType: IdentifierSchema,
  policySnapshotId: IdentifierSchema.nullable().optional(),
  budgetReservationId: IdentifierSchema.nullable().optional(),
  affectedConnectionIds: z.array(IdentifierSchema).max(128).default([]),
  evidenceIds: z.array(IdentifierSchema).max(256).default([]),
  paths: z.array(z.object({
    id: IdentifierSchema,
    disposition: z.enum(["proposed", "selected", "deferred", "rejected"]),
    evidenceIds: z.array(IdentifierSchema).max(64).default([]),
    rationaleDigest: DigestSchema.optional()
  }).strict()).min(1).max(64),
  selectedPathId: IdentifierSchema.optional(),
  validation: z.object({
    status: z.enum(["not_run", "passed", "failed"]),
    evidenceIds: z.array(IdentifierSchema).max(64).default([])
  }).strict().default({ status: "not_run", evidenceIds: [] }),
  outcome: z.enum(["pending", "completed", "deferred", "rejected", "failed"]).default("pending"),
  impactLevel: ImpactLevelSchema.default("low"),
  approval: HumanApprovalSchema.optional(),
  idempotencyKey: IdempotencyKeySchema
}).strict().superRefine((value, context) => {
  const ids = new Set(value.paths.map((path) => path.id));
  if (ids.size !== value.paths.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["paths"], message: "path IDs must be unique" });
  const selected = value.paths.filter((path) => path.disposition === "selected");
  if (selected.length > 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["paths"], message: "only one path may be selected" });
  if (value.selectedPathId && (!ids.has(value.selectedPathId) || !selected.some((path) => path.id === value.selectedPathId))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["selectedPathId"], message: "must reference the selected path" });
  }
});

const ModelRouteCandidateSchema = z.object({
  registrationId: IdentifierSchema,
  provider: IdentifierSchema.optional(),
  modelId: IdentifierSchema.optional(),
  immutableRevision: IdentifierSchema.optional(),
  estimatedCost: MoneySchema.optional(),
  reasonCodes: z.array(IdentifierSchema).max(64).default([])
}).strict();

const ModelRouteReceiptSchema = z.object({
  applicationId: IdentifierSchema,
  routeId: IdentifierSchema,
  policySnapshotId: IdentifierSchema.nullable().optional(),
  budgetReservationId: IdentifierSchema.nullable().optional(),
  registrationId: OptionalIdentifierSchema,
  provider: IdentifierSchema.nullable().optional(),
  modelId: IdentifierSchema.nullable().optional(),
  immutableRevision: IdentifierSchema.nullable().optional(),
  taskRole: IdentifierSchema,
  status: z.enum(["routed", "denied", "executed", "failed", "no_eligible_model"]),
  reasonCodes: z.array(IdentifierSchema).max(64).default([]),
  eligibleCandidates: z.array(ModelRouteCandidateSchema).max(128).default([]),
  excludedCandidates: z.array(ModelRouteCandidateSchema).max(128).default([]),
  estimatedCost: MoneySchema.default(0),
  actualCost: MoneySchema.nullable().default(null),
  usageEvidenceId: IdentifierSchema.optional(),
  idempotencyKey: IdempotencyKeySchema
}).strict().superRefine((value, context) => {
  if (value.actualCost !== null && !value.usageEvidenceId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["usageEvidenceId"], message: "is required when actualCost is recorded" });
  }
});

const KnowledgeReferenceSchema = z.object({
  id: IdentifierSchema,
  digest: DigestSchema.optional(),
  classification: ClassificationSchema,
  sourceWorkspaceId: OptionalIdentifierSchema
}).strict();

const SanitizationSchema = z.object({
  status: z.literal("sanitized"),
  contentIncluded: z.literal(false),
  transformIds: z.array(IdentifierSchema).min(1).max(64),
  evidenceId: IdentifierSchema.optional()
}).strict();

export const EnterpriseKnowledgeReuseRequestSchema = z.object({
  sourceApplicationId: IdentifierSchema,
  targetApplicationId: IdentifierSchema,
  purpose: IdentifierSchema,
  policySnapshotId: OptionalIdentifierSchema,
  data: z.object({
    classification: ClassificationSchema,
    region: IdentifierSchema,
    egress: IdentifierSchema,
    retentionDays: z.number().int().min(0).max(36_500),
    transformations: z.array(IdentifierSchema).max(64).default([]),
    complianceControlIds: z.array(IdentifierSchema).max(128).default([])
  }).strict(),
  evidence: z.array(PolicyEvidenceSchema).max(256).default([]),
  knowledgeReferences: z.array(KnowledgeReferenceSchema).min(1).max(256),
  sanitization: SanitizationSchema,
  impactLevel: ImpactLevelSchema.default("low"),
  approval: HumanApprovalSchema.optional(),
  idempotencyKey: IdempotencyKeySchema
}).strict();

const TenantKnowledgeRetrievalSchema = z.object({
  targetApplicationId: IdentifierSchema,
  sourceApplicationId: OptionalIdentifierSchema,
  purpose: IdentifierSchema,
  policySnapshotId: OptionalIdentifierSchema,
  data: z.object({
    classification: ClassificationSchema,
    region: IdentifierSchema,
    egress: IdentifierSchema,
    retentionDays: z.number().int().min(0).max(36_500),
    transformations: z.array(IdentifierSchema).max(64).default([]),
    complianceControlIds: z.array(IdentifierSchema).max(128).default([])
  }).strict(),
  evidence: z.array(PolicyEvidenceSchema).max(256).default([]),
  sanitization: SanitizationSchema,
  knowledgeIds: z.array(IdentifierSchema).max(256).default([]),
  impactLevel: ImpactLevelSchema.default("low"),
  approval: HumanApprovalSchema.optional(),
  maxResults: z.coerce.number().int().min(1).max(100).default(10),
  idempotencyKey: IdempotencyKeySchema
}).strict();

const AgenticXKnowledgeSchema = z.object({
  applicationId: IdentifierSchema,
  knowledgeId: IdentifierSchema,
  classification: ClassificationSchema,
  region: IdentifierSchema,
  digest: DigestSchema,
  retentionDays: z.number().int().min(0).max(36_500),
  transformIds: z.array(IdentifierSchema).min(1).max(64),
  evidenceIds: z.array(IdentifierSchema).max(64).default([]),
  expiresAt: TimestampSchema.optional(),
  idempotencyKey: IdempotencyKeySchema
}).strict();

const ReserveBudgetSchema = z.object({
  budgetId: IdentifierSchema,
  applicationId: OptionalIdentifierSchema,
  amount: PositiveMoneySchema,
  currency: CurrencySchema,
  purpose: z.string().trim().min(1).max(2_000),
  policySnapshotId: OptionalIdentifierSchema,
  expiresAt: TimestampSchema.optional(),
  idempotencyKey: IdempotencyKeySchema
}).strict();

const SettleBudgetSchema = z.object({
  reservationId: IdentifierSchema,
  actualAmount: MoneySchema,
  currency: CurrencySchema,
  usageEvidence: UsageEvidenceSchema,
  idempotencyKey: IdempotencyKeySchema
}).strict();

const ReleaseBudgetSchema = z.object({
  reservationId: IdentifierSchema,
  reason: z.string().min(1).max(2_000),
  idempotencyKey: IdempotencyKeySchema
}).strict();

const DecisionBuildCaptureSchema = z.object({
  branchId: IdentifierSchema,
  applicationId: IdentifierSchema,
  enterpriseId: IdentifierSchema.nullable().optional(),
  policySnapshotId: IdentifierSchema.nullable().optional(),
  budgetScopeId: IdentifierSchema.nullable().optional(),
  evidenceRefs: z.array(IdentifierSchema).max(256).default([]),
  stage: z.enum(["planned", "outcome"]),
  outcome: z.object({
    status: IdentifierSchema.optional(),
    buildId: IdentifierSchema.optional(),
    routeReceiptId: IdentifierSchema.optional()
  }).strict().default({}),
  idempotencyKey: IdempotencyKeySchema
}).strict();

const AgenticXReuseReceiptSchema = z.object({
  id: IdentifierSchema.optional(),
  status: z.enum(["allowed", "denied", "idempotent"]),
  purpose: IdentifierSchema,
  region: IdentifierSchema,
  egress: IdentifierSchema,
  transformation: IdentifierSchema,
  maxClassification: ClassificationSchema,
  targetApplicationId: IdentifierSchema.nullable().optional(),
  policySnapshotId: IdentifierSchema.nullable().optional(),
  allowedKnowledgeIds: z.array(IdentifierSchema).max(256).default([]),
  deniedCandidates: z.array(z.object({ knowledgeId: IdentifierSchema.nullable().optional(), reasonCodes: z.array(IdentifierSchema).max(64).default([]) }).strict()).max(256).default([]),
  denialReasons: z.array(IdentifierSchema).max(128).default([]),
  policyReceiptIds: z.array(IdentifierSchema).max(128).default([]),
  createdAt: TimestampSchema.optional(),
  idempotencyKey: IdempotencyKeySchema.optional()
}).passthrough();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(canonicalize(value))).digest("hex");
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function roundMoney(value) {
  return Number(Number(value).toFixed(6));
}

function parseOrThrow(schema, input, label = "Enterprise governance input") {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new EnterpriseGovernanceError(`${label} is invalid.`, {
        code: "invalid_enterprise_governance_input",
        status: 400,
        details: error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message }))
      });
    }
    throw error;
  }
}

function scopeFor(context = {}) {
  const scope = parseOrThrow(ScopeSchema, context, "Enterprise governance scope");
  return { tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: context.actor ? parseOrThrow(ActorSchema, context.actor, "Enterprise governance actor") : null };
}

function actorFor(actor) {
  return actor ? { id: actor.id, type: actor.type || "service" } : { id: "enterprise-governance", type: "service" };
}

function event({ type, tenantId, workspaceId, actor, payload, occurredAt }) {
  return {
    id: id("enterprise_governance_event"),
    schemaVersion: ENTERPRISE_GOVERNANCE_SCHEMA_VERSION,
    type,
    occurredAt,
    tenantId,
    workspaceId,
    actor: actorFor(actor),
    payload: clone(payload)
  };
}

export function ensureEnterpriseGovernanceState(state) {
  for (const key of [
    "enterpriseGovernanceBindings",
    "enterpriseGovernancePolicies",
    "enterpriseGovernanceBudgets",
    "enterpriseGovernanceReservations",
    "enterpriseGovernanceDecisionContexts",
    "enterpriseGovernanceKnowledgeReceipts",
    "enterpriseGovernanceIdempotency",
    "agenticXKnowledge",
    "agenticXReuseReceipts"
  ]) state[key] ||= {};
  return state;
}

function inScope(record, { tenantId, workspaceId }) {
  return Boolean(record && record.tenantId === tenantId && record.workspaceId === workspaceId);
}

function requireScoped(record, scope, label = "Enterprise governance record") {
  if (!inScope(record, scope)) {
    throw new EnterpriseGovernanceError(`${label} was not found in this tenant/workspace.`, {
      code: "enterprise_governance_not_found",
      status: 404
    });
  }
  return record;
}

function comparableTimestamp(value) {
  const result = Date.parse(value || "");
  return Number.isFinite(result) ? result : 0;
}

function policyRecords(state, scope, enterpriseId) {
  return Object.values(state.enterpriseGovernancePolicies || {})
    .filter((record) => inScope(record, scope) && (!enterpriseId || record.enterpriseId === enterpriseId))
    .sort((left, right) => comparableTimestamp(right.createdAt) - comparableTimestamp(left.createdAt) || String(right.id).localeCompare(String(left.id)));
}

function policyFor(state, scope, { enterpriseId, policySnapshotId, policyVersion } = {}) {
  let record = null;
  if (policySnapshotId) record = state.enterpriseGovernancePolicies?.[policySnapshotId] || null;
  else if (policyVersion) record = policyRecords(state, scope, enterpriseId).find((candidate) => candidate.policyVersion === policyVersion) || null;
  else record = policyRecords(state, scope, enterpriseId)[0] || null;
  if (!record || !inScope(record, scope) || (enterpriseId && record.enterpriseId !== enterpriseId)) return null;
  return record;
}

function applicationBindingFor(state, scope, applicationId) {
  return Object.values(state.enterpriseGovernanceBindings || {}).find((record) => inScope(record, scope) && record.applicationId === applicationId) || null;
}

function tenantApplicationBindingFor(state, tenantId, applicationId) {
  return Object.values(state.enterpriseGovernanceBindings || {})
    .filter((record) => record.tenantId === tenantId && record.applicationId === applicationId)
    .sort((left, right) => comparableTimestamp(right.createdAt) - comparableTimestamp(left.createdAt) || String(left.workspaceId).localeCompare(String(right.workspaceId)))[0] || null;
}

function requireApplicationBinding(state, scope, applicationId) {
  const binding = applicationBindingFor(state, scope, applicationId);
  if (!binding) {
    throw new EnterpriseGovernanceError("Application is not bound to an enterprise in this tenant/workspace.", {
      code: "application_binding_required",
      status: 409
    });
  }
  return binding;
}

function budgetFor(state, scope, budgetId) {
  const budget = state.enterpriseGovernanceBudgets?.[budgetId];
  return inScope(budget, scope) ? budget : null;
}

function reservationFor(state, scope, reservationId) {
  const reservation = state.enterpriseGovernanceReservations?.[reservationId];
  return inScope(reservation, scope) ? reservation : null;
}

function budgetWindowStatus(budget, at) {
  const timestamp = typeof at === "number" ? at : Date.parse(at);
  if (budget.startsAt && comparableTimestamp(budget.startsAt) > timestamp) return "not_started";
  if (budget.endsAt && comparableTimestamp(budget.endsAt) <= timestamp) return "expired";
  return "active";
}

function reservationActive(reservation, at) {
  return reservation.status === "reserved" && (!reservation.expiresAt || comparableTimestamp(reservation.expiresAt) > at);
}

function budgetTotals(state, budget, at = Date.now(), { excludeReservationId = null } = {}) {
  const reservations = Object.values(state.enterpriseGovernanceReservations || {})
    .filter((record) => record.budgetId === budget.id && record.id !== excludeReservationId);
  const reservedAmount = reservations.filter((record) => reservationActive(record, at)).reduce((sum, record) => sum + Number(record.estimatedAmount || 0), 0);
  const settledAmount = reservations.filter((record) => record.status === "settled").reduce((sum, record) => sum + Number(record.actualAmount || 0), 0);
  const releasedAmount = reservations.filter((record) => record.status === "released").reduce((sum, record) => sum + Number(record.estimatedAmount || 0), 0);
  const expiredAmount = reservations.filter((record) => record.status === "expired" || (record.status === "reserved" && record.expiresAt && comparableTimestamp(record.expiresAt) <= at)).reduce((sum, record) => sum + Number(record.estimatedAmount || 0), 0);
  const committedAmount = roundMoney(reservedAmount + settledAmount);
  return {
    limitAmount: roundMoney(budget.limitAmount),
    reservedAmount: roundMoney(reservedAmount),
    settledAmount: roundMoney(settledAmount),
    releasedAmount: roundMoney(releasedAmount),
    expiredAmount: roundMoney(expiredAmount),
    committedAmount,
    availableAmount: roundMoney(Math.max(0, Number(budget.limitAmount) - committedAmount))
  };
}

function budgetView(state, budget, at = Date.now()) {
  return {
    ...clone(budget),
    lifecycleStatus: budgetWindowStatus(budget, at),
    totals: budgetTotals(state, budget, at)
  };
}

function idempotencyId(scope, operation, key) {
  return `enterprise_governance_idem_${digest({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, operation, key }).slice(0, 48)}`;
}

function replayOrRemember(state, scope, operation, idempotencyKey, input, now, execute) {
  const recordId = idempotencyId(scope, operation, idempotencyKey);
  const inputDigest = digest(input);
  const previous = state.enterpriseGovernanceIdempotency[recordId];
  if (previous) {
    if (previous.inputDigest !== inputDigest) {
      throw new EnterpriseGovernanceError("This idempotency key was already used for a different request.", {
        code: "idempotency_key_reused",
        status: 409
      });
    }
    return { replayed: true, result: clone(previous.result) };
  }
  const result = execute();
  state.enterpriseGovernanceIdempotency[recordId] = {
    id: recordId,
    schemaVersion: ENTERPRISE_GOVERNANCE_SCHEMA_VERSION,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    operation,
    keyDigest: digest(idempotencyKey),
    inputDigest,
    result: clone(result),
    createdAt: now,
    revision: 1
  };
  return { replayed: false, result };
}

function evidenceState(evidence, scope, controls, policy, now) {
  if (!evidence || evidence.status !== "verified") return "invalid";
  if (policy.evidence.requireAuthorized && evidence.authorized !== true) return "unauthorized";
  if (evidence.tenantId !== scope.tenantId || evidence.workspaceId !== scope.workspaceId) return "scope_mismatch";
  const observedAt = comparableTimestamp(evidence.observedAt);
  if (!observedAt || observedAt > now || now - observedAt > Number(policy.evidence.maxAgeHours) * 60 * 60 * 1000) return "stale";
  if (evidence.expiresAt && comparableTimestamp(evidence.expiresAt) <= now) return "expired";
  if (!controls.every((control) => evidence.controlIds.includes(control))) return "nonmatching";
  return "valid";
}

function hasValidEvidence({ evidence, requiredControl, scope, policy, now }) {
  return evidence.some((item) => evidenceState(item, scope, [requiredControl], policy, now) === "valid");
}

function addRequiredEvidenceReasons({ reasons, evidence, scope, policy, now, controls }) {
  for (const control of controls) {
    if (!hasValidEvidence({ evidence, requiredControl: control, scope, policy, now })) reasons.push(`evidence_${control}_required`);
  }
}

function classificationRank(value) {
  return ENTERPRISE_DATA_CLASSIFICATIONS.indexOf(value);
}

function sanitizedPolicy(policy) {
  return {
    id: policy.id,
    enterpriseId: policy.enterpriseId,
    policyVersion: policy.policyVersion,
    policyDigest: policy.policyDigest,
    parentPolicySnapshotId: policy.parentPolicySnapshotId || null,
    createdAt: policy.createdAt,
    revision: policy.revision,
    controls: clone(policy.controls),
    evidence: clone(policy.evidence)
  };
}

function safeKnowledgeReferences(references) {
  return references.map((reference) => ({
    id: reference.id,
    digest: reference.digest || null,
    classification: reference.classification,
    sourceWorkspaceId: reference.sourceWorkspaceId || null
  }));
}

const GatewayAgenticXKnowledgeSchema = z.object({
  id: IdentifierSchema,
  sourceId: IdentifierSchema,
  sourceApplicationId: IdentifierSchema,
  version: IdentifierSchema,
  summary: z.string().trim().min(1).max(1_200),
  contentDigest: DigestSchema,
  sanitized: z.literal(true),
  immutableFingerprint: DigestSchema,
  classification: ClassificationSchema,
  region: IdentifierSchema,
  allowedPurposes: z.array(IdentifierSchema).min(1).max(64),
  allowedTransformations: z.array(IdentifierSchema).min(1).max(64),
  retention: z.object({ expiresAt: TimestampSchema, notBefore: TimestampSchema.optional() }).strict(),
  tags: z.array(IdentifierSchema).max(64).default([]),
  idempotencyKey: IdempotencyKeySchema.optional()
}).passthrough();

function safeSanitizedSummary(value) {
  const summary = String(value || "").trim();
  if (!summary || summary.length > 1_200) return null;
  const secretLike = /(?:\b(?:sk|sess)-[A-Za-z0-9_-]{16,}|\b(?:api[_-]?key|token|password|secret)\s*[:=]|authorization\s*[:=]\s*bearer\s+|postgres(?:ql)?:\/\/[^\s]+)/i;
  return secretLike.test(summary) ? null : summary;
}

function normalizeAgenticXKnowledgeInput(input, now) {
  if (!input || typeof input !== "object" || (!Object.prototype.hasOwnProperty.call(input, "sourceId") && !Object.prototype.hasOwnProperty.call(input, "contentDigest"))) {
    return { parsedInput: input, gatewayRecord: null };
  }
  const gateway = parseOrThrow(GatewayAgenticXKnowledgeSchema, input, "Sanitized AgenticX knowledge registration");
  const summary = safeSanitizedSummary(gateway.summary);
  if (!summary) throw new EnterpriseGovernanceError("AgenticX knowledge summary contains disallowed secret-like content or is not bounded.", { code: "agenticx_summary_denied", status: 422 });
  const expiresAt = comparableTimestamp(gateway.retention.expiresAt);
  const retentionDays = Math.max(0, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000)));
  if (!retentionDays) throw new EnterpriseGovernanceError("AgenticX knowledge retention has expired.", { code: "invalid_knowledge_expiry", status: 409 });
  return {
    parsedInput: {
      applicationId: gateway.sourceApplicationId,
      knowledgeId: gateway.id,
      classification: gateway.classification,
      region: gateway.region,
      digest: gateway.contentDigest,
      retentionDays,
      transformIds: gateway.allowedTransformations,
      evidenceIds: [],
      expiresAt: gateway.retention.expiresAt,
      idempotencyKey: gateway.idempotencyKey || `agenticx_${gateway.immutableFingerprint.slice(0, 48)}`
    },
    gatewayRecord: {
      id: gateway.id,
      sourceId: gateway.sourceId,
      sourceApplicationId: gateway.sourceApplicationId,
      version: gateway.version,
      summary,
      contentDigest: gateway.contentDigest,
      sanitized: true,
      immutableFingerprint: gateway.immutableFingerprint,
      allowedPurposes: [...new Set(gateway.allowedPurposes)],
      allowedTransformations: [...new Set(gateway.allowedTransformations)],
      retention: clone(gateway.retention),
      tags: [...new Set(gateway.tags)]
    }
  };
}

function agenticXKnowledgeView(record) {
  if (!record?.gatewayRecord) return clone(record);
  return {
    id: record.id,
    schemaVersion: record.schemaVersion,
    tenantId: record.tenantId,
    workspaceId: record.workspaceId,
    sourceId: record.gatewayRecord.sourceId,
    sourceApplicationId: record.applicationId,
    version: record.gatewayRecord.version,
    summary: record.gatewayRecord.summary,
    contentDigest: record.digest,
    sanitized: true,
    immutableFingerprint: record.gatewayRecord.immutableFingerprint,
    classification: record.classification,
    region: record.region,
    allowedPurposes: clone(record.gatewayRecord.allowedPurposes),
    allowedTransformations: clone(record.gatewayRecord.allowedTransformations),
    retention: clone(record.gatewayRecord.retention),
    tags: clone(record.gatewayRecord.tags),
    createdAt: record.createdAt,
    revision: record.revision
  };
}

function normalizedPurpose(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text) ? text : "external_operation";
}

function validUsageEvidence(evidence, policy, now) {
  if (!evidence || evidence.status !== "verified" || evidence.authorized !== true) return false;
  const observedAt = comparableTimestamp(evidence.observedAt);
  if (!observedAt || observedAt > now || now - observedAt > Number(policy.evidence.maxAgeHours) * 60 * 60 * 1000) return false;
  return !evidence.expiresAt || comparableTimestamp(evidence.expiresAt) > now;
}

export class EnterpriseGovernanceService {
  constructor({ store, clock = () => new Date() } = {}) {
    if (!store || typeof store.readState !== "function" || typeof store.mutate !== "function") {
      throw new EnterpriseGovernanceError("Enterprise governance requires a Decision Continuity store with readState and mutate.", {
        code: "enterprise_governance_store_required",
        status: 500
      });
    }
    this.store = store;
    this.clock = clock;
  }

  now() {
    const value = this.clock();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new EnterpriseGovernanceError("Enterprise governance clock produced an invalid time.", { code: "invalid_clock", status: 500 });
    return date;
  }

  async bindApplication(input, context = {}) {
    const parsed = parseOrThrow(EnterpriseApplicationBindingSchema, input, "Application binding");
    const scope = scopeFor(context);
    const occurredAt = this.now().toISOString();
    return this.store.mutate((state, events) => {
      ensureEnterpriseGovernanceState(state);
      const claim = replayOrRemember(state, scope, "bind_application", parsed.idempotencyKey, parsed, occurredAt, () => {
        const existing = applicationBindingFor(state, scope, parsed.applicationId);
        const bindingFingerprint = digest({ ...parsed, idempotencyKey: undefined });
        if (existing) {
          if (existing.bindingFingerprint !== bindingFingerprint) {
            throw new EnterpriseGovernanceError("Application bindings are immutable. Bind a new application identifier rather than changing its enterprise boundary.", {
              code: "application_binding_immutable",
              status: 409
            });
          }
          return { status: "idempotent", binding: clone(existing) };
        }
        const binding = {
          id: id("enterprise_binding"),
          schemaVersion: ENTERPRISE_GOVERNANCE_SCHEMA_VERSION,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          applicationId: parsed.applicationId,
          enterpriseId: parsed.enterpriseId,
          applicationName: parsed.applicationName || null,
          dataClassification: parsed.dataClassification,
          homeRegion: parsed.homeRegion || null,
          bindingFingerprint,
          createdAt: occurredAt,
          revision: 1
        };
        state.enterpriseGovernanceBindings[binding.id] = binding;
        events.push(event({ type: "enterprise_governance.application_bound", tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: scope.actor, occurredAt, payload: { bindingId: binding.id, applicationId: binding.applicationId, enterpriseId: binding.enterpriseId, classification: binding.dataClassification } }));
        return { status: "bound", binding: clone(binding) };
      });
      return claim.replayed ? { ...claim.result, status: "idempotent" } : claim.result;
    });
  }

  async getApplicationBinding({ applicationId } = {}, context = {}) {
    const parsed = parseOrThrow(z.object({ applicationId: IdentifierSchema }).strict(), { applicationId }, "Application binding query");
    const scope = scopeFor(context);
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    return clone(requireApplicationBinding(state, scope, parsed.applicationId));
  }

  async listApplicationBindings({ enterpriseId, limit = 100 } = {}, context = {}) {
    const parsed = parseOrThrow(z.object({ enterpriseId: OptionalIdentifierSchema, limit: z.coerce.number().int().min(1).max(250).default(100) }).strict(), { enterpriseId, limit }, "Application binding list query");
    const scope = scopeFor(context);
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    return Object.values(state.enterpriseGovernanceBindings)
      .filter((record) => inScope(record, scope) && (!parsed.enterpriseId || record.enterpriseId === parsed.enterpriseId))
      .sort((left, right) => String(left.applicationId).localeCompare(String(right.applicationId)))
      .slice(0, parsed.limit).map(clone);
  }

  async setPolicy(input, context = {}) {
    const parsed = parseOrThrow(EnterprisePolicyInputSchema, input, "Enterprise policy");
    const scope = scopeFor(context);
    const occurredAt = this.now().toISOString();
    return this.store.mutate((state, events) => {
      ensureEnterpriseGovernanceState(state);
      const claim = replayOrRemember(state, scope, "set_policy", parsed.idempotencyKey, parsed, occurredAt, () => {
        const policyDigest = digest({ enterpriseId: parsed.enterpriseId, policyVersion: parsed.policyVersion, controls: parsed.controls, evidence: parsed.evidence });
        const existing = policyRecords(state, scope, parsed.enterpriseId).find((record) => record.policyVersion === parsed.policyVersion);
        if (existing) {
          if (existing.policyDigest !== policyDigest) {
            throw new EnterpriseGovernanceError("Policy versions are immutable; create a new policyVersion for changed controls.", { code: "policy_version_immutable", status: 409 });
          }
          return { status: "idempotent", policy: sanitizedPolicy(existing) };
        }
        const parent = policyFor(state, scope, { enterpriseId: parsed.enterpriseId });
        const policy = {
          id: id("enterprise_policy"),
          schemaVersion: ENTERPRISE_GOVERNANCE_SCHEMA_VERSION,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          enterpriseId: parsed.enterpriseId,
          policyVersion: parsed.policyVersion,
          controls: clone(parsed.controls),
          evidence: clone(parsed.evidence),
          policyDigest,
          parentPolicySnapshotId: parent?.id || null,
          createdAt: occurredAt,
          revision: 1
        };
        state.enterpriseGovernancePolicies[policy.id] = policy;
        events.push(event({ type: "enterprise_governance.policy_snapshot_created", tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: scope.actor, occurredAt, payload: { policySnapshotId: policy.id, enterpriseId: policy.enterpriseId, policyVersion: policy.policyVersion, policyDigest: policy.policyDigest, parentPolicySnapshotId: policy.parentPolicySnapshotId } }));
        return { status: "created", policy: sanitizedPolicy(policy) };
      });
      return claim.replayed ? { ...claim.result, status: "idempotent" } : claim.result;
    });
  }

  async getPolicy({ enterpriseId, policySnapshotId, policyId, policyVersion } = {}, context = {}) {
    const parsed = parseOrThrow(z.object({ enterpriseId: OptionalIdentifierSchema, policySnapshotId: OptionalIdentifierSchema, policyId: OptionalIdentifierSchema, policyVersion: OptionalIdentifierSchema }).strict(), { enterpriseId, policySnapshotId, policyId, policyVersion }, "Policy query");
    const scope = scopeFor(context);
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    const policy = policyFor(state, scope, { ...parsed, policySnapshotId: parsed.policySnapshotId || parsed.policyId });
    return policy ? sanitizedPolicy(policy) : null;
  }

  async readPolicy(query = {}, context = {}) {
    return this.getPolicy(query, context);
  }

  async listPolicySnapshots({ enterpriseId, limit = 100 } = {}, context = {}) {
    const parsed = parseOrThrow(z.object({ enterpriseId: OptionalIdentifierSchema, limit: z.coerce.number().int().min(1).max(250).default(100) }).strict(), { enterpriseId, limit }, "Policy list query");
    const scope = scopeFor(context);
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    return policyRecords(state, scope, parsed.enterpriseId).slice(0, parsed.limit).map(sanitizedPolicy);
  }

  evaluatePolicyInState(parsed, state, scope, nowDate = this.now()) {
    ensureEnterpriseGovernanceState(state);
    const now = nowDate.getTime();
    const binding = requireApplicationBinding(state, scope, parsed.applicationId);
    const policy = policyFor(state, scope, { enterpriseId: binding.enterpriseId, policySnapshotId: parsed.policySnapshotId });
    const action = parsed.action || parsed.operation;
    const reasonCodes = [];
    if (!policy) {
      return {
        status: "denied",
        allowed: false,
        action,
        applicationId: binding.applicationId,
        enterpriseId: binding.enterpriseId,
        policySnapshotId: parsed.policySnapshotId || null,
        policyVersion: null,
        policyDigest: null,
        reasonCodes: ["policy_snapshot_required"],
        budget: null
      };
    }

    const { data, evidence } = parsed;
    if (!policy.controls.dataClassification.allowed.includes(data.classification)) reasonCodes.push("data_classification_denied");
    if (classificationRank(data.classification) < classificationRank(binding.dataClassification)) reasonCodes.push("data_classification_downgrade_denied");
    if (!policy.controls.residency.allowedRegions.includes(data.region)) reasonCodes.push("residency_denied");
    if (binding.homeRegion && binding.homeRegion !== data.region) reasonCodes.push("application_residency_denied");
    if (!policy.controls.egress.allowedDestinations.includes(data.egress)) reasonCodes.push("egress_denied");
    if (data.retentionDays > policy.controls.retention.maxDays) reasonCodes.push("retention_denied");
    if (data.transformations.some((transform) => !policy.controls.transformations.allowed.includes(transform))) reasonCodes.push("transformation_denied");
    if (policy.controls.transformations.requireSanitizationFor.includes(data.classification) && !data.transformations.length) reasonCodes.push("sanitization_required");
    for (const controlId of policy.controls.compliance.requiredControlIds) {
      if (!data.complianceControlIds.includes(controlId)) reasonCodes.push(`compliance_${controlId}_required`);
    }

    const evidenceControls = [];
    if (policy.controls.dataClassification.evidenceRequired) evidenceControls.push("data_classification");
    if (policy.controls.residency.evidenceRequired) evidenceControls.push("residency");
    if (policy.controls.egress.evidenceRequired) evidenceControls.push("egress");
    if (policy.controls.retention.evidenceRequired) evidenceControls.push("retention");
    if (policy.controls.transformations.evidenceRequired) evidenceControls.push("transformations");
    if (policy.controls.compliance.evidenceRequired) {
      for (const controlId of policy.controls.compliance.requiredControlIds) evidenceControls.push(`compliance:${controlId}`);
    }
    addRequiredEvidenceReasons({ reasons: reasonCodes, evidence, scope, policy, now, controls: evidenceControls });

    if (policy.controls.humanApproval.requiredFor.includes(parsed.impactLevel)) {
      const approval = parsed.approval;
      const approvalEvidence = approval ? evidence.find((item) => item.id === approval.evidenceId) : null;
      const approvalValid = Boolean(approval && comparableTimestamp(approval.approvedAt) <= now && approvalEvidence && evidenceState(approvalEvidence, scope, ["human_approval"], policy, now) === "valid");
      if (!approvalValid) reasonCodes.push("human_approval_required");
    }

    const budgetRequest = parsed.budget || (parsed.budgetId ? { budgetId: parsed.budgetId, amount: null, currency: null } : null);
    let budget = null;
    const budgetRequired = policy.controls.budget.requireReservation && !["agenticx_knowledge_reuse", "knowledge_reuse"].includes(action);
    if (budgetRequired) {
      if (!budgetRequest) {
        reasonCodes.push("budget_reservation_required");
      } else {
        budget = budgetFor(state, scope, budgetRequest.budgetId);
        if (!budget || budget.enterpriseId !== binding.enterpriseId || (budget.applicationId && budget.applicationId !== binding.applicationId)) {
          reasonCodes.push("budget_scope_denied");
        } else if (budgetWindowStatus(budget, now) !== "active") {
          reasonCodes.push("budget_inactive");
        } else {
          const totals = budgetTotals(state, budget, now);
          if (budget.currency !== policy.controls.budget.currency || (budgetRequest.currency && budgetRequest.currency !== budget.currency)) reasonCodes.push("budget_currency_denied");
          if (budgetRequest.amount !== null && budgetRequest.amount > policy.controls.budget.maxReservationAmount) reasonCodes.push("budget_reservation_limit_denied");
          if (budgetRequest.amount !== null && budgetRequest.amount > totals.availableAmount) reasonCodes.push("budget_exhausted");
          budget = { budgetId: budget.id, currency: budget.currency, availableAmount: totals.availableAmount, lifecycleStatus: budgetWindowStatus(budget, now) };
        }
      }
    }

    return {
      status: reasonCodes.length ? "denied" : "permitted",
      allowed: reasonCodes.length === 0,
      action,
      applicationId: binding.applicationId,
      enterpriseId: binding.enterpriseId,
      policySnapshotId: policy.id,
      policyVersion: policy.policyVersion,
      policyDigest: policy.policyDigest,
      reasonCodes: [...new Set(reasonCodes)],
      budget
    };
  }

  async evaluatePolicy(input, context = {}) {
    const parsed = parseOrThrow(EnterprisePolicyEvaluationSchema, input, "Policy evaluation");
    const scope = scopeFor(context);
    const state = await this.store.readState();
    return this.evaluatePolicyInState(parsed, state, scope, this.now());
  }

  async evaluateModelRoute(input, context = {}) {
    return this.evaluatePolicy({ ...input, action: input?.action || input?.operation || "aix_model_route" }, context);
  }

  async resolveAIXContext(input = {}, context = {}) {
    const evaluation = await this.evaluateModelRoute(input, context);
    const parsed = parseOrThrow(EnterprisePolicyEvaluationSchema, { ...input, action: input?.action || input?.operation || "aix_model_route" }, "AIX policy context");
    return {
      allowed: evaluation.allowed,
      reasonCodes: evaluation.reasonCodes,
      context: {
        applicationId: evaluation.applicationId,
        enterpriseId: evaluation.enterpriseId,
        policySnapshotId: evaluation.policySnapshotId,
        policyVersion: evaluation.policyVersion,
        budgetId: parsed.budget?.budgetId || parsed.budgetId || null,
        data: clone(parsed.data)
      }
    };
  }

  async createBudget(input, context = {}) {
    const parsed = parseOrThrow(EnterpriseBudgetInputSchema, input, "Budget envelope");
    const scope = scopeFor(context);
    const occurredAt = this.now().toISOString();
    return this.store.mutate((state, events) => {
      ensureEnterpriseGovernanceState(state);
      const claim = replayOrRemember(state, scope, "create_budget", parsed.idempotencyKey, parsed, occurredAt, () => {
        if (parsed.applicationId) {
          const binding = requireApplicationBinding(state, scope, parsed.applicationId);
          if (binding.enterpriseId !== parsed.enterpriseId) throw new EnterpriseGovernanceError("Budget application and enterprise binding do not match.", { code: "budget_scope_denied", status: 409 });
        }
        const policy = policyFor(state, scope, { enterpriseId: parsed.enterpriseId, policySnapshotId: parsed.policySnapshotId });
        if (!policy) throw new EnterpriseGovernanceError("A versioned enterprise policy snapshot is required before creating a budget.", { code: "policy_snapshot_required", status: 409 });
        if (policy.controls.budget.currency !== parsed.currency) throw new EnterpriseGovernanceError("Budget currency is not permitted by the policy snapshot.", { code: "budget_currency_denied", status: 409 });
        const fingerprint = digest({ ...parsed, idempotencyKey: undefined, policySnapshotId: policy.id });
        const existing = Object.values(state.enterpriseGovernanceBudgets).find((record) => inScope(record, scope) && record.enterpriseId === parsed.enterpriseId && record.budgetKey === parsed.budgetKey);
        if (existing) {
          if (existing.budgetFingerprint !== fingerprint) throw new EnterpriseGovernanceError("Budget keys are immutable. Create a new budgetKey for a changed envelope.", { code: "budget_immutable", status: 409 });
          return { status: "idempotent", budget: budgetView(state, existing, Date.parse(occurredAt)) };
        }
        const budget = {
          id: id("enterprise_budget"),
          schemaVersion: ENTERPRISE_GOVERNANCE_SCHEMA_VERSION,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          budgetKey: parsed.budgetKey,
          enterpriseId: parsed.enterpriseId,
          applicationId: parsed.applicationId || null,
          policySnapshotId: policy.id,
          currency: parsed.currency,
          limitAmount: roundMoney(parsed.limitAmount),
          startsAt: parsed.startsAt || occurredAt,
          endsAt: parsed.endsAt || null,
          budgetFingerprint: fingerprint,
          createdAt: occurredAt,
          revision: 1
        };
        state.enterpriseGovernanceBudgets[budget.id] = budget;
        events.push(event({ type: "enterprise_governance.budget_created", tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: scope.actor, occurredAt, payload: { budgetId: budget.id, budgetKey: budget.budgetKey, enterpriseId: budget.enterpriseId, applicationId: budget.applicationId, policySnapshotId: budget.policySnapshotId, currency: budget.currency, limitAmount: budget.limitAmount } }));
        return { status: "created", budget: budgetView(state, budget, Date.parse(occurredAt)) };
      });
      return claim.replayed ? { ...claim.result, status: "idempotent" } : claim.result;
    });
  }

  async getBudget({ budgetId } = {}, context = {}) {
    const parsed = parseOrThrow(z.object({ budgetId: IdentifierSchema }).strict(), { budgetId }, "Budget query");
    const scope = scopeFor(context);
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    const budget = budgetFor(state, scope, parsed.budgetId);
    if (!budget) throw new EnterpriseGovernanceError("Budget was not found in this tenant/workspace.", { code: "budget_not_found", status: 404 });
    return budgetView(state, budget, this.now().getTime());
  }

  async listBudgets({ enterpriseId, applicationId, limit = 100 } = {}, context = {}) {
    const parsed = parseOrThrow(z.object({ enterpriseId: OptionalIdentifierSchema, applicationId: OptionalIdentifierSchema, limit: z.coerce.number().int().min(1).max(250).default(100) }).strict(), { enterpriseId, applicationId, limit }, "Budget list query");
    const scope = scopeFor(context);
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    const now = this.now().getTime();
    return Object.values(state.enterpriseGovernanceBudgets)
      .filter((record) => inScope(record, scope) && (!parsed.enterpriseId || record.enterpriseId === parsed.enterpriseId) && (!parsed.applicationId || record.applicationId === parsed.applicationId))
      .sort((left, right) => comparableTimestamp(right.createdAt) - comparableTimestamp(left.createdAt))
      .slice(0, parsed.limit).map((record) => budgetView(state, record, now));
  }

  async getReservation({ reservationId } = {}, context = {}) {
    const parsed = parseOrThrow(z.object({ reservationId: IdentifierSchema }).strict(), { reservationId }, "Budget reservation query");
    const scope = scopeFor(context);
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    const reservation = reservationFor(state, scope, parsed.reservationId);
    if (!reservation) throw new EnterpriseGovernanceError("Budget reservation was not found in this tenant/workspace.", { code: "budget_reservation_not_found", status: 404 });
    return clone(reservation);
  }

  async listReservations({ budgetId, applicationId, status, limit = 100 } = {}, context = {}) {
    const parsed = parseOrThrow(z.object({
      budgetId: OptionalIdentifierSchema,
      applicationId: OptionalIdentifierSchema,
      status: z.enum(["reserved", "settled", "released", "expired"]).optional(),
      limit: z.coerce.number().int().min(1).max(250).default(100)
    }).strict(), { budgetId, applicationId, status, limit }, "Budget reservation list query");
    const scope = scopeFor(context);
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    const now = this.now().getTime();
    return Object.values(state.enterpriseGovernanceReservations)
      .filter((record) => inScope(record, scope) && (!parsed.budgetId || record.budgetId === parsed.budgetId) && (!parsed.applicationId || record.applicationId === parsed.applicationId) && (!parsed.status || record.status === parsed.status))
      .sort((left, right) => comparableTimestamp(right.createdAt) - comparableTimestamp(left.createdAt))
      .slice(0, parsed.limit)
      .map((record) => ({ ...clone(record), lifecycleStatus: reservationActive(record, now) ? "active" : record.status === "reserved" ? "expired" : record.status }));
  }

  async reserveBudget(input, context = {}) {
    const parsed = parseOrThrow(ReserveBudgetSchema, input, "Budget reservation");
    const scope = scopeFor(context);
    const occurredAt = this.now().toISOString();
    return this.store.mutate((state, events) => {
      ensureEnterpriseGovernanceState(state);
      const claim = replayOrRemember(state, scope, "reserve_budget", parsed.idempotencyKey, parsed, occurredAt, () => {
        const budget = budgetFor(state, scope, parsed.budgetId);
        if (!budget) throw new EnterpriseGovernanceError("Budget was not found in this tenant/workspace.", { code: "budget_not_found", status: 404 });
        const applicationId = parsed.applicationId || budget.applicationId;
        if (!applicationId) throw new EnterpriseGovernanceError("A budget reservation requires an application binding or an application-scoped budget.", { code: "application_binding_required", status: 409 });
        const application = requireApplicationBinding(state, scope, applicationId);
        if (budget.enterpriseId !== application.enterpriseId || (budget.applicationId && budget.applicationId !== application.applicationId)) throw new EnterpriseGovernanceError("Budget is not authorized for this application binding.", { code: "budget_scope_denied", status: 403 });
        const now = Date.parse(occurredAt);
        if (budgetWindowStatus(budget, now) !== "active") throw new EnterpriseGovernanceError("Budget is not active.", { code: "budget_inactive", status: 409 });
        if (parsed.expiresAt && comparableTimestamp(parsed.expiresAt) <= now) throw new EnterpriseGovernanceError("Budget reservation expiry must be in the future.", { code: "invalid_reservation_expiry", status: 400 });
        const policy = policyFor(state, scope, { enterpriseId: budget.enterpriseId, policySnapshotId: parsed.policySnapshotId || budget.policySnapshotId });
        if (!policy) throw new EnterpriseGovernanceError("A matching policy snapshot is required for a budget reservation.", { code: "policy_snapshot_required", status: 409 });
        if (policy.id !== budget.policySnapshotId && parsed.policySnapshotId !== policy.id) throw new EnterpriseGovernanceError("Budget reservation policy must match the budget's immutable policy snapshot.", { code: "budget_policy_mismatch", status: 409 });
        if (parsed.currency !== budget.currency || parsed.currency !== policy.controls.budget.currency) throw new EnterpriseGovernanceError("Budget reservation currency is not permitted.", { code: "budget_currency_denied", status: 409 });
        if (parsed.amount > policy.controls.budget.maxReservationAmount) throw new EnterpriseGovernanceError("Budget reservation exceeds the policy limit.", { code: "budget_reservation_limit_denied", status: 409 });
        const totals = budgetTotals(state, budget, now);
        if (parsed.amount > totals.availableAmount) throw new EnterpriseGovernanceError("Budget envelope has insufficient available funds for this reservation.", { code: "budget_exhausted", status: 409 });
        const reservation = {
          id: id("enterprise_reservation"),
          schemaVersion: ENTERPRISE_GOVERNANCE_SCHEMA_VERSION,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          budgetId: budget.id,
          enterpriseId: budget.enterpriseId,
          applicationId: application.applicationId,
          policySnapshotId: policy.id,
          purpose: normalizedPurpose(parsed.purpose),
          purposeDigest: digest(parsed.purpose),
          currency: parsed.currency,
          estimatedAmount: roundMoney(parsed.amount),
          actualAmount: null,
          status: "reserved",
          expiresAt: parsed.expiresAt || null,
          usageEvidence: null,
          createdAt: occurredAt,
          updatedAt: occurredAt,
          revision: 1
        };
        state.enterpriseGovernanceReservations[reservation.id] = reservation;
        events.push(event({ type: "enterprise_governance.budget_reserved", tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: scope.actor, occurredAt, payload: { reservationId: reservation.id, budgetId: reservation.budgetId, applicationId: reservation.applicationId, policySnapshotId: reservation.policySnapshotId, purpose: reservation.purpose, estimatedAmount: reservation.estimatedAmount, currency: reservation.currency } }));
        return { status: "reserved", reservation: clone(reservation), budget: budgetView(state, budget, now) };
      });
      return claim.replayed ? { ...claim.result, status: "idempotent" } : claim.result;
    });
  }

  async settleBudget(input, context = {}) {
    const parsed = parseOrThrow(SettleBudgetSchema, input, "Budget settlement");
    const scope = scopeFor(context);
    const occurredAt = this.now().toISOString();
    return this.store.mutate((state, events) => {
      ensureEnterpriseGovernanceState(state);
      const claim = replayOrRemember(state, scope, "settle_budget", parsed.idempotencyKey, parsed, occurredAt, () => {
        const reservation = reservationFor(state, scope, parsed.reservationId);
        if (!reservation) throw new EnterpriseGovernanceError("Budget reservation was not found in this tenant/workspace.", { code: "budget_reservation_not_found", status: 404 });
        if (reservation.status !== "reserved") throw new EnterpriseGovernanceError("Only an active budget reservation may be settled.", { code: "invalid_reservation_state", status: 409 });
        const budget = budgetFor(state, scope, reservation.budgetId);
        if (!budget) throw new EnterpriseGovernanceError("Reservation budget was not found.", { code: "budget_not_found", status: 409 });
        const policy = policyFor(state, scope, { enterpriseId: budget.enterpriseId, policySnapshotId: reservation.policySnapshotId });
        if (!policy) throw new EnterpriseGovernanceError("Reservation policy snapshot was not found.", { code: "policy_snapshot_required", status: 409 });
        const now = Date.parse(occurredAt);
        if (!reservationActive(reservation, now)) {
          reservation.status = "expired";
          reservation.updatedAt = occurredAt;
          reservation.revision += 1;
          events.push(event({ type: "enterprise_governance.budget_reservation_expired", tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: scope.actor, occurredAt, payload: { reservationId: reservation.id, budgetId: reservation.budgetId } }));
          throw new EnterpriseGovernanceError("Budget reservation has expired and cannot be settled.", { code: "budget_reservation_expired", status: 409 });
        }
        if (parsed.currency !== reservation.currency || parsed.currency !== budget.currency) throw new EnterpriseGovernanceError("Settlement currency does not match the reservation.", { code: "budget_currency_denied", status: 409 });
        if (parsed.actualAmount > policy.controls.budget.maxReservationAmount) throw new EnterpriseGovernanceError("Settlement exceeds the policy reservation limit.", { code: "budget_reservation_limit_denied", status: 409 });
        if (!validUsageEvidence(parsed.usageEvidence, policy, now)) throw new EnterpriseGovernanceError("Actual provider cost requires current, authorized, verified usage evidence.", { code: "usage_evidence_required", status: 409 });
        const totalsWithoutReservation = budgetTotals(state, budget, now, { excludeReservationId: reservation.id });
        if (roundMoney(totalsWithoutReservation.committedAmount + parsed.actualAmount) > budget.limitAmount) throw new EnterpriseGovernanceError("Settlement would exceed the budget envelope.", { code: "budget_exhausted", status: 409 });
        reservation.status = "settled";
        reservation.actualAmount = roundMoney(parsed.actualAmount);
        reservation.usageEvidence = {
          id: parsed.usageEvidence.id,
          source: parsed.usageEvidence.source,
          status: parsed.usageEvidence.status,
          observedAt: parsed.usageEvidence.observedAt,
          expiresAt: parsed.usageEvidence.expiresAt || null,
          digest: parsed.usageEvidence.digest || null
        };
        reservation.updatedAt = occurredAt;
        reservation.revision += 1;
        events.push(event({ type: "enterprise_governance.budget_settled", tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: scope.actor, occurredAt, payload: { reservationId: reservation.id, budgetId: reservation.budgetId, estimatedAmount: reservation.estimatedAmount, actualAmount: reservation.actualAmount, currency: reservation.currency, usageEvidenceId: reservation.usageEvidence.id } }));
        return { status: "settled", reservation: clone(reservation), budget: budgetView(state, budget, now) };
      });
      return claim.replayed ? { ...claim.result, status: "idempotent" } : claim.result;
    });
  }

  async releaseBudget(input, context = {}) {
    const parsed = parseOrThrow(ReleaseBudgetSchema, input, "Budget release");
    const scope = scopeFor(context);
    const occurredAt = this.now().toISOString();
    return this.store.mutate((state, events) => {
      ensureEnterpriseGovernanceState(state);
      const claim = replayOrRemember(state, scope, "release_budget", parsed.idempotencyKey, parsed, occurredAt, () => {
        const reservation = reservationFor(state, scope, parsed.reservationId);
        if (!reservation) throw new EnterpriseGovernanceError("Budget reservation was not found in this tenant/workspace.", { code: "budget_reservation_not_found", status: 404 });
        if (reservation.status !== "reserved") throw new EnterpriseGovernanceError("Only an active budget reservation may be released.", { code: "invalid_reservation_state", status: 409 });
        const budget = budgetFor(state, scope, reservation.budgetId);
        if (!budget) throw new EnterpriseGovernanceError("Reservation budget was not found.", { code: "budget_not_found", status: 409 });
        reservation.status = "released";
        reservation.releaseReasonDigest = digest(parsed.reason);
        reservation.updatedAt = occurredAt;
        reservation.revision += 1;
        events.push(event({ type: "enterprise_governance.budget_released", tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: scope.actor, occurredAt, payload: { reservationId: reservation.id, budgetId: reservation.budgetId, reasonDigest: reservation.releaseReasonDigest } }));
        return { status: "released", reservation: clone(reservation), budget: budgetView(state, budget, Date.parse(occurredAt)) };
      });
      return claim.replayed ? { ...claim.result, status: "idempotent" } : claim.result;
    });
  }

  async reserveResearchBudget(input = {}, context = {}) {
    const { sourceId, runId, ...reservation } = input || {};
    return this.reserveBudget(reservation, context);
  }

  async settleResearchBudget(input = {}, context = {}) {
    return this.settleBudget(input, context);
  }

  async releaseResearchBudget(input = {}, context = {}) {
    return this.releaseBudget(input, context);
  }

  async createDecisionContext(input, context = {}) {
    const parsed = parseOrThrow(EnterpriseDecisionContextSchema, input, "Decision context");
    const scope = scopeFor(context);
    const occurredAt = this.now().toISOString();
    return this.store.mutate((state, events) => {
      ensureEnterpriseGovernanceState(state);
      const claim = replayOrRemember(state, scope, "create_decision_context", parsed.idempotencyKey, parsed, occurredAt, () => {
        const binding = requireApplicationBinding(state, scope, parsed.applicationId);
        const policy = parsed.policySnapshotId ? policyFor(state, scope, { enterpriseId: binding.enterpriseId, policySnapshotId: parsed.policySnapshotId }) : policyFor(state, scope, { enterpriseId: binding.enterpriseId });
        if (parsed.policySnapshotId && !policy) throw new EnterpriseGovernanceError("Decision context policy snapshot is not available for this application enterprise.", { code: "policy_snapshot_required", status: 409 });
        if (parsed.budgetReservationId) {
          const reservation = reservationFor(state, scope, parsed.budgetReservationId);
          if (!reservation || reservation.applicationId !== binding.applicationId || reservation.enterpriseId !== binding.enterpriseId) throw new EnterpriseGovernanceError("Decision context budget reservation is not scoped to this application.", { code: "budget_scope_denied", status: 403 });
          if (policy && reservation.policySnapshotId !== policy.id) throw new EnterpriseGovernanceError("Decision context policy and budget reservation snapshots do not match.", { code: "budget_policy_mismatch", status: 409 });
        }
        if (policy?.controls.humanApproval.requiredFor.includes(parsed.impactLevel)) {
          if (!parsed.approval || !parsed.evidenceIds.includes(parsed.approval.evidenceId) || comparableTimestamp(parsed.approval.approvedAt) > Date.parse(occurredAt)) {
            throw new EnterpriseGovernanceError("High-impact decision contexts require a prior explicit human approval evidence reference.", { code: "human_approval_required", status: 409 });
          }
        }
        const decisionContext = {
          id: id("enterprise_decision_context"),
          schemaVersion: ENTERPRISE_GOVERNANCE_SCHEMA_VERSION,
          recordType: "decision_context",
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          enterpriseId: binding.enterpriseId,
          applicationId: binding.applicationId,
          decisionKey: parsed.decisionKey,
          workflowId: parsed.workflowId,
          decisionType: parsed.decisionType,
          policySnapshotId: policy?.id || null,
          budgetReservationId: parsed.budgetReservationId || null,
          affectedConnectionIds: [...new Set(parsed.affectedConnectionIds)],
          evidenceIds: [...new Set(parsed.evidenceIds)],
          paths: clone(parsed.paths),
          selectedPathId: parsed.selectedPathId || null,
          validation: clone(parsed.validation),
          outcome: parsed.outcome,
          impactLevel: parsed.impactLevel,
          approval: parsed.approval ? { approverId: parsed.approval.approverId, approvedAt: parsed.approval.approvedAt, evidenceId: parsed.approval.evidenceId } : null,
          createdAt: occurredAt,
          revision: 1
        };
        state.enterpriseGovernanceDecisionContexts[decisionContext.id] = decisionContext;
        events.push(event({ type: "enterprise_governance.decision_context_recorded", tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: scope.actor, occurredAt, payload: { decisionContextId: decisionContext.id, applicationId: decisionContext.applicationId, decisionKey: decisionContext.decisionKey, workflowId: decisionContext.workflowId, policySnapshotId: decisionContext.policySnapshotId, budgetReservationId: decisionContext.budgetReservationId, outcome: decisionContext.outcome, selectedPathId: decisionContext.selectedPathId } }));
        return { status: "recorded", decisionContext: clone(decisionContext) };
      });
      return claim.replayed ? { ...claim.result, status: "idempotent" } : claim.result;
    });
  }

  async recordDecisionContext(input, context = {}) {
    if (input && typeof input === "object" && input.branchId && !input.decisionKey) return this.recordBuildDecisionContext(input, context);
    return this.createDecisionContext(input, context);
  }

  async recordEnterpriseDecisionContext(input, context = {}) {
    return this.recordDecisionContext(input, context);
  }

  async recordBuildDecisionContext(input, context = {}) {
    const scope = scopeFor(context);
    const { tenantId: suppliedTenantId, workspaceId: suppliedWorkspaceId, ...payload } = input || {};
    if ((suppliedTenantId && suppliedTenantId !== scope.tenantId) || (suppliedWorkspaceId && suppliedWorkspaceId !== scope.workspaceId)) {
      throw new EnterpriseGovernanceError("DecisionX build capture cannot cross tenant/workspace scope.", { code: "cross_tenant_denied", status: 403 });
    }
    const parsed = parseOrThrow(DecisionBuildCaptureSchema, payload, "DecisionX build capture");
    const occurredAt = this.now().toISOString();
    return this.store.mutate((state, events) => {
      ensureEnterpriseGovernanceState(state);
      const claim = replayOrRemember(state, scope, "record_build_decision_context", parsed.idempotencyKey, parsed, occurredAt, () => {
        const binding = requireApplicationBinding(state, scope, parsed.applicationId);
        if (parsed.enterpriseId && parsed.enterpriseId !== binding.enterpriseId) throw new EnterpriseGovernanceError("Build capture enterprise does not match the immutable application binding.", { code: "application_binding_immutable", status: 409 });
        const policy = parsed.policySnapshotId ? policyFor(state, scope, { enterpriseId: binding.enterpriseId, policySnapshotId: parsed.policySnapshotId }) : null;
        if (parsed.policySnapshotId && !policy) throw new EnterpriseGovernanceError("Build capture policy snapshot is unavailable for this enterprise.", { code: "policy_snapshot_required", status: 409 });
        const receipt = {
          id: id("enterprise_build_decision_capture"),
          schemaVersion: ENTERPRISE_GOVERNANCE_SCHEMA_VERSION,
          recordType: "decision_build_capture",
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          enterpriseId: binding.enterpriseId,
          applicationId: binding.applicationId,
          branchId: parsed.branchId,
          stage: parsed.stage,
          policySnapshotId: policy?.id || null,
          budgetScopeId: parsed.budgetScopeId || null,
          evidenceRefs: [...new Set(parsed.evidenceRefs)],
          outcome: clone(parsed.outcome),
          createdAt: occurredAt,
          revision: 1
        };
        state.enterpriseGovernanceDecisionContexts[receipt.id] = receipt;
        events.push(event({ type: "enterprise_governance.build_decision_captured", tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: scope.actor, occurredAt, payload: { receiptId: receipt.id, branchId: receipt.branchId, applicationId: receipt.applicationId, stage: receipt.stage, policySnapshotId: receipt.policySnapshotId, budgetScopeId: receipt.budgetScopeId, outcome: receipt.outcome } }));
        return { status: "recorded", receipt: clone(receipt), decisionContext: clone(receipt) };
      });
      return claim.replayed ? { ...claim.result, status: "idempotent" } : claim.result;
    });
  }

  async getDecisionContext({ decisionContextId } = {}, context = {}) {
    const parsed = parseOrThrow(z.object({ decisionContextId: IdentifierSchema }).strict(), { decisionContextId }, "Decision context query");
    const scope = scopeFor(context);
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    const record = state.enterpriseGovernanceDecisionContexts[parsed.decisionContextId];
    requireScoped(record, scope, "Decision context");
    if (!["decision_context", "decision_build_capture"].includes(record.recordType)) throw new EnterpriseGovernanceError("Decision context was not found.", { code: "enterprise_governance_not_found", status: 404 });
    return clone(record);
  }

  async listDecisionContexts({ applicationId, decisionKey, workflowId, branchId, limit = 100 } = {}, context = {}) {
    const parsed = parseOrThrow(z.object({ applicationId: OptionalIdentifierSchema, decisionKey: OptionalIdentifierSchema, workflowId: OptionalIdentifierSchema, branchId: OptionalIdentifierSchema, limit: z.coerce.number().int().min(1).max(250).default(100) }).strict(), { applicationId, decisionKey, workflowId, branchId, limit }, "Decision context list query");
    const scope = scopeFor(context);
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    return Object.values(state.enterpriseGovernanceDecisionContexts)
      .filter((record) => inScope(record, scope) && ["decision_context", "decision_build_capture"].includes(record.recordType) && (!parsed.applicationId || record.applicationId === parsed.applicationId) && (!parsed.decisionKey || record.decisionKey === parsed.decisionKey) && (!parsed.workflowId || record.workflowId === parsed.workflowId) && (!parsed.branchId || record.branchId === parsed.branchId))
      .sort((left, right) => comparableTimestamp(right.createdAt) - comparableTimestamp(left.createdAt))
      .slice(0, parsed.limit).map(clone);
  }

  async recordModelRouteReceipt(input, context = {}) {
    const parsed = parseOrThrow(ModelRouteReceiptSchema, input, "Model route receipt");
    const scope = scopeFor(context);
    const occurredAt = this.now().toISOString();
    return this.store.mutate((state, events) => {
      ensureEnterpriseGovernanceState(state);
      const claim = replayOrRemember(state, scope, "record_model_route_receipt", parsed.idempotencyKey, parsed, occurredAt, () => {
        const binding = requireApplicationBinding(state, scope, parsed.applicationId);
        const policy = parsed.policySnapshotId ? policyFor(state, scope, { enterpriseId: binding.enterpriseId, policySnapshotId: parsed.policySnapshotId }) : null;
        if (parsed.policySnapshotId && !policy) throw new EnterpriseGovernanceError("Model route receipt policy snapshot is not available for this application enterprise.", { code: "policy_snapshot_required", status: 409 });
        if (["routed", "executed"].includes(parsed.status) && !policy) throw new EnterpriseGovernanceError("A selected model route must carry an authoritative policy snapshot.", { code: "policy_snapshot_required", status: 409 });
        if (["routed", "executed"].includes(parsed.status) && (!parsed.provider || !parsed.modelId || !parsed.immutableRevision)) throw new EnterpriseGovernanceError("A selected model route must identify its pinned provider, model, and revision.", { code: "model_route_provenance_required", status: 409 });
        if (parsed.budgetReservationId) {
          const reservation = reservationFor(state, scope, parsed.budgetReservationId);
          if (!reservation || reservation.applicationId !== binding.applicationId || reservation.enterpriseId !== binding.enterpriseId) throw new EnterpriseGovernanceError("Model route budget reservation is not scoped to this application.", { code: "budget_scope_denied", status: 403 });
          if (policy && reservation.policySnapshotId !== policy.id) throw new EnterpriseGovernanceError("Model route policy and budget reservation snapshots do not match.", { code: "budget_policy_mismatch", status: 409 });
        }
        const receipt = {
          id: id("enterprise_model_route_receipt"),
          schemaVersion: ENTERPRISE_GOVERNANCE_SCHEMA_VERSION,
          recordType: "model_route_receipt",
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          enterpriseId: binding.enterpriseId,
          applicationId: binding.applicationId,
          routeId: parsed.routeId,
          policySnapshotId: policy?.id || null,
          budgetReservationId: parsed.budgetReservationId || null,
          registrationId: parsed.registrationId || null,
          provider: parsed.provider || null,
          modelId: parsed.modelId || null,
          immutableRevision: parsed.immutableRevision || null,
          taskRole: parsed.taskRole,
          status: parsed.status,
          reasonCodes: [...new Set(parsed.reasonCodes)],
          eligibleCandidates: clone(parsed.eligibleCandidates),
          excludedCandidates: clone(parsed.excludedCandidates),
          estimatedCost: roundMoney(parsed.estimatedCost),
          actualCost: parsed.actualCost === null ? null : roundMoney(parsed.actualCost),
          usageEvidenceId: parsed.usageEvidenceId || null,
          createdAt: occurredAt,
          revision: 1
        };
        state.enterpriseGovernanceDecisionContexts[receipt.id] = receipt;
        events.push(event({ type: "enterprise_governance.model_route_receipt_recorded", tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: scope.actor, occurredAt, payload: { receiptId: receipt.id, applicationId: receipt.applicationId, routeId: receipt.routeId, policySnapshotId: receipt.policySnapshotId, budgetReservationId: receipt.budgetReservationId, registrationId: receipt.registrationId, status: receipt.status, reasonCodes: receipt.reasonCodes, estimatedCost: receipt.estimatedCost, actualCost: receipt.actualCost, usageEvidenceId: receipt.usageEvidenceId } }));
        return { status: "recorded", receipt: clone(receipt) };
      });
      return claim.replayed ? { ...claim.result, status: "idempotent" } : claim.result;
    });
  }

  async listModelRouteReceipts({ applicationId, routeId, limit = 100 } = {}, context = {}) {
    const parsed = parseOrThrow(z.object({ applicationId: OptionalIdentifierSchema, routeId: OptionalIdentifierSchema, limit: z.coerce.number().int().min(1).max(250).default(100) }).strict(), { applicationId, routeId, limit }, "Model route receipt list query");
    const scope = scopeFor(context);
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    return Object.values(state.enterpriseGovernanceDecisionContexts)
      .filter((record) => inScope(record, scope) && record.recordType === "model_route_receipt" && (!parsed.applicationId || record.applicationId === parsed.applicationId) && (!parsed.routeId || record.routeId === parsed.routeId))
      .sort((left, right) => comparableTimestamp(right.createdAt) - comparableTimestamp(left.createdAt))
      .slice(0, parsed.limit).map(clone);
  }

  async registerAgenticXKnowledge(input, context = {}) {
    const scope = scopeFor(context);
    const occurredAt = this.now().toISOString();
    const normalized = normalizeAgenticXKnowledgeInput(input, Date.parse(occurredAt));
    const parsed = parseOrThrow(AgenticXKnowledgeSchema, normalized.parsedInput, "AgenticX knowledge registration");
    return this.store.mutate((state, events) => {
      ensureEnterpriseGovernanceState(state);
      const claim = replayOrRemember(state, scope, "register_agenticx_knowledge", parsed.idempotencyKey, parsed, occurredAt, () => {
        const binding = requireApplicationBinding(state, scope, parsed.applicationId);
        if (parsed.expiresAt && comparableTimestamp(parsed.expiresAt) <= Date.parse(occurredAt)) throw new EnterpriseGovernanceError("AgenticX knowledge expiry must be in the future.", { code: "invalid_knowledge_expiry", status: 400 });
        const fingerprint = digest({ ...parsed, idempotencyKey: undefined, gatewayRecord: normalized.gatewayRecord ? { id: normalized.gatewayRecord.id, immutableFingerprint: normalized.gatewayRecord.immutableFingerprint } : null });
        const existing = Object.values(state.agenticXKnowledge).find((record) => inScope(record, scope) && record.recordType === "agenticx_knowledge" && record.applicationId === binding.applicationId && record.knowledgeId === parsed.knowledgeId);
        if (existing) {
          if (existing.knowledgeFingerprint !== fingerprint) throw new EnterpriseGovernanceError("AgenticX knowledge identifiers are immutable. Register a new identifier for changed sanitized metadata.", { code: "agenticx_knowledge_immutable", status: 409 });
          return { status: "idempotent", knowledge: agenticXKnowledgeView(existing) };
        }
        const knowledge = {
          id: normalized.gatewayRecord?.id || id("enterprise_agenticx_knowledge"),
          schemaVersion: ENTERPRISE_GOVERNANCE_SCHEMA_VERSION,
          recordType: "agenticx_knowledge",
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          enterpriseId: binding.enterpriseId,
          applicationId: binding.applicationId,
          knowledgeId: parsed.knowledgeId,
          classification: parsed.classification,
          region: parsed.region,
          digest: parsed.digest,
          retentionDays: parsed.retentionDays,
          transformIds: [...new Set(parsed.transformIds)],
          evidenceIds: [...new Set(parsed.evidenceIds)],
          expiresAt: parsed.expiresAt || null,
          gatewayRecord: normalized.gatewayRecord ? clone(normalized.gatewayRecord) : null,
          knowledgeFingerprint: fingerprint,
          createdAt: occurredAt,
          revision: 1
        };
        state.agenticXKnowledge[knowledge.id] = knowledge;
        events.push(event({ type: "enterprise_governance.agenticx_knowledge_registered", tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: scope.actor, occurredAt, payload: { knowledgeRecordId: knowledge.id, applicationId: knowledge.applicationId, knowledgeId: knowledge.knowledgeId, classification: knowledge.classification, region: knowledge.region, digest: knowledge.digest, expiresAt: knowledge.expiresAt } }));
        return { status: "registered", knowledge: agenticXKnowledgeView(knowledge) };
      });
      return claim.replayed ? { ...claim.result, status: "idempotent" } : claim.result;
    });
  }

  async listAgenticXKnowledge(query = {}, context = {}) {
    const { applicationId, tenantId, workspaceId, limit = 100 } = query || {};
    const parsed = parseOrThrow(z.object({ applicationId: OptionalIdentifierSchema, tenantId: OptionalIdentifierSchema, workspaceId: OptionalIdentifierSchema, limit: z.coerce.number().int().min(1).max(250).default(100) }).strict(), { applicationId, tenantId, workspaceId, limit }, "AgenticX knowledge list query");
    const scope = scopeFor(context);
    if ((parsed.tenantId && parsed.tenantId !== scope.tenantId) || (parsed.workspaceId && parsed.workspaceId !== scope.workspaceId)) {
      throw new EnterpriseGovernanceError("AgenticX knowledge query cannot cross tenant/workspace scope.", { code: "cross_tenant_denied", status: 403 });
    }
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    const now = this.now().getTime();
    return Object.values(state.agenticXKnowledge)
      .filter((record) => inScope(record, scope) && record.recordType === "agenticx_knowledge" && (!parsed.applicationId || record.applicationId === parsed.applicationId))
      .filter((record) => !record.expiresAt || comparableTimestamp(record.expiresAt) > now)
      .sort((left, right) => comparableTimestamp(right.createdAt) - comparableTimestamp(left.createdAt))
      .slice(0, parsed.limit).map(agenticXKnowledgeView);
  }

  /**
   * Authoritatively retrieves tenant-wide reusable knowledge without exposing
   * candidate identities before access has been approved.  Cross-workspace
   * discovery is intentionally internal: every candidate is passed through
   * requestKnowledgeReuse, which enforces the target application's binding,
   * enterprise boundary, immutable policy snapshot, evidence, data controls,
   * and sanitization receipt before its bounded summary can leave this method.
   */
  async retrieveAgenticXKnowledge(input, context = {}) {
    const parsed = parseOrThrow(TenantKnowledgeRetrievalSchema, input, "AgenticX tenant knowledge retrieval");
    const scope = scopeFor(context);
    const now = this.now().getTime();
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    // Fail before looking at candidate metadata when the requesting
    // application has no local enterprise authority.
    requireApplicationBinding(state, scope, parsed.targetApplicationId);

    const requestedIds = new Set(parsed.knowledgeIds);
    const candidates = Object.values(state.agenticXKnowledge)
      .filter((record) => record?.tenantId === scope.tenantId && record.recordType === "agenticx_knowledge")
      .filter((record) => !parsed.sourceApplicationId || record.applicationId === parsed.sourceApplicationId)
      .filter((record) => !record.expiresAt || comparableTimestamp(record.expiresAt) > now)
      .filter((record) => !requestedIds.size || requestedIds.has(record.id) || requestedIds.has(record.knowledgeId))
      .filter((record) => Boolean(record.gatewayRecord?.sanitized) && Boolean(safeSanitizedSummary(record.gatewayRecord?.summary)))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));

    const knowledge = [];
    const allowedReceipts = [];
    for (const candidate of candidates) {
      if (knowledge.length >= parsed.maxResults) break;
      const outcome = await this.requestKnowledgeReuse({
        sourceApplicationId: candidate.applicationId,
        targetApplicationId: parsed.targetApplicationId,
        purpose: parsed.purpose,
        ...(parsed.policySnapshotId ? { policySnapshotId: parsed.policySnapshotId } : {}),
        data: parsed.data,
        evidence: parsed.evidence,
        knowledgeReferences: [{ id: candidate.knowledgeId, digest: candidate.digest, classification: candidate.classification, sourceWorkspaceId: candidate.workspaceId }],
        sanitization: parsed.sanitization,
        impactLevel: parsed.impactLevel,
        ...(parsed.approval ? { approval: parsed.approval } : {}),
        idempotencyKey: `tenant_knowledge_${digest({ retrieval: parsed.idempotencyKey, candidateId: candidate.id }).slice(0, 48)}`
      }, context);
      if (outcome.receipt?.status !== "allowed") continue;
      const safe = agenticXKnowledgeView(candidate);
      // agenticXKnowledgeView is deliberately the only object that can leave
      // this boundary; it holds a sanitized summary and never raw content.
      if (!safe?.sanitized || !safeSanitizedSummary(safe.summary)) continue;
      if (knowledge.length < parsed.maxResults) knowledge.push(safe);
      allowedReceipts.push({ id: outcome.receipt.id, status: "allowed", policySnapshotId: outcome.receipt.policySnapshotId || null });
    }

    const status = knowledge.length ? "allowed" : "denied";
    // A single opaque retrieval receipt covers the no-candidate case and lets
    // the strict API/UI audit a retrieval without leaking denied candidates.
    const retrieval = await this.recordAgenticXReuseReceipt({
      id: `enterprise_agenticx_retrieval_${digest({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, idempotencyKey: parsed.idempotencyKey }).slice(0, 48)}`,
      status,
      purpose: parsed.purpose,
      region: parsed.data.region,
      egress: parsed.data.egress,
      transformation: parsed.sanitization.transformIds[0],
      maxClassification: parsed.data.classification,
      targetApplicationId: parsed.targetApplicationId,
      policySnapshotId: parsed.policySnapshotId || null,
      allowedKnowledgeIds: knowledge.map((item) => item.id),
      deniedCandidates: [],
      denialReasons: status === "allowed" ? [] : ["no_eligible_knowledge"],
      policyReceiptIds: allowedReceipts.map((receipt) => receipt.id),
      idempotencyKey: `retrieve_agenticx_${digest(parsed.idempotencyKey).slice(0, 48)}`
    }, context);
    return {
      status,
      knowledge: clone(knowledge),
      // Per-candidate receipt references are only disclosed for allowed
      // knowledge. Denied candidate IDs and reasons remain durable but hidden.
      receipts: clone(allowedReceipts),
      receipt: clone(retrieval.receipt),
      denialReasons: status === "allowed" ? [] : ["no_eligible_knowledge"]
    };
  }

  async retrieveTenantAgenticXKnowledge(input, context = {}) {
    return this.retrieveAgenticXKnowledge(input, context);
  }

  async requestKnowledgeReuse(input, context = {}) {
    const parsed = parseOrThrow(EnterpriseKnowledgeReuseRequestSchema, input, "Knowledge reuse request");
    const scope = scopeFor(context);
    const occurredAt = this.now().toISOString();
    return this.store.mutate((state, events) => {
      ensureEnterpriseGovernanceState(state);
      const claim = replayOrRemember(state, scope, "request_knowledge_reuse", parsed.idempotencyKey, parsed, occurredAt, () => {
        const knowledge = parsed.knowledgeReferences.map((reference) => Object.values(state.agenticXKnowledge).find((record) => record.tenantId === scope.tenantId && record.recordType === "agenticx_knowledge" && record.applicationId === parsed.sourceApplicationId && record.knowledgeId === reference.id && (!reference.sourceWorkspaceId || record.workspaceId === reference.sourceWorkspaceId)) || null);
        // A tenant-wide source must be tied to the workspace that registered
        // its knowledge.  Do not let a same-named application binding in the
        // caller's workspace substitute a different enterprise boundary.
        const sourceKnowledge = knowledge.find(Boolean);
        const source = (sourceKnowledge && Object.values(state.enterpriseGovernanceBindings).find((binding) => binding.tenantId === scope.tenantId && binding.workspaceId === sourceKnowledge.workspaceId && binding.applicationId === parsed.sourceApplicationId && binding.enterpriseId === sourceKnowledge.enterpriseId)) || applicationBindingFor(state, scope, parsed.sourceApplicationId) || tenantApplicationBindingFor(state, scope.tenantId, parsed.sourceApplicationId);
        if (!source) throw new EnterpriseGovernanceError("Source application is not bound to this tenant enterprise.", { code: "application_binding_required", status: 409 });
        const target = requireApplicationBinding(state, scope, parsed.targetApplicationId);
        const reasonCodes = [];
        if (source.enterpriseId !== target.enterpriseId) reasonCodes.push("cross_enterprise_knowledge_denied");
        if (knowledge.some((record) => record && record.enterpriseId !== source.enterpriseId)) reasonCodes.push("knowledge_source_binding_mismatch");
        if (knowledge.some((record) => !record)) reasonCodes.push("knowledge_unregistered");
        const now = Date.parse(occurredAt);
        if (knowledge.some((record) => record?.expiresAt && comparableTimestamp(record.expiresAt) <= now)) reasonCodes.push("knowledge_expired");
        if (knowledge.some((record, index) => record && record.digest !== parsed.knowledgeReferences[index].digest && parsed.knowledgeReferences[index].digest)) reasonCodes.push("knowledge_digest_mismatch");
        const highestClassification = knowledge.reduce((highest, record) => Math.max(highest, record ? classificationRank(record.classification) : -1), -1);
        if (highestClassification >= 0 && classificationRank(parsed.data.classification) < highestClassification) reasonCodes.push("knowledge_classification_downgrade_denied");
        for (const record of knowledge.filter(Boolean)) {
          const gateway = record.gatewayRecord;
          if (!gateway) continue;
          if (!gateway.sanitized || !safeSanitizedSummary(gateway.summary)) reasonCodes.push("unsanitized_knowledge_denied");
          if (!gateway.allowedPurposes.includes(parsed.purpose)) reasonCodes.push("knowledge_purpose_denied");
          if (record.region !== parsed.data.region) reasonCodes.push("knowledge_region_denied");
          if (parsed.sanitization.transformIds.some((transform) => !gateway.allowedTransformations.includes(transform) || !record.transformIds.includes(transform))) reasonCodes.push("knowledge_transformation_denied");
          if (gateway.retention?.notBefore && comparableTimestamp(gateway.retention.notBefore) > now) reasonCodes.push("knowledge_not_yet_available");
          if (record.expiresAt && comparableTimestamp(record.expiresAt) < now + parsed.data.retentionDays * 24 * 60 * 60 * 1000) reasonCodes.push("knowledge_retention_insufficient");
        }
        if (parsed.sanitization.transformIds.some((transform) => !parsed.data.transformations.includes(transform))) reasonCodes.push("sanitization_transform_mismatch");
        const evaluationInput = {
          applicationId: target.applicationId,
          action: "agenticx_knowledge_reuse",
          policySnapshotId: parsed.policySnapshotId,
          data: parsed.data,
          evidence: parsed.evidence,
          impactLevel: parsed.impactLevel,
          approval: parsed.approval
        };
        const policyEvaluation = this.evaluatePolicyInState(evaluationInput, state, scope, new Date(occurredAt));
        const policy = policyEvaluation.policySnapshotId ? policyFor(state, scope, { enterpriseId: target.enterpriseId, policySnapshotId: policyEvaluation.policySnapshotId }) : null;
        const sanitizationEvidence = parsed.evidence.find((item) => item.id === parsed.sanitization.evidenceId);
        if (!policy || !sanitizationEvidence || evidenceState(sanitizationEvidence, scope, ["sanitization"], policy, now) !== "valid") reasonCodes.push("sanitization_evidence_required");
        reasonCodes.push(...policyEvaluation.reasonCodes);
        const allowed = reasonCodes.length === 0;
        const receipt = {
          id: id("enterprise_knowledge_receipt"),
          schemaVersion: ENTERPRISE_GOVERNANCE_SCHEMA_VERSION,
          recordType: "knowledge_reuse_receipt",
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          enterpriseId: target.enterpriseId,
          sourceApplicationId: source.applicationId,
          sourceWorkspaceId: source.workspaceId,
          targetApplicationId: target.applicationId,
          purpose: parsed.purpose,
          policySnapshotId: policyEvaluation.policySnapshotId,
          policyDigest: policyEvaluation.policyDigest,
          status: allowed ? "allowed" : "denied",
          reasonCodes: [...new Set(reasonCodes)],
          data: {
            classification: parsed.data.classification,
            region: parsed.data.region,
            egress: parsed.data.egress,
            retentionDays: parsed.data.retentionDays,
            transformations: [...new Set(parsed.data.transformations)],
            complianceControlIds: [...new Set(parsed.data.complianceControlIds)]
          },
          sanitization: { transformIds: [...new Set(parsed.sanitization.transformIds)], evidenceId: parsed.sanitization.evidenceId, contentIncluded: false },
          knowledgeReferences: safeKnowledgeReferences(parsed.knowledgeReferences),
          createdAt: occurredAt,
          revision: 1
        };
        state.enterpriseGovernanceKnowledgeReceipts[receipt.id] = receipt;
        events.push(event({ type: allowed ? "enterprise_governance.knowledge_reuse_allowed" : "enterprise_governance.knowledge_reuse_denied", tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: scope.actor, occurredAt, payload: { receiptId: receipt.id, sourceApplicationId: receipt.sourceApplicationId, sourceWorkspaceId: receipt.sourceWorkspaceId, targetApplicationId: receipt.targetApplicationId, purpose: receipt.purpose, policySnapshotId: receipt.policySnapshotId, status: receipt.status, reasonCodes: receipt.reasonCodes, knowledgeReferenceIds: receipt.knowledgeReferences.map((reference) => reference.id) } }));
        return { status: receipt.status, receipt: clone(receipt) };
      });
      return claim.replayed ? { ...claim.result, status: "idempotent" } : claim.result;
    });
  }

  async requestKnowledgeReuseReceipt(input, context = {}) {
    return this.requestKnowledgeReuse(input, context);
  }

  async listKnowledgeReuseReceipts({ sourceApplicationId, targetApplicationId, status, limit = 100 } = {}, context = {}) {
    const parsed = parseOrThrow(z.object({
      sourceApplicationId: OptionalIdentifierSchema,
      targetApplicationId: OptionalIdentifierSchema,
      status: z.enum(["allowed", "denied"]).optional(),
      limit: z.coerce.number().int().min(1).max(250).default(100)
    }).strict(), { sourceApplicationId, targetApplicationId, status, limit }, "Knowledge reuse receipt list query");
    const scope = scopeFor(context);
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    const directReceipts = Object.values(state.enterpriseGovernanceKnowledgeReceipts)
      .filter((record) => inScope(record, scope) && record.recordType === "knowledge_reuse_receipt");
    const gatewayReceipts = Object.values(state.agenticXReuseReceipts)
      .filter((record) => inScope(record, scope) && record.recordType === "agenticx_gateway_reuse_receipt");
    return [...directReceipts, ...gatewayReceipts]
      // Gateway receipts deliberately do not preserve a source application
      // when access is denied, so a source filter only matches authoritative
      // direct receipts rather than inventing a source association.
      .filter((record) => (!parsed.sourceApplicationId || record.sourceApplicationId === parsed.sourceApplicationId) && (!parsed.targetApplicationId || record.targetApplicationId === parsed.targetApplicationId) && (!parsed.status || record.status === parsed.status))
      .sort((left, right) => comparableTimestamp(right.createdAt) - comparableTimestamp(left.createdAt))
      .slice(0, parsed.limit).map(clone);
  }

  async listAgenticXReuseReceipts(query = {}, context = {}) {
    return this.listKnowledgeReuseReceipts(query, context);
  }

  async recordAgenticXReuseReceipt(input, context = {}) {
    const parsed = parseOrThrow(AgenticXReuseReceiptSchema, input, "AgenticX reuse receipt");
    const scope = scopeFor(context);
    const occurredAt = this.now().toISOString();
    return this.store.mutate((state, events) => {
      ensureEnterpriseGovernanceState(state);
      const idempotencyKey = parsed.idempotencyKey || `agenticx_reuse_${digest({ id: parsed.id || null, purpose: parsed.purpose, allowedKnowledgeIds: parsed.allowedKnowledgeIds, denialReasons: parsed.denialReasons, createdAt: parsed.createdAt || occurredAt }).slice(0, 48)}`;
      const claim = replayOrRemember(state, scope, "record_agenticx_reuse_receipt", idempotencyKey, parsed, occurredAt, () => {
        const receipt = {
          id: parsed.id || id("enterprise_agenticx_reuse_receipt"),
          schemaVersion: ENTERPRISE_GOVERNANCE_SCHEMA_VERSION,
          recordType: "agenticx_gateway_reuse_receipt",
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          status: parsed.status === "idempotent" ? "allowed" : parsed.status,
          purpose: parsed.purpose,
          region: parsed.region,
          egress: parsed.egress,
          transformation: parsed.transformation,
          maxClassification: parsed.maxClassification,
          targetApplicationId: parsed.targetApplicationId || null,
          policySnapshotId: parsed.policySnapshotId || null,
          allowedKnowledgeIds: [...new Set(parsed.allowedKnowledgeIds)],
          deniedCandidates: clone(parsed.deniedCandidates),
          denialReasons: [...new Set(parsed.denialReasons)],
          policyReceiptIds: [...new Set(parsed.policyReceiptIds)],
          createdAt: parsed.createdAt || occurredAt,
          revision: 1
        };
        const existing = state.agenticXReuseReceipts[receipt.id];
        if (existing && inScope(existing, scope)) return { status: "idempotent", receipt: clone(existing) };
        state.agenticXReuseReceipts[receipt.id] = receipt;
        events.push(event({ type: "enterprise_governance.agenticx_reuse_receipt_recorded", tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: scope.actor, occurredAt, payload: { receiptId: receipt.id, status: receipt.status, targetApplicationId: receipt.targetApplicationId, allowedKnowledgeIds: receipt.allowedKnowledgeIds, denialReasons: receipt.denialReasons } }));
        return { status: "recorded", receipt: clone(receipt) };
      });
      return claim.replayed ? { ...claim.result, status: "idempotent" } : claim.result;
    });
  }

  async persistAgenticXReuseReceipt(input, context = {}) { return this.recordAgenticXReuseReceipt(input, context); }
  async saveAgenticXReuseReceipt(input, context = {}) { return this.recordAgenticXReuseReceipt(input, context); }
  async recordKnowledgeReuseReceipt(input, context = {}) { return this.recordAgenticXReuseReceipt(input, context); }
  async persistKnowledgeReuseReceipt(input, context = {}) { return this.recordAgenticXReuseReceipt(input, context); }

  async evaluateAgenticXKnowledge(input, context = {}) {
    // AgenticX follows this lightweight preflight with requestKnowledgeReuse,
    // which is the authoritative, receipt-producing access decision. Do not
    // turn partial gateway metadata into a second, weaker allow decision.
    if (typeof this.requestKnowledgeReuse === "function") return { status: "deferred_to_access_receipt", allowed: true, reasonCodes: [] };
    return this.evaluateKnowledgeReuse(input, context);
  }

  async evaluateKnowledgeReuse(input = {}, context = {}) {
    const sourceApplicationId = input.sourceApplicationId || input.knowledgeReference?.sourceApplicationId;
    const targetApplicationId = input.targetApplicationId || input.applicationId;
    if (!sourceApplicationId || !targetApplicationId) {
      return { status: "denied", allowed: false, reasonCodes: ["application_binding_required"] };
    }
    const reference = input.knowledgeReference || (Array.isArray(input.knowledgeReferences) ? input.knowledgeReferences[0] : null);
    const retentionDays = Number.isInteger(input.data?.retentionDays) ? input.data.retentionDays : 0;
    return this.evaluatePolicy({
      applicationId: targetApplicationId,
      action: "agenticx_knowledge_reuse",
      policySnapshotId: input.policySnapshotId || undefined,
      data: {
        classification: input.data?.classification || reference?.classification || "internal",
        region: input.data?.region || input.region || "unknown",
        egress: input.data?.egress || input.egress || "unknown",
        retentionDays,
        transformations: input.data?.transformations || (input.transformation ? [input.transformation] : []),
        complianceControlIds: input.data?.complianceControlIds || input.complianceControlIds || []
      },
      evidence: Array.isArray(input.evidence) ? input.evidence : [],
      impactLevel: input.impactLevel || "low",
      approval: input.approval
    }, context);
  }

  async evaluateResearchPolicy(input = {}, context = {}) {
    const scope = scopeFor(context);
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    const budget = input.budgetId ? budgetFor(state, scope, input.budgetId) : null;
    const applicationId = input.applicationId || budget?.applicationId || null;
    const data = input.data && typeof input.data === "object" ? input.data : {};
    if (!applicationId || !input.policySnapshotId || !input.region || !input.egress) {
      return { status: "denied", allowed: false, reasonCodes: ["governed_context_required"], policySnapshotId: input.policySnapshotId || null, budgetId: input.budgetId || null };
    }
    try {
      return this.evaluatePolicy({
        applicationId,
        action: "research_fetch",
        policySnapshotId: input.policySnapshotId,
        budgetId: input.budgetId || undefined,
        data: {
          classification: data.classification || input.dataClassification || "public",
          region: data.region || input.region,
          egress: data.egress || input.egress,
          retentionDays: Number.isInteger(data.retentionDays) ? data.retentionDays : 0,
          transformations: Array.isArray(data.transformations) ? data.transformations : ["redact"],
          complianceControlIds: Array.isArray(data.complianceControlIds) ? data.complianceControlIds : []
        },
        evidence: Array.isArray(input.evidence) ? input.evidence : [],
        impactLevel: input.impactLevel || "low"
      }, context);
    } catch (error) {
      return { status: "denied", allowed: false, reasonCodes: [error.code || "policy_evaluation_failed"], policySnapshotId: input.policySnapshotId || null, budgetId: input.budgetId || null };
    }
  }

  async overview({ enterpriseId, applicationId, recentLimit = 20 } = {}, context = {}) {
    const parsed = parseOrThrow(z.object({ enterpriseId: OptionalIdentifierSchema, applicationId: OptionalIdentifierSchema, recentLimit: z.coerce.number().int().min(1).max(100).default(20) }).strict(), { enterpriseId, applicationId, recentLimit }, "Enterprise governance overview query");
    const scope = scopeFor(context);
    const state = await this.store.readState();
    ensureEnterpriseGovernanceState(state);
    const now = this.now().getTime();
    const bindings = Object.values(state.enterpriseGovernanceBindings).filter((record) => inScope(record, scope) && (!parsed.enterpriseId || record.enterpriseId === parsed.enterpriseId) && (!parsed.applicationId || record.applicationId === parsed.applicationId));
    const permittedApplications = new Set(bindings.map((record) => record.applicationId));
    const permittedEnterprises = new Set(bindings.map((record) => record.enterpriseId));
    const budgets = Object.values(state.enterpriseGovernanceBudgets).filter((record) => inScope(record, scope) && (!parsed.enterpriseId || record.enterpriseId === parsed.enterpriseId) && (!parsed.applicationId || record.applicationId === parsed.applicationId));
    const routeReceipts = Object.values(state.enterpriseGovernanceDecisionContexts).filter((record) => inScope(record, scope) && record.recordType === "model_route_receipt" && permittedApplications.has(record.applicationId));
    const decisionContexts = Object.values(state.enterpriseGovernanceDecisionContexts).filter((record) => inScope(record, scope) && record.recordType === "decision_context" && permittedApplications.has(record.applicationId));
    const directKnowledgeReceipts = Object.values(state.enterpriseGovernanceKnowledgeReceipts)
      .filter((record) => inScope(record, scope) && record.recordType === "knowledge_reuse_receipt" && permittedApplications.has(record.targetApplicationId));
    const gatewayKnowledgeReceipts = Object.values(state.agenticXReuseReceipts)
      .filter((record) => inScope(record, scope) && record.recordType === "agenticx_gateway_reuse_receipt")
      .filter((record) => {
        if (record.targetApplicationId) return permittedApplications.has(record.targetApplicationId);
        // A gateway can deny before an application is selected.  Keep that
        // tenant/workspace-scoped audit fact visible only in the unfiltered
        // overview; it cannot be attributed safely to an application or
        // enterprise filter.
        return !parsed.applicationId && !parsed.enterpriseId;
      });
    const knowledgeReceipts = [...directKnowledgeReceipts, ...gatewayKnowledgeReceipts];
    const currentPolicies = [...permittedEnterprises].map((id) => policyFor(state, scope, { enterpriseId: id })).filter(Boolean).map(sanitizedPolicy);
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      generatedAt: new Date(now).toISOString(),
      applications: bindings.map(clone),
      policySnapshots: currentPolicies,
      budgets: budgets.map((budget) => budgetView(state, budget, now)),
      counts: {
        applications: bindings.length,
        policies: currentPolicies.length,
        budgets: budgets.length,
        reservations: Object.values(state.enterpriseGovernanceReservations).filter((record) => inScope(record, scope) && budgets.some((budget) => budget.id === record.budgetId)).length,
        decisionContexts: decisionContexts.length,
        modelRouteReceipts: routeReceipts.length,
        knowledgeReuseAllowed: knowledgeReceipts.filter((record) => record.status === "allowed").length,
        knowledgeReuseDenied: knowledgeReceipts.filter((record) => record.status === "denied").length
      },
      recent: {
        decisions: decisionContexts.sort((left, right) => comparableTimestamp(right.createdAt) - comparableTimestamp(left.createdAt)).slice(0, parsed.recentLimit).map(clone),
        modelRoutes: routeReceipts.sort((left, right) => comparableTimestamp(right.createdAt) - comparableTimestamp(left.createdAt)).slice(0, parsed.recentLimit).map(clone),
        knowledgeReuse: knowledgeReceipts.sort((left, right) => comparableTimestamp(right.createdAt) - comparableTimestamp(left.createdAt)).slice(0, parsed.recentLimit).map(clone)
      },
      contentRetention: "none; opaque identifiers, policy facts, hashes, and sanitized receipts only"
    };
  }
}

export const EnterpriseGovernance = EnterpriseGovernanceService;
