#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function arg(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function required(name) { const value = arg(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }
function fail(message) { throw new Error(message); }

export function validate08A1DSemanticGate({ classification, gate, requireRun = false }) {
  if (classification?.schema_version !== '08A1B-R3-semantic-classification-v1' || gate?.schema_version !== '08A1D-R3-semantic-gate-v1') fail('08A1D gate requires current R3 semantic evidence.');
  const unresolved = Number(classification?.totals?.semantically_unresolved ?? -1);
  const expected = unresolved === 0 && classification?.semantic_gate?.status === 'PASS' ? 'ELIGIBLE_TO_RUN' : 'NOT_RUN_SEMANTIC_GATE_BLOCKED';
  if (gate.status !== expected || gate?.prerequisite?.semantically_unresolved_classes !== unresolved || gate?.policy?.full_08a1d_rerun_performed !== false) fail('08A1D gate does not match the R3 semantic prerequisite.');
  if (requireRun && expected !== 'ELIGIBLE_TO_RUN') fail('Full 08A1D rerun is prohibited until R3 has zero unresolved classes.');
  return { expected, unresolved };
}

async function main() {
  const [classification, gate] = await Promise.all([readFile(required('--classification'), 'utf8').then(JSON.parse), readFile(required('--gate'), 'utf8').then(JSON.parse)]);
  const result = validate08A1DSemanticGate({ classification, gate, requireRun: process.argv.includes('--require-run') });
  process.stdout.write(`08A1D semantic gate: ${result.expected}; full rerun ${result.expected === 'ELIGIBLE_TO_RUN' ? 'eligible' : 'not run'}.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`08A1D semantic gate validation failed: ${error.message}\n`); process.exitCode = 1; });
