import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import express from "express";
import { CliProviderAdapter, createProviderAdapters, resolveApprovedExecutable, runProviderProcess, versionAtLeast } from "../src/aiProviders/adapters.js";
import { PROVIDER_DEFINITIONS, PROVIDER_IDS } from "../src/aiProviders/metadata.js";
import { JsonProviderProfileRepository } from "../src/aiProviders/repository.js";
import { registerAiProviderRoutes } from "../src/aiProviders/router.js";
import { AiProviderProfileService } from "../src/aiProviders/service.js";
import { extractAuthorizationChallenge, redactProviderText, sanitizeAuditMetadata, validateAuthorizationUrl } from "../src/aiProviders/security.js";

const scope = { tenantId: "tenant-a", principalId: "user-a", workspaceId: "workspace-a" };

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for test state.");
}

async function fixture(t, adapterOverrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-ai-profiles-"));
  const repository = new JsonProviderProfileRepository({ filePath: path.join(directory, "profiles.json") });
  const definitions = Object.fromEntries(PROVIDER_IDS.map((providerId) => [providerId, {
    providerId,
    definition: PROVIDER_DEFINITIONS[providerId],
    detectInstallation: async () => ({ installed: true, supportedVersion: true, version: "test", status: "installed" }),
    getCapabilities: async () => [...PROVIDER_DEFINITIONS[providerId].capabilities],
    availableAuthMethods: () => [...PROVIDER_DEFINITIONS[providerId].authMethods],
    preferredAuthMethod: () => PROVIDER_DEFINITIONS[providerId].authMethods.find((method) => !["existing_session", "unsupported"].includes(method)) || "",
    discoverExistingSession: async () => null,
    verifyProfile: async (_scope, profile) => ({ connected: profile.status === "connected" || profile.lastLoginSucceeded, status: profile.status || "connected", verifiedAt: new Date().toISOString() }),
    beginLogin: async ({ onProgress }) => { onProgress?.({ authorizationUrl: "https://auth.openai.com/authorize", destinationDomain: "auth.openai.com" }); return { connected: true }; },
    logoutProfile: async () => ({ disconnected: true, remoteRevocationConfirmed: false }),
    runtime: async () => ({ command: "/approved/codex", env: { PATH: "/approved" } }),
    ...adapterOverrides[providerId]
  }]));
  const service = new AiProviderProfileService({ repository, adapters: new Map(Object.entries(definitions)), loginTtlMs: 100 });
  t.after(async () => {
    await service.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { service, repository, directory, adapters: definitions };
}

function mockChild({ stdout = "", stderr = "", code = 0, hold = false, onKill = () => {} } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.exitCode = null;
  child.kill = (signal) => {
    onKill(signal);
    child.exitCode = 143;
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

test("canonical compatibility metadata defines all five independently detectable adapters", async () => {
  assert.deepEqual(Object.keys(PROVIDER_DEFINITIONS), PROVIDER_IDS);
  const adapters = createProviderAdapters({ env: { PATH: "" } });
  for (const providerId of PROVIDER_IDS) {
    assert.equal(adapters.get(providerId).providerId, providerId);
    assert.equal((await adapters.get(providerId).detectInstallation()).status, "not_installed");
  }
  assert.deepEqual(PROVIDER_DEFINITIONS.emergent.capabilities, []);
  assert.equal(PROVIDER_DEFINITIONS.cursor.supportsIsolatedProfiles, false);
  assert.equal(PROVIDER_DEFINITIONS.codex.authMode, "secure_chatgpt");
});

test("installed CLI detection is independently mocked for every provider", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-cli-detect-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const providerId of PROVIDER_IDS) {
    const definition = PROVIDER_DEFINITIONS[providerId];
    const executable = path.join(directory, definition.executableNames[0]);
    await fs.symlink(process.execPath, executable);
    const adapter = new CliProviderAdapter(providerId, {
      env: { PATH: directory, [definition.configuredExecutableEnv]: executable },
      spawnFactory: () => mockChild({ stdout: `${providerId} 9999.9.9\n` })
    });
    const installation = await adapter.detectInstallation();
    assert.equal(installation.installed, true, providerId);
    assert.equal(installation.supportedVersion, true, providerId);
    assert.match(installation.version, new RegExp(providerId));
  }
});

test("CLI detection falls back to approved aliases when a configured default is absent", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-cli-alias-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const alias = path.join(directory, "agent");
  await fs.symlink(process.execPath, alias);
  const resolved = await resolveApprovedExecutable(PROVIDER_DEFINITIONS.cursor, {
    PATH: directory,
    CURSOR_AGENT_BIN: "cursor-agent"
  });
  assert.equal(resolved, await fs.realpath(alias));
});

test("process cancellation terminates a mocked CLI child and command operations are allowlisted", async () => {
  const controller = new AbortController();
  let killedWith = "";
  const running = runProviderProcess("/approved/codex", ["login"], {
    signal: controller.signal,
    timeoutMs: 5000,
    spawnFactory: () => mockChild({ hold: true, onKill: (signal) => { killedWith = signal; } })
  });
  controller.abort();
  const result = await running;
  assert.equal(killedWith, "SIGTERM");
  assert.equal(result.cancelled, true);
  const adapter = new CliProviderAdapter("codex", { env: { PATH: "" } });
  assert.deepEqual(adapter.command("device_code"), ["login", "--device-auth"]);
  assert.throws(() => adapter.command("frontend-supplied-argument"), { code: "unsupported_capability" });
});

test("capabilities and minimum versions are derived from maintained provider metadata", () => {
  assert.equal(versionAtLeast("codex-cli 0.151.0", "0.1.0"), true);
  assert.equal(versionAtLeast("0.0.1", "1.0.0"), false);
  assert.ok(PROVIDER_DEFINITIONS.codex.capabilities.includes("multiple_profiles"));
  assert.ok(PROVIDER_DEFINITIONS.claude.capabilities.includes("profile_switch"));
  assert.ok(!PROVIDER_DEFINITIONS.cursor.capabilities.includes("profile_switch"));
  assert.ok(!PROVIDER_DEFINITIONS.copilot.capabilities.includes("logout"));
});

test("containerized Codex login prefers device authorization and disables the unreachable browser callback", async (t) => {
  const adapter = new CliProviderAdapter("codex", { env: { PATH: "", AI_PROVIDER_CODEX_BROWSER_CALLBACK_AVAILABLE: "false" } });
  assert.deepEqual(adapter.availableAuthMethods(), ["device_code", "api_token", "existing_session"]);
  assert.equal(adapter.preferredAuthMethod(), "device_code");

  const { service } = await fixture(t, {
    codex: {
      availableAuthMethods: () => ["device_code", "api_token", "existing_session"],
      preferredAuthMethod: () => "device_code"
    }
  });
  const overview = await service.overview(scope);
  const codex = overview.find((provider) => provider.providerId === "codex");
  assert.equal(codex.preferredAuthMethod, "device_code");
  assert.ok(!codex.authMethods.includes("browser_oauth"));
  await assert.rejects(() => service.beginLogin(scope, "codex", { authMethod: "browser_oauth" }), { code: "browser_callback_unavailable" });
});

test("authorization URLs require HTTPS and an exact approved-domain boundary", () => {
  assert.equal(validateAuthorizationUrl("https://auth.openai.com/oauth?state=secret", ["openai.com"]).hostname, "auth.openai.com");
  assert.equal(validateAuthorizationUrl("http://auth.openai.com/oauth", ["openai.com"]), null);
  assert.equal(validateAuthorizationUrl("https://openai.com.evil.example/oauth", ["openai.com"]), null);
  assert.equal(validateAuthorizationUrl("https://user:pass@openai.com/oauth", ["openai.com"]), null);
  assert.equal(extractAuthorizationChallenge("Go to https://github.com/login/device Code: ABCD-EFGH", ["github.com"]).deviceCode, "ABCD-EFGH");
});

test("CLI output and audit metadata redact secrets and authorization material", () => {
  const secret = "sk-example-super-secret-value";
  const output = redactProviderText(`Authorization: Bearer abc.def.ghi api_key=${secret} https://x.test/?code=once`);
  assert.ok(!output.includes(secret));
  assert.ok(!output.includes("abc.def.ghi"));
  assert.ok(!output.includes("code=once"));
  const audit = sanitizeAuditMetadata({ providerId: "codex", authorizationUrl: "https://secret", deviceCode: "ABCD", stdout: secret, result: "ok" });
  assert.deepEqual(audit, { providerId: "codex", result: "ok" });
});

test("isolated runtime directories do not mutate application HOME and are profile-specific", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-provider-home-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const adapter = new CliProviderAdapter("codex", { env: { PATH: "/bin", HOME: "/application-home", APP_DATABASE_PASSWORD: "never-forward" }, runtimeRoot: root });
  const first = await adapter.profileEnvironment(scope, { id: "codex-profile-a", runtimeKind: "isolated" });
  const second = await adapter.profileEnvironment(scope, { id: "codex-profile-b", runtimeKind: "isolated" });
  assert.equal(first.HOME, "/application-home");
  assert.notEqual(first.CODEX_HOME, second.CODEX_HOME);
  assert.ok(first.CODEX_HOME.startsWith(root));
  assert.equal(first.APP_DATABASE_PASSWORD, undefined);
});

test("existing sessions retain only their documented provider home and credential environment", async () => {
  const adapter = new CliProviderAdapter("codex", { env: { PATH: "/bin", HOME: "/application-home", CODEX_HOME: "/mounted/codex", OPENAI_API_KEY: "provider-key", DATABASE_URL: "never-forward" } });
  const environment = await adapter.profileEnvironment(scope, { id: "existing-codex", runtimeKind: "existing_session" });
  assert.equal(environment.CODEX_HOME, "/mounted/codex");
  assert.equal(environment.OPENAI_API_KEY, "provider-key");
  assert.equal(environment.DATABASE_URL, undefined);
});

test("existing authenticated CLI sessions are discovered, persisted as opaque refs, and activated", async (t) => {
  const { service, repository } = await fixture(t, { codex: { discoverExistingSession: async () => ({ connected: true, accountLabel: "jo***@example.com", accountFingerprint: "abc123", verifiedAt: "2026-01-01T00:00:00.000Z" }) } });
  const profiles = await service.listProfiles(scope, "codex");
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].authMethod, "existing_session");
  assert.equal(profiles[0].isActive, true);
  const stored = await repository.getProfile(scope, "codex", profiles[0].id);
  assert.match(stored.credentialRef, /^provider-runtime:\/\/codex\//);
  assert.equal(JSON.stringify(profiles).includes("credentialRef"), false);
  await assert.rejects(() => service.logoutProfile(scope, "codex", profiles[0].id), { code: "existing_session_logout_unsupported" });
});

test("browser OAuth/device login follows explicit states and clears challenges on completion", async (t) => {
  const { service } = await fixture(t);
  const started = await service.beginLogin(scope, "codex", { authMethod: "device_code", displayName: "Work Codex" });
  assert.ok(["created", "starting"].includes(started.state));
  const connected = await waitFor(() => {
    const status = service.getLoginStatus(scope, "codex", started.id);
    return status.state === "connected" ? status : null;
  });
  assert.equal(connected.authorizationUrl, undefined);
  assert.equal(connected.deviceCode, undefined);
  assert.equal((await service.listProfiles(scope, "codex", { discoverExisting: false }))[0].status, "connected");
});

test("token login never persists or returns the submitted token", async (t) => {
  let observedSecret = "";
  const token = "sk-test-value-that-must-disappear";
  const { service, repository } = await fixture(t, { codex: { beginLogin: async ({ secret }) => { observedSecret = secret; return { connected: true }; } } });
  const started = await service.beginLogin(scope, "codex", { authMethod: "api_token", displayName: "Token profile", secret: token });
  await waitFor(() => service.getLoginStatus(scope, "codex", started.id).state === "connected");
  assert.equal(observedSecret, token);
  const persisted = await fs.readFile(repository.filePath, "utf8");
  assert.equal(persisted.includes(token), false);
  assert.equal(JSON.stringify(service.getLoginStatus(scope, "codex", started.id)).includes(token), false);
  assert.equal((await repository.listAudit(scope)).some((event) => JSON.stringify(event).includes(token)), false);
});

test("login cancellation aborts the CLI operation and is idempotent", async (t) => {
  let aborted = false;
  const { service } = await fixture(t, {
    codex: {
      beginLogin: ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        aborted = true;
        reject(Object.assign(new Error("cancelled"), { category: "cancelled" }));
      }, { once: true }))
    }
  });
  const started = await service.beginLogin(scope, "codex", { authMethod: "browser_oauth", displayName: "Cancelled profile" });
  await waitFor(() => service.getLoginStatus(scope, "codex", started.id).state === "starting");
  const cancelled = await service.cancelLogin(scope, "codex", started.id);
  assert.equal(cancelled.state, "cancelled");
  assert.equal((await service.cancelLogin(scope, "codex", started.id)).state, "cancelled");
  assert.equal(aborted, true);
});

test("expired login sessions abort work and remove reusable challenge data", async (t) => {
  let clock = new Date("2026-01-01T00:00:00.000Z");
  const { service } = await fixture(t, {
    codex: {
      beginLogin: ({ signal, onProgress }) => {
        onProgress({ authorizationUrl: "https://auth.openai.com/oauth", destinationDomain: "auth.openai.com", deviceCode: "ABCD-EFGH" });
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("expired")), { once: true }));
      }
    }
  });
  service.now = () => clock;
  service.loginTtlMs = 10;
  const started = await service.beginLogin(scope, "codex", { authMethod: "device_code", displayName: "Expiring profile" });
  await waitFor(() => ["authorization_required", "waiting_for_provider"].includes(service.getLoginStatus(scope, "codex", started.id).state));
  clock = new Date("2026-01-01T00:00:01.000Z");
  const expired = service.getLoginStatus(scope, "codex", started.id);
  assert.equal(expired.state, "expired");
  assert.equal(expired.deviceCode, undefined);
  assert.equal(expired.authorizationUrl, undefined);
});

test("failed activation preserves the old active profile", async (t) => {
  const { service, repository, adapters } = await fixture(t);
  for (const [id, status] of [["codex-good", "connected"], ["codex-bad", "connected"]]) await repository.saveProfile(scope, { id, providerId: "codex", displayName: id, authMethod: "browser_oauth", credentialRef: `provider-runtime://codex/${id}`, runtimeKind: "isolated", status, lastLoginSucceeded: true });
  await repository.activateProfile(scope, "codex", "codex-good", "*");
  adapters.codex.verifyProfile = async (_scope, profile) => ({ connected: profile.id !== "codex-bad", status: profile.id === "codex-bad" ? "invalid" : "connected" });
  await assert.rejects(() => service.activateProfile(scope, "codex", "codex-bad"), { code: "profile_verification_failed" });
  assert.equal((await repository.getActivation(scope, "codex", "workspace-a")).profileId, "codex-good");
});

test("workspace overrides resolve ahead of global defaults and running selections stay frozen", async (t) => {
  const { service, repository } = await fixture(t);
  for (const id of ["codex-global", "codex-workspace"]) await repository.saveProfile(scope, { id, providerId: "codex", displayName: id, authMethod: "browser_oauth", credentialRef: `provider-runtime://codex/${id}`, runtimeKind: "isolated", status: "connected", lastLoginSucceeded: true });
  await repository.activateProfile(scope, "codex", "codex-global", "*");
  const globalJob = await service.resolveRuntimeSelection({ ...scope, workspaceId: "workspace-b" }, { providerId: "codex" });
  await service.activateProfile(scope, "codex", "codex-workspace", { scope: "workspace", workspaceId: "workspace-a" });
  const workspaceJob = await service.resolveRuntimeSelection(scope, { providerId: "codex" });
  assert.equal(globalJob.selection.profileId, "codex-global");
  assert.equal(workspaceJob.selection.profileId, "codex-workspace");
  assert.equal(globalJob.selection.profileId, "codex-global", "the previously created job remains frozen");
});

test("unsupported Cursor multi-profile and Emergent auth behavior is honest", async (t) => {
  const { service, repository } = await fixture(t);
  await repository.saveProfile(scope, { id: "cursor-existing", providerId: "cursor", displayName: "Cursor", authMethod: "existing_session", credentialRef: "provider-runtime://cursor/cursor-existing", runtimeKind: "existing_session", status: "connected" });
  await assert.rejects(() => service.beginLogin(scope, "cursor", { authMethod: "browser_oauth", displayName: "Another Cursor" }), { code: "profile_isolation_unsupported" });
  await assert.rejects(() => service.beginLogin(scope, "emergent", { authMethod: "browser_oauth", displayName: "Emergent" }), { code: "unsupported_auth_method" });
});

test("profile activation serializes concurrent mutations", async (t) => {
  let activeVerifications = 0;
  let maxVerifications = 0;
  const { service, repository, adapters } = await fixture(t);
  for (const id of ["codex-a", "codex-b"]) await repository.saveProfile(scope, { id, providerId: "codex", displayName: id, authMethod: "browser_oauth", credentialRef: `provider-runtime://codex/${id}`, runtimeKind: "isolated", status: "connected", lastLoginSucceeded: true });
  adapters.codex.verifyProfile = async () => { activeVerifications += 1; maxVerifications = Math.max(maxVerifications, activeVerifications); await new Promise((resolve) => setTimeout(resolve, 20)); activeVerifications -= 1; return { connected: true, status: "connected" }; };
  await Promise.all([service.activateProfile(scope, "codex", "codex-a"), service.activateProfile(scope, "codex", "codex-b")]);
  assert.equal(maxVerifications, 1);
  assert.equal((await repository.getActivation(scope, "codex", "workspace-a")).profileId, "codex-b");
});

test("provider API requires authorization before returning profile metadata", async (t) => {
  const { service } = await fixture(t);
  const app = express();
  app.use(express.json());
  registerAiProviderRoutes(app, { service, readPermission: "read", operatePermission: "operate", authorize: async () => { throw Object.assign(new Error("denied"), { name: "AuthenticationError", status: 401, code: "authentication_required" }); } });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai-providers?workspaceId=workspace-a`);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.code, "authentication_required");
  assert.equal(body.error.includes("denied"), false);
});
