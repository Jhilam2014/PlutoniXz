import assert from "node:assert/strict";
import test from "node:test";
import { PostgresDecisionContinuityStore } from "../../src/decisionContinuityPostgres.js";
import { DecisionContinuityWorkflowQueue } from "../../src/decisionContinuityWorkflow.js";

const databaseUrl = process.env.DECISION_CONTINUITY_TEST_DATABASE_URL;
const options = databaseUrl ? {} : { skip: "Set DECISION_CONTINUITY_TEST_DATABASE_URL." };
const run = `${process.pid}-${Date.now()}`;
const input = (id) => ({ eventId: `${id}-${run}`, workspaceId: "workflow", source: "monitor", observations: [{ constraintId: "ready", state: "cleared", source: "monitor", trusted: true, authorized: true }] });
const queueFor = (store, extra = {}) => new DecisionContinuityWorkflowQueue({ databaseUrl, store, leaseMs: 1000, maxAttempts: 2, perTenantConcurrency: 1, ...extra });

test("outbox survives an API-side publication gap and dispatches on recovery", options, async (context) => {
  const store = new PostgresDecisionContinuityStore({ databaseUrl }); const queue = queueFor(store); context.after(async()=>{ await queue.shutdown(); await store.pool?.end(); });
  const submitted = await queue.submit({ tenantId:`t-outbox-${run}`, workspaceId:"workflow", jobType:"condition_event", payload:input("outbox"), idempotencyKey:`outbox-${run}` }); await store.database();
  const pending = await store.pool.query("SELECT dispatch_status FROM decision_continuity_outbox WHERE payload->'payload'->>'jobId'=$1", [submitted.job.jobId]);
  assert.equal(pending.rows[0].dispatch_status, "pending");
  // Scope the recovery pass to this test's isolated tenant. A normal worker
  // intentionally drains the global outbox in bounded batches, so an
  // unscoped dispatch can legitimately service older tenants first.
  await queue.dispatchOutbox({ tenantId: submitted.job.tenantId, workspaceId: submitted.job.workspaceId });
  const published = await store.pool.query("SELECT dispatch_status FROM decision_continuity_outbox WHERE payload->'payload'->>'jobId'=$1", [submitted.job.jobId]);
  assert.equal(published.rows[0].dispatch_status, "published");
});

test("redelivery after an effect crash is idempotent, and lease expiry is recoverable", options, async (context) => {
  const tenantId=`t-recover-${run}`; const store=new PostgresDecisionContinuityStore({databaseUrl}); let fail=true;
  const crashing=queueFor(store,{failureInjector:(stage)=>{if(stage==="after_effect"&&fail){fail=false;throw new Error("crash after effect");}}}); const recovering=queueFor(store);
  context.after(async()=>{await crashing.shutdown();await recovering.shutdown();await store.pool?.end();});
  const submitted=await crashing.submit({tenantId,workspaceId:"workflow",jobType:"condition_event",payload:input("recover"),idempotencyKey:`recover-${run}`});
  const first=await crashing.claim({tenantId}); await crashing.execute(first).catch(error=>crashing.fail(first,error));
  await new Promise(resolve=>setTimeout(resolve,700)); const second=await recovering.claim({tenantId}); await recovering.execute(second);
  const jobs=await store.pool.query("SELECT state,attempts FROM decision_continuity_workflow_jobs WHERE job_id=$1",[submitted.job.jobId]); assert.equal(jobs.rows[0].state,"completed"); assert.equal(jobs.rows[0].attempts,2);
  const accepted=await store.listEvents({tenantId}); assert.equal(accepted.filter(event=>event.type==="condition_event.accepted").length,1);
});

test("concurrent duplicate submission, poison DLQ, and audited idempotent redrive are guarded", options, async (context) => {
  const tenantId=`t-dlq-${run}`; const store=new PostgresDecisionContinuityStore({databaseUrl}); const queue=queueFor(store); context.after(async()=>{await queue.shutdown();await store.pool?.end();});
  const [a,b]=await Promise.all([queue.submit({tenantId,workspaceId:"workflow",jobType:"condition_event",payload:input("same"),idempotencyKey:`same-${run}`}),queue.submit({tenantId,workspaceId:"workflow",jobType:"condition_event",payload:input("same"),idempotencyKey:`same-${run}`})]); assert.equal(a.job.jobId,b.job.jobId);
  const poison=await queue.submit({tenantId,workspaceId:"workflow",jobType:"disposition",payload:{branchId:"missing",status:"deferred",reason:"policy"},idempotencyKey:`poison-${run}`}); let job; do { job=await queue.claim({tenantId}); if (job?.job_type !== "disposition") await queue.execute(job); } while (job?.job_type !== "disposition"); await queue.execute(job).catch(error=>queue.fail(job,error));
  const dead=await store.pool.query("SELECT state FROM decision_continuity_workflow_jobs WHERE job_id=$1",[poison.job.jobId]); assert.equal(dead.rows[0].state,"dead");
  const redrive=await queue.redrive({jobId:poison.job.jobId,tenantId,actor:{type:"user",id:"operator"}}); const duplicateRedrive=await queue.redrive({jobId:poison.job.jobId,tenantId,actor:{type:"user",id:"operator"}}); assert.equal(redrive.idempotent,false); assert.equal(duplicateRedrive.idempotent,true); const redriven=await queue.claim({tenantId}); await queue.execute(redriven).catch(error=>queue.fail(redriven,error));
  const audit=await store.pool.query("SELECT count(*)::int AS count FROM decision_continuity_workflow_audit WHERE job_id=$1 AND action='redriven'",[poison.job.jobId]); assert.equal(audit.rows[0].count,1);
});

test("queue outage fails closed", async () => {
  const queue=new DecisionContinuityWorkflowQueue({databaseUrl:"postgres://127.0.0.1:1/nope"});
  await assert.rejects(queue.submit({tenantId:"t",workspaceId:"w",jobType:"condition_event",payload:{},idempotencyKey:"x"})); await queue.shutdown().catch(()=>{});
});
