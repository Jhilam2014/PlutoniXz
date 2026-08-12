# Decision Continuity durable workflows

PostgreSQL is the production authority for Decision Continuity. The file adapter is only for local development/tests and is rejected in production. A durable submission commits the job, audit row, `workflow.accepted` ledger event, and outbox intent in one database transaction; no API response relies on an in-process callback.

Identity, membership authority, OIDC validation, role/service-scope matrix, and browser-token handling are defined in [Decision Continuity identity and authorization](decision-continuity-identity-security.md). No lifecycle route is public.

## Lifecycle coverage matrix

The executable source is [the lifecycle registry](../apps/backend/src/decisionContinuityLifecycleRegistry.js), which the backend checks during startup and the unit suite checks for test linkage. Inventory: 19 implemented entry points — 10 read-only, 8 durable asynchronous, 1 transactionally synchronous, 0 reserved-for-later, and 0 unclassified exclusions. The additional read-only QAgent-run endpoint is tenant-scoped operator visibility; it cannot execute a QAgent, collect evidence, or mutate lifecycle state.

| Entry point | Method/path | Kind/trust | Tenant + idempotency | Transaction/job | Retry, terminal, audit | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| Workflow queue list | GET `/workflows/status` | Read / `workflow:read` | Human membership tenant | Tenant-filtered read | N/A | registry inventory |
| Workflow job status | GET `/workflows/:jobId` | Read / `workflow:read` | Human membership tenant | Tenant-filtered read | N/A | registry inventory |
| Redrive | POST `/workflows/:jobId/redrive` | Transactional / `workflow:redrive` | Human membership tenant; `Idempotency-Key` | Redrive audit + pending state | Bounded redrive; audit `redriven` | workflow controls |
| Ledger readiness | GET `/readiness` | Read / `decision:readiness` | Scoped service membership tenant | PostgreSQL health read | N/A | registry inventory |
| Branch list | GET `/branches` | Read / `decision:read` | Human membership tenant | Tenant-filtered state read | N/A | registry inventory |
| Branch create | POST `/branches` | Durable / `decision:propose` | Human membership tenant; required `Idempotency-Key` | `branch_create` | Permanent validation failures DLQ; `workflow.accepted`, `completed` | lifecycle handlers |
| Graph | GET `/graph` | Read / `decision:read` | Human membership tenant | Derived tenant state read | N/A | registry inventory |
| Branch detail | GET `/branches/:branchId` | Read / `decision:read` | Human membership tenant | Tenant-filtered state read | N/A | registry inventory |
| Branch events | GET `/branches/:branchId/events` | Read / `decision:read` | Human membership tenant | Tenant-filtered ledger read | N/A | registry inventory |
| Branch compare | GET `/branches/:branchId/compare/:otherBranchId` | Read / `decision:read` | Human membership tenant | Tenant-filtered state read | N/A | registry inventory |
| Disposition | POST `/branches/:branchId/disposition` | Durable / `decision:operate` | Human membership tenant; branch/revision/status key | `disposition` | Invalid state/revision DLQ; audit | lifecycle handlers |
| Condition event | POST `/condition-events` | Durable / `decision:condition_ingest` | Scoped service membership tenant; event ID | `condition_event` + inbox | Transient retry; validation DLQ; audit | workflow handlers/crash recovery |
| Reconsideration list | GET `/reconsiderations` | Read / `decision:read` | Human membership tenant | Tenant-filtered state read | N/A | registry inventory |
| Evaluation | POST `/reconsiderations/:id/evaluation` | Durable / `decision:evaluate` | Independent human evaluator or scoped service membership tenant | `evaluation` | Validation/independence DLQ; audit | lifecycle handlers |
| Policy | POST `/reconsiderations/:id/policy` | Durable / `decision:policy` | Scoped service membership tenant | `policy` | Policy state failure DLQ; audit | lifecycle handlers |
| Approval | POST `/reconsiderations/:id/approval` | Durable / `decision:approve` | Human membership tenant | `approval` | Authorization/state failure DLQ; audit | lifecycle handlers |
| Canary start | POST `/reconsiderations/:id/canary` | Durable / `decision:canary` | Human membership tenant | `canary_start` | Validation/state failure DLQ; audit | lifecycle handlers |
| Canary outcome | POST `/canaries/:id/outcome` | Durable / `decision:condition_ingest` | Scoped service membership tenant | `canary_outcome` | Validation/state failure DLQ; audit | lifecycle handlers |

All asynchronous routes return `202` with a stable `job.jobId`; a duplicate key returns the same job ID and `200`. Read status through `GET /api/decision-continuity/workflows/:jobId`, which always scopes by tenant. The P0 canary remains an audit-only record: it creates no traffic or deployment effect, so traffic management is explicitly reserved for a later deployment-control step, not excluded from durable lifecycle handling.

## States, idempotency, and lease fencing

Job states are `pending → leased → completed`, `pending/leased → retry → leased`, and `leased/retry → dead`; `cancelled` is terminal and reserved for explicit future cancellation. A lease carries `(job_id, lease_owner, lease_epoch, leased_until)`. Claim increments the epoch, and heartbeat, completion, failure, or effect acknowledgement require every fence field plus an unexpired lease. Expired leases become `retry`; stale workers cannot acknowledge a terminal effect after transfer.

Uniqueness is PostgreSQL-enforced on `(tenant_id, workspace_id, idempotency_key)`. The workflow inbox is keyed by `(consumer_name, job_id)` and is written in the same transaction as domain state/outbox and terminal acknowledgement. Redrives are keyed by job/action/idempotency key, preserve original failure/audit records, are limited by both the persisted per-job maximum and `DECISION_CONTINUITY_WORKER_MAX_REDRIVES`, and re-enter normal admission/concurrency checks.

Permanent validation, authorization, policy, invariant, and revision failures dead-letter immediately. Transient failures retry with bounded exponential backoff (250 ms to 30 s) until `DECISION_CONTINUITY_WORKER_MAX_ATTEMPTS`; then they dead-letter. The worker never retries a permanent failure silently.

## Budget, fairness, and observability

| Variable | Default | Valid range | Meaning |
| --- | ---: | ---: | --- |
| `DECISION_CONTINUITY_WORKER_CONCURRENCY` | 8 | 1–256 | Global database-leased work cap across workers |
| `DECISION_CONTINUITY_WORKER_TENANT_CONCURRENCY` | 2 | 1–64 | Concurrent leases per tenant |
| `DECISION_CONTINUITY_WORKER_TENANT_QUEUE_LIMIT` | 100 | 1–100000 | Active (`pending`/`retry`/`leased`) work per tenant/workspace |
| `DECISION_CONTINUITY_WORKER_LEASE_MS` | 30000 | 10–300000 | Lease/heartbeat duration; production should retain the 30 s default or longer |
| `DECISION_CONTINUITY_WORKER_MAX_ATTEMPTS` | 5 | 1–25 | Total attempts before DLQ |
| `DECISION_CONTINUITY_WORKER_MAX_REDRIVES` | 2 | 0–10 | Maximum audited redrives |
| `DECISION_CONTINUITY_WORKER_SHUTDOWN_GRACE_MS` | 20000 | 100–300000 | Drain grace before release/fencing |

Admission and claiming occur under PostgreSQL transactions and advisory locks. Claim ordering chooses the tenant with the fewest active leases before priority/creation order, preventing a noisy tenant from indefinitely starving a quiet tenant. Retries and redrives use the same limits. Duplicate requests resolve before admission accounting.

Structured worker events include `workflow_admitted`, `workflow_duplicate`, `workflow_claimed`, `workflow_completed`, `workflow_retried`, `workflow_dead_lettered`, `workflow_redriven`, `worker_draining`, and `shutdown_grace_expired`; tenant IDs are SHA-256 tags, not raw log dimensions. Tenant-scoped status returns safe counters for queued (`pending`), admitted/running (`leased`), retried, completed, dead-lettered, and redriven audit records. Alert on readiness unavailable, lease expiry growth, queue-limit rejects, DLQ growth, missing fresh worker heartbeat, or continuous retry/backlog growth.

## Worker health and shutdown

The separate worker handles `SIGTERM` and `SIGINT`. It immediately becomes draining/not-ready, clears claim/heartbeat timers, records a stopping heartbeat, waits for owned work during the configured grace period, then releases still-owned leases and fences them from terminal acknowledgement. Repeated signals are idempotent. Docker grants a 30 s stop grace period by default; an external forced kill after that is safe because the PostgreSQL transaction rolls back and the lease is recoverable.

`/healthz` reports process liveness. `/readyz` is only `200` when PostgreSQL is reachable and the worker is not draining. The Compose worker has its own restart policy, resource limits, healthcheck, and `stop_grace_period`.

## Local PostgreSQL validation

Use the local database profile, then run migrations and the suite inside the backend image if Node is not installed on the host:

```sh
docker compose --profile decision-continuity-postgres up -d decision-continuity-db
DECISION_CONTINUITY_DATABASE_URL='postgres://plutonix@localhost:5433/plutonix_decision_continuity' npm --prefix apps/backend run decision-continuity:migrate
DECISION_CONTINUITY_TEST_DATABASE_URL='postgres://…' npm --prefix apps/backend run test:integration
npm --prefix apps/backend test
docker compose config
git diff --check
```

The default integration workload is deterministic and bounded: 2 tenants, 11 unique jobs, 3 workers, global concurrency 2, per-tenant concurrency 1, and 12 duplicate submissions. It asserts admission, global/per-tenant limits, quiet-tenant progress, duplicate safety, lease recovery/stale-owner fencing, retry/DLQ/redrive bounds, database outage fail-closed behavior, and tenant isolation. Increase job counts only in a separately provisioned scheduled stress database; do not point stress runs at production.

## CI, migration, deployment, and rollback

`.github/workflows/decision-continuity.yml` provisions PostgreSQL 16, applies the complete migration sequence through the current QAgent migration, validates checksums, runs the backend suite, all real-PostgreSQL integration tests, Compose config, and `git diff --check`. It stores no payload or database artifacts.

Production rollout order is:

1. Build one backend image used by both API and worker.
2. Run `docker compose --profile decision-continuity-production run --rm decision-continuity-migrate` once; it holds a PostgreSQL advisory lock and records migration checksums.
3. Provision principals/memberships and deploy compatible API replicas with PostgreSQL, OIDC issuer/audience/JWKS configuration, an explicit CORS origin allowlist, and `DECISION_CONTINUITY_DURABLE_WORKFLOWS=true`.
4. Roll out the independent `decision-continuity-worker` service with a scoped `DECISION_CONTINUITY_WORKER_PRINCIPAL_ID`, then wait for `/readyz` plus a fresh worker heartbeat.
5. Run `npm --prefix apps/backend run decision-continuity:smoke` only with an explicitly enabled dedicated `smoke-*` tenant, API URL, and worker health URL.

Migrations are expand-only; application rollback should keep the schema and deploy the prior compatible API/worker version. Do not destructively roll back schema. If migration fails, halt API/worker rollout, inspect `decision_continuity_schema_migrations`, correct a new forward migration, and retry. During a database outage, readiness is `503` and submission fails closed. For backlog or a stuck lease, restore database connectivity and let lease recovery run; never mutate leased rows by hand. For poison jobs, inspect the preserved failure/audit history and use the authorized, idempotent redrive route. For worker crash loops, stop the worker, correct configuration/dependency health, then restart it; released/expired leases recover. For a failed rollout, keep the database, roll back compatible binaries, and verify API/worker readiness before resuming traffic.
