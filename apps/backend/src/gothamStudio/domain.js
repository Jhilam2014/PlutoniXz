import crypto from "node:crypto";
import { z } from "zod";

export const STUDIO_JOB_STATES = Object.freeze([
  "DRAFT",
  "QUEUED",
  "SUBMITTED",
  "STARTING",
  "RUNNING",
  "PAUSED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLING",
  "CANCELLED",
  "UNKNOWN"
]);

export const TERMINAL_STUDIO_JOB_STATES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);
export const ACTIVE_STUDIO_JOB_STATES = new Set(["QUEUED", "SUBMITTED", "STARTING", "RUNNING", "PAUSED", "CANCELLING", "UNKNOWN"]);

const providerIdSchema = z.string().trim().min(2).max(80).regex(/^[a-z][a-z0-9-]*$/);
const idSchema = z.string().trim().min(1).max(180);
const safeRecordSchema = z.record(z.unknown());

export const studioConstraintsSchema = z.object({
  maxRuns: z.number().int().min(1).max(50).default(1),
  maxEstimatedCost: z.number().finite().nonnegative().max(1_000_000).nullable().optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).default("USD"),
  maxRuntimeMinutes: z.number().int().min(1).max(43_200).default(60),
  allowedProviders: z.array(providerIdSchema).max(12).default([]),
  allowedComputeClasses: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
  allowGpu: z.boolean().default(false),
  allowDeployment: z.boolean().default(false)
}).strict();

export const studioPipelineInputSchema = z.object({
  workspaceId: idSchema,
  projectId: idSchema,
  name: z.string().trim().min(2).max(160),
  objective: z.string().trim().min(4).max(4_000),
  providerPreference: providerIdSchema.optional(),
  functionalityId: z.string().trim().max(180).optional(),
  stages: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    type: z.string().trim().min(2).max(120),
    name: z.string().trim().max(160).optional(),
    dependsOn: z.array(z.string().trim().min(1).max(120)).max(30).optional()
  }).strict()).min(1).max(100),
  providerConfiguration: safeRecordSchema.default({})
}).strict();

export const studioJobInputSchema = z.object({
  workspaceId: idSchema,
  projectId: idSchema,
  pipelineId: z.string().trim().max(180).optional(),
  functionalityId: z.string().trim().max(180).optional(),
  name: z.string().trim().min(2).max(180),
  objective: z.string().trim().min(4).max(6_000),
  provider: providerIdSchema,
  parameters: safeRecordSchema.default({}),
  providerConfiguration: safeRecordSchema.default({}),
  constraints: studioConstraintsSchema.default({}),
  workflowMode: z.enum(["planner", "debugger", "executor"]).default("executor"),
  submit: z.boolean().default(false),
  triggerSource: z.enum(["gotham", "studio", "api", "retry", "reconciler"]).default("studio")
}).strict();

export const studioJobProposalSchema = z.object({
  objective: z.string().trim().min(4).max(6_000),
  provider: providerIdSchema.optional(),
  pipeline: z.object({
    name: z.string().trim().min(2).max(160),
    stages: z.array(z.object({ id: z.string(), type: z.string() }).passthrough()).min(1).max(30)
  }).strict(),
  constraints: studioConstraintsSchema,
  deploymentPolicy: z.enum(["do_not_deploy", "approval_required"]).default("do_not_deploy"),
  estimatedResources: z.string().trim().max(500).nullable().default(null),
  estimatedCost: z.object({ amount: z.number().nonnegative(), currency: z.string().length(3), source: z.literal("provider") }).nullable().default(null),
  requiredInputs: z.array(z.string().trim().min(1).max(240)).max(20).default([])
}).strict();

const secretKeyPattern = /(^|_)(api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|bearer[-_]?token|password|passwd|secret|auth|authorization|private[-_]?key|client[-_]?secret|credential)s?($|_)/i;
const secretValuePatterns = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:dapi|dapij|ghp_|sk-)[A-Za-z0-9_-]{12,}\b/g,
  /([?&](?:token|key|secret|sig|signature)=)[^&\s]+/gi
];

export class GothamStudioError extends Error {
  constructor(message, { code = "gotham_studio_error", status = 400, retryable = false, details } = {}) {
    super(message);
    this.name = "GothamStudioError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export function studioId(prefix) {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${date}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export function normalizeProviderId(value = "") {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
}

export function sanitizeProviderText(value, fallback = "Provider operation failed.") {
  let text = String(value || fallback).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  for (const pattern of secretValuePatterns) text = text.replace(pattern, (match, prefix) => prefix ? `${prefix}[REDACTED]` : "[REDACTED]");
  return text.slice(0, 1_000) || fallback;
}

export function safeProviderUrl(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      return url.toString().slice(0, 2_000);
    }
  } catch {
    // Invalid and unsafe provider links remain unavailable.
  }
  return "";
}

export function sanitizeStudioValue(value, depth = 0) {
  if (depth > 8) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeStudioValue(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" ? sanitizeProviderText(value, "") : value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (secretKeyPattern.test(key)) return [];
    return [[key, sanitizeStudioValue(child, depth + 1)]];
  }));
}

export function assertNoProviderSecrets(value, trail = "providerConfiguration", depth = 0) {
  if (depth > 10 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoProviderSecrets(item, `${trail}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (secretKeyPattern.test(key)) {
      throw new GothamStudioError(`Provider credentials are backend-only; remove ${trail}.${key}.`, {
        code: "provider_secret_in_request",
        status: 400
      });
    }
    assertNoProviderSecrets(child, `${trail}.${key}`, depth + 1);
  }
}

export function publicStudioRecord(record = {}) {
  const { tenantId: _tenantId, idempotencyKey: _idempotencyKey, ...safe } = sanitizeStudioValue(record);
  return safe;
}

export function publicProviderMetadata(metadata = {}) {
  return sanitizeStudioValue(metadata);
}

export function isTerminalStudioState(state) {
  return TERMINAL_STUDIO_JOB_STATES.has(String(state || "").toUpperCase());
}

export function isActiveStudioState(state) {
  return ACTIVE_STUDIO_JOB_STATES.has(String(state || "").toUpperCase());
}

const allowedTransitions = new Map([
  ["DRAFT", new Set(["SUBMITTED", "QUEUED", "FAILED", "CANCELLED"])],
  ["SUBMITTED", new Set(["QUEUED", "STARTING", "RUNNING", "FAILED", "CANCELLING", "CANCELLED", "UNKNOWN"])],
  ["QUEUED", new Set(["STARTING", "RUNNING", "FAILED", "CANCELLING", "CANCELLED", "UNKNOWN"])],
  ["STARTING", new Set(["RUNNING", "FAILED", "CANCELLING", "CANCELLED", "UNKNOWN"])],
  ["RUNNING", new Set(["PAUSED", "SUCCEEDED", "FAILED", "CANCELLING", "CANCELLED", "UNKNOWN"])],
  ["PAUSED", new Set(["RUNNING", "FAILED", "CANCELLING", "CANCELLED", "UNKNOWN"])],
  ["CANCELLING", new Set(["CANCELLED", "FAILED", "UNKNOWN"])],
  ["UNKNOWN", new Set(["QUEUED", "STARTING", "RUNNING", "PAUSED", "SUCCEEDED", "FAILED", "CANCELLING", "CANCELLED"])],
  ["FAILED", new Set()],
  ["SUCCEEDED", new Set()],
  ["CANCELLED", new Set()]
]);

export function assertStudioStateTransition(currentState, nextState) {
  const current = String(currentState || "UNKNOWN").toUpperCase();
  const next = String(nextState || "UNKNOWN").toUpperCase();
  if (!STUDIO_JOB_STATES.includes(next)) {
    throw new GothamStudioError(`Unknown logical job state: ${next}.`, { code: "invalid_job_state", status: 500 });
  }
  if (current === next) return next;
  if (!allowedTransitions.get(current)?.has(next)) {
    throw new GothamStudioError(`Job cannot transition from ${current} to ${next}.`, { code: "invalid_job_transition", status: 409 });
  }
  return next;
}

export function studioScopeKey({ tenantId, workspaceId, projectId } = {}) {
  if (!tenantId || !workspaceId || !projectId) {
    throw new GothamStudioError("Tenant, workspace, and project context are required.", { code: "studio_scope_required", status: 400 });
  }
  return `${tenantId}:${workspaceId}:${projectId}`;
}
