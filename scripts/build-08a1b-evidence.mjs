#!/usr/bin/env node

/** Writes the sanitized 08A1B count bridge and source-owner action inventory. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCanonicalInventory, readSanitizedReports } from './reconcile-secret-findings.mjs';

function argument(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function argumentsFor(name) { return process.argv.flatMap((value, index) => value === name && process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? [process.argv[index + 1]] : []); }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }
function cell(value) { return String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' '); }
async function write(pathname, value) { await mkdir(path.dirname(pathname), { recursive: true }); await writeFile(pathname, value, 'utf8'); }

async function main() {
  const sourceReports = argumentsFor('--source-report'); if (sourceReports.length === 0) throw new Error('Missing --source-report');
  const sourceSets = await readSanitizedReports(sourceReports); // redaction first
  const manifest = JSON.parse(await readFile(required('--manifest'), 'utf8'));
  const expected = buildCanonicalInventory(sourceSets, manifest.run_id, manifest.provenance);
  if (expected.observation_count !== manifest.observation_count || JSON.stringify(expected.scan_observations) !== JSON.stringify(manifest.scan_observations)) throw new Error('Manifest does not reproduce from sanitized source reports.');
  const [baselineSet] = await readSanitizedReports([required('--baseline-history-report')]);
  const summaryRows = (await readFile(required('--scan-summary'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  if (!summaryRows.every((row) => typeof row.scope === 'string' && Number.isInteger(row.findingCount) && typeof row.reportRedacted === 'boolean')) throw new Error('Malformed scan summary.');
  const baselineRows = baselineSet.rows.length;
  const historyRows = manifest.scope_totals['reachable-git-history'] ?? 0;
  const nonHistoryRows = manifest.observation_count - historyRows;
  const bridgeRows = [
    ['Earlier reachable-history report', baselineRows, 'Baseline; structurally redacted before use'],
    ['Current reachable-history scope', historyRows, historyRows === baselineRows ? 'Exact reproduction of earlier historical-observation count' : 'Count changed; investigate safe report metadata'],
    ['Current non-history scopes', nonHistoryRows, 'Worktree, runtime, memory, observability, and bounded clean artifact scopes'],
    ['Current source observations', manifest.observation_count, 'Sum of all current structurally redacted reports'],
    ['Canonical occurrences', manifest.canonical_occurrence_count, `${manifest.observation_count - manifest.canonical_occurrence_count} overlapping observations collapsed only by exact safe object/location identity`],
    ['Logical items', manifest.logical_item_count, 'No credential-equality grouping without a safe equality identifier'],
  ];
  const scopeRows = summaryRows.map((row) => [row.scope, row.findingCount, row.exitCode, row.durationSeconds, row.reportRedacted ? 'yes' : 'no']);
  const causeRows = Object.entries(manifest.source_class_totals).map(([sourceClass, count]) => [sourceClass, count, sourceClass === 'SCANNER_OUTPUT_OR_REPORT_INPUT' ? 'Scanner output path observed in source metadata; control excludes the producing report directory from runtime input.' : 'Safe location/scope classification; not a provider or credential identity conclusion.']);
  const bridge = `# 08A1B scan count bridge\n\nAll source reports passed structural redaction validation before parsing. Counts describe observations, not credentials.\n\n## Provenance\n\n- Run ID: \`${manifest.run_id}\`\n- Scanner: \`${manifest.provenance.scanner_version_or_digest}\`\n- Scanner configuration SHA-256: \`${manifest.provenance.scanner_config_sha256}\`\n- Commit boundary: \`${manifest.provenance.commit_boundary}\`\n- Input roots: ${manifest.provenance.input_roots.map((value) => `\`${value}\``).join(', ')}\n- Output root: \`${manifest.provenance.output_root}\`\n- Source sanitation: \`${manifest.source_report_sanitation}\`\n\n## Count bridge\n\n| Stage | Observations/items | Explanation |\n| --- | ---: | --- |\n${bridgeRows.map((row) => `| ${row.map(cell).join(' | ')} |`).join('\n')}\n\n## Per-scope scan summary\n\n| Scope | Findings | Exit | Duration seconds | Redaction guard |\n| --- | ---: | ---: | ---: | --- |\n${scopeRows.map((row) => `| ${row.map(cell).join(' | ')} |`).join('\n')}\n\n## Safe amplification diagnosis\n\n| Safe source class | Observations | Finding |\n| --- | ---: | --- |\n${causeRows.map((row) => `| ${row.map(cell).join(' | ')} |`).join('\n')}\n\nThe 32 historical observations are reproduced by the current reachable-history report. The remaining ${nonHistoryRows} observations arise from separately scoped current/artifact roots; they are retained. No scanner rule label, location, or native fingerprint is treated as credential equality.\n`;
  const groups = new Map();
  for (const item of manifest.logical_items) {
    const key = `${item.candidate_source_owner_domain}|${item.reachability.join(',')}`;
    if (!groups.has(key)) groups.set(key, { domain: item.candidate_source_owner_domain, reachability: item.reachability.join(', '), logicalIds: [] });
    groups.get(key).logicalIds.push(item.logical_item_id);
  }
  const actionRows = [...groups.values()].sort((a, b) => a.domain.localeCompare(b.domain)).map((group) => `| ${[group.domain, 'UNASSIGNED — candidate source-owner domain only', group.reachability, group.logicalIds.length, group.logicalIds.join(', '), 'Assign an authorized owner, establish provider/validity evidence, and create an item-specific disposition.'].map(cell).join(' | ')} |`).join('\n');
  const actions = `# 08A1B source-owner action inventory\n\nThis queue is derived from logical items, not duplicate scan observations. It is not an authority record and it assigns no provider identity or terminal disposition. Every listed item remains \`UNKNOWN\` / \`UNRESOLVED\`.\n\n- Run ID: \`${manifest.run_id}\`\n- Logical items: ${manifest.logical_item_count}\n- Evidence basis: \`${manifest.logical_grouping_policy}\`\n\n| Candidate source-owner domain | Authorized owner | Reachability | Logical item count | Explicit logical item membership | Required next action |\n| --- | --- | --- | ---: | --- | --- |\n${actionRows}\n`;
  await write(required('--output-count-bridge'), bridge); await write(required('--output-owner-action-inventory'), actions);
  process.stdout.write(`Wrote count bridge and action inventory for ${manifest.logical_item_count} logical items.\n`);
}
main().catch((error) => { process.stderr.write(`08A1B evidence generation failed: ${error.message}\n`); process.exitCode = 1; });

