-- Enterprise BrainX records extend the existing Decision Continuity authority.
-- They are append-only/current-state projections, never a second source of
-- truth and never an authorization bypass for legacy portfolio artifacts.
ALTER TABLE decision_continuity_current_state
  DROP CONSTRAINT IF EXISTS decision_continuity_current_state_entity_type_check;
ALTER TABLE decision_continuity_current_state
  ADD CONSTRAINT decision_continuity_current_state_entity_type_check
  CHECK (entity_type IN (
    'branch', 'observation', 'reconsideration', 'approval', 'canary', 'condition_event', 'qagent_run', 'qagent_effect',
    'brainx_registration', 'brainx_policy', 'brainx_route', 'brainx_execution', 'brainx_effect', 'brainx_control', 'brainx_circuit_breaker',
    'governed_suggestion', 'intel_capability_proposal',
    'enterprise_governance_binding', 'enterprise_governance_policy', 'enterprise_governance_budget',
    'enterprise_governance_reservation', 'enterprise_governance_decision_context',
    'enterprise_governance_knowledge_receipt', 'enterprise_governance_idempotency',
    'researchx_source', 'researchx_run', 'researchx_effect', 'agenticx_knowledge', 'agenticx_reuse_receipt'
  )) NOT VALID;
ALTER TABLE decision_continuity_current_state
  VALIDATE CONSTRAINT decision_continuity_current_state_entity_type_check;

CREATE INDEX IF NOT EXISTS decision_continuity_enterprise_binding_application_idx
  ON decision_continuity_current_state (tenant_id, workspace_id, (record->>'applicationId'), updated_at DESC)
  WHERE entity_type = 'enterprise_governance_binding';
CREATE INDEX IF NOT EXISTS decision_continuity_enterprise_policy_scope_idx
  ON decision_continuity_current_state (tenant_id, workspace_id, (record->>'enterpriseId'), updated_at DESC)
  WHERE entity_type = 'enterprise_governance_policy';
CREATE INDEX IF NOT EXISTS decision_continuity_enterprise_budget_scope_idx
  ON decision_continuity_current_state (tenant_id, workspace_id, (record->>'enterpriseId'), (record->>'applicationId'), updated_at DESC)
  WHERE entity_type = 'enterprise_governance_budget';
CREATE INDEX IF NOT EXISTS decision_continuity_enterprise_reservation_budget_idx
  ON decision_continuity_current_state (tenant_id, workspace_id, (record->>'budgetId'), updated_at DESC)
  WHERE entity_type = 'enterprise_governance_reservation';
CREATE INDEX IF NOT EXISTS decision_continuity_enterprise_context_branch_idx
  ON decision_continuity_current_state (tenant_id, workspace_id, (record->>'branchId'), updated_at DESC)
  WHERE entity_type = 'enterprise_governance_decision_context';
CREATE INDEX IF NOT EXISTS decision_continuity_researchx_source_due_idx
  ON decision_continuity_current_state (tenant_id, workspace_id, (record->>'enabled'), updated_at DESC)
  WHERE entity_type = 'researchx_source';
CREATE INDEX IF NOT EXISTS decision_continuity_enterprise_knowledge_receipt_target_idx
  ON decision_continuity_current_state (tenant_id, workspace_id, (record->>'targetApplicationId'), updated_at DESC)
  WHERE entity_type = 'enterprise_governance_knowledge_receipt';
CREATE INDEX IF NOT EXISTS decision_continuity_agenticx_knowledge_scope_idx
  ON decision_continuity_current_state (tenant_id, workspace_id, (record->>'classification'), updated_at DESC)
  WHERE entity_type = 'agenticx_knowledge';
CREATE INDEX IF NOT EXISTS decision_continuity_agenticx_receipt_request_idx
  ON decision_continuity_current_state (tenant_id, workspace_id, (record->>'requestDigest'), updated_at DESC)
  WHERE entity_type = 'agenticx_reuse_receipt';
