#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { validateR4 } from './08a1c-r4-lib.mjs';

function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }

async function main() {
  const inventoryPath = required('--source-inventory');
  const [inventoryText, resolution, actionPackage, bridge] = await Promise.all([
    readFile(inventoryPath, 'utf8'),
    readFile(required('--resolution'), 'utf8').then(JSON.parse),
    readFile(required('--actions'), 'utf8').then(JSON.parse),
    readFile(required('--bridge'), 'utf8').then(JSON.parse),
  ]);
  const counts = validateR4({ inventory: JSON.parse(inventoryText), inventoryText, resolution, actionPackage, bridge });
  process.stdout.write(`Validated 08A1C-R4: ${counts.terminal} terminal logical items, ${counts.pending} exact pending Path B items, ${counts.actions} action rows.\n`);
}

main().catch((error) => { process.stderr.write(`08A1C-R4 validation failed: ${error.message}\n`); process.exitCode = 1; });
