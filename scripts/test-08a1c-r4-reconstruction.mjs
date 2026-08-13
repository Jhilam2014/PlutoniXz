#!/usr/bin/env node

import assert from 'node:assert/strict';
import { buildR4, r4Constants, validateR4 } from './08a1c-r4-lib.mjs';

const NOW = '2026-08-13T00:00:00Z';
const legacy = { legacy_path_a_dispositions: 1, legacy_path_b_dispositions: 1, legacy_r3_actions: 1, legacy_authority_records: 1 };

function source({ includePlausible = true } = {}) {
  const canonical = [{ canonical_occurrence_id: 'CAN-PATH-A', reachability: ['CURRENT_TREE'] }];
  const classes = [{ candidate_equivalence_class_id: 'CEQ-PATH-A', logical_item_id: 'LI-PATH-A', canonical_occurrence_ids: ['CAN-PATH-A'], member_count: 1, provenance_distribution: { TEST_FIXTURE: 1 } }];
  const logical = [{ logical_item_id: 'LI-PATH-A', candidate_equivalence_class_id: 'CEQ-PATH-A', canonical_occurrence_ids: ['CAN-PATH-A'], classification: 'VERIFIED_SYNTHETIC_FIXTURE', status: 'PATH_A_CLOSED', disposition: 'VERIFIED_SYNTHETIC_FIXTURE', deterministic_noncredential_proof_id: 'PATHA-TEST', proof_family: 'DETERMINISTIC_COMMITTED_FIXTURE', grouping_basis: 'MEMORY_ONLY_EXACT_CANDIDATE_EQUALITY', grouping_validator_version: 'r2-test', suspected_provider: 'UNVERIFIED', provider_identity_status: 'UNVERIFIED_NO_PROVIDER_PROOF', reachability: ['CURRENT_TREE'], source_owner_candidate: 'SOURCE_OWNER_IDENTIFICATION_REQUIRED' }];
  if (includePlausible) {
    canonical.push({ canonical_occurrence_id: 'CAN-PATH-B', reachability: ['RUNTIME_ARTIFACT'] });
    classes.push({ candidate_equivalence_class_id: 'CEQ-PATH-B', logical_item_id: 'LI-PATH-B', canonical_occurrence_ids: ['CAN-PATH-B'], member_count: 1, provenance_distribution: { GENERATED_OUTPUT: 1 } });
    logical.push({ logical_item_id: 'LI-PATH-B', candidate_equivalence_class_id: 'CEQ-PATH-B', canonical_occurrence_ids: ['CAN-PATH-B'], classification: 'PLAUSIBLE_CREDENTIAL', status: 'PENDING_08A1C_ELIGIBILITY', disposition: 'UNKNOWN', deterministic_noncredential_proof_id: null, proof_family: null, grouping_basis: 'MEMORY_ONLY_EXACT_CANDIDATE_EQUALITY', grouping_validator_version: 'r2-test', suspected_provider: 'UNVERIFIED', provider_identity_status: 'UNVERIFIED_NO_PROVIDER_PROOF', reachability: ['RUNTIME_ARTIFACT'], source_owner_candidate: 'SOURCE_OWNER_IDENTIFICATION_REQUIRED' });
  }
  return { schema_version: '08A1B-R2-logical-credential-inventory-v1', run_id: 'r2-test', reviewed_at: NOW, reconstruction: { version: 'r2-test', candidate_equality: 'MEMORY_ONLY' }, canonical_occurrences: canonical, candidate_equivalence_classes: classes, logical_items: logical, totals: { scan_observations: canonical.length, canonical_occurrences: canonical.length, provenance_records: canonical.length, candidate_equivalence_classes: classes.length, deterministic_noncredential_logical_items: 1, plausible_credential_logical_items: includePlausible ? 1 : 0, unreconstructed_candidates: 0, scanner_output_recursion: 0 } };
}
function build(input = source(), counts = legacy) { const inventoryText = JSON.stringify(input); return { inventory: input, inventoryText, ...buildR4({ inventory: input, inventoryText, legacy: counts }) }; }
function validate(result) { return validateR4(result); }
function rejects(mutator, pattern) { const result = build(); mutator(result); assert.throws(() => validate(result), pattern); }

const baseline = build();
assert.deepEqual(build(), baseline, 'unchanged R4 input must produce identical output');
assert.deepEqual(validate(baseline), { terminal: 1, pending: 1, actions: 1 });

rejects((result) => { result.inventory.run_id = 'stale-r2'; }, /current R2 inventory|tied to the exact current R2 inventory/);
rejects((result) => { result.resolution.dispositions.push(structuredClone(result.resolution.dispositions[0])); }, /exactly one disposition/);
rejects((result) => { result.resolution.dispositions[0].authority_state = 'OWNER_REQUIRED'; }, /Path A disposition/);
rejects((result) => { result.actionPackage.pending_actions = []; }, /external queue/);
rejects((result) => { result.actionPackage.pending_actions[0].logical_item_ids = ['LI-PATH-B', 'LI-PATH-A']; }, /malformed, amplified/);
rejects((result) => { result.actionPackage.pending_actions[0].authority_domain_id = 'stale-domain'; }, /prohibited R3 domain/);
rejects((result) => { result.actionPackage.pending_actions[0].suspected_provider = 'GuessedProvider'; }, /malformed, amplified/);
rejects((result) => { result.resolution.apify_08a1a_record.logical_item_id = 'LI-PATH-B'; }, /Apify evidence/);
rejects((result) => { result.bridge.records[0].active_r2_membership = true; }, /stale predecessor/);
rejects((result) => { result.resolution.apify_08a1a_record.reason = 'api_key: abcdefghijklmnop'; }, /secret-bearing/);

const emptyPathB = build(source({ includePlausible: false }), { legacy_path_a_dispositions: 1, legacy_path_b_dispositions: 0, legacy_r3_actions: 0, legacy_authority_records: 0 });
assert.deepEqual(validate(emptyPathB), { terminal: 1, pending: 0, actions: 0 }, 'zero plausible items must produce an empty Path B queue');

function terminalEvidence(result, terminalResult = 'REVOKED') {
  const pending = result.resolution.dispositions.find((item) => item.logical_item_id === 'LI-PATH-B');
  pending.primary_state = terminalResult; pending.terminal = true; delete pending.missing_predicates;
  result.actionPackage.pending_actions = []; result.actionPackage.totals.pending_actions = 0;
  result.resolution.accepted_provider_evidence_records = [{ logical_item_id: 'LI-PATH-B', terminal_result: terminalResult, authority_scope: 'Scoped responsible role', provider_scope: 'Verified provider project environment', safe_r2_linkage_reference: 'provider-audit-reference', authorized_actor_or_role: 'Authorized provider operator', sanitized_evidence_reference: 'tests/sanitized-provider-record', provider_identity_state: 'PROVIDER_VERIFIED', evidence_level: 'PROVIDER_VERIFIED', action_timestamp: '2026-08-12T10:00:00Z', independent_verification_timestamp: '2026-08-12T10:01:00Z', current_tree_remediation_state: 'REMEDIATED_WITHOUT_INVALIDATION_CLAIM', reachable_history_remediation_state: 'REMEDIATED_WITHOUT_INVALIDATION_CLAIM', old_credential_invalidation_state: terminalResult === 'ROTATED_OLD_INVALIDATED' ? 'PROVEN' : 'NOT_APPLICABLE', replacement_required: false, replacement_health_evidence_state: 'NOT_APPLICABLE' }];
  result.resolution.totals.terminal_primary_total = 2; result.resolution.totals.non_terminal_primary_total = 0; result.resolution.totals.non_terminal_primary_by_state = { [r4Constants.PATH_B_PENDING]: 0 }; result.resolution.totals.authority_records = { accepted: 0, rejected: 1, pending: 0 }; result.resolution.totals.provider_evidence_records = { accepted: 1, rejected: 1, pending: 0 };
}

const terminal = build(); terminalEvidence(terminal); assert.deepEqual(validate(terminal), { terminal: 2, pending: 0, actions: 0 }, 'a complete synthetic Path B evidence fixture is accepted');
for (const [mutate, pattern] of [
  [(result) => { result.resolution.accepted_provider_evidence_records[0].current_tree_remediation_state = 'REMOVAL_ONLY'; }, /Removal alone/],
  [(result) => { result.resolution.accepted_provider_evidence_records[0].owner_assertion_only = true; }, /not provider-verified/],
  [(result) => { result.resolution.accepted_provider_evidence_records[0].independent_verification_timestamp = '2026-08-12T09:00:00Z'; }, /chronology/],
  [(result) => { result.resolution.accepted_provider_evidence_records[0].independent_verification_timestamp = 'not-a-time'; }, /timestamp/],
  [(result) => { result.resolution.accepted_provider_evidence_records[0].terminal_result = 'ROTATED_OLD_INVALIDATED'; result.resolution.dispositions.find((item) => item.logical_item_id === 'LI-PATH-B').primary_state = 'ROTATED_OLD_INVALIDATED'; result.resolution.accepted_provider_evidence_records[0].old_credential_invalidation_state = 'NOT_PROVEN'; }, /old-credential invalidation/],
  [(result) => { result.resolution.accepted_provider_evidence_records[0].replacement_required = true; result.resolution.accepted_provider_evidence_records[0].replacement_health_evidence_state = 'NOT_PROVEN'; }, /Replacement-required/],
]) {
  const result = build(); terminalEvidence(result); mutate(result); assert.throws(() => validate(result), pattern);
}

process.stdout.write('08A1C-R4 lineage, Path A, queue, authority/provider, chronology, redaction, reuse-boundary, stale-membership, and stability tests passed.\n');
