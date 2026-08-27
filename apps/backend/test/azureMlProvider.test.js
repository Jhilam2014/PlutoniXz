import assert from "node:assert/strict";
import test from "node:test";
import { AzureMlExecutionProvider } from "../src/gothamStudio/providers/azureMl/azureMlProvider.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function providerWith(fetchImpl) {
  return new AzureMlExecutionProvider({
    env: {
      AZURE_ML_SUBSCRIPTION_ID: "subscription-test",
      AZURE_ML_RESOURCE_GROUP: "rg-test",
      AZURE_ML_WORKSPACE_NAME: "workspace-test",
      AZURE_ML_ACCESS_TOKEN: "backend-only-token",
      AZURE_ML_API_VERSION: "2026-03-01"
    },
    fetchImpl
  });
}

const logicalJob = {
  id: "PX-ML-TEST",
  name: "Azure boundary",
  providerConfiguration: {
    definition: {
      properties: {
        jobType: "Command",
        command: "python train.py",
        environmentId: "azureml:training-env:1",
        computeId: "azureml:cpu-cluster"
      }
    }
  }
};

test("Azure ML adapter uses the current ARM Jobs boundary and backend authorization", async () => {
  const requests = [];
  const provider = providerWith(async (url, options) => {
    requests.push({ url: String(url), method: options.method, authorization: options.headers.authorization, body: JSON.parse(options.body) });
    return jsonResponse({ properties: { status: "Starting" } });
  });
  const reference = await provider.submitJob(logicalJob);
  assert.equal(reference.providerJobId, "px-ml-test");
  assert.equal(reference.providerRunId, "px-ml-test");
  assert.equal(requests[0].method, "PUT");
  assert.match(requests[0].url, /Microsoft\.MachineLearningServices\/workspaces\/workspace-test\/jobs\/px-ml-test\?api-version=2026-03-01$/);
  assert.equal(requests[0].authorization, "Bearer backend-only-token");
  assert.equal(requests[0].body.properties.jobType, "Command");
});

test("Azure ML adapter reads normalized state and calls the documented cancel action", async () => {
  const requests = [];
  const provider = providerWith(async (url, options) => {
    requests.push({ url: String(url), method: options.method });
    return String(url).endsWith("/cancel?api-version=2026-03-01")
      ? jsonResponse({}, 202)
      : jsonResponse({ properties: { status: "Completed", startTime: "2026-08-27T10:00:00Z", endTime: "2026-08-27T10:05:00Z" } });
  });
  assert.equal((await provider.getJob({ providerJobId: "px-ml-test" })).logicalState, "SUCCEEDED");
  await provider.cancelJob({ providerJobId: "px-ml-test" });
  assert.equal(requests.some((request) => request.method === "POST" && request.url.includes("/jobs/px-ml-test/cancel")), true);
});

test("Azure ML adapter does not expose optional evidence capabilities it cannot retrieve", () => {
  const capabilities = providerWith(async () => jsonResponse({})).capabilities();
  assert.equal(capabilities.pollLogs, false);
  assert.equal(capabilities.metrics, false);
  assert.equal(capabilities.artifacts, false);
  assert.equal(capabilities.modelRegistry, false);
});
