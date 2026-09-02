#!/usr/bin/env node

import assert from 'node:assert/strict';
import { DETERMINISTIC_PATH_A_IDS, evaluateSemanticEvidence, noCandidateBearingData, ruleSemanticsFor } from './08a1b-r3-semantic-lib.mjs';
import { controlledEnvironmentContextFromBuffer } from './run-08a1b-r3-semantic-triage.mjs';

const member = { normalized_location: 'safe-fixture.json', object_marker: 'CURRENT_TREE', rule_id: 'generic-api-key', safe_line_metadata: { start_line: 1 } };
const generatedId = Buffer.from(`si_${'123e4567-e89b-42d3-a456-426614174000'}`, 'utf8');
const idResult = evaluateSemanticEvidence({ candidate: generatedId, canonicalMembers: [member], context: { source_context_available: true, schema_or_producer_validated: true, producer_validated: true, consumer_validated: true, record_kind: 'SELF_IMPROVEMENT_ID' } });
assert.equal(idResult.semantic_state, 'DETERMINISTIC_NON_SECRET');

const patternKey = Buffer.from('a'.repeat(24), 'utf8');
const patternKeyResult = evaluateSemanticEvidence({ candidate: patternKey, canonicalMembers: [member], context: {
  source_context_available: true, schema_or_producer_validated: true, producer_validated: true, consumer_validated: true,
  record_kind: 'SELF_IMPROVEMENT_PATTERN_KEY', source_references: ['synthetic patternKey field and stable-hash producer'], consumer_references: ['synthetic pattern-key consumer'],
} });
assert.equal(patternKeyResult.semantic_state, 'DETERMINISTIC_NON_SECRET');
assert.equal(patternKeyResult.proof_or_evidence_path_id, 'PATH_A_SELF_IMPROVEMENT_PATTERN_KEY_V1');
const planKeyResult = evaluateSemanticEvidence({ candidate: patternKey, canonicalMembers: [member], context: {
  source_context_available: true, schema_or_producer_validated: true, producer_validated: true, consumer_validated: true,
  record_kind: 'SELF_IMPROVEMENT_TOOL_PLAN_KEY', source_references: ['synthetic normalizedKey field and stable-hash producer'], consumer_references: ['synthetic duplicate-suppression consumer'],
} });
assert.equal(planKeyResult.semantic_state, 'DETERMINISTIC_NON_SECRET');
const malformedStableKey = Buffer.from('g'.repeat(24), 'utf8');
assert.equal(evaluateSemanticEvidence({ candidate: malformedStableKey, canonicalMembers: [member], context: { source_context_available: true, schema_or_producer_validated: true, producer_validated: true, consumer_validated: true, record_kind: 'SELF_IMPROVEMENT_PATTERN_KEY' } }).semantic_state, 'SEMANTICALLY_UNRESOLVED');

const genericLike = Buffer.from(`value_${'x'.repeat(32)}`, 'utf8');
const genericResult = evaluateSemanticEvidence({ candidate: genericLike, canonicalMembers: [member], context: { source_context_available: true, schema_or_producer_validated: false } });
assert.equal(genericResult.semantic_state, 'SEMANTICALLY_UNRESOLVED', 'A generic key-like value without a source contract cannot be promoted.');

const providerLike = Buffer.from(['A', 'I', 'z', 'a'].join('') + 'x'.repeat(35), 'utf8');
const providerWithoutUse = evaluateSemanticEvidence({ candidate: providerLike, canonicalMembers: [member], context: { source_context_available: true, schema_or_producer_validated: true, secret_bearing_schema: true, authentication_consumption: false } });
assert.equal(providerWithoutUse.semantic_state, 'SEMANTICALLY_UNRESOLVED', 'Provider structure without authentication context cannot be positive.');
const providerWithUse = evaluateSemanticEvidence({ candidate: providerLike, canonicalMembers: [member], context: { source_context_available: true, schema_or_producer_validated: true, secret_bearing_schema: true, authentication_consumption: true, source_references: ['synthetic auth source'], consumer_references: ['synthetic auth consumer'] } });
assert.equal(providerWithUse.semantic_state, 'POSITIVE_SECRET_CANDIDATE');
assert.equal(providerWithUse.semantic_subtype, 'PROVIDER_CREDENTIAL_CANDIDATE');

const environmentCandidate = Buffer.from(`apify_api_${'x'.repeat(24)}`, 'utf8');
const environmentBuffer = Buffer.from(`APIFY_API_KEY=${environmentCandidate.toString('utf8')}\nUNKNOWN_KEY=not-a-secret\n`, 'utf8');
const approvedEnvironment = controlledEnvironmentContextFromBuffer(environmentBuffer, environmentCandidate, (name) => name === 'APIFY_API_KEY' ? ['synthetic authenticated consumer'] : []);
assert.equal(approvedEnvironment.authentication_consumption, true);
assert.equal(approvedEnvironment.generic_secret_parser, true);
assert.equal(evaluateSemanticEvidence({ candidate: environmentCandidate, canonicalMembers: [member], context: approvedEnvironment }).semantic_state, 'POSITIVE_SECRET_CANDIDATE');
const unknownEnvironment = controlledEnvironmentContextFromBuffer(Buffer.from(`UNKNOWN_KEY=${environmentCandidate.toString('utf8')}\n`, 'utf8'), environmentCandidate, () => []);
assert.equal(evaluateSemanticEvidence({ candidate: environmentCandidate, canonicalMembers: [member], context: unknownEnvironment }).semantic_state, 'SEMANTICALLY_UNRESOLVED');
const ambiguousEnvironment = controlledEnvironmentContextFromBuffer(Buffer.from(`FIRST_KEY=${environmentCandidate.toString('utf8')}\nSECOND_KEY=${environmentCandidate.toString('utf8')}\n`, 'utf8'), environmentCandidate, () => []);
assert.equal(ambiguousEnvironment.available, false);
assert.equal(evaluateSemanticEvidence({ candidate: environmentCandidate, canonicalMembers: [member], context: ambiguousEnvironment }).semantic_state, 'SEMANTICALLY_UNRESOLVED');
const malformedEnvironment = controlledEnvironmentContextFromBuffer(Buffer.from('APIFY_API_KEY=malformed-value\n', 'utf8'), Buffer.from('malformed-value', 'utf8'), () => ['synthetic authenticated consumer']);
assert.equal(malformedEnvironment.generic_secret_parser, false);
assert.equal(evaluateSemanticEvidence({ candidate: Buffer.from('malformed-value', 'utf8'), canonicalMembers: [member], context: malformedEnvironment }).semantic_state, 'SEMANTICALLY_UNRESOLVED');

for (const rule of ['aws-access-token', 'gcp-api-key', 'generic-api-key', 'linkedin-client-id', 'openai-api-key', 'plutomix-fake-secret']) {
  const spec = ruleSemanticsFor(rule); assert.ok(spec.detector_contract && spec.semantic_assertion && spec.parser && spec.hardening, `${rule} needs a deterministic rule contract`);
}
assert.equal(noCandidateBearingData({ semantic_state: 'SEMANTICALLY_UNRESOLVED', missing_predicates: ['SOURCE_SCHEMA_OR_DETERMINISTIC_PRODUCER_CONTRACT_REQUIRED'] }), true);
assert.ok(DETERMINISTIC_PATH_A_IDS.has(patternKeyResult.proof_or_evidence_path_id));
assert.equal(JSON.stringify({ patternKeyResult, planKeyResult, approvedEnvironment, unknownEnvironment, malformedEnvironment }).includes(environmentCandidate.toString('utf8')), false, 'sanitized records never disclose synthetic candidate bytes.');

for (const value of [generatedId, patternKey, malformedStableKey, genericLike, providerLike, environmentCandidate, environmentBuffer]) value.fill(0);
console.log('08A1B-R3 semantic parser, stable-hash Path A, controlled-environment context, contextual-positive, unresolved, rule-contract, and non-disclosure tests passed.');
