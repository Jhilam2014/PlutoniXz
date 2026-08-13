#!/usr/bin/env node

/**
 * Supersede the inflated R4 external queue without deleting its audit record.
 * Current actions are derived only from R3 positive semantic candidates.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { noCandidateBearingData } from './08a1b-r3-semantic-lib.mjs';

function arg(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function required(name) { const value = arg(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function stable(items, key) { return [...items].sort((a, b) => String(a[key]).localeCompare(String(b[key]))); }
function countBy(items, field) { return Object.fromEntries([...items.reduce((map, item) => { const key = typeof field === 'function' ? field(item) : item[field]; map.set(key, (map.get(key) ?? 0) + 1); return map; }, new Map()).entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))); }
async function write(target, content) { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, 'utf8'); }

function markdown(status) {
  const totals = status.totals;
  const unresolved = Object.entries(status.unresolved_by_missing_predicate).map(([predicate, count]) => `| ${predicate} | ${count} |`).join('\n') || '| None | 0 |';
  return `# 08A1B-R3 / 08A1C-R4 queue supersession

## Outcome

The R4 external package is **${status.current_package_status}**. Its historical requests are retained solely as audit history and cannot be sent, populated, or counted as current owner/provider work.

| Measure | Count |
| --- | ---: |
| R4 historical request records preserved | ${totals.historical_r4_requests} |
| Historical request records made non-actionable | ${totals.superseded_non_actionable_requests} |
| Current active 08A1C actions | ${totals.active_08a1c_actions} |
| Current pending authority records | ${totals.current_pending_authority_records} |
| Current pending provider records | ${totals.current_pending_provider_records} |
| R3 positive secret candidates | ${totals.positive_secret_candidates} |
| R3 semantically unresolved classes | ${totals.semantically_unresolved_classes} |

## Corrected routing

Only \`POSITIVE_SECRET_CANDIDATE\` classes can ever enter 08A1C. \`SEMANTICALLY_UNRESOLVED\` classes retain repository analysis requirements and have no provider, authority, provider-action, or remediation disposition.

## Unresolved repository requirements

| Exact missing predicate | Classes |
| --- | ---: |
${unresolved}

## Full 08A1D and 08A1C gate

- Corrected 08A1B semantic gate: \`${status.semantic_gate_status}\`
- Full 08A1D: \`${status.full_08a1d_status}\`
- 08A1C: \`${status.corrected_08a1c_status}\`
- 08A1E: \`${status['08a1e_status']}\`

The historical R4 manifest remains a non-actionable audit attachment. This supersession status is the only current projection.
`;
}

async function main() {
  const [classificationText, r4ManifestText, r4ResolutionText] = await Promise.all([
    readFile(required('--classification'), 'utf8'),
    readFile(required('--r4-manifest'), 'utf8'),
    readFile(required('--r4-resolution'), 'utf8'),
  ]);
  const classification = JSON.parse(classificationText); const r4Manifest = JSON.parse(r4ManifestText); const r4Resolution = JSON.parse(r4ResolutionText);
  if (classification?.schema_version !== '08A1B-R3-semantic-classification-v1') throw new Error('Semantic supersession requires an R3 semantic classification.');
  if (!Array.isArray(r4Manifest?.pending_actions) || !Array.isArray(r4Resolution?.dispositions)) throw new Error('Semantic supersession requires the preserved R4 audit package.');
  if (!noCandidateBearingData(classification) || !noCandidateBearingData(r4Manifest) || !noCandidateBearingData(r4Resolution)) throw new Error('Semantic supersession rejects unsafe evidence.');
  const positive = stable(classification.classes.filter((item) => item.semantic_state === 'POSITIVE_SECRET_CANDIDATE'), 'equivalence_class_id');
  const unresolved = classification.classes.filter((item) => item.semantic_state === 'SEMANTICALLY_UNRESOLVED');
  const actionsByClass = new Map(r4Manifest.pending_actions.map((item) => [item.candidate_equivalence_class_id, item]));
  const activeActions = classification.semantic_gate.status === 'PASS'
    ? positive.map((item) => actionsByClass.get(item.equivalence_class_id)).filter(Boolean).map((item) => ({ ...item, request_status: 'PENDING_CORRECTED_08A1C_SEMANTIC_DISPOSITION', semantic_routing: 'POSITIVE_SECRET_CANDIDATE_ONLY' }))
    : [];
  if (activeActions.length !== (classification.semantic_gate.status === 'PASS' ? positive.length : 0)) throw new Error('Positive semantic classes must have exact preserved R4 audit membership before they can become active.');
  const status = {
    schema_version: '08A1C-R4-semantic-triage-supersession-v1',
    reviewed_at: classification.reviewed_at,
    source_semantic_classification: { content_checksum_sha256: sha(classificationText), source_r2_inventory: classification.source_r2_inventory },
    historical_r4_audit_package: {
      manifest_reference: '08a1c-external-r4/external-action-manifest.sanitized.json',
      manifest_checksum_sha256: sha(r4ManifestText),
      resolution_reference: '08a1c-r4-dispositions.sanitized.json',
      resolution_checksum_sha256: sha(r4ResolutionText),
      historical_request_count: r4Manifest.pending_actions.length,
      retained_for_audit_only: true,
    },
    current_package_status: classification.semantic_gate.status === 'PASS' ? 'CORRECTED_08A1C_POSITIVE_CANDIDATES_ONLY' : 'NON_ACTIONABLE_PENDING_SEMANTIC_TRIAGE',
    semantic_gate_status: classification.semantic_gate.status,
    corrected_08a1c_status: classification.semantic_gate.corrected_08a1c_status,
    full_08a1d_status: classification.semantic_gate.full_08a1d_status,
    '08a1e_status': classification.semantic_gate.status === 'PASS' && activeActions.length === 0 ? 'NOT_ELIGIBLE_PENDING_FULL_08A1D' : 'NOT_ELIGIBLE',
    active_positive_candidate_actions: activeActions,
    superseded_r4_action_ids: r4Manifest.pending_actions.map((item) => item.action_id).sort(),
    unresolved_by_missing_predicate: classification.totals.unresolved_by_missing_predicate,
    totals: {
      historical_r4_requests: r4Manifest.pending_actions.length,
      superseded_non_actionable_requests: r4Manifest.pending_actions.length - activeActions.length,
      active_08a1c_actions: activeActions.length,
      current_pending_authority_records: activeActions.length,
      current_pending_provider_records: activeActions.length,
      positive_secret_candidates: positive.length,
      semantically_unresolved_classes: unresolved.length,
    },
    policy: {
      r4_absence_of_path_a_inference_superseded: true,
      unresolved_have_no_provider_identity_authority_or_external_action: true,
      provider_actions_performed: false,
      historical_requests_not_sent_or_populated: true,
    },
  };
  if (!noCandidateBearingData(status)) throw new Error('Semantic supersession would persist prohibited candidate-bearing data.');
  const projection = {
    schema_version: '08A1C-current-authority-provider-projection-v1', reviewed_at: status.reviewed_at,
    status: status.current_package_status,
    active_authority_records: [], active_provider_evidence_records: [], active_actions: activeActions,
    totals: { pending_authority: status.totals.current_pending_authority_records, pending_provider: status.totals.current_pending_provider_records, active_actions: status.totals.active_08a1c_actions },
    source_supersession_status: '08a1c-external-r4/current-semantic-triage-status.sanitized.json',
  };
  const dispositions = stable(classification.classes.map((item) => ({
    equivalence_class_id: item.equivalence_class_id, logical_item_id: item.logical_item_id, semantic_state: item.semantic_state, semantic_subtype: item.semantic_subtype,
    current_08a1c_state: item.semantic_state === 'POSITIVE_SECRET_CANDIDATE' && classification.semantic_gate.status === 'PASS' ? 'ELIGIBLE_CORRECTED_08A1C' : item.semantic_state === 'DETERMINISTIC_NON_SECRET' ? 'NOT_APPLICABLE_PATH_A_SEMANTIC_TERMINAL' : 'NOT_ELIGIBLE_SEMANTICALLY_UNRESOLVED',
    current_external_action: item.semantic_state === 'POSITIVE_SECRET_CANDIDATE' && classification.semantic_gate.status === 'PASS' ? 'EXACT_POSITIVE_CLASS_ACTION_ONLY' : 'NONE',
    missing_predicates: item.missing_predicates,
  })), 'equivalence_class_id');
  await Promise.all([
    write(required('--output-status'), `${JSON.stringify(status, null, 2)}\n`),
    write(required('--output-projection'), `${JSON.stringify(projection, null, 2)}\n`),
    write(required('--output-dispositions'), `${JSON.stringify({ schema_version: '08A1C-current-semantic-disposition-register-v1', reviewed_at: status.reviewed_at, source_status: '08a1c-external-r4/current-semantic-triage-status.sanitized.json', dispositions, totals: countBy(dispositions, 'current_08a1c_state') }, null, 2)}\n`),
    write(required('--output-markdown'), markdown(status)),
  ]);
  process.stdout.write(`08A1C-R4 semantic supersession: ${status.totals.historical_r4_requests} audit requests retained, ${status.totals.active_08a1c_actions} current actions.\n`);
}

main().catch((error) => { process.stderr.write(`08A1C-R4 semantic supersession failed: ${error.message}\n`); process.exitCode = 1; });
