#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildR4Mapping } from './08a1d-r4-mapping-lib.mjs';

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }
async function write(target, content) { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, 'utf8'); }
function redactedRows(value) { if (!Array.isArray(value) || value.some((row) => row?.Secret !== 'REDACTED' || typeof row.Match !== 'string' || !row.Match.includes('REDACTED'))) throw new Error('08A1D mapping input report is not structurally redacted.'); return value; }

async function main() {
  const inventoryPath = required('--source-inventory');
  const coveragePath = required('--coverage');
  const [inventoryText, resolution, coverage] = await Promise.all([readFile(inventoryPath, 'utf8'), readFile(required('--resolution'), 'utf8').then(JSON.parse), readFile(coveragePath, 'utf8').then(JSON.parse)]);
  const references = [...coverage.roots, ...coverage.artifacts].map((item) => item.sanitized_report_reference).filter(Boolean);
  const rowsByReference = new Map(await Promise.all([...new Set(references)].map(async (reference) => [reference, redactedRows(JSON.parse(await readFile(reference, 'utf8')))])));
  const mapping = buildR4Mapping({ inventory: JSON.parse(inventoryText), inventoryText, resolution, coverage, rowsByReference });
  await write(required('--output-json'), `${JSON.stringify(mapping, null, 2)}\n`);
  await write(required('--output-md'), `# 08A1D R4 mapping status\n\n## Outcome\n\n**FULL RERUN REQUIRED.** Every retained 08A1D artifact record was projected against current R2 IDs using safe structural location/rule/line correlation only. The old bounded artifact coverage cannot be claimed current because it predates R2 and has no R2-bound content-identity/configuration attestation.\n\n- R2 run: \`${mapping.source_inventory.run_id}\`\n- Artifact records revalidated: ${mapping.totals.artifact_records}\n- Mapped pending disposition: ${mapping.totals.mapped_pending_disposition}\n- Reconciled findings: ${mapping.totals.findings_reconciled}\n- No R2 logical findings: ${mapping.totals.no_r2_logical_findings}\n- Unmapped R2 records: ${mapping.totals.unmapped_records}\n- Unmapped R2 observations: ${mapping.totals.unmapped_observations}\n- Active stale predecessor IDs: ${mapping.totals.stale_predecessor_ids_active}\n\n## Retention decision\n\n${mapping.full_rerun_reason}\n\nNo retained record is marked \`FINDINGS_RECONCILED\` unless all of its mapped current R2 logical items are terminal. Current mapped plausible items remain \`FINDINGS_MAPPED_PENDING_DISPOSITION\`.\n`);
  process.stdout.write(`Revalidated ${mapping.totals.artifact_records} 08A1D records against R2; coverage status is FULL_RERUN_REQUIRED.\n`);
}

main().catch((error) => { process.stderr.write(`08A1D-R4 mapping build failed: ${error.message}\n`); process.exitCode = 1; });
