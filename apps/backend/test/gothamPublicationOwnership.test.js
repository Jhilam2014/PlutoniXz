import assert from "node:assert/strict";
import test from "node:test";
import { codexPrompt, deterministicPublicationOwnershipPrompt } from "../src/codexWorkflow.js";

test("Gotham prompt assigns PlutoniX control-plane graph and memory publication to the backend", () => {
  const contract = deterministicPublicationOwnershipPrompt();
  assert.match(contract, /Do not create or update PlutoniX control-plane Neo4j, D3 topology/i);
  assert.match(contract, /deterministic backend publisher owns mandatory graph and memory projections/i);
  assert.match(contract, /does not prohibit application-owned graph or memory functionality/i);

  const prompt = codexPrompt("Implement the requested application change.", {
    objective: "Implement the requested application change.",
    sourceInstruction: "Implement the requested application change.",
    sections: [],
    orchestrationEnvelope: { parentWorkflowId: "workflow-prompt-test", delegations: [], childExecutionIds: [] }
  }, true);
  assert.match(prompt, /return implementation, changed-file, input-consumption, and validation evidence only/i);
  assert.match(prompt, /Do not report graph or memory publication as completed/i);
});
