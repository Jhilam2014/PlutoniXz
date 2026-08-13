#!/usr/bin/env node

/**
 * Turn the former active R4 package into retained audit history and replace
 * its public/current projections with the corrected R3 semantic state.
 */
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { noCandidateBearingData } from './08a1b-r3-semantic-lib.mjs';

function arg(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function required(name) { const value = arg(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }
async function readJson(filename) { return JSON.parse(await readFile(filename, 'utf8')); }
async function writeJson(filename, value) { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
async function preserve(source, audit) {
  try { await access(audit); return; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  try { await rename(source, audit); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

async function main() {
  const statusPath = required('--semantic-status');
  const projectionPath = required('--current-projection');
  const dispositionPath = required('--current-dispositions');
  const manifestPath = required('--manifest');
  const intakePath = required('--intake');
  const authorityPath = required('--authority-projection');
  const r4DispositionPath = required('--r4-dispositions');
  const [status, projection, dispositions, manifest, intake, authority, r4Dispositions] = await Promise.all([
    readJson(statusPath), readJson(projectionPath), readJson(dispositionPath), readJson(manifestPath), readJson(intakePath), readJson(authorityPath), readJson(r4DispositionPath),
  ]);
  if (status?.current_package_status !== 'NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE' || status?.totals?.active_08a1c_actions !== 0 || status?.totals?.current_pending_authority_records !== 0 || status?.totals?.current_pending_provider_records !== 0) throw new Error('R4 materialization requires a blocked semantic status with no current external actions.');
  if (!noCandidateBearingData({ status, projection, dispositions, manifest, intake, authority, r4Dispositions })) throw new Error('R4 materialization rejects candidate-bearing evidence.');
  const auditManifest = path.join(path.dirname(manifestPath), 'external-action-manifest.r4-audit.sanitized.json');
  const auditIntake = path.join(path.dirname(intakePath), 'evidence-intake.r4-audit.sanitized.json');
  const auditAuthority = authorityPath.replace(/\.sanitized\.json$/, '.r4-audit.sanitized.json');
  const auditDispositions = r4DispositionPath.replace(/\.sanitized\.json$/, '.r4-audit.sanitized.json');
  await Promise.all([preserve(manifestPath, auditManifest), preserve(intakePath, auditIntake), preserve(authorityPath, auditAuthority), preserve(r4DispositionPath, auditDispositions)]);
  const historicalRequestIds = status.superseded_r4_action_ids ?? [];
  const currentManifest = {
    schema_version: '08A1C-current-semantic-external-action-package-v1', reviewed_at: status.reviewed_at,
    package_status: 'NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE',
    historical_audit_manifest_reference: '08a1c-external-r4/external-action-manifest.r4-audit.sanitized.json',
    historical_request_count: historicalRequestIds.length,
    active_positive_candidate_actions: [], pending_actions: [],
    totals: { historical_r4_requests: historicalRequestIds.length, superseded_non_actionable_requests: historicalRequestIds.length, active_actions: 0, pending_authority: 0, pending_provider: 0 },
    policy: status.policy,
  };
  const currentIntake = {
    schema_version: '08A1C-current-semantic-evidence-intake-v1', reviewed_at: status.reviewed_at,
    package_status: currentManifest.package_status,
    historical_audit_intake_reference: '08a1c-external-r4/evidence-intake.r4-audit.sanitized.json',
    historical_pending_action_count: historicalRequestIds.length, active_pending_action_ids: [], accepted_records: [], rejected_records: [],
    intake_policy: 'No current provider or authority intake while semantic triage is blocked. Historical R4 requests are audit-only and must not be sent or populated.',
  };
  const currentAuthority = {
    schema_version: '08A1C-current-authority-provider-projection-v1', reviewed_at: status.reviewed_at,
    status: currentManifest.package_status,
    historical_audit_authority_projection_reference: path.basename(auditAuthority),
    active_authority_records: [], active_provider_evidence_records: [], active_actions: [],
    totals: { pending_authority: 0, pending_provider: 0, active_actions: 0, historical_r4_requests: historicalRequestIds.length },
    source_supersession_status: '08a1c-external-r4/current-semantic-triage-status.sanitized.json',
  };
  const currentRegister = {
    ...dispositions,
    current_package_status: currentManifest.package_status,
    historical_audit_disposition_reference: path.basename(auditDispositions),
    audit_only_r4_pending_request_count: historicalRequestIds.length,
  };
  await Promise.all([
    writeJson(manifestPath, currentManifest), writeJson(intakePath, currentIntake), writeJson(authorityPath, currentAuthority), writeJson(r4DispositionPath, currentRegister),
    writeFile(path.join(path.dirname(manifestPath), 'README.md'), `# 08A1C-R4 external package\n\n**Status: NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE.** The prior R4 requests are retained in the \`.r4-audit.sanitized.json\` files and must not be sent, populated, or counted as current actions. The current semantic gate is recorded in \`current-semantic-triage-status.sanitized.json\`.\n`, 'utf8'),
  ]);
  process.stdout.write(`Materialized R4 semantic status: ${historicalRequestIds.length} historical audit requests, 0 active external actions.\n`);
}

main().catch((error) => { process.stderr.write(`R4 semantic-status materialization failed: ${error.message}\n`); process.exitCode = 1; });
