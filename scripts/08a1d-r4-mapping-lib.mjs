import { createHash } from 'node:crypto';

const R2_SCHEMA = '08A1B-R2-logical-credential-inventory-v1';
const R4_RESOLUTION_SCHEMA = '08A1C-R4-reconstructed-disposition-v1';
export const R4_MAPPING_SCHEMA = '08A1D-R4-artifact-logical-mapping-v1';
const FORBIDDEN_FIELD = /^(?:secret|match|authorization|token_value|credential_value|replacement_value|raw_value|candidate_tag|equality_tag)$/i;
const CREDENTIAL_SHAPE = /(?:apify_api|sk-(?:proj-)?|AIza|AKIA|xox[abprs])[_-]?[A-Za-z0-9]{12,}|(?:api[_-]?key|token)\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i;

function fail(message) { throw new Error(message); }
function checksum(value) { return createHash('sha256').update(value).digest('hex'); }
function noSecretBearingData(value) { if (typeof value === 'string') return !CREDENTIAL_SHAPE.test(value); if (Array.isArray(value)) return value.every(noSecretBearingData); return !value || typeof value !== 'object' || Object.entries(value).every(([key, nested]) => !FORBIDDEN_FIELD.test(key) && noSecretBearingData(nested)); }
function equalSets(left, right) { return left.size === right.size && [...left].every((value) => right.has(value)); }
function countBy(items, field) { return Object.fromEntries([...items.reduce((map, item) => { const key = typeof field === 'function' ? field(item) : item[field]; map.set(key, (map.get(key) ?? 0) + 1); return map; }, new Map()).entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))); }
function normal(value) { return String(value ?? '').replace(/^\/(?:artifact|worktree|repo)\//, '').replaceAll('\\', '/'); }
function reportScope(reference) { const name = String(reference ?? '').split('/').at(-1) ?? ''; return name.replace(/\.gitleaks\.json$/, ''); }
function locationsFor(row, reference) {
  const value = normal(row.File); const scope = reportScope(reference); const roots = { runtime: 'runtime/', memory: 'memory/', observability: 'observability/', deliverables: 'deliverables/', 'apps-frontend-dist': 'apps/frontend/dist/', 'apps-generated-site-dist': 'apps/generated-site/dist/', 'apps-desktop-resources': 'apps/desktop/resources/' };
  const candidates = new Set([value]);
  if (roots[scope] && !value.startsWith(roots[scope])) candidates.add(`${roots[scope]}${value}`);
  return [...candidates];
}
function rowsForRecord(record, rows, reference) {
  if (record.path === '.') return rows;
  const scopeRoots = { runtime: 'runtime', memory: 'memory', observability: 'observability', deliverables: 'deliverables', 'apps-frontend-dist': 'apps/frontend/dist', 'apps-generated-site-dist': 'apps/generated-site/dist', 'apps-desktop-resources': 'apps/desktop/resources' };
  if (scopeRoots[reportScope(reference)] === record.path) return rows;
  const prefix = `${record.path.replace(/\/$/, '')}/`;
  return rows.filter((row) => {
    const file = normal(row.File);
    return file === record.path || file.startsWith(prefix) || file.startsWith(`${record.path}!`);
  });
}

export function buildR4Mapping({ inventory, inventoryText, resolution, coverage, rowsByReference }) {
  if (inventory?.schema_version !== R2_SCHEMA || resolution?.schema_version !== R4_RESOLUTION_SCHEMA || coverage?.schema_version !== '08A1D-artifact-coverage-v1') fail('R4 mapping requires R2 inventory, R4 disposition, and retained 08A1D coverage schemas.');
  if (!noSecretBearingData(inventory) || !noSecretBearingData(resolution) || !noSecretBearingData(coverage)) fail('R4 mapping input contains prohibited secret-bearing data.');
  if (resolution.source_inventory?.run_id !== inventory.run_id || resolution.source_inventory?.content_checksum_sha256 !== checksum(inventoryText)) fail('R4 mapping cannot use a resolution from a different R2 lineage.');
  const resolutionById = new Map(resolution.dispositions.map((item) => [item.logical_item_id, item]));
  const canonicalIndex = new Map();
  for (const canonical of inventory.canonical_occurrences) {
    const key = `${canonical.normalized_location}|${canonical.rule_id}|${canonical.safe_line_metadata?.start_line ?? ''}`;
    const logical = inventory.logical_items.find((item) => item.canonical_occurrence_ids.includes(canonical.canonical_occurrence_id));
    if (!logical) fail('R2 canonical occurrence has no logical item.');
    canonicalIndex.set(key, [...(canonicalIndex.get(key) ?? []), logical.logical_item_id]);
  }
  const sourceRecords = [...coverage.roots, ...coverage.artifacts];
  const mappings = sourceRecords.map((record) => {
    const rows = record.sanitized_report_reference ? rowsForRecord(record, rowsByReference.get(record.sanitized_report_reference) ?? [], record.sanitized_report_reference) : [];
    const r2Ids = new Set(); let unmapped = 0;
    for (const row of rows) {
      const matches = new Set();
      for (const location of locationsFor(row, record.sanitized_report_reference)) for (const id of canonicalIndex.get(`${location}|${row.RuleID}|${Number.isInteger(row.StartLine) ? row.StartLine : ''}`) ?? []) matches.add(id);
      if (matches.size !== 1) unmapped += 1; else r2Ids.add([...matches][0]);
    }
    const logicalItemIds = [...r2Ids].sort();
    const allTerminal = logicalItemIds.length > 0 && logicalItemIds.every((id) => resolutionById.get(id)?.terminal === true);
    const mappingState = unmapped > 0 ? 'UNMAPPED_R2_REQUIRES_FULL_RERUN' : logicalItemIds.length === 0 ? 'NO_R2_LOGICAL_FINDINGS' : allTerminal ? 'FINDINGS_RECONCILED' : 'FINDINGS_MAPPED_PENDING_DISPOSITION';
    return { artifact_id: record.artifact_id, artifact_path: record.path, source_artifact_state: record.artifact_state, source_observation_count: record.observation_count, report_observation_count: rows.length, r2_logical_item_ids: logicalItemIds, r2_logical_item_count: logicalItemIds.length, unmapped_r2_observation_count: unmapped, mapping_state: mappingState, source_report_reference: record.sanitized_report_reference ?? null };
  });
  const totalUnmapped = mappings.reduce((sum, item) => sum + item.unmapped_r2_observation_count, 0);
  const countDrift = mappings.filter((item) => item.source_observation_count !== item.report_observation_count).length;
  const output = {
    schema_version: R4_MAPPING_SCHEMA,
    reviewed_at: '2026-08-13T00:00:00Z',
    source_inventory: { schema_version: inventory.schema_version, run_id: inventory.run_id, content_checksum_sha256: checksum(inventoryText) },
    source_coverage: { schema_version: coverage.schema_version, run_id: coverage.run_id, source_inventory_run_id: coverage.source_manifest_run_id, retained_as: 'HISTORICAL_BOUNDED_COVERAGE_EVIDENCE_ONLY' },
    coverage_status: 'FULL_RERUN_REQUIRED',
    coverage_retention_eligible: false,
    full_rerun_reason: 'The bounded artifact coverage predates the R2 inventory and lacks an R2-bound content-identity and scanner-configuration attestation; R4 may not claim that the old full scan remains current.',
    mappings,
    totals: { artifact_records: mappings.length, mapped_pending_disposition: mappings.filter((item) => item.mapping_state === 'FINDINGS_MAPPED_PENDING_DISPOSITION').length, findings_reconciled: mappings.filter((item) => item.mapping_state === 'FINDINGS_RECONCILED').length, no_r2_logical_findings: mappings.filter((item) => item.mapping_state === 'NO_R2_LOGICAL_FINDINGS').length, unmapped_records: mappings.filter((item) => item.mapping_state === 'UNMAPPED_R2_REQUIRES_FULL_RERUN').length, unmapped_observations: totalUnmapped, report_count_drift_records: countDrift, stale_predecessor_ids_active: 0 },
  };
  validateR4Mapping({ inventory, inventoryText, resolution, mapping: output });
  return output;
}

export function validateR4Mapping({ inventory, inventoryText, resolution, mapping }) {
  if (inventory?.schema_version !== R2_SCHEMA || resolution?.schema_version !== R4_RESOLUTION_SCHEMA || mapping?.schema_version !== R4_MAPPING_SCHEMA) fail('Unsupported R4 artifact mapping schema.');
  if (!noSecretBearingData(mapping)) fail('R4 artifact mapping contains prohibited secret-bearing data.');
  if (mapping.source_inventory?.run_id !== inventory.run_id || mapping.source_inventory?.content_checksum_sha256 !== checksum(inventoryText) || resolution.source_inventory?.run_id !== inventory.run_id || resolution.source_inventory?.content_checksum_sha256 !== checksum(inventoryText)) fail('R4 artifact mapping has stale R2 lineage.');
  if (mapping.coverage_status !== 'FULL_RERUN_REQUIRED' || mapping.coverage_retention_eligible !== false || typeof mapping.full_rerun_reason !== 'string' || mapping.full_rerun_reason.length < 30) fail('R4 artifact mapping incorrectly retains pre-R2 coverage.');
  const logicalIds = new Set(inventory.logical_items.map((item) => item.logical_item_id));
  const dispositionById = new Map(resolution.dispositions.map((item) => [item.logical_item_id, item]));
  if (!equalSets(new Set(dispositionById.keys()), logicalIds)) fail('R4 resolution cannot support artifact consistency because it does not cover every R2 item.');
  const artifactIds = new Set();
  for (const record of mapping.mappings ?? []) {
    if (typeof record.artifact_id !== 'string' || artifactIds.has(record.artifact_id) || !Array.isArray(record.r2_logical_item_ids) || new Set(record.r2_logical_item_ids).size !== record.r2_logical_item_ids.length || !Number.isInteger(record.unmapped_r2_observation_count) || record.unmapped_r2_observation_count < 0) fail('R4 artifact mapping record is malformed.');
    artifactIds.add(record.artifact_id);
    for (const logicalItemId of record.r2_logical_item_ids) if (!logicalIds.has(logicalItemId)) fail('An R2-predecessor or unknown logical ID remains active in 08A1D.');
    const allTerminal = record.r2_logical_item_ids.length > 0 && record.r2_logical_item_ids.every((id) => dispositionById.get(id).terminal === true);
    const expected = record.unmapped_r2_observation_count > 0 ? 'UNMAPPED_R2_REQUIRES_FULL_RERUN' : record.r2_logical_item_ids.length === 0 ? 'NO_R2_LOGICAL_FINDINGS' : allTerminal ? 'FINDINGS_RECONCILED' : 'FINDINGS_MAPPED_PENDING_DISPOSITION';
    if (record.mapping_state !== expected) fail('08A1D artifact state is inconsistent with its R4 logical dispositions.');
  }
  const calculated = countBy(mapping.mappings, 'mapping_state');
  const totals = mapping.totals ?? {};
  if (totals.artifact_records !== mapping.mappings.length || totals.mapped_pending_disposition !== (calculated.FINDINGS_MAPPED_PENDING_DISPOSITION ?? 0) || totals.findings_reconciled !== (calculated.FINDINGS_RECONCILED ?? 0) || totals.no_r2_logical_findings !== (calculated.NO_R2_LOGICAL_FINDINGS ?? 0) || totals.unmapped_records !== (calculated.UNMAPPED_R2_REQUIRES_FULL_RERUN ?? 0) || totals.unmapped_observations !== mapping.mappings.reduce((sum, item) => sum + item.unmapped_r2_observation_count, 0) || totals.stale_predecessor_ids_active !== 0) fail('R4 artifact mapping totals do not reconcile.');
  return totals;
}
