import assert from "node:assert/strict";
import test from "node:test";
import {
  AgenticXKnowledgeGateway,
  redactAgenticXKnowledgeText,
  sanitizeAgenticXKnowledgeRecord
} from "../src/agenticXKnowledge.js";

const FIXED_NOW = "2026-08-22T00:00:00.000Z";
const clock = () => new Date(FIXED_NOW);

function knowledge(overrides = {}) {
  return {
    tenantId: "tenant-alpha",
    workspaceId: "workspace-alpha",
    sourceId: "shared-build-pattern",
    sourceApplicationId: "application-alpha",
    version: "1",
    summary: "Use the reviewed, bounded build validation sequence before deploying an application change.",
    classification: "internal",
    region: "in",
    allowedPurposes: ["application_development"],
    allowedTransformations: ["summary", "redacted_summary"],
    retention: { expiresAt: "2026-12-01T00:00:00.000Z" },
    tags: ["build", "validation"],
    ...overrides
  };
}

function retrieve(overrides = {}) {
  return {
    tenantId: "tenant-alpha",
    workspaceId: "workspace-alpha",
    purpose: "application_development",
    region: "in",
    egress: "isolated",
    maxClassification: "internal",
    transformation: "summary",
    idempotencyKey: "knowledge-reuse-one",
    ...overrides
  };
}

test("tenant isolation denies a known record from another tenant and leaves its identity out of the receipt", async () => {
  const gateway = new AgenticXKnowledgeGateway({ clock, config: { enabled: true } });
  const alpha = await gateway.register(knowledge(), { actor: { type: "user", id: "operator-alpha" } });
  const beta = await gateway.register(knowledge({
    tenantId: "tenant-beta",
    workspaceId: "workspace-beta",
    sourceId: "tenant-beta-pattern",
    sourceApplicationId: "application-beta"
  }), { actor: { type: "user", id: "operator-beta" } });

  const sameTenant = await gateway.retrieve(retrieve({ knowledgeIds: [alpha.knowledge.id] }));
  assert.equal(sameTenant.status, "allowed");
  assert.equal(sameTenant.knowledge[0].id, alpha.knowledge.id);

  const denied = await gateway.retrieve(retrieve({ knowledgeIds: [beta.knowledge.id], idempotencyKey: "cross-tenant" }));
  assert.equal(denied.status, "denied");
  assert.deepEqual(denied.denialReasons, ["cross_tenant_denied"]);
  assert.equal(denied.receipt.deniedCandidates[0].knowledgeId, null);
  assert.doesNotMatch(JSON.stringify(denied), /tenant-beta-pattern|application-beta|reviewed, bounded build validation/i);
});

test("an injected policy evaluator can deny reuse and receives only a safe knowledge reference", async () => {
  const evaluatorCalls = [];
  const gateway = new AgenticXKnowledgeGateway({
    clock,
    config: { enabled: true },
    policyEvaluator: async (input) => {
      evaluatorCalls.push(input);
      return { status: "denied", denialReasons: ["compliance_control_missing"] };
    }
  });
  const registered = await gateway.register(knowledge());
  const result = await gateway.retrieve(retrieve({ knowledgeIds: [registered.knowledge.id], idempotencyKey: "policy-denial" }));

  assert.equal(result.status, "denied");
  assert.ok(result.denialReasons.includes("compliance_control_missing"));
  assert.equal(evaluatorCalls.length, 1);
  assert.equal(evaluatorCalls[0].knowledgeReference.id, registered.knowledge.id);
  assert.equal(evaluatorCalls[0].knowledgeReference.digest, registered.knowledge.contentDigest);
  assert.equal("summary" in evaluatorCalls[0].knowledgeReference, false);
  assert.doesNotMatch(JSON.stringify(result.receipt), /reviewed, bounded build validation/i);
});

test("returns a bounded sanitized summary within its tenant/workspace and records an auditable allowed receipt", async () => {
  const gateway = new AgenticXKnowledgeGateway({
    clock,
    config: { maxSummaryChars: 44, maxRetentionDays: 365, enabled: true }
  });
  const registered = await gateway.register(knowledge());
  const result = await gateway.listEligibleKnowledge(retrieve({ knowledgeIds: [registered.knowledge.id], idempotencyKey: "safe-happy-path" }));

  assert.equal(result.status, "allowed");
  assert.equal(result.knowledge.length, 1);
  assert.ok(result.knowledge[0].summary.length <= 44);
  assert.equal(result.knowledge[0].contentDigest, registered.knowledge.contentDigest);
  assert.equal("allowedPurposes" in result.knowledge[0], false);
  assert.equal(result.receipt.status, "allowed");
  assert.deepEqual(result.receipt.allowedKnowledgeIds, [registered.knowledge.id]);
  assert.equal(result.receipt.resultCount, 1);
  assert.equal("summary" in result.receipt, false);
  const receipts = await gateway.listReceipts({ tenantId: "tenant-alpha", workspaceId: "workspace-alpha" });
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].id, result.receipt.id);
});

test("redaction helpers identify secrets and registration rejects secret, raw, and restricted material", async () => {
  const redacted = redactAgenticXKnowledgeText("Set OPENAI_API_KEY=sk-abcdefghijklmnopqrstuv and never print it.");
  assert.equal(redacted.redacted, true);
  assert.match(redacted.text, /\[REDACTED/);
  assert.doesNotMatch(redacted.text, /abcdefghijklmnopqrstuv/);

  const secretRecord = sanitizeAgenticXKnowledgeRecord(knowledge({ summary: "Bearer sk-abcdefghijklmnopqrstuv" }), { clock });
  assert.equal(secretRecord.ok, false);
  assert.ok(secretRecord.denialReasons.includes("secret_material_denied"));
  const rawRecord = sanitizeAgenticXKnowledgeRecord({ ...knowledge(), content: "untrusted raw prompt" }, { clock });
  assert.equal(rawRecord.ok, false);
  assert.ok(rawRecord.denialReasons.includes("raw_content_denied"));
  const restrictedRecord = sanitizeAgenticXKnowledgeRecord(knowledge({ classification: "restricted" }), { clock });
  assert.equal(restrictedRecord.ok, false);
  assert.ok(restrictedRecord.denialReasons.includes("restricted_content_denied"));

  const gateway = new AgenticXKnowledgeGateway({ clock, config: { enabled: true } });
  await assert.rejects(() => gateway.register(knowledge({ summary: "token=super-secret" })), (error) => error.code === "secret_material_denied");
});

test("local policy is fail-closed for classification, region, purpose, transformation, and expired retention", async () => {
  let current = "2026-08-22T00:00:00.000Z";
  const gateway = new AgenticXKnowledgeGateway({ clock: () => new Date(current), config: { enabled: true } });
  const registered = await gateway.register(knowledge({
    classification: "confidential",
    retention: { expiresAt: "2026-08-23T00:00:00.000Z" }
  }));
  const id = registered.knowledge.id;

  const classification = await gateway.retrieve(retrieve({ knowledgeIds: [id], idempotencyKey: "classification", maxClassification: "internal" }));
  assert.ok(classification.denialReasons.includes("classification_denied"));
  const region = await gateway.retrieve(retrieve({ knowledgeIds: [id], idempotencyKey: "region", region: "us" }));
  assert.ok(region.denialReasons.includes("region_denied"));
  const purpose = await gateway.retrieve(retrieve({ knowledgeIds: [id], idempotencyKey: "purpose", purpose: "incident_response", maxClassification: "confidential" }));
  assert.ok(purpose.denialReasons.includes("purpose_denied"));
  const transformation = await gateway.retrieve(retrieve({ knowledgeIds: [id], idempotencyKey: "transformation", transformation: "metadata", maxClassification: "confidential" }));
  assert.ok(transformation.denialReasons.includes("transformation_denied"));

  current = "2026-08-24T00:00:00.000Z";
  const expired = await gateway.retrieve(retrieve({ knowledgeIds: [id], idempotencyKey: "expired", maxClassification: "confidential" }));
  assert.ok(expired.denialReasons.includes("retention_denied"));
});

test("receipts use deterministic idempotency and fall back to memory when no governance receipt writer is present", async () => {
  const gateway = new AgenticXKnowledgeGateway({ clock, config: { enabled: true } });
  const registered = await gateway.register(knowledge());
  const input = retrieve({ knowledgeIds: [registered.knowledge.id], idempotencyKey: "once-only-reuse" });
  const first = await gateway.retrieve(input);
  const second = await gateway.retrieve(input);

  assert.equal(first.status, "allowed");
  assert.equal(second.status, "allowed");
  assert.equal(second.idempotent, true);
  assert.equal(second.receipt.id, first.receipt.id);
  assert.equal(first.receipt.persistence, "memory");
  assert.equal((await gateway.listReceipts({ tenantId: "tenant-alpha", workspaceId: "workspace-alpha" })).length, 1);

  const conflict = await gateway.retrieve(retrieve({
    knowledgeIds: [],
    idempotencyKey: "once-only-reuse"
  }));
  assert.equal(conflict.status, "denied");
  assert.deepEqual(conflict.denialReasons, ["idempotency_conflict"]);
});

test("uses the EnterpriseGovernance requestKnowledgeReuse seam without sending knowledge content", async () => {
  const calls = [];
  const governance = {
    async requestKnowledgeReuse(payload, context) {
      calls.push({ payload, context });
      return { status: "allowed", receipt: { id: "enterprise-reuse-receipt-1", status: "allowed" } };
    }
  };
  const gateway = new AgenticXKnowledgeGateway({ governance, clock, config: { enabled: true } });
  const registered = await gateway.register(knowledge());
  const result = await gateway.retrieve(retrieve({
    knowledgeIds: [registered.knowledge.id],
    targetApplicationId: "application-target",
    complianceControlIds: ["control-privacy"],
    idempotencyKey: "enterprise-governance-seam"
  }));

  assert.equal(result.status, "allowed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.sourceApplicationId, "application-alpha");
  assert.equal(calls[0].payload.targetApplicationId, "application-target");
  assert.equal(calls[0].payload.sanitization.contentIncluded, false);
  assert.equal("summary" in calls[0].payload.knowledgeReferences[0], false);
  assert.ok(result.receipt.policyReceiptIds.includes("enterprise-reuse-receipt-1"));
});
