-- Authoritative tenant, enterprise, team, application, and platform-admin
-- records. Project files remain in the project registry, while these tables
-- own the access boundary and portfolio relationship.
CREATE TABLE IF NOT EXISTS tenant_instances (
  tenant_id TEXT PRIMARY KEY,
  instance_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (length(trim(tenant_id)) BETWEEN 1 AND 160),
  CHECK (instance_key ~ '^tenant-[a-f0-9]{16}$')
);

CREATE TABLE IF NOT EXISTS tenant_enterprises (
  tenant_id TEXT NOT NULL REFERENCES tenant_instances(tenant_id) ON DELETE CASCADE,
  enterprise_id TEXT NOT NULL,
  label TEXT NOT NULL,
  label_key TEXT NOT NULL,
  created_by_principal_id TEXT REFERENCES identity_principals(principal_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, enterprise_id),
  UNIQUE (tenant_id, label_key),
  CHECK (enterprise_id ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  CHECK (length(trim(label)) BETWEEN 2 AND 80),
  CHECK (length(trim(label_key)) BETWEEN 2 AND 80)
);

CREATE OR REPLACE FUNCTION tenant_enterprise_limit_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id, 1402));
  IF (SELECT count(*) FROM tenant_enterprises WHERE tenant_id = NEW.tenant_id) >= 2 THEN
    RAISE EXCEPTION 'tenant enterprise limit reached' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenant_enterprise_limit_guard_trigger ON tenant_enterprises;
CREATE TRIGGER tenant_enterprise_limit_guard_trigger
BEFORE INSERT ON tenant_enterprises
FOR EACH ROW EXECUTE FUNCTION tenant_enterprise_limit_guard();

CREATE TABLE IF NOT EXISTS tenant_applications (
  tenant_id TEXT NOT NULL,
  enterprise_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  application_name TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  agent_source TEXT NOT NULL CHECK (agent_source IN ('global_community', 'enterprise')),
  owner_principal_id TEXT REFERENCES identity_principals(principal_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, application_id),
  FOREIGN KEY (tenant_id, enterprise_id) REFERENCES tenant_enterprises(tenant_id, enterprise_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id) REFERENCES tenant_instances(tenant_id) ON DELETE CASCADE,
  CHECK (length(trim(application_id)) BETWEEN 1 AND 180),
  CHECK (length(trim(application_name)) BETWEEN 2 AND 160)
);
CREATE INDEX IF NOT EXISTS tenant_applications_enterprise_idx
  ON tenant_applications (tenant_id, enterprise_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_team_invitations (
  invitation_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_instances(tenant_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  email_key TEXT NOT NULL,
  roles TEXT[] NOT NULL DEFAULT ARRAY['team_member']::TEXT[],
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by_principal_id TEXT NOT NULL REFERENCES identity_principals(principal_id) ON DELETE RESTRICT,
  accepted_by_principal_id TEXT REFERENCES identity_principals(principal_id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, email_key),
  CHECK (length(trim(email)) BETWEEN 3 AND 254),
  CHECK (email_key = lower(trim(email)))
);
CREATE INDEX IF NOT EXISTS tenant_team_invitations_tenant_status_idx
  ON tenant_team_invitations (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_admin_identities (
  email_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (email_key = lower(trim(email_key))),
  CHECK (length(email_key) BETWEEN 3 AND 254)
);

INSERT INTO platform_admin_identities (email_key, display_name)
VALUES ('jhilam.astro@gmail.com', 'Jhilam Astro')
ON CONFLICT (email_key) DO UPDATE SET status = 'active', updated_at = clock_timestamp();
