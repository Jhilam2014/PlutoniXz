import crypto from "node:crypto";
import { createProviderAdapters, ProviderAdapterError } from "./adapters.js";
import { PROVIDER_IDS, providerDefinition, publicProviderDefinition } from "./metadata.js";
import { createProviderProfileRepository } from "./repository.js";
import { sanitizeAuditMetadata } from "./security.js";

const LOGIN_TRANSITIONS = Object.freeze({
  created: new Set(["starting", "cancelled"]),
  starting: new Set(["authorization_required", "waiting_for_provider", "verifying", "failed", "expired", "cancelled"]),
  authorization_required: new Set(["waiting_for_provider", "verifying", "failed", "expired", "cancelled"]),
  waiting_for_provider: new Set(["authorization_required", "verifying", "failed", "expired", "cancelled"]),
  verifying: new Set(["connected", "failed", "expired", "cancelled"]),
  connected: new Set(),
  failed: new Set(),
  expired: new Set(),
  cancelled: new Set()
});

const TERMINAL_LOGIN_STATES = new Set(["connected", "failed", "expired", "cancelled"]);

export class ProviderProfileError extends Error {
  constructor(message, { code = "provider_profile_error", status = 400, category = "provider_error", recovery = [] } = {}) {
    super(message);
    this.name = "ProviderProfileError";
    this.code = code;
    this.status = status;
    this.category = category;
    this.recovery = recovery;
  }
}

function stableExistingId(scope, providerId) {
  return `existing-${crypto.createHash("sha256").update(`${scope.tenantId}:${scope.principalId}:${providerId}`).digest("hex").slice(0, 20)}`;
}

function newProfileId(providerId) {
  return `${providerId}-${crypto.randomUUID()}`;
}

function publicProfile(profile, activation) {
  return {
    id: profile.id,
    providerId: profile.providerId,
    displayName: profile.displayName,
    accountLabel: profile.accountLabel || undefined,
    accountFingerprint: profile.accountFingerprint || undefined,
    organizationLabel: profile.organizationLabel || undefined,
    authMethod: profile.authMethod,
    status: profile.status,
    createdAt: profile.createdAt,
    lastVerifiedAt: profile.lastVerifiedAt || undefined,
    expiresAt: profile.expiresAt || undefined,
    isActive: activation?.profileId === profile.id,
    activeScope: activation?.profileId === profile.id ? activation.scope : undefined
  };
}

function sessionPublic(session) {
  const terminal = TERMINAL_LOGIN_STATES.has(session.state);
  return {
    id: session.id,
    providerId: session.providerId,
    profileId: session.profileId,
    authMethod: session.authMethod,
    authMode: session.authMode,
    state: session.state,
    destinationDomain: terminal ? undefined : session.destinationDomain || undefined,
    authorizationUrl: terminal ? undefined : session.authorizationUrl || undefined,
    deviceCode: terminal ? undefined : session.deviceCode || undefined,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    error: session.error || undefined,
    failureCategory: session.failureCategory || undefined,
    recovery: session.recovery || []
  };
}

function normalizeError(error) {
  if (error instanceof ProviderAdapterError || error instanceof ProviderProfileError) return error;
  return new ProviderProfileError("The provider operation could not be completed.", { code: "provider_operation_failed", status: 500, category: "provider_error", recovery: ["Retry", "Keep the current active profile"] });
}

export class AiProviderProfileService {
  constructor({
    repository = createProviderProfileRepository(),
    adapters = createProviderAdapters(),
    now = () => new Date(),
    loginTtlMs = 10 * 60 * 1000,
    auditSink = null
  } = {}) {
    this.repository = repository;
    this.adapters = adapters;
    this.now = now;
    this.loginTtlMs = loginTtlMs;
    this.auditSink = auditSink;
    this.sessions = new Map();
    this.locks = new Map();
  }

  adapter(providerId) {
    const adapter = this.adapters.get(providerId);
    if (!adapter) throw new ProviderProfileError("Unknown AI provider.", { code: "provider_not_found", status: 404, category: "unsupported" });
    return adapter;
  }

  scope(input) {
    const scope = {
      tenantId: String(input?.tenantId || "").trim(),
      principalId: String(input?.principalId || input?.principal?.id || "").trim(),
      workspaceId: String(input?.workspaceId || "*").trim() || "*"
    };
    if (!scope.tenantId || !scope.principalId) throw new ProviderProfileError("An authenticated tenant and user scope is required.", { code: "authenticated_scope_required", status: 401, category: "authorization_denied" });
    return scope;
  }

  async exclusive(key, work) {
    const prior = this.locks.get(key) || Promise.resolve();
    const current = prior.catch(() => {}).then(work);
    this.locks.set(key, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }

  transition(session, next) {
    if (!LOGIN_TRANSITIONS[session.state]?.has(next)) throw new ProviderProfileError(`Invalid login transition ${session.state} → ${next}.`, { code: "invalid_login_transition", status: 409, category: "state_conflict" });
    session.state = next;
    session.updatedAt = this.now().toISOString();
    if (TERMINAL_LOGIN_STATES.has(next)) {
      session.authorizationUrl = "";
      session.destinationDomain = "";
      session.deviceCode = "";
    }
  }

  async audit(scope, providerId, eventType, { profileId = null, result = "succeeded", failureCategory = "", accountFingerprint = "", metadata = {} } = {}) {
    const event = {
      id: crypto.randomUUID(),
      tenantId: scope.tenantId,
      principalId: scope.principalId,
      workspaceId: scope.workspaceId || "*",
      providerId,
      profileId,
      eventType,
      result,
      failureCategory,
      accountFingerprint,
      metadata: sanitizeAuditMetadata(metadata),
      createdAt: this.now().toISOString()
    };
    await this.repository.appendAudit(event);
    await this.auditSink?.(event);
  }

  async importExisting(scopeInput, providerId) {
    const scope = this.scope(scopeInput);
    const adapter = this.adapter(providerId);
    const existing = await adapter.discoverExistingSession(scope);
    if (!existing?.connected) return null;
    const id = stableExistingId(scope, providerId);
    const current = await this.repository.getProfile(scope, providerId, id);
    const profile = await this.repository.saveProfile(scope, {
      ...current,
      id,
      providerId,
      displayName: current?.displayName || `${adapter.definition.name} existing session`,
      accountLabel: existing.accountLabel || current?.accountLabel || "",
      accountFingerprint: existing.accountFingerprint || current?.accountFingerprint || "",
      authMethod: "existing_session",
      credentialRef: `provider-runtime://${providerId}/${id}`,
      runtimeKind: "existing_session",
      status: "connected",
      lastVerifiedAt: existing.verifiedAt || this.now().toISOString(),
      lastLoginSucceeded: true
    });
    const activation = await this.repository.getActivation(scope, providerId, scope.workspaceId);
    if (!activation) await this.repository.activateProfile(scope, providerId, id, "*");
    return profile;
  }

  async listProfiles(scopeInput, providerId, { discoverExisting = true } = {}) {
    const scope = this.scope(scopeInput);
    const adapter = this.adapter(providerId);
    if (discoverExisting) await this.importExisting(scope, providerId).catch(() => null);
    const activation = await this.repository.getActivation(scope, providerId, scope.workspaceId);
    return (await this.repository.listProfiles(scope, providerId)).map((profile) => publicProfile(profile, activation));
  }

  async overview(scopeInput, { refresh = false } = {}) {
    const scope = this.scope(scopeInput);
    return Promise.all(PROVIDER_IDS.map(async (providerId) => {
      const adapter = this.adapter(providerId);
      const installation = await adapter.detectInstallation({ refresh });
      const capabilities = await adapter.getCapabilities();
      const profiles = await this.listProfiles(scope, providerId, { discoverExisting: installation.installed });
      const activeProfile = profiles.find((profile) => profile.isActive) || null;
      const definition = publicProviderDefinition(providerDefinition(providerId));
      const availableAuthMethods = adapter.availableAuthMethods();
      const status = !installation.installed
        ? "not_installed"
        : !installation.supportedVersion || (!capabilities.length && providerId === "emergent")
          ? "unsupported"
          : activeProfile?.status === "connected"
            ? "connected"
            : activeProfile?.status === "expired"
              ? "expired"
              : "disconnected";
      return {
        ...definition,
        installation: { installed: installation.installed, status: installation.status, version: installation.version, supportedVersion: installation.supportedVersion },
        capabilities,
        authMethods: installation.installed && installation.supportedVersion ? availableAuthMethods : [],
        preferredAuthMethod: installation.installed && installation.supportedVersion ? adapter.preferredAuthMethod() : "",
        authMethodNotice: providerId === "codex" && !availableAuthMethods.includes("browser_oauth")
          ? "This backend runs without a browser-reachable localhost:1455 callback. Use device-code authorization."
          : "",
        status,
        activeProfile,
        profiles
      };
    }));
  }

  async beginLogin(scopeInput, providerId, { authMethod, displayName = "", secret = "" } = {}) {
    const scope = this.scope(scopeInput);
    const adapter = this.adapter(providerId);
    if (adapter.definition.authMethods.includes(authMethod) && !adapter.availableAuthMethods().includes(authMethod)) {
      throw new ProviderProfileError("Browser sign-in cannot reach the Codex localhost callback from this backend runtime. Use device-code authorization instead.", { code: "browser_callback_unavailable", status: 409, category: "authentication_method_unavailable", recovery: ["Use device-code authorization"] });
    }
    if (!adapter.definition.authMethods.includes(authMethod) || ["existing_session", "unsupported"].includes(authMethod)) throw new ProviderProfileError("The requested login method is unsupported.", { code: "unsupported_auth_method", status: 409, category: "unsupported" });
    if (authMethod === "api_token" && !String(secret || "").trim()) throw new ProviderProfileError("A provider token is required.", { code: "token_required", status: 400, category: "token_invalid" });
    if (!adapter.definition.supportsIsolatedProfiles) {
      const profiles = await this.repository.listProfiles(scope, providerId);
      if (profiles.some((profile) => profile.status === "connected")) throw new ProviderProfileError(`${adapter.definition.name} does not document safe multiple-profile isolation. Disconnect its current local profile before reconnecting.`, { code: "profile_isolation_unsupported", status: 409, category: "profile_isolation_unsupported", recovery: ["Reconnect", "Keep the current active profile"] });
    }
    const profileId = newProfileId(providerId);
    const now = this.now();
    const session = {
      id: crypto.randomUUID(),
      providerId,
      profileId,
      authMethod,
      authMode: adapter.definition.authMode,
      scope,
      state: "created",
      authorizationUrl: "",
      destinationDomain: "",
      deviceCode: "",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.loginTtlMs).toISOString(),
      error: "",
      failureCategory: "",
      recovery: [],
      controller: new AbortController()
    };
    this.sessions.set(session.id, session);
    await this.repository.saveProfile(scope, {
      id: profileId,
      providerId,
      displayName: String(displayName || "").trim().slice(0, 80) || `${adapter.definition.name} profile`,
      authMethod,
      credentialRef: `provider-runtime://${providerId}/${profileId}`,
      runtimeKind: adapter.definition.supportsIsolatedProfiles ? "isolated" : "existing_session",
      status: "disconnected",
      lastLoginSucceeded: false
    });
    await this.audit(scope, providerId, "provider.login.started", { profileId, metadata: { authMethod } });
    let ephemeralSecret = authMethod === "api_token" ? String(secret) : undefined;
    session.task = Promise.resolve()
      .then(() => this.runLogin(session, ephemeralSecret))
      .finally(() => { ephemeralSecret = undefined; })
      .catch(() => {});
    return sessionPublic(session);
  }

  async runLogin(session, secret) {
    const { scope, providerId, profileId } = session;
    const adapter = this.adapter(providerId);
    try {
      this.transition(session, "starting");
      const login = await adapter.beginLogin({
        authMethod: session.authMethod,
        scope,
        profile: { id: profileId, runtimeKind: adapter.definition.supportsIsolatedProfiles ? "isolated" : "existing_session" },
        secret,
        signal: session.controller.signal,
        onProgress: (challenge) => {
          if (TERMINAL_LOGIN_STATES.has(session.state)) return;
          session.authorizationUrl = challenge.authorizationUrl || session.authorizationUrl;
          session.destinationDomain = challenge.destinationDomain || session.destinationDomain;
          session.deviceCode = challenge.deviceCode || session.deviceCode;
          const next = session.state === "starting" ? "authorization_required" : session.state === "authorization_required" ? "waiting_for_provider" : session.state;
          if (next !== session.state) this.transition(session, next);
          this.audit(scope, providerId, "provider.login.authorization_required", { profileId, metadata: { authMethod: session.authMethod, destinationDomain: session.destinationDomain } }).catch(() => {});
        }
      });
      if (session.controller.signal.aborted || session.state === "cancelled") return;
      if (["starting", "authorization_required", "waiting_for_provider"].includes(session.state)) this.transition(session, "verifying");
      const stored = await this.repository.getProfile(scope, providerId, profileId);
      const tentative = { ...stored, lastLoginSucceeded: Boolean(login.connected) };
      const verification = adapter.definition.verification === "login_process"
        ? { connected: Boolean(login.connected), status: login.connected ? "connected" : "disconnected", verifiedAt: this.now().toISOString() }
        : await adapter.verifyProfile(scope, tentative);
      if (!verification.connected) throw new ProviderProfileError("The provider profile could not be verified after login.", { code: "profile_verification_failed", status: 401, category: verification.category || "profile_verification_failed", recovery: ["Retry", "Reconnect"] });
      const profile = await this.repository.saveProfile(scope, {
        ...tentative,
        accountLabel: verification.accountLabel || stored?.accountLabel || "",
        accountFingerprint: verification.accountFingerprint || stored?.accountFingerprint || "",
        status: "connected",
        lastVerifiedAt: verification.verifiedAt || this.now().toISOString(),
        lastLoginSucceeded: true
      });
      const prior = await this.repository.getActivation(scope, providerId, scope.workspaceId);
      if (!prior) await this.repository.activateProfile(scope, providerId, profileId, "*");
      this.transition(session, "connected");
      await this.audit(scope, providerId, "provider.login.completed", { profileId, accountFingerprint: profile.accountFingerprint });
    } catch (rawError) {
      if (session.state === "cancelled") return;
      const error = normalizeError(rawError);
      const expired = this.now().getTime() >= new Date(session.expiresAt).getTime() || error.category === "authentication_timed_out";
      if (!TERMINAL_LOGIN_STATES.has(session.state)) this.transition(session, expired ? "expired" : "failed");
      session.error = error.message;
      session.failureCategory = error.category;
      session.recovery = error.recovery || ["Retry"];
      await this.audit(scope, providerId, "provider.login.failed", { profileId, result: "failed", failureCategory: error.category });
    } finally {
      secret = undefined;
    }
  }

  session(scopeInput, providerId, sessionId) {
    const scope = this.scope(scopeInput);
    const session = this.sessions.get(sessionId);
    if (!session || session.providerId !== providerId || session.scope.tenantId !== scope.tenantId || session.scope.principalId !== scope.principalId) throw new ProviderProfileError("Login session was not found.", { code: "login_session_not_found", status: 404, category: "not_found" });
    if (!TERMINAL_LOGIN_STATES.has(session.state) && this.now().getTime() >= new Date(session.expiresAt).getTime()) {
      session.controller.abort();
      this.transition(session, "expired");
      session.error = "The login session expired. Generate a new authorization challenge.";
      session.failureCategory = "authentication_timed_out";
      session.recovery = ["Retry", "Generate a new device code"];
    }
    return session;
  }

  getLoginStatus(scopeInput, providerId, sessionId) {
    return sessionPublic(this.session(scopeInput, providerId, sessionId));
  }

  async cancelLogin(scopeInput, providerId, sessionId) {
    const session = this.session(scopeInput, providerId, sessionId);
    if (session.state === "cancelled") return sessionPublic(session);
    if (TERMINAL_LOGIN_STATES.has(session.state)) return sessionPublic(session);
    session.controller.abort();
    this.transition(session, "cancelled");
    await this.audit(session.scope, providerId, "provider.login.cancelled", { profileId: session.profileId, result: "cancelled" });
    return sessionPublic(session);
  }

  async verifyProfile(scopeInput, providerId, profileId) {
    const scope = this.scope(scopeInput);
    return this.exclusive(`${scope.tenantId}:${scope.principalId}:${providerId}:${profileId}`, async () => {
      const profile = await this.repository.getProfile(scope, providerId, profileId);
      if (!profile) throw new ProviderProfileError("Provider profile was not found.", { code: "profile_not_found", status: 404, category: "not_found" });
      const verification = await this.adapter(providerId).verifyProfile(scope, profile);
      const saved = await this.repository.saveProfile(scope, {
        ...profile,
        status: verification.connected ? "connected" : verification.status === "expired" ? "expired" : "invalid",
        accountLabel: verification.accountLabel || profile.accountLabel || "",
        accountFingerprint: verification.accountFingerprint || profile.accountFingerprint || "",
        lastVerifiedAt: verification.verifiedAt || this.now().toISOString()
      });
      await this.audit(scope, providerId, "provider.profile.verified", { profileId, result: verification.connected ? "succeeded" : "failed", failureCategory: verification.category || "", accountFingerprint: saved.accountFingerprint });
      return publicProfile(saved, await this.repository.getActivation(scope, providerId, scope.workspaceId));
    });
  }

  async activateProfile(scopeInput, providerId, profileId, { workspaceId, scope: activationScope = "global" } = {}) {
    const scope = this.scope({ ...scopeInput, workspaceId: workspaceId || scopeInput.workspaceId });
    const targetWorkspace = activationScope === "workspace" ? scope.workspaceId : "*";
    if (activationScope === "workspace" && targetWorkspace === "*") throw new ProviderProfileError("A workspace-specific activation requires a workspace.", { code: "workspace_required", status: 400 });
    return this.exclusive(`${scope.tenantId}:${scope.principalId}:${providerId}:activation:${targetWorkspace}`, async () => {
      const profile = await this.repository.getProfile(scope, providerId, profileId);
      if (!profile) throw new ProviderProfileError("Provider profile was not found.", { code: "profile_not_found", status: 404, category: "not_found" });
      const verification = await this.adapter(providerId).verifyProfile(scope, profile);
      if (!verification.connected) {
        await this.audit(scope, providerId, "provider.profile.activated", { profileId, result: "failed", failureCategory: verification.category || "profile_verification_failed" });
        throw new ProviderProfileError("Profile verification failed; the current active profile was preserved.", { code: "profile_verification_failed", status: 409, category: "profile_verification_failed", recovery: ["Reconnect", "Keep the current active profile"] });
      }
      await this.repository.saveProfile(scope, { ...profile, status: "connected", lastVerifiedAt: verification.verifiedAt || this.now().toISOString() });
      const activation = await this.repository.activateProfile(scope, providerId, profileId, targetWorkspace);
      await this.audit(scope, providerId, "provider.profile.activated", { profileId, accountFingerprint: profile.accountFingerprint, metadata: { activationScope, idempotent: activation.idempotent, runningJobsUnaffected: true } });
      return { profile: publicProfile(profile, { profileId, scope: activationScope }), previousProfileId: activation.previousProfileId, scope: activationScope, workspaceId: targetWorkspace, idempotent: activation.idempotent, runningJobsUnaffected: true };
    });
  }

  async renameProfile(scopeInput, providerId, profileId, displayName) {
    const scope = this.scope(scopeInput);
    const profile = await this.repository.getProfile(scope, providerId, profileId);
    if (!profile) throw new ProviderProfileError("Provider profile was not found.", { code: "profile_not_found", status: 404, category: "not_found" });
    const name = String(displayName || "").trim();
    if (name.length < 2 || name.length > 80) throw new ProviderProfileError("Profile name must contain 2 to 80 characters.", { code: "invalid_profile_name", status: 400 });
    const saved = await this.repository.saveProfile(scope, { ...profile, displayName: name });
    await this.audit(scope, providerId, "provider.profile.renamed", { profileId });
    return publicProfile(saved, await this.repository.getActivation(scope, providerId, scope.workspaceId));
  }

  async logoutProfile(scopeInput, providerId, profileId) {
    const scope = this.scope(scopeInput);
    return this.exclusive(`${scope.tenantId}:${scope.principalId}:${providerId}:${profileId}`, async () => {
      const profile = await this.repository.getProfile(scope, providerId, profileId);
      if (!profile) throw new ProviderProfileError("Provider profile was not found.", { code: "profile_not_found", status: 404, category: "not_found" });
      if (profile.runtimeKind === "existing_session") throw new ProviderProfileError("The shared existing CLI session cannot be logged out from a principal-scoped profile. Connect an isolated profile to manage logout safely.", { code: "existing_session_logout_unsupported", status: 409, category: "profile_isolation_unsupported", recovery: ["Add profile", "Keep the current active profile"] });
      const result = await this.adapter(providerId).logoutProfile(scope, profile);
      const saved = await this.repository.saveProfile(scope, { ...profile, status: "disconnected", lastLoginSucceeded: false });
      await this.audit(scope, providerId, "provider.profile.logged_out", { profileId, accountFingerprint: profile.accountFingerprint, metadata: { remoteRevocationConfirmed: result.remoteRevocationConfirmed } });
      return { profile: publicProfile(saved, await this.repository.getActivation(scope, providerId, scope.workspaceId)), remoteRevocationConfirmed: false };
    });
  }

  async removeProfile(scopeInput, providerId, profileId) {
    const scope = this.scope(scopeInput);
    const profile = await this.repository.getProfile(scope, providerId, profileId);
    if (!profile) return { removed: false, idempotent: true };
    if (profile.status === "connected") throw new ProviderProfileError("Disconnect the local profile before removing its metadata.", { code: "profile_still_connected", status: 409, category: "state_conflict", recovery: ["Disconnect"] });
    const result = await this.repository.removeProfile(scope, providerId, profileId);
    await this.audit(scope, providerId, "provider.profile.removed", { profileId, accountFingerprint: profile.accountFingerprint });
    return { ...result, idempotent: !result.removed };
  }

  async resolveRuntimeSelection(scopeInput, { providerId = "codex", modelId, requestedProfileId } = {}) {
    const scope = this.scope(scopeInput);
    const adapter = this.adapter(providerId);
    let activation = await this.repository.getActivation(scope, providerId, scope.workspaceId);
    if (!activation) {
      await this.importExisting(scope, providerId).catch(() => null);
      activation = await this.repository.getActivation(scope, providerId, scope.workspaceId);
    }
    if (!activation) throw new ProviderProfileError(`Connect and activate a ${adapter.definition.name} profile before starting this Gotham job.`, { code: "active_profile_required", status: 409, category: "authentication_required", recovery: ["Connect", "Switch profile"] });
    if (requestedProfileId && activation.profileId !== requestedProfileId) throw new ProviderProfileError("The requested profile is not the active profile for this workspace.", { code: "inactive_profile_requested", status: 409, category: "state_conflict" });
    const profile = await this.repository.getProfile(scope, providerId, activation.profileId);
    if (!profile || profile.status !== "connected") throw new ProviderProfileError("The active provider profile is not connected.", { code: "active_profile_invalid", status: 409, category: "credential_expired", recovery: ["Verify", "Reconnect"] });
    const runtime = await adapter.runtime(scope, profile);
    if (!adapter.definition.gothamExecutionSupported) throw new ProviderProfileError(`${adapter.definition.name} account management is available, but its public CLI execution contract is not enabled for Gotham jobs.`, { code: "provider_execution_unsupported", status: 409, category: "unsupported", recovery: ["Use the connected OpenAI Codex provider"] });
    const selectedAt = this.now().toISOString();
    return {
      selection: { providerId, profileId: profile.id, modelId: modelId || undefined, workspaceId: scope.workspaceId === "*" ? undefined : scope.workspaceId, selectedAt },
      profile: publicProfile(profile, activation),
      runtime
    };
  }

  async close() {
    for (const session of this.sessions.values()) if (!TERMINAL_LOGIN_STATES.has(session.state)) session.controller.abort();
    await Promise.allSettled([...this.sessions.values()].map((session) => session.task).filter(Boolean));
    this.sessions.clear();
    if (this.repository.pool) await this.repository.pool.end();
  }
}

export { LOGIN_TRANSITIONS, TERMINAL_LOGIN_STATES, publicProfile, sessionPublic };
