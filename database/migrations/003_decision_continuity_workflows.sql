-- Step 2: durable at-least-once workflow transport backed by the authoritative
-- PostgreSQL database. Jobs are tenant/workspace scoped and never use process memory as truth.
ALTER TABLE decision_continuity_outbox ADD COLUMN IF NOT EXISTS dispatch_status TEXT NOT NULL DEFAULT 'pending' CHECK (dispatch_status IN ('pending','leased','published','dead'));
ALTER TABLE decision_continuity_outbox ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE decision_continuity_outbox ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE decision_continuity_outbox ADD COLUMN IF NOT EXISTS leased_until TIMESTAMPTZ;
ALTER TABLE decision_continuity_outbox ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE decision_continuity_outbox ADD COLUMN IF NOT EXISTS last_error_code TEXT;
CREATE INDEX IF NOT EXISTS decision_continuity_outbox_dispatch_idx ON decision_continuity_outbox (dispatch_status, available_at, outbox_id);

CREATE TABLE IF NOT EXISTS decision_continuity_workflow_jobs (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('condition_event','evaluation','policy','approval','canary_start','canary_outcome','disposition')),
  state TEXT NOT NULL CHECK (state IN ('pending','leased','retry','completed','cancelled','dead')),
  idempotency_key TEXT NOT NULL,
  branch_id TEXT, reconsideration_id TEXT, correlation_id TEXT NOT NULL, causation_id TEXT,
  payload JSONB NOT NULL, priority INTEGER NOT NULL DEFAULT 0, budget JSONB NOT NULL DEFAULT '{}'::jsonb,
  deadline_at TIMESTAMPTZ, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), leased_at TIMESTAMPTZ, leased_until TIMESTAMPTZ,
  lease_owner TEXT, completed_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  failure JSONB,
  UNIQUE (tenant_id, workspace_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS decision_continuity_workflow_claim_idx ON decision_continuity_workflow_jobs (state, available_at, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS decision_continuity_workflow_tenant_idx ON decision_continuity_workflow_jobs (tenant_id, state, leased_until);

CREATE TABLE IF NOT EXISTS decision_continuity_workflow_inbox (
  consumer_name TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES decision_continuity_workflow_jobs(job_id),
  tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, outcome JSONB, completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (consumer_name, job_id)
);
CREATE TABLE IF NOT EXISTS decision_continuity_worker_heartbeats (
  worker_id TEXT PRIMARY KEY, role TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb, heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), stopping_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS decision_continuity_workflow_audit (
  audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job_id TEXT NOT NULL, tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  action TEXT NOT NULL, actor JSONB NOT NULL DEFAULT '{}'::jsonb, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
