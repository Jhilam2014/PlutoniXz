import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertProductionOperationalConfiguration, operationalTelemetry, redactOperational } from "../src/operationalSecurity.js";

test("structured operational redaction removes credentials, database URLs, sensitive evidence, and protected fields", () => {
  const input = { authorization: "Bearer secret-token", databaseUrl: "postgresql://user:password@db/private", providerKey: "apify_api_secret", evidence: { patientNote: "private", apiKey: "sk-abcdef" }, custom: "hide-this" };
  const redacted = redactOperational(input, { protectedFields: ["patientNote", "custom"] });
  assert.deepEqual(redacted, { authorization: "<redacted>", databaseUrl: "<redacted>", providerKey: "<redacted>", evidence: { patientNote: "<redacted>", apiKey: "<redacted>" }, custom: "<redacted>" });
  assert.deepEqual(redactOperational({ decision: "retain", nested: { state: "active" } }), { decision: "retain", nested: { state: "active" } });
  const event = operationalTelemetry({ event: "provider.failure", tenantId: "tenant-a", correlationId: "request-a", attributes: input, protectedFields: ["patientNote"] });
  assert.doesNotMatch(JSON.stringify(event), /secret-token|postgresql:\/\/|apify_api_secret|sk-abcdef|private/i);
  assert.equal(event.tenantId.length, 16);
  assert.match(event.traceId, /^[a-f0-9]{32}$/);
  assert.match(event.spanId, /^[a-f0-9]{16}$/);
  assert.equal(event.resource["service.name"], "plutomix-backend");
});

test("production operational configuration refuses insecure authority, missing encryption/secrets, and unrestricted egress", () => {
  assert.throws(() => assertProductionOperationalConfiguration({ NODE_ENV: "production", DECISION_CONTINUITY_ADAPTER: "file" }), /secure operational configuration/i);
  assert.throws(() => assertProductionOperationalConfiguration({ NODE_ENV: "production", DECISION_CONTINUITY_DATABASE_URL: "postgres://db", PLUTOMIX_SECRETS_PROVIDER: "provider", PLUTOMIX_ENCRYPTION_KEY_REF: "key", PLUTOMIX_EGRESS_ALLOWLIST: "https://allowed", DECISION_CONTINUITY_ADAPTER: "file", DECISION_CONTINUITY_DURABLE_WORKFLOWS: "true", PLUTOMIX_DEV_AUTH_ENABLED: "false" }), /non-PostgreSQL/i);
  assert.throws(() => assertProductionOperationalConfiguration({ NODE_ENV: "production", DECISION_CONTINUITY_DATABASE_URL: "postgres://db", PLUTOMIX_SECRETS_PROVIDER: "env", PLUTOMIX_ENCRYPTION_KEY_REF: "key", PLUTOMIX_EGRESS_ALLOWLIST: "https://allowed", DECISION_CONTINUITY_ADAPTER: "postgres", DECISION_CONTINUITY_DURABLE_WORKFLOWS: "true", PLUTOMIX_DEV_AUTH_ENABLED: "false" }), /managed secrets provider/i);
  assert.throws(() => assertProductionOperationalConfiguration({ NODE_ENV: "production", DECISION_CONTINUITY_DATABASE_URL: "postgres://db", PLUTOMIX_SECRETS_PROVIDER: "provider", PLUTOMIX_ENCRYPTION_KEY_REF: "key", PLUTOMIX_EGRESS_ALLOWLIST: "*", DECISION_CONTINUITY_ADAPTER: "postgres", DECISION_CONTINUITY_DURABLE_WORKFLOWS: "true", PLUTOMIX_DEV_AUTH_ENABLED: "false" }), /non-wildcard egress/i);
  assert.doesNotThrow(() => assertProductionOperationalConfiguration({ NODE_ENV: "production", DECISION_CONTINUITY_DATABASE_URL: "postgres://db", PLUTOMIX_SECRETS_PROVIDER: "provider", PLUTOMIX_ENCRYPTION_KEY_REF: "key-ref", PLUTOMIX_EGRESS_ALLOWLIST: "https://allowed", DECISION_CONTINUITY_ADAPTER: "postgres", DECISION_CONTINUITY_DURABLE_WORKFLOWS: "true", PLUTOMIX_DEV_AUTH_ENABLED: "false" }));
});

test("production operational configuration requires sslrootcert to be a regular file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plutomix-postgres-ca-"));
  const certificatePath = path.join(root, "vultr-postgres-ca.crt");
  const environment = {
    NODE_ENV: "production",
    DECISION_CONTINUITY_DATABASE_URL: `postgres://db/defaultdb?sslmode=verify-full&sslrootcert=${encodeURIComponent(root)}`,
    PLUTOMIX_SECRETS_PROVIDER: "provider",
    PLUTOMIX_ENCRYPTION_KEY_REF: "key-ref",
    PLUTOMIX_EGRESS_ALLOWLIST: "https://allowed",
    DECISION_CONTINUITY_ADAPTER: "postgres",
    DECISION_CONTINUITY_DURABLE_WORKFLOWS: "true",
    PLUTOMIX_DEV_AUTH_ENABLED: "false"
  };
  try {
    assert.throws(() => assertProductionOperationalConfiguration(environment), /must be a regular file/i);
    environment.DECISION_CONTINUITY_DATABASE_URL = `postgres://db/defaultdb?sslmode=verify-full&sslrootcert=${encodeURIComponent(certificatePath)}`;
    assert.throws(() => assertProductionOperationalConfiguration(environment), /was not found/i);
    fs.writeFileSync(certificatePath, "test-ca-certificate\n");
    assert.doesNotThrow(() => assertProductionOperationalConfiguration(environment));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fake scanner fixture is redacted from structured log, error, trace, and report-shaped records", () => {
  const fakeToken = ["plutomix", "fake", "secret", "0123456789abcdef01234567"].join("_");
  const records = [
    redactOperational({ authorization: `Bearer ${fakeToken}` }),
    redactOperational({ error: { providerToken: fakeToken } }),
    operationalTelemetry({ event: "provider.failure", attributes: { providerToken: fakeToken } }),
    { finding: redactOperational({ detectedSecret: fakeToken }) }
  ];

  for (const record of records) {
    const serialized = JSON.stringify(record);
    assert.doesNotMatch(serialized, new RegExp(fakeToken));
    assert.match(serialized, /<redacted>/);
  }
});
