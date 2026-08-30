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

test("Gotham prompt receives only approved sharing context and preserves constraint-conflicting approaches as deferred", () => {
  const prompt = codexPrompt("Implement the governed client change.", {
    objective: "Implement the governed client change.",
    sourceInstruction: "Implement the governed client change.",
    sections: [],
    informationSharingContext: {
      activePolicies: [{
        id: "sharing-client-1",
        direction: "inbound",
        scope: { level: "client" },
        information: {
          summary: "Apply the approved client residency constraint.",
          classification: "confidential",
          dataCategories: ["client constraints"],
          governanceRules: ["Use only for application development."],
          privacyPolicies: ["Do not render client identifiers."],
          enterpriseConstraints: ["Keep regulated data in India."]
        }
      }]
    },
    orchestrationEnvelope: { parentWorkflowId: "workflow-sharing-test", delegations: [], childExecutionIds: [] }
  }, true);

  assert.match(prompt, /Enterprise information sharing is deny-by-default/);
  assert.match(prompt, /sharing-client-1/);
  assert.match(prompt, /Keep regulated data in India/);
  assert.match(prompt, /keep the approach deferred and cite the agreement and constraint/i);
});
