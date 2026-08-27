import { safeProviderUrl, sanitizeProviderText } from "../../domain.js";

const cancelledResults = new Set(["CANCELED", "UPSTREAM_CANCELED", "USER_CANCELED"]);
const failedResults = new Set([
  "FAILED",
  "TIMEDOUT",
  "MAXIMUM_CONCURRENT_RUNS_REACHED",
  "UPSTREAM_FAILED",
  "EXCLUDED",
  "SUCCESS_WITH_FAILURES",
  "DISABLED"
]);

export function normalizeDatabricksState(payload = {}) {
  const legacy = payload.state || {};
  const modern = payload.status || {};
  const lifecycle = String(legacy.life_cycle_state || modern.state || "UNKNOWN").toUpperCase();
  const result = String(legacy.result_state || modern.termination_details?.code || "").toUpperCase();
  let logicalState = "UNKNOWN";
  if (["QUEUED", "BLOCKED", "WAITING", "WAITING_FOR_RETRY"].includes(lifecycle)) logicalState = "QUEUED";
  else if (lifecycle === "PENDING") logicalState = "STARTING";
  else if (lifecycle === "RUNNING") logicalState = "RUNNING";
  else if (lifecycle === "TERMINATING") logicalState = "CANCELLING";
  else if (lifecycle === "PAUSED") logicalState = "PAUSED";
  else if (["TERMINATED", "SKIPPED", "INTERNAL_ERROR"].includes(lifecycle)) {
    if (result === "SUCCESS") logicalState = "SUCCEEDED";
    else if (cancelledResults.has(result)) logicalState = "CANCELLED";
    else logicalState = failedResults.has(result) || lifecycle !== "TERMINATED" ? "FAILED" : "UNKNOWN";
  }
  const startTime = Number(payload.start_time || payload.startTime || 0);
  const endTime = Number(payload.end_time || payload.endTime || 0);
  return {
    logicalState,
    providerState: [lifecycle, result].filter(Boolean).join(":"),
    providerStatusMessage: sanitizeProviderText(legacy.state_message || modern.termination_details?.message || modern.queue_details?.message || "", ""),
    startedAt: startTime > 0 ? new Date(startTime).toISOString() : "",
    completedAt: endTime > 0 ? new Date(endTime).toISOString() : "",
    computeDurationSeconds: startTime > 0 && endTime >= startTime ? Math.round((endTime - startTime) / 1000) : null,
    currentStage: Array.isArray(payload.tasks)
      ? payload.tasks.find((task) => ["RUNNING", "PENDING", "QUEUED"].includes(String(task.state?.life_cycle_state || task.status?.state || "").toUpperCase()))?.task_key || ""
      : "",
    progress: null,
    providerUrl: safeProviderUrl(payload.run_page_url),
    error: logicalState === "FAILED" ? {
      code: result || "DATABRICKS_RUN_FAILED",
      summary: sanitizeProviderText(legacy.state_message || modern.termination_details?.message || "Databricks execution failed.")
    } : null,
    raw: {
      lifecycle,
      result,
      runType: String(payload.run_type || ""),
      taskCount: Array.isArray(payload.tasks) ? payload.tasks.length : 0
    }
  };
}
