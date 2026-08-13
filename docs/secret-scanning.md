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
npm run secret:reconcile:08a1b:r3:test
npm run secret:reconcile:08a1b:r3
npm run secret:reconcile:08a1b:atomic:test
npm run secret:reconcile:08a1b:atomic
npm run secret:reconcile:08a1b:atomic:verify
npm run secret:reconcile:08a1c:test
npm run secret:reconcile:08a1c
```

08A1B-R2 is the current reconciliation control. `npm run secret:reconcile:08a1b` performs a new bounded scan of the configured local scopes and reconstructs candidate equality only in memory. A fresh per-run HMAC partitions candidates and constant-time byte comparison confirms each partition; candidate values, HMAC keys/tags, fragments, and derived hashes are never written. Structurally redacted scanner reports preserve only auditable observation metadata. A location-oriented scanner fingerprint is never treated as candidate equality: if one location/fingerprint contains multiple candidate bytes, R2 assigns separate memory-derived canonical occurrence slots before forming logical classes. The validator checks exact forward and reverse memberships, one equivalence class per canonical occurrence, raw-field absence, generated-report exclusion, deterministic Path A proof, and one-to-one inflation controls. Run `npm run secret:reconcile:08a1b:test` for repeated-copy, cross-scope, unequal-history, location-metadata ambiguity, overlap, provenance, fixture, recursion, and non-disclosure coverage.

08A1B-R3 is the corrected semantic layer. It consumes immutable R2 equality membership, processes complete candidates only in a bounded trusted process, and emits exactly one state per class: `DETERMINISTIC_NON_SECRET`, `POSITIVE_SECRET_CANDIDATE`, or `SEMANTICALLY_UNRESOLVED`. Missing Path A proof is never positive-secret evidence. A positive state requires a strict full-value parser plus secret-bearing schema and privileged-use context; unresolved classes retain an exact repository source/schema/parser/consumer requirement and cannot receive a provider, authority, or external action. Current semantic evidence is `08a1b-r3-semantic-classification.sanitized.json` and `08a1b-r3-rule-precision-summary.md`.

`npm run secret:reconcile:08a1b:atomic` is the recovery path for a frozen R2 snapshot. It replays only the paths named in the frozen, structurally redacted reports; reachable-history paths are pinned to that snapshot's commit boundary. Each scope has one 15-minute aggregate deadline across all replay targets. R2 equality and R3 semantic classification run in the same memory-only process, so no second full replay is required. The runner validates exact observation membership, writes no candidate values, tags, hashes, or `.env` values, and archives the preceding R3/R4 projections before publishing validated current evidence. Controlled `.env` context can map a candidate only to one variable name and an approved local authentication consumer; ambiguous or unapproved values remain unresolved.

The former R4 external package is now `NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE`. Its 1,067 requests are retained in the `.r4-audit.sanitized.json` files for audit but are not current pending authority/provider work. The only current package state is `08a1c-external-r4/current-semantic-triage-status.sanitized.json`. A full 08A1D rerun is allowed only after the R3 semantic gate passes with zero unresolved classes; otherwise 08A1D is explicitly `NOT RUN`.

The 08A1D artifact control derives its scope from the Compose build context and `.dockerignore` allowlist plus repository-owned runtime/export, memory, observability, deliverable, and build-output roots. Discovery uses `lstat`, never follows symlinks, excludes prior scanner-report directories, and records checksum, size, reachability, and actual format. ZIP files are preflighted for traversal, link/special-file entries, encryption, entry count, declared size, and expansion ratio before bounded temporary extraction. Oversized regular/binary files receive non-persistent static string extraction plus a read-only pinned Gitleaks file scan. All reports are structurally redacted before use.

The coverage states are `CLEAN`, `FINDINGS_RECONCILED`, `FINDINGS_MAPPED_PENDING_DISPOSITION`, `UNSCANNED`, `UNSUPPORTED`, and `OUT_OF_SCOPE_APPROVED`. A finding is mapped only through its 08A1B canonical identity; mapped-pending is acceptable for 08A1D when the independent 08A1C owner disposition remains open. `--require-coverage` rejects `UNSCANNED`, `UNSUPPORTED`, unmapped observations, missing scan evidence, invalid exclusions, report-recursion paths, or raw-value-shaped output fields. Approved exclusions require a named owner, evidence reference, and unexpired review timestamp.

## 08A1C authority and disposition closure

`08A1C` consumes only R3 `POSITIVE_SECRET_CANDIDATE` classes after the R3 semantic gate passes. `08a-owner-authority-records.sanitized.json` is the current authority/provider projection; it is empty while triage is blocked. A source path, rule label, commit author, Admin title, entropy, or a missing Path A proof never establishes secret semantics, provider identity, or authority. The historical R4 record is retained separately for audit.

`OWNER_ASSERTED` provider evidence is terminal only when the checked-in authority policy explicitly permits the exact scoped authority and a safe logical-item linkage exists. The current Apify authority record is deliberately not applied to an 08A1B scanner finding: its alias has no safe equality or provenance linkage to an inventory item. If 08A1C has non-terminal items, its result is `BLOCKED` after the per-item residual action inventory has been generated; 08A1D artifact coverage can continue independently.
