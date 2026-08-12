# QAgent bounded evidence planning for Decision Continuity

## Purpose and integration

Step 5 extends the existing QAgent controller into a bounded evidence planner for an eligible Decision Continuity reconsideration. It does not create another ledger: `qagent_run` and `qagent_effect` are tenant/workspace-scoped entities in the existing authoritative Decision Continuity current-state ledger, with corresponding immutable domain events and transactional outbox rows.

A run has schema version `qagent-decision-continuity/v1` and links the tenant, workspace, derived objective digest, affected branch IDs and per-branch relevance, reconsideration, triggering evaluation, workflow correlation/request/job IDs, and planner provider/model/prompt versions.

The persisted plan includes the uncertainty/evidence gap, one question, hypothesis, experiment, expected-information-gain proxy and calibration version, requested source/freshness, cost/latency/compute/risk estimate, immutable server limits, budget consumption, stop condition, semantic-deduplication fingerprint/evaluator/model/version/threshold, provenance validation, independent evaluation, provisional impact, and typed stop reason.

## Governed flow

```text
eligible reconsideration with material uncertainty
  -> schema-validated QAgent proposal (one question, one read-only request)
  -> server-side limits and semantic/evidence-gap deduplication
  -> registered read-only collector with idempotency claim
  -> deterministic provenance/freshness/digest/size validation
  -> independently identified evaluator
  -> provisional branch-evaluation attachment
  -> normal deterministic evaluation -> policy -> human approval -> canary
```

The attachment is an evidence relationship and provisional assessment only. It never changes a constraint to `cleared`, changes lifecycle status to approved/selected, assigns a final ranking, approves, canaries, promotes, changes policy, installs a capability, grants a permission, reads a secret, invokes a shell, or performs arbitrary network or production-write work.

Missing, stale, conflicting, low-confidence, unauthorized, or malformed evidence is preserved as rejected/untrusted metadata and stops the run. It cannot clear a constraint by assumption.

## Permission surface

| Identity | Allowed | Explicitly denied |
| --- | --- | --- |
| `qagent:*` service | Only `qagent:investigate` when provisioned, plus its tenant/workspace membership | all final `decision:evaluate`/policy/approve/canary and promotion evaluate/policy/approval/operate scopes, production writes, shell, arbitrary network, secret reads, permission grants |
| Registered collector | A named source/tool pair from the server allowlist, declared `read_only`, called with an idempotency key | Any non-allowlisted tool or source; collector output cannot become trusted by declaration |
| Independent evaluator | Receives deterministic-validator-passed, provenance-checked evidence | QAgent/originator identity; policy, approval, promotion, or constraint clearing |
| Operator/auditor | Read-only `GET /api/decision-continuity/qagent-runs` under existing `decision:read` | Browser-side investigation execution or lifecycle authorization |

Migration `008_decision_continuity_qagent_runs.sql` also rejects any membership that combines `qagent:investigate` with policy, approval, canary, or promotion lifecycle scopes.

There is intentionally no browser mutation endpoint for QAgent execution. A registered service integration calls `QAgentDecisionContinuityService`; production collection fails closed unless a collector is explicitly registered and marked read-only. This keeps model text and retrieved text away from tools and authorization boundaries.

## Server-enforced limits and enablement

`QAGENT_DECISION_CONTINUITY_ENABLED=false` is the default. Enabling the global flag is insufficient: the tenant must be explicitly listed in `QAGENT_DECISION_CONTINUITY_ENABLED_TENANTS`. If either condition is false, `createInvestigation` returns `baseline` and the established reconsideration path proceeds unchanged.

The environment supports lower bounded values for iterations, fan-out, tokens, model calls, tool calls, elapsed time, cost, compute units, evidence size, expected information gain, and deduplication threshold. Hard ceilings are in `qagentDecisionContinuity.js`; model output has a strict schema and contains no limit override field. Unknown/prompt-injected fields fail validation.

The default posture is one iteration, no recursion, one model call, one tool call, four branches maximum, 60 seconds, $0.25, and 64 KiB of retained evidence. A run stops with a typed reason for sufficient evidence, low expected value, unavailable evidence, policy denial, repeated question, budget exhaustion, timeout, cancellation, loop detection, invalid evidence, evaluator unavailability, no decision effect, or recovery requirement.

## Provenance, idempotency, and recovery

Only content digest, byte count, redacted excerpt, and non-secret provenance metadata are persisted. The raw content is untrusted until deterministic validation checks source/tool allowlisting, authorization, freshness/expiry, SHA-256 digest, and evidence size. The resulting record explicitly distinguishes accepted from rejected evidence.

Before collection, the service persists a `qagent_effect` claim keyed by tenant/workspace/run/effect/idempotency key. A completed claim returns the stored outcome. A pending claim after a restart stops with `recovery_required`; it is never blindly replayed. A real collector must use the same idempotency key and expose a read-only recovery lookup before resumption is added.

`qagent-semantic-dedup/calibrated-token-overlap-v1` records the calibrated lexical-semantic proxy, deterministic model label, version, threshold, evidence-gap key, similarity, and retained run ID. A duplicate creates an explicit `duplicate` run linked to the retained investigation rather than disappearing.

## Operator visibility, API, and metrics

The existing Decision Continuity panel now shows feature state, question, branch-specific gap, provenance, budget consumption, stop reason, decision impact, and next governed state. The tenant-scoped read endpoint returns only records in the caller's active tenant/workspace:

```text
GET /api/decision-continuity/qagent-runs?workspaceId=&reconsiderationId=&limit=
```

`schemas/qagent-decision-continuity-proposal.schema.json` is the transport contract for structured planner output. The server validates the equivalent strict Zod contract before persistence.

Metrics are tenant scoped and redact raw evidence: run count, active/duplicate runs, accepted/rejected evidence, provisional decision-impact count, no-decision-effect count, cost, and cost per provisional accepted improvement. The latter is an operational ratio, not a causal-improvement claim.

## Evaluation harness

`apps/backend/src/qagentEvaluationHarness.js` compares the same deterministic fixture across `no_qagent`, `single_agent_reflection`, and `qagent_assisted`. It captures quality/acceptance, human-correction proxy, latency, tokens/cost, model/tool calls, regressions, and cost per accepted improvement. The fixture oracle records one bounded QAgent-assisted provisional evaluation change at $0.004 per accepted improvement; it is CI regression evidence only and does not claim a production benefit.

Live-provider evaluation is opt-in through `QAGENT_LIVE_EVAL_ENABLED=true` and capped by `QAGENT_LIVE_EVAL_MAX_COST_USD`. The deterministic harness deliberately has no live-provider adapter and reports such a run as blocked rather than making an unapproved external call.
