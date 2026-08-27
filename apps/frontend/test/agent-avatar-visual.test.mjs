import assert from "node:assert/strict";
import test from "node:test";
import {
  agentAvatarDataUrl,
  agentGlyphMarkup,
  agentIconKind,
  agentVisualFromRecord
} from "../src/agentAvatarVisual.js";

test("Global Agent Memory visual records produce stable category avatars", () => {
  const qagent = agentVisualFromRecord({
    id: "checkout-qagent-controller",
    name: "Checkout QAgent",
    role: "Quality controller",
    profile: { color: "#4338ca", accent: "#a5b4fc" }
  });
  assert.equal(agentIconKind(qagent), "qagent");
  assert.equal(qagent.color, "#4338ca");
  assert.equal(qagent.accent, "#a5b4fc");
  assert.match(agentGlyphMarkup("qagent"), /M38 38l7 7/);
  assert.match(decodeURIComponent(agentAvatarDataUrl(qagent)), /<svg[^>]+viewBox="0 0 64 64"/);
});

test("generated agent avatar colors and variants remain deterministic", () => {
  const record = { id: "tenant-runtime-agent", name: "Runtime Agent", role: "runtime packaging" };
  assert.deepEqual(agentVisualFromRecord(record), agentVisualFromRecord(record));
  assert.equal(agentIconKind(agentVisualFromRecord(record)), "runtime");
});
