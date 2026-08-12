# Governed promotion: self-improvement runtime policy

## Selected production target

Step 4 governs exactly one real PlutoniX runtime target: the safe subset of the self-improvement runtime policy consumed by `readSelfImprovementConfig()` in `apps/backend/src/selfImprovement/controlPlane.js`.

The target is intentionally narrow. A promoted document may tune bounded observation/sandbox values, but can never introduce autonomous promotion, network research, tool building, a secret, a credential field, or a broader execution mode. The existing environment-derived policy remains active unless the governed selector is explicitly enabled.

The production target has the platform tenant/workspace scope `platform` / `self-improvement-runtime`. Other tenant/workspace records remain durable, scoped candidates but cannot alter this platform runtime selector. This prevents a tenant-owned candidate from becoming a global runtime configuration.

## Enablement and rollback safety

The runtime adapter is disabled by default in every environment. Production requires both of these explicit deployment settings before the selector is hydrated:

```text
GOVERNED_PROMOTIONS_ENABLED=true
GOVERNED_PROMOTION_SELF_IMPROVEMENT_ENABLED=true
```

Without both values, `readSelfImprovementConfig()` returns only its configured environment policy and the canary endpoint fails closed with `runtime_target_disabled`. No candidate is treated as production-ready merely because it has a request record.

When enabled, startup hydrates the durable selector. It restores the active, previous-known-good, and any running-canary artifact before accepting work. A selector change feeds the same `readSelfImprovementConfig()` runtime path; it is not a deployment-status projection.

Rollback is operational: the selector is switched to the stored known-good digest, the runtime adapter is updated, and the effect is recorded with an idempotency key. A repeated request does not repeat the runtime effect. A kill switch halts candidate selection and automatically invokes the same rollback operation for the active promoted/canary request.

## Durable lifecycle

Migration `007_governed_promotion_runtime.sql` creates tenant/workspace-scoped artifacts, requests, append-only hash-chained events, runtime selectors, idempotent effects, and kill switches.

1. A proposer stores the full candidate configuration, baseline metric suite, fixed evaluator fixture dataset, and deterministic validator report by canonical SHA-256 digest.
2. Validators check exact schema, canonical content integrity, secret/credential prohibition, and safety invariants. Failure produces `rejected`; it cannot progress.
3. A separately identified evaluator and reviewer record an evaluator identity/version, immutable fixture digest, outputs digest, uncertainty, conflict-of-interest declaration, and quality/regression/latency/cost/correction/reliability/security/confidence/sample metrics. Producer, evaluator, and reviewer must be distinct. QAgent and BrainX identities are rejected from these authority roles.
4. A versioned, content-addressed policy deterministically compares the evaluation to the baseline. It records every threshold reason and only permits a request to await approval when all gates pass.
5. Human approval binds the exact candidate and policy digests and expires according to the policy. The policy supports a quorum of one to five humans. A candidate amendment clears evaluation, policy, approval, and canary state, so no old approval can authorize changed bytes.
6. A human operator starts a canary only after a fresh quorum, enabled runtime target, clear kill switch, and explicit policy bounds. The selector uses a deterministic hash of the work-item key to route no more than the policy population percentage, work-item cap, or time window.
7. An independent monitor records bounded observations. Security findings, failures, regression, latency, cost, reliability, or confidence threshold breaches automatically halt and roll back. A successful bounded window promotes the candidate and retains the former active digest as the rollback target.

Every state transition records its actor, digest references, outcome, and hash-chained audit event. Existing request records and failed/rolled-back candidate artifacts are retained; nothing is deleted as part of rollback.

## Operator surface and authorization

`/api/governed-promotions/*` is authenticated through the existing verified OIDC → PostgreSQL principal and membership boundary. Authorization uses `promotion:*` permissions:

- `promotion:propose`, `promotion:evaluate`, `promotion:policy`, `promotion:approve`, `promotion:operate`, and `promotion:monitor` are distinct permissions.
- Approval and runtime operation require human identities. A service cannot receive `promotion:approve`; QAgent/BrainX-like service identities cannot administer promotion policy.
- Reads return only the selected tenant/workspace scope. The UI never receives cross-tenant request IDs or artifacts.

The Agentic System **Governed Promotion** panel is an operator evidence view. It reports pending approval bindings, candidate/policy/fixture/validator digests, canary and rollback outcome, current/previous selector state, target enablement, and RBAC errors. It exposes only the guarded kill switch and rollback actions; proposing/evaluation/approval remain API/role workflows rather than an unrestricted browser action.

## Required operational checks

- Apply migration `007` through `npm run decision-continuity:migrate` before enabling either runtime selector flag.
- Provision explicit platform-scope memberships for proposer, evaluator/reviewer, approver, operator, and monitor identities. Do not use a single administrative identity for the lifecycle.
- Preserve the migration ledger and all governed-promotion tables in backup/restore drills. Rollback is a selector reversal, not data deletion.
- Monitor `governed_promotion_events`, completed effect rows, kill-switch state, selector revision, and canary threshold outcomes.
- Treat a missing selector artifact or database failure as unavailable; do not fall back to a candidate from memory or filesystem.

## Test evidence

`apps/backend/test/governedPromotion.test.js` covers deterministic validator failure, complete candidate → evaluation → policy → approval → bounded selector → promotion, exact-digest/expiry/mutation invalidation, threshold rollback, repeated rollback effect idempotence, and kill-switch rollback.

`apps/backend/test/integration/governedPromotionPostgres.integration.test.js` runs the lifecycle against PostgreSQL and proves durable artifacts/events/effects plus tenant isolation.
