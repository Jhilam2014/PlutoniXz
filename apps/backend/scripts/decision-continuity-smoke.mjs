import crypto from "node:crypto";
import { PostgresDecisionContinuityStore } from "../src/decisionContinuityPostgres.js";
import { DecisionContinuityWorkflowQueue } from "../src/decisionContinuityWorkflow.js";

if (process.env.DECISION_CONTINUITY_SMOKE_ENABLED !== "true") {
  throw new Error("Set DECISION_CONTINUITY_SMOKE_ENABLED=true only for an isolated non-production smoke tenant.");
}
const databaseUrl = process.env.DECISION_CONTINUITY_DATABASE_URL || process.env.DATABASE_URL;
const tenantId = process.env.DECISION_CONTINUITY_SMOKE_TENANT_ID;
const apiUrl = String(process.env.DECISION_CONTINUITY_API_URL || "").replace(/\/$/, "");
const workerUrl = String(process.env.DECISION_CONTINUITY_WORKER_HEALTH_URL || "").replace(/\/$/, "");
if (!databaseUrl || !tenantId || !apiUrl || !workerUrl) {
  throw new Error("Smoke checks require DECISION_CONTINUITY_DATABASE_URL, DECISION_CONTINUITY_SMOKE_TENANT_ID, DECISION_CONTINUITY_API_URL, and DECISION_CONTINUITY_WORKER_HEALTH_URL.");
}
if (process.env.NODE_ENV === "production" && !String(tenantId).startsWith("smoke-")) {
  throw new Error("Production smoke tenants must use a dedicated tenant ID beginning with smoke-.");
}

const check = async (url, label) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  return response.json();
};
const api = await check(`${apiUrl}/api/decision-continuity/readiness`, "API readiness");
const worker = await check(`${workerUrl}/readyz`, "Worker readiness");
if (api.status !== "ok" || worker.readiness !== "ready") throw new Error("API or worker is not ready for durable decision-continuity work.");

const store = new PostgresDecisionContinuityStore({ databaseUrl });
const queue = new DecisionContinuityWorkflowQueue({ store, databaseUrl, workerId: `smoke-${process.pid}-${crypto.randomUUID().slice(0, 8)}` });
try {
  await store.database();
  const migrations = await store.pool.query("SELECT migration_name FROM decision_continuity_schema_migrations ORDER BY migration_name");
  if (!migrations.rows.some((row) => row.migration_name === "007_governed_promotion_runtime.sql")) throw new Error("Current governed-promotion migration is not applied.");
  const id = crypto.randomUUID();
  const submitted = await queue.submit({
    tenantId, workspaceId: "deployment-smoke", jobType: "condition_event", idempotencyKey: `smoke:${id}`,
    payload: { eventId: `smoke-${id}`, workspaceId: "deployment-smoke", source: "deployment-smoke", observations: [{ constraintId: "deployment-smoke", state: "cleared", source: "deployment-smoke", trusted: true, authorized: true }], __workflow: { actor: { type: "service", id: "deployment-smoke" } } }
  });
  const claimed = await queue.claim({ tenantId });
  if (!claimed || claimed.jobId !== submitted.job.jobId) throw new Error("Worker could not claim the deployment smoke job.");
  await queue.execute(claimed);
  const completed = await queue.jobStatus({ jobId: submitted.job.jobId, tenantId });
  if (completed.state !== "completed") throw new Error("Deployment smoke job did not complete.");
  console.log(JSON.stringify({ status: "ok", migrationCount: migrations.rowCount, jobId: completed.jobId, api: api.status, worker: worker.readiness }));
} finally {
  await queue.pool?.end();
  await store.pool?.end();
}
