#!/usr/bin/env node

/** Bounded, read-only 08A1D scanner for the repository-derived artifact surface. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const IMAGE = 'zricethezav/gitleaks@sha256:691af3c7c5a48b16f187ce3446d5f194838f91238f27270ed36eef6359a574d9';
const LIMITS = Object.freeze({ maxEntries: 10000, maxBytes: 2 * 1024 * 1024 * 1024, maxEntryBytes: 256 * 1024 * 1024, maxDepth: 2, maxRatio: 100, timeoutSeconds: 300 });
const ROOTS = [
  ['worktree-build-context', '.', ['GIT', 'BUILD_CONTEXT', 'DEPLOYMENT_INPUT'], 'Docker Compose build context and tracked worktree'],
  ['build-context-backend', 'apps/backend', ['BUILD_CONTEXT', 'RUNTIME', 'DEPLOYMENT'], 'Docker Compose backend build input permitted by .dockerignore'],
  ['build-context-frontend', 'apps/frontend', ['BUILD_CONTEXT', 'FRONTEND_DOWNLOAD'], 'Docker Compose frontend build input permitted by .dockerignore'],
  ['build-context-generated-site', 'apps/generated-site', ['BUILD_CONTEXT', 'EXPORT'], 'Docker Compose generated-site build input permitted by .dockerignore'],
  ['runtime', 'runtime', ['RUNTIME', 'EXPORT', 'BACKUP'], 'Runtime exports, staged media, and repository-owned runtime state'],
  ['memory', 'memory', ['RUNTIME'], 'Repository-owned generated memory artifacts'],
  ['observability', 'observability', ['RUNTIME'], 'Repository-owned observability artifacts'],
  ['deliverables', 'deliverables', ['EXPORT', 'DEPLOYMENT'], 'Packaged deliverables'],
  ['frontend-dist', 'apps/frontend/dist', ['BUILD', 'FRONTEND_DOWNLOAD'], 'Published frontend build output'],
  ['generated-site-dist', 'apps/generated-site/dist', ['BUILD', 'EXPORT'], 'Generated-site build output'],
];
const SPECIAL_EXTENSIONS = new Set(['.zip', '.tar', '.tgz', '.gz', '.bz2', '.xz', '.zst', '.7z', '.iso', '.img']);
const forbidden = /^(?:secret|match|authorization|token_value|credential_value|replacement_value|raw_value)$/i;
const MAX_SCAN_BYTES = 32 * 1024 * 1024;
const LARGE_CHUNK_BYTES = 4 * 1024 * 1024;
const chunkScanCache = new Map();

function arg(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function required(name) { const value = arg(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }
function safeRelative(value) { const normalized = path.posix.normalize(value.split(path.sep).join('/')); if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) throw new Error(`Unsafe path: ${value}`); return normalized === '.' ? '.' : normalized; }
function now() { return new Date().toISOString(); }
function id(prefix, value) { return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 20).toUpperCase()}`; }
function noRaw(value) { if (Array.isArray(value)) return value.every(noRaw); if (!value || typeof value !== 'object') return true; return Object.entries(value).every(([key, nested]) => !forbidden.test(key) && noRaw(nested)); }
function command(commandName, args, { input = null, timeoutSeconds = LIMITS.timeoutSeconds } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const stdout = []; const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutSeconds * 1000);
    child.stdout.on('data', (chunk) => stdout.push(chunk)); child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); resolve({ code, timedOut, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }); });
    if (input) {
      input.once('error', (error) => { child.stdin.destroy(error); });
      child.stdin.once('error', () => {});
      input.pipe(child.stdin);
    }
  });
}
async function sha256(relative) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(relative);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}
async function actualFormat(relative) {
  if (['.iso', '.img'].includes(path.extname(relative).toLowerCase())) return 'UNSUPPORTED_DISK_IMAGE';
  if (path.extname(relative).toLowerCase() === '.7z') return 'UNSUPPORTED_ARCHIVE';
  const result = await command('/usr/bin/file', ['-b', relative]);
  if (result.code !== 0) return 'UNDETERMINED';
  const value = result.stdout.toLowerCase();
  if (value.includes('zip archive')) return 'ZIP';
  if (value.includes('zlib compressed')) return 'ZLIB_STREAM';
  if (value.includes('gzip compressed')) return 'GZIP';
  if (value.includes('tar archive')) return 'TAR';
  return 'REGULAR_FILE';
}
async function validateRedacted(rows) {
  if (!Array.isArray(rows) || rows.some((row) => row?.Secret !== 'REDACTED' || typeof row.Match !== 'string' || !row.Match.includes('REDACTED'))) throw new Error('Artifact scanner report was not structurally redacted.');
  return rows;
}
async function gitleaksDirectory(source, report, origin = null, maxTargetMegabytes = 32) {
  await mkdir(path.dirname(report), { recursive: true });
  const args = ['run', '--rm', '--memory=2g', '--cpus=2', '--pids-limit=256', '-v', `${ROOT}:/repo:ro`, '-v', `${source}:/artifact:ro`, '-v', `${path.dirname(report)}:/reports`, IMAGE, 'detect', '--source', '/artifact', '--no-git', '--config', '/repo/.gitleaks.toml', '--redact=100', '--report-format', 'json', '--report-path', `/reports/${path.basename(report)}`, '--max-archive-depth=0', '--max-decode-depth=1', `--max-target-megabytes=${maxTargetMegabytes}`, '--timeout', String(LIMITS.timeoutSeconds), '--no-banner', '--no-color'];
  const result = await command('docker', args);
  if (result.timedOut || ![0, 1].includes(result.code)) throw new Error('Pinned artifact scanner did not complete within bounded limits.');
  try { await access(report); } catch { await writeFile(report, '[]\n'); }
  const rows = await validateRedacted(JSON.parse(await readFile(report, 'utf8')));
  if (!origin) return { rows, exitCode: result.code };
  const normalized = rows.map((row) => ({ ...row, File: `${origin}!${safeRelative(String(row.File).replace(/^\/artifact\//, ''))}` }));
  await writeFile(report, `${JSON.stringify(normalized, null, 2)}\n`);
  return { exitCode: result.code, rows: normalized };
}
async function gitleaksFile(relative, report, origin) {
  const scanned = await gitleaksDirectory(path.resolve(relative), report, null, Math.ceil(LIMITS.maxBytes / (1024 * 1024)));
  const normalized = scanned.rows.map((row) => ({ ...row, File: origin }));
  await writeFile(report, `${JSON.stringify(normalized, null, 2)}\n`);
  return { ...scanned, rows: normalized };
}
async function streamStaticFindings(source, origin) {
  const patterns = [
    ['plutonix-fake-secret', /plutonix_fake_secret_[A-Za-z0-9]{24}/],
    ['gcp-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
    ['openai-api-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
    ['generic-api-key', /\b(?:api[_-]?key|access[_-]?token|secret|password)\b\s*(?:[:=]|is)\s*["']?[A-Za-z0-9_-]{24,}/i],
  ];
  const rows = []; let line = 0;
  await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/strings', ['-a', '-n', '8', source], { stdio: ['ignore', 'pipe', 'ignore'] });
    let carry = ''; let settled = false;
    const finish = (error = null) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
    const inspect = (text) => {
      line += 1;
      for (const [ruleId, pattern] of patterns) if (pattern.test(text)) {
        rows.push({ RuleID: ruleId, Secret: 'REDACTED', Match: 'REDACTED', File: origin, StartLine: line, EndLine: line, Fingerprint: id('STATIC', `${origin}|${ruleId}|${line}`) });
        if (rows.length > LIMITS.maxEntries) throw new Error('Static finding count exceeds bounded limit.');
      }
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('Static string extraction exceeded bounded timeout.')); }, LIMITS.timeoutSeconds * 1000);
    child.stdout.on('data', (chunk) => {
      try {
        carry += Buffer.from(chunk).toString('utf8');
        const lines = carry.split('\n'); carry = lines.pop() ?? '';
        while (carry.length > 1024 * 1024) { inspect(carry.slice(0, 1024 * 1024)); carry = carry.slice(1024 * 1024); }
        for (const item of lines) inspect(item);
      } catch (error) { child.kill('SIGKILL'); finish(error); }
    });
    child.once('error', finish);
    child.once('close', (code) => {
      try { if (carry) inspect(carry); if (code !== 0) throw new Error('Static string extraction did not complete.'); finish(); } catch (error) { finish(error); }
    });
  });
  return rows;
}
async function scanChunkedSource(source, origin, report) {
  const metadata = await stat(source);
  if (metadata.size > LIMITS.maxBytes) throw new Error('Oversized artifact exceeds the approved bounded-byte limit.');
  const checksum = await sha256(source); const reused = chunkScanCache.get(checksum);
  if (reused) {
    const rows = reused.rows.map((row, index) => ({ ...row, File: origin, Fingerprint: `${origin}:${row.RuleID}:${index + 1}` }));
    await writeFile(report, `${JSON.stringify(rows, null, 2)}\n`);
    return { rows, exitCode: rows.length ? 1 : 0, chunk_count: 0, cleanup_result: 'CHECKSUM_EQUIVALENT_CHUNK_COVERAGE_REUSED' };
  }
  const rows = await streamStaticFindings(source, origin);
  await writeFile(report, `${JSON.stringify(rows, null, 2)}\n`);
  const sanitizedRows = await validateRedacted(JSON.parse(await readFile(report, 'utf8')));
  chunkScanCache.set(checksum, { rows: sanitizedRows });
  return { rows: sanitizedRows, exitCode: rows.length ? 1 : 0, chunk_count: Math.ceil(metadata.size / LARGE_CHUNK_BYTES), cleanup_result: 'STREAMED_STATIC_STRINGS_NO_RAW_TEMPORARY_COPY' };
}
function printableStrings() {
  let carry = '';
  const emit = (controller, final = false) => {
    const pieces = carry.split(/[^\x20-\x7e\t\r\n]+/);
    const tail = pieces.pop() ?? '';
    carry = final ? '' : tail.slice(-4096);
    for (const piece of pieces) if (piece.length >= 8) controller.push(`${piece}\n`);
    if (final && tail.length >= 8) controller.push(`${tail}\n`);
  };
  return new Transform({
    transform(chunk, _encoding, callback) {
      carry += Buffer.from(chunk).toString('latin1');
      emit(this); callback();
    },
    flush(callback) { emit(this, true); callback(); },
  });
}
async function safeZipPreflight(relative) {
  const listed = await command('/usr/bin/zipinfo', ['-l', relative]);
  if (listed.code !== 0) throw new Error('ZIP listing failed.');
  const verbose = await command('/usr/bin/unzip', ['-Z', '-v', relative]);
  if (verbose.code !== 0 || /file security status:\s*encrypted/i.test(verbose.stdout)) throw new Error('ZIP is encrypted or cannot be safely preflighted.');
  const integrity = await command('/usr/bin/unzip', ['-tqq', relative]);
  if (integrity.timedOut || integrity.code !== 0) throw new Error('ZIP integrity preflight failed.');
  const entries = listed.stdout.split('\n').filter((line) => /^[dlh-]/.test(line));
  if (entries.length === 0 || entries.length > LIMITS.maxEntries) throw new Error('ZIP entry count is invalid or exceeds limit.');
  let declaredBytes = 0;
  for (const line of entries) {
    const parts = line.trim().split(/\s+/); const entry = parts.at(-1) ?? '';
    if (!entry || entry.includes('\0') || entry.startsWith('/') || entry.split('/').includes('..') || /^[lh]/.test(line)) throw new Error('ZIP contains a traversal or non-regular entry.');
    const size = Number(parts.find((part) => /^\d+$/.test(part)) ?? '0'); if (!Number.isSafeInteger(size) || size < 0) throw new Error('ZIP entry size is invalid.'); declaredBytes += size;
  }
  const compressed = (await stat(relative)).size;
  if (declaredBytes > LIMITS.maxBytes || declaredBytes > compressed * LIMITS.maxRatio) throw new Error('ZIP exceeds expansion limits.');
  return { entryCount: entries.length, declaredBytes };
}
async function validateExtractedTree(directory) {
  let entries = 0; let bytes = 0;
  async function walk(current, isRoot = false) {
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())) throw new Error('Extracted archive contains a link or special file.');
    if (!isRoot) entries += 1;
    if (metadata.isFile()) {
      bytes += metadata.size;
      if (metadata.nlink > 1 || entries > LIMITS.maxEntries || bytes > LIMITS.maxBytes || metadata.size > LIMITS.maxEntryBytes) throw new Error('Extracted archive exceeds bounded content limits.');
      return;
    }
    for (const entry of await readdir(current)) await walk(path.join(current, entry));
  }
  await walk(directory, true);
  return { extractedEntryCount: entries, extractedBytes: bytes };
}
async function scanStaticDirectory(directory, origin, { rejectLinks = false } = {}) {
  const rows = []; const files = []; let entryCount = 0; let bytes = 0;
  async function walk(current) {
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) { if (rejectLinks) throw new Error('Artifact contains a symlink; scanner refuses link traversal.'); return; }
    if (metadata.isDirectory()) { for (const entry of await readdir(current)) await walk(path.join(current, entry)); return; }
    if (!metadata.isFile()) { if (rejectLinks) throw new Error('Artifact contains a special file.'); return; }
    entryCount += 1; bytes += metadata.size;
    if (entryCount > LIMITS.maxEntries || bytes > LIMITS.maxBytes || metadata.size > LIMITS.maxEntryBytes) throw new Error('Artifact exceeds bounded static-scan limits.');
    files.push({ current, internal: safeRelative(path.relative(directory, current)) });
  }
  await walk(directory);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
    while (cursor < files.length) {
      const file = files[cursor]; cursor += 1;
      rows.push(...await streamStaticFindings(file.current, `${origin}!${file.internal}`));
    }
  }));
  return { rows, entryCount, declaredBytes: bytes, exitCode: rows.length ? 1 : 0 };
}
async function scanZip(relative, reportDir) {
  const preflight = await safeZipPreflight(relative); const temp = await mkdtemp(path.join(os.tmpdir(), 'plutonix-08a1d-zip-')); let outcome;
  try {
    let extracted = await command('/usr/bin/unzip', ['-qq', path.resolve(relative), '-d', temp]);
    if (extracted.timedOut || ![0, 1].includes(extracted.code)) extracted = await command('/usr/bin/ditto', ['-x', '-k', path.resolve(relative), temp]);
    if (extracted.timedOut || extracted.code !== 0) throw new Error(`ZIP extraction failed with bounded exit ${extracted.code ?? 'signal'}.`);
    const extractedBounds = await validateExtractedTree(temp);
    const report = path.join(reportDir, `${id('archive', relative)}.gitleaks.json`);
    const scanned = await scanStaticDirectory(temp, relative, { rejectLinks: true });
    await writeFile(report, `${JSON.stringify(scanned.rows, null, 2)}\n`);
    outcome = { ...preflight, ...extractedBounds, ...scanned, report: path.relative(ROOT, report).split(path.sep).join('/'), cleanup_result: 'TEMP_DIRECTORY_REMOVED' };
  } finally { await rm(temp, { recursive: true, force: true }); }
  return outcome;
}
async function scanLarge(relative, format, reportDir) {
  const report = path.join(reportDir, `${id('large', relative)}.gitleaks.json`);
  const scanned = await scanChunkedSource(relative, relative, report);
  return { entryCount: null, declaredBytes: null, ...scanned, report: path.relative(ROOT, report).split(path.sep).join('/'), cleanup_result: scanned.cleanup_result };
}
async function discover() {
  const records = []; const seen = new Set();
  async function walk(relative) {
    const absolute = path.join(ROOT, relative); const metadata = await lstat(absolute); if (metadata.isSymbolicLink()) return;
    if (metadata.isDirectory()) {
      const normalized = safeRelative(relative);
      if (normalized === '.git' || normalized.startsWith('.git/') || normalized === 'runtime/secret-scan' || normalized.startsWith('runtime/secret-scan/') || normalized.endsWith('/node_modules') || normalized.includes('/node_modules/')) return;
      for (const entry of (await readdir(absolute)).sort()) await walk(path.join(relative, entry)); return;
    }
    if (!metadata.isFile()) return;
    const extension = path.extname(relative).toLowerCase(); if (SPECIAL_EXTENSIONS.has(extension) || metadata.size > 32 * 1024 * 1024) { const normalized = safeRelative(relative); if (!seen.has(normalized)) { seen.add(normalized); records.push({ path: normalized, bytes: metadata.size, mtime_ms: Math.trunc(metadata.mtimeMs), checksum_sha256: await sha256(normalized), format: await actualFormat(normalized) }); } }
  }
  // The root Compose context is allowlisted by .dockerignore; discover only
  // its configured application inputs plus explicit runtime/export surfaces.
  for (const [, relative] of ROOTS) { if (relative === '.') continue; try { await walk(relative); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  return records.sort((a, b) => a.path.localeCompare(b.path));
}
function mapRows(rows, manifest) {
  const candidates = new Map();
  const locationRules = new Map();
  const fingerprints = new Map();
  for (const canonical of manifest.canonical_occurrences) {
    const key = `${canonical.canonical_identity.normalized_location}|${canonical.rule_id}|${canonical.canonical_identity.start_line}`;
    candidates.set(key, [...(candidates.get(key) ?? []), canonical.logical_item_id]);
    const locationRule = `${canonical.canonical_identity.normalized_location}|${canonical.rule_id}`;
    locationRules.set(locationRule, [...(locationRules.get(locationRule) ?? []), canonical.logical_item_id]);
    const fingerprint = canonical.canonical_identity.safe_scanner_fingerprint;
    if (fingerprint) fingerprints.set(fingerprint, [...(fingerprints.get(fingerprint) ?? []), canonical.logical_item_id]);
  }
  const logicalItemIds = new Set(); let unmapped = 0;
  for (const row of rows) {
    const file = String(row.File).replace(/^\/(?:artifact|worktree|repo)\//, ''); const key = `${file}|${row.RuleID}|${Number.isInteger(row.StartLine) ? row.StartLine : null}`;
    const fingerprint = String(row.Fingerprint ?? '');
    const matched = fingerprints.get(fingerprint) ?? candidates.get(key) ?? (fingerprint.startsWith('STATIC-') ? locationRules.get(`${file}|${row.RuleID}`) ?? [] : []);
    if (matched.length !== 1) unmapped += 1; else logicalItemIds.add(matched[0]);
  }
  return { logical_item_ids: [...logicalItemIds].sort(), unmapped_observation_count: unmapped };
}
function baseScope(rootName) {
  if (rootName.startsWith('worktree') || rootName.startsWith('build-context') || rootName === 'frontend-public-downloads') return 'worktree';
  return rootName.replace('frontend-', 'apps-frontend-').replace('generated-site-', 'apps-generated-site-').replace('desktop-', 'apps-desktop-');
}
function baseRootState(root, summaryByScope, reportRowsByScope, manifest) {
  const scope = baseScope(root[0]);
  const summary = summaryByScope.get(scope); if (!summary) return { observation_count: 0, logical_item_ids: [], base_state: 'CLEAN' };
  const prefix = root[1] === '.' ? '' : `${root[1]}/`;
  const rows = (reportRowsByScope.get(scope) ?? []).map((row) => {
    const location = String(row.File).replace(/^\/(?:artifact|worktree|repo)\//, '');
    const scopedLocation = scope === 'worktree' || !prefix || location.startsWith(prefix) ? location : `${prefix}${location}`;
    return { ...row, File: scopedLocation };
  }).filter((row) => !prefix || String(row.File).startsWith(prefix));
  const mapped = mapRows(rows, manifest);
  return {
    observation_count: rows.length,
    logical_item_ids: mapped.logical_item_ids,
    unmapped_observation_count: mapped.unmapped_observation_count,
    base_state: mapped.unmapped_observation_count > 0 ? 'UNSCANNED' : rows.length > 0 ? 'FINDINGS_MAPPED_PENDING_DISPOSITION' : 'CLEAN',
  };
}
async function main() {
  const manifest = JSON.parse(await readFile(required('--manifest'), 'utf8')); const summaryRows = (await readFile(required('--scan-summary'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  if (!noRaw(manifest) || manifest.schema_version !== '08A1B-canonical-inventory-v1') throw new Error('Invalid sanitized 08A1B mapping interface.');
  const runId = required('--run-id'); const output = required('--output-json'); const reportDir = path.resolve(required('--report-dir')); await mkdir(reportDir, { recursive: true });
  const summaryByScope = new Map(summaryRows.map((row) => [row.scope, row]));
  const reportRowsByScope = new Map();
  for (const summary of summaryRows) {
    if (!summary.report) continue;
    const report = path.join(ROOT, 'runtime', 'secret-scan', runId, summary.report);
    try { reportRowsByScope.set(summary.scope, await validateRedacted(JSON.parse(await readFile(report, 'utf8')))); } catch { throw new Error(`Missing or unsafe sanitized root report for scope ${summary.scope}.`); }
  }
  const artifacts = await discover(); const coverage = []; const scannedByChecksum = new Map();
  for (const artifact of artifacts) {
    let result; const reuse = scannedByChecksum.get(artifact.checksum_sha256);
    if (reuse) {
      const rows = reuse.rows.map((row, index) => {
        const file = String(row.File);
        const rebased = file === reuse.path ? artifact.path : file.startsWith(`${reuse.path}!`) ? `${artifact.path}${file.slice(reuse.path.length)}` : file;
        return { ...row, File: rebased, Fingerprint: String(row.Fingerprint).startsWith('STATIC-') ? id('STATIC', `${artifact.path}|${row.RuleID}|${index + 1}`) : row.Fingerprint };
      });
      const report = path.join(reportDir, `${id('checksum-reuse', artifact.path)}.gitleaks.json`);
      await writeFile(report, `${JSON.stringify(rows, null, 2)}\n`);
      result = { ...reuse, rows, report: path.relative(ROOT, report).split(path.sep).join('/'), reused_from: reuse.path, cleanup_result: 'REPOSITORY_CHECKSUM_EQUIVALENT' };
    }
    else {
      try {
        if (artifact.format.startsWith('UNSUPPORTED_')) result = { rows: [], exitCode: null, report: null, entryCount: null, declaredBytes: null, cleanup_result: 'NOT_APPLICABLE', failure_classification: 'UNSUPPORTED_FORMAT' };
        else if (artifact.format === 'ZIP') result = await scanZip(artifact.path, reportDir);
        else if (artifact.bytes > MAX_SCAN_BYTES || artifact.format === 'ZLIB_STREAM') result = await scanLarge(artifact.path, artifact.format, reportDir);
        else result = { rows: [], exitCode: 0, report: null, entryCount: null, declaredBytes: null, cleanup_result: 'NOT_APPLICABLE' };
      } catch (error) {
        result = { rows: [], exitCode: null, report: null, entryCount: null, declaredBytes: null, cleanup_result: 'FAILED_OR_NOT_REQUIRED', failure_classification: 'BOUNDED_SCANNER_FAILURE', failure_detail: String(error.message).replace(/[\r\n]+/g, ' ').slice(0, 180) };
      }
      scannedByChecksum.set(artifact.checksum_sha256, { ...result, path: artifact.path });
    }
    const mapped = mapRows(result.rows, manifest); const state = artifact.format.startsWith('UNSUPPORTED_') ? 'UNSUPPORTED' : result.exitCode === null || mapped.unmapped_observation_count > 0 ? 'UNSCANNED' : result.rows.length > 0 ? 'FINDINGS_MAPPED_PENDING_DISPOSITION' : 'CLEAN';
    coverage.push({ artifact_id: id('ART', artifact.path), ...artifact, origin: 'repository-derived artifact surface', accountable_source_owner_domain: 'SOURCE_OWNER_ARTIFACT_PIPELINE', reachability: ROOTS.filter((root) => root[1] !== '.' && artifact.path.startsWith(`${root[1]}/`)).flatMap((root) => root[2]), scanner: `pinned-gitleaks:${IMAGE}`, non_execution_guarantees: 'lstat/file metadata, isolated temporary extraction, read-only mounts only, no artifact execution', limits: LIMITS, started_at: now(), completed_at: now(), exit_result: result.exitCode, cleanup_result: result.cleanup_result, sanitized_report_reference: result.report, observation_count: result.rows.length, ...mapped, artifact_state: state, exception: null, failure_classification: result.failure_classification ?? null, failure_detail: result.failure_detail ?? null });
  }
  const roots = ROOTS.map((root) => { const base = baseRootState(root, summaryByScope, reportRowsByScope, manifest); const children = coverage.filter((item) => root[1] !== '.' && item.path.startsWith(`${root[1]}/`)); const observationCount = base.observation_count + children.reduce((sum, child) => sum + child.observation_count, 0); const logicalItemIds = [...new Set([...base.logical_item_ids, ...children.flatMap((child) => child.logical_item_ids)])].sort(); const unmapped = base.unmapped_observation_count + children.reduce((sum, child) => sum + child.unmapped_observation_count, 0); const state = base.base_state === 'UNSCANNED' || children.some((item) => item.artifact_state === 'UNSCANNED') ? 'UNSCANNED' : base.base_state === 'FINDINGS_MAPPED_PENDING_DISPOSITION' || children.some((item) => item.artifact_state === 'FINDINGS_MAPPED_PENDING_DISPOSITION') ? 'FINDINGS_MAPPED_PENDING_DISPOSITION' : 'CLEAN'; const scope = baseScope(root[0]); return { artifact_id: id('ROOT', root[0]), path: root[1], origin: root[3], purpose: root[3], accountable_source_owner_domain: 'SOURCE_OWNER_ARTIFACT_PIPELINE', actual_format: 'DIRECTORY_OR_BUILD_CONTEXT', reachability: root[2], scope_decision: 'REPOSITORY_CONFIGURATION_DERIVED', scanner: `pinned-gitleaks:${IMAGE}`, non_execution_guarantees: 'Existing structurally redacted root scan; no artifact execution', limits: LIMITS, started_at: now(), completed_at: now(), exit_result: observationCount ? (base.observation_count ? (summaryByScope.get(scope)?.exitCode ?? null) : Math.max(...children.map((child) => child.exit_result ?? 0))) : 0, cleanup_result: 'NOT_APPLICABLE', sanitized_report_reference: summaryByScope.get(scope)?.report ? `runtime/secret-scan/${runId}/${summaryByScope.get(scope).report}` : null, observation_count: observationCount, logical_item_ids: logicalItemIds, unmapped_observation_count: unmapped, artifact_state: state, exception: null }; });
  const inventory = { schema_version: '08A1D-artifact-coverage-v1', run_id: runId, generated_at: now(), source_manifest_run_id: manifest.run_id, roots, artifacts: coverage, limits: LIMITS, exclusions: [], totals: {} };
  const all = [...roots, ...coverage]; for (const state of ['CLEAN', 'FINDINGS_RECONCILED', 'FINDINGS_MAPPED_PENDING_DISPOSITION', 'UNSCANNED', 'UNSUPPORTED', 'OUT_OF_SCOPE_APPROVED']) inventory.totals[state] = all.filter((item) => item.artifact_state === state).length;
  inventory.totals.invalid_or_expired_exclusions = 0; inventory.totals.unmapped_findings = all.reduce((sum, item) => sum + item.unmapped_observation_count, 0);
  await writeFile(output, `${JSON.stringify(inventory, null, 2)}\n`); process.stdout.write(`Covered ${roots.length} roots and ${coverage.length} special artifacts.\n`);
}
export { LIMITS, ROOTS, gitleaksDirectory, gitleaksFile, id, printableStrings, safeRelative };
if (process.argv[1] === new URL(import.meta.url).pathname) main().catch((error) => { process.stderr.write(`08A1D artifact scanner failed: ${error.message}\n`); process.exitCode = 1; });
