MERGE (p:Project {id: 'project:orchestrator-agent-001', name: 'plutomix'})
MERGE (w:Workflow {id: 'bootstrap-orchestrator-001', name: 'Bootstrap Orchestrator', status: 'complete'})
MERGE (a:Agent {id: 'project-execution-agent', name: 'Project Execution Agent', status: 'active', version: '1.0.0'})
MERGE (m:ApplicationFunctionality {id: 'agent-memory', name: 'Agent Memory', status: 'bootstrapped'})
MERGE (g:ApplicationFunctionality {id: 'neo4j-graph', name: 'Neo4j Graph Artifacts', status: 'ready'})
MERGE (v:VectorMemoryProvider {id: 'vector-memory', provider: 'chroma_local_generated', status: 'pending_install'})
MERGE (d:D3Page {id: 'agentic-system-d3', path: 'agentic-system/d3/index.html', status: 'ready'})
MERGE (p)-[:CONTAINS]->(w)
MERGE (w)-[:ASSIGNED_TO]->(a)
MERGE (a)-[:OWNS]->(m)
MERGE (a)-[:OWNS]->(g)
MERGE (a)-[:OWNS]->(v)
MERGE (g)-[:VISUALIZED_BY]->(d)
MERGE (v)-[:VISUALIZED_BY]->(d);

// Gotham Studio control-plane projection. Applying this to a live Neo4j
// deployment remains an explicit operator action.
MATCH (p:Project {id: 'project:orchestrator-agent-001'}),
      (a:Agent {id: 'project-execution-agent'}),
      (g:ApplicationFunctionality {id: 'neo4j-graph'}),
      (m:ApplicationFunctionality {id: 'agent-memory'})
MERGE (sw:Workflow {id: 'gotham-studio-control-plane-20260827', name: 'Gotham Studio AI/ML Control Plane', status: 'completed'})
MERGE (studio:ApplicationFunctionality {id: 'gotham-studio', name: 'Gotham Studio', status: 'implemented'})
SET studio.provider_neutral = true, studio.project_scoped = true
MERGE (provider:ApplicationFunctionality {id: 'gotham-studio-provider-boundary', name: 'ML Execution Provider Boundary', status: 'implemented'})
SET provider.providers = ['databricks', 'azure-ml'], provider.credentials = 'backend_only'
MERGE (ledger:ApplicationFunctionality {id: 'gotham-studio-persistence', name: 'Studio Execution Ledger', status: 'implemented'})
SET ledger.scope = ['tenant', 'workspace', 'project']
MERGE (studioPage:D3Page {id: 'gotham-studio', path: 'apps/frontend/src/gotham-studio/GothamStudio.jsx', status: 'implemented'})
MERGE (studioValidation:Validation {id: 'gotham-studio-contract', name: 'Gotham Studio Contract Validation', status: 'passed'})
MERGE (p)-[:CONTAINS]->(sw)
MERGE (sw)-[:ASSIGNED_TO]->(a)
MERGE (sw)-[:IMPLEMENTS]->(studio)
MERGE (studio)-[:USES]->(provider)
MERGE (studio)-[:PERSISTS_TO]->(ledger)
MERGE (studio)-[:VISUALIZED_BY]->(studioPage)
MERGE (sw)-[:VALIDATED_BY]->(studioValidation)
MERGE (studio)-[:REPRESENTED_IN]->(g)
MERGE (studio)-[:RECORDS_MEMORY_IN]->(m);
