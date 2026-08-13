#!/usr/bin/env node

/**
 * Execute 08A1B-R3 semantic triage without persisting scanner candidates.
 * R2 stays immutable input: this process only reproduces its raw correlation
 * in memory, evaluates deterministic source/parser/consumer rules, and writes
 * a sanitized semantic projection.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildR2Inventory, liveRawRowsForReports } from './reconstruct-08a1b-r2.mjs';
import { readSanitizedReports } from './reconcile-secret-findings.mjs';
import { SEMANTIC_SCHEMA, evaluateSemanticEvidence, noCandidateBearingData, ruleSemanticsFor } from './08a1b-r3-semantic-lib.mjs';

const R2_SCHEMA = '08A1B-R2-logical-credential-inventory-v1';
const MAX_CONTEXT_BYTES = 32 * 1024 * 1024;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const semanticSourceBuffers = new Map();
const semanticSourceAnalyses = new Map();

function fail(message) { throw new Error(message); }
function arg(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function required(name) { const value = arg(name); if (!value || value.startsWith('--')) fail(`Missing ${name}`); return value; }
function stable(items, key) { return [...items].sort((left, right) => String(typeof key === 'function' ? key(left) : left[key]).localeCompare(String(typeof key === 'function' ? key(right) : right[key]))); }
function countBy(items, selector) { return Object.fromEntries([...items.reduce((map, item) => { const key = typeof selector === 'function' ? selector(item) : item[selector]; map.set(key, (map.get(key) ?? 0) + 1); return map; }, new Map()).entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))); }
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function safeRelative(value) { const normalized = path.posix.normalize(String(value).replaceAll('\\', '/')); if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/') || normalized.includes('!')) return null; return normalized; }
function exactArray(left, right) { return Array.isArray(left) && Array.isArray(right) && JSON.stringify([...left].sort()) === JSON.stringify([...right].sort()); }
function cachedSourceBuffer(key, load) {
  const prior = semanticSourceBuffers.get(key);
  if (prior) return prior;
  const loaded = load();
  semanticSourceBuffers.set(key, loaded);
  return loaded;
}
/** Source bytes live only during an R3 classification and are zeroed before output publication. */
export function clearSemanticSourceBuffers() {
  for (const buffer of semanticSourceBuffers.values()) buffer.fill(0);
  semanticSourceBuffers.clear();
  semanticSourceAnalyses.clear();
}
function environmentConsumerContract(repositoryRoot, variableName) {
  const approved = {
    APIFY_API_KEY: ['apps/backend/src/server.js APIFY_API_KEY authenticated Apify request'],
  };
  const references = approved[variableName] ?? [];
  // Keep the allowlist tied to an actual local source location. This prevents
  // a configuration key name from becoming positive evidence by itself.
  return references.length && readFileSync(path.join(repositoryRoot, 'apps/backend/src/server.js'), 'utf8').includes(`process.env.${variableName}`)
    ? references : [];
}
export function controlledEnvironmentContextFromBuffer(buffer, candidate, consumerForVariable) {
  try {
    const text = buffer.toString('utf8');
    const matches = [];
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, name, rawValue] = match;
      const unquoted = rawValue.replace(/^(["'])([\s\S]*)\1$/, '$2');
      const value = Buffer.from(unquoted, 'utf8');
      try { if (value.length === candidate.length && value.equals(candidate)) matches.push(name); } finally { value.fill(0); }
    }
    if (matches.length !== 1) return { available: false, reason: matches.length ? 'ENVIRONMENT_CANDIDATE_MAPS_TO_MULTIPLE_VARIABLES' : 'ENVIRONMENT_CANDIDATE_VARIABLE_UNRESOLVED' };
    const variableName = matches[0]; const consumers = consumerForVariable(variableName);
    const strictApplicationSecret = variableName === 'APIFY_API_KEY' && /^apify_api_[A-Za-z0-9]{20,}$/.test(candidate.toString('utf8'));
    return {
      available: true,
      source_context_available: true,
      schema_or_producer_validated: consumers.length > 0,
      secret_bearing_schema: /(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|SIGNING)/.test(variableName),
      authentication_consumption: consumers.length > 0,
      generic_secret_parser: strictApplicationSecret,
      source_references: [`controlled .env variable schema: ${variableName}`],
      parser_references: ['controlled environment key/value parser'],
      consumer_references: consumers,
      missing_reason: consumers.length && strictApplicationSecret ? null : consumers.length ? 'ENVIRONMENT_VALUE_FAILED_APPROVED_STRICT_PARSER' : 'ENVIRONMENT_VARIABLE_HAS_NO_APPROVED_AUTHENTICATION_CONSUMER',
    };
  } catch { return { available: false, reason: 'ENVIRONMENT_SOURCE_CONTEXT_UNAVAILABLE' }; }
}
function controlledEnvironmentContext(repositoryRoot, location, candidate) {
  const relative = safeRelative(location);
  if (relative !== '.env') return { available: false, reason: 'HISTORICAL_ENVIRONMENT_SOURCE_CONTEXT_REQUIRES_CONTROLLED_ANALYSIS' };
  let buffer = null;
  try {
    buffer = readFileSync(path.join(repositoryRoot, relative));
    if (buffer.length > MAX_CONTEXT_BYTES) return { available: false, reason: 'SOURCE_CONTEXT_EXCEEDS_BOUNDED_IN_PROCESS_LIMIT' };
    return controlledEnvironmentContextFromBuffer(buffer, candidate, (variableName) => environmentConsumerContract(repositoryRoot, variableName));
  } catch { return { available: false, reason: 'ENVIRONMENT_SOURCE_CONTEXT_UNAVAILABLE' }; }
  finally { if (buffer) buffer.fill(0); }
}
function safeReadCurrent(repositoryRoot, location) {
  const relative = safeRelative(location); if (!relative) return { available: false, reason: 'NON_FILE_OR_ARCHIVE_LOCATION_REQUIRES_SOURCE_LINEAGE' };
  if (relative === '.env' || relative.startsWith('.env.')) return { available: false, reason: 'ENVIRONMENT_SOURCE_CONTEXT_REQUIRES_CONTROLLED_ANALYSIS' };
  try {
    const filename = path.join(repositoryRoot, relative); const size = statSync(filename).size;
    if (size > MAX_CONTEXT_BYTES) return { available: false, reason: 'SOURCE_CONTEXT_EXCEEDS_BOUNDED_IN_PROCESS_LIMIT' };
    const value = cachedSourceBuffer(`CURRENT_TREE:${relative}`, () => readFileSync(filename));
    return { available: true, buffer: value, source_key: `CURRENT_TREE:${relative}` };
  } catch { return { available: false, reason: 'CURRENT_SOURCE_CONTEXT_UNAVAILABLE' }; }
}
function safeReadHistory(repositoryRoot, marker, location) {
  const relative = safeRelative(location); if (!relative) return { available: false, reason: 'HISTORICAL_NON_FILE_OR_ARCHIVE_LOCATION_REQUIRES_SOURCE_LINEAGE' };
  if (relative === '.env' || relative.startsWith('.env.')) return { available: false, reason: 'HISTORICAL_ENVIRONMENT_SOURCE_CONTEXT_REQUIRES_CONTROLLED_ANALYSIS' };
  try {
    const value = cachedSourceBuffer(`HISTORY:${marker}:${relative}`, () => Buffer.from(execFileSync('git', ['-C', repositoryRoot, 'show', `${marker}:${relative}`], { encoding: 'buffer', maxBuffer: MAX_CONTEXT_BYTES, stdio: ['ignore', 'pipe', 'ignore'] })));
    return { available: true, buffer: value, source_key: `HISTORY:${marker}:${relative}` };
  } catch { return { available: false, reason: 'HISTORICAL_SOURCE_CONTEXT_UNAVAILABLE_OR_OVERSIZE' }; }
}
function sourceAnalysisFromBuffer(buffer, sourceKey) {
  const existing = semanticSourceAnalyses.get(sourceKey);
  if (existing) return existing;
  let text = null;
  try { text = buffer.toString('utf8'); } catch { return { structured: false, fieldKindsByValue: new Map(), directAuthClient: false, secretSchema: false }; }
  const fieldKindsByValue = new Map(); let parsedAny = false;
  function walk(value, key = '') {
    if (typeof value === 'string') {
      const fields = fieldKindsByValue.get(value) ?? new Set(); fields.add(String(key)); fieldKindsByValue.set(value, fields);
      return;
    }
    if (Array.isArray(value)) { for (const item of value) walk(item, key); return; }
    if (value && typeof value === 'object') for (const [childKey, child] of Object.entries(value)) walk(child, childKey);
  }
  try { walk(JSON.parse(text)); parsedAny = true; } catch {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { walk(JSON.parse(line)); parsedAny = true; } catch { /* mixed/plain sources remain unresolved */ }
    }
  }
  const analysis = {
    structured: parsedAny,
    fieldKindsByValue,
    directAuthClient: /(?:fetch|axios|request|client\.)[\s\S]{0,600}(?:authorization|bearer|x-api-key)|(?:authorization|bearer|x-api-key)[\s\S]{0,600}(?:fetch|axios|request|client\.)/i.test(text),
    secretSchema: /(?:secret|password|signing|private[_-]?key|session)[\w.-]{0,80}\s*[:=]/i.test(text),
  };
  semanticSourceAnalyses.set(sourceKey, analysis);
  return analysis;
}
function valueContextFromStructuredBuffer(buffer, candidate, sourceKey) {
  const analysis = sourceAnalysisFromBuffer(buffer, sourceKey);
  const fieldKinds = analysis.fieldKindsByValue.get(candidate.toString('utf8')) ?? new Set();
  return { structured: analysis.structured, fieldKinds: [...fieldKinds].sort(), analysis };
}
function contractFilesPresent(repositoryRoot, requirements) {
  try {
    return requirements.every(({ file, snippets }) => {
      const source = readFileSync(path.join(repositoryRoot, file), 'utf8');
      return snippets.every((snippet) => source.includes(snippet));
    });
  } catch { return false; }
}
function selfImprovementStableHashContext(repositoryRoot, member, fieldKinds) {
  // A source location, a 24-hex shape, or a field label on its own is never
  // Path A proof. These narrowly pinned contracts require all three: the
  // record field, its deterministic producer, and a local consumer.
  if (member.object_marker !== 'CURRENT_TREE') return null;
  if (member.normalized_location === 'runtime/self-improvement/patterns/patterns.jsonl' && fieldKinds.includes('patternKey')) {
    const validated = contractFilesPresent(repositoryRoot, [
      { file: 'apps/backend/src/selfImprovement/aggregator.js', snippets: ['const patternKey = stableHash(key).slice(0, 24);', 'patternKey,'] },
      { file: 'apps/backend/src/selfImprovement/contracts.js', snippets: ['patternKey: stableHashIdentifierSchema'] },
      { file: 'apps/backend/src/selfImprovement/controlPlane.js', snippets: ['row.patternKey || row.id'] },
      { file: 'apps/backend/src/selfImprovement/evidenceBuilder.js', snippets: ['pattern.patternKey === trigger.patternKey'] },
    ]);
    if (!validated) return null;
    return {
      source_context_available: true,
      schema_or_producer_validated: true,
      producer_validated: true,
      consumer_validated: true,
      record_kind: 'SELF_IMPROVEMENT_PATTERN_KEY',
      source_references: ['runtime/self-improvement/patterns/patterns.jsonl patternKey field', 'apps/backend/src/selfImprovement/aggregator.js stableHash producer'],
      consumer_references: ['apps/backend/src/selfImprovement/controlPlane.js pattern consolidation', 'apps/backend/src/selfImprovement/evidenceBuilder.js trigger-to-pattern lookup'],
    };
  }
  if (member.normalized_location === 'runtime/self-improvement/tools/tool-incorporation-plans.jsonl' && fieldKinds.includes('normalizedKey')) {
    const validated = contractFilesPresent(repositoryRoot, [
      { file: 'apps/backend/src/selfImprovement/toolCapabilityAgent.js', snippets: ['const normalizedKey = stableHashIdentifierSchema.parse(stableHash(fingerprintText(', ')).slice(0, 24));', 'normalizedKey,', 'row.normalizedKey !== key'] },
    ]);
    if (!validated) return null;
    return {
      source_context_available: true,
      schema_or_producer_validated: true,
      producer_validated: true,
      consumer_validated: true,
      record_kind: 'SELF_IMPROVEMENT_TOOL_PLAN_KEY',
      source_references: ['runtime/self-improvement/tools/tool-incorporation-plans.jsonl normalizedKey field', 'apps/backend/src/selfImprovement/toolCapabilityAgent.js stableHash producer'],
      consumer_references: ['apps/backend/src/selfImprovement/toolCapabilityAgent.js duplicate-suppression key comparison'],
    };
  }
  return null;
}
function contextForMember(repositoryRoot, member, candidate) {
  if (member.object_marker === 'CURRENT_TREE' && member.normalized_location === '.env') {
    const environment = controlledEnvironmentContext(repositoryRoot, member.normalized_location, candidate);
    if (!environment.available) return { source_context_available: false, schema_or_producer_validated: false, source_references: [], consumer_references: [], missing_reason: environment.reason };
    return environment;
  }
  const source = member.object_marker === 'CURRENT_TREE'
    ? safeReadCurrent(repositoryRoot, member.normalized_location)
    : safeReadHistory(repositoryRoot, member.object_marker, member.normalized_location);
  if (!source.available) return {
    source_context_available: false,
    schema_or_producer_validated: false,
    source_references: [],
    consumer_references: [],
    missing_reason: source.reason,
  };
  try {
    const structured = valueContextFromStructuredBuffer(source.buffer, candidate, source.source_key);
    const identifierField = structured.fieldKinds.includes('id');
    const location = member.normalized_location;
    const stableHashContext = selfImprovementStableHashContext(repositoryRoot, member, structured.fieldKinds);
    if (stableHashContext) return stableHashContext;
    if (location.startsWith('runtime/self-improvement/') && identifierField) return {
      source_context_available: true,
      schema_or_producer_validated: true,
      producer_validated: true,
      consumer_validated: true,
      record_kind: 'SELF_IMPROVEMENT_ID',
      source_references: ['apps/backend/src/selfImprovement/store.js createId producer'],
      consumer_references: ['SelfImprovementStore JSON/JSONL serialization contract'],
    };
    if ((location.startsWith('database/agent-token-usage') || location.startsWith('observability/agent-efficiency/')) && identifierField) return {
      source_context_available: true,
      schema_or_producer_validated: true,
      producer_validated: true,
      consumer_validated: true,
      record_kind: 'TOKEN_ECONOMY_CONTENT_ID',
      source_references: ['apps/backend/src/tokenEconomy.js recordAgentTokenUsage producer'],
      consumer_references: ['token-economy JSON/JSONL timeline serialization contract'],
    };
    const directAuthClient = structured.analysis.directAuthClient;
    const secretSchema = structured.analysis.secretSchema;
    return {
      source_context_available: true,
      schema_or_producer_validated: false,
      authentication_consumption: directAuthClient,
      secret_bearing_schema: secretSchema && directAuthClient,
      source_references: structured.structured ? ['structured source parsed; no approved producer contract'] : ['source bytes inspected; no approved structured schema'],
      consumer_references: directAuthClient ? ['authentication-client syntax observed; no approved source-to-value contract'] : [],
      missing_reason: structured.structured ? 'NO_APPROVED_PRODUCER_SCHEMA_CONSUMER_CONTRACT' : 'SOURCE_IS_NOT_A_VALIDATED_STRUCTURED_RECORD',
    };
  } finally { /* cached source buffers are zeroed together after R3 classification */ }
}
function mergeContexts(contexts) {
  const references = (field) => [...new Set(contexts.flatMap((item) => item[field] ?? []))].sort();
  const unavailable = contexts.find((item) => item.source_context_available !== true);
  const first = contexts.find((item) => item.record_kind && item.producer_validated && item.consumer_validated);
  if (first && !unavailable) return { ...first, source_references: references('source_references'), consumer_references: references('consumer_references'), schema_or_producer_validated: true };
  return {
    source_context_available: !unavailable,
    schema_or_producer_validated: contexts.every((item) => item.schema_or_producer_validated === true),
    authentication_consumption: contexts.some((item) => item.authentication_consumption === true),
    secret_bearing_schema: contexts.some((item) => item.secret_bearing_schema === true),
    source_references: references('source_references'),
    consumer_references: references('consumer_references'),
    missing_reason: unavailable?.missing_reason ?? contexts.map((item) => item.missing_reason).filter(Boolean).sort()[0] ?? 'NO_APPROVED_PRODUCER_SCHEMA_CONSUMER_CONTRACT',
  };
}
function selectBoundedEvidenceMember(members) {
  return [...members].sort((left, right) => {
    const rank = (member) => {
      if (member.normalized_location === 'apps/backend/test/operationalSecurity.test.js' && member.object_marker === 'CURRENT_TREE') return 0;
      if (member.object_marker === 'CURRENT_TREE' && member.normalized_location !== '.env' && !member.normalized_location.startsWith('.env.')) return 1;
      if (member.object_marker !== 'CURRENT_TREE' && member.normalized_location !== '.env' && !member.normalized_location.startsWith('.env.')) return 2;
      return 3;
    };
    return rank(left) - rank(right) || left.canonical_occurrence_id.localeCompare(right.canonical_occurrence_id);
  })[0];
}
export function semanticRecord({ group, members, provenanceByCanonical, candidate, repositoryRoot, fixtureContract }) {
  // Exact equality lets one bounded source occurrence establish a candidate's
  // positive path.  It cannot establish a broad negative conclusion, so any
  // non-fixture class without a complete approved contract remains unresolved.
  // One deterministic representative per equality class prevents generated
  // copies from turning source-context inspection into an unbounded replay.
  const context = mergeContexts([contextForMember(repositoryRoot, selectBoundedEvidenceMember(members), candidate)]);
  context.fixture_contract_validated = fixtureContract;
  const result = evaluateSemanticEvidence({ candidate, canonicalMembers: members, context });
  if (result.semantic_state === 'SEMANTICALLY_UNRESOLVED') {
    result.missing_predicates = [...new Set([...result.missing_predicates, context.missing_reason].filter(Boolean))].sort();
  }
  return {
    equivalence_class_id: group.candidate_equivalence_class_id,
    logical_item_id: group.logical_item_id,
    canonical_occurrence_ids: group.canonical_occurrence_ids,
    provenance_membership: countBy(members.map((member) => provenanceByCanonical.get(member.canonical_occurrence_id)), 'origin_class'),
    contributing_rule_ids: [...new Set(members.map((member) => member.rule_id))].sort(),
    semantic_state: result.semantic_state,
    semantic_subtype: result.semantic_subtype,
    proof_or_evidence_path_id: result.proof_or_evidence_path_id,
    proof_family: result.proof_family,
    source_references: result.source_references,
    parser_references: result.parser_references,
    consumer_references: result.consumer_references,
    validator_version: '08A1B-R3-deterministic-semantic-validator-v1',
    validator_result: result.semantic_state === 'SEMANTICALLY_UNRESOLVED' ? 'UNRESOLVED_REPOSITORY_EVIDENCE_INSUFFICIENT' : 'PASS',
    missing_predicates: result.missing_predicates,
    reverse_lineage: 'R2 exact equivalence class -> R3 deterministic semantic state',
  };
}
function fallbackUnresolved(inventory, reason, fixtureContractValidated = false) {
  const canonical = new Map(inventory.canonical_occurrences.map((item) => [item.canonical_occurrence_id, item]));
  const provenance = new Map(inventory.provenance_records.map((item) => [item.canonical_occurrence_id, item]));
  return stable(inventory.candidate_equivalence_classes.map((group) => {
    const members = group.canonical_occurrence_ids.map((id) => canonical.get(id));
    const retainedFixture = fixtureContractValidated && members.some((member) => member.normalized_location === 'apps/backend/test/operationalSecurity.test.js'
      && member.object_marker === 'CURRENT_TREE'
      && member.rule_id === 'generic-api-key'
      && member.safe_line_metadata?.start_line === 27);
    return {
      equivalence_class_id: group.candidate_equivalence_class_id,
      logical_item_id: group.logical_item_id,
      canonical_occurrence_ids: group.canonical_occurrence_ids,
      provenance_membership: countBy(members.map((member) => provenance.get(member.canonical_occurrence_id)), 'origin_class'),
      contributing_rule_ids: [...new Set(members.map((member) => member.rule_id))].sort(),
      semantic_state: retainedFixture ? 'DETERMINISTIC_NON_SECRET' : 'SEMANTICALLY_UNRESOLVED',
      semantic_subtype: retainedFixture ? 'NON_SECRET_IDENTIFIER_OR_FIXTURE' : null,
      proof_or_evidence_path_id: retainedFixture ? 'PATH_A_COMMITTED_SYNTHETIC_FIXTURE_V2' : null,
      proof_family: retainedFixture ? 'DETERMINISTIC_COMMITTED_SYNTHETIC_FIXTURE' : null,
      source_references: retainedFixture ? ['apps/backend/test/operationalSecurity.test.js fixture contract'] : [],
      parser_references: retainedFixture ? ['08A1B-R3 fixture-location validator'] : [],
      consumer_references: retainedFixture ? ['apps/backend/test/operationalSecurity.test.js positive and negative scanner assertions'] : [],
      validator_version: '08A1B-R3-deterministic-semantic-validator-v1',
      validator_result: retainedFixture ? 'PASS' : 'BLOCKED_R2_SOURCE_SNAPSHOT_NOT_REPRODUCIBLE',
      missing_predicates: retainedFixture ? [] : [reason], reverse_lineage: retainedFixture ? 'R2 exact equivalence class -> retained R3 Path A fixture semantic state' : 'R2 exact equivalence class -> R3 blocked semantic state',
    };
  }), 'equivalence_class_id');
}
export function fixtureContract(repositoryRoot) {
  try {
    const lines = readFileSync(path.join(repositoryRoot, 'apps/backend/test/operationalSecurity.test.js'), 'utf8').split(/\r?\n/);
    return lines[26]?.includes('const fakeToken') === true && lines[36]?.includes('assert.doesNotMatch') === true && lines[37]?.includes('/<redacted>/') === true;
  } catch { return false; }
}
export function bridge(inventory, rebuilt) {
  const sameClasses = exactArray(inventory.candidate_equivalence_classes.map((item) => item.candidate_equivalence_class_id), rebuilt.candidate_equivalence_classes.map((item) => item.candidate_equivalence_class_id));
  const sameCanonical = exactArray(inventory.canonical_occurrences.map((item) => item.canonical_occurrence_id), rebuilt.canonical_occurrences.map((item) => item.canonical_occurrence_id));
  const sameMemberships = sameClasses && inventory.candidate_equivalence_classes.every((item) => {
    const current = rebuilt.candidate_equivalence_classes.find((candidate) => candidate.candidate_equivalence_class_id === item.candidate_equivalence_class_id);
    return current && exactArray(item.canonical_occurrence_ids, current.canonical_occurrence_ids);
  });
  return {
    status: sameCanonical && sameClasses && sameMemberships ? 'REPRODUCED_EXACT_R2_MEMBERSHIP' : 'R2_MEMBERSHIP_CHANGED_REBASE_REQUIRED',
    prior_totals: { scan_observations: inventory.totals.scan_observations, canonical_occurrences: inventory.totals.canonical_occurrences, equivalence_classes: inventory.totals.candidate_equivalence_classes },
    reproduced_totals: { scan_observations: rebuilt.totals.scan_observations, canonical_occurrences: rebuilt.totals.canonical_occurrences, equivalence_classes: rebuilt.totals.candidate_equivalence_classes },
    canonical_ids_exact: sameCanonical,
    equivalence_class_ids_exact: sameClasses,
    equivalence_memberships_exact: sameMemberships,
  };
}
export function atomicBridge(inventory) {
  return {
    status: 'ATOMIC_EXACT_R2_MEMBERSHIP',
    prior_totals: null,
    reproduced_totals: { scan_observations: inventory.totals.scan_observations, canonical_occurrences: inventory.totals.canonical_occurrences, equivalence_classes: inventory.totals.candidate_equivalence_classes },
    canonical_ids_exact: true,
    equivalence_class_ids_exact: true,
    equivalence_memberships_exact: true,
  };
}
export function policyMarkdown() {
  return `# 08A1B-R3 semantic classification policy

## Corrected invariant

Exact R2 equality proves only which observations contain equal candidate bytes. It does not prove that a distinct value is a credential. R3 assigns exactly one deterministic semantic state to each R2 equivalence class: \`DETERMINISTIC_NON_SECRET\`, \`POSITIVE_SECRET_CANDIDATE\`, or \`SEMANTICALLY_UNRESOLVED\`.

## Decision rules

- Path A requires exact membership plus an approved producer/schema/parser and consumer contract with a deterministic regression test.
- Positive routing requires a strict full-value parser evaluated only in memory **and** the appropriate secret-bearing schema and privileged-use trace. Provider, owner, and authority are never inferred here.
- Absence of Path A proof remains unresolved. It is never promoted to a positive secret candidate.
- Unresolved classes retain an exact repository source/schema/parser/consumer requirement and never enter an 08A1C provider queue.

## Bounded trusted process

The runner either replays structurally redacted R2 reports against a memory-only raw scanner or derives R2 and R3 atomically from that same memory-only replay. Candidate/source buffers are processed in process memory; reports, candidate bytes, equality tags, fragments, and candidate-derived identifiers are not written. Current-tree and reachable-history context access refuses archive-internal paths, unavailable sources, and files above the bounded context limit. The current \`.env\` may be parsed only in memory to map a candidate to exactly one variable name and an approved local authentication consumer; neither values nor candidate-derived data are written. Buffers are cleared after each context evaluation to the extent Node.js permits.

## Approved Path A families in this implementation

| Family | Deterministic contract |
| --- | --- |
| Committed synthetic fixture | Exact fixture location plus committed positive/negative scanner assertions |
| Self-improvement identifier | Strict generated identifier grammar, \`createId\` producer, and JSON/JSONL serialization contract |
| Self-improvement pattern key | Exact \`patternKey\` field, strict 24-hex stable-hash grammar, aggregator producer, and pattern consumers |
| Self-improvement tool-plan key | Exact \`normalizedKey\` field, strict 24-hex stable-hash grammar, tool-plan producer, and duplicate-suppression consumer |
| Token-economy content identifier | Strict content-ID grammar, token-economy producer, and timeline serialization contract |
| Integrity digest | Strict SHA-256 grammar plus an approved integrity producer and consumer contract |

No path/origin, field name, rule label, entropy score, or missing Path A proof is a semantic proof by itself.
`;
}
export function precisionMarkdown(classification, inventory) {
  const byClass = new Map(classification.classes.map((item) => [item.equivalence_class_id, item]));
  const canonicalById = new Map(inventory.canonical_occurrences.map((item) => [item.canonical_occurrence_id, item]));
  const rows = new Map();
  for (const group of inventory.candidate_equivalence_classes) {
    const item = byClass.get(group.candidate_equivalence_class_id);
    const rules = [...new Set(group.canonical_occurrence_ids.map((id) => canonicalById.get(id).rule_id))];
    for (const rule of rules) {
      const row = rows.get(rule) ?? { rule, observations: 0, classes: 0, deterministic_non_secret: 0, positive_secret_candidate: 0, semantically_unresolved: 0 };
      row.classes += 1; row.observations += group.canonical_occurrence_ids.map((id) => canonicalById.get(id).contributing_observation_ids.length).reduce((a, b) => a + b, 0);
      if (item.semantic_state === 'DETERMINISTIC_NON_SECRET') row.deterministic_non_secret += 1;
      else if (item.semantic_state === 'POSITIVE_SECRET_CANDIDATE') row.positive_secret_candidate += 1;
      else row.semantically_unresolved += 1;
      rows.set(rule, row);
    }
  }
  return `# 08A1B-R3 scanner-rule precision summary

Each row reports current R2 equality classes that contain the rule. A rule may contribute to more than one observation in the same class; this document does not treat a scanner match as secret semantics.

| Rule | Detection contract | Semantic assertion | Strict parser | Deterministic non-secret | Positive candidate | Unresolved | Classes | Observations | Contextual hardening |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
${stable([...rows.values()], 'rule').map((row) => { const spec = ruleSemanticsFor(row.rule); return `| ${row.rule} | ${spec.detector_contract} | ${spec.semantic_assertion} | ${spec.parser} | ${row.deterministic_non_secret} | ${row.positive_secret_candidate} | ${row.semantically_unresolved} | ${row.classes} | ${row.observations} | ${spec.hardening} |`; }).join('\n')}

## Synthetic precision suite

\`scripts/test-08a1b-r3-semantic-triage.mjs\` verifies synthetic generated identifiers, a generic key-like value without a producer contract, a provider-shaped value without authentication context, and a provider-shaped value with a strict parser plus secret-bearing authentication context. It also verifies that every contributing scanner rule has an explicit semantic contract. No real credential is used or persisted.
`;
}
export function classificationMarkdown(classification) {
  const totals = classification.totals;
  const missing = Object.entries(totals.unresolved_by_missing_predicate).map(([key, value]) => `| ${key} | ${value} |`).join('\n') || '| None | 0 |';
  return `# 08A1B-R3 semantic classification

## Outcome

${classification.semantic_gate.status === 'PASS' ? 'PASS — every equality class has a validated semantic route.' : 'BLOCKED — one or more classes remain semantically unresolved; no provider or authority action is eligible for those classes.'}

| Measure | Count |
| --- | ---: |
| R2 equivalence classes | ${totals.equivalence_classes} |
| Deterministic non-secret | ${totals.deterministic_non_secret} |
| Positive secret candidate | ${totals.positive_secret_candidate} |
| Semantically unresolved | ${totals.semantically_unresolved} |
| Active 08A1C external actions | ${totals.active_08a1c_actions} |

## Exact unresolved repository requirements

| Missing predicate | Classes |
| --- | ---: |
${missing}
`;
}
async function write(target, content) { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, 'utf8'); }

export function exactR2Membership(status) {
  return status === 'REPRODUCED_EXACT_R2_MEMBERSHIP' || status === 'ATOMIC_EXACT_R2_MEMBERSHIP';
}

export function buildSemanticClassification({ inventory, inventoryText, reviewedAt, sourceReplay, reproduction, classes, replayMode = 'STRUCTURALLY_REDACTED_R2_REPORTS_PLUS_MEMORY_ONLY_RAW_REPLAY' }) {
  if (classes.length !== inventory.candidate_equivalence_classes.length) fail('R3 must produce exactly one semantic state for every R2 equivalence class.');
  const stateCounts = countBy(classes, 'semantic_state');
  const unresolvedByMissingPredicate = countBy(classes.filter((item) => item.semantic_state === 'SEMANTICALLY_UNRESOLVED').flatMap((item) => item.missing_predicates), (value) => value);
  const totals = {
    equivalence_classes: classes.length,
    deterministic_non_secret: stateCounts.DETERMINISTIC_NON_SECRET ?? 0,
    positive_secret_candidate: stateCounts.POSITIVE_SECRET_CANDIDATE ?? 0,
    semantically_unresolved: stateCounts.SEMANTICALLY_UNRESOLVED ?? 0,
    deterministic_non_secret_by_proof_family: countBy(classes.filter((item) => item.semantic_state === 'DETERMINISTIC_NON_SECRET'), 'proof_family'),
    positive_by_subtype: countBy(classes.filter((item) => item.semantic_state === 'POSITIVE_SECRET_CANDIDATE'), 'semantic_subtype'),
    unresolved_by_missing_predicate: unresolvedByMissingPredicate,
    active_08a1c_actions: 0,
  };
  const exactMembership = exactR2Membership(reproduction.status);
  const classification = {
    schema_version: SEMANTIC_SCHEMA,
    reviewed_at: reviewedAt,
    source_r2_inventory: { run_id: inventory.run_id, schema_version: inventory.schema_version, content_checksum_sha256: sha(inventoryText), equality_method: inventory.reconstruction?.candidate_equality },
    source_replay: { mode: replayMode, result: sourceReplay, r2_bridge: reproduction },
    policy: {
      absence_of_path_a_is_not_positive_secret_evidence: true,
      semantic_state_is_exactly_one_per_equivalence_class: true,
      unresolved_items_have_no_provider_or_authority_action: true,
      candidate_bytes_persisted: false,
    },
    classes,
    totals,
    semantic_gate: {
      status: totals.semantically_unresolved === 0 && exactMembership ? 'PASS' : 'BLOCKED',
      blocking_reason: totals.semantically_unresolved === 0 && exactMembership ? null : 'SEMANTICALLY_UNRESOLVED_CLASSES_OR_UNREPRODUCED_R2_SOURCE_SNAPSHOT',
      corrected_08a1c_status: totals.semantically_unresolved === 0 && exactMembership ? 'ELIGIBLE_FOR_POSITIVE_SECRET_CANDIDATES_ONLY' : 'NOT_ELIGIBLE_SEMANTIC_TRIAGE_BLOCKED',
      full_08a1d_status: totals.semantically_unresolved === 0 && exactMembership ? 'ELIGIBLE_TO_RUN' : 'NOT_RUN_SEMANTIC_GATE_BLOCKED',
    },
  };
  if (!noCandidateBearingData(classification)) fail('R3 classification would persist prohibited candidate-bearing data.');
  return classification;
}

async function main() {
  const repositoryRoot = path.resolve(required('--repository-root'));
  const inventoryPath = required('--inventory');
  const reviewedAt = required('--reviewed-at'); if (!ISO.test(reviewedAt) || !Number.isFinite(Date.parse(reviewedAt))) fail('R3 requires an explicit ISO UTC review timestamp.');
  const inventoryText = await readFile(inventoryPath, 'utf8'); const inventory = JSON.parse(inventoryText);
  if (inventory?.schema_version !== R2_SCHEMA || !Array.isArray(inventory?.candidate_equivalence_classes)) fail('R3 requires an R2 logical credential inventory.');
  if (!noCandidateBearingData(inventory)) fail('R3 rejects an unsafe R2 input representation.');
  const reports = inventory.reconstruction?.source_report_paths?.map((relative) => path.join(repositoryRoot, relative)) ?? [];
  if (reports.length === 0) fail('R3 requires R2 structural source-report paths.');
  let classes = []; let reproduction; let sourceReplay = 'NOT_RUN';
  try {
    const sourceSets = await readSanitizedReports(reports);
    const rawRowsByScope = await liveRawRowsForReports(repositoryRoot, sourceSets, { commitBoundary: inventory.reconstruction?.commit_boundary });
    const captured = [];
    let rebuilt;
    try {
      rebuilt = buildR2Inventory({
        sourceSets,
        rawRowsByScope,
        runId: inventory.run_id,
        pathAFixtureSourceValidated: fixtureContract(repositoryRoot),
        provenance: {
          reviewed_at: inventory.reviewed_at,
          scanner_version_or_digest: inventory.reconstruction?.scanner_version_or_digest,
          scanner_config_sha256: inventory.reconstruction?.scanner_config_sha256,
          commit_boundary: inventory.reconstruction?.commit_boundary,
          input_snapshot: inventory.reconstruction?.input_snapshot,
        },
        onMemoryReconstructed: ({ canonical_occurrences, candidate_equivalence_classes, provenance_records, candidate_by_canonical_id }) => {
          const canonicalById = new Map(canonical_occurrences.map((item) => [item.canonical_occurrence_id, item]));
          const provenanceByCanonical = new Map(provenance_records.map((item) => [item.canonical_occurrence_id, item]));
          for (const group of candidate_equivalence_classes) {
            const candidate = candidate_by_canonical_id.get(group.canonical_occurrence_ids[0]);
            if (!candidate) continue;
            captured.push(semanticRecord({ group, members: group.canonical_occurrence_ids.map((id) => canonicalById.get(id)), provenanceByCanonical, candidate, repositoryRoot, fixtureContract: fixtureContract(repositoryRoot) }));
          }
        },
      });
    } finally { clearSemanticSourceBuffers(); }
    reproduction = bridge(inventory, rebuilt); sourceReplay = 'COMPLETED_MEMORY_ONLY';
    classes = reproduction.status === 'REPRODUCED_EXACT_R2_MEMBERSHIP'
      ? stable(captured, 'equivalence_class_id')
      : fallbackUnresolved(inventory, 'R2_MEMBERSHIP_CHANGED_REBASE_REQUIRED', fixtureContract(repositoryRoot));
  } catch {
    reproduction = { status: 'R2_SOURCE_SNAPSHOT_NOT_REPRODUCIBLE', prior_totals: { scan_observations: inventory.totals.scan_observations, canonical_occurrences: inventory.totals.canonical_occurrences, equivalence_classes: inventory.totals.candidate_equivalence_classes }, reproduced_totals: null, canonical_ids_exact: false, equivalence_class_ids_exact: false, equivalence_memberships_exact: false };
    classes = fallbackUnresolved(inventory, 'FROZEN_R2_RAW_CORRELATION_REPRODUCTION_REQUIRED', fixtureContract(repositoryRoot));
    sourceReplay = 'FAILED_CLOSED_NO_RAW_OUTPUT';
  }
  const classification = buildSemanticClassification({ inventory, inventoryText, reviewedAt, sourceReplay, reproduction, classes });
  await Promise.all([
    write(required('--output-classification'), `${JSON.stringify(classification, null, 2)}\n`),
    write(required('--output-policy'), policyMarkdown()),
    ...(arg('--output-policy-secondary') ? [write(arg('--output-policy-secondary'), policyMarkdown())] : []),
    write(required('--output-precision'), precisionMarkdown(classification, inventory)),
    write(required('--output-summary'), classificationMarkdown(classification)),
  ]);
  process.stdout.write(`08A1B-R3 semantic triage: ${classification.totals.deterministic_non_secret} deterministic non-secret, ${classification.totals.positive_secret_candidate} positive secret candidate, ${classification.totals.semantically_unresolved} unresolved; ${classification.semantic_gate.status}.\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`08A1B-R3 semantic triage failed: ${error.message}\n`); process.exitCode = 1; });
