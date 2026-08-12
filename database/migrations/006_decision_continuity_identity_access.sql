-- Step 3 identity and authorization authority. External OIDC subjects are
-- mapped to internal principals and tenant/workspace memberships; token claims
-- never grant tenant access on their own.
CREATE TABLE IF NOT EXISTS identity_principals (
  principal_id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('human', 'service')),
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (issuer, subject),
  CHECK (length(trim(principal_id)) > 0),
  CHECK (length(trim(issuer)) > 0),
  CHECK (length(trim(subject)) > 0)
);

CREATE TABLE IF NOT EXISTS identity_tenant_memberships (
  principal_id TEXT NOT NULL REFERENCES identity_principals(principal_id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '*',
  roles TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  service_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (principal_id, tenant_id, workspace_id),
  CHECK (length(trim(tenant_id)) > 0),
  CHECK (length(trim(workspace_id)) > 0),
  CHECK (NOT ('decision:approve' = ANY(service_scopes)))
);
CREATE INDEX IF NOT EXISTS identity_tenant_memberships_lookup_idx
  ON identity_tenant_memberships (tenant_id, principal_id, status);

CREATE TABLE IF NOT EXISTS identity_access_audit (
  audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  principal_id TEXT REFERENCES identity_principals(principal_id) ON DELETE SET NULL,
  tenant_id TEXT,
  workspace_id TEXT,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  code TEXT NOT NULL,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (length(trim(action)) > 0),
  CHECK (length(trim(code)) > 0)
);
CREATE INDEX IF NOT EXISTS identity_access_audit_tenant_created_idx
  ON identity_access_audit (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS identity_access_audit_principal_created_idx
  ON identity_access_audit (principal_id, created_at DESC);

-- The application uses SET LOCAL inside an explicit transaction. The setting
-- is therefore cleared before a pooled connection is returned, preventing a
-- tenant context from leaking to a subsequent request. Existing tables retain
-- their application-level authorization and tenant composite keys; a future
-- non-owner application DB role can adopt this setting in RLS policies without
-- changing the durable record schema.
CREATE OR REPLACE FUNCTION decision_continuity_current_tenant()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '') $$;

ALTER TABLE decision_continuity_current_state
  ADD CONSTRAINT decision_continuity_current_state_tenant_workspace_nonempty
  CHECK (length(trim(tenant_id)) > 0 AND length(trim(workspace_id)) > 0) NOT VALID;
ALTER TABLE decision_continuity_events
  ADD CONSTRAINT decision_continuity_events_tenant_workspace_nonempty
  CHECK (length(trim(tenant_id)) > 0 AND length(trim(workspace_id)) > 0) NOT VALID;
ALTER TABLE decision_continuity_outbox
  ADD CONSTRAINT decision_continuity_outbox_tenant_workspace_nonempty
  CHECK (length(trim(tenant_id)) > 0 AND length(trim(workspace_id)) > 0) NOT VALID;
ALTER TABLE decision_continuity_workflow_jobs
  ADD CONSTRAINT decision_continuity_workflow_jobs_tenant_workspace_nonempty
  CHECK (length(trim(tenant_id)) > 0 AND length(trim(workspace_id)) > 0) NOT VALID;
ALTER TABLE decision_continuity_workflow_inbox
  ADD CONSTRAINT decision_continuity_workflow_inbox_tenant_workspace_nonempty
  CHECK (length(trim(tenant_id)) > 0 AND length(trim(workspace_id)) > 0) NOT VALID;

ALTER TABLE decision_continuity_current_state VALIDATE CONSTRAINT decision_continuity_current_state_tenant_workspace_nonempty;
ALTER TABLE decision_continuity_events VALIDATE CONSTRAINT decision_continuity_events_tenant_workspace_nonempty;
ALTER TABLE decision_continuity_outbox VALIDATE CONSTRAINT decision_continuity_outbox_tenant_workspace_nonempty;
ALTER TABLE decision_continuity_workflow_jobs VALIDATE CONSTRAINT decision_continuity_workflow_jobs_tenant_workspace_nonempty;
ALTER TABLE decision_continuity_workflow_inbox VALIDATE CONSTRAINT decision_continuity_workflow_inbox_tenant_workspace_nonempty;
