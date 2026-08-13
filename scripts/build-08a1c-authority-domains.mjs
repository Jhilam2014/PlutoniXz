#!/usr/bin/env node

/**
 * Builds the 08A1C-R3 source-scope authority decomposition without opening
 * credentials, .env content, provider consoles, or external systems.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PATH_A = 'PATH_A_REPOSITORY_FACT';
const PATH_B = 'PATH_B_EXTERNAL_AUTHORITY_OR_PROVIDER';
const DOMAIN_DEFINITIONS = [
  ['AD-SOURCE-SELF-IMPROVEMENT-RUNTIME', 'SOURCE_SCOPE_SELF_IMPROVEMENT_RUNTIME', 'runtime/self-improvement/', 'Self-improvement runtime records'],
  ['AD-SOURCE-STAGED-PROJECT-MEDIA', 'SOURCE_SCOPE_STAGED_PROJECT_MEDIA', 'runtime/staged-project-media/', 'Staged project-media ingress'],
  ['AD-SOURCE-PROJECT-INTELLIGENCE-MEMORY', 'SOURCE_SCOPE_PROJECT_INTELLIGENCE_MEMORY', 'memory/project-intelligence/projects/', 'Project-intelligence memory records'],
  ['AD-SOURCE-AGENT-EFFICIENCY-OBSERVABILITY', 'SOURCE_SCOPE_AGENT_EFFICIENCY_OBSERVABILITY', 'observability/agent-efficiency/', 'Agent-efficiency observability records'],
  ['AD-SOURCE-REPOSITORY-CONFIGURATION-INGRESS', 'SOURCE_SCOPE_REPOSITORY_CONFIGURATION_INGRESS', '.env and .env.example names only', 'Repository configuration ingress'],
  ['AD-SOURCE-ORCHESTRATION-POLICY', 'SOURCE_SCOPE_ORCHESTRATION_POLICY', 'AGENTS.md', 'Orchestration policy source'],
  ['AD-SOURCE-BACKEND-OPERATIONAL-TESTS', 'SOURCE_SCOPE_BACKEND_OPERATIONAL_TESTS', 'apps/backend/test/', 'Backend operational test source'],
  ['AD-SOURCE-AGENT-TOKEN-LEDGER', 'SOURCE_SCOPE_AGENT_TOKEN_LEDGER', 'database/agent-token-usage.table.jsonl', 'Agent token-usage ledger'],
  ['AD-SOURCE-ARCHIVED-WORKSPACE', 'SOURCE_SCOPE_ARCHIVED_WORKSPACE', 'orchestrator-temp/', 'Archived workspace provenance'],
  ['AD-SOURCE-LEGACY-AGENT-WORKSPACE', 'SOURCE_SCOPE_LEGACY_AGENT_WORKSPACE', 'newAgent/', 'Legacy local-agent workspace provenance'],
  ['AD-SOURCE-SELF-IMPROVEMENT-OBSERVABILITY', 'SOURCE_SCOPE_SELF_IMPROVEMENT_OBSERVABILITY', 'observability/self-improvement/', 'Self-improvement observability record'],
].map(([authorityDomainId, sourceScopeId, sourceSystemRoot, displayName]) => ({ authorityDomainId, sourceScopeId, sourceSystemRoot, displayName }));

function argument(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }
function isIsoTimestamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value); }
function stable(items, field) { return [...items].sort((left, right) => String(left[field]).localeCompare(String(right[field]))); }
function countBy(items, valueFor) { return Object.fromEntries([...items.reduce((counts, item) => { const key = valueFor(item); counts.set(key, (counts.get(key) ?? 0) + 1); return counts; }, new Map()).entries()].sort(([left], [right]) => String(left).localeCompare(String(right)))); }
async function writeJson(filename, value) { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
async function writeText(filename, value) { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, value, 'utf8'); }

function domainForLocation(location) {
  if (location.startsWith('runtime/self-improvement/')) return DOMAIN_DEFINITIONS[0];
  if (location.startsWith('runtime/staged-project-media/')) return DOMAIN_DEFINITIONS[1];
  if (location.startsWith('memory/project-intelligence/projects/')) return DOMAIN_DEFINITIONS[2];
  if (location.startsWith('observability/agent-efficiency/')) return DOMAIN_DEFINITIONS[3];
  if (location === '.env' || location === '.env.example') return DOMAIN_DEFINITIONS[4];
  if (location === 'AGENTS.md') return DOMAIN_DEFINITIONS[5];
  if (location.startsWith('apps/backend/test/')) return DOMAIN_DEFINITIONS[6];
  if (location === 'database/agent-token-usage.table.jsonl') return DOMAIN_DEFINITIONS[7];
  if (location.startsWith('orchestrator-temp/')) return DOMAIN_DEFINITIONS[8];
  if (location.startsWith('newAgent/')) return DOMAIN_DEFINITIONS[9];
  if (location.startsWith('observability/self-improvement/')) return DOMAIN_DEFINITIONS[10];
  throw new Error(`No approved source-scope classifier exists for sanitized location ${location}.`);
}

function authorityRequest(domain, reviewedAt) {
  return `# Authority request — ${domain.authority_domain_id}\n\nStatus: **PENDING_SOURCE_OWNER_IDENTIFICATION**. Created from sanitized repository provenance at ${reviewedAt}.\n\n## Scope\n\n- Source scope: \`${domain.source_scope_id}\`\n- Source-system/root boundary: \`${domain.source_system_root}\`\n- Residual logical items: ${domain.logical_item_count}\n- Reachability is an observation bucket only; it is not an authority, provider, credential group, environment, or deployment scope.\n\n## Requested safe evidence\n\n1. Identify the accountable source owner or service role for this exact source scope.\n2. Provide a time-valid authorization statement that names only the source scope, service/project boundary, environment, and allowed action.\n3. State whether provider access is needed. Do not paste credentials, credential fragments, raw console output, screenshots containing secrets, or irreversible action results into this repository.\n4. If provider evidence is needed, use the paired provider-evidence request after source-owner authority has been independently verified.\n\n## Acceptance\n\nA future intake must have a UTC timestamp, a redacted evidence reference, a reviewer, an exact domain identifier, and a safe linkage to individual logical items or a validator-approved batch. This request grants no authority and closes no finding.\n`;
}

function providerRequest(domain, reviewedAt) {
  return `# Provider-evidence request — ${domain.authority_domain_id}\n\nStatus: **PENDING_PROVIDER_IDENTIFICATION**. Created at ${reviewedAt}.\n\nNo provider is asserted for this domain. Scanner rule labels and reachability do not prove provider identity, a credential group, account, project, service, or environment.\n\n## Preconditions\n\n- An independently verified authority record for \`${domain.authority_domain_id}\`.\n- A source-owner-confirmed provider/service scope.\n- A nonsecret, item-level safe linkage or a validator-approved batch linkage.\n\n## Requested terminal evidence (only when applicable)\n\nProvide a redacted provider audit/reference that establishes provider identity, scope, action/verification chronology, and result. A source removal, image-only evidence, scanner label, or unlinked external assertion is insufficient. Do not include credential values or credential-derived hashes.\n\n## Current result\n\nProvider credential groups: **0**. This file is a request template only and does not authorize provider access or claim an action occurred.\n`;
}

function readme(domains, total) {
  const rows = domains.map((domain) => `| ${domain.authority_domain_id} | ${domain.source_scope_id} | ${domain.logical_item_count} | ${domain.reachability_buckets.map((entry) => `${entry.bucket}=${entry.logical_item_count}`).join(', ')} |`).join('\n');
  return `# 08A1C-R3 external-evidence intake package\n\nThis package corrects the prior reachability-to-authority conflation. It contains only sanitized repository provenance and external-evidence requests; it contains no credentials, provider-console data, account access, or external mutations.\n\n- Source inventory: \`20260811T214249Z\`; 14,908 observations, 14,849 canonical occurrences, and 14,849 logical items.\n- Path A: one committed deterministic synthetic fixture.\n- Path B: ${total} residual logical items in ${domains.length} source-scope authority domains.\n- Provider credential groups: 0; every Path B provider identity remains \`UNKNOWN\`.\n- Existing 08A1A Apify OWNER_ASSERTED record: preserved as unlinked; it is not reused by this package.\n\n| Authority domain | Exact source scope | Path B logical items | Reachability observations |\n| --- | --- | ---: | --- |\n${rows}\n\nUse \`scripts/verify-08a1c-external-evidence.mjs\` before accepting any future intake.\n`;
}

function buildAuthorityConfig(previousConfig, domains) {
  const preservedActive = (previousConfig.authority_records ?? []).filter((record) => record.status !== 'PENDING_AUTHORITY_EVIDENCE').map((record) => ({ ...record, candidate_source_owner_domain: undefined, authority_domain_id: null, logical_item_ids: [], safe_linkage_status: 'UNLINKED_NO_SAFE_ITEM_LINKAGE' }));
  const pending = domains.map((domain) => ({
    authority_id: `AUTH-PENDING-${domain.authority_domain_id.replace(/^AD-/, '')}`,
    authority_domain_id: domain.authority_domain_id,
    status: 'PENDING_AUTHORITY_EVIDENCE',
    accountable_owner_or_role: 'SOURCE_OWNER_IDENTIFICATION_REQUIRED',
    provider_project_service_scope: 'UNKNOWN — source ownership is not provider proof',
    environment_scope: 'UNKNOWN',
    authority_basis: `No repository evidence identifies an accountable authority for ${domain.source_scope_id}.`,
    sanitized_evidence_reference: 'NO_AUTHORITY_EVIDENCE_RECORDED',
    evidence_level: 'NONE',
    approval_timestamp: null,
    validity_or_review_period: 'Pending source-owner identification, scoped authorization, and independent evidence.',
  }));
  return {
    schema_version: '08A1C-authority-records-v2',
    reviewed_at: previousConfig.reviewed_at,
    evidence_policy: {
      ...(previousConfig.evidence_policy ?? {}),
      owner_asserted_terminal_authority_ids: previousConfig.evidence_policy?.owner_asserted_terminal_authority_ids ?? [],
      unlinked_authority_assertion_ids: preservedActive.filter((record) => record.status === 'ACTIVE_OWNER_ASSERTED').map((record) => record.authority_id),
      policy_note: 'Authority records are keyed to source-scope authority domains. Reachability buckets are not authority domains. An unlinked owner assertion cannot be used for a disposition.',
    },
    authority_records: stable([...preservedActive, ...pending], 'authority_id'),
    disposition_overrides: previousConfig.disposition_overrides ?? [],
  };
}

async function main() {
  const [manifest, repositoryFacts, previousConfig] = await Promise.all([
    readFile(required('--source-manifest'), 'utf8').then(JSON.parse),
    readFile(required('--repository-facts'), 'utf8').then(JSON.parse),
    readFile(required('--previous-authority-records'), 'utf8').then(JSON.parse),
  ]);
  if (manifest.schema_version !== '08A1B-canonical-inventory-v1') throw new Error('Expected 08A1B canonical inventory.');
  if (!isIsoTimestamp(previousConfig.reviewed_at) || repositoryFacts.reviewed_at !== previousConfig.reviewed_at || repositoryFacts.source_manifest_run_id !== manifest.run_id) throw new Error('The sanitized source, fact, and review timestamps do not reconcile.');
  const factIds = new Set(repositoryFacts.repository_facts.map((fact) => fact.logical_item_id));
  if (factIds.size !== 1 || [...factIds][0] !== 'LI-0688064EDD3166F6BF2C') throw new Error('The only permitted Path A fixture did not revalidate exactly.');
  const canonicalById = new Map(manifest.canonical_occurrences.map((item) => [item.canonical_occurrence_id, item]));
  const members = [];
  for (const logical of manifest.logical_items) {
    if (factIds.has(logical.logical_item_id)) continue;
    if (!Array.isArray(logical.canonical_occurrence_ids) || logical.canonical_occurrence_ids.length !== 1) throw new Error(`Logical item ${logical.logical_item_id} lacks one canonical occurrence.`);
    const canonical = canonicalById.get(logical.canonical_occurrence_ids[0]);
    if (!canonical) throw new Error(`Logical item ${logical.logical_item_id} has no canonical occurrence.`);
    const sourceLocation = canonical.canonical_identity.normalized_location;
    const definition = domainForLocation(sourceLocation);
    members.push({
      logical_item_id: logical.logical_item_id,
      canonical_occurrence_id: canonical.canonical_occurrence_id,
      authority_domain_id: definition.authorityDomainId,
      source_scope_id: definition.sourceScopeId,
      source_system_root: definition.sourceSystemRoot,
      source_location: sourceLocation,
      object_marker: canonical.canonical_identity.object_marker,
      reachability: logical.reachability,
      provider_identity_status: 'UNKNOWN',
      provider_credential_group_id: null,
      closure_path: PATH_B,
    });
  }
  const domains = stable(DOMAIN_DEFINITIONS.map((definition) => {
    const domainMembers = stable(members.filter((member) => member.authority_domain_id === definition.authorityDomainId), 'logical_item_id');
    if (domainMembers.length === 0) throw new Error(`Authority domain ${definition.authorityDomainId} has no residual membership.`);
    return {
      authority_domain_id: definition.authorityDomainId,
      status: 'PENDING_SOURCE_OWNER_IDENTIFICATION',
      authority_domain_kind: 'SOURCE_OWNER_INVESTIGATION_SCOPE',
      source_scope_id: definition.sourceScopeId,
      source_system_root: definition.sourceSystemRoot,
      source_scope_basis: 'CANONICAL_NORMALIZED_LOCATION_PROVENANCE',
      source_scope_evidence: 'Sanitized canonical normalized-location provenance only; no CODEOWNERS, provider identity, credential equality, account, project, service, or environment is inferred.',
      accountable_owner_or_role: 'SOURCE_OWNER_IDENTIFICATION_REQUIRED',
      provider_identity_status: 'UNKNOWN',
      provider_credential_group_ids: [],
      environment_scope: 'UNKNOWN',
      logical_item_count: domainMembers.length,
      logical_item_ids: domainMembers.map((member) => member.logical_item_id),
      canonical_occurrence_ids: domainMembers.map((member) => member.canonical_occurrence_id),
      reachability_buckets: Object.entries(countBy(domainMembers, (member) => member.reachability.join('+'))).map(([bucket, logicalItemCount]) => ({ bucket, logical_item_count: logicalItemCount })),
      source_location_counts: countBy(domainMembers, (member) => member.source_location),
      membership_file: `memberships/${definition.authorityDomainId}.sanitized.json`,
      authority_request: `authority-requests/${definition.authorityDomainId}.md`,
      provider_evidence_request: `provider-evidence-requests/${definition.authorityDomainId}.md`,
    };
  }), 'authority_domain_id');
  const outputDirectory = required('--output-directory');
  const authorityDomains = {
    schema_version: '08A1C-authority-domain-decomposition-v1',
    reviewed_at: previousConfig.reviewed_at,
    source_inventory: { run_id: manifest.run_id, observation_count: manifest.observation_count, canonical_occurrence_count: manifest.canonical_occurrence_count, logical_item_count: manifest.logical_item_count },
    decomposition_policy: {
      reachability_is_not_authority_domain: true,
      domain_key: 'exact sanitized source-system/root provenance',
      provider_identity_rule: 'UNKNOWN_UNTIL_SAFE_EXTERNAL_EVIDENCE',
      provider_credential_group_rule: 'NO_GROUP_WITHOUT_SAFE_NONSECRET_LINKAGE',
      path_a_excluded_logical_item_ids: [...factIds],
      preserved_unlinked_authority_record: 'AUTH-APIFY-DEV-JHILAM-BERA-20260811',
    },
    totals: { path_a_repository_fact_logical_items: factIds.size, path_b_residual_logical_items: members.length, authority_domains: domains.length, provider_credential_groups: 0, safe_authority_linkages: 0 },
    authority_domains: domains,
  };
  const reachabilityMap = {
    schema_version: '08A1C-reachability-to-authority-map-v1',
    reviewed_at: previousConfig.reviewed_at,
    source_inventory_run_id: manifest.run_id,
    semantics: 'Each entry maps one Path B logical item to an exact source-scope authority domain. The reachability field is retained as an independent observation dimension and is never used as the authority-domain key.',
    totals: { residual_logical_items: members.length, authority_domains: domains.length, provider_credential_groups: 0, safe_authority_linkages: 0 },
    items: stable(members, 'logical_item_id'),
  };
  const actions = domains.map((domain) => ({
    action_id: `ACTION-${domain.authority_domain_id.replace(/^AD-/, '')}`,
    authority_domain_id: domain.authority_domain_id,
    action_type: 'REQUEST_SOURCE_OWNER_AUTHORITY_AND_PROVIDER_IDENTIFICATION',
    status: 'PENDING_EXTERNAL_EVIDENCE',
    logical_item_count: domain.logical_item_count,
    provider_credential_group_count: 0,
    authority_request: domain.authority_request,
    provider_evidence_request: domain.provider_evidence_request,
    acceptance_validator: 'scripts/verify-08a1c-external-evidence.mjs',
    prohibited_shortcuts: ['scanner_rule_label_as_provider_proof', 'reachability_as_authority', 'unlinked_owner_assertion', 'source_removal_as_terminal_closure', 'credential_or_credential_derived_hash'],
  }));
  const actionManifest = {
    schema_version: '08A1C-external-action-manifest-v1',
    reviewed_at: previousConfig.reviewed_at,
    source_inventory_run_id: manifest.run_id,
    totals: { authority_actions: actions.length, provider_evidence_actions: actions.length, pending_external_evidence_actions: actions.length, imported_authority_evidence: 0, imported_provider_evidence: 0, provider_credential_groups: 0, safe_authority_linkages: 0 },
    actions,
  };
  const intake = { schema_version: '08A1C-external-evidence-intake-v1', reviewed_at: previousConfig.reviewed_at, source_inventory_run_id: manifest.run_id, intake_policy: 'Safe metadata and redacted references only. No credential values, credential-derived hashes, raw console exports, or unreviewed provider assertions.', totals: { authority_records_imported: 0, provider_evidence_records_imported: 0, accepted: 0, rejected: 0, pending: actions.length, provider_credential_groups: 0, safe_authority_linkages: 0 }, records: [] };
  const contract = { schema_version: 'product-shape-contract-v1', goal: 'Correct the 08A1C authority model and generate a safe external-evidence intake package.', context: 'Existing production-readiness evidence repository; canonical scan inventory is immutable.', scope: 'Sanitized local evidence, documentation, deterministic scripts, and validation only.', constraints: ['No .env reads', 'No external provider actions', 'No credentials or credential-derived hashes', 'No commits, pushes, deployments, rotations, revocations, or deletions'], requirements: ['Separate reachability from authority domains', 'Preserve Path A fixture', 'Keep provider identity unknown until safe evidence', 'Generate per-domain action requests'], done_when: 'Domain membership, action manifest, and validators reconcile exactly with the unchanged 08A1B inventory.', product_shape: 'existing_product_change', why_not_simpler: 'A prose correction cannot guarantee per-item source-scope coverage or fail closed on unsafe external intake.', why_not_more_complex: 'No product surface, provider integration, or external mutation is authorized.' };
  await Promise.all([
    writeJson(path.join(outputDirectory, 'authority-domains.sanitized.json'), authorityDomains),
    writeJson(path.join(outputDirectory, 'reachability-to-authority-map.sanitized.json'), reachabilityMap),
    writeJson(path.join(outputDirectory, 'external-action-manifest.sanitized.json'), actionManifest),
    writeJson(path.join(outputDirectory, 'evidence-intake.sanitized.json'), intake),
    writeJson(path.join(outputDirectory, 'workflow-contract.sanitized.json'), contract),
    writeText(path.join(outputDirectory, 'README.md'), readme(domains, members.length)),
    writeText(path.join(outputDirectory, 'validation-summary.md'), `# 08A1C-R3 validation summary\n\nPending external-evidence package generated at ${previousConfig.reviewed_at}.\n\n- Canonical observations: ${manifest.observation_count}\n- Canonical occurrences: ${manifest.canonical_occurrence_count}\n- Logical items: ${manifest.logical_item_count}\n- Path A deterministic fixture: ${factIds.size}\n- Path B residual: ${members.length}\n- Source-scope authority domains: ${domains.length}\n- Provider credential groups: 0\n- Safe authority linkages: 0\n- Imported external evidence: 0\n\nThe package is intentionally **BLOCKED** pending independently verified source-owner and provider evidence.\n`),
  ]);
  await Promise.all(domains.flatMap((domain) => {
    const domainMembers = stable(members.filter((member) => member.authority_domain_id === domain.authority_domain_id), 'logical_item_id');
    return [
      writeJson(path.join(outputDirectory, domain.membership_file), { schema_version: '08A1C-authority-domain-membership-v1', reviewed_at: previousConfig.reviewed_at, source_inventory_run_id: manifest.run_id, authority_domain_id: domain.authority_domain_id, source_scope_id: domain.source_scope_id, provider_credential_groups: [], logical_item_count: domainMembers.length, members: domainMembers }),
      writeText(path.join(outputDirectory, domain.authority_request), authorityRequest(domain, previousConfig.reviewed_at)),
      writeText(path.join(outputDirectory, domain.provider_evidence_request), providerRequest(domain, previousConfig.reviewed_at)),
    ];
  }));
  await writeJson(required('--output-authority-records'), buildAuthorityConfig(previousConfig, domains));
  process.stdout.write(`Built 08A1C-R3 authority decomposition: ${domains.length} source-scope domains and ${members.length} Path B logical items.\n`);
}

main().catch((error) => { process.stderr.write(`08A1C-R3 authority-domain build failed: ${error.message}\n`); process.exitCode = 1; });
