#!/usr/bin/env node

/** Build the R4-only 08A1C disposition and bounded evidence package from R2. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildR4, R4_REVIEWED_AT } from './08a1c-r4-lib.mjs';

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }
function cell(value) { return String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' '); }
async function write(target, content) { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, 'utf8'); }
async function writeJson(target, value) { await write(target, `${JSON.stringify(value, null, 2)}\n`); }

function legacyCounts(resolution, actions, authority) {
  if (!Array.isArray(resolution?.dispositions) || !Array.isArray(actions?.actions) || !Array.isArray(authority?.authority_records)) throw new Error('Legacy R3 sources are malformed; do not infer supersession counts.');
  const pathA = resolution.dispositions.filter((item) => item.closure_path === 'PATH_A_REPOSITORY_FACT' || item.disposition === 'VERIFIED_SYNTHETIC_FIXTURE').length;
  const pathB = resolution.dispositions.length - pathA;
  if (pathA < 0 || pathB < 0) throw new Error('Legacy R3 source contains invalid disposition counts.');
  return { legacy_path_a_dispositions: pathA, legacy_path_b_dispositions: pathB, legacy_r3_actions: actions.actions.length, legacy_authority_records: authority.authority_records.length };
}

function bridgeMarkdown(result) {
  const { resolution, actionPackage, bridge } = result;
  const totals = resolution.totals;
  return `# 08A1C-R4 reconstructed logical-credential disposition bridge

## Outcome

**BLOCKED on external evidence only.** The R2 inventory is immutable input. R4 closes the deterministic Path A item and creates one non-amplified, exact-R2 evidence request for every remaining plausible equality class. No provider action, credential access, or external authentication occurred.

## R2 lineage

- R2 run: \`${resolution.source_inventory.run_id}\`
- R2 schema: \`${resolution.source_inventory.schema_version}\`
- R2 content checksum: \`${resolution.source_inventory.content_checksum_sha256}\`
- R2 equality method: \`${resolution.source_inventory.equality_method}\`
- R4 reviewed at: \`${resolution.reviewed_at}\`

## Current logical-item totals

| Measure | Count |
| --- | ---: |
| Scan observations | ${totals.scan_observations} |
| Canonical occurrences | ${totals.canonical_occurrences} |
| Candidate-equivalence classes | ${totals.candidate_equivalence_classes} |
| Logical items | ${totals.logical_items} |
| Path A terminal items | ${totals.path_a_terminal_total} |
| Plausible Path B items | ${totals.plausible_credential_total} |
| Terminal primary states | ${totals.terminal_primary_total} |
| Non-terminal primary states | ${totals.non_terminal_primary_total} |
| Exact R4 external actions | ${actionPackage.totals.pending_actions} |

## Path A terminal proof totals

| Proof family | Count |
| --- | ---: |
${Object.entries(totals.path_a_terminal_by_proof_family).map(([name, count]) => `| ${cell(name)} | ${count} |`).join('\n')}

## Authority and provider evidence

| Evidence class | Accepted | Rejected legacy input | Pending exact R2 requests |
| --- | ---: | ---: | ---: |
| Authority | ${totals.authority_records.accepted} | ${totals.authority_records.rejected} | ${totals.authority_records.pending} |
| Provider terminal evidence | ${totals.provider_evidence_records.accepted} | ${totals.provider_evidence_records.rejected} | ${totals.provider_evidence_records.pending} |

The rejected values are superseded pre-R2 records, not current queue membership. R4 makes no provider identity, authority, account, project, environment, validity, or terminal-result inference from paths, rules, reachability, source domains, or prior prose.

## Apify 08A1A boundary

The retained Apify 08A1A owner-evidence record is structurally valid and **unlinked**. It is not applied to any R2 logical item because no exact safe R2 alias/project/account/environment linkage is present. Its evidence level remains \`OWNER_ASSERTED\`, not provider verified.

## Supersession bridge

| Legacy source | Records | Current R4 treatment |
| --- | ---: | --- |
| V1 Path A dispositions | ${bridge.totals.legacy_path_a_dispositions} | Superseded to the current R2 deterministic Path A proof only |
| V1 Path B dispositions | ${bridge.totals.legacy_path_b_dispositions} | \`SUPERSEDED_NO_ACTION\` |
| R3 source-scope actions | ${bridge.totals.legacy_r3_actions} | \`SUPERSEDED_NO_ACTION\` |
| Pre-R2 authority records | ${bridge.totals.legacy_authority_records} | \`SUPERSEDED_NO_ACTION\` |
| Active legacy memberships | ${bridge.totals.active_legacy_memberships} | None |

## Next instruction

\`NEXT INSTRUCTION: RERUN THIS SAME 08A1C-R4 AFTER COMPLETING THE FINAL R4 EVIDENCE PACKAGE\`
`;
}

function dispositionsMarkdown(result) {
  const { resolution } = result;
  return `# 08A1C reconstructed disposition register — R4

The canonical machine-readable register is \`08a1c-r4-dispositions.sanitized.json\`. It freezes exactly one primary state per current R2 logical item and is derived only from R2 safe membership and deterministic proof metadata.

| State | Logical items | Closure path |
| --- | ---: | --- |
| VERIFIED_SYNTHETIC_FIXTURE | ${resolution.totals.path_a_terminal_total} | Path A deterministic repository proof |
| PENDING_EXTERNAL_EVIDENCE | ${resolution.totals.non_terminal_primary_total} | Path B exact-R2 external evidence |

No Path A item has an authority or provider requirement. Every Path B record has provider \`UNKNOWN\`, accountable role \`SOURCE_OWNER_IDENTIFICATION_REQUIRED\`, and an exact one-item R4 request until evidence proves otherwise.
`;
}

function actionMarkdown(result) {
  const { actionPackage, resolution } = result;
  return `# 08A1C-R4 final external action inventory

The machine-readable queue is \`08a1c-external-r4/external-action-manifest.sanitized.json\`.

- Exact R2 lineage: \`${resolution.source_inventory.run_id}\`
- Pending actions: ${actionPackage.totals.pending_actions}
- Provider credential groups: ${actionPackage.totals.provider_credential_groups}
- Action amplification: ${actionPackage.totals.action_amplification}
- Each action has one logical item and one candidate-equivalence class.
- All pending providers remain \`UNKNOWN\`; all roles remain \`SOURCE_OWNER_IDENTIFICATION_REQUIRED\`.

Each request requires current scoped authority, verified provider scope, exact R2 linkage, terminal provider result, actor/role and timezone timestamps, independent chronology, sanitized evidence, current-tree/history remediation, and replacement health proof when required. No request authorizes a provider mutation.
`;
}

function matrixMarkdown(result) {
  const { resolution } = result;
  return `# 08A1C-R4 authority and provider evidence matrix

| Path | Logical items | Authority state | Provider state | Terminal-evidence state |
| --- | ---: | --- | --- | --- |
| Path A deterministic proof | ${resolution.totals.path_a_terminal_total} | Not applicable | Not required | Repository proven |
| Path B plausible credential | ${resolution.totals.non_terminal_primary_total} | Pending current scoped authority | UNKNOWN | Pending provider terminal result and chronology |

Accepted authority records: ${resolution.totals.authority_records.accepted}. Accepted provider-evidence records: ${resolution.totals.provider_evidence_records.accepted}. Legacy R3 authority-domain records are superseded audit history and have no active R2 membership.
`;
}

function reconciliationMarkdown(result) {
  const { resolution, bridge } = result;
  return `# 08A finding reconciliation — R4

R4 reconciles only the immutable R2 logical inventory. It does not repeat candidate equality, consume credential material, or infer provider identity.

| Reconciliation layer | Count | State |
| --- | ---: | --- |
| R2 logical items | ${resolution.totals.logical_items} | Exactly one R4 primary state each |
| Deterministic Path A closures | ${resolution.totals.path_a_terminal_total} | Terminal |
| Plausible Path B logical items | ${resolution.totals.plausible_credential_total} | Pending exact external evidence |
| Active legacy memberships | ${bridge.totals.active_legacy_memberships} | Rejected |

R4 is blocked only by the remaining external evidence predicates. No repository-provable deterministic item remains in the external queue.
`;
}

function policyMarkdown() {
  return `# 08A1C evidence-path policy — R4

R4 consumes only \`08A1B-R2-logical-credential-inventory-v1\` membership. Exact candidate equality was completed by the R2 memory-only process and is never recomputed from sanitized evidence here.

| Path | Eligible current classes | Terminal condition |
| --- | --- | --- |
| Path A | Valid R2 deterministic noncredential proofs | Exact R2 proof, validator, positive/negative regression references, and reverse lineage |
| Path B | Every R2 \`PLAUSIBLE_CREDENTIAL\` class | Scoped authority, verified provider scope, exact linkage, terminal evidence, actor/time, independent chronology, remediation, and replacement health evidence when required |

Path B actions are one per R2 logical item by default. Reachability, source scope, scanner rule, path, provider-shaped prefix, and owner assertion are not authority, provider identity, equality, or terminal evidence. The legacy R3 eleven-domain package remains superseded audit history only.
`;
}

async function main() {
  const sourcePath = required('--source-inventory');
  const [inventoryText, legacyResolution, legacyActions, legacyAuthority] = await Promise.all([
    readFile(sourcePath, 'utf8'),
    readFile(required('--legacy-resolution'), 'utf8').then(JSON.parse),
    readFile(required('--legacy-actions'), 'utf8').then(JSON.parse),
    readFile(required('--legacy-authority'), 'utf8').then(JSON.parse),
  ]);
  const inventory = JSON.parse(inventoryText);
  const result = buildR4({ inventory, inventoryText, legacy: legacyCounts(legacyResolution, legacyActions, legacyAuthority) });
  const evidenceRoot = required('--evidence-root');
  const externalRoot = path.join(evidenceRoot, '08a1c-external-r4');
  const authorityProjection = {
    schema_version: '08A1C-R4-authority-provider-evidence-v1',
    reviewed_at: R4_REVIEWED_AT,
    source_inventory: result.resolution.source_inventory,
    accepted_authority_records: result.resolution.accepted_authority_records,
    accepted_provider_evidence_records: result.resolution.accepted_provider_evidence_records,
    totals: result.resolution.totals,
    apify_08a1a_record: result.resolution.apify_08a1a_record,
  };
  const intake = {
    schema_version: '08A1C-R4-evidence-intake-v1',
    reviewed_at: R4_REVIEWED_AT,
    source_inventory: result.resolution.source_inventory,
    intake_policy: 'Safe metadata and redacted evidence references only. No credential material, fragments, candidate-derived tags, raw provider console exports, or images without machine-checkable scope/linkage.',
    accepted_records: [],
    rejected_records: [],
    pending_action_ids: result.actionPackage.pending_actions.map((item) => item.action_id),
    totals: { accepted: 0, rejected_legacy_records: result.actionPackage.totals.rejected_legacy_records, pending: result.actionPackage.totals.pending_actions },
  };
  await Promise.all([
    writeJson(path.join(evidenceRoot, '08a1c-r4-dispositions.sanitized.json'), result.resolution),
    writeJson(path.join(evidenceRoot, '08a1c-r4-supersession-bridge.sanitized.json'), result.bridge),
    writeJson(path.join(externalRoot, 'external-action-manifest.sanitized.json'), result.actionPackage),
    writeJson(path.join(externalRoot, 'evidence-intake.sanitized.json'), intake),
    writeJson(path.join(evidenceRoot, '08a-owner-dispositions.sanitized.json'), result.resolution),
    writeJson(path.join(evidenceRoot, '08a-owner-authority-records.sanitized.json'), authorityProjection),
    write(path.join(evidenceRoot, '08a1c-r4-count-and-disposition-bridge.md'), bridgeMarkdown(result)),
    write(path.join(evidenceRoot, '08a-owner-dispositions.md'), dispositionsMarkdown(result)),
    write(path.join(evidenceRoot, '08a-owner-action-inventory.md'), actionMarkdown(result)),
    write(path.join(evidenceRoot, '08a-owner-authority-matrix.md'), matrixMarkdown(result)),
    write(path.join(evidenceRoot, '08a-finding-reconciliation.md'), reconciliationMarkdown(result)),
    write(path.join(evidenceRoot, '08a1c-evidence-path-policy.md'), policyMarkdown()),
    write(path.join(evidenceRoot, '08a1c-count-bridge.md'), bridgeMarkdown(result)),
    write(path.join(externalRoot, 'README.md'), `# 08A1C-R4 final evidence package\n\nThis package contains ${result.actionPackage.totals.pending_actions} exact-R2, one-item requests. It is the sole active external intake surface for the current R2 run \`${result.resolution.source_inventory.run_id}\`. The legacy \`08a1c-external/\` R3 package is preserved as superseded audit history and must not be executed.\n`),
    write(path.join(externalRoot, 'validation-summary.md'), `# 08A1C-R4 validation summary\n\n- R2 logical items: ${result.resolution.totals.logical_items}\n- Path A terminal: ${result.resolution.totals.path_a_terminal_total}\n- Path B pending: ${result.resolution.totals.non_terminal_primary_total}\n- Exact action rows: ${result.actionPackage.totals.pending_actions}\n- Accepted authority/provider evidence: 0 / 0\n- Status: BLOCKED only on required external evidence.\n`),
  ]);
  process.stdout.write(`Built R4 dispositions for ${result.resolution.totals.logical_items} R2 logical items; ${result.actionPackage.totals.pending_actions} exact external evidence requests remain.\n`);
}

main().catch((error) => { process.stderr.write(`08A1C-R4 evidence build failed: ${error.message}\n`); process.exitCode = 1; });
