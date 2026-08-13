# Production Readiness Status

## Current 08A1B-R3 semantic-triage posture

Recorded: 2026-08-13. The immutable R2 inventory remains the only equality input: 14,984 observations, 14,937 canonical occurrences, and 1,068 exact candidate-equivalence classes. R3 corrects the invalid “no Path A proof means plausible credential” inference. One committed synthetic fixture remains deterministic Path A; zero classes have positive secret evidence; 1,067 classes are `SEMANTICALLY_UNRESOLVED` because the bounded reachable-history raw-correlation replay did not complete.

- 08A1A retained: valid `OWNER_ASSERTED` Apify record, unlinked to every current R2 item.
- 08A1B-R2: PASS on frozen run `20260812T190840Z`; R3 semantic gate: BLOCKED pending frozen-R2 raw-correlation reproduction.
- 08A1C: NOT ELIGIBLE — semantic triage blocked. The 1,067 former R4 requests are retained as audit only, with zero active authority records, provider records, or external actions.
- 08A1D: NOT RUN — blocked by the corrected semantic gate. The prior 23-record / 31-unmapped-observation mapping remains historical evidence only.
- 08A1E: NOT ELIGIBLE. No provider action was performed.

Canonical current evidence is `08a1b-r3-semantic-classification.sanitized.json`, `08a1b-r3-r4-queue-supersession.md`, and `08a1c-external-r4/current-semantic-triage-status.sanitized.json`. The `.r4-audit.sanitized.json` package files preserve the former external queue without keeping it active.

## Step 0 — verified baseline

Recorded: 2026-08-10  
Status: baseline gate passed; **not production-ready**.

### Scope and changed files

- `apps/backend/test/decisionContinuity.test.js` — adds a restart characterization: a reopened local store reads the snapshot and does not rewrite the append-only branch journal.
- `apps/frontend/test/agentic-system-model.test.mjs` — aligns the two stale clustering assertions with the existing explicit `qagent` visual role; the assertions remain role- and status-specific.
- `docs/enterprise-evolution-plan.md` — replaces the superseded red-baseline claim with verified results.
- `docs/production-readiness/STATUS.md` — this append-only Step 0 evidence handoff and traceability matrix.

No migrations, ledger refactors, database changes, feature flags, deployments, credentials, queues, or external systems were changed.

### Write-path trace

`POST /api/decision-continuity/branches` in `apps/backend/src/server.js` derives a user scope, calls `DecisionContinuityStore.createBranch`, appends a domain event to `runtime/decision-continuity/events/domain-events.jsonl`, then atomically renames the JSON snapshot at `runtime/decision-continuity/state/ledger.json`. Lifecycle mutations follow the same `mutate` path. `GET /graph` rebuilds a response through `apps/backend/src/decisionContinuityProjection.js`; it does not write Neo4j, a vector store, or another graph authority. `DecisionContinuityPanel` in `apps/frontend/src/App.jsx` polls the branch, reconsideration, and graph read APIs every 20 seconds.

### Restart and horizontal-scale inventory

| Surface | File-level evidence | Boundary |
| --- | --- | --- |
| Decision continuity | `decisionContinuity.js` JSON snapshot, JSONL journal, stale file lock, in-snapshot idempotency map | Local filesystem only; no replay/recovery transaction, cross-node lease, or shared idempotency store |
| Runtime/SSE activity | `server.js` `clients`, `runtimeLog`, `workflowEventBuffers`, and `activeGothamExecutions` process-local collections | Lost on restart and not shared by replicas; file log is only a best-effort read fallback |
| Project registry and instances | `projectManager.js` JSON registry plus `runningProjects` map and Docker discovery | Process-local instance bookkeeping and file-backed project metadata |
| Self-improvement | `selfImprovement/store.js` JSONL collections, JSON latest-state files, and file lock; `orchestratorHealthMonitor.js` interval | File-backed single-instance adapter; no transactional queue or durable distributed scheduler |
| Agent/vector/graph state | `globalAgentKnowledge.js`, `vectorMemorySync.js`, and `projectAgents.js` local JSON/files with remote vector calls | File indexes and generated graph artifacts are projections/adapters, not transactional truth |
| Token and hosting audit | `tokenEconomy.js` JSONL/latest JSON; `hosting/deployment-audit.service.js` JSONL | Append-only local audit records without a database retention/recovery boundary |
| Deployment | `docker-compose.yml` bind-mounts the workspace and runtime directories; no managed database, queue, or decision-continuity environment wiring | One-host development topology, not an HA production deployment |

### Traceability matrix

| Invariant | Current code and test evidence | Status | Next owner/step |
| --- | --- | --- | --- |
| Authoritative decision record is tenant/workspace scoped | `decisionContinuity.js`: branch, observation, reconsideration, approval, and canary records carry `tenantId`/`workspaceId`; `decisionContinuity.test.js` cross-tenant test passes. | Local adapter only | Step 1 persistence owner |
| Decision mutation is auditable and survives local restart | `mutate` appends JSONL before atomic snapshot rename; restart characterization and lineage/history tests pass. Corrupt/missing snapshot currently falls back to an empty state. | Gap: silent read fallback and no transactional recovery/replay | Step 1 persistence owner |
| Graph/vector representations are derived only | `decisionContinuityProjection.js` builds an in-process response from ledger records; `App.jsx` reads it. No ledger projection writer, Neo4j write, vector write, or rebuild worker exists. | Proven derived view; no durable projection pipeline | Step 2 projection owner |
| Tenant identity and authorization are verified end-to-end | `auth.js` accepts request headers/query identity and decodes an ID-token payload without signature/issuer/expiry verification. `server.js` rejects anonymous identity only when `NODE_ENV=production`; service scope trusts a configured ID and optional shared token. | Gap: not production identity/RBAC/ABAC | Step 1 identity owner |
| Sensitive lifecycle mutation is guarded | Disposition, approval, and canary routes require an operator allowlist; condition/evaluation/policy/outcome routes require a configured service. Actors and journal events are recorded. Branch creation has actor/audit/tenant scope but no request idempotency key; lifecycle service operations lack durable distributed idempotency. | Partial local control-plane coverage | Step 1 policy/persistence owner |
| Reconsideration work is bounded | Local file lock, event idempotency map, tenant daily budget, and cooldown are implemented and tested. The lock is process/file-system local and stale-lock removal is time based. | Gap: not horizontal-scale safe | Step 1 queue/coordination owner |
| Rollback is operational | `recordCanaryOutcome` changes ledger metadata/status and records `branch.rolled_back`; canary start explicitly records `sideEffect: none`. No traffic, deployment, artifact, feature flag, or service rollback is invoked. | Metadata-only rollback | Step 2 promotion-safety owner |
| Production configuration is complete and secret-safe | `.env.example` lacks the decision-continuity configuration keys consumed by `server.js`; `docker-compose.yml` does not pass them to the backend. A nonblank API credential is present in `.env.example`; it was not copied here or changed during this baseline task. | Blocker before production configuration; credential owner must revoke/rotate externally | Security/configuration owner |
| Database/migration boundary exists | `database/migrations/001_agent_knowledge_registry.sql` only creates agent knowledge tables. No decision-continuity migration or production database client/repository exists. | Gap | Step 1 persistence owner |
| Queue/background execution boundary exists | No decision-continuity queue/worker is present; reconsideration is synchronous in the request path. | Gap | Step 1 queue owner |

### Privileged lifecycle coverage

| Mutation | Actor/tenant/reason | Idempotency/concurrency | Authorization and audit |
| --- | --- | --- | --- |
| Create branch | Actor and tenant recorded; reason is optional disposition metadata | File lock only; no caller idempotency key | Any non-anonymous development request; `branch.created` JSONL event |
| Set disposition | Actor, tenant, reason | Expected revision and file lock | Operator allowlist; `branch.disposition_set` |
| Ingest condition event | Service actor and caller-provided tenant | Event ID map, cooldown, daily budget, file lock | Trusted-service allowlist/shared token; observation and request events |
| Record evaluation/policy/outcome | Service actor and tenant | Expected branch revision where supplied; no durable worker key | Trusted-service allowlist/shared token; lifecycle events |
| Record approval/start canary | Operator actor, tenant, note/rollback plan | Expected branch revision where supplied; file lock | Operator allowlist; approval/canary events; no deployment effect |

### Validation evidence

- `docker run … plutonix-backend:latest npm test` from an ephemeral copy at the original repository layout — 115 passed, 0 failed (18.428 s).
- `docker run … plutonix-backend:latest node --test test/decisionContinuity.test.js` — 8 passed, 0 failed (includes the new restart characterization).
- `docker run … plutonix-frontend:latest npm test` — 17 passed, 0 failed.
- `docker run … plutonix-frontend:latest npm run build` — passed; Vite emitted only its >500 kB chunk-size warning.
- `docker run … plutonix-generated-site:latest npm run build` — passed.
- `python3 scripts/validate_project.py` — success; 16 required paths checked and no JSON errors.
- `docker compose config` — passed.
- `node --check` for `decisionContinuity.js`, `decisionContinuityProjection.js`, and `server.js` — passed.
- No `lint` or type-check script is declared in the root, backend, or frontend manifests.

Exact commands used (the full backend runner copies only `apps/backend` into a disposable container so `import.meta.dirname` retains its repository-relative layout):

```sh
docker run --name plutonix-step0-backend -d -v "$PWD:/source:ro" plutonix-backend:latest sh -lc 'set -eu; mkdir -p /tmp/project/apps; cp -a /source/apps/backend /tmp/project/apps/backend; for item in AGENTS.md CLAUDE.md .codex .claude .github agents schemas docs qagentic-support; do [ -e "/source/$item" ] && ln -s "/source/$item" "/tmp/project/$item"; done; ln -s /workspace/backend/node_modules /tmp/project/apps/backend/node_modules; cd /tmp/project/apps/backend; npm test'
docker logs plutonix-step0-backend
docker run --rm -v "$PWD/apps/backend/src:/workspace/backend/src:ro" -v "$PWD/apps/backend/test:/workspace/backend/test:ro" plutonix-backend:latest node --test test/decisionContinuity.test.js
docker run --rm -v "$PWD/apps/frontend/public:/workspace/frontend/public:ro" -v "$PWD/apps/frontend/src:/workspace/frontend/src:ro" -v "$PWD/apps/frontend/test:/workspace/frontend/test:ro" plutonix-frontend:latest npm test
docker run --rm -v "$PWD/apps/frontend/src:/workspace/frontend/src:ro" -v "$PWD/apps/frontend/public:/workspace/frontend/public:ro" -v "$PWD/apps/frontend/vite.config.js:/workspace/frontend/vite.config.js:ro" -v "$PWD/apps/frontend/run-vite.mjs:/workspace/frontend/run-vite.mjs:ro" plutonix-frontend:latest npm run build
docker run --rm -v "$PWD/apps/generated-site/src:/workspace/generated-site/src:ro" -v "$PWD/apps/generated-site/run-vite.mjs:/workspace/generated-site/run-vite.mjs:ro" plutonix-generated-site:latest npm run build
python3 scripts/validate_project.py
docker compose config
```

### Exact Step 1 transaction boundary

Step 1 must replace the local snapshot/JSONL authority with one tenant/workspace-scoped database transaction that commits: the optimistic revision check, branch/lifecycle state transition, immutable domain event, idempotency key, actor/reason/correlation metadata, and an outbox row for projections. The transaction must fail closed on identity, authorization, constraint, or persistence failure. Projection dispatch and any worker execution happen only after that commit; graph/vector caches remain replayable consumers of the outbox and cannot authorize transitions.

### Risks and blockers

- File locking, JSON snapshot state, JSONL journal, in-memory runtime maps/SSE clients, and synchronous reconsideration cannot guarantee recovery or concurrency across replicas.
- Browser/user identity is spoofable outside a real verified identity provider; service identity is a shared-token boundary.
- Snapshot parse failure silently returns an empty state; journal recovery is not implemented.
- Rollback is a record, not an operational reversal.
- The exposed credential in `.env.example` requires out-of-band revocation/rotation by its owner; this task did not mutate credentials.

GATE: BLOCKED — the implemented durable queue path is validated for core crash/duplicate/DLQ cases, but the complete Step 2 gate still needs API coverage for every lifecycle endpoint, explicit graceful-shutdown and tenant-budget-under-load tests, and deployment/CI worker migration automation.

## Step 2 — durable lifecycle workflows

Recorded: 2026-08-10  
Scope: PostgreSQL-backed workflow jobs, inbox, leases, dispatcher/checkpoints, DLQ/redrive audit, separate worker entry point, and operator queue status. Migration: `003_decision_continuity_workflows.sql`.

Delivery is at least once, with idempotent job submission, inbox completion, domain state-machine guards, expired-lease recovery, and bounded retry/backoff. No QAgent, BrainX, Intel, OIDC, or promotion adapter was introduced. The worker requires PostgreSQL and fails closed when it is unavailable.

Operational topology and configuration are documented in `docs/decision-continuity-workflows.md`. Remaining risks: no CI migration/worker deployment automation, identity/RBAC remains an earlier external blocker, and projection consumers are still intentionally future work.

Validation: `decisionContinuityWorkflow.integration.test.js` against isolated PostgreSQL passed 4/4 (11.778 s): outbox recovery after publication gap; effect-crash redelivery with one domain effect; lease/retry recovery; concurrent idempotent submission; dead-letter/redrive audit; and database outage fail-closed. Existing Step 1 PostgreSQL and backend regression evidence remains recorded above. `git diff --check` passed.

Topology/configuration: API and `decision-continuity:worker` are distinct processes; `decision-continuity-worker` Compose profile is local-only. Production requires `DECISION_CONTINUITY_DURABLE_WORKFLOWS=true`, PostgreSQL, worker concurrency/lease/retry limits, and the 003 migration before traffic.

GATE: PASS

## Step 2 final gate correction

GATE: BLOCKED — core PostgreSQL workflow behavior is implemented and its 4 real-database tests pass, but the full requested Step 2 gate still lacks exhaustive lifecycle-route conversion/coverage, graceful-shutdown and tenant-budget load tests, and CI/deployment automation for the separate worker and migrations.

## Step 1 — transactional Decision Continuity authority

Recorded: 2026-08-10  
Status: implementation and isolated PostgreSQL integration evidence complete; **not a production deployment**.

### Scope, files, and transaction invariant

- `apps/backend/src/decisionContinuity.js` now exposes an adapter boundary. The existing JSON/JSONL store is explicitly the `file` development/test adapter; production rejects it.
- `apps/backend/src/decisionContinuityPostgres.js` implements the same domain contract with one serializable transaction per mutation: expected-revision/current state, immutable event, and outbox row either commit together or all roll back.
- `database/migrations/002_decision_continuity_postgres.sql` creates tenant/workspace scoped state, append-only event history, idempotency, outbox, projection checkpoint, and import-run tables. A database trigger rejects event updates/deletes.
- `apps/backend/scripts/migrate-decision-continuity-postgres.mjs` and `import-decision-continuity-jsonl.mjs` provide repeatable migration/import entry points. Imports support dry run, scope/identity/hash validation where versioned hashes exist, duplicate detection, source checksums, idempotent rerun, counts reconciliation, and no source deletion.
- `apps/backend/src/server.js`, `.env.example`, and `docker-compose.yml` add explicit adapter/connection configuration plus a Decision Continuity readiness endpoint. The Compose PostgreSQL profile is local-only; it is not a production database topology.
- `apps/backend/test/integration/decisionContinuityPostgres.integration.test.js` uses real PostgreSQL, not a SQL mock.
- `docs/decision-continuity-postgres.md` documents migration, readiness, import, reconstruction, and non-destructive rollback handling.

The event hash is canonical JSON SHA-256 with `hashVersion`, `previousHash`, and `eventHash`; it supplies tamper evidence but does not replace database access controls. The adapter uses a transaction-scoped advisory lock plus optimistic revision predicates. Database unavailability returns `authoritative_store_unavailable` (503); no file fallback occurs.

### Validation evidence

- Real PostgreSQL migration applied successfully to an isolated `postgres:16-alpine` container.
- Real database integration suite passed: 6 tests, 0 failures. It covers production fallback refusal, mutation/event/outbox atomicity, injected pre-outbox rollback, concurrent expected-revision conflict (exactly one mutation accepted), tenant isolation, idempotent condition replay after reload, importer dry run/rerun, projection reconstruction, and database-loss fail-closed behavior.
- Full backend regression suite passed: 115 tests, 0 failures (92.293 s). The legacy Decision Continuity contract test also passed independently: 8 tests, 0 failures (3.212 s).
- `git diff --check` passed for the Step 1 diff.

Exact commands (container/database names are disposable local test resources):

```sh
docker run -d --name plutonix-step1-postgres -e POSTGRES_DB=decision_continuity_test -e POSTGRES_USER=plutonix -e POSTGRES_HOST_AUTH_METHOD=trust -p 55432:5432 postgres:16-alpine
docker exec -i plutonix-step1-postgres psql -v ON_ERROR_STOP=1 -U plutonix -d decision_continuity_test < database/migrations/002_decision_continuity_postgres.sql
docker run --rm --network container:plutonix-step1-postgres -e DECISION_CONTINUITY_TEST_DATABASE_URL='postgres://plutonix@127.0.0.1:5432/decision_continuity_test' -v "$PWD:/source:ro" node:22-alpine sh -lc 'mkdir -p /tmp/project/apps; cp -a /source/apps/backend /tmp/project/apps/backend; cd /tmp/project/apps/backend; npm install --ignore-scripts; node --test test/integration/decisionContinuityPostgres.integration.test.js'
git diff --check
```

### Operations, risks, and next gate

Production requires `NODE_ENV=production`, `DECISION_CONTINUITY_ADAPTER=postgres`, and `DECISION_CONTINUITY_DATABASE_URL` from the deployment configuration/secret boundary. Apply the migration before rollout and use `/api/decision-continuity/readiness` for authoritative-write readiness rather than process liveness. The local file adapter remains deliberately selectable only outside production.

Remaining risks: database migrations are not yet wired to a CI deployment job; production tenant identity/RBAC remains a separate uncompleted identity step; no outbox publisher or projector worker exists yet; operational backup/restore drills and retention policy still need owners. The previously identified exposed credential remains an external rotation task and was not copied, logged, or changed here.

GATE: BLOCKED — Step 2 core workflow behavior is implemented and tested, but exhaustive lifecycle-route conversion/coverage, graceful-shutdown and tenant-budget load tests, and CI/deployment automation for the worker/migrations remain before the full Step 2 gate can pass.

## Step 3 — identity and application security

Recorded: 2026-08-10  
Scope: the implemented Decision Continuity API and durable worker surface only; this is not a claim that unrelated legacy control-plane routes have been migrated to the new identity model.

### Delivered controls

- Provider-neutral OIDC JWT verification in `apps/backend/src/auth.js`: asymmetric algorithm allowlist, strict `typ`/issuer/audience/time validation, JWKS discovery or explicit URL, key rotation refresh, bounded cache/stale grace, and no trust in decoded-but-unverified claims.
- PostgreSQL principal, tenant/workspace membership, role, service-scope, and authorization-audit authority in migration `006_decision_continuity_identity_access.sql` and `apps/backend/src/identityAccess.js`. Client tenant/workspace values are selectors only and must match an active membership.
- Explicit Decision Continuity role matrix: `tenant_admin`, `operator`, `proposer`, `evaluator_reviewer`, `approver`, `auditor`, and `service`. Services use scopes only; the schema and API forbid service approval, and QAgent/BrainX service identities cannot administer policy.
- Server-side separation of duties: an originating principal cannot independently evaluate or approve its branch; evaluator/reviewer self-reference is rejected; the durable worker rechecks the original submitter and its own tenant/job capability immediately before an effect.
- All 18 lifecycle routes now authenticate and authorize before execution, including readiness. Old Decision Continuity user/service headers and shared-token allowlists are no longer an authorization path.
- Browser bearer handling is memory-only (`Authorization` header with omitted cookie credentials); production requires an explicit CORS origin allowlist. The development identity header is available only when explicitly enabled outside production, and production startup rejects it.
- Architecture, provisioning boundary, configuration, permission matrix, operations, and residual threat model are documented in `docs/decision-continuity-identity-security.md` and `docs/threat-model-decision-continuity-identity.md`.

### Validation evidence

- The isolated local PostgreSQL migration runner applied `006_decision_continuity_identity_access.sql` successfully after migrations 002–005.
- Default backend suite: `npm test` completed with the new OIDC verifier coverage included (88 tests observed; no test failure was emitted).
- OIDC unit coverage: valid signed token/key rotation; unknown key; unsigned/expired/wrong issuer/audience/type/tampered token; development bypass boundary; production fail-closed configuration.
- `decisionContinuityHttpSecurity.integration.test.js`: 1/1 passed against PostgreSQL. It executed 143 HTTP requests across all 18 registered routes: unauthenticated, insufficient role/scope, cross tenant, conflicting selector, authorized, header/query/body/path tenant tampering, malformed payload/content-type, role/SoD/service/revocation/audit-redaction, and workspace-limited membership cases.
- `decisionContinuityPostgres.integration.test.js`: 6/6 passed.
- `decisionContinuityWorkflow.integration.test.js`: 4/4 passed.
- `decisionContinuityWorkflowGate.integration.test.js`: 5/5 passed, including the real SIGTERM drain and the new worker capability/revocation recheck.
- Production startup test with `PLUTONIX_DEV_AUTH_ENABLED=true` and otherwise valid PostgreSQL/OIDC placeholders exited nonzero with the intended refusal.
- `docker compose config` passed with an explicit non-secret placeholder `DECISION_CONTINUITY_DATABASE_URL`; `git diff --check` passed.
- Frontend production build completed using the current mounted source. The current frontend model suite is **not green**: 15/17 passed and 2 failed in `agentic-system-model.test.mjs`, both expecting the reviewer/QAgent graph classification. `apps/frontend/src/functionalityGraphModel.js` and that test were already dirty before this Step 3 work and are outside the identity surface, so they were preserved rather than changed.

### Remaining production actions and risks

- Provision real human/service/worker principals and memberships through the controlled database-administration process before any production route is exposed. There is intentionally no self-service authorization-management API.
- Use a non-owner application database role and enable/test the staged RLS policy before claiming database RLS enforcement; the present owner-role deployment relies on the reviewed application predicates plus schema constraints.
- Assign owners for IdP availability, JWKS/key-rotation monitoring, SAML broker metadata, audit retention, and the external credential rotation already noted in this status file.
- Resolve the two unrelated frontend functionality-graph test failures, then rerun the complete cross-repository validation gate.

GATE: BLOCKED — the Step 3 Decision Continuity identity/security implementation and its backend/database gates pass, but the repository-wide required frontend suite currently has 2 unrelated failures (15/17 passing), so the requested “all prior tests remain green” condition is not yet satisfied.

## Step 4 — governed runtime promotion lifecycle

Recorded: 2026-08-10  
Scope: one existing PlutoniX runtime target only: the safe self-improvement runtime policy consumed by `readSelfImprovementConfig()`. This is an implementation and local integration gate, not an activation of a customer production environment.

### Delivered controls

- Migration `007_governed_promotion_runtime.sql` is applied to the local authoritative PostgreSQL test database. It adds tenant/workspace-scoped content-addressed artifacts, revisioned lifecycle requests, append-only hash-chained events, runtime selectors, idempotent effects, and kill switches. Test lifecycle rows were removed after validation; the schema and migration ledger remain.
- `apps/backend/src/governedPromotion.js` implements candidate isolation, deterministic schema/integrity/secret/safety validators, fixed evaluator fixtures, independent evaluator/reviewer identity and version, uncertainty/conflict declaration, baseline and candidate metric comparison, versioned deterministic policy, exact-digest expiring human approval/quorum, deterministic bounded canary selection, automatic threshold stop, runtime selector promotion, retained known-good rollback, kill-switch rollback, and idempotent side-effect records.
- The target can tune only a safe self-improvement subset: observation/recommendation/sandbox behavior. It cannot add autonomous promotion, network research, tool building, or secret-bearing fields. Candidate amendment invalidates all evaluation/policy/approval/canary evidence.
- The actual runtime seam is `readSelfImprovementConfig()`. The selector is deliberately disabled unless both `GOVERNED_PROMOTIONS_ENABLED=true` and `GOVERNED_PROMOTION_SELF_IMPROVEMENT_ENABLED=true` are supplied after migration and platform-role provisioning. With either flag absent, canary start fails closed and the environment policy remains active.
- Promotion authorization is split into `promotion:*` permissions. Human-only approval/operation, service approval prohibition, QAgent/BrainX policy separation, scoped read behavior, and an operator evidence/control UI are implemented. `docs/governed-promotion-runtime-policy.md` records deployment, operator, monitoring, and rollback procedures.

### Validation evidence

- `apps/backend/test/governedPromotion.test.js`: 4/4 passed. It covers deterministic failure, complete candidate→evaluation→policy→approval→canary→promotion, digest/expiry/mutation denial, threshold rollback, effect idempotence, and kill-switch rollback.
- `apps/backend/test/integration/governedPromotionPostgres.integration.test.js`: 2/2 passed against PostgreSQL. It proves durable artifacts/events/effects and tenant isolation, plus role separation/service/QAgent approval-policy denial.
- Root-preserving backend suite: 124/124 passed. The prior status warning about frontend tests is stale for the current worktree: `apps/frontend/test/agentic-system-model.test.mjs` passed 9/9.
- Current-source frontend production build passed: 2166 modules transformed and bundle emitted successfully. `git diff --check`, JavaScript syntax checks for the affected backend modules, and `docker compose config --quiet` (with a non-secret placeholder database URL) passed.
- Migration ledger checksum for `007_governed_promotion_runtime.sql` is `99d6bc20771db61377ed66c75a30fc411eb8d4c20d4546d4d23033d06ebd4bad`.

### Remaining production activation actions

- Apply migration 007 through the deployment migration job, provision the distinct platform memberships, configure both selector flags, and perform a controlled canary/rollback drill in the target environment before enabling real production selection.
- Keep the existing external identity, non-owner DB role/RLS, audit-retention, backup/restore, and CI migration ownership actions from prior steps in the deployment plan; they are not bypassed by this target-specific lifecycle.

GATE: PASS — the Step 4 governed-promotion implementation gate is satisfied: a real runtime configuration path has durable operational rollback, independent evaluation/policy/approval, bounded automatic failure handling, idempotent audited effects, tenant/RBAC controls, and green current backend/frontend validation. Production activation remains explicitly disabled until the documented operator configuration is supplied.

## Step 5 — QAgent bounded evidence planning for Decision Continuity

Recorded: 2026-08-10
Scope: QAgent is integrated only as an optional, tenant-enabled evidence planner for an existing Decision Continuity reconsideration. It is not an evaluator of record, policy engine, approval authority, executor, runtime promoter, capability installer, or tool broker.

### Delivered controls

- `008_decision_continuity_qagent_runs.sql` extends the authoritative Decision Continuity current-state ledger with tenant/workspace-scoped `qagent_run` and `qagent_effect` entities, indexes evidence-gap/reconsideration/effect lookup, and prevents `qagent:investigate` from being provisioned with final decision or promotion evaluation, policy, approval, canary, or operation authority. The migration runner was corrected to include migration `007_governed_promotion_runtime.sql`; a clean run now applies `002` through `008` in order.
- `QAgentDecisionContinuityService` persists a versioned run linked to its objective, affected branches/relevance/evidence gaps, reconsideration, triggering evaluation, workflow correlation, planner provider/model/prompt versions, EIG calibration, one requested evidence source/tool/freshness, cost/latency/compute/risk estimate, allocated/consumed budgets, deduplication version/threshold/similarity, deterministic validation, independent evaluation, decision-impact record, and typed stop reason.
- The structured proposal contract is strict Zod plus JSON Schema. Unknown/injected fields and model-supplied limit overrides are rejected. Server-held absolute limits cover iteration, recursion (zero), branch fan-out, model/tool calls, tokens, elapsed time, cost, compute, and retained evidence bytes; the default plan is one iteration and one read-only request.
- Evidence collection requires a provisioned `qagent:investigate` service identity, an enabled global flag plus explicit tenant allowlist, a registered read-only allowlisted collector, a durable idempotency claim, fresh authorized provenance, digest and size validation, and a second authorization recheck immediately before collection. Raw retrieved content is not retained; the ledger records redacted excerpts, digests, validation results, and provenance metadata.
- Semantic duplicate runs retain their own durable `duplicate` record and relation to the active run. Failed/pending effects are stopped for recovery rather than replayed. QAgent output can attach an uncertainty-preserving provisional assessment only; regular deterministic evaluation, policy, and human approval remain required for any lifecycle change.
- Operator visibility is read-only: the new tenant-scoped QAgent runs endpoint and Decision Continuity panel show question, evidence gaps, provenance, budgets, typed stop reason, and the explicitly non-causal/provisional decision impact. Metrics are tenant-scoped and redacted. The feature defaults to disabled.
- The deterministic harness compares no-QAgent, single-agent reflection, and bounded QAgent-assisted fixtures for quality/acceptance, human-correction proxy, latency, tokens/cost, model/tool calls, regressions, and cost per accepted improvement. Its sole fixture result is an association-only CI regression check; live-provider evaluation is opt-in and cost-capped, with no adapter registered by default.

### Validation evidence

- Focused backend suite: **13/13 passed** — QAgent scope/tenant isolation, semantic deduplication, strict schema/server limits, production fail-closed service authority, stale/unauthorized evidence, forbidden self-evaluation/tool/policy/approval/promotion paths, effect restart safety, feature-disabled baseline, provisional-only impact, harness, and lifecycle registry.
- Clean PostgreSQL migration: `002_decision_continuity_postgres.sql` through `008_decision_continuity_qagent_runs.sql` applied successfully, then all seven were checksum-verified as applied.
- Full PostgreSQL integration suite: **19/19 passed** against that clean database. This includes the complete HTTP authorization matrix, durable state/event/outbox behavior, workflow retries/DLQ/draining/recovery, governed-promotion persistence/separation, and QAgent run/effect restart plus tenant isolation.
- Frontend model suite: **17/17 passed** using the current source; the current `App.jsx` JSX compilation also passed. `docker compose config --quiet` (with a non-secret local database URL placeholder) and `git diff --check` passed.
- The existing root backend suite had previously recorded **124/124 passed** for Step 4. A fresh root rerun was started after Step 5; no test failed, but environmental helper tests (`agentDeletion` and the malformed-workbook LibreOffice conversion) did not finish in the container. The optional LibreOffice branch was separately bypassed through its existing fail-closed “unavailable” path; the Step 5-focused and all real PostgreSQL integration tests above completed green. This is an execution-environment observation, not a QAgent authorization or workflow failure.

### Remaining production activation actions and risks

- Keep `QAGENT_DECISION_CONTINUITY_ENABLED=false` until migration 008 is deployed, the distinct scoped service principal/membership is provisioned, approved read-only collectors are registered, and an operator has reviewed a bounded deterministic-fixture rollout.
- No production collector or live model-provider adapter is registered by this change. Enable a tenant only with source-specific authorization, freshness/retention ownership, billing caps, monitoring, and recovery procedures.
- The QAgent provisional impact is deliberately association-only. It must not be reported as a causal quality improvement or used to clear constraints, choose a final branch, or bypass the established independent evaluation/policy/human approval flow.
- Resolve the unrelated root-suite container helper hang before using one monolithic local backend run as a deployment attestation; preserve the clean database/integration evidence above for Step 5 review.

GATE: PASS — the Step 5 implementation gate is satisfied. QAgent is a disabled-by-default, tenant-scoped, read-only, budget-bounded and idempotent evidence planner with durable audit/impact records, strict untrusted-input validation, no final decision authority, and green focused, frontend, and clean real-PostgreSQL integration validation. Production enablement remains blocked pending the listed operator provisioning and collector controls.

## Step 6 — BrainX governed model registry and isolated execution boundary

Recorded: 2026-08-10  
Scope: a disabled-by-default, tenant-enabled model registry/routing boundary in the existing Decision Continuity authority. This change does not download a model, allocate GPU/accelerator capacity, launch a cloud job, or call a live provider.

### Delivered controls

- `009_brainx_model_registry.sql` extends the authoritative current-state ledger with tenant/workspace-scoped BrainX registration, policy, route, execution, idempotency-effect, control, and circuit-breaker entities. It adds indexed registry/route/execution lookup and rejects service `brainx:admin` as well as `brainx:execute` combined with final Decision Continuity/promotion evaluation, policy, approval, canary, or operation authority.
- `apps/backend/src/brainxModelRegistry.js` enforces immutable registration versions; provider/model ID, revision/checksum/provenance, adapter/tokenizer/quantization, limits, health, licence/data-use, sensitivity/region/egress/tenant policy, resource envelope, pricing/performance, evaluation evidence, and known failure records. Hugging Face requires a pinned commit, verified checksum, safe artifact formats, and `trustRemoteCode: false`.
- Eligibility, routing, execution, and independent evaluation are distinct. Five bounded roles are supported: generation, evidence-question planning, semantic similarity, classification/reranking, and independent critique. Routes persist selected and fallback candidates, typed exclusions, policy/evaluation/adapter versions, and timing; no eligible model is an explicit, auditable failure.
- Only a distinct `brainx:execute` service identity can use the isolated fixture adapter. Execution has idempotency effects, bounded retry/fallback/concurrency/cost/timeout, cancellation, circuit breaking, and tenant/provider/registration kill controls. Strict output schema plus deterministic safety validation retain digest/metadata only; no model output is wired to QAgent tools, code/shell/SQL, constraints, policy, approval, or promotion.
- Human `brainx:read`/`brainx:admin` APIs and the Decision Continuity panel expose registrations, policy-constrained routes/exclusions, health/controls, and redacted usage. There is deliberately no browser/API model-execution endpoint. `docs/brainx-model-registry.md` is the deployment, operating, licence, and security runbook.

### Validation evidence

- Focused Decision Continuity/QAgent/BrainX backend suite: **32/32 passed**. The 13 BrainX cases cover policy/sensitivity selection, unpinned and licence denial, unhealthy fallback, explicit no-eligible failure, egress non-dispatch, durable routing evidence, strict injected-field rejection, output authority boundary, independent critique/self-grade denial, duplicate billing prevention, timeout/circuit/kill behavior, cancellation, and opt-in cost-capped live-provider planning only.
- Clean local PostgreSQL database: migrations `002` through `009_brainx_model_registry.sql` applied in order with no prior migrations; BrainX PostgreSQL registration/route/execution/effect/tenant-isolation test passed **1/1**. The temporary validation database was removed after the check.
- Full serialized PostgreSQL integration suite: **20/20 passed**, including the 19-route Decision Continuity HTTP matrix plus BrainX API RBAC/tenant/strict-schema assertions, durable workflow/outbox/recovery, governed promotion, QAgent, and BrainX persistence tests.
- Current-source frontend model suite: **17/17 passed**. Current-source frontend production build passed (2166 modules transformed). Backend syntax checks, `docker compose config --quiet` with a non-secret placeholder database URL, and `git diff --check` passed.

### Remaining production activation actions and risks

- Keep `BRAINX_ENABLED=false` and `BRAINX_LIVE_PROVIDER_ENABLED=false` until migration 009 is deployed; approved human/read/admin and distinct execution identities are provisioned; and each tenant has reviewed pinned artifact provenance, licence/attribution/data-use terms, sensitivity/region/egress policy, fixture health evidence, budgets, monitoring, cancellation/circuit/kill drills, and recovery ownership.
- No live provider adapter, model download, accelerator allocation, or cloud job interface is supplied. Any future live evaluation must remain explicit opt-in, pinned, budget-capped, independently reviewed, and separately deployed.
- Route/evaluation telemetry is operational attribution only, not proof that a model caused a quality improvement. Independent critique/provider diversity is a minimum separation control; final Decision Continuity policy and human approval remain required.

GATE: PASS — the Step 6 implementation gate is satisfied. BrainX is an optional, disabled-by-default governed registry with durable tenant-scoped provenance, strict policy routing, isolated fixture-only execution, bounded failure controls, independent-evaluation separation, no final authority, and green focused/frontend/real-PostgreSQL validation. Production activation remains blocked pending the documented tenant and operator controls.

## Step 7 — evidence-backed Suggested Next and Intel proposals

Recorded: 2026-08-10  
Scope: non-executing, tenant/workspace-scoped review records in the existing Decision Continuity ledger.

### Delivered controls

- `010_suggestion_intel_governance.sql` adds governed suggestion and Intel capability-proposal entities to the existing ledger and service-admin restriction; it does not create a parallel registry.
- `SuggestionIntelGovernance` records trusted trigger/evidence/branch links, bounded action and success conditions, cost/risk/reversibility, blockers, expiry, deterministic deduplication metadata, policy/lifecycle links, untrusted model rationale separated from authoritative facts, revisions, and evaluation/approval invalidation.
- Intel proposals preserve required registry/ledger/graph/authorized-vector reuse searches and create rationale, full risk/cost/test/metric/rollout/rollback/owner fields, and never use vector similarity as identity or authority.
- Dedicated human read/edit/review RBAC and originator/reviewer separation protect APIs. The overview UI makes blockers, facts, rationale, policy, and Step 4 link distinct. Neither suggestions nor Intel can install, enable, grant, download, or deploy.

### Validation evidence

- `apps/backend/test/suggestionIntelGovernance.test.js`: **4/4 passed**; covers trusted cleared-event creation/deduplication, blockers and edit invalidation/history, mandatory reuse evidence/rationale, no self-authority/cross-tenant denial, and Step 4 link gating.
- Local migration runner applied `010_suggestion_intel_governance.sql` after migrations 002–009. Backend syntax checks passed. Current-source frontend production build completed successfully.

### Remaining production actions and risks

- Provision reviewed human memberships before exposing edit/review APIs. Keep any automatic generation integration disabled; this slice accepts records only through authenticated human APIs and does not activate QD/neuroevolution.
- A Step 4 promotion link is a traceability/control link, not a substitute for creation, validation, policy, approval, canary, outcome, or rollback on the governed promotion request.

GATE: PASS — Step 7 supplies non-executing, evidence-backed suggestion/Intel review surfaces with lifecycle linkage, inspectable reuse/deduplication, enforced invalidation/blockers, and focused validation. Production execution remains exclusively governed by Step 4.

## Step 8 — operational hardening

Recorded: 2026-08-10

### Delivered controls and evidence

- Removed literal Apify credentials from `.env.example`; examples now contain placeholders only. Added `PLUTONIX_SECRETS_PROVIDER`, `PLUTONIX_ENCRYPTION_KEY_REF`, `PLUTONIX_EGRESS_ALLOWLIST`, and bounded API-body configuration.
- `apps/backend/src/operationalSecurity.js` provides structured redaction and an OpenTelemetry-log-compatible JSON envelope (service resource, 32-hex trace ID, 16-hex span ID, HTTP semantic attributes). `x-request-id` is echoed for correlation. A tenant hash is emitted only after membership authorization resolves it; no client tenant selector is trusted for telemetry. Production startup now rejects file authority, non-durable workflows, development authentication, explicitly insecure secrets-provider modes, and missing/wildcard secrets/encryption/egress configuration. Docker Compose forwards the required references to the API and worker.
- `apps/backend/test/operationalSecurity.test.js`: **2/2 passed**, covering headers/tokens/database URLs/provider keys/protected evidence fields, non-sensitive metadata retention, OTEL-compatible ID shape, and production fail-closed configuration. The real PostgreSQL HTTP authorization matrix also passed **1/1**, covering **19 routes and 149 matrix HTTP requests**, plus a 413 oversized-body case that returns the supplied correlation header without reflecting the submitted marker. It demonstrated authorized tenant-safe request telemetry. Syntax and diff checks passed.
- Backend production dependency scan: `npm audit --omit=dev --json` reported **0 critical, 0 high, 0 moderate, 1 low** vulnerability: transitive `body-parser` invalid-limit denial of service. Frontend production dependency scan reported **0 findings** across 102 production and 53 optional dependencies. No SBOM/container scan or signed-artifact claim was made.

### Blockers and next gate

- No configured encrypted artifact backup target, isolated restore environment, deletion-propagation worker, OTel exporter/alerts backend, production object storage, container scanner/SBOM tool, signing credentials, or measured SLO source exists in this workspace. Therefore no real restore timing, retention/deletion verification, alert delivery, image provenance, or achieved SLO can be claimed. The removed example Apify credential must be rotated/revoked and assessed for history exposure outside this workspace.
- `docs/operational-hardening.md` records the required backup/restore, retention/deletion, OTel/alerts, staging/production isolation, container hardening, and incident-runbook work before a production readiness gate.
- The Decision Continuity worker and migration Compose profiles now run as non-root `node` with read-only roots, all capabilities dropped, `no-new-privileges`, and a constrained temporary filesystem. The general API composition remains a production blocker because it mounts a writable workspace, Codex home, and Docker socket.
- Dockerfile dependency installation now uses the root workspace lock with `npm ci --omit=dev`; its install layer completed and reproduced the one low dependency finding. The full local image build was cancelled after duplicate local build jobs stalled, so no full-image build, image scan, SBOM, or provenance assertion is recorded.

GATE: BLOCKED — local redaction, production fail-closed configuration, and dependency audit are verified, but the required isolated backup/restore, deletion propagation, full lifecycle telemetry/alerts, SBOM/container scanning, and production deployment hardening have not been configured or exercised.

## Step 8 remediation 08A — secret incident, history, and runtime-artifact review

Recorded: 2026-08-10  
Result: **BLOCKED**

### Scope and changes

- Added `.gitleaks.toml`, `scripts/secret-scan.sh`, `.github/workflows/secret-scan.yml`, and `docs/secret-scanning.md`. The local and CI control uses Gitleaks v8.30.0 pinned to image digest `sha256:691af3c7c5a48b16f187ce3446d5f194838f91238f27270ed36eef6359a574d9`, full Gitleaks redaction, default rules, no allowlist, a bounded temporary worktree staging area, full reachable-history mode, and repository-owned artifact-root scans.
- Added `npm run secret:scan` and `npm run secret:scan:verify-fixture`. The fake-token verification creates an unmistakably fake token only in a temporary directory, requires the scanner to fail and redact it, removes it, then requires a clean scan.
- Expanded `.gitignore` and `.dockerignore` for real environment files, private-key containers, credential/secrets directories, and repository runtime artifacts while preserving `.env.example` as the only example configuration file included in a Docker build context.
- Added `docs/production-readiness/incidents/2026-08-10-apify-credential-exposure.md`. It explicitly records that the safe credential identifier, owner, discovery time, affected deployed environments, provider rotation/revocation status, and revocation timestamp have not been supplied.
- Extended `apps/backend/test/operationalSecurity.test.js` to prove the fake scanner fixture is redacted from structured log, error-shaped, trace, and report-shaped records.

### Sanitized evidence and findings

Command (completed):

```sh
docker run --rm --memory=2g --cpus=2 --pids-limit=256 \
  -v "$PWD:/repo:ro" \
  -v "$PWD/runtime/secret-scan/08a-manual-20260810:/reports" \
  zricethezav/gitleaks@sha256:691af3c7c5a48b16f187ce3446d5f194838f91238f27270ed36eef6359a574d9 \
  detect --source /repo --log-opts='--all' --config /repo/.gitleaks.toml \
  --redact=100 --report-format json \
  --report-path /reports/reachable-git-history.gitleaks.json \
  --max-archive-depth=3 --max-decode-depth=1 --max-target-megabytes=32 \
  --timeout=900 --no-banner --no-color
```

- Exit code: `1`; scan duration was not captured by the pre-control manual container invocation and is deliberately not estimated.
- Evidence: `runtime/secret-scan/08a-manual-20260810/reachable-git-history.gitleaks.json` (30,333 bytes, 32 findings, all `Secret` fields confirmed `REDACTED`).
- Rule counts: 18 `generic-api-key`, 13 `gcp-api-key`, and 1 `openai-api-key` finding. Metadata points to the historical `.env.example` incident plus generated memory, telemetry, archive, test, and usage artifacts. Every finding remains open and requires owner triage; no secret value was copied into this status record.

### Runtime-artifact inventory and residual review work

Repository-owned roots present at review time: `runtime` (293 files, 125,002,099 bytes, 6 archives); `memory` (275 files, 12,896,656 bytes); `observability` (56 files, 118,899,669 bytes); `deliverables` (8,538 files, 1,157,585,729 bytes, 2 archives); `apps/frontend/dist` (22 files, 157,551,871 bytes, 1 archive); and `apps/generated-site/dist` (10 files, 545,912 bytes).

The complete artifact-root scan cannot be reported clean: the reachable-history scan already produced unresolved findings, and three earlier unconstrained local scanner attempts created resource-intensive processes that were stopped. The checked-in control now has a 32 MiB individual-file limit and an `unscannable-large-files.tsv` evidence inventory to keep future runs bounded; large archives still require an approved, format-appropriate scan. `${HOME}/.codex` is mounted only by the development Compose service, is outside the repository and not repository-owned, and was not scanned.

### Tests and exact results

- `sh -n scripts/secret-scan.sh && sh scripts/secret-scan.sh verify-fixture` — exit 0; fake-token detection, report redaction, expected failing scan, and post-removal passing scan verified (26.8 seconds observed wall time).
- `docker run --rm -v "$PWD/apps/backend/src:/workspace/backend/src:ro" -v "$PWD/apps/backend/test:/workspace/backend/test:ro" plutonix-backend:latest node --test test/operationalSecurity.test.js` — exit 0; 3 passed, 0 failed, 2.056 seconds.
- `docker run … gitleaks … detect --source /repo --log-opts='--all' …` — exit 1; 32 redacted unresolved findings; duration not captured as noted above.

### User action required and blockers

1. Provide non-secret evidence of the affected Apify credential's provider-side revocation/rotation: approved safe identifier or one-way fingerprint, owner, affected environments, and timestamp. Do not provide a credential value.
2. Assign an authorized data owner to triage and remediate the 32 scanner findings, including current generated artifact findings. Do not delete generated exports, logs, archives, or history without explicit ownership and authorization.
3. Run the bounded complete artifact-root scan after the findings are remediated, and use a format-appropriate scanner for the large disk-image/archive inventory. Re-run the same 08A subgate afterward.

Residual risks: current secrets may remain in generated artifacts; historical secrets remain reachable; the scanner CI workflow is added but has not executed in GitHub Actions; client bundle and all artifact roots have not completed a clean post-remediation scan. No provider revocation, artifact cleanup, history rewrite, CI execution, or external account action is claimed.

SUBGATE 08A: BLOCKED

## Step 8 supporting Compose interpolation correction

Recorded: 2026-08-11  
Scope: local development startup only; no credential, Git history, production profile, worker, migration, or external system was changed.

`docker-compose.yml` no longer uses Compose's required-variable interpolation for `DECISION_CONTINUITY_DATABASE_URL` in the inactive `decision-continuity-worker` and `decision-continuity-migrate` profiles. Compose interpolates every declared service before profile selection, so the former expression incorrectly prevented the ordinary development stack from starting when no production database URL was configured. Both the worker entry point and migration script independently reject an empty database URL at runtime, preserving the fail-closed production boundary when either profile is explicitly enabled.

Validation:

```sh
DECISION_CONTINUITY_DATABASE_URL='' docker compose config --quiet
git diff --check
./run.sh --no-build
./run.sh --status
```

- `docker compose config --quiet` and `git diff --check` exited 0 in 1.9 s.
- `./run.sh --no-build` exited 0 in 18.5 s; backend `/api/status`, frontend, and generated site all became ready.
- `./run.sh --status` exited 0 in 1.1 s. The normal backend, frontend, and generated-site services are running; the decision-continuity worker is not active. A pre-existing local PostgreSQL helper container was already running and was preserved.

Files changed: `docker-compose.yml`, `docs/production-readiness/STATUS.md`.

Residual risk: enabling either production Decision Continuity profile still requires an authoritative PostgreSQL URL and the separate production identity/operational configuration; this correction does not configure or activate those services.

STEP 08A: IN PROGRESS — Apify owner evidence is recorded in 08A1A; scan amplification, canonicalization, ownership, dispositions, and coverage work remain outstanding.

## Step 8 remediation 08A1A — Apify owner-evidence closure

Recorded: 2026-08-11T12:41:57Z  
Result: **PASS — Apify owner evidence recorded; overall Step 08A remains in progress**

### Scope and repository-controlled changes

- Normalized `docs/production-readiness/evidence/08a-owner-evidence.md` and added the sanitized revocation and health-check records. The owner-approved Apify chronology is `2026-08-11T10:41:00Z < 2026-08-11T11:07:55Z < 2026-08-11T11:08:55Z < 2026-08-11T11:11:26Z`; all provider-console and Development-health facts are OWNER_ASSERTED unless independently noted.
- Added `scripts/reconcile-secret-findings.mjs` and `scripts/verify-08a-reconciliation.mjs`. They reject unsafe source reports, create a one-to-one `OCC-*` manifest from safe scanner metadata only, group only exact safe scanner-fingerprint matches, and fail closed for dropped/duplicated mappings, unsupported dispositions, or closed records lacking a UTC timestamp and sanitized evidence reference.
- Added `scripts/inventory-08a-artifacts.mjs` and `scripts/verify-08a-artifact-inventory.mjs`. The inventory uses `lstat`, does not follow links or read artifact contents, and rejects CLEAN/FINDINGS_RECONCILED records that lack scan evidence.
- Updated `scripts/secret-scan.sh` and `docs/secret-scanning.md`: every generated report is structurally checked for redaction, unsafe generated reports are removed without printing them, scanner console output is not persisted, and the bounded scanner uses a 2 GiB/2 CPU default. No allowlist was added.
- Added package scripts for the reconciliation and inventory controls. Generated evidence: `docs/production-readiness/evidence/08a-finding-reconciliation.md`, `docs/production-readiness/evidence/08a-artifact-inventory.md`, and ignored runtime evidence under `runtime/secret-scan/20260811T122836Z/`.

### Sanitized scan and reconciliation evidence

Command (completed):

```sh
SCAN_TIMEOUT_SECONDS=900 SECRET_SCAN_MEMORY_LIMIT=2g SECRET_SCAN_CPUS=2 \
  sh scripts/secret-scan.sh scan
```

- Exit code: `1` (findings; not a scanner crash). Per-scope durations in the generated summary total 280 seconds.
- Every one of the nine generated JSON reports passed the structural guard: all `Secret` fields were exactly `REDACTED` and all `Match` fields contained a redaction marker. No raw field was output or retained in the handoff documentation.
- Worktree: 15 occurrences (12 generic API-key-rule, 1 GCP API-key-rule, 2 OpenAI API-key-rule), exit 1, 14 seconds. The scan intentionally included local `.env` paths; their contents were not opened.
- Reachable history: 32 occurrences (18 generic, 13 GCP, 1 OpenAI), exit 1, 67 seconds.
- Runtime: 14,786 occurrences (14,750 generic, 24 GCP, 6 AWS-access-token, 6 LinkedIn-client-ID), exit 1, 137 seconds. Memory: 22 occurrences (10 generic, 10 GCP, 2 OpenAI), exit 1, 15 seconds. Observability: 2 GCP occurrences, exit 1, 3 seconds.
- Deliverables, frontend dist, generated-site dist, and desktop resources reported 0 findings under the configured bounds (exit 0; 29, 9, 3, and 3 seconds respectively). This does not override separate unscannable/archive/disk-image statuses.
- `runtime/secret-scan/20260811T122836Z/finding-reconciliation.sanitized.json` maps 14,857 source occurrences exactly once to 14,798 logical items. Category totals are 14,790 generic API-key-rule, 50 GCP API-key-rule, 5 OpenAI API-key-rule, and 12 other-rule occurrences. All 14,798 logical items are `UNKNOWN`/`UNRESOLVED`; no rule label was treated as provider, owner, validity, or Apify proof.
- `runtime/secret-scan/20260811T122836Z/artifact-inventory.sanitized.json` records 21 roots/artifacts: 2 CLEAN, 2 FINDINGS_RECONCILED, 13 UNSCANNED, 4 UNSUPPORTED, and 0 approved exceptions. It includes 3 oversized-file, 6 archive, and 4 disk-image records.

### Local validation

- `sh -n scripts/secret-scan.sh && sh scripts/secret-scan.sh verify-fixture` — exit 0, 6.0 seconds observed. The fake-token regression detected, redacted, failed before removal, and passed after removal.
- Docker Node 22 syntax/reconciliation command over the five non-empty reports — exit 0, about 11 seconds observed; 14,857 occurrence mappings and 14,798 logical items validated.
- Docker Node 22 artifact inventory command — exit 0, about 13 seconds observed; 21 inventory records validated.
- Reconciliation validator with `--require-closure` — exit 1 as expected, reporting incomplete logical closure. Artifact validator with `--require-coverage` — exit 1 as expected, reporting incomplete artifact coverage. These expected failures prove the new gates fail closed.
- A disposable Docker Node test supplied a deliberately non-redacted synthetic report with no credential value. The reconciliation validator rejected it before manifest processing (exit 1 as expected), proving the raw-secret-field guard fails closed.
- `docker run --rm -v "$PWD/apps/backend/src:/workspace/backend/src:ro" -v "$PWD/apps/backend/test:/workspace/backend/test:ro" plutonix-backend:latest node --test test/operationalSecurity.test.js` — exit 0, 0.522 seconds reported by Node; 3 passed, 0 failed.
- `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/secret-scan.yml")'`, `sh -n scripts/secret-scan.sh`, `git diff --check`, and `docker compose config --quiet` — exit 0. Workflow syntax was parsed locally only; no remote run is claimed.
- `git check-ignore --quiet .env` — exit 0. Only ignore status was checked; `.env` content was not read.

### Apify owner-evidence result and remaining downstream work

- Apify owner remediation: **RECORDED**. The evidence classification is OWNER_ASSERTED, plus repository-verified Git-ignore and evidence-path metadata. No provider-console fact is promoted to PROVIDER_VERIFIED and no live old-credential test was performed.
- The replacement is owner-asserted to be stored only in local gitignored `.env` under `APIFY_API_TOKEN`; `git check-ignore --quiet .env` confirms ignore behavior without opening the file.
- `apify-revocation-sanitized.png` is repository-verified as a 2876 × 1362 PNG with SHA-256 `686f64afd5851e5c7b6671cb484a06bd5e47e5cfe3c567bfad5c1b005bd4f00a`. Its content status is `IMAGE_INSPECTION_NOT_AVAILABLE`, so it is supplemental only and not PROVIDER_VERIFIED.
- The Apify owner-evidence subgate is **PASS**. It does not close the incident, all credentials, 08A1, or Step 08A.
- Authorized to review GCP, OpenAI, and unidentified findings: **No**. Assigned authorized owner: **Not yet assigned**. Authorized owner assignment completed: **No**. Owner-assignment evidence: **Pending per-item assignment**. Evidence-backed dispositions completed: **No**. Remaining unresolved logical items: **14,798**.
- Scan amplification and canonicalization, archive/oversized-file/frontend-download/unsupported-format/disk-image coverage, and remote exact-commit CI evidence are carried forward to `08A1B` and later work. They do not block 08A1A.

Files changed for 08A1A: `docs/production-readiness/evidence/08a-owner-evidence.md`, `docs/production-readiness/evidence/apify-revocation-sanitized.md`, `docs/production-readiness/evidence/apify-post-rotation-health-check.md`, `docs/production-readiness/incidents/2026-08-10-apify-credential-exposure.md`, the scoped owner-evidence validator, and this status record.

Residual risks: Apify provider-console and Development-health facts remain OWNER_ASSERTED rather than PROVIDER_VERIFIED; 14,798 non-Apify/unlinked logical items remain unresolved; artifact coverage is incomplete; and remote exact-commit CI evidence is not yet available.

SUBGATE 08A1A: PASS
STEP 08A: IN PROGRESS
NEXT SUBGATE: 08A1B

## Step 8 remediation 08A1B — secret-scan normalization and canonical inventory

Recorded: 2026-08-12
Result: **PASS — mechanically trustworthy and triageable; no credential is closed**

### Provenance and count bridge

- Source run: `20260811T211215Z`, using nine structurally redacted reports, the pinned Gitleaks image digest, the checked-in scanner configuration, and reviewed commit boundary `d96548231bfec7c85cd81cc20feac70be6e39e9f`.
- Earlier reachable-history observations: 32. Current reachable-history observations: 35. The sanitized count bridge records the three-observation increase; it is retained for owner triage rather than suppressed.
- Current source observations: 14,908. Canonical occurrences: 14,849. Logical items: 14,849. Unresolved logical items: 14,849.
- The 59-observation canonical reduction is limited to same normalized object/location, object marker, rule, line span, and scanner-native finding identity. Scanner-native fingerprints are documented location-oriented metadata, not credential-equality proof. Without a safe equality identifier, each canonical occurrence remains a separate logical item.
- Safe source-class totals: runtime source 14,792; archive or backup content 46; reachable-history source 30; memory source 22; worktree source 10; test or fixture content 6; observability source 2.

### Controls and evidence

- `scripts/secret-scan.sh` stages `runtime/` without `runtime/secret-scan/` for the producing runtime scan. Generated scanner reports remain independently checked for redaction before consumption; no broad allowlist or coverage reduction was introduced.
- `scripts/reconcile-secret-findings.mjs` now produces the three-layer `scan_observation` → `canonical_occurrence` → `logical_item` model. The companion validator checks redaction-first parsing, stable IDs, forward/reverse links, count reconciliation, no raw-bearing fields, and conservative logical grouping.
- `docs/production-readiness/evidence/08a-scan-count-bridge.md`, `08a-finding-reconciliation.md`, and `08a-owner-action-inventory.md` contain the sanitized provenance, counts, and source-owner investigation queues.

### Handoff

All 14,849 logical items remain `UNKNOWN` / `UNRESOLVED` and require actual authority/provider evidence in 08A1C. Archive, oversized-file, frontend-download, unsupported-format, and disk-image coverage remains 08A1D work. These subgates may proceed independently.

SUBGATE 08A1B: PASS

## Step 8 remediation 08A1C — authorized-owner resolution and evidence-backed dispositions

Recorded: 2026-08-11T21:51:32Z
Result: **BLOCKED — repository-local authority/disposition work is complete; external owner and provider evidence is absent**

### Inventory and authority validation

- Revalidated the 08A1A owner-evidence gate and the 08A1B three-layer invariant against fresh run `20260811T214249Z`: 14,908 structurally redacted observations, 14,849 canonical occurrences, and 14,849 logical items. The 08A1B observations/canonical occurrences were preserved as source evidence.
- Added a fail-closed 08A1C authority/disposition generator and validator. It permits only the explicit terminal enum, requires a scoped time-valid active authority, safe authority-to-item linkage, verified provider identity, independent chronology/evidence, and deterministic proof plus regression coverage for fixtures or false positives.
- Created `08a-owner-authority-matrix.md`, `08a-owner-dispositions.md`, `08a-owner-dispositions.sanitized.json`, and a grouped one-row-per-logical-item `08a-owner-action-inventory.md`. The queue contains 14,807 runtime-artifact, 19 reachable-history, 15 current-tree, 6 memory-artifact, and 2 observability-artifact items.
- The 08A1A Apify authority remains OWNER_ASSERTED and scoped to the named Development credential only. No safe equality/provenance linkage connects that alias to an 08A1B logical item, and no repository-approved 08A1C terminal policy accepts OWNER_ASSERTED evidence. It was not reassigned to GCP, OpenAI, generic-rule, other-rule, or unidentified items.

### Result totals

| State | Count |
| --- | ---: |
| `REVOKED` | 0 |
| `ROTATED_OLD_INVALIDATED` | 0 |
| `DELETED_AT_PROVIDER` | 0 |
| `PROVEN_INVALID` | 0 |
| `VERIFIED_FALSE_POSITIVE` | 0 |
| `VERIFIED_SYNTHETIC_FIXTURE` | 0 |
| `OWNER_ASSIGNMENT_REQUIRED` | 14,849 |
| `OWNER_ACTION_PENDING` | 0 |
| `PROVIDER_VERIFICATION_PENDING` | 0 |
| `EVIDENCE_INVALID` | 0 |
| `UNRESOLVED` | 0 |
| UNKNOWN provider identity (separate dimension) | 14,849 |
| Hidden non-terminal state | 0 |

### Local validation

- 08A1A owner evidence validator, 08A1B reconstruction validator, and 08A1B synthetic tests passed.
- 08A1C synthetic positive closure and negative expiry, missing-authority, state, evidence, chronology, invalidation, history-only, image-only, broad-batch, evidence-reuse, duplicate-closure, and hidden-state tests passed.
- The current 08A1C resolution validator passed with 14,849 non-terminal primary states. Closure mode remains expected to fail until external evidence exists.

### Exact residual action

For every row in `docs/production-readiness/evidence/08a-owner-action-inventory.md`, the accountable provider or source-service owner must first provide a named, scoped, time-valid authority record with a sanitized evidence reference and approval timestamp. That owner must then establish provider identity and credential validity from a safe identifier or deterministic provenance, remediate reachable exposure where applicable, and provide independently verifiable terminal evidence. The acceptance criterion is enforced by the checked-in validator; it rejects current-tree-only removal, unlinked authority, provider labels, images alone, and overbroad batches. `08A1D` may proceed independently for artifact coverage.

SUBGATE 08A1C: BLOCKED

## Step 8 remediation 08A1B-R2 — memory-only candidate reconstruction

Recorded: 2026-08-12T19:08:40Z
Result: **PASS — fresh source bytes were reconstructed only in memory into exact candidate-equivalence classes; no credential value or equality tag was persisted**

### Corrected gate baseline and source bridge

- Before this R2 result, the corrected baseline was: 08A1A PASS; 08A1B REOPENED; 08A1C NOT ELIGIBLE; 08A1D coverage PASS with V1 mapping provisional; and 08A1E NOT ELIGIBLE.
- Fresh run `20260812T190840Z` used the pinned scanner digest, checked-in configuration SHA-256, nine scoped inputs, the recorded commit boundary, and output-root exclusion before any R2 evidence was generated.
- Fresh observations are 14,984: runtime 14,912 (+78), reachable history 34 (-1), worktree 14 (-1), memory 22, observability 2, and all four build/export scopes 0. The net +76 versus the pre-R2 14,908 baseline is retained as a source-scope delta, not silently carried forward.
- R2 creates 14,937 canonical occurrences and 1,068 logical candidate classes. The +88 canonical delta is the +76 fresh-observation delta plus 12 V1 location/fingerprint collisions now separated by direct in-memory candidate bytes. The 14,849 V1 logical items are superseded by 1,068 exact R2 candidate classes; this is equality reconstruction, not provider, owner, validity, or disposition evidence.

### Safety and provenance result

- Every canonical occurrence belongs to exactly one candidate-equivalence class. Equality uses a fresh in-memory HMAC partition followed by constant-time byte comparison; raw candidates, HMAC keys/tags, fragments, and derived candidate hashes are not written.
- R2 recorded 1 deterministic Path A synthetic fixture closure and 1,067 plausible credential classes. The fixture's current committed source and regression assertions are validated; its exact historical copy inherits that proof only through the R2 equality class.
- Provenance totals are generated output 14,870, copied source 31, memory capture 12, primary source 10, test fixture 6, observability capture 4, and explicit unknown 4. Scanner-output recursion is 0 and unreconstructed candidates are 0.

### Downstream invalidation

- 08A1C-R3 remains **NON-ACTIONABLE**. Its V1 logical memberships, authority requests, provider-evidence requests, and intake assumptions must be rebuilt from the R2 equivalence inventory before any external action or inference.
- 08A1D retains its coverage evidence only. All V1 canonical/logical mappings are **PROVISIONAL_PENDING_R2_REVALIDATION**; they are not R2 equality, owner, provider, or terminal-disposition proof.
- 08A1E remains **NOT ELIGIBLE** until the R2-aware 08A1C revalidation and any necessary 08A1D mapping revalidation are complete.

### Local validation

- `npm run secret:reconcile:08a1b` completed the fresh direct scan and `--require-pass` R2 validation successfully.
- The R2 synthetic suite covers repeated copies, cross-scope equality, unequal history, location-fingerprint ambiguity, overlap, provenance, Path A fixture inheritance, unavailable source bytes, non-disclosure, collisions, recursion, inflation, deltas, and reruns.

Evidence: `08a1b-r2-count-and-provenance-bridge.md`, `08a1b-r2-candidate-provenance.sanitized.json`, `08a1b-r2-equivalence-classes.sanitized.json`, `08a1b-r2-logical-credential-inventory.sanitized.json`, and the R2 `08a-owner-action-inventory.md`.

SUBGATE 08A1B: PASS

## Step 8 remediation 08A1C-R3 — authority-domain decomposition and external-evidence intake

Recorded: 2026-08-12
Result: **BLOCKED — the reachability/authority-model defect is corrected locally; source-owner and provider evidence is still absent**

- Revalidated the unchanged 08A1B inventory: 14,908 observations, 14,849 canonical occurrences, and 14,849 logical items. Path A still closes exactly one deterministic committed fixture as `VERIFIED_SYNTHETIC_FIXTURE`; 14,848 Path B items retain exactly one `OWNER_ASSIGNMENT_REQUIRED` state and there are no hidden states.
- Replaced the invalid five-bucket “authority domain” grouping with 11 exact source-scope investigation domains. Reachability stays separate: CURRENT_TREE=14, MEMORY_ARTIFACT=6, OBSERVABILITY_ARTIFACT=2, REACHABLE_HISTORY=19, and RUNTIME_ARTIFACT=14,807. It proves neither ownership nor provider scope.
- The 11 domains are source-system/root boundaries, not provider guesses: self-improvement runtime (14,792), staged project media (15), project-intelligence memory (12), repository configuration ingress (10), backend operational tests (5), agent-efficiency observability (4), archived workspace (4), orchestration policy (2), agent-token ledger (2), legacy agent workspace (1), and self-improvement observability (1).
- Generated `docs/production-readiness/evidence/08a1c-external/` with bidirectional logical/canonical/domain membership, one authority request and one provider-evidence request per domain, an external-action manifest, empty safe intake ledger, and deterministic validation. Provider credential groups=0 and safe authority linkages=0.
- The 08A1A Apify OWNER_ASSERTED record remains explicitly unlinked and is not reused. No provider identity, account, project, service, deployment, environment, credential equality, revocation, rotation, deletion, or terminal result is inferred or performed.
- `scripts/verify-08a1c-external-evidence.mjs` and tests fail closed for reachability-as-authority, provider guesses, membership/fixture leakage, timestamp drift, unsafe linkage, malformed action state, redaction, and rerun drift. 08A1D artifact consistency accepts the v3 disposition schema and remains independently PASS.

Evidence: `08a1c-external/README.md`, `authority-domains.sanitized.json`, `reachability-to-authority-map.sanitized.json`, `external-action-manifest.sanitized.json`, `evidence-intake.sanitized.json`, `08a-owner-authority-matrix.md`, `08a-owner-dispositions.sanitized.json`, and `08a1c-count-bridge.md`.

SUBGATE 08A1C: BLOCKED

## Step 8 remediation 08A1D — bounded read-only artifact coverage

Recorded: 2026-08-11T23:04:26Z
Result: **PASS — complete configured artifact coverage; owner disposition remains an independent 08A1C blocker**

- Added configuration-derived discovery for Docker build inputs, runtime exports/staged media, generated memory, observability, and packaged deliverables. Scanner report directories and external development mounts are excluded from application coverage.
- The control uses `lstat` without following links; ZIP integrity/listing preflight, traversal/link/encryption/entry/ratio limits, bounded temporary extraction, static string scanning, cleanup verification, and streamed static-string scanning for oversized regular/binary content. No artifact is executed.
- Run `20260811T214249Z` covers 10 roots and 7 special artifacts: `CLEAN=11`, `FINDINGS_MAPPED_PENDING_DISPOSITION=8`, `UNSCANNED=0`, `UNSUPPORTED=0`, approved exclusions `=0`, and unmapped observations `=0`.
- The three staged-media archive records have six redacted static observations mapped to their existing 08A1B archive logical items. They are coverage-complete but remain pending owner disposition; no credential equality, provider identity, or terminal status is inferred.
- Evidence: `docs/production-readiness/evidence/08a-artifact-inventory.md`, `08a-artifact-coverage-summary.md`, and structurally redacted runtime reports under `runtime/secret-scan/20260811T214249Z/artifact-coverage-08a1d-v12/`.

`08A1C` remains BLOCKED for external authority/provider evidence across the 14,849 logical items; 08A1D does not change that dependency.

SUBGATE 08A1D: PASS

## Step 8 remediation 08A1C-R1 — residual-queue reclassification and closure-policy repair

Recorded: 2026-08-12
Result: **BLOCKED — repository-proven closure is complete; 14,848 items still need external owner/provider evidence**

> Historical R1 note: its “five compact external action groups” were reachability buckets. They are superseded by the 11 source-scope authority domains in 08A1C-R3 above and must not be interpreted as authority, provider, or credential groupings.

### Corrected evidence paths and count bridge

- The prior all-external 08A1C outcome is retained as superseded baseline evidence. Its defect was applying Path B authority/provider requirements to Path A repository-fact dispositions. The corrected validator makes the paths disjoint: Path A permits only repository-proven `VERIFIED_FALSE_POSITIVE` or `VERIFIED_SYNTHETIC_FIXTURE`; Path B permits provider action only with scoped active authority, verified provider identity, safe linkage, required provider evidence, and chronology.
- Reconciliation remains immutable at 14,908 observations, 14,849 canonical occurrences, and 14,849 logical items. The previous normalized inventory had 14,857 observations, 14,798 canonical occurrences, and 14,798 logical items. The exact increase is 51 at each layer; it is real inventory growth, not a duplicate projection. The existing 59-observation canonical reduction remains a separate source-observation fact.
- Repository fact discovery classified every logical item without opening local `.env` files. Exactly one committed, deterministic, non-provider operational-security test fixture has canonical membership, deterministic generator provenance, safe proof metadata, source/validator versions, and regression references. It is closed as `VERIFIED_SYNTHETIC_FIXTURE` through Path A without an authority or provider assertion.

### Current authoritative totals

| Dimension | Count or status |
| --- | ---: |
| `VERIFIED_SYNTHETIC_FIXTURE` terminal disposition | 1 |
| Other terminal dispositions | 0 |
| `OWNER_ASSIGNMENT_REQUIRED` primary state | 14,848 |
| Hidden non-terminal state | 0 |
| Path A repository-fact records | 1 |
| Path B authority/provider records | 14,848 |
| UNKNOWN provider identity | 14,849 |
| Compact external action groups | 5 |

### Preserved boundaries and validation

- The 08A1A Apify record remains OWNER_ASSERTED, Development-scoped, and unlinked to the scanner inventory. It does not authorize GCP, OpenAI, generic-rule, or unidentified items. Historical HUMAN provider-writing references are superseded context and not terminal evidence.
- `scripts/test-08a1c-owner-dispositions.mjs` now proves Path A fixture and masked-derivative acceptance, rejection of provider-shaped fixture without generator proof, document-label-only proof, provider action through Path A, Path B without authority, duplicate projection, broad batches, evidence reuse, count drift, and unchanged rerun stability.
- `scripts/verify-08a1d-artifact-coverage.mjs` now receives the disposition register for lightweight artifact-to-logical consistency. A mapped artifact can be `FINDINGS_RECONCILED` only when every linked logical item is terminal; the current eight mapped records remain pending, so 08A1D's passed coverage result is unchanged.

### Evidence

`08a1c-evidence-path-policy.md`, `08a1c-count-bridge.md`, `08a1c-repository-facts.sanitized.json`, `08a-owner-authority-matrix.md`, `08a-owner-dispositions.md`, `08a-owner-action-inventory.md`, and `08a-finding-reconciliation.md` now carry the current 08A1C-R1 state.

SUBGATE 08A1C: BLOCKED

## Current 08A1B-R2 gate record — supersedes the V1/R1/R3 mappings above

The fresh 08A1B-R2 run `20260812T190840Z` is now the source of truth: 14,984 observations, 14,937 canonical occurrences, one deterministic Path A fixture, and 1,067 plausible credential classes (1,068 exact candidate-equivalence classes total). It passed the memory-only reconstruction validator with zero unreconstructed candidates and zero scanner-output recursion.

The fresh source delta is fully retained: runtime +78, reachable history -1, worktree -1, net +76 observations. R2 separates 12 V1 location/fingerprint collisions with different candidate bytes, accounting for the +88 canonical delta. The V1/R3 source item, authority, provider, disposition, and 08A1D mapping records above are historical only.

Current downstream state: 08A1A PASS; 08A1C-R3 NON-ACTIONABLE pending R2-aware membership rebuild; 08A1D coverage retained with mapping PROVISIONAL_PENDING_R2_REVALIDATION; 08A1E NOT ELIGIBLE. No external authority, provider, remediation, or credential action is claimed.

SUBGATE 08A1B: PASS
