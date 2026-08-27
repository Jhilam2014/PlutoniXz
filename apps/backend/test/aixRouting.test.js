import assert from "node:assert/strict";
import test from "node:test";
import { GovernedAIXRouter } from "../src/aixRouting.js";

const tenantId = "aix-tenant";
const workspaceId = "application-a";
const actor = { type: "user", id: "aix-operator" };

function registration({ id, provider = "openai", modelId = "gpt-test", score = 0.8, health = "healthy", licence = "allowed", roles = ["generation"], sensitivity = ["internal"], region = ["in"], egress = ["isolated"] } = {}) {
  return {
    id: id || `${provider}-${modelId}`,
    registrationKey: `${provider}-${modelId}`,
    registrationVersion: "1",
    provider,
    modelId,
    immutableRevision: "a".repeat(40),
    artifact: { checksum: "b".repeat(64) },
    enabled: true,
    health: { status: health },
    taskRoles: roles,
    governance: { tenantAllowlist: [tenantId], allowedDataSensitivity: sensitivity, approvedRegions: region, approvedEgress: egress },
    licence: { commercialUse: licence },
    performance: { p95LatencyMs: 100 },
    pricing: { inputUsdPer1k: 0.01, outputUsdPer1k: 0.02 },
    evaluationEvidence: { outcomeScore: score }
  };
}

function fixture({ enabled = true, registrations = [registration()], context = null, policy = null, reserve = null } = {}) {
  const receipts = [];
  const registry = {
    isEnabledForTenant: () => enabled,
    async getPolicy() { return policy || { allowCommercialUse: true, maxCostUsdPerRoute: 1, maxLatencyMs: 1000, allowedSensitivity: ["internal"], approvedRegions: ["in"], allowedEgress: ["isolated"] }; },
    async listRegistrations() { return registrations; }
  };
  const governance = {
    async resolveAIXContext() {
      return context === false ? { allowed: false, denialReasons: ["evidence_stale"] } : context || {
        allowed: true,
        context: {
          policySnapshotId: "policy-a",
          budgetId: "budget-a",
          data: {
            classification: "internal",
            region: "in",
            egress: "isolated",
            retentionDays: 1,
            transformations: ["summary"],
            complianceControlIds: [],
            commercialUse: true
          }
        }
      };
    },
    async evaluateModelRoute() { return { allowed: true, receipt: { id: "policy-receipt-a", status: "allowed" } }; },
    async reserveBudget() { return reserve || { status: "reserved", reservationId: "reserve-a" }; },
    async recordModelRouteReceipt(receipt) { receipts.push(receipt); return receipt; }
  };
  return { registry, governance, receipts };
}

function request(overrides = {}) {
  return {
    tenantId,
    workspaceId,
    actor,
    applicationId: "application-a",
    input: "Make a narrow governed application change with existing behavior preserved.",
    taskRole: "generation",
    idempotencyKey: "aix-test-key",
    data: {
      classification: "internal",
      region: "in",
      egress: "isolated",
      retentionDays: 1,
      transformations: ["summary"],
      complianceControlIds: [],
      commercialUse: true
    },
    ...overrides
  };
}

function router(registry, governance) {
  return new GovernedAIXRouter({
    registry,
    governance,
    config: {
      enabled: true,
      permittedTaskRoles: new Set(["generation"]),
      maxRouteCostUsd: 1,
      maxLatencyMs: 60_000,
      receiptRetention: "test"
    }
  });
}

test("preserves the current executor when BrainX is disabled", async () => {
  const { registry, governance } = fixture({ enabled: false });
  const result = await router(registry, governance).route(request());
  assert.equal(result.status, "baseline");
  assert.equal(result.route, null);
});

test("fails closed when the governed application context is unavailable", async () => {
  const { registry, governance, receipts } = fixture({ context: false });
  const result = await router(registry, governance).route(request());
  assert.equal(result.status, "no_eligible_model");
  assert.ok(result.route.denialReasons.includes("evidence_stale"));
  assert.equal(receipts.length, 1);
});

test("routes only a registered current-executor model and reserves budget before execution", async () => {
  const hf = registration({ id: "hf", provider: "huggingface", modelId: "org/model", score: 0.99 });
  const openai = registration({ id: "openai", provider: "openai", modelId: "gpt-governed", score: 0.7 });
  const { registry, governance, receipts } = fixture({ registrations: [hf, openai] });
  const result = await router(registry, governance).route(request());
  assert.equal(result.status, "routed");
  assert.equal(result.route.selectedRegistrationId, "openai");
  assert.equal(result.route.executionModel, "gpt-governed");
  assert.equal(result.route.budgetReservationId, "reserve-a");
  assert.equal(result.route.actualCostUsd, null);
  assert.equal(result.route.actualCostStatus, "usage_evidence_required");
  assert.ok(receipts[0].excludedCandidates.some((candidate) => candidate.registrationId === "hf" && candidate.reasonCodes.includes("huggingface_live_inference_not_enabled")));
});

test("does not silently bypass a governed tenant with no eligible model", async () => {
  const denied = registration({ id: "denied", provider: "openai", licence: "denied" });
  const { registry, governance, receipts } = fixture({ registrations: [denied] });
  const result = await router(registry, governance).route(request());
  assert.equal(result.status, "no_eligible_model");
  assert.equal(result.failureCode, "no_eligible_model");
  assert.ok(receipts[0].excludedCandidates.some((candidate) => candidate.reasonCodes.includes("license_denied")));
});

test("records budget exhaustion as a no-eligible-model decision before provider invocation", async () => {
  const { registry, governance, receipts } = fixture({ reserve: { status: "exhausted" } });
  const result = await router(registry, governance).route(request());
  assert.equal(result.status, "no_eligible_model");
  assert.ok(result.route.denialReasons.includes("budget_exhausted"));
  assert.equal(receipts.length, 1);
});
