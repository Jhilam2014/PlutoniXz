#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildCanonicalInventory, readSanitizedReports } from './reconcile-secret-findings.mjs';

const safe = (file, fingerprint, commit = '') => ({ Secret: 'REDACTED', Match: 'REDACTED', File: file, Fingerprint: fingerprint, RuleID: 'generic-api-key', Commit: commit, StartLine: 7, EndLine: 7 });
const reports = (rows, name) => [{ sourceReport: `runtime/secret-scan/test/${name}.gitleaks.json`, rows }];
const overlap = buildCanonicalInventory([...reports([safe('/worktree/runtime/example.json', 'same-location')], 'worktree'), ...reports([safe('/artifact/example.json', 'same-location')], 'runtime')], 'test');
assert.equal(overlap.observation_count, 2); assert.equal(overlap.canonical_occurrence_count, 1); assert.equal(overlap.logical_item_count, 1);
const history = buildCanonicalInventory(reports([safe('example.json', 'one', 'commit-a'), safe('example.json', 'two', 'commit-b')], 'reachable-git-history'), 'test');
assert.equal(history.canonical_occurrence_count, 2); assert.equal(history.logical_item_count, 2);
const twoSignals = buildCanonicalInventory(reports([safe('/worktree/example.json', 'first'), safe('/worktree/example.json', 'second')], 'worktree'), 'test');
assert.equal(twoSignals.canonical_occurrence_count, 2); assert.equal(twoSignals.logical_item_count, 2);
const copied = buildCanonicalInventory([...reports([safe('/artifact/source.json', 'copy')], 'runtime'), ...reports([safe('/artifact/copy.json', 'copy')], 'runtime')], 'test');
assert.equal(copied.logical_item_count, 2);
const repeated = buildCanonicalInventory(reports([safe('/worktree/example.json', 'stable')], 'worktree'), 'test');
assert.deepEqual(repeated, buildCanonicalInventory(reports([safe('/worktree/example.json', 'stable')], 'worktree'), 'test'));
assert.equal(JSON.stringify(overlap).includes('"Secret"'), false); assert.equal(JSON.stringify(overlap).includes('"Match"'), false);

const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'plutomix-08a1b-'));
const reportPath = path.join(fixtureRoot, 'safe.gitleaks.json');
const unsafeReportPath = path.join(fixtureRoot, 'unsafe.gitleaks.json');
const manifestPath = path.join(fixtureRoot, 'manifest.json');
await writeFile(reportPath, `${JSON.stringify([safe('/worktree/example.json', 'fixture')])}\n`);
await writeFile(unsafeReportPath, `${JSON.stringify([{ ...safe('/worktree/example.json', 'fixture'), Secret: 'UNREDACTED' }])}\n`);
await assert.rejects(readSanitizedReports([unsafeReportPath]));
const fixtureManifest = buildCanonicalInventory(await readSanitizedReports([reportPath]), 'fixture');
await writeFile(manifestPath, `${JSON.stringify(fixtureManifest)}\n`);
execFileSync(process.execPath, ['scripts/verify-08a-reconciliation.mjs', '--source-report', reportPath, '--manifest', manifestPath], { stdio: 'pipe' });
const broken = JSON.parse(await readFile(manifestPath, 'utf8')); broken.canonical_occurrences[0].contributing_observation_ids = [];
await writeFile(manifestPath, `${JSON.stringify(broken)}\n`);
assert.notEqual(spawnSync(process.execPath, ['scripts/verify-08a-reconciliation.mjs', '--source-report', reportPath, '--manifest', manifestPath], { encoding: 'utf8' }).status, 0);
console.log('08A1B synthetic overlap, history, two-signal, copied-artifact, stable-run, unsafe-report, missing-link, and non-disclosure tests passed.');

