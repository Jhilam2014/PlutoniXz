import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PostgresDecisionContinuityStore } from "../../src/decisionContinuityPostgres.js";
import { DecisionContinuityWorkflowQueue } from "../../src/decisionContinuityWorkflow.js";
import { IdentityAccessStore } from "../../src/identityAccess.js";
import {
  DECISION_CONTINUITY_LIFECYCLE_ROUTES,
  assertDecisionContinuityHttpSecurityCoverage,
  decisionContinuityHttpSecurityMatrix
} from "../../src/decisionContinuityLifecycleRegistry.js";

const databaseUrl = process.env.DECISION_CONTINUITY_TEST_DATABASE_URL;
const options = databaseUrl ? {} : { skip: "Set DECISION_CONTINUITY_TEST_DATABASE_URL to run the HTTP security matrix." };
const runId = `${process.pid}-${Date.now()}`;
const tenants = { a: `matrix-tenant-a-${runId}`, b: `matrix-tenant-b-${runId}` };
const trustedService = `matrix-service-${runId}`;
const approver = `matrix-approver-${runId}`;
const insufficientHuman = `matrix-insufficient-human-${runId}`;
const insufficientService = `matrix-insufficient-service-${runId}`;
const oidcIssuer = `https://issuer.test/plutonix-${runId}`;
const oidcAudience = "plutonix-decision-continuity-tests";
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: `test-key-${runId}`, use: "sig", key_ops: ["verify"] };
const workspaceFor = (tenantId) => `workspace-${tenantId}`;

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function bearerToken(subject, claims = {}) {
  const header = base64Url({ alg: "RS256", typ: "JWT", kid: publicJwk.kid });
  const payload = base64Url({ iss: oidcIssuer, sub: subject, aud: oidcAudience, exp: Math.floor(Date.now() / 1000) + 300, ...claims });
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function branchInput(tenantId, label, overrides = {}) {
  return {
    workspaceId: workspaceFor(tenantId),
    decisionId: `decision-${label}-${runId}`,
    objective: `Keep ${label} isolated by tenant and retain durable workflow evidence.`,
    candidate: { approach: `candidate-${label}` },
    evidence: [{ id: `evidence-${label}`, type: "test", source: "http-security-matrix" }],
    producedBy: { agentId: `planner-${tenantId}`, actorId: tenantId, source: "http-security-matrix" },
    constraintExpression: { constraintId: `constraint-${label}` },
    revisitTriggers: [`constraint-${label}`],
    ...overrides
  };
}

function userHeaders(tenantId, extra = {}) {
  return { authorization: `Bearer ${bearerToken(tenantId)}`, "x-plutonix-tenant-id": tenantId, ...extra };
}

function serviceHeaders(tenantId = tenants.a, extra = {}) {
  return {
    authorization: `Bearer ${bearerToken(trustedService)}`,
    "x-plutonix-tenant-id": tenantId,
    ...extra
  };
}

function headersForPrincipal(subject, tenantId, extra = {}) {
  return { authorization: `Bearer ${bearerToken(subject)}`, "x-plutonix-tenant-id": tenantId, ...extra };
}

function resourcePath(route, fixture) {
  const values = {
    jobId: fixture.workflow.job.jobId,
    branchId: fixture.branch.id,
    otherBranchId: fixture.otherBranch.id,
    reconsiderationId: fixture.reconsideration.id,
    canaryId: fixture.canary.id
  };
  return route.path.replace(/:([A-Za-z0-9_]+)/g, (_match, key) => encodeURIComponent(values[key] || `missing-${key}`));
}

function requestBody(entry, fixture, tenantId, suffix, { includeTenant = true } = {}) {
  const serviceScope = (body) => entry.tenant === "service_claim" && includeTenant ? { ...body, tenantId } : body;
  if (entry.key === "branch_create") {
    return branchInput(tenantId, `http-${suffix}`, { workspaceId: workspaceFor(tenantId) });
  }
  if (entry.key === "disposition") {
    return { workspaceId: fixture.workspaceId, status: "deferred", reason: "HTTP matrix submission", expectedRevision: fixture.branch.revision };
  }
  if (entry.key === "condition_event") {
    return serviceScope({
      workspaceId: workspaceFor(tenantId),
      eventId: `condition-http-${suffix}-${runId}`,
      source: "http-security-matrix",
      observations: [{ constraintId: `condition-http-${suffix}`, state: "cleared", source: "http-security-matrix", trusted: true, authorized: true }]
    });
  }
  if (entry.key === "evaluation") {
    return serviceScope({
      workspaceId: fixture.workspaceId,
      evaluatorId: `evaluator-${suffix}`,
      reviewerId: `reviewer-${suffix}`,
      validator: { status: "passed", deterministic: true },
      summary: "Queue only; the worker owns the effect boundary."
    });
  }
  if (entry.key === "policy") {
    return serviceScope({ workspaceId: fixture.workspaceId, policyVersion: "http-matrix-v1", decision: "permitted", reasons: ["matrix"] });
  }
  if (entry.key === "approval") {
    return { workspaceId: fixture.workspaceId, decision: "approved", note: "HTTP security matrix" };
  }
  if (entry.key === "canary_start") {
    return {
      workspaceId: fixture.workspaceId,
      trafficPercent: 5,
      durationMinutes: 5,
      monitoringWindowMinutes: 5,
      successCriteria: ["No material regression"],
      failureCriteria: ["Any critical regression"],
      rollbackPlan: "Stop the audit-only control-plane canary record."
    };
  }
  if (entry.key === "canary_outcome") {
    return serviceScope({ workspaceId: fixture.workspaceId, status: "passed", metrics: { errorRate: 0.01 }, summary: "Audit-only outcome." });
  }
  return undefined;
}

async function request(baseUrl, { method, path, headers = {}, body, rawBody } = {}) {
  const requestHeaders = { ...headers };
  let payload;
  if (rawBody !== undefined) payload = rawBody;
  else if (body !== undefined) {
    requestHeaders["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}/api/decision-continuity${path}`, { method: method.toUpperCase(), headers: requestHeaders, body: payload });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json, text, headers: Object.fromEntries(response.headers.entries()) };
}

async function brainxRequest(baseUrl, { method, path, headers = {}, body } = {}) {
  const requestHeaders = { ...headers };
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (body !== undefined) requestHeaders["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}/api/brainx${path}`, { method: method.toUpperCase(), headers: requestHeaders, body: payload });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json, text };
}

function brainxRegistrationInput(label) {
  return {
    registrationKey: `http-brainx-${label}`, registrationVersion: "1.0.0", provider: "fixture-http", modelId: "fixture-http-model", immutableRevision: "c".repeat(40),
    artifact: { checksum: crypto.createHash("sha256").update(`brainx-http-${label}`).digest("hex"), provenance: "http-security-fixture", formats: ["safetensors"], verifiedAt: "2026-08-10T00:00:00.000Z", trustRemoteCode: false },
    adapter: { id: "fixture-http-adapter", version: "v1", tokenizer: "fixture", quantization: "none", executionMode: "isolated_fixture" }, taskRoles: ["generation"], limits: { contextTokens: 4096, inputTokens: 2048, outputTokens: 512 }, health: { status: "healthy", checkedAt: "2026-08-10T00:00:00.000Z", source: "fixture" },
    licence: { spdx: "Apache-2.0", commercialUse: "allowed", attribution: "fixture", dataUsePolicy: "fixture only" }, governance: { allowedDataSensitivity: ["internal"], approvedRegions: ["in"], approvedEgress: ["isolated"], tenantAllowlist: [tenants.a] }, resources: { hardware: ["fixture"], memoryMb: 32, storageMb: 32 }, pricing: { version: "v1", source: "fixture", inputUsdPer1k: 0.01, outputUsdPer1k: 0.02 }, performance: { p95LatencyMs: 100, throughputTokensPerSecond: 50 }, evaluationEvidence: { version: "v1", measuredAt: "2026-08-10T00:00:00.000Z", outcomeScore: 0.8, sampleCount: 10, provenance: "fixture" }, knownFailureModes: [], enabled: true
  };
}

async function effectSnapshot(pool) {
  const result = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM decision_continuity_workflow_jobs) AS jobs,
      (SELECT count(*)::int FROM decision_continuity_workflow_inbox) AS inbox,
      (SELECT count(*)::int FROM decision_continuity_workflow_audit) AS workflow_audit,
      (SELECT count(*)::int FROM decision_continuity_outbox) AS outbox,
      (SELECT count(*)::int FROM decision_continuity_events) AS events,
      (SELECT count(*)::int FROM decision_continuity_current_state) AS current_state,
      (SELECT count(*)::int FROM decision_continuity_current_state WHERE entity_type = 'canary') AS canaries
  `);
  return result.rows[0];
}

async function createFixture(store, queue, tenantId, label) {
  const branch = await store.createBranch(branchInput(tenantId, `${label}-primary`), { tenantId, actor: { type: "user", id: tenantId } });
  const otherBranch = await store.createBranch(branchInput(tenantId, `${label}-compare`), { tenantId, actor: { type: "user", id: tenantId } });
  await store.setDisposition({ branchId: branch.id, status: "deferred", reason: "Build HTTP route fixtures." }, { tenantId, actor: { type: "user", id: tenantId } });
  const condition = await store.ingestConditionEvent({
    eventId: `fixture-condition-${label}-${runId}`,
    workspaceId: workspaceFor(tenantId),
    source: "http-security-matrix",
    observations: [{ constraintId: `constraint-${label}-primary`, state: "cleared", source: "http-security-matrix", trusted: true, authorized: true }]
  }, { tenantId, actor: { type: "service", id: trustedService } });
  const reconsideration = condition.requests[0];
  await store.recordEvaluation({
    reconsiderationId: reconsideration.id,
    evaluatorId: `fixture-evaluator-${label}`,
    reviewerId: `fixture-reviewer-${label}`,
    validator: { status: "passed", deterministic: true }
  }, { tenantId, actor: { type: "service", id: trustedService } });
  await store.recordPolicyDecision({ reconsiderationId: reconsideration.id, policyVersion: "fixture-v1", decision: "permitted" }, { tenantId, actor: { type: "service", id: trustedService } });
  await store.recordApproval({ reconsiderationId: reconsideration.id, decision: "approved", approverId: `fixture-approver-${label}` }, { tenantId, actor: { type: "user", id: tenantId } });
  const canary = await store.startCanary({
    reconsiderationId: reconsideration.id,
    trafficPercent: 5,
    durationMinutes: 5,
    monitoringWindowMinutes: 5,
    successCriteria: ["No critical regression"],
    failureCriteria: ["Critical regression"],
    rollbackPlan: "Stop the canary record."
  }, { tenantId, actor: { type: "user", id: tenantId } });
  const submitted = await queue.submit({
    tenantId,
    workspaceId: workspaceFor(tenantId),
    jobType: "condition_event",
    payload: { eventId: `fixture-workflow-${label}-${runId}`, workspaceId: workspaceFor(tenantId), source: "fixture", observations: [], __workflow: { actor: { type: "service", id: trustedService } } },
    idempotencyKey: `fixture-workflow-${label}-${runId}`
  });
  await queue.pool.query(
    "UPDATE decision_continuity_workflow_jobs SET state = 'dead', failure = $2::jsonb WHERE job_id = $1",
    [submitted.job.jobId, JSON.stringify({ code: "fixture_dead_letter", message: "HTTP redrive fixture" })]
  );
  return { workspaceId: workspaceFor(tenantId), branch, otherBranch, reconsideration, canary, workflow: submitted };
}

function expectedStatus(entry, caseName) {
  if (caseName === "unauthenticated") return 401;
  if (caseName === "insufficient_capability") return 403;
  if (caseName === "tenant_mismatch") return entry.tenant === "service_claim" && entry.jsonBody ? 400 : 404;
  if (caseName === "cross_tenant") return 404;
  return entry.execution === "read" ? 200 : 202;
}

function requestCase(entry, caseName, fixture) {
  let headers = {};
  let tenantId = tenants.a;
  let includeTenant = true;
  let path = resourcePath(entry, fixture);
  if (caseName === "authorized_success") {
    headers = entry.trust === "trusted_service"
      ? serviceHeaders(tenants.a)
      : entry.key === "approval"
        ? headersForPrincipal(approver, tenants.a)
        : userHeaders(tenants.a);
  } else if (caseName === "unauthenticated") {
    headers = {};
  } else if (caseName === "insufficient_capability") {
    headers = entry.trust === "trusted_service"
      ? headersForPrincipal(insufficientHuman, tenants.a)
      : headersForPrincipal(insufficientService, tenants.a);
  } else if (caseName === "cross_tenant") {
    headers = entry.trust === "trusted_service" ? serviceHeaders(tenants.b) : headersForPrincipal(tenants.a, tenants.b);
    tenantId = tenants.b;
  } else if (caseName === "tenant_mismatch") {
    headers = entry.trust === "trusted_service" ? serviceHeaders(tenants.b) : userHeaders(tenants.a, { "x-plutonix-tenant-id": tenants.b });
  }
  const idempotencyKey = entry.execution === "read" ? undefined : `http-${entry.key}-${caseName}-${runId}`;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return {
    method: entry.method,
    path,
    headers,
    body: entry.jsonBody ? requestBody(entry, fixture, tenantId, `${entry.key}-${caseName}`, { includeTenant }) : undefined,
    idempotencyKey
  };
}

function assertNoSensitiveFailure(response) {
  const text = JSON.stringify(response.json || response.text || "");
  assert.doesNotMatch(text, /(stack|select\s|insert\s|update\s|postgresql.*error|matrix-service-token)/i);
}

function assertTenantRead(entry, response, tenantFixture, otherFixture) {
  const expectedTenantId = tenantFixture.branch.tenantId;
  const serialized = JSON.stringify(response.json || {});
  assert.equal(serialized.includes(otherFixture.branch.id), false, `${entry.key} must not disclose another tenant branch`);
  if (entry.key === "workflow_status") assert.ok(response.json.workflows.jobs.every((job) => job.tenantId === expectedTenantId));
  if (entry.key === "workflow_job_status") assert.equal(response.json.job.tenantId, expectedTenantId);
  if (entry.key === "branch_list") assert.ok(response.json.branches.every((branch) => branch.tenantId === expectedTenantId));
  if (entry.key === "branch_get") assert.equal(response.json.branch.tenantId, expectedTenantId);
  if (entry.key === "branch_events") assert.ok(response.json.events.every((event) => event.tenantId === expectedTenantId));
  if (entry.key === "reconsideration_list") assert.ok(response.json.reconsiderations.every((item) => item.tenantId === expectedTenantId));
  if (entry.key === "qagent_run_list") {
    assert.ok(response.json.qagentRuns.every((item) => item.tenantId === expectedTenantId));
    assert.equal(response.json.qagentMetrics.tenantId, expectedTenantId);
  }
  if (entry.key === "branch_compare") {
    assert.deepEqual(response.json.comparison.comparedBranchIds, [tenantFixture.branch.id, tenantFixture.otherBranch.id]);
  }
}

async function assertQueuedSubmission(pool, entry, response, before) {
  assert.equal(response.json.status, "accepted");
  assert.ok(response.json.job?.jobId, `${entry.key} must return a durable job identity`);
  const jobResult = await pool.query("SELECT * FROM decision_continuity_workflow_jobs WHERE job_id = $1", [response.json.job.jobId]);
  assert.equal(jobResult.rowCount, 1);
  const job = jobResult.rows[0];
  assert.equal(job.tenant_id, tenants.a);
  assert.equal(job.job_type, entry.jobType);
  assert.equal(job.idempotency_key, `http-${entry.key}-authorized_success-${runId}`);
  assert.equal(job.payload.__workflow.actor.type, entry.trust === "trusted_service" ? "service" : "user");
  assert.equal(job.payload.__workflow.actor.id, entry.trust === "trusted_service" ? trustedService : entry.key === "approval" ? approver : tenants.a);
  assert.equal(job.payload.__workflow.authorization.permission, entry.permission);
  assert.equal(job.payload.__workflow.authorization.tenantId, tenants.a);
  const related = await pool.query(
    `SELECT
      (SELECT count(*)::int FROM decision_continuity_events WHERE payload->>'jobId' = $1) AS events,
      (SELECT count(*)::int FROM decision_continuity_outbox WHERE payload->'payload'->>'jobId' = $1) AS outbox,
      (SELECT count(*)::int FROM decision_continuity_workflow_audit WHERE job_id = $1 AND action = 'submitted') AS audit`,
    [response.json.job.jobId]
  );
  assert.deepEqual(related.rows[0], { events: 1, outbox: 1, audit: 1 });
  const after = await effectSnapshot(pool);
  assert.equal(after.jobs, before.jobs + 1);
  assert.equal(after.events, before.events + 1);
  assert.equal(after.outbox, before.outbox + 1);
  assert.equal(after.workflow_audit, before.workflow_audit + 1);
  assert.equal(after.inbox, before.inbox);
  assert.equal(after.current_state, before.current_state, `${entry.key} must not apply its domain effect inline`);
  assert.equal(after.canaries, before.canaries, `${entry.key} must not create or traffic-shift a canary inline`);
  return after;
}

test("the lifecycle HTTP authorization and tenant-isolation matrix covers every registered route against PostgreSQL", options, async (context) => {
  const matrix = decisionContinuityHttpSecurityMatrix();
  assert.deepEqual(assertDecisionContinuityHttpSecurityCoverage(matrix), { inventory: 19, matrixCases: 19 });
  assert.equal(matrix.length, Object.keys(DECISION_CONTINUITY_LIFECYCLE_ROUTES).length);

  const previousEnvironment = Object.fromEntries([
    "NODE_ENV", "DECISION_CONTINUITY_ADAPTER", "DECISION_CONTINUITY_DATABASE_URL", "DECISION_CONTINUITY_DURABLE_WORKFLOWS",
    "PLUTONIX_AUTH_MODE", "OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_JSON", "OIDC_JWKS_URL", "PLUTONIX_DEV_AUTH_ENABLED", "PLUTONIX_SERVER_AUTOSTART"
  ].map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DECISION_CONTINUITY_ADAPTER: "postgres",
    DECISION_CONTINUITY_DATABASE_URL: databaseUrl,
    DECISION_CONTINUITY_DURABLE_WORKFLOWS: "true",
    PLUTONIX_AUTH_MODE: "oidc",
    OIDC_ISSUER: oidcIssuer,
    OIDC_AUDIENCE: oidcAudience,
    OIDC_JWKS_JSON: JSON.stringify({ keys: [publicJwk] }),
    OIDC_JWKS_URL: "",
    PLUTONIX_DEV_AUTH_ENABLED: "false",
    PLUTONIX_SERVER_AUTOSTART: "false"
  });

  const store = new PostgresDecisionContinuityStore({ databaseUrl, reconsiderationCooldownMs: 0 });
  const fixtureQueue = new DecisionContinuityWorkflowQueue({ databaseUrl, store, logger: { info() {} } });
  const identityAccess = new IdentityAccessStore({ databaseUrl });
  const provisionHuman = async (id, roles, tenantId = tenants.a) => {
    await identityAccess.provisionPrincipal({ id, issuer: oidcIssuer, subject: id, type: "human", displayName: id });
    await identityAccess.provisionMembership({ principalId: id, tenantId, roles });
  };
  await provisionHuman(tenants.a, ["tenant_admin"]);
  await provisionHuman(tenants.b, ["tenant_admin"], tenants.b);
  await provisionHuman(approver, ["approver"]);
  await provisionHuman(insufficientHuman, []);
  await identityAccess.provisionPrincipal({ id: trustedService, issuer: oidcIssuer, subject: trustedService, type: "service", displayName: "HTTP matrix service" });
  await identityAccess.provisionMembership({
    principalId: trustedService,
    tenantId: tenants.a,
    serviceScopes: ["decision:readiness", "decision:condition_ingest", "decision:evaluate", "decision:policy"]
  });
  await identityAccess.provisionPrincipal({ id: insufficientService, issuer: oidcIssuer, subject: insufficientService, type: "service", displayName: "Insufficient HTTP matrix service" });
  await identityAccess.provisionMembership({ principalId: insufficientService, tenantId: tenants.a, serviceScopes: [] });
  const fixtureA = await createFixture(store, fixtureQueue, tenants.a, "a");
  const fixtureB = await createFixture(store, fixtureQueue, tenants.b, "b");
  const { app, closePlutonixServerResources } = await import("../../src/server.js");
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const oversizedMarker = "operational-body-limit-marker";
  const oversized = await request(baseUrl, {
    method: "POST",
    path: "/branches",
    headers: userHeaders(tenants.a, { "content-type": "application/json", "x-request-id": "operational-request-id" }),
    rawBody: JSON.stringify({ evidence: oversizedMarker.repeat(12_000) })
  });
  assert.equal(oversized.status, 413, oversized.text);
  assert.equal(oversized.headers["x-request-id"], "operational-request-id");
  assert.doesNotMatch(oversized.text, new RegExp(oversizedMarker));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closePlutonixServerResources();
    await fixtureQueue.pool?.query(
      "UPDATE decision_continuity_workflow_jobs SET state = 'cancelled', cancelled_at = clock_timestamp() WHERE tenant_id = ANY($1::text[]) AND state IN ('pending', 'retry', 'leased')",
      [[tenants.a, tenants.b]]
    );
    await fixtureQueue.pool?.end();
    await store.pool?.end();
    await identityAccess.pool?.end();
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const totals = { matrixCases: 0, unauthenticated: 0, insufficientCapability: 0, crossTenant: 0, tenantMismatch: 0, authorizedSuccess: 0, headerTenantTamper: 0, queryTenantTamper: 0, bodyTenantTamper: 0, pathCrossTenant: 0, missingTenant: 0, invalidContentType: 0, invalidPayload: 0 };
  const standardCases = ["unauthenticated", "insufficient_capability", "cross_tenant", "tenant_mismatch", "authorized_success"];
  for (const entry of matrix) {
    for (const caseName of standardCases) {
      const before = await effectSnapshot(fixtureQueue.pool);
      const input = requestCase(entry, caseName, fixtureA);
      const response = await request(baseUrl, input);
      assert.equal(response.status, expectedStatus(entry, caseName), `${entry.key} ${caseName}: ${response.text}`);
      if (caseName !== "authorized_success") {
        assertNoSensitiveFailure(response);
        assert.deepEqual(await effectSnapshot(fixtureQueue.pool), before, `${entry.key} ${caseName} must have no protected side effect`);
      } else if (entry.execution === "read") {
        assert.deepEqual(await effectSnapshot(fixtureQueue.pool), before, `${entry.key} reads must not mutate state`);
        assertTenantRead(entry, response, fixtureA, fixtureB);
      } else if (entry.execution === "durable_queue") {
        const after = await assertQueuedSubmission(fixtureQueue.pool, entry, response, before);
        const replay = await request(baseUrl, input);
        assert.equal(replay.status, 200, `${entry.key} idempotent replay must be acknowledged`);
        assert.equal(replay.json.status, "idempotent");
        assert.equal(replay.json.job.jobId, response.json.job.jobId);
        assert.deepEqual(await effectSnapshot(fixtureQueue.pool), after, `${entry.key} replay must not duplicate effects`);
      } else {
        assert.equal(response.json.status, "accepted");
        assert.equal(response.json.job.state, "pending");
        const redriven = await fixtureQueue.pool.query("SELECT state, redrive_count FROM decision_continuity_workflow_jobs WHERE job_id = $1", [fixtureA.workflow.job.jobId]);
        assert.deepEqual(redriven.rows[0], { state: "pending", redrive_count: 1 });
        const after = await effectSnapshot(fixtureQueue.pool);
        assert.equal(after.jobs, before.jobs);
        assert.equal(after.events, before.events);
        assert.equal(after.outbox, before.outbox);
        assert.equal(after.workflow_audit, before.workflow_audit + 1);
        const replay = await request(baseUrl, input);
        assert.equal(replay.status, 200);
        assert.equal(replay.json.status, "idempotent");
        assert.deepEqual(await effectSnapshot(fixtureQueue.pool), after);
      }
      if (caseName === "unauthenticated") totals.unauthenticated += 1;
      if (caseName === "insufficient_capability") totals.insufficientCapability += 1;
      if (caseName === "cross_tenant") {
        totals.crossTenant += 1;
        totals.headerTenantTamper += 1;
      }
      if (caseName === "tenant_mismatch") totals.tenantMismatch += 1;
      if (caseName === "authorized_success") totals.authorizedSuccess += 1;
      totals.matrixCases += 1;
    }

    // Every route is checked for a query-level tenant swap in addition to the
    // header swap above. JSON mutations also reject a body tenant swap, and
    // resource routes reject identifiers belonging to another tenant.
    {
      const before = await effectSnapshot(fixtureQueue.pool);
      const input = requestCase(entry, "authorized_success", fixtureA);
      input.path = `${input.path}${input.path.includes("?") ? "&" : "?"}tenantId=${encodeURIComponent(tenants.b)}`;
      const response = await request(baseUrl, input);
      assert.equal(response.status, 400, `${entry.key} query tenant tamper: ${response.text}`);
      assertNoSensitiveFailure(response);
      assert.deepEqual(await effectSnapshot(fixtureQueue.pool), before);
      totals.queryTenantTamper += 1;
    }

    if (entry.jsonBody) {
      const before = await effectSnapshot(fixtureQueue.pool);
      const input = requestCase(entry, "authorized_success", fixtureA);
      input.body = { ...input.body, tenantId: tenants.b };
      const response = await request(baseUrl, input);
      assert.equal(response.status, 400, `${entry.key} body tenant tamper: ${response.text}`);
      assertNoSensitiveFailure(response);
      assert.deepEqual(await effectSnapshot(fixtureQueue.pool), before);
      totals.bodyTenantTamper += 1;
    }

    if (entry.path.includes(":")) {
      const before = await effectSnapshot(fixtureQueue.pool);
      const input = requestCase(entry, "authorized_success", fixtureA);
      input.path = resourcePath(entry, fixtureB);
      const response = await request(baseUrl, input);
      assert.equal(response.status, 404, `${entry.key} path tenant tamper: ${response.text}`);
      assertNoSensitiveFailure(response);
      assert.deepEqual(await effectSnapshot(fixtureQueue.pool), before);
      totals.pathCrossTenant += 1;
    }

    if (entry.jsonBody) {
      const before = await effectSnapshot(fixtureQueue.pool);
      const valid = requestCase(entry, "authorized_success", fixtureA);
      const invalidType = await request(baseUrl, { ...valid, headers: { ...valid.headers, "content-type": "text/plain" }, body: undefined, rawBody: "not-json" });
      assert.equal(invalidType.status, 415);
      assertNoSensitiveFailure(invalidType);
      assert.deepEqual(await effectSnapshot(fixtureQueue.pool), before);
      totals.invalidContentType += 1;
      const invalidPayload = await request(baseUrl, { ...valid, body: {}, rawBody: undefined });
      assert.equal(invalidPayload.status, 400);
      assertNoSensitiveFailure(invalidPayload);
      assert.deepEqual(await effectSnapshot(fixtureQueue.pool), before);
      totals.invalidPayload += 1;
    }
  }

  const byKey = Object.fromEntries(matrix.map((entry) => [entry.key, entry]));
  const evaluator = `matrix-evaluator-${runId}`;
  const auditor = `matrix-auditor-${runId}`;
  const workspaceAuditor = `matrix-workspace-auditor-${runId}`;
  const qAgent = `qagent-policy-${runId}`;
  const brainxService = `brainx-router-${runId}`;
  await provisionHuman(evaluator, ["evaluator_reviewer"]);
  await provisionHuman(auditor, ["auditor"]);
  await identityAccess.provisionPrincipal({ id: workspaceAuditor, issuer: oidcIssuer, subject: workspaceAuditor, type: "human", displayName: workspaceAuditor });
  await identityAccess.provisionMembership({ principalId: workspaceAuditor, tenantId: tenants.a, workspaceId: fixtureA.workspaceId, roles: ["auditor"] });
  await identityAccess.provisionPrincipal({ id: qAgent, issuer: oidcIssuer, subject: qAgent, type: "service", displayName: "QAgent policy advisor" });
  await identityAccess.provisionMembership({ principalId: qAgent, tenantId: tenants.a, serviceScopes: ["decision:policy"] });
  await identityAccess.provisionPrincipal({ id: brainxService, issuer: oidcIssuer, subject: brainxService, type: "service", displayName: "BrainX isolated router" });
  await identityAccess.provisionMembership({ principalId: brainxService, tenantId: tenants.a, serviceScopes: ["brainx:execute"] });

  {
    const input = requestCase(byKey.evaluation, "authorized_success", fixtureA);
    input.headers = { ...headersForPrincipal(evaluator, tenants.a), "idempotency-key": `human-evaluator-${runId}` };
    const response = await request(baseUrl, input);
    assert.equal(response.status, 202, `the evaluator_reviewer role must be able to submit an independent evaluation: ${response.text}`);
    assert.equal(response.json.job.payload.__workflow.authorization.principalType, "human");
  }
  {
    const input = requestCase(byKey.approval, "authorized_success", fixtureA);
    input.headers = { ...userHeaders(tenants.a), "idempotency-key": `self-approval-${runId}` };
    const response = await request(baseUrl, input);
    assert.equal(response.status, 403, `an originating proposer/admin must not self-approve: ${response.text}`);
  }
  {
    const input = requestCase(byKey.branch_create, "authorized_success", fixtureA);
    input.headers = { ...headersForPrincipal(auditor, tenants.a), "idempotency-key": `auditor-proposal-${runId}` };
    const response = await request(baseUrl, input);
    assert.equal(response.status, 403, `auditor must remain read-only: ${response.text}`);
  }
  {
    const withoutWorkspace = await request(baseUrl, { method: "get", path: byKey.branch_list.path, headers: headersForPrincipal(workspaceAuditor, tenants.a) });
    assert.equal(withoutWorkspace.status, 404, `workspace-limited memberships must not widen to the whole tenant: ${withoutWorkspace.text}`);
    const withinWorkspace = await request(baseUrl, { method: "get", path: `${byKey.branch_list.path}?workspaceId=${encodeURIComponent(fixtureA.workspaceId)}`, headers: headersForPrincipal(workspaceAuditor, tenants.a) });
    assert.equal(withinWorkspace.status, 200, `workspace-limited memberships must read their selected workspace: ${withinWorkspace.text}`);
    assert.ok(withinWorkspace.json.branches.every((branch) => branch.workspaceId === fixtureA.workspaceId));
  }
  {
    const input = requestCase(byKey.policy, "authorized_success", fixtureA);
    input.headers = { ...headersForPrincipal(qAgent, tenants.a), "idempotency-key": `qagent-policy-${runId}` };
    const response = await request(baseUrl, input);
    assert.equal(response.status, 403, `QAgent/BrainX identities cannot administer policy: ${response.text}`);
  }
  {
    const workspace = `?workspaceId=${encodeURIComponent(fixtureA.workspaceId)}`;
    const deniedRead = await brainxRequest(baseUrl, { method: "get", path: "/overview", headers: headersForPrincipal(insufficientHuman, tenants.a) });
    assert.equal(deniedRead.status, 403, `BrainX read requires its dedicated human permission: ${deniedRead.text}`);
    const serviceAdmin = await brainxRequest(baseUrl, { method: "post", path: `/registrations${workspace}`, headers: headersForPrincipal(brainxService, tenants.a), body: brainxRegistrationInput(`service-${runId}`) });
    assert.equal(serviceAdmin.status, 403, `BrainX execution service must not administer registrations: ${serviceAdmin.text}`);
    const invalid = await brainxRequest(baseUrl, { method: "post", path: `/registrations${workspace}`, headers: userHeaders(tenants.a), body: { ...brainxRegistrationInput(`invalid-${runId}`), callerRouteOverride: "allow-any-provider" } });
    assert.equal(invalid.status, 400, `unknown BrainX registration fields must be rejected: ${invalid.text}`);
    const created = await brainxRequest(baseUrl, { method: "post", path: `/registrations${workspace}`, headers: userHeaders(tenants.a), body: brainxRegistrationInput(`valid-${runId}`) });
    assert.equal(created.status, 201, `tenant admin may register a reviewed fixture: ${created.text}`);
    const overview = await brainxRequest(baseUrl, { method: "get", path: `/overview${workspace}`, headers: userHeaders(tenants.a) });
    assert.equal(overview.status, 200);
    assert.ok(overview.json.registrations.some((record) => record.id === created.json.registration.id));
    assert.doesNotMatch(JSON.stringify(overview.json), /fixture input|authorization|bearer|secret/i);
    const tenantSwap = await brainxRequest(baseUrl, { method: "get", path: "/overview", headers: headersForPrincipal(tenants.a, tenants.b) });
    assert.equal(tenantSwap.status, 404, `BrainX tenant selector must not cross the caller membership: ${tenantSwap.text}`);
  }
  await assert.rejects(
    identityAccess.provisionMembership({ principalId: trustedService, tenantId: tenants.a, workspaceId: "approval-forbidden", serviceScopes: ["decision:approve"] }),
    /decision:approve|identity_tenant_memberships/i
  );
  await identityAccess.provisionMembership({ principalId: approver, tenantId: tenants.a, roles: ["approver"], status: "revoked" });
  {
    const response = await request(baseUrl, requestCase(byKey.approval, "authorized_success", fixtureA));
    assert.equal(response.status, 404, `membership revocation must take effect on the next request: ${response.text}`);
  }
  const accessAudit = await fixtureQueue.pool.query(
    "SELECT outcome, code, metadata::text AS metadata FROM identity_access_audit WHERE tenant_id = $1 ORDER BY audit_id DESC LIMIT 80",
    [tenants.a]
  );
  assert.ok(accessAudit.rows.some((row) => row.outcome === "allowed"));
  assert.ok(accessAudit.rows.some((row) => row.outcome === "denied"));
  assert.doesNotMatch(JSON.stringify(accessAudit.rows), /Bearer\s|token|credential|claims/i, "authorization audit must not store raw token material or claims");

  assert.deepEqual(totals, {
    matrixCases: 95,
    unauthenticated: 19,
    insufficientCapability: 19,
    crossTenant: 19,
    tenantMismatch: 19,
    authorizedSuccess: 19,
    headerTenantTamper: 19,
    queryTenantTamper: 19,
    bodyTenantTamper: 8,
    pathCrossTenant: 11,
    missingTenant: 0,
    invalidContentType: 8,
    invalidPayload: 8
  });
  console.log(JSON.stringify({ decisionContinuityHttpSecurityMatrix: { routes: matrix.length, ...totals, totalHttpRequests: 149 } }));
});
