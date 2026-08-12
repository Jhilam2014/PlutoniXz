import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { PostgresDecisionContinuityStore } from "../../src/decisionContinuityPostgres.js";
import { DecisionContinuityWorkflowQueue } from "../../src/decisionContinuityWorkflow.js";
import { IdentityAccessStore } from "../../src/identityAccess.js";

const databaseUrl = process.env.DECISION_CONTINUITY_TEST_DATABASE_URL;
const options = databaseUrl ? {} : { skip: "Set DECISION_CONTINUITY_TEST_DATABASE_URL." };
const run = `${process.pid}-${Date.now()}`;
const actor = { type: "service", id: "workflow-test" };
const input = (id) => ({ eventId: `${id}-${run}`, workspaceId: "gate", source: "monitor", observations: [{ constraintId: "capacity", state: "cleared", source: "monitor", trusted: true, authorized: true }] });
const queueFor = (store, extra = {}) => new DecisionContinuityWorkflowQueue({
  databaseUrl, store, leaseMs: 1_000, pollMs: 30_000, shutdownGraceMs: 250,
  globalConcurrency: 2, perTenantConcurrency: 1, perTenantQueueLimit: 20, maxAttempts: 2, maxRedrives: 1,
  logger: { info() {} }, ...extra
});
const close = async (...queues) => Promise.all(queues.map(async (queue) => queue.pool?.end()));

function waitFor(child, predicate, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(new Error("Timed out waiting for worker lifecycle event.")), timeoutMs);
    const onData = (chunk) => {
      text += chunk.toString();
      if (predicate(text)) { clearTimeout(timer); child.stdout.off("data", onData); resolve(text); }
    };
    child.stdout.on("data", onData);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

function waitForExit(child, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Worker did not exit within its shutdown bound.")), timeoutMs);
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

test("actual SIGTERM drains an idle worker process and exits without timer or PostgreSQL-pool leakage", options, async (context) => {
  const healthPort = 18_100 + (process.pid % 1_000);
  const child = spawn(process.execPath, ["scripts/decision-continuity-worker.mjs"], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "test", DECISION_CONTINUITY_ADAPTER: "postgres", DECISION_CONTINUITY_DATABASE_URL: databaseUrl, DECISION_CONTINUITY_WORKER_HEALTH_PORT: String(healthPort), DECISION_CONTINUITY_WORKER_POLL_MS: "30000", DECISION_CONTINUITY_WORKER_SHUTDOWN_GRACE_MS: "250" }
  });
  context.after(() => { if (!child.killed) child.kill("SIGKILL"); });
  await waitFor(child, (text) => text.includes('"health_server_ready"'));
  child.kill("SIGTERM");
  const exit = await waitForExit(child);
  assert.equal(exit.signal, null);
  assert.equal(exit.code, 0);
});

test("SIGTERM-equivalent draining is ready while idle, claims nothing new, and closes cleanly", options, async (context) => {
  const store = new PostgresDecisionContinuityStore({ databaseUrl });
  const queue = queueFor(store);
  context.after(async () => { await close(queue); await store.pool?.end(); });
  await queue.start();
  assert.equal((await queue.health()).readiness, "ready");
  await queue.shutdown({ graceMs: 250 });
  assert.equal(queue.pollTimer, null);
  assert.equal(queue.heartbeatTimer, null);
  assert.equal(queue.draining, true);
});

test("a worker can claim and execute only a tenant-scoped capability it is provisioned for, and rechecks a revoked submitter", options, async (context) => {
  const store = new PostgresDecisionContinuityStore({ databaseUrl });
  const identities = new IdentityAccessStore({ databaseUrl });
  const tenantId = `worker-identity-${run}`;
  const workerPrincipalId = `worker-service-${run}`;
  const submitterPrincipalId = `submitter-service-${run}`;
  const queue = queueFor(store, { identityAccess: identities, workerPrincipalId });
  context.after(async () => { await close(queue); await store.pool?.end(); await identities.pool?.end(); });
  await identities.provisionPrincipal({ id: workerPrincipalId, issuer: "test", subject: workerPrincipalId, type: "service" });
  await identities.provisionMembership({ principalId: workerPrincipalId, tenantId, serviceScopes: ["workflow:execute", "workflow:execute:condition_event"] });
  await identities.provisionPrincipal({ id: submitterPrincipalId, issuer: "test", subject: submitterPrincipalId, type: "service" });
  await identities.provisionMembership({ principalId: submitterPrincipalId, tenantId, serviceScopes: ["decision:condition_ingest"] });
  const authorization = { principalId: submitterPrincipalId, principalType: "service", tenantId, permission: "decision:condition_ingest", membershipWorkspaceId: "*" };
  const accepted = await queue.submit({
    tenantId,
    workspaceId: "gate",
    jobType: "condition_event",
    payload: { ...input("worker-authorized"), __workflow: { actor: { type: "service", id: submitterPrincipalId }, authorization } },
    idempotencyKey: `worker-authorized-${run}`
  });
  const claimed = await queue.claim();
  assert.equal(claimed.jobId, accepted.job.jobId);
  await queue.execute(claimed);
  assert.equal((await queue.jobStatus({ jobId: claimed.jobId, tenantId })).state, "completed");

  await queue.submit({
    tenantId,
    workspaceId: "gate",
    jobType: "condition_event",
    payload: { ...input("worker-revoked"), __workflow: { actor: { type: "service", id: submitterPrincipalId }, authorization } },
    idempotencyKey: `worker-revoked-${run}`
  });
  const revokedClaim = await queue.claim();
  await identities.provisionMembership({ principalId: submitterPrincipalId, tenantId, serviceScopes: [], status: "revoked" });
  await assert.rejects(queue.execute(revokedClaim), (error) => error.code === "authorization_denied");
  await queue.fail(revokedClaim, Object.assign(new Error("revoked submitter"), { code: "authorization_denied" }));
  assert.equal((await queue.jobStatus({ jobId: revokedClaim.jobId, tenantId })).state, "dead");
});

test("shutdown grace fences active work and a second worker recovers the relinquished lease", options, async (context) => {
  const store = new PostgresDecisionContinuityStore({ databaseUrl });
  let enterEffect;
  let releaseEffect;
  const entered = new Promise((resolve) => { enterEffect = resolve; });
  const release = new Promise((resolve) => { releaseEffect = resolve; });
  const first = queueFor(store, { hooks: { beforeEffect: async () => { enterEffect(); await release; } } });
  const second = queueFor(store);
  context.after(async () => { releaseEffect(); await close(first, second); await store.pool?.end(); });
  await first.start();
  const submitted = await first.submit({ tenantId: `shutdown-${run}`, workspaceId: "gate", jobType: "condition_event", payload: { ...input("shutdown"), __workflow: { actor } }, idempotencyKey: `shutdown-${run}` });
  const claimed = await first.claim();
  const runEffect = first.execute(claimed).catch((error) => error);
  first.active.set(claimed.jobId, { job: claimed, run: runEffect });
  await entered;
  const stopping = first.shutdown({ graceMs: 100 });
  assert.equal(await first.claim(), null, "draining worker must stop claiming immediately");
  await stopping;
  const recovered = await second.claim();
  assert.equal(recovered.jobId, submitted.job.jobId);
  releaseEffect();
  assert.equal((await runEffect).code, "lease_lost", "expired shutdown work cannot commit after relinquishing its lease");
  await second.execute(recovered);
  assert.equal((await second.jobStatus({ jobId: submitted.job.jobId, tenantId: submitted.job.tenantId })).state, "completed");
});

test("tenant admission, global/per-tenant claims, duplicate storms, lease transfer, and isolation hold under multi-worker load", options, async (context) => {
  const store = new PostgresDecisionContinuityStore({ databaseUrl });
  const workers = [queueFor(store), queueFor(store), queueFor(store)];
  context.after(async () => { await close(...workers); await store.pool?.end(); });
  const noisy = `noisy-${run}`;
  const quiet = `quiet-${run}`;
  const submittedAt = Date.now();
  const noisyJobs = await Promise.all(Array.from({ length: 8 }, (_, index) => workers[0].submit({ tenantId: noisy, workspaceId: "gate", jobType: "condition_event", payload: { ...input(`noisy-${index}`), __workflow: { actor } }, idempotencyKey: `noisy-${index}-${run}` })));
  const quietJobs = await Promise.all(Array.from({ length: 2 }, (_, index) => workers[0].submit({ tenantId: quiet, workspaceId: "gate", jobType: "condition_event", payload: { ...input(`quiet-${index}`), __workflow: { actor } }, idempotencyKey: `quiet-${index}-${run}` })));
  const duplicates = await Promise.all(Array.from({ length: 12 }, () => workers[0].submit({ tenantId: quiet, workspaceId: "gate", jobType: "condition_event", payload: { ...input("duplicate"), __workflow: { actor } }, idempotencyKey: `duplicate-${run}` })));
  assert.equal(new Set(duplicates.map((entry) => entry.job.jobId)).size, 1, "duplicate storm must consume one queue slot");

  const first = await workers[0].claim();
  const second = await workers[1].claim();
  const third = await workers[2].claim();
  assert.notEqual(first.tenantId, second.tenantId, "fair claim gives a quiet tenant progress while noisy work is leased");
  assert.equal(third, null, "global concurrency is transactionally capped across workers");
  await Promise.all([workers[0].execute(first), workers[1].execute(second)]);

  const transfer = await workers[0].claim();
  await store.database();
  await store.pool.query("UPDATE decision_continuity_workflow_jobs SET leased_until = clock_timestamp() - interval '1 millisecond' WHERE job_id = $1", [transfer.jobId]);
  const recovered = await workers[1].claim();
  assert.equal(recovered.jobId, transfer.jobId, "expired lease is recovered by another worker");
  await assert.rejects(workers[0].execute(transfer), (error) => error.code === "lease_lost");
  await workers[1].execute(recovered);

  let iterations = 0;
  while (iterations++ < 30) {
    const claims = await Promise.all(workers.map((worker) => worker.claim()));
    const active = claims.filter(Boolean);
    if (!active.length) break;
    await Promise.all(claims.map((job, index) => job ? workers[index].execute(job) : null));
  }
  const noisyStatus = await workers[0].status({ tenantId: noisy });
  const quietStatus = await workers[0].status({ tenantId: quiet });
  assert.equal(noisyStatus.counts.completed, noisyJobs.length);
  assert.equal(quietStatus.counts.completed, quietJobs.length + 1);
  await assert.rejects(workers[0].jobStatus({ jobId: noisyJobs[0].job.jobId, tenantId: quiet }), (error) => error.code === "not_found");
  const elapsedMs = Date.now() - submittedAt;
  console.log(JSON.stringify({ workflowLoadReport: { tenants: 2, jobs: noisyJobs.length + quietJobs.length + 1, duplicateSubmissions: duplicates.length, workers: 3, globalConcurrency: 2, perTenantConcurrency: 1, elapsedMs, assertions: ["global cap", "per-tenant cap", "fair quiet progress", "duplicate safety", "lease recovery", "tenant isolation"] } }));
});
