import crypto from "node:crypto";
import { z } from "zod";
import { DecisionContinuityError } from "./decisionContinuity.js";
import { neutralizeLogInstruction, redactSensitiveText } from "./selfImprovement/redaction.js";

/**
 * ResearchX is an intentionally narrow, audit-only research boundary.  It is
 * not a browser, crawler, code writer, policy editor, deployment client, or a
 * general-purpose network proxy.  A source must be registered first, the
 * tenant must opt in, all domains must be allowed twice (global configuration
 * and source record), and any non-zero estimated spend must be reserved before
 * a fetch starts.
 */
export const RESEARCHX_SCHEMA_VERSION = "researchx/v1";
export const RESEARCHX_SOURCE_TYPES = Object.freeze([
  "web_page", "documentation", "rss_feed", "atom_feed", "json_feed", "security_advisory"
]);
export const RESEARCHX_RUN_STATUSES = Object.freeze([
  "pending", "running", "completed", "completed_with_observation_error", "skipped", "failed"
]);
export const RESEARCHX_FAILURE_CODES = Object.freeze([
  "researchx_feature_disabled", "researchx_tenant_disabled", "researchx_network_disabled",
  "source_disabled", "source_not_found", "source_domain_denied", "redirect_denied",
  "cadence_not_due", "quota_exhausted", "budget_exhausted", "budget_authority_required",
  "policy_denied", "policy_evaluation_failed", "source_fetcher_required", "fetch_timeout",
  "fetch_failed", "response_status_denied", "response_too_large", "unsupported_content_type",
  "invalid_response", "callback_side_effect_denied", "budget_settlement_required"
]);

const MIN_CADENCE_MS = 60_000;
const MAX_CADENCE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_SOURCE_BYTES = 1_024 * 1_024;
const MAX_FETCH_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;
const MAX_SOURCES_PER_CYCLE = 32;
const MAX_EVIDENCE_CHARS = 8_000;
const SAFE_CONTENT_TYPES = new Set([
  "text/plain", "text/html", "application/json", "application/xml", "text/xml",
  "application/rss+xml", "application/atom+xml", "application/feed+json"
]);
const PRIVATE_HOSTS = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);
const CREDENTIAL_QUERY_KEY = /(?:^|[_-])(?:api[_-]?key|access[_-]?key|token|secret|password|authorization|signature)(?:$|[_-])/i;
const FORBIDDEN_CALLBACK_ACTION = /(?:deploy|patch|write(?:_code|_file)?|change[_-]?policy|execute|promote|delete)/i;

const nowIso = () => new Date().toISOString();
const createId = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: canonical(value[key]) }), {})
    : value;
const digest = (value) => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(canonical(value))).digest("hex");
const bool = (value) => String(value || "").trim().toLowerCase() === "true";
const csv = (value, fallback = []) => {
  const values = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  return values.length ? [...new Set(values)] : fallback;
};
const bounded = (value, fallback, maximum, minimum = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};
const text = (value, max = 1_000) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
const finiteAmount = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export class ResearchXError extends DecisionContinuityError {
  constructor(message, { code = "researchx_error", status = 400, details = null } = {}) {
    super(message, { code, status, details });
    this.name = "ResearchXError";
  }
}

function normalizeDomain(value) {
  const candidate = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (!candidate || candidate.length > 253 || /[\s/@:]/.test(candidate) || candidate === "*") {
    throw new ResearchXError("ResearchX allowlist entries must be a concrete DNS domain or a bounded subdomain wildcard.", {
      code: "invalid_source_domain"
    });
  }
  const wildcard = candidate.startsWith("*.");
  const domain = wildcard ? candidate.slice(2) : candidate.replace(/^\./, "");
  if (!domain || !domain.includes(".") || /(^-|-$|\.\.|[^a-z0-9.-])/i.test(domain)) {
    throw new ResearchXError("ResearchX allowlist entries must be valid public DNS domains.", { code: "invalid_source_domain" });
  }
  return wildcard ? `*.${domain}` : domain;
}

function normalizeDomainList(values, fallback = []) {
  const inputs = Array.isArray(values) ? values : fallback;
  return [...new Set(inputs.map(normalizeDomain))];
}

function matchesDomain(hostname, allowlist) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return Array.from(allowlist || []).some((entry) => {
    const domain = String(entry || "").toLowerCase();
    if (domain.startsWith("*.")) return host.endsWith(`.${domain.slice(2)}`) && host !== domain.slice(2);
    return host === domain || host.endsWith(`.${domain}`);
  });
}

function isIpAddress(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "");
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

function parseSafeUrl(raw, { allowHttp = false } = {}) {
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    throw new ResearchXError("ResearchX source URLs must be absolute HTTP(S) URLs.", { code: "invalid_source_url" });
  }
  if (!(["https:", ...(allowHttp ? ["http:"] : [])].includes(url.protocol))) {
    throw new ResearchXError("ResearchX only permits HTTPS source URLs unless HTTP is explicitly enabled.", { code: "source_protocol_denied" });
  }
  if (url.username || url.password || PRIVATE_HOSTS.has(url.hostname.toLowerCase()) || isIpAddress(url.hostname)) {
    throw new ResearchXError("ResearchX source URLs may not use credentials, local hosts, or IP addresses.", { code: "source_url_denied" });
  }
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== defaultPort) {
    throw new ResearchXError("ResearchX source URLs may only use their protocol default port.", { code: "source_port_denied" });
  }
  for (const [key] of url.searchParams.entries()) {
    if (CREDENTIAL_QUERY_KEY.test(key)) {
      throw new ResearchXError("ResearchX source URLs may not contain credential-like query parameters.", { code: "source_url_credential_denied" });
    }
  }
  return url;
}

function safeCitationUrl(raw) {
  const url = parseSafeUrl(raw, { allowHttp: true });
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function sourceUrlAllowed(rawUrl, allowlist, options = {}) {
  const url = parseSafeUrl(rawUrl, options);
  return matchesDomain(url.hostname, allowlist);
}

function normalizedContentType(value) {
  return String(value || "").toLowerCase().split(";", 1)[0].trim();
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const target = String(name).toLowerCase();
  const entry = Object.entries(headers).find(([key]) => String(key).toLowerCase() === target);
  return entry ? String(entry[1] || "") : "";
}

function redactedError(error) {
  return neutralizeLogInstruction(error?.message || String(error || "unknown_error"), { maxLength: 800 });
}

function stripMarkup(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, (entity) => ({
      "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'"
    })[entity.toLowerCase()] || " ");
}

/** Returns bounded, sanitized evidence suitable for persistence and review. */
export function redactResearchEvidence(value, { maxLength = MAX_EVIDENCE_CHARS, contentType = "" } = {}) {
  const extracted = /html|xml/i.test(contentType) ? stripMarkup(value) : String(value || "");
  return neutralizeLogInstruction(redactSensitiveText(extracted, { maxLength }), { maxLength });
}

export function resolveResearchXConfig(env = process.env) {
  const allowedDomains = new Set(normalizeDomainList(csv(env.RESEARCHX_ALLOWED_DOMAINS)));
  const enabledTenants = new Set(csv(env.RESEARCHX_ENABLED_TENANTS));
  const maxBytes = bounded(env.RESEARCHX_MAX_BYTES_PER_SOURCE, 128 * 1024, MAX_SOURCE_BYTES, 1_024);
  const fetchTimeoutMs = bounded(env.RESEARCHX_FETCH_TIMEOUT_MS, 10_000, MAX_FETCH_TIMEOUT_MS, 250);
  const cadenceMs = bounded(env.RESEARCHX_CADENCE_MS, 24 * 60 * 60 * 1000, MAX_CADENCE_MS, MIN_CADENCE_MS);
  return {
    enabled: bool(env.RESEARCHX_ENABLED),
    workerEnabled: bool(env.RESEARCHX_WORKER_ENABLED),
    networkEnabled: bool(env.RESEARCHX_NETWORK_ENABLED),
    enabledTenants,
    allowedDomains,
    cadenceMs,
    minCadenceMs: bounded(env.RESEARCHX_MIN_CADENCE_MS, MIN_CADENCE_MS, MAX_CADENCE_MS, MIN_CADENCE_MS),
    maxCadenceMs: bounded(env.RESEARCHX_MAX_CADENCE_MS, MAX_CADENCE_MS, MAX_CADENCE_MS, MIN_CADENCE_MS),
    maxBytesPerSource: maxBytes,
    fetchTimeoutMs,
    maxRedirects: bounded(env.RESEARCHX_MAX_REDIRECTS, 2, MAX_REDIRECTS, 0),
    maxSourcesPerCycle: bounded(env.RESEARCHX_MAX_SOURCES_PER_CYCLE, 8, MAX_SOURCES_PER_CYCLE, 1),
    maxRunsPerSourcePerDay: bounded(env.RESEARCHX_MAX_RUNS_PER_SOURCE_PER_DAY, 4, 100, 1),
    workerIntervalMs: bounded(env.RESEARCHX_WORKER_INTERVAL_MS, 60_000, MAX_CADENCE_MS, MIN_CADENCE_MS),
    maxEvidenceChars: bounded(env.RESEARCHX_MAX_EVIDENCE_CHARS, 3_000, MAX_EVIDENCE_CHARS, 200),
    allowHttp: bool(env.RESEARCHX_ALLOW_HTTP)
  };
}

const ResearchPolicyEvidenceSchema = z.object({
  id: z.string().min(1).max(160),
  controlIds: z.array(z.string().min(1).max(160)).min(1).max(64),
  status: z.enum(["verified", "unknown", "stale", "expired", "invalid", "unauthorized"]),
  authorized: z.boolean(),
  observedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional()
}).strict();

const ResearchHumanApprovalSchema = z.object({
  approved: z.literal(true),
  approverId: z.string().min(1).max(160),
  approvedAt: z.string().datetime(),
  evidenceId: z.string().min(1).max(160)
}).strict();

const SourceInputSchema = z.object({
  label: z.string().min(2).max(240),
  url: z.string().min(12).max(2_000),
  sourceType: z.enum(RESEARCHX_SOURCE_TYPES).default("web_page"),
  allowedDomains: z.array(z.string().min(3).max(253)).min(1).max(20).optional(),
  cadenceMs: z.number().int().min(MIN_CADENCE_MS).max(MAX_CADENCE_MS).optional(),
  maxBytes: z.number().int().min(1_024).max(MAX_SOURCE_BYTES).optional(),
  timeoutMs: z.number().int().min(250).max(MAX_FETCH_TIMEOUT_MS).optional(),
  maxRedirects: z.number().int().min(0).max(MAX_REDIRECTS).optional(),
  expectedContentTypes: z.array(z.string().min(3).max(120)).min(1).max(12).optional(),
  maxRunsPerDay: z.number().int().min(1).max(100).optional(),
  estimatedCostUsd: z.number().min(0).max(100_000).default(0),
  budgetId: z.string().min(1).max(200).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  // These records are optional only to preserve legacy/source-only use. A
  // composed EnterpriseGovernanceService fails closed until all required
  // application, data, and evidence facts are supplied.
  applicationId: z.string().min(1).max(160).optional(),
  policySnapshotId: z.string().min(1).max(200).nullable().optional(),
  dataClassification: z.enum(["public", "internal", "confidential", "restricted"]).default("public"),
  region: z.string().min(1).max(120).optional(),
  egress: z.string().min(1).max(160).default("allowlisted_internet"),
  retentionDays: z.number().int().min(0).max(36_500).default(1),
  transformations: z.array(z.string().min(1).max(160)).max(64).default(["redacted_summary"]),
  complianceControlIds: z.array(z.string().min(1).max(160)).max(128).default([]),
  policyEvidence: z.array(ResearchPolicyEvidenceSchema).max(256).default([]),
  impactLevel: z.enum(["low", "medium", "high", "critical"]).default("low"),
  approval: ResearchHumanApprovalSchema.optional(),
  enabled: z.boolean().default(true),
  idempotencyKey: z.string().min(8).max(240).optional()
}).strict();

function normalizeSource(input, config) {
  const parsed = SourceInputSchema.parse(input);
  const url = parseSafeUrl(parsed.url, { allowHttp: config.allowHttp });
  const allowedDomains = normalizeDomainList(parsed.allowedDomains || [url.hostname]);
  if (!matchesDomain(url.hostname, allowedDomains)) {
    throw new ResearchXError("A registered source URL must be covered by its own explicit source-domain allowlist.", { code: "source_domain_denied" });
  }
  const expectedContentTypes = [...new Set((parsed.expectedContentTypes || [...SAFE_CONTENT_TYPES]).map(normalizedContentType))];
  if (expectedContentTypes.some((type) => !SAFE_CONTENT_TYPES.has(type))) {
    throw new ResearchXError("ResearchX source content types must be bounded text, feed, XML, or JSON formats.", { code: "unsupported_content_type" });
  }
  return {
    label: text(parsed.label, 240),
    url: url.toString(),
    sourceType: parsed.sourceType,
    allowedDomains,
    cadenceMs: Math.min(config.maxCadenceMs, Math.max(config.minCadenceMs, parsed.cadenceMs || config.cadenceMs)),
    maxBytes: Math.min(config.maxBytesPerSource, parsed.maxBytes || config.maxBytesPerSource),
    timeoutMs: Math.min(config.fetchTimeoutMs, parsed.timeoutMs || config.fetchTimeoutMs),
    maxRedirects: Math.min(config.maxRedirects, parsed.maxRedirects ?? config.maxRedirects),
    expectedContentTypes,
    maxRunsPerDay: Math.min(config.maxRunsPerSourcePerDay, parsed.maxRunsPerDay || config.maxRunsPerSourcePerDay),
    estimatedCostUsd: Number(parsed.estimatedCostUsd),
    budgetId: parsed.budgetId || null,
    currency: parsed.currency,
    applicationId: parsed.applicationId ? text(parsed.applicationId, 160) : null,
    policySnapshotId: parsed.policySnapshotId || null,
    dataClassification: parsed.dataClassification,
    region: parsed.region ? text(parsed.region, 120) : null,
    egress: text(parsed.egress, 160),
    retentionDays: parsed.retentionDays,
    transformations: [...new Set(parsed.transformations.map((value) => text(value, 160)).filter(Boolean))],
    complianceControlIds: [...new Set(parsed.complianceControlIds.map((value) => text(value, 160)).filter(Boolean))],
    policyEvidence: copy(parsed.policyEvidence),
    impactLevel: parsed.impactLevel,
    approval: parsed.approval ? copy(parsed.approval) : null,
    enabled: parsed.enabled,
    idempotencyKey: parsed.idempotencyKey || null
  };
}

function ensureState(state) {
  state.researchXSources ||= {};
  state.researchXRuns ||= {};
  state.researchXEffects ||= {};
}

function audit({ tenantId, workspaceId, type, actor, correlationId = null, payload = {} }) {
  return {
    id: createId("dce"), schemaVersion: RESEARCHX_SCHEMA_VERSION, tenantId, workspaceId, type,
    occurredAt: nowIso(), actor: actor || { type: "service", id: "researchx" }, correlationId,
    payload: copy(payload)
  };
}

function assertScope({ tenantId, workspaceId = "default" } = {}) {
  if (!text(tenantId, 160)) throw new ResearchXError("ResearchX requires a tenant-scoped identity.", { code: "tenant_required", status: 401 });
  if (!text(workspaceId, 160)) throw new ResearchXError("ResearchX requires a workspace scope.", { code: "workspace_required", status: 400 });
  return { tenantId: text(tenantId, 160), workspaceId: text(workspaceId, 160) };
}

function inScope(record, scope) {
  return Boolean(record && record.tenantId === scope.tenantId && record.workspaceId === scope.workspaceId);
}

function sourceHost(source) {
  try { return parseSafeUrl(source.url, { allowHttp: true }).hostname; } catch { return ""; }
}

function dayStart(at) {
  const date = new Date(at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function scheduledKey(source, at) {
  return `${source.id}:${Math.floor(new Date(at).getTime() / source.cadenceMs)}`;
}

function requestIdempotencyKey(source, at, explicit) {
  return text(explicit, 240) || `researchx:${scheduledKey(source, at)}`;
}

function invocationMethod(target, names) {
  const name = names.find((candidate) => typeof target?.[candidate] === "function");
  return name ? target[name].bind(target) : null;
}

async function readBoundedBody(response, maxBytes) {
  const body = response?.body;
  if (typeof body === "string") {
    const bytes = Buffer.byteLength(body);
    if (bytes > maxBytes) throw new ResearchXError("The source response exceeded its configured byte limit.", { code: "response_too_large", status: 413 });
    return { text: body, byteLength: bytes };
  }
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    const bytes = Buffer.from(body);
    if (bytes.byteLength > maxBytes) throw new ResearchXError("The source response exceeded its configured byte limit.", { code: "response_too_large", status: 413 });
    return { text: new TextDecoder().decode(bytes), byteLength: bytes.byteLength };
  }
  if (body?.getReader) {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
        total += chunk.byteLength;
        if (total > maxBytes) {
          await reader.cancel("ResearchX byte limit exceeded").catch(() => {});
          throw new ResearchXError("The source response exceeded its configured byte limit.", { code: "response_too_large", status: 413 });
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock?.();
    }
    const content = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
    return { text: new TextDecoder().decode(content), byteLength: total };
  }
  if (body && typeof body[Symbol.asyncIterator] === "function") {
    const chunks = [];
    let total = 0;
    for await (const item of body) {
      const chunk = Buffer.isBuffer(item) ? item : Buffer.from(item);
      total += chunk.byteLength;
      if (total > maxBytes) throw new ResearchXError("The source response exceeded its configured byte limit.", { code: "response_too_large", status: 413 });
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks, total);
    return { text: content.toString("utf8"), byteLength: content.byteLength };
  }
  throw new ResearchXError("ResearchX source fetchers must return a bounded body string, bytes, or readable stream.", { code: "invalid_response" });
}

async function invokeFetcher(fetcher, request) {
  const method = typeof fetcher === "function" ? fetcher : fetcher?.fetch?.bind(fetcher);
  if (!method) throw new ResearchXError("ResearchX requires an injected bounded source-fetch adapter.", { code: "source_fetcher_required", status: 503 });
  const controller = new AbortController();
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ResearchXError("The source fetch timed out before evidence could be recorded.", { code: "fetch_timeout", status: 504 }));
      }, request.timeoutMs);
    });
    return await Promise.race([Promise.resolve(method({ ...request, signal: controller.signal, redirect: "manual" })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function redirectLocation(response) {
  return text(response?.location || headerValue(response?.headers, "location"), 2_000);
}

function isRedirectStatus(status) {
  return Number(status) >= 300 && Number(status) < 400;
}

/**
 * A minimal native-fetch adapter.  The service always requests manual
 * redirects and reads the body itself with a byte cap; callers may replace it
 * with a proxy/fixture adapter, but the service never falls back to fetch on
 * its own.
 */
export function createBoundedResearchSourceFetcher({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new ResearchXError("A fetch implementation is required to create a ResearchX fetch adapter.", { code: "source_fetcher_required", status: 503 });
  return async ({ url, signal, redirect = "manual" }) => {
    const response = await fetchImpl(url, {
      method: "GET", redirect, signal,
      headers: { accept: "text/html, text/plain, application/json, application/xml, application/rss+xml, application/atom+xml;q=0.9, */*;q=0.1" }
    });
    return { status: response.status, url: response.url || url, headers: response.headers, body: response.body };
  };
}

function callbackResultIsReviewOnly(result) {
  if (result === undefined || result === null) return true;
  if (typeof result !== "object" || Array.isArray(result)) return false;
  const serialized = JSON.stringify(result);
  return !FORBIDDEN_CALLBACK_ACTION.test(serialized);
}

function publicSource(source) {
  const { url, ...rest } = source;
  return { ...copy(rest), url: safeCitationUrl(url), host: sourceHost(source) };
}

function publicRun(run) {
  return copy(run);
}

function sourceInputFromRecord(source) {
  return {
    label: source.label,
    url: source.url,
    sourceType: source.sourceType,
    allowedDomains: source.allowedDomains,
    cadenceMs: source.cadenceMs,
    maxBytes: source.maxBytes,
    timeoutMs: source.timeoutMs,
    maxRedirects: source.maxRedirects,
    expectedContentTypes: source.expectedContentTypes,
    maxRunsPerDay: source.maxRunsPerDay,
    estimatedCostUsd: source.estimatedCostUsd,
    budgetId: source.budgetId,
    currency: source.currency,
    applicationId: source.applicationId || undefined,
    policySnapshotId: source.policySnapshotId,
    dataClassification: source.dataClassification,
    region: source.region || undefined,
    egress: source.egress,
    retentionDays: source.retentionDays,
    transformations: source.transformations,
    complianceControlIds: source.complianceControlIds,
    policyEvidence: source.policyEvidence,
    impactLevel: source.impactLevel,
    approval: source.approval || undefined,
    enabled: source.enabled,
    idempotencyKey: source.idempotencyKey || undefined
  };
}

/**
 * Tenant-scoped ResearchX control-plane service.  `governance` is optional
 * for the file-backed development adapter, but governed paid research requires
 * its reserve/settle/release budget methods.  The service deliberately exposes
 * no code, policy, deployment, shell, or provider execution capability.
 */
export class ResearchXService {
  constructor({ store = null, governance = null, sourceFetcher = null, config = resolveResearchXConfig(), observationCallback = null, now = () => new Date(), actor = { type: "service", id: "researchx" } } = {}) {
    this.governance = governance || null;
    this.store = store || governance?.store || null;
    if (!this.store?.mutate || !this.store?.readState) throw new Error("ResearchX requires an injected enterprise governance service/store with Decision Continuity persistence.");
    this.sourceFetcher = sourceFetcher;
    this.config = config;
    this.observationCallback = observationCallback;
    this.clock = now;
    this.actor = actor;
  }

  isEnabledForTenant(tenantId) {
    return Boolean(this.config.enabled && this.config.enabledTenants?.has(String(tenantId || "")));
  }

  async _mutate(work) {
    return this.store.mutate(async (state, events) => {
      ensureState(state);
      return work(state, events);
    });
  }

  async _state() {
    const state = await this.store.readState();
    ensureState(state);
    return state;
  }

  async _source(sourceId, scope, { includeDeleted = false } = {}) {
    const state = await this._state();
    const source = state.researchXSources?.[sourceId];
    if (!inScope(source, scope) || (!includeDeleted && source.deletedAt)) {
      throw new ResearchXError("The requested ResearchX source is unavailable in this tenant/workspace scope.", { code: "source_not_found", status: 404 });
    }
    return copy(source);
  }

  async createSource(input, context = {}) {
    const scope = assertScope(context);
    const normalized = normalizeSource(input, this.config);
    return this._mutate((state, events) => {
      const duplicate = Object.values(state.researchXSources).find((source) => inScope(source, scope) && source.idempotencyKey && source.idempotencyKey === normalized.idempotencyKey);
      if (duplicate) return { status: "idempotent", source: publicSource(duplicate) };
      const id = createId("researchx_source");
      const createdAt = nowIso();
      const source = {
        id, schemaVersion: RESEARCHX_SCHEMA_VERSION, tenantId: scope.tenantId, workspaceId: scope.workspaceId,
        ...normalized, createdAt, updatedAt: createdAt, deletedAt: null, revision: 1,
        sourceDigest: digest({ ...normalized, url: safeCitationUrl(normalized.url) })
      };
      state.researchXSources[id] = source;
      events.push(audit({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, type: "researchx.source.created", actor: context.actor || this.actor, payload: { sourceId: id, host: sourceHost(source), sourceType: source.sourceType, enabled: source.enabled } }));
      return { status: "created", source: publicSource(source) };
    });
  }

  async getSource(sourceId, context = {}) {
    const scope = assertScope(context);
    return publicSource(await this._source(sourceId, scope, { includeDeleted: Boolean(context.includeDeleted) }));
  }

  async updateSource(sourceId, patch, context = {}) {
    const scope = assertScope(context);
    return this._mutate((state, events) => {
      const existing = state.researchXSources[sourceId];
      if (!inScope(existing, scope) || existing.deletedAt) throw new ResearchXError("The requested ResearchX source is unavailable in this tenant/workspace scope.", { code: "source_not_found", status: 404 });
      // Build an explicit public-input view instead of spreading the persisted
      // record: IDs, tenant scope, audit metadata, and prior evidence must
      // never become writable source input.
      const normalized = normalizeSource({ ...sourceInputFromRecord(existing), ...patch, idempotencyKey: existing.idempotencyKey || undefined }, this.config);
      const source = {
        ...existing, ...normalized, updatedAt: nowIso(), revision: Number(existing.revision || 0) + 1,
        sourceDigest: digest({ ...normalized, url: safeCitationUrl(normalized.url) })
      };
      state.researchXSources[sourceId] = source;
      events.push(audit({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, type: "researchx.source.updated", actor: context.actor || this.actor, payload: { sourceId, host: sourceHost(source), revision: source.revision, enabled: source.enabled } }));
      return { status: "updated", source: publicSource(source) };
    });
  }

  /** Soft deletion preserves the approval/audit trail and prevents future fetches. */
  async deleteSource(sourceId, context = {}) {
    const scope = assertScope(context);
    return this._mutate((state, events) => {
      const source = state.researchXSources[sourceId];
      if (!inScope(source, scope) || source.deletedAt) throw new ResearchXError("The requested ResearchX source is unavailable in this tenant/workspace scope.", { code: "source_not_found", status: 404 });
      source.enabled = false;
      source.deletedAt = nowIso();
      source.updatedAt = source.deletedAt;
      source.revision = Number(source.revision || 0) + 1;
      events.push(audit({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, type: "researchx.source.deleted", actor: context.actor || this.actor, payload: { sourceId, host: sourceHost(source), revision: source.revision } }));
      return { status: "deleted", source: publicSource(source) };
    });
  }

  async listSources(context = {}) {
    const scope = assertScope(context);
    const state = await this._state();
    return Object.values(state.researchXSources)
      .filter((source) => inScope(source, scope))
      .filter((source) => context.includeDeleted || !source.deletedAt)
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)) || String(left.id).localeCompare(String(right.id)))
      .map(publicSource);
  }

  async listRuns({ sourceId, statuses, limit = 100, ...context } = {}) {
    const scope = assertScope(context);
    const max = Math.max(1, Math.min(Number(limit) || 100, 500));
    const allowedStatuses = Array.isArray(statuses) ? new Set(statuses.filter((status) => RESEARCHX_RUN_STATUSES.includes(status))) : null;
    const state = await this._state();
    return Object.values(state.researchXRuns)
      .filter((run) => inScope(run, scope))
      .filter((run) => !sourceId || run.sourceId === sourceId)
      .filter((run) => !allowedStatuses?.size || allowedStatuses.has(run.status))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)) || String(right.id).localeCompare(String(left.id)))
      .slice(0, max)
      .map(publicRun);
  }

  async getRun(runId, context = {}) {
    const scope = assertScope(context);
    const state = await this._state();
    const run = state.researchXRuns?.[runId];
    if (!inScope(run, scope)) throw new ResearchXError("The requested ResearchX run is unavailable in this tenant/workspace scope.", { code: "run_not_found", status: 404 });
    return publicRun(run);
  }

  _baseEligibility(source, scope, at, runs = []) {
    const config = this.config;
    if (!config.enabled) return { eligible: false, code: "researchx_feature_disabled", nextEligibleAt: null };
    if (!config.enabledTenants?.has(scope.tenantId)) return { eligible: false, code: "researchx_tenant_disabled", nextEligibleAt: null };
    if (!source.enabled || source.deletedAt) return { eligible: false, code: "source_disabled", nextEligibleAt: null };
    if (!config.networkEnabled) return { eligible: false, code: "researchx_network_disabled", nextEligibleAt: null };
    const host = sourceHost(source);
    if (!host || !matchesDomain(host, config.allowedDomains) || !matchesDomain(host, source.allowedDomains)) return { eligible: false, code: "source_domain_denied", nextEligibleAt: null };
    const now = new Date(at).getTime();
    // Count every attempted schedule slot, including pre-fetch denials.  A
    // caller must not be able to bypass cadence/quota simply by rotating
    // idempotency keys after a budget or policy denial.
    const scopedRuns = runs.filter((run) => run.sourceId === source.id && ["pending", "running", "completed", "completed_with_observation_error", "failed", "skipped"].includes(run.status));
    const latest = scopedRuns.sort((left, right) => new Date(right.startedAt || right.createdAt).getTime() - new Date(left.startedAt || left.createdAt).getTime())[0];
    const lastAt = latest ? new Date(latest.startedAt || latest.createdAt).getTime() : 0;
    const nextAt = lastAt ? lastAt + Number(source.cadenceMs) : now;
    if (lastAt && now < nextAt) return { eligible: false, code: "cadence_not_due", lastRunAt: new Date(lastAt).toISOString(), nextEligibleAt: new Date(nextAt).toISOString() };
    const runsToday = scopedRuns.filter((run) => dayStart(run.startedAt || run.createdAt) === dayStart(at)).length;
    if (runsToday >= Number(source.maxRunsPerDay || config.maxRunsPerSourcePerDay)) return { eligible: false, code: "quota_exhausted", nextEligibleAt: new Date(dayStart(at) + 24 * 60 * 60 * 1000).toISOString(), runsToday };
    return { eligible: true, code: null, lastRunAt: lastAt ? new Date(lastAt).toISOString() : null, nextEligibleAt: new Date(nextAt).toISOString(), runsToday };
  }

  async _evaluateGovernance(source, scope) {
    const method = invocationMethod(this.governance, ["evaluateResearchPolicy", "evaluatePolicy"]);
    if (!method) return { allowed: true, receipt: null };
    let applicationId = source.applicationId || null;
    if (!applicationId && source.budgetId && typeof this.governance?.getBudget === "function") {
      try {
        applicationId = (await this.governance.getBudget({ budgetId: source.budgetId }, scope))?.applicationId || null;
      } catch {
        // The policy evaluation below remains fail-closed; do not expose
        // budget details from another scope in a research worker response.
      }
    }
    if (!applicationId || !source.region) {
      return {
        allowed: false,
        code: "policy_denied",
        receipt: { status: "denied", allowed: false, reasonCodes: ["application_binding_required"] }
      };
    }
    const evidence = (source.policyEvidence || []).map((item) => ({
      id: item.id,
      controlIds: item.controlIds,
      status: item.status,
      authorized: item.authorized,
      observedAt: item.observedAt,
      ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId
    }));
    try {
      const result = await method({
        applicationId,
        action: "research_fetch",
        ...(source.policySnapshotId ? { policySnapshotId: source.policySnapshotId } : {}),
        ...(source.budgetId ? { budgetId: source.budgetId } : {}),
        // The strict EnterpriseGovernance research bridge accepts these
        // explicit routing facts in addition to the canonical data object.
        // They are duplicated here only for adapter compatibility, never
        // inferred from a URL or a source label.
        region: source.region,
        egress: source.egress,
        data: {
          classification: source.dataClassification,
          region: source.region,
          egress: source.egress,
          retentionDays: source.retentionDays,
          transformations: source.transformations,
          complianceControlIds: source.complianceControlIds
        },
        evidence,
        impactLevel: source.impactLevel,
        ...(source.approval ? { approval: source.approval } : {})
      }, scope);
      if (result === false || result?.allowed === false || result?.status === "denied") {
        return { allowed: false, code: "policy_denied", receipt: result || null };
      }
      return { allowed: true, receipt: result || null };
    } catch (error) {
      return { allowed: false, code: error?.code === "policy_denied" ? "policy_denied" : "policy_evaluation_failed", receipt: { error: redactedError(error) } };
    }
  }

  async scheduleEligibility({ sourceId, at = this.clock(), ...context } = {}) {
    const scope = assertScope(context);
    const source = await this._source(sourceId, scope);
    const state = await this._state();
    const base = this._baseEligibility(source, scope, at, Object.values(state.researchXRuns));
    if (!base.eligible) return { sourceId, ...base };
    const governance = await this._evaluateGovernance(source, scope);
    return { sourceId, ...base, eligible: governance.allowed, code: governance.allowed ? null : governance.code, governanceReceipt: governance.receipt ? copy(governance.receipt) : null };
  }

  async listScheduleEligibility({ at = this.clock(), ...context } = {}) {
    const sources = await this.listSources(context);
    const results = [];
    for (const source of sources) results.push(await this.scheduleEligibility({ sourceId: source.id, at, ...context }));
    return results;
  }

  async _createRun(source, scope, { at, idempotencyKey, actor, preflight }) {
    return this._mutate((state, events) => {
      const existingEffect = Object.values(state.researchXEffects).find((effect) => inScope(effect, scope) && effect.idempotencyKey === idempotencyKey);
      if (existingEffect) {
        const existingRun = state.researchXRuns[existingEffect.runId];
        return { idempotent: true, run: copy(existingRun) };
      }
      const id = createId("researchx_run");
      const createdAt = nowIso();
      const run = {
        id, schemaVersion: RESEARCHX_SCHEMA_VERSION, tenantId: scope.tenantId, workspaceId: scope.workspaceId,
        sourceId: source.id, sourceRevision: source.revision, idempotencyKey,
        status: preflight.eligible ? "pending" : "skipped", failureCode: preflight.eligible ? null : preflight.code,
        failureDetail: preflight.eligible ? null : null,
        scheduledAt: new Date(at).toISOString(), startedAt: null, completedAt: preflight.eligible ? nowIso() : null,
        createdAt, updatedAt: createdAt, revision: 1, reviewRequired: true,
        safety: { codeMutation: "not_supported", policyMutation: "not_supported", deployment: "not_supported", rawEvidencePersistence: "not_supported" },
        budget: { budgetId: source.budgetId, currency: source.currency, estimatedCostUsd: source.estimatedCostUsd, reservationId: null, reservationStatus: "not_required", actualCostUsd: null, actualCostEvidence: null },
        policy: { snapshotId: source.policySnapshotId, evaluationReceipt: preflight.governanceReceipt || null },
        citation: null, evidence: null, observation: { status: "not_attempted", reviewOnly: true }
      };
      if (!preflight.eligible) run.failureDetail = preflight.code;
      state.researchXRuns[id] = run;
      const effect = { id: createId("researchx_effect"), schemaVersion: RESEARCHX_SCHEMA_VERSION, tenantId: scope.tenantId, workspaceId: scope.workspaceId, idempotencyKey, runId: id, createdAt, updatedAt: createdAt, revision: 1 };
      state.researchXEffects[effect.id] = effect;
      events.push(audit({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, type: preflight.eligible ? "researchx.run.started" : "researchx.run.skipped", actor: actor || this.actor, correlationId: id, payload: { runId: id, sourceId: source.id, status: run.status, failureCode: run.failureCode, host: sourceHost(source) } }));
      return { idempotent: false, run: copy(run) };
    });
  }

  async _updateRun(runId, scope, mutate, { eventType, actor, payload = {} } = {}) {
    return this._mutate((state, events) => {
      const run = state.researchXRuns[runId];
      if (!inScope(run, scope)) throw new ResearchXError("The requested ResearchX run is unavailable in this tenant/workspace scope.", { code: "run_not_found", status: 404 });
      mutate(run);
      run.updatedAt = nowIso();
      run.revision = Number(run.revision || 0) + 1;
      if (eventType) events.push(audit({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, type: eventType, actor: actor || this.actor, correlationId: run.id, payload: { runId: run.id, sourceId: run.sourceId, status: run.status, failureCode: run.failureCode, ...payload } }));
      return copy(run);
    });
  }

  async _reserveBudget(source, run, scope) {
    if (source.estimatedCostUsd <= 0) return { required: false, reservationId: null, status: "not_required" };
    const reserve = invocationMethod(this.governance, ["reserveResearchBudget", "reserveBudget"]);
    if (!reserve || !source.budgetId) {
      throw new ResearchXError("Non-zero ResearchX spend requires an enterprise budget and a successful reservation before fetch.", { code: "budget_authority_required", status: 409 });
    }
    let applicationId = source.applicationId || null;
    if (!applicationId && typeof this.governance?.getBudget === "function") {
      try {
        applicationId = (await this.governance.getBudget({ budgetId: source.budgetId }, scope))?.applicationId || null;
      } catch {
        // No budget information is surfaced across a failed scope check.
      }
    }
    if (!applicationId) {
      throw new ResearchXError("ResearchX budget reservations require an application-scoped enterprise binding.", { code: "budget_authority_required", status: 409 });
    }
    try {
      const reserved = await reserve({
        budgetId: source.budgetId, amount: source.estimatedCostUsd, currency: source.currency,
        applicationId,
        purpose: "research_fetch",
        idempotencyKey: `${run.idempotencyKey}:reserve`,
        ...(source.policySnapshotId ? { policySnapshotId: source.policySnapshotId } : {})
      }, { ...scope, actor: this.actor });
      const reservationId = typeof reserved === "string" ? reserved : reserved?.reservationId || reserved?.reservation?.id || reserved?.id;
      if (!reservationId || reserved?.allowed === false || ["denied", "exhausted", "rejected"].includes(String(reserved?.status || "").toLowerCase())) {
        throw new ResearchXError("The enterprise research budget does not have an available reservation.", { code: "budget_exhausted", status: 409 });
      }
      return { required: true, reservationId: String(reservationId), status: "reserved", receipt: copy(reserved) };
    } catch (error) {
      if (error instanceof ResearchXError) throw error;
      throw new ResearchXError("The enterprise research budget reservation was not accepted; ResearchX did not fetch the source.", { code: error?.code === "budget_exhausted" ? "budget_exhausted" : "budget_authority_required", status: 409, details: { error: redactedError(error) } });
    }
  }

  async _releaseBudget(run, source, scope, reason) {
    if (!run.budget?.reservationId) return { status: "not_required" };
    const release = invocationMethod(this.governance, ["releaseResearchBudget", "releaseBudget"]);
    if (!release) return { status: "settlement_required", reason: "release_authority_unavailable" };
    try {
      const receipt = await release({ reservationId: run.budget.reservationId, reason: text(reason, 600), idempotencyKey: `${run.idempotencyKey}:release` }, { ...scope, actor: this.actor });
      return { status: "released", receipt: copy(receipt || null) };
    } catch (error) {
      return { status: "settlement_required", reason: redactedError(error) };
    }
  }

  async _settleBudget(run, source, scope, usage) {
    if (!run.budget?.reservationId) return { status: "not_required" };
    const actualAmount = finiteAmount(usage?.actualCostUsd);
    const usageEvidence = usage?.usageEvidence && typeof usage.usageEvidence === "object" ? copy(usage.usageEvidence) : null;
    if (actualAmount === null || !usageEvidence) {
      // Never invent or infer provider spend.  Retain the reservation for an
      // explicit human/accounting resolution instead of falsely releasing it.
      return { status: "settlement_required", actualCostUsd: null, reason: "verified_usage_evidence_required" };
    }
    const settle = invocationMethod(this.governance, ["settleResearchBudget", "settleBudget"]);
    if (!settle) return { status: "settlement_required", actualCostUsd: null, reason: "settlement_authority_unavailable" };
    try {
      const receipt = await settle({ reservationId: run.budget.reservationId, actualAmount, currency: source.currency, usageEvidence, idempotencyKey: `${run.idempotencyKey}:settle` }, { ...scope, actor: this.actor });
      return { status: "settled", actualCostUsd: actualAmount, receipt: copy(receipt || null), usageEvidence: copy(usageEvidence) };
    } catch (error) {
      return { status: "settlement_required", actualCostUsd: null, reason: redactedError(error) };
    }
  }

  async _fetchSource(source) {
    let url = source.url;
    const redirects = [];
    for (let redirectCount = 0; redirectCount <= source.maxRedirects; redirectCount += 1) {
      const response = await invokeFetcher(this.sourceFetcher, {
        url, timeoutMs: source.timeoutMs, maxBytes: source.maxBytes,
        allowedDomains: [...source.allowedDomains], maxRedirects: source.maxRedirects
      });
      if (!response || typeof response !== "object") throw new ResearchXError("The source fetch adapter returned an invalid response.", { code: "invalid_response" });
      const actualUrl = response.url || url;
      if (!sourceUrlAllowed(actualUrl, source.allowedDomains, { allowHttp: this.config.allowHttp }) || !matchesDomain(parseSafeUrl(actualUrl, { allowHttp: this.config.allowHttp }).hostname, this.config.allowedDomains)) {
        throw new ResearchXError("The source fetch adapter returned a URL outside the configured domain allowlists.", { code: "redirect_denied", status: 403 });
      }
      const adapterRedirects = Array.isArray(response.redirects) ? response.redirects : [];
      if (adapterRedirects.length > source.maxRedirects) {
        throw new ResearchXError("The source fetch adapter exceeded the configured redirect limit.", { code: "redirect_denied", status: 403 });
      }
      for (const redirect of adapterRedirects) {
        const redirectUrl = typeof redirect === "string" ? redirect : redirect?.url || redirect?.location;
        if (!redirectUrl || !sourceUrlAllowed(new URL(redirectUrl, url).toString(), source.allowedDomains, { allowHttp: this.config.allowHttp }) || !matchesDomain(parseSafeUrl(new URL(redirectUrl, url).toString(), { allowHttp: this.config.allowHttp }).hostname, this.config.allowedDomains)) {
          throw new ResearchXError("The source fetch adapter reported a redirect outside the explicit allowlists.", { code: "redirect_denied", status: 403 });
        }
      }
      if (response.redirected === true && actualUrl !== url && !Array.isArray(response.redirects)) {
        throw new ResearchXError("The source fetch adapter followed an unverified redirect.", { code: "redirect_denied", status: 403 });
      }
      if (isRedirectStatus(response.status)) {
        const location = redirectLocation(response);
        if (!location || redirectCount >= source.maxRedirects) throw new ResearchXError("The source redirect is missing or exceeds the configured redirect limit.", { code: "redirect_denied", status: 403 });
        const next = new URL(location, url).toString();
        if (!sourceUrlAllowed(next, source.allowedDomains, { allowHttp: this.config.allowHttp }) || !matchesDomain(parseSafeUrl(next, { allowHttp: this.config.allowHttp }).hostname, this.config.allowedDomains)) {
          throw new ResearchXError("A source redirect targets a domain outside the explicit allowlists.", { code: "redirect_denied", status: 403 });
        }
        redirects.push(safeCitationUrl(next));
        url = next;
        continue;
      }
      if (Number(response.status) < 200 || Number(response.status) >= 300) {
        throw new ResearchXError(`The source returned HTTP ${Number(response.status) || "unknown"}.`, { code: "response_status_denied", status: 502 });
      }
      const contentLength = Number(headerValue(response.headers, "content-length"));
      if (Number.isFinite(contentLength) && contentLength > source.maxBytes) throw new ResearchXError("The source response declared a body larger than its configured byte limit.", { code: "response_too_large", status: 413 });
      const contentType = normalizedContentType(response.contentType || headerValue(response.headers, "content-type"));
      if (!contentType || !source.expectedContentTypes.includes(contentType) || !SAFE_CONTENT_TYPES.has(contentType)) {
        throw new ResearchXError("The source response content type is not approved for ResearchX evidence collection.", { code: "unsupported_content_type", status: 415 });
      }
      const body = await readBoundedBody(response, source.maxBytes);
      return { url: actualUrl, redirects, contentType, ...body, usage: response.usage || null };
    }
    throw new ResearchXError("The source redirect limit was exceeded.", { code: "redirect_denied", status: 403 });
  }

  async _notifyObservation(run, source, scope) {
    const callback = this.observationCallback || invocationMethod(this.governance, ["createResearchObservation", "recordResearchObservation"]);
    if (!callback) return { status: "not_configured", reviewOnly: true };
    const payload = Object.freeze({
      schemaVersion: RESEARCHX_SCHEMA_VERSION,
      mode: "review_required",
      sideEffects: Object.freeze({ codeMutation: false, policyMutation: false, deployment: false, budgetMutation: false }),
      tenantId: scope.tenantId, workspaceId: scope.workspaceId,
      runId: run.id, sourceId: source.id,
      citation: copy(run.citation), evidence: copy(run.evidence),
      budget: { estimatedCostUsd: run.budget.estimatedCostUsd, actualCostUsd: run.budget.actualCostUsd },
      reviewRequired: true
    });
    try {
      const result = await callback(payload, { ...scope, actor: this.actor });
      if (!callbackResultIsReviewOnly(result)) return { status: "rejected", reviewOnly: true, reason: "callback_side_effect_denied" };
      return { status: "created", reviewOnly: true, receipt: copy(result || null) };
    } catch (error) {
      return { status: "failed", reviewOnly: true, reason: redactedError(error) };
    }
  }

  async runSource({ sourceId, at = this.clock(), idempotencyKey, ...context } = {}) {
    const scope = assertScope(context);
    const source = await this._source(sourceId, scope);
    const eligibility = await this.scheduleEligibility({ sourceId, at, ...context });
    const key = requestIdempotencyKey(source, at, idempotencyKey);
    const created = await this._createRun(source, scope, { at, idempotencyKey: key, actor: context.actor || this.actor, preflight: eligibility });
    if (created.idempotent) return { status: "idempotent", run: publicRun(created.run) };
    let run = created.run;
    if (!eligibility.eligible) return { status: "skipped", run: publicRun(run) };

    try {
      const reservation = await this._reserveBudget(source, run, scope);
      run = await this._updateRun(run.id, scope, (record) => {
        record.status = "running";
        record.startedAt = nowIso();
        record.budget = { ...record.budget, reservationId: reservation.reservationId, reservationStatus: reservation.status, reservationReceipt: reservation.receipt || null };
      }, { actor: context.actor || this.actor });
    } catch (error) {
      run = await this._updateRun(run.id, scope, (record) => {
        record.status = "skipped";
        record.failureCode = error?.code === "budget_exhausted" ? "budget_exhausted" : "budget_authority_required";
        record.failureDetail = redactedError(error);
        record.completedAt = nowIso();
      }, { eventType: "researchx.run.skipped", actor: context.actor || this.actor });
      return { status: "skipped", run: publicRun(run) };
    }

    try {
      const fetched = await this._fetchSource(source);
      const evidence = redactResearchEvidence(fetched.text, { maxLength: this.config.maxEvidenceChars, contentType: fetched.contentType });
      const citation = {
        sourceId: source.id, url: safeCitationUrl(fetched.url), redirects: fetched.redirects,
        retrievedAt: nowIso(), contentType: fetched.contentType, contentDigest: digest(fetched.text)
      };
      const settlement = await this._settleBudget(run, source, scope, fetched.usage);
      run = await this._updateRun(run.id, scope, (record) => {
        record.citation = citation;
        record.evidence = { digest: digest(evidence), excerpt: evidence, byteLength: fetched.byteLength, rawContentPersisted: false };
        record.budget = {
          ...record.budget,
          reservationStatus: settlement.status,
          actualCostUsd: settlement.actualCostUsd,
          actualCostEvidence: settlement.usageEvidence || null,
          settlementReceipt: settlement.receipt || null,
          settlementReason: settlement.reason || null
        };
        record.status = "completed";
        record.failureCode = settlement.status === "settlement_required" ? "budget_settlement_required" : null;
        record.failureDetail = settlement.reason || null;
        record.completedAt = nowIso();
      }, { actor: context.actor || this.actor });
      const observation = await this._notifyObservation(run, source, scope);
      run = await this._updateRun(run.id, scope, (record) => {
        record.observation = observation;
        if (observation.status === "failed") record.status = "completed_with_observation_error";
      }, { eventType: "researchx.observation.created", actor: context.actor || this.actor, payload: { observationStatus: observation.status, reviewOnly: true } });
      return { status: run.status === "completed" ? "completed" : "completed_with_observation_error", run: publicRun(run) };
    } catch (error) {
      const release = await this._releaseBudget(run, source, scope, error?.code || "fetch_failed");
      run = await this._updateRun(run.id, scope, (record) => {
        record.status = "failed";
        record.failureCode = RESEARCHX_FAILURE_CODES.includes(error?.code) ? error.code : "fetch_failed";
        record.failureDetail = redactedError(error);
        record.completedAt = nowIso();
        record.budget = { ...record.budget, reservationStatus: release.status, releaseReceipt: release.receipt || null, releaseReason: release.reason || null };
      }, { eventType: "researchx.run.failed", actor: context.actor || this.actor });
      return { status: "failed", run: publicRun(run) };
    }
  }

  async runEligible({ at = this.clock(), limit = this.config.maxSourcesPerCycle, ...context } = {}) {
    const scope = assertScope(context);
    const maximum = Math.max(1, Math.min(Number(limit) || this.config.maxSourcesPerCycle, this.config.maxSourcesPerCycle));
    const eligibility = await this.listScheduleEligibility({ at, ...context });
    const eligible = eligibility.filter((entry) => entry.eligible).slice(0, maximum);
    const results = [];
    for (const entry of eligible) results.push(await this.runSource({ sourceId: entry.sourceId, at, ...context }));
    return { tenantId: scope.tenantId, workspaceId: scope.workspaceId, at: new Date(at).toISOString(), eligible: eligibility, results };
  }

  // Friendly aliases for callers that use an imperative worker vocabulary.
  async registerSource(input, context = {}) { return this.createSource(input, context); }
  async retireSource(sourceId, context = {}) { return this.deleteSource(sourceId, context); }
  async executeRun(input = {}) { return this.runSource(input); }
  async runScheduled(input = {}) { return this.runEligible(input); }
}

/**
 * Creates a low-privilege scheduler.  It only calls `runEligible`; source
 * registration, policy changes, deployments, and code edits are deliberately
 * absent.  Callers may use `start: false` to invoke `runOnce` from an external
 * durable scheduler instead of keeping an interval in-process.
 */
export function createResearchXWorker({ service, config = service?.config, logger = console, tenantIds = null, workspaceId = "default", intervalMs, start = false } = {}) {
  if (!service?.runEligible) throw new ResearchXError("ResearchX worker bootstrap requires a ResearchX service.", { code: "researchx_worker_service_required", status: 503 });
  if (!config?.enabled || !config?.workerEnabled || !config?.networkEnabled || !config.enabledTenants?.size) {
    throw new ResearchXError("ResearchX worker is disabled until explicit feature, worker, network, and tenant configuration is present.", { code: "researchx_worker_disabled", status: 503 });
  }
  const configuredTenantIds = [...new Set((tenantIds || [...config.enabledTenants]).map((value) => text(value, 160)).filter(Boolean))]
    .filter((tenantId) => config.enabledTenants.has(tenantId));
  if (!configuredTenantIds.length) throw new ResearchXError("ResearchX worker has no explicitly enabled tenant scope.", { code: "researchx_worker_disabled", status: 503 });
  const cadence = Math.max(MIN_CADENCE_MS, Math.min(Number(intervalMs) || config.workerIntervalMs, MAX_CADENCE_MS));
  let timer = null;
  let running = false;
  const runOnce = async () => {
    if (running) return { status: "already_running", results: [] };
    running = true;
    try {
      const results = [];
      for (const tenantId of configuredTenantIds) {
        try {
          results.push(await service.runEligible({ tenantId, workspaceId, limit: config.maxSourcesPerCycle }));
        } catch (error) {
          results.push({ tenantId, workspaceId, status: "failed", error: redactedError(error) });
        }
      }
      return { status: "completed", results };
    } finally {
      running = false;
    }
  };
  const worker = {
    config: copy({ ...config, enabledTenants: [...config.enabledTenants], allowedDomains: [...config.allowedDomains] }),
    async runOnce() { return runOnce(); },
    async start() {
      if (timer) return { status: "already_started" };
      await runOnce();
      timer = setInterval(() => { void runOnce().then((result) => logger.info?.(JSON.stringify({ component: "researchx-worker", event: "cycle_completed", result }))).catch((error) => logger.error?.(error)); }, cadence);
      timer.unref?.();
      return { status: "started", intervalMs: cadence };
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      return { status: "stopped" };
    },
    health() { return { status: "ready", component: "researchx-worker", running, scheduled: Boolean(timer), tenantCount: configuredTenantIds.length, intervalMs: cadence }; }
  };
  if (start) void worker.start();
  return worker;
}

/**
 * Process-safe worker bootstrap.  Configuration comes exclusively from the
 * supplied process environment (or an injected environment in tests), never a
 * source file or an unbounded remote configuration endpoint.  A service must
 * be supplied by the application composition root so this module cannot
 * silently create a filesystem store or unauthenticated governance client.
 */
export async function bootstrapResearchXWorker({ env = process.env, service = null, createService = null, logger = console, start = true, ...options } = {}) {
  const config = resolveResearchXConfig(env);
  if (!config.enabled || !config.workerEnabled || !config.networkEnabled || !config.enabledTenants.size) {
    throw new ResearchXError("ResearchX worker bootstrap failed closed because the required enabled configuration is absent.", { code: "researchx_worker_disabled", status: 503 });
  }
  const resolvedService = service || await createService?.({ env, config });
  if (!resolvedService) throw new ResearchXError("ResearchX worker bootstrap requires an application-composed service; no default network/store wiring is permitted.", { code: "researchx_worker_service_required", status: 503 });
  return createResearchXWorker({ service: resolvedService, config, logger, start, ...options });
}
