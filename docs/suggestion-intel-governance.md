# Suggested Next Instruction and Intel governance

Step 7 turns Suggested Next Instruction and Intel capability proposals into tenant/workspace-scoped review records in the existing Decision Continuity authority. They are not agents, installers, feature flags, policy engines, tool brokers, deployment APIs, or alternative promotion tracks.

## Evidence and states

A suggestion must reference a trusted condition event, evidence IDs, and (when applicable) an affected branch. It records the change, blockers, benefit/cost/risk/reversibility, bounded action, success condition, expiry, deterministic semantic-deduplication method/version/threshold, authoritative facts, and separately marked untrusted model rationale. States are informational, needs-evidence, ready-for-review, ready-for-approval, approved-for-execution, rejected, expired, superseded, and completed. Viewing or generating a record has no side effect.

Edits retain a revision with actor/reason/content digest. A material edit invalidates attached evaluation and approval digests and returns the record to a non-executing review state. Rejected and expired records remain queryable. Manual merge/supersede must retain predecessor IDs and provenance rather than delete a record.

## Intel reuse and lifecycle

Intel proposals require a grounded trigger: repeated failure, blocked task, customer/operator evidence, policy change, missing integration, or measured performance gap. Before a create decision they preserve four searches—local registry, transactional ledger, graph projection, and authorized vector index—and, for a create decision, why reuse/upgrade is unsuitable. Vector similarity is evidence only; it is never identity or authorization.

Capability proposals include frequency/severity, affected links, dependencies, permissions/data/infrastructure, licence/security/privacy risks, implementation/operating costs, tests/metrics, rollout/monitoring/rollback, and human owner approval. Neither record type can grant permissions, enable flags, install code/tools, download models, or deploy.

Only a blocker-free, independently evaluated suggestion may be linked to an existing Step 4 governed-promotion request by a different human reviewer with an approval digest. The Step 4 request still owns isolation, deterministic validation, independent evaluation, policy, human approval, canary, outcome, and rollback. A link is not execution authority.

## API and operator view

`GET /api/suggestions/overview` is read-only. Human `suggestion:edit` creates/edits suggestions and Intel proposals; human `suggestion:review` records review and links the record to Step 4. Services cannot edit/review/administer this surface. The Decision Continuity panel labels facts, model rationale, policy state, lifecycle link, and remaining blockers separately.
