-- Step 4: authoritative lifecycle records for governed runtime promotions.
-- Every row is explicitly tenant/workspace scoped. JSON artifacts are retained
-- by their canonical SHA-256 digest; revisions never overwrite prior evidence.
CREATE TABLE IF NOT EXISTS governed_promotion_artifacts (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  target_key TEXT NOT NULL,
  artifact_digest TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  content JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, workspace_id, target_key, artifact_digest),
  CHECK (length(trim(tenant_id)) > 0 AND length(trim(workspace_id)) > 0),
  CHECK (artifact_digest ~ '^[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS governed_promotion_requests (
  request_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  target_key TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (length(trim(tenant_id)) > 0 AND length(trim(workspace_id)) > 0),
  CHECK (status IN ('awaiting_evaluation', 'awaiting_policy', 'awaiting_approval', 'approved', 'canary_running', 'promoted', 'halted', 'rolled_back', 'rejected'))
);
CREATE INDEX IF NOT EXISTS governed_promotion_requests_scope_idx
  ON governed_promotion_requests (tenant_id, workspace_id, target_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS governed_promotion_events (
  event_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES governed_promotion_requests(request_id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  target_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor JSONB NOT NULL,
  payload JSONB NOT NULL,
  previous_hash TEXT,
  event_hash TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (length(trim(tenant_id)) > 0 AND length(trim(workspace_id)) > 0),
  CHECK (event_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS governed_promotion_events_scope_idx
  ON governed_promotion_events (tenant_id, workspace_id, target_key, occurred_at DESC);

CREATE TABLE IF NOT EXISTS governed_promotion_runtime_selectors (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  target_key TEXT NOT NULL,
  active_digest TEXT,
  previous_digest TEXT,
  canary_digest TEXT,
  selector JSONB NOT NULL DEFAULT '{}'::JSONB,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, workspace_id, target_key),
  CHECK (length(trim(tenant_id)) > 0 AND length(trim(workspace_id)) > 0),
  CHECK ((active_digest IS NULL OR active_digest ~ '^[a-f0-9]{64}$') AND (previous_digest IS NULL OR previous_digest ~ '^[a-f0-9]{64}$') AND (canary_digest IS NULL OR canary_digest ~ '^[a-f0-9]{64}$'))
);

CREATE TABLE IF NOT EXISTS governed_promotion_effects (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  request_id TEXT NOT NULL REFERENCES governed_promotion_requests(request_id) ON DELETE RESTRICT,
  effect_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  outcome JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, workspace_id, request_id, effect_type, idempotency_key)
);

CREATE TABLE IF NOT EXISTS governed_promotion_kill_switches (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  target_key TEXT NOT NULL,
  halted BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, workspace_id, target_key),
  CHECK (length(trim(tenant_id)) > 0 AND length(trim(workspace_id)) > 0)
);

ALTER TABLE identity_tenant_memberships
  ADD CONSTRAINT identity_service_cannot_approve_governed_promotion
  CHECK (NOT ('promotion:approve' = ANY(service_scopes))) NOT VALID;
ALTER TABLE identity_tenant_memberships
  VALIDATE CONSTRAINT identity_service_cannot_approve_governed_promotion;
