#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildResolution, validateResolution } from './verify-08a1c-owner-dispositions.mjs';

const REVIEWED_AT = '2026-08-12T12:00:00Z';
const CANONICAL_ID = 'CAN-TEST-0001';
const LOGICAL_ID = 'LI-TEST-0001';

function sourceManifest({ reachability = ['CURRENT_TREE'] } = {}) {
  return {
    schema_version: '08A1B-canonical-inventory-v1', run_id: '08a1c-test', observation_count: 1, canonical_occurrence_count: 1, logical_item_count: 1,
    canonical_occurrences: [{ canonical_occurrence_id: CANONICAL_ID, canonical_identity: { normalized_location: 'fixtures/safe-provenance.json', object_marker: 'CURRENT_TREE', rule_id: 'test-rule', start_line: 1, end_line: 1, safe_scanner_fingerprint: 'fixtures/safe-provenance.json:test-rule:1' } }],
    logical_items: [{ logical_item_id: LOGICAL_ID, canonical_occurrence_ids: [CANONICAL_ID], status: 'UNRESOLVED', disposition: 'UNKNOWN', candidate_source_owner_domain: 'SOURCE_OWNER_CURRENT_TREE', reachability, current_tree_remediation_status: reachability.includes('CURRENT_TREE') ? 'PRESENT_IN_CURRENT_TREE_SCOPE' : 'NOT_PRESENT_IN_CURRENT_TREE_SCOPE', reachable_history_status: reachability.includes('REACHABLE_HISTORY') ? 'PRESENT_IN_REACHABLE_HISTORY_SCOPE' : 'NOT_PRESENT_IN_HISTORY_SCOPE' }],
  };
}
function pendingAuthority() { return { authority_id: 'AUTH-PENDING-SOURCE_OWNER_CURRENT_TREE', status: 'PENDING_AUTHORITY_EVIDENCE', accountable_owner_or_role: 'UNASSIGNED', provider_project_service_scope: 'UNKNOWN', environment_scope: 'UNKNOWN', authority_basis: 'No authority record.', sanitized_evidence_reference: 'NO_AUTHORITY_EVIDENCE_RECORDED', evidence_level: 'NONE', approval_timestamp: null, validity_or_review_period: 'Pending evidence.', candidate_source_owner_domain: 'SOURCE_OWNER_CURRENT_TREE' }; }
function activeAuthority({ validUntil = '2026-08-12T13:00:00Z' } = {}) { return { authority_id: 'AUTH-TEST-PROVIDER', status: 'ACTIVE_PROVIDER_VERIFIED', accountable_owner_or_role: 'Provider test owner', provider_project_service_scope: 'Test provider scope', authorized_providers: ['TestProvider'], environment_scope: 'Test', authority_basis: 'Deterministic test authority.', sanitized_evidence_reference: 'tests/provider-authority.md', evidence_level: 'PROVIDER_VERIFIED', approval_timestamp: '2026-08-12T11:00:00Z', valid_from: '2026-08-12T11:00:00Z', valid_until: validUntil, validity_or_review_period: 'Fixture test window.', candidate_source_owner_domain: null }; }
function config({ overrides = [], active = null } = {}) { return { schema_version: '08A1C-authority-records-v1', reviewed_at: REVIEWED_AT, evidence_policy: { owner_asserted_terminal_authority_ids: [] }, authority_records: [pendingAuthority(), ...(active ? [active] : [])], disposition_overrides: overrides }; }
function fact({ proofFamily = 'DETERMINISTIC_COMMITTED_FIXTURE', disposition = 'VERIFIED_SYNTHETIC_FIXTURE', extra = {} } = {}) {
  const value = { logical_item_id: LOGICAL_ID, canonical_occurrence_id: CANONICAL_ID, closure_path: 'PATH_A_REPOSITORY_FACT', disposition, proof_family: proofFamily, reason_code: 'DETERMINISTIC_NON_PROVIDER_TEST_FIXTURE', safe_provenance: 'Deterministic committed source fixture under test control; no provider identity is inferred.', source_version: 'test-source-v1', validator_version: 'test-fact-validator-v1', proof_reference: 'tests/safe-fixture-proof.md', regression_test_reference: 'scripts/test-08a1c-owner-dispositions.mjs', repository_verification_timestamp: '2026-08-12T11:30:00Z', ...extra };
  if (proofFamily === 'DETERMINISTIC_COMMITTED_FIXTURE' && !Object.hasOwn(extra, 'generator_proof_reference')) value.generator_proof_reference = 'tests/deterministic-fixture-generator.mjs';
  if ((proofFamily === 'DETERMINISTIC_MASKED_DERIVATIVE' || proofFamily === 'SCANNER_EVIDENCE_DERIVATIVE') && !Object.hasOwn(extra, 'derivative_chain_reference')) value.derivative_chain_reference = 'tests/deterministic-derivation-chain.md';
  if (proofFamily === 'NONEXECUTABLE_DOCUMENTATION_PROVEN' && !Object.hasOwn(extra, 'nonexecution_proof_reference')) value.nonexecution_proof_reference = 'tests/nonexecution-proof.md';
  return value;
}
function facts(records = []) { return { schema_version: '08A1C-repository-facts-v1', source_manifest_run_id: '08a1c-test', reviewed_at: REVIEWED_AT, validator_version: 'test-fact-discovery-v1', source_report_sanitation: 'STRUCTURALLY_VERIFIED_SECRET_AND_MATCH_REDACTED', inspection_scope: 'Safe unit-test provenance only.', totals: { logical_items_inspected: 1, repository_terminal_facts: records.length, path_classification_totals: records.length ? { PATH_A_REPOSITORY_FACT: records.length, PATH_B_EXTERNAL_AUTHORITY_OR_PROVIDER: 1 - records.length } : { PATH_B_EXTERNAL_AUTHORITY_OR_PROVIDER: 1 }, proof_family_totals: Object.fromEntries([...records.reduce((map, record) => map.set(record.proof_family, (map.get(record.proof_family) ?? 0) + 1), new Map()).entries()] ) }, repository_facts: records }; }
function providerOverride(extra = {}) { return { logical_item_id: LOGICAL_ID, authority_id: 'AUTH-TEST-PROVIDER', accountable_owner: 'Provider test owner', environment_scope: 'Test', verified_provider: 'TestProvider', provider_identity_basis: 'SAFE_PROVIDER_AUDIT_LINKAGE', safe_authority_linkage_basis: 'SAFE_PROVIDER_AUDIT_LINK_TEST_0001', disposition: 'REVOKED', review_state: 'CLOSED', action_timestamp: '2026-08-12T11:10:00Z', independent_verification_timestamp: '2026-08-12T11:20:00Z', sanitized_evidence_reference: 'tests/provider-evidence.md', evidence_level: 'PROVIDER_VERIFIED', evidence_source: 'PROVIDER_AUDIT', ...extra }; }

const source = sourceManifest();
const baselineConfig = config();
const baselineFacts = facts();
const baseline = buildResolution(source, baselineConfig, baselineFacts);
assert.equal(validateResolution(source, baselineConfig, baselineFacts, baseline).non_terminal_primary_total, 1, 'high-entropy/unknown evidence remains non-terminal');
assert.equal(baseline.dispositions[0].review_state, 'OWNER_ASSIGNMENT_REQUIRED');
assert.throws(() => validateResolution(source, baselineConfig, baselineFacts, baseline, { requireClosure: true }), /closure is incomplete/);

const fixtureFacts = facts([fact()]);
const fixtureResolution = buildResolution(source, baselineConfig, fixtureFacts);
assert.equal(validateResolution(source, baselineConfig, fixtureFacts, fixtureResolution, { requireClosure: true }).non_terminal_primary_total, 0, 'Path A fixture needs no authority');
assert.equal(fixtureResolution.dispositions[0].authority_id, null, 'Path A authority requirement is rejected as a policy defect');
assert.equal(fixtureResolution.dispositions[0].verified_provider, 'UNKNOWN');
assert.deepEqual(buildResolution(source, baselineConfig, fixtureFacts), fixtureResolution, 'unchanged rerun is stable');

const maskedFacts = facts([fact({ proofFamily: 'DETERMINISTIC_MASKED_DERIVATIVE', disposition: 'VERIFIED_FALSE_POSITIVE', extra: { reason_code: 'DETERMINISTIC_MASKED_DERIVATIVE' } })]);
const maskedResolution = buildResolution(source, baselineConfig, maskedFacts);
assert.equal(validateResolution(source, baselineConfig, maskedFacts, maskedResolution, { requireClosure: true }).non_terminal_primary_total, 0, 'deterministic masked derivative is accepted on Path A');

const providerShapedWithoutGenerator = facts([fact({ extra: { reason_code: 'PROVIDER_SHAPED_FIXTURE_WITHOUT_GENERATOR_PROOF', generator_proof_reference: null } })]);
assert.throws(() => buildResolution(source, baselineConfig, providerShapedWithoutGenerator), /lacks deterministic generator proof/);
const docLabelOnly = facts([fact({ proofFamily: 'NONEXECUTABLE_DOCUMENTATION_PROVEN', disposition: 'VERIFIED_FALSE_POSITIVE', extra: { nonexecution_proof_reference: null } })]);
assert.throws(() => buildResolution(source, baselineConfig, docLabelOnly), /lacks non-execution proof/);
const providerThroughPathA = facts([fact({ disposition: 'REVOKED' })]);
assert.throws(() => buildResolution(source, baselineConfig, providerThroughPathA), /does not use an allowed Path A terminal disposition/);

const noAuthorityProvider = config({ overrides: [providerOverride()] });
assert.throws(() => validateResolution(source, noAuthorityProvider, baselineFacts, buildResolution(source, noAuthorityProvider, baselineFacts)), /lacks active authority or verified provider identity/);
const providerConfig = config({ active: activeAuthority(), overrides: [providerOverride()] });
const providerResolution = buildResolution(source, providerConfig, baselineFacts);
assert.equal(validateResolution(source, providerConfig, baselineFacts, providerResolution, { requireClosure: true }).non_terminal_primary_total, 0);
assert.throws(() => buildResolution(source, config({ active: activeAuthority({ validUntil: '2026-08-12T11:59:59Z' }) } ), baselineFacts), /expired/);

const duplicateProjection = structuredClone(fixtureResolution); duplicateProjection.dispositions.push(structuredClone(fixtureResolution.dispositions[0]));
assert.throws(() => validateResolution(source, baselineConfig, fixtureFacts, duplicateProjection), /duplicate 08A1C disposition logical item ID/);
const twoItemSource = structuredClone(source); twoItemSource.observation_count = 2; twoItemSource.canonical_occurrence_count = 2; twoItemSource.logical_item_count = 2; twoItemSource.canonical_occurrences.push({ canonical_occurrence_id: 'CAN-TEST-0002', canonical_identity: { normalized_location: 'fixtures/safe-provenance-2.json', object_marker: 'CURRENT_TREE', rule_id: 'test-rule', start_line: 1, end_line: 1, safe_scanner_fingerprint: 'fixtures/safe-provenance-2.json:test-rule:1' } }); twoItemSource.logical_items.push({ ...twoItemSource.logical_items[0], logical_item_id: 'LI-TEST-0002', canonical_occurrence_ids: ['CAN-TEST-0002'] });
const broadBatch = config({ active: activeAuthority(), overrides: [{ ...providerOverride(), logical_item_ids: [LOGICAL_ID, 'LI-TEST-0002'] }] });
assert.throws(() => buildResolution(twoItemSource, broadBatch, { ...facts(), source_manifest_run_id: '08a1c-test', totals: { ...facts().totals, logical_items_inspected: 2, path_classification_totals: { PATH_B_EXTERNAL_AUTHORITY_OR_PROVIDER: 2 } } }), /strong batch linkage/);
const duplicateEvidenceConfig = config({ active: activeAuthority(), overrides: [providerOverride(), { ...providerOverride(), logical_item_id: 'LI-TEST-0002' }] });
const twoFacts = { ...facts(), totals: { ...facts().totals, logical_items_inspected: 2, path_classification_totals: { PATH_B_EXTERNAL_AUTHORITY_OR_PROVIDER: 2 } } };
assert.throws(() => validateResolution(twoItemSource, duplicateEvidenceConfig, twoFacts, buildResolution(twoItemSource, duplicateEvidenceConfig, twoFacts)), /reused across unrelated/);

const [oldManifest, currentManifest] = await Promise.all([readFile(new URL('../runtime/secret-scan/20260811T122836Z/canonical-inventory.08a1b.sanitized.json', import.meta.url), 'utf8').then(JSON.parse), readFile(new URL('../runtime/secret-scan/20260811T214249Z/canonical-inventory.08a1b.sanitized.json', import.meta.url), 'utf8').then(JSON.parse)]);
assert.deepEqual({ observations: currentManifest.observation_count - oldManifest.observation_count, canonical: currentManifest.canonical_occurrence_count - oldManifest.canonical_occurrence_count, logical: currentManifest.logical_item_count - oldManifest.logical_item_count }, { observations: 51, canonical: 51, logical: 51 }, '14,798 vs 14,849 bridge must preserve real inventory growth');

console.log('08A1C Path A/Path B acceptance, policy-defect, authority, projection, count-drift, batch, evidence-reuse, and rerun-stability tests passed.');
