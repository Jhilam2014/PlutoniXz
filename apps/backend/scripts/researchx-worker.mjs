import http from "node:http";
import { createDecisionContinuityStore } from "../src/decisionContinuity.js";
import {
  ResearchXService,
  bootstrapResearchXWorker,
  createBoundedResearchSourceFetcher,
  resolveResearchXConfig
} from "../src/researchX.js";

// This process intentionally has no command-line source, tenant, URL, or
// budget overrides.  All configuration is supplied by its environment and the
// authoritative source registry/policy is read through Decision Continuity.
const config = resolveResearchXConfig(process.env);
if (!config.enabled || !config.workerEnabled || !config.networkEnabled || !config.enabledTenants.size) {
  throw new Error("ResearchX worker is disabled. Set explicit RESEARCHX_ENABLED, RESEARCHX_WORKER_ENABLED, RESEARCHX_NETWORK_ENABLED, and RESEARCHX_ENABLED_TENANTS values to run it.");
}
if (String(process.env.DECISION_CONTINUITY_ADAPTER || "postgres").toLowerCase() !== "postgres") {
  throw new Error("DECISION_CONTINUITY_ADAPTER=postgres is required for the ResearchX worker.");
}
const databaseUrl = process.env.DECISION_CONTINUITY_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DECISION_CONTINUITY_DATABASE_URL is required for the ResearchX worker.");

const store = createDecisionContinuityStore({ adapter: "postgres", environment: process.env.NODE_ENV, databaseUrl });
await store.ensure();

// The enterprise service is loaded here rather than reconstructed from an
// environment-defined module path.  That prevents a worker environment from
// injecting arbitrary executable code into the privileged budget boundary.
let EnterpriseGovernanceService;
try {
  ({ EnterpriseGovernanceService } = await import("../src/enterpriseGovernance.js"));
} catch (error) {
  throw new Error(`ResearchX requires the EnterpriseGovernanceService composition root: ${error.message}`);
}
if (typeof EnterpriseGovernanceService !== "function") throw new Error("ResearchX requires EnterpriseGovernanceService to enforce policy and budget reservations.");

const governance = new EnterpriseGovernanceService({ store });
const service = new ResearchXService({
  store,
  governance,
  config,
  sourceFetcher: createBoundedResearchSourceFetcher(),
  actor: { type: "service", id: process.env.RESEARCHX_WORKER_PRINCIPAL_ID || "researchx-worker" }
});
const worker = await bootstrapResearchXWorker({ env: process.env, service, start: false });
const healthPort = Number(process.env.RESEARCHX_WORKER_HEALTH_PORT || 8082);
let stopping = false;

const healthServer = http.createServer((req, res) => {
  const health = worker.health();
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(health));
  }
  if (req.url === "/readyz") {
    const ready = health.status === "ready";
    res.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
    return res.end(JSON.stringify(health));
  }
  res.writeHead(404).end();
});

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ component: "researchx-worker", event: "shutdown_signal", signal, at: new Date().toISOString() }));
  await worker.stop();
  await new Promise((resolve) => healthServer.close(resolve));
  await store.pool?.end();
  process.exitCode = 0;
}

process.once("SIGTERM", () => { void stop("SIGTERM"); });
process.once("SIGINT", () => { void stop("SIGINT"); });
process.once("uncaughtException", (error) => { console.error(error); void stop("uncaughtException"); });
process.once("unhandledRejection", (error) => { console.error(error); void stop("unhandledRejection"); });

await new Promise((resolve, reject) => healthServer.listen(healthPort, "0.0.0.0", (error) => error ? reject(error) : resolve()));
await worker.start();
console.log(JSON.stringify({ component: "researchx-worker", event: "ready", port: healthPort, tenants: [...config.enabledTenants], at: new Date().toISOString() }));
