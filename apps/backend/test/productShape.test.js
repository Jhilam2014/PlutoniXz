import assert from "node:assert/strict";
import test from "node:test";
import { selectAdaptiveRoute } from "../src/adaptiveOrchestration.js";
import { orchestrateBuilderInstruction } from "../src/orchestratorAgent.js";
import { classifyProductShape, validateProductShapeOutputs } from "../src/productShape.js";

const cases = [
  {
    instruction: "Create an Excel workbook with budget formulas, summary tables, and separate monthly sheets.",
    artifactType: "spreadsheet",
    productShape: "artifact_only",
    interactionModel: "workbook_artifact"
  },
  {
    instruction: "Design a printable event flyer using the supplied logo, schedule, and venue details.",
    artifactType: "flyer",
    productShape: "artifact_only",
    interactionModel: "print_artifact"
  },
  {
    instruction: "Create an invoice PDF from the supplied finance records.",
    artifactType: "document",
    productShape: "artifact_only",
    interactionModel: "document_artifact"
  },
  {
    instruction: "Produce a product demo video using the uploaded script and footage.",
    artifactType: "video",
    productShape: "artifact_only",
    interactionModel: "media_artifact"
  },
  {
    instruction: "Build a CSV to JSON converter tool.",
    artifactType: "web_application",
    productShape: "focused_task_tool",
    interactionModel: "focused_tool"
  },
  {
    instruction: "Create an OpenAPI service for order processing with input validation and tests.",
    artifactType: "api_service",
    productShape: "service_or_automation",
    interactionModel: "service_contract"
  },
  {
    instruction: "Create a portfolio website for a photographer.",
    artifactType: "website",
    productShape: "app_shaped_page",
    interactionModel: "content_site"
  },
  {
    instruction: "Build a CRM application with users, permissions, database records, and an approval workflow.",
    artifactType: "web_application",
    productShape: "production_application",
    interactionModel: "record_workspace"
  },
  {
    instruction: "Build a multi-tenant enterprise platform with three roles, persistent workflows, integrations, approvals, workers, and audit logs.",
    artifactType: "web_application",
    productShape: "deep_complex_platform",
    interactionModel: "multi_surface_platform"
  },
  {
    instruction: "Build a booking mobile app with login, saved appointments, and payments.",
    artifactType: "mobile_application",
    productShape: "production_application",
    interactionModel: "mobile_flow"
  }
];

for (const fixture of cases) {
  test(`classifies ${fixture.productShape}: ${fixture.instruction}`, () => {
    const decision = classifyProductShape({ instruction: fixture.instruction });
    assert.equal(decision.artifactType, fixture.artifactType);
    assert.equal(decision.productShape, fixture.productShape);
    assert.equal(decision.interactionModel, fixture.interactionModel);
    assert.ok(decision.whyNotSimpler);
    assert.ok(decision.whyNotMoreComplex);
    assert.ok(decision.prohibitedDefaults.includes("unrequested visible how-to or feature explanation"));
  });
}

test("does not select deep platform scope from the word platform alone", () => {
  const decision = classifyProductShape({
    instruction: "Create a simple community platform page for a local design club."
  });
  assert.equal(decision.artifactType, "web_application");
  assert.equal(decision.productShape, "app_shaped_page");
});

test("preserves existing product shape for scoped project changes", () => {
  const decision = classifyProductShape({
    instruction: "Add a country filter to the existing investor list.",
    projectName: "Investor Finder",
    existingProject: true
  });
  assert.equal(decision.artifactType, "existing_project");
  assert.equal(decision.productShape, "existing_product_change");
  assert.equal(decision.interactionModel, "preserve_existing");
});

test("does not turn focused tools into hero and CTA templates", () => {
  const { structuredRequest } = orchestrateBuilderInstruction("Build a focused mortgage calculator tool.");
  assert.equal(structuredRequest.productDecision.productShape, "focused_task_tool");
  assert.deepEqual(structuredRequest.sections, ["primary-task", "result-state"]);
  assert.equal(structuredRequest.siteStructure, "single_page");
  assert.equal(structuredRequest.sections.includes("hero"), false);
  assert.equal(structuredRequest.sections.includes("cta"), false);
});

test("plans the real artifact path instead of a React page for PDF output", () => {
  const { structuredRequest } = orchestrateBuilderInstruction(
    "Create a PDF report from these real finance records: revenue 100, expenses 60."
  );
  assert.equal(structuredRequest.productDecision.productShape, "artifact_only");
  assert.equal(structuredRequest.siteStructure, "not_applicable");
  assert.equal(structuredRequest.fileOperations[0].path, "deliverables/");
  assert.equal(structuredRequest.fileOperations.some((operation) => operation.path === "src/generated/generatedPage.jsx"), false);
});

test("requires semantic review for governance-heavy product decisions", () => {
  const productDecision = classifyProductShape({
    instruction: "Build a production application with authentication, permissions, payments, approval, and audit logs."
  });
  const route = selectAdaptiveRoute({
    instruction: "Build a production application with authentication, permissions, payments, approval, and audit logs.",
    taskType: "Medium",
    productDecision,
    maxModelCalls: 2
  });
  assert.equal(route.requiresIndependentReview, true);
  assert.equal(route.productReviewRequired, true);
  assert.equal(route.plannedModelCalls, 2);
});

test("fails artifact-only completion when only a React preview changed", () => {
  const decision = classifyProductShape({ instruction: "Create a PDF invoice." });
  const validation = validateProductShapeOutputs(decision, [
    "src/generated/generatedPage.jsx",
    "src/generated/metadata.json"
  ]);
  assert.equal(validation.status, "failed");
  assert.match(validation.failures.join(" "), /No changed document file/);
});

test("accepts the requested artifact as primary output", () => {
  const decision = classifyProductShape({ instruction: "Create a PDF invoice." });
  const validation = validateProductShapeOutputs(decision, [
    "deliverables/invoice.pdf",
    "src/generated/metadata.json"
  ]);
  assert.equal(validation.status, "passed");
});

test("requires a real workbook rather than a decorative web table", () => {
  const decision = classifyProductShape({ instruction: "Create an Excel workbook with formulas for quarterly planning." });
  const rejected = validateProductShapeOutputs(decision, ["src/generated/generatedPage.jsx", "src/generated/metadata.json"]);
  assert.equal(rejected.status, "failed");
  assert.match(rejected.failures.join(" "), /No changed spreadsheet file/);

  const accepted = validateProductShapeOutputs(decision, ["deliverables/quarterly-planning.xlsx", "src/generated/metadata.json"]);
  assert.equal(accepted.status, "passed");
});
