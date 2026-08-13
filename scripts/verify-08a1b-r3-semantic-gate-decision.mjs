#!/usr/bin/env node

/** Fail-closed verifier for the value-free final R3 evidence-gap decision. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { noCandidateBearingData } from './08a1b-r3-semantic-lib.mjs';

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}.`); return value; }
function fail(code, message) { const error = new Error(`${code}: ${message}`); error.code = code; throw error; }
function signature(predicates) { return [...predicates].sort().join('|'); }
function mapCounts(groups) { return new Map(groups.map((group) => [signature(group.missing_predicates), group.class_count])); }
const forbiddenKey = /(?:^|_)(?:hash|tag|fragment)(?:_|$)|(?:candidate|class|logical|canonical|observation)(?:_[a-z0-9]+)*_(?:fragment|hash|tag|identifier|id)$/i;
const forbiddenString = /(?:apify_api|sk-(?:proj-)?|AIza|AKIA|xox[abprs])[_-]?[A-Za-z0-9]{12,}|(?:api[_-]?key|token)\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}|\b[a-f0-9]{24,}\b/i;

function containsForbiddenDerivedMaterial(value) {
  if (typeof value === 'string') return forbiddenString.test(value);
  if (Array.isArray(value)) return value.some(containsForbiddenDerivedMaterial);
  return value && typeof value === 'object' && Object.entries(value).some(([key, nested]) => forbiddenKey.test(key) || containsForbiddenDerivedMaterial(nested));
}

export function validateSemanticGateDecision({ r3, r4Status, r4Manifest, r4Authority, gate, decision, markdown }) {
  if (decision?.schema_version !== '08A1B-R3-semantic-gate-evidence-gap-decision-v1') fail('DECISION_SCHEMA_MISMATCH', 'Unsupported decision schema.');
  if (!noCandidateBearingData({ decision, markdown }) || containsForbiddenDerivedMaterial({ decision, markdown })) fail('DECISION_DISCLOSURE_DETECTED', 'Published decision data contains candidate-bearing or candidate-derived material.');
  if (decision.execution_status !== 'PASS' || decision.semantic_gate_status !== 'BLOCKED' || decision.semantic_gate_reason_code !== 'SEMANTIC_GATE_UNRESOLVED_CLASSES_REQUIRE_AUTHORIZED_EVIDENCE' || decision.overall_disposition !== 'BLOCKED_PASS' || decision.decision !== 'ACCEPT_BLOCKED_PASS' || decision.decision_outcome !== 'ACCEPTED_EVIDENCE_LIMITED_EXCEPTION') fail('DECISION_STATUS_MISMATCH', 'Execution quality and semantic-gate disposition are not stated correctly.');
  if (r3?.totals?.equivalence_classes !== 1068 || r3?.totals?.deterministic_non_secret !== 1045 || r3?.totals?.positive_secret_candidate !== 0 || r3?.totals?.semantically_unresolved !== 23 || r3?.semantic_gate?.status !== 'BLOCKED') fail('R3_RECONCILIATION_MISMATCH', 'R3 semantic totals or gate state do not match the required blocked state.');
  const state = decision.reconciled_state ?? {};
  if (state.r2_scan_observations !== 14984 || state.equivalence_classes !== r3.totals.equivalence_classes || state.deterministic_non_secrets !== r3.totals.deterministic_non_secret || state.positive_candidates_established !== 0 || state.semantically_unresolved_classes !== 23) fail('DECISION_TOTALS_MISMATCH', 'Decision totals do not reconcile to R3.');
  if (r4Status?.current_package_status !== 'NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE' || r4Status?.totals?.current_pending_authority_records !== 0 || r4Status?.totals?.current_pending_provider_records !== 0 || r4Manifest?.totals?.active_actions !== 0 || r4Manifest?.totals?.pending_authority !== 0 || r4Manifest?.totals?.pending_provider !== 0 || r4Authority?.totals?.active_actions !== 0 || r4Authority?.totals?.pending_authority !== 0 || r4Authority?.totals?.pending_provider !== 0 || state.current_r4_authority_queue !== 0 || state.current_r4_provider_queue !== 0) fail('R4_INACTIVITY_MISMATCH', 'Current R4 provider or authority work is not empty.');
  if (gate?.status !== 'NOT_RUN_SEMANTIC_GATE_BLOCKED' || gate?.prerequisite?.semantically_unresolved_classes !== 23 || gate?.policy?.full_08a1d_rerun_performed !== false || state.full_08a1d_status !== gate.status) fail('08A1D_INACTIVITY_MISMATCH', '08A1D does not remain blocked and inactive.');
  const actual = new Map();
  for (const item of r3.classes.filter((entry) => entry.semantic_state === 'SEMANTICALLY_UNRESOLVED')) {
    const key = signature(item.missing_predicates); actual.set(key, (actual.get(key) ?? 0) + 1);
  }
  const groups = decision.exclusive_reason_breakdown;
  if (!Array.isArray(groups) || groups.length !== 9 || groups.reduce((sum, group) => sum + group.class_count, 0) !== 23 || groups.some((group) => group.status !== 'BLOCKED' || !group.blocked_reason_code || !Array.isArray(group.authorized_evidence_source_types) || group.authorized_evidence_source_types.length === 0 || !group.minimum_authorized_evidence || !group.resolution_scope)) fail('DECISION_GROUP_STRUCTURE_MISMATCH', 'Every exact evidence-gap group must retain a blocked status, reason, minimum authorized source, and resolution scope.');
  const expected = mapCounts(groups);
  if (actual.size !== expected.size || [...expected].some(([key, count]) => actual.get(key) !== count)) fail('DECISION_GROUP_RECONCILIATION_MISMATCH', 'Published evidence-gap groups do not exactly cover the current unresolved R3 classes.');
  const ownerDecision = decision.owner_authorization_decision ?? {};
  if (ownerDecision.status !== 'PASS' || ownerDecision.decision !== 'ACCEPT_BLOCKED_PASS' || ownerDecision.decision_reason_code !== 'OWNER_ACCEPTED_EVIDENCE_LIMITED_EXCEPTION' || ownerDecision.required !== false || ownerDecision.additional_evidence_authorized !== false || ownerDecision.future_reopening_requires_new_explicit_authorization !== true) fail('OWNER_DECISION_MISMATCH', 'The owner acceptance must be final while withholding new evidence authorization.');
  const requiredMarkdown = ['EXECUTION_STATUS: PASS', 'SEMANTIC_GATE_STATUS: BLOCKED', 'OVERALL_DISPOSITION: BLOCKED_PASS', 'DECISION: ACCEPT_BLOCKED_PASS', 'DECISION_OUTCOME: ACCEPTED_EVIDENCE_LIMITED_EXCEPTION', 'OWNER_ACCEPTED_EVIDENCE_LIMITED_EXCEPTION', 'NOT_RUN_SEMANTIC_GATE_BLOCKED'];
  if (requiredMarkdown.some((line) => !markdown.includes(line))) fail('MARKDOWN_STATUS_MISMATCH', 'Decision Markdown omits a required status or owner decision.');
  return { unresolved: 23, groups: 9 };
}

async function main() {
  const [r3, r4Status, r4Manifest, r4Authority, gate, decision, markdown] = await Promise.all([
    readFile(required('--r3-classification'), 'utf8').then(JSON.parse),
    readFile(required('--r4-status'), 'utf8').then(JSON.parse),
    readFile(required('--r4-manifest'), 'utf8').then(JSON.parse),
    readFile(required('--r4-authority'), 'utf8').then(JSON.parse),
    readFile(required('--08a1d-gate'), 'utf8').then(JSON.parse),
    readFile(required('--decision-json'), 'utf8').then(JSON.parse),
    readFile(required('--decision-markdown'), 'utf8'),
  ]);
  const result = validateSemanticGateDecision({ r3, r4Status, r4Manifest, r4Authority, gate, decision, markdown });
  process.stdout.write('R3_RECONCILIATION_STATUS: PASS\n');
  process.stdout.write(`EXCLUSIVE_REASON_BREAKDOWN_STATUS: PASS — ${result.unresolved} unresolved classes across ${result.groups} groups\n`);
  process.stdout.write('R4_AND_08A1D_INACTIVITY_STATUS: PASS\n');
  process.stdout.write('SANITIZED_DECISION_NON_DISCLOSURE_STATUS: PASS\n');
  process.stdout.write('SEMANTIC_GATE_STATUS: BLOCKED — SEMANTIC_GATE_UNRESOLVED_CLASSES_REQUIRE_AUTHORIZED_EVIDENCE\n');
  process.stdout.write('DECISION_PACKAGE_VALIDATION_STATUS: PASS\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  process.stderr.write(`DECISION_PACKAGE_VALIDATION_STATUS: FAIL — ${error.code ?? 'DECISION_VALIDATION_FAILED'}: ${error.message}\n`);
  process.exitCode = 1;
});
