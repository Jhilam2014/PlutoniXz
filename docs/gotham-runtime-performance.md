# Gotham Runtime Performance and Usage

## Why small instructions were slow

Before this refactor, a managed run could direct Gotham to reconcile the 188,154-byte root operating manual, a 166,717-byte generated project policy, and a 15,374-byte project orchestrator handoff. The pre-refactor prompt fixtures were about 6.8 KB themselves, but they instructed the model to read roughly 370 KB of additional control-plane policy. A failed sandbox/cache attempt could then trigger another execution or an inappropriate project repair, while token accounting estimated the complete JSON transport stream at one token per four characters.

The deterministic projection publisher was independently verified outside the HTTP critical path. This refactor addresses the remaining policy, routing, failure-recovery, and accounting costs.

## Runtime lifecycle

1. The backend classifies `Auto` as Simple, Medium, or Hard from request boundaries and risk.
2. It reads `policies/manifest.json`, verifies pack hashes, selects core plus one lifecycle, task-size, and artifact-domain pack, and compiles a bounded static policy bundle.
3. Immediately before execution it adds the current instruction, completion criteria, project-state digest, selected agent definition, and a fresh canonical decision snapshot.
4. Gotham implements the bounded project change and returns evidence. It does not scan policy directories or publish PlutoniX control-plane projections.
5. Canonical path, branch dispositions, and terminal outcome remain synchronous. A durable publication receipt is queued before the HTTP result returns.
6. Local graph and memory projections publish asynchronously; the existing idle vector-memory scheduler runs only after local publication succeeds.

The root `AGENTS.md` is the compact constitution/router. The previous complete manual is preserved at `policies/reference/full-operating-manual.md` and is an optional audit reference, not normal runtime context. Generated `.agentic/orchestrator-agent.md` files are compact identity/handoff records. User-authored project instructions outside a managed block are preserved.

## Static cache and freshness

Static compiled policy is keyed by manifest version, selected pack IDs and versions, verified content hashes, workflow mode, lifecycle, resolved task size, artifact domain, and risk. Changing a selected pack version or hash invalidates it. User instructions, project digests, decisions, approvals, and branch dispositions are always rebuilt and never served from the static cache.

Compilation defaults:

- `GOTHAM_COMPILED_POLICY_CONTEXT_ENABLED=true`
- `GOTHAM_COMPILED_CONTEXT_TARGET_TOKENS=10000`
- `GOTHAM_COMPILED_CONTEXT_HARD_TOKENS=24000`

A missing, conflicting, malformed, hash-mismatched, or over-budget mandatory pack blocks execution rather than silently weakening policy.

## Calls, failures, and recovery

Planned execution and review calls are displayed separately from the infrastructure replay and project-repair limits. A Simple task normally makes one execution call. Medium normally makes one execution call. Hard/high-risk work may add one independent review.

Failure classes distinguish model-cache schema, CLI/model compatibility, missing workspace cwd, sandbox runtime, container/volume, transient provider, timeout, project implementation, project validation, and user cancellation. Only project implementation and validation failures are eligible for bounded project repair.

At startup, known model-cache candidates under `GOTHAM_HOME`/`CODEX_HOME` are inspected once per resolved runtime home. Incompatible files are atomically moved into `cache-recovery/`; compatible caches remain untouched. A filesystem lock coordinates concurrent preparation.

Infrastructure replay is capped by `PLUTONIX_INFRASTRUCTURE_REPLAY_LIMIT` (maximum one). The backend first verifies workspace access, CLI, cache, and sandbox health. It replays the original instruction only when health passes and no partial project changes were observed. It never turns an infrastructure diagnostic into a code-repair prompt.

## Usage accounting

Terminal provider usage wins when available. Normalized records preserve input, cached-input, output, reasoning-output, and total tokens plus provider-schema provenance. When provider usage is absent, the record is explicitly `estimated` and counts the bounded prompt plus model-authored output text—not tool payloads, JSON event envelopes, file contents, stderr, or diagnostics.

Transport diagnostics remain separate as `transportBytes`, `stdoutEventBytes`, and `stderrBytes`. Attempts carry parent workflow, attempt ID/number/type/status, provider/model, failure class, and timestamps. Execution, replay, review, fallback, and repair attempts are distinguishable.

## Publication and timing

The user-facing duration covers deterministic preparation, canonical persistence, model execution, validation/preview, and durable queueing. It does not include asynchronous `publicationDurationMs`. Publication state is reported as queued, started, completed, retry scheduled, failed, or degraded; queued is never called completed.

Inspect publication details and retry/recovery operations in [the publication guide](gotham-workflow-publication.md). Do not disable canonical decision persistence. An emergency projection disable remains explicit and degraded, with the durable receipt preserved.

## Browser refresh and reattachment

Gotham execution is backend-owned and is not cancelled when the originating browser request or event stream disconnects. `GET /api/generate/status` returns the authenticated user’s active execution metadata, scoped to an optional project ID. The frontend persists the selected project ID, polls this endpoint, and reconstructs the running instruction, elapsed timer, selected flow, task classification, and stop control after a refresh or a reopened page. When the backend reports the execution idle, the frontend reloads durable project instruction history, project state, preview, and the latest canonical terminal outcome.

The runtime event log is written by the backend independently of the browser connection. A `gotham-client-detached` event records that the client disconnected while the backend continued. Reattachment never starts a second model call and never changes the selected path or branch disposition.

## Measured evidence

The repository baseline recorded before implementation was:

- root policy: 188,154 bytes;
- generated project policy: 166,717 bytes;
- project orchestrator handoff: 15,374 bytes;
- legacy Simple prompt fixture: 6,778 characters (about 1,695 locally estimated tokens), plus instructions to read the large files above.

After compilation, a representative Simple runtime bundle selected six mandatory packs and measured about 1,273 locally estimated tokens before task-specific dynamic context. The compact root router is approximately 10 KB. These are context-size measurements, not claims about provider billing or end-to-end latency. Runtime dashboards must use provider-reported usage and measured timings where available.
