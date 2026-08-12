import assert from "node:assert/strict";
import test from "node:test";
import { classifyProductShape } from "../src/productShape.js";
import { getIntelProfile, intelProfileRegistry, profileArtifactValidation, selectIntelProfile, validateIntelProfileRegistry } from "../src/intelProfiles.js";

const cases = [
  ["Build a React web application for customer support.", "web-application"],
  ["Create an OpenAPI REST API service for orders.", "api-service"],
  ["Create a PDF report from the supplied source material.", "document-pdf"],
  ["Create an Excel workbook with formulas and monthly sheets.", "spreadsheet"]
];

for (const [instruction, profileId] of cases) {
  test(`selects the ${profileId} profile`, () => {
    const selection = selectIntelProfile({ instruction, productDecision: classifyProductShape({ instruction }) });
    assert.equal(selection.status, "selected");
    assert.equal(selection.profileId, profileId);
    assert.equal(selection.profile.status, "supported");
  });
}

test("uses existing-project metadata during selection", () => {
  const selection = selectIntelProfile({
    instruction: "Add a request validator to this project.",
    productDecision: classifyProductShape({ instruction: "Add a request validator.", existingProject: true }),
    existingProjectMetadata: { artifactType: "api_service", hasBackendInterface: true }
  });
  assert.equal(selection.profileId, "api-service");
  assert.equal(selection.source, "existing-project");
});

test("asks for clarification when two materially different artifact types are explicitly requested", () => {
  const instruction = "Create a spreadsheet workbook with Excel formulas and a PDF document report.";
  const selection = selectIntelProfile({ instruction, productDecision: classifyProductShape({ instruction }) });
  assert.equal(selection.status, "needs_clarification");
  assert.equal(selection.requiresUserConfirmation, true);
});

test("does not fall back to web for unsupported profiles", () => {
  const instruction = "Build an iOS mobile application with native screens.";
  const selection = selectIntelProfile({ instruction, productDecision: classifyProductShape({ instruction }) });
  assert.equal(selection.profileId, "mobile-application");
  assert.equal(selection.status, "unsupported");
});

test("validates every registered profile and normalizes profile-specific output checks", () => {
  assert.equal(validateIntelProfileRegistry(intelProfileRegistry).length, intelProfileRegistry.length);
  assert.equal(profileArtifactValidation(getIntelProfile("web-application"), ["src/App.jsx"]).status, "passed");
  assert.equal(profileArtifactValidation(getIntelProfile("api-service"), ["backend/server.js"]).status, "passed");
  assert.equal(profileArtifactValidation(getIntelProfile("document-pdf"), ["deliverables/report.pdf"]).status, "passed");
  assert.equal(profileArtifactValidation(getIntelProfile("spreadsheet"), ["deliverables/budget.xlsx"]).status, "passed");
});
