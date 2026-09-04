import crypto from "node:crypto";
import fs from "node:fs";

const SECRET_KEY = /(?:authorization|cookie|password|secret|token|api[_-]?key|database[_-]?url|connection[_-]?string|private[_-]?key)/i;
const SECRET_VALUE = /(?:bearer\s+[a-z0-9._~-]+|(?:sk|pk|apify_api)_[a-z0-9_-]+|postgres(?:ql)?:\/\/[^\s]+|AIza[\w-]{20,})/gi;

export function redactOperational(value, { protectedFields = [] } = {}) {
  const protectedNames = protectedFields.map((field) => String(field).trim()).filter(Boolean);
  const protectedKey = protectedNames.length
    ? new RegExp(protectedNames.map((field) => field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i")
    : null;
  if (typeof value === "string") return value.replace(SECRET_VALUE, "<redacted>").slice(0, 2000);
  if (Array.isArray(value)) return value.map((item) => redactOperational(item, { protectedFields }));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, (SECRET_KEY.test(key) || protectedKey?.test(key)) ? "<redacted>" : redactOperational(item, { protectedFields })]));
}

export function operationalTelemetry({ event, tenantId = null, correlationId = null, attributes = {}, protectedFields = [] } = {}) {
  const tenant = tenantId ? crypto.createHash("sha256").update(String(tenantId)).digest("hex").slice(0, 16) : null;
  const correlation = correlationId ? crypto.createHash("sha256").update(String(correlationId)).digest("hex").slice(0, 32) : null;
  return {
    schemaVersion: "plutomix-operational-telemetry/v1",
    event: String(event || "unknown").slice(0, 160),
    tenantId: tenant,
    correlationId: correlation,
    traceId: correlation,
    spanId: crypto.randomBytes(8).toString("hex"),
    at: new Date().toISOString(),
    resource: { "service.name": "plutomix-backend", "service.version": String(process.env.npm_package_version || "unknown").slice(0, 80) },
    attributes: redactOperational(attributes, { protectedFields })
  };
}

export function assertProductionOperationalConfiguration(env = process.env) {
  if (String(env.NODE_ENV).toLowerCase() !== "production") return;
  const required = ["DECISION_CONTINUITY_DATABASE_URL", "PLUTOMIX_SECRETS_PROVIDER", "PLUTOMIX_ENCRYPTION_KEY_REF", "PLUTOMIX_EGRESS_ALLOWLIST"];
  const missing = required.filter((key) => !String(env[key] || "").trim());
  if (missing.length) throw new Error(`Production requires secure operational configuration: ${missing.join(", ")}.`);
  if (["env", "plaintext", "local", "none"].includes(String(env.PLUTOMIX_SECRETS_PROVIDER).trim().toLowerCase())) throw new Error("Production requires a managed secrets provider reference, not plaintext environment secrets.");
  if (String(env.PLUTOMIX_EGRESS_ALLOWLIST).split(",").map((entry) => entry.trim()).some((entry) => !entry || entry === "*")) throw new Error("Production requires an explicit non-wildcard egress allowlist.");
  if (String(env.DECISION_CONTINUITY_ADAPTER || "postgres").toLowerCase() !== "postgres") throw new Error("Production refuses non-PostgreSQL authoritative storage.");
  if (String(env.DECISION_CONTINUITY_DURABLE_WORKFLOWS || "true").toLowerCase() !== "true") throw new Error("Production requires durable workflows.");
  if (String(env.PLUTOMIX_DEV_AUTH_ENABLED || "false").toLowerCase() === "true") throw new Error("Production refuses development authentication.");
  let databaseUrl;
  try {
    databaseUrl = new URL(String(env.DECISION_CONTINUITY_DATABASE_URL || ""));
  } catch {
    throw new Error("Production DECISION_CONTINUITY_DATABASE_URL is invalid.");
  }
  const sslRootCertificate = databaseUrl.searchParams.get("sslrootcert");
  if (sslRootCertificate) {
    let certificateStat;
    try {
      certificateStat = fs.statSync(sslRootCertificate);
    } catch {
      throw new Error(`Production PostgreSQL CA certificate was not found at ${sslRootCertificate}.`);
    }
    if (!certificateStat.isFile()) {
      throw new Error(`Production PostgreSQL CA certificate must be a regular file: ${sslRootCertificate}.`);
    }
  }
}
