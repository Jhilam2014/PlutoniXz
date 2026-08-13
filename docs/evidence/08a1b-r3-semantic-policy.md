# 08A1B-R3 semantic classification policy

## Corrected invariant

Exact R2 equality proves only which observations contain equal candidate bytes. It does not prove that a distinct value is a credential. R3 assigns exactly one deterministic semantic state to each R2 equivalence class: `DETERMINISTIC_NON_SECRET`, `POSITIVE_SECRET_CANDIDATE`, or `SEMANTICALLY_UNRESOLVED`.

## Decision rules

- Path A requires exact membership plus an approved producer/schema/parser and consumer contract with a deterministic regression test.
- Positive routing requires a strict full-value parser evaluated only in memory **and** the appropriate secret-bearing schema and privileged-use trace. Provider, owner, and authority are never inferred here.
- Absence of Path A proof remains unresolved. It is never promoted to a positive secret candidate.
- Unresolved classes retain an exact repository source/schema/parser/consumer requirement and never enter an 08A1C provider queue.

## Bounded trusted process

The runner replays structurally redacted R2 reports against a memory-only raw scanner. Candidate/source buffers are processed in process memory; reports, candidate bytes, equality tags, fragments, and candidate-derived identifiers are not written. Current-tree and reachable-history context access refuses environment files, archive-internal paths, unavailable sources, and files above the bounded context limit. Buffers are cleared after each context evaluation to the extent Node.js permits.

## Approved Path A families in this implementation

| Family | Deterministic contract |
| --- | --- |
| Committed synthetic fixture | Exact fixture location plus committed positive/negative scanner assertions |
| Self-improvement identifier | Strict generated identifier grammar, `createId` producer, and JSON/JSONL serialization contract |
| Token-economy content identifier | Strict content-ID grammar, token-economy producer, and timeline serialization contract |
| Integrity digest | Strict SHA-256 grammar plus an approved integrity producer and consumer contract |

No path/origin, field name, rule label, entropy score, or missing Path A proof is a semantic proof by itself.
