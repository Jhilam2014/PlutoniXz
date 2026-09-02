# Gotham deterministic workflow publication

Gotham generation uses three ownership phases.

1. Deterministic preparation reads the latest canonical workflow decisions, selects the adaptive route, records the prepared checkpoint, binds project agents, and writes only the project-local context required by Gotham.
2. Gotham implements the project change. PlutoMix validates the output, performs preview handoff, records the terminal execution outcome, and durably enqueues one publication receipt before returning the HTTP response.
3. The deterministic backend publisher drains the durable outbox only while Gotham is idle. It publishes project instruction and what-next projections, project execution memory, agent/project topology, Neo4j seed data, backend and frontend D3 snapshots, registry/observability views, and then schedules the existing idle vector-memory synchronizer.

## Canonical decisions and derived projections

Canonical workflow decisions are append-only JSONL records under:

```text
runtime/workflow-decision-continuity/<project-id>.jsonl
```

Each prepared record captures the selected path and adaptive route before model execution. Each terminal record captures workflow/checkpoint/project identifiers, exact selected/rejected/deferred dispositions and reasons, constraints and evidence references, approval and reconsideration state, execution/validation/review/repair/fallback outcomes, and the publication ID/idempotency key.

The next instruction reads this canonical ledger before adaptive routing. It never waits for Neo4j, D3, what-next, or vector publication. Graph presence is not branch activation, and publication never promotes, reconsiders, or executes a rejected or deferred branch.

Neo4j, D3, project-memory summaries, what-next knowledge, registry views, and observability are derived projections. Their temporary delay or failure cannot rewrite the canonical decision.

## Durable outbox, claims, and recovery

The default outbox is:

```text
runtime/workflow-publication-outbox/
  pending/
  processing/
  published/
  failed/
```

Jobs are written to a temporary file, synced, and atomically renamed into `pending`. A worker claims a job with an atomic rename into `processing`. An in-process drain promise plus a filesystem publisher lock serializes shared graph writes across backend processes. Graph snapshots and generated Neo4j files use atomic replacement, so readers continue to see the last complete snapshot.

The publication idempotency key is `sha256(workflowId + resultDigest + publisherVersion)`. The result digest covers stable canonical status, route/path, exact branch dispositions, changed-file digests, validation, review, recovery, and sanitized error evidence; volatile timestamps and timing measurements are deliberately excluded.

At startup, abandoned `processing` jobs are moved back to `pending`. Retries are bounded and exponential; the sanitized last failure and attempt count remain in the job. Jobs that exhaust retries move to `failed` and are preserved for diagnosis. Publication IDs and stable graph identities prevent duplicate JSONL entries, graph nodes, and links.

To inspect jobs:

```sh
find runtime/workflow-publication-outbox -maxdepth 2 -type f -name '*.json' -print
```

To retry a diagnosed failed job, move that one explicit JSON file from `failed/` to `pending/` and restart the backend. Do not edit its receipt or branch dispositions. Startup recovery and the next idle drain will claim it.

## Events and statuses

The backend emits:

- `publication.queued` after the receipt is durable;
- `publication.started` after a worker claim;
- `publication.completed` after local projections succeed;
- `publication.retry_scheduled` after a retryable failure;
- `publication.failed` for degraded publishing, invalid jobs, or exhausted retries.

Terminal Gotham responses contain only the queue receipt:

```json
{ "publication": { "id": "publication_...", "status": "queued" } }
```

`queued` must not be interpreted as graph, memory, or vector completion.

## Configuration and latency

```text
GOTHAM_PUBLICATION_ENABLED=true
GOTHAM_PUBLICATION_MAX_ATTEMPTS=5
GOTHAM_PUBLICATION_RETRY_BASE_MS=1000
GOTHAM_PUBLICATION_IDLE_ONLY=true
GOTHAM_PUBLICATION_LOCK_STALE_MS=900000
GOTHAM_PUBLICATION_OUTBOX_PATH=
```

Setting `GOTHAM_PUBLICATION_ENABLED=false` is an emergency degraded mode only. Receipts remain durable and pending, an observability warning is emitted, and canonical decision persistence continues.

`GOTHAM_PUBLICATION_IDLE_ONLY` must remain `true`. Setting it to `false` fails closed with a degraded event and leaves receipts pending; it never authorizes graph or vector publication during Gotham execution.

User-facing duration includes deterministic preparation, decision/outcome persistence, model execution, validation, preview handoff, and durable queue write. It excludes `publicationDurationMs` and vector synchronization. Publication observability records the separate preparation, decision persistence, model, validation, preview, queue, and publisher timings when the runtime can measure them.
