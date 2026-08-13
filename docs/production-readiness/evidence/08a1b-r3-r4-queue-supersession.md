# 08A1B-R3 / 08A1C-R4 queue supersession

## Outcome

The R4 external package is **NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE**. Its historical requests are retained solely as audit history and cannot be sent, populated, or counted as current owner/provider work.

| Measure | Count |
| --- | ---: |
| R4 historical request records preserved | 1067 |
| Historical request records made non-actionable | 1067 |
| Current active 08A1C actions | 0 |
| Current pending authority records | 0 |
| Current pending provider records | 0 |
| R3 positive secret candidates | 0 |
| R3 semantically unresolved classes | 23 |

## Corrected routing

Only `POSITIVE_SECRET_CANDIDATE` classes can ever enter 08A1C. `SEMANTICALLY_UNRESOLVED` classes retain repository analysis requirements and have no provider, authority, provider-action, or remediation disposition.

## Unresolved repository requirements

| Exact missing predicate | Classes |
| --- | ---: |
| AUTHENTICATION_OR_PRIVILEGED_CONSUMPTION_TRACE_REQUIRED | 10 |
| ENVIRONMENT_CANDIDATE_VARIABLE_UNRESOLVED | 1 |
| ENVIRONMENT_SOURCE_CONTEXT_REQUIRES_CONTROLLED_ANALYSIS | 2 |
| ENVIRONMENT_VALUE_FAILED_APPROVED_STRICT_PARSER | 1 |
| ENVIRONMENT_VARIABLE_HAS_NO_APPROVED_AUTHENTICATION_CONSUMER | 1 |
| EXACT_SOURCE_SCHEMA_PARSER_AND_CONSUMER_SEMANTICS_REQUIRED | 13 |
| NO_APPROVED_PRODUCER_SCHEMA_CONSUMER_CONTRACT | 9 |
| NON_FILE_OR_ARCHIVE_LOCATION_REQUIRES_SOURCE_LINEAGE | 8 |
| ORIGINAL_SOURCE_OR_HISTORY_CONTEXT_REQUIRES_BOUNDED_RETRIEVAL | 11 |
| SOURCE_IS_NOT_A_VALIDATED_STRUCTURED_RECORD | 1 |
| SOURCE_SCHEMA_OR_DETERMINISTIC_PRODUCER_CONTRACT_REQUIRED | 22 |

## Full 08A1D and 08A1C gate

- Corrected 08A1B semantic gate: `BLOCKED`
- Full 08A1D: `NOT_RUN_SEMANTIC_GATE_BLOCKED`
- 08A1C: `NOT_ELIGIBLE_SEMANTIC_TRIAGE_BLOCKED`
- 08A1E: `NOT_ELIGIBLE`

The historical R4 manifest remains a non-actionable audit attachment. This supersession status is the only current projection.
