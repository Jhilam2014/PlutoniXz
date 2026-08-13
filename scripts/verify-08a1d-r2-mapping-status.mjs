#!/usr/bin/env node

/** Confirms that retained 08A1D coverage is not misrepresented as an R2 map. */
import { readFile } from 'node:fs/promises';

const inventoryPath = new URL('../docs/production-readiness/evidence/08a1b-r2-logical-credential-inventory.sanitized.json', import.meta.url);
const statusPath = new URL('../docs/production-readiness/evidence/08a1d-r2-mapping-status.md', import.meta.url);

const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
const status = await readFile(statusPath, 'utf8');
if (inventory.schema_version !== '08A1B-R2-logical-credential-inventory-v1' || inventory.totals?.unreconstructed_candidates !== 0 || inventory.totals?.scanner_output_recursion !== 0) throw new Error('08A1D cannot retain coverage status without a passing R2 reconstruction.');
if (!status.includes('PROVISIONAL_PENDING_R2_REVALIDATION') || !status.includes(inventory.run_id)) throw new Error('08A1D R2 mapping status is missing or references a different reconstruction run.');
process.stdout.write(`08A1D coverage retained; V1 mapping is provisional pending revalidation against R2 run ${inventory.run_id}.\n`);
