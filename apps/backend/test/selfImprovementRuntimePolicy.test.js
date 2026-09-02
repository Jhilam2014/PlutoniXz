import assert from "node:assert/strict";
import test from "node:test";
import {
  orchestratorRuntimeSelfHealEnabled,
  selfImprovementRuntimeEventsEnabled,
  selfImprovementStartupCycleEnabled
} from "../src/selfImprovement/runtimePolicy.js";

test("keeps runtime self-improvement triggers disabled by default", () => {
  assert.equal(selfImprovementRuntimeEventsEnabled({}), false);
  assert.equal(orchestratorRuntimeSelfHealEnabled({}), false);
  assert.equal(selfImprovementStartupCycleEnabled({}), true);
});

test("allows explicit runtime trigger opt-in", () => {
  assert.equal(selfImprovementRuntimeEventsEnabled({ PLUTOMIX_SELF_IMPROVEMENT_RUNTIME_EVENTS: "true" }), true);
  assert.equal(orchestratorRuntimeSelfHealEnabled({ PLUTOMIX_ORCHESTRATOR_SELF_HEAL: "1" }), true);
  assert.equal(selfImprovementStartupCycleEnabled({ SELF_IMPROVEMENT_STARTUP_CYCLE_ENABLED: "false" }), false);
});
