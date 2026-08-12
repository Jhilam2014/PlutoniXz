import assert from "node:assert/strict";
import test from "node:test";
import { probeCodexCli } from "../src/codexWorkflow.js";

test("Codex CLI probe reports an executable version", async () => {
  const probe = await probeCodexCli(process.execPath);
  assert.equal(probe.available, true);
  assert.equal(probe.status, "available");
  assert.match(probe.version, /^v\d+/);
});

test("Codex CLI probe reports a missing executable without treating it as configured", async () => {
  const probe = await probeCodexCli("plutonix-codex-bin-that-does-not-exist");
  assert.equal(probe.available, false);
  assert.equal(probe.status, "unavailable");
});
