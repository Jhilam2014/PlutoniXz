export const STUDIO_TERMINAL_STATES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);
export const STUDIO_ACTIVE_STATES = new Set(["QUEUED", "SUBMITTED", "STARTING", "RUNNING", "PAUSED", "CANCELLING", "UNKNOWN"]);

export function studioStateTone(state = "UNKNOWN") {
  const value = String(state || "UNKNOWN").toUpperCase();
  if (value === "SUCCEEDED") return "success";
  if (value === "FAILED") return "danger";
  if (value === "CANCELLED") return "muted";
  if (["RUNNING", "STARTING", "SUBMITTED"].includes(value)) return "active";
  if (["QUEUED", "PAUSED", "CANCELLING"].includes(value)) return "attention";
  return "neutral";
}

export function providerLabel(provider = "") {
  return ({ databricks: "Databricks", "azure-ml": "Azure ML" })[provider] || String(provider || "Provider");
}

export function elapsedLabel(job = {}) {
  const start = new Date(job.startedAt || job.submittedAt || job.createdAt || 0).getTime();
  const end = new Date(job.completedAt || Date.now()).getTime();
  if (!start || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return "Unavailable";
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function costLabel(job = {}) {
  if (Number.isFinite(job.actualCost)) return `${job.costCurrency || ""} ${job.actualCost.toLocaleString()} actual`.trim();
  if (Number.isFinite(job.estimatedCost)) return `${job.costCurrency || ""} ${job.estimatedCost.toLocaleString()} estimated`.trim();
  return "Cost unavailable";
}

export function providerCapabilities(providers = [], providerId = "") {
  return providers.find((provider) => provider.id === providerId)?.capabilities || {};
}

export function canCancelStudioJob(job, providers = []) {
  return STUDIO_ACTIVE_STATES.has(job?.logicalState) && job.logicalState !== "CANCELLING" && Boolean(providerCapabilities(providers, job.provider).cancelJob);
}

export function canRetryStudioJob(job) {
  const attempt = Number(job?.retry?.attempt || 1);
  const maxRuns = Number(job?.constraints?.maxRuns || 1);
  return ["FAILED", "CANCELLED"].includes(job?.logicalState) && attempt < maxRuns;
}

export function canSubmitStudioJob(job, providers = [], workflowMode = "executor") {
  return job?.logicalState === "DRAFT"
    && workflowMode === "executor"
    && Boolean(providerCapabilities(providers, job.provider).submitJob);
}

export function providerConfigured(provider = {}) {
  return provider.configured === true && !["not_configured", "error"].includes(provider.status);
}
