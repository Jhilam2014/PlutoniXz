import { MLExecutionProvider, ProviderExecutionError } from "../executionProvider.js";
import { DatabricksClient, safeDatabricksWorkspace } from "./databricksClient.js";
import { normalizeDatabricksState } from "./databricksNormalizer.js";

export class DatabricksExecutionProvider extends MLExecutionProvider {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, client } = {}) {
    super({ id: "databricks", label: "Databricks", env });
    this.client = client || new DatabricksClient({
      host: env.DATABRICKS_HOST,
      token: env.DATABRICKS_TOKEN,
      apiVersion: env.DATABRICKS_JOBS_API_VERSION || "2.2",
      timeoutMs: env.GOTHAM_STUDIO_PROVIDER_TIMEOUT_MS,
      retries: env.GOTHAM_STUDIO_PROVIDER_RETRIES,
      fetchImpl
    });
  }

  configurationStatus() {
    const configured = this.client.configured();
    return {
      configured,
      status: configured ? "configured" : "not_configured",
      metadata: {
        workspace: safeDatabricksWorkspace(this.env.DATABRICKS_HOST) || "",
        authenticationMode: this.env.DATABRICKS_AUTH_MODE || (configured ? "backend_token" : "not_configured"),
        apiVersion: this.client.apiVersion
      }
    };
  }

  capabilities() {
    const configured = this.client.configured();
    const mlflow = configured && String(this.env.DATABRICKS_MLFLOW_ENABLED || "false").toLowerCase() === "true";
    return {
      submitJob: configured,
      cancelJob: configured,
      streamLogs: false,
      pollLogs: configured,
      metrics: mlflow,
      artifacts: mlflow,
      experiments: mlflow,
      modelRegistry: false,
      costEstimate: false,
      openProvider: configured
    };
  }

  async validateConnection() {
    await this.client.listJobs();
    return { status: "connected", connected: true, checkedAt: new Date().toISOString(), metadata: this.configurationStatus().metadata };
  }

  async submitJob(job) {
    const config = job.providerConfiguration || {};
    let response;
    if (config.jobId !== undefined && config.jobId !== null && String(config.jobId).trim()) {
      response = await this.client.runNow(config.jobId, config.jobParameters || {}, job.id);
    } else if (Array.isArray(config.tasks) && config.tasks.length) {
      response = await this.client.submitRun({
        run_name: job.name,
        timeout_seconds: Math.max(60, Number(job.constraints?.maxRuntimeMinutes || 60) * 60),
        tasks: config.tasks,
        ...(config.gitSource ? { git_source: config.gitSource } : {}),
        ...(config.jobClusters ? { job_clusters: config.jobClusters } : {})
      }, job.id);
    } else {
      throw new ProviderExecutionError("Databricks submission requires a saved job ID or a non-empty tasks specification.", {
        code: "provider_job_spec_required",
        status: 409
      });
    }
    const runId = response.run_id ?? response.runId;
    if (runId === undefined || runId === null) {
      throw new ProviderExecutionError("Databricks accepted the request without returning a run ID.", { code: "provider_reference_missing", status: 502 });
    }
    return {
      providerJobId: String(config.jobId ?? response.job_id ?? ""),
      providerRunId: String(runId),
      providerState: "SUBMITTED",
      providerUrl: `${this.client.host}/#job/${encodeURIComponent(String(config.jobId || response.job_id || "0"))}/run/${encodeURIComponent(String(runId))}`
    };
  }

  async getJob(executionRef) {
    if (!executionRef?.providerRunId) throw new ProviderExecutionError("Databricks run reference is missing.", { code: "provider_reference_missing", status: 409 });
    return normalizeDatabricksState(await this.client.getRun(executionRef.providerRunId));
  }

  async cancelJob(executionRef) {
    if (!executionRef?.providerRunId) throw new ProviderExecutionError("Databricks run reference is missing.", { code: "provider_reference_missing", status: 409 });
    await this.client.cancelRun(executionRef.providerRunId);
  }

  async getLogs(executionRef) {
    const payload = await this.client.getRunOutput(executionRef.providerRunId);
    const entries = [
      payload.logs ? { stream: "stdout", content: payload.logs } : null,
      payload.notebook_output?.result ? { stream: "notebook", content: payload.notebook_output.result } : null,
      payload.error ? { stream: "error", content: payload.error } : null
    ].filter(Boolean).map((entry, index) => ({ id: `${executionRef.providerRunId}:${index + 1}`, ...entry, content: String(entry.content).slice(0, 500_000) }));
    return { entries, nextCursor: null, truncated: Boolean(payload.logs_truncated) };
  }

  async getMetrics(executionRef) {
    const runIds = executionRef.experimentRunIds || [];
    if (!runIds.length) return [];
    const runs = await Promise.all(runIds.slice(0, 20).map((runId) => this.client.getMlflowRun(runId)));
    return runs.flatMap((payload) => (payload.run?.data?.metrics || []).map((metric) => ({
      key: metric.key,
      value: metric.value,
      timestamp: metric.timestamp ? new Date(metric.timestamp).toISOString() : "",
      step: metric.step ?? null,
      experimentRunId: payload.run?.info?.run_id || ""
    })));
  }

  async getArtifacts(executionRef) {
    const runIds = executionRef.experimentRunIds || [];
    if (!runIds.length) return [];
    const pages = await Promise.all(runIds.slice(0, 20).map((runId) => this.client.listMlflowArtifacts(runId)));
    return pages.flatMap((payload, pageIndex) => (payload.files || []).map((file) => ({
      path: file.path,
      isDirectory: Boolean(file.is_dir),
      size: file.file_size ?? null,
      experimentRunId: runIds[pageIndex]
    })));
  }
}
