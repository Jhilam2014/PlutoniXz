# Secret scanning

Run the pinned scanner locally with:

```sh
npm run secret:scan
npm run secret:scan:verify-fixture
```

The scanner runs `zricethezav/gitleaks` version 8.30.0 pinned to digest `sha256:691af3c7c5a48b16f187ce3446d5f194838f91238f27270ed36eef6359a574d9`. It extends the detector's default rule set, scans the complete local worktree (including staged and untracked files), all reachable Git history, and any present repository-owned runtime, memory, observability, deliverable, client-bundle, and desktop-resource roots. The worktree scan uses a temporary, exact path-list staging directory so development dependencies and large generated artifacts are reviewed through their dedicated root scans rather than exhausting the scanner process. Docker build contexts are a subset of the scanned worktree after the checked-in `.dockerignore` policy is applied.

Each scan uses Gitleaks' full redaction setting, one level of encoded-content decoding, and up to three nested archive levels. The control validates after every scope that every `Secret` field is exactly `REDACTED` and every `Match` field has a redaction marker; it deletes a generated report that fails this check without printing it. Scanner console output is intentionally not persisted. To prevent archive expansion from exhausting a developer or CI runner, individual files larger than 32 MiB are not read by Gitleaks; `unscannable-large-files.tsv` records their safe relative path and byte size for an approved, format-appropriate follow-up scan. Generated local evidence is written under `runtime/secret-scan/<UTC timestamp>/`: per-scope JSON reports retain only Gitleaks rule IDs, locations, fingerprints, and redacted match values; `summary.jsonl` records scope, duration, exit code, and finding count. These files are runtime artifacts and are ignored by Git. The runtime producing scan stages `runtime/` without `runtime/secret-scan/`, preventing prior scanner reports from becoming runtime application input; every produced report remains independently subject to the structural redaction guard.

`npm run secret:scan:verify-fixture` creates a temporary, unmistakably fake token, confirms the scanner fails on it and reports it redacted, removes the temporary fixture, then confirms the scanner passes. It does not add a credential-shaped fixture to the repository.

No broad secret-scanner allowlist is configured. A finding is a release blocker until it is remediated or receives a narrowly scoped, reviewed, time-bounded disposition outside this default configuration. Provider-side revocation/rotation is an external control and cannot be proved by this scanner.

## 08A one-to-one reconciliation and artifact inventory

For the 08A incident evidence, use the following repository controls after a structurally redacted history report has been produced:

```sh
npm run secret:reconcile:08a
npm run secret:reconcile:08a:verify
npm run secret:artifacts:08a
npm run secret:artifacts:08a:verify
npm run secret:artifacts:08a1d:test
npm run secret:artifacts:08a1d
npm run secret:artifacts:08a1d:verify
npm run secret:reconcile:08a1b:test
SECRET_SCAN_RUN_ID=<UTC-run-id> npm run secret:reconcile:08a1b
npm run secret:reconcile:08a1c:test
SECRET_SCAN_RUN_ID=<validated-08A1B-run-id> npm run secret:reconcile:08a1c
```

The 08A1B reconciliation generator emits a three-layer inventory: `scan_observation`, `canonical_occurrence`, and `logical_item`. Source-report redaction is checked before a report is parsed. A canonical occurrence can combine only observations of the same normalized object/location, commit/object marker, rule, line span, and scanner-native finding identity. Gitleaks' location-oriented fingerprint is documented metadata, not credential equality; without an independently safe equality identifier every canonical occurrence remains a separate `UNKNOWN` / `UNRESOLVED` logical item. The validator checks forward and reverse links, stable identifiers, all layer counts, raw-field absence, and conservative grouping. Run `npm run secret:reconcile:08a1b:test` for synthetic overlap, repeated-history, two-signal, copied-artifact, stability, and non-disclosure coverage.

The 08A1D artifact control derives its scope from the Compose build context and `.dockerignore` allowlist plus repository-owned runtime/export, memory, observability, deliverable, and build-output roots. Discovery uses `lstat`, never follows symlinks, excludes prior scanner-report directories, and records checksum, size, reachability, and actual format. ZIP files are preflighted for traversal, link/special-file entries, encryption, entry count, declared size, and expansion ratio before bounded temporary extraction. Oversized regular/binary files receive non-persistent static string extraction plus a read-only pinned Gitleaks file scan. All reports are structurally redacted before use.

The coverage states are `CLEAN`, `FINDINGS_RECONCILED`, `FINDINGS_MAPPED_PENDING_DISPOSITION`, `UNSCANNED`, `UNSUPPORTED`, and `OUT_OF_SCOPE_APPROVED`. A finding is mapped only through its 08A1B canonical identity; mapped-pending is acceptable for 08A1D when the independent 08A1C owner disposition remains open. `--require-coverage` rejects `UNSCANNED`, `UNSUPPORTED`, unmapped observations, missing scan evidence, invalid exclusions, report-recursion paths, or raw-value-shaped output fields. Approved exclusions require a named owner, evidence reference, and unexpired review timestamp.

## 08A1C authority and disposition closure

`08A1C` consumes, but does not rewrite, the validated 08A1B inventory. `08a-owner-authority-records.sanitized.json` stores scoped active or pending authority records only; a source path, rule label, commit author, or Admin title does not establish provider authority. The generator creates one disposition record and one owner-action row per logical item, as well as the authority matrix and reconciler-consumption appendix. The validator rejects an expired or missing authority, unsupported primary state, missing evidence, reversed action/verification chronology, rotation without old-credential invalidation, current-tree-only history handling, image-only proof, broad or weakly linked batches, evidence reuse across unrelated closures, duplicate logical-item closure, and hidden non-terminal states. The synthetic test includes positive deterministic fixture closure and negative coverage for those fail-closed controls.

`OWNER_ASSERTED` provider evidence is terminal only when the checked-in authority policy explicitly permits the exact scoped authority and a safe logical-item linkage exists. The current Apify authority record is deliberately not applied to an 08A1B scanner finding: its alias has no safe equality or provenance linkage to an inventory item. If 08A1C has non-terminal items, its result is `BLOCKED` after the per-item residual action inventory has been generated; 08A1D artifact coverage can continue independently.
