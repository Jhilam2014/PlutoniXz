# 08A1C evidence-path policy — R4

## Current semantic supersession

R3 replaces the former binary R4 input rule. Only an R3 `POSITIVE_SECRET_CANDIDATE` may enter Path B, and only after the semantic gate passes. A missing Path A proof is neither secret evidence nor external-action authority. While the R3 gate is blocked, the R4 policy below is historical audit material.

R4 consumes only `08A1B-R2-logical-credential-inventory-v1` membership. Exact candidate equality was completed by the R2 memory-only process and is never recomputed from sanitized evidence here.

| Path | Eligible current classes | Terminal condition |
| --- | --- | --- |
| Path A | Valid R2 deterministic noncredential proofs | Exact R2 proof, validator, positive/negative regression references, and reverse lineage |
| Path B | Every R2 `PLAUSIBLE_CREDENTIAL` class | Scoped authority, verified provider scope, exact linkage, terminal evidence, actor/time, independent chronology, remediation, and replacement health evidence when required |

Path B actions are one per R2 logical item by default. Reachability, source scope, scanner rule, path, provider-shaped prefix, and owner assertion are not authority, provider identity, equality, or terminal evidence. The legacy R3 eleven-domain package remains superseded audit history only.
