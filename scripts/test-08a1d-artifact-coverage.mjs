#!/usr/bin/env node

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gitleaksDirectory, gitleaksFile, id, printableStrings, safeRelative } from './scan-08a1d-artifacts.mjs';

async function collect(stream) { const chunks = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString('utf8'); }
function mustThrow(action) { assert.throws(action); }
async function main() {
  assert.equal(safeRelative('apps/frontend/dist/downloads/archive.zip'), 'apps/frontend/dist/downloads/archive.zip');
  mustThrow(() => safeRelative('../outside')); mustThrow(() => safeRelative('/absolute/path'));
  assert.equal(id('ART', 'stable-path'), id('ART', 'stable-path'), 'stable IDs must be repeatable');
  assert.notEqual(id('ART', 'stable-path'), id('ART', 'other-path'), 'stable IDs must remain path-specific');
  const strings = await collect(Readable.from([Buffer.from([0, 1, 2]), Buffer.from('static-value-1234'), Buffer.from([0, 3])]).pipe(printableStrings()));
  assert.match(strings, /static-value-1234/, 'binary content must be reduced to static strings before stream scanning');
  const source = await readFile(new URL('./scan-08a1d-artifacts.mjs', import.meta.url), 'utf8');
  for (const required of ['entry.split(\'/\').includes(\'..\')', '^[dlh-]', 'metadata.nlink > 1', 'runtime/secret-scan', 'maxEntries', 'maxRatio', 'maxDepth', 'file security status', 'mkdtemp', 'ditto', 'scanChunkedSource', 'STREAMED_STATIC_STRINGS_NO_RAW_TEMPORARY_COPY', 'UNSUPPORTED_DISK_IMAGE']) assert.ok(source.includes(required), `missing traversal/link/nesting/bomb/encryption/timeout/cleanup control: ${required}`);
  assert.ok(!source.includes(':/artifact:rw'), 'artifacts may never be mounted writable');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'plutonix-08a1d-test-'));
  try {
    const exported = path.join(temporary, 'frontend-export'); const reports = path.join(temporary, 'reports');
    await mkdir(exported); await mkdir(reports);
    const synthetic = ['plutonix_fake_', 'secret_', 'abcdefghijklmnopqrstuvwx'].join('');
    await writeFile(path.join(exported, 'bundle.js'), `const fixture = "${synthetic}";\n`);
    const report = path.join(reports, 'frontend-export.gitleaks.json');
    const scan = await gitleaksDirectory(exported, report, 'apps/frontend/dist/fixture-export');
    assert.equal(scan.exitCode, 1, 'synthetic frontend-export secret must be detected');
    assert.equal(scan.rows.length, 1, 'synthetic frontend-export secret must produce one redacted observation');
    assert.equal(scan.rows[0].Secret, 'REDACTED'); assert.match(scan.rows[0].Match, /REDACTED/);
    assert.match(scan.rows[0].File, /^apps\/frontend\/dist\/fixture-export!/);
    const fileReport = path.join(reports, 'frontend-export-file.gitleaks.json');
    const fileScan = await gitleaksFile(path.join(exported, 'bundle.js'), fileReport, 'apps/frontend/dist/fixture-export/bundle.js');
    assert.equal(fileScan.exitCode, 1, 'oversized-file path must remain scanner-compatible when mounted as a single read-only file');
    assert.equal(fileScan.rows[0].Secret, 'REDACTED'); assert.equal(fileScan.rows[0].File, 'apps/frontend/dist/fixture-export/bundle.js');
  } finally { await rm(temporary, { recursive: true, force: true }); }
  process.stdout.write('08A1D bounded-artifact tests passed (paths, stability, static strings, fixture export, read-only controls).\n');
}
main().catch((error) => { process.stderr.write(`08A1D bounded-artifact tests failed: ${error.message}\n`); process.exitCode = 1; });
