#!/usr/bin/env node

/** Validate the current R4 projection against one validated current R3 result. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { noCandidateBearingData } from './08a1b-r3-semantic-lib.mjs';

function arg(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function required(name) { const value = arg(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }
function fail(message) { throw new Error(message); }
function sha(value) { return createHash('sha256').update(value).digest('hex'); }

export function validateCurrentR4SemanticStatus({ classificationText, classification, status, manifest, authority }) {
  if (classification?.schema_version !== '08A1B-R3-semantic-classification-v1' || status?.schema_version !== '08A1C-R4-semantic-triage-supersession-v1') fail('Current R4 semantic status requires an R3 classification and R4 supersession record.');
  if (!noCandidateBearingData({ classification, status, manifest, authority })) fail('Current R4 semantic status contains candidate-bearing data.');
  const unresolved = Number(classification?.totals?.semantically_unresolved ?? -1);
  const positive = Number(classification?.totals?.positive_secret_candidate ?? -1);
  const expectedGate = unresolved === 0 && classification?.semantic_gate?.status === 'PASS' ? 'PASS' : 'BLOCKED';
  if (status.reviewed_at !== classification.reviewed_at || status?.source_semantic_classification?.content_checksum_sha256 !== sha(classificationText) || status?.semantic_gate_status !== expectedGate || status?.totals?.semantically_unresolved_classes !== unresolved || status?.totals?.positive_secret_candidates !== positive) fail('Current R4 semantic status is not derived from the exact validated R3 result.');
  if (!Array.isArray(status.active_positive_candidate_actions) || status.totals.active_08a1c_actions !== status.active_positive_candidate_actions.length || status.totals.current_pending_authority_records !== status.active_positive_candidate_actions.length || status.totals.current_pending_provider_records !== status.active_positive_candidate_actions.length) fail('Current R4 queue totals do not reconcile.');
  if (expectedGate === 'BLOCKED') {
    if (status.current_package_status !== 'NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE' || status.active_positive_candidate_actions.length !== 0 || status.corrected_08a1c_status !== 'NOT_ELIGIBLE_SEMANTIC_TRIAGE_BLOCKED' || status.full_08a1d_status !== 'NOT_RUN_SEMANTIC_GATE_BLOCKED') fail('Blocked R3 triage must leave every current R4 queue empty.');
    if (manifest?.schema_version !== '08A1C-current-semantic-external-action-package-v1' || manifest?.package_status !== 'NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE' || manifest?.pending_actions?.length !== 0 || manifest?.totals?.active_actions !== 0 || manifest?.totals?.pending_authority !== 0 || manifest?.totals?.pending_provider !== 0) fail('Blocked R3 triage produced an invalid current external-action package.');
    if (authority?.schema_version !== '08A1C-current-authority-provider-projection-v1' || authority?.status !== 'NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE' || authority?.active_authority_records?.length !== 0 || authority?.active_provider_evidence_records?.length !== 0 || authority?.active_actions?.length !== 0 || authority?.totals?.active_actions !== 0) fail('Blocked R3 triage produced an invalid current authority/provider projection.');
  }
  return { status: expectedGate, unresolved, positive, activeActions: status.active_positive_candidate_actions.length };
}

async function main() {
  const [classificationText, status, manifest, authority] = await Promise.all([
    readFile(required('--classification'), 'utf8'),
    readFile(required('--status'), 'utf8').then(JSON.parse),
    readFile(required('--manifest'), 'utf8').then(JSON.parse),
    readFile(required('--authority'), 'utf8').then(JSON.parse),
  ]);
  const result = validateCurrentR4SemanticStatus({ classificationText, classification: JSON.parse(classificationText), status, manifest, authority });
  process.stdout.write(`Validated current 08A1C-R4 semantic status: ${result.status}, ${result.unresolved} unresolved classes, ${result.activeActions} active actions.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`Current 08A1C-R4 semantic status validation failed: ${error.message}\n`); process.exitCode = 1; });
