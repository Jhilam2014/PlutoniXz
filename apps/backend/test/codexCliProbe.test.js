import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import test from "node:test";
import { copilotCliArgsForPrompt, parseCompletionCheckResult, probeCodexCli, probeCopilotCli, resolveGothamRuntime } from "../src/codexWorkflow.js";

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

test("Copilot CLI probe reports availability when Codex is unavailable", async () => {
  const probe = await probeCopilotCli();
  assert.equal(typeof probe.available, "boolean");
  if (probe.available) {
    assert.equal(probe.status, "available");
    assert.equal(typeof probe.version, "string");
  } else {
    assert.equal(probe.status, "unavailable");
  }
});

test("runtime resolver prefers Copilot when Codex is unavailable", () => {
  const resolved = resolveGothamRuntime({
    codexBin: "missing-codex",
    codexProbe: { available: false, status: "unavailable", version: "" },
    copilotProbe: { available: true, status: "available", version: "gh copilot" }
  });

  assert.deepEqual(resolved, {
    kind: "copilot",
    bin: "copilot",
    probe: { available: true, status: "available", version: "gh copilot", command: "copilot" }
  });
});

test("Copilot CLI probing supports a direct copilot binary and uses the correct invocation contract", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-copilot-probe-"));
  const fakeBin = path.join(tempDir, "copilot");
  await fs.writeFile(fakeBin, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--help\" ]; then",
    "  printf '%s\\n' 'Runs the GitHub Copilot CLI'",
    "  exit 0",
    "fi",
    "exit 1"
  ].join("\n"));
  await fs.chmod(fakeBin, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${tempDir}${path.delimiter}${previousPath}`;

  try {
    const result = await probeCopilotCli(2000);
    assert.equal(result.available, true);
    assert.match(result.version, /GitHub Copilot CLI/i);
    assert.deepEqual(copilotCliArgsForPrompt("hello there"), [
      "-p",
      "hello there",
      "--model",
      "auto",
      "--allow-all-tools"
    ]);
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("repair completion checks parse pass and fail verdicts", () => {
  assert.deepEqual(parseCompletionCheckResult("PLUTONIX_COMPLETION_CHECK: PASS\nPLUTONIX_REVIEW: PASS"), {
    pass: true,
    status: "PASS",
    reason: ""
  });

  assert.deepEqual(parseCompletionCheckResult("PLUTONIX_COMPLETION_CHECK: FAIL: still missing expected route\nPLUTONIX_REVIEW: FAIL: route missing"), {
    pass: false,
    status: "FAIL",
    reason: "still missing expected route"
  });

  assert.equal(parseCompletionCheckResult("no marker here").pass, false);
});
