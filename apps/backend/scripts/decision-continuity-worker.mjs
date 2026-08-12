import http from "node:http";
import { createDecisionContinuityStore } from "../src/decisionContinuity.js";
import { DecisionContinuityWorkflowQueue, workflowConfigFromEnvironment } from "../src/decisionContinuityWorkflow.js";
import { assertProductionIdentityConfiguration } from "../src/auth.js";
import { IdentityAccessStore } from "../src/identityAccess.js";

if (String(process.env.DECISION_CONTINUITY_ADAPTER || "postgres").toLowerCase() !== "postgres") {
  throw new Error("DECISION_CONTINUITY_ADAPTER=postgres is required for the decision-continuity worker.");
}
if (!process.env.DECISION_CONTINUITY_DATABASE_URL && !process.env.DATABASE_URL) {
  throw new Error("DECISION_CONTINUITY_DATABASE_URL is required for the decision-continuity worker.");
}
assertProductionIdentityConfiguration();
if (process.env.NODE_ENV === "production" && !process.env.DECISION_CONTINUITY_WORKER_PRINCIPAL_ID) {
  throw new Error("DECISION_CONTINUITY_WORKER_PRINCIPAL_ID is required for the production workflow worker.");
}
const config = workflowConfigFromEnvironment();
const databaseUrl = process.env.DECISION_CONTINUITY_DATABASE_URL || process.env.DATABASE_URL;
const store = createDecisionContinuityStore({
  adapter: "postgres", environment: process.env.NODE_ENV,
  databaseUrl,
  maxReconsiderationsPerTenantPerDay: Number(process.env.DECISION_CONTINUITY_MAX_RECONSIDERATIONS_PER_TENANT_PER_DAY || 25),
  reconsiderationCooldownMs: Number(process.env.DECISION_CONTINUITY_RECONSIDERATION_COOLDOWN_MS || 30 * 60 * 1000)
});
const identityAccess = new IdentityAccessStore({ databaseUrl });
const queue = new DecisionContinuityWorkflowQueue({ store, databaseUrl, identityAccess, workerPrincipalId: process.env.DECISION_CONTINUITY_WORKER_PRINCIPAL_ID || "", ...config });
const healthPort = Number(process.env.DECISION_CONTINUITY_WORKER_HEALTH_PORT || 8081);
let stopping = false;
const server = http.createServer(async (req, res) => {
  const health = await queue.health();
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(health));
  }
  if (req.url === "/readyz") {
    const ready = health.readiness === "ready";
    res.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
    return res.end(JSON.stringify(health));
  }
  res.writeHead(404).end();
});

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ component: "decision-continuity-worker", event: "shutdown_signal", signal, at: new Date().toISOString() }));
  await new Promise((resolve) => server.close(resolve));
  await queue.shutdown({ graceMs: config.shutdownGraceMs });
  await store.pool?.end();
  await identityAccess.pool?.end();
  process.exitCode = 0;
}

process.once("SIGTERM", () => { void stop("SIGTERM"); });
process.once("SIGINT", () => { void stop("SIGINT"); });
process.once("uncaughtException", (error) => { console.error(error); void stop("uncaughtException"); });
process.once("unhandledRejection", (error) => { console.error(error); void stop("unhandledRejection"); });

await queue.start();
await new Promise((resolve, reject) => server.listen(healthPort, "0.0.0.0", (error) => error ? reject(error) : resolve()));
console.log(JSON.stringify({ component: "decision-continuity-worker", event: "health_server_ready", port: healthPort, at: new Date().toISOString() }));
