#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const inventoryPath = 'runtime/secret-scan/20260811T214249Z/artifact-coverage.08a1d.sanitized.json';
const manifestPath = 'runtime/secret-scan/20260811T214249Z/canonical-inventory.08a1b.sanitized.json';
const resolutionPath = 'docs/production-readiness/evidence/08a-owner-dispositions.sanitized.json';
const verifierPath = 'scripts/verify-08a1d-artifact-coverage.mjs';
function run(inventory, resolution) {
  return spawnSync(process.execPath, [verifierPath, '--inventory', inventory, '--manifest', manifestPath, '--resolution', resolution, '--require-coverage'], { encoding: 'utf8' });
}

const temporary = await mkdtemp(path.join(os.tmpdir(), 'plutonix-08a1c-artifact-consistency-'));
try {
  assert.equal(run(inventoryPath, resolutionPath).status, 0);
  const [inventory, resolution] = await Promise.all([readFile(inventoryPath, 'utf8').then(JSON.parse), readFile(resolutionPath, 'utf8').then(JSON.parse)]);
  const pending = [...inventory.roots, ...inventory.artifacts].find((record) => record.artifact_state === 'FINDINGS_MAPPED_PENDING_DISPOSITION');
  assert.ok(pending, 'expected at least one mapped-pending artifact record');
  const invalidInventory = structuredClone(inventory); const invalidRecord = [...invalidInventory.roots, ...invalidInventory.artifacts].find((record) => record.artifact_id === pending.artifact_id); invalidRecord.artifact_state = 'FINDINGS_RECONCILED';
  const invalidInventoryPath = path.join(temporary, 'invalid-inventory.json'); await writeFile(invalidInventoryPath, `${JSON.stringify(invalidInventory)}\n`);
  const invalid = run(invalidInventoryPath, resolutionPath); assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /linked logical item remains non-terminal/);
  const terminalInventory = structuredClone(inventory); const terminalResolution = structuredClone(resolution); const pendingRecords = [...terminalInventory.roots, ...terminalInventory.artifacts].filter((record) => record.artifact_state === 'FINDINGS_MAPPED_PENDING_DISPOSITION'); const linked = new Set(pendingRecords.flatMap((record) => record.logical_item_ids)); for (const item of terminalResolution.dispositions) if (linked.has(item.logical_item_id)) item.review_state = 'CLOSED'; for (const record of pendingRecords) record.artifact_state = 'FINDINGS_RECONCILED';
  const terminalInventoryPath = path.join(temporary, 'terminal-inventory.json'); const terminalResolutionPath = path.join(temporary, 'terminal-resolution.json'); await Promise.all([writeFile(terminalInventoryPath, `${JSON.stringify(terminalInventory)}\n`), writeFile(terminalResolutionPath, `${JSON.stringify(terminalResolution)}\n`)]);
  assert.equal(run(terminalInventoryPath, terminalResolutionPath).status, 0);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log('08A1D artifact-to-logical disposition consistency tests passed.');
