import { spawn } from "node:child_process";
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { redactOperational } from "./operationalSecurity.js";
import { appendBounded, redactProviderText } from "./aiProviders/security.js";

export const CLAUDE_RUNTIME_FAILURES = Object.freeze({
  INVALID_RUNTIME: "invalid_claude_runtime",
  INVALID_REQUEST: "invalid_claude_request",
  WORKSPACE_INVALID: "workspace_invalid",
  AUTHENTICATION_REQUIRED: "unauthenticated_cli",
  SANDBOX_UNAVAILABLE: "claude_sandbox_unavailable",
  TIMEOUT: "workflow_timeout",
  CANCELLED: "user_cancelled",
  MALFORMED_EVENTS: "malformed_events",
  MISSING_RESULT: "missing_result",
  NON_ZERO_EXIT: "non_zero_exit",
  CONCURRENT_EXECUTION: "concurrent_execution",
  SHUTDOWN: "server_shutdown"
});

export const CLAUDE_EXECUTION_MODES = Object.freeze({
  WRITE: "workspace-write",
  READ_ONLY: "read-only"
});

const WRITE_TOOLS = Object.freeze(["Read", "Glob", "Grep", "Edit", "Write", "Bash"]);
const READ_ONLY_TOOLS = Object.freeze(["Read", "Glob", "Grep", "Bash"]);
const SAFE_TOOL_NAMES = new Set(WRITE_TOOLS);
const MAX_STDOUT_CHARS = 4 * 1024 * 1024;
const MAX_STDERR_CHARS = 256 * 1024;
const MAX_EVENT_LINE_CHARS = 256 * 1024;
const DEFAULT_MALFORMED_THRESHOLD = 8;
const DEFAULT_TIMEOUT_MS = 600_000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_TURNS = 40;
const MAX_TURNS = 100;
const DEFAULT_TERMINATION_GRACE_MS = 2500;

const PROFILE_ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP",
  "LANG", "LC_ALL", "TERM", "NO_COLOR", "CI", "SSL_CERT_FILE", "SSL_CERT_DIR",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"
]);

const BASH_SECRET_ENV_KEYS = Object.freeze([
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AZURE_CLIENT_SECRET",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy"
]);

const activeExecutions = new Map();
let shuttingDown = false;

export class ClaudeRuntimeError extends Error {
  constructor(message, { category, code = category, exitCode = null, signal = "", details = {} } = {}) {
    super(message);
    this.name = "ClaudeRuntimeError";
    this.code = code;
    this.category = category;
    this.failureClass = category;
    this.workflowFailureClass = category;
    this.exitCode = exitCode;
    this.signal = signal;
    this.details = details;
  }
}

function runtimeError(category, message, details = {}) {
  return new ClaudeRuntimeError(message, { category, details });
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function safeIdentifier(value) {
  const text = String(value || "").trim();
  return text && text.length <= 240 && !/[\u0000-\u001f\u007f]/.test(text) ? text : "";
}

function safeProbeLabel(value) {
  const text = String(value || "").trim();
  return /^[a-zA-Z0-9._:-]{1,80}$/.test(text) ? text : "";
}

function executionKey({ providerId, profileId, workspaceId } = {}) {
  return JSON.stringify([providerId, profileId, workspaceId]);
}

function safeSessionId(value) {
  const text = String(value || "").trim();
  return /^[a-zA-Z0-9._:-]{1,180}$/.test(text) ? text : "";
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function safeUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = [
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "server_tool_use_input_tokens",
    "server_tool_use_output_tokens"
  ];
  return Object.fromEntries(allowed.flatMap((key) => {
    const amount = finiteNonNegative(value[key]);
    return amount === null ? [] : [[key, amount]];
  }));
}

export function redactClaudeText(value, maxLength = 4000, sensitiveValues = []) {
  let text = String(value || "");
  for (const sensitive of [...sensitiveValues].map(String).filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(sensitive).join("[REDACTED_PATH]");
  }
  return redactProviderText(redactOperational(text), maxLength).replace(/\s+/g, " ").trim();
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function validateClaudeWorkspace({ workspaceDir, registeredWorkspaceDirs = [], managedRoots = [], mode = CLAUDE_EXECUTION_MODES.WRITE } = {}) {
  if (!String(workspaceDir || "").trim()) {
    throw runtimeError(CLAUDE_RUNTIME_FAILURES.WORKSPACE_INVALID, "No managed project workspace was selected.");
  }
  let workspace;
  try {
    workspace = await fs.realpath(workspaceDir);
    const stat = await fs.stat(workspace);
    if (!stat.isDirectory()) throw new Error("not a directory");
    const access = mode === CLAUDE_EXECUTION_MODES.READ_ONLY
      ? nodeFs.constants.R_OK
      : nodeFs.constants.R_OK | nodeFs.constants.W_OK;
    await fs.access(workspace, access);
  } catch {
    throw runtimeError(CLAUDE_RUNTIME_FAILURES.WORKSPACE_INVALID, "The selected managed project workspace is unavailable.");
  }
  const forbidden = new Set([path.parse(workspace).root, path.resolve(os.homedir())]);
  if (process.env.PLUTOMIX_WORKSPACE_ROOT) forbidden.add(path.resolve(process.env.PLUTOMIX_WORKSPACE_ROOT));
  if (forbidden.has(workspace)) {
    throw runtimeError(CLAUDE_RUNTIME_FAILURES.WORKSPACE_INVALID, "The selected target is not an approved project workspace.");
  }
  const registered = [];
  for (const candidate of registeredWorkspaceDirs.filter(Boolean)) {
    try {
      registered.push(await fs.realpath(candidate));
    } catch {
      // A missing registered path cannot authorize another workspace.
    }
  }
  if (!registered.includes(workspace)) {
    throw runtimeError(CLAUDE_RUNTIME_FAILURES.WORKSPACE_INVALID, "The selected target is not a registered project workspace.");
  }
  const roots = [];
  for (const candidate of managedRoots.filter(Boolean)) {
    try {
      roots.push(await fs.realpath(candidate));
    } catch {
      // A missing managed root cannot authorize another workspace.
    }
  }
  if (roots.length && !roots.some((root) => root !== workspace && isWithin(root, workspace))) {
    throw runtimeError(CLAUDE_RUNTIME_FAILURES.WORKSPACE_INVALID, "The selected project resolves outside the managed workspace roots.");
  }
  return workspace;
}

async function validateRuntime(runtime) {
  if (!runtime || runtime.providerId !== "claude") {
    throw runtimeError(CLAUDE_RUNTIME_FAILURES.INVALID_RUNTIME, "A backend-resolved Claude provider runtime is required.");
  }
  const profileId = safeIdentifier(runtime.profileId);
  const workspaceId = safeIdentifier(runtime.workspaceId);
  const command = String(runtime.command || "").trim();
  if (!profileId || !workspaceId || !path.isAbsolute(command) || !runtime.env || typeof runtime.env !== "object" || Array.isArray(runtime.env)) {
    throw runtimeError(CLAUDE_RUNTIME_FAILURES.INVALID_RUNTIME, "The backend-resolved Claude provider runtime is invalid.");
  }
  try {
    const stat = await fs.stat(command);
    if (!stat.isFile()) throw new Error("not a file");
    await fs.access(command, nodeFs.constants.X_OK);
  } catch {
    throw runtimeError(CLAUDE_RUNTIME_FAILURES.INVALID_RUNTIME, "The backend-resolved Claude executable is unavailable.");
  }
  const configuredDirectory = String(runtime.env.CLAUDE_CONFIG_DIR || "").trim();
  if (!path.isAbsolute(configuredDirectory)) {
    throw runtimeError(CLAUDE_RUNTIME_FAILURES.INVALID_RUNTIME, "The Claude provider profile is not isolated.");
  }
  let configDir;
  try {
    configDir = await fs.realpath(configuredDirectory);
    if (!(await fs.stat(configDir)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw runtimeError(CLAUDE_RUNTIME_FAILURES.INVALID_RUNTIME, "The Claude provider profile is unavailable.");
  }
  return { command, profileId, workspaceId, configDir, profileEnv: runtime.env };
}

function profileProcessEnvironment(profileEnv, overrides = {}) {
  const environment = Object.fromEntries(Object.entries(profileEnv).filter(([key, value]) => PROFILE_ENV_KEYS.has(key) && value !== undefined && value !== null));
  Object.assign(environment, overrides, {
    CI: "1",
    NO_COLOR: "1",
    CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_ENABLE_TELEMETRY: "0"
  });
  return environment;
}

function nestedSandboxRequired(configurationEnv, platform) {
  return platform === "linux" && String(configurationEnv.PLUTOMIX_BACKEND_CONTAINER || "").trim() === "plutomix-backend";
}

function backendSettings({ workspace, configDir, sessionTemp, bashEnvFile, mode, configurationEnv, platform }) {
  const home = String(configurationEnv.HOME || "").trim();
  const denyRead = [configDir, "/proc"];
  if (path.isAbsolute(home)) denyRead.push(home);
  const denyWrite = [configDir, bashEnvFile];
  if (mode === CLAUDE_EXECUTION_MODES.READ_ONLY) denyWrite.push(workspace);
  const sandbox = {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    excludedCommands: [],
    allowUnsandboxedCommands: false,
    filesystem: {
      allowRead: [workspace, sessionTemp],
      allowWrite: mode === CLAUDE_EXECUTION_MODES.READ_ONLY ? [sessionTemp] : [workspace, sessionTemp],
      denyRead: [...new Set(denyRead)],
      denyWrite: [...new Set(denyWrite)]
    },
    network: {
      allowedDomains: []
    }
  };
  if (nestedSandboxRequired(configurationEnv, platform)) sandbox.enableWeakerNestedSandbox = true;
  const tools = mode === CLAUDE_EXECUTION_MODES.READ_ONLY ? READ_ONLY_TOOLS : WRITE_TOOLS;
  return {
    permissions: {
      allow: [...tools],
      deny: mode === CLAUDE_EXECUTION_MODES.READ_ONLY
        ? ["WebFetch", "WebSearch", "Edit", "Write"]
        : ["WebFetch", "WebSearch"]
    },
    sandbox
  };
}

function validatedModel(value) {
  const model = String(value || "").trim();
  if (!model) return "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(model)) {
    throw runtimeError(CLAUDE_RUNTIME_FAILURES.INVALID_REQUEST, "The selected Claude model identifier is invalid.");
  }
  return model;
}

function fixedArgv({ prompt, settings, tools, model, maxTurns }) {
  return [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--restricted",
    "--strict-mcp-config",
    "--no-chrome",
    "--tools",
    tools.join(","),
    "--permission-mode",
    "acceptEdits",
    "--settings",
    JSON.stringify(settings),
    ...(model ? ["--model", model] : []),
    "--max-turns",
    String(maxTurns)
  ];
}

function safeSpawn(spawnFactory, command, args, options) {
  return spawnFactory(command, args, { ...options, shell: false, windowsHide: true });
}

function terminationController(child, graceMs) {
  let started = false;
  let killTimer;
  return {
    terminate() {
      if (started || !child || child.exitCode !== null) return;
      started = true;
      child.kill?.("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill?.("SIGKILL");
      }, graceMs);
      killTimer.unref?.();
    },
    clear() {
      clearTimeout(killTimer);
    }
  };
}

async function runProbe(runtime, args, { timeoutMs = 8000, cwd, spawnFactory = spawn, terminationGraceMs = 1000 } = {}) {
  let resolved;
  try {
    resolved = await validateRuntime(runtime);
  } catch (error) {
    return { code: null, timedOut: false, error: error.message, category: error.category };
  }
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timer;
    let child;
    let termination;
    let timedOut = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      termination?.clear();
      resolve(result);
    };
    try {
      child = safeSpawn(spawnFactory, resolved.command, args, {
        cwd,
        env: profileProcessEnvironment(resolved.profileEnv),
        stdio: ["ignore", "pipe", "pipe"]
      });
      termination = terminationController(child, terminationGraceMs);
    } catch {
      finish({ code: null, timedOut: false, error: "Claude CLI could not be started.", category: CLAUDE_RUNTIME_FAILURES.INVALID_RUNTIME });
      return;
    }
    timer = setTimeout(() => {
      timedOut = true;
      termination.terminate();
    }, boundedInteger(timeoutMs, 8000, 250, 60_000));
    timer.unref?.();
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on?.("data", (chunk) => { stdout = appendBounded(stdout, chunk, 16 * 1024); });
    child.stderr?.on?.("data", (chunk) => { stderr = appendBounded(stderr, chunk, 16 * 1024); });
    child.on?.("error", () => finish({ code: null, timedOut: false, error: "Claude CLI could not be started.", category: CLAUDE_RUNTIME_FAILURES.INVALID_RUNTIME }));
    child.on?.("close", (code, childSignal) => finish({
      code,
      signal: childSignal || "",
      timedOut,
      stdout,
      stderr,
      sensitiveValues: [resolved.configDir]
    }));
  });
}

export async function probeClaudeVersion(runtime, options = {}) {
  const result = await runProbe(runtime, ["--version"], options);
  if (result.category) return { available: false, status: "unavailable", version: "", error: result.error, category: result.category };
  if (result.timedOut) return { available: false, status: "version_check_timed_out", version: "" };
  if (result.code !== 0) return { available: false, status: "version_check_failed", version: "", error: "Claude version probe failed." };
  return { available: true, status: "available", version: redactClaudeText(result.stdout || result.stderr, 160, result.sensitiveValues) };
}

export async function probeClaudeAuthentication(runtime, options = {}) {
  const result = await runProbe(runtime, ["auth", "status"], options);
  if (result.category) return { authenticated: false, status: "unavailable", authMethod: "", apiProvider: "", error: result.error, category: result.category };
  if (result.timedOut) return { authenticated: false, status: "unavailable", authMethod: "", apiProvider: "", error: "Claude authentication probe timed out." };
  let status;
  try {
    status = JSON.parse(String(result.stdout || ""));
  } catch {
    return { authenticated: false, status: "authentication_probe_failed", authMethod: "", apiProvider: "", error: "Claude returned an invalid authentication status." };
  }
  const authenticated = result.code === 0 && status?.loggedIn === true;
  return {
    authenticated,
    status: authenticated ? "ready" : "authentication_required",
    authMethod: safeProbeLabel(status?.authMethod),
    apiProvider: safeProbeLabel(status?.apiProvider),
    error: authenticated ? "" : "Claude authentication is required. Connect the selected Claude profile before retrying."
  };
}

async function executableAvailable(name, environment = process.env) {
  const candidates = [
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    ...String(environment.PATH || "").split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, name))
  ];
  for (const candidate of [...new Set(candidates)]) {
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) continue;
      await fs.access(candidate, nodeFs.constants.X_OK);
      return true;
    } catch {
      // Continue through the fixed dependency candidates.
    }
  }
  return false;
}

export async function probeClaudeSandboxReadiness(runtime, {
  workspaceDir,
  registeredWorkspaceDirs = [workspaceDir],
  managedRoots = [],
  configurationEnv = process.env,
  platform = process.platform
} = {}) {
  try {
    const resolved = await validateRuntime(runtime);
    const workspace = await validateClaudeWorkspace({ workspaceDir, registeredWorkspaceDirs, managedRoots });
    const probeTemp = path.join(os.tmpdir(), "plutomix-claude-sandbox-preflight");
    const settings = backendSettings({
      workspace,
      configDir: resolved.configDir,
      sessionTemp: probeTemp,
      bashEnvFile: path.join(probeTemp, "bash-env"),
      mode: CLAUDE_EXECUTION_MODES.WRITE,
      configurationEnv,
      platform
    });
    const sandbox = settings.sandbox;
    const failClosed = sandbox?.enabled === true &&
      sandbox?.failIfUnavailable === true &&
      sandbox?.allowUnsandboxedCommands === false &&
      Array.isArray(sandbox?.filesystem?.allowWrite) &&
      sandbox.filesystem.allowWrite.includes(workspace) &&
      Array.isArray(sandbox?.filesystem?.denyRead) &&
      sandbox.filesystem.denyRead.includes(resolved.configDir) &&
      settings.permissions?.deny?.includes("WebFetch") &&
      settings.permissions?.deny?.includes("WebSearch");
    if (!failClosed) {
      return {
        status: "unavailable",
        component: "claude_restricted_sandbox",
        failureClass: CLAUDE_RUNTIME_FAILURES.SANDBOX_UNAVAILABLE,
        reason: "Claude's backend-owned sandbox policy is not fail-closed."
      };
    }
    if (platform === "linux") {
      const [bubblewrap, socat] = await Promise.all([
        executableAvailable("bwrap", configurationEnv),
        executableAvailable("socat", configurationEnv)
      ]);
      if (!bubblewrap || !socat) {
        return {
          status: "unavailable",
          component: "claude_restricted_sandbox",
          failureClass: CLAUDE_RUNTIME_FAILURES.SANDBOX_UNAVAILABLE,
          reason: "Claude's required Linux sandbox dependencies are unavailable.",
          dependencies: { bubblewrap, socat }
        };
      }
      return {
        status: "ready",
        component: "claude_restricted_sandbox",
        failureClass: "",
        reason: "",
        dependencies: { bubblewrap: true, socat: true },
        failClosed: true
      };
    }
    return {
      status: "ready",
      component: "claude_restricted_sandbox",
      failureClass: "",
      reason: "",
      dependencies: { bubblewrap: "not_applicable", socat: "not_applicable" },
      failClosed: true
    };
  } catch (error) {
    return {
      status: "unavailable",
      component: "claude_restricted_sandbox",
      failureClass: error.category || CLAUDE_RUNTIME_FAILURES.SANDBOX_UNAVAILABLE,
      reason: redactClaudeText(error.message || "Claude sandbox preflight failed.", 500)
    };
  }
}

export function publicClaudeEvent(event = {}) {
  const type = String(event?.type || "");
  if (type === "system") {
    if (event.subtype === "init") return { type: "claude-started", message: "Claude started the restricted workspace task." };
    if (event.subtype === "api_retry") {
      const attempt = boundedInteger(event.attempt, 1, 1, 100);
      return { type: "claude-retry", message: `Claude is retrying a provider request (attempt ${attempt}).` };
    }
    return { type: "claude-progress", message: "Claude reported a runtime update." };
  }
  if (type === "assistant") {
    const content = Array.isArray(event.message?.content) ? event.message.content : [];
    const tool = content.find((block) => block?.type === "tool_use");
    if (tool) {
      const name = SAFE_TOOL_NAMES.has(tool.name) ? tool.name : "a permitted tool";
      return { type: "claude-tool", message: `Claude is using ${name}.` };
    }
    if (content.some((block) => block?.type === "text")) return { type: "claude-response", message: "Claude produced a response update." };
    return { type: "claude-progress", message: "Claude is processing the workspace task." };
  }
  if (type === "user") {
    const content = Array.isArray(event.message?.content) ? event.message.content : [];
    if (content.some((block) => block?.type === "tool_result")) return { type: "claude-tool-result", message: "Claude completed a tool step." };
    return null;
  }
  if (type === "result") {
    return event.is_error
      ? { type: "claude-failed", message: "Claude reported an execution failure." }
      : { type: "claude-completed", message: "Claude completed the restricted workspace task." };
  }
  return null;
}

export function createClaudeStreamParser({ onEvent = () => {}, onMalformed = () => {}, malformedThreshold = DEFAULT_MALFORMED_THRESHOLD } = {}) {
  const threshold = boundedInteger(malformedThreshold, DEFAULT_MALFORMED_THRESHOLD, 0, 100);
  let buffer = "";
  let validEvents = 0;
  let malformedEvents = 0;
  const malformed = () => {
    malformedEvents += 1;
    onMalformed({ count: malformedEvents, thresholdExceeded: malformedEvents > threshold });
  };
  const parseLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_EVENT_LINE_CHARS) {
      malformed();
      return;
    }
    try {
      const event = JSON.parse(trimmed);
      if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("invalid event");
      validEvents += 1;
      onEvent(event);
    } catch {
      malformed();
    }
  };
  return {
    push(chunk) {
      buffer += String(chunk || "");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) parseLine(line);
      if (buffer.length > MAX_EVENT_LINE_CHARS) {
        buffer = "";
        malformed();
      }
    },
    finish() {
      if (buffer.trim()) parseLine(buffer);
      buffer = "";
      return { validEvents, malformedEvents, thresholdExceeded: malformedEvents > threshold };
    },
    stats() {
      return { validEvents, malformedEvents, thresholdExceeded: malformedEvents > threshold };
    }
  };
}

function captureEvent(event, state) {
  const sessionId = safeSessionId(event.session_id || event.sessionId);
  if (sessionId) state.sessionId = sessionId;
  const usage = safeUsage(event.usage || event.message?.usage);
  if (Object.keys(usage).length) state.usage = { ...state.usage, ...usage };
  if (event.type !== "result") return;
  state.sawResult = true;
  state.resultIsError = event.is_error === true;
  if (typeof event.result === "string") state.finalResponse = redactClaudeText(event.result, 16_000, state.sensitiveValues);
  const durationMs = finiteNonNegative(event.duration_ms);
  const durationApiMs = finiteNonNegative(event.duration_api_ms);
  const totalCostUsd = finiteNonNegative(event.total_cost_usd);
  const numTurns = finiteNonNegative(event.num_turns);
  if (durationMs !== null) state.durationMs = durationMs;
  if (durationApiMs !== null) state.durationApiMs = durationApiMs;
  if (totalCostUsd !== null) state.totalCostUsd = totalCostUsd;
  if (numTurns !== null) state.numTurns = numTurns;
}

function failureCategory(diagnostic) {
  if (/sandbox(?:ing)?[^.\n]*(?:unavailable|failed|cannot start)|bubblewrap|\bbwrap\b|\bsocat\b|failIfUnavailable/i.test(diagnostic)) {
    return CLAUDE_RUNTIME_FAILURES.SANDBOX_UNAVAILABLE;
  }
  if (/not logged in|login required|authentication required|unauthenticated|invalid api key|authentication_failed/i.test(diagnostic)) {
    return CLAUDE_RUNTIME_FAILURES.AUTHENTICATION_REQUIRED;
  }
  return CLAUDE_RUNTIME_FAILURES.NON_ZERO_EXIT;
}

export function activeClaudeExecutionCount() {
  return activeExecutions.size;
}

export function cancelClaudeExecution(identity) {
  const providerId = safeIdentifier(identity?.providerId);
  const profileId = safeIdentifier(identity?.profileId);
  const workspaceId = safeIdentifier(identity?.workspaceId);
  if (!providerId || !profileId || !workspaceId) return false;
  const execution = activeExecutions.get(executionKey({ providerId, profileId, workspaceId }));
  if (!execution) return false;
  execution.cancel();
  return true;
}

export async function executeClaude({
  runtime,
  prompt,
  cwd,
  registeredWorkspaceDirs = [cwd],
  managedRoots = [],
  mode = CLAUDE_EXECUTION_MODES.WRITE,
  selectedModel = "",
  signal,
  timeoutMs,
  configurationEnv = process.env,
  platform = process.platform,
  malformedThreshold = DEFAULT_MALFORMED_THRESHOLD,
  terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
  spawnFactory = spawn,
  onEvent = () => {},
  onMalformed = () => {},
  onStderr = () => {}
} = {}) {
  if (shuttingDown) throw runtimeError(CLAUDE_RUNTIME_FAILURES.SHUTDOWN, "The backend is shutting down and cannot start a Claude task.");
  if (signal?.aborted) throw runtimeError(CLAUDE_RUNTIME_FAILURES.CANCELLED, "The Claude workflow was stopped by the user.");
  if (![CLAUDE_EXECUTION_MODES.WRITE, CLAUDE_EXECUTION_MODES.READ_ONLY].includes(mode)) {
    throw runtimeError(CLAUDE_RUNTIME_FAILURES.INVALID_REQUEST, "The Claude execution mode is invalid.");
  }
  const safePrompt = String(prompt || "");
  if (!safePrompt.trim() || safePrompt.length > 256 * 1024) {
    throw runtimeError(CLAUDE_RUNTIME_FAILURES.INVALID_REQUEST, "The Claude task prompt is invalid.");
  }
  const resolved = await validateRuntime(runtime);
  const workspace = await validateClaudeWorkspace({ workspaceDir: cwd, registeredWorkspaceDirs, managedRoots, mode });
  const identity = { providerId: "claude", profileId: resolved.profileId, workspaceId: resolved.workspaceId };
  const key = executionKey(identity);
  if (activeExecutions.has(key)) {
    throw runtimeError(CLAUDE_RUNTIME_FAILURES.CONCURRENT_EXECUTION, "A Claude execution is already active for this provider profile and workspace.");
  }
  const model = validatedModel(selectedModel);
  const configuredTimeout = boundedInteger(configurationEnv.CLAUDE_WORKFLOW_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS);
  const inactivityTimeoutMs = boundedInteger(timeoutMs, configuredTimeout, 25, MAX_TIMEOUT_MS);
  const maxTurns = boundedInteger(configurationEnv.CLAUDE_WORKFLOW_MAX_TURNS, DEFAULT_MAX_TURNS, 1, MAX_TURNS);
  const sessionTemp = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-claude-runtime-"));
  await fs.chmod(sessionTemp, 0o700);
  const bashEnvFile = path.join(sessionTemp, "bash-env");
  await fs.writeFile(bashEnvFile, `${BASH_SECRET_ENV_KEYS.map((keyName) => `unset ${keyName}`).join("\n")}\n`, { mode: 0o600 });
  const settings = backendSettings({ workspace, configDir: resolved.configDir, sessionTemp, bashEnvFile, mode, configurationEnv, platform });
  const tools = mode === CLAUDE_EXECUTION_MODES.READ_ONLY ? READ_ONLY_TOOLS : WRITE_TOOLS;
  const args = fixedArgv({ prompt: safePrompt, settings, tools, model, maxTurns });
  const sensitiveValues = [resolved.configDir, sessionTemp, bashEnvFile, JSON.stringify(settings)];
  const environment = profileProcessEnvironment(resolved.profileEnv, {
    TMPDIR: sessionTemp,
    TMP: sessionTemp,
    TEMP: sessionTemp,
    BASH_ENV: bashEnvFile,
    ENV: bashEnvFile
  });
  let stdout = "";
  let stderr = "";
  let child;
  let inactivityTimer;
  let timedOut = false;
  let cancelled = false;
  let shutdown = false;
  const state = {
    sawResult: false,
    resultIsError: false,
    finalResponse: "",
    sessionId: "",
    usage: {},
    durationMs: null,
    durationApiMs: null,
    totalCostUsd: null,
    numTurns: null,
    sensitiveValues
  };
  const parser = createClaudeStreamParser({
    malformedThreshold,
    onMalformed,
    onEvent: (event) => {
      captureEvent(event, state);
      const publicEvent = publicClaudeEvent(event);
      if (publicEvent) onEvent(publicEvent);
    }
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let termination;
    const cleanup = async () => {
      clearTimeout(inactivityTimer);
      termination?.clear();
      signal?.removeEventListener?.("abort", onAbort);
      if (activeExecutions.get(key)?.child === child) activeExecutions.delete(key);
      await fs.rm(sessionTemp, { recursive: true, force: true });
    };
    const rejectOnce = async (error) => {
      if (settled) return;
      settled = true;
      await cleanup();
      reject(error);
    };
    const onAbort = () => {
      cancelled = true;
      termination?.terminate();
    };
    const resetInactivity = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        timedOut = true;
        termination?.terminate();
      }, inactivityTimeoutMs);
      inactivityTimer.unref?.();
    };
    try {
      child = safeSpawn(spawnFactory, resolved.command, args, {
        cwd: workspace,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"]
      });
      termination = terminationController(child, boundedInteger(terminationGraceMs, DEFAULT_TERMINATION_GRACE_MS, 10, 10_000));
    } catch {
      void rejectOnce(runtimeError(CLAUDE_RUNTIME_FAILURES.INVALID_RUNTIME, "Claude CLI could not be started."));
      return;
    }
    activeExecutions.set(key, {
      child,
      cancel() {
        cancelled = true;
        termination.terminate();
      },
      shutdown() {
        shutdown = true;
        termination.terminate();
      }
    });
    signal?.addEventListener?.("abort", onAbort, { once: true });
    resetInactivity();
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on?.("data", (chunk) => {
      resetInactivity();
      stdout = appendBounded(stdout, chunk, MAX_STDOUT_CHARS);
      parser.push(chunk);
    });
    child.stderr?.on?.("data", (chunk) => {
      resetInactivity();
      stderr = appendBounded(stderr, chunk, MAX_STDERR_CHARS);
      if (String(chunk || "").length) onStderr("Claude reported a runtime diagnostic.");
    });
    child.on?.("error", () => {
      void rejectOnce(runtimeError(CLAUDE_RUNTIME_FAILURES.INVALID_RUNTIME, "Claude CLI could not be started."));
    });
    child.on?.("close", async (code, childSignal) => {
      if (settled) return;
      settled = true;
      const stats = parser.finish();
      const details = { code, signal: childSignal || "", ...stats };
      const diagnostic = redactClaudeText(`${stderr}\n${state.resultIsError ? state.finalResponse : ""}`, 2000, sensitiveValues);
      await cleanup();
      if (shutdown) {
        reject(new ClaudeRuntimeError("Claude execution stopped because the backend is shutting down.", { category: CLAUDE_RUNTIME_FAILURES.SHUTDOWN, exitCode: code, signal: childSignal || "", details }));
        return;
      }
      if (cancelled) {
        reject(new ClaudeRuntimeError("The Claude workflow was stopped by the user.", { category: CLAUDE_RUNTIME_FAILURES.CANCELLED, exitCode: code, signal: childSignal || "", details }));
        return;
      }
      if (timedOut) {
        reject(new ClaudeRuntimeError(`The Claude workflow timed out after ${Math.round(inactivityTimeoutMs / 1000)} seconds of inactivity.`, { category: CLAUDE_RUNTIME_FAILURES.TIMEOUT, exitCode: code, signal: childSignal || "", details }));
        return;
      }
      if (code !== 0 || state.resultIsError) {
        const category = failureCategory(diagnostic);
        const message = category === CLAUDE_RUNTIME_FAILURES.AUTHENTICATION_REQUIRED
          ? "Claude authentication is required. Connect the selected Claude profile before retrying."
          : category === CLAUDE_RUNTIME_FAILURES.SANDBOX_UNAVAILABLE
            ? "Claude sandboxing is unavailable; the restricted workflow was not started."
            : `Claude workflow exited unsuccessfully${code === null ? "." : ` with code ${code}.`}`;
        reject(new ClaudeRuntimeError(message, { category, exitCode: code, signal: childSignal || "", details }));
        return;
      }
      if (stats.thresholdExceeded) {
        reject(new ClaudeRuntimeError("Claude exceeded the malformed event safety threshold.", { category: CLAUDE_RUNTIME_FAILURES.MALFORMED_EVENTS, exitCode: code, details }));
        return;
      }
      if (!state.sawResult) {
        reject(new ClaudeRuntimeError("Claude exited without a final result event.", { category: CLAUDE_RUNTIME_FAILURES.MISSING_RESULT, exitCode: code, details }));
        return;
      }
      resolve({
        code,
        finalResponse: state.finalResponse,
        sessionId: state.sessionId,
        usage: state.usage,
        durationMs: state.durationMs,
        durationApiMs: state.durationApiMs,
        totalCostUsd: state.totalCostUsd,
        numTurns: state.numTurns,
        ...stats
      });
    });
  });
}

export async function shutdownClaudeRuntime({ graceMs = 3000 } = {}) {
  shuttingDown = true;
  const executions = [...activeExecutions.values()];
  for (const execution of executions) execution.shutdown();
  if (!executions.length) return { stopped: 0, remaining: 0 };
  const started = Date.now();
  while (activeExecutions.size && Date.now() - started < graceMs) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  for (const execution of activeExecutions.values()) execution.child?.kill?.("SIGKILL");
  return { stopped: executions.length, remaining: activeExecutions.size };
}

export function resetClaudeRuntimeForTests() {
  shuttingDown = false;
  for (const execution of activeExecutions.values()) execution.cancel();
  activeExecutions.clear();
}
