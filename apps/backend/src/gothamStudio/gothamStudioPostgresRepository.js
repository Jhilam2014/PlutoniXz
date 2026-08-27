import pg from "pg";
import { GothamStudioError, publicStudioRecord, studioId, studioScopeKey } from "./domain.js";

function byNewest(left, right) {
  return new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime();
}

function recordFrom(row) {
  return row?.record && typeof row.record === "object" ? row.record : null;
}

function now() {
  return new Date().toISOString();
}

export class GothamStudioPostgresRepository {
  constructor({ databaseUrl = process.env.GOTHAM_STUDIO_DATABASE_URL || process.env.DECISION_CONTINUITY_DATABASE_URL || process.env.DATABASE_URL, pool = null } = {}) {
    this.databaseUrl = String(databaseUrl || "").trim();
    this.pool = pool;
  }

  database() {
    if (!this.pool) {
      if (!this.databaseUrl) throw new GothamStudioError("Gotham Studio PostgreSQL is not configured.", { code: "studio_database_unavailable", status: 503 });
      this.pool = new pg.Pool({ connectionString: this.databaseUrl, max: 8, idleTimeoutMillis: 10_000 });
    }
    return this.pool;
  }

  databaseError(error) {
    if (error instanceof GothamStudioError) return error;
    return new GothamStudioError(
      error?.code === "42P01" ? "Gotham Studio database migration 012 is required." : "Gotham Studio database is unavailable.",
      { code: error?.code === "42P01" ? "studio_migration_required" : "studio_database_unavailable", status: 503, retryable: true }
    );
  }

  async query(text, values = []) {
    try {
      return await this.database().query(text, values);
    } catch (error) {
      throw this.databaseError(error);
    }
  }

  async transaction(operation) {
    let client;
    try {
      client = await this.database().connect();
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client?.query("ROLLBACK").catch(() => {});
      throw this.databaseError(error);
    } finally {
      client?.release();
    }
  }

  async close() {
    if (this.pool?.end) await this.pool.end();
    this.pool = null;
  }

  async withJobLease(jobId, scope, operation) {
    studioScopeKey(scope);
    let client;
    let acquired = false;
    const leaseKey = `${scope.tenantId}:${scope.workspaceId}:${scope.projectId}:${jobId}`;
    try {
      client = await this.database().connect();
      const result = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [leaseKey]);
      acquired = result.rows[0]?.acquired === true;
      if (!acquired) return null;
      return await operation();
    } catch (error) {
      throw this.databaseError(error);
    } finally {
      if (acquired) await client?.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [leaseKey]).catch(() => {});
      client?.release();
    }
  }

  async listPipelines(scope) {
    studioScopeKey(scope);
    const result = await this.query("SELECT record FROM gotham_studio_pipelines WHERE tenant_id=$1 AND workspace_id=$2 AND project_id=$3 ORDER BY updated_at DESC", [scope.tenantId, scope.workspaceId, scope.projectId]);
    return result.rows.map(recordFrom).filter(Boolean).map(publicStudioRecord);
  }

  async getPipeline(id, scope) {
    studioScopeKey(scope);
    const result = await this.query("SELECT record FROM gotham_studio_pipelines WHERE pipeline_id=$1 AND tenant_id=$2 AND workspace_id=$3 AND project_id=$4", [id, scope.tenantId, scope.workspaceId, scope.projectId]);
    const record = recordFrom(result.rows[0]);
    if (!record) throw new GothamStudioError("Pipeline not found.", { code: "pipeline_not_found", status: 404 });
    return publicStudioRecord(record);
  }

  async createPipeline(input, scope) {
    studioScopeKey(scope);
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${scope.tenantId}:${scope.workspaceId}:${scope.projectId}:${input.name.toLowerCase()}`]);
      const versionResult = await client.query("SELECT COALESCE(MAX(version),0)+1 AS version FROM gotham_studio_pipelines WHERE tenant_id=$1 AND workspace_id=$2 AND project_id=$3 AND lower(name)=lower($4)", [scope.tenantId, scope.workspaceId, scope.projectId, input.name]);
      const timestamp = now();
      const pipeline = {
        id: studioId("PX-PIPELINE"), tenantId: scope.tenantId, workspaceId: scope.workspaceId, projectId: scope.projectId,
        name: input.name, version: Number(versionResult.rows[0]?.version || 1), objective: input.objective,
        providerPreference: input.providerPreference || "", functionalityId: input.functionalityId || "",
        stages: input.stages, providerConfiguration: input.providerConfiguration || {}, createdAt: timestamp, updatedAt: timestamp
      };
      await client.query(`INSERT INTO gotham_studio_pipelines
        (pipeline_id,tenant_id,workspace_id,project_id,functionality_id,name,version,objective,provider_preference,stages,provider_configuration,record,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$13)`, [
        pipeline.id, scope.tenantId, scope.workspaceId, scope.projectId, pipeline.functionalityId || null,
        pipeline.name, pipeline.version, pipeline.objective, pipeline.providerPreference || null,
        JSON.stringify(pipeline.stages), JSON.stringify(pipeline.providerConfiguration), JSON.stringify(pipeline), timestamp
      ]);
      return publicStudioRecord(pipeline);
    });
  }

  async listJobs(scope, { states = [], limit = 200 } = {}) {
    studioScopeKey(scope);
    const normalizedStates = states.map((item) => String(item).toUpperCase());
    const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
    const result = await this.query(`SELECT record FROM gotham_studio_jobs
      WHERE tenant_id=$1 AND workspace_id=$2 AND project_id=$3 AND ($4::text[] IS NULL OR logical_state=ANY($4::text[]))
      ORDER BY updated_at DESC LIMIT $5`, [scope.tenantId, scope.workspaceId, scope.projectId, normalizedStates.length ? normalizedStates : null, safeLimit]);
    return result.rows.map(recordFrom).filter(Boolean).map(publicStudioRecord);
  }

  async listActiveJobScopes(states = []) {
    const normalizedStates = states.map((item) => String(item).toUpperCase());
    const result = await this.query("SELECT job_id,tenant_id,workspace_id,project_id,updated_at FROM gotham_studio_jobs WHERE $1::text[] IS NULL OR logical_state=ANY($1::text[])", [normalizedStates.length ? normalizedStates : null]);
    return result.rows.map((row) => ({ jobId: row.job_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, projectId: row.project_id, updatedAt: row.updated_at?.toISOString?.() || row.updated_at }));
  }

  async getJob(id, scope) {
    studioScopeKey(scope);
    const result = await this.query("SELECT record FROM gotham_studio_jobs WHERE job_id=$1 AND tenant_id=$2 AND workspace_id=$3 AND project_id=$4", [id, scope.tenantId, scope.workspaceId, scope.projectId]);
    const record = recordFrom(result.rows[0]);
    if (!record) throw new GothamStudioError("Job not found.", { code: "job_not_found", status: 404 });
    return publicStudioRecord(record);
  }

  async findJobByIdempotencyKey(key, scope) {
    if (!key) return null;
    studioScopeKey(scope);
    const result = await this.query("SELECT record FROM gotham_studio_jobs WHERE tenant_id=$1 AND workspace_id=$2 AND project_id=$3 AND idempotency_key=$4", [scope.tenantId, scope.workspaceId, scope.projectId, key]);
    const record = recordFrom(result.rows[0]);
    return record ? publicStudioRecord(record) : null;
  }

  async createJob(input, scope, { idempotencyKey = "", triggeredBy = null } = {}) {
    studioScopeKey(scope);
    return this.transaction(async (client) => {
      if (idempotencyKey) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${scope.tenantId}:${scope.workspaceId}:${idempotencyKey}`]);
        const existing = await client.query("SELECT record FROM gotham_studio_jobs WHERE tenant_id=$1 AND workspace_id=$2 AND project_id=$3 AND idempotency_key=$4", [scope.tenantId, scope.workspaceId, scope.projectId, idempotencyKey]);
        if (recordFrom(existing.rows[0])) return publicStudioRecord(recordFrom(existing.rows[0]));
      }
      const timestamp = now();
      const job = {
        id: studioId("PX-ML"), tenantId: scope.tenantId, workspaceId: scope.workspaceId, projectId: scope.projectId,
        pipelineId: input.pipelineId || "", functionalityId: input.functionalityId || "", name: input.name, objective: input.objective,
        provider: input.provider, providerJobId: "", providerRunId: "", providerUrl: "", logicalState: "DRAFT", providerState: "",
        providerStatusMessage: "", currentStage: "", progress: null, parameters: input.parameters || {}, providerConfiguration: input.providerConfiguration || {},
        constraints: input.constraints, estimatedCost: null, actualCost: null, costCurrency: input.constraints.currency,
        computeDurationSeconds: null, resourceType: input.providerConfiguration?.computeClass || "", error: null,
        retry: { retryOfJobId: input.retryOfJobId || "", attempt: Number(input.retryAttempt || 1), retriedByJobId: "" },
        experimentReferences: Array.isArray(input.providerConfiguration?.mlflowRunIds) ? input.providerConfiguration.mlflowRunIds.slice(0, 20).map((providerRunId) => ({ providerRunId: String(providerRunId) })) : [],
        modelReferences: [], artifactReferences: [], triggeredBy: triggeredBy || { type: "user", id: "", name: "" },
        triggerSource: input.triggerSource, workflowMode: input.workflowMode, idempotencyKey,
        createdAt: timestamp, submittedAt: "", startedAt: "", completedAt: "", updatedAt: timestamp
      };
      await client.query(`INSERT INTO gotham_studio_jobs
        (job_id,tenant_id,workspace_id,project_id,pipeline_id,functionality_id,name,objective,provider,provider_job_id,provider_run_id,logical_state,provider_state,parameters,provider_configuration,constraints,estimated_cost,actual_cost,cost_currency,error,retry,idempotency_key,record,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,$10,NULL,$11::jsonb,$12::jsonb,$13::jsonb,NULL,NULL,$14,NULL,$15::jsonb,$16,$17::jsonb,$18,$18)`, [
        job.id, scope.tenantId, scope.workspaceId, scope.projectId, job.pipelineId || null, job.functionalityId || null,
        job.name, job.objective, job.provider, job.logicalState, JSON.stringify(job.parameters), JSON.stringify(job.providerConfiguration),
        JSON.stringify(job.constraints), job.costCurrency, JSON.stringify(job.retry), idempotencyKey || null, JSON.stringify(job), timestamp
      ]);
      return publicStudioRecord(job);
    });
  }

  async updateJob(id, scope, updater) {
    studioScopeKey(scope);
    return this.transaction(async (client) => {
      const result = await client.query("SELECT record FROM gotham_studio_jobs WHERE job_id=$1 AND tenant_id=$2 AND workspace_id=$3 AND project_id=$4 FOR UPDATE", [id, scope.tenantId, scope.workspaceId, scope.projectId]);
      const current = recordFrom(result.rows[0]);
      if (!current) throw new GothamStudioError("Job not found.", { code: "job_not_found", status: 404 });
      const patch = typeof updater === "function" ? await updater(publicStudioRecord(current)) : updater;
      const next = { ...current, ...(patch || {}), updatedAt: now() };
      await client.query(`UPDATE gotham_studio_jobs SET provider_job_id=$5,provider_run_id=$6,logical_state=$7,provider_state=$8,
        estimated_cost=$9,actual_cost=$10,cost_currency=$11,error=$12::jsonb,retry=$13::jsonb,submitted_at=$14,started_at=$15,completed_at=$16,record=$17::jsonb,updated_at=$18
        WHERE job_id=$1 AND tenant_id=$2 AND workspace_id=$3 AND project_id=$4`, [
        id, scope.tenantId, scope.workspaceId, scope.projectId, next.providerJobId || null, next.providerRunId || null,
        next.logicalState, next.providerState || null, next.estimatedCost, next.actualCost, next.costCurrency || null,
        JSON.stringify(next.error), JSON.stringify(next.retry || {}), next.submittedAt || null, next.startedAt || null,
        next.completedAt || null, JSON.stringify(next), next.updatedAt
      ]);
      return publicStudioRecord(next);
    });
  }

  async appendEvent(event, scope) {
    studioScopeKey(scope);
    const record = { id: studioId("PX-EVENT"), tenantId: scope.tenantId, workspaceId: scope.workspaceId, projectId: scope.projectId, ...event, createdAt: event.createdAt || now() };
    await this.query(`INSERT INTO gotham_studio_events (event_id,tenant_id,workspace_id,project_id,job_id,event_type,payload,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [record.id, scope.tenantId, scope.workspaceId, scope.projectId, record.jobId || null, record.type, JSON.stringify(record), record.createdAt]);
    return publicStudioRecord(record);
  }

  async listEvents(scope, { jobId = "", limit = 300 } = {}) {
    studioScopeKey(scope);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 300, 1000));
    const result = await this.query(`SELECT payload AS record FROM gotham_studio_events WHERE tenant_id=$1 AND workspace_id=$2 AND project_id=$3
      AND ($4::text='' OR job_id=$4) ORDER BY created_at DESC LIMIT $5`, [scope.tenantId, scope.workspaceId, scope.projectId, jobId, safeLimit]);
    return result.rows.map(recordFrom).filter(Boolean).map(publicStudioRecord);
  }

  async recordProviderCheck(providerId, check, scope) {
    studioScopeKey(scope);
    const timestamp = now();
    const record = { tenantId: scope.tenantId, workspaceId: scope.workspaceId, projectId: scope.projectId, providerId, ...check, checkedAt: check.checkedAt || timestamp, updatedAt: timestamp };
    await this.query(`INSERT INTO gotham_studio_provider_checks (tenant_id,workspace_id,project_id,provider_id,status,connected,metadata,error,record,checked_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11)
      ON CONFLICT (tenant_id,workspace_id,project_id,provider_id) DO UPDATE SET status=EXCLUDED.status,connected=EXCLUDED.connected,metadata=EXCLUDED.metadata,error=EXCLUDED.error,record=EXCLUDED.record,checked_at=EXCLUDED.checked_at,updated_at=EXCLUDED.updated_at`, [
      scope.tenantId, scope.workspaceId, scope.projectId, providerId, record.status, Boolean(record.connected), JSON.stringify(record.metadata || {}), JSON.stringify(record.error || null), JSON.stringify(record), record.checkedAt, record.updatedAt
    ]);
    return publicStudioRecord(record);
  }

  async listProviderChecks(scope) {
    studioScopeKey(scope);
    const result = await this.query("SELECT record FROM gotham_studio_provider_checks WHERE tenant_id=$1 AND workspace_id=$2 AND project_id=$3 ORDER BY updated_at DESC", [scope.tenantId, scope.workspaceId, scope.projectId]);
    return result.rows.map(recordFrom).filter(Boolean).map(publicStudioRecord);
  }

  async listExperiments(scope) {
    studioScopeKey(scope);
    const result = await this.query("SELECT record FROM gotham_studio_experiments WHERE tenant_id=$1 AND workspace_id=$2 AND project_id=$3 ORDER BY updated_at DESC", [scope.tenantId, scope.workspaceId, scope.projectId]);
    return result.rows.map(recordFrom).filter(Boolean).map(publicStudioRecord).sort(byNewest);
  }

  async upsertExperiment(input, scope) {
    studioScopeKey(scope);
    const existing = (await this.listExperiments(scope)).find((item) => item.provider === input.provider && item.providerRunId === input.providerRunId);
    const timestamp = now();
    const record = { ...(existing || {}), id: existing?.id || studioId("PX-EXP"), tenantId: scope.tenantId, workspaceId: scope.workspaceId, projectId: scope.projectId,
      pipelineId: input.pipelineId || existing?.pipelineId || "", jobId: input.jobId || existing?.jobId || "", provider: input.provider,
      providerRunId: input.providerRunId, name: input.name || existing?.name || `Experiment ${input.providerRunId}`,
      metrics: Array.isArray(input.metrics) ? input.metrics.slice(0, 500) : existing?.metrics || [], primaryMetric: input.primaryMetric || existing?.primaryMetric || null,
      status: input.status || existing?.status || "recorded", isBest: input.isBest === true, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp };
    await this.query(`INSERT INTO gotham_studio_experiments (experiment_id,tenant_id,workspace_id,project_id,pipeline_id,job_id,provider,provider_run_id,name,metrics,primary_metric,status,is_best,record,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14::jsonb,$15,$16)
      ON CONFLICT (tenant_id,workspace_id,project_id,provider,provider_run_id) DO UPDATE SET metrics=EXCLUDED.metrics,primary_metric=EXCLUDED.primary_metric,status=EXCLUDED.status,is_best=EXCLUDED.is_best,record=EXCLUDED.record,updated_at=EXCLUDED.updated_at`, [
      record.id, scope.tenantId, scope.workspaceId, scope.projectId, record.pipelineId || null, record.jobId || null, record.provider, record.providerRunId,
      record.name, JSON.stringify(record.metrics), JSON.stringify(record.primaryMetric), record.status, record.isBest, JSON.stringify(record), record.createdAt, record.updatedAt
    ]);
    return publicStudioRecord(record);
  }

  async listModels(scope) {
    studioScopeKey(scope);
    const result = await this.query("SELECT record FROM gotham_studio_models WHERE tenant_id=$1 AND workspace_id=$2 AND project_id=$3 ORDER BY updated_at DESC", [scope.tenantId, scope.workspaceId, scope.projectId]);
    return result.rows.map(recordFrom).filter(Boolean).map(publicStudioRecord).sort(byNewest);
  }

  async upsertModel(input, scope) {
    studioScopeKey(scope);
    const version = String(input.version || "");
    const existing = (await this.listModels(scope)).find((item) => item.provider === input.provider && item.providerModelId === input.providerModelId && String(item.version || "") === version);
    const timestamp = now();
    const record = { ...(existing || {}), id: existing?.id || studioId("PX-MODEL"), tenantId: scope.tenantId, workspaceId: scope.workspaceId, projectId: scope.projectId,
      pipelineId: input.pipelineId || existing?.pipelineId || "", jobId: input.jobId || existing?.jobId || "", experimentId: input.experimentId || existing?.experimentId || "",
      provider: input.provider, providerModelId: input.providerModelId, name: input.name || existing?.name || input.providerModelId, version,
      stage: input.stage || existing?.stage || "Unassigned", metrics: Array.isArray(input.metrics) ? input.metrics.slice(0, 500) : existing?.metrics || [],
      isBest: input.isBest === true, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp };
    await this.query(`INSERT INTO gotham_studio_models (model_id,tenant_id,workspace_id,project_id,pipeline_id,job_id,experiment_id,provider,provider_model_id,name,version,stage,metrics,is_best,record,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15::jsonb,$16,$17)
      ON CONFLICT (tenant_id,workspace_id,project_id,provider,provider_model_id,version) DO UPDATE SET stage=EXCLUDED.stage,metrics=EXCLUDED.metrics,is_best=EXCLUDED.is_best,record=EXCLUDED.record,updated_at=EXCLUDED.updated_at`, [
      record.id, scope.tenantId, scope.workspaceId, scope.projectId, record.pipelineId || null, record.jobId || null, record.experimentId || null,
      record.provider, record.providerModelId, record.name, record.version, record.stage, JSON.stringify(record.metrics), record.isBest, JSON.stringify(record), record.createdAt, record.updatedAt
    ]);
    return publicStudioRecord(record);
  }
}
