-- Step 7: Suggested Next Instruction and Intel capability proposals remain
-- scoped entities in the existing Decision Continuity authority.
ALTER TABLE decision_continuity_current_state
  DROP CONSTRAINT IF EXISTS decision_continuity_current_state_entity_type_check;
ALTER TABLE decision_continuity_current_state
  ADD CONSTRAINT decision_continuity_current_state_entity_type_check
  CHECK (entity_type IN (
    'branch', 'observation', 'reconsideration', 'approval', 'canary', 'condition_event', 'qagent_run', 'qagent_effect',
    'brainx_registration', 'brainx_policy', 'brainx_route', 'brainx_execution', 'brainx_effect', 'brainx_control', 'brainx_circuit_breaker',
    'governed_suggestion', 'intel_capability_proposal'
  )) NOT VALID;
ALTER TABLE decision_continuity_current_state VALIDATE CONSTRAINT decision_continuity_current_state_entity_type_check;
CREATE INDEX IF NOT EXISTS decision_continuity_suggestion_trigger_idx ON decision_continuity_current_state (tenant_id, workspace_id, (record->>'triggeringEventId'), updated_at DESC) WHERE entity_type = 'governed_suggestion';
CREATE INDEX IF NOT EXISTS decision_continuity_intel_reuse_idx ON decision_continuity_current_state (tenant_id, workspace_id, (record #>> '{reuseDecision,decision}'), updated_at DESC) WHERE entity_type = 'intel_capability_proposal';
ALTER TABLE identity_tenant_memberships ADD CONSTRAINT identity_suggestion_admin_human_only CHECK (NOT ('suggestion:admin' = ANY(service_scopes))) NOT VALID;
ALTER TABLE identity_tenant_memberships VALIDATE CONSTRAINT identity_suggestion_admin_human_only;
