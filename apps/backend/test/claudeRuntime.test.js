import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import fs from "fs-extra";
import test from "node:test";
import {
  CLAUDE_EXECUTION_MODES,
  CLAUDE_RUNTIME_FAILURES,
  activeClaudeExecutionCount,
  cancelClaudeExecution,
  createClaudeStreamParser,
  executeClaude,
  probeClaudeAuthentication,
  probeClaudeSandboxReadiness,
  probeClaudeVersion,
  publicClaudeEvent,
  resetClaudeRuntimeForTests
} from "../src/claudeRuntime.js";

async function fixture(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-claude-runtime-test-"));
  const managedRoot = path.join(root, "projects");
  const workspace = path.join(managedRoot, "project-a");
  const configDir = path.join(root, "profiles", "claude", "profile-a");
  const command = path.join(root, "claude");
  await fs.ensureDir(workspace);
  await fs.ensureDir(configDir);
  await fs.symlink(process.execPath, command);
  const runtime = {
    providerId: "claude",
    profileId: "profile-a",
    workspaceId: "workspace-a",
    command,
    env: {
      PATH: path.dirname(process.execPath),
      HOME: root,
      CLAUDE_CONFIG_DIR: configDir,
      ANTHROPIC_API_KEY: "sk-ant-test-parent-only",
      DATABASE_URL: "postgres://must-not-propagate",
      OPENAI_API_KEY: "must-not-propagate"
    }
  };
  context.after(async () => {
    resetClaudeRuntimeForTests();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, managedRoot, workspace, configDir, command, runtime };
}

function mockChild({ stdout = "", stderr = "", code = 0, hold = false, closeOnTerm = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.exitCode = null;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === "SIGTERM" && !closeOnTerm) return true;
    queueMicrotask(() => child.emit("close", null, signal));
    return true;
  };
  if (!hold) queueMicrotask(() => {
    if (stdout) child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    child.stdout.end();
    child.stderr.end();
    child.exitCode = code;
    child.emit("close", code, null);
  });
  return child;
}

function resultStream(overrides = {}) {
  const result = {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Final answer",
    session_id: "session-123",
    duration_ms: 1200,
    duration_api_ms: 900,
    total_cost_usd: 0.0123,
    num_turns: 3,
    usage: { input_tokens: 10, output_tokens: 5, ignored_future_field: "private" },
    ...overrides
  };
  return `${JSON.stringify({ type: "system", subtype: "init", session_id: "session-123" })}\n${JSON.stringify(result)}\n`;
}

function executionOptions(fx, extra = {}) {
  return {
    runtime: fx.runtime,
    prompt: "Complete the selected workspace task.",
    cwd: fx.workspace,
    registeredWorkspaceDirs: [fx.workspace],
    managedRoots: [fx.managedRoot],
    timeoutMs: 1000,
    terminationGraceMs: 20,
    configurationEnv: {
      HOME: fx.root,
      CLAUDE_WORKFLOW_TIMEOUT_MS: "600000",
      CLAUDE_WORKFLOW_MAX_TURNS: "7",
      PLUTOMIX_BACKEND_CONTAINER: "plutomix-backend"
    },
    platform: "linux",
    ...extra
  };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for Claude runtime state.");
}

test("uses the exact fixed argv, no shell, exact cwd, and a bounded profile environment", async (context) => {
  const fx = await fixture(context);
  let invocation;
  let bashEnvironment = "";
  const events = [];
  const spawnFactory = (command, args, options) => {
    invocation = { command, args, options };
    bashEnvironment = nodeFs.readFileSync(options.env.BASH_ENV, "utf8");
    return mockChild({
      stdout: [
        JSON.stringify({ type: "system", subtype: "init", session_id: "session-123" }),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "cat secret" } }] } }),
        JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "raw private output" }] } }),
        JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Done", session_id: "session-123" })
      ].join("\n") + "\n"
    });
  };
  const result = await executeClaude(executionOptions(fx, {
    selectedModel: "claude-sonnet-4-6",
    spawnFactory,
    onEvent: (event) => events.push(event)
  }));

  assert.equal(invocation.command, fx.command);
  const settingsIndex = invocation.args.indexOf("--settings");
  const settings = JSON.parse(invocation.args[settingsIndex + 1]);
  const normalizedArgs = [...invocation.args];
  normalizedArgs[settingsIndex + 1] = "<backend-owned-json>";
  assert.deepEqual(normalizedArgs, [
    "-p", "Complete the selected workspace task.",
    "--output-format", "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--restricted",
    "--strict-mcp-config",
    "--no-chrome",
    "--tools", "Read,Glob,Grep,Edit,Write,Bash",
    "--permission-mode", "acceptEdits",
    "--settings", "<backend-owned-json>",
    "--model", "claude-sonnet-4-6",
    "--max-turns", "7"
  ]);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.cwd, await fs.realpath(fx.workspace));
  assert.equal(invocation.options.env.CLAUDE_CONFIG_DIR, fx.configDir);
  assert.equal(invocation.options.env.ANTHROPIC_API_KEY, "sk-ant-test-parent-only");
  assert.equal(invocation.options.env.DATABASE_URL, undefined);
  assert.equal(invocation.options.env.OPENAI_API_KEY, undefined);
  assert.match(bashEnvironment, /unset ANTHROPIC_API_KEY/);
  assert.match(bashEnvironment, /unset CLAUDE_CODE_OAUTH_TOKEN/);
  assert.equal(settings.sandbox.enabled, true);
  assert.equal(settings.sandbox.failIfUnavailable, true);
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
  assert.equal(settings.sandbox.enableWeakerNestedSandbox, true);
  assert.deepEqual(settings.sandbox.network.allowedDomains, []);
  assert.ok(settings.sandbox.filesystem.denyRead.includes(await fs.realpath(fx.configDir)));
  assert.ok(settings.sandbox.filesystem.denyRead.includes("/proc"));
  assert.ok(settings.sandbox.filesystem.allowWrite.includes(await fs.realpath(fx.workspace)));
  assert.ok(settings.sandbox.filesystem.allowWrite.some((entry) => entry.includes("plutomix-claude-runtime-")));
  assert.ok(!invocation.args.includes("--dangerously-skip-permissions"));
  assert.ok(!invocation.args.includes("bypassPermissions"));
  assert.ok(!invocation.args.includes("WebFetch"));
  assert.equal(result.finalResponse, "Done");
  assert.doesNotMatch(JSON.stringify({ result, events }), /cat secret|raw private output|sk-ant-test-parent-only|backend-owned-json/);
});

test("omits the model flag unless a backend-valid model identifier is supplied", async (context) => {
  const fx = await fixture(context);
  let args;
  await executeClaude(executionOptions(fx, {
    spawnFactory: (_command, observedArgs) => {
      args = observedArgs;
      return mockChild({ stdout: resultStream() });
    }
  }));
  assert.equal(args.includes("--model"), false);
  await assert.rejects(
    executeClaude(executionOptions(fx, { selectedModel: "sonnet; rm -rf workspace" })),
    (error) => error.category === CLAUDE_RUNTIME_FAILURES.INVALID_REQUEST
  );
});

test("probes the pinned version and parses documented authentication JSON without exposing profile paths", async (context) => {
  const fx = await fixture(context);
  const observedArgs = [];
  const spawnFactory = (_command, args) => {
    observedArgs.push(args);
    if (args[0] === "--version") return mockChild({ stdout: "2.1.251 (Claude Code)\n" });
    return mockChild({ stdout: JSON.stringify({ loggedIn: true, authMethod: "oauth", apiProvider: "firstParty", projectsDirectory: fx.configDir }) });
  };
  const version = await probeClaudeVersion(fx.runtime, { spawnFactory });
  const auth = await probeClaudeAuthentication(fx.runtime, { spawnFactory });
  assert.deepEqual(observedArgs, [["--version"], ["auth", "status"]]);
  assert.equal(version.version, "2.1.251 (Claude Code)");
  assert.deepEqual(auth, { authenticated: true, status: "ready", authMethod: "oauth", apiProvider: "firstParty", error: "" });
  assert.doesNotMatch(JSON.stringify({ version, auth }), new RegExp(fx.configDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("preflights fail-closed settings and both required Linux sandbox dependencies without a model call", async (context) => {
  const fx = await fixture(context);
  const dependencyDir = path.join(fx.root, "sandbox-bin");
  await fs.ensureDir(dependencyDir);
  await fs.symlink(process.execPath, path.join(dependencyDir, "bwrap"));
  await fs.symlink(process.execPath, path.join(dependencyDir, "socat"));
  const ready = await probeClaudeSandboxReadiness(fx.runtime, {
    workspaceDir: fx.workspace,
    registeredWorkspaceDirs: [fx.workspace],
    managedRoots: [fx.managedRoot],
    configurationEnv: { PATH: dependencyDir, HOME: fx.root, PLUTOMIX_BACKEND_CONTAINER: "plutomix-backend" },
    platform: "linux"
  });
  assert.deepEqual(ready, {
    status: "ready",
    component: "claude_restricted_sandbox",
    failureClass: "",
    reason: "",
    dependencies: { bubblewrap: true, socat: true },
    failClosed: true
  });
  await fs.rm(path.join(dependencyDir, "socat"));
  const unavailable = await probeClaudeSandboxReadiness(fx.runtime, {
    workspaceDir: fx.workspace,
    registeredWorkspaceDirs: [fx.workspace],
    managedRoots: [fx.managedRoot],
    configurationEnv: { PATH: dependencyDir, HOME: fx.root },
    platform: "linux"
  });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.failureClass, CLAUDE_RUNTIME_FAILURES.SANDBOX_UNAVAILABLE);
  assert.deepEqual(unavailable.dependencies, { bubblewrap: true, socat: false });
});

test("reports authentication probe and execution failures safely", async (context) => {
  const fx = await fixture(context);
  const probe = await probeClaudeAuthentication(fx.runtime, {
    spawnFactory: () => mockChild({ code: 1, stdout: JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty", projectsDirectory: fx.configDir }) })
  });
  assert.equal(probe.authenticated, false);
  assert.equal(probe.status, "authentication_required");

  await assert.rejects(
    executeClaude(executionOptions(fx, {
      spawnFactory: () => mockChild({ code: 1, stderr: `Authentication required for ${fx.configDir}; sk-ant-secret-value` })
    })),
    (error) => {
      assert.equal(error.category, CLAUDE_RUNTIME_FAILURES.AUTHENTICATION_REQUIRED);
      assert.doesNotMatch(error.message, /sk-ant-secret-value|profiles/);
      return true;
    }
  );
});

test("parses incremental JSON events, ignores unknown types, and bounds malformed evidence", () => {
  const events = [];
  const malformed = [];
  const parser = createClaudeStreamParser({
    malformedThreshold: 1,
    onEvent: (event) => events.push(event),
    onMalformed: (event) => malformed.push(event)
  });
  parser.push('{"type":"sys');
  parser.push('tem","subtype":"init"}\nnot-json\n{"type":"future_event","private":"ignored"}\n');
  parser.push('still-not-json\n');
  assert.deepEqual(parser.finish(), { validEvents: 2, malformedEvents: 2, thresholdExceeded: true });
  assert.deepEqual(events.map((event) => event.type), ["system", "future_event"]);
  assert.equal(publicClaudeEvent(events[1]), null);
  assert.equal(malformed.length, 2);
  assert.equal("line" in malformed[0], false);
});

test("extracts only the final response and bounded usage metadata", async (context) => {
  const fx = await fixture(context);
  const result = await executeClaude(executionOptions(fx, {
    spawnFactory: () => mockChild({ stdout: resultStream() })
  }));
  assert.deepEqual(result, {
    code: 0,
    finalResponse: "Final answer",
    sessionId: "session-123",
    usage: { input_tokens: 10, output_tokens: 5 },
    durationMs: 1200,
    durationApiMs: 900,
    totalCostUsd: 0.0123,
    numTurns: 3,
    validEvents: 2,
    malformedEvents: 0,
    thresholdExceeded: false
  });
});

test("classifies non-zero exits without returning stderr or raw process details", async (context) => {
  const fx = await fixture(context);
  const diagnostics = [];
  await assert.rejects(
    executeClaude(executionOptions(fx, {
      spawnFactory: () => mockChild({ code: 9, stderr: "provider failed with sk-ant-private-value" }),
      onStderr: (message) => diagnostics.push(message)
    })),
    (error) => {
      assert.equal(error.category, CLAUDE_RUNTIME_FAILURES.NON_ZERO_EXIT);
      assert.equal(error.exitCode, 9);
      assert.doesNotMatch(JSON.stringify(error), /sk-ant-private-value|--settings|CLAUDE_CONFIG_DIR/);
      return true;
    }
  );
  assert.deepEqual(diagnostics, ["Claude reported a runtime diagnostic."]);
});

test("fails closed when the Claude sandbox is unavailable", async (context) => {
  const fx = await fixture(context);
  await assert.rejects(
    executeClaude(executionOptions(fx, {
      spawnFactory: () => mockChild({ code: 1, stderr: "Sandboxing unavailable: bwrap could not start" })
    })),
    (error) => error.category === CLAUDE_RUNTIME_FAILURES.SANDBOX_UNAVAILABLE
  );
});

test("enforces read-only and workspace-write tool and filesystem modes", async (context) => {
  const fx = await fixture(context);
  const invocations = [];
  const spawnFactory = (_command, args) => {
    invocations.push(args);
    return mockChild({ stdout: resultStream() });
  };
  await executeClaude(executionOptions(fx, { mode: CLAUDE_EXECUTION_MODES.WRITE, spawnFactory }));
  await executeClaude(executionOptions(fx, { mode: CLAUDE_EXECUTION_MODES.READ_ONLY, spawnFactory }));
  const writeTools = invocations[0][invocations[0].indexOf("--tools") + 1];
  const readTools = invocations[1][invocations[1].indexOf("--tools") + 1];
  const writeSettings = JSON.parse(invocations[0][invocations[0].indexOf("--settings") + 1]);
  const readSettings = JSON.parse(invocations[1][invocations[1].indexOf("--settings") + 1]);
  assert.equal(writeTools, "Read,Glob,Grep,Edit,Write,Bash");
  assert.equal(readTools, "Read,Glob,Grep,Bash");
  const canonicalWorkspace = await fs.realpath(fx.workspace);
  assert.equal(writeSettings.sandbox.filesystem.denyWrite.includes(canonicalWorkspace), false);
  assert.equal(readSettings.sandbox.filesystem.denyWrite.includes(canonicalWorkspace), true);
  assert.ok(readSettings.permissions.deny.includes("Edit"));
  assert.ok(readSettings.permissions.deny.includes("Write"));
});

test("uses a strong sandbox outside the marked Linux backend container", async (context) => {
  const fx = await fixture(context);
  let settings;
  await executeClaude(executionOptions(fx, {
    configurationEnv: { HOME: fx.root, CLAUDE_WORKFLOW_MAX_TURNS: "40" },
    platform: "linux",
    spawnFactory: (_command, args) => {
      settings = JSON.parse(args[args.indexOf("--settings") + 1]);
      return mockChild({ stdout: resultStream() });
    }
  }));
  assert.equal("enableWeakerNestedSandbox" in settings.sandbox, false);
});

test("applies an inactivity timeout and cleans up active execution ownership", async (context) => {
  const fx = await fixture(context);
  const child = mockChild({ hold: true });
  await assert.rejects(
    executeClaude(executionOptions(fx, { timeoutMs: 30, spawnFactory: () => child })),
    (error) => error.category === CLAUDE_RUNTIME_FAILURES.TIMEOUT
  );
  assert.deepEqual(child.signals, ["SIGTERM"]);
  assert.equal(activeClaudeExecutionCount(), 0);
});

test("AbortSignal escalates TERM to KILL when the child does not stop", async (context) => {
  const fx = await fixture(context);
  const controller = new AbortController();
  const child = mockChild({ hold: true, closeOnTerm: false });
  const execution = executeClaude(executionOptions(fx, {
    signal: controller.signal,
    timeoutMs: 1000,
    terminationGraceMs: 10,
    spawnFactory: () => child
  }));
  await waitFor(() => activeClaudeExecutionCount() === 1);
  controller.abort();
  await assert.rejects(execution, (error) => error.category === CLAUDE_RUNTIME_FAILURES.CANCELLED);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(activeClaudeExecutionCount(), 0);
});

test("malformed events remain nonfatal until the configured threshold is exceeded", async (context) => {
  const fx = await fixture(context);
  const oneMalformed = await executeClaude(executionOptions(fx, {
    malformedThreshold: 1,
    spawnFactory: () => mockChild({ stdout: `not-json\n${resultStream()}` })
  }));
  assert.equal(oneMalformed.malformedEvents, 1);
  await assert.rejects(
    executeClaude(executionOptions(fx, {
      malformedThreshold: 1,
      spawnFactory: () => mockChild({ stdout: `bad-one\nbad-two\n${resultStream()}` })
    })),
    (error) => error.category === CLAUDE_RUNTIME_FAILURES.MALFORMED_EVENTS
  );
});

test("concurrent execution cancellation is isolated by provider, profile, and workspace", async (context) => {
  const fx = await fixture(context);
  const firstChild = mockChild({ hold: true });
  const secondChild = mockChild({ hold: true });
  const first = executeClaude(executionOptions(fx, { spawnFactory: () => firstChild }));
  const secondRuntime = { ...fx.runtime, profileId: "profile-b" };
  const second = executeClaude(executionOptions(fx, { runtime: secondRuntime, spawnFactory: () => secondChild }));
  await waitFor(() => activeClaudeExecutionCount() === 2);

  assert.equal(cancelClaudeExecution({ providerId: "claude", profileId: "another-profile", workspaceId: "workspace-a" }), false);
  assert.deepEqual(firstChild.signals, []);
  assert.deepEqual(secondChild.signals, []);
  assert.equal(cancelClaudeExecution({ providerId: "claude", profileId: "profile-a", workspaceId: "workspace-a" }), true);
  await assert.rejects(first, (error) => error.category === CLAUDE_RUNTIME_FAILURES.CANCELLED);
  assert.deepEqual(firstChild.signals, ["SIGTERM"]);
  assert.deepEqual(secondChild.signals, []);
  assert.equal(activeClaudeExecutionCount(), 1);
  assert.equal(cancelClaudeExecution({ providerId: "claude", profileId: "profile-b", workspaceId: "workspace-a" }), true);
  await assert.rejects(second, (error) => error.category === CLAUDE_RUNTIME_FAILURES.CANCELLED);
  assert.deepEqual(secondChild.signals, ["SIGTERM"]);
  assert.equal(activeClaudeExecutionCount(), 0);
});
