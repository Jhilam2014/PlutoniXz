# 08A1B scan count bridge

All source reports passed structural redaction validation before parsing. Counts describe observations, not credentials.

## Provenance

- Run ID: `20260811T214249Z`
- Scanner: `zricethezav/gitleaks@sha256:691af3c7c5a48b16f187ce3446d5f194838f91238f27270ed36eef6359a574d9`
- Scanner configuration SHA-256: `d7e50ecc5ad855cf0d98dde2d5204d7c9c432e1ac9df42244f95317405b4855b`
- Commit boundary: `d96548231bfec7c85cd81cc20feac70be6e39e9f`
- Input roots: `worktree`, `reachable-git-history`, `runtime`, `memory`, `observability`, `deliverables`, `apps/frontend/dist`, `apps/generated-site/dist`
- Output root: `runtime/secret-scan`
- Source sanitation: `STRUCTURALLY_VERIFIED_SECRET_AND_MATCH_REDACTED`

## Count bridge

| Stage | Observations/items | Explanation |
| --- | ---: | --- |
| Earlier reachable-history report | 32 | Baseline; structurally redacted before use |
| Current reachable-history scope | 35 | Count changed; investigate safe report metadata |
| Current non-history scopes | 14873 | Worktree, runtime, memory, observability, and bounded clean artifact scopes |
| Current source observations | 14908 | Sum of all current structurally redacted reports |
| Canonical occurrences | 14849 | 59 overlapping observations collapsed only by exact safe object/location identity |
| Logical items | 14849 | No credential-equality grouping without a safe equality identifier |

## Per-scope scan summary

| Scope | Findings | Exit | Duration seconds | Redaction guard |
| --- | ---: | ---: | ---: | --- |
| worktree | 15 | 1 | 75 | yes |
| reachable-git-history | 35 | 1 | 158 | yes |
| runtime | 14834 | 1 | 158 | yes |
| memory | 22 | 1 | 17 | yes |
| observability | 2 | 1 | 4 | yes |
| deliverables | 0 | 0 | 34 | yes |
| apps-frontend-dist | 0 | 0 | 9 | yes |
| apps-generated-site-dist | 0 | 0 | 4 | yes |
| apps-desktop-resources | 0 | 0 | 4 | yes |

## Safe amplification diagnosis

| Safe source class | Observations | Finding |
| --- | ---: | --- |
| ARCHIVE_OR_BACKUP_CONTENT | 46 | Safe location/scope classification; not a provider or credential identity conclusion. |
| MEMORY_SOURCE | 22 | Safe location/scope classification; not a provider or credential identity conclusion. |
| OBSERVABILITY_SOURCE | 2 | Safe location/scope classification; not a provider or credential identity conclusion. |
| REACHABLE_GIT_HISTORY_SOURCE | 30 | Safe location/scope classification; not a provider or credential identity conclusion. |
| RUNTIME_SOURCE | 14792 | Safe location/scope classification; not a provider or credential identity conclusion. |
| TEST_OR_FIXTURE_CONTENT | 6 | Safe location/scope classification; not a provider or credential identity conclusion. |
| WORKTREE_SOURCE | 10 | Safe location/scope classification; not a provider or credential identity conclusion. |

The 32 historical observations are reproduced by the current reachable-history report. The remaining 14873 observations arise from separately scoped current/artifact roots; they are retained. No scanner rule label, location, or native fingerprint is treated as credential equality.
