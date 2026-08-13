#!/usr/bin/env node

/**
 * Publishes the final, value-free R3 semantic-gate evidence-gap decision.
 *
 * It consumes only current sanitized R2/R3/R4/08A1D artifacts.  It never
 * replays a scan, reads a live environment, or materializes class members.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { noCandidateBearingData } from './08a1b-r3-semantic-lib.mjs';

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}.`); return value; }
function fail(code, message) { const error = new Error(`${code}: ${message}`); error.code = code; throw error; }
function signature(predicates) { return [...predicates].sort().join('|'); }
function iso(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) && Number.isFinite(Date.parse(value)); }

const GROUPS = [
  {
    evidence_gap_category: 'MISSING_BOUNDED_HISTORY_OR_SOURCE_LINEAGE_PROOF',
    class_count: 6,
    missing_predicates: ['AUTHENTICATION_OR_PRIVILEGED_CONSUMPTION_TRACE_REQUIRED', 'NON_FILE_OR_ARCHIVE_LOCATION_REQUIRES_SOURCE_LINEAGE', 'ORIGINAL_SOURCE_OR_HISTORY_CONTEXT_REQUIRES_BOUNDED_RETRIEVAL', 'SOURCE_SCHEMA_OR_DETERMINISTIC_PRODUCER_CONTRACT_REQUIRED'],
    why_repository_only_evidence_is_insufficient: 'The available record lacks a bounded source lineage, a deterministic producer contract, and a privileged-consumer trace. The existing repository scope cannot safely establish the original record semantics.',
    minimum_authorized_evidence: 'One service-owner-approved bounded lineage packet, limited to the relevant source record, plus its producer/schema contract and either a privileged-consumer trace or an explicit no-consumer attestation.',
    authorized_evidence_source_types: ['approved bounded historical source retrieval', 'schema contract or internal documentation', 'service-owner attestation'],
    resolution_scope: 'MAY_ESTABLISH_POSITIVE_CANDIDATE_OR_NON_SECRET_STATUS_ONLY_WITH_ALL_REQUIRED_CONTRACTS',
    status: 'BLOCKED',
    blocked_reason_code: 'AUTHORIZATION_REQUIRED_FOR_BOUNDED_SOURCE_LINEAGE_AND_AUTHENTICATION_TRACE',
  },
  {
    evidence_gap_category: 'MISSING_EXACT_SEMANTIC_CONTRACT',
    class_count: 6,
    missing_predicates: ['EXACT_SOURCE_SCHEMA_PARSER_AND_CONSUMER_SEMANTICS_REQUIRED', 'NO_APPROVED_PRODUCER_SCHEMA_CONSUMER_CONTRACT', 'SOURCE_SCHEMA_OR_DETERMINISTIC_PRODUCER_CONTRACT_REQUIRED'],
    why_repository_only_evidence_is_insufficient: 'A structurally parsed record exists, but no approved source-to-field producer, parser, and consumer contract identifies its semantic role.',
    minimum_authorized_evidence: 'The smallest source-specific schema or producer contract that names the field role, its strict parser, and its allowed consumers.',
    authorized_evidence_source_types: ['schema contract', 'internal documentation', 'service-owner attestation'],
    resolution_scope: 'MAY_ESTABLISH_POSITIVE_CANDIDATE_OR_NON_SECRET_STATUS_ONLY_IF_THE_AUTHORIZED_CONTRACT_INCLUDES_STRICT_SECRET_AND_PRIVILEGED_USE_SEMANTICS',
    status: 'BLOCKED',
    blocked_reason_code: 'AUTHORIZATION_REQUIRED_FOR_EXACT_SOURCE_SEMANTIC_CONTRACT',
  },
  {
    evidence_gap_category: 'MISSING_SOURCE_SCHEMA_PRODUCER_AND_AUTHENTICATION_CONSUMER_PROOF',
    class_count: 3,
    missing_predicates: ['AUTHENTICATION_OR_PRIVILEGED_CONSUMPTION_TRACE_REQUIRED', 'NO_APPROVED_PRODUCER_SCHEMA_CONSUMER_CONTRACT', 'SOURCE_SCHEMA_OR_DETERMINISTIC_PRODUCER_CONTRACT_REQUIRED'],
    why_repository_only_evidence_is_insufficient: 'The sanitized repository record has neither an approved producer/schema contract nor a trace from the exact semantic field to a privileged consumer.',
    minimum_authorized_evidence: 'A source-specific schema or producer contract and one approved consumer trace that is bounded to the declared authentication or privileged-use boundary.',
    authorized_evidence_source_types: ['schema contract', 'approved runtime trace', 'service-owner attestation'],
    resolution_scope: 'MAY_ESTABLISH_POSITIVE_CANDIDATE_OR_NON_SECRET_STATUS_ONLY_WITH_STRICT_PARSER_AND_SECRET_BEARING_CONTRACT',
    status: 'BLOCKED',
    blocked_reason_code: 'AUTHORIZATION_REQUIRED_FOR_SOURCE_CONTRACT_AND_AUTHENTICATION_TRACE',
  },
  {
    evidence_gap_category: 'CONTROLLED_ENVIRONMENT_EVIDENCE_GAP',
    class_count: 2,
    missing_predicates: ['ENVIRONMENT_SOURCE_CONTEXT_REQUIRES_CONTROLLED_ANALYSIS', 'EXACT_SOURCE_SCHEMA_PARSER_AND_CONSUMER_SEMANTICS_REQUIRED', 'ORIGINAL_SOURCE_OR_HISTORY_CONTEXT_REQUIRES_BOUNDED_RETRIEVAL', 'SOURCE_SCHEMA_OR_DETERMINISTIC_PRODUCER_CONTRACT_REQUIRED'],
    why_repository_only_evidence_is_insufficient: 'The required source is controlled environment material that the current authorization excludes; history and field semantics therefore cannot be validated from published repository evidence.',
    minimum_authorized_evidence: 'A controlled-environment review authorization limited to variable-role metadata and the matching schema, producer, parser, and consumer contract; no value collection is permitted.',
    authorized_evidence_source_types: ['controlled-environment authorization', 'schema contract', 'service-owner attestation'],
    resolution_scope: 'MAY_ESTABLISH_POSITIVE_CANDIDATE_OR_NON_SECRET_STATUS_ONLY_WITH_VALUE_FREE_STRICT_SEMANTIC_EVIDENCE',
    status: 'BLOCKED',
    blocked_reason_code: 'AUTHORIZATION_REQUIRED_FOR_CONTROLLED_ENVIRONMENT_METADATA_ANALYSIS',
  },
  {
    evidence_gap_category: 'MISSING_SOURCE_LINEAGE_AND_EXACT_SEMANTIC_CONTRACT',
    class_count: 2,
    missing_predicates: ['EXACT_SOURCE_SCHEMA_PARSER_AND_CONSUMER_SEMANTICS_REQUIRED', 'NON_FILE_OR_ARCHIVE_LOCATION_REQUIRES_SOURCE_LINEAGE', 'ORIGINAL_SOURCE_OR_HISTORY_CONTEXT_REQUIRES_BOUNDED_RETRIEVAL', 'SOURCE_SCHEMA_OR_DETERMINISTIC_PRODUCER_CONTRACT_REQUIRED'],
    why_repository_only_evidence_is_insufficient: 'No bounded source lineage is available, and the published evidence does not establish the exact field contract needed to distinguish an identifier, fixture, or secret-bearing field.',
    minimum_authorized_evidence: 'One owner-approved bounded source-lineage record together with the exact source schema, parser, and consumer contract.',
    authorized_evidence_source_types: ['approved bounded historical source retrieval', 'schema contract', 'service-owner attestation'],
    resolution_scope: 'MAY_PROVE_NON_SECRET_STATUS_OR_REMAIN_UNRESOLVED; A_POSITIVE_RESULT_REQUIRES_A_SEPARATE_STRICT_SECRET_AND_PRIVILEGED_USE_CONTRACT',
    status: 'BLOCKED',
    blocked_reason_code: 'AUTHORIZATION_REQUIRED_FOR_SOURCE_LINEAGE_AND_EXACT_FIELD_SEMANTICS',
  },
  {
    evidence_gap_category: 'UNVALIDATED_STRUCTURED_RECORD_GAP',
    class_count: 1,
    missing_predicates: ['EXACT_SOURCE_SCHEMA_PARSER_AND_CONSUMER_SEMANTICS_REQUIRED', 'SOURCE_IS_NOT_A_VALIDATED_STRUCTURED_RECORD', 'SOURCE_SCHEMA_OR_DETERMINISTIC_PRODUCER_CONTRACT_REQUIRED'],
    why_repository_only_evidence_is_insufficient: 'Observed bytes are not tied to an approved structured-record schema, so the field role and any consumer semantics are unproven.',
    minimum_authorized_evidence: 'The governing structured-record schema and producer contract, plus the documented parser and consumer semantics for that field.',
    authorized_evidence_source_types: ['schema contract', 'internal documentation', 'service-owner attestation'],
    resolution_scope: 'MAY_ESTABLISH_POSITIVE_CANDIDATE_OR_NON_SECRET_STATUS_ONLY_IF_AN_APPROVED_STRICT_SECRET_CONTRACT_IS_PROVIDED',
    status: 'BLOCKED',
    blocked_reason_code: 'AUTHORIZATION_REQUIRED_FOR_STRUCTURED_RECORD_SCHEMA_AND_PRODUCER_PROOF',
  },
  {
    evidence_gap_category: 'MISSING_AUTHENTICATION_CONSUMER_TRACE',
    class_count: 1,
    missing_predicates: ['AUTHENTICATION_OR_PRIVILEGED_CONSUMPTION_TRACE_REQUIRED', 'ENVIRONMENT_VARIABLE_HAS_NO_APPROVED_AUTHENTICATION_CONSUMER', 'SOURCE_SCHEMA_OR_DETERMINISTIC_PRODUCER_CONTRACT_REQUIRED'],
    why_repository_only_evidence_is_insufficient: 'Controlled-environment role metadata alone does not prove that the exact semantic field is consumed by an approved authentication or privileged-use boundary.',
    minimum_authorized_evidence: 'A value-free service-owner attestation or approved runtime trace that binds the declared environment role to one authentication or privileged-use consumer, plus its schema contract.',
    authorized_evidence_source_types: ['approved runtime trace', 'service-owner attestation', 'schema contract'],
    resolution_scope: 'MAY_ESTABLISH_POSITIVE_CANDIDATE_OR_NON_SECRET_STATUS_ONLY_WITH_SECRET_BEARING_SCHEMA_AND_STRICT_PARSER_CONFIRMATION',
    status: 'BLOCKED',
    blocked_reason_code: 'AUTHORIZATION_REQUIRED_FOR_VALUE_FREE_AUTHENTICATION_CONSUMER_TRACE',
  },
  {
    evidence_gap_category: 'CONTROLLED_ENVIRONMENT_VARIABLE_MAPPING_GAP',
    class_count: 1,
    missing_predicates: ['ENVIRONMENT_CANDIDATE_VARIABLE_UNRESOLVED', 'EXACT_SOURCE_SCHEMA_PARSER_AND_CONSUMER_SEMANTICS_REQUIRED', 'ORIGINAL_SOURCE_OR_HISTORY_CONTEXT_REQUIRES_BOUNDED_RETRIEVAL', 'SOURCE_SCHEMA_OR_DETERMINISTIC_PRODUCER_CONTRACT_REQUIRED'],
    why_repository_only_evidence_is_insufficient: 'The current authorized evidence cannot establish a unique value-free mapping from the source record to a controlled-environment role or its historical lineage.',
    minimum_authorized_evidence: 'A controlled-environment authorization for value-free variable-role mapping, accompanied by the relevant historical lineage and source schema contract.',
    authorized_evidence_source_types: ['controlled-environment authorization', 'approved bounded historical source retrieval', 'schema contract'],
    resolution_scope: 'MAY_ESTABLISH_POSITIVE_CANDIDATE_OR_NON_SECRET_STATUS_ONLY_WITH_A_UNIQUE_VALUE_FREE_MAPPING_AND_STRICT_CONTRACT',
    status: 'BLOCKED',
    blocked_reason_code: 'AUTHORIZATION_REQUIRED_FOR_CONTROLLED_ENVIRONMENT_ROLE_MAPPING',
  },
  {
    evidence_gap_category: 'CONTROLLED_ENVIRONMENT_STRICT_PARSER_GAP',
    class_count: 1,
    missing_predicates: ['ENVIRONMENT_VALUE_FAILED_APPROVED_STRICT_PARSER', 'EXACT_SOURCE_SCHEMA_PARSER_AND_CONSUMER_SEMANTICS_REQUIRED'],
    why_repository_only_evidence_is_insufficient: 'An observed controlled-environment role has an approved consumer, but the value did not satisfy the approved strict parser and no exact alternate non-secret semantic contract is authorized.',
    minimum_authorized_evidence: 'A value-free schema or producer contract that proves the field is non-secret, including the field parser and consumer role; no alternate parser or classifier change is implied.',
    authorized_evidence_source_types: ['schema contract', 'internal documentation', 'service-owner attestation'],
    resolution_scope: 'CAN_ONLY_PROVE_NON_SECRET_STATUS_OR_REMAIN_UNRESOLVED_UNDER_THE_CURRENT_APPROVED_PARSER',
    status: 'BLOCKED',
    blocked_reason_code: 'AUTHORIZATION_REQUIRED_FOR_NON_SECRET_CONTRACT_AFTER_STRICT_PARSER_NON_MATCH',
  },
].map((group) => ({ ...group, missing_predicates: [...group.missing_predicates].sort(), authorized_evidence_source_types: [...group.authorized_evidence_source_types].sort() }));

const DIMENSION_DEFINITIONS = [
  ['MISSING_SOURCE_SCHEMA_PRODUCER_OR_CONSUMER_PROOF', ['SOURCE_SCHEMA_OR_DETERMINISTIC_PRODUCER_CONTRACT_REQUIRED']],
  ['MISSING_EXACT_SEMANTIC_CONTRACT', ['EXACT_SOURCE_SCHEMA_PARSER_AND_CONSUMER_SEMANTICS_REQUIRED']],
  ['MISSING_BOUNDED_HISTORY_OR_SOURCE_LINEAGE_PROOF', ['ORIGINAL_SOURCE_OR_HISTORY_CONTEXT_REQUIRES_BOUNDED_RETRIEVAL']],
  ['MISSING_AUTHENTICATION_CONSUMER_TRACE', ['AUTHENTICATION_OR_PRIVILEGED_CONSUMPTION_TRACE_REQUIRED']],
  ['CONTROLLED_ENVIRONMENT_OR_STRUCTURED_RECORD_GAP', ['ENVIRONMENT_CANDIDATE_VARIABLE_UNRESOLVED', 'ENVIRONMENT_SOURCE_CONTEXT_REQUIRES_CONTROLLED_ANALYSIS', 'ENVIRONMENT_VALUE_FAILED_APPROVED_STRICT_PARSER', 'ENVIRONMENT_VARIABLE_HAS_NO_APPROVED_AUTHENTICATION_CONSUMER', 'SOURCE_IS_NOT_A_VALIDATED_STRUCTURED_RECORD']],
];

function markdown(decision) {
  const dimensions = decision.non_exclusive_evidence_gap_dimensions.map((item) => `| ${item.evidence_gap_dimension} | ${item.class_count} |`).join('\n');
  const groups = decision.exclusive_reason_breakdown.map((group, index) => `### Group ${index + 1} — ${group.evidence_gap_category}\n\n- **Sanitized class count:** ${group.class_count}\n- **STATUS:** ${group.status}\n- **Reason code:** ${group.blocked_reason_code}\n- **Why repository-only evidence is insufficient:** ${group.why_repository_only_evidence_is_insufficient}\n- **Minimum authorized evidence:** ${group.minimum_authorized_evidence}\n- **Authorized source type:** ${group.authorized_evidence_source_types.join('; ')}\n- **Resolution scope:** ${group.resolution_scope}\n- **Missing predicates:** ${group.missing_predicates.join(', ')}\n`).join('\n');
  return `# 08A1B-R3 final semantic-gate evidence-gap decision\n\n## Disposition\n\nEXECUTION_STATUS: PASS\n\nSEMANTIC_GATE_STATUS: BLOCKED\n\nSEMANTIC_GATE_REASON_CODE: SEMANTIC_GATE_UNRESOLVED_CLASSES_REQUIRE_AUTHORIZED_EVIDENCE\n\nOVERALL_DISPOSITION: BLOCKED_PASS\n\nDECISION: ACCEPT_BLOCKED_PASS\n\nDECISION_OUTCOME: ACCEPTED_EVIDENCE_LIMITED_EXCEPTION\n\nThe execution and all applicable artifact validations are complete. The semantic gate remains blocked because 23 classes lack authorized semantic evidence. The 23 unresolved classes are accepted as an evidence-limited exception. No positive candidates were established. Current R4 provider and authority queues remain empty, and 08A1D remains \`NOT_RUN_SEMANTIC_GATE_BLOCKED\`. No further repository-only action is justified or authorized.\n\n## Reconciled state\n\n| Measure | Count or state |\n| --- | --- |\n| R2 scan observations | ${decision.reconciled_state.r2_scan_observations} |\n| R2/R3 equivalence classes | ${decision.reconciled_state.equivalence_classes} |\n| Deterministic non-secrets | ${decision.reconciled_state.deterministic_non_secrets} |\n| Positive candidates established | ${decision.reconciled_state.positive_candidates_established} |\n| Semantically unresolved classes | ${decision.reconciled_state.semantically_unresolved_classes} |\n| Current R4 provider queue | ${decision.reconciled_state.current_r4_provider_queue} |\n| Current R4 authority queue | ${decision.reconciled_state.current_r4_authority_queue} |\n| 08A1D | ${decision.reconciled_state.full_08a1d_status} |\n\n## Sanitized evidence-gap dimensions\n\nThese dimensions overlap; the exclusive nine-group breakdown below reconciles to 23 classes exactly.\n\n| Evidence-gap dimension | Classes |\n| --- | ---: |\n${dimensions}\n\n## Exclusive reason breakdown and minimum authorized evidence\n\n${groups}\n## Final owner decision\n\nSTATUS: PASS\n\nDecision code: ACCEPT_BLOCKED_PASS\n\nReason code: OWNER_ACCEPTED_EVIDENCE_LIMITED_EXCEPTION\n\nThe owner accepts the blocked-pass disposition as final. No additional evidence source is authorized by this decision. Any future reopening requires a new explicit, value-free, bounded authorization and must not imply provider contact, authority action, live-environment access, candidate-value collection, or classifier relaxation.\n\n## Non-disclosure and inactivity controls\n\nSTATUS: PASS\n\nThis package contains only aggregate counts, reason codes, semantic predicates, and evidence-source categories. It contains no candidate values, fragments, hashes, tags, class identifiers, or other candidate-derived material. It does not create provider or authority work, and it preserves the current empty R4 queues and blocked 08A1D state.\n`;
}

function validateInputs({ r2, r3, r4Status, r4Manifest, r4Authority, gate }) {
  if (!noCandidateBearingData({ r2, r3, r4Status, r4Manifest, r4Authority, gate })) fail('SANITIZED_INPUT_DISCLOSURE_DETECTED', 'One or more source artifacts contain prohibited candidate-bearing data.');
  if (r2?.totals?.scan_observations !== 14984 || r2?.totals?.candidate_equivalence_classes !== 1068) fail('R2_RECONCILIATION_MISMATCH', 'The decision package requires the validated R2 totals.');
  if (r3?.schema_version !== '08A1B-R3-semantic-classification-v1' || r3?.totals?.equivalence_classes !== 1068 || r3?.totals?.deterministic_non_secret !== 1045 || r3?.totals?.positive_secret_candidate !== 0 || r3?.totals?.semantically_unresolved !== 23 || r3?.semantic_gate?.status !== 'BLOCKED') fail('R3_SEMANTIC_STATE_MISMATCH', 'The decision package requires the validated blocked R3 state.');
  if (r4Status?.semantic_gate_status !== 'BLOCKED' || r4Status?.current_package_status !== 'NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE' || r4Status?.totals?.current_pending_authority_records !== 0 || r4Status?.totals?.current_pending_provider_records !== 0 || r4Manifest?.totals?.active_actions !== 0 || r4Manifest?.totals?.pending_authority !== 0 || r4Manifest?.totals?.pending_provider !== 0 || r4Authority?.totals?.active_actions !== 0 || r4Authority?.totals?.pending_authority !== 0 || r4Authority?.totals?.pending_provider !== 0) fail('R4_INACTIVITY_MISMATCH', 'The decision package requires empty current R4 queues.');
  if (gate?.status !== 'NOT_RUN_SEMANTIC_GATE_BLOCKED' || gate?.prerequisite?.semantically_unresolved_classes !== 23 || gate?.policy?.full_08a1d_rerun_performed !== false) fail('08A1D_GATE_MISMATCH', 'The decision package requires the blocked 08A1D gate.');
}

function deriveDimensions(r3) {
  const unresolved = r3.classes.filter((item) => item.semantic_state === 'SEMANTICALLY_UNRESOLVED');
  return DIMENSION_DEFINITIONS.map(([evidence_gap_dimension, predicates]) => ({
    evidence_gap_dimension,
    class_count: unresolved.filter((item) => item.missing_predicates.some((predicate) => predicates.includes(predicate))).length,
    counting_method: predicates.length === 1 ? 'COUNT_OF_UNRESOLVED_CLASSES_WITH_PREDICATE' : 'COUNT_OF_UNRESOLVED_CLASSES_WITH_ANY_LISTED_PREDICATE',
  }));
}

function validateGrouping(r3) {
  const actual = new Map();
  for (const item of r3.classes.filter((entry) => entry.semantic_state === 'SEMANTICALLY_UNRESOLVED')) {
    const key = signature(item.missing_predicates);
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }
  const expected = new Map(GROUPS.map((group) => [signature(group.missing_predicates), group.class_count]));
  if (actual.size !== expected.size || [...expected].some(([key, count]) => actual.get(key) !== count)) fail('UNRESOLVED_GROUPING_MISMATCH', 'The sanitized exclusive gap grouping no longer reconciles to current R3 evidence.');
  if (GROUPS.reduce((sum, group) => sum + group.class_count, 0) !== 23) fail('UNRESOLVED_GROUPING_TOTAL_MISMATCH', 'The exclusive gap grouping must total 23 classes.');
}

async function write(target, content) { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, 'utf8'); }

async function main() {
  const reviewedAt = required('--reviewed-at'); if (!iso(reviewedAt)) fail('INVALID_REVIEW_TIMESTAMP', 'Expected an ISO UTC timestamp.');
  const [r2, r3, r4Status, r4Manifest, r4Authority, gate] = await Promise.all([
    readFile(required('--r2-inventory'), 'utf8').then(JSON.parse),
    readFile(required('--r3-classification'), 'utf8').then(JSON.parse),
    readFile(required('--r4-status'), 'utf8').then(JSON.parse),
    readFile(required('--r4-manifest'), 'utf8').then(JSON.parse),
    readFile(required('--r4-authority'), 'utf8').then(JSON.parse),
    readFile(required('--08a1d-gate'), 'utf8').then(JSON.parse),
  ]);
  validateInputs({ r2, r3, r4Status, r4Manifest, r4Authority, gate });
  process.stdout.write('INPUT_RECONCILIATION_STATUS: PASS\n');
  validateGrouping(r3);
  process.stdout.write('UNRESOLVED_REASON_GROUPING_STATUS: PASS\n');
  const decision = {
    schema_version: '08A1B-R3-semantic-gate-evidence-gap-decision-v1',
    reviewed_at: reviewedAt,
    execution_status: 'PASS',
    semantic_gate_status: 'BLOCKED',
    semantic_gate_reason_code: 'SEMANTIC_GATE_UNRESOLVED_CLASSES_REQUIRE_AUTHORIZED_EVIDENCE',
    overall_disposition: 'BLOCKED_PASS',
    decision: 'ACCEPT_BLOCKED_PASS',
    decision_outcome: 'ACCEPTED_EVIDENCE_LIMITED_EXCEPTION',
    decision_scope: {
      no_additional_repository_scan_performed: true,
      no_classifier_relaxation_or_positive_creation_performed: true,
      no_live_environment_or_external_system_access_performed: true,
      no_provider_or_authority_action_performed: true,
      no_candidate_or_candidate_derived_material_persisted: true,
    },
    source_artifacts: ['08a1b-r2-logical-credential-inventory.sanitized.json', '08a1b-r3-semantic-classification.sanitized.json', '08a1c-external-r4/current-semantic-triage-status.sanitized.json', '08a1c-external-r4/external-action-manifest.sanitized.json', '08a-owner-authority-records.sanitized.json', '08a1d-r3-semantic-gate.sanitized.json'],
    reconciled_state: {
      r2_scan_observations: r2.totals.scan_observations,
      equivalence_classes: r3.totals.equivalence_classes,
      deterministic_non_secrets: r3.totals.deterministic_non_secret,
      positive_candidates_established: r3.totals.positive_secret_candidate,
      semantically_unresolved_classes: r3.totals.semantically_unresolved,
      current_r4_provider_queue: r4Status.totals.current_pending_provider_records,
      current_r4_authority_queue: r4Status.totals.current_pending_authority_records,
      full_08a1d_status: gate.status,
    },
    non_exclusive_evidence_gap_dimensions: deriveDimensions(r3),
    exclusive_reason_breakdown: GROUPS,
    owner_authorization_decision: {
      status: 'PASS',
      decision: 'ACCEPT_BLOCKED_PASS',
      decision_reason_code: 'OWNER_ACCEPTED_EVIDENCE_LIMITED_EXCEPTION',
      required: false,
      additional_evidence_authorized: false,
      future_reopening_requires_new_explicit_authorization: true,
      authorization_limits: 'Any future authorization must remain value-free and bounded to the documented evidence source. It must not authorize provider contact, authority action, live-environment access, candidate-value collection, or classifier relaxation.',
    },
    no_further_repository_only_action_justified_without_new_authorization: true,
  };
  if (!noCandidateBearingData(decision)) fail('DECISION_DISCLOSURE_PREVENTION_FAILED', 'The decision record would contain prohibited candidate-bearing data.');
  const decisionMarkdown = markdown(decision);
  if (!noCandidateBearingData(decisionMarkdown)) fail('MARKDOWN_DISCLOSURE_PREVENTION_FAILED', 'The decision Markdown would contain prohibited candidate-bearing data.');
  await Promise.all([
    write(required('--output-json'), `${JSON.stringify(decision, null, 2)}\n`),
    write(required('--output-markdown'), decisionMarkdown),
  ]);
  process.stdout.write('SEMANTIC_GATE_STATUS: BLOCKED — SEMANTIC_GATE_UNRESOLVED_CLASSES_REQUIRE_AUTHORIZED_EVIDENCE\n');
  process.stdout.write('DECISION_PUBLICATION_STATUS: PASS\n');
  process.stdout.write('EXECUTION_STATUS: PASS\n');
}

main().catch((error) => {
  process.stderr.write(`DECISION_PUBLICATION_STATUS: FAIL — ${error.code ?? 'DECISION_BUILD_FAILED'}: ${error.message}\n`);
  process.exitCode = 1;
});
