import { AuthenticationError, externalIdentityFromRequest, identityIssuerAliases } from "./auth.js";

export const DECISION_PERMISSIONS = Object.freeze({
  READ: "decision:read",
  PROPOSE: "decision:propose",
  OPERATE: "decision:operate",
  CONDITION_INGEST: "decision:condition_ingest",
  EVALUATE: "decision:evaluate",
  POLICY: "decision:policy",
  APPROVE: "decision:approve",
  CANARY: "decision:canary",
  READINESS: "decision:readiness",
  QAGENT_INVESTIGATE: "qagent:investigate",
  QAGENT_READ: "qagent:read",
  BRAINX_READ: "brainx:read",
  BRAINX_ADMIN: "brainx:admin",
  BRAINX_EXECUTE: "brainx:execute",
  SUGGESTION_READ: "suggestion:read",
  SUGGESTION_EDIT: "suggestion:edit",
  SUGGESTION_REVIEW: "suggestion:review",
  SUGGESTION_ADMIN: "suggestion:admin",
  WORKFLOW_READ: "workflow:read",
  WORKFLOW_REDRIVE: "workflow:redrive",
  WORKFLOW_EXECUTE: "workflow:execute",
  PROMOTION_READ: "promotion:read",
  PROMOTION_PROPOSE: "promotion:propose",
  PROMOTION_EVALUATE: "promotion:evaluate",
  PROMOTION_POLICY: "promotion:policy",
  PROMOTION_APPROVE: "promotion:approve",
  PROMOTION_OPERATE: "promotion:operate",
  PROMOTION_MONITOR: "promotion:monitor",
  TENANT_MANAGE: "tenant:manage"
});

export const DECISION_ROLE_PERMISSIONS = Object.freeze({
  tenant_admin: ["*"],
  operator: [DECISION_PERMISSIONS.READ, DECISION_PERMISSIONS.OPERATE, DECISION_PERMISSIONS.CANARY, DECISION_PERMISSIONS.WORKFLOW_READ, DECISION_PERMISSIONS.WORKFLOW_REDRIVE, DECISION_PERMISSIONS.PROMOTION_READ, DECISION_PERMISSIONS.PROMOTION_OPERATE, DECISION_PERMISSIONS.BRAINX_READ, DECISION_PERMISSIONS.SUGGESTION_READ, DECISION_PERMISSIONS.SUGGESTION_EDIT],
  proposer: [DECISION_PERMISSIONS.READ, DECISION_PERMISSIONS.PROPOSE, DECISION_PERMISSIONS.PROMOTION_READ, DECISION_PERMISSIONS.PROMOTION_PROPOSE, DECISION_PERMISSIONS.SUGGESTION_READ, DECISION_PERMISSIONS.SUGGESTION_EDIT],
  evaluator_reviewer: [DECISION_PERMISSIONS.READ, DECISION_PERMISSIONS.EVALUATE, DECISION_PERMISSIONS.PROMOTION_READ, DECISION_PERMISSIONS.PROMOTION_EVALUATE, DECISION_PERMISSIONS.PROMOTION_POLICY, DECISION_PERMISSIONS.SUGGESTION_READ, DECISION_PERMISSIONS.SUGGESTION_REVIEW],
  approver: [DECISION_PERMISSIONS.READ, DECISION_PERMISSIONS.APPROVE, DECISION_PERMISSIONS.PROMOTION_READ, DECISION_PERMISSIONS.PROMOTION_APPROVE],
  auditor: [DECISION_PERMISSIONS.READ, DECISION_PERMISSIONS.WORKFLOW_READ, DECISION_PERMISSIONS.PROMOTION_READ, DECISION_PERMISSIONS.BRAINX_READ, DECISION_PERMISSIONS.SUGGESTION_READ],
  team_member: [DECISION_PERMISSIONS.READ, DECISION_PERMISSIONS.BRAINX_READ, DECISION_PERMISSIONS.SUGGESTION_READ, DECISION_PERMISSIONS.WORKFLOW_READ, DECISION_PERMISSIONS.PROMOTION_READ],
  service: []
});

const SERVICE_FORBIDDEN_PERMISSIONS = new Set([DECISION_PERMISSIONS.APPROVE, DECISION_PERMISSIONS.PROMOTION_APPROVE, DECISION_PERMISSIONS.BRAINX_ADMIN, DECISION_PERMISSIONS.SUGGESTION_ADMIN, DECISION_PERMISSIONS.SUGGESTION_EDIT, DECISION_PERMISSIONS.SUGGESTION_REVIEW]);

function isAutonomousAdvisoryService(principal) {
  return principal?.type === "service" && /(?:qagent|brainx)/i.test(`${principal.id || ""} ${principal.subject || ""}`);
}
const AUTONOMOUS_ADVISORY_FORBIDDEN_PERMISSIONS = new Set([
  DECISION_PERMISSIONS.EVALUATE,
  DECISION_PERMISSIONS.POLICY,
  DECISION_PERMISSIONS.PROMOTION_EVALUATE,
  DECISION_PERMISSIONS.PROMOTION_POLICY
]);
const LIFECYCLE_JOB_PERMISSIONS = Object.freeze({
  branch_create: DECISION_PERMISSIONS.PROPOSE,
  disposition: DECISION_PERMISSIONS.OPERATE,
  condition_event: DECISION_PERMISSIONS.CONDITION_INGEST,
  evaluation: DECISION_PERMISSIONS.EVALUATE,
  policy: DECISION_PERMISSIONS.POLICY,
  approval: DECISION_PERMISSIONS.APPROVE,
  canary_start: DECISION_PERMISSIONS.CANARY,
  canary_outcome: DECISION_PERMISSIONS.CONDITION_INGEST
});

export class AuthorizationError extends Error {
  constructor(message = "Authorization was denied.", { code = "authorization_denied", status = 403, details } = {}) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function rolePermissions(roles = []) {
  return new Set((roles || []).flatMap((role) => DECISION_ROLE_PERMISSIONS[role] || []));
}

function allows(membership, permission) {
  if (membership.principalType === "service") return (membership.serviceScopes || []).includes(permission);
  const granted = rolePermissions(membership.roles);
  return granted.has("*") || granted.has(permission);
}

function validTenant(value) {
  return typeof value === "string" && value.trim() && value.trim().length <= 160 ? value.trim() : "";
}

function requestTenantSelector(req) {
  const sources = [
    ["header", req.get("x-plutomix-tenant-id")],
    ["query", req.query?.tenantId],
    ["body", req.body?.tenantId]
  ].filter(([, value]) => value !== undefined);
  if (!sources.length) return null;
  const values = sources.map(([source, value]) => ({ source, tenantId: validTenant(value) }));
  if (values.some((item) => !item.tenantId) || new Set(values.map((item) => item.tenantId)).size !== 1) {
    throw new AuthorizationError("The requested tenant context is invalid.", { code: "invalid_tenant_context", status: 400 });
  }
  return values[0].tenantId;
}

function requestWorkspaceSelector(req) {
  const values = [req.query?.workspaceId, req.body?.workspaceId]
    .filter((value) => value !== undefined)
    .map((value) => String(value || "").trim());
  if (!values.length) return null;
  if (values.some((value) => !value || value.length > 160) || new Set(values).size !== 1) {
    throw new AuthorizationError("The requested workspace context is invalid.", { code: "invalid_workspace_context", status: 400 });
  }
  return values[0];
}

function auditMetadata(metadata = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (value === undefined || value === null) continue;
    if (/token|authorization|claim|credential|secret/i.test(key)) continue;
    if (typeof value === "string") safe[key] = value.slice(0, 240);
    else if (typeof value === "number" || typeof value === "boolean") safe[key] = value;
  }
  return safe;
}

function asPrincipal(row) {
  return {
    id: row.principal_id,
    issuer: row.issuer,
    subject: row.subject,
    type: row.principal_type,
    status: row.status,
    displayName: row.display_name || "",
    email: row.email || ""
  };
}

function asMembership(row, principal) {
  return {
    principalId: principal.id,
    principalType: principal.type,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    status: row.status,
    roles: row.roles || [],
    serviceScopes: row.service_scopes || []
  };
}

export function permissionForLifecycleJob(jobType) {
  return LIFECYCLE_JOB_PERMISSIONS[jobType] || null;
}

export class IdentityAccessStore {
  constructor({ databaseUrl = process.env.DECISION_CONTINUITY_DATABASE_URL || process.env.DATABASE_URL, env = process.env } = {}) {
    this.databaseUrl = databaseUrl || "";
    this.env = env;
    this.pool = null;
  }

  async database() {
    if (!this.databaseUrl) throw new AuthorizationError("The identity authority is unavailable.", { code: "identity_authority_unavailable", status: 503 });
    if (!this.pool) {
      const { default: pg } = await import("pg");
      this.pool = new pg.Pool({ connectionString: this.databaseUrl, max: 6, idleTimeoutMillis: 10_000 });
    }
    return this.pool;
  }

  async transaction(work, tenantId = null) {
    const pool = await this.database();
    const client = await pool.connect().catch(() => { throw new AuthorizationError("The identity authority is unavailable.", { code: "identity_authority_unavailable", status: 503 }); });
    try {
      await client.query("BEGIN");
      if (tenantId) await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async recordAudit({ principalId = null, tenantId = null, workspaceId = null, action, outcome, code, requestId = null, metadata = {} } = {}) {
    try {
      await this.transaction((client) => client.query(
        `INSERT INTO identity_access_audit
           (principal_id, tenant_id, workspace_id, action, outcome, code, request_id, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [principalId, tenantId, workspaceId, String(action || "unknown").slice(0, 160), outcome === "allowed" ? "allowed" : "denied", String(code || "unknown").slice(0, 120), requestId ? String(requestId).slice(0, 160) : null, JSON.stringify(auditMetadata(metadata))]
      ), tenantId);
    } catch (error) {
      if (error instanceof AuthorizationError) throw error;
      throw new AuthorizationError("The authorization audit store is unavailable; the action was not accepted.", { code: "audit_unavailable", status: 503 });
    }
  }

  async authenticateRequest(req) {
    let external;
    try {
      external = await externalIdentityFromRequest(req, { env: this.env });
    } catch (error) {
      const normalized = error instanceof AuthenticationError ? error : new AuthenticationError();
      await this.recordAudit({ action: "authentication", outcome: "denied", code: normalized.code, metadata: { path: req.path, method: req.method } });
      throw normalized;
    }
    const pool = await this.database();
    const acceptedIssuers = identityIssuerAliases(external.issuer);
    const result = await pool.query(
      `SELECT principal_id, issuer, subject, principal_type, status, display_name, email
         FROM identity_principals
        WHERE issuer = ANY($1::text[]) AND subject = $2
        ORDER BY principal_id
        LIMIT 2`,
      [acceptedIssuers, external.subject]
    ).catch(() => { throw new AuthorizationError("The identity authority is unavailable.", { code: "identity_authority_unavailable", status: 503 }); });
    if (result.rowCount > 1) {
      await this.recordAudit({ action: "authentication", outcome: "denied", code: "principal_alias_conflict", metadata: { path: req.path, method: req.method } });
      throw new AuthenticationError("The authenticated principal has conflicting issuer aliases.", { code: "principal_alias_conflict" });
    }
    const principal = asPrincipal(result.rows[0] || {});
    if (!result.rowCount || principal.status !== "active") {
      await this.recordAudit({ principalId: result.rows[0]?.principal_id || null, action: "authentication", outcome: "denied", code: result.rowCount ? "principal_disabled" : "principal_unmapped", metadata: { path: req.path, method: req.method } });
      throw new AuthenticationError("The authenticated principal is not active.", { code: "principal_inactive" });
    }
    return principal;
  }

  async membershipFor({ principal, tenantId, workspaceId = null }) {
    const pool = await this.database();
    const result = await pool.query(
      `SELECT principal_id, tenant_id, workspace_id, status, roles, service_scopes
         FROM identity_tenant_memberships
        WHERE principal_id = $1 AND tenant_id = $2 AND status = 'active'
          AND ($3::text IS NULL OR workspace_id IN ('*', $3))
        ORDER BY CASE WHEN workspace_id = $3 THEN 0 ELSE 1 END
        LIMIT 1`,
      [principal.id, tenantId, workspaceId]
    );
    return result.rowCount ? asMembership(result.rows[0], principal) : null;
  }

  async membershipsFor(principal) {
    const pool = await this.database();
    const result = await pool.query(
      `SELECT principal_id, tenant_id, workspace_id, status, roles, service_scopes
         FROM identity_tenant_memberships WHERE principal_id = $1 AND status = 'active'`,
      [principal.id]
    );
    return result.rows.map((row) => asMembership(row, principal));
  }

  async authorizeRequest(req, { permission, principalTypes = ["human", "service"], action } = {}) {
    let principal;
    try {
      principal = req.plutomixPrincipal || await this.authenticateRequest(req);
      req.plutomixPrincipal = principal;
      const tenantId = requestTenantSelector(req);
      const workspaceId = requestWorkspaceSelector(req);
      const memberships = await this.membershipsFor(principal);
      const selectedTenant = tenantId || (new Set(memberships.map((item) => item.tenantId)).size === 1 ? memberships[0]?.tenantId : null);
      if (!selectedTenant) throw new AuthorizationError("An explicit active tenant context is required.", { code: "tenant_context_required", status: 404 });
      const membership = await this.membershipFor({ principal, tenantId: selectedTenant, workspaceId });
      if (!membership) throw new AuthorizationError("The requested tenant resource was not found.", { code: "tenant_not_found", status: 404 });
      if (!workspaceId && membership.workspaceId !== "*") {
        throw new AuthorizationError("An explicit authorized workspace context is required.", { code: "workspace_context_required", status: 404 });
      }
      if (!principalTypes.includes(principal.type)) throw new AuthorizationError("This identity type cannot perform the requested action.", { code: "principal_type_denied" });
      if (principal.type === "service" && (SERVICE_FORBIDDEN_PERMISSIONS.has(permission) || (isAutonomousAdvisoryService(principal) && AUTONOMOUS_ADVISORY_FORBIDDEN_PERMISSIONS.has(permission)))) throw new AuthorizationError("This autonomous advisory service cannot perform final evaluation, approval, or policy administration.", { code: "service_separation_denied" });
      if (!allows(membership, permission)) throw new AuthorizationError("The requested permission is not granted.", { code: "permission_denied" });
      await this.recordAudit({ principalId: principal.id, tenantId: membership.tenantId, workspaceId: workspaceId || membership.workspaceId, action: action || permission, outcome: "allowed", code: "authorized", requestId: req.get("x-request-id"), metadata: { path: req.path, method: req.method, principalType: principal.type } });
      return {
        principal,
        membership,
        tenantId: membership.tenantId,
        workspaceId: workspaceId || membership.workspaceId,
        actor: { type: principal.type === "service" ? "service" : "user", id: principal.id, name: principal.displayName || "" },
        authorization: { principalId: principal.id, principalType: principal.type, tenantId: membership.tenantId, permission, membershipWorkspaceId: membership.workspaceId }
      };
    } catch (error) {
      const normalized = error instanceof AuthenticationError || error instanceof AuthorizationError ? error : new AuthorizationError("Authorization was denied.", { code: "authorization_unavailable", status: 503 });
      await this.recordAudit({ principalId: principal?.id || req.plutomixPrincipal?.id || null, action: action || permission || "unknown", outcome: "denied", code: normalized.code, requestId: req.get("x-request-id"), metadata: { path: req.path, method: req.method } }).catch(() => {});
      throw normalized;
    }
  }

  async assertPrincipalPermission({ principalId, tenantId, workspaceId = null, permission, principalTypes = ["human", "service"] } = {}) {
    const pool = await this.database();
    const principalResult = await pool.query("SELECT principal_id, issuer, subject, principal_type, status, display_name, email FROM identity_principals WHERE principal_id = $1", [principalId]);
    if (!principalResult.rowCount) throw new AuthorizationError("The authorization principal is unavailable.", { code: "authorization_denied" });
    const principal = asPrincipal(principalResult.rows[0]);
    if (principal.status !== "active" || !principalTypes.includes(principal.type)) throw new AuthorizationError("The authorization principal is not eligible.", { code: "authorization_denied" });
    const membership = await this.membershipFor({ principal, tenantId, workspaceId });
    if (!membership || !allows(membership, permission) || (principal.type === "service" && (SERVICE_FORBIDDEN_PERMISSIONS.has(permission) || (isAutonomousAdvisoryService(principal) && AUTONOMOUS_ADVISORY_FORBIDDEN_PERMISSIONS.has(permission))))) {
      throw new AuthorizationError("The authorization principal does not hold the required permission.", { code: "authorization_denied" });
    }
    return { principal, membership };
  }

  async assertSeparationOfDuties({ principalId, tenantId, originatorPrincipalIds = [], action }) {
    if (["approval", "evaluation"].includes(action) && originatorPrincipalIds.filter(Boolean).includes(principalId)) {
      throw new AuthorizationError("The originating principal cannot be the final evaluator or approver for this change.", { code: "separation_of_duties_denied" });
    }
    return true;
  }

  async workerTenantIds(workerPrincipalId, jobType = null) {
    const pool = await this.database();
    const result = await pool.query("SELECT principal_id, issuer, subject, principal_type, status, display_name, email FROM identity_principals WHERE principal_id = $1", [workerPrincipalId]);
    if (!result.rowCount) throw new AuthorizationError("The workflow worker identity is not provisioned.", { code: "worker_identity_denied" });
    const principal = asPrincipal(result.rows[0]);
    if (principal.type !== "service" || principal.status !== "active") throw new AuthorizationError("The workflow worker identity is not active.", { code: "worker_identity_denied" });
    const memberships = await this.membershipsFor(principal);
    return [...new Set(memberships.filter((membership) => allows(membership, DECISION_PERMISSIONS.WORKFLOW_EXECUTE) && (!jobType || allows(membership, `${DECISION_PERMISSIONS.WORKFLOW_EXECUTE}:${jobType}`))).map((membership) => membership.tenantId))];
  }

  async authorizeWorkerJob({ workerPrincipalId, job } = {}) {
    const permission = permissionForLifecycleJob(job?.jobType);
    const authorization = job?.payload?.__workflow?.authorization;
    if (!workerPrincipalId || !permission || !authorization || authorization.tenantId !== job.tenantId || authorization.permission !== permission) {
      throw new AuthorizationError("The workflow job lacks a valid authorization envelope.", { code: "authorization_failed" });
    }
    const allowedTenants = await this.workerTenantIds(workerPrincipalId, job.jobType);
    if (!allowedTenants.includes(job.tenantId)) throw new AuthorizationError("The workflow worker is not assigned to this tenant and capability.", { code: "worker_scope_denied" });
    await this.assertPrincipalPermission({ principalId: authorization.principalId, tenantId: job.tenantId, workspaceId: job.workspaceId, permission, principalTypes: [authorization.principalType] });
    await this.recordAudit({ principalId: workerPrincipalId, tenantId: job.tenantId, workspaceId: job.workspaceId, action: `workflow.execute.${job.jobType}`, outcome: "allowed", code: "authorized", metadata: { jobId: job.jobId, submittedBy: authorization.principalId } });
    return true;
  }

  async provisionPrincipal({ id, issuer, subject, type = "human", displayName = "", email = "", status = "active" } = {}) {
    if (!id || !issuer || !subject || !["human", "service"].includes(type)) throw new Error("A complete identity principal is required.");
    const pool = await this.database();
    await pool.query(
      `INSERT INTO identity_principals (principal_id, issuer, subject, principal_type, display_name, email, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (issuer, subject) DO UPDATE SET principal_id = EXCLUDED.principal_id, principal_type = EXCLUDED.principal_type, display_name = EXCLUDED.display_name, email = EXCLUDED.email, status = EXCLUDED.status, updated_at = clock_timestamp()`,
      [id, issuer, subject, type, displayName, email, status]
    );
  }

  async provisionMembership({ principalId, tenantId, workspaceId = "*", roles = [], serviceScopes = [], status = "active" } = {}) {
    if (!principalId || !tenantId || !workspaceId) throw new Error("A complete tenant membership is required.");
    const pool = await this.database();
    await pool.query(
      `INSERT INTO identity_tenant_memberships (principal_id, tenant_id, workspace_id, roles, service_scopes, status)
       VALUES ($1,$2,$3,$4::text[],$5::text[],$6)
       ON CONFLICT (principal_id, tenant_id, workspace_id) DO UPDATE SET roles = EXCLUDED.roles, service_scopes = EXCLUDED.service_scopes, status = EXCLUDED.status, updated_at = clock_timestamp()`,
      [principalId, tenantId, workspaceId, roles, serviceScopes, status]
    );
  }
}
