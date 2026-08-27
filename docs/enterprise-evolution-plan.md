# PlutoniX Enterprise Evolution Plan

Status: active implementation plan  
Scope: governed decision continuity for the existing PlutoniX control plane

## Current capability map

| Area | Existing evidence | Current state |
| --- | --- | --- |
| React operator surface | `apps/frontend/src/App.jsx`, `apps/frontend/src/functionalityGraphModel.js` | Existing Builder, PlutoniX, Agents, Hosting, graph, Intel, and suggestion surfaces. |
| Express control-plane API | `apps/backend/src/server.js` | REST, SSE runtime events, project lifecycle, self-improvement, Intel profiles, model-pool, and generated-project endpoints. |
| File-backed operational records | `apps/backend/src/selfImprovement/store.js`, `apps/backend/src/projectManager.js` | JSON/JSONL records and registries; suitable for a backwards-compatible local ledger adapter, but not a multi-node transactional database. |
| Existing governance primitives | `apps/backend/src/selfImprovement/{policy,validation,controlPlane}.js` | Candidate validation, monetary approval, promotion decision, rollback record, risk policy, and proposal evidence exist for self-improvement. |
| Intel | `apps/backend/src/{intelProfiles,intelOrchestration,intelVerification}.js` | Profile selection, score-gated proposals, one writer, bounded repair, deterministic validation, and independent verification. |
| QAgentic | `qagentic-support/`, `apps/backend/src/projectBootstrap.js` | Project-local QAgent scaffolding and next-instruction contracts exist; no durable branch-aware investigation ledger yet. |
| Graph and vector projections | `apps/backend/src/projectAgents.js`, `topology/d3/`, `graph/neo4j/`, `apps/backend/src/vectorMemorySync.js` | Local graph/D3 artifacts and safe idle-only vector synchronization. Neo4j/vector remain projections rather than an authoritative decision record. |
| Identity and authorization | `apps/backend/src/auth.js`, `apps/backend/src/identityAccess.js`, migration `006_decision_continuity_identity_access.sql` | Provider-neutral verified OIDC, principal/membership authority, tenant/workspace RBAC, service scopes, authorization audit, and worker rechecks now protect the Decision Continuity surface. |
| Structured schema history | `database/agent-knowledge.schema.graphql`, `database/migrations/001_agent_knowledge_registry.sql` | Agent knowledge schema exists. There is no branch/evidence/constraint/event schema or migration. |

## Gap map and decisions

1. **Authoritative branch record is missing.** Add a local durable ledger with atomic snapshot writes and append-only JSONL domain events. It is an additive, single-instance runtime adapter; a production relational/event-store adapter remains an explicit infrastructure follow-on.
2. **Current proposal records are domain-specific.** Preserve them and add an adapter boundary rather than replacing Intel or self-improvement records.
3. **Constraints are not declarative or trusted.** Add a Zod-validated expression language (`all`, `any`, `not`, leaf predicates) with fail-closed `unknown`, `stale`, expired, and unauthorized observations.
4. **Reconsideration is not idempotent.** Add indexed revisit triggers, event fingerprints, cooldowns, budget controls, loop detection, and dead-letter records.
5. **Promotion records are incomplete across domains.** Reuse the existing validation/policy intent in a generalized lifecycle: evaluation → independent review → approval → canary → outcome/rollback. A branch can never promote itself.
6. **Tenant safety is implemented for Decision Continuity.** Verified OIDC subjects map to PostgreSQL principals and active tenant/workspace memberships; role/scope checks, service separation, SoD, and audit are enforced on every lifecycle route and worker effect. SAML remains brokered into this OIDC boundary; enterprise-wide adoption outside the Decision Continuity surface still needs infrastructure ownership.
7. **QAgents, Intel, BrainX, and QD need a common foundation.** Integrate them only after the P0 ledger lifecycle is proven end-to-end; do not create a competing store.

## Target data flow

```text
operator/service request
  -> tenant-scoped Branch Ledger (atomic snapshot + append-only events)
  -> constraint observation/event validation
  -> indexed, idempotent reconsideration request
  -> deterministic validation + independent evaluation
  -> server-enforced approval gate
  -> bounded canary outcome
  -> promotion or rollback/retention event
  -> graph/vector/score/UI projections (derived only)
```

The ledger is authoritative for the implemented slice. Graph, vector, fitness rankings, UI explanations, and suggestion text are rebuildable projections and must not authorize promotion.

## Ordered migration plan

### Phase 0 — Discovery and compatibility (complete)

- Publish this file-level gap map and acceptance checklist.
- Preserve existing project, Intel, QAgentic, self-improvement, graph, and vector behavior.

### Phase 1 — P0 branch ledger foundation (complete for the local single-instance adapter)

- `apps/backend/src/decisionContinuity.js` implements a versioned tenant/workspace-scoped branch ledger, atomic local snapshot, append-only domain journal, short-lived write lock, revision conflict handling, branch lineage, evidence, provenance, fitness vectors, content hashes, and historical transition payloads.
- Branches may be directly marked only non-promoting dispositions. Selection is possible only after the lifecycle records below; the P0 store itself has no deployment side effect.
- `apps/backend/src/server.js` exposes tenant-scoped branch, history, graph, and comparison APIs with bounded result limits.

### Phase 2 — P0 constraints and reactivation (complete for trusted local service events)

- The ledger validates safe `all`/`any`/`not` expressions and named constraint definitions; it never evaluates arbitrary code.
- Trusted, authorized, unexpired condition observations drive indexed reconsideration requests. Missing, stale, expired, invalid, or unauthorized observations fail closed.
- Replays use event idempotency keys. A per-tenant daily budget, cooldown, lock, and dead-letter path prevent runaway or duplicate local processing. A condition event can open a request only; it cannot select or deploy a branch.

### Phase 3 — P0 governed evaluation lifecycle (complete as an audit-only control-plane record)

- Evaluation requires a supplied deterministic-validator result and an independent reviewer. A versioned policy decision is then required before approval.
- Approval is default-deny until an operator allowlist is configured. Bounded canaries require traffic, duration, monitoring, success/failure thresholds, and a rollback plan. A severe regression forces a rollback record; none of these P0 operations deploys or mutates production.
- Existing self-improvement validation/policy records are preserved. A follow-on adapter should emit their proven validator/policy outputs directly into this ledger rather than creating a second promotion path.

### Phase 4 — P1 control-plane integration

- Make QAgents branch-aware uncertainty and experiment planners with bounded budgets and deduplication. **Step 5 is implemented as a feature-disabled-by-default QAgent adapter in the existing Decision Continuity ledger:** versioned tenant/workspace-scoped runs/effects, structured output, calibrated-proxy semantic deduplication, hard server limits, read-only collector boundary, deterministic provenance validation, independent-evaluator attachment, duplicate/restart recovery safety, operator visibility, and deterministic baseline/reflection/QAgent fixture comparison are in `apps/backend/src/qagentDecisionContinuity.js`, migration 008, and `docs/qagent-decision-continuity.md`. It still requires production collector registration, external identity provisioning, migration application, and a controlled deployment drill before activation.
- **Step 7 is implemented as a non-executing Decision Continuity adapter:** Suggested Next Instructions and Intel capability proposals have tenant/workspace-scoped evidence, revision/invalidation, explicit blocker/state controls, inspectable deterministic deduplication/reuse decisions, RBAC, and Step 4 promotion links in `apps/backend/src/suggestionIntelGovernance.js`, migration 010, and `docs/suggestion-intel-governance.md`. They cannot install, enable, grant, download, or deploy.
- **Step 6 is implemented as a feature-disabled BrainX model-governance layer in the existing Decision Continuity ledger:** immutable provider/model/artifact registrations, licence/data/region/egress routing eligibility, reproducible candidate/exclusion evidence, isolated fixture-only execution, strict untrusted-output validation, independent critique separation, idempotent usage effects, health/circuit/kill controls, and operator read/admin views are in `apps/backend/src/brainxModelRegistry.js`, migration 009, and `docs/brainx-model-registry.md`. It performs no model download, GPU allocation, cloud job, or live provider call; production activation still requires tenant-specific registration and deployment controls.
- **Enterprise BrainX governed rollout extends, rather than replaces, Step 6:** migration 011 and the Enterprise Brain services add immutable application/enterprise bindings, policy snapshots, budget envelopes/reservations, DecisionX contexts/outcomes, ResearchX source/run records, AIX route receipts, and AgenticX reuse receipts to the same Decision Continuity authority. Strict `/api/enterprise-brain/*` routes use existing OIDC/RBAC; the legacy portfolio endpoint remains a projection. Feature-disabled defaults preserve current executor behavior. Missing/stale/expired/unauthorized evidence, unavailable policy/budget authority, and unpersistable receipts fail closed. See `docs/enterprise-brainx-governance.md`.

### Step 4 — governed runtime promotion (implemented; production activation requires operator configuration)

- `apps/backend/src/governedPromotion.js` promotes one existing runtime target, the safe self-improvement policy consumed by `readSelfImprovementConfig()`. Candidate, baseline, evaluator fixture, validator, evaluation, and policy records are canonical SHA-256 addressed artifacts under an explicit tenant/workspace scope.
- The controller enforces deterministic validation, independent evaluator/reviewer identity/version, a fixed fixture digest, versioned policy thresholds, expiring exact-digest human approval with optional quorum, a deterministic bounded canary, automatic stop/rollback, retained outcomes, and idempotent selector effects.
- Migration `007_governed_promotion_runtime.sql` is the PostgreSQL authority for artifacts, request revisions, event hashes, selectors, effects, and kill switches. The selector starts disabled unless both `GOVERNED_PROMOTIONS_ENABLED` and `GOVERNED_PROMOTION_SELF_IMPROVEMENT_ENABLED` are configured.
- `docs/governed-promotion-runtime-policy.md` contains the target rationale, actual runtime seam, operator API/RBAC surface, deployment enablement, and rollback/monitoring runbook. The Agentic System UI has a read/evidence/control panel; it does not grant a browser unrestricted promotion authority.

### Phase 5 — P2 research and production infrastructure

- ResearchX now supplies a feature-disabled, allowlisted, bounded research-worker foundation backed by the ledger. It can emit citations, sanitized evidence, observations, or reconsideration requests only; it cannot mutate source, policy, or deployment state.
- Extend the established PostgreSQL/OIDC/RBAC pattern to remaining control-plane surfaces; add ABAC where required, egress enforcement, retention/deletion, OpenAPI, runbooks, disaster-recovery adapters, and separately approved live-provider/inference adapters.

### Step 1 persistence update — PostgreSQL authority (implemented, deployment pending)

- `database/migrations/002_decision_continuity_postgres.sql` supplies the Decision Continuity current-state, immutable event, idempotency, transactional-outbox, projection-checkpoint, and import-run schema.
- `DECISION_CONTINUITY_ADAPTER=postgres` is the production-only authority; `file` is explicitly development/test-only and production rejects it rather than downgrading.
- `docs/decision-continuity-postgres.md` records the migration/import procedure, readiness distinction, and non-destructive rollback path. Outbox consumption and durable projection workers remain a subsequent step.

## Compatibility and risk controls

- New endpoints and runtime files are additive; no existing route or project record is changed.
- Enterprise Brain application bindings, policy/budget records, research runs, model routes, and knowledge-reuse receipts are canonical Decision Continuity state; portfolio, graph, vector, and UI material remain derived views.
- The local ledger is feature-scoped and has no live deployment action.
- Unknown, stale, expired, or unauthorized evidence cannot clear a constraint.
- Promotion is blocked without an independent evaluator, deterministic validation, approval, and a bounded canary record.
- Direct browser requests cannot declare themselves trusted condition sources; production trusted services must be configured server-side.
- Full multi-tenant database, SSO, and external event/queue infrastructure are deliberately not simulated.

## Implemented P0 API and configuration

Decision Continuity derives tenant authority from verified OIDC identity plus PostgreSQL membership. In production, anonymous access is rejected; browser bearer credentials are memory-only. Browser clients can create and inspect their authorized branch records but cannot send trusted condition facts or promote a branch unless their specific role permits it.

| API family | Purpose | Enforcement |
| --- | --- | --- |
| `GET/POST /api/decision-continuity/branches` | Create/list tenant branches; `GET /:branchId`, `/:branchId/events` show historical facts | Tenant-scoped, bounded lists; browser creation records the authenticated actor. |
| `GET /api/decision-continuity/graph` | Rebuildable lineage/evidence/constraint/event projection | Derived view only; never authorizes a lifecycle transition. |
| `GET /api/decision-continuity/branches/:branchId/compare/:otherBranchId` | Inspect lexical, semantic, structural, behavioral, and outcome similarity | Semantic similarity is `unavailable` unless a versioned tenant fingerprint already exists; no external model call is made. |
| `POST /api/decision-continuity/condition-events` | Record trusted observations and request reconsideration | Requires configured trusted service identity and tenant id; idempotent. |
| evaluation/policy/outcome routes | Record deterministic validation, independent review, policy, and monitored outcomes | Trusted-service only. |
| disposition/approval/canary routes | Set a non-promoting disposition, human approval, or audit-only canary record | Requires explicit operator allowlist; deny by default. |
| `/api/enterprise-brain/*` | Manage/read immutable bindings, policy snapshots, budgets, approved research sources/runs, DecisionX projections, AIX route receipts, and AgenticX reuse receipts | Strict verified OIDC/RBAC; human administration for high-impact writes; worker reads only its explicit scope; legacy portfolio data is not authorization. |

Configuration uses no embedded secrets:

```dotenv
# Optional. Defaults to <project>/runtime/decision-continuity.
DECISION_CONTINUITY_ROOT=/secure/runtime/decision-continuity

# Production requires verified OIDC and explicit browser origins. Provision
# principals/memberships in PostgreSQL through the controlled admin process.
PLUTONIX_AUTH_MODE=oidc
OIDC_ISSUER=https://issuer.example
OIDC_AUDIENCE=plutonix-decision-continuity
OIDC_JWKS_URL=https://issuer.example/keys
PLUTONIX_CORS_ORIGINS=https://app.example
DECISION_CONTINUITY_WORKER_PRINCIPAL_ID=workflow-worker-prod-01

DECISION_CONTINUITY_MAX_RECONSIDERATIONS_PER_TENANT_PER_DAY=25
DECISION_CONTINUITY_RECONSIDERATION_COOLDOWN_MS=1800000
```

The lifecycle API does not use a shared service token. It verifies OIDC bearer tokens and resolves service authority from memberships/scopes; neither the ledger nor its authorization audit records a raw bearer token. The complete configuration and permission matrix are in `docs/decision-continuity-identity-security.md`.

## Acceptance checklist

- [x] Two materially distinct child branches retain lineage, provenance, fitness vectors, content hash, and disposition events (`decisionContinuity.test.js`).
- [x] Compound constraints remain blocking until every required fresh authorized predicate clears.
- [x] One trusted condition change creates at most one reconsideration request, including under replay.
- [x] Reconsideration re-runs current evaluation and cannot displace a selected branch on failure.
- [x] Promotion record requires deterministic validation, independent review, policy, approval, bounded canary, and outcome record.
- [x] Severe canary regression records rollback and keeps prior branch history intact.
- [x] New ledger APIs are tenant scoped and fail closed on unauthorized cross-tenant branch access.
- [x] Operator view distinguishes ledger facts and derived graph/projection data; sensitive lifecycle actions remain server guarded.
- [x] Step 0 baseline: full backend suite (115 tests), frontend suite (17 tests), JavaScript syntax checks, and frontend production builds pass. The two Agentic-system fixture expectations were updated to the intentional separate QAgent visual role.
- [x] Step 1: a PostgreSQL integration suite proves atomic state/event/outbox writes, expected-revision conflict behavior, idempotency replay, tenant isolation, importer dry-run/rerun, projection reconstruction, and database-loss fail-closed behavior.
- Enterprise Brain rollout validation exercises policy snapshot immutability, stale/unknown evidence denial, budget-reservation concurrency, capture idempotency, legacy-branch compatibility, model exclusions, ResearchX no-side-effect behavior, tenant reuse denial, PostgreSQL/OIDC role isolation, migration 011, and permission/loading/empty/denied UI states.

## Owner decisions and external blockers

- Select a production transactional event store (PostgreSQL/EventStore/etc.) and migration owner before multi-instance deployment.
- Configure OIDC/SAML, role mapping, trusted service identities, secrets manager, and tenant retention/deletion policy before production use.
- Approve any live Neo4j/vector projection, paid model, GPU, or external provider execution separately.
- Assign data-protection, residency, retention, licence, egress, and compliance-control owners for each production policy snapshot; this software does not make those organization-specific approvals or legal certifications.
- Build the Phase 4 adapters so QAgent, Intel, BrainX, and Suggested Next Instruction consume this ledger rather than duplicating branch/evidence/policy records.
