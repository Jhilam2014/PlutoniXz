#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const permitted = new Set(['CLEAN', 'FINDINGS_RECONCILED', 'UNSCANNED', 'UNSUPPORTED', 'OUT_OF_SCOPE_WITH_JUSTIFICATION']);
function argument(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }
function iso(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value); }
async function main() {
  const inventory = JSON.parse(await readFile(required('--inventory'), 'utf8'));
  const requireCoverage = process.argv.includes('--require-coverage');
  if (!Array.isArray(inventory?.records)) throw new Error('Malformed artifact inventory.');
  const ids = new Set();
  for (const record of inventory.records) {
    if (!record.artifact_id || ids.has(record.artifact_id)) throw new Error('Missing or duplicate artifact ID.');
    ids.add(record.artifact_id);
    if (!permitted.has(record.final_status)) throw new Error('Unsupported artifact status.');
    if (record.final_status === 'CLEAN' && (!record.scan_method || record.scan_method.includes('NOT_YET') || !iso(record.scan_timestamp_utc) || record.result_count !== 0 || !record.sanitized_report_reference)) throw new Error('CLEAN artifact lacks successful scan evidence.');
    if (record.final_status === 'FINDINGS_RECONCILED' && (!record.scan_method || !iso(record.scan_timestamp_utc) || !record.sanitized_report_reference)) throw new Error('FINDINGS_RECONCILED artifact lacks scan evidence.');
    if (requireCoverage && !['CLEAN', 'FINDINGS_RECONCILED', 'OUT_OF_SCOPE_WITH_JUSTIFICATION'].includes(record.final_status)) throw new Error('Artifact review coverage is incomplete.');
  }
  process.stdout.write(`Validated ${inventory.records.length} artifact inventory records.\n`);
}
main().catch((error) => { process.stderr.write(`08A artifact inventory validation failed: ${error.message}\n`); process.exitCode = 1; });
