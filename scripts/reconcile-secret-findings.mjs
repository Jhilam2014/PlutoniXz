#!/usr/bin/env node

/**
 * 08A1B reconciliation. Source reports are structurally redacted before any
 * row is used. Gitleaks' Fingerprint is location-oriented metadata, not a
 * credential-equality proof, so each canonical occurrence remains a separate
 * logical item unless a later evidence-backed process supplies stronger proof.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SCHEMA_VERSION = '08A1B-canonical-inventory-v1';
const FINGERPRINT_SEMANTICS = 'Gitleaks Fingerprint is scanner-native, location-oriented finding metadata. It is not a credential-value digest and cannot prove credential equality across distinct objects.';
const NO_EQUALITY_BASIS = 'NO_SAFE_CREDENTIAL_EQUALITY_IDENTIFIER_AVAILABLE';
const PROHIBITED_FIELD = /^(?:secret|match|authorization|token_value|replacement_value)$/i;

function argument(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
function argumentsFor(name) { return process.argv.flatMap((value, index) => value === name && process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? [process.argv[index + 1]] : []); }
function required(name) { const value = argument(name); if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`); return value; }
function safeReportPath(value) { return value.replace(/^.*?(runtime\/secret-scan\/)/, '$1'); }
function reportId(value) { return path.basename(value).replace(/\.gitleaks\.json$/, ''); }
function categoryFor(ruleId) { return ruleId === 'gcp-api-key' ? 'GCP_API_KEY_RULE' : ruleId === 'openai-api-key' ? 'OPENAI_API_KEY_RULE' : ruleId === 'generic-api-key' ? 'GENERIC_API_KEY_RULE' : 'OTHER_SCANNER_RULE'; }
function stableId(prefix, value) { return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 20).toUpperCase()}`; }
function safeText(value, label) { if (typeof value !== 'string' || value.length === 0) throw new Error(`Report record has no safe ${label}.`); return value; }
function currentCommit(record) { return typeof record.Commit === 'string' && record.Commit.length > 0 ? record.Commit : 'CURRENT_TREE'; }
function locationFor(file, scope) {
  const relative = file.replace(/^\/(?:worktree|repo|artifact)\//, '');
  const prefixes = { runtime: 'runtime', memory: 'memory', observability: 'observability', deliverables: 'deliverables', 'apps-frontend-dist': 'apps/frontend/dist', 'apps-generated-site-dist': 'apps/generated-site/dist' };
  if (scope === 'reachable-git-history' || scope === 'worktree') return relative;
  const prefix = prefixes[scope];
  return prefix && !relative.startsWith(`${prefix}/`) ? `${prefix}/${relative}` : relative;
}
function reachabilityFor(scope, commit, location) {
  if (scope === 'reachable-git-history' || commit !== 'CURRENT_TREE') return 'REACHABLE_HISTORY';
  if (scope === 'worktree') return 'CURRENT_TREE';
  if (location.startsWith('runtime/')) return 'RUNTIME_ARTIFACT';
  if (location.startsWith('memory/')) return 'MEMORY_ARTIFACT';
  if (location.startsWith('observability/')) return 'OBSERVABILITY_ARTIFACT';
  return 'BUILD_EXPORT_OR_DELIVERABLE_ARTIFACT';
}
function ownerDomainFor(reachability) { return `SOURCE_OWNER_${reachability}`; }
function sourceClass(location, scope) {
  const lower = location.toLowerCase();
  if (lower.includes('secret-scan/')) return 'SCANNER_OUTPUT_OR_REPORT_INPUT';
  if (lower.includes('.zip!') || /\.(zip|tar|tgz|gz|7z)!/.test(lower)) return 'ARCHIVE_OR_BACKUP_CONTENT';
  if (/(^|\/)(node_modules|vendor|cache)(\/|$)/.test(lower)) return 'VENDORED_OR_CACHE_CONTENT';
  if (/(^|\/)(test|tests|fixtures?)(\/|$)/.test(lower)) return 'TEST_OR_FIXTURE_CONTENT';
  if (/(backup|export|deliverable)/.test(lower)) return 'COPIED_BACKUP_OR_EXPORT_CONTENT';
  return `${scope.toUpperCase().replaceAll('-', '_')}_SOURCE`;
}
function assertSanitizedReport(rows) {
  if (!Array.isArray(rows)) throw new Error('The source report must be an array.');
  for (const row of rows) {
    if (row?.Secret !== 'REDACTED') throw new Error('Source report is unsafe: Secret is not exactly REDACTED.');
    if (typeof row.Match !== 'string' || !row.Match.includes('REDACTED')) throw new Error('Source report is unsafe: Match is not demonstrably redacted.');
    safeText(row.Fingerprint, 'scanner fingerprint'); safeText(row.RuleID, 'rule ID'); safeText(row.File, 'repository path');
    if (row.Commit !== undefined && row.Commit !== null && typeof row.Commit !== 'string') throw new Error('Report record has an invalid commit identifier.');
  }
}
function markdownEscape(value) { return String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' '); }

export async function readSanitizedReports(sourceReports) {
  const result = [];
  for (const sourceReport of sourceReports) {
    const rows = JSON.parse(await readFile(sourceReport, 'utf8'));
    assertSanitizedReport(rows); // Must happen before any row is normalized or summarized.
    result.push({ sourceReport, rows });
  }
  return result;
}

export function buildCanonicalInventory(sourceSets, runId, provenance = {}) {
  const observations = [];
  const canonicalByKey = new Map();
  const observationsByCanonicalId = new Map();
  for (const { sourceReport, rows } of sourceSets) {
    const scope = reportId(sourceReport);
    rows.forEach((record, index) => {
      const fingerprint = safeText(record.Fingerprint, 'scanner fingerprint');
      const ruleId = safeText(record.RuleID, 'rule ID');
      const commit = currentCommit(record);
      const location = locationFor(safeText(record.File, 'repository path'), scope);
      const startLine = Number.isInteger(record.StartLine) ? record.StartLine : null;
      const endLine = Number.isInteger(record.EndLine) ? record.EndLine : startLine;
      const canonicalKey = JSON.stringify({ location, commit, ruleId, startLine, endLine, fingerprint });
      const canonicalOccurrenceId = stableId('CAN', canonicalKey);
      const observationId = stableId('OBS', JSON.stringify({ report: safeReportPath(sourceReport), index: index + 1 }));
      const reachability = reachabilityFor(scope, commit, location);
      const observation = {
        observation_id: observationId, run_id: runId, report_id: scope, scope_id: scope,
        scanner: 'gitleaks', scanner_version_or_digest: provenance.scanner_version_or_digest ?? 'UNRECORDED_IN_SOURCE_REPORT',
        rule_id: ruleId, category: categoryFor(ruleId), normalized_location: location, object_marker: commit,
        safe_line_metadata: { start_line: startLine, end_line: endLine }, safe_scanner_fingerprint: fingerprint,
        scanner_fingerprint_semantics: FINGERPRINT_SEMANTICS, reachability, source_class: sourceClass(location, scope),
        source_report: safeReportPath(sourceReport), source_observation_index: index + 1, canonical_occurrence_id: canonicalOccurrenceId,
      };
      observations.push(observation);
      if (!observationsByCanonicalId.has(canonicalOccurrenceId)) observationsByCanonicalId.set(canonicalOccurrenceId, []);
      observationsByCanonicalId.get(canonicalOccurrenceId).push(observation);
      if (!canonicalByKey.has(canonicalKey)) canonicalByKey.set(canonicalKey, {
        canonical_occurrence_id: canonicalOccurrenceId, canonical_identity: { normalized_location: location, object_marker: commit, rule_id: ruleId, start_line: startLine, end_line: endLine, safe_scanner_fingerprint: fingerprint },
        normalization_version: '08A1B-location-object-v1', reason: 'Same normalized object/location, object marker, rule, line span, and scanner-native finding identity in one inventory.',
        rule_id: ruleId, category: categoryFor(ruleId), safe_credential_equality_identifier: null, safe_credential_equality_semantics: NO_EQUALITY_BASIS,
        contributing_observation_ids: [], contributing_report_ids: [], contributing_scope_ids: [], logical_item_id: stableId('LI', canonicalOccurrenceId),
      });
      const canonical = canonicalByKey.get(canonicalKey);
      canonical.contributing_observation_ids.push(observationId);
      if (!canonical.contributing_report_ids.includes(scope)) canonical.contributing_report_ids.push(scope);
      if (!canonical.contributing_scope_ids.includes(scope)) canonical.contributing_scope_ids.push(scope);
    });
  }
  const canonicalOccurrences = [...canonicalByKey.values()].sort((a, b) => a.canonical_occurrence_id.localeCompare(b.canonical_occurrence_id));
  const logicalItems = canonicalOccurrences.map((canonical) => {
    const linked = observationsByCanonicalId.get(canonical.canonical_occurrence_id) ?? [];
    const reachability = [...new Set(linked.map((item) => item.reachability))].sort();
    return {
      logical_item_id: canonical.logical_item_id, canonical_occurrence_ids: [canonical.canonical_occurrence_id], grouping_basis: NO_EQUALITY_BASIS,
      grouping_evidence_strength: 'CONSERVATIVE_SEPARATE_ITEM', suspected_provider: 'UNVERIFIED', provider_identity_status: 'RULE_LABEL_NOT_PROVIDER_PROOF',
      reachability, candidate_source_owner_domain: ownerDomainFor(reachability[0]), authorized_owner: 'UNASSIGNED', authority_status: 'OWNER_ASSIGNMENT_REQUIRED',
      disposition: 'UNKNOWN', status: 'UNRESOLVED', evidence_reference: null, evidence_level: 'NONE', current_tree_remediation_status: reachability.includes('CURRENT_TREE') ? 'NOT_DETERMINED' : 'NOT_PRESENT_IN_CURRENT_TREE_SCOPE', reachable_history_status: reachability.includes('REACHABLE_HISTORY') ? 'PRESENT' : 'NOT_PRESENT_IN_HISTORY_SCOPE',
    };
  });
  const categoryTotals = Object.fromEntries([...new Set(observations.map((item) => item.category))].sort().map((category) => [category, observations.filter((item) => item.category === category).length]));
  const scopeTotals = Object.fromEntries([...new Set(observations.map((item) => item.scope_id))].sort().map((scope) => [scope, observations.filter((item) => item.scope_id === scope).length]));
  const sourceClassTotals = Object.fromEntries([...new Set(observations.map((item) => item.source_class))].sort().map((sourceClass) => [sourceClass, observations.filter((item) => item.source_class === sourceClass).length]));
  return { schema_version: SCHEMA_VERSION, run_id: runId, provenance, source_reports: sourceSets.map(({ sourceReport }) => safeReportPath(sourceReport)), source_report_sanitation: 'STRUCTURALLY_VERIFIED_SECRET_AND_MATCH_REDACTED', scanner_fingerprint_semantics: FINGERPRINT_SEMANTICS, logical_grouping_policy: NO_EQUALITY_BASIS, observation_count: observations.length, canonical_occurrence_count: canonicalOccurrences.length, logical_item_count: logicalItems.length, unresolved_logical_item_count: logicalItems.length, category_totals: categoryTotals, scope_totals: scopeTotals, source_class_totals: sourceClassTotals, scan_observations: observations, canonical_occurrences: canonicalOccurrences, logical_items: logicalItems,
    // Compatibility aliases retain old consumers while preserving the new model.
    occurrence_count_in_source_report: observations.length, occurrence_count_in_manifest: observations.length, occurrences: observations, logical_credentials: logicalItems };
}

function reconciliationMarkdown(manifest) {
  const logicalRows = manifest.logical_items.map((item) => `| ${[item.logical_item_id, item.canonical_occurrence_ids.join(', '), item.candidate_source_owner_domain, item.reachability.join(', '), item.status].map(markdownEscape).join(' | ')} |`).join('\n');
  const canonicalRows = manifest.canonical_occurrences.map((item) => `| ${[item.canonical_occurrence_id, item.contributing_observation_ids.length, item.canonical_identity.normalized_location, item.canonical_identity.object_marker, item.logical_item_id].map(markdownEscape).join(' | ')} |`).join('\n');
  return `# 08A1B finding reconciliation\n\nThis inventory contains sanitized scanner metadata only. Redaction is verified before parsing. Scanner rule labels and scanner-native fingerprints do not prove provider, owner, validity, or credential equality.\n\n- Run ID: \`${manifest.run_id}\`\n- Source reports: ${manifest.source_reports.map((value) => `\`${value}\``).join(', ')}\n- Scan observations: ${manifest.observation_count}\n- Canonical occurrences: ${manifest.canonical_occurrence_count}\n- Logical items: ${manifest.logical_item_count}\n- Unresolved logical items: ${manifest.unresolved_logical_item_count}\n- Scope totals: ${Object.entries(manifest.scope_totals).map(([key, value]) => `${key}=${value}`).join(', ')}\n- Category totals: ${Object.entries(manifest.category_totals).map(([key, value]) => `${key}=${value}`).join(', ')}\n- Fingerprint semantics: ${manifest.scanner_fingerprint_semantics}\n- Logical grouping policy: \`${manifest.logical_grouping_policy}\`\n\n## Logical item inventory\n\n| Logical item | Canonical occurrence | Candidate source-owner domain | Reachability | Status |\n| --- | --- | --- | --- | --- |\n${logicalRows}\n\n## Canonical occurrence inventory\n\n| Canonical occurrence | Observations | Normalized location | Object marker | Logical item |\n| --- | ---: | --- | --- | --- |\n${canonicalRows}\n`;
}

async function main() {
  const sourceReports = argumentsFor('--source-report'); if (sourceReports.length === 0) throw new Error('Missing --source-report');
  const outputJson = required('--output-json'); const outputMarkdown = required('--output-markdown'); const runId = required('--run-id');
  const provenance = { scanner_version_or_digest: argument('--scanner-version-or-digest') ?? 'UNRECORDED_IN_SOURCE_REPORT', scanner_config_sha256: argument('--scanner-config-sha256') ?? 'UNRECORDED', input_roots: argumentsFor('--input-root'), output_root: argument('--output-root') ?? 'UNRECORDED', commit_boundary: argument('--commit-boundary') ?? 'UNRECORDED' };
  const manifest = buildCanonicalInventory(await readSanitizedReports(sourceReports), runId, provenance);
  await mkdir(path.dirname(outputJson), { recursive: true }); await mkdir(path.dirname(outputMarkdown), { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'); await writeFile(outputMarkdown, reconciliationMarkdown(manifest), 'utf8');
  process.stdout.write(`Reconciled ${manifest.observation_count} observations into ${manifest.canonical_occurrence_count} canonical occurrences and ${manifest.logical_item_count} logical items.\n`);
}
if (process.argv[1] === new URL(import.meta.url).pathname) main().catch((error) => { process.stderr.write(`08A1B reconciliation failed: ${error.message}\n`); process.exitCode = 1; });
