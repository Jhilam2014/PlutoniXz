#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
  'agents/generated/project-execution-agent.agent.md',
  'registry/agents/project-execution-agent.registry.json',
  'registry/agents/vector-sync-index.json',
  'graph/neo4j/schema.cypher',
  'graph/neo4j/constraints.cypher',
  'graph/neo4j/seed-agents-and-functionalities.cypher',
  'graph/workspace-graph.json',
  'topology/d3/agentic-system-graph.json',
  'topology/d3/agentic-system-graph.schema.json',
  'agentic-system/d3/index.html',
  'agentic-system/d3/agentic-system-d3.js',
  'agentic-system/d3/agentic-system.css',
  'memory/vector/provider-resolution.json',
  'memory/vector/prompt-ledger.jsonl',
  'observability/agent-memory/env-check.json',
  'observability/agent-memory/latest-sync.json',
  'observability/agent-memory/vector-store-verification.json',
  'observability/graph/neo4j-sync-status.json',
  'schemas/agent-knowledge-record.schema.json',
  'schemas/agent-capability-score.schema.json',
  'schemas/agent-vector-memory.schema.json',
  'tests/agent-memory/agent-selection.test.ts',
  'tests/agent-memory/agent-scoring.test.ts',
  'tests/agent-memory/repeated-request-detector.test.ts',
  'tests/agent-memory/vector-store-sync.test.ts',
]
JSON_FILES = [
  'registry/agents/project-execution-agent.registry.json',
  'registry/agents/vector-sync-index.json',
  'graph/workspace-graph.json',
  'topology/d3/agentic-system-graph.json',
  'topology/d3/agentic-system-graph.schema.json',
  'memory/vector/provider-resolution.json',
  'observability/agent-memory/env-check.json',
  'observability/agent-memory/latest-sync.json',
  'observability/agent-memory/vector-store-verification.json',
  'observability/graph/neo4j-sync-status.json',
  'schemas/agent-knowledge-record.schema.json',
  'schemas/agent-capability-score.schema.json',
  'schemas/agent-vector-memory.schema.json',
]

missing = [path for path in REQUIRED if not (ROOT / path).exists()]
json_errors = []
for path in JSON_FILES:
    try:
        json.loads((ROOT / path).read_text())
    except Exception as exc:
        json_errors.append({'path': path, 'error': str(exc)})

result = {
  'status': 'success' if not missing and not json_errors else 'failed',
  'missing': missing,
  'json_errors': json_errors,
  'checked_required_count': len(REQUIRED),
}
out = ROOT / 'observability/bootstrap-orchestrator-001/bootstrap-verification.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
raise SystemExit(0 if result['status'] == 'success' else 1)
