#!/usr/bin/env node

/**
 * Rebuild 08A1B-R2 and 08A1B-R3 from one bounded, memory-only replay of the
 * frozen structural reports. This removes the second full scanner pass while
 * preserving exact R2 -> R3 membership lineage and non-disclosure controls.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readSanitizedReports } from './reconcile-secret-findings.mjs';
import { actionInventoryMarkdown, buildR2Inventory, inventoryMarkdown, liveRawRowsForReports, reconciliationMarkdown } from './reconstruct-08a1b-r2.mjs';
import { atomicBridge, buildSemanticClassification, classificationMarkdown, clearSemanticSourceBuffers, fixtureContract, policyMarkdown, precisionMarkdown, semanticRecord } from './run-08a1b-r3-semantic-triage.mjs';
import { validateR2Inventory } from './verify-08a1b-r2-reconstruction.mjs';
import { validateSemanticTriage } from './verify-08a1b-r3-semantic-triage.mjs';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function fail(message) { throw new Error(message); }
function arg(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function args(name) { return process.argv.flatMap((value, index) => value === name && process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? [process.argv[index + 1]] : []); }
function required(name) { const value = arg(name); if (!value || value.startsWith('--')) fail(`Missing ${name}`); return value; }
async function write(target, content) { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, 'utf8'); }
async function writeJson(target, value) { await write(target, `${JSON.stringify(value, null, 2)}\n`); }

async function archiveCurrent(sources, directory, runId) {
  const records = [];
  await mkdir(directory, { recursive: true });
  for (const source of sources) {
    try {
      await readFile(source, 'utf8');
      const destination = path.join(directory, `${path.basename(source).replace(/\.sanitized\.json$/, '')}.pre-atomic-${runId}.sanitized.json`);
      await copyFile(source, destination);
      records.push({ source: source.replace(/^.*?(docs\/)/, '$1'), archived: destination.replace(/^.*?(docs\/)/, '$1') });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  await writeJson(path.join(directory, `pre-atomic-${runId}.manifest.sanitized.json`), {
    schema_version: '08A1B-R3-pre-atomic-audit-archive-v1', run_id: runId,
    archive_reason: 'Current R3 and R4 projections retained before validated atomic R2-to-R3 publication.',
    records,
  });
}

async function main() {
  const repositoryRoot = path.resolve(required('--repository-root'));
  if (process.argv.includes('--publish-existing')) {
    const [inventoryText, classificationText] = await Promise.all([readFile(required('--output-inventory'), 'utf8'), readFile(required('--output-classification'), 'utf8')]);
    const inventory = JSON.parse(inventoryText); const classification = JSON.parse(classificationText);
    validateR2Inventory(inventory, { requirePass: true });
    validateSemanticTriage({ inventory, classification });
    await Promise.all([
      write(required('--output-policy'), policyMarkdown()),
      write(required('--output-precision'), precisionMarkdown(classification, inventory)),
      write(required('--output-summary'), classificationMarkdown(classification)),
    ]);
    process.stdout.write(`Published validated atomic 08A1B-R2/R3 derived evidence: ${classification.totals.equivalence_classes} classes, ${classification.totals.semantically_unresolved} unresolved.\n`);
    return;
  }
  const runId = required('--run-id');
  const reviewedAt = required('--reviewed-at'); if (!ISO.test(reviewedAt) || !Number.isFinite(Date.parse(reviewedAt))) fail('Atomic R2/R3 requires an explicit UTC review timestamp.');
  const frozenInventoryPath = arg('--frozen-inventory');
  const frozenInventory = frozenInventoryPath ? JSON.parse(await readFile(frozenInventoryPath, 'utf8')) : null;
  const commitBoundary = arg('--commit-boundary') ?? frozenInventory?.reconstruction?.commit_boundary;
  if (typeof commitBoundary !== 'string' || !/^[0-9a-f]{40}$/i.test(commitBoundary)) fail('Atomic R2/R3 requires a frozen 40-character commit boundary.');
  const reports = args('--source-report').length
    ? args('--source-report')
    : (frozenInventory?.reconstruction?.source_report_paths ?? []).map((relative) => path.join(repositoryRoot, relative));
  if (!reports.length) fail('Atomic R2/R3 requires one or more frozen structural source reports.');
  const sourceSets = await readSanitizedReports(reports);
  const rawRowsByScope = await liveRawRowsForReports(repositoryRoot, sourceSets, { commitBoundary });
  const captured = [];
  const inputSnapshot = {
    scope_ids: sourceSets.map((set) => path.basename(set.sourceReport).replace(/\.gitleaks\.json$/, '')).sort(),
    output_roots_excluded_from_producing_scans: ['runtime/secret-scan'],
    frozen_before_output_generation: true,
    frozen_structural_reports_replayed: true,
    atomic_r2_r3_lineage: true,
    path_a_fixture_source_validated: fixtureContract(repositoryRoot),
  };
  let inventory;
  try {
    inventory = buildR2Inventory({
      sourceSets, rawRowsByScope, runId,
      pathAFixtureSourceValidated: inputSnapshot.path_a_fixture_source_validated,
      provenance: { reviewed_at: reviewedAt, commit_boundary: commitBoundary, scanner_version_or_digest: arg('--scanner-version-or-digest') ?? frozenInventory?.reconstruction?.scanner_version_or_digest, scanner_config_sha256: arg('--scanner-config-sha256') ?? frozenInventory?.reconstruction?.scanner_config_sha256, input_snapshot: inputSnapshot },
      onMemoryReconstructed: ({ canonical_occurrences, candidate_equivalence_classes, provenance_records, candidate_by_canonical_id }) => {
        const canonicalById = new Map(canonical_occurrences.map((item) => [item.canonical_occurrence_id, item]));
        const provenanceByCanonical = new Map(provenance_records.map((item) => [item.canonical_occurrence_id, item]));
        for (const group of candidate_equivalence_classes) {
          const candidate = candidate_by_canonical_id.get(group.canonical_occurrence_ids[0]);
          if (!candidate) fail('Atomic R2/R3 lost an in-memory candidate before semantic classification.');
          captured.push(semanticRecord({ group, members: group.canonical_occurrence_ids.map((id) => canonicalById.get(id)), provenanceByCanonical, candidate, repositoryRoot, fixtureContract: inputSnapshot.path_a_fixture_source_validated }));
        }
      },
    });
  } finally { clearSemanticSourceBuffers(); }
  const inventoryText = `${JSON.stringify(inventory, null, 2)}\n`;
  const classification = buildSemanticClassification({
    inventory, inventoryText, reviewedAt, classes: captured.sort((left, right) => left.equivalence_class_id.localeCompare(right.equivalence_class_id)),
    sourceReplay: 'COMPLETED_ATOMIC_MEMORY_ONLY', reproduction: atomicBridge(inventory),
    replayMode: 'FROZEN_STRUCTURALLY_REDACTED_REPORTS_PLUS_ATOMIC_MEMORY_ONLY_R2_R3',
  });
  validateR2Inventory(inventory, { requirePass: true });
  validateSemanticTriage({ inventory, classification });

  const auditDirectory = required('--archive-directory');
  await archiveCurrent(args('--archive-current'), auditDirectory, runId);
  const candidateProvenance = { schema_version: '08A1B-R2-candidate-provenance-v1', run_id: runId, reviewed_at: reviewedAt, totals: inventory.totals, provenance_records: inventory.provenance_records, canonical_occurrences: inventory.canonical_occurrences, scan_observations: inventory.scan_observations };
  const equivalence = { schema_version: '08A1B-R2-equivalence-classes-v1', run_id: runId, reviewed_at: reviewedAt, equality_contract: inventory.reconstruction.candidate_equality, totals: { candidate_equivalence_classes: inventory.totals.candidate_equivalence_classes, singleton_equivalence_classes: inventory.totals.singleton_equivalence_classes, repeated_equivalence_classes: inventory.totals.repeated_equivalence_classes, largest_equivalence_class_size: inventory.totals.largest_equivalence_class_size }, candidate_equivalence_classes: inventory.candidate_equivalence_classes };
  await Promise.all([
    write(required('--output-inventory'), inventoryText),
    writeJson(required('--output-provenance'), candidateProvenance),
    writeJson(required('--output-equivalence'), equivalence),
    write(required('--output-count-bridge'), inventoryMarkdown(inventory)),
    write(required('--output-reconciliation'), reconciliationMarkdown(inventory)),
    write(required('--output-action-inventory'), actionInventoryMarkdown(inventory)),
    write(required('--output-classification'), `${JSON.stringify(classification, null, 2)}\n`),
    write(required('--output-policy'), policyMarkdown()),
    write(required('--output-precision'), precisionMarkdown(classification, inventory)),
    write(required('--output-summary'), classificationMarkdown(classification)),
  ]);
  process.stdout.write(`Atomic 08A1B-R2/R3: ${inventory.totals.scan_observations} observations, ${inventory.totals.candidate_equivalence_classes} classes, ${classification.totals.semantically_unresolved} unresolved; ${classification.semantic_gate.status}.\n`);
}

main().catch((error) => { process.stderr.write(`Atomic 08A1B-R2/R3 failed: ${error.message}\n`); process.exitCode = 1; });
