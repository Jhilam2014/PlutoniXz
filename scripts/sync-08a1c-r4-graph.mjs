#!/usr/bin/env node

/** Incrementally expose the corrected R3/R4 semantic workflow to local graph/D3 projections. */
import { readFile, writeFile } from 'node:fs/promises';

const files = [
  'graph/workspace-graph.json',
  'topology/d3/agentic-system-graph.json',
  'apps/frontend/public/topology/d3/agentic-system-graph.json',
];
const nodes = [
  { id: 'workflow:08a1b-r3-semantic-triage', type: 'workflow', label: '08A1B R3 Semantic Triage', group: 'workflow', risk_level: 'high', status: 'blocked_semantic_replay', metadata: { source: '08A1B-R2', mode: 'repository_local_only', semantic_gate: 'BLOCKED' } },
  { id: 'functionality:08a1b-r3-semantic-classification', type: 'functionality', label: 'R2 Equality-class Semantic Classification', group: 'security-evidence', risk_level: 'high', status: 'semantically_unresolved', metadata: { deterministic_non_secret: 1, positive_secret_candidate: 0, semantically_unresolved: 1067 } },
  { id: 'validation:08a1b-r3-frozen-r2-replay', type: 'validation', label: 'Frozen R2 Raw-correlation Replay', group: 'validation', risk_level: 'high', status: 'bounded_replay_incomplete', metadata: { required: 'FROZEN_R2_RAW_CORRELATION_REPRODUCTION_REQUIRED' } },
  { id: 'workflow:08a1c-r4-reconstructed-disposition', type: 'workflow', label: '08A1C R4 Audit Queue', group: 'workflow', risk_level: 'high', status: 'non_actionable_pending_semantic_triage', metadata: { historical_requests: 1067, active_external_actions: 0 } },
  { id: 'validation:08a1d-r4-mapping', type: 'validation', label: '08A1D Rerun Gate', group: 'validation', risk_level: 'high', status: 'not_run_semantic_gate_blocked', metadata: { retained_records: 23, unmapped_observations: 31 } },
];
const links = [
  { source: 'project:orchestrator-agent-001', target: 'workflow:08a1b-r3-semantic-triage', type: 'contains', weight: 1, metadata: {} },
  { source: 'workflow:08a1b-r3-semantic-triage', target: 'functionality:08a1b-r3-semantic-classification', type: 'implements', weight: 1, metadata: {} },
  { source: 'workflow:08a1b-r3-semantic-triage', target: 'validation:08a1b-r3-frozen-r2-replay', type: 'validates', weight: 1, metadata: {} },
  { source: 'workflow:08a1b-r3-semantic-triage', target: 'workflow:08a1c-r4-reconstructed-disposition', type: 'depends_on', weight: 1, metadata: { requirement: 'zero_semantically_unresolved' } },
  { source: 'workflow:08a1b-r3-semantic-triage', target: 'validation:08a1d-r4-mapping', type: 'validates', weight: 1, metadata: { requirement: 'semantic_gate_pass' } },
  { source: 'agent:project-execution-agent', target: 'workflow:08a1b-r3-semantic-triage', type: 'assigned_to', weight: 1, metadata: {} },
];
function key(link) { return `${link.source}|${link.target}|${link.type}`; }
async function main() {
  for (const file of files) {
    const graph = JSON.parse(await readFile(file, 'utf8'));
    graph.metadata ??= {}; graph.metadata.latest_workflow_id = '08a1b-r3-semantic-triage';
    const nodeMap = new Map(graph.nodes.map((item) => [item.id, item])); for (const node of nodes) nodeMap.set(node.id, node); graph.nodes = [...nodeMap.values()];
    const linkMap = new Map(graph.links.map((item) => [key(item), item])); for (const link of links) linkMap.set(key(link), link); graph.links = [...linkMap.values()];
    await writeFile(file, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  }
  process.stdout.write('Incrementally synchronized 08A1B-R3 semantic triage, non-actionable R4 audit queue, and blocked 08A1D gate nodes to local graph/D3 projections.\n');
}
main().catch((error) => { process.stderr.write(`08A1C-R4 graph sync failed: ${error.message}\n`); process.exitCode = 1; });
