import { GothamStudioError, sanitizeProviderText, sanitizeStudioValue } from "../domain.js";

export class ProviderExecutionError extends GothamStudioError {
  constructor(message, { code = "provider_failure", status = 502, providerStatus = null, retryable = false, details } = {}) {
    super(sanitizeProviderText(message), { code, status, retryable, details: sanitizeStudioValue(details) });
    this.name = "ProviderExecutionError";
    this.providerStatus = providerStatus;
  }
}

export class MLExecutionProvider {
  constructor({ id, label, env = process.env } = {}) {
    if (!id) throw new Error("An ML execution provider ID is required.");
    this.id = id;
    this.label = label || id;
    this.env = env;
  }

  configurationStatus() {
    return { status: "not_configured", configured: false, metadata: {} };
  }

  capabilities() {
    return {
      submitJob: false,
      cancelJob: false,
      streamLogs: false,
      pollLogs: false,
      metrics: false,
      artifacts: false,
      experiments: false,
      modelRegistry: false,
      costEstimate: false,
      openProvider: false
    };
  }

  unsupported(operation) {
    throw new ProviderExecutionError(`${this.label} does not support ${operation}.`, {
      code: "provider_capability_unsupported",
      status: 409
    });
  }
}
