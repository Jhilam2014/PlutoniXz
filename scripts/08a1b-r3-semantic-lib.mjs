/**
 * Deterministic semantic policy helpers for 08A1B-R3.
 *
 * These helpers deliberately receive a complete candidate only in memory. They
 * return source/schema/consumer *categories*, never the candidate or a
 * candidate-derived identifier. A broad scanner match is therefore not a
 * positive secret assertion.
 */
import { timingSafeEqual } from 'node:crypto';

export const SEMANTIC_SCHEMA = '08A1B-R3-semantic-classification-v1';
export const SEMANTIC_STATES = new Set([
  'DETERMINISTIC_NON_SECRET',
  'POSITIVE_SECRET_CANDIDATE',
  'SEMANTICALLY_UNRESOLVED',
]);
export const POSITIVE_SUBTYPES = new Set([
  'PROVIDER_CREDENTIAL_CANDIDATE',
  'GENERIC_APPLICATION_SECRET_CANDIDATE',
  'AUTH_SESSION_OR_SIGNING_MATERIAL_CANDIDATE',
]);
export const DETERMINISTIC_PATH_A_IDS = new Set([
  'PATH_A_COMMITTED_SYNTHETIC_FIXTURE_V2',
  'PATH_A_SELF_IMPROVEMENT_RUNTIME_IDENTIFIER_V1',
  'PATH_A_TOKEN_ECONOMY_CONTENT_IDENTIFIER_V1',
  'PATH_A_REPOSITORY_INTEGRITY_DIGEST_V1',
  'PATH_A_STRUCTURED_UUID_IDENTIFIER_V1',
  'PATH_A_SELF_IMPROVEMENT_PATTERN_KEY_V1',
  'PATH_A_SELF_IMPROVEMENT_TOOL_PLAN_KEY_V1',
]);

export const RULE_SEMANTICS = Object.freeze({
  'aws-access-token': {
    detector_contract: 'Provider-shaped access-key material; scanner match alone does not establish authentication use.',
    semantic_assertion: 'PROVIDER_STRUCTURE_ONLY',
    parser: 'STRICT_AWS_ACCESS_KEY_ID',
    hardening: 'Require a strict parser plus a repository authentication-client or credential-store consumption trace.',
  },
  'gcp-api-key': {
    detector_contract: 'Google API-key-shaped string; scanner match alone does not establish use or scope.',
    semantic_assertion: 'PROVIDER_STRUCTURE_ONLY',
    parser: 'STRICT_GOOGLE_API_KEY',
    hardening: 'Require a strict parser plus a repository authentication-client or secret-configuration consumption trace.',
  },
  'generic-api-key': {
    detector_contract: 'Broad key/value string shape; it makes no secret, provider, or authentication-semantic assertion.',
    semantic_assertion: 'BROAD_STRING_SHAPE_ONLY',
    parser: 'NO_GENERIC_CREDENTIAL_PARSER',
    hardening: 'Require a source schema that marks the field secret-bearing and a privileged-use consumption trace.',
  },
  'linkedin-client-id': {
    detector_contract: 'Client/application identifier shape; it is not a client secret assertion.',
    semantic_assertion: 'PUBLIC_IDENTIFIER_OR_STRUCTURE_ONLY',
    parser: 'STRICT_LINKEDIN_CLIENT_IDENTIFIER',
    hardening: 'Require a schema/consumer distinction between a public client ID and a client secret before positive routing.',
  },
  'openai-api-key': {
    detector_contract: 'OpenAI-key-shaped string; scanner match alone does not establish authentication use, account, or project scope.',
    semantic_assertion: 'PROVIDER_STRUCTURE_ONLY',
    parser: 'STRICT_OPENAI_KEY',
    hardening: 'Require a strict parser plus a repository authentication-client, secret configuration, or credential-store consumption trace.',
  },
  'plutomix-fake-secret': {
    detector_contract: 'Repository-defined synthetic fixture marker.',
    semantic_assertion: 'SYNTHETIC_FIXTURE_MARKER',
    parser: 'DETERMINISTIC_TEST_FIXTURE_CONTRACT',
    hardening: 'Require the exact committed fixture producer and its positive/negative scanner regression assertions.',
  },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SELF_IMPROVEMENT_ID = /^si_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_ECONOMY_ID = /^[0-9a-f]{24}$/i;
// This grammar is intentionally separate from a provider credential parser.
// The two Path A contracts below prove that these values are truncated local
// SHA-256 identifiers, not merely that they happen to have 24 hex characters.
const STABLE_HASH_IDENTIFIER = /^[0-9a-f]{24}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const AWS_ACCESS_KEY_ID = /^AKIA[0-9A-Z]{16}$/;
const GOOGLE_API_KEY = /^AIza[0-9A-Za-z_-]{35}$/;
const OPENAI_API_KEY = /^sk-(?:proj-)?[A-Za-z0-9_-]{20,}$/;

function exact(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right) || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function nonSecret(proofId, proofFamily, sourceReferences, parserReferences, consumerReferences) {
  return {
    semantic_state: 'DETERMINISTIC_NON_SECRET',
    semantic_subtype: 'NON_SECRET_IDENTIFIER_OR_FIXTURE',
    proof_or_evidence_path_id: proofId,
    proof_family: proofFamily,
    source_references: sourceReferences,
    parser_references: parserReferences,
    consumer_references: consumerReferences,
    missing_predicates: [],
  };
}

function positive(subtype, pathId, sourceReferences, parserReferences, consumerReferences) {
  return {
    semantic_state: 'POSITIVE_SECRET_CANDIDATE',
    semantic_subtype: subtype,
    proof_or_evidence_path_id: pathId,
    proof_family: null,
    source_references: sourceReferences,
    parser_references: parserReferences,
    consumer_references: consumerReferences,
    missing_predicates: [],
  };
}

function unresolved(missingPredicates, sourceReferences = [], parserReferences = [], consumerReferences = []) {
  return {
    semantic_state: 'SEMANTICALLY_UNRESOLVED',
    semantic_subtype: null,
    proof_or_evidence_path_id: null,
    proof_family: null,
    source_references: sourceReferences,
    parser_references: parserReferences,
    consumer_references: consumerReferences,
    missing_predicates: [...new Set(missingPredicates)].sort(),
  };
}

function parserKind(candidate) {
  const value = candidate.toString('utf8');
  if (AWS_ACCESS_KEY_ID.test(value)) return 'STRICT_AWS_ACCESS_KEY_ID';
  if (GOOGLE_API_KEY.test(value)) return 'STRICT_GOOGLE_API_KEY';
  if (OPENAI_API_KEY.test(value)) return 'STRICT_OPENAI_KEY';
  return null;
}

/**
 * Classify one in-memory candidate against a deterministic context contract.
 * The caller owns candidate/context lifetime and must not serialize either.
 */
export function evaluateSemanticEvidence({ candidate, canonicalMembers, context }) {
  const safeContext = context ?? {};
  const members = canonicalMembers ?? [];
  const fixture = members.some((member) => member.normalized_location === 'apps/backend/test/operationalSecurity.test.js'
    && member.object_marker === 'CURRENT_TREE'
    && member.rule_id === 'generic-api-key'
    && member.safe_line_metadata?.start_line === 27);
  if (fixture && safeContext.fixture_contract_validated === true) {
    return nonSecret(
      'PATH_A_COMMITTED_SYNTHETIC_FIXTURE_V2',
      'DETERMINISTIC_COMMITTED_SYNTHETIC_FIXTURE',
      ['apps/backend/test/operationalSecurity.test.js fixture contract'],
      ['08A1B-R3 fixture-location validator'],
      ['apps/backend/test/operationalSecurity.test.js positive and negative scanner assertions'],
    );
  }

  if (safeContext.record_kind === 'SELF_IMPROVEMENT_ID' && SELF_IMPROVEMENT_ID.test(candidate.toString('utf8')) && safeContext.producer_validated && safeContext.consumer_validated) {
    return nonSecret(
      'PATH_A_SELF_IMPROVEMENT_RUNTIME_IDENTIFIER_V1',
      'GENERATED_RUNTIME_IDENTIFIER',
      ['apps/backend/src/selfImprovement/store.js createId producer'],
      ['self-improvement JSON/JSONL record identifier field contract'],
      ['SelfImprovementStore append/write JSON serialization contract'],
    );
  }
  if (safeContext.record_kind === 'TOKEN_ECONOMY_CONTENT_ID' && TOKEN_ECONOMY_ID.test(candidate.toString('utf8')) && safeContext.producer_validated && safeContext.consumer_validated) {
    return nonSecret(
      'PATH_A_TOKEN_ECONOMY_CONTENT_IDENTIFIER_V1',
      'GENERATED_CONTENT_IDENTIFIER',
      ['apps/backend/src/tokenEconomy.js recordAgentTokenUsage producer'],
      ['token-economy JSON/JSONL identifier field contract'],
      ['token-economy timeline serialization contract'],
    );
  }
  if (safeContext.record_kind === 'SELF_IMPROVEMENT_PATTERN_KEY' && STABLE_HASH_IDENTIFIER.test(candidate.toString('utf8')) && safeContext.producer_validated && safeContext.consumer_validated) {
    return nonSecret(
      'PATH_A_SELF_IMPROVEMENT_PATTERN_KEY_V1',
      'GENERATED_STABLE_HASH_IDENTIFIER',
      safeContext.source_references ?? ['self-improvement pattern-key producer'],
      ['strict 24-hex truncated SHA-256 identifier grammar'],
      safeContext.consumer_references ?? ['self-improvement pattern-key consumer'],
    );
  }
  if (safeContext.record_kind === 'SELF_IMPROVEMENT_TOOL_PLAN_KEY' && STABLE_HASH_IDENTIFIER.test(candidate.toString('utf8')) && safeContext.producer_validated && safeContext.consumer_validated) {
    return nonSecret(
      'PATH_A_SELF_IMPROVEMENT_TOOL_PLAN_KEY_V1',
      'GENERATED_STABLE_HASH_IDENTIFIER',
      safeContext.source_references ?? ['self-improvement tool-plan-key producer'],
      ['strict 24-hex truncated SHA-256 identifier grammar'],
      safeContext.consumer_references ?? ['self-improvement tool-plan-key consumer'],
    );
  }
  if (safeContext.record_kind === 'SHA256_INTEGRITY_DIGEST' && SHA256.test(candidate.toString('utf8')) && safeContext.producer_validated && safeContext.consumer_validated) {
    return nonSecret(
      'PATH_A_REPOSITORY_INTEGRITY_DIGEST_V1',
      'INTEGRITY_DIGEST',
      safeContext.source_references ?? ['repository integrity producer'],
      ['strict SHA-256 grammar parser'],
      safeContext.consumer_references ?? ['integrity metadata consumer'],
    );
  }
  if (safeContext.record_kind === 'UUID_IDENTIFIER' && UUID.test(candidate.toString('utf8')) && safeContext.producer_validated && safeContext.consumer_validated) {
    return nonSecret(
      'PATH_A_STRUCTURED_UUID_IDENTIFIER_V1',
      'STRUCTURED_NON_AUTH_IDENTIFIER',
      safeContext.source_references ?? ['structured record producer'],
      ['strict UUID grammar parser'],
      safeContext.consumer_references ?? ['structured record consumer'],
    );
  }

  const strictParser = parserKind(candidate);
  if (strictParser && safeContext.authentication_consumption === true && safeContext.secret_bearing_schema === true) {
    return positive(
      'PROVIDER_CREDENTIAL_CANDIDATE',
      `POSITIVE_${strictParser}_WITH_AUTHENTICATION_CONTEXT_V1`,
      safeContext.source_references ?? ['repository authentication source'],
      [strictParser, 'strict full-value grammar evaluated only in memory'],
      safeContext.consumer_references ?? ['repository authentication/authorization consumer'],
    );
  }
  if (safeContext.sensitive_material_parser === true && safeContext.authentication_consumption === true && safeContext.secret_bearing_schema === true) {
    return positive(
      'AUTH_SESSION_OR_SIGNING_MATERIAL_CANDIDATE',
      'POSITIVE_SENSITIVE_MATERIAL_WITH_PRIVILEGED_USE_CONTEXT_V1',
      safeContext.source_references ?? ['repository sensitive-material source'],
      safeContext.parser_references ?? ['strict sensitive-material parser'],
      safeContext.consumer_references ?? ['repository signing/session/authentication consumer'],
    );
  }
  if (safeContext.secret_bearing_schema === true && safeContext.authentication_consumption === true && safeContext.generic_secret_parser === true) {
    return positive(
      'GENERIC_APPLICATION_SECRET_CANDIDATE',
      'POSITIVE_SECRET_CONFIGURATION_WITH_PRIVILEGED_USE_CONTEXT_V1',
      safeContext.source_references ?? ['repository secret-bearing configuration source'],
      safeContext.parser_references ?? ['strict application-secret parser'],
      safeContext.consumer_references ?? ['repository privileged-use consumer'],
    );
  }

  const missing = [];
  if (safeContext.source_context_available !== true) missing.push('ORIGINAL_SOURCE_OR_HISTORY_CONTEXT_REQUIRES_BOUNDED_RETRIEVAL');
  if (safeContext.schema_or_producer_validated !== true) missing.push('SOURCE_SCHEMA_OR_DETERMINISTIC_PRODUCER_CONTRACT_REQUIRED');
  if (strictParser && safeContext.authentication_consumption !== true) missing.push('AUTHENTICATION_OR_PRIVILEGED_CONSUMPTION_TRACE_REQUIRED');
  if (!strictParser && safeContext.non_secret_proof_available !== true) missing.push('EXACT_SOURCE_SCHEMA_PARSER_AND_CONSUMER_SEMANTICS_REQUIRED');
  if (safeContext.source_context_available === true && safeContext.schema_or_producer_validated === true && safeContext.authentication_consumption !== true && !safeContext.non_secret_proof_available) missing.push('NO_VALID_PATH_A_OR_POSITIVE_SECRET_EVIDENCE_PATH');
  return unresolved(missing, safeContext.source_references ?? [], strictParser ? [strictParser] : [], safeContext.consumer_references ?? []);
}

export function ruleSemanticsFor(ruleId) {
  return RULE_SEMANTICS[ruleId] ?? {
    detector_contract: 'Scanner rule is present in the pinned default detector set; rule semantics require an explicit local parser contract before classification.',
    semantic_assertion: 'UNSPECIFIED_SCANNER_SHAPE_ONLY',
    parser: 'NO_APPROVED_PARSER',
    hardening: 'Add a strict parser and contextual consumer contract before any positive-secret routing.',
  };
}

export function noCandidateBearingData(value) {
  const prohibited = /^(?:secret|match|authorization|token_value|credential_value|replacement_value|raw_value|candidate_tag|equality_tag)$/i;
  const candidateShape = /(?:apify_api|sk-(?:proj-)?|AIza|AKIA|xox[abprs])[_-]?[A-Za-z0-9]{12,}|(?:api[_-]?key|token)\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i;
  if (typeof value === 'string') return !candidateShape.test(value);
  if (Array.isArray(value)) return value.every(noCandidateBearingData);
  return !value || typeof value !== 'object' || Object.entries(value).every(([key, nested]) => !prohibited.test(key) && noCandidateBearingData(nested));
}

export function sameBuffer(left, right) { return exact(left, right); }
