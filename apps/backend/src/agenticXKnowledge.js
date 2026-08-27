import crypto from "node:crypto";
import { z } from "zod";

/**
 * AgenticX knowledge is intentionally a small, tenant-scoped control-plane
 * boundary. It does not discover files, query a vector store, or treat an
 * agent's prior prompt/context as authority. The only candidates it can reuse
 * are records explicitly registered through this gateway.
 */
export const AGENTICX_KNOWLEDGE_SCHEMA_VERSION = "agenticx-knowledge/v1";
export const AGENTICX_KNOWLEDGE_CLASSIFICATIONS = Object.freeze(["public", "internal", "confidential", "restricted"]);
export const AGENTICX_KNOWLEDGE_TRANSFORMATIONS = Object.freeze(["summary", "redacted_summary", "metadata"]);

const CLASSIFICATION_RANK = Object.freeze({ public: 0, internal: 1, confidential: 2, restricted: 3 });
const ABSOLUTE_MAX_RESULTS = 50;
const ABSOLUTE_MAX_SUMMARY_CHARS = 4_000;
const ABSOLUTE_MAX_RETENTION_DAYS = 3_650;
const RAW_FIELD_NAMES = new Set([
  "content", "rawcontent", "raw_content", "payload", "body", "attachment", "attachments", "file", "files",
  "filepath", "file_path", "sourcepath", "source_path", "secret", "secrets", "credential", "credentials"
]);

export class AgenticXKnowledgeError extends Error {
  constructor(message, { code = "agenticx_knowledge_error", status = 400, details = null } = {}) {
    super(message);
    this.name = "AgenticXKnowledgeError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const IdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/, "must be an identifier");
const TenantIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/, "must be an identifier");
const ClassificationSchema = z.enum(AGENTICX_KNOWLEDGE_CLASSIFICATIONS);
const TransformationSchema = z.enum(AGENTICX_KNOWLEDGE_TRANSFORMATIONS);
const ImpactLevelSchema = z.enum(["low", "medium", "high", "critical"]);
const HumanApprovalSchema = z.object({
  approved: z.literal(true),
  approverId: IdSchema,
  approvedAt: z.string().datetime(),
  evidenceId: IdSchema
}).strict();

const RetentionSchema = z.object({
  notBefore: z.string().datetime().optional(),
  expiresAt: z.string().datetime()
}).strict();

const RequestPolicyRestrictionsSchema = z.object({
  allowedClassifications: z.array(ClassificationSchema).min(1).max(AGENTICX_KNOWLEDGE_CLASSIFICATIONS.length).optional(),
  allowedRegions: z.array(z.string().min(1).max(80)).min(1).max(32).optional(),
  allowedPurposes: z.array(z.string().min(1).max(160)).min(1).max(32).optional(),
  allowedTransformations: z.array(TransformationSchema).min(1).max(AGENTICX_KNOWLEDGE_TRANSFORMATIONS.length).optional()
}).strict();

const EvidenceReferenceSchema = z.object({
  id: IdSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  type: z.string().min(1).max(80).optional(),
  // A caller may supply the bounded policy-evidence fields needed by the
  // enterprise authority. Partial references remain useful for local audit,
  // but are deliberately not upgraded into policy evidence below.
  controlIds: z.array(IdSchema).min(1).max(64).optional(),
  status: z.enum(["verified", "unknown", "stale", "expired", "invalid", "unauthorized"]).optional(),
  authorized: z.boolean().optional(),
  observedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  tenantId: TenantIdSchema.optional(),
  workspaceId: TenantIdSchema.optional()
}).strict();

/**
 * This is a registration input, not a raw-content import contract. Unknown
 * fields are ignored after explicit raw-field checks, so callers cannot make a
 * new raw-content field authoritative by adding it to a payload.
 */
export const AgenticXKnowledgeRecordInputSchema = z.object({
  tenantId: TenantIdSchema.optional(),
  workspaceId: TenantIdSchema.optional(),
  id: IdSchema.optional(),
  knowledgeId: IdSchema.optional(),
  sourceId: IdSchema.optional(),
  sourceApplicationId: IdSchema.optional(),
  applicationId: IdSchema.optional(),
  version: z.string().min(1).max(120).default("1"),
  summary: z.string().min(1).max(ABSOLUTE_MAX_SUMMARY_CHARS),
  sanitizedSummary: z.string().min(1).max(ABSOLUTE_MAX_SUMMARY_CHARS).optional(),
  classification: ClassificationSchema,
  region: z.string().min(1).max(80),
  allowedPurposes: z.array(z.string().min(1).max(160)).min(1).max(32),
  allowedTransformations: z.array(TransformationSchema).min(1).max(AGENTICX_KNOWLEDGE_TRANSFORMATIONS.length).default(["summary"]),
  retention: RetentionSchema,
  tags: z.array(z.string().min(1).max(80)).max(32).default([]),
  idempotencyKey: z.string().min(1).max(240).optional(),
  sanitized: z.boolean().optional()
}).passthrough();

export const AgenticXKnowledgeRetrievalSchema = z.object({
  tenantId: TenantIdSchema,
  workspaceId: TenantIdSchema.default("default"),
  purpose: z.string().min(1).max(160),
  region: z.string().min(1).max(80),
  egress: z.string().min(1).max(160).default("isolated"),
  maxClassification: ClassificationSchema.default("internal"),
  transformation: TransformationSchema.default("summary"),
  // This is the target workflow's requested retention window. The enterprise
  // authority compares it with the source record's remaining retention before
  // returning a summary; it is not inferred from the source material.
  retentionDays: z.number().int().min(0).max(ABSOLUTE_MAX_RETENTION_DAYS).default(1),
  knowledgeIds: z.array(IdSchema).max(ABSOLUTE_MAX_RESULTS).default([]),
  maxResults: z.number().int().min(1).max(ABSOLUTE_MAX_RESULTS).default(10),
  targetApplicationId: IdSchema.optional(),
  policySnapshotId: IdSchema.optional(),
  complianceControlIds: z.array(IdSchema).max(64).default([]),
  evidence: z.array(EvidenceReferenceSchema).max(64).default([]),
  restrictions: RequestPolicyRestrictionsSchema.optional(),
  impactLevel: ImpactLevelSchema.default("low"),
  approval: HumanApprovalSchema.optional(),
  idempotencyKey: z.string().min(1).max(240).optional(),
  actor: z.object({ id: z.string().min(1).max(160), type: z.string().min(1).max(80) }).strict().optional()
}).strict();

function nowIso(clock = () => new Date()) {
  const date = clock();
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) throw new AgenticXKnowledgeError("AgenticX clock returned an invalid date.", { code: "invalid_clock", status: 500 });
  return parsed.toISOString();
}

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

function deterministicId(prefix, value) {
  return `${prefix}_${digest(value).slice(0, 32)}`;
}

function asSet(values) {
  if (values instanceof Set) return new Set([...values].map((value) => String(value).trim()).filter(Boolean));
  return new Set(Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean) : []);
}

function csv(value, fallback = []) {
  const parsed = String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
  return parsed.length ? [...new Set(parsed)] : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizedText(value, maxLength = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizedList(values, maxLength = 160) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => normalizedText(value, maxLength)).filter(Boolean))];
}

function hasAllowedValue(values, value) {
  return !values.size || values.has("*") || values.has(value);
}

function safeActor(actor) {
  if (!actor || typeof actor !== "object") return { type: "service", id: "agenticx-knowledge" };
  return {
    type: normalizedText(actor.type || "unknown", 80),
    id: normalizedText(actor.id || "unknown", 160)
  };
}

/**
 * Redacts common credential forms. It returns metadata rather than logging the
 * matched input, which lets callers decide to reject a record without ever
 * retaining the original secret.
 */
export function redactAgenticXKnowledgeText(input, { maxLength = ABSOLUTE_MAX_SUMMARY_CHARS } = {}) {
  const original = String(input || "");
  const findings = new Set();
  let text = original;
  const replace = (pattern, replacement, finding) => {
    const before = text;
    text = text.replace(pattern, replacement);
    if (text !== before) findings.add(finding);
  };

  replace(/-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]", "private_key");
  replace(/\b(?:sk|rk|pk|sess)-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_API_KEY]", "api_key");
  replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]", "access_key");
  replace(/(authorization\s*[:=]\s*bearer\s+)[^\s'"`]+/gi, "$1[REDACTED]", "authorization");
  replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|PASSWORD|SECRET|PRIVATE[_-]?KEY|CREDENTIAL))\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]", "credential_assignment");
  replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[REDACTED]@", "connection_string");
  replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]", "jwt");

  const limit = boundedInteger(maxLength, ABSOLUTE_MAX_SUMMARY_CHARS, 1, ABSOLUTE_MAX_SUMMARY_CHARS);
  const truncated = text.length > limit;
  if (truncated) {
    const marker = " [clipped]";
    text = limit > marker.length ? `${text.slice(0, limit - marker.length)}${marker}` : text.slice(0, limit);
    findings.add("summary_too_large");
  }
  return { text, redacted: findings.size > 0, findingCodes: [...findings].sort(), truncated };
}

export const redactKnowledgeText = redactAgenticXKnowledgeText;

function hasSecretFinding(redaction) {
  return (redaction?.findingCodes || []).some((code) => code !== "summary_too_large");
}

function rawFields(record, prefix = "", depth = 0) {
  if (!record || typeof record !== "object" || depth > 5) return [];
  if (Array.isArray(record)) return record.flatMap((value, index) => rawFields(value, `${prefix}[${index}]`, depth + 1));
  return Object.entries(record).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const own = RAW_FIELD_NAMES.has(String(key).replace(/[-\s]/g, "").toLowerCase()) ? [path] : [];
    return own.concat(rawFields(value, path, depth + 1));
  });
}

function registrationScope(input, context = {}) {
  const recordTenant = normalizedText(input?.tenantId, 160);
  const contextTenant = normalizedText(context?.tenantId, 160);
  const recordWorkspace = normalizedText(input?.workspaceId, 160);
  const contextWorkspace = normalizedText(context?.workspaceId, 160);
  if (!recordTenant && !contextTenant) throw new AgenticXKnowledgeError("A tenantId is required for AgenticX knowledge.", { code: "tenant_required", status: 400 });
  if (recordTenant && contextTenant && recordTenant !== contextTenant) throw new AgenticXKnowledgeError("Knowledge registration cannot cross tenant scope.", { code: "cross_tenant_denied", status: 403 });
  if (recordWorkspace && contextWorkspace && recordWorkspace !== contextWorkspace) throw new AgenticXKnowledgeError("Knowledge registration cannot cross workspace scope.", { code: "cross_workspace_denied", status: 403 });
  return { tenantId: contextTenant || recordTenant, workspaceId: contextWorkspace || recordWorkspace || "default" };
}

function normalizedRecordInput(input = {}) {
  return {
    ...input,
    sourceId: input.sourceId || input.knowledgeId || input.id,
    sourceApplicationId: input.sourceApplicationId || input.applicationId,
    summary: input.summary || input.sanitizedSummary
  };
}

/**
 * Produces the only record shape the gateway stores. A supplied `content`, raw
 * payload, secret-bearing summary, or restricted classification is rejected;
 * a redacted copy is returned only for caller-side remediation and is never
 * persisted by the gateway.
 */
export function sanitizeAgenticXKnowledgeRecord(input = {}, { tenantId, workspaceId, config = resolveAgenticXKnowledgeConfig(), clock = () => new Date() } = {}) {
  const effectiveConfig = normalizeConfig(config);
  const forbidden = rawFields(input);
  if (forbidden.length) {
    return { ok: false, knowledge: null, denialReasons: ["raw_content_denied"], redaction: { text: "", redacted: false, findingCodes: ["raw_field"], truncated: false } };
  }
  const scope = registrationScope(input, { tenantId, workspaceId });
  const parsed = AgenticXKnowledgeRecordInputSchema.parse(normalizedRecordInput(input));
  if (!parsed.sourceId) {
    return { ok: false, knowledge: null, denialReasons: ["source_identifier_required"], redaction: { text: "", redacted: false, findingCodes: [], truncated: false } };
  }
  const summary = redactAgenticXKnowledgeText(parsed.summary, { maxLength: effectiveConfig.maxSummaryChars });
  const metadataRedaction = redactAgenticXKnowledgeText([
    parsed.sourceId,
    parsed.sourceApplicationId || parsed.applicationId || "",
    parsed.version,
    parsed.region,
    ...parsed.allowedPurposes,
    ...parsed.tags
  ].join("\n"), { maxLength: ABSOLUTE_MAX_SUMMARY_CHARS });
  if (parsed.classification === "restricted") {
    return { ok: false, knowledge: null, denialReasons: ["restricted_content_denied"], redaction: summary };
  }
  if (hasSecretFinding(summary) || hasSecretFinding(metadataRedaction)) {
    return { ok: false, knowledge: null, denialReasons: ["secret_material_denied"], redaction: summary };
  }
  const timestamp = Date.parse(nowIso(clock));
  const expiresAt = Date.parse(parsed.retention.expiresAt);
  const notBefore = parsed.retention.notBefore ? Date.parse(parsed.retention.notBefore) : null;
  if (!Number.isFinite(expiresAt) || expiresAt <= timestamp || (notBefore !== null && notBefore >= expiresAt)) {
    return { ok: false, knowledge: null, denialReasons: ["retention_invalid"], redaction: summary };
  }
  const maximumExpiry = timestamp + (Number(effectiveConfig.maxRetentionDays) * 24 * 60 * 60 * 1000);
  if (expiresAt > maximumExpiry) {
    return { ok: false, knowledge: null, denialReasons: ["retention_exceeds_limit"], redaction: summary };
  }
  const classification = parsed.classification;
  const region = normalizedText(parsed.region, 80);
  const allowedPurposes = normalizedList(parsed.allowedPurposes, 160);
  const allowedTransformations = normalizedList(parsed.allowedTransformations, 80);
  const tags = normalizedList(parsed.tags, 80);
  if (!region || !allowedPurposes.length || !allowedTransformations.length) {
    return { ok: false, knowledge: null, denialReasons: ["knowledge_metadata_invalid"], redaction: summary };
  }
  const immutablePayload = {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    sourceId: parsed.sourceId,
    sourceApplicationId: parsed.sourceApplicationId || null,
    version: parsed.version,
    summaryDigest: digest(summary.text),
    classification,
    region,
    allowedPurposes,
    allowedTransformations,
    retention: parsed.retention,
    tags
  };
  return {
    ok: true,
    denialReasons: [],
    redaction: summary,
    knowledge: {
      id: deterministicId("ak", immutablePayload),
      schemaVersion: AGENTICX_KNOWLEDGE_SCHEMA_VERSION,
      ...immutablePayload,
      summary: summary.text,
      contentDigest: digest(summary.text),
      sanitized: true,
      immutableFingerprint: digest(immutablePayload)
    }
  };
}

export const sanitizeKnowledgeRecord = sanitizeAgenticXKnowledgeRecord;

/**
 * All defaults are deliberately conservative: no restricted material, no raw
 * transformation, same-region reuse, and short bounded summaries. Empty
 * allowlists mean "not additionally restricted by environment", never an
 * exemption from the per-record controls above.
 */
export function resolveAgenticXKnowledgeConfig(env = process.env) {
  const allowedClassifications = csv(env.AGENTICX_KNOWLEDGE_ALLOWED_CLASSIFICATIONS, ["public", "internal", "confidential"])
    .filter((value) => AGENTICX_KNOWLEDGE_CLASSIFICATIONS.includes(value));
  return {
    // The gateway is additive and stays unavailable until an operator has
    // explicitly enabled tenant-scoped reuse.
    enabled: bool(env.AGENTICX_KNOWLEDGE_ENABLED, false),
    enabledTenants: asSet(csv(env.AGENTICX_KNOWLEDGE_ENABLED_TENANTS)),
    allowedClassifications: asSet(allowedClassifications.length ? allowedClassifications : ["public", "internal"]),
    allowedRegions: asSet(csv(env.AGENTICX_KNOWLEDGE_ALLOWED_REGIONS)),
    allowedPurposes: asSet(csv(env.AGENTICX_KNOWLEDGE_ALLOWED_PURPOSES)),
    allowedTransformations: asSet(csv(env.AGENTICX_KNOWLEDGE_ALLOWED_TRANSFORMATIONS, AGENTICX_KNOWLEDGE_TRANSFORMATIONS)),
    defaultMaxClassification: AGENTICX_KNOWLEDGE_CLASSIFICATIONS.includes(env.AGENTICX_KNOWLEDGE_DEFAULT_MAX_CLASSIFICATION)
      ? env.AGENTICX_KNOWLEDGE_DEFAULT_MAX_CLASSIFICATION
      : "internal",
    maxResults: boundedInteger(env.AGENTICX_KNOWLEDGE_MAX_RESULTS, 10, 1, ABSOLUTE_MAX_RESULTS),
    maxSummaryChars: boundedInteger(env.AGENTICX_KNOWLEDGE_MAX_SUMMARY_CHARS, 1_200, 1, ABSOLUTE_MAX_SUMMARY_CHARS),
    maxRetentionDays: boundedInteger(env.AGENTICX_KNOWLEDGE_MAX_RETENTION_DAYS, 365, 1, ABSOLUTE_MAX_RETENTION_DAYS)
  };
}

export const resolveAgenticXConfig = resolveAgenticXKnowledgeConfig;

function normalizeConfig(config = resolveAgenticXKnowledgeConfig()) {
  const defaults = resolveAgenticXKnowledgeConfig();
  const defaultMaxClassification = AGENTICX_KNOWLEDGE_CLASSIFICATIONS.includes(config?.defaultMaxClassification)
    ? config.defaultMaxClassification
    : defaults.defaultMaxClassification;
  return {
    enabled: config?.enabled === undefined ? defaults.enabled : Boolean(config.enabled),
    enabledTenants: asSet(config?.enabledTenants ?? defaults.enabledTenants),
    allowedClassifications: asSet(config?.allowedClassifications ?? defaults.allowedClassifications),
    allowedRegions: asSet(config?.allowedRegions ?? defaults.allowedRegions),
    allowedPurposes: asSet(config?.allowedPurposes ?? defaults.allowedPurposes),
    allowedTransformations: asSet(config?.allowedTransformations ?? defaults.allowedTransformations),
    defaultMaxClassification,
    maxResults: boundedInteger(config?.maxResults, defaults.maxResults, 1, ABSOLUTE_MAX_RESULTS),
    maxSummaryChars: boundedInteger(config?.maxSummaryChars, defaults.maxSummaryChars, 1, ABSOLUTE_MAX_SUMMARY_CHARS),
    maxRetentionDays: boundedInteger(config?.maxRetentionDays, defaults.maxRetentionDays, 1, ABSOLUTE_MAX_RETENTION_DAYS)
  };
}

function normalizeRetrievalInput(input = {}, config) {
  const workflow = input.workflow && typeof input.workflow === "object" ? input.workflow : {};
  const data = input.data && typeof input.data === "object" ? input.data : {};
  const restrictions = input.restrictions || input.policy || undefined;
  const parsed = AgenticXKnowledgeRetrievalSchema.parse({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId || "default",
    purpose: input.purpose,
    region: input.region || data.region,
    egress: input.egress || data.egress || "isolated",
    maxClassification: input.maxClassification || input.dataClassification || input.classification || data.classification || config.defaultMaxClassification,
    transformation: input.transformation || input.requestedTransformation || "summary",
    retentionDays: input.retentionDays ?? data.retentionDays ?? 1,
    knowledgeIds: input.knowledgeIds || input.ids || input.knowledgeReferences?.map((reference) => typeof reference === "string" ? reference : reference?.id).filter(Boolean) || [],
    maxResults: Math.min(Number(input.maxResults) || config.maxResults, config.maxResults),
    targetApplicationId: input.targetApplicationId || input.applicationId,
    policySnapshotId: input.policySnapshotId,
    complianceControlIds: input.complianceControlIds || data.complianceControlIds || [],
    evidence: input.evidence || input.evidenceReferences || [],
    restrictions,
    impactLevel: input.impactLevel || data.impactLevel || "low",
    approval: input.approval,
    idempotencyKey: input.idempotencyKey || workflow.idempotencyKey || workflow.requestId || input.requestId,
    actor: input.actor
  });
  const unsafeRequestText = [
    parsed.purpose,
    parsed.region,
    parsed.egress,
    ...(parsed.restrictions?.allowedPurposes || []),
    ...(parsed.restrictions?.allowedRegions || [])
  ].some((value) => hasSecretFinding(redactAgenticXKnowledgeText(value, { maxLength: 240 })));
  if (unsafeRequestText) {
    throw new AgenticXKnowledgeError("Knowledge reuse context cannot contain secret material.", { code: "unsafe_request_context", status: 422 });
  }
  return {
    ...parsed,
    purpose: normalizedText(parsed.purpose, 160),
    region: normalizedText(parsed.region, 80),
    egress: normalizedText(parsed.egress, 160),
    knowledgeIds: [...new Set(parsed.knowledgeIds)],
    complianceControlIds: normalizedList(parsed.complianceControlIds, 160),
    evidence: parsed.evidence.map((entry) => ({ ...entry, digest: entry.digest?.toLowerCase() })),
    actor: safeActor(parsed.actor),
    restrictions: parsed.restrictions ? {
      allowedClassifications: parsed.restrictions.allowedClassifications ? new Set(parsed.restrictions.allowedClassifications) : null,
      allowedRegions: parsed.restrictions.allowedRegions ? asSet(parsed.restrictions.allowedRegions) : null,
      allowedPurposes: parsed.restrictions.allowedPurposes ? asSet(parsed.restrictions.allowedPurposes) : null,
      allowedTransformations: parsed.restrictions.allowedTransformations ? asSet(parsed.restrictions.allowedTransformations) : null
    } : null
  };
}

function policyEvidenceForGovernance(entries = []) {
  return entries
    .filter((entry) => entry && Array.isArray(entry.controlIds) && entry.controlIds.length
      && entry.status && typeof entry.authorized === "boolean" && entry.observedAt
      && entry.tenantId && entry.workspaceId)
    .map((entry) => ({
      id: entry.id,
      controlIds: entry.controlIds,
      status: entry.status,
      authorized: entry.authorized,
      observedAt: entry.observedAt,
      ...(entry.expiresAt ? { expiresAt: entry.expiresAt } : {}),
      tenantId: entry.tenantId,
      workspaceId: entry.workspaceId
    }));
}

function sanitizationEvidenceId(entries = []) {
  return entries.find((entry) => Array.isArray(entry.controlIds) && entry.controlIds.includes("sanitization"))?.id
    // This is an explicit absence marker, not invented evidence. The
    // enterprise service records it as a denied request when no verified
    // sanitization evidence is present.
    || "agenticx_sanitization_evidence_absent";
}

function safeRequestFingerprint(request) {
  return digest({
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    purpose: request.purpose,
    region: request.region,
    egress: request.egress,
    maxClassification: request.maxClassification,
    transformation: request.transformation,
    retentionDays: request.retentionDays,
    knowledgeIds: request.knowledgeIds,
    maxResults: request.maxResults,
    targetApplicationId: request.targetApplicationId || null,
    policySnapshotId: request.policySnapshotId || null,
    complianceControlIds: request.complianceControlIds,
    evidence: request.evidence,
    impactLevel: request.impactLevel,
    approval: request.approval || null,
    restrictions: request.restrictions ? {
      allowedClassifications: request.restrictions.allowedClassifications ? [...request.restrictions.allowedClassifications].sort() : null,
      allowedRegions: request.restrictions.allowedRegions ? [...request.restrictions.allowedRegions].sort() : null,
      allowedPurposes: request.restrictions.allowedPurposes ? [...request.restrictions.allowedPurposes].sort() : null,
      allowedTransformations: request.restrictions.allowedTransformations ? [...request.restrictions.allowedTransformations].sort() : null
    } : null
  });
}

function localEligibility(record, request, config, at) {
  const reasons = [];
  if (!config.enabled || (config.enabledTenants.size && !config.enabledTenants.has(record.tenantId))) reasons.push("agenticx_feature_disabled");
  if (!record.sanitized) reasons.push("unsanitized_knowledge_denied");
  if (record.classification === "restricted") reasons.push("restricted_content_denied");
  if (!config.allowedClassifications.has(record.classification)) reasons.push("classification_denied");
  if (CLASSIFICATION_RANK[record.classification] > CLASSIFICATION_RANK[request.maxClassification]) reasons.push("classification_denied");
  if (record.region !== request.region) reasons.push("region_denied");
  if (!hasAllowedValue(config.allowedRegions, record.region) || !hasAllowedValue(config.allowedRegions, request.region)) reasons.push("region_denied");
  if (!record.allowedPurposes.includes(request.purpose) || !hasAllowedValue(config.allowedPurposes, request.purpose)) reasons.push("purpose_denied");
  if (!record.allowedTransformations.includes(request.transformation) || !config.allowedTransformations.has(request.transformation)) reasons.push("transformation_denied");
  const expiresAt = Date.parse(record.retention.expiresAt);
  const notBefore = record.retention.notBefore ? Date.parse(record.retention.notBefore) : null;
  if (!Number.isFinite(expiresAt) || expiresAt <= at || (notBefore !== null && (!Number.isFinite(notBefore) || notBefore > at))) reasons.push("retention_denied");
  if (request.restrictions?.allowedClassifications && !request.restrictions.allowedClassifications.has(record.classification)) reasons.push("classification_denied");
  if (request.restrictions?.allowedRegions && !hasAllowedValue(request.restrictions.allowedRegions, record.region)) reasons.push("region_denied");
  if (request.restrictions?.allowedPurposes && !hasAllowedValue(request.restrictions.allowedPurposes, request.purpose)) reasons.push("purpose_denied");
  if (request.restrictions?.allowedTransformations && !request.restrictions.allowedTransformations.has(request.transformation)) reasons.push("transformation_denied");
  return [...new Set(reasons)].sort();
}

function evaluationResult(value, fallbackReason = "policy_denied") {
  if (value === true) return { allowed: true, denialReasons: [], receiptId: null };
  if (value === false || value === null || value === undefined) return { allowed: false, denialReasons: [fallbackReason], receiptId: null };
  const receipt = value.receipt && typeof value.receipt === "object" ? value.receipt : value;
  const status = String(value.status || receipt.status || "").toLowerCase();
  const allowed = value.allowed === true || status === "allowed" || (status === "idempotent" && String(receipt.status || "").toLowerCase() === "allowed");
  const rawReasons = value.denialReasons || value.reasonCodes || receipt.denialReasons || receipt.reasonCodes || [];
  const denialReasons = normalizedList(rawReasons, 120).map((reason) => reason.toLowerCase().replace(/\s+/g, "_"));
  return {
    allowed,
    denialReasons: allowed ? [] : (denialReasons.length ? denialReasons : [fallbackReason]),
    receiptId: typeof receipt.id === "string" ? normalizedText(receipt.id, 160) : null
  };
}

function publicKnowledge(record, maxSummaryChars) {
  const safe = redactAgenticXKnowledgeText(record.summary, { maxLength: maxSummaryChars });
  // A record can only have reached storage after a clean sanitization pass. If
  // a future implementation corrupts that invariant, do not return it.
  if (hasSecretFinding(safe)) return null;
  return {
    id: record.id,
    sourceId: record.sourceId,
    sourceApplicationId: record.sourceApplicationId,
    version: record.version,
    summary: safe.text,
    contentDigest: record.contentDigest,
    classification: record.classification,
    region: record.region,
    tags: Array.isArray(record.tags) ? [...record.tags] : [],
    retention: { expiresAt: record.retention?.expiresAt || null }
  };
}

function makeMemory(memory = {}) {
  return {
    knowledge: memory.knowledge instanceof Map ? memory.knowledge : new Map(),
    knowledgeBySourceVersion: memory.knowledgeBySourceVersion instanceof Map ? memory.knowledgeBySourceVersion : new Map(),
    registrationIdempotency: memory.registrationIdempotency instanceof Map ? memory.registrationIdempotency : new Map(),
    receipts: memory.receipts instanceof Map ? memory.receipts : new Map(),
    retrievalIdempotency: memory.retrievalIdempotency instanceof Map ? memory.retrievalIdempotency : new Map(),
    retrievalInflight: memory.retrievalInflight instanceof Map ? memory.retrievalInflight : new Map()
  };
}

/**
 * A tenant-scoped reuse gateway. `governance` and `policyEvaluator` are
 * injected so the gateway does not substitute UI project tags, a vector store,
 * or a filesystem scan for enterprise authorization.
 */
export class AgenticXKnowledgeGateway {
  constructor({ governance = null, policyEvaluator = null, config = null, env = process.env, memory = null, clock = () => new Date() } = {}) {
    this.env = env;
    this.config = normalizeConfig(config || resolveAgenticXKnowledgeConfig(env));
    this.governance = governance;
    this.policyEvaluator = policyEvaluator;
    this.memory = makeMemory(memory || {});
    this.clock = clock;
  }

  isEnabledForTenant(tenantId) {
    return Boolean(this.config.enabled && (!this.config.enabledTenants.size || this.config.enabledTenants.has(tenantId)));
  }

  async register(input, context = {}) {
    const scope = registrationScope(input, context);
    await this.#hydrateKnowledge(scope, context);
    const sanitized = sanitizeAgenticXKnowledgeRecord(input, { ...scope, config: this.config, clock: this.clock });
    if (!sanitized.ok) {
      throw new AgenticXKnowledgeError("AgenticX knowledge is not eligible for registration.", {
        code: sanitized.denialReasons[0] || "knowledge_registration_denied",
        status: 422,
        details: { denialReasons: sanitized.denialReasons }
      });
    }
    let record = { ...sanitized.knowledge, createdAt: nowIso(this.clock), registeredBy: safeActor(context.actor) };
    const sourceVersionKey = `${record.tenantId}:${record.workspaceId}:${record.sourceId}:${record.version}`;
    const idempotencyKey = normalizedText(context.idempotencyKey || input.idempotencyKey || `register:${record.immutableFingerprint}`, 240);
    const operationKey = `${record.tenantId}:${record.workspaceId}:${idempotencyKey}`;
    const existingOperation = this.memory.registrationIdempotency.get(operationKey);
    if (existingOperation) {
      if (existingOperation.fingerprint !== record.immutableFingerprint) {
        throw new AgenticXKnowledgeError("Registration idempotency key was already used for different knowledge.", { code: "idempotency_conflict", status: 409 });
      }
      return { status: "idempotent", knowledge: clone(this.memory.knowledge.get(existingOperation.knowledgeId)) };
    }
    const existingId = this.memory.knowledgeBySourceVersion.get(sourceVersionKey);
    if (existingId) {
      const existing = this.memory.knowledge.get(existingId);
      if (existing?.immutableFingerprint !== record.immutableFingerprint) {
        throw new AgenticXKnowledgeError("Knowledge source versions are immutable; register a new version for changed material or controls.", { code: "knowledge_version_immutable", status: 409 });
      }
      this.memory.registrationIdempotency.set(operationKey, { fingerprint: record.immutableFingerprint, knowledgeId: existing.id });
      return { status: "idempotent", knowledge: clone(existing) };
    }
    const persisted = await this.#persistKnowledge(record, scope, context);
    if (persisted) record = persisted;
    this.memory.knowledge.set(record.id, record);
    this.memory.knowledgeBySourceVersion.set(sourceVersionKey, record.id);
    this.memory.registrationIdempotency.set(operationKey, { fingerprint: record.immutableFingerprint, knowledgeId: record.id });
    return { status: "registered", knowledge: clone(record) };
  }

  async registerKnowledge(input, context = {}) {
    return this.register(input, context);
  }

  async listEligibleKnowledge(context = {}) {
    return this.retrieve(context);
  }

  async listKnowledge(context = {}) {
    // Keep the convenient name without creating an ungoverned data-reading
    // path. A caller must still supply a purpose, region, and policy context.
    return this.listEligibleKnowledge(context);
  }

  async retrieve(input = {}) {
    const request = normalizeRetrievalInput(input, this.config);
    const fingerprint = safeRequestFingerprint(request);
    const idempotencyKey = request.idempotencyKey || `retrieve:${fingerprint.slice(0, 48)}`;
    const operationKey = `${request.tenantId}:${request.workspaceId}:${idempotencyKey}`;
    const prior = this.memory.retrievalIdempotency.get(operationKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) return this.#idempotencyConflict(request, fingerprint, idempotencyKey, operationKey);
      return { ...clone(prior.result), idempotent: true };
    }
    const inFlight = this.memory.retrievalInflight.get(operationKey);
    if (inFlight) return clone(await inFlight);
    const work = this.#retrieveOnce(request, fingerprint, idempotencyKey, operationKey);
    this.memory.retrievalInflight.set(operationKey, work);
    try {
      return await work;
    } finally {
      this.memory.retrievalInflight.delete(operationKey);
    }
  }

  async #idempotencyConflict(request, fingerprint, idempotencyKey, operationKey) {
    const receipt = this.#receipt({
      request,
      fingerprint,
      idempotencyKey,
      status: "denied",
      denialReasons: ["idempotency_conflict"],
      allowedKnowledgeIds: [],
      deniedCandidates: [],
      policyReceiptIds: []
    });
    await this.#persistReceipt(receipt, request);
    return {
      status: "denied",
      knowledge: [],
      denialReasons: ["idempotency_conflict"],
      receipt: clone(receipt),
      idempotent: false,
      operationKeyDigest: digest(operationKey)
    };
  }

  #enterpriseRetriever() {
    if (!this.governance || typeof this.governance !== "object") return null;
    if (typeof this.governance.retrieveAgenticXKnowledge === "function") {
      return { receiver: this.governance, fn: this.governance.retrieveAgenticXKnowledge };
    }
    if (typeof this.governance.retrieveTenantAgenticXKnowledge === "function") {
      return { receiver: this.governance, fn: this.governance.retrieveTenantAgenticXKnowledge };
    }
    return null;
  }

  /**
   * The enterprise authority is the only component allowed to discover
   * cross-workspace candidates. It evaluates each candidate before returning
   * a bounded, sanitized summary, so this gateway never hydrates or scans a
   * second workspace itself. A present-but-unavailable authority fails closed
   * rather than falling back to the older same-workspace memory path.
   */
  async #retrieveFromEnterpriseAuthority({ request, fingerprint, idempotencyKey, operationKey, atIso, at, retriever }) {
    const governanceEvidence = policyEvidenceForGovernance(request.evidence);
    const sanitizationEvidence = sanitizationEvidenceId(governanceEvidence);
    const authorityIdempotencyKey = `tenant-retrieve-${digest({
      fingerprint,
      targetApplicationId: request.targetApplicationId,
      requestKey: idempotencyKey
    }).slice(0, 48)}`;
    let authorityResult;
    try {
      authorityResult = await retriever.fn.call(retriever.receiver, {
        targetApplicationId: request.targetApplicationId,
        purpose: request.purpose,
        ...(request.policySnapshotId ? { policySnapshotId: request.policySnapshotId } : {}),
        data: {
          classification: request.maxClassification,
          region: request.region,
          egress: request.egress,
          retentionDays: request.retentionDays,
          transformations: [request.transformation],
          complianceControlIds: request.complianceControlIds
        },
        evidence: governanceEvidence,
        sanitization: {
          status: "sanitized",
          contentIncluded: false,
          transformIds: [request.transformation],
          evidenceId: sanitizationEvidence
        },
        knowledgeIds: request.knowledgeIds,
        impactLevel: request.impactLevel,
        ...(request.approval ? { approval: request.approval } : {}),
        maxResults: request.maxResults,
        idempotencyKey: authorityIdempotencyKey
      }, {
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        actor: request.actor
      });
    } catch {
      const receipt = this.#receipt({
        request,
        fingerprint,
        idempotencyKey,
        status: "denied",
        denialReasons: ["governance_evaluation_unavailable"],
        allowedKnowledgeIds: [],
        deniedCandidates: [],
        policyReceiptIds: [],
        atIso
      });
      await this.#persistReceipt(receipt, request);
      const result = { status: "denied", knowledge: [], denialReasons: ["governance_evaluation_unavailable"], receipt: clone(receipt), idempotent: false };
      this.memory.retrievalIdempotency.set(operationKey, { fingerprint, result: clone(result) });
      return result;
    }

    const authorityKnowledge = Array.isArray(authorityResult?.knowledge) ? authorityResult.knowledge : [];
    const authorityAllowed = authorityResult?.status === "allowed" || authorityResult?.receipt?.status === "allowed";
    const selected = [];
    const denials = [];
    if (authorityAllowed) {
      for (const record of authorityKnowledge) {
        if (selected.length >= request.maxResults) break;
        // The authority has already checked tenant and enterprise boundaries.
        // Retain the gateway's own narrow configuration gates without turning
        // its memory store into a cross-workspace discovery mechanism.
        const localReasons = localEligibility(record, request, this.config, at);
        if (localReasons.length) {
          denials.push({ knowledgeId: record?.id || null, reasonCodes: localReasons });
          continue;
        }
        const safe = publicKnowledge(record, this.config.maxSummaryChars);
        if (!safe) {
          denials.push({ knowledgeId: record?.id || null, reasonCodes: ["unsanitized_knowledge_denied"] });
          continue;
        }
        selected.push(safe);
      }
    }
    const policyReceiptIds = [
      ...(Array.isArray(authorityResult?.receipts) ? authorityResult.receipts : []).map((receipt) => receipt?.id),
      authorityResult?.receipt?.id
    ].filter((value) => typeof value === "string" && value.length);
    const authorityDenials = Array.isArray(authorityResult?.denialReasons) ? authorityResult.denialReasons : [];
    const denialReasons = [...new Set([
      ...authorityDenials,
      ...denials.flatMap((item) => item.reasonCodes),
      ...(!selected.length && !authorityDenials.length && !denials.length ? ["no_eligible_knowledge"] : [])
    ].map((reason) => normalizedText(reason, 120).toLowerCase().replace(/\s+/g, "_")).filter(Boolean))].sort();
    const status = selected.length ? "allowed" : "denied";
    const receipt = this.#receipt({
      request,
      fingerprint,
      idempotencyKey,
      status,
      denialReasons,
      allowedKnowledgeIds: selected.map((item) => item.id),
      deniedCandidates: denials,
      policyReceiptIds: [...new Set(policyReceiptIds)].sort(),
      atIso
    });
    await this.#persistReceipt(receipt, request);
    const result = {
      status,
      knowledge: selected,
      denialReasons,
      receipt: clone(receipt),
      idempotent: false
    };
    this.memory.retrievalIdempotency.set(operationKey, { fingerprint, result: clone(result) });
    return result;
  }

  async #retrieveOnce(request, fingerprint, idempotencyKey, operationKey) {
    const atIso = nowIso(this.clock);
    const at = Date.parse(atIso);
    const denials = [];
    const selected = [];
    const policyReceiptIds = [];
    const requestedIds = request.knowledgeIds;
    if (!this.isEnabledForTenant(request.tenantId)) {
      denials.push({ knowledgeId: null, reasonCodes: ["agenticx_feature_disabled"] });
      const receipt = this.#receipt({
        request,
        fingerprint,
        idempotencyKey,
        status: "denied",
        denialReasons: ["agenticx_feature_disabled"],
        allowedKnowledgeIds: [],
        deniedCandidates: denials,
        policyReceiptIds: [],
        atIso
      });
      await this.#persistReceipt(receipt, request);
      const result = { status: "denied", knowledge: [], denialReasons: ["agenticx_feature_disabled"], receipt: clone(receipt), idempotent: false };
      this.memory.retrievalIdempotency.set(operationKey, { fingerprint, result: clone(result) });
      return result;
    }
    const enterpriseRetriever = request.targetApplicationId ? this.#enterpriseRetriever() : null;
    if (enterpriseRetriever) {
      return this.#retrieveFromEnterpriseAuthority({
        request,
        fingerprint,
        idempotencyKey,
        operationKey,
        atIso,
        at,
        retriever: enterpriseRetriever
      });
    }
    try {
      await this.#hydrateKnowledge(request, { actor: request.actor });
    } catch {
      const receipt = this.#receipt({
        request,
        fingerprint,
        idempotencyKey,
        status: "denied",
        denialReasons: ["knowledge_persistence_unavailable"],
        allowedKnowledgeIds: [],
        deniedCandidates: [],
        policyReceiptIds: [],
        atIso
      });
      await this.#persistReceipt(receipt, request);
      const result = { status: "denied", knowledge: [], denialReasons: ["knowledge_persistence_unavailable"], receipt: clone(receipt), idempotent: false };
      this.memory.retrievalIdempotency.set(operationKey, { fingerprint, result: clone(result) });
      return result;
    }
    const candidates = requestedIds.length
      ? requestedIds.map((id) => ({ requestedId: id, record: this.memory.knowledge.get(id) || null }))
      : [...this.memory.knowledge.values()].sort((left, right) => left.id.localeCompare(right.id)).map((record) => ({ requestedId: record.id, record }));

    for (const candidate of candidates) {
      const record = candidate.record;
      if (!record) {
        denials.push({ knowledgeId: candidate.requestedId, reasonCodes: ["knowledge_not_found"] });
        continue;
      }
      if (record.tenantId !== request.tenantId) {
        // Deliberately do not return the other tenant's identity or contents.
        denials.push({ knowledgeId: null, reasonCodes: ["cross_tenant_denied"] });
        continue;
      }
      if (record.workspaceId !== request.workspaceId) {
        denials.push({ knowledgeId: record.id, reasonCodes: ["cross_workspace_denied"] });
        continue;
      }
      const localReasons = localEligibility(record, request, this.config, at);
      if (localReasons.length) {
        denials.push({ knowledgeId: record.id, reasonCodes: localReasons });
        continue;
      }
      const policy = await this.#evaluatePolicy(record, request, fingerprint, at);
      if (policy.receiptId) policyReceiptIds.push(policy.receiptId);
      if (!policy.allowed) {
        denials.push({ knowledgeId: record.id, reasonCodes: policy.denialReasons });
        continue;
      }
      const safe = publicKnowledge(record, this.config.maxSummaryChars);
      if (!safe) {
        denials.push({ knowledgeId: record.id, reasonCodes: ["unsanitized_knowledge_denied"] });
        continue;
      }
      if (selected.length < request.maxResults) selected.push(safe);
    }

    const denialReasons = [...new Set(denials.flatMap((item) => item.reasonCodes))].sort();
    if (!selected.length && !denialReasons.length) denialReasons.push("no_eligible_knowledge");
    const status = selected.length ? "allowed" : "denied";
    const receipt = this.#receipt({
      request,
      fingerprint,
      idempotencyKey,
      status,
      denialReasons,
      allowedKnowledgeIds: selected.map((item) => item.id),
      deniedCandidates: denials,
      policyReceiptIds: [...new Set(policyReceiptIds)].sort(),
      atIso
    });
    await this.#persistReceipt(receipt, request);
    const result = {
      status,
      knowledge: selected,
      denialReasons,
      receipt: clone(receipt),
      idempotent: false
    };
    this.memory.retrievalIdempotency.set(operationKey, { fingerprint, result: clone(result) });
    return result;
  }

  async #evaluatePolicy(record, request, fingerprint, at) {
    const evaluators = [];
    if (typeof this.policyEvaluator === "function") evaluators.push({ type: "policy_evaluator", fn: this.policyEvaluator, receiver: null });
    if (this.policyEvaluator && typeof this.policyEvaluator.evaluateAgenticXKnowledge === "function") evaluators.push({ type: "policy_evaluator", fn: this.policyEvaluator.evaluateAgenticXKnowledge, receiver: this.policyEvaluator });
    if (this.policyEvaluator && typeof this.policyEvaluator.evaluateKnowledgeReuse === "function") evaluators.push({ type: "policy_evaluator", fn: this.policyEvaluator.evaluateKnowledgeReuse, receiver: this.policyEvaluator });
    if (this.policyEvaluator && typeof this.policyEvaluator.evaluate === "function") evaluators.push({ type: "policy_evaluator", fn: this.policyEvaluator.evaluate, receiver: this.policyEvaluator });
    if (!this.policyEvaluator && typeof this.governance === "function") evaluators.push({ type: "policy_evaluator", fn: this.governance, receiver: null });
    if (this.governance && typeof this.governance.evaluateAgenticXKnowledge === "function") evaluators.push({ type: "policy_evaluator", fn: this.governance.evaluateAgenticXKnowledge, receiver: this.governance });
    if (this.governance && typeof this.governance.evaluateKnowledgeReuse === "function") evaluators.push({ type: "policy_evaluator", fn: this.governance.evaluateKnowledgeReuse, receiver: this.governance });

    const receiptIds = [];
    const governanceEvidence = policyEvidenceForGovernance(request.evidence);
    const sanitizationEvidence = sanitizationEvidenceId(governanceEvidence);
    for (const evaluator of evaluators) {
      try {
        const outcome = evaluationResult(await evaluator.fn.call(evaluator.receiver, {
          operation: "agenticx_knowledge_reuse",
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          purpose: request.purpose,
          data: {
            classification: record.classification,
            region: request.region,
            egress: request.egress,
            retentionDays: Math.max(0, Math.ceil((Date.parse(record.retention.expiresAt) - at) / (24 * 60 * 60 * 1000))),
            transformations: [request.transformation],
            complianceControlIds: request.complianceControlIds
          },
          knowledgeReference: { id: record.id, digest: record.contentDigest, classification: record.classification },
          targetApplicationId: request.targetApplicationId || null,
          sourceApplicationId: record.sourceApplicationId || null,
          policySnapshotId: request.policySnapshotId || null,
          complianceControlIds: request.complianceControlIds,
          evidence: governanceEvidence,
          sanitization: { status: "sanitized", contentIncluded: false, transformIds: [request.transformation], evidenceId: sanitizationEvidence }
        }, { tenantId: request.tenantId, workspaceId: request.workspaceId, actor: request.actor }));
        if (outcome.receiptId) receiptIds.push(outcome.receiptId);
        if (!outcome.allowed) return { allowed: false, denialReasons: outcome.denialReasons, receiptId: receiptIds[0] || null };
      } catch {
        return { allowed: false, denialReasons: ["governance_evaluation_unavailable"], receiptId: receiptIds[0] || null };
      }
    }

    const requestKnowledgeReuse = this.governance && (this.governance.requestKnowledgeReuse || this.governance.requestKnowledgeReuseReceipt);
    if (typeof requestKnowledgeReuse === "function") {
      if (!record.sourceApplicationId || !request.targetApplicationId) return { allowed: false, denialReasons: ["application_binding_required"], receiptId: receiptIds[0] || null };
      const retentionDays = Math.max(0, Math.ceil((Date.parse(record.retention.expiresAt) - at) / (24 * 60 * 60 * 1000)));
      const governanceIdempotencyKey = `akx-${digest({ fingerprint, sourceApplicationId: record.sourceApplicationId, targetApplicationId: request.targetApplicationId }).slice(0, 48)}`;
      try {
        const outcome = evaluationResult(await requestKnowledgeReuse.call(this.governance, {
          sourceApplicationId: record.sourceApplicationId,
          targetApplicationId: request.targetApplicationId,
          purpose: request.purpose,
          data: {
            classification: record.classification,
            region: request.region,
            egress: request.egress,
            retentionDays,
            transformations: [request.transformation],
            complianceControlIds: request.complianceControlIds
          },
          ...(request.policySnapshotId ? { policySnapshotId: request.policySnapshotId } : {}),
          evidence: governanceEvidence,
          knowledgeReferences: [{ id: record.id, digest: record.contentDigest, classification: record.classification }],
          sanitization: { status: "sanitized", contentIncluded: false, transformIds: [request.transformation], evidenceId: sanitizationEvidence },
          idempotencyKey: governanceIdempotencyKey
        }, { tenantId: request.tenantId, workspaceId: request.workspaceId, actor: request.actor }));
        if (outcome.receiptId) receiptIds.push(outcome.receiptId);
        return { allowed: outcome.allowed, denialReasons: outcome.denialReasons, receiptId: receiptIds[0] || null };
      } catch {
        return { allowed: false, denialReasons: ["governance_evaluation_unavailable"], receiptId: receiptIds[0] || null };
      }
    }
    return { allowed: true, denialReasons: [], receiptId: receiptIds[0] || null };
  }

  #receipt({ request, fingerprint, idempotencyKey, status, denialReasons, allowedKnowledgeIds, deniedCandidates, policyReceiptIds, atIso = nowIso(this.clock) }) {
    const requestKeyDigest = digest(idempotencyKey);
    return {
      id: deterministicId("akrr", { tenantId: request.tenantId, workspaceId: request.workspaceId, requestKeyDigest, fingerprint, status }),
      schemaVersion: AGENTICX_KNOWLEDGE_SCHEMA_VERSION,
      type: "agenticx.knowledge.reuse",
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      status,
      requestDigest: fingerprint,
      idempotencyKeyDigest: requestKeyDigest,
      purpose: request.purpose,
      region: request.region,
      egress: request.egress,
      transformation: request.transformation,
      maxClassification: request.maxClassification,
      targetApplicationId: request.targetApplicationId || null,
      policySnapshotId: request.policySnapshotId || null,
      actor: request.actor,
      allowedKnowledgeIds: [...new Set(allowedKnowledgeIds)].sort(),
      deniedCandidates: deniedCandidates.map((entry) => ({ knowledgeId: entry.knowledgeId || null, reasonCodes: [...new Set(entry.reasonCodes)].sort() })),
      denialReasons: [...new Set(denialReasons)].sort(),
      policyReceiptIds: [...new Set(policyReceiptIds)].sort(),
      resultCount: allowedKnowledgeIds.length,
      createdAt: atIso,
      persistence: "memory"
    };
  }

  async #persistReceipt(receipt, request) {
    const persistenceMethods = [
      "recordAgenticXReuseReceipt", "persistAgenticXReuseReceipt", "saveAgenticXReuseReceipt",
      "recordKnowledgeReuseReceipt", "persistKnowledgeReuseReceipt", "saveKnowledgeReuseReceipt", "recordReuseReceipt"
    ];
    let persisted = false;
    if (this.governance && typeof this.governance === "object") {
      for (const method of persistenceMethods) {
        if (typeof this.governance[method] !== "function") continue;
        try {
          await this.governance[method](clone(receipt), { tenantId: request.tenantId, workspaceId: request.workspaceId, actor: request.actor });
          persisted = true;
          break;
        } catch {
          // A fallback receipt is mandatory when the injected writer is unavailable.
        }
      }
    }
    receipt.persistence = persisted ? "governance" : "memory";
    this.memory.receipts.set(receipt.id, clone(receipt));
    return clone(receipt);
  }

  /**
   * The gateway has an in-memory fallback for isolated tests, while a composed
   * EnterpriseGovernanceService makes tenant knowledge durable. Only the
   * already-sanitized record is handed to that boundary; no raw prompt, file,
   * secret, or vector-store payload is ever persisted here.
   */
  async #persistKnowledge(record, scope, context) {
    const methods = ["registerAgenticXKnowledge", "persistAgenticXKnowledge", "saveAgenticXKnowledge"];
    const method = methods.find((name) => typeof this.governance?.[name] === "function");
    if (!method) return null;
    try {
      const result = await this.governance[method](clone(record), { tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: context.actor });
      const persisted = result?.knowledge || result?.record || result;
      if (!persisted || persisted.tenantId !== record.tenantId || persisted.workspaceId !== record.workspaceId || persisted.id !== record.id || persisted.contentDigest !== record.contentDigest) {
        throw new AgenticXKnowledgeError("The enterprise knowledge authority did not preserve the sanitized immutable record.", { code: "knowledge_persistence_invalid", status: 503 });
      }
      return clone(persisted);
    } catch (error) {
      if (error instanceof AgenticXKnowledgeError) throw error;
      throw new AgenticXKnowledgeError("AgenticX knowledge could not be persisted to the enterprise authority.", { code: "knowledge_persistence_unavailable", status: 503 });
    }
  }

  async #hydrateKnowledge(scope, context = {}) {
    const methods = ["listAgenticXKnowledge", "listPersistedAgenticXKnowledge", "readAgenticXKnowledge"];
    const method = methods.find((name) => typeof this.governance?.[name] === "function");
    if (!method) return;
    let result;
    try {
      result = await this.governance[method]({ tenantId: scope.tenantId, workspaceId: scope.workspaceId }, { tenantId: scope.tenantId, workspaceId: scope.workspaceId, actor: context.actor });
    } catch (error) {
      throw new AgenticXKnowledgeError("AgenticX knowledge could not be read from the enterprise authority.", { code: "knowledge_persistence_unavailable", status: 503 });
    }
    const records = Array.isArray(result) ? result : Array.isArray(result?.knowledge) ? result.knowledge : Array.isArray(result?.records) ? result.records : [];
    for (const item of records) {
      if (!item || item.tenantId !== scope.tenantId || item.workspaceId !== scope.workspaceId || !item.id || !item.sourceId || !item.version || !item.contentDigest || !item.summary || item.sanitized !== true) continue;
      this.memory.knowledge.set(item.id, clone(item));
      this.memory.knowledgeBySourceVersion.set(`${item.tenantId}:${item.workspaceId}:${item.sourceId}:${item.version}`, item.id);
    }
  }

  async listReceipts({ tenantId, workspaceId = "default" } = {}) {
    const scopedTenantId = TenantIdSchema.parse(tenantId);
    const scopedWorkspaceId = TenantIdSchema.parse(workspaceId);
    return [...this.memory.receipts.values()]
      .filter((receipt) => receipt.tenantId === scopedTenantId && receipt.workspaceId === scopedWorkspaceId)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)) || left.id.localeCompare(right.id))
      .map(clone);
  }
}

export const AgenticXKnowledgeService = AgenticXKnowledgeGateway;
export function createAgenticXKnowledgeGateway(options = {}) {
  return new AgenticXKnowledgeGateway(options);
}
