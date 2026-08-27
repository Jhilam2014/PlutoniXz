import fs from "node:fs/promises";
import path from "node:path";
import { GothamStudioError, publicStudioRecord, studioId, studioScopeKey } from "./domain.js";

const EMPTY_STATE = Object.freeze({
  version: 1,
  pipelines: [],
  jobs: [],
  experiments: [],
  models: [],
  providerChecks: [],
  events: []
});

function scoped(record, scope) {
  return record.tenantId === scope.tenantId
    && record.workspaceId === scope.workspaceId
    && record.projectId === scope.projectId;
}

function byNewest(left, right) {
  return new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime();
}

export class GothamStudioRepository {
  constructor({ filePath } = {}) {
    if (!filePath) throw new Error("Gotham Studio repository requires a file path.");
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async readState() {
    try {
      const state = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      return {
        ...EMPTY_STATE,
        ...state,
        pipelines: Array.isArray(state.pipelines) ? state.pipelines : [],
        jobs: Array.isArray(state.jobs) ? state.jobs : [],
        experiments: Array.isArray(state.experiments) ? state.experiments : [],
        models: Array.isArray(state.models) ? state.models : [],
        providerChecks: Array.isArray(state.providerChecks) ? state.providerChecks : [],
        events: Array.isArray(state.events) ? state.events : []
      };
    } catch (error) {
      if (error.code === "ENOENT") return structuredClone(EMPTY_STATE);
      throw new GothamStudioError("Gotham Studio state could not be read.", { code: "studio_state_unavailable", status: 503 });
    }
  }

  async writeState(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
  }

  async mutate(mutator) {
    const operation = this.writeQueue.catch(() => {}).then(async () => {
      const state = await this.readState();
      const result = await mutator(state);
      await this.writeState(state);
      return result;
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async listPipelines(scope) {
    studioScopeKey(scope);
    return (await this.readState()).pipelines.filter((item) => scoped(item, scope)).sort(byNewest).map(publicStudioRecord);
  }

  async getPipeline(id, scope) {
    studioScopeKey(scope);
    const record = (await this.readState()).pipelines.find((item) => item.id === id && scoped(item, scope));
    if (!record) throw new GothamStudioError("Pipeline not found.", { code: "pipeline_not_found", status: 404 });
    return publicStudioRecord(record);
  }

  async createPipeline(input, scope) {
    studioScopeKey(scope);
    return this.mutate(async (state) => {
      const now = new Date().toISOString();
      const versions = state.pipelines.filter((item) => scoped(item, scope) && item.name.toLowerCase() === input.name.toLowerCase());
      const pipeline = {
        id: studioId("PX-PIPELINE"),
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        name: input.name,
        version: Math.max(0, ...versions.map((item) => Number(item.version || 0))) + 1,
        objective: input.objective,
        providerPreference: input.providerPreference || "",
        functionalityId: input.functionalityId || "",
        stages: input.stages,
        providerConfiguration: input.providerConfiguration || {},
        createdAt: now,
        updatedAt: now
      };
      state.pipelines.push(pipeline);
      return publicStudioRecord(pipeline);
    });
  }

  async listJobs(scope, { states = [], limit = 200 } = {}) {
    studioScopeKey(scope);
    const stateSet = new Set(states.map((item) => String(item).toUpperCase()));
    return (await this.readState()).jobs
      .filter((item) => scoped(item, scope) && (!stateSet.size || stateSet.has(item.logicalState)))
      .sort(byNewest)
      .slice(0, Math.max(1, Math.min(Number(limit) || 200, 500)))
      .map(publicStudioRecord);
  }

  async listActiveJobScopes(states = []) {
    const stateSet = new Set(states.map((item) => String(item).toUpperCase()));
    return (await this.readState()).jobs
      .filter((item) => !stateSet.size || stateSet.has(item.logicalState))
      .map((item) => ({
        jobId: item.id,
        tenantId: item.tenantId,
        workspaceId: item.workspaceId,
        projectId: item.projectId,
        updatedAt: item.updatedAt
      }));
  }

  async getJob(id, scope) {
    studioScopeKey(scope);
    const record = (await this.readState()).jobs.find((item) => item.id === id && scoped(item, scope));
    if (!record) throw new GothamStudioError("Job not found.", { code: "job_not_found", status: 404 });
    return publicStudioRecord(record);
  }

  async findJobByIdempotencyKey(key, scope) {
    if (!key) return null;
    studioScopeKey(scope);
    const record = (await this.readState()).jobs.find((item) => item.idempotencyKey === key && scoped(item, scope));
    return record ? publicStudioRecord(record) : null;
  }

  async createJob(input, scope, { idempotencyKey = "", triggeredBy = null } = {}) {
    studioScopeKey(scope);
    return this.mutate(async (state) => {
      if (idempotencyKey) {
        const existing = state.jobs.find((item) => item.idempotencyKey === idempotencyKey && scoped(item, scope));
        if (existing) return publicStudioRecord(existing);
      }
      const now = new Date().toISOString();
      const job = {
        id: studioId("PX-ML"),
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        pipelineId: input.pipelineId || "",
        functionalityId: input.functionalityId || "",
        name: input.name,
        objective: input.objective,
        provider: input.provider,
        providerJobId: "",
        providerRunId: "",
        providerUrl: "",
        logicalState: "DRAFT",
        providerState: "",
        providerStatusMessage: "",
        currentStage: "",
        progress: null,
        parameters: input.parameters || {},
        providerConfiguration: input.providerConfiguration || {},
        constraints: input.constraints,
        estimatedCost: null,
        actualCost: null,
        costCurrency: input.constraints.currency,
        computeDurationSeconds: null,
        resourceType: input.providerConfiguration?.computeClass || "",
        error: null,
        retry: {
          retryOfJobId: input.retryOfJobId || "",
          attempt: Number(input.retryAttempt || 1),
          retriedByJobId: ""
        },
        experimentReferences: Array.isArray(input.providerConfiguration?.mlflowRunIds)
          ? input.providerConfiguration.mlflowRunIds.slice(0, 20).map((providerRunId) => ({ providerRunId: String(providerRunId) }))
          : [],
        modelReferences: [],
        artifactReferences: [],
        triggeredBy: triggeredBy || { type: "user", id: "", name: "" },
        triggerSource: input.triggerSource,
        workflowMode: input.workflowMode,
        idempotencyKey,
        createdAt: now,
        submittedAt: "",
        startedAt: "",
        completedAt: "",
        updatedAt: now
      };
      state.jobs.push(job);
      return publicStudioRecord(job);
    });
  }

  async updateJob(id, scope, updater) {
    studioScopeKey(scope);
    return this.mutate(async (state) => {
      const index = state.jobs.findIndex((item) => item.id === id && scoped(item, scope));
      if (index < 0) throw new GothamStudioError("Job not found.", { code: "job_not_found", status: 404 });
      const current = state.jobs[index];
      const patch = typeof updater === "function" ? await updater(publicStudioRecord(current)) : updater;
      state.jobs[index] = { ...current, ...(patch || {}), updatedAt: new Date().toISOString() };
      return publicStudioRecord(state.jobs[index]);
    });
  }

  async appendEvent(event, scope) {
    studioScopeKey(scope);
    return this.mutate(async (state) => {
      const record = {
        id: studioId("PX-EVENT"),
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        ...event,
        createdAt: event.createdAt || new Date().toISOString()
      };
      state.events.push(record);
      if (state.events.length > 10_000) state.events.splice(0, state.events.length - 10_000);
      return publicStudioRecord(record);
    });
  }

  async listEvents(scope, { jobId = "", limit = 300 } = {}) {
    studioScopeKey(scope);
    return (await this.readState()).events
      .filter((item) => scoped(item, scope) && (!jobId || item.jobId === jobId))
      .sort(byNewest)
      .slice(0, Math.max(1, Math.min(Number(limit) || 300, 1_000)))
      .map(publicStudioRecord);
  }

  async recordProviderCheck(providerId, check, scope) {
    studioScopeKey(scope);
    return this.mutate(async (state) => {
      const now = new Date().toISOString();
      const index = state.providerChecks.findIndex((item) => item.providerId === providerId && scoped(item, scope));
      const record = {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        providerId,
        ...check,
        checkedAt: check.checkedAt || now,
        updatedAt: now
      };
      if (index >= 0) state.providerChecks[index] = { ...state.providerChecks[index], ...record };
      else state.providerChecks.push(record);
      return publicStudioRecord(record);
    });
  }

  async listProviderChecks(scope) {
    studioScopeKey(scope);
    return (await this.readState()).providerChecks.filter((item) => scoped(item, scope)).map(publicStudioRecord);
  }

  async listExperiments(scope) {
    studioScopeKey(scope);
    return (await this.readState()).experiments.filter((item) => scoped(item, scope)).sort(byNewest).map(publicStudioRecord);
  }

  async upsertExperiment(input, scope) {
    studioScopeKey(scope);
    return this.mutate(async (state) => {
      const now = new Date().toISOString();
      const index = state.experiments.findIndex((item) => scoped(item, scope)
        && item.provider === input.provider
        && item.providerRunId === input.providerRunId);
      const current = index >= 0 ? state.experiments[index] : null;
      const experiment = {
        ...(current || {}),
        id: current?.id || studioId("PX-EXP"),
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        pipelineId: input.pipelineId || current?.pipelineId || "",
        jobId: input.jobId || current?.jobId || "",
        provider: input.provider,
        providerRunId: input.providerRunId,
        name: input.name || current?.name || `Experiment ${input.providerRunId}`,
        metrics: Array.isArray(input.metrics) ? input.metrics.slice(0, 500) : current?.metrics || [],
        primaryMetric: input.primaryMetric || current?.primaryMetric || null,
        status: input.status || current?.status || "recorded",
        isBest: input.isBest === true,
        createdAt: current?.createdAt || now,
        updatedAt: now
      };
      if (index >= 0) state.experiments[index] = experiment;
      else state.experiments.push(experiment);
      return publicStudioRecord(experiment);
    });
  }

  async listModels(scope) {
    studioScopeKey(scope);
    return (await this.readState()).models.filter((item) => scoped(item, scope)).sort(byNewest).map(publicStudioRecord);
  }

  async upsertModel(input, scope) {
    studioScopeKey(scope);
    return this.mutate(async (state) => {
      const now = new Date().toISOString();
      const index = state.models.findIndex((item) => scoped(item, scope)
        && item.provider === input.provider
        && item.providerModelId === input.providerModelId
        && String(item.version || "") === String(input.version || ""));
      const current = index >= 0 ? state.models[index] : null;
      const model = {
        ...(current || {}),
        id: current?.id || studioId("PX-MODEL"),
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        pipelineId: input.pipelineId || current?.pipelineId || "",
        jobId: input.jobId || current?.jobId || "",
        experimentId: input.experimentId || current?.experimentId || "",
        provider: input.provider,
        providerModelId: input.providerModelId,
        name: input.name || current?.name || input.providerModelId,
        version: String(input.version || current?.version || ""),
        stage: input.stage || current?.stage || "Unassigned",
        metrics: Array.isArray(input.metrics) ? input.metrics.slice(0, 500) : current?.metrics || [],
        isBest: input.isBest === true,
        createdAt: current?.createdAt || now,
        updatedAt: now
      };
      if (index >= 0) state.models[index] = model;
      else state.models.push(model);
      return publicStudioRecord(model);
    });
  }
}
