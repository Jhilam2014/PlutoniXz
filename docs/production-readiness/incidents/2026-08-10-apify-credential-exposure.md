# Apify credential exposure incident record

Status: **open — Apify owner remediation remains unlinked 08A1A evidence; corrected 08A1B-R3 semantic triage is blocked with 1,067 unresolved repository-classification items and zero active external requests**
Recorded: 2026-08-10  
Owner-evidence update: 2026-08-11
Owner-resolution update: 2026-08-11T21:51:32Z
Residual-queue reclassification update: 2026-08-12
Authority-domain decomposition update: 2026-08-12
R2/R4 reconstruction update: 2026-08-13
R3 semantic-triage update: 2026-08-13

## Safe incident boundary

This incident record contains no credential value, token fragment, replacement value, request header, authorization header, provider response body, or secret-bearing command output.

| Field | Recorded value |
| --- | --- |
| Incident ID | `SEC-2026-08-10-APIFY-001` |
| Provider | Apify |
| Discovery date | `2026-08-10` |
| Credential purpose | Apify actor execution |
| Affected environment | Development only |
| Credential owner / authority | Jhilam Bera / Admin — OWNER_ASSERTED |
| Safe alias | `APIFY-DEV-PERSONAL-TOKEN-2026-08-11` — OWNER_ASSERTED |
| Apify owner remediation | RECORDED |
| Apify evidence classification | OWNER_ASSERTED, with repository-verified Git-ignore and evidence-path metadata |
| Apify owner-evidence subgate | PASS |
| Provider verification | None. Repository evidence does not independently prove provider-console state. |
| Overall Step 08A | IN PROGRESS |
| 08A1B inventory prerequisite | PASS — R2 run `20260812T190840Z`; 1,068 exact candidate-equivalence classes |
| 08A1B-R3 semantic gate | BLOCKED — 1 deterministic fixture, 0 positive secret candidates, and 1,067 semantically unresolved classes pending frozen-R2 raw-correlation reproduction |
| 08A1C authority/disposition result | NOT ELIGIBLE — zero active authority/provider actions; prior R4 requests are audit only |
| Artifact-coverage subgate | 08A1D NOT RUN — full rerun is prohibited until the corrected R3 semantic gate passes |

## Current R3 semantic triage and R4 audit status

R4 preserves the 08A1A Apify record at `OWNER_ASSERTED` only. It has no validated exact R2 alias, project, account, environment, or logical-item linkage and is therefore not applied to any Path B item.

The immutable R2 run `20260812T190840Z` has 14,984 observations, 14,937 canonical occurrences, and 1,068 exact candidate-equivalence classes. R3 preserves one deterministic Path A fixture. It finds zero `POSITIVE_SECRET_CANDIDATE` classes and leaves 1,067 `SEMANTICALLY_UNRESOLVED` because the approved bounded reachable-history raw-correlation replay did not complete. The exact next repository-local requirement is to complete that frozen-R2 raw-correlation replay; unresolved classes have no provider, authority, or external action assignment.

The former R4 package preserves all 1,067 requests in `.r4-audit.sanitized.json` files, but its current package status is `NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE`: active authority requests, provider requests, and external actions are all zero. R4 also projected 23 retained 08A1D artifact records; its five records / 31 observations that were not safely mapped remain historical. Full 08A1D is `NOT RUN` until R3 passes.

## 08A1A Apify owner-evidence closure

Jhilam Bera (Admin) approved the following owner assertions: the Development-only Apify credential used for actor execution was regenerated/rotated in the Apify provider console at `2026-08-11T10:41:00Z`; the old credential was confirmed unusable through the provider console at `2026-08-11T11:07:55Z`; the post-rotation Development health check passed at `2026-08-11T11:08:55Z`; and the record was approved at `2026-08-11T11:11:26Z`.

The chronology is strictly increasing: `2026-08-11T10:41:00Z < 2026-08-11T11:07:55Z < 2026-08-11T11:08:55Z < 2026-08-11T11:11:26Z`.

The replacement is owner-asserted to be held only in the local gitignored `.env` as `APIFY_API_TOKEN`; it was not stored in Git or documentation. Git metadata confirms the local `.env` path is ignored without opening its contents. The sanitized revocation and health records are at `docs/production-readiness/evidence/apify-revocation-sanitized.md` and `docs/production-readiness/evidence/apify-post-rotation-health-check.md`.

The supplemental PNG at `docs/production-readiness/evidence/apify-revocation-sanitized.png` is present as a 2876 × 1362 PNG with SHA-256 `686f64afd5851e5c7b6671cb484a06bd5e47e5cfe3c567bfad5c1b005bd4f00a`. Its content classification is `IMAGE_INSPECTION_NOT_AVAILABLE`; it is not PROVIDER_VERIFIED and does not block this owner-evidence subgate.

## Redacted scanner evidence and remaining scope

On 2026-08-10, the pinned scanner completed a full reachable-history review with exit code 1 and 32 redacted findings. The complete sanitized machine-readable evidence remains at `runtime/secret-scan/08a-manual-20260810/reachable-git-history.gitleaks.json`; every `Secret` field is `REDACTED`.

`runtime/secret-scan/20260811T214249Z/canonical-inventory.08a1b.sanitized.json` and `docs/production-readiness/evidence/08a-finding-reconciliation.md` reconcile 14,908 scan observations into 14,849 canonical occurrences and 14,849 source logical items. 08A1C later proved one deterministic non-provider test fixture through Path A; 14,848 items remain on Path B. Scanner rule labels are not provider, owner, validity, or Apify-linkage evidence.

The superseded partial artifact inventory is retained as historical evidence only. The current 08A1D inventory at `runtime/secret-scan/20260811T214249Z/artifact-coverage.08a1d.sanitized.json` and `docs/production-readiness/evidence/08a-artifact-inventory.md` covers the configured archive, oversized-file, frontend-download, and disk-image surface. Remote exact-commit CI evidence remains unresolved.

| Downstream ownership and disposition | Status |
| --- | --- |
| Authorized to review GCP, OpenAI, and unidentified findings | No |
| Assigned authorized owner | Not yet assigned |
| Authorized owner assignment completed | No |
| Owner-assignment evidence | Pending per-item assignment |
| Evidence-backed dispositions completed | One Path A repository-fact fixture closure; no Path B external closure |
| Remaining unresolved logical items | 14,848 |

These items were carried forward through the completed `08A1B` inventory gate into `08A1C`. They do not close the incident and do not block the completed Apify owner-evidence subgate.

## 08A1B normalized inventory

The 08A1B canonical inventory reproduces 14,908 structurally redacted scan observations from the nine reports in `runtime/secret-scan/20260811T214249Z/`. It maps them into 14,849 canonical occurrences and 14,849 logical items, all `UNKNOWN` / `UNRESOLVED`.

The prior 32 reachable-history observations are reproduced exactly by the current reachable-history scope. The additional observations arise from separately scoped worktree, runtime, memory, and observability inputs; they are retained. The 59-observation reduction occurs only when observations have the same normalized object/location, object marker, rule, line span, and scanner-native finding identity. The scanner fingerprint is location-oriented metadata, not a credential-value equality proof, so no additional logical grouping or closure is inferred.

`runtime/secret-scan/` is now excluded only from the producing runtime scan, while generated reports remain subject to an independent structural redaction guard. No provider/rule/path-family allowlist was added, and no current-tree, history, runtime, build, export, or deployment coverage was removed.

The source-owner action queue is recorded at `docs/production-readiness/evidence/08a-owner-action-inventory.md`. Its candidate domains are investigation queues only; no authority, provider, owner, validity, or terminal disposition is assigned by 08A1B.

## 08A1C authorized-owner resolution and disposition result (superseded baseline)

The 08A1C validator consumed the immutable 08A1B source inventory for run `20260811T214249Z`: 14,908 observations, 14,849 canonical occurrences, and 14,849 logical items. It created one safe disposition record and one residual action row per logical item. No source evidence was rewritten and no credential value, fragment, equality hash, request header, or provider response was read or recorded.

| Authority and disposition result | Count or status |
| --- | --- |
| Active authority records that safely cover logical items | 0 |
| Pending source-owner authority templates | 5 |
| `REVOKED` | 0 |
| `ROTATED_OLD_INVALIDATED` | 0 |
| `DELETED_AT_PROVIDER` | 0 |
| `PROVEN_INVALID` | 0 |
| `VERIFIED_FALSE_POSITIVE` | 0 |
| `VERIFIED_SYNTHETIC_FIXTURE` | 0 |
| `OWNER_ASSIGNMENT_REQUIRED` primary state | 14,849 |
| UNKNOWN provider identity | 14,849 |
| Hidden non-terminal states | 0 |

The named Jhilam Bera authority remains scoped to the documented Apify Development credential. The inventory contains no safe equality or provenance link from that alias to any scanner logical item, and the checked-in policy does not allow its OWNER_ASSERTED evidence level to terminally close an 08A1C item. It is therefore not assigned to GCP, OpenAI, generic-rule, other-rule, or UNKNOWN findings.

The authority matrix is `docs/production-readiness/evidence/08a-owner-authority-matrix.md`; the per-item register and machine-readable record are `docs/production-readiness/evidence/08a-owner-dispositions.md` and `08a-owner-dispositions.sanitized.json`; the grouped, one-row-per-logical-item external queue is `docs/production-readiness/evidence/08a-owner-action-inventory.md`. The exact remaining action is to provide a scoped, time-valid authority record for each candidate source-owner domain, then have that authority establish the provider and validity from safe linkage/provenance and supply independently verifiable terminal evidence. The validator will not accept a rule label, source removal, image-only evidence, broad batch, or unlinked authority as a substitute.

This all-external baseline is superseded by the residual-queue reclassification below. 08A1D artifact coverage remains independent.

## 08A1D bounded read-only artifact coverage result

Run `20260811T214249Z` derives scope from the checked-in Compose context and `.dockerignore` allowlist plus repository-owned runtime/export, memory, observability, deliverable, and build-output roots. It covers 10 roots and 7 archive or oversized artifacts.

The control uses metadata-only `lstat` discovery; no symlink traversal; bounded archive preflight and temporary extraction; static-string content review; and structurally redacted evidence. It never executes artifacts. The final inventory totals are `CLEAN=11`, `FINDINGS_MAPPED_PENDING_DISPOSITION=8`, `UNSCANNED=0`, `UNSUPPORTED=0`, approved exclusions `=0`, and unmapped observations `=0`.

Six redacted static observations in the three checksum-equivalent staged-media archives map to the existing 08A1B logical items and remain `FINDINGS_MAPPED_PENDING_DISPOSITION`. This is an artifact-coverage outcome, not provider, owner, validity, or terminal-disposition evidence. Thus 08A1D passes independently while 08A1C remains blocked by external authority/provider evidence for 14,848 logical items.

## 08A1C residual-queue reclassification and policy repair

The earlier all-external 08A1C policy is retained above as superseded baseline evidence. It incorrectly required owner/provider authority even for repository-proven false positives or synthetic fixtures. The repaired policy separates Path A repository facts from Path B external authority/provider actions.

> Historical R1 note: the five group figures in this section are reachability buckets only. The R3 source-scope decomposition below supersedes them as an authority model.

The deterministic test-fixture proof closes exactly one logical item as `VERIFIED_SYNTHETIC_FIXTURE` through Path A. It has canonical membership, deterministic generator provenance, a source/validator version, and regression coverage; no provider identity or authority is asserted. The remaining 14,848 logical items have no equivalent repository proof and retain exactly one `OWNER_ASSIGNMENT_REQUIRED` primary state on Path B.

The count bridge is 14,798 → 14,849 logical items (+51), exactly matching the observation and canonical-occurrence deltas. The 14,908 observations remain separate from the 14,849 canonical/logical layer. The five remaining external action groups are current-tree (14), memory (6), observability (2), reachable history (19), and runtime artifacts (14,807).

The 08A1A Apify OWNER_ASSERTED record still has no safe linkage to any scanner logical item and is not reused for this closure. Historical HUMAN provider writings are superseded context, not terminal evidence. See `08a1c-evidence-path-policy.md`, `08a1c-count-bridge.md`, `08a1c-repository-facts.sanitized.json`, and the updated authority, disposition, and compact action-inventory records.

## 08A1C-R3 authority-domain decomposition and external-evidence intake

The preceding reference to five external action groups is superseded: those five figures are reachability observations, not authority domains. R3 preserves reachability independently as CURRENT_TREE=14, MEMORY_ARTIFACT=6, OBSERVABILITY_ARTIFACT=2, REACHABLE_HISTORY=19, and RUNTIME_ARTIFACT=14,807. It does not use those values to infer a person, provider, credential group, account, project, service, deployment, or environment.

The 14,848 Path B logical items are now partitioned by exact sanitized source-system/root provenance into 11 pending source-scope authority domains: self-improvement runtime (14,792), staged project media (15), project-intelligence memory (12), repository configuration ingress (10), backend operational tests (5), agent-efficiency observability (4), archived workspace (4), orchestration policy (2), agent-token ledger (2), legacy agent workspace (1), and self-improvement observability (1). The deterministic Path A fixture remains the only terminal closure.

`docs/production-readiness/evidence/08a1c-external/` contains bidirectional logical/canonical/domain membership, 11 authority requests, 11 provider-evidence requests, the external-action manifest, and an empty sanitized intake. Provider credential groups=0, safe authority linkages=0, and no external action is recorded. The existing 08A1A Apify OWNER_ASSERTED record remains explicitly unlinked and is not a basis to close, classify, revoke, rotate, or otherwise act on any inventory item.

The R3 validator rejects reachability-as-authority, provider guesses, missing/duplicate domain membership, Path A fixture leakage, timestamp drift, unsafe linkage, malformed external actions, secret-bearing content, and rerun drift. The incident stays open pending independently verified source-owner authority and provider evidence for every applicable Path B domain.

## 08A1B-R2 reconstruction supersession

The V1 08A1B inventory and every R1/R3 mapping above are superseded for downstream action. Fresh run `20260812T190840Z` records 14,984 observations, 14,937 canonical occurrences, one deterministic synthetic fixture closure, and 1,067 plausible credential classes across 1,068 memory-only exact candidate-equivalence classes. The +76 source-observation delta is runtime +78, reachable history -1, and worktree -1; the +88 canonical delta additionally resolves 12 location/fingerprint collisions with differing candidate bytes.

R2 wrote no credential values, equality tags, candidate fragments, or derived candidate hashes. It passed with zero unreconstructed candidates and zero scanner-output recursion. The R3 authority package is **NON-ACTIONABLE** until its domain membership is rebuilt from R2; 08A1D retains only coverage evidence, with its V1 logical mappings **PROVISIONAL_PENDING_R2_REVALIDATION**. No provider, owner, validity, rotation, revocation, deletion, or external evidence assertion has been made by this update.
