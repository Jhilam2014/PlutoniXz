#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildResolution } from './verify-08a1c-owner-dispositions.mjs';
import { validateExternalEvidence } from './verify-08a1c-external-evidence.mjs';

const manifestPath = 'runtime/secret-scan/20260811T214249Z/canonical-inventory.08a1b.sanitized.json';
const factsPath = 'docs/production-readiness/evidence/08a1c-repository-facts.sanitized.json';
const packageDirectory = 'docs/production-readiness/evidence/08a1c-external';
const authorityRecordsPath = `${packageDirectory}/authority-records.r3.sanitized.json`;
const domainPath = `${packageDirectory}/authority-domains.sanitized.json`;

const [sourceManifest, repositoryFacts, authorityDomains, reachabilityMap, actionManifest, intake, authorityRecords] = await Promise.all([
  readFile(manifestPath, 'utf8').then(JSON.parse),
  readFile(factsPath, 'utf8').then(JSON.parse),
  readFile(domainPath, 'utf8').then(JSON.parse),
  readFile(`${packageDirectory}/reachability-to-authority-map.sanitized.json`, 'utf8').then(JSON.parse),
  readFile(`${packageDirectory}/external-action-manifest.sanitized.json`, 'utf8').then(JSON.parse),
  readFile(`${packageDirectory}/evidence-intake.sanitized.json`, 'utf8').then(JSON.parse),
  readFile(authorityRecordsPath, 'utf8').then(JSON.parse),
]);
const resolution = buildResolution(sourceManifest, authorityRecords, repositoryFacts, authorityDomains);
const baseline = { sourceManifest, repositoryFacts, authorityDomains, reachabilityMap, actionManifest, intake, authorityRecords, resolution, packageDirectory };
const result = await validateExternalEvidence(baseline);
assert.deepEqual(result, { authority_domains: 11, path_a_logical_items: 1, path_b_logical_items: 14848, provider_credential_groups: 0, safe_authority_linkages: 0, reachability_buckets: { CURRENT_TREE: 14, MEMORY_ARTIFACT: 6, OBSERVABILITY_ARTIFACT: 2, REACHABLE_HISTORY: 19, RUNTIME_ARTIFACT: 14807 } });

const providerInference = structuredClone(baseline); providerInference.reachabilityMap.items[0].provider_identity_status = 'UNVERIFIED_PROVIDER_NAME';
await assert.rejects(() => validateExternalEvidence(providerInference), /source data into authority\/provider data/);
const reachabilityAuthority = structuredClone(baseline); reachabilityAuthority.authorityDomains.authority_domains[0].source_scope_basis = 'REACHABILITY';
await assert.rejects(() => validateExternalEvidence(reachabilityAuthority), /source-scope or unknown-provider constraints/);
const fixtureLeak = structuredClone(baseline); fixtureLeak.authorityDomains.authority_domains[0].logical_item_ids[0] = 'LI-0688064EDD3166F6BF2C';
await assert.rejects(() => validateExternalEvidence(fixtureLeak), /Path A logical item/);
const timestampMismatch = structuredClone(baseline); timestampMismatch.intake.reviewed_at = '2026-08-12T00:00:00Z';
await assert.rejects(() => validateExternalEvidence(timestampMismatch), /reviewed UTC timestamp/);
const unsafeApifyLinkage = structuredClone(baseline); const apify = unsafeApifyLinkage.authorityRecords.authority_records.find((record) => record.authority_id === 'AUTH-APIFY-DEV-JHILAM-BERA-20260811'); apify.authority_domain_id = 'AD-SOURCE-SELF-IMPROVEMENT-RUNTIME';
await assert.rejects(() => validateExternalEvidence(unsafeApifyLinkage), /Apify assertion must remain explicitly unlinked/);
const actionMismatch = structuredClone(baseline); actionMismatch.actionManifest.actions[0].status = 'IMPLICITLY_APPROVED';
await assert.rejects(() => validateExternalEvidence(actionMismatch), /External action/);

const temporary = await mkdtemp(path.join(os.tmpdir(), 'plutonix-08a1c-r3-stability-'));
try {
  for (const outputName of ['first', 'second']) {
    const outputDirectory = path.join(temporary, outputName);
    const run = spawnSync(process.execPath, ['scripts/build-08a1c-authority-domains.mjs', '--source-manifest', manifestPath, '--repository-facts', factsPath, '--previous-authority-records', 'docs/production-readiness/evidence/08a-owner-authority-records.sanitized.json', '--output-directory', outputDirectory, '--output-authority-records', path.join(outputDirectory, 'authority-records.r3.sanitized.json')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  }
  for (const filename of ['authority-domains.sanitized.json', 'reachability-to-authority-map.sanitized.json', 'external-action-manifest.sanitized.json', 'evidence-intake.sanitized.json', 'authority-records.r3.sanitized.json']) {
    const [first, second] = await Promise.all([readFile(path.join(temporary, 'first', filename), 'utf8'), readFile(path.join(temporary, 'second', filename), 'utf8')]);
    assert.equal(first, second, `rerun output drifted for ${filename}`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log('08A1C-R3 authority-domain membership, source-scope separation, unknown-provider, timestamp, safe-linkage, action, fixture, redaction, batch-dependent disposition, and rerun-stability tests passed.');
