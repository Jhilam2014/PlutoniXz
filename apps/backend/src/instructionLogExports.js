import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
const MAX_EXPORT_BYTES = 4 * 1024 * 1024;
const EXPORT_SECRET_KEY = /(?:authorization|cookie|password|secret|token|api[_-]?key|database[_-]?url|connection[_-]?string|private[_-]?key)/i;
const EXPORT_SECRET_VALUE = /(?:bearer\s+[a-z0-9._~-]+|(?:sk|pk|apify_api)_[a-z0-9_-]+|postgres(?:ql)?:\/\/[^\s]+|AIza[\w-]{20,})/gi;

export class InstructionLogExportError extends Error {
  constructor(message, { code = "instruction_log_export_error", status = 400 } = {}) {
    super(message);
    this.name = "InstructionLogExportError";
    this.code = code;
    this.status = status;
  }
}

function requiredScope(scope = {}) {
  const normalized = {
    tenantId: String(scope.tenantId || "").trim(),
    workspaceId: String(scope.workspaceId || "").trim(),
    projectId: String(scope.projectId || "").trim()
  };
  if (!normalized.tenantId || !normalized.workspaceId || !normalized.projectId) {
    throw new InstructionLogExportError("Tenant, workspace, and project context are required.", {
      code: "instruction_log_export_scope_required",
      status: 400
    });
  }
  return normalized;
}

function portableSegment(value, fallback) {
  return String(value || fallback)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || fallback;
}

function exportTimestamp(value) {
  const date = new Date(value || Date.now());
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return safe.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function instructionSequenceId(instruction = {}) {
  const explicit = String(instruction.instructionSequenceId || instruction.parentWorkflowId || instruction.workflowId || instruction.buildId || "").trim();
  if (explicit) return explicit.slice(0, 240);
  const source = [instruction.projectId, instruction.recordedAt, instruction.instruction].map((value) => String(value || "")).join("\u0000");
  return `instruction-${crypto.createHash("sha256").update(source).digest("hex").slice(0, 24)}`;
}

export function instructionLogExportFilename({ enterpriseName, projectName, instructionSequenceId: sequenceId, exportId, createdAt } = {}) {
  return [
    portableSegment(enterpriseName, "enterprise"),
    portableSegment(projectName, "project"),
    portableSegment(sequenceId, "instruction"),
    portableSegment(exportId, "export"),
    exportTimestamp(createdAt)
  ].join("_") + ".txt";
}

function eventProviderAccount(event = {}) {
  const selection = event.providerRuntimeSelection || event.providerSelection || {};
  const providerId = String(event.providerId || event.provider || selection.providerId || "").trim();
  const providerProfileId = String(event.providerProfileId || event.profileId || selection.profileId || "").trim();
  if (!providerId && !providerProfileId) return null;
  return { providerId: providerId || "unknown", providerProfileId: providerProfileId || "" };
}

function uniqueProviderAccounts(events = [], instruction = {}) {
  const candidates = [eventProviderAccount(instruction), ...events.map(eventProviderAccount)].filter(Boolean);
  const seen = new Set();
  return candidates.filter((account) => {
    const key = `${account.providerId}:${account.providerProfileId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function redactExport(value, ancestors = new WeakSet()) {
  if (typeof value === "string") return value.replace(EXPORT_SECRET_VALUE, "<redacted>");
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return "<circular>";
    ancestors.add(value);
    const redacted = value.map((item) => redactExport(item, ancestors));
    ancestors.delete(value);
    return redacted;
  }
  if (!value || typeof value !== "object") return value;
  if (ancestors.has(value)) return "<circular>";
  ancestors.add(value);
  const redacted = Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    EXPORT_SECRET_KEY.test(key) ? "<redacted>" : redactExport(item, ancestors)
  ]));
  ancestors.delete(value);
  return redacted;
}

function jsonSection(value) {
  return JSON.stringify(redactExport(value), null, 2);
}

function boundedContent(content) {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes <= MAX_EXPORT_BYTES) return { content, truncated: false, originalBytes: bytes };
  const suffix = `\n\n[Export truncated at ${MAX_EXPORT_BYTES} bytes; original size ${bytes} bytes.]\n`;
  const bounded = Buffer.from(content, "utf8").subarray(0, MAX_EXPORT_BYTES - Buffer.byteLength(suffix)).toString("utf8");
  return { content: `${bounded}${suffix}`, truncated: true, originalBytes: bytes };
}

export function buildInstructionLogExport({ scope, project, instruction, events = [], actor = {}, now = new Date() } = {}) {
  const normalizedScope = requiredScope(scope);
  const sequenceId = instructionSequenceId(instruction);
  const exportId = `gotham-log-${crypto.randomUUID()}`;
  const createdAt = new Date(now).toISOString();
  const providerAccounts = uniqueProviderAccounts(events, instruction);
  const enterpriseName = String(project?.enterprise?.name || project?.enterpriseName || "Enterprise").trim();
  const projectName = String(project?.name || instruction?.projectName || "Project").trim();
  const filename = instructionLogExportFilename({
    enterpriseName,
    projectName,
    instructionSequenceId: sequenceId,
    exportId,
    createdAt
  });
  const chronologicalEvents = [...events].sort((left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0));
  const header = [
    "PlutoMix Gotham instruction execution log",
    `Export ID: ${exportId}`,
    `Created at: ${createdAt}`,
    `Enterprise: ${enterpriseName}`,
    `Project: ${projectName} (${normalizedScope.projectId})`,
    `Instruction sequence ID: ${sequenceId}`,
    `AI account(s): ${providerAccounts.length ? providerAccounts.map((item) => `${item.providerId}${item.providerProfileId ? ` / ${item.providerProfileId}` : ""}`).join(", ") : "not recorded"}`,
    `Execution status: ${instruction?.status || "unknown"}`,
    "Secrets and credentials: redacted",
    ""
  ].join("\n");
  const eventSections = chronologicalEvents.length
    ? chronologicalEvents.map((event, index) => [
        `--- Event ${index + 1} of ${chronologicalEvents.length} ---`,
        jsonSection(event)
      ].join("\n")).join("\n\n")
    : "No separately retained runtime events were available; the persisted instruction record below remains authoritative.";
  const assembled = [
    header,
    "=== Instruction and execution record ===",
    jsonSection({ ...instruction, instructionSequenceId: sequenceId }),
    "",
    "=== Detailed chronological runtime events ===",
    eventSections,
    ""
  ].join("\n");
  const bounded = boundedContent(assembled);
  const primaryProvider = providerAccounts[0] || { providerId: "", providerProfileId: "" };
  return {
    id: exportId,
    ...normalizedScope,
    enterpriseName,
    projectName,
    instructionSequenceId: sequenceId,
    providerId: primaryProvider.providerId,
    providerProfileId: primaryProvider.providerProfileId,
    providerAccounts,
    filename,
    content: bounded.content,
    contentSha256: crypto.createHash("sha256").update(bounded.content).digest("hex"),
    contentBytes: Buffer.byteLength(bounded.content, "utf8"),
    sourceEventCount: chronologicalEvents.length,
    truncated: bounded.truncated,
    originalBytes: bounded.originalBytes,
    createdByPrincipalId: String(actor.principalId || actor.id || "").slice(0, 240),
    createdAt
  };
}

function publicExport(record = {}) {
  const { content: _content, tenantId: _tenantId, createdByPrincipalId: _principalId, ...metadata } = record;
  return metadata;
}

function scoped(record, scope) {
  return record.tenantId === scope.tenantId && record.workspaceId === scope.workspaceId && record.projectId === scope.projectId;
}

export class FileInstructionLogExportRepository {
  constructor({ filePath } = {}) {
    if (!filePath) throw new Error("Instruction log export repository requires a file path.");
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async readRows() {
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      return Array.isArray(data.exports) ? data.exports : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw new InstructionLogExportError("Instruction log exports are unavailable.", { code: "instruction_log_export_store_unavailable", status: 503 });
    }
  }

  async create(record, scope) {
    const normalizedScope = requiredScope(scope);
    const operation = this.writeQueue.catch(() => {}).then(async () => {
      const rows = await this.readRows();
      rows.push({ ...record, ...normalizedScope });
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporaryPath, `${JSON.stringify({ version: 1, exports: rows }, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporaryPath, this.filePath);
      return publicExport(record);
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async get(id, scope) {
    const normalizedScope = requiredScope(scope);
    const record = (await this.readRows()).find((item) => item.id === id && scoped(item, normalizedScope));
    if (!record) throw new InstructionLogExportError("Instruction log export not found.", { code: "instruction_log_export_not_found", status: 404 });
    return record;
  }
}

export class PostgresInstructionLogExportRepository {
  constructor({ databaseUrl, pool = null } = {}) {
    this.databaseUrl = String(databaseUrl || "").trim();
    this.pool = pool;
  }

  database() {
    if (!this.pool) {
      if (!this.databaseUrl) throw new InstructionLogExportError("Instruction log export PostgreSQL is not configured.", { code: "instruction_log_export_database_unavailable", status: 503 });
      this.pool = new pg.Pool({ connectionString: this.databaseUrl, max: 4, idleTimeoutMillis: 10_000 });
    }
    return this.pool;
  }

  databaseError(error) {
    if (error instanceof InstructionLogExportError) return error;
    return new InstructionLogExportError(
      error?.code === "42P01" ? "Instruction log export database migration 016 is required." : "Instruction log exports are unavailable.",
      { code: error?.code === "42P01" ? "instruction_log_export_migration_required" : "instruction_log_export_database_unavailable", status: 503 }
    );
  }

  async query(sql, values) {
    try {
      return await this.database().query(sql, values);
    } catch (error) {
      throw this.databaseError(error);
    }
  }

  async create(record, scope) {
    const normalizedScope = requiredScope(scope);
    const metadata = publicExport({ ...record, ...normalizedScope });
    await this.query(`INSERT INTO gotham_instruction_log_exports
      (export_id,tenant_id,workspace_id,project_id,instruction_sequence_id,enterprise_name,project_name,provider_id,provider_profile_id,provider_accounts,filename,content_text,content_sha256,content_bytes,source_event_count,truncated,created_by_principal_id,metadata,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19)`, [
      record.id, normalizedScope.tenantId, normalizedScope.workspaceId, normalizedScope.projectId,
      record.instructionSequenceId, record.enterpriseName, record.projectName, record.providerId || null,
      record.providerProfileId || null, JSON.stringify(record.providerAccounts || []), record.filename,
      record.content, record.contentSha256, record.contentBytes, record.sourceEventCount, record.truncated,
      record.createdByPrincipalId || null, JSON.stringify(metadata), record.createdAt
    ]);
    return metadata;
  }

  async get(id, scope) {
    const normalizedScope = requiredScope(scope);
    const result = await this.query(`SELECT metadata,content_text FROM gotham_instruction_log_exports
      WHERE export_id=$1 AND tenant_id=$2 AND workspace_id=$3 AND project_id=$4`, [
      id, normalizedScope.tenantId, normalizedScope.workspaceId, normalizedScope.projectId
    ]);
    const row = result.rows[0];
    if (!row) throw new InstructionLogExportError("Instruction log export not found.", { code: "instruction_log_export_not_found", status: 404 });
    return { ...(row.metadata || {}), content: row.content_text };
  }
}

export function createInstructionLogExportRepository({ root, env = process.env } = {}) {
  const mode = String(env.GOTHAM_STUDIO_REPOSITORY || (env.NODE_ENV === "production" ? "postgres" : "file")).trim().toLowerCase();
  if (mode === "postgres") {
    return new PostgresInstructionLogExportRepository({
      databaseUrl: env.GOTHAM_STUDIO_DATABASE_URL || env.DECISION_CONTINUITY_DATABASE_URL || env.DATABASE_URL
    });
  }
  if (mode !== "file") throw new Error(`Unsupported instruction log export repository mode: ${mode}`);
  return new FileInstructionLogExportRepository({
    filePath: env.GOTHAM_INSTRUCTION_LOG_EXPORT_PATH || path.join(root, "runtime", "gotham-instruction-log-exports.json")
  });
}
