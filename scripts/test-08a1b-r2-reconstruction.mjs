#!/usr/bin/env node

import assert from 'node:assert/strict';
import { assertRawReplayCompleteness, buildR2Inventory, deriveReplayTargets, MEMORY_SCAN_TIMEOUT_MS, partitionCandidateBuffers, remainingScopeTimeout } from './reconstruct-08a1b-r2.mjs';
import { validateR2Inventory } from './verify-08a1b-r2-reconstruction.mjs';

const REVIEWED_AT = '2026-08-13T00:00:00Z';
function sanitizedRow(file, fingerprint, { scope = 'worktree', commit = '', rule = 'generic-api-key', line = 1 } = {}) { return { Secret: 'REDACTED', Match: 'REDACTED', File: file, Fingerprint: fingerprint, RuleID: rule, Commit: commit, StartLine: line, EndLine: line, _scope: scope }; }
function rawRow(safe, candidate) { return { File: safe.File, Fingerprint: safe.Fingerprint, RuleID: safe.RuleID, Commit: safe.Commit, StartLine: safe.StartLine, EndLine: safe.EndLine, Secret: candidate, Match: candidate }; }
function sourceSets(rows) {
  const grouped = new Map();
  for (const row of rows) { const entries = grouped.get(row._scope) ?? []; const { _scope, ...safe } = row; entries.push(safe); grouped.set(row._scope, entries); }
  return [...grouped.entries()].map(([scope, entries]) => ({ sourceReport: `runtime/secret-scan/r2-test/${scope}.gitleaks.json`, rows: entries }));
}
function rawRows(rows, omitScopes = new Set()) {
  const grouped = new Map();
  for (const row of rows) { if (omitScopes.has(row._scope)) continue; const entries = grouped.get(row._scope) ?? []; entries.push(rawRow(row, row._candidate)); grouped.set(row._scope, entries); }
  return grouped;
}
function inventory(rows, options = {}) {
  const safeRows = rows.map(({ _candidate, ...row }) => row);
  return buildR2Inventory({ sourceSets: sourceSets(safeRows), rawRowsByScope: rawRows(rows, options.omitScopes), runId: 'r2-test', provenance: { reviewed_at: REVIEWED_AT, input_snapshot: { frozen_before_output_generation: true }, scanner_config_sha256: 'safe-fixture-config' }, allowUnreconstructed: Boolean(options.allowUnreconstructed), pathAFixtureSourceValidated: Boolean(options.pathAFixtureSourceValidated) });
}

const copies = Array.from({ length: 10_000 }, (_, index) => ({ ...sanitizedRow(`/artifact/self-improvement/copy-${index}.json`, `copy-${index}`, { scope: 'runtime' }), _candidate: 'synthetic-equality-fixture-value' }));
const repeated = inventory(copies);
assert.equal(repeated.totals.candidate_equivalence_classes, 1, '10,000 equal synthetic candidates collapse into one class');
assert.equal(repeated.logical_items.length, 1);
assert.equal(repeated.candidate_equivalence_classes[0].member_count, 10_000);

const crossScopeRows = [
  { ...sanitizedRow('/worktree/current.txt', 'current', { scope: 'worktree' }), _candidate: 'same-candidate' },
  { ...sanitizedRow('/repo/history.txt', 'history', { scope: 'reachable-git-history', commit: 'commit-one' }), _candidate: 'same-candidate' },
  { ...sanitizedRow('/artifact/runtime.txt', 'runtime', { scope: 'runtime' }), _candidate: 'same-candidate' },
  { ...sanitizedRow('/artifact/memory.txt', 'memory', { scope: 'memory' }), _candidate: 'same-candidate' },
  { ...sanitizedRow('/artifact/observability.txt', 'observability', { scope: 'observability' }), _candidate: 'same-candidate' },
];
const crossScope = inventory(crossScopeRows);
assert.equal(crossScope.totals.candidate_equivalence_classes, 1, 'same candidate across scopes remains one logical candidate');
assert.deepEqual(crossScope.logical_items[0].reachability, ['CURRENT_TREE', 'MEMORY_ARTIFACT', 'OBSERVABILITY_ARTIFACT', 'REACHABLE_HISTORY', 'RUNTIME_ARTIFACT']);

const unequalAcrossTime = inventory([
  { ...sanitizedRow('/repo/a.txt', 'history-a', { scope: 'reachable-git-history', commit: 'commit-a' }), _candidate: 'candidate-a' },
  { ...sanitizedRow('/repo/a.txt', 'history-b', { scope: 'reachable-git-history', commit: 'commit-b' }), _candidate: 'candidate-b' },
]);
assert.equal(unequalAcrossTime.totals.candidate_equivalence_classes, 2, 'unequal candidates at one location across time remain separate');

const overlapRows = [
  { ...sanitizedRow('/worktree/runtime/repeated.json', 'overlap', { scope: 'worktree' }), _candidate: 'overlap-candidate' },
  { ...sanitizedRow('/artifact/repeated.json', 'overlap', { scope: 'runtime' }), _candidate: 'overlap-candidate' },
];
const overlap = inventory(overlapRows);
assert.equal(overlap.totals.scan_observations, 2); assert.equal(overlap.totals.canonical_occurrences, 1); assert.equal(overlap.totals.candidate_equivalence_classes, 1, 'overlap preserves observations while collapsing canonical source occurrence');

const sameLocationDifferentCandidates = inventory([
  { ...sanitizedRow('/worktree/multi.txt', 'location-oriented-fingerprint', { scope: 'worktree', line: 9 }), _candidate: 'first-different-candidate' },
  { ...sanitizedRow('/worktree/multi.txt', 'location-oriented-fingerprint', { scope: 'worktree', line: 9 }), _candidate: 'second-different-candidate' },
]);
assert.equal(sameLocationDifferentCandidates.totals.canonical_occurrences, 2, 'same location-oriented scanner metadata must not merge different in-memory candidate bytes');
assert.equal(sameLocationDifferentCandidates.totals.candidate_equivalence_classes, 2);

const fixture = inventory([{ ...sanitizedRow('/worktree/apps/backend/test/operationalSecurity.test.js', 'fixture', { scope: 'worktree', line: 27 }), _candidate: 'synthetic-fixture-value' }], { pathAFixtureSourceValidated: true });
assert.equal(fixture.logical_items[0].classification, 'VERIFIED_SYNTHETIC_FIXTURE');
const fixtureWithHistoricalCopy = inventory([
  { ...sanitizedRow('/worktree/apps/backend/test/operationalSecurity.test.js', 'fixture-current', { scope: 'worktree', line: 27 }), _candidate: 'synthetic-fixture-value' },
  { ...sanitizedRow('/repo/apps/backend/test/operationalSecurity.test.js', 'fixture-history', { scope: 'reachable-git-history', commit: 'fixture-history-commit', line: 27 }), _candidate: 'synthetic-fixture-value' },
], { pathAFixtureSourceValidated: true });
assert.equal(fixtureWithHistoricalCopy.logical_items[0].classification, 'VERIFIED_SYNTHETIC_FIXTURE', 'exact historical copies inherit only the deterministic fixture proof, never provider evidence.');
assert.equal(fixtureWithHistoricalCopy.provenance_records.filter((item) => item.candidate_bytes_preserved === 'EXACT_EQUALITY_CONFIRMED_TO_DETERMINISTIC_FIXTURE').length, 1);
const unvalidatedFixture = inventory([{ ...sanitizedRow('/worktree/apps/backend/test/operationalSecurity.test.js', 'fixture-unvalidated', { scope: 'worktree', line: 27 }), _candidate: 'synthetic-fixture-value' }]);
assert.equal(unvalidatedFixture.logical_items[0].classification, 'PLAUSIBLE_CREDENTIAL', 'Path A must require the committed source and regression assertion check.');
const unknownGenerated = inventory([{ ...sanitizedRow('/artifact/self-improvement/unknown.json', 'unknown', { scope: 'runtime' }), _candidate: 'unknown-generated-value' }]);
assert.equal(unknownGenerated.logical_items[0].classification, 'PLAUSIBLE_CREDENTIAL', 'generated output does not auto-close');

const unreconstructed = inventory([{ ...sanitizedRow('/worktree/unavailable.txt', 'unavailable', { scope: 'worktree' }), _candidate: 'unavailable-value' }], { omitScopes: new Set(['worktree']), allowUnreconstructed: true });
assert.equal(unreconstructed.totals.unreconstructed_candidates, 1);
assert.throws(() => validateR2Inventory(unreconstructed, { requirePass: true }), /unreconstructed candidates/);

const rerunRows = [{ ...sanitizedRow('/worktree/stable.txt', 'stable', { scope: 'worktree' }), _candidate: 'stable-candidate' }];
const first = inventory(rerunRows); const second = inventory(rerunRows);
assert.deepEqual(first, second, 'new ephemeral HMAC keys retain stable class memberships and IDs');
assert.equal(JSON.stringify(first).includes('stable-candidate'), false, 'output omits raw candidate material');
assert.equal(JSON.stringify(first).includes('equality_tag'), false, 'output omits equality tags');
assert.throws(() => partitionCandidateBuffers([{ canonical_occurrence_id: 'CAN-1', candidate: Buffer.from('one') }, { canonical_occurrence_id: 'CAN-2', candidate: Buffer.alloc(0) }]), /nonempty/, 'ambiguous equality input fails closed');
assert.throws(() => inventory([{ ...sanitizedRow('/artifact/secret-scan/report.json', 'recursive', { scope: 'runtime' }), _candidate: 'report-value' }]), /scanner-output recursion/);

const replaySafe = sanitizedRow('/repo/archive.zip!nested/config.json', 'targeted', { scope: 'reachable-git-history', commit: 'a'.repeat(40), line: 7 });
const replaySet = { sourceReport: 'runtime/secret-scan/r2-test/reachable-git-history.gitleaks.json', rows: [replaySafe] };
assert.deepEqual(deriveReplayTargets(replaySet, { commitBoundary: 'a'.repeat(40) }), { scope: 'reachable-git-history', targets: ['archive.zip'], commit_boundary: 'a'.repeat(40) }, 'replay targets use the outer archive and frozen commit boundary');
assert.throws(() => deriveReplayTargets(replaySet, { commitBoundary: 'b'.repeat(40) }), /frozen commit boundary/);
assert.equal(remainingScopeTimeout(100, 100 + MEMORY_SCAN_TIMEOUT_MS - 1), 1, 'all replay targets share one aggregate scope deadline');
assert.throws(() => remainingScopeTimeout(100, 100 + MEMORY_SCAN_TIMEOUT_MS), /aggregate scope timeout/);
const replayRaw = rawRow(replaySafe, 'targeted-value');
assert.doesNotThrow(() => assertRawReplayCompleteness(replaySet, [replayRaw]));
assert.throws(() => assertRawReplayCompleteness(replaySet, []), /omitted/);

let capturedCandidate = null;
const zeroingRow = { ...sanitizedRow('/worktree/zeroing.txt', 'zeroing', { scope: 'worktree' }), _candidate: 'zeroing-candidate' };
const { _candidate: ignoredCandidate, ...zeroingSafe } = zeroingRow;
buildR2Inventory({ sourceSets: sourceSets([zeroingSafe]), rawRowsByScope: rawRows([zeroingRow]), runId: 'zeroing-test', provenance: { reviewed_at: REVIEWED_AT, input_snapshot: { frozen_before_output_generation: true } }, onMemoryReconstructed: ({ candidate_by_canonical_id }) => { capturedCandidate = candidate_by_canonical_id.values().next().value; } });
assert.ok(Buffer.isBuffer(capturedCandidate));
assert.ok(capturedCandidate.every((byte) => byte === 0), 'candidate buffers are zeroed after the in-memory reconstruction hook returns');

const valid = validateR2Inventory(crossScope, { requirePass: true });
assert.equal(valid.status, 'PASS');
const propagated = structuredClone(crossScope); propagated.totals.scan_observations += 1; propagated.totals.candidate_equivalence_classes += 1;
assert.throws(() => validateR2Inventory(propagated, { priorInventory: { totals: { scan_observations: crossScope.totals.scan_observations, candidate_equivalence_classes: crossScope.totals.candidate_equivalence_classes } } }), /totals do not reconcile|Exact observation-delta propagation/);
console.log('08A1B-R2 repeated-copy, targeted replay, frozen history, aggregate deadline, raw completeness, buffer zeroing, cross-scope, inequality, location-metadata ambiguity, overlap, provenance, fixture, unavailable-source, non-disclosure, collision, recursion, inflation, delta, and ephemeral-rerun tests passed.');
