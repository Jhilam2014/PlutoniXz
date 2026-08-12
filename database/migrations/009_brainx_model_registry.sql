-- Step 6: BrainX registry/routing/execution records are scoped entities in the
-- existing authoritative Decision Continuity ledger. This is an expand-only
-- migration; BrainX does not create an independent control-plane store.
ALTER TABLE decision_continuity_current_state
  DROP CONSTRAINT IF EXISTS decision_continuity_current_state_entity_type_check;
ALTER TABLE decision_continuity_current_state
  ADD CONSTRAINT decision_continuity_current_state_entity_type_check
  CHECK (entity_type IN (
    'branch', 'observation', 'reconsideration', 'approval', 'canary', 'condition_event', 'qagent_run', 'qagent_effect',
    'brainx_registration', 'brainx_policy', 'brainx_route', 'brainx_execution', 'brainx_effect', 'brainx_control', 'brainx_circuit_breaker'
  )) NOT VALID;
ALTER TABLE decision_continuity_current_state
  VALIDATE CONSTRAINT decision_continuity_current_state_entity_type_check;

CREATE INDEX IF NOT EXISTS decision_continuity_brainx_registration_lookup_idx
  ON decision_continuity_current_state (tenant_id, workspace_id, (record->>'registrationKey'), updated_at DESC)
  WHERE entity_type = 'brainx_registration';
CREATE INDEX IF NOT EXISTS decision_continuity_brainx_route_lookup_idx
  ON decision_continuity_current_state (tenant_id, workspace_id, (record->>'taskRole'), updated_at DESC)
  WHERE entity_type = 'brainx_route';
CREATE INDEX IF NOT EXISTS decision_continuity_brainx_execution_route_idx
  ON decision_continuity_current_state (tenant_id, workspace_id, (record->>'routeId'), updated_at DESC)
  WHERE entity_type = 'brainx_execution';

-- BrainX execution is allowed only to a separately provisioned service scope.
-- It cannot share final lifecycle/promotion authority, and administrative
-- registry controls are human-only in both schema and application policy.
ALTER TABLE identity_tenant_memberships
  ADD CONSTRAINT identity_brainx_no_final_lifecycle_authority
  CHECK (NOT ('brainx:execute' = ANY(service_scopes) AND (
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
  VALIDATE CONSTRAINT identity_brainx_no_final_lifecycle_authority;
ALTER TABLE identity_tenant_memberships
  ADD CONSTRAINT identity_brainx_admin_human_only
  CHECK (NOT ('brainx:admin' = ANY(service_scopes))) NOT VALID;
ALTER TABLE identity_tenant_memberships
  VALIDATE CONSTRAINT identity_brainx_admin_human_only;
