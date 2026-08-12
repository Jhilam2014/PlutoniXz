-- Step 2 production controls. These additions are additive and safe for an
-- expand/contract rollout: old API and worker versions can continue to use the
-- workflow tables while the new worker begins enforcing the new columns.

ALTER TABLE decision_continuity_workflow_jobs
  ADD COLUMN IF NOT EXISTS redrive_count INTEGER NOT NULL DEFAULT 0 CHECK (redrive_count >= 0),
  ADD COLUMN IF NOT EXISTS max_redrives INTEGER NOT NULL DEFAULT 1 CHECK (max_redrives >= 0);

CREATE TABLE IF NOT EXISTS decision_continuity_workflow_tenant_scheduling (
  tenant_id TEXT PRIMARY KEY,
  last_claimed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS decision_continuity_workflow_admission_idx
  ON decision_continuity_workflow_jobs (tenant_id, workspace_id, state, created_at)
  WHERE state IN ('pending', 'retry', 'leased');

CREATE INDEX IF NOT EXISTS decision_continuity_workflow_fencing_idx
  ON decision_continuity_workflow_jobs (job_id, state, lease_owner, leased_until);
