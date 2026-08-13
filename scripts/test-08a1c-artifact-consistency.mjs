#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateR4Mapping } from './08a1d-r4-mapping-lib.mjs';

const inventoryPath = new URL('../docs/production-readiness/evidence/08a1b-r2-logical-credential-inventory.sanitized.json', import.meta.url);
const resolutionPath = new URL('../docs/production-readiness/evidence/08a1c-r4-dispositions.sanitized.json', import.meta.url);
const mappingPath = new URL('../docs/production-readiness/evidence/08a1d-r4-artifact-mapping.sanitized.json', import.meta.url);
const [inventoryText, resolution, mapping] = await Promise.all([readFile(inventoryPath, 'utf8'), readFile(resolutionPath, 'utf8').then(JSON.parse), readFile(mappingPath, 'utf8').then(JSON.parse)]);
const totals = validateR4Mapping({ inventory: JSON.parse(inventoryText), inventoryText, resolution, mapping });
assert.equal(mapping.source_inventory.run_id, JSON.parse(inventoryText).run_id);
assert.equal(totals.stale_predecessor_ids_active, 0);
assert.equal(mapping.coverage_status, 'FULL_RERUN_REQUIRED');
assert.ok(totals.unmapped_observations > 0, 'pre-R2 coverage must not be silently retained as a complete current map');
assert.ok(mapping.mappings.every((record) => !record.r2_logical_item_ids.some((id) => !resolution.dispositions.some((item) => item.logical_item_id === id))), 'every active artifact mapping must target a current R2/R4 logical item');
process.stdout.write('08A1C-R4/08A1D artifact consistency test passed (current R2 IDs only; retained coverage fails closed).\n');
