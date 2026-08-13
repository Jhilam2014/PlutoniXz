#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function arg(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function required(name) { const value = arg(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }

async function main() {
  const classification = JSON.parse(await readFile(required('--classification'), 'utf8'));
  if (classification?.schema_version !== '08A1B-R3-semantic-classification-v1') throw new Error('08A1D semantic gate requires current R3 classification evidence.');
  const unresolved = Number(classification?.totals?.semantically_unresolved ?? -1);
  const eligible = unresolved === 0 && classification?.semantic_gate?.status === 'PASS';
  const gate = {
    schema_version: '08A1D-R3-semantic-gate-v1', reviewed_at: classification.reviewed_at,
    status: eligible ? 'ELIGIBLE_TO_RUN' : 'NOT_RUN_SEMANTIC_GATE_BLOCKED',
    prerequisite: { source_semantic_classification: '08a1b-r3-semantic-classification.sanitized.json', semantically_unresolved_classes: unresolved, semantic_gate_status: classification.semantic_gate.status },
    policy: { full_08a1d_rerun_performed: false, rerun_must_not_start_while_semantic_gate_blocked: true, source_is_current_r3_semantic_evidence: true },
  };
  const output = required('--output'); await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(gate, null, 2)}\n`, 'utf8');
  process.stdout.write(`Built 08A1D semantic gate: ${gate.status}.\n`);
}

main().catch((error) => { process.stderr.write(`08A1D semantic gate build failed: ${error.message}\n`); process.exitCode = 1; });
