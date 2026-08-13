#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { validateR4Mapping } from './08a1d-r4-mapping-lib.mjs';

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }

async function main() {
  const inventoryPath = required('--source-inventory');
  const [inventoryText, resolution, mapping] = await Promise.all([readFile(inventoryPath, 'utf8'), readFile(required('--resolution'), 'utf8').then(JSON.parse), readFile(required('--mapping'), 'utf8').then(JSON.parse)]);
  const totals = validateR4Mapping({ inventory: JSON.parse(inventoryText), inventoryText, resolution, mapping });
  process.stdout.write(`Validated 08A1D-R4 mapping: ${totals.artifact_records} records, ${totals.unmapped_observations} unmapped observations, FULL_RERUN_REQUIRED.\n`);
}

main().catch((error) => { process.stderr.write(`08A1D-R4 mapping validation failed: ${error.message}\n`); process.exitCode = 1; });
