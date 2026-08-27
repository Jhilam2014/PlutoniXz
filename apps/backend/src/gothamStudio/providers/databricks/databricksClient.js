import { ProviderExecutionError } from "../executionProvider.js";
import { sanitizeProviderText, sanitizeStudioValue } from "../../domain.js";

function normalizedHost(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return "";
    return url.origin;
  } catch {
    return "";
  }
}

export class DatabricksClient {
  constructor({ host, token, apiVersion = "2.2", fetchImpl = globalThis.fetch, timeoutMs = 20_000, retries = 1 } = {}) {
    this.host = normalizedHost(host);
    this.token = String(token || "").trim();
    this.apiVersion = String(apiVersion || "2.2").trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(1_000, Math.min(Number(timeoutMs) || 20_000, 120_000));
    this.retries = Math.max(0, Math.min(Number(retries) || 0, 3));
  }

  configured() {
    return Boolean(this.host && this.token);
  }

  async request(method, endpoint, { query, body, attempt = 0 } = {}) {
    if (!this.configured()) {
      throw new ProviderExecutionError("Databricks is not configured.", { code: "provider_not_configured", status: 409 });
    }
    const url = new URL(`${this.host}${endpoint}`);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        redirect: "error"
      });
    } catch (error) {
      clearTimeout(timeout);
      if (attempt < this.retries) return this.request(method, endpoint, { query, body, attempt: attempt + 1 });
      throw new ProviderExecutionError(error?.name === "AbortError" ? "Databricks request timed out." : "Databricks could not be reached.", {
        code: error?.name === "AbortError" ? "provider_timeout" : "provider_unavailable",
        status: 503,
        retryable: true
      });
    }
    clearTimeout(timeout);
    let payload = {};
    try {
      payload = response.status === 204 ? {} : await response.json();
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < this.retries) return this.request(method, endpoint, { query, body, attempt: attempt + 1 });
      throw new ProviderExecutionError(
        response.status === 401 || response.status === 403
          ? "Databricks authentication or authorization failed."
          : response.status === 429
            ? "Databricks rate limited the request."
            : sanitizeProviderText(payload.message || payload.error || `Databricks request failed with status ${response.status}.`),
        {
          code: response.status === 429 ? "provider_rate_limited" : response.status === 401 || response.status === 403 ? "provider_authentication_failed" : "provider_request_failed",
          status: response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 502 : 502,
          providerStatus: response.status,
          retryable,
          details: { errorCode: payload.error_code || payload.errorCode || "" }
        }
      );
    }
    return sanitizeStudioValue(payload);
  }

  jobsEndpoint(path) {
    return `/api/${this.apiVersion}/jobs/${path}`;
  }

  listJobs() {
    return this.request("GET", this.jobsEndpoint("list"), { query: { limit: 1 } });
  }

  runNow(jobId, parameters = {}, idempotencyToken = "") {
    return this.request("POST", this.jobsEndpoint("run-now"), {
      body: {
        job_id: Number.isFinite(Number(jobId)) ? Number(jobId) : jobId,
        ...(idempotencyToken ? { idempotency_token: idempotencyToken.slice(0, 64) } : {}),
        ...(Object.keys(parameters || {}).length ? { job_parameters: parameters } : {})
      }
    });
  }

  submitRun(spec = {}, idempotencyToken = "") {
    return this.request("POST", this.jobsEndpoint("runs/submit"), {
      body: {
        ...spec,
        ...(idempotencyToken ? { idempotency_token: idempotencyToken.slice(0, 64) } : {})
      }
    });
  }

  getRun(runId) {
    return this.request("GET", this.jobsEndpoint("runs/get"), { query: { run_id: runId } });
  }

  cancelRun(runId) {
    return this.request("POST", this.jobsEndpoint("runs/cancel"), { body: { run_id: runId } });
  }

  getRunOutput(runId) {
    return this.request("GET", this.jobsEndpoint("runs/get-output"), { query: { run_id: runId } });
  }

  getMlflowRun(runId) {
    return this.request("GET", "/api/2.0/mlflow/runs/get", { query: { run_id: runId } });
  }

  listMlflowArtifacts(runId, artifactPath = "") {
    return this.request("GET", "/api/2.0/mlflow/artifacts/list", { query: { run_id: runId, path: artifactPath } });
  }
}

export function safeDatabricksWorkspace(host = "") {
  return normalizedHost(host);
}
