-- Safe metadata for Gotham Chat AI CLI provider profiles. Provider secrets and
-- raw credential locations are deliberately absent. credential_ref is an
-- opaque reference to a provider-owned isolated runtime/keychain entry.
CREATE TABLE IF NOT EXISTS ai_provider_profiles (
  profile_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('codex','claude','copilot','cursor','emergent')),
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 80),
  account_label TEXT,
  account_fingerprint TEXT,
  organization_label TEXT,
  auth_method TEXT NOT NULL CHECK (auth_method IN ('browser_oauth','device_code','api_token','existing_session','enterprise_login','unsupported')),
  credential_ref TEXT NOT NULL CHECK (credential_ref ~ '^provider-runtime://(codex|claude|copilot|cursor|emergent)/[a-zA-Z0-9._-]+$'),
  runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('isolated','existing_session')),
  status TEXT NOT NULL CHECK (status IN ('connected','expired','invalid','disconnected')),
  last_verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  last_login_succeeded BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, principal_id, provider_id, profile_id)
);

CREATE INDEX IF NOT EXISTS ai_provider_profiles_scope_idx
  ON ai_provider_profiles (tenant_id, principal_id, provider_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_provider_activations (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('codex','claude','copilot','cursor','emergent')),
  workspace_id TEXT NOT NULL DEFAULT '*',
  profile_id TEXT NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, principal_id, provider_id, workspace_id),
  FOREIGN KEY (tenant_id, principal_id, provider_id, profile_id)
    REFERENCES ai_provider_profiles (tenant_id, principal_id, provider_id, profile_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_provider_audit_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '*',
  provider_id TEXT NOT NULL CHECK (provider_id IN ('codex','claude','copilot','cursor','emergent')),
  profile_id TEXT,
  event_type TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('succeeded','failed','cancelled')),
  failure_category TEXT,
  account_fingerprint TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT (metadata::text ~* '(access.?token|refresh.?token|authorization|api.?key|device.?code|credential|cookie|stdout|stderr|https?://)'))
);

CREATE INDEX IF NOT EXISTS ai_provider_audit_scope_time_idx
  ON ai_provider_audit_events (tenant_id, principal_id, created_at DESC);
