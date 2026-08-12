# 08A1C count bridge

Counts distinguish scan observations, canonical occurrences, logical items, primary state, and action-queue grouping. No total is forced to match another layer.

| Layer | Earlier normalized inventory | Current 08A1B inventory | Delta |
| --- | ---: | ---: | ---: |
| Scan observations | 14857 | 14908 | 51 |
| Canonical occurrences | 14798 | 14849 | 51 |
| Logical items | 14798 | 14849 | 51 |

The 14,798 → 14,849 increase is exactly 51 observations, 51 canonical occurrences, and 51 logical items. It is inventory growth, not a duplicate projection or a count normalization. The current 14,908 → 14,849 difference is 59 same-identity observation overlaps already proven by 08A1B.

## Current primary-state bridge

| Primary state / terminal disposition | Logical items |
| --- | ---: |
| DELETED_AT_PROVIDER | 0 |
| PROVEN_INVALID | 0 |
| REVOKED | 0 |
| ROTATED_OLD_INVALIDATED | 0 |
| VERIFIED_FALSE_POSITIVE | 0 |
| VERIFIED_SYNTHETIC_FIXTURE | 1 |
| EVIDENCE_INVALID | 0 |
| OWNER_ACTION_PENDING | 0 |
| OWNER_ASSIGNMENT_REQUIRED | 14848 |
| PROVIDER_VERIFICATION_PENDING | 0 |
| UNRESOLVED | 0 |

## Independent dimensions

| Dimension | Totals |
| --- | --- |
| Closure path | PATH_A_REPOSITORY_FACT=1, PATH_B_EXTERNAL_AUTHORITY_OR_PROVIDER=14848 |
| Provider identity | UNKNOWN=14849, VERIFIED=0 |
| Repository proof family | DETERMINISTIC_COMMITTED_FIXTURE=1 |
| External action queue | 5 authority-domain groups for 14848 residual logical items |

Every logical item has one canonical member and one primary state. The action queue groups pending external work and is not another logical-item total.
