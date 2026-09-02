import crypto from "node:crypto";
import fs from "node:fs/promises";
import nodeFs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PROVIDER_IDS, providerDefinition } from "./metadata.js";
import { appendBounded, assertSecureRuntimeDirectory, extractAuthorizationChallenge, redactProviderText, safeFingerprint } from "./security.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export class ProviderAdapterError extends Error {
  constructor(message, { code = "provider_error", status = 400, category = "provider_error", recovery = [] } = {}) {
    super(message);
    this.name = "ProviderAdapterError";
    this.code = code;
    this.status = status;
    this.category = category;
    this.recovery = recovery;
  }
}

function versionTuple(value) {
  const match = String(value || "").match(/(?:^|\s|v)(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
  return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : null;
}

export function versionAtLeast(value, minimum) {
  if (!minimum) return true;
  const actual = versionTuple(value);
  const required = versionTuple(minimum);
  if (!actual || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > required[index]) return true;
    if (actual[index] < required[index]) return false;
  }
  return true;
}

async function executableAt(candidate) {
  try {
    const resolved = await fs.realpath(candidate);
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) return "";
    await fs.access(resolved, nodeFs.constants.X_OK);
    return resolved;
  } catch {
    return "";
  }
}

export async function resolveApprovedExecutable(definition, env = process.env) {
  const configured = String(env[definition.configuredExecutableEnv] || "").trim();
  const candidates = configured
    ? [configured, ...definition.executableNames.filter((name) => name !== configured)]
    : [...definition.executableNames];
  const pathEntries = String(env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const candidate of candidates) {
    const base = path.basename(candidate);
    if (!definition.executableNames.includes(base)) continue;
    if (path.isAbsolute(candidate)) {
      const resolved = await executableAt(candidate);
      if (resolved) return resolved;
      continue;
    }
    if (candidate !== base) continue;
    for (const entry of pathEntries) {
      const resolved = await executableAt(path.join(entry, candidate));
      if (resolved) return resolved;
    }
  }
  return "";
}

function childEnvironment(baseEnv, extraEnv) {
  const permitted = new Set([
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP",
    "LANG", "LC_ALL", "TERM", "NO_COLOR", "CI", "SSL_CERT_FILE", "SSL_CERT_DIR",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"
  ]);
  const env = Object.fromEntries(Object.entries(baseEnv).filter(([key]) => permitted.has(key)));
  Object.assign(env, extraEnv);
  for (const key of Object.keys(env)) {
    if (env[key] === undefined || env[key] === null) delete env[key];
  }
  return env;
}

export function runProviderProcess(command, args, {
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  input,
  keepStdinOpen = false,
  signal,
  spawnFactory = spawn,
  onOutput,
  onStdinReady
} = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timer;
    let killTimer;
    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener?.("abort", abort);
      onStdinReady?.(null);
      if (error) reject(error);
      else resolve(result);
    };
    let child;
    try {
      child = spawnFactory(command, args, {
        env,
        shell: false,
        windowsHide: true,
        stdio: [input === undefined && !keepStdinOpen ? "ignore" : "pipe", "pipe", "pipe"]
      });
    } catch (error) {
      finish(null, new ProviderAdapterError("The provider CLI could not be started.", { code: "cli_start_failed", category: "cli_process_terminated" }));
      return;
    }
    const terminate = () => {
      child.kill?.("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill?.("SIGKILL");
      }, 1000);
      killTimer.unref?.();
    };
    const abort = () => terminate();
    signal?.addEventListener?.("abort", abort, { once: true });
    if (keepStdinOpen) {
      // A CLI can close its input between a status poll and the user's
      // submission. Treat that race as a normal login failure, not an
      // unhandled stream error in the backend process.
      child.stdin?.on?.("error", () => {});
      onStdinReady?.((value) => {
        if (settled || child.stdin?.destroyed || child.stdin?.writableEnded) return false;
        child.stdin?.write?.(String(value));
        return true;
      });
    }
    if (input !== undefined) {
      child.stdin?.end(String(input));
      input = undefined;
    }
    timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, Math.max(250, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
    timer.unref?.();
    const capture = (streamName, chunk) => {
      if (streamName === "stdout") stdout = appendBounded(stdout, chunk);
      else stderr = appendBounded(stderr, chunk);
      // rawText remains inside the adapter call solely long enough to validate
      // an authorization URL/device challenge. It is never logged, persisted,
      // or returned directly to a caller.
      onOutput?.({ stream: streamName, text: redactProviderText(chunk, 4000), rawText: String(chunk) });
    };
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on?.("data", (chunk) => capture("stdout", chunk));
    child.stderr?.on?.("data", (chunk) => capture("stderr", chunk));
    child.on?.("error", () => finish(null, new ProviderAdapterError("The provider CLI process terminated unexpectedly.", { code: "cli_process_error", category: "cli_process_terminated", recovery: ["Retry", "Install or upgrade CLI"] })));
    child.on?.("close", (code, closeSignal) => finish({
      code,
      signal: closeSignal || "",
      timedOut,
      cancelled: Boolean(signal?.aborted),
      stdout: redactProviderText(stdout),
      stderr: redactProviderText(stderr)
    }));
  });
}

function statusFromOutput(definition, result) {
  const combined = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (result.timedOut) return { connected: false, status: "error", category: "authentication_timed_out" };
  if (result.code !== 0 || /not logged in|not authenticated|login required|unauthenticated|expired/i.test(combined)) {
    return { connected: false, status: /expired/i.test(combined) ? "expired" : "disconnected", category: /expired/i.test(combined) ? "credential_expired" : "authentication_required" };
  }
  let accountLabel = "";
  try {
    const parsed = JSON.parse(result.stdout);
    accountLabel = parsed.email || parsed.username || parsed.account || parsed.user || "";
  } catch {
    const match = combined.match(/(?:logged in as|authenticated as|account|email|user)\s*[:\-]?\s*([^\s,;]+)/i);
    accountLabel = match?.[1] || "";
  }
  return {
    connected: true,
    status: "connected",
    accountLabel: safeFingerprint(accountLabel),
    accountFingerprint: accountLabel ? crypto.createHash("sha256").update(String(accountLabel).toLowerCase()).digest("hex").slice(0, 16) : "",
    authMode: definition.authMode
  };
}

export class CliProviderAdapter {
  constructor(providerId, {
    env = process.env,
    runtimeRoot = process.env.AI_PROVIDER_RUNTIME_ROOT || "/workspace/runtime/ai-provider-profiles",
    spawnFactory = spawn,
    now = () => new Date()
  } = {}) {
    const definition = providerDefinition(providerId);
    if (!definition) throw new Error(`Unknown provider adapter: ${providerId}`);
    this.providerId = providerId;
    this.definition = definition;
    this.env = env;
    this.runtimeRoot = runtimeRoot;
    this.spawnFactory = spawnFactory;
    this.now = now;
    this.installationCache = null;
  }

  async detectInstallation({ refresh = false } = {}) {
    if (this.installationCache && !refresh) return this.installationCache;
    const executable = await resolveApprovedExecutable(this.definition, this.env);
    if (!executable) {
      this.installationCache = { installed: false, status: "not_installed", version: "", supportedVersion: false };
      return this.installationCache;
    }
    const result = await runProviderProcess(executable, [...this.definition.versionArgs], {
      env: this.env,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      spawnFactory: this.spawnFactory
    });
    const version = result.code === 0 ? redactProviderText(result.stdout || result.stderr, 160).trim() : "";
    const supportedVersion = result.code === 0 && versionAtLeast(version, this.definition.minimumVersion);
    this.installationCache = {
      installed: result.code === 0,
      status: result.code !== 0 ? "error" : supportedVersion ? "installed" : "unsupported_version",
      version,
      supportedVersion,
      executable
    };
    return this.installationCache;
  }

  async getCapabilities() {
    const installation = await this.detectInstallation();
    return installation.installed && installation.supportedVersion ? [...this.definition.capabilities] : [];
  }

  availableAuthMethods() {
    const methods = [...this.definition.authMethods];
    if (this.providerId !== "codex") return methods;
    const configured = String(this.env.AI_PROVIDER_CODEX_BROWSER_CALLBACK_AVAILABLE || "").trim().toLowerCase();
    const browserCallbackAvailable = !configured || ["1", "true", "yes"].includes(configured);
    return browserCallbackAvailable ? methods : methods.filter((method) => method !== "browser_oauth");
  }

  preferredAuthMethod() {
    const methods = this.availableAuthMethods().filter((method) => !["existing_session", "unsupported"].includes(method));
    if (this.providerId === "codex" && methods.includes("device_code")) return "device_code";
    return methods[0] || "";
  }

  command(operation) {
    const args = this.definition.commands[operation];
    if (!args) throw new ProviderAdapterError(`${this.definition.name} does not support this operation through its public CLI.`, {
      code: "unsupported_capability",
      status: 409,
      category: "unsupported",
      recovery: ["Use another supported authentication method", "Install or upgrade CLI"]
    });
    return [...args];
  }

  async profileEnvironment(scope, profile = {}) {
    if (profile.runtimeKind === "existing_session") {
      const providerCredentialKeys = {
        codex: ["OPENAI_API_KEY"],
        claude: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
        copilot: ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"],
        cursor: ["CURSOR_API_KEY"],
        emergent: []
      }[this.providerId];
      const providerEnvironment = Object.fromEntries(providerCredentialKeys.filter((key) => this.env[key]).map((key) => [key, this.env[key]]));
      if (this.definition.isolationEnv && this.env[this.definition.isolationEnv]) providerEnvironment[this.definition.isolationEnv] = this.env[this.definition.isolationEnv];
      return childEnvironment(this.env, providerEnvironment);
    }
    if (!this.definition.isolationEnv) return childEnvironment(this.env, {});
    const tenantHash = crypto.createHash("sha256").update(String(scope.tenantId)).digest("hex").slice(0, 20);
    const principalHash = crypto.createHash("sha256").update(String(scope.principalId)).digest("hex").slice(0, 20);
    const runtimeDir = await assertSecureRuntimeDirectory(this.runtimeRoot, [tenantHash, principalHash, this.providerId, profile.id]);
    return childEnvironment(this.env, { [this.definition.isolationEnv]: runtimeDir });
  }

  async run(operation, { scope, profile, timeoutMs = DEFAULT_TIMEOUT_MS, input, keepStdinOpen = false, signal, onOutput, onStdinReady } = {}) {
    const installation = await this.detectInstallation();
    if (!installation.installed) throw new ProviderAdapterError(`${this.definition.name} CLI is not installed.`, { code: "cli_not_installed", status: 409, category: "cli_not_installed", recovery: ["Install or upgrade CLI"] });
    if (!installation.supportedVersion) throw new ProviderAdapterError(`${this.definition.name} CLI version is unsupported.`, { code: "unsupported_cli_version", status: 409, category: "unsupported_cli_version", recovery: ["Install or upgrade CLI"] });
    return runProviderProcess(installation.executable, this.command(operation), {
      env: await this.profileEnvironment(scope, profile),
      timeoutMs,
      input,
      keepStdinOpen,
      signal,
      spawnFactory: this.spawnFactory,
      onOutput,
      onStdinReady
    });
  }

  async verifyProfile(scope, profile) {
    if (this.definition.verification === "unsupported") return { connected: false, status: "unsupported", category: "unsupported" };
    if (this.definition.verification === "login_process" && profile.lastLoginSucceeded) {
      return { connected: true, status: "connected", authMode: this.definition.authMode, verifiedAt: this.now().toISOString() };
    }
    const result = await this.run("status", { scope, profile, timeoutMs: DEFAULT_TIMEOUT_MS });
    return { ...statusFromOutput(this.definition, result), verifiedAt: this.now().toISOString() };
  }

  async discoverExistingSession(scope) {
    if (!this.definition.authMethods.includes("existing_session") || this.definition.verification !== "status_command") return null;
    try {
      const verification = await this.verifyProfile(scope, { id: `existing-${this.providerId}`, runtimeKind: "existing_session" });
      return verification.connected ? verification : null;
    } catch {
      return null;
    }
  }

  async beginLogin({ authMethod, scope, profile, secret, signal, onProgress, onAuthorizationInputReady }) {
    if (this.definition.authMethods.includes(authMethod) && !this.availableAuthMethods().includes(authMethod)) {
      throw new ProviderAdapterError("Browser sign-in cannot reach the Codex localhost callback from this backend runtime. Use device-code authorization instead.", {
        code: "browser_callback_unavailable",
        status: 409,
        category: "authentication_method_unavailable",
        recovery: ["Use device-code authorization", "Enable and route the Codex localhost callback explicitly"]
      });
    }
    if (!this.definition.authMethods.includes(authMethod) || authMethod === "existing_session" || authMethod === "unsupported") {
      throw new ProviderAdapterError(`${this.definition.name} does not support the requested authentication method.`, { code: "unsupported_auth_method", status: 409, category: "unsupported" });
    }
    const aggregate = { value: "" };
    const interactiveAuthorization = this.providerId === "claude" && ["browser_oauth", "enterprise_login"].includes(authMethod);
    const result = await this.run(authMethod, {
      scope,
      profile,
      timeoutMs: LOGIN_TIMEOUT_MS,
      input: authMethod === "api_token" ? `${String(secret || "").trim()}\n` : undefined,
      keepStdinOpen: interactiveAuthorization,
      signal,
      onStdinReady: interactiveAuthorization ? (write) => {
        onAuthorizationInputReady?.(write ? (authorizationCode) => write(`${authorizationCode}\n`) : null);
      } : undefined,
      onOutput: ({ rawText }) => {
        aggregate.value = appendBounded(aggregate.value, rawText);
        const challenge = extractAuthorizationChallenge(aggregate.value, this.definition.authDomains);
        if (challenge.authorizationUrl || challenge.deviceCode) onProgress?.(challenge);
      }
    });
    aggregate.value = "";
    if (result.cancelled) throw new ProviderAdapterError("Provider login was cancelled.", { code: "login_cancelled", category: "cancelled" });
    if (result.timedOut) throw new ProviderAdapterError("Provider authorization timed out.", { code: "login_timed_out", status: 408, category: "authentication_timed_out", recovery: ["Retry", "Generate a new device code"] });
    if (result.code !== 0) throw new ProviderAdapterError("The provider rejected or could not complete authentication.", { code: "login_failed", status: 401, category: /denied/i.test(`${result.stdout} ${result.stderr}`) ? "authorization_denied" : "authentication_failed", recovery: ["Retry", "Reconnect"] });
    return { connected: true, status: "connected", authMode: this.definition.authMode };
  }

  async logoutProfile(scope, profile) {
    const result = await this.run("logout", { scope, profile });
    if (result.code !== 0) throw new ProviderAdapterError("The local provider profile could not be disconnected.", { code: "logout_failed", category: "authentication_failed" });
    return { disconnected: true, remoteRevocationConfirmed: false };
  }

  async runtime(scope, profile) {
    const installation = await this.detectInstallation();
    if (!installation.installed || !installation.supportedVersion) throw new ProviderAdapterError("The selected provider runtime is unavailable.", { code: "provider_unavailable", status: 409 });
    const runtime = { command: installation.executable, env: await this.profileEnvironment(scope, profile) };
    if (this.providerId !== "claude") return runtime;
    return { ...runtime, providerId: "claude", profileId: String(profile.id || ""), workspaceId: String(scope.workspaceId || "") };
  }
}

export function createProviderAdapters(options = {}) {
  return new Map(PROVIDER_IDS.map((providerId) => [providerId, new CliProviderAdapter(providerId, options)]));
}
