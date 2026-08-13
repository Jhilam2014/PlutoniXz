#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';
import { buildR2Inventory } from './reconstruct-08a1b-r2.mjs';
import { atomicBridge, buildSemanticClassification, fixtureContract, semanticRecord } from './run-08a1b-r3-semantic-triage.mjs';
import { noCandidateBearingData } from './08a1b-r3-semantic-lib.mjs';
import { validateR2Inventory } from './verify-08a1b-r2-reconstruction.mjs';
import { validateSemanticTriage } from './verify-08a1b-r3-semantic-triage.mjs';

const root = process.cwd();
const candidate = `AIza${'x'.repeat(35)}`;
const safe = { File: '/worktree/apps/backend/test/operationalSecurity.test.js', Fingerprint: 'atomic-fixture', RuleID: 'generic-api-key', Commit: '', StartLine: 27, EndLine: 27, Secret: 'REDACTED', Match: 'REDACTED' };
const raw = { ...safe, Secret: candidate, Match: candidate };
const sourceSets = [{ sourceReport: path.join(root, 'runtime/secret-scan/atomic-test/worktree.gitleaks.json'), rows: [safe] }];
const captured = [];
const inventory = buildR2Inventory({
  sourceSets, rawRowsByScope: new Map([['worktree', [raw]]]), runId: 'atomic-test', pathAFixtureSourceValidated: fixtureContract(root),
  provenance: { reviewed_at: '2026-08-13T00:00:00Z', input_snapshot: { frozen_before_output_generation: true, atomic_r2_r3_lineage: true } },
  onMemoryReconstructed: ({ canonical_occurrences, candidate_equivalence_classes, provenance_records, candidate_by_canonical_id }) => {
    const canonicalById = new Map(canonical_occurrences.map((item) => [item.canonical_occurrence_id, item]));
    const provenanceByCanonical = new Map(provenance_records.map((item) => [item.canonical_occurrence_id, item]));
    for (const group of candidate_equivalence_classes) captured.push(semanticRecord({ group, members: group.canonical_occurrence_ids.map((id) => canonicalById.get(id)), provenanceByCanonical, candidate: candidate_by_canonical_id.get(group.canonical_occurrence_ids[0]), repositoryRoot: root, fixtureContract: fixtureContract(root) }));
  },
});
const inventoryText = `${JSON.stringify(inventory, null, 2)}\n`;
const classification = buildSemanticClassification({ inventory, inventoryText, reviewedAt: '2026-08-13T00:00:00Z', classes: captured, sourceReplay: 'COMPLETED_ATOMIC_MEMORY_ONLY', reproduction: atomicBridge(inventory), replayMode: 'FROZEN_STRUCTURALLY_REDACTED_REPORTS_PLUS_ATOMIC_MEMORY_ONLY_R2_R3' });
assert.equal(classification.source_replay.r2_bridge.status, 'ATOMIC_EXACT_R2_MEMBERSHIP');
assert.deepEqual(classification.classes[0].canonical_occurrence_ids, inventory.candidate_equivalence_classes[0].canonical_occurrence_ids, 'R3 inherits exact atomic R2 membership.');
assert.equal(classification.semantic_gate.status, 'PASS');
assert.equal(noCandidateBearingData({ inventory, classification }), true);
assert.equal(JSON.stringify({ inventory, classification }).includes(candidate), false, 'atomic output never serializes raw candidates.');
validateR2Inventory(inventory, { requirePass: true });
validateSemanticTriage({ inventory, classification });
console.log('Atomic R2-to-R3 lineage, exact membership, non-disclosure, and validator tests passed.');
