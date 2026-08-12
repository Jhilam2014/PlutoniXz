#!/usr/bin/env node

/** Fail-closed 08A1C closure validator with separate repository and authority paths. */
import { readFile } from 'node:fs/promises';

const TERMINAL_DISPOSITIONS = new Set(['REVOKED', 'ROTATED_OLD_INVALIDATED', 'DELETED_AT_PROVIDER', 'PROVEN_INVALID', 'VERIFIED_FALSE_POSITIVE', 'VERIFIED_SYNTHETIC_FIXTURE']);
const REPOSITORY_TERMINAL_DISPOSITIONS = new Set(['VERIFIED_FALSE_POSITIVE', 'VERIFIED_SYNTHETIC_FIXTURE']);
const PROVIDER_TERMINAL_DISPOSITIONS = new Set(['REVOKED', 'ROTATED_OLD_INVALIDATED', 'DELETED_AT_PROVIDER', 'PROVEN_INVALID']);
const NON_TERMINAL_STATES = new Set(['UNRESOLVED', 'OWNER_ASSIGNMENT_REQUIRED', 'OWNER_ACTION_PENDING', 'PROVIDER_VERIFICATION_PENDING', 'EVIDENCE_INVALID']);
const REPOSITORY_PROOF_FAMILIES = new Set(['STRUCTURAL_NONCREDENTIAL', 'DETERMINISTIC_MASKED_DERIVATIVE', 'DETERMINISTIC_COMMITTED_FIXTURE', 'NONEXECUTABLE_DOCUMENTATION_PROVEN', 'SCANNER_EVIDENCE_DERIVATIVE']);
const CLOSED_STATE = 'CLOSED';
const PATH_A = 'PATH_A_REPOSITORY_FACT';
const PATH_B = 'PATH_B_EXTERNAL_AUTHORITY_OR_PROVIDER';
const AUTHORITY_ACTIVE = new Set(['ACTIVE_OWNER_ASSERTED', 'ACTIVE_REPOSITORY_VERIFIED', 'ACTIVE_PROVIDER_VERIFIED']);
const AUTHORITY_PENDING = 'PENDING_AUTHORITY_EVIDENCE';
const APPROVED_BATCH_LINKAGE = new Set(['DETERMINISTIC_FIXTURE_PROVENANCE', 'SAME_SAFE_PROVIDER_AUDIT_EVENT_AND_EQUALITY_IDENTIFIER']);
const FORBIDDEN_FIELD = /^(?:secret|match|authorization|token_value|credential_value|replacement_value|raw_value)$/i;
const CREDENTIAL_SHAPE = /(?:apify_api|sk-(?:proj-)?|AIza|AKIA|xox[abprs])[_-]?[A-Za-z0-9]{12,}|(?:api[_-]?key|token)\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i;

function fail(message) { throw new Error(message); }
function argument(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) fail(`Missing ${name}`); return value; }
function isIsoTimestamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value); }
function ids(items, key, label) { const values = items.map((item) => item?.[key]); if (values.some((value) => typeof value !== 'string' || value.length === 0) || new Set(values).size !== values.length) fail(`Missing or duplicate ${label}.`); return new Set(values); }
function noSecretBearingData(value) { if (typeof value === 'string') return !CREDENTIAL_SHAPE.test(value); if (Array.isArray(value)) return value.every(noSecretBearingData); return !value || typeof value !== 'object' || Object.entries(value).every(([key, nested]) => !FORBIDDEN_FIELD.test(key) && noSecretBearingData(nested)); }
function equalSets(actual, expected) { return actual.size === expected.size && [...actual].every((value) => expected.has(value)); }
function sortById(items, key) { return [...items].sort((left, right) => left[key].localeCompare(right[key])); }
function countBy(items, valueFor) { return Object.fromEntries([...items.reduce((counts, item) => { const key = valueFor(item); counts.set(key, (counts.get(key) ?? 0) + 1); return counts; }, new Map()).entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))); }

function validateSourceManifest(manifest) {
  if (manifest?.schema_version !== '08A1B-canonical-inventory-v1') fail('08A1C requires the 08A1B canonical inventory schema.');
  if (!noSecretBearingData(manifest) || !Array.isArray(manifest.logical_items) || !Array.isArray(manifest.canonical_occurrences)) fail('08A1B source manifest is unsafe or malformed.');
  if (manifest.logical_item_count !== manifest.logical_items.length || manifest.canonical_occurrence_count !== manifest.canonical_occurrences.length) fail('08A1B source count does not reconcile.');
  const logicalIds = ids(manifest.logical_items, 'logical_item_id', '08A1B logical item ID');
  const canonicalIds = ids(manifest.canonical_occurrences, 'canonical_occurrence_id', '08A1B canonical occurrence ID');
  const mapped = new Set();
  for (const logical of manifest.logical_items) {
    if (logical.status !== 'UNRESOLVED' || logical.disposition !== 'UNKNOWN') fail('08A1C cannot consume a mutated or pre-closed 08A1B inventory.');
    if (!Array.isArray(logical.canonical_occurrence_ids) || logical.canonical_occurrence_ids.length !== 1) fail('08A1B logical item must retain exactly one canonical occurrence without safe credential equality evidence.');
    const canonicalId = logical.canonical_occurrence_ids[0];
    if (!canonicalIds.has(canonicalId) || mapped.has(canonicalId)) fail('08A1B canonical occurrence is missing or multiply linked.');
    mapped.add(canonicalId);
  }
  if (!equalSets(mapped, canonicalIds)) fail('08A1B canonical occurrence mapping is incomplete.');
  return { logicalIds, canonicalIds };
}

function validateAuthorityConfig(config) {
  if (config?.schema_version !== '08A1C-authority-records-v1' || !Array.isArray(config.authority_records)) fail('Unsupported 08A1C authority-record schema.');
  if (!isIsoTimestamp(config.reviewed_at) || !noSecretBearingData(config)) fail('Authority config is unsafe or missing a UTC review timestamp.');
  if (!Array.isArray(config.evidence_policy?.owner_asserted_terminal_authority_ids) || !config.evidence_policy.owner_asserted_terminal_authority_ids.every((value) => typeof value === 'string')) fail('Authority config lacks an explicit owner-asserted terminal-evidence policy.');
  const authorityIds = ids(config.authority_records, 'authority_id', 'authority ID');
  for (const authority of config.authority_records) {
    for (const field of ['authority_id', 'status', 'accountable_owner_or_role', 'provider_project_service_scope', 'environment_scope', 'authority_basis', 'sanitized_evidence_reference', 'validity_or_review_period']) if (typeof authority[field] !== 'string' || authority[field].trim().length === 0) fail(`Authority ${authority.authority_id} is missing ${field}.`);
    if (![...AUTHORITY_ACTIVE, AUTHORITY_PENDING].includes(authority.status)) fail(`Authority ${authority.authority_id} has an unsupported status.`);
    if (AUTHORITY_ACTIVE.has(authority.status)) {
      if (!isIsoTimestamp(authority.approval_timestamp) || authority.approval_timestamp > config.reviewed_at) fail(`Active authority ${authority.authority_id} is missing a valid approval timestamp.`);
      if (!['OWNER_ASSERTED', 'REPOSITORY_VERIFIED', 'PROVIDER_VERIFIED'].includes(authority.evidence_level)) fail(`Active authority ${authority.authority_id} has an unsupported evidence level.`);
      if (!isIsoTimestamp(authority.valid_from) || !isIsoTimestamp(authority.valid_until) || authority.valid_from > authority.approval_timestamp || authority.approval_timestamp > authority.valid_until || config.reviewed_at > authority.valid_until) fail(`Active authority ${authority.authority_id} is expired or has an invalid validity period.`);
      if (!Array.isArray(authority.authorized_providers) || authority.authorized_providers.length === 0 || authority.authorized_providers.some((provider) => typeof provider !== 'string' || provider === 'UNKNOWN')) fail(`Active authority ${authority.authority_id} lacks authorized provider scope.`);
    } else if (authority.approval_timestamp !== null || authority.evidence_level !== 'NONE') fail(`Pending authority ${authority.authority_id} must not claim approval or evidence.`);
  }
  return authorityIds;
}

function validateRepositoryFacts(facts, sourceManifest, authorityConfig) {
  if (facts?.schema_version !== '08A1C-repository-facts-v1' || !Array.isArray(facts.repository_facts) || !facts.totals || !isIsoTimestamp(facts.reviewed_at) || !noSecretBearingData(facts)) fail('Repository-fact evidence is unsafe or malformed.');
  if (facts.source_manifest_run_id !== sourceManifest.run_id || facts.reviewed_at !== authorityConfig.reviewed_at) fail('Repository-fact evidence has different source inventory or review timestamp.');
  if (facts.totals.logical_items_inspected !== sourceManifest.logical_item_count) fail('Repository-fact evidence did not classify every logical item.');
  const classificationTotals = facts.totals.path_classification_totals;
  if (!classificationTotals || Object.keys(classificationTotals).some((key) => ![PATH_A, PATH_B].includes(key)) || (classificationTotals[PATH_A] ?? 0) !== facts.repository_facts.length || (classificationTotals[PATH_B] ?? 0) !== sourceManifest.logical_item_count - facts.repository_facts.length) fail('Repository-fact path classifications do not reconcile.');
  if (facts.totals.repository_terminal_facts !== facts.repository_facts.length || JSON.stringify(facts.totals.proof_family_totals) !== JSON.stringify(countBy(facts.repository_facts, (item) => item.proof_family))) fail('Repository-fact totals do not reconcile.');
  const logicalById = new Map(sourceManifest.logical_items.map((item) => [item.logical_item_id, item]));
  const factIds = ids(facts.repository_facts, 'logical_item_id', 'repository-fact logical item ID');
  const canonicalFactIds = ids(facts.repository_facts, 'canonical_occurrence_id', 'repository-fact canonical occurrence ID');
  for (const fact of facts.repository_facts) {
    const logical = logicalById.get(fact.logical_item_id);
    if (!logical || logical.canonical_occurrence_ids[0] !== fact.canonical_occurrence_id) fail(`Repository fact ${fact.logical_item_id} has invalid canonical membership.`);
    if (fact.closure_path !== PATH_A || !REPOSITORY_TERMINAL_DISPOSITIONS.has(fact.disposition) || !REPOSITORY_PROOF_FAMILIES.has(fact.proof_family)) fail(`Repository fact ${fact.logical_item_id} does not use an allowed Path A terminal disposition.`);
    for (const field of ['reason_code', 'safe_provenance', 'source_version', 'validator_version', 'proof_reference', 'regression_test_reference']) if (typeof fact[field] !== 'string' || fact[field].length < 8) fail(`Repository fact ${fact.logical_item_id} lacks ${field}.`);
    if (fact.proof_family === 'DETERMINISTIC_COMMITTED_FIXTURE' && (typeof fact.generator_proof_reference !== 'string' || fact.generator_proof_reference.length < 8)) fail(`Repository fixture ${fact.logical_item_id} lacks deterministic generator proof.`);
    if (fact.proof_family === 'DETERMINISTIC_MASKED_DERIVATIVE' && (typeof fact.derivative_chain_reference !== 'string' || fact.derivative_chain_reference.length < 8)) fail(`Masked derivative ${fact.logical_item_id} lacks deterministic derivation proof.`);
    if (fact.proof_family === 'NONEXECUTABLE_DOCUMENTATION_PROVEN' && (typeof fact.nonexecution_proof_reference !== 'string' || fact.nonexecution_proof_reference.length < 8)) fail(`Documentation closure ${fact.logical_item_id} lacks non-execution proof.`);
    if (fact.proof_family === 'SCANNER_EVIDENCE_DERIVATIVE' && (typeof fact.derivative_chain_reference !== 'string' || fact.derivative_chain_reference.length < 8)) fail(`Scanner derivative ${fact.logical_item_id} lacks deterministic derivation proof.`);
    if (!isIsoTimestamp(fact.repository_verification_timestamp) || fact.repository_verification_timestamp > authorityConfig.reviewed_at) fail(`Repository fact ${fact.logical_item_id} has an invalid verification timestamp.`);
  }
  return { factIds, canonicalFactIds, byLogicalId: new Map(facts.repository_facts.map((fact) => [fact.logical_item_id, fact])) };
}

function authorityForDomain(authorities, domain) { const matches = authorities.filter((authority) => authority.status === AUTHORITY_PENDING && authority.candidate_source_owner_domain === domain); if (matches.length !== 1) fail(`Expected exactly one pending authority record for ${domain}.`); return matches[0]; }
function normalizeOverrideMembers(override) {
  const members = Array.isArray(override.logical_item_ids) ? override.logical_item_ids : override.logical_item_id ? [override.logical_item_id] : [];
  if (members.length === 0 || new Set(members).size !== members.length) fail('A disposition override must explicitly list unique logical item IDs.');
  if (members.length > 1) {
    if (typeof override.batch_id !== 'string' || !APPROVED_BATCH_LINKAGE.has(override.batch_linkage_basis) || typeof override.common_safe_linkage_identifier !== 'string' || override.common_safe_linkage_identifier.length < 8) fail('A multi-item disposition override lacks explicit, strong batch linkage.');
  } else if (override.batch_id || override.batch_linkage_basis || override.common_safe_linkage_identifier) fail('Single-item disposition override cannot claim batch linkage.');
  return members;
}

export function buildResolution(sourceManifest, authorityConfig, repositoryFacts) {
  validateSourceManifest(sourceManifest); validateAuthorityConfig(authorityConfig);
  const facts = validateRepositoryFacts(repositoryFacts, sourceManifest, authorityConfig);
  const canonicalById = new Map(sourceManifest.canonical_occurrences.map((item) => [item.canonical_occurrence_id, item]));
  const overridesById = new Map();
  for (const override of authorityConfig.disposition_overrides ?? []) for (const logicalItemId of normalizeOverrideMembers(override)) { if (overridesById.has(logicalItemId) || facts.byLogicalId.has(logicalItemId)) fail(`Logical item ${logicalItemId} appears in more than one closure input.`); overridesById.set(logicalItemId, override); }
  const dispositions = sortById(sourceManifest.logical_items, 'logical_item_id').map((logical) => {
    const canonical = canonicalById.get(logical.canonical_occurrence_ids[0]);
    const baseline = {
      logical_item_id: logical.logical_item_id, canonical_occurrence_ids: logical.canonical_occurrence_ids,
      safe_identity_or_provenance_basis: `Canonical occurrence ${canonical.canonical_occurrence_id}; scanner-native location/provenance metadata only; no credential-value equality identifier.`,
      closure_path: PATH_B, verified_provider: 'UNKNOWN', provider_identity_basis: 'SCANNER_RULE_LABEL_NOT_PROVIDER_PROOF',
      authority_id: authorityForDomain(authorityConfig.authority_records, logical.candidate_source_owner_domain).authority_id, accountable_owner: 'UNASSIGNED', environment_scope: 'UNKNOWN',
      reachability: logical.reachability, current_tree_remediation_status: logical.current_tree_remediation_status, reachable_history_status: logical.reachable_history_status,
      disposition: 'UNKNOWN', review_state: 'OWNER_ASSIGNMENT_REQUIRED', action_timestamp: null, independent_verification_timestamp: null,
      sanitized_evidence_reference: null, evidence_level: 'NONE', evidence_source: 'NONE', safe_authority_linkage_basis: null,
      repository_proof_family: null, repository_reason_code: null, repository_safe_provenance: null, repository_source_version: null, repository_validator_version: null, deterministic_proof_reference: null, regression_test_reference: null, repository_verification_timestamp: null,
      validator_version: '08A1C-owner-disposition-validator-v2', review_timestamp: authorityConfig.reviewed_at,
      pending_reason: 'No repository evidence establishes an accountable authority, provider identity, validity, or terminal disposition for this logical item.', batch_id: null, batch_linkage_basis: null, common_safe_linkage_identifier: null,
    };
    const fact = facts.byLogicalId.get(logical.logical_item_id);
    if (fact) return {
      ...baseline, closure_path: PATH_A, authority_id: null, accountable_owner: 'NOT_APPLICABLE_REPOSITORY_FACT', environment_scope: 'NOT_APPLICABLE_REPOSITORY_FACT', verified_provider: 'UNKNOWN', provider_identity_basis: 'NOT_APPLICABLE_REPOSITORY_FACT',
      disposition: fact.disposition, review_state: CLOSED_STATE, evidence_level: 'REPOSITORY_VERIFIED', evidence_source: 'REPOSITORY_FACT_DISCOVERY', sanitized_evidence_reference: fact.proof_reference,
      repository_proof_family: fact.proof_family, repository_reason_code: fact.reason_code, repository_safe_provenance: fact.safe_provenance, repository_source_version: fact.source_version, repository_validator_version: fact.validator_version,
      deterministic_proof_reference: fact.proof_reference, regression_test_reference: fact.regression_test_reference, repository_verification_timestamp: fact.repository_verification_timestamp,
      current_tree_remediation_status: 'REPOSITORY_FACT_PROVEN_NONCREDENTIAL', reachable_history_status: 'NOT_PRESENT_IN_HISTORY_SCOPE', pending_reason: null,
    };
    const override = overridesById.get(logical.logical_item_id);
    if (!override) return baseline;
    const { logical_item_id, logical_item_ids, ...fields } = override;
    return { ...baseline, ...fields, closure_path: PATH_B, logical_item_id: logical.logical_item_id, canonical_occurrence_ids: logical.canonical_occurrence_ids, review_timestamp: authorityConfig.reviewed_at };
  });
  if (overridesById.size !== (authorityConfig.disposition_overrides ?? []).reduce((total, override) => total + normalizeOverrideMembers(override).length, 0)) fail('Disposition override members do not reconcile.');
  const expandedAuthorities = sortById(authorityConfig.authority_records, 'authority_id').map((authority) => ({ ...authority, logical_item_ids: dispositions.filter((item) => item.authority_id === authority.authority_id).map((item) => item.logical_item_id) }));
  const resolution = { schema_version: '08A1C-owner-resolution-v2', source_inventory: { schema_version: sourceManifest.schema_version, run_id: sourceManifest.run_id, observation_count: sourceManifest.observation_count, canonical_occurrence_count: sourceManifest.canonical_occurrence_count, logical_item_count: sourceManifest.logical_item_count }, repository_fact_evidence: { schema_version: repositoryFacts.schema_version, validator_version: repositoryFacts.validator_version, repository_terminal_facts: repositoryFacts.repository_facts.length }, reviewed_at: authorityConfig.reviewed_at, authority_records: expandedAuthorities, dispositions };
  resolution.counts = resolutionCounts(resolution); resolution.outcome = resolution.counts.non_terminal_primary_total === 0 ? 'PASS' : 'BLOCKED';
  return resolution;
}

export function resolutionCounts(resolution) {
  const terminal = Object.fromEntries([...TERMINAL_DISPOSITIONS].sort().map((disposition) => [disposition, 0]));
  const nonTerminalStates = Object.fromEntries([...NON_TERMINAL_STATES].sort().map((state) => [state, 0]));
  const providerStates = { UNKNOWN: 0, VERIFIED: 0 };
  for (const item of resolution.dispositions ?? []) { if (TERMINAL_DISPOSITIONS.has(item.disposition)) terminal[item.disposition] += 1; if (NON_TERMINAL_STATES.has(item.review_state)) nonTerminalStates[item.review_state] += 1; providerStates[item.verified_provider === 'UNKNOWN' ? 'UNKNOWN' : 'VERIFIED'] += 1; }
  return { terminal_dispositions: terminal, non_terminal_primary_states: nonTerminalStates, non_terminal_primary_total: Object.values(nonTerminalStates).reduce((sum, value) => sum + value, 0), provider_identity_states: providerStates, closure_path_totals: countBy(resolution.dispositions ?? [], (item) => item.closure_path ?? 'MISSING'), authority_disposition_totals: countBy(resolution.dispositions ?? [], (item) => item.authority_id ?? 'NOT_APPLICABLE_REPOSITORY_FACT'), repository_fact_proof_family_totals: countBy((resolution.dispositions ?? []).filter((item) => item.closure_path === PATH_A), (item) => item.repository_proof_family), hidden_non_terminal_state_count: 0 };
}

function validateRepositoryTerminal(item, fact, reviewedAt) {
  if (!fact || item.authority_id !== null || item.accountable_owner !== 'NOT_APPLICABLE_REPOSITORY_FACT' || item.verified_provider !== 'UNKNOWN' || item.provider_identity_basis !== 'NOT_APPLICABLE_REPOSITORY_FACT') fail(`Repository closure ${item.logical_item_id} incorrectly requires or asserts authority/provider identity.`);
  if (!REPOSITORY_TERMINAL_DISPOSITIONS.has(item.disposition) || item.evidence_level !== 'REPOSITORY_VERIFIED' || item.evidence_source !== 'REPOSITORY_FACT_DISCOVERY') fail(`Repository closure ${item.logical_item_id} lacks Path A repository evidence.`);
  for (const [resolutionField, factField] of [['disposition', 'disposition'], ['repository_proof_family', 'proof_family'], ['repository_reason_code', 'reason_code'], ['repository_safe_provenance', 'safe_provenance'], ['repository_source_version', 'source_version'], ['repository_validator_version', 'validator_version'], ['deterministic_proof_reference', 'proof_reference'], ['regression_test_reference', 'regression_test_reference'], ['repository_verification_timestamp', 'repository_verification_timestamp']]) if (item[resolutionField] !== fact[factField]) fail(`Repository closure ${item.logical_item_id} does not match its deterministic fact record.`);
  if (!REPOSITORY_PROOF_FAMILIES.has(item.repository_proof_family) || !isIsoTimestamp(item.repository_verification_timestamp) || item.repository_verification_timestamp > reviewedAt) fail(`Repository closure ${item.logical_item_id} has invalid Path A proof metadata.`);
}

function validateProviderTerminal(item, authority, reviewedAt) {
  if (!authority || !AUTHORITY_ACTIVE.has(authority.status) || item.verified_provider === 'UNKNOWN' || item.provider_identity_basis === 'SCANNER_RULE_LABEL_NOT_PROVIDER_PROOF') fail(`Provider-action disposition ${item.logical_item_id} lacks active authority or verified provider identity.`);
  if (!authority.authorized_providers.includes(item.verified_provider) || typeof item.safe_authority_linkage_basis !== 'string' || item.safe_authority_linkage_basis.length < 8 || /scanner[_ -]?(?:rule|label)|fingerprint/i.test(item.safe_authority_linkage_basis)) fail(`Provider-action disposition ${item.logical_item_id} lacks safe provider/authority linkage.`);
  if (authority.environment_scope !== item.environment_scope || typeof item.accountable_owner !== 'string' || item.accountable_owner === 'UNASSIGNED') fail(`Provider-action disposition ${item.logical_item_id} exceeds its authority scope.`);
  if (item.evidence_level !== 'PROVIDER_VERIFIED' || typeof item.sanitized_evidence_reference !== 'string' || item.sanitized_evidence_reference.length === 0 || item.evidence_source === 'IMAGE_ONLY' || item.evidence_source === 'UNSUPPORTED_TEXT_COMPANION') fail(`Provider-action disposition ${item.logical_item_id} lacks independently verifiable provider evidence.`);
  if (!isIsoTimestamp(item.action_timestamp) || !isIsoTimestamp(item.independent_verification_timestamp) || item.action_timestamp > item.independent_verification_timestamp || item.independent_verification_timestamp > reviewedAt) fail(`Provider-action disposition ${item.logical_item_id} has invalid action/verification chronology.`);
  if (item.current_tree_remediation_status === 'REMOVED_FROM_CURRENT_TREE_ONLY' || (item.reachability.includes('REACHABLE_HISTORY') && item.reachable_history_status === 'REMOVED_FROM_CURRENT_TREE_ONLY')) fail(`Provider-action disposition ${item.logical_item_id} treats source removal as terminal closure.`);
  if (item.disposition === 'ROTATED_OLD_INVALIDATED' && item.old_credential_invalidated !== true) fail(`Rotation disposition ${item.logical_item_id} lacks independent old-credential invalidation.`);
}

export function validateResolution(sourceManifest, authorityConfig, repositoryFacts, resolution, { requireClosure = false } = {}) {
  const { logicalIds, canonicalIds } = validateSourceManifest(sourceManifest); validateAuthorityConfig(authorityConfig);
  const facts = validateRepositoryFacts(repositoryFacts, sourceManifest, authorityConfig);
  if (resolution?.schema_version !== '08A1C-owner-resolution-v2' || !isIsoTimestamp(resolution.reviewed_at) || !Array.isArray(resolution.dispositions) || !Array.isArray(resolution.authority_records) || !noSecretBearingData(resolution)) fail('Malformed or unsafe 08A1C resolution.');
  if (resolution.reviewed_at !== authorityConfig.reviewed_at) fail('Resolution review timestamp does not match authority config.');
  const resolutionIds = ids(resolution.dispositions, 'logical_item_id', '08A1C disposition logical item ID'); if (!equalSets(resolutionIds, logicalIds)) fail('08A1C dispositions do not cover each logical item exactly once.');
  const sourceLogicalById = new Map(sourceManifest.logical_items.map((item) => [item.logical_item_id, item])); const sourceCanonicalById = new Map(sourceManifest.canonical_occurrences.map((item) => [item.canonical_occurrence_id, item]));
  const authorityById = new Map(resolution.authority_records.map((item) => [item.authority_id, item])); if (authorityById.size !== resolution.authority_records.length) fail('Resolution authority records are duplicated.');
  const closedByEvidence = new Map(); const batchMembers = new Map(); let hiddenStates = 0; const consumedFacts = new Set();
  for (const item of resolution.dispositions) {
    const sourceLogical = sourceLogicalById.get(item.logical_item_id); if (!sourceLogical || JSON.stringify(item.canonical_occurrence_ids) !== JSON.stringify(sourceLogical.canonical_occurrence_ids) || item.canonical_occurrence_ids.some((id) => !canonicalIds.has(id))) fail(`08A1C disposition ${item.logical_item_id} does not preserve canonical linkage.`);
    const canonical = sourceCanonicalById.get(item.canonical_occurrence_ids[0]); if (!item.safe_identity_or_provenance_basis?.includes(canonical.canonical_occurrence_id) || !item.safe_identity_or_provenance_basis.includes('no credential-value equality identifier')) fail(`08A1C disposition ${item.logical_item_id} has unsupported safe identity semantics.`);
    if (item.review_timestamp !== resolution.reviewed_at || item.validator_version !== '08A1C-owner-disposition-validator-v2') fail(`08A1C disposition ${item.logical_item_id} lacks validator traceability.`);
    const terminal = TERMINAL_DISPOSITIONS.has(item.disposition);
    if (terminal) {
      if (item.review_state !== CLOSED_STATE) fail(`Terminal disposition ${item.logical_item_id} is not closed.`);
      if (item.closure_path === PATH_A) { validateRepositoryTerminal(item, facts.byLogicalId.get(item.logical_item_id), resolution.reviewed_at); consumedFacts.add(item.logical_item_id); }
      else if (item.closure_path === PATH_B && PROVIDER_TERMINAL_DISPOSITIONS.has(item.disposition)) validateProviderTerminal(item, authorityById.get(item.authority_id), resolution.reviewed_at);
      else fail(`Terminal disposition ${item.logical_item_id} uses an invalid closure path.`);
      const earlierEvidenceUse = closedByEvidence.get(item.sanitized_evidence_reference); if (earlierEvidenceUse && (item.batch_id === null || earlierEvidenceUse.batchId !== item.batch_id)) fail(`Evidence reference is reused across unrelated closed items: ${item.sanitized_evidence_reference}.`); closedByEvidence.set(item.sanitized_evidence_reference, { batchId: item.batch_id });
    } else {
      const authority = authorityById.get(item.authority_id); if (item.closure_path !== PATH_B || item.disposition !== 'UNKNOWN' || !NON_TERMINAL_STATES.has(item.review_state) || !authority) fail(`Unsupported non-terminal state for ${item.logical_item_id}.`);
      if (item.review_state === 'OWNER_ASSIGNMENT_REQUIRED' && authority.status !== AUTHORITY_PENDING) fail(`Owner-assignment pending item ${item.logical_item_id} references a non-pending authority.`);
      if (item.review_state === 'PROVIDER_VERIFICATION_PENDING' && item.verified_provider === 'UNKNOWN') fail(`Provider-verification pending item ${item.logical_item_id} lacks an identified provider.`);
    }
    if (!terminal && !NON_TERMINAL_STATES.has(item.review_state)) hiddenStates += 1;
    if (item.batch_id !== null) { if (!APPROVED_BATCH_LINKAGE.has(item.batch_linkage_basis) || typeof item.common_safe_linkage_identifier !== 'string' || item.common_safe_linkage_identifier.length < 8) fail(`Batch member ${item.logical_item_id} lacks strong linkage.`); const members = batchMembers.get(item.batch_id) ?? []; members.push(item); batchMembers.set(item.batch_id, members); }
  }
  if (!equalSets(consumedFacts, facts.factIds)) fail('Repository facts are orphaned or projected more than once.');
  for (const [batchId, members] of batchMembers) if (members.length < 2 || new Set(members.map((item) => item.common_safe_linkage_identifier)).size !== 1 || new Set(members.map((item) => item.sanitized_evidence_reference)).size !== 1) fail(`Batch ${batchId} has incomplete or divergent linkage.`);
  const expandedAuthorityMembers = new Map(resolution.authority_records.map((authority) => [authority.authority_id, new Set(authority.logical_item_ids ?? [])]));
  for (const authority of resolution.authority_records) if (authority.status === AUTHORITY_PENDING && authority.logical_item_ids?.some((item) => !logicalIds.has(item))) fail(`Authority ${authority.authority_id} has malformed logical-item coverage.`);
  for (const item of resolution.dispositions.filter((item) => item.authority_id !== null)) if (!expandedAuthorityMembers.get(item.authority_id)?.has(item.logical_item_id)) fail(`Authority coverage omits ${item.logical_item_id}.`);
  const actualCounts = resolutionCounts(resolution); actualCounts.hidden_non_terminal_state_count = hiddenStates; if (JSON.stringify(actualCounts) !== JSON.stringify(resolution.counts)) fail('08A1C resolution counts do not reconcile.');
  if (hiddenStates !== 0) fail('08A1C contains hidden non-terminal states.'); if (requireClosure && actualCounts.non_terminal_primary_total !== 0) fail('08A1C closure is incomplete.'); return actualCounts;
}

async function main() {
  const [sourceManifest, authorityConfig, repositoryFacts, resolution] = await Promise.all([readFile(required('--source-manifest'), 'utf8').then(JSON.parse), readFile(required('--authority-records'), 'utf8').then(JSON.parse), readFile(required('--repository-facts'), 'utf8').then(JSON.parse), readFile(required('--resolution'), 'utf8').then(JSON.parse)]);
  const counts = validateResolution(sourceManifest, authorityConfig, repositoryFacts, resolution, { requireClosure: process.argv.includes('--require-closure') });
  process.stdout.write(`Validated 08A1C resolution: ${resolution.dispositions.length} logical items, ${counts.non_terminal_primary_total} non-terminal primary states.\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) main().catch((error) => { process.stderr.write(`08A1C owner/disposition validation failed: ${error.message}\n`); process.exitCode = 1; });
