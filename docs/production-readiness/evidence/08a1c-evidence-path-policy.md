# 08A1C evidence-path policy

## Closure-policy repair

The superseded 08A1C policy applied an active owner/provider authority prerequisite to every terminal disposition. That conflated two different evidence questions and wrongly blocked repository-proven false-positive or synthetic-fixture closure. The repaired policy makes the branches disjoint.

| Path | Eligible result | Required evidence | Prohibited shortcut |
| --- | --- | --- | --- |
| Path A — repository fact | `VERIFIED_FALSE_POSITIVE` or `VERIFIED_SYNTHETIC_FIXTURE` | Canonical membership, deterministic proof family/reason/safe provenance, source and validator version, repository proof and regression reference, stable rerun | Authority/provider evidence, scanner label alone, documentation label alone, or a provider-shaped fixture without generator proof |
| Path B — authority/provider action | `REVOKED`, `ROTATED_OLD_INVALIDATED`, `DELETED_AT_PROVIDER`, or `PROVEN_INVALID` | Current scoped authority, verified provider identity, safe linkage, required provider evidence, action/verification chronology | Path A, source removal, image-only evidence, owner assertion outside explicitly approved policy, or an unlinked batch |

Path A requires no authority. Path B always requires it. Historical HUMAN provider writings `63841`, `27491`, and `74682` are retained only as superseded context; they are not executable terminal evidence.

## Current repository-fact evidence

- Fact schema: `08A1C-repository-facts-v1`; validator: `08A1C-repository-fact-discovery-v1`; reviewed at `2026-08-11T21:51:32Z`.
- Repository-terminal facts: 1.
- Proof-family totals:

| Proof family | Logical items |
| --- | ---: |
| DETERMINISTIC_COMMITTED_FIXTURE | 1 |

All other items are deliberately routed to Path B.
