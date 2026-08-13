import { createHash } from 'node:crypto';

export const R4_SCHEMA = '08A1C-R4-reconstructed-disposition-v1';
export const R4_ACTION_SCHEMA = '08A1C-R4-final-external-action-package-v1';
export const R4_BRIDGE_SCHEMA = '08A1C-R4-supersession-bridge-v1';
export const R4_REVIEWED_AT = '2026-08-13T00:00:00Z';

const R2_SCHEMA = '08A1B-R2-logical-credential-inventory-v1';
const PATH_A_CLASSIFICATION = 'VERIFIED_SYNTHETIC_FIXTURE';
const PATH_B_CLASSIFICATION = 'PLAUSIBLE_CREDENTIAL';
const PATH_A_STATE = 'VERIFIED_SYNTHETIC_FIXTURE';
const PATH_B_PENDING = 'PENDING_EXTERNAL_EVIDENCE';
const PATH_B_TERMINAL = new Set(['REVOKED', 'ROTATED_OLD_INVALIDATED', 'DELETED_AT_PROVIDER', 'PROVEN_INVALID']);
const REQUIRED_PREDICATES = [
  'CURRENT_SCOPED_AUTHORITY',
  'VERIFIED_PROVIDER_PROJECT_ACCOUNT_ENVIRONMENT_SCOPE',
  'SAFE_EXACT_R2_LOGICAL_ITEM_LINKAGE',
  'TERMINAL_PROVIDER_RESULT',
  'AUTHORIZED_ACTOR_OR_ROLE_WITH_TIMEZONE_TIMESTAMP',
  'INDEPENDENT_VERIFICATION_WITH_VALID_CHRONOLOGY',
  'POLICY_ACCEPTED_SANITIZED_EVIDENCE_REFERENCE',
  'CURRENT_TREE_AND_REACHABLE_HISTORY_REMEDIATION',
  'REPLACEMENT_HEALTH_EVIDENCE_WHEN_REQUIRED',
];
const FORBIDDEN_FIELD = /^(?:secret|match|authorization|token_value|credential_value|replacement_value|raw_value|candidate_tag|equality_tag)$/i;
const CREDENTIAL_SHAPE = /(?:apify_api|sk-(?:proj-)?|AIza|AKIA|xox[abprs])[_-]?[A-Za-z0-9]{12,}|(?:api[_-]?key|token)\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function fail(message) { throw new Error(message); }
function stable(items, key) { return [...items].sort((left, right) => String(left[key]).localeCompare(String(right[key]))); }
function asSet(values) { return new Set(values); }
function equalSets(left, right) { return left.size === right.size && [...left].every((value) => right.has(value)); }
function countBy(items, key) {
  return Object.fromEntries([...items.reduce((counts, item) => {
    const value = typeof key === 'function' ? key(item) : item[key];
    counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  }, new Map()).entries()].sort(([a], [b]) => String(a).localeCompare(String(b))));
}
function noSecretBearingData(value) {
  if (typeof value === 'string') return !CREDENTIAL_SHAPE.test(value);
  if (Array.isArray(value)) return value.every(noSecretBearingData);
  return !value || typeof value !== 'object' || Object.entries(value).every(([key, nested]) => !FORBIDDEN_FIELD.test(key) && noSecretBearingData(nested));
}
function requireIso(value, label) { if (typeof value !== 'string' || !ISO.test(value) || !Number.isFinite(Date.parse(value))) fail(`${label} must be an ISO UTC timestamp.`); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

export function validateR2Inventory(inventory) {
  if (inventory?.schema_version !== R2_SCHEMA || !Array.isArray(inventory.logical_items) || !Array.isArray(inventory.candidate_equivalence_classes) || !Array.isArray(inventory.canonical_occurrences)) fail('08A1C-R4 requires the current 08A1B-R2 inventory schema.');
  if (!noSecretBearingData(inventory)) fail('08A1B-R2 inventory contains prohibited secret-bearing data.');
  const totals = inventory.totals ?? {};
  if (totals.candidate_equivalence_classes !== inventory.candidate_equivalence_classes.length || totals.candidate_equivalence_classes !== inventory.logical_items.length || totals.canonical_occurrences !== inventory.canonical_occurrences.length) fail('08A1B-R2 inventory totals do not reconcile.');
  if (totals.unreconstructed_candidates !== 0 || totals.scanner_output_recursion !== 0) fail('08A1B-R2 prerequisite contains unresolved or recursive scan evidence.');
  const logicalIds = inventory.logical_items.map((item) => item.logical_item_id);
  const classIds = inventory.candidate_equivalence_classes.map((item) => item.candidate_equivalence_class_id);
  const canonicalIds = inventory.canonical_occurrences.map((item) => item.canonical_occurrence_id);
  if (new Set(logicalIds).size !== logicalIds.length || new Set(classIds).size !== classIds.length || new Set(canonicalIds).size !== canonicalIds.length) fail('08A1B-R2 inventory contains duplicate identifiers.');
  const canonicalSet = asSet(canonicalIds);
  const classById = new Map(inventory.candidate_equivalence_classes.map((item) => [item.candidate_equivalence_class_id, item]));
  const seenCanonical = new Set();
  for (const logical of inventory.logical_items) {
    const group = classById.get(logical.candidate_equivalence_class_id);
    if (!group || group.logical_item_id !== logical.logical_item_id || !Array.isArray(logical.canonical_occurrence_ids) || logical.canonical_occurrence_ids.length === 0 || !equalSets(asSet(logical.canonical_occurrence_ids), asSet(group.canonical_occurrence_ids))) fail('08A1B-R2 logical/class membership is incomplete or stale.');
    for (const canonicalId of logical.canonical_occurrence_ids) {
      if (!canonicalSet.has(canonicalId) || seenCanonical.has(canonicalId)) fail('08A1B-R2 canonical membership is missing or multiply assigned.');
      seenCanonical.add(canonicalId);
    }
    if (![PATH_A_CLASSIFICATION, PATH_B_CLASSIFICATION].includes(logical.classification)) fail('08A1B-R2 contains an unsupported logical classification.');
  }
  if (!equalSets(seenCanonical, canonicalSet)) fail('08A1B-R2 did not assign every canonical occurrence.');
  const pathA = inventory.logical_items.filter((item) => item.classification === PATH_A_CLASSIFICATION);
  const pathB = inventory.logical_items.filter((item) => item.classification === PATH_B_CLASSIFICATION);
  if (pathA.length !== totals.deterministic_noncredential_logical_items || pathB.length !== totals.plausible_credential_logical_items || pathA.length + pathB.length !== logicalIds.length) fail('08A1B-R2 classification totals do not reconcile.');
  for (const item of pathA) if (item.status !== 'PATH_A_CLOSED' || item.disposition !== PATH_A_STATE || item.proof_family !== 'DETERMINISTIC_COMMITTED_FIXTURE' || !item.deterministic_noncredential_proof_id) fail('08A1B-R2 Path A proof is not current.');
  for (const item of pathB) if (item.status !== 'PENDING_08A1C_ELIGIBILITY' || item.disposition !== 'UNKNOWN' || item.proof_family !== null) fail('08A1B-R2 plausible item was mutated before 08A1C.');
  return { logicalIds: asSet(logicalIds), canonicalIds: canonicalSet, classById, pathA, pathB };
}

function reachabilityDistribution(logical, canonicalById) {
  const counts = new Map();
  for (const canonicalId of logical.canonical_occurrence_ids) for (const reachability of canonicalById.get(canonicalId).reachability ?? []) counts.set(reachability, (counts.get(reachability) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function membership(logical, classById, canonicalById) {
  const group = classById.get(logical.candidate_equivalence_class_id);
  return {
    logical_item_id: logical.logical_item_id,
    candidate_equivalence_class_id: logical.candidate_equivalence_class_id,
    canonical_occurrence_ids: [...logical.canonical_occurrence_ids].sort(),
    canonical_occurrence_count: logical.canonical_occurrence_ids.length,
    provenance_distribution: group.provenance_distribution,
    reachability_distribution: reachabilityDistribution(logical, canonicalById),
    equality_basis: logical.grouping_basis,
    equality_validator_version: logical.grouping_validator_version,
  };
}

function pathARecord(logical, classById, canonicalById) {
  return {
    ...membership(logical, classById, canonicalById),
    closure_path: 'PATH_A_DETERMINISTIC_REPOSITORY_PROOF',
    primary_state: PATH_A_STATE,
    terminal: true,
    proof_family: logical.proof_family,
    deterministic_noncredential_proof_id: logical.deterministic_noncredential_proof_id,
    proof_reference: '08A1B-R2 deterministic fixture source contract',
    validator_reference: 'scripts/verify-08a1b-r2-reconstruction.mjs',
    positive_regression_reference: 'scripts/test-08a1b-r2-reconstruction.mjs deterministic fixture acceptance',
    negative_regression_reference: 'scripts/test-08a1b-r2-reconstruction.mjs fixture/provenance rejection coverage',
    authority_state: 'NOT_APPLICABLE_PATH_A',
    provider_identity_state: 'UNVERIFIED_NOT_REQUIRED_PATH_A',
    terminal_evidence_state: 'REPOSITORY_PROVEN',
    reverse_lineage: 'R2 logical item -> deterministic proof -> R4 Path A terminal disposition',
  };
}

function pathBRecord(logical, classById, canonicalById) {
  return {
    ...membership(logical, classById, canonicalById),
    closure_path: 'PATH_B_EXTERNAL_AUTHORITY_AND_PROVIDER_EVIDENCE',
    primary_state: PATH_B_PENDING,
    terminal: false,
    suspected_provider: 'UNKNOWN',
    accountable_role: 'SOURCE_OWNER_IDENTIFICATION_REQUIRED',
    authority_state: 'PENDING_CURRENT_SCOPED_AUTHORITY',
    provider_identity_state: 'UNKNOWN',
    provider_linkage_state: 'PENDING_SAFE_EXACT_R2_LINKAGE',
    terminal_evidence_state: 'PENDING_PROVIDER_TERMINAL_RESULT_AND_CHRONOLOGY',
    existing_evidence_references: [],
    missing_predicates: REQUIRED_PREDICATES,
    reverse_lineage: 'R2 logical item -> R4 Path B pending disposition -> exact one bounded evidence request',
  };
}

function actionFor(record) {
  return {
    action_id: `R4-ACTION-${record.logical_item_id}`,
    logical_item_ids: [record.logical_item_id],
    candidate_equivalence_class_id: record.candidate_equivalence_class_id,
    canonical_occurrence_ids: record.canonical_occurrence_ids,
    request_scope: 'EXACT_R2_LOGICAL_ITEM_ONLY',
    request_status: PATH_B_PENDING,
    responsible_role: 'SOURCE_OWNER_IDENTIFICATION_REQUIRED',
    suspected_provider: 'UNKNOWN',
    safe_repository_facts: {
      provenance_distribution: record.provenance_distribution,
      reachability_distribution: record.reachability_distribution,
      equality_basis: record.equality_basis,
    },
    required_evidence: REQUIRED_PREDICATES,
    acceptance_validator: 'scripts/verify-08a1c-r4-reconstruction.mjs',
    acceptance_criteria: [
      'Exact R2 logical-item and canonical-occurrence linkage only.',
      'Current scoped authority and verified provider scope are both recorded.',
      'Provider terminal result, actor/role, and timezone timestamps pass independent chronology validation.',
      'Current-tree and reachable-history remediation are recorded without treating removal as invalidation proof.',
      'Evidence contains no candidate value, fragment, credential-derived tag, or reversible encoding.',
    ],
    prohibited_shortcuts: ['source_domain_grouping', 'reachability_grouping', 'provider_guess', 'scanner_rule_as_provider_identity', 'owner_assertion_as_provider_verification', 'current_tree_removal_as_terminal_proof', 'credential_or_credential_derived_hash'],
  };
}

export function buildR4({ inventory, inventoryText, legacy }) {
  const validated = validateR2Inventory(inventory);
  if (!inventoryText || typeof inventoryText !== 'string') fail('R4 generation requires the exact R2 inventory bytes for its content checksum.');
  for (const key of ['legacy_path_a_dispositions', 'legacy_path_b_dispositions', 'legacy_r3_actions', 'legacy_authority_records']) if (!Number.isInteger(legacy?.[key]) || legacy[key] < 0) fail(`Missing safe legacy supersession count ${key}.`);
  const canonicalById = new Map(inventory.canonical_occurrences.map((item) => [item.canonical_occurrence_id, item]));
  const pathA = stable(validated.pathA.map((item) => pathARecord(item, validated.classById, canonicalById)), 'logical_item_id');
  const pathB = stable(validated.pathB.map((item) => pathBRecord(item, validated.classById, canonicalById)), 'logical_item_id');
  const source = {
    schema_version: inventory.schema_version,
    run_id: inventory.run_id,
    reviewed_at: inventory.reviewed_at,
    content_checksum_sha256: sha256(inventoryText),
    reconstruction_version: inventory.reconstruction?.version,
    equality_method: inventory.reconstruction?.candidate_equality,
    validator_reference: 'scripts/verify-08a1b-r2-reconstruction.mjs',
  };
  const resolution = {
    schema_version: R4_SCHEMA,
    reviewed_at: R4_REVIEWED_AT,
    source_inventory: source,
    policy: {
      source_membership: 'R2_MEMORY_ONLY_EXACT_CANDIDATE_EQUIVALENCE_CLASS',
      default_path_b_grouping: 'ONE_R2_LOGICAL_ITEM_PER_REQUEST',
      provider_identity: 'UNKNOWN_UNTIL_EXACT_SAFE_EVIDENCE',
      reachability_or_source_domain_is_not_authority: true,
      external_actions_performed: false,
      legacy_r3_memberships: 'SUPERSEDED_AUDIT_HISTORY_ONLY',
    },
    dispositions: stable([...pathA, ...pathB], 'logical_item_id'),
    accepted_authority_records: [],
    accepted_provider_evidence_records: [],
    apify_08a1a_record: {
      status: 'VALID_08A1A_UNLINKED_NO_EXACT_R2_LINKAGE',
      evidence_level: 'OWNER_ASSERTED',
      linkage_state: 'NOT_APPLIED_TO_ANY_R2_LOGICAL_ITEM',
      reason: 'The retained 08A1A record has no validated exact R2 logical-item, alias, project, account, or environment linkage.',
      validator_reference: 'scripts/verify-08a1a-owner-evidence.mjs',
    },
    totals: {
      scan_observations: inventory.totals.scan_observations,
      canonical_occurrences: inventory.totals.canonical_occurrences,
      candidate_equivalence_classes: inventory.totals.candidate_equivalence_classes,
      logical_items: inventory.logical_items.length,
      path_a_terminal_by_proof_family: countBy(pathA, 'proof_family'),
      path_a_terminal_total: pathA.length,
      plausible_credential_total: pathB.length,
      terminal_primary_total: pathA.length,
      non_terminal_primary_by_state: { [PATH_B_PENDING]: pathB.length },
      non_terminal_primary_total: pathB.length,
      authority_records: { accepted: 0, rejected: legacy.legacy_authority_records, pending: pathB.length },
      provider_evidence_records: { accepted: 0, rejected: legacy.legacy_r3_actions, pending: pathB.length },
      apify_evidence_records: { valid_unlinked: 1, applied: 0 },
    },
  };
  const actions = stable(pathB.map(actionFor), 'action_id');
  const actionPackage = {
    schema_version: R4_ACTION_SCHEMA,
    reviewed_at: R4_REVIEWED_AT,
    source_inventory: source,
    package_status: 'PENDING_EXTERNAL_EVIDENCE',
    grouping_policy: 'ONE_EXACT_R2_LOGICAL_ITEM_PER_ACTION_UNLESS_A_FUTURE_VALIDATOR_ACCEPTS_STRONG_EXPLICIT_PROVIDER_LINKAGE',
    accepted_records: [],
    rejected_records: [],
    pending_actions: actions,
    totals: { pending_actions: actions.length, accepted_records: 0, rejected_legacy_records: legacy.legacy_r3_actions, provider_credential_groups: 0, action_amplification: 0 },
  };
  const bridgeRecords = [
    ...Array.from({ length: legacy.legacy_path_b_dispositions }, (_, index) => ({ legacy_record_type: 'V1_PATH_B_LOGICAL_DISPOSITION', legacy_record_ordinal: index + 1, status: 'SUPERSEDED_NO_ACTION', r2_basis: 'V1 one-occurrence membership is not equality-compatible with R2 candidate-equivalence membership.', active_r2_membership: false })),
    ...Array.from({ length: legacy.legacy_path_a_dispositions }, (_, index) => ({ legacy_record_type: 'V1_PATH_A_LOGICAL_DISPOSITION', legacy_record_ordinal: index + 1, status: 'SUPERSEDED_TO_CURRENT_R2_PATH_A', r2_basis: 'Current deterministic proof is retained only through the R2 Path A proof family and exact R2 membership.', active_r2_membership: false })),
    ...Array.from({ length: legacy.legacy_r3_actions }, (_, index) => ({ legacy_record_type: 'R3_SOURCE_SCOPE_ACTION', legacy_record_ordinal: index + 1, status: 'SUPERSEDED_NO_ACTION', r2_basis: 'R3 source-scope authority domains are not R2 equality groups and cannot remain active.', active_r2_membership: false })),
    ...Array.from({ length: legacy.legacy_authority_records }, (_, index) => ({ legacy_record_type: 'PRE_R2_AUTHORITY_RECORD', legacy_record_ordinal: index + 1, status: 'SUPERSEDED_NO_ACTION', r2_basis: 'Pre-R2 authority records lack a validated exact R2 linkage.', active_r2_membership: false })),
  ];
  const bridge = {
    schema_version: R4_BRIDGE_SCHEMA,
    reviewed_at: R4_REVIEWED_AT,
    source_inventory: source,
    records: bridgeRecords,
    totals: {
      legacy_path_a_dispositions: legacy.legacy_path_a_dispositions,
      legacy_path_b_dispositions: legacy.legacy_path_b_dispositions,
      legacy_r3_actions: legacy.legacy_r3_actions,
      legacy_authority_records: legacy.legacy_authority_records,
      active_legacy_memberships: 0,
      superseded_no_action: legacy.legacy_path_b_dispositions + legacy.legacy_r3_actions + legacy.legacy_authority_records,
      superseded_to_current_path_a: legacy.legacy_path_a_dispositions,
    },
  };
  validateR4({ inventory, inventoryText, resolution, actionPackage, bridge });
  return { resolution, actionPackage, bridge };
}

function validateSource(source, inventory, inventoryText, label) {
  if (!source || source.schema_version !== inventory.schema_version || source.run_id !== inventory.run_id || source.content_checksum_sha256 !== sha256(inventoryText)) fail(`${label} is not tied to the exact current R2 inventory.`);
}

function validateTerminalEvidence(record, logicalIds, reviewedAt) {
  if (!record || typeof record.logical_item_id !== 'string' || !logicalIds.has(record.logical_item_id) || !PATH_B_TERMINAL.has(record.terminal_result)) fail('Provider terminal evidence has an invalid logical item or result.');
  for (const field of ['authority_scope', 'provider_scope', 'safe_r2_linkage_reference', 'authorized_actor_or_role', 'sanitized_evidence_reference', 'current_tree_remediation_state', 'reachable_history_remediation_state']) if (typeof record[field] !== 'string' || record[field].trim() === '') fail(`Provider terminal evidence lacks ${field}.`);
  if (record.provider_identity_state !== 'PROVIDER_VERIFIED' || record.evidence_level !== 'PROVIDER_VERIFIED' || record.owner_assertion_only === true) fail('Provider terminal evidence is not provider-verified.');
  if (record.current_tree_remediation_state === 'REMOVAL_ONLY' || record.reachable_history_remediation_state === 'REMOVAL_ONLY') fail('Removal alone cannot be accepted as invalidation evidence.');
  requireIso(record.action_timestamp, 'Provider action timestamp'); requireIso(record.independent_verification_timestamp, 'Independent verification timestamp');
  if (Date.parse(record.action_timestamp) >= Date.parse(record.independent_verification_timestamp) || Date.parse(record.independent_verification_timestamp) > Date.parse(reviewedAt)) fail('Provider terminal-evidence chronology is invalid.');
  if (record.terminal_result === 'ROTATED_OLD_INVALIDATED' && record.old_credential_invalidation_state !== 'PROVEN') fail('Rotation evidence does not prove old-credential invalidation.');
  if (record.replacement_required === true && record.replacement_health_evidence_state !== 'PROVEN') fail('Replacement-required evidence lacks sanitized health proof.');
}

export function validateR4({ inventory, inventoryText, resolution, actionPackage, bridge }) {
  const validated = validateR2Inventory(inventory);
  for (const [label, value] of Object.entries({ resolution, actionPackage, bridge })) if (!noSecretBearingData(value)) fail(`${label} contains prohibited secret-bearing data.`);
  if (resolution?.schema_version !== R4_SCHEMA || actionPackage?.schema_version !== R4_ACTION_SCHEMA || bridge?.schema_version !== R4_BRIDGE_SCHEMA) fail('Unsupported R4 evidence schema.');
  validateSource(resolution.source_inventory, inventory, inventoryText, 'R4 resolution'); validateSource(actionPackage.source_inventory, inventory, inventoryText, 'R4 action package'); validateSource(bridge.source_inventory, inventory, inventoryText, 'R4 supersession bridge');
  requireIso(resolution.reviewed_at, 'R4 review timestamp'); requireIso(actionPackage.reviewed_at, 'R4 action-package review timestamp'); requireIso(bridge.reviewed_at, 'R4 bridge review timestamp');
  if (resolution.policy?.reachability_or_source_domain_is_not_authority !== true || resolution.policy?.default_path_b_grouping !== 'ONE_R2_LOGICAL_ITEM_PER_REQUEST') fail('R4 policy permits prohibited authority grouping.');
  const itemById = new Map(resolution.dispositions.map((item) => [item.logical_item_id, item]));
  if (itemById.size !== resolution.dispositions.length || !equalSets(new Set(itemById.keys()), validated.logicalIds)) fail('R4 does not provide exactly one disposition for every current R2 logical item.');
  const terminalEvidenceById = new Map((resolution.accepted_provider_evidence_records ?? []).map((record) => [record.logical_item_id, record]));
  if (terminalEvidenceById.size !== (resolution.accepted_provider_evidence_records ?? []).length) fail('Provider terminal evidence is reused across unrelated logical items.');
  for (const record of terminalEvidenceById.values()) validateTerminalEvidence(record, validated.logicalIds, resolution.reviewed_at);
  const expectedActionIds = new Set(); let terminal = 0; let pending = 0;
  for (const logical of inventory.logical_items) {
    const item = itemById.get(logical.logical_item_id);
    if (item.candidate_equivalence_class_id !== logical.candidate_equivalence_class_id || !equalSets(new Set(item.canonical_occurrence_ids), new Set(logical.canonical_occurrence_ids))) fail('R4 disposition has stale or incomplete R2 membership.');
    if (logical.classification === PATH_A_CLASSIFICATION) {
      if (item.primary_state !== PATH_A_STATE || item.terminal !== true || item.closure_path !== 'PATH_A_DETERMINISTIC_REPOSITORY_PROOF' || item.authority_state !== 'NOT_APPLICABLE_PATH_A' || item.provider_identity_state !== 'UNVERIFIED_NOT_REQUIRED_PATH_A' || item.proof_family !== logical.proof_family || item.deterministic_noncredential_proof_id !== logical.deterministic_noncredential_proof_id) fail('R4 Path A disposition is not a valid deterministic closure.');
      terminal += 1;
    } else {
      if (item.closure_path !== 'PATH_B_EXTERNAL_AUTHORITY_AND_PROVIDER_EVIDENCE') fail('R4 plausible item was routed through the wrong path.');
      if (item.primary_state === PATH_B_PENDING) {
        if (item.terminal !== false || item.suspected_provider !== 'UNKNOWN' || item.provider_identity_state !== 'UNKNOWN' || item.accountable_role !== 'SOURCE_OWNER_IDENTIFICATION_REQUIRED' || !Array.isArray(item.missing_predicates) || !equalSets(new Set(item.missing_predicates), new Set(REQUIRED_PREDICATES))) fail('R4 pending Path B item is unsafe or incomplete.');
        expectedActionIds.add(logical.logical_item_id); pending += 1;
      } else if (PATH_B_TERMINAL.has(item.primary_state)) {
        const evidence = terminalEvidenceById.get(logical.logical_item_id);
        if (item.terminal !== true || !evidence || evidence.terminal_result !== item.primary_state) fail('R4 terminal Path B item lacks accepted exact provider evidence.');
        terminal += 1;
      } else fail('R4 plausible item has an unsupported primary state.');
    }
  }
  if ((resolution.accepted_authority_records ?? []).length !== (resolution.totals?.authority_records?.accepted ?? 0)) fail('R4 authority accepted total is inconsistent.');
  const actionByLogicalId = new Map();
  for (const action of actionPackage.pending_actions ?? []) {
    if (typeof action.action_id !== 'string' || action.request_scope !== 'EXACT_R2_LOGICAL_ITEM_ONLY' || action.suspected_provider !== 'UNKNOWN' || action.responsible_role !== 'SOURCE_OWNER_IDENTIFICATION_REQUIRED' || !Array.isArray(action.logical_item_ids) || action.logical_item_ids.length !== 1 || !Array.isArray(action.required_evidence) || !equalSets(new Set(action.required_evidence), new Set(REQUIRED_PREDICATES))) fail('R4 external action is malformed, amplified, or infers provider/authority.');
    if (Object.hasOwn(action, 'authority_domain_id') || Object.hasOwn(action, 'source_domain_id') || Object.hasOwn(action, 'provider_credential_group_id')) fail('R4 external action retained a prohibited R3 domain/group field.');
    const logicalItemId = action.logical_item_ids[0];
    if (!expectedActionIds.has(logicalItemId) || actionByLogicalId.has(logicalItemId)) fail('R4 external actions do not match current pending R2 membership exactly once.');
    const logical = inventory.logical_items.find((item) => item.logical_item_id === logicalItemId);
    if (action.candidate_equivalence_class_id !== logical.candidate_equivalence_class_id || !equalSets(new Set(action.canonical_occurrence_ids), new Set(logical.canonical_occurrence_ids))) fail('R4 external action does not retain exact R2 class membership.');
    actionByLogicalId.set(logicalItemId, action);
  }
  if (!equalSets(new Set(actionByLogicalId.keys()), expectedActionIds) || actionPackage.totals?.pending_actions !== expectedActionIds.size) fail('R4 external queue does not equal the remaining plausible R2 set.');
  const apify = resolution.apify_08a1a_record;
  if (!apify || apify.status !== 'VALID_08A1A_UNLINKED_NO_EXACT_R2_LINKAGE' || apify.linkage_state !== 'NOT_APPLIED_TO_ANY_R2_LOGICAL_ITEM' || Object.hasOwn(apify, 'logical_item_id') || Object.hasOwn(apify, 'logical_item_ids')) fail('08A1A Apify evidence is improperly reused without exact R2 linkage.');
  const bridgeCounts = countBy(bridge.records ?? [], 'legacy_record_type');
  if ((bridge.records ?? []).some((record) => record.active_r2_membership !== false || !['SUPERSEDED_NO_ACTION', 'SUPERSEDED_TO_CURRENT_R2_PATH_A'].includes(record.status))) fail('A stale predecessor membership remains active.');
  if ((bridgeCounts.V1_PATH_B_LOGICAL_DISPOSITION ?? 0) !== bridge.totals?.legacy_path_b_dispositions || (bridgeCounts.V1_PATH_A_LOGICAL_DISPOSITION ?? 0) !== bridge.totals?.legacy_path_a_dispositions || (bridgeCounts.R3_SOURCE_SCOPE_ACTION ?? 0) !== bridge.totals?.legacy_r3_actions || (bridgeCounts.PRE_R2_AUTHORITY_RECORD ?? 0) !== bridge.totals?.legacy_authority_records || bridge.totals.active_legacy_memberships !== 0) fail('R4 supersession bridge does not account for every legacy record.');
  const recomputedStates = countBy(resolution.dispositions, 'primary_state');
  if (resolution.totals?.terminal_primary_total !== terminal || resolution.totals?.non_terminal_primary_total !== pending || resolution.totals?.non_terminal_primary_by_state?.[PATH_B_PENDING] !== pending || resolution.totals?.authority_records?.pending !== pending || resolution.totals?.provider_evidence_records?.pending !== pending || resolution.totals?.path_a_terminal_total !== validated.pathA.length || JSON.stringify(resolution.totals?.path_a_terminal_by_proof_family) !== JSON.stringify(countBy(validated.pathA, 'proof_family'))) fail('R4 resolution totals do not reconcile.');
  if ((recomputedStates[PATH_A_STATE] ?? 0) + (recomputedStates[PATH_B_PENDING] ?? 0) + [...PATH_B_TERMINAL].reduce((sum, state) => sum + (recomputedStates[state] ?? 0), 0) !== resolution.dispositions.length) fail('R4 contains a hidden primary state.');
  return { terminal, pending, actions: actionByLogicalId.size };
}

export const r4Constants = { PATH_A_STATE, PATH_B_PENDING, PATH_B_TERMINAL: [...PATH_B_TERMINAL], REQUIRED_PREDICATES };
