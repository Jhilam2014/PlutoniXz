#!/usr/bin/env node

/** Fail-closed validation for the 08A1C-R3 external-evidence intake package. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PATH_A = 'PATH_A_REPOSITORY_FACT';
const PATH_B = 'PATH_B_EXTERNAL_AUTHORITY_OR_PROVIDER';
const FORBIDDEN_FIELD = /^(?:secret|match|authorization|token_value|credential_value|replacement_value|raw_value)$/i;
const CREDENTIAL_SHAPE = /(?:apify_api|sk-(?:proj-)?|AIza|AKIA|xox[abprs])[_-]?[A-Za-z0-9]{12,}|(?:api[_-]?key|token)\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i;

function fail(message) { throw new Error(message); }
function argument(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) fail(`Missing ${name}`); return value; }
function isIsoTimestamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value); }
function noSecretBearingData(value) { if (typeof value === 'string') return !CREDENTIAL_SHAPE.test(value); if (Array.isArray(value)) return value.every(noSecretBearingData); return !value || typeof value !== 'object' || Object.entries(value).every(([key, nested]) => !FORBIDDEN_FIELD.test(key) && noSecretBearingData(nested)); }
function ids(items, key, label) { const values = items.map((item) => item?.[key]); if (values.some((value) => typeof value !== 'string' || value.length === 0) || new Set(values).size !== values.length) fail(`Missing or duplicate ${label}.`); return new Set(values); }
function equalSets(left, right) { return left.size === right.size && [...left].every((value) => right.has(value)); }
function countBy(items, valueFor) { return Object.fromEntries([...items.reduce((counts, item) => { const key = valueFor(item); counts.set(key, (counts.get(key) ?? 0) + 1); return counts; }, new Map()).entries()].sort(([left], [right]) => String(left).localeCompare(String(right)))); }

export async function validateExternalEvidence({ sourceManifest, repositoryFacts, authorityDomains, reachabilityMap, actionManifest, intake, authorityRecords, resolution, packageDirectory }) {
  if (sourceManifest?.schema_version !== '08A1B-canonical-inventory-v1' || !Array.isArray(sourceManifest.logical_items) || !Array.isArray(sourceManifest.canonical_occurrences) || !noSecretBearingData(sourceManifest)) fail('External-evidence validation requires a safe canonical 08A1B inventory.');
  if (repositoryFacts?.schema_version !== '08A1C-repository-facts-v1' || !Array.isArray(repositoryFacts.repository_facts) || !isIsoTimestamp(repositoryFacts.reviewed_at) || !noSecretBearingData(repositoryFacts)) fail('Repository facts are unsafe or malformed.');
  const reviewedAt = repositoryFacts.reviewed_at;
  if (authorityDomains?.schema_version !== '08A1C-authority-domain-decomposition-v1' || reachabilityMap?.schema_version !== '08A1C-reachability-to-authority-map-v1' || actionManifest?.schema_version !== '08A1C-external-action-manifest-v1' || intake?.schema_version !== '08A1C-external-evidence-intake-v1' || authorityRecords?.schema_version !== '08A1C-authority-records-v2' || resolution?.schema_version !== '08A1C-owner-resolution-v3') fail('The external-evidence package has an unsupported schema version.');
  for (const artifact of [authorityDomains, reachabilityMap, actionManifest, intake, authorityRecords, resolution]) if (!isIsoTimestamp(artifact.reviewed_at) || artifact.reviewed_at !== reviewedAt || !noSecretBearingData(artifact)) fail('External evidence must be redacted and share the reviewed UTC timestamp.');
  if (authorityDomains.source_inventory?.run_id !== sourceManifest.run_id || reachabilityMap.source_inventory_run_id !== sourceManifest.run_id || actionManifest.source_inventory_run_id !== sourceManifest.run_id || intake.source_inventory_run_id !== sourceManifest.run_id || resolution.source_inventory?.run_id !== sourceManifest.run_id) fail('External-evidence artifacts have a mismatched source inventory.');
  if (authorityDomains.decomposition_policy?.reachability_is_not_authority_domain !== true || authorityDomains.decomposition_policy?.provider_identity_rule !== 'UNKNOWN_UNTIL_SAFE_EXTERNAL_EVIDENCE' || authorityDomains.decomposition_policy?.provider_credential_group_rule !== 'NO_GROUP_WITHOUT_SAFE_NONSECRET_LINKAGE') fail('The decomposition does not fail closed on authority/provider inference.');
  const canonicalById = new Map(sourceManifest.canonical_occurrences.map((item) => [item.canonical_occurrence_id, item]));
  const pathAIds = new Set(repositoryFacts.repository_facts.map((fact) => fact.logical_item_id));
  if (pathAIds.size !== 1 || !pathAIds.has('LI-0688064EDD3166F6BF2C')) fail('The deterministic Path A fixture did not revalidate exactly.');
  const residualIds = new Set(sourceManifest.logical_items.map((item) => item.logical_item_id).filter((id) => !pathAIds.has(id)));
  const domains = authorityDomains.authority_domains;
  const domainIds = ids(domains, 'authority_domain_id', 'authority-domain ID');
  const domainsById = new Map(domains.map((domain) => [domain.authority_domain_id, domain]));
  const covered = new Set();
  for (const domain of domains) {
    if (domain.status !== 'PENDING_SOURCE_OWNER_IDENTIFICATION' || domain.authority_domain_kind !== 'SOURCE_OWNER_INVESTIGATION_SCOPE' || domain.source_scope_basis === 'REACHABILITY' || !String(domain.source_scope_basis).includes('CANONICAL_NORMALIZED_LOCATION') || typeof domain.source_scope_id !== 'string' || typeof domain.source_system_root !== 'string' || domain.provider_identity_status !== 'UNKNOWN' || !Array.isArray(domain.provider_credential_group_ids) || domain.provider_credential_group_ids.length !== 0 || domain.environment_scope !== 'UNKNOWN') fail(`Authority domain ${domain.authority_domain_id} violates source-scope or unknown-provider constraints.`);
    if (!Array.isArray(domain.logical_item_ids) || domain.logical_item_count !== domain.logical_item_ids.length || !Array.isArray(domain.canonical_occurrence_ids) || domain.canonical_occurrence_ids.length !== domain.logical_item_count || !Array.isArray(domain.reachability_buckets) || domain.reachability_buckets.length === 0) fail(`Authority domain ${domain.authority_domain_id} has incomplete membership.`);
    for (const logicalItemId of domain.logical_item_ids) { if (!residualIds.has(logicalItemId) || covered.has(logicalItemId)) fail(`Authority-domain membership has a duplicate, missing, or Path A logical item: ${logicalItemId}.`); covered.add(logicalItemId); }
    const membership = JSON.parse(await readFile(path.join(packageDirectory, domain.membership_file), 'utf8'));
    if (membership.schema_version !== '08A1C-authority-domain-membership-v1' || membership.authority_domain_id !== domain.authority_domain_id || membership.source_scope_id !== domain.source_scope_id || membership.logical_item_count !== domain.logical_item_count || !Array.isArray(membership.members) || !noSecretBearingData(membership)) fail(`Membership file is malformed for ${domain.authority_domain_id}.`);
    if (!equalSets(new Set(membership.members.map((member) => member.logical_item_id)), new Set(domain.logical_item_ids))) fail(`Membership file does not exactly match domain ${domain.authority_domain_id}.`);
    for (const member of membership.members) {
      const canonical = canonicalById.get(member.canonical_occurrence_id);
      if (!canonical || member.authority_domain_id !== domain.authority_domain_id || member.source_scope_id !== domain.source_scope_id || member.provider_identity_status !== 'UNKNOWN' || member.provider_credential_group_id !== null || member.closure_path !== PATH_B || !Array.isArray(member.reachability)) fail(`Membership member violates safety constraints in ${domain.authority_domain_id}.`);
    }
    const [authorityRequest, providerRequest] = await Promise.all([readFile(path.join(packageDirectory, domain.authority_request), 'utf8'), readFile(path.join(packageDirectory, domain.provider_evidence_request), 'utf8')]);
    if (!authorityRequest.includes(domain.authority_domain_id) || !authorityRequest.includes(domain.source_scope_id) || !providerRequest.includes(domain.authority_domain_id) || !providerRequest.includes('No provider is asserted') || !noSecretBearingData(authorityRequest) || !noSecretBearingData(providerRequest)) fail(`External request template is unsafe or incomplete for ${domain.authority_domain_id}.`);
  }
  if (!equalSets(covered, residualIds)) fail('Authority domains must cover every Path B logical item exactly once.');
  const mapItems = reachabilityMap.items;
  if (!Array.isArray(mapItems) || !equalSets(ids(mapItems, 'logical_item_id', 'reachability-map logical item ID'), residualIds)) fail('Reachability map must cover every Path B logical item exactly once.');
  for (const item of mapItems) {
    const domain = domainsById.get(item.authority_domain_id);
    if (!domain || item.source_scope_id !== domain.source_scope_id || item.source_system_root !== domain.source_system_root || item.provider_identity_status !== 'UNKNOWN' || item.provider_credential_group_id !== null || item.closure_path !== PATH_B || !Array.isArray(item.reachability) || !domain.logical_item_ids.includes(item.logical_item_id)) fail(`Reachability map incorrectly turns source data into authority/provider data for ${item.logical_item_id}.`);
  }
  if (authorityDomains.totals?.path_a_repository_fact_logical_items !== pathAIds.size || authorityDomains.totals?.path_b_residual_logical_items !== residualIds.size || authorityDomains.totals?.authority_domains !== domainIds.size || authorityDomains.totals?.provider_credential_groups !== 0 || authorityDomains.totals?.safe_authority_linkages !== 0 || reachabilityMap.totals?.residual_logical_items !== residualIds.size || reachabilityMap.totals?.authority_domains !== domainIds.size || reachabilityMap.totals?.provider_credential_groups !== 0 || reachabilityMap.totals?.safe_authority_linkages !== 0) fail('Authority-domain or reachability-map totals do not reconcile.');
  const pendingAuthorities = authorityRecords.authority_records.filter((record) => record.status === 'PENDING_AUTHORITY_EVIDENCE');
  if (!equalSets(ids(pendingAuthorities, 'authority_domain_id', 'pending authority-domain ID'), domainIds)) fail('Authority records must include one pending authority per source-scope domain.');
  const apify = authorityRecords.authority_records.find((record) => record.authority_id === 'AUTH-APIFY-DEV-JHILAM-BERA-20260811');
  if (!apify || apify.authority_domain_id !== null || apify.safe_linkage_status !== 'UNLINKED_NO_SAFE_ITEM_LINKAGE' || (apify.logical_item_ids ?? []).length !== 0 || !(authorityRecords.evidence_policy?.unlinked_authority_assertion_ids ?? []).includes(apify.authority_id)) fail('The existing Apify assertion must remain explicitly unlinked.');
  if (!Array.isArray(actionManifest.actions) || actionManifest.actions.length !== domainIds.size || !equalSets(ids(actionManifest.actions, 'authority_domain_id', 'action authority-domain ID'), domainIds)) fail('External-action manifest must contain one action per authority domain.');
  for (const action of actionManifest.actions) if (action.status !== 'PENDING_EXTERNAL_EVIDENCE' || action.action_type !== 'REQUEST_SOURCE_OWNER_AUTHORITY_AND_PROVIDER_IDENTIFICATION' || action.provider_credential_group_count !== 0 || !Array.isArray(action.prohibited_shortcuts) || !action.prohibited_shortcuts.includes('reachability_as_authority') || !action.prohibited_shortcuts.includes('unlinked_owner_assertion')) fail(`External action ${action.action_id} is unsafe or incomplete.`);
  if (actionManifest.totals?.authority_actions !== domainIds.size || actionManifest.totals?.provider_evidence_actions !== domainIds.size || actionManifest.totals?.pending_external_evidence_actions !== domainIds.size || actionManifest.totals?.imported_authority_evidence !== 0 || actionManifest.totals?.imported_provider_evidence !== 0 || actionManifest.totals?.provider_credential_groups !== 0 || actionManifest.totals?.safe_authority_linkages !== 0) fail('External-action totals do not reconcile.');
  if (!Array.isArray(intake.records) || intake.records.length !== 0 || intake.totals?.authority_records_imported !== 0 || intake.totals?.provider_evidence_records_imported !== 0 || intake.totals?.accepted !== 0 || intake.totals?.rejected !== 0 || intake.totals?.pending !== domainIds.size || intake.totals?.provider_credential_groups !== 0 || intake.totals?.safe_authority_linkages !== 0) fail('No external evidence is authorized or available for this intake run.');
  if (!Array.isArray(resolution.dispositions) || resolution.dispositions.length !== sourceManifest.logical_item_count || resolution.authority_domain_decomposition?.authority_domains !== domainIds.size || resolution.authority_domain_decomposition?.provider_credential_groups !== 0 || resolution.authority_domain_decomposition?.safe_authority_linkages !== 0 || resolution.authority_domain_decomposition?.reachability_is_not_authority_domain !== true) fail('Resolution does not preserve the external authority-domain model.');
  const resolutionPathB = resolution.dispositions.filter((item) => item.closure_path === PATH_B);
  if (!equalSets(new Set(resolutionPathB.map((item) => item.logical_item_id)), residualIds)) fail('Resolution does not cover the expected Path B membership.');
  for (const item of resolutionPathB) {
    const mapItem = mapItems.find((entry) => entry.logical_item_id === item.logical_item_id);
    if (!mapItem || item.authority_domain_id !== mapItem.authority_domain_id || item.source_scope_id !== mapItem.source_scope_id || item.source_system_root !== mapItem.source_system_root || item.provider_credential_group_id !== null || item.verified_provider !== 'UNKNOWN' || item.review_state !== 'OWNER_ASSIGNMENT_REQUIRED') fail(`Resolution lacks bidirectional source-scope mapping for ${item.logical_item_id}.`);
  }
  const resolutionPathA = resolution.dispositions.filter((item) => item.closure_path === PATH_A);
  if (resolutionPathA.length !== 1 || resolutionPathA[0].logical_item_id !== 'LI-0688064EDD3166F6BF2C' || resolutionPathA[0].authority_domain_id !== null || resolutionPathA[0].disposition !== 'VERIFIED_SYNTHETIC_FIXTURE') fail('Resolution Path A fixture is malformed.');
  return { authority_domains: domainIds.size, path_a_logical_items: pathAIds.size, path_b_logical_items: residualIds.size, provider_credential_groups: 0, safe_authority_linkages: 0, reachability_buckets: countBy(mapItems, (item) => item.reachability.join('+')) };
}

async function main() {
  const packageDirectory = required('--package-directory');
  const [sourceManifest, repositoryFacts, authorityDomains, reachabilityMap, actionManifest, intake, authorityRecords, resolution] = await Promise.all([
    readFile(required('--source-manifest'), 'utf8').then(JSON.parse),
    readFile(required('--repository-facts'), 'utf8').then(JSON.parse),
    readFile(path.join(packageDirectory, 'authority-domains.sanitized.json'), 'utf8').then(JSON.parse),
    readFile(path.join(packageDirectory, 'reachability-to-authority-map.sanitized.json'), 'utf8').then(JSON.parse),
    readFile(path.join(packageDirectory, 'external-action-manifest.sanitized.json'), 'utf8').then(JSON.parse),
    readFile(path.join(packageDirectory, 'evidence-intake.sanitized.json'), 'utf8').then(JSON.parse),
    readFile(required('--authority-records'), 'utf8').then(JSON.parse),
    readFile(required('--resolution'), 'utf8').then(JSON.parse),
  ]);
  const result = await validateExternalEvidence({ sourceManifest, repositoryFacts, authorityDomains, reachabilityMap, actionManifest, intake, authorityRecords, resolution, packageDirectory });
  process.stdout.write(`Validated 08A1C-R3 external evidence: ${result.authority_domains} source-scope domains, ${result.path_b_logical_items} Path B items, ${result.provider_credential_groups} provider credential groups.\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) main().catch((error) => { process.stderr.write(`08A1C-R3 external-evidence validation failed: ${error.message}\n`); process.exitCode = 1; });
