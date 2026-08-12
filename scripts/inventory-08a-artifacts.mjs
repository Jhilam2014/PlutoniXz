#!/usr/bin/env node

/**
 * Safe inventory only: recursively walks repository-controlled artifacts using
 * lstat (never follows symlinks) and records format/size/status without
 * opening their contents. A later scanner may promote only successfully
 * scanned records to CLEAN.
 */
import { lstat, readdir, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const roots = [
  ['runtime', 'runtime evidence and exports', 'NO'],
  ['memory', 'generated project memory', 'NO'],
  ['observability', 'generated observability artifacts', 'NO'],
  ['deliverables', 'packaged deliverables', 'NO'],
  ['apps/frontend/dist', 'frontend build output', 'NO'],
  ['apps/generated-site/dist', 'generated-site build output', 'NO'],
];
const archiveExtensions = new Set(['.zip', '.tar', '.tgz', '.gz', '.bz2', '.xz', '.7z']);
function argument(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }
function formatFor(file) {
  const lower = file.toLowerCase();
  const ext = path.extname(lower);
  if (archiveExtensions.has(ext) || lower.endsWith('.tar.gz')) return 'ARCHIVE';
  return 'DIRECTORY_OR_PLAIN_FILES';
}
async function summarize(root) {
  const stats = { files: 0, bytes: 0, archives: [] };
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(process.cwd(), absolute);
      const meta = await lstat(absolute);
      if (meta.isSymbolicLink()) continue;
      if (meta.isDirectory()) await walk(absolute);
      else if (meta.isFile()) {
        stats.files += 1;
        stats.bytes += meta.size;
        const format = formatFor(relative);
        if (format !== 'DIRECTORY_OR_PLAIN_FILES') stats.archives.push({ path: relative, bytes: meta.size, format });
      }
    }
  }
  await walk(root);
  return stats;
}
function markdownCell(value) { return String(value ?? '—').replaceAll('|', '\\|'); }
async function main() {
  const outputJson = required('--output-json');
  const outputMarkdown = required('--output-markdown');
  const runId = required('--run-id');
  const summaryPath = argument('--scan-summary');
  const largeInventoryPath = argument('--unscannable-large-files');
  const reconciliationPath = argument('--finding-reconciliation');
  const reconciliation = reconciliationPath ? JSON.parse(await readFile(reconciliationPath, 'utf8')) : null;
  const reconciliationAvailable = Number.isInteger(reconciliation?.occurrence_count_in_manifest)
    && Array.isArray(reconciliation?.occurrences);
  const summaries = summaryPath
    ? (await readFile(summaryPath, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
    : [];
  const summaryByScope = new Map(summaries.map((summary) => [summary.scope, summary]));
  const unscannable = largeInventoryPath
    ? (await readFile(largeInventoryPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => {
      const [artifactPath, bytes] = line.split('\t');
      return { path: artifactPath, bytes: Number(bytes) };
    })
    : [];
  const scopeForRoot = new Map([
    ['runtime', 'runtime'], ['memory', 'memory'], ['observability', 'observability'], ['deliverables', 'deliverables'],
    ['apps/frontend/dist', 'apps-frontend-dist'], ['apps/generated-site/dist', 'apps-generated-site-dist'],
  ]);
  const reportReference = (summary) => (summary ? `runtime/secret-scan/${runId}/${summary.report}` : null);
  const rootStatus = (relative) => {
    const summary = summaryByScope.get(scopeForRoot.get(relative));
    const hasUnscannable = unscannable.some((item) => item.path === relative || item.path.startsWith(`${relative}/`));
    if (!summary) return { status: 'UNSCANNED', method: 'NOT_EXECUTED_PENDING_COMPLETE_REDACTED_SCAN', timestamp: null, resultCount: null, reference: null };
    if (hasUnscannable) return { status: 'UNSCANNED', method: 'BOUNDED_RECURSIVE_SCAN_COMPLETED_BUT_LARGE_FILES_UNSCANNED', timestamp: null, resultCount: summary.findingCount, reference: reportReference(summary) };
    if (summary.exitCode === 0 && summary.findingCount === 0) return { status: 'CLEAN', method: 'PINNED_GITLEAKS_RECURSIVE_SCAN', timestamp: new Date().toISOString(), resultCount: 0, reference: reportReference(summary) };
    if (summary.exitCode === 1 && summary.findingCount > 0 && reconciliationAvailable) return { status: 'FINDINGS_RECONCILED', method: 'PINNED_GITLEAKS_RECURSIVE_SCAN', timestamp: new Date().toISOString(), resultCount: summary.findingCount, reference: reportReference(summary) };
    return { status: 'UNSCANNED', method: 'SCAN_DID_NOT_PRODUCE_USABLE_COVERAGE', timestamp: null, resultCount: summary.findingCount ?? null, reference: reportReference(summary) };
  };
  const records = [];
  for (const [relative, purpose, included] of roots) {
    try {
      const rootStats = await lstat(relative);
      if (!rootStats.isDirectory()) continue;
      const summary = await summarize(relative);
      const rootReview = rootStatus(relative);
      records.push({ artifact_id: `ROOT-${String(records.length + 1).padStart(3, '0')}`, path: relative, type: 'ROOT', format: 'DIRECTORY', bytes: summary.bytes, file_count: summary.files, source_or_purpose: purpose, included_in_docker_build_context: included, scan_method: rootReview.method, scan_timestamp_utc: rootReview.timestamp, result_count: rootReview.resultCount, sanitized_report_reference: rootReview.reference, final_status: rootReview.status });
      for (const archive of summary.archives) {
        records.push({ artifact_id: `ART-${String(records.length + 1).padStart(3, '0')}`, path: archive.path, type: 'ARCHIVE', format: archive.format, bytes: archive.bytes, file_count: null, source_or_purpose: purpose, included_in_docker_build_context: included, scan_method: 'BOUNDED_LIST_EXTRACT_AND_SCAN_NOT_YET_EXECUTED', scan_timestamp_utc: null, result_count: null, sanitized_report_reference: null, final_status: 'UNSCANNED' });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      records.push({ artifact_id: `ROOT-${String(records.length + 1).padStart(3, '0')}`, path: relative, type: 'ROOT', format: 'NOT_PRESENT', bytes: 0, file_count: 0, source_or_purpose: purpose, included_in_docker_build_context: included, scan_method: 'NOT_APPLICABLE', scan_timestamp_utc: null, result_count: 0, sanitized_report_reference: null, final_status: 'OUT_OF_SCOPE_WITH_JUSTIFICATION' });
    }
  }
  for (const unscannableRecord of unscannable) {
    if (!records.some((record) => record.path === unscannableRecord.path)) {
      records.push({ artifact_id: `ART-${String(records.length + 1).padStart(3, '0')}`, path: unscannableRecord.path, type: 'LARGE_FILE', format: formatFor(unscannableRecord.path), bytes: unscannableRecord.bytes, file_count: null, source_or_purpose: 'bounded scanner exclusion inventory', included_in_docker_build_context: 'UNKNOWN', scan_method: 'EXCEEDS_PINNED_SCANNER_MAX_TARGET_SIZE', scan_timestamp_utc: null, result_count: null, sanitized_report_reference: null, final_status: 'UNSCANNED' });
    }
  }
  const totals = Object.fromEntries(['CLEAN', 'FINDINGS_RECONCILED', 'UNSCANNED', 'UNSUPPORTED', 'OUT_OF_SCOPE_WITH_JUSTIFICATION'].map((status) => [status, records.filter((record) => record.final_status === status).length]));
  const inventory = { schema_version: '08A1-artifact-inventory-v1', run_id: runId, generated_at_utc: new Date().toISOString(), records, totals };
  await mkdir(path.dirname(outputJson), { recursive: true });
  await mkdir(path.dirname(outputMarkdown), { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  const rows = records.map((record) => `| ${[record.artifact_id, record.path, record.type, record.format, record.bytes, record.included_in_docker_build_context, record.scan_method, record.final_status].map(markdownCell).join(' | ')} |`).join('\n');
  await writeFile(outputMarkdown, `# 08A artifact review inventory\n\nThis is a safe filesystem inventory; it does **not** claim content review. The inventory walks with \`lstat\` and does not follow links or execute artifacts. A record cannot become \`CLEAN\` without a successful scan method, UTC timestamp, zero result count, and sanitized report reference.\n\n- Run ID: \`${runId}\`\n- Records: ${records.length}\n- Status totals: ${Object.entries(totals).map(([status, count]) => `${status}=${count}`).join(', ')}\n\n| ID | Path | Type | Format | Bytes | Docker context | Scan method | Status |\n| --- | --- | --- | --- | ---: | --- | --- | --- |\n${rows}\n`, 'utf8');
  process.stdout.write(`Inventoried ${records.length} artifact records.\n`);
}
main().catch((error) => { process.stderr.write(`Artifact inventory failed: ${error.message}\n`); process.exitCode = 1; });
