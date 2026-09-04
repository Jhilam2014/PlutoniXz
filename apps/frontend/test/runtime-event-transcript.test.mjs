import assert from "node:assert/strict";
import test from "node:test";
import { runtimeEventPresentation, runtimeEventStatusLabel, runtimeEventTranscript } from "../src/runtimeEventTranscript.js";

test("renders a failure event as status instead of duplicating it as request and response", () => {
  const failure = "Gotham completed but did not change any meaningful project or requested artifact files.";
  assert.deepEqual(runtimeEventTranscript({ type: "error", message: failure }), {
    inputLog: "",
    responseLog: "",
    statusLog: failure
  });
});

test("labels successful publication updates as status rather than failure", () => {
  const event = { type: "publication.queued", status: "published", message: "Workflow projections were durably queued." };
  const transcript = runtimeEventTranscript(event);
  assert.equal(runtimeEventStatusLabel(event, transcript), "Status");
  assert.equal(runtimeEventStatusLabel({ type: "project create failed" }, { statusLog: "EISDIR" }), "Failure");
  assert.equal(runtimeEventStatusLabel({ type: "provider-progress" }, { inputLog: "prompt" }), "Execution status");
});

test("keeps agent input, output, and distinct execution status separate", () => {
  assert.deepEqual(runtimeEventTranscript({
    agentInput: "Add the database browser.",
    agentResponse: "Updated src/App.jsx.",
    message: "Gotham changed 1 file"
  }), {
    inputLog: "Add the database browser.",
    responseLog: "Updated src/App.jsx.",
    statusLog: "Gotham changed 1 file"
  });
});

test("classifies provider-neutral runtime events without calling Claude Codex", () => {
  const expected = new Map([
    ["provider-start", "start"],
    ["provider-runtime-verified", "verified"],
    ["provider-progress", "progress"],
    ["provider-command", "command"],
    ["provider-file-change", "file-change"],
    ["provider-complete", "completion"],
    ["provider-failure", "failure"]
  ]);
  for (const [type, kind] of expected) {
    const presentation = runtimeEventPresentation({ type, providerId: "claude" });
    assert.equal(presentation.kind, kind);
    assert.equal(presentation.providerLabel, "Claude Code");
    assert.equal(presentation.providerLabel.includes("Codex"), false);
  }
});

test("continues classifying persisted Codex events as OpenAI Codex activity", () => {
  assert.deepEqual(runtimeEventPresentation({ type: "codex-command" }), {
    providerId: "codex",
    providerLabel: "OpenAI Codex",
    kind: "command",
    isProviderRuntime: true
  });
  assert.equal(runtimeEventPresentation({ type: "codex-progress" }).kind, "progress");
  assert.equal(runtimeEventPresentation({ type: "codex-complete" }).kind, "completion");
});
