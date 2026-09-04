import crypto from "node:crypto";

const AGENT_SOURCES = new Set(["global_community", "enterprise"]);
const INVITABLE_ROLES = new Set(["team_member", "operator", "proposer", "auditor"]);
const GOOGLE_IDENTITY_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const TENANT_INSTANCE_KEY_PATTERN = /^tenant-[a-f0-9]{16}$/;

export class TenantGovernanceError extends Error {
  constructor(message, { code = "tenant_governance_error", status = 400, details } = {}) {
    super(message);
    this.name = "TenantGovernanceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function clean(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function emailKey(value) {
  const email = clean(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new TenantGovernanceError("A valid team member email address is required.", { code: "invalid_email" });
  }
  return email;
}

function configurationError(message) {
  return new TenantGovernanceError(message, { code: "google_jit_configuration_invalid", status: 503 });
}

function googleIssuerAliases(value) {
  const issuer = String(value || "").trim();
  if (!GOOGLE_IDENTITY_ISSUERS.has(issuer)) return issuer ? [issuer] : [];
  return [issuer, ...[...GOOGLE_IDENTITY_ISSUERS].filter((candidate) => candidate !== issuer)];
}

function pageInteger(value, fallback, { name, min, max }) {
  const normalized = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw new TenantGovernanceError(`${name} must be an integer between ${min} and ${max}.`, { code: "invalid_pagination", status: 400 });
  }
  return normalized;
}

export function resolveGoogleJitOnboardingPolicy(env = process.env) {
  const rawEnabled = String(env.PLUTOMIX_GOOGLE_JIT_ONBOARDING_ENABLED || "false").trim().toLowerCase();
  if (!new Set(["true", "false"]).has(rawEnabled)) {
    throw configurationError("PLUTOMIX_GOOGLE_JIT_ONBOARDING_ENABLED must be true or false.");
  }
  const enabled = rawEnabled === "true";
  if (!enabled) return { enabled: false };

  const tenantSelector = String(env.PLUTOMIX_GOOGLE_JIT_TENANT_ID || "").trim();
  const expectedInstanceKey = String(env.PLUTOMIX_GOOGLE_JIT_TENANT_INSTANCE_KEY || "").trim();
  const configuredAdminIssuer = String(env.PLUTOMIX_GOOGLE_JIT_ADMIN_ISSUER || "").trim();
  const adminSubject = String(env.PLUTOMIX_GOOGLE_JIT_ADMIN_SUBJECT || "").trim();
  let adminEmail;
  try {
    adminEmail = emailKey(env.PLUTOMIX_GOOGLE_JIT_ADMIN_EMAIL);
  } catch {
    throw configurationError("PLUTOMIX_GOOGLE_JIT_ADMIN_EMAIL must be a valid email address.");
  }
  if (!tenantSelector || tenantSelector.length > 160) {
    throw configurationError("PLUTOMIX_GOOGLE_JIT_TENANT_ID must identify one tenant or tenant instance.");
  }
  if (expectedInstanceKey && !TENANT_INSTANCE_KEY_PATTERN.test(expectedInstanceKey)) {
    throw configurationError("PLUTOMIX_GOOGLE_JIT_TENANT_INSTANCE_KEY must be a valid tenant instance key.");
  }
  if (!GOOGLE_IDENTITY_ISSUERS.has(configuredAdminIssuer)) {
    throw configurationError("PLUTOMIX_GOOGLE_JIT_ADMIN_ISSUER must be a Google identity issuer.");
  }
  if (!/^\d{1,200}$/.test(adminSubject)) {
    throw configurationError("PLUTOMIX_GOOGLE_JIT_ADMIN_SUBJECT must be the numeric Google subject, not an OAuth client ID.");
  }
  const configuredOidcIssuer = String(env.OIDC_ISSUER || "").trim().replace(/\/$/, "");
  if (GOOGLE_IDENTITY_ISSUERS.has(configuredOidcIssuer) && configuredOidcIssuer !== configuredAdminIssuer) {
    throw configurationError("PLUTOMIX_GOOGLE_JIT_ADMIN_ISSUER must match OIDC_ISSUER.");
  }
  return { enabled, tenantSelector, expectedInstanceKey, adminIssuer: configuredAdminIssuer, adminSubject, adminEmail };
}

export function assertGoogleJitOnboardingConfiguration(env = process.env) {
  resolveGoogleJitOnboardingPolicy(env);
}

function verifiedGoogleIdentity(identity = {}) {
  if (!identity.emailVerified) {
    throw new TenantGovernanceError("A verified Google email identity is required for onboarding.", { code: "verified_email_required", status: 403 });
  }
  const sourceIssuer = String(identity.issuer || "").trim();
  const subject = String(identity.subject || "").trim();
  if (!GOOGLE_IDENTITY_ISSUERS.has(sourceIssuer) || !subject || subject.length > 200) {
    throw new TenantGovernanceError("A verified Google identity is required for onboarding.", { code: "google_identity_required", status: 401 });
  }
  return {
    issuer: sourceIssuer,
    subject,
    email: emailKey(identity.email),
    displayName: clean(identity.displayName, 160)
  };
}

export function googleJitRoleForIdentity(identity, policy) {
  if (!policy?.enabled) return null;
  const normalized = verifiedGoogleIdentity(identity);
  if (normalized.issuer !== policy.adminIssuer) {
    throw new TenantGovernanceError("The Google identity issuer does not match the configured onboarding issuer.", { code: "google_identity_required", status: 401 });
  }
  const platformAdmin = normalized.issuer === policy.adminIssuer
    && normalized.subject === policy.adminSubject
    && normalized.email === policy.adminEmail;
  return { ...normalized, role: platformAdmin ? "tenant_admin" : "team_member", platformAdmin };
}

function labelKey(value) {
  return clean(value, 80).replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function slug(value) {
  return clean(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
}

function digest(value, length = 16) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function instanceKey(tenantId) {
  return `tenant-${digest(tenantId, 16)}`;
}

function enterpriseRow(row) {
  return {
    id: row.enterprise_id,
    label: row.label,
    applicationCount: Number(row.application_count || 0),
    createdAt: row.created_at
  };
}

function applicationRow(row) {
  return {
    id: row.application_id,
    name: row.application_name,
    enterpriseId: row.enterprise_id,
    instanceKey: row.instance_key,
    agentSource: row.agent_source,
    ownerPrincipalId: row.owner_principal_id || "",
    createdAt: row.created_at
  };
}

function invitationRow(row) {
  return {
    id: row.invitation_id,
    email: row.email,
    roles: row.roles || [],
    status: row.status,
    acceptedAt: row.accepted_at || null,
    createdAt: row.created_at
  };
}

export class TenantGovernanceService {
  constructor({ databaseUrl = process.env.DECISION_CONTINUITY_DATABASE_URL || process.env.DATABASE_URL, pool = null, env = process.env } = {}) {
    this.databaseUrl = databaseUrl || "";
    this.pool = pool;
    this.env = env;
  }

  async database() {
    if (this.pool) return this.pool;
    if (!this.databaseUrl) throw new TenantGovernanceError("Tenant governance is unavailable.", { code: "tenant_governance_unavailable", status: 503 });
    const { default: pg } = await import("pg");
    this.pool = new pg.Pool({ connectionString: this.databaseUrl, max: 6, idleTimeoutMillis: 10_000 });
    return this.pool;
  }

  async transaction(work) {
    const pool = await this.database();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw this.normalizeError(error);
    } finally {
      client.release();
    }
  }

  normalizeError(error) {
    if (error instanceof TenantGovernanceError) return error;
    if (error?.code === "42P01") return new TenantGovernanceError("Tenant governance migration 014 is required.", { code: "tenant_governance_migration_required", status: 503 });
    if (error?.code === "P0001" && /enterprise limit/i.test(error.message || "")) {
      return new TenantGovernanceError("This tenant already has two enterprises. Delete an existing empty enterprise before creating another.", { code: "enterprise_limit_reached", status: 409, details: { limit: 2 } });
    }
    if (error?.code === "23503") return new TenantGovernanceError("The requested tenant or enterprise relationship is unavailable.", { code: "tenant_resource_not_found", status: 404 });
    if (error?.code === "23505") return new TenantGovernanceError("That enterprise label or team invitation already exists.", { code: "tenant_resource_conflict", status: 409 });
    return new TenantGovernanceError("Tenant governance is temporarily unavailable.", { code: "tenant_governance_unavailable", status: 503 });
  }

  async ensureInstance(client, tenantId) {
    const id = clean(tenantId);
    if (!id) throw new TenantGovernanceError("An authorized tenant is required.", { code: "tenant_required", status: 401 });
    const key = instanceKey(id);
    const inserted = await client.query(
      `INSERT INTO tenant_instances (tenant_id, instance_key)
       VALUES ($1,$2)
       ON CONFLICT DO NOTHING
       RETURNING tenant_id, instance_key, created_at`,
      [id, key]
    );
    const result = inserted.rowCount
      ? inserted
      : await client.query("SELECT tenant_id, instance_key, created_at FROM tenant_instances WHERE tenant_id = $1", [id]);
    if (!result.rowCount || result.rows[0].instance_key !== key) {
      throw new TenantGovernanceError("The tenant instance boundary is inconsistent.", { code: "tenant_instance_conflict", status: 409 });
    }
    return { tenantId: result.rows[0].tenant_id, instanceKey: result.rows[0].instance_key, createdAt: result.rows[0].created_at };
  }

  async resolveConfiguredTenant(client, policy) {
    const selected = await client.query(
      `SELECT tenant_id, instance_key, created_at
         FROM tenant_instances
        WHERE tenant_id = $1 OR instance_key = $1
        ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END`,
      [policy.tenantSelector]
    );
    if (selected.rowCount > 1) {
      throw configurationError("The configured Google onboarding tenant selector is ambiguous.");
    }
    let tenant;
    if (selected.rowCount) {
      tenant = {
        tenantId: selected.rows[0].tenant_id,
        instanceKey: selected.rows[0].instance_key,
        createdAt: selected.rows[0].created_at
      };
    } else if (TENANT_INSTANCE_KEY_PATTERN.test(policy.tenantSelector)) {
      throw configurationError("The configured Google onboarding tenant instance does not exist.");
    } else {
      tenant = await this.ensureInstance(client, policy.tenantSelector);
    }
    if (policy.expectedInstanceKey && tenant.instanceKey !== policy.expectedInstanceKey) {
      throw configurationError("The configured Google onboarding tenant does not match its expected instance key.");
    }
    return tenant;
  }

  async reconcileGooglePrincipalAliases(client, principals, candidate) {
    if (principals.length !== 2) {
      throw new TenantGovernanceError("Conflicting Google issuer aliases exist for this identity.", { code: "principal_alias_conflict", status: 403 });
    }
    if (principals.some((principal) => principal.principal_type !== "human")) {
      throw new TenantGovernanceError("Conflicting Google issuer aliases exist for this identity.", { code: "principal_alias_conflict", status: 403 });
    }
    if (principals.some((principal) => principal.status !== "active")) {
      throw new TenantGovernanceError("The Google identity is disabled and cannot be automatically onboarded.", { code: "principal_disabled", status: 403 });
    }
    const storedEmails = principals
      .map((principal) => String(principal.email || "").trim().toLowerCase())
      .filter(Boolean);
    if (storedEmails.some((email) => email !== candidate.email)) {
      throw new TenantGovernanceError("Conflicting Google issuer aliases exist for this identity.", { code: "principal_alias_conflict", status: 403 });
    }

    const keeper = principals.find((principal) => principal.issuer === candidate.issuer);
    const duplicate = principals.find((principal) => principal.principal_id !== keeper?.principal_id);
    if (!keeper || !duplicate) {
      throw new TenantGovernanceError("Conflicting Google issuer aliases exist for this identity.", { code: "principal_alias_conflict", status: 403 });
    }

    const duplicateMemberships = await client.query(
      `SELECT tenant_id, workspace_id, roles, service_scopes, status, created_at
         FROM identity_tenant_memberships
        WHERE principal_id = $1
        FOR UPDATE`,
      [duplicate.principal_id]
    );
    for (const membership of duplicateMemberships.rows) {
      await client.query(
        `INSERT INTO identity_tenant_memberships
           (principal_id, tenant_id, workspace_id, roles, service_scopes, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4::text[],$5::text[],$6,$7,clock_timestamp())
         ON CONFLICT (principal_id, tenant_id, workspace_id) DO UPDATE
           SET roles = ARRAY(
                 SELECT DISTINCT value
                   FROM unnest(identity_tenant_memberships.roles || EXCLUDED.roles) AS values(value)
                  ORDER BY value
               ),
               service_scopes = ARRAY(
                 SELECT DISTINCT value
                   FROM unnest(identity_tenant_memberships.service_scopes || EXCLUDED.service_scopes) AS values(value)
                  ORDER BY value
               ),
               status = CASE
                 WHEN identity_tenant_memberships.status = 'revoked' OR EXCLUDED.status = 'revoked' THEN 'revoked'
                 ELSE 'active'
               END,
               created_at = LEAST(identity_tenant_memberships.created_at, EXCLUDED.created_at),
               updated_at = clock_timestamp()`,
        [
          keeper.principal_id,
          membership.tenant_id,
          membership.workspace_id,
          membership.roles || [],
          membership.service_scopes || [],
          membership.status,
          membership.created_at
        ]
      );
    }

    await client.query("DELETE FROM identity_tenant_memberships WHERE principal_id = $1", [duplicate.principal_id]);
    await client.query("UPDATE identity_access_audit SET principal_id = $1 WHERE principal_id = $2", [keeper.principal_id, duplicate.principal_id]);
    await client.query("UPDATE tenant_enterprises SET created_by_principal_id = $1 WHERE created_by_principal_id = $2", [keeper.principal_id, duplicate.principal_id]);
    await client.query("UPDATE tenant_applications SET owner_principal_id = $1 WHERE owner_principal_id = $2", [keeper.principal_id, duplicate.principal_id]);
    await client.query("UPDATE tenant_team_invitations SET invited_by_principal_id = $1 WHERE invited_by_principal_id = $2", [keeper.principal_id, duplicate.principal_id]);
    await client.query("UPDATE tenant_team_invitations SET accepted_by_principal_id = $1 WHERE accepted_by_principal_id = $2", [keeper.principal_id, duplicate.principal_id]);
    await client.query("DELETE FROM identity_principals WHERE principal_id = $1", [duplicate.principal_id]);
    await client.query(
      `INSERT INTO identity_access_audit
         (principal_id, tenant_id, workspace_id, action, outcome, code, metadata)
       VALUES ($1,NULL,NULL,'identity.google_alias_reconcile','allowed','aliases_merged',$2::jsonb)`,
      [keeper.principal_id, JSON.stringify({ retainedIssuer: candidate.issuer, removedIssuer: duplicate.issuer })]
    );
    return keeper;
  }

  async onboardGoogleIdentity(identity = {}) {
    const policy = resolveGoogleJitOnboardingPolicy(this.env);
    if (!policy.enabled) {
      return { principalId: null, tenantIds: [], roles: [], platformAdmin: false, provisioned: false };
    }
    let candidate;
    try {
      candidate = googleJitRoleForIdentity(identity, policy);
      return await this.transaction(async (client) => {
        const tenant = await this.resolveConfiguredTenant(client, policy);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, $2))", [`${candidate.issuer}:${candidate.subject}`, 1604]);
        let existingPrincipal = await client.query(
          `SELECT principal_id, issuer, principal_type, status, email
             FROM identity_principals
            WHERE issuer = ANY($1::text[]) AND subject = $2
            FOR UPDATE`,
          [googleIssuerAliases(candidate.issuer), candidate.subject]
        );
        let aliasesReconciled = false;
        if (existingPrincipal.rowCount > 1) {
          const retained = await this.reconcileGooglePrincipalAliases(client, existingPrincipal.rows, candidate);
          existingPrincipal = { rowCount: 1, rows: [retained] };
          aliasesReconciled = true;
        }
        if (existingPrincipal.rowCount && (existingPrincipal.rows[0].principal_type !== "human" || existingPrincipal.rows[0].status !== "active")) {
          throw new TenantGovernanceError("The Google identity is disabled and cannot be automatically onboarded.", { code: "principal_disabled", status: 403 });
        }

        const principalId = existingPrincipal.rows[0]?.principal_id || `principal-${digest(`${candidate.issuer}:${candidate.subject}`, 24)}`;
        const principalCreated = !existingPrincipal.rowCount;
        if (principalCreated) {
          await client.query(
            `INSERT INTO identity_principals
               (principal_id, issuer, subject, principal_type, display_name, email, status)
             VALUES ($1,$2,$3,'human',$4,$5,'active')`,
            [principalId, candidate.issuer, candidate.subject, candidate.displayName, candidate.email]
          );
        } else {
          await client.query(
            `UPDATE identity_principals
                SET issuer = $2, display_name = $3, email = $4, updated_at = clock_timestamp()
              WHERE principal_id = $1 AND status = 'active'`,
            [principalId, candidate.issuer, candidate.displayName, candidate.email]
          );
        }

        const existingMemberships = await client.query(
          `SELECT workspace_id, roles, status
             FROM identity_tenant_memberships
            WHERE principal_id = $1 AND tenant_id = $2
            FOR UPDATE`,
          [principalId, tenant.tenantId]
        );
        if (existingMemberships.rows.some((membership) => membership.status !== "active")) {
          throw new TenantGovernanceError("The Google identity's tenant membership is revoked.", { code: "membership_revoked", status: 403 });
        }
        const existingMembership = existingMemberships.rows.find((membership) => membership.workspace_id === "*");

        const membershipCreated = !existingMembership;
        let roleAdded = false;
        let roles;
        if (membershipCreated) {
          roles = [candidate.role];
          await client.query(
            `INSERT INTO identity_tenant_memberships
               (principal_id, tenant_id, workspace_id, roles, status)
             VALUES ($1,$2,'*',$3::text[],'active')`,
            [principalId, tenant.tenantId, roles]
          );
        } else {
          roles = existingMembership.roles || [];
          if (!roles.includes(candidate.role)) {
            roleAdded = true;
            const updated = await client.query(
              `UPDATE identity_tenant_memberships
                  SET roles = array_append(roles, $3::text), updated_at = clock_timestamp()
                WHERE principal_id = $1 AND tenant_id = $2 AND workspace_id = '*' AND status = 'active'
                RETURNING roles`,
              [principalId, tenant.tenantId, candidate.role]
            );
            roles = updated.rows[0].roles;
          }
        }

        let platformAdminCreated = false;
        if (candidate.platformAdmin) {
          const platformIdentity = await client.query(
            "SELECT status FROM platform_admin_identities WHERE email_key = $1 FOR UPDATE",
            [candidate.email]
          );
          if (platformIdentity.rowCount && platformIdentity.rows[0].status !== "active") {
            throw new TenantGovernanceError("The platform administrator identity is disabled.", { code: "platform_admin_disabled", status: 403 });
          }
          if (platformIdentity.rowCount) {
            await client.query(
              "UPDATE platform_admin_identities SET display_name = $2, updated_at = clock_timestamp() WHERE email_key = $1 AND status = 'active'",
              [candidate.email, candidate.displayName]
            );
          } else {
            platformAdminCreated = true;
            await client.query(
              "INSERT INTO platform_admin_identities (email_key, display_name, status) VALUES ($1,$2,'active')",
              [candidate.email, candidate.displayName]
            );
          }
        }

        const provisioned = principalCreated || aliasesReconciled || membershipCreated || roleAdded || platformAdminCreated;
        if (provisioned) {
          await client.query(
            `INSERT INTO identity_access_audit
               (principal_id, tenant_id, workspace_id, action, outcome, code, metadata)
             VALUES ($1,$2,'*','identity.google_jit_onboard','allowed','provisioned',$3::jsonb)`,
            [principalId, tenant.tenantId, JSON.stringify({ role: candidate.role, platformAdmin: candidate.platformAdmin })]
          );
        }
        return {
          principalId,
          tenantIds: [tenant.tenantId],
          roles,
          platformAdmin: candidate.platformAdmin,
          provisioned
        };
      });
    } catch (error) {
      await this.recordGoogleJitDenial(candidate || identity, policy, error).catch(() => {});
      throw error;
    }
  }

  async recordGoogleJitDenial(identity, policy, error) {
    const issuers = googleIssuerAliases(identity?.issuer);
    const subject = clean(identity?.subject, 200);
    const pool = await this.database();
    const principal = issuers.length && subject
      ? await pool.query("SELECT principal_id FROM identity_principals WHERE issuer = ANY($1::text[]) AND subject = $2 ORDER BY principal_id LIMIT 2", [issuers, subject])
      : { rows: [] };
    await pool.query(
      `INSERT INTO identity_access_audit
         (principal_id, tenant_id, workspace_id, action, outcome, code, metadata)
       VALUES ($1,$2,'*','identity.google_jit_onboard','denied',$3,'{}'::jsonb)`,
      [principal.rowCount === 1 ? principal.rows[0].principal_id : null, policy.tenantSelector || null, clean(error?.code || "onboarding_denied", 120)]
    );
  }

  async ensureMembershipInstances(client) {
    const memberships = await client.query(
      `SELECT DISTINCT tenant_id
         FROM identity_tenant_memberships
        WHERE length(trim(tenant_id)) BETWEEN 1 AND 160`
    );
    for (const membership of memberships.rows) {
      await this.ensureInstance(client, membership.tenant_id);
    }
  }

  async resolveEnterprise({ enterpriseId = "", label = "" } = {}, { tenantId, principalId } = {}) {
    const displayLabel = clean(label, 80).replace(/\s+/g, " ");
    if (displayLabel.length < 2) throw new TenantGovernanceError("Enterprise label is required and must be 2-80 characters.", { code: "enterprise_label_required" });
    const requestedId = clean(enterpriseId, 80);
    if (requestedId && !/^[a-z0-9][a-z0-9-]{1,79}$/.test(requestedId)) {
      throw new TenantGovernanceError("Enterprise ID is invalid.", { code: "invalid_enterprise_id" });
    }
    return this.transaction(async (client) => {
      const tenant = await this.ensureInstance(client, tenantId);
      const key = labelKey(displayLabel);
      if (requestedId) {
        const selected = await client.query(
          `SELECT enterprise_id, label, created_at,
                  (SELECT count(*) FROM tenant_applications a WHERE a.tenant_id = e.tenant_id AND a.enterprise_id = e.enterprise_id) AS application_count
             FROM tenant_enterprises e WHERE tenant_id = $1 AND enterprise_id = $2`,
          [tenantId, requestedId]
        );
        if (!selected.rowCount) throw new TenantGovernanceError("The selected enterprise is not available in this tenant.", { code: "enterprise_not_found", status: 404 });
        if (labelKey(selected.rows[0].label) !== key) throw new TenantGovernanceError("The enterprise label does not match the selected enterprise.", { code: "enterprise_label_mismatch", status: 409 });
        return { tenant, enterprise: enterpriseRow(selected.rows[0]), created: false };
      }
      const existing = await client.query(
        `SELECT enterprise_id, label, created_at,
                (SELECT count(*) FROM tenant_applications a WHERE a.tenant_id = e.tenant_id AND a.enterprise_id = e.enterprise_id) AS application_count
           FROM tenant_enterprises e WHERE tenant_id = $1 AND label_key = $2`,
        [tenantId, key]
      );
      if (existing.rowCount) return { tenant, enterprise: enterpriseRow(existing.rows[0]), created: false };
      const base = slug(displayLabel) || `enterprise-${digest(key, 10)}`;
      const collision = await client.query("SELECT 1 FROM tenant_enterprises WHERE tenant_id = $1 AND enterprise_id = $2", [tenantId, base]);
      const id = collision.rowCount ? `${base.slice(0, 62)}-${digest(key, 7)}` : base;
      const inserted = await client.query(
        `INSERT INTO tenant_enterprises (tenant_id, enterprise_id, label, label_key, created_by_principal_id)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING enterprise_id, label, created_at, 0::bigint AS application_count`,
        [tenantId, id, displayLabel, key, principalId || null]
      );
      return { tenant, enterprise: enterpriseRow(inserted.rows[0]), created: true };
    });
  }

  async registerApplication({ applicationId, applicationName, enterpriseId, agentSource, ownerPrincipalId = "" } = {}, { tenantId } = {}) {
    const source = clean(agentSource, 40);
    if (!AGENT_SOURCES.has(source)) throw new TenantGovernanceError("Choose global community agents or enterprise-specific agents.", { code: "invalid_agent_source" });
    return this.transaction(async (client) => {
      const tenant = await this.ensureInstance(client, tenantId);
      const result = await client.query(
        `INSERT INTO tenant_applications
           (tenant_id, enterprise_id, application_id, application_name, instance_key, agent_source, owner_principal_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id, application_id) DO UPDATE
           SET application_name = EXCLUDED.application_name, enterprise_id = EXCLUDED.enterprise_id,
               agent_source = EXCLUDED.agent_source, updated_at = clock_timestamp()
         RETURNING *`,
        [tenantId, enterpriseId, clean(applicationId, 180), clean(applicationName, 160), tenant.instanceKey, source, ownerPrincipalId || null]
      );
      return applicationRow(result.rows[0]);
    });
  }

  async removeApplication(applicationId, { tenantId } = {}) {
    const pool = await this.database();
    const result = await pool.query("DELETE FROM tenant_applications WHERE tenant_id = $1 AND application_id = $2 RETURNING application_id", [tenantId, clean(applicationId, 180)]).catch((error) => { throw this.normalizeError(error); });
    return { removed: Boolean(result.rowCount), applicationId: clean(applicationId, 180) };
  }

  async deleteEnterprise(enterpriseId, { tenantId } = {}) {
    return this.transaction(async (client) => {
      const locked = await client.query(
        `SELECT enterprise_id FROM tenant_enterprises
          WHERE tenant_id = $1 AND enterprise_id = $2 FOR UPDATE`,
        [tenantId, clean(enterpriseId, 80)]
      );
      if (!locked.rowCount) throw new TenantGovernanceError("Enterprise not found.", { code: "enterprise_not_found", status: 404 });
      const applications = await client.query(
        "SELECT count(*)::int AS application_count FROM tenant_applications WHERE tenant_id = $1 AND enterprise_id = $2",
        [tenantId, clean(enterpriseId, 80)]
      );
      if (Number(applications.rows[0].application_count)) {
        throw new TenantGovernanceError("Delete or reassign this enterprise's applications before deleting the enterprise.", { code: "enterprise_not_empty", status: 409 });
      }
      await client.query("DELETE FROM tenant_enterprises WHERE tenant_id = $1 AND enterprise_id = $2", [tenantId, enterpriseId]);
      return { removed: true, enterpriseId };
    });
  }

  async inviteTeamMember({ email, roles = ["team_member"] } = {}, { tenantId, principalId } = {}) {
    const normalizedEmail = emailKey(email);
    const normalizedRoles = [...new Set((roles || []).map((role) => clean(role, 60)).filter((role) => INVITABLE_ROLES.has(role)))];
    if (!normalizedRoles.length) normalizedRoles.push("team_member");
    return this.transaction(async (client) => {
      await this.ensureInstance(client, tenantId);
      const result = await client.query(
        `INSERT INTO tenant_team_invitations
           (invitation_id, tenant_id, email, email_key, roles, invited_by_principal_id)
         VALUES ($1,$2,$3,$3,$4::text[],$5)
         ON CONFLICT (tenant_id, email_key) DO UPDATE
           SET email = EXCLUDED.email, roles = EXCLUDED.roles, status = 'pending',
               invited_by_principal_id = EXCLUDED.invited_by_principal_id,
               accepted_by_principal_id = NULL, accepted_at = NULL, updated_at = clock_timestamp()
         RETURNING *`,
        [crypto.randomUUID(), tenantId, normalizedEmail, normalizedRoles, principalId]
      );
      return invitationRow(result.rows[0]);
    });
  }

  async acceptInvitations(identity = {}) {
    if (!identity.emailVerified) throw new TenantGovernanceError("A verified email identity is required to accept team invitations.", { code: "verified_email_required", status: 403 });
    const normalizedEmail = emailKey(identity.email);
    const issuer = clean(identity.issuer, 300);
    const subject = clean(identity.subject, 200);
    if (!issuer || !subject) throw new TenantGovernanceError("A verified identity is required.", { code: "identity_required", status: 401 });
    return this.transaction(async (client) => {
      const invitations = await client.query(
        `SELECT * FROM tenant_team_invitations WHERE email_key = $1 AND status = 'pending' FOR UPDATE`,
        [normalizedEmail]
      );
      if (!invitations.rowCount) throw new TenantGovernanceError("No pending tenant invitation matches this verified email.", { code: "invitation_not_found", status: 404 });
      const existingPrincipal = await client.query(
        "SELECT principal_id, principal_type, status FROM identity_principals WHERE issuer = $1 AND subject = $2 FOR UPDATE",
        [issuer, subject]
      );
      if (existingPrincipal.rowCount && (existingPrincipal.rows[0].principal_type !== "human" || existingPrincipal.rows[0].status !== "active")) {
        throw new TenantGovernanceError("The identity is disabled and cannot accept an invitation.", { code: "principal_disabled", status: 403 });
      }
      const principalId = existingPrincipal.rows[0]?.principal_id || `principal-${digest(`${issuer}:${subject}`, 24)}`;
      if (existingPrincipal.rowCount) {
        await client.query(
          "UPDATE identity_principals SET display_name = $2, email = $3, updated_at = clock_timestamp() WHERE principal_id = $1 AND status = 'active'",
          [principalId, clean(identity.displayName, 160), normalizedEmail]
        );
      } else {
        await client.query(
          `INSERT INTO identity_principals (principal_id, issuer, subject, principal_type, display_name, email, status)
           VALUES ($1,$2,$3,'human',$4,$5,'active')`,
          [principalId, issuer, subject, clean(identity.displayName, 160), normalizedEmail]
        );
      }
      const accepted = [];
      for (const invitation of invitations.rows) {
        await client.query(
          `INSERT INTO identity_tenant_memberships (principal_id, tenant_id, workspace_id, roles, status)
           VALUES ($1,$2,'*',$3::text[],'active')
           ON CONFLICT (principal_id, tenant_id, workspace_id) DO UPDATE
             SET roles = EXCLUDED.roles, status = 'active', updated_at = clock_timestamp()`,
          [principalId, invitation.tenant_id, invitation.roles]
        );
        const updated = await client.query(
          `UPDATE tenant_team_invitations SET status = 'accepted', accepted_by_principal_id = $2,
                  accepted_at = clock_timestamp(), updated_at = clock_timestamp()
            WHERE invitation_id = $1 RETURNING *`,
          [invitation.invitation_id, principalId]
        );
        accepted.push(invitationRow(updated.rows[0]));
      }
      return { principalId, invitations: accepted };
    });
  }

  async overview({ tenantId } = {}) {
    const pool = await this.database();
    try {
      await this.transaction((client) => this.ensureInstance(client, tenantId));
      const [tenant, enterprises, applications, members, invitations] = await Promise.all([
        pool.query("SELECT tenant_id, instance_key, created_at FROM tenant_instances WHERE tenant_id = $1", [tenantId]),
        pool.query(`SELECT e.*, count(a.application_id)::int AS application_count FROM tenant_enterprises e LEFT JOIN tenant_applications a ON a.tenant_id = e.tenant_id AND a.enterprise_id = e.enterprise_id WHERE e.tenant_id = $1 GROUP BY e.tenant_id, e.enterprise_id ORDER BY e.created_at`, [tenantId]),
        pool.query("SELECT * FROM tenant_applications WHERE tenant_id = $1 ORDER BY created_at DESC", [tenantId]),
        pool.query(`SELECT p.principal_id, p.display_name, p.email, m.roles, m.status, m.created_at FROM identity_tenant_memberships m JOIN identity_principals p ON p.principal_id = m.principal_id WHERE m.tenant_id = $1 AND m.workspace_id = '*' ORDER BY m.created_at`, [tenantId]),
        pool.query("SELECT * FROM tenant_team_invitations WHERE tenant_id = $1 ORDER BY created_at DESC", [tenantId])
      ]);
      return {
        tenant: tenant.rowCount ? { id: tenant.rows[0].tenant_id, instanceKey: tenant.rows[0].instance_key, createdAt: tenant.rows[0].created_at } : { id: tenantId, instanceKey: instanceKey(tenantId), createdAt: null },
        limits: { enterprises: 2, enterpriseCount: enterprises.rowCount, canCreateEnterprise: enterprises.rowCount < 2 },
        enterprises: enterprises.rows.map(enterpriseRow),
        applications: applications.rows.map(applicationRow),
        members: members.rows.map((row) => ({ id: row.principal_id, name: row.display_name || "", email: row.email || "", roles: row.roles || [], status: row.status, joinedAt: row.created_at })),
        invitations: invitations.rows.map(invitationRow)
      };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async platformAdminAuthorization(client, identity = {}) {
    const issuer = clean(identity.issuer, 300);
    const issuers = googleIssuerAliases(issuer);
    const subject = clean(identity.subject, 200);
    const principal = issuers.length && subject
      ? await client.query("SELECT principal_id FROM identity_principals WHERE issuer = ANY($1::text[]) AND subject = $2 ORDER BY principal_id LIMIT 2", [issuers, subject])
      : { rows: [] };
    const principalId = principal.rowCount === 1 ? principal.rows[0].principal_id : null;
    if (principal.rowCount > 1) return { authorized: false, principalId: null, tenantId: null };
    if (!identity.emailVerified || !identity.email) return { authorized: false, principalId, tenantId: null };

    const policy = resolveGoogleJitOnboardingPolicy(this.env);
    if (policy.enabled) {
      let candidate;
      try {
        candidate = googleJitRoleForIdentity(identity, policy);
      } catch {
        return { authorized: false, principalId, tenantId: policy.tenantSelector };
      }
      if (!candidate.platformAdmin) return { authorized: false, principalId, tenantId: policy.tenantSelector };
      const tenant = await this.resolveConfiguredTenant(client, policy);
      const result = await client.query(
        `SELECT p.principal_id
           FROM platform_admin_identities a
           JOIN identity_principals p
             ON p.issuer = ANY($2::text[]) AND p.subject = $3 AND lower(trim(p.email)) = a.email_key
           JOIN identity_tenant_memberships m
             ON m.principal_id = p.principal_id AND m.tenant_id = $4 AND m.workspace_id = '*'
          WHERE a.email_key = $1 AND a.status = 'active' AND p.status = 'active'
            AND p.principal_type = 'human' AND m.status = 'active'
            AND 'tenant_admin' = ANY(m.roles)`,
        [candidate.email, googleIssuerAliases(candidate.issuer), candidate.subject, tenant.tenantId]
      );
      return { authorized: Boolean(result.rowCount), principalId: result.rows[0]?.principal_id || principalId, tenantId: tenant.tenantId };
    }

    let normalizedEmail;
    try {
      normalizedEmail = emailKey(identity.email);
    } catch {
      return { authorized: false, principalId, tenantId: null };
    }
    const result = await client.query("SELECT 1 FROM platform_admin_identities WHERE email_key = $1 AND status = 'active'", [normalizedEmail]);
    return { authorized: Boolean(result.rowCount), principalId, tenantId: null };
  }

  async recordPlatformAdminAudit(client, authorization, { outcome, code, metadata = {} }) {
    await client.query(
      `INSERT INTO identity_access_audit
         (principal_id, tenant_id, workspace_id, action, outcome, code, metadata)
       VALUES ($1,$2,NULL,'platform_admin.overview',$3,$4,$5::jsonb)`,
      [authorization.principalId, authorization.tenantId, outcome, code, JSON.stringify(metadata)]
    );
  }

  async isPlatformAdmin(identity = {}) {
    return this.transaction(async (client) => (await this.platformAdminAuthorization(client, identity)).authorized);
  }

  async platformOverview(identity = {}, pagination = {}) {
    const limit = pageInteger(pagination.limit, 25, { name: "limit", min: 1, max: 100 });
    const offset = pageInteger(pagination.offset, 0, { name: "offset", min: 0, max: 1_000_000 });
    const result = await this.transaction(async (client) => {
      const authorization = await this.platformAdminAuthorization(client, identity);
      if (!authorization.authorized) {
        await this.recordPlatformAdminAudit(client, authorization, { outcome: "denied", code: "platform_admin_required" });
        return { authorized: false };
      }

      const [countResult, tenantsResult] = await Promise.all([
        client.query("SELECT count(*)::int AS total FROM tenant_instances"),
        client.query(
          `SELECT i.tenant_id, i.instance_key, i.created_at,
                  (SELECT count(*)::int FROM identity_tenant_memberships m WHERE m.tenant_id = i.tenant_id AND m.workspace_id = '*' AND m.status = 'active') AS member_count,
                  (SELECT count(*)::int FROM tenant_enterprises e WHERE e.tenant_id = i.tenant_id) AS enterprise_count,
                  (SELECT count(*)::int FROM tenant_applications a WHERE a.tenant_id = i.tenant_id) AS application_count
             FROM tenant_instances i
            ORDER BY i.created_at DESC, i.tenant_id
            LIMIT $1 OFFSET $2`,
          [limit, offset]
        )
      ]);
      const total = Number(countResult.rows[0]?.total || 0);
      const returned = tenantsResult.rowCount;
      await this.recordPlatformAdminAudit(client, authorization, {
        outcome: "allowed",
        code: "authorized",
        metadata: { limit, offset, returned, total }
      });
      return {
        authorized: true,
        tenants: tenantsResult.rows.map((row) => ({
          id: row.tenant_id,
          instanceKey: row.instance_key,
          createdAt: row.created_at,
          memberCount: Number(row.member_count || 0),
          enterpriseCount: Number(row.enterprise_count || 0),
          applicationCount: Number(row.application_count || 0)
        })),
        pagination: {
          offset,
          limit,
          returned,
          total,
          hasMore: offset + returned < total,
          nextOffset: offset + returned
        }
      };
    });
    if (!result.authorized) {
      throw new TenantGovernanceError("Platform administration requires the configured verified identity.", { code: "platform_admin_required", status: 403 });
    }
    const { authorized: _authorized, ...overview } = result;
    return overview;
  }
}

export const tenantInstanceKey = instanceKey;
