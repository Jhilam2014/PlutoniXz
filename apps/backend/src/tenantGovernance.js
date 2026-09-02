import crypto from "node:crypto";

const AGENT_SOURCES = new Set(["global_community", "enterprise"]);
const INVITABLE_ROLES = new Set(["team_member", "operator", "proposer", "auditor"]);

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
  constructor({ databaseUrl = process.env.DECISION_CONTINUITY_DATABASE_URL || process.env.DATABASE_URL, pool = null } = {}) {
    this.databaseUrl = databaseUrl || "";
    this.pool = pool;
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
      const generatedPrincipalId = `principal-${digest(`${issuer}:${subject}`, 24)}`;
      const principal = await client.query(
        `INSERT INTO identity_principals (principal_id, issuer, subject, principal_type, display_name, email, status)
         VALUES ($1,$2,$3,'human',$4,$5,'active')
         ON CONFLICT (issuer, subject) DO UPDATE
           SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, status = 'active', updated_at = clock_timestamp()
         RETURNING principal_id`,
        [generatedPrincipalId, issuer, subject, clean(identity.displayName, 160), normalizedEmail]
      );
      const principalId = principal.rows[0].principal_id;
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

  async isPlatformAdmin(identity = {}) {
    if (!identity.emailVerified || !identity.email) return false;
    const pool = await this.database();
    const result = await pool.query("SELECT 1 FROM platform_admin_identities WHERE email_key = $1 AND status = 'active'", [emailKey(identity.email)]).catch((error) => { throw this.normalizeError(error); });
    return Boolean(result.rowCount);
  }

  async platformOverview(identity = {}) {
    if (!(await this.isPlatformAdmin(identity))) throw new TenantGovernanceError("Platform administration requires the configured verified identity.", { code: "platform_admin_required", status: 403 });
    await this.transaction((client) => this.ensureMembershipInstances(client));
    const pool = await this.database();
    try {
      const result = await pool.query(`
        SELECT i.tenant_id, i.instance_key, i.created_at,
               COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.enterprise_id, 'label', e.label, 'createdAt', e.created_at) ORDER BY e.created_at) FROM tenant_enterprises e WHERE e.tenant_id = i.tenant_id), '[]'::jsonb) AS enterprises,
               COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.application_id, 'name', a.application_name, 'enterpriseId', a.enterprise_id, 'agentSource', a.agent_source, 'ownerPrincipalId', a.owner_principal_id, 'createdAt', a.created_at) ORDER BY a.created_at DESC) FROM tenant_applications a WHERE a.tenant_id = i.tenant_id), '[]'::jsonb) AS applications,
               COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.principal_id, 'name', p.display_name, 'email', p.email, 'roles', m.roles, 'status', m.status) ORDER BY m.created_at) FROM identity_tenant_memberships m JOIN identity_principals p ON p.principal_id = m.principal_id WHERE m.tenant_id = i.tenant_id AND m.workspace_id = '*'), '[]'::jsonb) AS members
          FROM tenant_instances i ORDER BY i.created_at`);
      return {
        administrator: { email: emailKey(identity.email), displayName: clean(identity.displayName, 160) },
        tenants: result.rows.map((row) => ({ id: row.tenant_id, instanceKey: row.instance_key, createdAt: row.created_at, enterprises: row.enterprises || [], applications: row.applications || [], members: row.members || [] }))
      };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }
}

export const tenantInstanceKey = instanceKey;
