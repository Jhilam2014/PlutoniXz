import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import test from "node:test";
import {
  CODEX_RUNTIME_FAILURES,
  activeCodexExecutionCount,
  createJsonlParser,
  executeCodex,
  probeCodexAuthentication,
  probeCodexRuntime,
  probeCodexVersion,
  publicCodexEvent,
  redactCodexText,
  resetCodexRuntimeForTests,
  shutdownCodexRuntime,
  validateCodexWorkspace
} from "../src/codexRuntime.js";

async function fixture(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-codex-runtime-"));
  const managedRoot = path.join(root, "projects");
  const workspace = path.join(managedRoot, "project-a");
  const bin = path.join(root, "fake-codex.mjs");
  await fs.ensureDir(workspace);
  await fs.writeFile(bin, `#!/usr/bin/env node
const mode = process.env.FAKE_CODEX_MODE || "success";
const args = process.argv.slice(2);
if (args[0] === "--version") {
  if (mode === "version-fail") process.exit(2);
  process.stdout.write("codex-cli 9.9.9\\n");
  process.exit(0);
}
if (args[0] === "login" && args[1] === "status") {
  if (mode === "auth-missing") {
    process.stderr.write("Not logged in\\n");
    process.exit(1);
  }
  process.stdout.write("Logged in using ChatGPT\\n");
  process.exit(0);
}
if (mode === "split") {
  process.stdout.write('{"type":"thread.started","thread_id":"thread-1"}\\n{"type":"item.completed","item":{"type":"agent_');
  setTimeout(() => { process.stdout.write('message","text":"done"}}\\n'); }, 15);
} else if (mode === "multi") {
  process.stdout.write('{"type":"turn.started"}\\n{"type":"item.completed","item":{"type":"agent_message","text":"complete"}}\\n');
} else if (mode === "malformed") {
  process.stdout.write('not-json\\n');
} else if (mode === "mixed-malformed") {
  process.stdout.write('not-json\\n{"type":"turn.completed"}\\n');
} else if (mode === "nonzero") {
  process.stderr.write('request failed with Bearer secret-token and sk-test-secret-value\\n');
  process.exit(7);
} else if (mode === "auth-exec") {
  process.stderr.write('authentication required; not logged in\\n');
  process.exit(1);
} else if (mode === "wait") {
  process.stdout.write('{"type":"turn.started"}\\n');
  setInterval(() => {}, 1000);
} else {
  process.stdout.write('{"type":"item.completed","item":{"type":"command_execution","command":"npm test","status":"completed"}}\\n');
  process.stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"Task complete"}}\\n');
}
`);
  await fs.chmod(bin, 0o755);
  context.after(async () => {
    resetCodexRuntimeForTests();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, managedRoot, workspace, bin };
}

function executionOptions(fx, mode, extra = {}) {
  return {
    command: fx.bin,
    args: ["exec", "--json", "task"],
    cwd: fx.workspace,
    registeredWorkspaceDirs: [fx.workspace],
    managedRoots: [fx.managedRoot],
    timeoutMs: 2000,
    env: { ...process.env, OPENAI_API_KEY: "", FAKE_CODEX_MODE: mode },
    ...extra
  };
}

test("resolves available and unavailable Codex executables and probes the version", async (context) => {
  const fx = await fixture(context);
  const available = await probeCodexVersion(fx.bin, { env: { ...process.env, FAKE_CODEX_MODE: "success" } });
  assert.equal(available.available, true);
  assert.equal(available.version, "codex-cli 9.9.9");
  const unavailable = await probeCodexVersion(path.join(fx.root, "missing-codex"));
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.category, CODEX_RUNTIME_FAILURES.MISSING_CLI);
});

test("reports authentication readiness without returning credentials", async (context) => {
  const fx = await fixture(context);
  const ready = await probeCodexAuthentication(fx.bin, { env: { ...process.env, OPENAI_API_KEY: "", FAKE_CODEX_MODE: "success" } });
  assert.equal(ready.authenticated, true);
  const missing = await probeCodexAuthentication(fx.bin, { env: { ...process.env, OPENAI_API_KEY: "", FAKE_CODEX_MODE: "auth-missing" } });
  assert.equal(missing.authenticated, false);
  assert.equal(missing.status, "authentication_required");
  assert.match(missing.error, /codex login --device-auth/);
  assert.doesNotMatch(JSON.stringify(missing), /secret-token/);
});

test("returns the safe backend-managed status contract with no VS Code dependency", async (context) => {
  const fx = await fixture(context);
  const status = await probeCodexRuntime({ command: fx.bin, env: { ...process.env, OPENAI_API_KEY: "", FAKE_CODEX_MODE: "success" } });
  assert.deepEqual({
    transport: status.transport,
    available: status.available,
    authenticated: status.authenticated,
    version: status.version,
    runtimeManagedBy: status.runtimeManagedBy,
    requiresVsCode: status.requiresVsCode
  }, {
    transport: "cli",
    available: true,
    authenticated: true,
    version: "codex-cli 9.9.9",
    runtimeManagedBy: "plutomix-backend",
    requiresVsCode: false
  });
});

test("buffers split JSONL chunks and parses several events in one chunk", async () => {
  const events = [];
  const parser = createJsonlParser({ onEvent: (event) => events.push(event) });
  parser.push('{"type":"turn.st');
  parser.push('arted"}\n{"type":"turn.completed"}\n');
  assert.deepEqual(parser.finish(), { validEvents: 2, malformedEvents: 0 });
  assert.deepEqual(events.map((event) => event.type), ["turn.started", "turn.completed"]);
});

test("ignores malformed lines safely while preserving valid JSONL events", async () => {
  const events = [];
  const malformed = [];
  const parser = createJsonlParser({ onEvent: (event) => events.push(event), onMalformed: (event) => malformed.push(event) });
  parser.push('not-json\n{"type":"turn.completed"}\n');
  assert.deepEqual(parser.finish(), { validEvents: 1, malformedEvents: 1 });
  assert.equal(events[0].type, "turn.completed");
  assert.equal(malformed.length, 1);
  assert.equal("line" in malformed[0], false);
});

test("maps only safe public events and excludes private reasoning", () => {
  assert.equal(publicCodexEvent({ type: "item.completed", item: { type: "reasoning", text: "private chain" } }), null);
  assert.deepEqual(publicCodexEvent({ type: "item.completed", item: { type: "file_change", changes: [{ path: "src/App.jsx" }] } }), {
    type: "codex-file-change",
    message: "Changed src/App.jsx",
    paths: ["src/App.jsx"],
    codexEventType: "item.completed"
  });
});

test("executes successfully and returns final message and thread metadata", async (context) => {
  const fx = await fixture(context);
  const events = [];
  const result = await executeCodex(executionOptions(fx, "split", { onEvent: (event) => events.push(event) }));
  assert.equal(result.code, 0);
  assert.equal(result.threadId, "thread-1");
  assert.equal(result.finalResponse, "done");
  assert.deepEqual(events.map((event) => event.type), ["codex-thread-started", "codex-message"]);
});

test("classifies non-zero exits and redacts diagnostic secrets", async (context) => {
  const fx = await fixture(context);
  await assert.rejects(executeCodex(executionOptions(fx, "nonzero")), (error) => {
    assert.equal(error.category, CODEX_RUNTIME_FAILURES.NON_ZERO_EXIT);
    assert.equal(error.exitCode, 7);
    assert.doesNotMatch(error.message, /secret-token|sk-test-secret-value/);
    return true;
  });
  assert.doesNotMatch(redactCodexText("Authorization: Bearer abcdefgh sk-test-secret-value"), /abcdefgh|sk-test-secret-value/);
});

test("classifies missing authentication during execution", async (context) => {
  const fx = await fixture(context);
  await assert.rejects(
    executeCodex(executionOptions(fx, "auth-exec")),
    (error) => error.category === CODEX_RUNTIME_FAILURES.AUTHENTICATION_REQUIRED && /device-auth/.test(error.message)
  );
});

test("times out and cleans up the child process", async (context) => {
  const fx = await fixture(context);
  await assert.rejects(
    executeCodex(executionOptions(fx, "wait", { timeoutMs: 50 })),
    (error) => error.category === CODEX_RUNTIME_FAILURES.TIMEOUT
  );
  assert.equal(activeCodexExecutionCount(), 0);
});

test("cancels through AbortSignal and cleans up the child process", async (context) => {
  const fx = await fixture(context);
  const controller = new AbortController();
  const execution = executeCodex(executionOptions(fx, "wait", { signal: controller.signal }));
  setTimeout(() => controller.abort(), 25);
  await assert.rejects(execution, (error) => error.category === CODEX_RUNTIME_FAILURES.CANCELLED);
  assert.equal(activeCodexExecutionCount(), 0);
});

test("stops active children during backend shutdown", async (context) => {
  const fx = await fixture(context);
  const execution = executeCodex(executionOptions(fx, "wait"));
  const rejected = assert.rejects(execution, (error) => error.category === CODEX_RUNTIME_FAILURES.SHUTDOWN);
  while (activeCodexExecutionCount() === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  const shutdown = await shutdownCodexRuntime({ graceMs: 1000 });
  assert.equal(shutdown.stopped, 1);
  await rejected;
  assert.equal(activeCodexExecutionCount(), 0);
});

test("rejects traversal and symlink escape outside managed roots", async (context) => {
  const fx = await fixture(context);
  const outside = path.join(fx.root, "outside");
  const symlink = path.join(fx.managedRoot, "escaped-project");
  await fs.ensureDir(outside);
  await fs.symlink(outside, symlink);
  await assert.rejects(
    validateCodexWorkspace({ workspaceDir: path.join(fx.managedRoot, "..", "outside"), registeredWorkspaceDirs: [outside], managedRoots: [fx.managedRoot] }),
    (error) => error.category === CODEX_RUNTIME_FAILURES.WORKSPACE_INVALID
  );
  await assert.rejects(
    validateCodexWorkspace({ workspaceDir: symlink, registeredWorkspaceDirs: [symlink], managedRoots: [fx.managedRoot] }),
    (error) => error.category === CODEX_RUNTIME_FAILURES.WORKSPACE_INVALID
  );
});

test("rejects concurrent execution for the same canonical project", async (context) => {
  const fx = await fixture(context);
  const first = executeCodex(executionOptions(fx, "wait"));
  const firstRejected = assert.rejects(first, (error) => error.category === CODEX_RUNTIME_FAILURES.SHUTDOWN);
  while (activeCodexExecutionCount() === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(
    executeCodex(executionOptions(fx, "success")),
    (error) => error.category === CODEX_RUNTIME_FAILURES.CONCURRENT_EXECUTION
  );
  await shutdownCodexRuntime({ graceMs: 1000 });
  await firstRejected;
});

test("fails a successful process whose stdout contains only malformed JSONL", async (context) => {
  const fx = await fixture(context);
  await assert.rejects(
    executeCodex(executionOptions(fx, "malformed")),
    (error) => error.category === CODEX_RUNTIME_FAILURES.MALFORMED_EVENTS
  );
  const mixed = await executeCodex(executionOptions(fx, "mixed-malformed"));
  assert.equal(mixed.validEvents, 1);
  assert.equal(mixed.malformedEvents, 1);
});
