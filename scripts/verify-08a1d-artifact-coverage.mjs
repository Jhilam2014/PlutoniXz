#!/usr/bin/env node

/** Validate the sanitized 08A1D artifact coverage interface without reading artifact content. */
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const STATES = new Set(['CLEAN', 'FINDINGS_RECONCILED', 'FINDINGS_MAPPED_PENDING_DISPOSITION', 'UNSCANNED', 'UNSUPPORTED', 'OUT_OF_SCOPE_APPROVED']);
const FORBIDDEN = /^(?:secret|match|authorization|token_value|credential_value|replacement_value|raw_value)$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
function arg(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function required(name) { const value = arg(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }
function safePath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const normalized = path.posix.normalize(value.split(path.sep).join('/'));
  return !path.posix.isAbsolute(normalized) && normalized !== '..' && !normalized.startsWith('../');
}
function noRaw(value) {
  if (Array.isArray(value)) return value.every(noRaw);
  return !value || typeof value !== 'object' || Object.entries(value).every(([key, nested]) => !FORBIDDEN.test(key) && noRaw(nested));
}
function requireEvidence(record) {
  if (!ISO.test(record.started_at ?? '') || !ISO.test(record.completed_at ?? '') || !record.scanner || !record.non_execution_guarantees || !record.cleanup_result) throw new Error(`${record.artifact_id} lacks bounded scan lifecycle evidence.`);
  if (!Array.isArray(record.reachability) || !record.reachability.length) throw new Error(`${record.artifact_id} lacks reachability evidence.`);
  if (!Array.isArray(record.logical_item_ids) || !Number.isInteger(record.unmapped_observation_count) || record.unmapped_observation_count < 0) throw new Error(`${record.artifact_id} lacks canonical mapping evidence.`);
}
async function exists(relative) { try { await access(relative); return true; } catch { return false; } }
async function main() {
  const inventoryPath = required('--inventory');
  const manifestPath = required('--manifest');
  const resolutionPath = arg('--resolution');
  const requireCoverage = process.argv.includes('--require-coverage');
  const [inventory, manifest, resolution] = await Promise.all([
    readFile(inventoryPath, 'utf8').then(JSON.parse),
    readFile(manifestPath, 'utf8').then(JSON.parse),
    resolutionPath ? readFile(resolutionPath, 'utf8').then(JSON.parse) : Promise.resolve(null),
  ]);
  if (inventory?.schema_version !== '08A1D-artifact-coverage-v1' || manifest?.schema_version !== '08A1B-canonical-inventory-v1') throw new Error('Unsupported coverage or canonical inventory schema.');
  if (!noRaw(inventory)) throw new Error('Coverage inventory contains a prohibited raw-value field.');
  if (inventory.source_manifest_run_id !== manifest.run_id) throw new Error('Coverage inventory was mapped against a different 08A1B run.');
  if (!Array.isArray(inventory.roots) || !Array.isArray(inventory.artifacts) || !Array.isArray(inventory.exclusions)) throw new Error('Coverage inventory arrays are missing.');
  const all = [...inventory.roots, ...inventory.artifacts]; const ids = new Set(); const logical = new Set(manifest.logical_items.map((item) => item.logical_item_id));
  let terminalByLogicalId = null;
  if (resolution) {
    if (!['08A1C-owner-resolution-v2', '08A1C-owner-resolution-v3'].includes(resolution?.schema_version) || !Array.isArray(resolution.dispositions) || !noRaw(resolution)) throw new Error('Artifact consistency requires a safe 08A1C Path A/Path B resolution.');
    const resolutionIds = new Set(resolution.dispositions.map((item) => item.logical_item_id));
    if (resolutionIds.size !== resolution.dispositions.length || resolutionIds.size !== logical.size || [...logical].some((item) => !resolutionIds.has(item))) throw new Error('Artifact consistency resolution does not cover each source logical item exactly once.');
    terminalByLogicalId = new Map(resolution.dispositions.map((item) => [item.logical_item_id, item.review_state === 'CLOSED']));
  }
  for (const record of all) {
    if (typeof record.artifact_id !== 'string' || ids.has(record.artifact_id)) throw new Error('Artifact IDs must be stable and unique.');
    ids.add(record.artifact_id);
    if (!safePath(record.path) || String(record.path).startsWith('runtime/secret-scan/')) throw new Error(`${record.artifact_id} has an unsafe or recursive report path.`);
    if (!STATES.has(record.artifact_state)) throw new Error(`${record.artifact_id} has an invalid artifact state.`);
    requireEvidence(record);
    if (record.observation_count !== 0 && !record.sanitized_report_reference) throw new Error(`${record.artifact_id} has observations without a sanitized report reference.`);
    if (record.sanitized_report_reference && !safePath(record.sanitized_report_reference)) throw new Error(`${record.artifact_id} has unsafe report reference.`);
    for (const identifier of record.logical_item_ids) if (!logical.has(identifier)) throw new Error(`${record.artifact_id} maps to unknown logical item ${identifier}.`);
    if (record.observation_count === 0 && record.logical_item_ids.length) throw new Error(`${record.artifact_id} maps logical items without observations.`);
    if (record.artifact_state === 'CLEAN' && (record.exit_result !== 0 || record.observation_count !== 0 || record.unmapped_observation_count !== 0 || !record.sanitized_report_reference)) throw new Error(`${record.artifact_id} claims CLEAN without complete clean evidence.`);
    if (record.artifact_state === 'FINDINGS_MAPPED_PENDING_DISPOSITION' && (!record.observation_count || !record.logical_item_ids.length || record.unmapped_observation_count !== 0)) throw new Error(`${record.artifact_id} lacks a complete pending-disposition mapping.`);
    if (record.artifact_state === 'FINDINGS_RECONCILED' && (!record.observation_count || !record.logical_item_ids.length || record.unmapped_observation_count !== 0)) throw new Error(`${record.artifact_id} lacks a reconciled logical mapping.`);
    if (terminalByLogicalId && record.logical_item_ids.length) {
      const allLinkedTerminal = record.logical_item_ids.every((identifier) => terminalByLogicalId.get(identifier) === true);
      if (record.artifact_state === 'FINDINGS_RECONCILED' && !allLinkedTerminal) throw new Error(`${record.artifact_id} is reconciled while a linked logical item remains non-terminal.`);
      if (record.artifact_state === 'FINDINGS_MAPPED_PENDING_DISPOSITION' && allLinkedTerminal) throw new Error(`${record.artifact_id} remains pending although all linked logical items are terminal.`);
    }
    if (requireCoverage && ['UNSCANNED', 'UNSUPPORTED'].includes(record.artifact_state)) throw new Error(`${record.artifact_id} prevents complete coverage.`);
  }
  for (const exclusion of inventory.exclusions) {
    if (exclusion.artifact_state !== 'OUT_OF_SCOPE_APPROVED' || !exclusion.owner || !exclusion.approval_evidence || !ISO.test(exclusion.expires_at ?? '') || Date.parse(exclusion.expires_at) <= Date.now()) throw new Error('An exclusion lacks current owner approval, evidence, or expiry.');
  }
  if (inventory.totals?.unmapped_findings !== all.reduce((sum, record) => sum + record.unmapped_observation_count, 0)) throw new Error('Unmapped finding total is inconsistent.');
  if (requireCoverage && (inventory.totals.unmapped_findings !== 0 || (inventory.totals.invalid_or_expired_exclusions ?? 0) !== 0)) throw new Error('Coverage contains unmapped findings or invalid exclusions.');
  for (const record of all.filter((item) => item.sanitized_report_reference)) if (!(await exists(record.sanitized_report_reference))) throw new Error(`Missing sanitized report: ${record.sanitized_report_reference}`);
  process.stdout.write(`Validated ${inventory.roots.length} roots and ${inventory.artifacts.length} special artifacts against ${manifest.logical_items.length} logical items${resolution ? ' with 08A1C disposition consistency' : ''}.\n`);
}
main().catch((error) => { process.stderr.write(`08A1D artifact coverage validation failed: ${error.message}\n`); process.exitCode = 1; });
