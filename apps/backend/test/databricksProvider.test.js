import assert from "node:assert/strict";
import test from "node:test";
import { DatabricksExecutionProvider } from "../src/gothamStudio/providers/databricks/databricksProvider.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function providerWith(fetchImpl) {
  return new DatabricksExecutionProvider({
    env: { DATABRICKS_HOST: "https://workspace.example", DATABRICKS_TOKEN: "backend-only-token", DATABRICKS_JOBS_API_VERSION: "2.2", GOTHAM_STUDIO_PROVIDER_RETRIES: "0" },
    fetchImpl
  });
}

const logicalJob = {
  id: "PX-ML-TEST",
  name: "Provider boundary",
  providerConfiguration: { jobId: 81932, jobParameters: { dataset: "catalog.schema.table" } },
  constraints: { maxRuntimeMinutes: 30 }
};

test("Databricks adapter submits saved jobs with backend auth and persists physical references", async () => {
  const requests = [];
  const provider = providerWith(async (url, options) => {
    requests.push({ url: String(url), method: options.method, authorization: options.headers.authorization, body: JSON.parse(options.body) });
    return jsonResponse({ run_id: 310441 });
  });
  const reference = await provider.submitJob(logicalJob);
  assert.equal(reference.providerJobId, "81932");
  assert.equal(reference.providerRunId, "310441");
  assert.match(requests[0].url, /\/api\/2\.2\/jobs\/run-now$/);
  assert.equal(requests[0].authorization, "Bearer backend-only-token");
  assert.equal(requests[0].body.idempotency_token, "PX-ML-TEST");
});

test("Databricks adapter reads status, output, cancellation, success, and failure from HTTP boundaries", async () => {
  const requests = [];
  const provider = providerWith(async (url, options) => {
    requests.push({ url: String(url), method: options.method });
    if (String(url).includes("runs/get-output")) return jsonResponse({ logs: "training output" });
    if (String(url).includes("runs/get")) return jsonResponse({ state: { life_cycle_state: "TERMINATED", result_state: "FAILED", state_message: "Training failed" } });
    return jsonResponse({});
  });
  const ref = { providerRunId: "310441" };
  assert.equal((await provider.getJob(ref)).logicalState, "FAILED");
  assert.equal((await provider.getLogs(ref)).entries[0].content, "training output");
  await provider.cancelJob(ref);
  assert.equal(requests.some((request) => request.url.includes("runs/cancel") && request.method === "POST"), true);
});

test("Databricks adapter sanitizes authentication and rate-limit failures", async () => {
  const authentication = providerWith(async () => jsonResponse({ message: "Bearer leaked-provider-token" }, 401));
  await assert.rejects(() => authentication.validateConnection(), (error) => error.code === "provider_authentication_failed" && !error.message.includes("leaked-provider-token"));
  const limited = providerWith(async () => jsonResponse({ message: "Too many requests" }, 429));
  await assert.rejects(() => limited.validateConnection(), (error) => error.code === "provider_rate_limited" && error.retryable === true);
});
