import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRealDataNeed, normalizeRealDataPreflightPayload } from "../src/realDataPreflight.js";

test("normalizes legacy references before real-data preflight validation", () => {
  const result = normalizeRealDataPreflightPayload({
    instruction: "Build a tool using the uploaded media.",
    mediaIds: [null, "media-1", { id: "media-2" }, { path: "legacy.png" }],
    stagedMediaIds: [{ id: "staged-1" }, undefined],
    referenceCount: "2",
    suppliedData: {
      source_data: null,
      integration_source: 42,
      structured_context: { endpoint: "https://example.test/data" }
    }
  });

  assert.deepEqual(result.mediaIds, ["media-1", "media-2"]);
  assert.deepEqual(result.stagedMediaIds, ["staged-1"]);
  assert.equal(result.referenceCount, 2);
  assert.deepEqual(result.suppliedData, {
    integration_source: "42",
    structured_context: '{"endpoint":"https://example.test/data"}'
  });
});

test("allows a focused tool that does not depend on external records", () => {
  const result = analyzeRealDataNeed({ instruction: "Build a CSV to JSON converter tool." });
  assert.equal(result.status, "ready");
  assert.equal(result.productDecision.productShape, "focused_task_tool");
  assert.deepEqual(result.requiredFields, []);
});

test("asks for one combined source before a live finance build", () => {
  const result = analyzeRealDataNeed({
    instruction: "Build a live finance dashboard backed by our database.",
    projectName: "Finance Operations"
  });
  assert.equal(result.status, "needs_input");
  assert.deepEqual(result.requiredFields.map((field) => field.id), ["source_data"]);
  assert.equal(result.requiredFields[0].inputKind, "text_or_file");
  assert.match(result.requiredFields[0].purpose, /live or backend data boundary/i);
  assert.ok(result.requiredFields[0].usedFor.includes("persistence"));
  assert.match(result.requiredFields[0].expectedInput, /endpoint/i);
});

test("accepts an integration endpoint supplied through the required-data dialog", () => {
  const result = analyzeRealDataNeed({
    instruction: "Build a live finance dashboard backed by our database.",
    projectName: "Finance Operations",
    suppliedData: {
      source_data: "Endpoint: https://finance.example.test/v1/summary using FINANCE_API_KEY"
    }
  });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.requiredFields, []);
});

test("accepts explicit empty placeholder authorization without fabricating data", () => {
  const result = analyzeRealDataNeed({
    instruction: "Build a finance dashboard and use empty placeholders until the backend is connected.",
    projectName: "Finance Operations"
  });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.requiredFields, []);
});

test("requires an upload-capable field when referenced media is missing", () => {
  const result = analyzeRealDataNeed({
    instruction: "Create a demo video using the uploaded footage for Product Northstar.",
    projectName: "Product Northstar"
  });
  assert.equal(result.status, "needs_input");
  assert.deepEqual(result.requiredFields.map((field) => field.id), ["media_reference"]);
  assert.equal(result.requiredFields[0].inputKind, "text_or_file");
  assert.match(result.requiredFields[0].accept, /video/);
  assert.match(result.requiredFields[0].purpose, /source material/i);
  assert.match(result.requiredFields[0].expectedInput, /upload/i);
});

test("recognizes staged media as real reference evidence", () => {
  const result = analyzeRealDataNeed({
    instruction: "Create a demo video using the uploaded footage for Product Northstar.",
    projectName: "Product Northstar",
    stagedMediaIds: ["media-1"]
  });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.requiredFields, []);
});
