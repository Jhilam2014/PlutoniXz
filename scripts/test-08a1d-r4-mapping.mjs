#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildR4Mapping, validateR4Mapping } from './08a1d-r4-mapping-lib.mjs';

const inventory = {
  schema_version: '08A1B-R2-logical-credential-inventory-v1',
  run_id: 'r2-mapping-test',
  canonical_occurrences: [{ canonical_occurrence_id: 'CAN-1', normalized_location: 'runtime/safe.json', rule_id: 'test-rule', safe_line_metadata: { start_line: 7 } }],
  logical_items: [{ logical_item_id: 'LI-1', candidate_equivalence_class_id: 'CEQ-1', canonical_occurrence_ids: ['CAN-1'], classification: 'PLAUSIBLE_CREDENTIAL' }],
};
const inventoryText = JSON.stringify(inventory);
const sourceInventory = { schema_version: inventory.schema_version, run_id: inventory.run_id, content_checksum_sha256: createHash('sha256').update(inventoryText).digest('hex') };
const resolution = { schema_version: '08A1C-R4-reconstructed-disposition-v1', source_inventory: sourceInventory, dispositions: [{ logical_item_id: 'LI-1', terminal: false }] };
const coverage = { schema_version: '08A1D-artifact-coverage-v1', run_id: 'old-coverage', source_manifest_run_id: 'old-r2', roots: [{ artifact_id: 'ROOT-1', path: 'runtime', artifact_state: 'FINDINGS_MAPPED_PENDING_DISPOSITION', observation_count: 1, sanitized_report_reference: 'tests/runtime.gitleaks.json' }], artifacts: [] };
const rowsByReference = new Map([['tests/runtime.gitleaks.json', [{ Secret: 'REDACTED', Match: 'REDACTED', File: 'safe.json', RuleID: 'test-rule', StartLine: 7 }]]]);

const mapping = buildR4Mapping({ inventory, inventoryText, resolution, coverage, rowsByReference });
assert.equal(mapping.totals.artifact_records, 1);
assert.equal(mapping.totals.mapped_pending_disposition, 1);
assert.equal(mapping.totals.unmapped_observations, 0);
assert.equal(mapping.coverage_status, 'FULL_RERUN_REQUIRED');
assert.doesNotThrow(() => validateR4Mapping({ inventory, inventoryText, resolution, mapping }));

const stale = structuredClone(mapping); stale.mappings[0].r2_logical_item_ids = ['LI-STALE'];
assert.throws(() => validateR4Mapping({ inventory, inventoryText, resolution, mapping: stale }), /predecessor or unknown/);
const falseReconciled = structuredClone(mapping); falseReconciled.mappings[0].mapping_state = 'FINDINGS_RECONCILED';
assert.throws(() => validateR4Mapping({ inventory, inventoryText, resolution, mapping: falseReconciled }), /inconsistent/);
const retained = structuredClone(mapping); retained.coverage_retention_eligible = true;
assert.throws(() => validateR4Mapping({ inventory, inventoryText, resolution, mapping: retained }), /incorrectly retains/);
const unmapped = buildR4Mapping({ inventory, inventoryText, resolution, coverage, rowsByReference: new Map([['tests/runtime.gitleaks.json', [{ Secret: 'REDACTED', Match: 'REDACTED', File: 'different.json', RuleID: 'test-rule', StartLine: 7 }]]]) });
assert.equal(unmapped.mappings[0].mapping_state, 'UNMAPPED_R2_REQUIRES_FULL_RERUN');

process.stdout.write('08A1D-R4 current-lineage, pending/reconciled state, stale-ID, coverage-retention, and unmapped-finding tests passed.\n');
