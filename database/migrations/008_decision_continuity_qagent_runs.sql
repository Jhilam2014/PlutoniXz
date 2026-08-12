-- Step 5: QAgent evidence-planning records live in the existing authoritative
-- Decision Continuity ledger. They are not a second workflow or truth source.
-- The entity check is expanded additively so old readers continue to ignore
-- these entities while Step 5-aware readers can rebuild them from events.
ALTER TABLE decision_continuity_current_state
  DROP CONSTRAINT IF EXISTS decision_continuity_current_state_entity_type_check;
ALTER TABLE decision_continuity_current_state
  ADD CONSTRAINT decision_continuity_current_state_entity_type_check
  CHECK (entity_type IN ('branch', 'observation', 'reconsideration', 'approval', 'canary', 'condition_event', 'qagent_run', 'qagent_effect')) NOT VALID;
ALTER TABLE decision_continuity_current_state
  VALIDATE CONSTRAINT decision_continuity_current_state_entity_type_check;

-- One retained QAgent run can be related to semantically duplicate proposals
-- through its immutable record. This index makes tenant-scoped evidence-gap
-- lookup bounded without using a cross-tenant semantic store as authority.
CREATE INDEX IF NOT EXISTS decision_continuity_qagent_run_dedupe_idx
  ON decision_continuity_current_state
  (tenant_id, workspace_id, (record #>> '{deduplication,evidenceGap}'), updated_at DESC)
  WHERE entity_type = 'qagent_run';

CREATE INDEX IF NOT EXISTS decision_continuity_qagent_run_reconsideration_idx
  ON decision_continuity_current_state
  (tenant_id, workspace_id, (record->>'reconsiderationId'), updated_at DESC)
  WHERE entity_type = 'qagent_run';

-- A qagent_effect is an idempotency claim for a registered read-only evidence
-- collector. A pending claim is recovered or stopped; it is never blindly
-- replayed after a worker/process restart.
CREATE INDEX IF NOT EXISTS decision_continuity_qagent_effect_run_idx
  ON decision_continuity_current_state
  (tenant_id, workspace_id, (record->>'runId'), updated_at DESC)
  WHERE entity_type = 'qagent_effect';

ALTER TABLE identity_tenant_memberships
  ADD CONSTRAINT identity_qagent_no_lifecycle_authority
  CHECK (NOT ('qagent:investigate' = ANY(service_scopes) AND (
    'decision:approve' = ANY(service_scopes) OR
    'decision:evaluate' = ANY(service_scopes) OR
    'decision:policy' = ANY(service_scopes) OR
    'decision:canary' = ANY(service_scopes) OR
    'promotion:approve' = ANY(service_scopes) OR
    'promotion:evaluate' = ANY(service_scopes) OR
    'promotion:policy' = ANY(service_scopes) OR
    'promotion:operate' = ANY(service_scopes)
  ))) NOT VALID;
ALTER TABLE identity_tenant_memberships
  VALIDATE CONSTRAINT identity_qagent_no_lifecycle_authority;
