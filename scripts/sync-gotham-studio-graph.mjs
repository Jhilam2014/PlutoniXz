#!/usr/bin/env node

/** Incrementally exposes Gotham Studio without replacing generated project topology. */
import { readFile, writeFile } from "node:fs/promises";

const workflowId = "gotham-studio-control-plane-20260827";
const graphFiles = [
  "graph/workspace-graph.json",
  "topology/d3/agentic-system-graph.json",
  "apps/frontend/public/topology/d3/agentic-system-graph.json"
];
const nodes = [
  { id: `workflow:${workflowId}`, type: "workflow", label: "Gotham Studio AI/ML Control Plane", group: "workflow", risk_level: "high", status: "completed", metadata: { productShape: "existing_product_change", externalCompute: "explicit_executor_only" } },
  { id: "functionality:gotham-studio", type: "functionality", label: "Gotham Studio", group: "ml-control-plane", risk_level: "high", status: "implemented", metadata: { projectScoped: true, providerNeutral: true, route: "/api/gotham-studio" } },
  { id: "functionality:gotham-studio-provider-boundary", type: "service", label: "ML Execution Provider Boundary", group: "ml-provider", risk_level: "high", status: "implemented", metadata: { providers: ["databricks", "azure-ml"], credentials: "backend_only" } },
  { id: "functionality:gotham-studio-persistence", type: "database", label: "Studio Execution Ledger", group: "data", risk_level: "high", status: "implemented", metadata: { productionRepository: "postgresql", developmentFallback: "atomic_json", scopedBy: ["tenant", "workspace", "project"] } },
  { id: "page:gotham-studio", type: "page", label: "Gotham Studio Workspace", group: "dashboard-ui", risk_level: "medium", status: "implemented", metadata: { internalTo: "Gotham Builder", workspace: "gotham-studio" } },
  { id: "validation:gotham-studio-contract", type: "validation", label: "Gotham Studio Contract Validation", group: "validation", risk_level: "high", status: "passed", metadata: { backendContractTests: 17, frontendContractTests: 8, frontendBuild: "passed", visualBrowser: "unavailable" } }
];
const links = [
  { source: "project:orchestrator-agent-001", target: `workflow:${workflowId}`, type: "contains", weight: 1, metadata: {} },
  { source: "agent:project-execution-agent", target: `workflow:${workflowId}`, type: "assigned_to", weight: 1, metadata: { reuseDecision: "exact_reuse" } },
  { source: `workflow:${workflowId}`, target: "functionality:gotham-studio", type: "implements", weight: 1, metadata: {} },
  { source: "functionality:gotham-studio", target: "functionality:gotham-studio-provider-boundary", type: "uses", weight: 1, metadata: {} },
  { source: "functionality:gotham-studio", target: "functionality:gotham-studio-persistence", type: "persists_to", weight: 1, metadata: {} },
  { source: "functionality:gotham-studio", target: "page:gotham-studio", type: "visualized_by", weight: 1, metadata: {} },
  { source: `workflow:${workflowId}`, target: "validation:gotham-studio-contract", type: "validates", weight: 1, metadata: {} },
  { source: "functionality:gotham-studio", target: "functionality:agent-memory", type: "records_memory_in", weight: 1, metadata: {} },
  { source: "functionality:gotham-studio", target: "functionality:neo4j-graph", type: "represented_in", weight: 1, metadata: {} }
];

function linkKey(link) {
  return `${link.source}|${link.target}|${link.type}`;
}

for (const file of graphFiles) {
  const graph = JSON.parse(await readFile(file, "utf8"));
  graph.metadata ??= {};
  graph.metadata.latest_workflow_id = workflowId;
  graph.metadata.gotham_studio = { status: "implemented", providers: ["databricks", "azure-ml"] };
  const nodeMap = new Map((graph.nodes || []).map((item) => [item.id, item]));
  for (const node of nodes) nodeMap.set(node.id, node);
  graph.nodes = [...nodeMap.values()];
  const linkMap = new Map((graph.links || []).map((item) => [linkKey(item), item]));
  for (const link of links) linkMap.set(linkKey(link), link);
  graph.links = [...linkMap.values()];
  await writeFile(file, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
}

const mapPath = "graph/agent-functionality-map.json";
const map = JSON.parse(await readFile(mapPath, "utf8"));
map.latest_workflow_id = workflowId;
const executor = map.agents.find((agent) => agent.agent_id === "project-execution-agent");
if (executor) {
  executor.owns = [...new Set([...(executor.owns || []), "gotham-studio", "gotham-studio-provider-boundary", "gotham-studio-persistence"] )];
  executor.validates = [...new Set([...(executor.validates || []), "gotham-studio-contract"] )];
}
await writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");

process.stdout.write("Incrementally synchronized Gotham Studio into workspace, D3, and agent-functionality graphs.\n");
