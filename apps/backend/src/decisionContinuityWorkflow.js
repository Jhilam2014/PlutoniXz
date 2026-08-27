import crypto from "node:crypto";
import { DecisionContinuityError } from "./decisionContinuity.js";

const JOB_TYPES = new Set(["branch_create", "condition_event", "evaluation", "policy", "approval", "canary_start", "canary_outcome", "disposition"]);
const TERMINAL_STATES = new Set(["completed", "cancelled", "dead"]);
const PERMANENT_CODES = new Set([
  "invalid_disposition", "invalid_evaluation", "invalid_policy_decision", "invalid_approval", "invalid_lifecycle_state",
  "deterministic_validation_required", "independent_review_required", "independent_approval_required", "tenant_required",
  "not_found", "revision_conflict", "invalid_request", "invalid_canary", "invalid_canary_outcome", "authorization_failed", "authorization_denied", "worker_scope_denied", "worker_identity_denied"
]);
const WORKFLOW_LOCK_ID = 712_810_044;

function finiteInteger(value, fallback, { name, min, max }) {
  const source = value === undefined || value === null || value === "" ? fallback : value;
  const parsed = Number(source);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new DecisionContinuityError(`${name} must be an integer between ${min} and ${max}.`, {
      code: "invalid_workflow_configuration", status: 500
    });
  }
  return parsed;
}

export function workflowConfigFromEnvironment(env = process.env) {
  return {
    globalConcurrency: finiteInteger(env.DECISION_CONTINUITY_WORKER_CONCURRENCY, 8, { name: "DECISION_CONTINUITY_WORKER_CONCURRENCY", min: 1, max: 256 }),
    perTenantConcurrency: finiteInteger(env.DECISION_CONTINUITY_WORKER_TENANT_CONCURRENCY, 2, { name: "DECISION_CONTINUITY_WORKER_TENANT_CONCURRENCY", min: 1, max: 64 }),
    perTenantQueueLimit: finiteInteger(env.DECISION_CONTINUITY_WORKER_TENANT_QUEUE_LIMIT, 100, { name: "DECISION_CONTINUITY_WORKER_TENANT_QUEUE_LIMIT", min: 1, max: 100_000 }),
    // The production default is 30 seconds; short values remain valid so the
    // deterministic integration suite can exercise lease transfer quickly.
    leaseMs: finiteInteger(env.DECISION_CONTINUITY_WORKER_LEASE_MS, 30_000, { name: "DECISION_CONTINUITY_WORKER_LEASE_MS", min: 10, max: 300_000 }),
    maxAttempts: finiteInteger(env.DECISION_CONTINUITY_WORKER_MAX_ATTEMPTS, 5, { name: "DECISION_CONTINUITY_WORKER_MAX_ATTEMPTS", min: 1, max: 25 }),
    maxRedrives: finiteInteger(env.DECISION_CONTINUITY_WORKER_MAX_REDRIVES, 2, { name: "DECISION_CONTINUITY_WORKER_MAX_REDRIVES", min: 0, max: 10 }),
    pollMs: finiteInteger(env.DECISION_CONTINUITY_WORKER_POLL_MS, 500, { name: "DECISION_CONTINUITY_WORKER_POLL_MS", min: 50, max: 30_000 }),
    shutdownGraceMs: finiteInteger(env.DECISION_CONTINUITY_WORKER_SHUTDOWN_GRACE_MS, 20_000, { name: "DECISION_CONTINUITY_WORKER_SHUTDOWN_GRACE_MS", min: 100, max: 300_000 })
  };
}

function safeTenantTag(tenantId) {
  return crypto.createHash("sha256").update(String(tenantId)).digest("hex").slice(0, 12);
}

function toCamelJob(row) {
  if (!row) return null;
  return {
    // Retain the database-shaped names for existing internal callers while the
    // API returns the documented camelCase contract below.
    ...row,
    jobId: row.job_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    jobType: row.job_type,
    state: row.state,
    idempotencyKey: row.idempotency_key,
    branchId: row.branch_id,
    reconsiderationId: row.reconsideration_id,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    payload: row.payload,
    priority: row.priority,
    budget: row.budget,
    deadlineAt: row.deadline_at,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    redriveCount: Number(row.redrive_count || 0),
    availableAt: row.available_at,
    leasedAt: row.leased_at,
    leasedUntil: row.leased_until,
    leaseOwner: row.lease_owner,
    leaseEpoch: Number(row.lease_epoch || 0),
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    failure: row.failure
  };
}

function asError(error) {
  if (error instanceof DecisionContinuityError) return error;
  const wrapped = new DecisionContinuityError("Decision-continuity workflow processing failed.", {
    code: error?.code || "workflow_processing_failed", status: 503,
    details: { name: error?.name || "Error" }
  });
  wrapped.cause = error;
  return wrapped;
}

function isPermanent(error) {
  return error instanceof DecisionContinuityError && (error.status < 500 || PERMANENT_CODES.has(error.code));
}

function withoutWorkflowContext(payload = {}) {
  const { __workflow, ...input } = payload || {};
  return input;
}

export class DecisionContinuityWorkflowQueue {
  constructor({
    store,
    databaseUrl = process.env.DECISION_CONTINUITY_DATABASE_URL || process.env.DATABASE_URL,
    workerId = `decision-worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`,
    globalConcurrency,
    perTenantConcurrency,
    perTenantQueueLimit,
    leaseMs,
    maxAttempts,
    maxRedrives,
    pollMs,
    shutdownGraceMs,
    failureInjector,
    hooks = {},
    identityAccess = null,
    workerPrincipalId = process.env.DECISION_CONTINUITY_WORKER_PRINCIPAL_ID || "",
    logger = console
  } = {}) {
    this.store = store;
    this.databaseUrl = databaseUrl || "";
    this.workerId = workerId;
    this.config = workflowConfigFromEnvironment({
      ...process.env,
      DECISION_CONTINUITY_WORKER_CONCURRENCY: globalConcurrency ?? process.env.DECISION_CONTINUITY_WORKER_CONCURRENCY,
      DECISION_CONTINUITY_WORKER_TENANT_CONCURRENCY: perTenantConcurrency ?? process.env.DECISION_CONTINUITY_WORKER_TENANT_CONCURRENCY,
      DECISION_CONTINUITY_WORKER_TENANT_QUEUE_LIMIT: perTenantQueueLimit ?? process.env.DECISION_CONTINUITY_WORKER_TENANT_QUEUE_LIMIT,
      DECISION_CONTINUITY_WORKER_LEASE_MS: leaseMs ?? process.env.DECISION_CONTINUITY_WORKER_LEASE_MS,
      DECISION_CONTINUITY_WORKER_MAX_ATTEMPTS: maxAttempts ?? process.env.DECISION_CONTINUITY_WORKER_MAX_ATTEMPTS,
      DECISION_CONTINUITY_WORKER_MAX_REDRIVES: maxRedrives ?? process.env.DECISION_CONTINUITY_WORKER_MAX_REDRIVES,
      DECISION_CONTINUITY_WORKER_POLL_MS: pollMs ?? process.env.DECISION_CONTINUITY_WORKER_POLL_MS,
      DECISION_CONTINUITY_WORKER_SHUTDOWN_GRACE_MS: shutdownGraceMs ?? process.env.DECISION_CONTINUITY_WORKER_SHUTDOWN_GRACE_MS
    });
    this.failureInjector = failureInjector;
    this.hooks = hooks;
    this.identityAccess = identityAccess;
    this.workerPrincipalId = workerPrincipalId;
    this.logger = logger;
    this.pool = null;
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.tickPromise = null;
    this.active = new Map();
    this.draining = false;
    this.started = false;
    this.shutdownStartedAt = null;
    this.fencedJobIds = new Set();
  }

  log(event, fields = {}) {
    const record = { component: "decision-continuity-worker", event, workerId: this.workerId, at: new Date().toISOString(), ...fields };
    if (typeof this.logger?.info === "function") this.logger.info(record);
    else if (typeof this.logger?.log === "function") this.logger.log(JSON.stringify(record));
  }

  async database() {
    if (!this.databaseUrl) throw new DecisionContinuityError("DECISION_CONTINUITY_DATABASE_URL is required for durable workflows.", { code: "authoritative_store_unavailable", status: 503 });
    if (!this.pool) {
      try {
        const { default: pg } = await import("pg");
        this.pool = new pg.Pool({ connectionString: this.databaseUrl, max: Math.max(4, Math.min(32, this.config.globalConcurrency + 2)), idleTimeoutMillis: 10_000 });
      } catch (error) {
        throw new DecisionContinuityError("The PostgreSQL workflow queue is unavailable.", { code: "authoritative_store_unavailable", status: 503, details: { name: error.name } });
      }
    }
    return this.pool;
  }

  async transaction(work) {
    const pool = await this.database();
    const client = await pool.connect().catch((error) => { throw asError(error); });
    try {
      // The advisory lock serializes workflow admission/claim transitions. Read
      // committed avoids a stale serializable snapshot treating an accepted
      // duplicate as a unique-constraint failure after it waited on that lock.
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [WORKFLOW_LOCK_ID]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error instanceof DecisionContinuityError ? error : asError(error);
    } finally {
      client.release();
    }
  }

  async submit({ tenantId, workspaceId, jobType, payload, idempotencyKey, branchId = null, reconsiderationId = null, correlationId, causationId = null, priority = 0, budget = {}, maxAttempts } = {}) {
    if (!tenantId || !workspaceId || !idempotencyKey || !JOB_TYPES.has(jobType)) {
      throw new DecisionContinuityError("Workflow submissions require tenant, workspace, supported job type, and idempotency key.", { code: "invalid_request" });
    }
    if (String(idempotencyKey).length > 240) throw new DecisionContinuityError("The workflow idempotency key is too long.", { code: "invalid_request" });
    const safeAttempts = finiteInteger(maxAttempts, this.config.maxAttempts, { name: "maxAttempts", min: 1, max: this.config.maxAttempts });
    const jobId = `dcw_${crypto.randomUUID()}`;
    const eventId = `dcw_event_${crypto.randomUUID()}`;
    const result = await this.transaction(async (client) => {
      const existing = await client.query(
        `SELECT * FROM decision_continuity_workflow_jobs
          WHERE tenant_id = $1 AND workspace_id = $2 AND idempotency_key = $3`,
        [tenantId, workspaceId, String(idempotencyKey)]
      );
      if (existing.rowCount) return { job: toCamelJob(existing.rows[0]), idempotent: true };
      const admitted = await client.query(
        `SELECT count(*)::int AS count
           FROM decision_continuity_workflow_jobs
          WHERE tenant_id = $1 AND workspace_id = $2
            AND state IN ('pending', 'retry', 'leased')`,
        [tenantId, workspaceId]
      );
      if (Number(admitted.rows[0].count) >= this.config.perTenantQueueLimit) {
        throw new DecisionContinuityError("The tenant workflow admission limit has been reached; retry after queued work progresses.", {
          code: "tenant_queue_full", status: 429, details: { limit: this.config.perTenantQueueLimit }
        });
      }
      const storedPayload = {
        ...(payload || {}),
        __workflow: {
          actor: payload?.__workflow?.actor || { type: "system", id: "unknown" },
          authorization: payload?.__workflow?.authorization || null,
          submittedAt: new Date().toISOString()
        }
      };
      const inserted = await client.query(
        `INSERT INTO decision_continuity_workflow_jobs
           (job_id, tenant_id, workspace_id, job_type, state, idempotency_key, branch_id, reconsideration_id, correlation_id, causation_id, payload, priority, budget, max_attempts, max_redrives)
         VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14)
         RETURNING *`,
        [jobId, tenantId, workspaceId, jobType, String(idempotencyKey), branchId, reconsiderationId, correlationId || jobId, causationId, JSON.stringify(storedPayload), Number(priority) || 0, JSON.stringify(budget || {}), safeAttempts, this.config.maxRedrives]
      );
      const eventRecord = {
        id: eventId, tenantId, workspaceId, type: "workflow.accepted", occurredAt: new Date().toISOString(),
        actor: storedPayload.__workflow.actor, correlationId: correlationId || jobId,
        payload: { jobId, jobType, branchId, reconsiderationId, idempotencyKey: String(idempotencyKey) },
        hashVersion: "decision-continuity-event/v1"
      };
      const chain = await client.query(
        `SELECT event_hash FROM decision_continuity_events
          WHERE tenant_id = $1 AND workspace_id = $2
          ORDER BY sequence_no DESC LIMIT 1`,
        [tenantId, workspaceId]
      );
      const previousHash = chain.rows[0]?.event_hash || null;
      eventRecord.previousHash = previousHash;
      const hash = crypto.createHash("sha256").update(JSON.stringify(eventRecord)).digest("hex");
      eventRecord.eventHash = hash;
      await client.query(
        `INSERT INTO decision_continuity_events
           (event_id, tenant_id, workspace_id, aggregate_id, aggregate_version, event_type, actor, correlation_id, payload, previous_hash, event_hash, event_record)
         VALUES ($1,$2,$3,$4,0,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11::jsonb)`,
        [eventId, tenantId, workspaceId, branchId || jobId, eventRecord.type, JSON.stringify(eventRecord.actor), eventRecord.correlationId, JSON.stringify(eventRecord.payload), previousHash, hash, JSON.stringify(eventRecord)]
      );
      await client.query(
        `INSERT INTO decision_continuity_outbox (event_id, tenant_id, workspace_id, aggregate_id, aggregate_version, payload, checkpoint_version)
         VALUES ($1,$2,$3,$4,0,$5::jsonb,1)`,
        [eventId, tenantId, workspaceId, branchId || jobId, JSON.stringify(eventRecord)]
      );
      await client.query(
        `INSERT INTO decision_continuity_workflow_audit (job_id, tenant_id, workspace_id, action, actor, metadata)
         VALUES ($1,$2,$3,'submitted',$4::jsonb,$5::jsonb)`,
        [jobId, tenantId, workspaceId, JSON.stringify(eventRecord.actor), JSON.stringify({ jobType })]
      );
      return { job: toCamelJob(inserted.rows[0]), idempotent: false };
    });
    this.log(result.idempotent ? "workflow_duplicate" : "workflow_admitted", { tenant: safeTenantTag(tenantId), jobType });
    return result;
  }

  async dispatchOutbox({ limit = 100, tenantId = null, workspaceId = null } = {}) {
    const size = finiteInteger(limit, 100, { name: "outbox dispatch limit", min: 1, max: 500 });
    return this.transaction(async (client) => {
      const rows = await client.query(
        `WITH candidates AS (
           SELECT outbox_id FROM decision_continuity_outbox
            WHERE dispatch_status IN ('pending', 'leased')
              AND available_at <= clock_timestamp()
              AND (leased_until IS NULL OR leased_until < clock_timestamp())
              AND ($2::text IS NULL OR tenant_id = $2)
              AND ($3::text IS NULL OR workspace_id = $3)
            ORDER BY outbox_id
            FOR UPDATE SKIP LOCKED
            LIMIT $1
         )
         UPDATE decision_continuity_outbox AS outbox
            SET dispatch_status = 'published', published_at = clock_timestamp(), lease_owner = $4, leased_until = NULL, attempts = attempts + 1
           FROM candidates
          WHERE outbox.outbox_id = candidates.outbox_id
         RETURNING outbox.outbox_id`,
        [size, tenantId || null, workspaceId || null, this.workerId]
      );
      return rows.rowCount;
    });
  }

  async claim({ tenantId } = {}) {
    if (this.draining) return null;
    if (this.identityAccess) {
      if (!this.workerPrincipalId && process.env.NODE_ENV === "production") {
        throw new DecisionContinuityError("A configured workflow worker identity is required in production.", { code: "authorization_failed", status: 503 });
      }
    }
    const claimed = await this.transaction(async (client) => {
      await client.query(
        `UPDATE decision_continuity_workflow_jobs
            SET state = 'retry', lease_owner = NULL, leased_at = NULL, leased_until = NULL,
                available_at = LEAST(available_at, clock_timestamp()), failure = COALESCE(failure, '{}'::jsonb) || '{"code":"lease_expired"}'::jsonb
          WHERE state = 'leased' AND leased_until < clock_timestamp()`
      );
      const global = await client.query(
        `SELECT count(*)::int AS count FROM decision_continuity_workflow_jobs
          WHERE state = 'leased' AND leased_until >= clock_timestamp()`
      );
      if (Number(global.rows[0].count) >= this.config.globalConcurrency) return null;
      const candidates = await client.query(
        `SELECT job.*, COALESCE(active_by_tenant.active_count, 0)::int AS active_count
           FROM decision_continuity_workflow_jobs AS job
           LEFT JOIN (
             SELECT tenant_id, count(*)::int AS active_count
               FROM decision_continuity_workflow_jobs
              WHERE state = 'leased' AND leased_until >= clock_timestamp()
              GROUP BY tenant_id
           ) AS active_by_tenant ON active_by_tenant.tenant_id = job.tenant_id
          WHERE job.state IN ('pending', 'retry')
            AND job.available_at <= clock_timestamp()
            AND ($1::text IS NULL OR job.tenant_id = $1)
            AND ($3::text IS NULL OR EXISTS (
              SELECT 1 FROM identity_tenant_memberships AS membership
               WHERE membership.principal_id = $3
                 AND membership.tenant_id = job.tenant_id
                 AND membership.status = 'active'
                 AND membership.service_scopes @> ARRAY['workflow:execute', 'workflow:execute:' || job.job_type]::text[]
            ))
            AND COALESCE(active_by_tenant.active_count, 0) < $2
          ORDER BY COALESCE(active_by_tenant.active_count, 0) ASC, job.priority DESC, job.created_at ASC, job.job_id ASC
          FOR UPDATE OF job SKIP LOCKED
          LIMIT 1`,
        [tenantId || null, this.config.perTenantConcurrency, this.workerPrincipalId || null]
      );
      if (!candidates.rowCount) return null;
      const job = candidates.rows[0];
      const update = await client.query(
        `UPDATE decision_continuity_workflow_jobs
            SET state = 'leased', attempts = attempts + 1, leased_at = clock_timestamp(), leased_until = clock_timestamp() + ($2::bigint * INTERVAL '1 millisecond'),
                lease_owner = $3, lease_epoch = lease_epoch + 1
          WHERE job_id = $1
          RETURNING *`,
        [job.job_id, this.config.leaseMs, this.workerId]
      );
      await client.query(
        `INSERT INTO decision_continuity_workflow_audit (job_id, tenant_id, workspace_id, action, actor, metadata)
         VALUES ($1,$2,$3,'claimed',$4::jsonb,$5::jsonb)`,
        [job.job_id, job.tenant_id, job.workspace_id, JSON.stringify({ type: "worker", id: this.workerId }), JSON.stringify({ leaseEpoch: Number(job.lease_epoch || 0) + 1 })]
      );
      return toCamelJob(update.rows[0]);
    });
    if (claimed) this.log("workflow_claimed", { tenant: safeTenantTag(claimed.tenantId), jobType: claimed.jobType, attempt: claimed.attempts });
    return claimed;
  }

  async heartbeat(job) {
    if (!job?.jobId) return false;
    const pool = await this.database();
    const update = await pool.query(
      `UPDATE decision_continuity_workflow_jobs
          SET leased_until = clock_timestamp() + ($4::bigint * INTERVAL '1 millisecond')
        WHERE job_id = $1 AND state = 'leased' AND lease_owner = $2 AND lease_epoch = $3 AND leased_until >= clock_timestamp()`,
      [job.jobId, this.workerId, job.leaseEpoch, Math.max(this.config.leaseMs, 100)]
    );
    return update.rowCount === 1;
  }

  workflowHandler(job, transactionalStore) {
    const actor = job.payload?.__workflow?.actor || { type: "system", id: "workflow" };
    const input = withoutWorkflowContext(job.payload);
    const scope = { tenantId: job.tenantId, actor };
    if (job.jobType === "branch_create") return transactionalStore.createBranch(input, scope);
    if (job.jobType === "condition_event") return transactionalStore.ingestConditionEvent(input, scope);
    if (job.jobType === "evaluation") return transactionalStore.recordEvaluation({ ...input, reconsiderationId: job.reconsiderationId }, scope);
    if (job.jobType === "policy") return transactionalStore.recordPolicyDecision({ ...input, reconsiderationId: job.reconsiderationId }, scope);
    if (job.jobType === "approval") return transactionalStore.recordApproval({ ...input, reconsiderationId: job.reconsiderationId }, scope);
    if (job.jobType === "canary_start") return transactionalStore.startCanary({ ...input, reconsiderationId: job.reconsiderationId }, scope);
    if (job.jobType === "canary_outcome") return transactionalStore.recordCanaryOutcome({ ...input, canaryId: input.canaryId || job.branchId }, scope);
    if (job.jobType === "disposition") return transactionalStore.setDisposition({ ...input, branchId: job.branchId || input.branchId }, scope);
    throw new DecisionContinuityError("The workflow job type has no registered handler.", { code: "invalid_request" });
  }

  async execute(job) {
    if (!job?.jobId) return null;
    if (!this.store?.executeWorkflowEffect) {
      throw new DecisionContinuityError("The workflow runtime requires the PostgreSQL decision-continuity store.", { code: "authoritative_store_unavailable", status: 503 });
    }
    if (this.identityAccess) {
      if (!this.workerPrincipalId && process.env.NODE_ENV === "production") {
        throw new DecisionContinuityError("A configured workflow worker identity is required in production.", { code: "authorization_failed", status: 503 });
      }
      if (this.workerPrincipalId) await this.identityAccess.authorizeWorkerJob({ workerPrincipalId: this.workerPrincipalId, job });
    }
    if (!(await this.heartbeat(job))) {
      throw new DecisionContinuityError("The worker no longer owns this workflow lease.", { code: "lease_lost", status: 409 });
    }
    await this.hooks.beforeEffect?.(job);
    const result = await this.store.executeWorkflowEffect({
      job,
      workerId: this.workerId,
      shouldFence: () => this.fencedJobIds.has(job.jobId),
      effect: (transactionalStore) => this.workflowHandler(job, transactionalStore),
      afterEffect: (outcome) => this.failureInjector?.("after_effect", job, outcome)
    });
    this.log("workflow_completed", { tenant: safeTenantTag(job.tenantId), jobType: job.jobType, idempotent: Boolean(result?.idempotent) });
    return result;
  }

  async fail(job, error) {
    if (!job?.jobId) return false;
    const normalized = asError(error);
    if (normalized.code === "lease_lost") return false;
    const permanent = isPermanent(normalized);
    const backoffMs = Math.min(30_000, Math.max(250, 250 * (2 ** Math.max(0, Number(job.attempts || 1) - 1))));
    const result = await this.transaction(async (client) => {
      const current = await client.query(
        `SELECT * FROM decision_continuity_workflow_jobs
          WHERE job_id = $1 AND state = 'leased' AND lease_owner = $2 AND lease_epoch = $3 AND leased_until >= clock_timestamp()
          FOR UPDATE`,
        [job.jobId, this.workerId, job.leaseEpoch]
      );
      if (!current.rowCount) return false;
      const row = current.rows[0];
      const dead = permanent || Number(row.attempts) >= Number(row.max_attempts);
      await client.query(
        `UPDATE decision_continuity_workflow_jobs
            SET state = $4, lease_owner = NULL, leased_at = NULL, leased_until = NULL,
                available_at = CASE WHEN $4 = 'retry' THEN clock_timestamp() + ($5::bigint * INTERVAL '1 millisecond') ELSE available_at END,
                failure = $6::jsonb
          WHERE job_id = $1 AND lease_owner = $2 AND lease_epoch = $3`,
        [job.jobId, this.workerId, job.leaseEpoch, dead ? "dead" : "retry", backoffMs, JSON.stringify({ code: normalized.code, message: normalized.message.slice(0, 500), permanent })]
      );
      await client.query(
        `INSERT INTO decision_continuity_workflow_audit (job_id, tenant_id, workspace_id, action, actor, metadata)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [job.jobId, row.tenant_id, row.workspace_id, dead ? "dead_lettered" : "retried", JSON.stringify({ type: "worker", id: this.workerId }), JSON.stringify({ code: normalized.code, permanent, backoffMs })]
      );
      return true;
    });
    if (result) this.log(permanent ? "workflow_dead_lettered" : "workflow_retried", { tenant: safeTenantTag(job.tenantId), jobType: job.jobType, code: normalized.code });
    return result;
  }

  async redrive({ jobId, tenantId, actor, idempotencyKey } = {}) {
    if (!jobId || !tenantId) throw new DecisionContinuityError("Redrive requires job and tenant scope.", { code: "invalid_request" });
    const redriveKey = idempotencyKey || `redrive:${jobId}`;
    return this.transaction(async (client) => {
      const existing = await client.query(
        `SELECT metadata FROM decision_continuity_workflow_audit
          WHERE job_id = $1 AND tenant_id = $2 AND action = 'redriven' AND idempotency_key = $3`,
        [jobId, tenantId, redriveKey]
      );
      if (existing.rowCount) {
        const job = await client.query("SELECT * FROM decision_continuity_workflow_jobs WHERE job_id = $1 AND tenant_id = $2", [jobId, tenantId]);
        if (!job.rowCount) throw new DecisionContinuityError("Workflow job was not found in this tenant.", { code: "not_found", status: 404 });
        return { job: toCamelJob(job.rows[0]), idempotent: true };
      }
      const job = await client.query("SELECT * FROM decision_continuity_workflow_jobs WHERE job_id = $1 AND tenant_id = $2 FOR UPDATE", [jobId, tenantId]);
      if (!job.rowCount) throw new DecisionContinuityError("Workflow job was not found in this tenant.", { code: "not_found", status: 404 });
      const row = job.rows[0];
      if (row.state !== "dead") throw new DecisionContinuityError("Only a dead-lettered workflow job can be redriven.", { code: "invalid_redrive_state", status: 409 });
      if (Number(row.redrive_count) >= Math.min(Number(row.max_redrives), this.config.maxRedrives)) throw new DecisionContinuityError("The workflow redrive limit has been reached.", { code: "redrive_limit_reached", status: 409 });
      const admitted = await client.query(
        `SELECT count(*)::int AS count FROM decision_continuity_workflow_jobs
          WHERE tenant_id = $1 AND workspace_id = $2 AND state IN ('pending','retry','leased')`, [tenantId, row.workspace_id]
      );
      if (Number(admitted.rows[0].count) >= this.config.perTenantQueueLimit) throw new DecisionContinuityError("The tenant workflow admission limit has been reached.", { code: "tenant_queue_full", status: 429 });
      const updated = await client.query(
        `UPDATE decision_continuity_workflow_jobs
            SET state = 'pending', available_at = clock_timestamp(), attempts = 0, lease_owner = NULL, leased_at = NULL, leased_until = NULL,
                failure = NULL, redrive_count = redrive_count + 1
          WHERE job_id = $1 AND tenant_id = $2
          RETURNING *`, [jobId, tenantId]
      );
      await client.query(
        `INSERT INTO decision_continuity_workflow_audit (job_id, tenant_id, workspace_id, action, actor, metadata, idempotency_key)
         VALUES ($1,$2,$3,'redriven',$4::jsonb,$5::jsonb,$6)`,
        [jobId, tenantId, row.workspace_id, JSON.stringify(actor || {}), JSON.stringify({ priorFailure: row.failure, redriveCount: Number(row.redrive_count) + 1 }), redriveKey]
      );
      this.log("workflow_redriven", { tenant: safeTenantTag(tenantId), jobType: row.job_type });
      return { job: toCamelJob(updated.rows[0]), idempotent: false };
    });
  }

  async jobStatus({ jobId, tenantId } = {}) {
    if (!jobId || !tenantId) throw new DecisionContinuityError("Workflow status requires job and tenant scope.", { code: "tenant_required", status: 401 });
    const pool = await this.database();
    const result = await pool.query("SELECT * FROM decision_continuity_workflow_jobs WHERE job_id = $1 AND tenant_id = $2", [jobId, tenantId]);
    if (!result.rowCount) throw new DecisionContinuityError("Workflow job was not found in this tenant.", { code: "not_found", status: 404 });
    return toCamelJob(result.rows[0]);
  }

  async status({ tenantId, limit = 100 } = {}) {
    if (!tenantId) throw new DecisionContinuityError("A tenant-scoped identity is required.", { code: "tenant_required", status: 401 });
    const pool = await this.database();
    const size = finiteInteger(limit, 100, { name: "status limit", min: 1, max: 500 });
    const [jobs, counts] = await Promise.all([
      pool.query("SELECT * FROM decision_continuity_workflow_jobs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2", [tenantId, size]),
      pool.query("SELECT state, count(*)::int AS count FROM decision_continuity_workflow_jobs WHERE tenant_id = $1 GROUP BY state", [tenantId])
    ]);
    return { jobs: jobs.rows.map(toCamelJob), counts: Object.fromEntries(counts.rows.map((row) => [row.state, Number(row.count)])) };
  }

  async recordHeartbeat({ stopping = false } = {}) {
    const pool = await this.database();
    await pool.query(
      `INSERT INTO decision_continuity_worker_heartbeats (worker_id, role, details, heartbeat_at, stopping_at)
       VALUES ($1, 'decision-continuity-worker', $2::jsonb, clock_timestamp(), CASE WHEN $3 THEN clock_timestamp() ELSE NULL END)
       ON CONFLICT (worker_id) DO UPDATE
         SET details = EXCLUDED.details, heartbeat_at = EXCLUDED.heartbeat_at, stopping_at = EXCLUDED.stopping_at`,
      [this.workerId, JSON.stringify({ ready: !this.draining && !stopping, active: this.active.size, config: { globalConcurrency: this.config.globalConcurrency, perTenantConcurrency: this.config.perTenantConcurrency } }), stopping]
    );
  }

  async health() {
    try {
      const pool = await this.database();
      await pool.query("SELECT 1");
      return { liveness: "ok", readiness: this.started && !this.draining ? "ready" : "draining", workerId: this.workerId, active: this.active.size };
    } catch (error) {
      return { liveness: "ok", readiness: "unavailable", workerId: this.workerId, active: this.active.size, reason: error.code || "database_unavailable" };
    }
  }

  async tick() {
    if (this.tickPromise) return this.tickPromise;
    this.tickPromise = (async () => {
      if (this.draining) return;
      await this.dispatchOutbox().catch((error) => this.log("outbox_dispatch_failed", { code: error.code || "unknown" }));
      while (!this.draining && this.active.size < this.config.globalConcurrency) {
        const job = await this.claim();
        if (!job) break;
        const run = this.execute(job)
          .catch((error) => this.fail(job, error))
          .finally(() => this.active.delete(job.jobId));
        this.active.set(job.jobId, { job, run });
      }
    })().finally(() => { this.tickPromise = null; });
    return this.tickPromise;
  }

  async start() {
    if (this.started) return;
    await this.database();
    this.started = true;
    this.draining = false;
    await this.recordHeartbeat();
    this.pollTimer = setInterval(() => { void this.tick(); }, this.config.pollMs);
    this.heartbeatTimer = setInterval(() => { if (!this.draining) void this.recordHeartbeat().catch((error) => this.log("heartbeat_failed", { code: error.code || "unknown" })); }, Math.max(250, Math.floor(this.config.leaseMs / 3)));
    this.pollTimer.unref?.();
    this.heartbeatTimer.unref?.();
    this.log("worker_ready", { globalConcurrency: this.config.globalConcurrency, perTenantConcurrency: this.config.perTenantConcurrency });
    await this.tick();
  }

  async releaseOwnedLeases() {
    const pool = await this.database();
    const rows = await pool.query(
      `UPDATE decision_continuity_workflow_jobs
          SET state = 'retry', lease_owner = NULL, leased_at = NULL, leased_until = NULL, available_at = clock_timestamp(),
              failure = COALESCE(failure, '{}'::jsonb) || '{"code":"worker_shutdown"}'::jsonb
        WHERE state = 'leased' AND lease_owner = $1
        RETURNING job_id`, [this.workerId]
    );
    return rows.rowCount;
  }

  async shutdown({ graceMs = this.config.shutdownGraceMs } = {}) {
    if (this.draining) return;
    this.draining = true;
    this.shutdownStartedAt = new Date().toISOString();
    clearInterval(this.pollTimer);
    clearInterval(this.heartbeatTimer);
    this.pollTimer = null;
    this.heartbeatTimer = null;
    await this.recordHeartbeat({ stopping: true }).catch((error) => this.log("shutdown_heartbeat_failed", { code: error.code || "unknown" }));
    this.log("worker_draining", { active: this.active.size, graceMs });
    const activeRuns = [...this.active.values()].map((entry) => entry.run);
    let timedOut = false;
    if (activeRuns.length) {
      await Promise.race([
        Promise.allSettled(activeRuns),
        new Promise((resolve) => setTimeout(() => { timedOut = true; resolve(); }, graceMs))
      ]);
    }
    if (timedOut) {
      for (const { job } of this.active.values()) this.fencedJobIds.add(job.jobId);
      const released = await this.releaseOwnedLeases().catch((error) => { this.log("lease_release_failed", { code: error.code || "unknown" }); return 0; });
      this.log("shutdown_grace_expired", { active: this.active.size, released });
    }
    this.started = false;
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.log("worker_stopped", { timedOut });
  }
}
