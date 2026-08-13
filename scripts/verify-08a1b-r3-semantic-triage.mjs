#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DETERMINISTIC_PATH_A_IDS, noCandidateBearingData } from './08a1b-r3-semantic-lib.mjs';
import { exactR2Membership } from './run-08a1b-r3-semantic-triage.mjs';
import { validateR2Inventory } from './verify-08a1b-r2-reconstruction.mjs';

function arg(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function required(name) { const value = arg(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }
function equalSets(left, right) { return left.size === right.size && [...left].every((value) => right.has(value)); }
function fail(message) { throw new Error(message); }

export function validateSemanticTriage({ inventory, classification, supersession, currentManifest = null, currentAuthority = null, artifactGate = null }) {
  validateR2Inventory(inventory, { requirePass: true });
  if (classification?.schema_version !== '08A1B-R3-semantic-classification-v1' || (supersession !== undefined && supersession !== null && supersession?.schema_version !== '08A1C-R4-semantic-triage-supersession-v1')) fail('Unsupported semantic-triage evidence schema.');
  if (!noCandidateBearingData(classification) || (supersession !== undefined && supersession !== null && !noCandidateBearingData(supersession))) fail('Semantic-triage evidence contains candidate-bearing data.');
  const classIds = new Set(inventory.candidate_equivalence_classes.map((item) => item.candidate_equivalence_class_id));
  const semanticIds = new Set(classification.classes.map((item) => item.equivalence_class_id));
  if (semanticIds.size !== classification.classes.length || !equalSets(classIds, semanticIds)) fail('Every R2 equivalence class must have exactly one R3 semantic state.');
  const r2ClassById = new Map(inventory.candidate_equivalence_classes.map((item) => [item.candidate_equivalence_class_id, item]));
  const allowed = new Set(['DETERMINISTIC_NON_SECRET', 'POSITIVE_SECRET_CANDIDATE', 'SEMANTICALLY_UNRESOLVED']);
  const positiveSubtypes = new Set(['PROVIDER_CREDENTIAL_CANDIDATE', 'GENERIC_APPLICATION_SECRET_CANDIDATE', 'AUTH_SESSION_OR_SIGNING_MATERIAL_CANDIDATE']);
  let deterministic = 0; let positive = 0; let unresolved = 0;
  for (const item of classification.classes) {
    if (!allowed.has(item.semantic_state) || !Array.isArray(item.canonical_occurrence_ids) || !item.logical_item_id || !Array.isArray(item.source_references) || !Array.isArray(item.parser_references) || !Array.isArray(item.consumer_references) || !Array.isArray(item.missing_predicates)) fail('Semantic record is structurally incomplete.');
    const r2Class = r2ClassById.get(item.equivalence_class_id);
    if (!r2Class || item.logical_item_id !== r2Class.logical_item_id || JSON.stringify(item.canonical_occurrence_ids) !== JSON.stringify(r2Class.canonical_occurrence_ids)) fail('R3 semantic membership must exactly preserve its R2 equivalence class and member ordering.');
    if (item.semantic_state === 'DETERMINISTIC_NON_SECRET') {
      deterministic += 1;
      if (!DETERMINISTIC_PATH_A_IDS.has(item.proof_or_evidence_path_id) || !item.proof_family || item.source_references.length === 0 || item.parser_references.length === 0 || item.consumer_references.length === 0 || item.missing_predicates.length !== 0 || item.validator_result !== 'PASS') fail('Path A semantic class lacks complete deterministic proof.');
    } else if (item.semantic_state === 'POSITIVE_SECRET_CANDIDATE') {
      positive += 1;
      if (!positiveSubtypes.has(item.semantic_subtype) || !item.proof_or_evidence_path_id || item.source_references.length === 0 || item.parser_references.length === 0 || item.consumer_references.length === 0 || item.missing_predicates.length !== 0 || item.validator_result !== 'PASS') fail('Positive semantic class lacks strict parser/context evidence.');
    } else {
      unresolved += 1;
      if (item.semantic_subtype !== null || item.proof_or_evidence_path_id !== null || item.proof_family !== null || item.missing_predicates.length === 0 || /provider|authority|external action/i.test(JSON.stringify(item))) fail('Unresolved semantic class is improperly assigned an action or unsupported evidence.');
    }
  }
  const totals = classification.totals ?? {};
  if (totals.equivalence_classes !== classIds.size || totals.deterministic_non_secret !== deterministic || totals.positive_secret_candidate !== positive || totals.semantically_unresolved !== unresolved) fail('Semantic classification totals do not reconcile.');
  const bridge = classification.source_replay?.r2_bridge;
  if (!exactR2Membership(bridge?.status) || bridge?.canonical_ids_exact !== true || bridge?.equivalence_class_ids_exact !== true || bridge?.equivalence_memberships_exact !== true) {
    if (classification.semantic_gate?.status === 'PASS') fail('A passing semantic gate requires exact R2 canonical and equivalence membership lineage.');
  }
  const expectedGate = unresolved === 0 && exactR2Membership(bridge?.status) ? 'PASS' : 'BLOCKED';
  if (classification.semantic_gate?.status !== expectedGate || totals.active_08a1c_actions !== 0) fail('Semantic gate status or pre-08A1C action count is invalid.');
  if (supersession !== undefined && supersession !== null && (supersession.totals?.historical_r4_requests !== supersession.superseded_r4_action_ids?.length || supersession.totals?.active_08a1c_actions !== supersession.active_positive_candidate_actions?.length || supersession.totals?.current_pending_authority_records !== supersession.active_positive_candidate_actions?.length || supersession.totals?.current_pending_provider_records !== supersession.active_positive_candidate_actions?.length)) fail('Current R4 supersession totals are inconsistent.');
  if (supersession !== undefined && supersession !== null && expectedGate === 'BLOCKED') {
    if (supersession.current_package_status !== 'NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE' || supersession.active_positive_candidate_actions.length !== 0 || supersession.totals.current_pending_authority_records !== 0 || supersession.totals.current_pending_provider_records !== 0 || supersession.full_08a1d_status !== 'NOT_RUN_SEMANTIC_GATE_BLOCKED') fail('Blocked semantic triage must leave no active authority/provider queue or 08A1D rerun.');
  }
  if (currentManifest !== null) {
    if (supersession === undefined || supersession === null) fail('Current external-action validation requires an R4 supersession record.');
    if (currentManifest?.schema_version !== '08A1C-current-semantic-external-action-package-v1' || currentManifest?.package_status !== 'NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE' || !Array.isArray(currentManifest.pending_actions) || currentManifest.pending_actions.length !== 0 || currentManifest?.totals?.active_actions !== 0 || currentManifest?.totals?.pending_authority !== 0 || currentManifest?.totals?.pending_provider !== 0 || currentManifest?.historical_request_count !== supersession.totals.historical_r4_requests) fail('Current external-action projection does not preserve audit history while removing active R4 work.');
  }
  if (currentAuthority !== null) {
    if (supersession === undefined || supersession === null) fail('Current authority validation requires an R4 supersession record.');
    if (currentAuthority?.schema_version !== '08A1C-current-authority-provider-projection-v1' || currentAuthority?.status !== 'NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE' || currentAuthority?.totals?.pending_authority !== 0 || currentAuthority?.totals?.pending_provider !== 0 || currentAuthority?.totals?.active_actions !== 0 || (currentAuthority.active_authority_records ?? []).length !== 0 || (currentAuthority.active_provider_evidence_records ?? []).length !== 0 || (currentAuthority.active_actions ?? []).length !== 0) fail('Current authority/provider projection contains prohibited active work.');
  }
  if (artifactGate !== null) {
    const expectedArtifactStatus = expectedGate === 'PASS' ? 'ELIGIBLE_TO_RUN' : 'NOT_RUN_SEMANTIC_GATE_BLOCKED';
    if (artifactGate?.schema_version !== '08A1D-R3-semantic-gate-v1' || artifactGate?.status !== expectedArtifactStatus || artifactGate?.prerequisite?.semantically_unresolved_classes !== unresolved || artifactGate?.policy?.full_08a1d_rerun_performed !== false) fail('08A1D semantic gate is inconsistent with the current R3 semantic state.');
  }
  return { deterministic, positive, unresolved, status: expectedGate };
}

async function main() {
  const [inventory, classification, supersession, currentManifest, currentAuthority, artifactGate] = await Promise.all([
    readFile(required('--inventory'), 'utf8').then(JSON.parse), readFile(required('--classification'), 'utf8').then(JSON.parse), readFile(required('--supersession'), 'utf8').then(JSON.parse),
    arg('--current-manifest') ? readFile(arg('--current-manifest'), 'utf8').then(JSON.parse) : Promise.resolve(null),
    arg('--current-authority') ? readFile(arg('--current-authority'), 'utf8').then(JSON.parse) : Promise.resolve(null),
    arg('--artifact-gate') ? readFile(arg('--artifact-gate'), 'utf8').then(JSON.parse) : Promise.resolve(null),
  ]);
  const result = validateSemanticTriage({ inventory, classification, supersession, currentManifest, currentAuthority, artifactGate });
  process.stdout.write(`Validated 08A1B-R3 semantic triage: ${result.deterministic} deterministic, ${result.positive} positive, ${result.unresolved} unresolved; ${result.status}.\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`08A1B-R3 semantic validation failed: ${error.message}\n`); process.exitCode = 1; });
