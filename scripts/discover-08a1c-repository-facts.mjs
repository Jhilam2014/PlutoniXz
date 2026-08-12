#!/usr/bin/env node

/**
 * Derive narrowly scoped 08A1C Path A facts without printing or persisting a
 * credential value. Source reports must already be structurally redacted.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SCHEMA_VERSION = '08A1C-repository-facts-v1';
const VALIDATOR_VERSION = '08A1C-repository-fact-discovery-v1';
const FIXTURE_LOCATION = 'apps/backend/test/operationalSecurity.test.js';
const PROVIDER_SHAPE = /(?:\bAIza|\bAKIA|\bsk-(?:proj-)?|\bxox[abprs]|apify_api)/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function fail(message) { throw new Error(message); }
function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) fail(`Missing ${name}`); return value; }
function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && !value.split(path.sep).includes('..');
}
function noRaw(value) {
  if (typeof value === 'string') return !/(?:apify_api|sk-(?:proj-)?|AIza|AKIA|xox[abprs])[_-]?[A-Za-z0-9]{12,}|(?:api[_-]?key|token)\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i.test(value);
  if (Array.isArray(value)) return value.every(noRaw);
  return !value || typeof value !== 'object' || Object.entries(value).every(([key, nested]) => !/^(?:secret|match|authorization|token_value|credential_value|replacement_value|raw_value)$/i.test(key) && noRaw(nested));
}
function sortedCounts(values) {
  return Object.fromEntries([...values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function validateManifest(manifest) {
  if (manifest?.schema_version !== '08A1B-canonical-inventory-v1' || !Array.isArray(manifest.scan_observations) || !Array.isArray(manifest.canonical_occurrences) || !Array.isArray(manifest.logical_items)) fail('Unsupported 08A1B source inventory.');
  if (!noRaw(manifest)) fail('Source manifest contains prohibited raw-value data.');
  if (manifest.logical_item_count !== manifest.logical_items.length || manifest.canonical_occurrence_count !== manifest.canonical_occurrences.length) fail('Source manifest count mismatch.');
  const logicalByCanonical = new Map();
  for (const logical of manifest.logical_items) {
    if (!Array.isArray(logical.canonical_occurrence_ids) || logical.canonical_occurrence_ids.length !== 1) fail('08A1C Path A discovery requires exactly one canonical occurrence per logical item.');
    logicalByCanonical.set(logical.canonical_occurrence_ids[0], logical);
  }
  if (logicalByCanonical.size !== manifest.canonical_occurrences.length) fail('Source canonical/logical membership is incomplete.');
  return logicalByCanonical;
}

async function sanitizedRows(repositoryRoot, sourceReport, cache) {
  if (!safeRelative(sourceReport)) fail(`Unsafe source report reference: ${sourceReport}`);
  if (!cache.has(sourceReport)) {
    const rows = JSON.parse(await readFile(path.join(repositoryRoot, sourceReport), 'utf8'));
    if (!Array.isArray(rows) || rows.some((row) => row?.Secret !== 'REDACTED' || typeof row.Match !== 'string' || !row.Match.includes('REDACTED'))) fail(`Source report is not structurally redacted: ${sourceReport}`);
    cache.set(sourceReport, rows);
  }
  return cache.get(sourceReport);
}

function fixtureFact({ canonical, logical, observation, row, testLines, testSource, reviewedAt }) {
  const identity = canonical.canonical_identity;
  if (identity.object_marker !== 'CURRENT_TREE' || identity.normalized_location !== FIXTURE_LOCATION || row.RuleID !== 'generic-api-key') return null;
  const lineNumber = row.StartLine;
  const line = Number.isInteger(lineNumber) ? testLines[lineNumber - 1] ?? '' : '';
  const deterministicBuilder = testSource.includes('test("fake scanner fixture') && testSource.includes('const fakeToken = [') && testSource.includes('.join("_")');
  if (!deterministicBuilder || !line.includes('fakeToken') || PROVIDER_SHAPE.test(line)) return null;
  return {
    logical_item_id: logical.logical_item_id,
    canonical_occurrence_id: canonical.canonical_occurrence_id,
    closure_path: 'PATH_A_REPOSITORY_FACT',
    disposition: 'VERIFIED_SYNTHETIC_FIXTURE',
    proof_family: 'DETERMINISTIC_COMMITTED_FIXTURE',
    reason_code: 'DETERMINISTIC_NON_PROVIDER_TEST_FIXTURE',
    safe_provenance: 'Current-tree scanner location and line metadata point to the committed operational-security test; its local fake-token builder is deterministic and non-provider-shaped.',
    source_version: 'operational-security-fixture-source-v1',
    validator_version: VALIDATOR_VERSION,
    proof_reference: 'apps/backend/test/operationalSecurity.test.js; .gitleaks.toml custom fake-fixture control',
    generator_proof_reference: 'apps/backend/test/operationalSecurity.test.js deterministic fake-token builder',
    regression_test_reference: 'apps/backend/test/operationalSecurity.test.js; scripts/secret-scan.sh verify-fixture',
    repository_verification_timestamp: reviewedAt,
  };
}

async function main() {
  const repositoryRoot = required('--repository-root');
  const reviewedAt = required('--reviewed-at');
  if (!ISO.test(reviewedAt)) fail('Repository-fact discovery requires a stable UTC review timestamp.');
  const manifest = JSON.parse(await readFile(required('--source-manifest'), 'utf8'));
  const logicalByCanonical = validateManifest(manifest);
  const reportCache = new Map();
  const observationById = new Map(manifest.scan_observations.map((item) => [item.observation_id, item]));
  const testSource = await readFile(path.join(repositoryRoot, FIXTURE_LOCATION), 'utf8');
  const testLines = testSource.split(/\r?\n/);
  const facts = [];
  const classifications = [];

  for (const canonical of [...manifest.canonical_occurrences].sort((left, right) => left.canonical_occurrence_id.localeCompare(right.canonical_occurrence_id))) {
    const logical = logicalByCanonical.get(canonical.canonical_occurrence_id);
    const observations = canonical.contributing_observation_ids.map((id) => observationById.get(id));
    if (observations.some((item) => !item)) fail(`Canonical occurrence ${canonical.canonical_occurrence_id} has an orphaned observation.`);
    let fact = null;
    for (const observation of observations) {
      const rows = await sanitizedRows(repositoryRoot, observation.source_report, reportCache);
      const row = rows[observation.source_observation_index - 1];
      if (!row || row.RuleID !== observation.rule_id) fail(`Source report linkage is invalid for ${observation.observation_id}.`);
      fact ??= fixtureFact({ canonical, logical, observation, row, testLines, testSource, reviewedAt });
    }
    if (fact) {
      facts.push(fact);
      classifications.push('PATH_A_REPOSITORY_FACT');
    } else {
      classifications.push('PATH_B_EXTERNAL_AUTHORITY_OR_PROVIDER');
    }
  }
  if (new Set(facts.map((item) => item.logical_item_id)).size !== facts.length || new Set(facts.map((item) => item.canonical_occurrence_id)).size !== facts.length) fail('Repository facts must have unique logical and canonical membership.');
  const output = {
    schema_version: SCHEMA_VERSION,
    source_manifest_run_id: manifest.run_id,
    reviewed_at: reviewedAt,
    validator_version: VALIDATOR_VERSION,
    source_report_sanitation: 'STRUCTURALLY_VERIFIED_SECRET_AND_MATCH_REDACTED',
    inspection_scope: 'All logical items classified; only a fixed committed test-fixture proof family is eligible for Path A in this run. Local .env files are never opened by this discovery control.',
    totals: {
      logical_items_inspected: manifest.logical_item_count,
      repository_terminal_facts: facts.length,
      path_classification_totals: sortedCounts(classifications),
      proof_family_totals: sortedCounts(facts.map((item) => item.proof_family)),
    },
    repository_facts: facts,
  };
  if (!noRaw(output)) fail('Repository-fact output would contain prohibited raw-value data.');
  const outputPath = required('--output');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  process.stdout.write(`Discovered ${facts.length} repository-proven terminal facts; ${manifest.logical_item_count - facts.length} logical items remain on the external authority/provider path.\n`);
}

main().catch((error) => { process.stderr.write(`08A1C repository-fact discovery failed: ${error.message}\n`); process.exitCode = 1; });
