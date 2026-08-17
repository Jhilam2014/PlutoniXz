function enabled(value) {
  return String(value || "").trim().toLowerCase() === "true" || String(value || "").trim() === "1";
}

// Runtime observations remain local by default. Running a full improvement
// cycle while a user instruction is executing is opt-in because it competes
// with that instruction for model, filesystem, and observability resources.
export function selfImprovementRuntimeEventsEnabled(env = process.env) {
  return enabled(env.PLUTONIX_SELF_IMPROVEMENT_RUNTIME_EVENTS);
}

export function selfImprovementStartupCycleEnabled(env = process.env) {
  return env.SELF_IMPROVEMENT_STARTUP_CYCLE_ENABLED === undefined
    ? true
    : enabled(env.SELF_IMPROVEMENT_STARTUP_CYCLE_ENABLED);
}

export function orchestratorRuntimeSelfHealEnabled(env = process.env) {
  return enabled(env.PLUTONIX_ORCHESTRATOR_SELF_HEAL);
}
