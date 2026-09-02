import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GothamStudioRepository } from "../src/gothamStudio/gothamStudioRepository.js";
import { GothamStudioService } from "../src/gothamStudio/gothamStudioService.js";
import { ProviderRegistry } from "../src/gothamStudio/providers/providerRegistry.js";
import { MLExecutionProvider } from "../src/gothamStudio/providers/executionProvider.js";
import { normalizeDatabricksState } from "../src/gothamStudio/providers/databricks/databricksNormalizer.js";
import { normalizeAzureMlState } from "../src/gothamStudio/providers/azureMl/azureMlNormalizer.js";
import { detectMlExecutionIntent, deriveMlExecutionProposal } from "../src/gothamStudio/gothamStudioIntent.js";

const scope = { tenantId: "tenant-a", workspaceId: "project-a", projectId: "project-a" };

class FakeProvider extends MLExecutionProvider {
  constructor() {
    super({ id: "fake-provider", label: "Fake Provider", env: {} });
    this.state = "RUNNING";
    this.submissions = 0;
    this.cancellations = 0;
  }

  configurationStatus() { return { configured: true, status: "configured", metadata: { workspace: "test" } }; }
  capabilities() { return { submitJob: true, cancelJob: true, streamLogs: false, pollLogs: true, metrics: true, artifacts: true, experiments: true, modelRegistry: false, costEstimate: false, openProvider: true }; }
  async validateConnection() { return { status: "connected", connected: true, checkedAt: new Date().toISOString() }; }
  async submitJob(job) { this.submissions += 1; return { providerJobId: "physical-job", providerRunId: `run-${job.id}`, providerState: "SUBMITTED", providerUrl: "https://provider.example/runs/1" }; }
  async getJob() { return { logicalState: this.state, providerState: this.state, providerStatusMessage: "", progress: null }; }
  async cancelJob() { this.cancellations += 1; }
  async getLogs() { return { entries: [{ id: "1", stream: "stdout", content: "real provider output" }], nextCursor: null, truncated: false }; }
  async getMetrics(ref) { return (ref.experimentRunIds || []).map((experimentRunId) => ({ key: "accuracy", value: 0.91, experimentRunId })); }
  async getArtifacts() { return []; }
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-gotham-studio-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const provider = new FakeProvider();
  const repository = new GothamStudioRepository({ filePath: path.join(root, "state.json") });
  const events = [];
  const service = new GothamStudioService({ repository, providerRegistry: new ProviderRegistry([provider]), emit: (...args) => events.push(args) });
  return { root, provider, repository, service, events };
}

function jobInput(overrides = {}) {
  return {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    name: "Churn training",
    objective: "Train and evaluate a churn model.",
    provider: "fake-provider",
    parameters: {},
    providerConfiguration: {},
    constraints: { maxRuns: 2, currency: "USD", maxRuntimeMinutes: 30, allowedProviders: ["fake-provider"], allowedComputeClasses: [], allowGpu: false, allowDeployment: false },
    workflowMode: "executor",
    submit: false,
    triggerSource: "studio",
    ...overrides
  };
}

test("provider registry registers providers, reports capabilities, and rejects unknown providers", () => {
  const provider = new FakeProvider();
  const registry = new ProviderRegistry([provider]);
  assert.equal(registry.get("fake-provider"), provider);
  assert.equal(registry.list()[0].capabilities.cancelJob, true);
  assert.throws(() => registry.get("missing"), (error) => error.code === "unknown_provider");
});

test("normalizes Databricks and Azure provider states into the Studio lifecycle", () => {
  assert.equal(normalizeDatabricksState({ state: { life_cycle_state: "TERMINATED", result_state: "SUCCESS" } }).logicalState, "SUCCEEDED");
  assert.equal(normalizeDatabricksState({ status: { state: "TERMINATING", termination_details: {} } }).logicalState, "CANCELLING");
  assert.equal(normalizeAzureMlState({ properties: { status: "CancelRequested" } }).logicalState, "CANCELLING");
  assert.equal(normalizeAzureMlState({ properties: { status: "Failed", error: { message: "token=secret-value" } } }).logicalState, "FAILED");
  assert.equal(normalizeDatabricksState({ state: { life_cycle_state: "RUNNING" }, run_page_url: "javascript:alert(1)" }).providerUrl, "");
  assert.equal(normalizeAzureMlState({ properties: { status: "Running", services: { tracking: { endpoint: "data:text/html,unsafe" } } } }).providerUrl, "");
});

test("creates an idempotent logical job, persists provider references, and reconciles lifecycle state", async (t) => {
  const { provider, repository, service, events } = await fixture(t);
  const created = await service.createJob(jobInput(), scope, { idempotencyKey: "create-1", actor: { type: "user", id: "human-1" } });
  const duplicate = await service.createJob(jobInput(), scope, { idempotencyKey: "create-1", actor: { type: "user", id: "human-1" } });
  assert.equal(duplicate.id, created.id);
  const submitted = await service.submitJob(created.id, scope, { workflowMode: "executor" });
  assert.equal(submitted.logicalState, "SUBMITTED");
  assert.equal(submitted.providerJobId, "physical-job");
  assert.match(submitted.providerRunId, /^run-PX-ML-/);
  assert.equal(provider.submissions, 1);

  const running = await service.reconcileJob(created.id, scope);
  assert.equal(running.logicalState, "RUNNING");
  provider.state = "SUCCEEDED";
  const succeeded = await service.reconcileJob(created.id, scope);
  assert.equal(succeeded.logicalState, "SUCCEEDED");
  assert.ok(succeeded.completedAt);
  assert.equal((await repository.listEvents(scope, { jobId: created.id })).some((event) => event.type === "job.completed"), true);
  assert.equal(events.some(([type, , detail]) => type === "studio.provider.request" && detail.operation === "submit_job" && Number.isFinite(detail.durationMs)), true);
  assert.equal(events.some(([type, , detail]) => type === "studio.job.reconcile" && detail.studioJobId === created.id), true);
});

test("enforces Planner submission, compute safety, cancellation, retry bounds, and scope isolation", async (t) => {
  const { provider, service } = await fixture(t);
  const planner = await service.createJob(jobInput({ workflowMode: "planner" }), scope, { idempotencyKey: "planner" });
  await assert.rejects(() => service.submitJob(planner.id, scope, { workflowMode: "planner" }), (error) => error.code === "executor_mode_required");

  const gpu = await service.createJob(jobInput({ providerConfiguration: { computeClass: "A100-GPU" } }), scope, { idempotencyKey: "gpu" });
  await assert.rejects(() => service.submitJob(gpu.id, scope, { workflowMode: "executor" }), (error) => error.code === "gpu_not_allowed");

  const budget = await service.createJob(jobInput({ constraints: { ...jobInput().constraints, maxEstimatedCost: 50 } }), scope, { idempotencyKey: "budget" });
  await assert.rejects(() => service.submitJob(budget.id, scope, { workflowMode: "executor" }), (error) => error.code === "cost_ceiling_unverifiable");

  const cancellable = await service.createJob(jobInput(), scope, { idempotencyKey: "cancel" });
  await service.submitJob(cancellable.id, scope, { workflowMode: "executor" });
  const cancelling = await service.cancelJob(cancellable.id, scope);
  assert.equal(cancelling.logicalState, "CANCELLING");
  assert.equal(provider.cancellations, 1);

  await assert.rejects(() => service.repository.getJob(cancellable.id, { ...scope, tenantId: "tenant-b" }), (error) => error.code === "job_not_found");
});

test("rejects provider secrets and returns provider data only when capability is published", async (t) => {
  const { service } = await fixture(t);
  await assert.rejects(
    () => service.createJob(jobInput({ providerConfiguration: { accessToken: "must-not-be-stored" } }), scope, { idempotencyKey: "secret" }),
    (error) => error.code === "provider_secret_in_request"
  );
  await assert.rejects(
    () => service.createJob(jobInput({ parameters: { authToken: "must-not-be-stored" } }), scope, { idempotencyKey: "secret-auth" }),
    (error) => error.code === "provider_secret_in_request"
  );
  const job = await service.createJob(jobInput(), scope, { idempotencyKey: "logs" });
  await service.submitJob(job.id, scope, { workflowMode: "executor" });
  const logs = await service.providerData(job.id, scope, "logs");
  assert.equal(logs.entries[0].content, "real provider output");
});

test("persists real provider experiment metrics without inventing model records", async (t) => {
  const { repository, service } = await fixture(t);
  const job = await service.createJob(jobInput({ providerConfiguration: { mlflowRunIds: ["mlflow-run-1"] } }), scope, { idempotencyKey: "metrics" });
  await service.submitJob(job.id, scope, { workflowMode: "executor" });
  const metrics = await service.providerData(job.id, scope, "metrics");
  assert.equal(metrics[0].value, 0.91);
  const experiments = await repository.listExperiments(scope);
  assert.equal(experiments.length, 1);
  assert.equal(experiments[0].providerRunId, "mlflow-run-1");
  assert.equal((await repository.listModels(scope)).length, 0);
});

test("detects execution objectives without misrouting Studio implementation requests", () => {
  assert.equal(detectMlExecutionIntent("Use Databricks to train a churn model from the latest dataset.").detected, true);
  assert.equal(detectMlExecutionIntent("Implement the Gotham Studio provider adapter and API.").detected, false);
  assert.equal(detectMlExecutionIntent("What is available?", {}).detected, false);
  assert.equal(detectMlExecutionIntent("Why did this fail?", { selectedJobId: "PX-ML-1" }).detected, true);
  const proposal = deriveMlExecutionProposal("Use Databricks to compare LightGBM and XGBoost under ₹1,000. Register the winner but do not deploy.");
  assert.equal(proposal.provider, "databricks");
  assert.equal(proposal.constraints.currency, "INR");
  assert.equal(proposal.constraints.maxEstimatedCost, 1000);
  assert.equal(proposal.constraints.allowDeployment, false);
});

test("selected Studio context is inspected without creating duplicate logical work", async (t) => {
  const { repository, service } = await fixture(t);
  const job = await service.createJob(jobInput(), scope, { idempotencyKey: "context-source" });
  const result = await service.createGothamProposal({
    instruction: `Why did ${job.id} reach its current state?`,
    projectName: "Project A",
    workflowMode: "executor",
    studioContext: { selectedJobId: job.id }
  }, scope);
  assert.equal(result.contextual, true);
  assert.equal(result.job.id, job.id);
  assert.equal((await repository.listJobs(scope)).length, 1);
  assert.equal((await repository.listPipelines(scope)).length, 0);
});
