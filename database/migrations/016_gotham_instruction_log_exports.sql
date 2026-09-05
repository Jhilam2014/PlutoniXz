-- Immutable, tenant/project-scoped Gotham instruction log exports. The exact
-- redacted text downloaded by the user is retained with its digest so a later
-- download is identical to the originally generated export.
CREATE TABLE IF NOT EXISTS gotham_instruction_log_exports (
  export_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  instruction_sequence_id TEXT NOT NULL,
  enterprise_name TEXT NOT NULL,
  project_name TEXT NOT NULL,
  provider_id TEXT,
  provider_profile_id TEXT,
  provider_accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
  filename TEXT NOT NULL,
  content_text TEXT NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  content_bytes INTEGER NOT NULL CHECK (content_bytes >= 0 AND content_bytes <= 4194304),
  source_event_count INTEGER NOT NULL DEFAULT 0 CHECK (source_event_count >= 0),
  truncated BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_principal_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, workspace_id, project_id, filename)
);

CREATE INDEX IF NOT EXISTS gotham_instruction_log_exports_scope_sequence_idx
  ON gotham_instruction_log_exports (tenant_id, workspace_id, project_id, instruction_sequence_id, created_at DESC);
