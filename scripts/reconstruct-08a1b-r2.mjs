#!/usr/bin/env node

/**
 * 08A1B-R2 reconstructs logical credential candidates without ever writing a
 * candidate value, equality tag, or raw scanner report. The only raw scanner
 * data path is Docker stdout -> this process -> ephemeral HMAC/equality
 * partition -> zeroed buffers. Persisted artifacts contain safe memberships.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { readSanitizedReports } from './reconcile-secret-findings.mjs';

export const R2_SCHEMA = '08A1B-R2-logical-credential-inventory-v1';
const R2_VERSION = '08A1B-R2-candidate-equivalence-v1';
const RAW_SCAN_VERSION = '08A1B-R2-memory-only-gitleaks-v1';
const IMAGE = 'zricethezav/gitleaks@sha256:691af3c7c5a48b16f187ce3446d5f194838f91238f27270ed36eef6359a574d9';
const PROHIBITED_FIELD = /^(?:secret|match|authorization|token_value|credential_value|replacement_value|raw_value|equality_tag|candidate_tag)$/i;
const CREDENTIAL_SHAPE = /(?:apify_api|sk-(?:proj-)?|AIza|AKIA|xox[abprs])[_-]?[A-Za-z0-9]{12,}|(?:api[_-]?key|token)\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i;
const SCOPES = ['worktree', 'reachable-git-history', 'runtime', 'memory', 'observability', 'deliverables', 'apps-frontend-dist', 'apps-generated-site-dist', 'apps-desktop-resources'];
export const MEMORY_SCAN_TIMEOUT_MS = 15 * 60 * 1000;

function fail(message) { throw new Error(message); }
function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function argumentsFor(name) { return process.argv.flatMap((value, index) => value === name && process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? [process.argv[index + 1]] : []); }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) fail(`Missing ${name}`); return value; }
function stableId(prefix, value) { return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 20).toUpperCase()}`; }
function stable(items, key) { const valueFor = typeof key === 'function' ? key : (item) => item[key]; return [...items].sort((left, right) => String(valueFor(left)).localeCompare(String(valueFor(right)))); }
function countBy(items, valueFor) { return Object.fromEntries([...items.reduce((counts, item) => { const key = valueFor(item); counts.set(key, (counts.get(key) ?? 0) + 1); return counts; }, new Map()).entries()].sort(([left], [right]) => String(left).localeCompare(String(right)))); }
function isIso(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value); }
function safeReportPath(value) { return value.replace(/^.*?(runtime\/secret-scan\/)/, '$1'); }
function reportId(value) { return path.basename(value).replace(/\.gitleaks\.json$/, ''); }
function locationFor(file, scope) {
  const relative = String(file).replace(/^\/(?:worktree|repo|artifact)\//, '');
  const prefixes = { runtime: 'runtime', memory: 'memory', observability: 'observability', deliverables: 'deliverables', 'apps-frontend-dist': 'apps/frontend/dist', 'apps-generated-site-dist': 'apps/generated-site/dist', 'apps-desktop-resources': 'apps/desktop/resources' };
  if (scope === 'reachable-git-history' || scope === 'worktree') return relative;
  const prefix = prefixes[scope];
  return prefix && !relative.startsWith(`${prefix}/`) ? `${prefix}/${relative}` : relative;
}
function objectMarker(record) { return typeof record.Commit === 'string' && record.Commit.length > 0 ? record.Commit : 'CURRENT_TREE'; }
function reachabilityFor(scope, marker, location) {
  if (scope === 'reachable-git-history' || marker !== 'CURRENT_TREE') return 'REACHABLE_HISTORY';
  if (scope === 'worktree') return 'CURRENT_TREE';
  if (location.startsWith('runtime/')) return 'RUNTIME_ARTIFACT';
  if (location.startsWith('memory/')) return 'MEMORY_ARTIFACT';
  if (location.startsWith('observability/')) return 'OBSERVABILITY_ARTIFACT';
  return 'BUILD_EXPORT_OR_DELIVERABLE_ARTIFACT';
}
function noRaw(value) {
  if (typeof value === 'string') return !CREDENTIAL_SHAPE.test(value);
  if (Array.isArray(value)) return value.every(noRaw);
  return !value || typeof value !== 'object' || Object.entries(value).every(([key, nested]) => !PROHIBITED_FIELD.test(key) && noRaw(nested));
}
function sourceClass(location) {
  if (location.startsWith('runtime/secret-scan/')) return 'SCANNER_OUTPUT';
  if (location.startsWith('runtime/self-improvement/')) return 'GENERATED_OUTPUT';
  if (location.startsWith('memory/')) return 'MEMORY_CAPTURE';
  if (location.startsWith('observability/')) return 'OBSERVABILITY_CAPTURE';
  if (location.startsWith('apps/backend/test/')) return 'TEST_FIXTURE';
  if (location === '.env' || location === '.env.example') return 'PRIMARY_SOURCE';
  if (location.startsWith('orchestrator-temp/') || location.startsWith('newAgent/') || /(?:\.zip!|backup|export)/i.test(location)) return 'COPIED_SOURCE';
  return 'UNKNOWN';
}
function provenanceDefinition(location) {
  const origin = sourceClass(location);
  if (origin === 'SCANNER_OUTPUT') fail('R2 rejected scanner-output recursion in an application input.');
  const references = {
    GENERATED_OUTPUT: 'apps/backend/src/selfImprovement/store.js; docs/self-improvement-control-plane.md',
    MEMORY_CAPTURE: 'memory/project-intelligence/ source root; repository producer semantics not fully proven',
    OBSERVABILITY_CAPTURE: 'apps/backend/src/tokenEconomy.js and self-improvement observability writers',
    TEST_FIXTURE: 'apps/backend/test/ committed test source',
    PRIMARY_SOURCE: 'repository configuration/source path',
    COPIED_SOURCE: 'archive, backup, or copied workspace provenance path',
    UNKNOWN: 'No deterministic repository producer/source proof available',
  };
  const transformations = { GENERATED_OUTPUT: 'GENERATED_RUNTIME_RECORD', MEMORY_CAPTURE: 'MEMORY_CAPTURE', OBSERVABILITY_CAPTURE: 'OBSERVABILITY_CAPTURE', TEST_FIXTURE: 'COMMITTED_TEST_FIXTURE', PRIMARY_SOURCE: 'PRIMARY_SOURCE', COPIED_SOURCE: 'COPY_OR_ARCHIVE', UNKNOWN: 'UNKNOWN' };
  return { origin_class: origin, producer_or_source_reference: references[origin], transformation_type: transformations[origin], candidate_bytes_preserved: origin === 'PRIMARY_SOURCE' ? 'NOT_APPLICABLE_PRIMARY_SOURCE' : 'UNKNOWN_UNTIL_EXACT_EQUIVALENCE_OR_PRODUCER_PROOF' };
}
function fixtureProof(canonical, pathAFixtureSourceValidated = false) {
  if (!pathAFixtureSourceValidated || canonical.normalized_location !== 'apps/backend/test/operationalSecurity.test.js' || canonical.object_marker !== 'CURRENT_TREE' || canonical.rule_id !== 'generic-api-key' || canonical.safe_line_metadata.start_line !== 27) return null;
  return {
    proof_id: 'PATHA-DETERMINISTIC-OPERATIONAL-SECURITY-FIXTURE-V1',
    proof_family: 'DETERMINISTIC_COMMITTED_FIXTURE',
    classification: 'VERIFIED_SYNTHETIC_FIXTURE',
    producer_reference: 'apps/backend/test/operationalSecurity.test.js deterministic fake-token builder',
    regression_test_reference: 'apps/backend/test/operationalSecurity.test.js; scripts/secret-scan.sh verify-fixture',
    validator_version: '08A1B-R2-path-a-validator-v1',
  };
}
function rawKey({ scope, record }) {
  const start = Number.isInteger(record.StartLine) ? record.StartLine : null;
  const end = Number.isInteger(record.EndLine) ? record.EndLine : start;
  return JSON.stringify({ scope, location: locationFor(record.File, scope), object_marker: objectMarker(record), rule_id: record.RuleID, start_line: start, end_line: end, fingerprint: record.Fingerprint });
}
function rawSafeKey({ scope, record }) {
  const start = Number.isInteger(record.StartLine) ? record.StartLine : null;
  const end = Number.isInteger(record.EndLine) ? record.EndLine : start;
  return JSON.stringify({ location: locationFor(record.File, scope), object_marker: objectMarker(record), rule_id: record.RuleID, start_line: start, end_line: end });
}
function ensureRawRecord(record) {
  if (!record || typeof record.File !== 'string' || typeof record.RuleID !== 'string' || typeof record.Fingerprint !== 'string' || typeof record.Secret !== 'string' || record.Secret.length === 0 || record.Secret === 'REDACTED') fail('Memory-only scanner returned a malformed candidate record.');
}

function safeReplayPath(value) {
  const outer = String(value).replace(/^\/(?:worktree|repo|artifact)\//, '').split('!')[0];
  const normalized = path.posix.normalize(outer.replaceAll('\\', '/'));
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/') || normalized.includes('\0') || normalized.startsWith('.git/')) {
    fail('Sanitized report contains an unsafe replay target.');
  }
  return normalized;
}

/**
 * Derive the smallest scanner input set that can reproduce a structurally
 * redacted report. Archive member paths are deliberately reduced to their
 * outer archive: the pinned scanner owns bounded archive traversal.
 */
export function deriveReplayTargets(sourceSet, { commitBoundary = null } = {}) {
  const scope = reportId(sourceSet.sourceReport);
  const targets = [...new Set(sourceSet.rows.map((record) => safeReplayPath(record.File)))].sort();
  if (scope === 'reachable-git-history') {
    if (typeof commitBoundary !== 'string' || !/^[0-9a-f]{40}$/i.test(commitBoundary)) fail('Reachable-history replay requires a pinned 40-character commit boundary.');
    if (!sourceSet.rows.every((record) => objectMarker(record) === commitBoundary)) fail('Reachable-history report does not match its frozen commit boundary.');
  }
  return { scope, targets, commit_boundary: scope === 'reachable-git-history' ? commitBoundary : null };
}

export function remainingScopeTimeout(startedAt, now = Date.now(), aggregateTimeoutMs = MEMORY_SCAN_TIMEOUT_MS) {
  const remaining = aggregateTimeoutMs - (now - startedAt);
  if (remaining <= 0) fail('Memory-only scanner exceeded its approved aggregate scope timeout.');
  return remaining;
}

export function canonicalizeSanitizedReports(sourceSets, runId, provenance = {}) {
  const observations = [];
  const structuralCandidates = new Map();
  for (const { sourceReport, rows } of sourceSets) {
    const scope = reportId(sourceReport);
    for (const [index, record] of rows.entries()) {
      const start = Number.isInteger(record.StartLine) ? record.StartLine : null;
      const end = Number.isInteger(record.EndLine) ? record.EndLine : start;
      const location = locationFor(record.File, scope);
      const marker = objectMarker(record);
      const safeKey = rawSafeKey({ scope, record });
      const fingerprint = record.Fingerprint;
      if (typeof fingerprint !== 'string' || !fingerprint) fail('Sanitized report lacks scanner correlation metadata.');
      const observation = {
        observation_id: stableId('OBS', JSON.stringify({ report: safeReportPath(sourceReport), index: index + 1 })),
        run_id: runId,
        report_id: scope,
        scope_id: scope,
        scanner: 'gitleaks',
        scanner_version_or_digest: provenance.scanner_version_or_digest ?? IMAGE,
        rule_id: record.RuleID,
        normalized_location: location,
        object_marker: marker,
        safe_line_metadata: { start_line: start, end_line: end },
        reachability: reachabilityFor(scope, marker, location),
        source_report: safeReportPath(sourceReport),
        source_observation_index: index + 1,
        scanner_correlation_key: rawKey({ scope, record }),
        canonical_safe_key: safeKey,
      };
      observations.push(observation);
      if (!structuralCandidates.has(safeKey)) structuralCandidates.set(safeKey, { safeKey, observations: [] });
      structuralCandidates.get(safeKey).observations.push(observation);
    }
  }
  return { observations: stable(observations, 'observation_id'), structuralCandidates };
}

export function partitionCandidateBuffers(canonicalCandidates) {
  const key = randomBytes(32);
  try {
    const byTag = new Map();
    for (const item of canonicalCandidates) {
      if (!Buffer.isBuffer(item.candidate) || item.candidate.length === 0) fail('Candidate equality requires nonempty in-memory candidate bytes.');
      const tag = createHmac('sha256', key).update(item.candidate).digest();
      const tagKey = tag.toString('base64');
      tag.fill(0);
      const group = byTag.get(tagKey) ?? [];
      if (group.length > 0 && (group[0].candidate.length !== item.candidate.length || !timingSafeEqual(group[0].candidate, item.candidate))) fail('Memory-only candidate equality collision or ambiguity detected.');
      group.push(item); byTag.set(tagKey, group);
    }
    return stable([...byTag.values()].map((members) => ({
      canonical_occurrence_ids: stable(members, 'canonical_occurrence_id').map((item) => item.canonical_occurrence_id),
      members,
    })), (item) => item.canonical_occurrence_ids.join(','));
  } finally { key.fill(0); }
}

function canonicalizeMemoryCandidates(observations, structuralCandidates, candidateByObservation, unreconstructedObservationIds) {
  const canonicalOccurrences = [];
  const canonicalCandidateById = new Map();
  const unreconstructedCanonicalIds = new Set();
  const observationById = new Map(observations.map((item) => [item.observation_id, item]));
  for (const structuralCandidate of stable([...structuralCandidates.values()], (item) => item.safeKey)) {
    const parsed = JSON.parse(structuralCandidate.safeKey);
    const available = structuralCandidate.observations.filter((item) => candidateByObservation.has(item.observation_id));
    const partitions = partitionCandidateBuffers(available.map((item) => ({ canonical_occurrence_id: item.observation_id, candidate: candidateByObservation.get(item.observation_id) })));
    const allPartitions = [
      ...partitions.map((partition) => ({ members: partition.members.map((item) => item.canonical_occurrence_id), candidate: partition.members[0].candidate, reconstructed: true })),
      ...structuralCandidate.observations.filter((item) => unreconstructedObservationIds.has(item.observation_id)).map((item) => ({ members: [item.observation_id], candidate: null, reconstructed: false })),
    ].sort((left, right) => left.members.join(',').localeCompare(right.members.join(',')));
    for (const [index, partition] of allPartitions.entries()) {
      const members = partition.members.map((id) => observationById.get(id));
      if (members.some((item) => !item)) fail('Canonical reconstruction lost an observation.');
      const identity = { ...parsed, occurrence_slot: index + 1, contributing_observation_ids: partition.members.slice().sort() };
      const canonicalOccurrenceId = stableId('CAN', JSON.stringify({ version: '08A1B-R2-canonical-location-and-memory-slot-v2', identity }));
      for (const observation of members) observation.canonical_occurrence_id = canonicalOccurrenceId;
      canonicalOccurrences.push({
        canonical_occurrence_id: canonicalOccurrenceId,
        normalized_location: parsed.location,
        object_marker: parsed.object_marker,
        rule_id: parsed.rule_id,
        safe_line_metadata: { start_line: parsed.start_line, end_line: parsed.end_line },
        occurrence_slot: identity.occurrence_slot,
        normalization_version: '08A1B-R2-location-object-and-memory-slot-v2',
        contributing_observation_ids: identity.contributing_observation_ids,
        contributing_report_ids: [...new Set(members.map((item) => item.report_id))].sort(),
        contributing_scope_ids: [...new Set(members.map((item) => item.scope_id))].sort(),
        reachability: [...new Set(members.map((item) => item.reachability))].sort(),
      });
      if (partition.reconstructed) canonicalCandidateById.set(canonicalOccurrenceId, Buffer.from(partition.candidate));
      else unreconstructedCanonicalIds.add(canonicalOccurrenceId);
    }
  }
  for (const observation of observations) {
    delete observation.scanner_correlation_key;
    delete observation.canonical_safe_key;
  }
  return { canonicalOccurrences: stable(canonicalOccurrences, 'canonical_occurrence_id'), canonicalCandidateById, unreconstructedCanonicalIds };
}

function logicalFromClass(equivalenceClass, canonicalById, pathAFixtureSourceValidated) {
  const members = equivalenceClass.canonical_occurrence_ids.map((id) => canonicalById.get(id));
  if (equivalenceClass.equality_run_result === 'UNRECONSTRUCTED_SOURCE_BYTES') {
    return {
      logical_item_id: stableId('LI', JSON.stringify({ version: R2_VERSION, candidate_equivalence_class_id: equivalenceClass.candidate_equivalence_class_id })),
      candidate_equivalence_class_id: equivalenceClass.candidate_equivalence_class_id,
      canonical_occurrence_ids: equivalenceClass.canonical_occurrence_ids,
      observation_ids: members.flatMap((member) => member.contributing_observation_ids).sort(),
      classification: 'UNRECONSTRUCTED_CANDIDATE',
      status: 'BLOCKED_SOURCE_BYTES_UNAVAILABLE',
      disposition: 'UNKNOWN',
      deterministic_noncredential_proof_id: null,
      proof_family: null,
      grouping_basis: 'SOURCE_BYTES_UNAVAILABLE_NO_EQUALITY_INFERENCE',
      grouping_validator_version: RAW_SCAN_VERSION,
      suspected_provider: 'UNVERIFIED',
      provider_identity_status: 'UNVERIFIED_NO_PROVIDER_PROOF',
      reachability: [...new Set(members.flatMap((member) => member.reachability))].sort(),
      source_owner_candidate: 'SOURCE_ACCESS_RECONSTRUCTION_REQUIRED',
      downstream_08a1c_state: 'NOT_ELIGIBLE_08A1B_R2_BLOCKED',
    };
  }
  const proofs = members.map((member) => fixtureProof(member, pathAFixtureSourceValidated)).filter(Boolean);
  const proof = proofs.length > 0 ? proofs[0] : null;
  if (proof && proofs.some((candidate) => candidate.proof_id !== proof.proof_id)) fail('Path A proof conflict within an equality class.');
  const logicalItemId = stableId('LI', JSON.stringify({ version: R2_VERSION, candidate_equivalence_class_id: equivalenceClass.candidate_equivalence_class_id }));
  return {
    logical_item_id: logicalItemId,
    candidate_equivalence_class_id: equivalenceClass.candidate_equivalence_class_id,
    canonical_occurrence_ids: equivalenceClass.canonical_occurrence_ids,
    observation_ids: members.flatMap((member) => member.contributing_observation_ids).sort(),
    classification: proof?.classification ?? 'PLAUSIBLE_CREDENTIAL',
    status: proof ? 'PATH_A_CLOSED' : 'PENDING_08A1C_ELIGIBILITY',
    disposition: proof ? 'VERIFIED_SYNTHETIC_FIXTURE' : 'UNKNOWN',
    deterministic_noncredential_proof_id: proof?.proof_id ?? null,
    proof_family: proof?.proof_family ?? null,
    grouping_basis: 'MEMORY_ONLY_EXACT_CANDIDATE_EQUALITY',
    grouping_validator_version: RAW_SCAN_VERSION,
    suspected_provider: 'UNVERIFIED',
    provider_identity_status: 'UNVERIFIED_NO_PROVIDER_PROOF',
    reachability: [...new Set(members.flatMap((member) => member.reachability))].sort(),
    source_owner_candidate: 'SOURCE_OWNER_IDENTIFICATION_REQUIRED',
    downstream_08a1c_state: proof ? 'NOT_APPLICABLE_PATH_A' : 'ELIGIBLE_IF_08A1B_R2_PASSES',
  };
}

export function buildR2Inventory({ sourceSets, rawRowsByScope, runId, provenance = {}, allowUnreconstructed = false, pathAFixtureSourceValidated = false, onMemoryReconstructed = null }) {
  const { observations, structuralCandidates } = canonicalizeSanitizedReports(sourceSets, runId, provenance);
  const rawByCorrelation = new Map();
  for (const [scope, rows] of rawRowsByScope.entries()) {
    for (const record of rows) {
      ensureRawRecord(record);
      const key = rawKey({ scope, record });
      const entries = rawByCorrelation.get(key) ?? [];
      const candidate = Buffer.from(record.Secret, 'utf8');
      record.Secret = ''; record.Match = '';
      entries.push(candidate); rawByCorrelation.set(key, entries);
    }
  }
  const candidateByObservation = new Map(); const unreconstructedObservationIds = new Set(); const canonicalCandidateById = new Map();
  try {
    for (const observation of observations) {
      const sourceSet = sourceSets.find((set) => reportId(set.sourceReport) === observation.scope_id);
      const row = sourceSet?.rows[observation.source_observation_index - 1];
      if (!row) fail('Canonical reconstruction lost its sanitized scanner row.');
      const available = rawByCorrelation.get(rawKey({ scope: observation.scope_id, record: row }));
      if (!available || available.length === 0) {
        if (!allowUnreconstructed) fail(`Raw candidate reconstruction is incomplete for sanitized scope ${observation.scope_id}.`);
        unreconstructedObservationIds.add(observation.observation_id);
        continue;
      }
      candidateByObservation.set(observation.observation_id, available.shift());
    }
    if ([...rawByCorrelation.values()].some((values) => values.length !== 0)) fail('Raw candidate reconstruction has unmapped scanner rows.');
    const reconstruction = canonicalizeMemoryCandidates(observations, structuralCandidates, candidateByObservation, unreconstructedObservationIds);
    const canonicalOccurrences = reconstruction.canonicalOccurrences;
    for (const [canonicalId, candidate] of reconstruction.canonicalCandidateById) canonicalCandidateById.set(canonicalId, candidate);
    const unreconstructedCanonicalIds = reconstruction.unreconstructedCanonicalIds;
    const partitions = partitionCandidateBuffers(canonicalOccurrences.filter((canonical) => canonicalCandidateById.has(canonical.canonical_occurrence_id)).map((canonical) => ({ canonical_occurrence_id: canonical.canonical_occurrence_id, candidate: canonicalCandidateById.get(canonical.canonical_occurrence_id) })));
    const equivalenceClasses = stable([...partitions.map((partition) => ({
      candidate_equivalence_class_id: stableId('CEQ', JSON.stringify({ version: R2_VERSION, canonical_occurrence_ids: partition.canonical_occurrence_ids })),
      canonical_occurrence_ids: partition.canonical_occurrence_ids,
      equality_method: 'EPHEMERAL_HMAC_PARTITION_THEN_CONSTANT_TIME_BYTE_EQUALITY',
      equality_implementation_version: RAW_SCAN_VERSION,
      equality_run_result: 'COMPLETE_MEMORY_ONLY',
      member_count: partition.canonical_occurrence_ids.length,
      provenance_distribution: {},
    })), ...[...unreconstructedCanonicalIds].sort().map((canonicalOccurrenceId) => ({
      candidate_equivalence_class_id: stableId('CEQ', JSON.stringify({ version: R2_VERSION, canonical_occurrence_ids: [canonicalOccurrenceId], source_bytes: 'UNAVAILABLE' })),
      canonical_occurrence_ids: [canonicalOccurrenceId],
      equality_method: 'NO_EQUALITY_INFERENCE_WHEN_SOURCE_BYTES_UNAVAILABLE',
      equality_implementation_version: RAW_SCAN_VERSION,
      equality_run_result: 'UNRECONSTRUCTED_SOURCE_BYTES',
      member_count: 1,
      provenance_distribution: {},
    }))], 'candidate_equivalence_class_id');
    const classByCanonical = new Map();
    for (const equivalenceClass of equivalenceClasses) for (const canonicalId of equivalenceClass.canonical_occurrence_ids) classByCanonical.set(canonicalId, equivalenceClass);
    const provenanceRecords = stable(canonicalOccurrences.map((canonical) => {
      const definition = provenanceDefinition(canonical.normalized_location);
      const equivalenceClass = classByCanonical.get(canonical.canonical_occurrence_id);
      return {
        provenance_id: stableId('PROV', canonical.canonical_occurrence_id),
        canonical_occurrence_id: canonical.canonical_occurrence_id,
        candidate_equivalence_class_id: equivalenceClass.candidate_equivalence_class_id,
        ...definition,
        parent_occurrence_ids: [],
        deterministic_proof_id: fixtureProof(canonical, pathAFixtureSourceValidated)?.proof_id ?? null,
        validator_version: '08A1B-R2-provenance-validator-v1',
      };
    }), 'provenance_id');
    const provenanceByCanonical = new Map(provenanceRecords.map((record) => [record.canonical_occurrence_id, record]));
    for (const equivalenceClass of equivalenceClasses) {
      const members = equivalenceClass.canonical_occurrence_ids.map((id) => provenanceByCanonical.get(id));
      equivalenceClass.provenance_distribution = countBy(members, (record) => record.origin_class);
      const primary = members.filter((record) => record.origin_class === 'PRIMARY_SOURCE').map((record) => record.canonical_occurrence_id).sort();
      if (primary.length) for (const record of members.filter((candidate) => candidate.origin_class !== 'PRIMARY_SOURCE')) {
        record.parent_occurrence_ids = primary;
        record.candidate_bytes_preserved = 'EXACT_EQUALITY_CONFIRMED_TO_PRIMARY_SOURCE';
      }
      const fixture = members.filter((record) => record.deterministic_proof_id).map((record) => record.canonical_occurrence_id).sort();
      if (fixture.length) for (const record of members.filter((candidate) => !candidate.deterministic_proof_id)) {
        record.parent_occurrence_ids = fixture;
        record.candidate_bytes_preserved = 'EXACT_EQUALITY_CONFIRMED_TO_DETERMINISTIC_FIXTURE';
      }
    }
    const canonical = canonicalOccurrences.map((item) => ({
      ...item,
      provenance_id: provenanceByCanonical.get(item.canonical_occurrence_id).provenance_id,
      candidate_equivalence_class_id: classByCanonical.get(item.canonical_occurrence_id).candidate_equivalence_class_id,
      deterministic_noncredential_proof_id: fixtureProof(item, pathAFixtureSourceValidated)?.proof_id ?? null,
    }));
    const canonicalById = new Map(canonical.map((item) => [item.canonical_occurrence_id, item]));
    const logicalItems = stable(equivalenceClasses.map((equivalenceClass) => logicalFromClass(equivalenceClass, canonicalById, pathAFixtureSourceValidated)), 'logical_item_id');
    const logicalByClass = new Map(logicalItems.map((item) => [item.candidate_equivalence_class_id, item]));
    for (const equivalenceClass of equivalenceClasses) equivalenceClass.logical_item_id = logicalByClass.get(equivalenceClass.candidate_equivalence_class_id).logical_item_id;
    // This narrowly scoped hook supports follow-on deterministic analysis while
    // the original scanner candidates are still confined to this process. The
    // hook receives no mutable scanner rows and must return only sanitized
    // metadata; candidate buffers remain cleared by this function's finally.
    if (onMemoryReconstructed !== null) {
      if (typeof onMemoryReconstructed !== 'function') fail('onMemoryReconstructed must be a function when supplied.');
      onMemoryReconstructed({
        canonical_occurrences: canonical,
        candidate_equivalence_classes: equivalenceClasses,
        provenance_records: provenanceRecords,
        candidate_by_canonical_id: canonicalCandidateById,
      });
    }
    const provenanceTotals = countBy(provenanceRecords, (record) => record.origin_class);
    const singletonCount = equivalenceClasses.filter((item) => item.member_count === 1).length;
    const repeatedClasses = equivalenceClasses.filter((item) => item.member_count > 1);
    const derivedCopyOccurrences = provenanceRecords.filter((record) => record.parent_occurrence_ids.length > 0).length;
    const pathATotal = logicalItems.filter((item) => item.classification !== 'PLAUSIBLE_CREDENTIAL' && item.classification !== 'UNRECONSTRUCTED_CANDIDATE').length;
    const plausibleTotal = logicalItems.filter((item) => item.classification === 'PLAUSIBLE_CREDENTIAL').length;
    const inventory = {
      schema_version: R2_SCHEMA,
      run_id: runId,
      reviewed_at: provenance.reviewed_at,
      source_report_sanitation: 'STRUCTURALLY_VERIFIED_SECRET_AND_MATCH_REDACTED',
      reconstruction: { version: R2_VERSION, raw_scan_version: RAW_SCAN_VERSION, candidate_equality: 'MEMORY_ONLY_EPHEMERAL_HMAC_AND_CONSTANT_TIME_CONFIRMATION', raw_candidate_persistence: 'PROHIBITED', input_snapshot: provenance.input_snapshot, scanner_version_or_digest: provenance.scanner_version_or_digest ?? IMAGE, scanner_config_sha256: provenance.scanner_config_sha256, commit_boundary: provenance.commit_boundary, source_report_paths: sourceSets.map((set) => safeReportPath(set.sourceReport)) },
      totals: {
        scan_observations: observations.length,
        canonical_occurrences: canonical.length,
        provenance_records: provenanceRecords.length,
        candidate_equivalence_classes: equivalenceClasses.length,
        singleton_equivalence_classes: singletonCount,
        repeated_equivalence_classes: repeatedClasses.length,
        largest_equivalence_class_size: Math.max(0, ...equivalenceClasses.map((item) => item.member_count)),
        deterministic_noncredential_logical_items: pathATotal,
        plausible_credential_logical_items: plausibleTotal,
        unreconstructed_candidates: logicalItems.filter((item) => item.classification === 'UNRECONSTRUCTED_CANDIDATE').length,
        terminal_logical_items: pathATotal,
        non_terminal_logical_items: plausibleTotal,
        duplicated_or_derived_occurrences_absorbed: derivedCopyOccurrences,
        scanner_output_recursion: 0,
        unresolved_provenance: provenanceRecords.filter((record) => record.origin_class === 'UNKNOWN').length,
      },
      provenance_totals: provenanceTotals,
      observation_to_canonical_overlap_reduction: observations.length - canonical.length,
      scan_observations: observations,
      canonical_occurrences: canonical,
      provenance_records: provenanceRecords,
      candidate_equivalence_classes: equivalenceClasses,
      logical_items: logicalItems,
    };
    if (!isIso(inventory.reviewed_at) || !noRaw(inventory)) fail('R2 reconstruction would persist prohibited candidate material.');
    return inventory;
  } finally {
    for (const candidate of candidateByObservation.values()) candidate.fill(0);
    for (const candidate of canonicalCandidateById.values()) candidate.fill(0);
    for (const values of rawByCorrelation.values()) for (const candidate of values) candidate.fill(0);
  }
}

function dockerArgsForScope(root, emptyDirectory, scope, { target = null, commitBoundary = null, timeoutMs = MEMORY_SCAN_TIMEOUT_MS } = {}) {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const args = ['run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--memory', '2g', '--cpus', '2', '--pids-limit', '256', '-v', `${root}:/repo:ro`];
  if (scope === 'worktree') {
    for (const target of ['.git', 'node_modules', 'runtime', 'memory', 'observability', 'deliverables', 'human-review', 'apps/backend/node_modules', 'apps/frontend/node_modules', 'apps/generated-site/node_modules', 'apps/frontend/dist', 'apps/generated-site/dist', 'apps/desktop/resources']) args.push('-v', `${emptyDirectory}:/repo/${target}:ro`);
    args.push(IMAGE, 'detect', '--source', target ? `/repo/${target}` : '/repo', '--no-git');
  } else if (scope === 'reachable-git-history') {
    const logOptions = target
      ? `${commitBoundary} -- ${target}`
      : '--all';
    args.push(IMAGE, 'detect', '--source', '/repo', `--log-opts=${logOptions}`);
  } else {
    const targets = { runtime: 'runtime', memory: 'memory', observability: 'observability', deliverables: 'deliverables', 'apps-frontend-dist': 'apps/frontend/dist', 'apps-generated-site-dist': 'apps/generated-site/dist', 'apps-desktop-resources': 'apps/desktop/resources' };
    const scopeRoot = targets[scope];
    if (!scopeRoot) fail(`Unsupported memory-only scan scope ${scope}.`);
    args.push('-v', `${path.join(root, scopeRoot)}:/artifact:ro`);
    if (scope === 'runtime') args.push('-v', `${emptyDirectory}:/artifact/secret-scan:ro`);
    const localTarget = target ? target.replace(new RegExp(`^${scopeRoot}/`), '') : '';
    args.push(IMAGE, 'detect', '--source', localTarget ? `/artifact/${localTarget}` : '/artifact', '--no-git');
  }
  return [...args, '--config', '/repo/.gitleaks.toml', '--redact=0', '--report-format', 'json', '--report-path', '-', '--max-archive-depth=3', '--max-decode-depth=1', '--max-target-megabytes=32', `--timeout=${seconds}`, '--no-banner', '--no-color', '--log-level', 'error'];
}

async function runDockerMemoryScan(root, emptyDirectory, scope, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? MEMORY_SCAN_TIMEOUT_MS;
    const child = spawn('docker', dockerArgsForScope(root, emptyDirectory, scope, { ...options, timeoutMs }), { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; const errors = [];
    let timedOut = false;
    // Do not rely solely on a scanner-internal timeout: enforce the same
    // bounded limit at the host process boundary so a stuck history/artifact
    // scan cannot silently outlive the approved replay window.
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => errors.push(Buffer.from(chunk)));
    child.once('error', () => { clearTimeout(timer); reject(new Error(`Memory-only scanner could not start for scope ${scope}.`)); });
    child.once('close', (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks); for (const error of errors) error.fill(0);
      try {
        if (timedOut) throw new Error(`Memory-only scanner exceeded its approved aggregate scope timeout for scope ${scope}.`);
        if (![0, 1].includes(code)) throw new Error(`Memory-only scanner failed for scope ${scope}.`);
        const text = output.toString('utf8'); output.fill(0);
        const rows = text.trim() ? JSON.parse(text) : [];
        if (!Array.isArray(rows)) throw new Error(`Memory-only scanner returned malformed JSON for scope ${scope}.`);
        resolve(rows);
      } catch (error) { output.fill(0); reject(error instanceof Error ? error : new Error(`Memory-only scanner failed for scope ${scope}.`)); }
    });
  });
}

export function assertRawReplayCompleteness(sourceSet, rawRows) {
  const scope = reportId(sourceSet.sourceReport);
  const expected = new Map();
  for (const record of sourceSet.rows) {
    const key = rawKey({ scope, record });
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }
  try {
    for (const record of rawRows) {
      ensureRawRecord(record);
      const key = rawKey({ scope, record });
      const count = expected.get(key) ?? 0;
      if (count < 1) fail(`Memory-only replay returned an unexpected raw record for scope ${scope}.`);
      expected.set(key, count - 1);
    }
    if ([...expected.values()].some((count) => count !== 0)) fail(`Memory-only replay omitted one or more sanitized observations for scope ${scope}.`);
  } catch (error) {
    for (const record of rawRows) { if (typeof record?.Secret === 'string') record.Secret = ''; if (typeof record?.Match === 'string') record.Match = ''; }
    throw error;
  }
}

export async function liveRawRowsForReports(repositoryRoot, sourceSets, { commitBoundary = null, aggregateTimeoutMs = MEMORY_SCAN_TIMEOUT_MS } = {}) {
  // Docker Desktop can mount the workspace but may reject OS-private temp
  // paths. This directory is empty, lives under the already-excluded scanner
  // output root, and is never populated with candidate/source bytes.
  const emptyDirectory = await mkdtemp(path.join(repositoryRoot, 'runtime', 'secret-scan', 'r2-mask-'));
  try {
    const results = new Map();
    for (const sourceSet of sourceSets.filter((set) => set.rows.length > 0)) {
      const replay = deriveReplayTargets(sourceSet, { commitBoundary });
      const startedAt = Date.now(); const rows = [];
      try {
        for (const target of replay.targets) {
          const raw = await runDockerMemoryScan(repositoryRoot, emptyDirectory, replay.scope, {
            target,
            commitBoundary: replay.commit_boundary,
            timeoutMs: remainingScopeTimeout(startedAt, Date.now(), aggregateTimeoutMs),
          });
          const targetRows = sourceSet.rows.filter((record) => safeReplayPath(record.File) === target);
          try { assertRawReplayCompleteness({ ...sourceSet, rows: targetRows }, raw); }
          catch { throw new Error(`Memory-only replay target ${replay.scope}:${target} did not exactly reproduce its structurally redacted observations.`); }
          rows.push(...raw);
        }
        assertRawReplayCompleteness(sourceSet, rows);
        results.set(replay.scope, rows);
      } catch (error) {
        for (const record of rows) { if (typeof record?.Secret === 'string') record.Secret = ''; if (typeof record?.Match === 'string') record.Match = ''; }
        throw error;
      }
    }
    for (const sourceSet of sourceSets.filter((set) => set.rows.length === 0)) results.set(reportId(sourceSet.sourceReport), []);
    return results;
  } finally {
    // The directory contains no candidate material. Leave OS-managed cleanup
    // to avoid a destructive operation inside this reconstruction process.
  }
}

async function scopeExists(repositoryRoot, scope) {
  const roots = { runtime: 'runtime', memory: 'memory', observability: 'observability', deliverables: 'deliverables', 'apps-frontend-dist': 'apps/frontend/dist', 'apps-generated-site-dist': 'apps/generated-site/dist', 'apps-desktop-resources': 'apps/desktop/resources' };
  if (scope === 'worktree' || scope === 'reachable-git-history') return true;
  try { await access(path.join(repositoryRoot, roots[scope])); return true; } catch { return false; }
}

export async function liveRawRowsForScopes(repositoryRoot, scopes = SCOPES) {
  const emptyDirectory = await mkdtemp(path.join(repositoryRoot, 'runtime', 'secret-scan', 'r2-mask-'));
  try {
    const results = new Map();
    for (const scope of scopes) results.set(scope, await (await scopeExists(repositoryRoot, scope) ? runDockerMemoryScan(repositoryRoot, emptyDirectory, scope) : Promise.resolve([])));
    return results;
  } finally {
    // This empty, ignored directory is never populated with candidate bytes.
  }
}

function sourceSetsFromMemoryScan(rawRowsByScope, reportDirectory) {
  return SCOPES.map((scope) => {
    const rows = rawRowsByScope.get(scope) ?? [];
    const sanitized = rows.map((row) => ({ ...row, Secret: 'REDACTED', Match: 'REDACTED' }));
    return { sourceReport: path.join(reportDirectory, `${scope}.gitleaks.json`), rows: sanitized };
  });
}

export function inventoryMarkdown(inventory) {
  const totals = inventory.totals;
  const provenance = Object.entries(inventory.provenance_totals).map(([key, value]) => `| ${key} | ${value} |`).join('\n');
  const classes = inventory.candidate_equivalence_classes.map((item) => `| ${item.candidate_equivalence_class_id} | ${item.member_count} | ${Object.entries(item.provenance_distribution).map(([key, value]) => `${key}=${value}`).join(', ')} | ${item.logical_item_id} |`).join('\n');
  const logical = inventory.logical_items.map((item) => `| ${item.logical_item_id} | ${item.candidate_equivalence_class_id} | ${item.classification} | ${item.canonical_occurrence_ids.length} | ${item.reachability.join(', ')} | ${item.downstream_08a1c_state} |`).join('\n');
  const pass = totals.unreconstructed_candidates === 0 && totals.scanner_output_recursion === 0 && totals.candidate_equivalence_classes > 0;
  return `# 08A1B-R2 count and provenance bridge\n\n## Outcome\n\n${pass ? 'PASS — all freshly scanned canonical occurrences were reconstructed into one and only one memory-only exact candidate-equivalence class.' : 'BLOCKED — reconstruction did not satisfy the required safety and completeness invariants.'}\n\n## Why prior reopened\n\nThe prior 08A1B inventory correctly retained scanner fingerprints as location metadata, but it did not reconstruct candidate equality from source bytes. R2 replaces the one-canonical-occurrence/one-logical-item assumption with an ephemeral in-memory equality partition.\n\n## Reproduced source counts\n\nThis reconstruction used structurally redacted scanner reports for auditable observation metadata and a separate, bounded memory-only scanner pass for exact candidate equality. Candidate bytes, ephemeral HMAC keys/tags, raw matches, and raw scanner reports were never persisted.\n\n| Layer | Count |\n| --- | ---: |\n| Scan observations | ${totals.scan_observations} |\n| Canonical occurrences | ${totals.canonical_occurrences} |\n| Overlapping observations collapsed | ${inventory.observation_to_canonical_overlap_reduction} |\n| Provenance records | ${totals.provenance_records} |\n| Candidate equivalence classes | ${totals.candidate_equivalence_classes} |\n| Singleton equivalence classes | ${totals.singleton_equivalence_classes} |\n| Repeated equivalence classes | ${totals.repeated_equivalence_classes} |\n| Largest equivalence class | ${totals.largest_equivalence_class_size} |\n\n## Amplification and recursion root causes\n\nThe observation-to-canonical reduction is caused only by overlapping scoped observations of the same normalized source occurrence. Produced scanner-report roots are masked from producing scans; scanner-output recursion is ${totals.scanner_output_recursion}.\n\n## Observation-to-canonical bridge\n\nEvery observation has one canonical occurrence; each canonical occurrence carries all contributing observation IDs and scope IDs.\n\n## Candidate equality reconstruction\n\nEach canonical candidate is partitioned only while in memory using a fresh per-run HMAC key, then constant-time byte equality confirms every same-tag group. Neither candidate bytes, HMAC keys, tags, fragments, nor derived candidate hashes are serialized.\n\n## Provenance classification\n\n| Origin class | Canonical occurrences |\n| --- | ---: |\n${provenance}\n\n## Logical-credential totals\n\n| Measure | Count |\n| --- | ---: |\n| Candidate-equivalence classes | ${totals.candidate_equivalence_classes} |\n| Plausible credential logical items | ${totals.plausible_credential_logical_items} |\n| Unreconstructed candidates | ${totals.unreconstructed_candidates} |\n| Derived/copy occurrences absorbed | ${totals.duplicated_or_derived_occurrences_absorbed} |\n| Unresolved provenance (explicit UNKNOWN only) | ${totals.unresolved_provenance} |\n\n## Path A proof totals\n\n| Deterministic non-credential logical items | Count |\n| --- | ---: |\n| Verified Path A items | ${totals.deterministic_noncredential_logical_items} |\n\n## Plausible credential queue\n\nThe action inventory contains one row per exact candidate-equivalence class. It makes no provider, owner, validity, or external-action assertion.\n\n## Files changed\n\nThe R2 source-of-truth artifacts are this bridge, the candidate-provenance ledger, equivalence-class ledger, logical-credential inventory, and owner action inventory.\n\n## Validation matrix\n\n| Invariant | Result |\n| --- | --- |\n| All canonical occurrences assigned once | ${totals.unreconstructed_candidates === 0 ? 'PASS' : 'BLOCKED'} |\n| Equality only in memory | PASS |\n| Fresh HMAC key and no tags persisted | PASS |\n| Scanner output excluded from producing scans | ${totals.scanner_output_recursion === 0 ? 'PASS' : 'BLOCKED'} |\n| Path A proof source validated | ${inventory.reconstruction.input_snapshot.path_a_fixture_source_validated ? 'PASS' : 'NOT_APPLICABLE'} |\n\n## Downstream 08A1C/08A1D status\n\n08A1C is not eligible for action until this R2 result is accepted. Existing R3 authority artifacts remain non-actionable pending R2. 08A1D coverage evidence may remain, but all old logical-item mappings require R2 revalidation.\n\n## Remaining blockers\n\n${pass ? 'No R2 reconstruction blocker remains. External owner/provider work is outside this subgate.' : 'Complete the failed reconstruction invariant before any downstream authority or mapping work.'}\n\n## Next eligible subgate\n\n${pass ? '08A1C — only after consuming this R2 logical-credential inventory.' : '08A1B-R2 rerun.'}\n\n## Candidate-equivalence classes\n\n| Equivalence class | Canonical members | Provenance distribution | Logical item |\n| --- | ---: | --- | --- |\n${classes}\n\n## Logical credential inventory\n\n| Logical item | Equivalence class | Classification | Canonical members | Reachability | 08A1C state |\n| --- | --- | --- | ---: | --- | --- |\n${logical}\n\nSUBGATE 08A1B: ${pass ? 'PASS' : 'BLOCKED'}\n`;
}
export function actionInventoryMarkdown(inventory) {
  const plausible = inventory.logical_items.filter((item) => item.classification === 'PLAUSIBLE_CREDENTIAL');
  const rows = plausible.map((item) => `| ${item.logical_item_id} | ${item.candidate_equivalence_class_id} | ${item.canonical_occurrence_ids.length} | ${item.reachability.join(', ')} | Provider and source owner UNVERIFIED; eligible only after 08A1B-R2 PASS |`).join('\n');
  return `# 08A1B-R2 plausible-credential queue\n\nEach row is one memory-only exact candidate-equivalence class. It is not an authority assignment, provider identification, or disposition.\n\n| Logical item | Candidate equivalence class | Canonical occurrences | Reachability | Next action |\n| --- | --- | ---: | --- | --- |\n${rows}\n`;
}
export function reconciliationMarkdown(inventory) {
  return `# 08A1B-R2 finding reconciliation\n\nThis R2 record supersedes the prior V1 logical-item mapping. It preserves scan observations and canonical occurrences, but uses only freshly reconstructed in-memory exact candidate equality for logical credential classes. No raw candidate material, equality tag, or derived candidate hash is persisted.\n\n${inventoryMarkdown(inventory)}`;
}
async function writeJson(filename, value) { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }

async function validatePathAFixtureSource(repositoryRoot) {
  const filename = path.join(repositoryRoot, 'apps/backend/test/operationalSecurity.test.js');
  try {
    const lines = (await readFile(filename, 'utf8')).split(/\r?\n/);
    return lines[26]?.includes('const fakeToken') === true
      && lines[36]?.includes('assert.doesNotMatch') === true
      && lines[37]?.includes('/<redacted>/') === true;
  } catch {
    return false;
  }
}

async function main() {
  const repositoryRoot = required('--repository-root');
  const runId = required('--run-id');
  const reviewedAt = required('--reviewed-at'); if (!isIso(reviewedAt)) fail('R2 requires an explicit UTC review timestamp.');
  const sourceReports = argumentsFor('--source-report');
  const liveScan = process.argv.includes('--live-scan');
  if ((liveScan && sourceReports.length) || (!liveScan && !sourceReports.length)) fail('Choose exactly one source mode: --live-scan or one or more --source-report values.');
  const pathAFixtureSourceValidated = await validatePathAFixtureSource(repositoryRoot);
  const rawRowsByScope = liveScan ? await liveRawRowsForScopes(repositoryRoot) : await liveRawRowsForReports(repositoryRoot, await readSanitizedReports(sourceReports));
  const sourceSets = liveScan ? sourceSetsFromMemoryScan(rawRowsByScope, required('--report-directory')) : await readSanitizedReports(sourceReports);
  if (!sourceSets.every((set) => Array.isArray(set.rows) && set.rows.every((row) => row.Secret === 'REDACTED' && typeof row.Match === 'string' && row.Match.includes('REDACTED')))) fail('R2 generated an unsafe scanner report representation.');
  const inventory = buildR2Inventory({ sourceSets, rawRowsByScope, runId, pathAFixtureSourceValidated, provenance: { reviewed_at: reviewedAt, scanner_version_or_digest: argument('--scanner-version-or-digest') ?? IMAGE, scanner_config_sha256: argument('--scanner-config-sha256') ?? 'UNRECORDED', commit_boundary: argument('--commit-boundary') ?? 'UNRECORDED', input_snapshot: { scope_ids: sourceSets.map((set) => reportId(set.sourceReport)).sort(), output_roots_excluded_from_producing_scans: ['runtime/secret-scan'], frozen_before_output_generation: true, path_a_fixture_source_validated: pathAFixtureSourceValidated } } });
  const candidateProvenance = { schema_version: '08A1B-R2-candidate-provenance-v1', run_id: runId, reviewed_at: reviewedAt, totals: inventory.totals, provenance_records: inventory.provenance_records, canonical_occurrences: inventory.canonical_occurrences, scan_observations: inventory.scan_observations };
  const equivalence = { schema_version: '08A1B-R2-equivalence-classes-v1', run_id: runId, reviewed_at: reviewedAt, equality_contract: inventory.reconstruction.candidate_equality, totals: { candidate_equivalence_classes: inventory.totals.candidate_equivalence_classes, singleton_equivalence_classes: inventory.totals.singleton_equivalence_classes, repeated_equivalence_classes: inventory.totals.repeated_equivalence_classes, largest_equivalence_class_size: inventory.totals.largest_equivalence_class_size }, candidate_equivalence_classes: inventory.candidate_equivalence_classes };
  const outputInventory = required('--output-inventory');
  const outputLogicalInventory = argument('--output-logical-inventory-doc');
  await Promise.all([
    writeJson(outputInventory, inventory),
    ...(outputLogicalInventory ? [writeJson(outputLogicalInventory, inventory)] : []),
    writeJson(required('--output-provenance'), candidateProvenance),
    writeJson(required('--output-equivalence'), equivalence),
    writeFile(required('--output-count-bridge'), inventoryMarkdown(inventory), 'utf8'),
    ...(argument('--output-reconciliation') ? [writeFile(argument('--output-reconciliation'), reconciliationMarkdown(inventory), 'utf8')] : []),
    writeFile(required('--output-action-inventory'), actionInventoryMarkdown(inventory), 'utf8'),
    ...(liveScan ? sourceSets.map((set) => writeJson(set.sourceReport, set.rows)) : []),
  ]);
  process.stdout.write(`Reconstructed 08A1B-R2: ${inventory.totals.scan_observations} observations, ${inventory.totals.canonical_occurrences} canonical occurrences, and ${inventory.totals.candidate_equivalence_classes} logical candidate classes.\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) main().catch((error) => { process.stderr.write(`08A1B-R2 reconstruction failed: ${error.message}\n`); process.exitCode = 1; });
