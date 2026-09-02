# Gotham Studio

Gotham Studio is PlutoMix's project-scoped AI/ML execution control plane. It turns a Gotham ML objective into durable logical pipeline and job records, then submits external compute only after an authenticated operator uses Executor mode and the selected provider passes the job's policy checks.

It is an internal Builder workspace, not a second public product. Open it with the **Studio** control in the Gotham Builder header. The public landing workspace remains unchanged.

## Runtime architecture

The frontend reads only the provider-neutral `/api/gotham-studio/*` contract. The backend owns provider credentials, converts provider state into the logical lifecycle, persists provider references, and emits Studio lifecycle events into the existing Gotham activity stream.

```text
Gotham objective / Studio form
              |
              v
 logical Pipeline + Job (project/tenant scope)
              |
      Executor + policy gates
              |
              v
      MLExecutionProvider interface
          /                 \
 Databricks Jobs 2.2     Azure ML ARM Jobs
          \                 /
           normalized lifecycle
              |
     Studio UI + Gotham activity
```

Planner and Debugger mode can analyze or propose ML work. They cannot submit external compute. Gotham's natural-language ML route creates a durable pipeline and draft job in Executor mode but deliberately does not submit it; the operator must complete the provider specification and explicitly submit from Studio.

## Persistence and identity

PostgreSQL is the production authority for pipelines, jobs, experiments, models, provider checks, and lifecycle events. `database/migrations/012_gotham_studio.sql` defines the normalized tables and their tenant/workspace/project indexes; job mutations use transactions and scoped row locks. The reconciler uses scope-keyed PostgreSQL advisory leases, which are released automatically if a replica exits, to prevent duplicate cross-replica reconciliation. Run `npm --prefix apps/backend run gotham-studio:migrate` as a controlled deployment step before starting a production backend. The application refuses to use file persistence when `NODE_ENV=production`.

Local development and tests may set `GOTHAM_STUDIO_REPOSITORY=file` to use the atomic JSON repository at `database/gotham-studio/state.json`; `GOTHAM_STUDIO_STATE_PATH` relocates that development state. Set `GOTHAM_STUDIO_REPOSITORY=postgres` and `GOTHAM_STUDIO_DATABASE_URL` (or the shared `DECISION_CONTINUITY_DATABASE_URL` / `DATABASE_URL`) for PostgreSQL. Records carry tenant, workspace, and project scope internally; public API responses remove the tenant and idempotency fields. Every API route uses the existing strict identity/RBAC layer and validates that the requested workspace matches the managed project.

Logical job states are:

`DRAFT`, `QUEUED`, `SUBMITTED`, `STARTING`, `RUNNING`, `PAUSED`, `SUCCEEDED`, `FAILED`, `CANCELLING`, `CANCELLED`, and `UNKNOWN`.

Provider-native IDs, run IDs, raw states, timestamps, sanitized errors, retry lineage, and cost fields are stored separately from the logical state. Reconciliation is bounded by `GOTHAM_STUDIO_RECONCILIATION_INTERVAL_MS` and `GOTHAM_STUDIO_MAX_RECONCILIATIONS_PER_CYCLE`. Polling with no logical state change does not append another activity event.

## Codex Account & Usage

The Builder account panel starts a short-lived, read-only Codex App Server session and reads `account/read`, `account/rateLimits/read`, and `account/usage/read`. For ChatGPT-authenticated Codex sessions this can populate the account email, plan/authentication type, allowance windows, reset credits, lifetime token summary, and daily token buckets. In production, provider data is returned only when the Codex account email exactly matches the verified PlutoMix profile email; a shared backend login therefore cannot disclose account-wide usage to another profile. Development authentication has no email claim, so its production-forbidden local fallback requires the exact `PLUTOMIX_DEV_AUTH_SUBJECT` configured for the backend. No access or refresh token is read, stored, logged, or returned.

Codex does not expose a provider account ID for every authentication mode, so that field remains explicitly unavailable when absent. **Latest Gotham execution in this project** is the newest owner/project-scoped execution ledger entry, not the current browser conversation. Context-window occupancy also remains unavailable because the short-lived account session has no active Gotham thread from which to derive it. These boundaries follow the official [Codex App Server account methods](https://developers.openai.com/codex/app-server/) and keep subscription allowance separate from context occupancy.

## Provider configuration

All credentials are backend-only. Never expose these values with a `VITE_` prefix, put them in Studio forms, add them to pipeline/job parameters, or commit them.

Databricks:

```dotenv
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
DATABRICKS_TOKEN=...
DATABRICKS_AUTH_MODE=backend_token
DATABRICKS_JOBS_API_VERSION=2.2
DATABRICKS_MLFLOW_ENABLED=false
```

The adapter can submit a saved job ID with `run-now`, submit a one-time tasks specification, inspect and cancel a run, and poll run output. When `DATABRICKS_MLFLOW_ENABLED=true`, an operator may attach existing MLflow run IDs to the logical job; Studio then reads real metrics/artifacts and persists experiment projections when those metrics are retrieved. The adapter does not currently expose streaming logs, model-registry mutation, or provider cost estimates. Databricks documents Jobs API 2.2 as its current Jobs API and recommends 2.2 for clients: [Databricks Jobs API reference](https://docs.databricks.com/api/workspace/jobs).

Azure Machine Learning:

```dotenv
AZURE_ML_SUBSCRIPTION_ID=...
AZURE_ML_RESOURCE_GROUP=...
AZURE_ML_WORKSPACE_NAME=...
AZURE_ML_ACCESS_TOKEN=...
AZURE_ML_API_VERSION=2026-03-01
AZURE_ML_MANAGEMENT_ENDPOINT=https://management.azure.com
```

The adapter creates or updates an ARM job, retrieves its state, and invokes its cancel action. It currently advertises no log, metric, artifact, experiment, model-registry, or cost-estimate support, so those controls do not appear. The API version is configurable because Azure evolves this surface: [Azure ML Jobs REST reference](https://learn.microsoft.com/en-us/rest/api/azureml/jobs?view=rest-azureml-2026-03-01).

After changing credentials, restart the backend and use **Providers / Setup → Verify**. Verification records connection status and a sanitized failure; it never returns a credential.

## Execution policy

Every logical job carries these controls:

- maximum run count and runtime;
- allowed providers and compute classes;
- GPU allow/deny;
- estimated-cost ceiling and currency;
- deployment allow/deny, defaulting to deny.

Submission is rejected if the provider is outside the allowed list, a disallowed GPU/compute class is requested, a linked pipeline includes deployment while deployment is denied, or a cost ceiling cannot be verified. Neither bundled provider currently estimates cost, so any non-empty cost ceiling also requires a provider-side `budgetPolicyId` or `costControlReference`. Studio never displays invented prices.

The job-create and retry APIs require an `Idempotency-Key`. Databricks receives the logical job ID as its idempotency token; Azure uses a stable logical-job-derived resource name with an idempotent ARM `PUT`.

## API surface

All requests require `workspaceId` and `projectId`, which must identify the same authorized managed project.

- `GET /api/gotham-studio/overview`
- `GET /api/gotham-studio/providers`
- `POST /api/gotham-studio/providers/:provider/verify`
- `GET|POST /api/gotham-studio/jobs`
- `GET /api/gotham-studio/jobs/:id`
- `POST /api/gotham-studio/jobs/:id/submit|refresh|cancel|retry`
- `GET /api/gotham-studio/jobs/:id/logs|metrics|artifacts`
- `GET|POST /api/gotham-studio/pipelines`
- `GET /api/gotham-studio/pipelines/:id`
- `GET /api/gotham-studio/experiments`
- `GET /api/gotham-studio/models`

Errors use a stable code, sanitized message, retryability flag, and appropriate HTTP status. A job outside the caller's scope returns the same not-found shape as an absent job.

## Operational boundaries

- No provider job runs until an authenticated operator explicitly submits a complete job in Executor mode.
- No automatic model deployment is implemented.
- Secrets found in parameters or provider configuration are rejected before persistence.
- Provider errors and returned payloads are sanitized before storage or response.
- Background reconciliation is concurrency-bounded and skips duplicate lifecycle events.
- Provider calls emit `studio.provider.request` with operation latency and outcome; failures also emit `studio.provider.failure`, and each active poll emits `studio.job.reconcile` without fabricating a lifecycle transition.
- The Studio frontend polls only while a project has active jobs; the backend remains authoritative.
- Models remain empty until a future adapter exposes real model-registry evidence. The UI labels that absence directly.

Useful validation commands:

```bash
cd apps/backend && node --test --test-concurrency=1 test/gothamStudio.test.js test/databricksProvider.test.js test/azureMlProvider.test.js
cd apps/frontend && node --test test/gotham-studio.test.mjs test/studio-access.test.mjs
cd apps/frontend && npm run build
```
