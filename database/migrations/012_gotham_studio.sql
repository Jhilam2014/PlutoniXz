-- PostgreSQL persistence for production Gotham Studio deployments. Local
-- development may explicitly use the atomic file repository as a fallback.
CREATE TABLE IF NOT EXISTS gotham_studio_pipelines (
  pipeline_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  functionality_id TEXT,
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  objective TEXT NOT NULL,
  provider_preference TEXT,
  stages JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  record JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, workspace_id, project_id, name, version)
);

CREATE TABLE IF NOT EXISTS gotham_studio_jobs (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  pipeline_id TEXT REFERENCES gotham_studio_pipelines(pipeline_id),
  functionality_id TEXT,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_job_id TEXT,
  provider_run_id TEXT,
  logical_state TEXT NOT NULL CHECK (logical_state IN ('DRAFT','QUEUED','SUBMITTED','STARTING','RUNNING','PAUSED','SUCCEEDED','FAILED','CANCELLING','CANCELLED','UNKNOWN')),
  provider_state TEXT,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  constraints JSONB NOT NULL,
  estimated_cost NUMERIC,
  actual_cost NUMERIC,
  cost_currency CHAR(3),
  error JSONB,
  retry JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT,
  record JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  submitted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, workspace_id, project_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS gotham_studio_jobs_scope_state_idx
  ON gotham_studio_jobs (tenant_id, workspace_id, project_id, logical_state, updated_at DESC);

CREATE TABLE IF NOT EXISTS gotham_studio_experiments (
  experiment_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  pipeline_id TEXT REFERENCES gotham_studio_pipelines(pipeline_id),
  job_id TEXT REFERENCES gotham_studio_jobs(job_id),
  provider TEXT NOT NULL,
  provider_run_id TEXT NOT NULL,
  name TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  primary_metric JSONB,
  status TEXT NOT NULL DEFAULT 'recorded',
  is_best BOOLEAN NOT NULL DEFAULT FALSE,
  record JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, workspace_id, project_id, provider, provider_run_id)
);

CREATE TABLE IF NOT EXISTS gotham_studio_models (
  model_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  pipeline_id TEXT REFERENCES gotham_studio_pipelines(pipeline_id),
  job_id TEXT REFERENCES gotham_studio_jobs(job_id),
  experiment_id TEXT REFERENCES gotham_studio_experiments(experiment_id),
  provider TEXT NOT NULL,
  provider_model_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  stage TEXT NOT NULL DEFAULT 'Unassigned',
  metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_best BOOLEAN NOT NULL DEFAULT FALSE,
  record JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, workspace_id, project_id, provider, provider_model_id, version)
);

CREATE TABLE IF NOT EXISTS gotham_studio_provider_checks (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  status TEXT NOT NULL,
  connected BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error JSONB,
  record JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, workspace_id, project_id, provider_id)
);

CREATE TABLE IF NOT EXISTS gotham_studio_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  job_id TEXT REFERENCES gotham_studio_jobs(job_id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
