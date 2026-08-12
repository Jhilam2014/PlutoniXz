# Decision Continuity PostgreSQL authority

Step 1 makes PostgreSQL the only production source of truth for Decision Continuity. The previous JSON snapshot and JSONL journal remain available only through `DECISION_CONTINUITY_ADAPTER=file` for local development and tests. Production selects PostgreSQL by default and explicitly fails closed if any other adapter is requested.

Apply the migration runner through the current `009_brainx_model_registry.sql` with the deployment database role, then start the backend with `DECISION_CONTINUITY_ADAPTER=postgres` and `DECISION_CONTINUITY_DATABASE_URL` set. `npm run decision-continuity:migrate` is a small convenience runner. `/api/status` reports liveness plus whether authoritative writes are ready; `/api/decision-continuity/readiness` is a scoped service route and returns 503 until PostgreSQL is usable. See [identity and authorization](decision-continuity-identity-security.md) for principal/membership provisioning and database-layer controls.

The schema uses tenant/workspace scoped primary keys for current state, a unique event identity, a tenant/workspace idempotency constraint, append-only hash-chained events, and a transactional outbox. The event table rejects updates and deletes at the database level. Outbox rows may be marked published by a future publisher without changing event history.

## One-time legacy import

Take a filesystem backup first. Run the migration, then validate without writes:

```sh
DECISION_CONTINUITY_DATABASE_URL='postgres://…' npm --prefix apps/backend run decision-continuity:import -- \
  --snapshot runtime/decision-continuity/state/ledger.json \
  --events runtime/decision-continuity/events/domain-events.jsonl --dry-run
```

Repeat without `--dry-run` to import. The importer checks JSONL identity/scope, records a source checksum, is resumable, and will report the same checksum as idempotent on retry. It does not delete the filesystem source or generate destructive rollback SQL. Restore a tested database backup or mark the import run superseded during a rollback investigation; preserve the source files for reconciliation.

Projection views are derived only: rebuild a graph or comparison by querying tenant-scoped current state and events, then calling the existing projection functions. Checkpoints have a versioned table for a future asynchronous projector but do not authorize state transitions.
