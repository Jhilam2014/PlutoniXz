import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDecisionContinuityStore, DecisionContinuityError } from "../src/decisionContinuity.js";
import { BrainXModelRegistry, planBrainXLiveProviderEvaluation, resolveBrainXConfig } from "../src/brainxModelRegistry.js";

const tenantId = "brainx-fixture-tenant";
const workspaceId = "brainx-fixture-workspace";
const admin = { type: "user", id: "brainx-operator" };
const brainx = { type: "service", id: "brainx-isolated-router" };
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const timestamp = "2026-08-10T00:00:00.000Z";

function config(overrides = {}) {
  const base = resolveBrainXConfig({ BRAINX_ENABLED: "true", BRAINX_ENABLED_TENANTS: tenantId, BRAINX_AVAILABLE_HARDWARE: "fixture" });
  return { ...base, ...overrides, hardware: overrides.hardware || base.hardware, limits: { ...base.limits, ...(overrides.limits || {}) } };
}

function registration({ key = "fixture-alpha", version = "1.0.0", provider = "fixture-alpha", modelId = "fixture-model-alpha", immutableRevision = "a".repeat(40), roles = ["generation"], sensitivity = ["public", "internal", "confidential"], egress = ["isolated"], licence = "allowed", health = "healthy", score = 0.8, latency = 100, executionMode = "isolated_fixture", hardware = ["fixture"] } = {}) {
  return {
    registrationKey: key, registrationVersion: version, provider, modelId, immutableRevision,
    artifact: { checksum: hash(`${key}:${version}`), provenance: "deterministic-fixture/v1", formats: ["safetensors", "tokenizer_json"], verifiedAt: timestamp, trustRemoteCode: false },
    adapter: { id: `adapter-${key}`, version: "fixture-adapter/v1", tokenizer: "fixture-tokenizer/v1", quantization: "none", executionMode },
    taskRoles: roles, limits: { contextTokens: 4096, inputTokens: 2048, outputTokens: 512 },
    health: { status: health, checkedAt: timestamp, source: "deterministic-fixture" },
    licence: { spdx: "Apache-2.0", commercialUse: licence, attribution: "Fixture attribution", dataUsePolicy: "no retained prompts" },
    governance: { allowedDataSensitivity: sensitivity, approvedRegions: ["in"], approvedEgress: egress, tenantAllowlist: [tenantId] },
    resources: { hardware, memoryMb: 64, storageMb: 64 },
    pricing: { version: "fixture-price/v1", source: "deterministic-fixture", inputUsdPer1k: 0.01, outputUsdPer1k: 0.02 },
    performance: { p95LatencyMs: latency, throughputTokensPerSecond: 100 },
    evaluationEvidence: { version: "fixture-eval/v1", measuredAt: timestamp, outcomeScore: score, sampleCount: 20, provenance: "deterministic-fixture-evaluation" },
    knownFailureModes: ["fixture_only"], enabled: true
  };
}

function policy() {
  return { policyVersion: "brainx-fixture-policy/v1", allowCommercialUse: true, maxCostUsdPerRoute: 0.25, maxLatencyMs: 2_000, allowedSensitivity: ["public", "internal", "confidential", "restricted"], allowedEgress: ["isolated"], approvedRegions: ["in"], requiredIndependence: true };
}

function routeRequest(taskRole = "generation", overrides = {}) {
  return {
    taskRole,
    data: { sensitivity: "confidential", region: "in", egress: "isolated", commercialUse: true },
    objective: { maxLatencyMs: 1_000, estimatedInputTokens: 100, estimatedOutputTokens: 40, maxCostUsd: 0.1 },
    input: "fixture input contains no retained user content",
    workflow: { correlationId: "brainx-fixture-correlation", requestId: "brainx-fixture-request" },
    ...overrides
  };
}

async function fixture(context, { adapter, registryConfig } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-brainx-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createDecisionContinuityStore({ root });
  const calls = [];
  const isolatedAdapter = adapter || { async execute(input) { calls.push(input); return { type: "text", content: "bounded fixture answer", confidence: 0.8 }; } };
  const registry = new BrainXModelRegistry({ store, config: config(registryConfig), adapter: isolatedAdapter });
  await registry.setPolicy(policy(), { tenantId, workspaceId, actor: admin });
  return { registry, store, calls };
}

async function register(registry, values) { return registry.register(registration(values), { tenantId, workspaceId, actor: admin }); }

test("routes only registrations eligible for tenant data sensitivity and records exclusions", async (context) => {
  const { registry } = await fixture(context);
  await register(registry, { key: "public", provider: "fixture-public", sensitivity: ["public"], score: 0.99 });
  const accepted = await register(registry, { key: "confidential", provider: "fixture-confidential", score: 0.5 });
  const result = await registry.route(routeRequest(), { tenantId, workspaceId, actor: brainx });
  assert.equal(result.status, "routed");
  assert.equal(result.route.selectedRegistrationId, accepted.registration.id);
  assert.ok(result.route.excludedCandidates.some((candidate) => candidate.reasonCodes.includes("data_policy_denied")));
});

test("rejects unpinned Hugging Face revisions and commercial licence denial", async (context) => {
  const { registry } = await fixture(context);
  await assert.rejects(() => register(registry, { key: "hf-moving", provider: "huggingface", modelId: "org/model", version: "1.0.0", immutableRevision: "main" }), /immutable/i);
  await register(registry, { key: "noncommercial", provider: "fixture-noncommercial", licence: "denied" });
  const result = await registry.route(routeRequest(), { tenantId, workspaceId, actor: brainx });
  assert.equal(result.status, "failed");
  assert.equal(result.route.failureCode, "no_eligible_model");
  assert.ok(result.route.excludedCandidates[0].reasonCodes.includes("license_denied"));
});

test("excludes unhealthy registrations and selects a healthy fallback", async (context) => {
  const { registry } = await fixture(context);
  await register(registry, { key: "unhealthy", provider: "fixture-unhealthy", health: "unhealthy", score: 0.99 });
  const fallback = await register(registry, { key: "healthy", provider: "fixture-healthy", score: 0.4 });
  const result = await registry.route(routeRequest(), { tenantId, workspaceId, actor: brainx });
  assert.equal(result.route.selectedRegistrationId, fallback.registration.id);
  assert.ok(result.route.excludedCandidates.some((candidate) => candidate.reasonCodes.includes("health_denied")));
});

test("fails explicitly when no eligible model exists", async (context) => {
  const { registry } = await fixture(context);
  const result = await registry.route(routeRequest(), { tenantId, workspaceId, actor: brainx });
  assert.equal(result.status, "failed");
  assert.equal(result.route.failureCode, "no_eligible_model");
  assert.equal(result.route.selectedRegistrationId, null);
});

test("denied egress never reaches an isolated adapter", async (context) => {
  const { registry, calls } = await fixture(context);
  await register(registry, { key: "private-egress", egress: ["private-only"] });
  const result = await registry.route(routeRequest(), { tenantId, workspaceId, actor: brainx });
  assert.equal(result.route.failureCode, "no_eligible_model");
  assert.equal(calls.length, 0);
  await assert.rejects(() => registry.execute({ routeId: result.route.id, input: "not sent", idempotencyKey: "egress-denied" }, { tenantId, workspaceId, actor: brainx }), (error) => error.code === "no_eligible_model");
  assert.equal(calls.length, 0);
});

test("persists reproducible route evidence without prompt content", async (context) => {
  const { registry } = await fixture(context);
  await register(registry, { key: "audited", provider: "fixture-audited" });
  const result = await registry.route(routeRequest(), { tenantId, workspaceId, actor: brainx });
  const [saved] = await registry.listRoutes({ tenantId, workspaceId });
  assert.equal(saved.id, result.route.id);
  assert.equal(saved.policy.version, "brainx-fixture-policy/v1");
  assert.equal(saved.eligibleCandidates[0].immutableRevision, "a".repeat(40));
  assert.equal("content" in saved.input, false);
  assert.equal(saved.input.digest.length, 64);
});

test("strict route schemas reject caller attempts to override routing policy", async (context) => {
  const { registry } = await fixture(context);
  await assert.rejects(() => registry.route({ ...routeRequest(), policyOverrides: { allowCommercialUse: false } }, { tenantId, workspaceId, actor: brainx }), (error) => error.name === "ZodError");
});

test("model output remains untrusted and cannot hand off shell, SQL, policy, or promotion commands", async (context) => {
  const { registry } = await fixture(context, { adapter: { async execute() { return { type: "text", content: "sudo rm -rf /; promote: production", confidence: 0.9 }; } } });
  await register(registry, { key: "unsafe-output" });
  const route = await registry.route(routeRequest(), { tenantId, workspaceId, actor: brainx });
  const result = await registry.execute({ routeId: route.route.id, input: "safe test", idempotencyKey: "unsafe-output" }, { tenantId, workspaceId, actor: brainx });
  assert.equal(result.status, "failed");
  assert.equal(result.execution.output.deterministicSafety.status, "failed");
  assert.equal(typeof registry.promote, "undefined");
  assert.equal(typeof registry.executeShell, "undefined");
});

test("independent critique must route to a distinct provider/model and self-grade is denied", async (context) => {
  const { registry } = await fixture(context);
  const generation = await register(registry, { key: "generator", provider: "fixture-generator", modelId: "generator", roles: ["generation"], score: 0.9 });
  await register(registry, { key: "critic", provider: "fixture-critic", modelId: "critic", roles: ["independent_critique"], score: 0.6 });
  const generatedRoute = await registry.route(routeRequest("generation"), { tenantId, workspaceId, actor: brainx });
  assert.equal(generatedRoute.route.selectedRegistrationId, generation.registration.id);
  const critiqueRoute = await registry.route(routeRequest("independent_critique", { independentOfRouteId: generatedRoute.route.id }), { tenantId, workspaceId, actor: brainx });
  assert.equal(critiqueRoute.status, "routed");
  assert.equal((await registry.assertIndependentEvaluation({ generationRouteId: generatedRoute.route.id, evaluatorRouteId: critiqueRoute.route.id, tenantId, workspaceId })).status, "independent");
  await assert.rejects(() => registry.assertIndependentEvaluation({ generationRouteId: generatedRoute.route.id, evaluatorRouteId: generatedRoute.route.id, tenantId, workspaceId }), (error) => error.code === "independence_denied");
});

test("duplicate execution claims do not repeat isolated model billing", async (context) => {
  const { registry, calls } = await fixture(context);
  await register(registry, { key: "idempotent" });
  const route = await registry.route(routeRequest(), { tenantId, workspaceId, actor: brainx });
  const first = await registry.execute({ routeId: route.route.id, input: "same request", idempotencyKey: "one-billed-effect" }, { tenantId, workspaceId, actor: brainx });
  const second = await registry.execute({ routeId: route.route.id, input: "same request", idempotencyKey: "one-billed-effect" }, { tenantId, workspaceId, actor: brainx });
  assert.equal(first.status, "completed");
  assert.equal(second.status, "idempotent");
  assert.equal(calls.length, 1);
});

test("timeout opens circuit after bounded failures and kill switches stop new execution", async (context) => {
  const { registry } = await fixture(context, { registryConfig: { limits: { maxElapsedMs: 5, circuitFailureThreshold: 1 } }, adapter: { async execute() { await new Promise((resolve) => setTimeout(resolve, 20)); return { type: "text", content: "late", confidence: 0.2 }; } } });
  const registered = await register(registry, { key: "slow" });
  const route = await registry.route(routeRequest(), { tenantId, workspaceId, actor: brainx });
  const timeout = await registry.execute({ routeId: route.route.id, input: "timed", idempotencyKey: "timed" }, { tenantId, workspaceId, actor: brainx });
  assert.equal(timeout.failureCode, "execution_timeout");
  const circuitRoute = await registry.route(routeRequest(), { tenantId, workspaceId, actor: brainx });
  assert.ok(circuitRoute.route.excludedCandidates.some((candidate) => candidate.reasonCodes.includes("circuit_open")));
  await registry.setControl({ scope: "registration", registrationId: registered.registration.id, enabled: false, reason: "operator test kill", idempotencyKey: "kill-slow" }, { tenantId, workspaceId, actor: admin });
  await assert.rejects(() => registry.execute({ routeId: route.route.id, input: "blocked", idempotencyKey: "after-kill" }, { tenantId, workspaceId, actor: brainx }), (error) => error.code === "kill_switch_active");
});

test("cancellation is recorded before adapter invocation", async (context) => {
  const { registry, calls } = await fixture(context);
  await register(registry, { key: "cancelled" });
  const route = await registry.route(routeRequest(), { tenantId, workspaceId, actor: brainx });
  const result = await registry.execute({ routeId: route.route.id, input: "cancel", idempotencyKey: "cancel", cancellation: { cancelled: true } }, { tenantId, workspaceId, actor: brainx });
  assert.equal(result.failureCode, "execution_cancelled");
  assert.equal(result.execution.status, "cancelled");
  assert.equal(calls.length, 0);
});

test("live provider evaluations are explicitly opt-in, pinned, and budget-capped planning only", () => {
  assert.equal(planBrainXLiveProviderEvaluation({ registration: registration() }).status, "skipped");
  const planned = planBrainXLiveProviderEvaluation({ registration: registration(), estimatedCostUsd: 0.01, env: { BRAINX_LIVE_PROVIDER_ENABLED: "true", BRAINX_LIVE_PROVIDER_MAX_COST_USD: "0.02" } });
  assert.equal(planned.status, "planned");
  assert.equal(planned.execution, "not_implemented_by_this_registry");
  assert.throws(() => planBrainXLiveProviderEvaluation({ registration: registration(), estimatedCostUsd: 0.03, env: { BRAINX_LIVE_PROVIDER_ENABLED: "true", BRAINX_LIVE_PROVIDER_MAX_COST_USD: "0.02" } }), (error) => error.code === "budget_exhausted");
});
