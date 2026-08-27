import crypto from "node:crypto";
import {
  BRANCH_STATUSES,
  DecisionContinuityError,
  FileDecisionContinuityStore,
  branchPaginationMetadata,
  normalizeBranchPagination
} from "./decisionContinuity.js";

const CURRENT_ENTITY_TYPES = [
  "branch", "observation", "reconsideration", "approval", "canary", "condition_event", "qagent_run", "qagent_effect",
  "brainx_registration", "brainx_policy", "brainx_route", "brainx_execution", "brainx_effect", "brainx_control", "brainx_circuit_breaker",
  "governed_suggestion", "intel_capability_proposal",
  "enterprise_governance_binding", "enterprise_governance_policy", "enterprise_governance_budget", "enterprise_governance_reservation",
  "enterprise_governance_decision_context", "enterprise_governance_knowledge_receipt", "enterprise_governance_idempotency",
  "researchx_source", "researchx_run", "researchx_effect", "agenticx_knowledge", "agenticx_reuse_receipt"
];
const RETRYABLE_CODES = new Set(["40001", "40P01", "23505"]);
const ADVISORY_LOCK_ID = 483_310_029;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function emptyState() {
  return {
    schemaVersion: "1.0.0",
    updatedAt: new Date().toISOString(),
    branches: {},
    observations: {},
    reconsiderations: {},
    approvals: {},
    canaries: {},
    processedConditionEvents: {},
    qagentRuns: {},
    qagentEffects: {},
    brainxRegistrations: {},
    brainxPolicies: {},
    brainxRoutes: {},
    brainxExecutions: {},
    brainxEffects: {},
    brainxControls: {},
    brainxCircuitBreakers: {},
    governedSuggestions: {},
    intelCapabilityProposals: {},
    enterpriseGovernanceBindings: {},
    enterpriseGovernancePolicies: {},
    enterpriseGovernanceBudgets: {},
    enterpriseGovernanceReservations: {},
    enterpriseGovernanceDecisionContexts: {},
    enterpriseGovernanceKnowledgeReceipts: {},
    enterpriseGovernanceIdempotency: {},
    researchXSources: {},
    researchXRuns: {},
    researchXEffects: {},
    agenticXKnowledge: {},
    agenticXReuseReceipts: {}
  };
}

function recordEntries(state, events = []) {
  const rows = [];
  for (const branch of Object.values(state.branches || {})) {
    rows.push({ type: "branch", id: branch.id, tenantId: branch.tenantId, workspaceId: branch.workspaceId, revision: branch.revision, record: branch });
  }
  for (const [id, observation] of Object.entries(state.observations || {})) {
    rows.push({ type: "observation", id, tenantId: observation.tenantId, workspaceId: observation.workspaceId, revision: observation.revision, record: observation });
  }
  for (const request of Object.values(state.reconsiderations || {})) {
    rows.push({ type: "reconsideration", id: request.id, tenantId: request.tenantId, workspaceId: request.workspaceId, revision: request.revision || 1, record: request });
  }
  for (const approval of Object.values(state.approvals || {})) {
    rows.push({ type: "approval", id: approval.id, tenantId: approval.tenantId, workspaceId: approval.workspaceId, revision: approval.revision || 1, record: approval });
  }
  for (const canary of Object.values(state.canaries || {})) {
    rows.push({ type: "canary", id: canary.id, tenantId: canary.tenantId, workspaceId: canary.workspaceId, revision: canary.revision || 1, record: canary });
  }
  for (const [id, result] of Object.entries(state.processedConditionEvents || {})) {
    const accepted = events.find((event) => event.type === "condition_event.accepted" && event.payload?.eventId === result.eventId);
    const tenantId = accepted?.tenantId || result.tenantId;
    const workspaceId = accepted?.workspaceId || result.workspaceId;
    if (!tenantId || !workspaceId) {
      throw new DecisionContinuityError("Condition-event idempotency record is missing tenant/workspace scope.", {
        code: "invalid_idempotency_scope",
        status: 409
      });
    }
    rows.push({ type: "condition_event", id, tenantId, workspaceId, revision: 1, record: result });
  }
  for (const run of Object.values(state.qagentRuns || {})) {
    rows.push({ type: "qagent_run", id: run.id, tenantId: run.tenantId, workspaceId: run.workspaceId, revision: run.revision || 1, record: run });
  }
  for (const effect of Object.values(state.qagentEffects || {})) {
    rows.push({ type: "qagent_effect", id: effect.id, tenantId: effect.tenantId, workspaceId: effect.workspaceId, revision: effect.revision || 1, record: effect });
  }
  for (const [type, records] of Object.entries({
    brainx_registration: state.brainxRegistrations || {}, brainx_policy: state.brainxPolicies || {}, brainx_route: state.brainxRoutes || {},
    brainx_execution: state.brainxExecutions || {}, brainx_effect: state.brainxEffects || {}, brainx_control: state.brainxControls || {},
    brainx_circuit_breaker: state.brainxCircuitBreakers || {}, governed_suggestion: state.governedSuggestions || {},
    intel_capability_proposal: state.intelCapabilityProposals || {},
    enterprise_governance_binding: state.enterpriseGovernanceBindings || {},
    enterprise_governance_policy: state.enterpriseGovernancePolicies || {},
    enterprise_governance_budget: state.enterpriseGovernanceBudgets || {},
    enterprise_governance_reservation: state.enterpriseGovernanceReservations || {},
    enterprise_governance_decision_context: state.enterpriseGovernanceDecisionContexts || {},
    enterprise_governance_knowledge_receipt: state.enterpriseGovernanceKnowledgeReceipts || {},
    enterprise_governance_idempotency: state.enterpriseGovernanceIdempotency || {},
    researchx_source: state.researchXSources || {}, researchx_run: state.researchXRuns || {}, researchx_effect: state.researchXEffects || {},
    agenticx_knowledge: state.agenticXKnowledge || {}, agenticx_reuse_receipt: state.agenticXReuseReceipts || {}
  })) {
    for (const [key, record] of Object.entries(records)) {
      rows.push({ type, id: record.id || key, tenantId: record.tenantId, workspaceId: record.workspaceId, revision: record.revision || 1, record });
    }
  }
  return rows;
}

function stateFromRows(rows = []) {
  const state = emptyState();
  for (const row of rows) {
    const record = row.record;
    if (row.entity_type === "branch") state.branches[row.entity_id] = record;
    else if (row.entity_type === "observation") state.observations[row.entity_id] = record;
    else if (row.entity_type === "reconsideration") state.reconsiderations[row.entity_id] = record;
    else if (row.entity_type === "approval") state.approvals[row.entity_id] = record;
    else if (row.entity_type === "canary") state.canaries[row.entity_id] = record;
    else if (row.entity_type === "condition_event") state.processedConditionEvents[row.entity_id] = record;
    else if (row.entity_type === "qagent_run") state.qagentRuns[row.entity_id] = record;
    else if (row.entity_type === "qagent_effect") state.qagentEffects[row.entity_id] = record;
    else if (row.entity_type === "brainx_registration") state.brainxRegistrations[row.entity_id] = record;
    else if (row.entity_type === "brainx_policy") state.brainxPolicies[row.entity_id] = record;
    else if (row.entity_type === "brainx_route") state.brainxRoutes[row.entity_id] = record;
    else if (row.entity_type === "brainx_execution") state.brainxExecutions[row.entity_id] = record;
    else if (row.entity_type === "brainx_effect") state.brainxEffects[row.entity_id] = record;
    else if (row.entity_type === "brainx_control") state.brainxControls[row.entity_id] = record;
    else if (row.entity_type === "brainx_circuit_breaker") state.brainxCircuitBreakers[row.entity_id] = record;
    else if (row.entity_type === "governed_suggestion") state.governedSuggestions[row.entity_id] = record;
    else if (row.entity_type === "intel_capability_proposal") state.intelCapabilityProposals[row.entity_id] = record;
    else if (row.entity_type === "enterprise_governance_binding") state.enterpriseGovernanceBindings[row.entity_id] = record;
    else if (row.entity_type === "enterprise_governance_policy") state.enterpriseGovernancePolicies[row.entity_id] = record;
    else if (row.entity_type === "enterprise_governance_budget") state.enterpriseGovernanceBudgets[row.entity_id] = record;
    else if (row.entity_type === "enterprise_governance_reservation") state.enterpriseGovernanceReservations[row.entity_id] = record;
    else if (row.entity_type === "enterprise_governance_decision_context") state.enterpriseGovernanceDecisionContexts[row.entity_id] = record;
    else if (row.entity_type === "enterprise_governance_knowledge_receipt") state.enterpriseGovernanceKnowledgeReceipts[row.entity_id] = record;
    else if (row.entity_type === "enterprise_governance_idempotency") state.enterpriseGovernanceIdempotency[row.entity_id] = record;
    else if (row.entity_type === "researchx_source") state.researchXSources[row.entity_id] = record;
    else if (row.entity_type === "researchx_run") state.researchXRuns[row.entity_id] = record;
    else if (row.entity_type === "researchx_effect") state.researchXEffects[row.entity_id] = record;
    else if (row.entity_type === "agenticx_knowledge") state.agenticXKnowledge[row.entity_id] = record;
    else if (row.entity_type === "agenticx_reuse_receipt") state.agenticXReuseReceipts[row.entity_id] = record;
  }
  return state;
}

function changed(left, right) {
  return JSON.stringify(canonicalize(left)) !== JSON.stringify(canonicalize(right));
}

function branchIdFor(event) {
  return event.payload?.branchId || event.payload?.branch?.id || event.payload?.request?.branchId || "system";
}

function revisionFor(event) {
  return Number(event.payload?.after?.revision || event.payload?.branch?.revision || event.payload?.request?.branchRevision || 0);
}

export class PostgresDecisionContinuityStore extends FileDecisionContinuityStore {
  constructor({ databaseUrl = process.env.DECISION_CONTINUITY_DATABASE_URL || process.env.DATABASE_URL, failureInjector, ...options } = {}) {
    super(options);
    this.databaseUrl = databaseUrl || "";
    this.pool = null;
    this.failureInjector = failureInjector;
  }

  async database() {
    if (!this.databaseUrl) {
      throw new DecisionContinuityError("The authoritative Decision Continuity database is not configured.", {
        code: "authoritative_store_unavailable",
        status: 503
      });
    }
    if (!this.pool) {
      try {
        const { default: pg } = await import("pg");
        this.pool = new pg.Pool({ connectionString: this.databaseUrl, max: 8, idleTimeoutMillis: 10_000 });
      } catch (error) {
        throw new DecisionContinuityError("The PostgreSQL Decision Continuity adapter is unavailable.", {
          code: "authoritative_store_unavailable",
          status: 503,
          details: { cause: error.message }
        });
      }
    }
    return this.pool;
  }

  async health() {
    try {
      const pool = await this.database();
      await pool.query("SELECT 1");
      return { status: "ready", adapter: "postgres", authoritativeWrites: "ready" };
    } catch (error) {
      return { status: "unavailable", adapter: "postgres", authoritativeWrites: "unavailable", reason: error.message };
    }
  }

  async ensure() {
    const health = await this.health();
    if (health.status !== "ready") {
      throw new DecisionContinuityError("The authoritative Decision Continuity database is unavailable.", {
        code: "authoritative_store_unavailable",
        status: 503
      });
    }
  }

  async readState() {
    const pool = await this.database();
    try {
      const result = await pool.query(
        `SELECT entity_type, entity_id, record
           FROM decision_continuity_current_state
          WHERE entity_type = ANY($1::text[])`,
        [CURRENT_ENTITY_TYPES]
      );
      return stateFromRows(result.rows);
    } catch (error) {
      throw this.databaseError(error);
    }
  }

  async readStateWithClient(client) {
    const result = await client.query(
      `SELECT entity_type, entity_id, record
         FROM decision_continuity_current_state
        WHERE entity_type = ANY($1::text[])`,
      [CURRENT_ENTITY_TYPES]
    );
    return stateFromRows(result.rows);
  }

  async listBranchesPage({ tenantId, workspaceId, decisionId, statuses, limit, offset } = {}) {
    if (!tenantId) throw new DecisionContinuityError("A tenant-scoped identity is required.", { code: "tenant_required", status: 401 });
    const pagination = normalizeBranchPagination({ limit, offset });
    const allowedStatuses = Array.isArray(statuses) ? statuses.filter((status) => BRANCH_STATUSES.includes(status)) : [];
    const parameters = [
      tenantId,
      workspaceId || null,
      decisionId || null,
      allowedStatuses
    ];
    const pool = await this.database();
    try {
      const [count, page] = await Promise.all([
        pool.query(
          `SELECT count(*)::int AS total
             FROM decision_continuity_current_state
            WHERE tenant_id = $1
              AND entity_type = 'branch'
              AND ($2::text IS NULL OR workspace_id = $2)
              AND ($3::text IS NULL OR record->>'decisionId' = $3)
              AND (cardinality($4::text[]) = 0 OR record->>'status' = ANY($4::text[]))`,
          parameters
        ),
        pool.query(
          `SELECT record
             FROM decision_continuity_current_state
            WHERE tenant_id = $1
              AND entity_type = 'branch'
              AND ($2::text IS NULL OR workspace_id = $2)
              AND ($3::text IS NULL OR record->>'decisionId' = $3)
              AND (cardinality($4::text[]) = 0 OR record->>'status' = ANY($4::text[]))
            ORDER BY record->>'updatedAt' DESC NULLS LAST, entity_id DESC
            LIMIT $5 OFFSET $6`,
          [...parameters, pagination.limit, pagination.offset]
        )
      ]);
      const branches = page.rows.map((row) => clone(row.record));
      return {
        branches,
        pagination: branchPaginationMetadata({
          ...pagination,
          total: Number(count.rows[0]?.total || 0),
          returned: branches.length
        })
      };
    } catch (error) {
      throw this.databaseError(error);
    }
  }

  async listBranches(options = {}) {
    return (await this.listBranchesPage(options)).branches;
  }

  databaseError(error) {
    if (error instanceof DecisionContinuityError) return error;
    return new DecisionContinuityError("The authoritative Decision Continuity database is unavailable; no write was accepted.", {
      code: "authoritative_store_unavailable",
      status: 503,
      details: { databaseCode: error.code || "unknown" }
    });
  }

  async mutateWithinClient(client, work) {
    await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_ID]);
    const before = await this.readStateWithClient(client);
    const state = clone(before);
    const events = [];
    const result = await work(state, events);
    state.updatedAt = new Date().toISOString();
    await this.persistState(client, before, state, events);
    return result;
  }

  async mutate(work, existingClient = null) {
    if (existingClient) return this.mutateWithinClient(existingClient, work);
    const pool = await this.database();
    let retry = 0;
    while (retry < 2) {
      const client = await pool.connect().catch((error) => { throw this.databaseError(error); });
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const result = await this.mutateWithinClient(client, work);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        if (RETRYABLE_CODES.has(error.code) && retry < 1) {
          retry += 1;
          continue;
        }
        if (error instanceof DecisionContinuityError || error.name === "ZodError") throw error;
        throw this.databaseError(error);
      } finally {
        client.release();
      }
    }
    throw new DecisionContinuityError("Concurrent Decision Continuity mutation conflict.", { code: "revision_conflict", status: 409 });
  }

  /**
   * Executes a workflow effect and acknowledges its lease in one PostgreSQL
   * transaction.  The bound facade makes the existing domain methods use this
   * transaction without duplicating their validation/state-machine logic.
   */
  async executeWorkflowEffect({ job, workerId, effect, afterEffect, shouldFence = () => false } = {}) {
    if (!job?.jobId || !workerId || typeof effect !== "function") {
      throw new DecisionContinuityError("A claimed workflow job, worker identity, and effect are required.", { code: "invalid_request" });
    }
    const pool = await this.database();
    const client = await pool.connect().catch((error) => { throw this.databaseError(error); });
    try {
      // The same advisory lock used by domain mutations serializes effects;
      // read committed prevents a transaction waiting on that lock from using
      // a snapshot that predates the just-completed workflow effect.
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_ID]);
      const claimed = await client.query(
        `SELECT * FROM decision_continuity_workflow_jobs
          WHERE job_id = $1 AND tenant_id = $2 AND state = 'leased'
            AND lease_owner = $3 AND lease_epoch = $4 AND leased_until >= clock_timestamp()
          FOR UPDATE`,
        [job.jobId, job.tenantId, workerId, job.leaseEpoch]
      );
      if (!claimed.rowCount) {
        throw new DecisionContinuityError("The worker no longer owns this workflow lease.", { code: "lease_lost", status: 409 });
      }
      const inbox = await client.query(
        `SELECT outcome FROM decision_continuity_workflow_inbox
          WHERE consumer_name = 'decision-continuity-domain/v1' AND job_id = $1 AND tenant_id = $2`,
        [job.jobId, job.tenantId]
      );
      if (inbox.rowCount) {
        await client.query("COMMIT");
        return { idempotent: true, outcome: inbox.rows[0].outcome };
      }
      const transactionalStore = Object.create(this);
      transactionalStore.mutate = (work) => this.mutate(work, client);
      const outcome = await effect(transactionalStore);
      await afterEffect?.(outcome);
      if (shouldFence()) {
        throw new DecisionContinuityError("The worker shutdown grace period fenced this workflow lease.", { code: "lease_lost", status: 409 });
      }
      const completion = await client.query(
        `UPDATE decision_continuity_workflow_jobs
            SET state = 'completed', completed_at = clock_timestamp(), lease_owner = NULL, leased_at = NULL, leased_until = NULL
          WHERE job_id = $1 AND tenant_id = $2 AND state = 'leased'
            AND lease_owner = $3 AND lease_epoch = $4 AND leased_until >= clock_timestamp()
          RETURNING *`,
        [job.jobId, job.tenantId, workerId, job.leaseEpoch]
      );
      if (!completion.rowCount) {
        throw new DecisionContinuityError("The workflow lease expired before the effect could be acknowledged.", { code: "lease_lost", status: 409 });
      }
      await client.query(
        `INSERT INTO decision_continuity_workflow_inbox (consumer_name, job_id, tenant_id, workspace_id, outcome)
         VALUES ('decision-continuity-domain/v1', $1, $2, $3, $4::jsonb)`,
        [job.jobId, job.tenantId, job.workspaceId, JSON.stringify(outcome || {})]
      );
      await client.query(
        `INSERT INTO decision_continuity_workflow_audit (job_id, tenant_id, workspace_id, action, actor, metadata)
         VALUES ($1, $2, $3, 'completed', $4::jsonb, $5::jsonb)`,
        [job.jobId, job.tenantId, job.workspaceId, JSON.stringify({ type: "worker", id: workerId }), JSON.stringify({ leaseEpoch: job.leaseEpoch })]
      );
      await client.query("COMMIT");
      return { idempotent: false, outcome };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (error instanceof DecisionContinuityError || error.name === "ZodError") throw error;
      throw this.databaseError(error);
    } finally {
      client.release();
    }
  }

  async persistState(client, before, state, events) {
    const beforeRows = new Map(recordEntries(before).map((row) => [`${row.type}:${row.tenantId}:${row.workspaceId}:${row.id}`, row]));
    for (const row of recordEntries(state, events)) {
      const key = `${row.type}:${row.tenantId}:${row.workspaceId}:${row.id}`;
      const previous = beforeRows.get(key);
      if (previous && !changed(previous.record, row.record)) continue;
      if (!previous) {
        await client.query(
          `INSERT INTO decision_continuity_current_state
             (tenant_id, workspace_id, entity_type, entity_id, revision, record)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [row.tenantId, row.workspaceId, row.type, row.id, Number(row.revision || 1), JSON.stringify(row.record)]
        );
      } else {
        const update = await client.query(
          `UPDATE decision_continuity_current_state
              SET revision = $6, record = $7::jsonb, updated_at = NOW()
            WHERE tenant_id = $1 AND workspace_id = $2 AND entity_type = $3 AND entity_id = $4 AND revision = $5`,
          [row.tenantId, row.workspaceId, row.type, row.id, Number(previous.revision || 1), Number(row.revision || 1), JSON.stringify(row.record)]
        );
        if (update.rowCount !== 1) {
          throw new DecisionContinuityError("The record changed before this request could be applied. Refresh and retry.", {
            code: "revision_conflict",
            status: 409
          });
        }
      }
      if (row.type === "condition_event") {
        await client.query(
          `INSERT INTO decision_continuity_idempotency (tenant_id, workspace_id, idempotency_key, response)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (tenant_id, workspace_id, idempotency_key) DO UPDATE SET response = EXCLUDED.response`,
          [row.tenantId, row.workspaceId, row.id, JSON.stringify(row.record)]
        );
      }
    }

    for (const event of events) {
      const chain = await client.query(
        `SELECT event_hash FROM decision_continuity_events
          WHERE tenant_id = $1 AND workspace_id = $2
          ORDER BY sequence_no DESC LIMIT 1`,
        [event.tenantId, event.workspaceId]
      );
      const previousHash = chain.rows[0]?.event_hash || null;
      const immutableEvent = {
        ...clone(event),
        hashVersion: "decision-continuity-event/v1",
        previousHash
      };
      const calculatedHash = digest({ ...immutableEvent, eventHash: undefined });
      if (event.eventHash && event.hashVersion && event.eventHash !== calculatedHash) {
        throw new DecisionContinuityError("Imported event hash does not match its canonical payload.", { code: "event_integrity_failed", status: 409 });
      }
      immutableEvent.eventHash = event.eventHash || calculatedHash;
      await client.query(
        `INSERT INTO decision_continuity_events
           (event_id, tenant_id, workspace_id, aggregate_id, aggregate_version, event_type, actor, correlation_id, payload, previous_hash, event_hash, event_record)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12::jsonb)`,
        [immutableEvent.id, immutableEvent.tenantId, immutableEvent.workspaceId, branchIdFor(immutableEvent), revisionFor(immutableEvent), immutableEvent.type, JSON.stringify(immutableEvent.actor || {}), immutableEvent.correlationId, JSON.stringify(immutableEvent.payload || {}), previousHash, immutableEvent.eventHash, JSON.stringify(immutableEvent)]
      );
      await this.failureInjector?.("before_outbox", immutableEvent);
      await client.query(
        `INSERT INTO decision_continuity_outbox
           (event_id, tenant_id, workspace_id, aggregate_id, aggregate_version, payload, checkpoint_version)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 1)`,
        [immutableEvent.id, immutableEvent.tenantId, immutableEvent.workspaceId, branchIdFor(immutableEvent), revisionFor(immutableEvent), JSON.stringify(immutableEvent)]
      );
    }
  }

  async listEvents({ tenantId, workspaceId, branchId, limit = 200 } = {}) {
    if (!tenantId) throw new DecisionContinuityError("A tenant-scoped identity is required.", { code: "tenant_required", status: 401 });
    const pool = await this.database();
    try {
      const result = await pool.query(
        `SELECT event_record
           FROM decision_continuity_events
          WHERE tenant_id = $1
            AND ($2::text IS NULL OR workspace_id = $2)
            AND ($3::text IS NULL OR aggregate_id = $3)
          ORDER BY sequence_no DESC
          LIMIT $4`,
        [tenantId, workspaceId || null, branchId || null, Math.max(1, Math.min(Number(limit) || 200, 500))]
      );
      return result.rows.map((row) => row.event_record);
    } catch (error) {
      throw this.databaseError(error);
    }
  }

  async importLegacy({ state, events = [], dryRun = false } = {}) {
    if (!state || typeof state !== "object") throw new DecisionContinuityError("A validated legacy snapshot is required for import.", { code: "invalid_import" });
    const eventIds = new Set();
    for (const event of events) {
      if (!event?.id || !event?.tenantId || !event?.workspaceId || !event?.type || eventIds.has(event.id)) {
        throw new DecisionContinuityError("Imported events require unique id, tenantId, workspaceId, and type.", { code: "invalid_import" });
      }
      eventIds.add(event.id);
    }
    const rows = recordEntries(state, events);
    const sourceChecksum = digest({ state, events });
    if (dryRun) {
      return { dryRun: true, sourceChecksum, currentStateRecords: rows.length, events: events.length, outboxRecords: events.length };
    }
    const pool = await this.database();
    const client = await pool.connect().catch((error) => { throw this.databaseError(error); });
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_ID]);
      const existing = await client.query("SELECT source_checksum, imported_counts FROM decision_continuity_import_runs WHERE source_checksum = $1", [sourceChecksum]);
      if (existing.rowCount) {
        await client.query("COMMIT");
        return { dryRun: false, idempotent: true, sourceChecksum, ...existing.rows[0].imported_counts };
      }
      const empty = emptyState();
      await this.persistState(client, empty, state, events);
      const counts = { currentStateRecords: rows.length, events: events.length, outboxRecords: events.length };
      const persisted = await client.query(
        `SELECT
           (SELECT count(*)::int FROM decision_continuity_current_state) AS current_state_records,
           (SELECT count(*)::int FROM decision_continuity_events) AS events,
           (SELECT count(*)::int FROM decision_continuity_outbox) AS outbox_records`
      );
      if (persisted.rows[0].current_state_records < counts.currentStateRecords || persisted.rows[0].events < counts.events || persisted.rows[0].outbox_records < counts.outboxRecords) {
        throw new DecisionContinuityError("Imported record counts did not reconcile before commit.", { code: "import_reconciliation_failed", status: 409 });
      }
      await client.query(
        `INSERT INTO decision_continuity_import_runs (source_checksum, imported_counts, rollback_plan)
         VALUES ($1, $2::jsonb, $3)`,
        [sourceChecksum, JSON.stringify(counts), "Do not delete source JSONL. Roll back by restoring a database backup or marking this import run superseded; a destructive delete migration is intentionally not provided."]
      );
      await client.query("COMMIT");
      return { dryRun: false, idempotent: false, sourceChecksum, destinationChecksum: sourceChecksum, ...counts };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (error instanceof DecisionContinuityError) throw error;
      throw this.databaseError(error);
    } finally {
      client.release();
    }
  }
}
