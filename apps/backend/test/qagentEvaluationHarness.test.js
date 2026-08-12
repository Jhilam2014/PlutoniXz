import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadQAgentDeterministicFixtures, runQAgentEvaluationHarness } from "../src/qagentEvaluationHarness.js";

const fixturesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "qagent-decision-continuity.json");

test("deterministic QAgent harness compares baseline, reflection, and bounded investigation without claiming production benefit", async () => {
  const fixtureFile = await loadQAgentDeterministicFixtures(fixturesPath);
  const result = runQAgentEvaluationHarness({ fixtureFile });
  assert.deepEqual(Object.keys(result.summary), ["no_qagent", "single_agent_reflection", "qagent_assisted"]);
  assert.equal(result.results.length, 3);
  assert.equal(result.summary.no_qagent.toolCalls, 0);
  assert.equal(result.summary.single_agent_reflection.modelCalls, 1);
  assert.equal(result.summary.qagent_assisted.toolCalls, 1);
  assert.equal(result.summary.qagent_assisted.acceptedImprovements, 1);
  assert.equal(result.summary.qagent_assisted.costPerAcceptedImprovement, 0.004);
  assert.equal(result.liveProvider.status, "opt_in_disabled");
  assert.match(result.attribution, /do not establish production improvement/i);
});

test("a live provider remains explicitly opt-in and budget-capped without an adapter call", async () => {
  const fixtureFile = await loadQAgentDeterministicFixtures(fixturesPath);
  const result = runQAgentEvaluationHarness({ fixtureFile, liveEnabled: true, liveCostCapUsd: 0.05 });
  assert.equal(result.liveProvider.status, "blocked");
  assert.equal(result.liveProvider.budgetCapUsd, 0.05);
});
