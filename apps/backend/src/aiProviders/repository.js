import fs from "node:fs/promises";
import path from "node:path";
import { sanitizeAuditMetadata } from "./security.js";

function scopeKey({ tenantId, principalId }) {
  return `${tenantId}\u0000${principalId}`;
}

function activationKey({ tenantId, principalId, providerId, workspaceId = "*" }) {
  return `${scopeKey({ tenantId, principalId })}\u0000${providerId}\u0000${workspaceId || "*"}`;
}

function emptyState() {
  return { schemaVersion: 1, profiles: [], activations: {}, auditEvents: [] };
}

function profileMatches(profile, scope, providerId = null) {
  return profile.tenantId === scope.tenantId && profile.principalId === scope.principalId && (!providerId || profile.providerId === providerId);
}

function safeRecord(profile) {
  const allowed = ["id", "tenantId", "principalId", "providerId", "displayName", "accountLabel", "accountFingerprint", "organizationLabel", "authMethod", "credentialRef", "runtimeKind", "status", "createdAt", "updatedAt", "lastVerifiedAt", "expiresAt", "lastLoginSucceeded"];
  return Object.fromEntries(allowed.filter((key) => profile[key] !== undefined).map((key) => [key, profile[key]]));
}

export class JsonProviderProfileRepository {
  constructor({ filePath = process.env.AI_PROVIDER_PROFILE_STORE || "/workspace/runtime/ai-provider-profiles/metadata.json", now = () => new Date() } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.queue = Promise.resolve();
  }

  async read() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      return { ...emptyState(), ...parsed, profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [], activations: parsed.activations && typeof parsed.activations === "object" ? parsed.activations : {}, auditEvents: Array.isArray(parsed.auditEvents) ? parsed.auditEvents : [] };
    } catch (error) {
      if (error.code === "ENOENT") return emptyState();
      throw error;
    }
  }

  async write(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, this.filePath);
    await fs.chmod(this.filePath, 0o600);
  }

  transaction(work) {
    const run = this.queue.then(async () => {
      const state = await this.read();
      const result = await work(state);
      await this.write(state);
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async listProfiles(scope, providerId = null) {
    const state = await this.read();
    return state.profiles.filter((profile) => profileMatches(profile, scope, providerId)).map((profile) => ({ ...profile }));
  }

  async getProfile(scope, providerId, profileId) {
    return (await this.listProfiles(scope, providerId)).find((profile) => profile.id === profileId) || null;
  }

  async saveProfile(scope, input) {
    return this.transaction((state) => {
      const record = safeRecord({ ...input, tenantId: scope.tenantId, principalId: scope.principalId, updatedAt: this.now().toISOString() });
      const index = state.profiles.findIndex((profile) => profileMatches(profile, scope, input.providerId) && profile.id === input.id);
      if (index >= 0) state.profiles[index] = { ...state.profiles[index], ...record };
      else state.profiles.push({ ...record, createdAt: record.createdAt || this.now().toISOString() });
      return { ...(index >= 0 ? state.profiles[index] : state.profiles.at(-1)) };
    });
  }

  async activateProfile(scope, providerId, profileId, workspaceId = "*") {
    return this.transaction((state) => {
      const profile = state.profiles.find((item) => profileMatches(item, scope, providerId) && item.id === profileId);
      if (!profile) throw Object.assign(new Error("Provider profile was not found."), { code: "profile_not_found", status: 404 });
      if (profile.status !== "connected") throw Object.assign(new Error("Only a connected provider profile can be activated."), { code: "profile_not_connected", status: 409 });
      const key = activationKey({ ...scope, providerId, workspaceId });
      const previousProfileId = state.activations[key]?.profileId || null;
      state.activations[key] = { profileId, activatedAt: this.now().toISOString() };
      return { profile: { ...profile }, previousProfileId, workspaceId: workspaceId || "*", idempotent: previousProfileId === profileId };
    });
  }

  async getActivation(scope, providerId, workspaceId = "*") {
    const state = await this.read();
    const workspace = workspaceId && workspaceId !== "*" ? state.activations[activationKey({ ...scope, providerId, workspaceId })] : null;
    const global = state.activations[activationKey({ ...scope, providerId, workspaceId: "*" })];
    const selected = workspace || global;
    return selected ? { ...selected, scope: workspace ? "workspace" : "global", workspaceId: workspace ? workspaceId : "*" } : null;
  }

  async removeProfile(scope, providerId, profileId) {
    return this.transaction((state) => {
      const index = state.profiles.findIndex((item) => profileMatches(item, scope, providerId) && item.id === profileId);
      if (index < 0) return { removed: false };
      state.profiles.splice(index, 1);
      for (const [key, activation] of Object.entries(state.activations)) {
        if (activation.profileId === profileId && key.startsWith(`${scopeKey(scope)}\u0000${providerId}\u0000`)) delete state.activations[key];
      }
      return { removed: true };
    });
  }

  async appendAudit(event) {
    return this.transaction((state) => {
      const row = {
        id: event.id,
        tenantId: event.tenantId,
        principalId: event.principalId,
        workspaceId: event.workspaceId || "*",
        providerId: event.providerId,
        profileId: event.profileId || null,
        eventType: event.eventType,
        result: event.result,
        failureCategory: event.failureCategory || "",
        accountFingerprint: event.accountFingerprint || "",
        metadata: sanitizeAuditMetadata(event.metadata),
        createdAt: event.createdAt || this.now().toISOString()
      };
      state.auditEvents.push(row);
      state.auditEvents = state.auditEvents.slice(-2000);
      return { ...row };
    });
  }

  async listAudit(scope, limit = 100) {
    const state = await this.read();
    return state.auditEvents.filter((event) => event.tenantId === scope.tenantId && event.principalId === scope.principalId).slice(-Math.max(1, Math.min(250, limit)));
  }
}

function fromRow(row) {
  return {
    id: row.profile_id,
    tenantId: row.tenant_id,
    principalId: row.principal_id,
    providerId: row.provider_id,
    displayName: row.display_name,
    accountLabel: row.account_label || "",
    accountFingerprint: row.account_fingerprint || "",
    organizationLabel: row.organization_label || "",
    authMethod: row.auth_method,
    credentialRef: row.credential_ref,
    runtimeKind: row.runtime_kind,
    status: row.status,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
    lastVerifiedAt: row.last_verified_at?.toISOString?.() || row.last_verified_at || "",
    expiresAt: row.expires_at?.toISOString?.() || row.expires_at || "",
    lastLoginSucceeded: row.last_login_succeeded
  };
}

export class PostgresProviderProfileRepository {
  constructor({ databaseUrl, pool = null, now = () => new Date() } = {}) {
    this.databaseUrl = databaseUrl;
    this.pool = pool;
    this.now = now;
  }

  async database() {
    if (this.pool) return this.pool;
    const { default: pg } = await import("pg");
    this.pool = new pg.Pool({ connectionString: this.databaseUrl, max: 5, idleTimeoutMillis: 10_000 });
    return this.pool;
  }

  async listProfiles(scope, providerId = null) {
    const pool = await this.database();
    const result = await pool.query(`SELECT * FROM ai_provider_profiles WHERE tenant_id=$1 AND principal_id=$2 AND ($3::text IS NULL OR provider_id=$3) ORDER BY created_at`, [scope.tenantId, scope.principalId, providerId]);
    return result.rows.map(fromRow);
  }

  async getProfile(scope, providerId, profileId) {
    const pool = await this.database();
    const result = await pool.query(`SELECT * FROM ai_provider_profiles WHERE tenant_id=$1 AND principal_id=$2 AND provider_id=$3 AND profile_id=$4`, [scope.tenantId, scope.principalId, providerId, profileId]);
    return result.rowCount ? fromRow(result.rows[0]) : null;
  }

  async saveProfile(scope, input) {
    const record = safeRecord({ ...input, tenantId: scope.tenantId, principalId: scope.principalId });
    const pool = await this.database();
    const result = await pool.query(`INSERT INTO ai_provider_profiles
      (profile_id,tenant_id,principal_id,provider_id,display_name,account_label,account_fingerprint,organization_label,auth_method,credential_ref,runtime_kind,status,last_verified_at,expires_at,last_login_succeeded)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (tenant_id,principal_id,provider_id,profile_id) DO UPDATE SET display_name=EXCLUDED.display_name,account_label=EXCLUDED.account_label,account_fingerprint=EXCLUDED.account_fingerprint,organization_label=EXCLUDED.organization_label,auth_method=EXCLUDED.auth_method,credential_ref=EXCLUDED.credential_ref,runtime_kind=EXCLUDED.runtime_kind,status=EXCLUDED.status,last_verified_at=EXCLUDED.last_verified_at,expires_at=EXCLUDED.expires_at,last_login_succeeded=EXCLUDED.last_login_succeeded,updated_at=clock_timestamp()
      RETURNING *`, [record.id, scope.tenantId, scope.principalId, record.providerId, record.displayName, record.accountLabel || null, record.accountFingerprint || null, record.organizationLabel || null, record.authMethod, record.credentialRef, record.runtimeKind, record.status, record.lastVerifiedAt || null, record.expiresAt || null, Boolean(record.lastLoginSucceeded)]);
    return fromRow(result.rows[0]);
  }

  async activateProfile(scope, providerId, profileId, workspaceId = "*") {
    const pool = await this.database();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${scope.tenantId}:${scope.principalId}:${providerId}:${workspaceId}`]);
      const target = await client.query(`SELECT * FROM ai_provider_profiles WHERE tenant_id=$1 AND principal_id=$2 AND provider_id=$3 AND profile_id=$4 FOR UPDATE`, [scope.tenantId, scope.principalId, providerId, profileId]);
      if (!target.rowCount) throw Object.assign(new Error("Provider profile was not found."), { code: "profile_not_found", status: 404 });
      if (target.rows[0].status !== "connected") throw Object.assign(new Error("Only a connected provider profile can be activated."), { code: "profile_not_connected", status: 409 });
      const previous = await client.query(`SELECT profile_id FROM ai_provider_activations WHERE tenant_id=$1 AND principal_id=$2 AND provider_id=$3 AND workspace_id=$4 FOR UPDATE`, [scope.tenantId, scope.principalId, providerId, workspaceId]);
      await client.query(`INSERT INTO ai_provider_activations (tenant_id,principal_id,provider_id,workspace_id,profile_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,principal_id,provider_id,workspace_id) DO UPDATE SET profile_id=EXCLUDED.profile_id,activated_at=clock_timestamp()`, [scope.tenantId, scope.principalId, providerId, workspaceId, profileId]);
      await client.query("COMMIT");
      return { profile: fromRow(target.rows[0]), previousProfileId: previous.rows[0]?.profile_id || null, workspaceId, idempotent: previous.rows[0]?.profile_id === profileId };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getActivation(scope, providerId, workspaceId = "*") {
    const pool = await this.database();
    const result = await pool.query(`SELECT profile_id,workspace_id,activated_at FROM ai_provider_activations WHERE tenant_id=$1 AND principal_id=$2 AND provider_id=$3 AND workspace_id IN ('*',$4) ORDER BY CASE WHEN workspace_id=$4 THEN 0 ELSE 1 END LIMIT 1`, [scope.tenantId, scope.principalId, providerId, workspaceId]);
    if (!result.rowCount) return null;
    return { profileId: result.rows[0].profile_id, workspaceId: result.rows[0].workspace_id, scope: result.rows[0].workspace_id === "*" ? "global" : "workspace", activatedAt: result.rows[0].activated_at?.toISOString?.() || result.rows[0].activated_at };
  }

  async removeProfile(scope, providerId, profileId) {
    const pool = await this.database();
    const result = await pool.query(`DELETE FROM ai_provider_profiles WHERE tenant_id=$1 AND principal_id=$2 AND provider_id=$3 AND profile_id=$4`, [scope.tenantId, scope.principalId, providerId, profileId]);
    return { removed: result.rowCount > 0 };
  }

  async appendAudit(event) {
    const pool = await this.database();
    const metadata = sanitizeAuditMetadata(event.metadata);
    await pool.query(`INSERT INTO ai_provider_audit_events (event_id,tenant_id,principal_id,workspace_id,provider_id,profile_id,event_type,result,failure_category,account_fingerprint,metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`, [event.id, event.tenantId, event.principalId, event.workspaceId || "*", event.providerId, event.profileId || null, event.eventType, event.result, event.failureCategory || null, event.accountFingerprint || null, JSON.stringify(metadata), event.createdAt || this.now().toISOString()]);
  }
}

export function createProviderProfileRepository({ env = process.env, ...options } = {}) {
  const databaseUrl = env.AI_PROVIDER_DATABASE_URL || env.DECISION_CONTINUITY_DATABASE_URL || env.DATABASE_URL;
  if (databaseUrl) return new PostgresProviderProfileRepository({ databaseUrl, ...options });
  if (String(env.NODE_ENV || "").toLowerCase() === "production") throw new Error("AI provider profile metadata requires AI_PROVIDER_DATABASE_URL or DATABASE_URL in production.");
  return new JsonProviderProfileRepository({ filePath: env.AI_PROVIDER_PROFILE_STORE || options.filePath, ...options });
}
