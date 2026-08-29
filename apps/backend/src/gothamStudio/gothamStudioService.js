import {
  ACTIVE_STUDIO_JOB_STATES,
  GothamStudioError,
  assertNoProviderSecrets,
  assertStudioStateTransition,
  isActiveStudioState,
  isTerminalStudioState,
  publicStudioRecord,
  sanitizeProviderText,
  studioJobInputSchema,
  studioPipelineInputSchema
} from "./domain.js";
import { deriveMlExecutionProposal } from "./gothamStudioIntent.js";

function now() {
  return new Date().toISOString();
}

function executionRef(job) {
  return {
    providerJobId: job.providerJobId,
    providerRunId: job.providerRunId,
    experimentRunIds: (job.experimentReferences || []).map((item) => item.providerRunId || item.runId).filter(Boolean)
  };
}

function errorRecord(error) {
  return {
    code: String(error?.code || "provider_failure").slice(0, 160),
    summary: sanitizeProviderText(error?.message || "Provider operation failed."),
    retryable: Boolean(error?.retryable),
    occurredAt: now()
  };
}

function eventMessage(type, job, extra = {}) {
  const provider = job.provider === "azure-ml" ? "Azure ML" : job.provider === "databricks" ? "Databricks" : job.provider;
  return {
    "job.created": `Gotham Studio created logical job ${job.id}.`,
    "job.submitted": `Gotham Studio submitted ${job.id} to ${provider}.`,
    "job.started": `${job.id} entered RUNNING on ${provider}.`,
    "job.progress": `${job.id} changed to ${extra.logicalState || job.logicalState}.`,
    "job.failed": `${job.id} failed on ${provider}.`,
    "job.cancel.requested": `Cancellation was requested for ${job.id}.`,
    "job.cancelled": `${job.id} was cancelled.`,
    "job.completed": `${job.id} completed successfully.`,
    "job.retry": `${job.id} was created as a bounded retry.`,
    "job.reconcile": `${job.id} was reconciled with ${provider}.`
  }[type] || `${job.id}: ${type}`;
}

export class GothamStudioService {
  constructor({ repository, providerRegistry, emit = () => {}, reconciliationIntervalMs = 30_000, maxReconciliationsPerCycle = 50 } = {}) {
    if (!repository || !providerRegistry) throw new Error("Gotham Studio service requires repository and provider registry.");
    this.repository = repository;
    this.providerRegistry = providerRegistry;
    this.emit = emit;
    this.reconciliationIntervalMs = Math.max(10_000, Math.min(Number(reconciliationIntervalMs) || 30_000, 15 * 60_000));
    this.maxReconciliationsPerCycle = Math.max(1, Math.min(Number(maxReconciliationsPerCycle) || 50, 500));
    this.reconciler = null;
    this.reconcileRunning = false;
  }

  async recordEvent(type, job, scope, extra = {}) {
    const event = await this.repository.appendEvent({
      type,
      jobId: job.id,
      pipelineId: job.pipelineId || "",
      functionalityId: job.functionalityId || "",
      logicalState: extra.logicalState || job.logicalState,
      provider: job.provider,
      providerRunId: job.providerRunId || "",
      message: eventMessage(type, job, extra),
      detail: extra.detail || null
    }, scope);
    this.emit(`studio.${type}`, event.message, {
      projectId: job.projectId,
      workspaceId: job.workspaceId,
      studioJobId: job.id,
      studioPipelineId: job.pipelineId || "",
      functionalityId: job.functionalityId || "",
      provider: job.provider,
      logicalState: event.logicalState,
      status: event.logicalState
    });
    return event;
  }

  async providerCall(provider, operation, scope, context, action) {
    const startedAt = Date.now();
    try {
      const result = await action();
      this.emit("studio.provider.request", `${provider.label} ${operation} completed.`, {
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        provider: provider.id,
        operation,
        durationMs: Date.now() - startedAt,
        status: "succeeded",
        ...context
      });
      return result;
    } catch (error) {
      const detail = errorRecord(error);
      const metadata = {
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        provider: provider.id,
        operation,
        durationMs: Date.now() - startedAt,
        status: "failed",
        error: detail,
        ...context
      };
      this.emit("studio.provider.request", `${provider.label} ${operation} failed.`, metadata);
      this.emit("studio.provider.failure", `${provider.label} ${operation} failed.`, metadata);
      throw error;
    }
  }

  async providers(scope) {
    const checks = await this.repository.listProviderChecks(scope);
    const checkById = new Map(checks.map((item) => [item.providerId, item]));
    return this.providerRegistry.list().map((provider) => ({ ...provider, lastVerification: checkById.get(provider.id) || null }));
  }

  async verifyProvider(providerId, scope) {
    const provider = this.providerRegistry.get(providerId);
    let check;
    let providerCallFailed = false;
    try {
      check = await this.providerCall(provider, "validate_connection", scope, {}, () => provider.validateConnection());
    } catch (error) {
      providerCallFailed = true;
      check = { status: "error", connected: false, checkedAt: now(), error: errorRecord(error) };
    }
    const record = await this.repository.recordProviderCheck(provider.id, check, scope);
    if (check.connected) {
      this.emit("studio.provider.verified", `${provider.label} connection verified.`, {
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        provider: provider.id,
        status: check.status
      });
    } else if (!providerCallFailed) {
      this.emit("studio.provider.failure", `${provider.label} connection failed verification.`, {
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        provider: provider.id,
        operation: "validate_connection",
        status: check.status
      });
    }
    return record;
  }

  async createPipeline(input, scope) {
    const parsed = studioPipelineInputSchema.parse(input);
    assertNoProviderSecrets(parsed.providerConfiguration);
    if (parsed.projectId !== scope.projectId || parsed.workspaceId !== scope.workspaceId) {
      throw new GothamStudioError("Pipeline scope does not match the authorized project.", { code: "studio_scope_mismatch", status: 404 });
    }
    const pipeline = await this.repository.createPipeline(parsed, scope);
    this.emit("studio.pipeline.created", `Gotham Studio created pipeline ${pipeline.id}.`, {
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      studioPipelineId: pipeline.id,
      functionalityId: pipeline.functionalityId || ""
    });
    return pipeline;
  }

  async validateSubmissionPolicy(job, provider) {
    const constraints = job.constraints || {};
    if (constraints.allowedProviders?.length && !constraints.allowedProviders.includes(job.provider)) {
      throw new GothamStudioError("The selected provider is outside the job's allowed provider policy.", { code: "provider_not_allowed", status: 409 });
    }
    const pipeline = job.pipelineId ? await this.repository.getPipeline(job.pipelineId, {
      tenantId: job.__scope.tenantId,
      workspaceId: job.workspaceId,
      projectId: job.projectId
    }) : null;
    if (!constraints.allowDeployment && pipeline?.stages?.some((stage) => /deploy/i.test(`${stage.type} ${stage.name || ""}`))) {
      throw new GothamStudioError("Automatic deployment is disabled by this job's execution policy.", { code: "deployment_not_allowed", status: 409 });
    }
    const computeClass = String(job.providerConfiguration?.computeClass || "");
    if (!constraints.allowGpu && /gpu|cuda|a\d{2,3}|h\d{2,3}/i.test(computeClass)) {
      throw new GothamStudioError("GPU execution is disabled by this job's execution policy.", { code: "gpu_not_allowed", status: 409 });
    }
    if (constraints.allowedComputeClasses?.length && computeClass && !constraints.allowedComputeClasses.includes(computeClass)) {
      throw new GothamStudioError("The requested compute class is outside the job policy.", { code: "compute_class_not_allowed", status: 409 });
    }
    if (constraints.maxEstimatedCost !== undefined && constraints.maxEstimatedCost !== null) {
      const capabilities = provider.capabilities();
      if (!capabilities.costEstimate && !job.providerConfiguration?.budgetPolicyId && !job.providerConfiguration?.costControlReference) {
        throw new GothamStudioError("This provider cannot verify the requested cost ceiling. Attach a provider budget policy before submission.", {
          code: "cost_ceiling_unverifiable",
          status: 409
        });
      }
      if (capabilities.costEstimate && typeof provider.estimateCost === "function") {
        const estimate = await this.providerCall(provider, "estimate_cost", job.__scope, { studioJobId: job.id }, () => provider.estimateCost(job));
        if (estimate?.amount > constraints.maxEstimatedCost || (estimate?.currency && estimate.currency !== constraints.currency)) {
          throw new GothamStudioError("The provider estimate exceeds the authorized compute budget.", { code: "compute_budget_exceeded", status: 409 });
        }
        return estimate;
      }
    }
    return null;
  }

  async createJob(input, scope, { idempotencyKey = "", actor = null } = {}) {
    const parsed = studioJobInputSchema.parse(input);
    assertNoProviderSecrets(parsed.parameters, "parameters");
    assertNoProviderSecrets(parsed.providerConfiguration);
    if (parsed.projectId !== scope.projectId || parsed.workspaceId !== scope.workspaceId) {
      throw new GothamStudioError("Job scope does not match the authorized project.", { code: "studio_scope_mismatch", status: 404 });
    }
    if (parsed.pipelineId) await this.repository.getPipeline(parsed.pipelineId, scope);
    const existing = await this.repository.findJobByIdempotencyKey(idempotencyKey, scope);
    if (existing) return existing;
    const job = await this.repository.createJob(parsed, scope, { idempotencyKey, triggeredBy: actor });
    await this.recordEvent("job.created", job, scope);
    return parsed.submit ? this.submitJob(job.id, scope, { workflowMode: parsed.workflowMode }) : job;
  }

  async submitJob(jobId, scope, { workflowMode = "executor" } = {}) {
    if (workflowMode !== "executor") {
      throw new GothamStudioError("Only Gotham Executor mode may submit physical ML execution.", { code: "executor_mode_required", status: 409 });
    }
    let job = await this.repository.getJob(jobId, scope);
    if (job.logicalState !== "DRAFT") {
      if (job.providerRunId && isActiveStudioState(job.logicalState)) return job;
      throw new GothamStudioError("Only a draft logical job can be submitted.", { code: "job_not_submittable", status: 409 });
    }
    const provider = this.providerRegistry.get(job.provider);
    if (!provider.capabilities().submitJob) throw new GothamStudioError(`${provider.label} is not configured for submission.`, { code: "provider_not_configured", status: 409 });
    job.__scope = scope;
    let estimate = null;
    try {
      estimate = await this.validateSubmissionPolicy(job, provider);
      const reference = await this.providerCall(provider, "submit_job", scope, { studioJobId: job.id }, () => provider.submitJob(job));
      job = await this.repository.updateJob(job.id, scope, {
        ...reference,
        logicalState: "SUBMITTED",
        providerState: reference.providerState || "SUBMITTED",
        submittedAt: now(),
        estimatedCost: estimate?.amount ?? null,
        costCurrency: estimate?.currency || job.costCurrency
      });
      await this.recordEvent("job.submitted", job, scope);
      return job;
    } catch (error) {
      job = await this.repository.updateJob(job.id, scope, { logicalState: "FAILED", completedAt: now(), error: errorRecord(error) });
      await this.recordEvent("job.failed", job, scope, { detail: job.error });
      throw error;
    }
  }

  async reconcileJob(jobId, scope) {
    let job = await this.repository.getJob(jobId, scope);
    if (!job.providerRunId || !isActiveStudioState(job.logicalState)) return job;
    const provider = this.providerRegistry.get(job.provider);
    const providerState = await this.providerCall(provider, "get_job", scope, { studioJobId: job.id }, () => provider.getJob(executionRef(job)));
    let logicalState = providerState.logicalState || "UNKNOWN";
    try { assertStudioStateTransition(job.logicalState, logicalState); } catch { logicalState = job.logicalState; }
    const patch = {
      ...providerState,
      logicalState,
      startedAt: job.startedAt || providerState.startedAt || (logicalState === "RUNNING" ? now() : ""),
      completedAt: providerState.completedAt || (isTerminalStudioState(logicalState) ? now() : job.completedAt),
      providerUrl: providerState.providerUrl || job.providerUrl,
      error: providerState.error || (logicalState === "FAILED" ? job.error : null)
    };
    const previous = job.logicalState;
    job = await this.repository.updateJob(job.id, scope, patch);
    this.emit("studio.job.reconcile", `Gotham Studio reconciled ${job.id} with ${provider.label}.`, {
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      studioJobId: job.id,
      studioPipelineId: job.pipelineId || "",
      functionalityId: job.functionalityId || "",
      provider: job.provider,
      previousLogicalState: previous,
      logicalState,
      stateChanged: logicalState !== previous,
      status: logicalState
    });
    if (logicalState !== previous) {
      const type = logicalState === "RUNNING" ? "job.started"
        : logicalState === "SUCCEEDED" ? "job.completed"
          : logicalState === "FAILED" ? "job.failed"
            : logicalState === "CANCELLED" ? "job.cancelled"
              : "job.progress";
      await this.recordEvent(type, job, scope, { logicalState, detail: job.error });
    }
    return job;
  }

  async cancelJob(jobId, scope) {
    let job = await this.repository.getJob(jobId, scope);
    if (job.logicalState === "DRAFT") {
      job = await this.repository.updateJob(job.id, scope, { logicalState: "CANCELLED", completedAt: now() });
      await this.recordEvent("job.cancelled", job, scope);
      return job;
    }
    if (!isActiveStudioState(job.logicalState) || job.logicalState === "CANCELLING") return job;
    const provider = this.providerRegistry.get(job.provider);
    if (!provider.capabilities().cancelJob || typeof provider.cancelJob !== "function") {
      throw new GothamStudioError(`${provider.label} does not support cancellation for this job.`, { code: "provider_capability_unsupported", status: 409 });
    }
    job = await this.repository.updateJob(job.id, scope, { logicalState: "CANCELLING" });
    await this.recordEvent("job.cancel.requested", job, scope);
    try {
      await this.providerCall(provider, "cancel_job", scope, { studioJobId: job.id }, () => provider.cancelJob(executionRef(job)));
      return job;
    } catch (error) {
      await this.repository.updateJob(job.id, scope, { logicalState: "UNKNOWN", error: errorRecord(error) });
      throw error;
    }
  }

  async retryJob(jobId, scope, { workflowMode = "executor", idempotencyKey = "", actor = null, submit = true } = {}) {
    const original = await this.repository.getJob(jobId, scope);
    if (!isTerminalStudioState(original.logicalState) || original.logicalState === "SUCCEEDED") {
      throw new GothamStudioError("Only failed or cancelled jobs can be retried.", { code: "job_not_retryable", status: 409 });
    }
    const nextAttempt = Number(original.retry?.attempt || 1) + 1;
    if (nextAttempt > Number(original.constraints?.maxRuns || 1)) {
      throw new GothamStudioError("The retry would exceed this job's maximum run count.", { code: "max_runs_exceeded", status: 409 });
    }
    const retried = await this.repository.createJob({
      ...original,
      retryOfJobId: original.id,
      retryAttempt: nextAttempt,
      triggerSource: "retry",
      workflowMode,
      submit: false
    }, scope, { idempotencyKey, triggeredBy: actor });
    await this.repository.updateJob(original.id, scope, { retry: { ...original.retry, retriedByJobId: retried.id } });
    await this.recordEvent("job.retry", retried, scope);
    return submit ? this.submitJob(retried.id, scope, { workflowMode }) : retried;
  }

  async providerData(jobId, scope, kind) {
    const job = await this.repository.getJob(jobId, scope);
    const provider = this.providerRegistry.get(job.provider);
    const capabilities = provider.capabilities();
    const capability = { logs: "pollLogs", metrics: "metrics", artifacts: "artifacts" }[kind];
    const method = { logs: "getLogs", metrics: "getMetrics", artifacts: "getArtifacts" }[kind];
    if (!capabilities[capability] || typeof provider[method] !== "function") {
      throw new GothamStudioError(`${provider.label} does not expose ${kind} through this adapter.`, { code: "provider_capability_unsupported", status: 409 });
    }
    const result = await this.providerCall(provider, `get_${kind}`, scope, { studioJobId: job.id }, () => provider[method](executionRef(job)));
    if (kind === "metrics" && Array.isArray(result)) {
      const metricsByRun = new Map();
      for (const metric of result) {
        const providerRunId = String(metric.experimentRunId || "").trim();
        if (!providerRunId) continue;
        const metrics = metricsByRun.get(providerRunId) || [];
        metrics.push(metric);
        metricsByRun.set(providerRunId, metrics);
      }
      await Promise.all([...metricsByRun].map(([providerRunId, metrics]) => this.repository.upsertExperiment({
        provider: job.provider,
        providerRunId,
        jobId: job.id,
        pipelineId: job.pipelineId,
        name: `MLflow run ${providerRunId}`,
        metrics,
        status: isTerminalStudioState(job.logicalState) ? job.logicalState.toLowerCase() : "running"
      }, scope)));
    }
    return result;
  }

  async overview(scope) {
    const [jobs, pipelines, experiments, models, providers] = await Promise.all([
      this.repository.listJobs(scope),
      this.repository.listPipelines(scope),
      this.repository.listExperiments(scope),
      this.repository.listModels(scope),
      this.providers(scope)
    ]);
    const totals = Object.fromEntries(["RUNNING", "SUCCEEDED", "FAILED", "QUEUED", "DRAFT", "CANCELLED"].map((state) => [state.toLowerCase(), jobs.filter((job) => job.logicalState === state).length]));
    const consumed = jobs.reduce((summary, job) => {
      if (Number.isFinite(job.computeDurationSeconds)) summary.computeDurationSeconds += job.computeDurationSeconds;
      if (Number.isFinite(job.actualCost)) {
        const currency = job.costCurrency || "UNKNOWN";
        summary.actualCostByCurrency[currency] = (summary.actualCostByCurrency[currency] || 0) + job.actualCost;
      }
      return summary;
    }, { computeDurationSeconds: 0, actualCostByCurrency: {} });
    return {
      totals,
      activeJobs: jobs.filter((job) => isActiveStudioState(job.logicalState)).slice(0, 20),
      attentionJobs: jobs.filter((job) => job.logicalState === "FAILED" || job.logicalState === "UNKNOWN").slice(0, 20),
      recentCompleted: jobs.filter((job) => job.logicalState === "SUCCEEDED").slice(0, 10),
      pipelines,
      bestExperiment: experiments.find((experiment) => experiment.isBest) || null,
      bestModel: models.find((model) => model.isBest || model.stage === "Production") || null,
      consumed,
      providers
    };
  }

  async createGothamProposal({ instruction, projectName = "Project", workflowMode = "executor", functionalityId = "", studioContext = null }, scope, actor = null) {
    const proposal = deriveMlExecutionProposal(instruction);
    const selectedJobId = String(studioContext?.selectedJobId || "").trim();
    const selectedPipelineId = String(studioContext?.selectedPipelineId || "").trim();
    const selectedExperimentId = String(studioContext?.selectedExperimentId || "").trim();
    const selectedModelId = String(studioContext?.selectedModelId || "").trim();
    if (selectedJobId || selectedPipelineId || selectedExperimentId || selectedModelId) {
      const job = selectedJobId ? await this.repository.getJob(selectedJobId, scope) : null;
      const pipelineId = selectedPipelineId || job?.pipelineId || "";
      const pipeline = pipelineId ? await this.repository.getPipeline(pipelineId, scope) : null;
      const experiments = selectedExperimentId ? await this.repository.listExperiments(scope) : [];
      const models = selectedModelId ? await this.repository.listModels(scope) : [];
      const experiment = selectedExperimentId ? experiments.find((item) => item.id === selectedExperimentId) : null;
      const model = selectedModelId ? models.find((item) => item.id === selectedModelId) : null;
      if (selectedExperimentId && !experiment) throw new GothamStudioError("Experiment not found.", { code: "experiment_not_found", status: 404 });
      if (selectedModelId && !model) throw new GothamStudioError("Model not found.", { code: "model_not_found", status: 404 });
      return {
        proposal,
        pipeline,
        job,
        experiment,
        model,
        submitted: false,
        contextual: true
      };
    }
    if (workflowMode !== "executor") return { proposal, pipeline: null, job: null, submitted: false };
    const provider = proposal.provider || this.providerRegistry.list().find((item) => item.configured)?.id || "databricks";
    const pipeline = await this.createPipeline({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      name: proposal.pipeline.name || `${projectName} ML pipeline`,
      objective: proposal.objective,
      providerPreference: provider,
      functionalityId,
      stages: proposal.pipeline.stages,
      providerConfiguration: {}
    }, scope);
    const job = await this.createJob({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      pipelineId: pipeline.id,
      functionalityId,
      name: proposal.pipeline.name,
      objective: proposal.objective,
      provider,
      parameters: {},
      providerConfiguration: {},
      constraints: proposal.constraints,
      workflowMode,
      submit: false,
      triggerSource: "gotham"
    }, scope, { idempotencyKey: `gotham-proposal:${scope.projectId}:${Buffer.from(instruction).toString("base64url").slice(0, 120)}`, actor });
    return { proposal, pipeline, job, submitted: false };
  }

  async reconcileCycle() {
    if (this.reconcileRunning) return;
    this.reconcileRunning = true;
    try {
      const rows = await this.repository.listActiveJobScopes([...ACTIVE_STUDIO_JOB_STATES]);
      for (const row of rows.slice(0, this.maxReconciliationsPerCycle)) {
        const reconcile = () => this.reconcileJob(row.jobId, row);
        if (typeof this.repository.withJobLease === "function") {
          await this.repository.withJobLease(row.jobId, row, reconcile).catch(() => {});
        } else {
          await reconcile().catch(() => {});
        }
      }
    } finally {
      this.reconcileRunning = false;
    }
  }

  startReconciler() {
    if (this.reconciler) return;
    this.reconciler = setInterval(() => this.reconcileCycle().catch(() => {}), this.reconciliationIntervalMs);
    this.reconciler.unref?.();
  }

  stopReconciler() {
    if (this.reconciler) clearInterval(this.reconciler);
    this.reconciler = null;
  }
}

export function publicGothamStudioError(error) {
  return {
    status: "failed",
    code: String(error?.code || "gotham_studio_error").slice(0, 160),
    error: error instanceof GothamStudioError ? error.message : "Gotham Studio could not complete the request.",
    retryable: Boolean(error?.retryable),
    details: error?.details ? publicStudioRecord(error.details) : undefined
  };
}
