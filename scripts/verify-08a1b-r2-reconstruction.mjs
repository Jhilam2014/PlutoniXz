#!/usr/bin/env node

/** Fail-closed structural validator for the safe 08A1B-R2 reconstruction. */
import { readFile } from 'node:fs/promises';
import { R2_SCHEMA } from './reconstruct-08a1b-r2.mjs';

const FORBIDDEN = /^(?:secret|match|authorization|token_value|credential_value|replacement_value|raw_value|equality_tag|candidate_tag)$/i;
const SHAPE = /(?:apify_api|sk-(?:proj-)?|AIza|AKIA|xox[abprs])[_-]?[A-Za-z0-9]{12,}|(?:api[_-]?key|token)\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i;
const PATH_A = new Set(['VERIFIED_SYNTHETIC_FIXTURE', 'VERIFIED_PLACEHOLDER_OR_EXAMPLE', 'VERIFIED_REDACTION_SENTINEL', 'VERIFIED_NON_CREDENTIAL_IDENTIFIER', 'VERIFIED_SCANNER_DERIVED_NON_CREDENTIAL']);

function fail(message) { throw new Error(message); }
function arg(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function required(name) { const value = arg(name); if (!value || value.startsWith('--')) fail(`Missing ${name}.`); return value; }
function noRaw(value) { if (typeof value === 'string') return !SHAPE.test(value); if (Array.isArray(value)) return value.every(noRaw); return !value || typeof value !== 'object' || Object.entries(value).every(([key, nested]) => !FORBIDDEN.test(key) && noRaw(nested)); }
function ids(items, key, label) { const values = items.map((item) => item?.[key]); if (values.some((value) => typeof value !== 'string' || value.length === 0) || new Set(values).size !== values.length) fail(`Missing or duplicate ${label}.`); return new Set(values); }
function equalSets(left, right) { return left.size === right.size && [...left].every((value) => right.has(value)); }
function countBy(items, valueFor) { return Object.fromEntries([...items.reduce((counts, item) => { const key = valueFor(item); counts.set(key, (counts.get(key) ?? 0) + 1); return counts; }, new Map()).entries()].sort(([left], [right]) => String(left).localeCompare(String(right)))); }

export function validateR2Inventory(inventory, { priorInventory = null, requirePass = false } = {}) {
  if (inventory?.schema_version !== R2_SCHEMA || !Array.isArray(inventory.scan_observations) || !Array.isArray(inventory.canonical_occurrences) || !Array.isArray(inventory.provenance_records) || !Array.isArray(inventory.candidate_equivalence_classes) || !Array.isArray(inventory.logical_items) || !noRaw(inventory)) fail('R2 inventory is unsafe or malformed.');
  const observations = ids(inventory.scan_observations, 'observation_id', 'scan observation ID');
  const canonical = ids(inventory.canonical_occurrences, 'canonical_occurrence_id', 'canonical occurrence ID');
  const provenance = ids(inventory.provenance_records, 'provenance_id', 'provenance record ID');
  const classes = ids(inventory.candidate_equivalence_classes, 'candidate_equivalence_class_id', 'candidate equivalence class ID');
  const logical = ids(inventory.logical_items, 'logical_item_id', 'logical item ID');
  const totals = inventory.totals ?? {};
  if (totals.scan_observations !== observations.size || totals.canonical_occurrences !== canonical.size || totals.provenance_records !== provenance.size || totals.candidate_equivalence_classes !== classes.size || totals.deterministic_noncredential_logical_items + totals.plausible_credential_logical_items + totals.unreconstructed_candidates !== logical.size) fail('R2 layer totals do not reconcile.');
  if (inventory.reconstruction?.candidate_equality !== 'MEMORY_ONLY_EPHEMERAL_HMAC_AND_CONSTANT_TIME_CONFIRMATION' || inventory.reconstruction?.raw_candidate_persistence !== 'PROHIBITED' || inventory.reconstruction?.input_snapshot?.frozen_before_output_generation !== true) fail('R2 lacks the required memory-only equality and frozen-input controls.');
  const canonicalLinks = new Map();
  for (const item of inventory.scan_observations) {
    if (!canonical.has(item.canonical_occurrence_id) || canonicalLinks.has(item.observation_id)) fail('Observation has invalid canonical linkage.');
    canonicalLinks.set(item.observation_id, item.canonical_occurrence_id);
  }
  const provenanceByCanonical = new Map(); const classByCanonical = new Map();
  for (const item of inventory.canonical_occurrences) {
    if (!Array.isArray(item.contributing_observation_ids) || item.contributing_observation_ids.length === 0 || item.contributing_observation_ids.some((id) => !observations.has(id)) || !provenance.has(item.provenance_id) || !classes.has(item.candidate_equivalence_class_id)) fail(`Canonical occurrence ${item.canonical_occurrence_id} lacks complete forward links.`);
    for (const observationId of item.contributing_observation_ids) if (canonicalLinks.get(observationId) !== item.canonical_occurrence_id) fail(`Canonical occurrence ${item.canonical_occurrence_id} has an invalid reverse observation link.`);
    provenanceByCanonical.set(item.canonical_occurrence_id, item.provenance_id); classByCanonical.set(item.canonical_occurrence_id, item.candidate_equivalence_class_id);
  }
  if (provenanceByCanonical.size !== canonical.size || classByCanonical.size !== canonical.size) fail('Canonical occurrence links are incomplete.');
  const recordByCanonical = new Map();
  for (const record of inventory.provenance_records) {
    if (!canonical.has(record.canonical_occurrence_id) || recordByCanonical.has(record.canonical_occurrence_id) || !classes.has(record.candidate_equivalence_class_id) || !['PRIMARY_SOURCE', 'COPIED_SOURCE', 'GENERATED_OUTPUT', 'SCANNER_OUTPUT', 'REDACTED_REPORT', 'MEMORY_CAPTURE', 'OBSERVABILITY_CAPTURE', 'TEST_FIXTURE', 'DOCUMENTATION_EXAMPLE', 'PLACEHOLDER', 'IDENTIFIER', 'UNKNOWN'].includes(record.origin_class)) fail('Provenance record is malformed.');
    if (record.origin_class === 'SCANNER_OUTPUT' || record.origin_class === 'REDACTED_REPORT') fail('Scanner or redacted-report recursion entered the primary R2 inventory.');
    if (recordByCanonical.has(record.canonical_occurrence_id) || provenanceByCanonical.get(record.canonical_occurrence_id) !== record.provenance_id || classByCanonical.get(record.canonical_occurrence_id) !== record.candidate_equivalence_class_id) fail('Provenance record has inconsistent canonical membership.');
    recordByCanonical.set(record.canonical_occurrence_id, record);
  }
  if (recordByCanonical.size !== canonical.size) fail('Every canonical occurrence must have exactly one provenance record.');
  const logicalByClass = new Map(); const classMembers = new Set();
  for (const equivalence of inventory.candidate_equivalence_classes) {
    const reconstructed = equivalence.equality_method === 'EPHEMERAL_HMAC_PARTITION_THEN_CONSTANT_TIME_BYTE_EQUALITY' && equivalence.equality_run_result === 'COMPLETE_MEMORY_ONLY';
    const unavailable = equivalence.equality_method === 'NO_EQUALITY_INFERENCE_WHEN_SOURCE_BYTES_UNAVAILABLE' && equivalence.equality_run_result === 'UNRECONSTRUCTED_SOURCE_BYTES';
    if ((!reconstructed && !unavailable) || !Array.isArray(equivalence.canonical_occurrence_ids) || equivalence.member_count !== equivalence.canonical_occurrence_ids.length || equivalence.member_count < 1 || !equivalence.logical_item_id || (unavailable && equivalence.member_count !== 1)) fail(`Equivalence class ${equivalence.candidate_equivalence_class_id} lacks complete equality evidence.`);
    for (const canonicalId of equivalence.canonical_occurrence_ids) {
      if (!canonical.has(canonicalId) || classMembers.has(canonicalId) || classByCanonical.get(canonicalId) !== equivalence.candidate_equivalence_class_id) fail(`Equivalence class ${equivalence.candidate_equivalence_class_id} has invalid canonical membership.`);
      classMembers.add(canonicalId);
    }
    logicalByClass.set(equivalence.candidate_equivalence_class_id, equivalence.logical_item_id);
  }
  if (!equalSets(classMembers, canonical)) fail('Candidate-equivalence memberships must cover canonical occurrences exactly once.');
  const logicalMembers = new Set();
  for (const item of inventory.logical_items) {
    if (!classes.has(item.candidate_equivalence_class_id) || logicalByClass.get(item.candidate_equivalence_class_id) !== item.logical_item_id || !Array.isArray(item.canonical_occurrence_ids) || item.canonical_occurrence_ids.length === 0 || !Array.isArray(item.observation_ids) || !item.observation_ids.length) fail(`Logical item ${item.logical_item_id} lacks its exact equivalence membership.`);
    if (logicalMembers.has(item.candidate_equivalence_class_id)) fail('More than one logical item maps to a candidate-equivalence class.');
    logicalMembers.add(item.candidate_equivalence_class_id);
    const expectedCanonical = inventory.candidate_equivalence_classes.find((candidate) => candidate.candidate_equivalence_class_id === item.candidate_equivalence_class_id).canonical_occurrence_ids;
    if (JSON.stringify([...item.canonical_occurrence_ids].sort()) !== JSON.stringify([...expectedCanonical].sort())) fail(`Logical item ${item.logical_item_id} alters canonical equivalence membership.`);
    const equivalence = inventory.candidate_equivalence_classes.find((candidate) => candidate.candidate_equivalence_class_id === item.candidate_equivalence_class_id);
    if (item.classification === 'PLAUSIBLE_CREDENTIAL') {
      if (item.status !== 'PENDING_08A1C_ELIGIBILITY' || item.disposition !== 'UNKNOWN' || item.deterministic_noncredential_proof_id !== null || item.suspected_provider !== 'UNVERIFIED') fail(`Plausible logical item ${item.logical_item_id} has fabricated closure metadata.`);
    } else if (PATH_A.has(item.classification)) {
      if (item.status !== 'PATH_A_CLOSED' || !item.deterministic_noncredential_proof_id || !item.proof_family) fail(`Path A logical item ${item.logical_item_id} lacks deterministic proof.`);
    } else if (item.classification === 'UNRECONSTRUCTED_CANDIDATE') {
      if (equivalence.equality_run_result !== 'UNRECONSTRUCTED_SOURCE_BYTES' || item.status !== 'BLOCKED_SOURCE_BYTES_UNAVAILABLE' || item.downstream_08a1c_state !== 'NOT_ELIGIBLE_08A1B_R2_BLOCKED') fail(`Unreconstructed logical item ${item.logical_item_id} lacks a safe access blocker.`);
    } else fail(`Logical item ${item.logical_item_id} has unsupported classification.`);
  }
  if (!equalSets(logicalMembers, classes)) fail('Every candidate-equivalence class must map to exactly one logical item.');
  const singleton = inventory.candidate_equivalence_classes.filter((item) => item.member_count === 1).length;
  const repeated = inventory.candidate_equivalence_classes.filter((item) => item.member_count > 1).length;
  if (totals.singleton_equivalence_classes !== singleton || totals.repeated_equivalence_classes !== repeated || totals.largest_equivalence_class_size !== Math.max(0, ...inventory.candidate_equivalence_classes.map((item) => item.member_count)) || totals.scanner_output_recursion !== 0 || totals.unreconstructed_candidates !== inventory.logical_items.filter((item) => item.classification === 'UNRECONSTRUCTED_CANDIDATE').length || totals.unresolved_provenance !== inventory.provenance_records.filter((item) => item.origin_class === 'UNKNOWN').length || JSON.stringify(inventory.provenance_totals) !== JSON.stringify(countBy(inventory.provenance_records, (item) => item.origin_class))) fail('R2 summary totals are inconsistent.');
  if (priorInventory) {
    const observationDelta = inventory.totals.scan_observations - priorInventory.totals.scan_observations;
    const logicalDelta = inventory.totals.candidate_equivalence_classes - priorInventory.totals.candidate_equivalence_classes;
    if (observationDelta > 0 && logicalDelta === observationDelta && repeated === 0 && inventory.totals.observation_to_canonical_overlap_reduction === 0) fail('Exact observation-delta propagation lacks a candidate-equivalence/provenance bridge.');
  }
  if (requirePass && inventory.totals.unreconstructed_candidates !== 0) fail('08A1B-R2 cannot pass while unreconstructed candidates remain.');
  if (requirePass && inventory.totals.candidate_equivalence_classes === inventory.totals.canonical_occurrences) {
    const allSingleton = singleton === inventory.totals.candidate_equivalence_classes;
    const noDerived = inventory.totals.duplicated_or_derived_occurrences_absorbed === 0;
    const resolvedProvenance = inventory.totals.unresolved_provenance === 0;
    if (!(allSingleton && noDerived && resolvedProvenance && inventory.totals.scanner_output_recursion === 0)) fail('Strict one-to-one inflation guard rejected the R2 PASS candidate.');
  }
  return { status: inventory.totals.unreconstructed_candidates === 0 ? 'PASS' : 'BLOCKED', totals };
}

async function main() {
  const inventory = JSON.parse(await readFile(required('--inventory'), 'utf8'));
  const priorPath = arg('--prior-inventory'); const priorInventory = priorPath ? JSON.parse(await readFile(priorPath, 'utf8')) : null;
  const result = validateR2Inventory(inventory, { priorInventory, requirePass: process.argv.includes('--require-pass') });
  process.stdout.write(`Validated 08A1B-R2 reconstruction: ${result.totals.scan_observations} observations, ${result.totals.candidate_equivalence_classes} candidate classes, ${result.status}.\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) main().catch((error) => { process.stderr.write(`08A1B-R2 validation failed: ${error.message}\n`); process.exitCode = 1; });
