import { spawn } from "node:child_process";
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { redactOperational } from "./operationalSecurity.js";

export const CODEX_RUNTIME_FAILURES = Object.freeze({
  MISSING_CLI: "missing_cli",
  AUTHENTICATION_REQUIRED: "unauthenticated_cli",
  TIMEOUT: "workflow_timeout",
  MODEL_INCOMPATIBLE: "codex_cli_model_incompatible",
  CANCELLED: "user_cancelled",
  MALFORMED_EVENTS: "malformed_events",
  NON_ZERO_EXIT: "non_zero_exit",
  WORKSPACE_INVALID: "workspace_invalid",
  CONCURRENT_EXECUTION: "concurrent_execution",
  SHUTDOWN: "server_shutdown"
});

const activeExecutions = new Map();
const MAX_RETAINED_STDOUT_CHARS = 4 * 1024 * 1024;
const MAX_RETAINED_STDERR_CHARS = 256 * 1024;
let shuttingDown = false;

function appendTail(current, chunk, maxChars) {
  const combined = `${current}${String(chunk || "")}`;
  return combined.length > maxChars ? combined.slice(-maxChars) : combined;
}

export class CodexRuntimeError extends Error {
  constructor(message, { category, code = category, exitCode = null, signal = "", details = {} } = {}) {
    super(message);
    this.name = "CodexRuntimeError";
    this.code = code;
    this.category = category;
    this.failureClass = category;
    this.workflowFailureClass = category;
    this.exitCode = exitCode;
    this.signal = signal;
    this.details = details;
  }
}

export function codexProcessEnvironment(env = process.env) {
  const nodeDirectory = path.dirname(process.execPath || "");
  const pathEntries = String(env.PATH || "").split(path.delimiter).filter(Boolean);
  if (nodeDirectory && !pathEntries.includes(nodeDirectory)) pathEntries.unshift(nodeDirectory);
  return {
    ...env,
    PATH: pathEntries.join(path.delimiter),
    CI: "1",
    NO_COLOR: "1"
  };
}

export function redactCodexText(value, maxLength = 1200) {
  const redacted = String(redactOperational(String(value || "")))
    .replace(/\b(?:sk|sess|key)-[A-Za-z0-9_.-]{8,}\b/gi, "<redacted>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/([?&](?:access_token|api_key|token|key)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/\s+/g, " ")
    .trim();
  return redacted.slice(0, maxLength);
}

function runtimeError(category, message, details = {}) {
  return new CodexRuntimeError(message, { category, details });
}

async function executableCandidate(command, env = process.env) {
  const configured = String(command || "").trim();
  if (!configured) return "";
  if (path.isAbsolute(configured) || configured.includes(path.sep)) return path.resolve(configured);
  for (const entry of String(env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(entry, configured);
    try {
      await fs.access(candidate, nodeFs.constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH without exposing the searched host directories.
    }
  }
  return "";
}

export async function resolveCodexExecutable(command = process.env.CODEX_BIN || "codex", { env = process.env } = {}) {
  const candidate = await executableCandidate(command, env);
  if (!candidate) {
    throw runtimeError(
      CODEX_RUNTIME_FAILURES.MISSING_CLI,
      "Codex CLI is unavailable. Install @openai/codex and configure CODEX_BIN to its executable."
    );
  }
  try {
    const resolved = await fs.realpath(candidate);
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) throw new Error("not a file");
    await fs.access(resolved, nodeFs.constants.X_OK);
    return resolved;
  } catch {
    throw runtimeError(
      CODEX_RUNTIME_FAILURES.MISSING_CLI,
      "Codex CLI is unavailable. Install @openai/codex and configure CODEX_BIN to its executable."
    );
  }
}

function safeSpawn(command, args, options) {
  return spawn(command, args, {
    ...options,
    shell: false,
    windowsHide: true
  });
}

async function runProbe(command, args, { timeoutMs = 8000, env = process.env } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    let stdout = "";
    let stderr = "";
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child;
    try {
      child = safeSpawn(command, args, {
        env: codexProcessEnvironment(env),
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      finish({ code: null, timedOut: false, error: redactCodexText(error.message) });
      return;
    }
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 1000);
      killTimer.unref?.();
      finish({ code: null, timedOut: true, stdout: "", stderr: "" });
    }, Math.max(250, timeoutMs));
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout = appendTail(stdout, chunk, 16 * 1024); });
    child.stderr?.on("data", (chunk) => { stderr = appendTail(stderr, chunk, 16 * 1024); });
    child.on("error", (error) => finish({ code: null, timedOut: false, error: redactCodexText(error.message) }));
    child.on("close", (code, signal) => finish({
      code,
      signal: signal || "",
      timedOut: false,
      stdout: redactCodexText(stdout, 2000),
      stderr: redactCodexText(stderr, 2000)
    }));
  });
}

export async function probeCodexVersion(command = process.env.CODEX_BIN || "codex", options = {}) {
  let resolvedBin;
  try {
    resolvedBin = await resolveCodexExecutable(command, options);
  } catch (error) {
    return { available: false, status: "unavailable", version: "", error: error.message, category: error.category };
  }
  const result = await runProbe(resolvedBin, ["--version"], options);
  if (result.timedOut) return { available: false, status: "version_check_timed_out", version: "", resolvedBin };
  if (result.code !== 0) {
    return { available: false, status: "version_check_failed", version: "", resolvedBin, error: result.stderr || result.error || "Codex version probe failed." };
  }
  return { available: true, status: "available", version: result.stdout, resolvedBin };
}

export async function probeCodexAuthentication(command = process.env.CODEX_BIN || "codex", options = {}) {
  let resolvedBin;
  try {
    resolvedBin = await resolveCodexExecutable(command, options);
  } catch (error) {
    return { authenticated: false, status: "unavailable", mode: "", error: error.message, category: error.category };
  }
  const env = options.env || process.env;
  if (String(env.OPENAI_API_KEY || "").trim()) {
    return { authenticated: true, status: "ready", mode: "api_key", resolvedBin };
  }
  const result = await runProbe(resolvedBin, ["login", "status"], options);
  const combined = `${result.stdout || ""} ${result.stderr || ""}`.trim();
  if (result.code === 0 && !/not logged in|login required|unauthenticated/i.test(combined)) {
    return { authenticated: true, status: "ready", mode: /chatgpt/i.test(combined) ? "chatgpt" : "codex_login", resolvedBin };
  }
  if (result.timedOut) {
    return { authenticated: false, status: "unavailable", mode: "", resolvedBin, error: "Codex authentication probe timed out." };
  }
  return {
    authenticated: false,
    status: "authentication_required",
    mode: "",
    resolvedBin,
    error: "Codex authentication is required. Run `codex login --device-auth` once on the host."
  };
}

export async function probeCodexRuntime({ command = process.env.CODEX_BIN || "codex", timeoutMs = 8000, env = process.env } = {}) {
  const version = await probeCodexVersion(command, { timeoutMs, env });
  if (!version.available) {
    return {
      transport: "cli",
      available: false,
      authenticated: false,
      authenticationStatus: "unavailable",
      version: version.version || "",
      runtimeManagedBy: "plutomix-backend",
      requiresVsCode: false,
      error: version.error || "Codex CLI is unavailable."
    };
  }
  const authentication = await probeCodexAuthentication(version.resolvedBin, { timeoutMs, env });
  return {
    transport: "cli",
    available: true,
    authenticated: authentication.authenticated,
    authenticationStatus: authentication.status,
    version: version.version,
    runtimeManagedBy: "plutomix-backend",
    requiresVsCode: false,
    error: authentication.error || ""
  };
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function validateCodexWorkspace({ workspaceDir, registeredWorkspaceDirs = [], managedRoots = [] } = {}) {
  if (!String(workspaceDir || "").trim()) {
    throw runtimeError(CODEX_RUNTIME_FAILURES.WORKSPACE_INVALID, "No managed project workspace was selected.");
  }
  let workspace;
  try {
    workspace = await fs.realpath(workspaceDir);
    const stat = await fs.stat(workspace);
    if (!stat.isDirectory()) throw new Error("not a directory");
    await fs.access(workspace, nodeFs.constants.R_OK | nodeFs.constants.W_OK);
  } catch {
    throw runtimeError(CODEX_RUNTIME_FAILURES.WORKSPACE_INVALID, "The selected managed project workspace is unavailable.");
  }
  const forbidden = new Set([path.parse(workspace).root, path.resolve(os.homedir())]);
  if (process.env.PLUTOMIX_WORKSPACE_ROOT) forbidden.add(path.resolve(process.env.PLUTOMIX_WORKSPACE_ROOT));
  if (forbidden.has(workspace)) {
    throw runtimeError(CODEX_RUNTIME_FAILURES.WORKSPACE_INVALID, "The selected target is not an approved project workspace.");
  }
  const registered = [];
  for (const candidate of registeredWorkspaceDirs.filter(Boolean)) {
    try {
      registered.push(await fs.realpath(candidate));
    } catch {
      // A missing registered workspace cannot authorize a different path.
    }
  }
  if (!registered.includes(workspace)) {
    throw runtimeError(CODEX_RUNTIME_FAILURES.WORKSPACE_INVALID, "The selected target is not a registered project workspace.");
  }
  const roots = [];
  for (const candidate of managedRoots.filter(Boolean)) {
    try {
      roots.push(await fs.realpath(candidate));
    } catch {
      // A missing managed root cannot authorize a path.
    }
  }
  if (roots.length && !roots.some((root) => root !== workspace && isWithin(root, workspace))) {
    throw runtimeError(CODEX_RUNTIME_FAILURES.WORKSPACE_INVALID, "The selected project resolves outside the managed workspace roots.");
  }
  return workspace;
}

function eventText(event = {}) {
  const item = event.item || {};
  return event.message || event.text || event.delta || item.text || item.message || event.result?.message || "";
}

export function publicCodexEvent(event = {}) {
  const type = String(event.type || event.event || "codex.event");
  const item = event.item || {};
  const itemType = String(item.type || "");
  if (/reasoning|chain.of.thought|analysis/i.test(type) || /reasoning|chain.of.thought|analysis/i.test(itemType)) return null;
  if (type === "thread.started") {
    return { type: "codex-thread-started", message: "Codex thread started.", threadId: String(event.thread_id || event.threadId || "").slice(0, 180), codexEventType: type };
  }
  if (type === "turn.started") return { type: "codex-running", message: "Codex is running the selected project task.", codexEventType: type };
  if (type === "turn.completed") return { type: "codex-turn-completed", message: "Codex completed the execution turn.", codexEventType: type };
  if (type === "turn.failed") return { type: "codex-failed", message: "Codex reported an execution failure.", codexEventType: type };
  if (itemType === "agent_message") {
    const message = redactCodexText(eventText(event), 4000);
    return message ? { type: "codex-message", message, finalResponse: message, codexEventType: type } : null;
  }
  if (itemType === "command_execution") {
    const status = String(item.status || event.status || (type.endsWith("completed") ? "completed" : "running"));
    const command = redactCodexText(item.command || item.name || "project command", 500);
    return { type: "codex-command", message: `${status === "completed" ? "Completed" : "Running"} command: ${command}`, activityStatus: status, codexEventType: type };
  }
  if (itemType === "file_change") {
    const paths = (item.changes || event.changes || [])
      .map((change) => String(change?.path || change?.file || "").trim())
      .filter(Boolean)
      .slice(0, 50);
    return { type: "codex-file-change", message: paths.length ? `Changed ${paths.join(", ")}` : "Codex applied project file changes.", paths, codexEventType: type };
  }
  if (/item\.(started|completed)/.test(type) && itemType) {
    return { type: "codex-progress", message: `${itemType.replaceAll("_", " ")} ${type.endsWith("completed") ? "completed" : "started"}.`, codexEventType: type };
  }
  const message = redactCodexText(eventText(event), 1000) || type.replaceAll(".", " ");
  return { type: "codex-progress", message, codexEventType: type };
}

export function createJsonlParser({ onEvent = () => {}, onMalformed = () => {} } = {}) {
  let buffer = "";
  let validEvents = 0;
  let malformedEvents = 0;
  const parseLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const event = JSON.parse(trimmed);
      validEvents += 1;
      onEvent(event);
    } catch {
      malformedEvents += 1;
      onMalformed({ lineNumber: validEvents + malformedEvents });
    }
  };
  return {
    push(chunk) {
      buffer += String(chunk || "");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) parseLine(line);
    },
    finish() {
      if (buffer.trim()) parseLine(buffer);
      buffer = "";
      return { validEvents, malformedEvents };
    },
    stats() {
      return { validEvents, malformedEvents };
    }
  };
}

function terminateChild(child, graceMs = 2500) {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, graceMs);
  timer.unref?.();
}

export function activeCodexExecutionCount() {
  return activeExecutions.size;
}

export async function executeCodex({
  command = process.env.CODEX_BIN || "codex",
  args = [],
  cwd,
  registeredWorkspaceDirs = [cwd],
  managedRoots = [],
  signal,
  timeoutMs = Number(process.env.CODEX_WORKFLOW_TIMEOUT_MS || 600000),
  env = process.env,
  onEvent = () => {},
  onMalformed = () => {},
  onStderr = () => {}
} = {}) {
  if (shuttingDown) throw runtimeError(CODEX_RUNTIME_FAILURES.SHUTDOWN, "The backend is shutting down and cannot start a Codex task.");
  if (signal?.aborted) throw runtimeError(CODEX_RUNTIME_FAILURES.CANCELLED, "Gotham workflow was stopped by the user.");
  const resolvedBin = await resolveCodexExecutable(command, { env });
  const workspace = await validateCodexWorkspace({ workspaceDir: cwd, registeredWorkspaceDirs, managedRoots });
  if (activeExecutions.has(workspace)) {
    throw runtimeError(CODEX_RUNTIME_FAILURES.CONCURRENT_EXECUTION, "A Codex execution is already active for this project workspace.");
  }
  let stdout = "";
  let stderr = "";
  let finalResponse = "";
  let threadId = "";
  let timer;
  let child;
  let timedOut = false;
  let cancelled = false;
  let shutdown = false;
  const parser = createJsonlParser({
    onEvent: (event) => {
      const publicEvent = publicCodexEvent(event);
      if (!publicEvent) return;
      if (publicEvent.finalResponse) finalResponse = publicEvent.finalResponse;
      if (publicEvent.threadId) threadId = publicEvent.threadId;
      onEvent(publicEvent, event);
    },
    onMalformed
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      activeExecutions.delete(workspace);
      reject(error);
    };
    const onAbort = () => {
      cancelled = true;
      terminateChild(child);
    };
    const resetTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        terminateChild(child);
      }, Math.max(1000, timeoutMs));
    };
    try {
      child = safeSpawn(resolvedBin, args, {
        cwd: workspace,
        env: codexProcessEnvironment(env),
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      finishReject(runtimeError(CODEX_RUNTIME_FAILURES.MISSING_CLI, "Codex CLI could not be started."));
      return;
    }
    activeExecutions.set(workspace, {
      child,
      stop(reason = CODEX_RUNTIME_FAILURES.SHUTDOWN) {
        shutdown = reason === CODEX_RUNTIME_FAILURES.SHUTDOWN;
        terminateChild(child);
      }
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    resetTimeout();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      resetTimeout();
      stdout = appendTail(stdout, chunk, MAX_RETAINED_STDOUT_CHARS);
      parser.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      resetTimeout();
      stderr = appendTail(stderr, chunk, MAX_RETAINED_STDERR_CHARS);
      onStderr(redactCodexText(chunk));
    });
    child.on("error", () => finishReject(runtimeError(CODEX_RUNTIME_FAILURES.MISSING_CLI, "Codex CLI could not be started.")));
    child.on("close", (code, childSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      activeExecutions.delete(workspace);
      const stats = parser.finish();
      const details = { resolvedBin, workspace, code, signal: childSignal || "", ...stats };
      if (shutdown) {
        reject(new CodexRuntimeError("Codex execution stopped because the backend is shutting down.", { category: CODEX_RUNTIME_FAILURES.SHUTDOWN, exitCode: code, signal: childSignal || "", details }));
        return;
      }
      if (cancelled) {
        reject(new CodexRuntimeError("Gotham workflow was stopped by the user.", { category: CODEX_RUNTIME_FAILURES.CANCELLED, exitCode: code, signal: childSignal || "", details }));
        return;
      }
      if (timedOut) {
        reject(new CodexRuntimeError(`Gotham workflow timed out after ${Math.round(timeoutMs / 1000)} seconds.`, { category: CODEX_RUNTIME_FAILURES.TIMEOUT, exitCode: code, signal: childSignal || "", details }));
        return;
      }
      if (code !== 0) {
        const diagnostic = redactCodexText(stderr || stdout);
        const authenticationRequired = /not logged in|login required|authentication required|unauthenticated/i.test(diagnostic);
        const modelIncompatible = /model requires a newer version|model metadata for .+ not found/i.test(diagnostic);
        const category = authenticationRequired
          ? CODEX_RUNTIME_FAILURES.AUTHENTICATION_REQUIRED
          : modelIncompatible
            ? CODEX_RUNTIME_FAILURES.MODEL_INCOMPATIBLE
            : CODEX_RUNTIME_FAILURES.NON_ZERO_EXIT;
        const message = authenticationRequired
          ? "Codex authentication is required. Run `codex login --device-auth` once on the host."
          : `Codex workflow exited with code ${code}${diagnostic ? `: ${diagnostic}` : "."}`;
        reject(new CodexRuntimeError(message, { category, exitCode: code, signal: childSignal || "", details }));
        return;
      }
      if (stats.malformedEvents > 0 && stats.validEvents === 0) {
        reject(new CodexRuntimeError("Codex returned malformed JSONL output and no valid runtime events.", { category: CODEX_RUNTIME_FAILURES.MALFORMED_EVENTS, exitCode: code, details }));
        return;
      }
      resolve({
        code,
        resolvedBin,
        workspace,
        stdout,
        stderr: redactCodexText(stderr, 4000),
        finalResponse,
        threadId,
        ...stats
      });
    });
  });
}

export async function shutdownCodexRuntime({ graceMs = 3000 } = {}) {
  shuttingDown = true;
  const executions = [...activeExecutions.values()];
  for (const execution of executions) execution.stop(CODEX_RUNTIME_FAILURES.SHUTDOWN);
  if (!executions.length) return { stopped: 0, remaining: 0 };
  const started = Date.now();
  while (activeExecutions.size && Date.now() - started < graceMs) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  for (const execution of activeExecutions.values()) execution.child?.kill("SIGKILL");
  return { stopped: executions.length, remaining: activeExecutions.size };
}

export function resetCodexRuntimeForTests() {
  shuttingDown = false;
  for (const execution of activeExecutions.values()) terminateChild(execution.child, 0);
  activeExecutions.clear();
}
