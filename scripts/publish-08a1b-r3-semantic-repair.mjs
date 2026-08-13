#!/usr/bin/env node

/** Stage, validate, then atomically publish the targeted R3 semantic repair. */
import { access, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { bridge } from './run-08a1b-r3-semantic-triage.mjs';
import { noCandidateBearingData } from './08a1b-r3-semantic-lib.mjs';
import { validateR2Inventory } from './verify-08a1b-r2-reconstruction.mjs';
import { validateSemanticTriage } from './verify-08a1b-r3-semantic-triage.mjs';
import { validateCurrentR4SemanticStatus } from './verify-08a1c-r4-semantic-status.mjs';
import { validate08A1DSemanticGate } from './verify-08a1d-semantic-gate.mjs';

function arg(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function fail(message) { throw new Error(message); }
function safeRunId(value) { return /^[A-Za-z0-9][A-Za-z0-9_-]{5,120}$/.test(value) ? value : null; }
function nowRunId() { return `r3-semantic-repair-${new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')}`; }
function currentUtc() { return new Date().toISOString(); }
async function json(filename) { return JSON.parse(await readFile(filename, 'utf8')); }
async function writeJson(filename, value) { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
async function copy(source, target) { await mkdir(path.dirname(target), { recursive: true }); await copyFile(source, target); }
function runNode(repositoryRoot, script, args) {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, script), ...args], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) fail(`Staged semantic publication step failed: ${path.basename(script)}.`);
}

/** Promote prevalidated staged files with recoverable rollback on failure. */
export async function publishStagedFiles(pairs, { renameFile = rename } = {}) {
  const backups = [];
  const promoted = [];
  try {
    for (const [index, pair] of pairs.entries()) {
      await mkdir(path.dirname(pair.target), { recursive: true });
      const backup = path.join(pair.stageRoot, 'rollback', `${String(index).padStart(3, '0')}-${path.basename(pair.target)}`);
      try {
        await mkdir(path.dirname(backup), { recursive: true });
        await renameFile(pair.target, backup);
        backups.push({ target: pair.target, backup });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await renameFile(pair.source, pair.target);
      promoted.push(pair);
    }
  } catch (error) {
    for (const pair of [...promoted].reverse()) {
      try { await renameFile(pair.target, pair.source); } catch { /* preserve original error */ }
    }
    for (const { target, backup } of [...backups].reverse()) {
      try { await renameFile(backup, target); } catch { /* best-effort recovery */ }
    }
    throw error;
  }
}

function exactCurrentMembership(prior, rebuilt) {
  const result = bridge(prior, rebuilt);
  if (result.status !== 'REPRODUCED_EXACT_R2_MEMBERSHIP' || result.canonical_ids_exact !== true || result.equivalence_class_ids_exact !== true || result.equivalence_memberships_exact !== true) fail('Staged R2 replay changed the validated current R2 membership.');
  return result;
}

async function main() {
  const repositoryRoot = path.resolve(arg('--repository-root') ?? '.');
  const runId = safeRunId(arg('--run-id') ?? nowRunId());
  const reviewedAt = arg('--reviewed-at') ?? currentUtc();
  if (!runId || Number.isNaN(Date.parse(reviewedAt))) fail('Semantic repair requires a safe run ID and UTC review timestamp.');
  const current = (relative) => path.join(repositoryRoot, relative);
  const stageRoot = path.join(repositoryRoot, 'runtime/secret-scan', `${runId}-stage`);
  const stage = (relative) => path.join(stageRoot, relative);
  const currentInventoryPath = current('docs/production-readiness/evidence/08a1b-r2-logical-credential-inventory.sanitized.json');
  const currentInventory = await json(currentInventoryPath);
  const archiveRelative = `docs/production-readiness/evidence/08a1b-r3-audit/${runId}`;
  await mkdir(stageRoot, { recursive: true });

  const atomicOutputs = [
    'docs/production-readiness/evidence/08a1b-r2-logical-credential-inventory.sanitized.json',
    'docs/production-readiness/evidence/08a1b-r2-candidate-provenance.sanitized.json',
    'docs/production-readiness/evidence/08a1b-r2-equivalence-classes.sanitized.json',
    'docs/production-readiness/evidence/08a1b-r2-count-and-provenance-bridge.md',
    'docs/production-readiness/evidence/08a-finding-reconciliation.md',
    'docs/production-readiness/evidence/08a-owner-action-inventory.md',
    'docs/production-readiness/evidence/08a1b-r3-semantic-classification.sanitized.json',
    'docs/production-readiness/evidence/08a1b-r3-semantic-policy.md',
    'docs/production-readiness/evidence/08a1b-r3-rule-precision-summary.md',
    'docs/production-readiness/evidence/08a1b-r3-semantic-classification.md',
  ];
  const [inventoryRelative, provenanceRelative, equivalenceRelative, countBridgeRelative, reconciliationRelative, actionInventoryRelative, classificationRelative, policyRelative, precisionRelative, summaryRelative] = atomicOutputs;
  const archiveStage = stage(archiveRelative);
  runNode(repositoryRoot, 'scripts/reconcile-08a1b-r2-r3-atomic.mjs', [
    '--repository-root', repositoryRoot, '--run-id', runId, '--reviewed-at', reviewedAt, '--frozen-inventory', currentInventoryPath,
    '--archive-directory', archiveStage,
    '--archive-current', current(classificationRelative),
    '--archive-current', current('docs/production-readiness/evidence/08a1c-external-r4/current-semantic-triage-status.sanitized.json'),
    '--archive-current', current('docs/production-readiness/evidence/08a-owner-authority-records.sanitized.json'),
    '--archive-current', current('docs/production-readiness/evidence/08a-owner-dispositions.sanitized.json'),
    '--output-inventory', stage(inventoryRelative), '--output-provenance', stage(provenanceRelative), '--output-equivalence', stage(equivalenceRelative),
    '--output-count-bridge', stage(countBridgeRelative), '--output-reconciliation', stage(reconciliationRelative), '--output-action-inventory', stage(actionInventoryRelative),
    '--output-classification', stage(classificationRelative), '--output-policy', stage(policyRelative), '--output-precision', stage(precisionRelative), '--output-summary', stage(summaryRelative),
  ]);

  const stagedInventoryText = await readFile(stage(inventoryRelative), 'utf8');
  const stagedClassificationText = await readFile(stage(classificationRelative), 'utf8');
  const stagedInventory = JSON.parse(stagedInventoryText);
  const stagedClassification = JSON.parse(stagedClassificationText);
  const membership = exactCurrentMembership(currentInventory, stagedInventory);
  validateR2Inventory(stagedInventory, { requirePass: true });
  validateSemanticTriage({ inventory: stagedInventory, classification: stagedClassification });

  const seedFiles = [
    'docs/production-readiness/evidence/08a1c-external-r4/external-action-manifest.sanitized.json',
    'docs/production-readiness/evidence/08a1c-external-r4/evidence-intake.sanitized.json',
    'docs/production-readiness/evidence/08a-owner-authority-records.sanitized.json',
    'docs/production-readiness/evidence/08a1c-r4-dispositions.sanitized.json',
  ];
  await Promise.all(seedFiles.map((relative) => copy(current(relative), stage(relative))));
  const statusRelative = 'docs/production-readiness/evidence/08a1c-external-r4/current-semantic-triage-status.sanitized.json';
  const projectionRelative = 'docs/production-readiness/evidence/08a-owner-authority-records.current-semantic.sanitized.json';
  const currentDispositionsRelative = 'docs/production-readiness/evidence/08a-owner-dispositions.current-semantic.sanitized.json';
  const supersessionMarkdownRelative = 'docs/production-readiness/evidence/08a1b-r3-r4-queue-supersession.md';
  runNode(repositoryRoot, 'scripts/build-08a1c-r4-semantic-supersession.mjs', [
    '--classification', stage(classificationRelative),
    '--r4-manifest', current('docs/production-readiness/evidence/08a1c-external-r4/external-action-manifest.r4-audit.sanitized.json'),
    '--r4-resolution', current('docs/production-readiness/evidence/08a1c-r4-dispositions.r4-audit.sanitized.json'),
    '--output-status', stage(statusRelative), '--output-projection', stage(projectionRelative), '--output-dispositions', stage(currentDispositionsRelative), '--output-markdown', stage(supersessionMarkdownRelative),
  ]);
  runNode(repositoryRoot, 'scripts/materialize-08a1c-r4-semantic-status.mjs', [
    '--semantic-status', stage(statusRelative), '--current-projection', stage(projectionRelative), '--current-dispositions', stage(currentDispositionsRelative),
    '--manifest', stage('docs/production-readiness/evidence/08a1c-external-r4/external-action-manifest.sanitized.json'),
    '--intake', stage('docs/production-readiness/evidence/08a1c-external-r4/evidence-intake.sanitized.json'),
    '--authority-projection', stage('docs/production-readiness/evidence/08a-owner-authority-records.sanitized.json'),
    '--r4-dispositions', stage('docs/production-readiness/evidence/08a1c-r4-dispositions.sanitized.json'),
  ]);
  const gateRelative = 'docs/production-readiness/evidence/08a1d-r3-semantic-gate.sanitized.json';
  runNode(repositoryRoot, 'scripts/build-08a1d-r3-semantic-gate.mjs', ['--classification', stage(classificationRelative), '--output', stage(gateRelative)]);
  const [status, manifest, authority, gate] = await Promise.all([
    json(stage(statusRelative)), json(stage('docs/production-readiness/evidence/08a1c-external-r4/external-action-manifest.sanitized.json')),
    json(stage('docs/production-readiness/evidence/08a-owner-authority-records.sanitized.json')), json(stage(gateRelative)),
  ]);
  validateSemanticTriage({ inventory: stagedInventory, classification: stagedClassification, supersession: status, currentManifest: manifest, currentAuthority: authority, artifactGate: gate });
  validateCurrentR4SemanticStatus({ classificationText: stagedClassificationText, classification: stagedClassification, status, manifest, authority });
  validate08A1DSemanticGate({ classification: stagedClassification, gate });

  const publicationRelative = 'docs/production-readiness/evidence/08a1b-r3-semantic-repair-last-publication.sanitized.json';
  const publication = {
    schema_version: '08A1B-R3-semantic-repair-publication-v1', run_id: runId, reviewed_at: reviewedAt,
    publication_status: 'VALIDATED_STAGED_REPLACEMENT', source_replay: stagedClassification.source_replay,
    exact_prior_r2_membership: membership, totals: stagedClassification.totals,
    downstream: { r4_semantic_status: status.semantic_gate_status, active_provider_or_authority_actions: status.totals.active_08a1c_actions, full_08a1d_status: gate.status },
    policy: { provider_calls_performed: false, authority_actions_performed: false, candidate_bytes_persisted: false, staged_before_publish: true },
  };
  if (!noCandidateBearingData(publication)) fail('Staged semantic publication would persist candidate-bearing data.');
  await writeJson(stage(publicationRelative), publication);
  const promoteRelative = [
    ...atomicOutputs, statusRelative, projectionRelative, currentDispositionsRelative, supersessionMarkdownRelative,
    'docs/production-readiness/evidence/08a1c-external-r4/external-action-manifest.sanitized.json',
    'docs/production-readiness/evidence/08a1c-external-r4/evidence-intake.sanitized.json',
    'docs/production-readiness/evidence/08a1c-external-r4/README.md',
    'docs/production-readiness/evidence/08a-owner-authority-records.sanitized.json',
    'docs/production-readiness/evidence/08a1c-r4-dispositions.sanitized.json', gateRelative, publicationRelative,
  ];
  const pairs = [
    ...promoteRelative.map((relative) => ({ source: stage(relative), target: current(relative), stageRoot })),
    { source: archiveStage, target: current(archiveRelative), stageRoot },
  ];
  await publishStagedFiles(pairs);
  process.stdout.write(`Published semantic repair: ${stagedClassification.totals.deterministic_non_secret} deterministic, ${stagedClassification.totals.positive_secret_candidate} positive, ${stagedClassification.totals.semantically_unresolved} unresolved; ${stagedClassification.semantic_gate.status}.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`Semantic repair publication failed: ${error.message}\n`); process.exitCode = 1; });
