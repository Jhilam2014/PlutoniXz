import { safeProviderUrl, sanitizeProviderText } from "../../domain.js";

export function normalizeAzureMlState(payload = {}) {
  const status = String(payload.properties?.status || payload.status || "Unknown");
  const normalized = status.toLowerCase();
  const logicalState = {
    notstarted: "QUEUED",
    queued: "QUEUED",
    provisioning: "STARTING",
    preparing: "STARTING",
    starting: "STARTING",
    running: "RUNNING",
    finalizing: "RUNNING",
    cancelrequested: "CANCELLING",
    canceled: "CANCELLED",
    completed: "SUCCEEDED",
    failed: "FAILED",
    paused: "PAUSED",
    notresponding: "UNKNOWN",
    unknown: "UNKNOWN"
  }[normalized] || "UNKNOWN";
  const services = payload.properties?.services || {};
  const providerUrl = Object.values(services).find((service) => service?.endpoint)?.endpoint || "";
  return {
    logicalState,
    providerState: status,
    providerStatusMessage: sanitizeProviderText(payload.properties?.error?.message || payload.properties?.statusMessage || "", ""),
    startedAt: payload.properties?.startTime || "",
    completedAt: payload.properties?.endTime || "",
    computeDurationSeconds: null,
    currentStage: normalized === "finalizing" ? "Finalizing outputs" : "",
    progress: null,
    providerUrl: safeProviderUrl(providerUrl),
    error: logicalState === "FAILED" ? {
      code: String(payload.properties?.error?.code || "AZURE_ML_JOB_FAILED").slice(0, 160),
      summary: sanitizeProviderText(payload.properties?.error?.message || "Azure ML execution failed.")
    } : null,
    raw: { status, jobType: String(payload.properties?.jobType || payload.kind || "") }
  };
}
