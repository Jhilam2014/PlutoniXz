#!/usr/bin/env node

/** Fail-closed 08A1B validator. Source report sanitation is checked first. */
import { readFile } from 'node:fs/promises';
import { buildCanonicalInventory, readSanitizedReports } from './reconcile-secret-findings.mjs';

function argument(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function argumentsFor(name) { return process.argv.flatMap((value, index) => value === name && process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? [process.argv[index + 1]] : []); }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }
function fail(message) { throw new Error(message); }
function noRawFields(value) {
  if (Array.isArray(value)) return value.every(noRawFields);
  if (!value || typeof value !== 'object') return true;
  return Object.entries(value).every(([key, nested]) => !/^(?:secret|match|authorization|token_value|replacement_value)$/i.test(key) && noRawFields(nested));
}
function ids(items, key) { return new Set(items.map((item) => item[key])); }
async function main() {
  const sourceReports = argumentsFor('--source-report'); if (sourceReports.length === 0) fail('Missing --source-report');
  const sourceSets = await readSanitizedReports(sourceReports); // No manifest is opened until source sanitation succeeds.
  const manifest = JSON.parse(await readFile(required('--manifest'), 'utf8'));
  if (manifest?.schema_version !== '08A1B-canonical-inventory-v1') fail('Unsupported reconciliation schema.');
  if (!noRawFields(manifest)) fail('Manifest contains a prohibited secret-bearing field name.');
  const expected = buildCanonicalInventory(sourceSets, manifest.run_id, manifest.provenance);
  for (const key of ['observation_count', 'canonical_occurrence_count', 'logical_item_count', 'unresolved_logical_item_count']) if (manifest[key] !== expected[key]) fail(`Count mismatch for ${key}.`);
  if (JSON.stringify(manifest.category_totals) !== JSON.stringify(expected.category_totals) || JSON.stringify(manifest.scope_totals) !== JSON.stringify(expected.scope_totals)) fail('Sanitized totals do not reconcile.');
  for (const key of ['scan_observations', 'canonical_occurrences', 'logical_items']) if (!Array.isArray(manifest[key])) fail(`Missing ${key}.`);
  const observationIds = ids(manifest.scan_observations, 'observation_id'); const canonicalIds = ids(manifest.canonical_occurrences, 'canonical_occurrence_id'); const logicalIds = ids(manifest.logical_items, 'logical_item_id');
  if (observationIds.size !== manifest.scan_observations.length || canonicalIds.size !== manifest.canonical_occurrences.length || logicalIds.size !== manifest.logical_items.length) fail('Duplicate layer identifier.');
  if (JSON.stringify(manifest.scan_observations) !== JSON.stringify(expected.scan_observations) || JSON.stringify(manifest.canonical_occurrences) !== JSON.stringify(expected.canonical_occurrences) || JSON.stringify(manifest.logical_items) !== JSON.stringify(expected.logical_items)) fail('Forward mappings do not match sanitized source evidence.');
  const observationLinks = new Map(); for (const canonical of manifest.canonical_occurrences) { if (!logicalIds.has(canonical.logical_item_id)) fail('Canonical occurrence has no logical item.'); for (const observationId of canonical.contributing_observation_ids) { if (!observationIds.has(observationId) || observationLinks.has(observationId)) fail('Observation orphaned or multiply mapped.'); observationLinks.set(observationId, canonical.canonical_occurrence_id); } }
  if (observationLinks.size !== observationIds.size) fail('At least one observation is unmapped.');
  for (const observation of manifest.scan_observations) if (observationLinks.get(observation.observation_id) !== observation.canonical_occurrence_id) fail('Observation reverse link is inconsistent.');
  const canonicalLinks = new Map(); for (const logical of manifest.logical_items) { if (logical.grouping_basis !== 'NO_SAFE_CREDENTIAL_EQUALITY_IDENTIFIER_AVAILABLE' || logical.canonical_occurrence_ids.length !== 1) fail('Unsupported logical grouping without safe equality evidence.'); for (const canonicalId of logical.canonical_occurrence_ids) { if (!canonicalIds.has(canonicalId) || canonicalLinks.has(canonicalId)) fail('Canonical occurrence orphaned or multiply mapped.'); canonicalLinks.set(canonicalId, logical.logical_item_id); } }
  if (canonicalLinks.size !== canonicalIds.size) fail('At least one canonical occurrence is unmapped.');
  if (manifest.logical_items.some((item) => item.status !== 'UNRESOLVED' || item.disposition !== 'UNKNOWN')) fail('08A1B cannot infer a terminal disposition.');
  if (process.argv.includes('--require-closure')) fail('08A1B deliberately preserves unresolved logical items for 08A1C.');
  process.stdout.write(`Validated ${manifest.observation_count} observations, ${manifest.canonical_occurrence_count} canonical occurrences, and ${manifest.logical_item_count} logical items.\n`);
}
main().catch((error) => { process.stderr.write(`08A1B reconciliation validation failed: ${error.message}\n`); process.exitCode = 1; });
