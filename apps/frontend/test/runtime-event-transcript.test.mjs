import assert from "node:assert/strict";
import test from "node:test";
import { runtimeEventTranscript } from "../src/runtimeEventTranscript.js";

test("renders a failure event as status instead of duplicating it as request and response", () => {
  const failure = "Gotham completed but did not change any meaningful project or requested artifact files.";
  assert.deepEqual(runtimeEventTranscript({ type: "error", message: failure }), {
    inputLog: "",
    responseLog: "",
    statusLog: failure
  });
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
