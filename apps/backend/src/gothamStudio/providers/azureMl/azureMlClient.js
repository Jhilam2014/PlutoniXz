import { ProviderExecutionError } from "../executionProvider.js";
import { sanitizeProviderText, sanitizeStudioValue } from "../../domain.js";

function segment(value) {
  return encodeURIComponent(String(value || "").trim());
}

export class AzureMlClient {
  constructor({ subscriptionId, resourceGroup, workspaceName, accessToken, apiVersion = "2026-03-01", managementEndpoint = "https://management.azure.com", fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {}) {
    this.subscriptionId = String(subscriptionId || "").trim();
    this.resourceGroup = String(resourceGroup || "").trim();
    this.workspaceName = String(workspaceName || "").trim();
    this.accessToken = String(accessToken || "").trim();
    this.apiVersion = String(apiVersion || "2026-03-01").trim();
    this.managementEndpoint = String(managementEndpoint || "https://management.azure.com").replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(1_000, Math.min(Number(timeoutMs) || 20_000, 120_000));
  }

  configured() {
    return Boolean(this.subscriptionId && this.resourceGroup && this.workspaceName && this.accessToken);
  }

  workspacePath() {
    return `/subscriptions/${segment(this.subscriptionId)}/resourceGroups/${segment(this.resourceGroup)}/providers/Microsoft.MachineLearningServices/workspaces/${segment(this.workspaceName)}`;
  }

  async request(method, resourcePath, { body, query } = {}) {
    if (!this.configured()) throw new ProviderExecutionError("Azure Machine Learning is not configured.", { code: "provider_not_configured", status: 409 });
    const url = new URL(`${this.managementEndpoint}${this.workspacePath()}${resourcePath}`);
    url.searchParams.set("api-version", this.apiVersion);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        redirect: "error"
      });
    } catch (error) {
      clearTimeout(timeout);
      throw new ProviderExecutionError(error?.name === "AbortError" ? "Azure ML request timed out." : "Azure ML could not be reached.", {
        code: error?.name === "AbortError" ? "provider_timeout" : "provider_unavailable",
        status: 503,
        retryable: true
      });
    }
    clearTimeout(timeout);
    let payload = {};
    try { payload = response.status === 204 ? {} : await response.json(); } catch { payload = {}; }
    if (!response.ok) {
      throw new ProviderExecutionError(
        response.status === 401 || response.status === 403
          ? "Azure ML authentication or authorization failed."
          : response.status === 429
            ? "Azure ML rate limited the request."
            : sanitizeProviderText(payload.error?.message || `Azure ML request failed with status ${response.status}.`),
        {
          code: response.status === 429 ? "provider_rate_limited" : response.status === 401 || response.status === 403 ? "provider_authentication_failed" : "provider_request_failed",
          status: response.status === 429 ? 429 : 502,
          providerStatus: response.status,
          retryable: response.status === 429 || response.status >= 500,
          details: { errorCode: payload.error?.code || "" }
        }
      );
    }
    return sanitizeStudioValue(payload);
  }

  listJobs() { return this.request("GET", "/jobs", { query: { $top: 1 } }); }
  createJob(name, definition) { return this.request("PUT", `/jobs/${segment(name)}`, { body: definition }); }
  getJob(name) { return this.request("GET", `/jobs/${segment(name)}`); }
  cancelJob(name) { return this.request("POST", `/jobs/${segment(name)}/cancel`); }
}
