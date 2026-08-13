#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publishStagedFiles } from './publish-08a1b-r3-semantic-repair.mjs';
import { validateCurrentR4SemanticStatus } from './verify-08a1c-r4-semantic-status.mjs';
import { validate08A1DSemanticGate } from './verify-08a1d-semantic-gate.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'plutonix-semantic-publish-'));
try {
  const currentA = path.join(root, 'current-a.json'); const currentB = path.join(root, 'current-b.json');
  const stageA = path.join(root, 'stage-a.json'); const stageB = path.join(root, 'stage-b.json');
  await Promise.all([writeFile(currentA, 'old-a'), writeFile(currentB, 'old-b'), writeFile(stageA, 'new-a'), writeFile(stageB, 'new-b')]);
  const injectedFailure = async (source, target) => {
    if (source === stageB && target === currentB) throw new Error('synthetic promotion failure');
    return rename(source, target);
  };
  await assert.rejects(() => publishStagedFiles([
    { source: stageA, target: currentA, stageRoot: root },
    { source: stageB, target: currentB, stageRoot: root },
  ], { renameFile: injectedFailure }), /synthetic promotion failure/);
  assert.equal(await readFile(currentA, 'utf8'), 'old-a', 'rollback restores an already-promoted current artifact.');
  assert.equal(await readFile(currentB, 'utf8'), 'old-b', 'rollback restores the artifact whose replacement failed.');

  const classification = { schema_version: '08A1B-R3-semantic-classification-v1', reviewed_at: '2026-08-13T00:00:00Z', totals: { semantically_unresolved: 1, positive_secret_candidate: 0 }, semantic_gate: { status: 'BLOCKED' } };
  const classificationText = `${JSON.stringify(classification)}\n`;
  const status = {
    schema_version: '08A1C-R4-semantic-triage-supersession-v1', reviewed_at: classification.reviewed_at,
    source_semantic_classification: { content_checksum_sha256: createHash('sha256').update(classificationText).digest('hex') },
    semantic_gate_status: 'BLOCKED', current_package_status: 'NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE', corrected_08a1c_status: 'NOT_ELIGIBLE_SEMANTIC_TRIAGE_BLOCKED', full_08a1d_status: 'NOT_RUN_SEMANTIC_GATE_BLOCKED', active_positive_candidate_actions: [],
    totals: { semantically_unresolved_classes: 1, positive_secret_candidates: 0, active_08a1c_actions: 0, current_pending_authority_records: 0, current_pending_provider_records: 0 },
  };
  const manifest = { schema_version: '08A1C-current-semantic-external-action-package-v1', package_status: 'NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE', pending_actions: [], totals: { active_actions: 0, pending_authority: 0, pending_provider: 0 } };
  const authority = { schema_version: '08A1C-current-authority-provider-projection-v1', status: 'NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE', active_authority_records: [], active_provider_evidence_records: [], active_actions: [], totals: { active_actions: 0 } };
  assert.deepEqual(validateCurrentR4SemanticStatus({ classificationText, classification, status, manifest, authority }), { status: 'BLOCKED', unresolved: 1, positive: 0, activeActions: 0 });
  const gate = { schema_version: '08A1D-R3-semantic-gate-v1', status: 'NOT_RUN_SEMANTIC_GATE_BLOCKED', prerequisite: { semantically_unresolved_classes: 1 }, policy: { full_08a1d_rerun_performed: false } };
  assert.deepEqual(validate08A1DSemanticGate({ classification, gate }), { expected: 'NOT_RUN_SEMANTIC_GATE_BLOCKED', unresolved: 1 });
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log('Staged semantic publication rollback, blocked R4/08A1D status, and empty-queue tests passed.');
