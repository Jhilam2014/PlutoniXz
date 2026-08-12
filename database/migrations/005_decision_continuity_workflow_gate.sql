-- Step 2 gate completion: an opaque lease epoch makes stale owners unable to
-- acknowledge work after a transfer; redrive keys make an operator retry
-- idempotent without erasing failure history.
ALTER TABLE decision_continuity_workflow_jobs
  ADD COLUMN IF NOT EXISTS lease_epoch BIGINT NOT NULL DEFAULT 0;

ALTER TABLE decision_continuity_workflow_audit
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS decision_continuity_workflow_redrive_idempotency_idx
  ON decision_continuity_workflow_audit (job_id, action, idempotency_key)
  WHERE action = 'redriven' AND idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS decision_continuity_workflow_active_claim_idx
  ON decision_continuity_workflow_jobs (state, leased_until, tenant_id, available_at)
  WHERE state = 'leased';

-- The initial 003 constraint deliberately listed known job types. Branch
-- creation is now also admitted through the durable API boundary.
ALTER TABLE decision_continuity_workflow_jobs
  DROP CONSTRAINT IF EXISTS decision_continuity_workflow_jobs_job_type_check;
ALTER TABLE decision_continuity_workflow_jobs
  ADD CONSTRAINT decision_continuity_workflow_jobs_job_type_check
  CHECK (job_type IN ('branch_create','condition_event','evaluation','policy','approval','canary_start','canary_outcome','disposition'));

CREATE TABLE IF NOT EXISTS decision_continuity_schema_migrations (
  migration_name TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
