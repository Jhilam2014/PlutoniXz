# 08A1C-R3 external-evidence intake package

This package corrects the prior reachability-to-authority conflation. It contains only sanitized repository provenance and external-evidence requests; it contains no credentials, provider-console data, account access, or external mutations.

> **Non-actionable pending R2-aware membership rebuild.** 08A1B-R2 passed on run `20260812T190840Z`, but this R3 package is bound to the superseded V1 logical-item inventory. It must not be used to request authority, request provider evidence, classify a provider or owner, or accept external intake until its domain memberships are rebuilt from the fresh R2 candidate-equivalence inventory. See `r2-dependency.sanitized.json`.

- Source inventory: `20260811T214249Z`; 14,908 observations, 14,849 canonical occurrences, and 14,849 logical items.
- Path A: one committed deterministic synthetic fixture.
- Path B: 14848 residual logical items in 11 source-scope authority domains.
- Provider credential groups: 0; every Path B provider identity remains `UNKNOWN`.
- Existing 08A1A Apify OWNER_ASSERTED record: preserved as unlinked; it is not reused by this package.

| Authority domain | Exact source scope | Path B logical items | Reachability observations |
| --- | --- | ---: | --- |
| AD-SOURCE-AGENT-EFFICIENCY-OBSERVABILITY | SOURCE_SCOPE_AGENT_EFFICIENCY_OBSERVABILITY | 4 | OBSERVABILITY_ARTIFACT=2, REACHABLE_HISTORY=2 |
| AD-SOURCE-AGENT-TOKEN-LEDGER | SOURCE_SCOPE_AGENT_TOKEN_LEDGER | 2 | CURRENT_TREE=1, REACHABLE_HISTORY=1 |
| AD-SOURCE-ARCHIVED-WORKSPACE | SOURCE_SCOPE_ARCHIVED_WORKSPACE | 4 | CURRENT_TREE=2, REACHABLE_HISTORY=2 |
| AD-SOURCE-BACKEND-OPERATIONAL-TESTS | SOURCE_SCOPE_BACKEND_OPERATIONAL_TESTS | 5 | CURRENT_TREE=2, REACHABLE_HISTORY=3 |
| AD-SOURCE-LEGACY-AGENT-WORKSPACE | SOURCE_SCOPE_LEGACY_AGENT_WORKSPACE | 1 | CURRENT_TREE=1 |
| AD-SOURCE-ORCHESTRATION-POLICY | SOURCE_SCOPE_ORCHESTRATION_POLICY | 2 | CURRENT_TREE=1, REACHABLE_HISTORY=1 |
| AD-SOURCE-PROJECT-INTELLIGENCE-MEMORY | SOURCE_SCOPE_PROJECT_INTELLIGENCE_MEMORY | 12 | MEMORY_ARTIFACT=6, REACHABLE_HISTORY=6 |
| AD-SOURCE-REPOSITORY-CONFIGURATION-INGRESS | SOURCE_SCOPE_REPOSITORY_CONFIGURATION_INGRESS | 10 | CURRENT_TREE=7, REACHABLE_HISTORY=3 |
| AD-SOURCE-SELF-IMPROVEMENT-OBSERVABILITY | SOURCE_SCOPE_SELF_IMPROVEMENT_OBSERVABILITY | 1 | REACHABLE_HISTORY=1 |
| AD-SOURCE-SELF-IMPROVEMENT-RUNTIME | SOURCE_SCOPE_SELF_IMPROVEMENT_RUNTIME | 14792 | RUNTIME_ARTIFACT=14792 |
| AD-SOURCE-STAGED-PROJECT-MEDIA | SOURCE_SCOPE_STAGED_PROJECT_MEDIA | 15 | RUNTIME_ARTIFACT=15 |

Use `scripts/verify-08a1c-external-evidence.mjs` before accepting any future intake.
