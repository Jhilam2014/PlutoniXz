import { MLExecutionProvider, ProviderExecutionError } from "../executionProvider.js";
import { AzureMlClient } from "./azureMlClient.js";
import { normalizeAzureMlState } from "./azureMlNormalizer.js";

function azureJobName(logicalId) {
  return String(logicalId || "gotham-studio-job").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

export class AzureMlExecutionProvider extends MLExecutionProvider {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, client } = {}) {
    super({ id: "azure-ml", label: "Azure Machine Learning", env });
    this.client = client || new AzureMlClient({
      subscriptionId: env.AZURE_ML_SUBSCRIPTION_ID,
      resourceGroup: env.AZURE_ML_RESOURCE_GROUP,
      workspaceName: env.AZURE_ML_WORKSPACE_NAME,
      accessToken: env.AZURE_ML_ACCESS_TOKEN,
      apiVersion: env.AZURE_ML_API_VERSION || "2026-03-01",
      managementEndpoint: env.AZURE_ML_MANAGEMENT_ENDPOINT,
      timeoutMs: env.GOTHAM_STUDIO_PROVIDER_TIMEOUT_MS,
      fetchImpl
    });
  }

  configurationStatus() {
    const configured = this.client.configured();
    return {
      configured,
      status: configured ? "configured" : "not_configured",
      metadata: {
        workspace: this.client.workspaceName,
        resourceGroup: this.client.resourceGroup,
        authenticationMode: configured ? "backend_bearer" : "not_configured",
        apiVersion: this.client.apiVersion
      }
    };
  }

  capabilities() {
    const configured = this.client.configured();
    return {
      submitJob: configured,
      cancelJob: configured,
      streamLogs: false,
      pollLogs: false,
      metrics: false,
      artifacts: false,
      experiments: false,
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
    const definition = job.providerConfiguration?.definition;
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
      throw new ProviderExecutionError("Azure ML submission requires a complete ARM job definition.", { code: "provider_job_spec_required", status: 409 });
    }
    const jobName = azureJobName(job.providerConfiguration?.jobName || job.id);
    const response = await this.client.createJob(jobName, definition);
    return {
      providerJobId: jobName,
      providerRunId: jobName,
      providerState: String(response.properties?.status || "SUBMITTED"),
      providerUrl: `https://ml.azure.com/runs/${encodeURIComponent(jobName)}?wsid=${encodeURIComponent(this.client.workspacePath())}`
    };
  }

  async getJob(executionRef) {
    const id = executionRef?.providerJobId || executionRef?.providerRunId;
    if (!id) throw new ProviderExecutionError("Azure ML job reference is missing.", { code: "provider_reference_missing", status: 409 });
    return normalizeAzureMlState(await this.client.getJob(id));
  }

  async cancelJob(executionRef) {
    const id = executionRef?.providerJobId || executionRef?.providerRunId;
    if (!id) throw new ProviderExecutionError("Azure ML job reference is missing.", { code: "provider_reference_missing", status: 409 });
    await this.client.cancelJob(id);
  }
}
