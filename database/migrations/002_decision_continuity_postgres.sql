-- Authoritative Decision Continuity ledger. Apply with a deployment role before
-- starting a production backend. All tenant/workspace identities are explicit.

CREATE TABLE IF NOT EXISTS decision_continuity_current_state (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('branch', 'observation', 'reconsideration', 'approval', 'canary', 'condition_event')),
  entity_id TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK (revision >= 1),
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, workspace_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS decision_continuity_current_state_tenant_workspace_idx
  ON decision_continuity_current_state (tenant_id, workspace_id, entity_type, updated_at DESC);
CREATE INDEX IF NOT EXISTS decision_continuity_branch_decision_idx
  ON decision_continuity_current_state (tenant_id, workspace_id, (record->>'decisionId')) WHERE entity_type = 'branch';

CREATE TABLE IF NOT EXISTS decision_continuity_events (
  sequence_no BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version BIGINT NOT NULL DEFAULT 0,
  event_type TEXT NOT NULL,
  actor JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id TEXT,
  payload JSONB NOT NULL,
  previous_hash TEXT,
  event_hash TEXT NOT NULL UNIQUE,
  event_record JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, workspace_id, aggregate_id, aggregate_version, event_id)
);
CREATE INDEX IF NOT EXISTS decision_continuity_events_scope_sequence_idx
  ON decision_continuity_events (tenant_id, workspace_id, sequence_no DESC);
CREATE INDEX IF NOT EXISTS decision_continuity_events_aggregate_idx
  ON decision_continuity_events (tenant_id, workspace_id, aggregate_id, sequence_no DESC);

CREATE TABLE IF NOT EXISTS decision_continuity_idempotency (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS decision_continuity_outbox (
  outbox_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE REFERENCES decision_continuity_events(event_id),
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version BIGINT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL,
  checkpoint_version INTEGER NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS decision_continuity_outbox_pending_idx
  ON decision_continuity_outbox (created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS decision_continuity_projection_checkpoints (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  projection_name TEXT NOT NULL,
  projection_version INTEGER NOT NULL,
  last_sequence_no BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, workspace_id, projection_name, projection_version)
);

CREATE TABLE IF NOT EXISTS decision_continuity_import_runs (
  import_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_checksum TEXT NOT NULL UNIQUE,
  imported_counts JSONB NOT NULL,
  rollback_plan TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Event history is append-only even for application roles with update/delete.
CREATE OR REPLACE FUNCTION decision_continuity_forbid_event_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'decision_continuity_events is append-only';
END;
$$;
DROP TRIGGER IF EXISTS decision_continuity_events_immutable ON decision_continuity_events;
CREATE TRIGGER decision_continuity_events_immutable
  BEFORE UPDATE OR DELETE ON decision_continuity_events
  FOR EACH ROW EXECUTE FUNCTION decision_continuity_forbid_event_mutation();
