import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildProjectAgentTopology, syncProjectAgentTopology } from "../src/projectAgents.js";

const environmentKeys = [
  "PLUTONIX_PROJECT_ROOT",
  "PROJECT_AGENT_RUNTIME_ROOT",
  "PROJECT_AGENT_MARKDOWN_ROOT",
  "PROJECT_AGENT_ARCHIVE_ROOT",
  "PROJECT_AGENT_REUSE_DECISION_ROOT",
  "PROJECT_AGENT_REGISTRY_ROOT",
  "PROJECT_AGENT_NEO4J_PATH",
  "AGENTIC_SYSTEM_GRAPH_PATH",
  "FRONTEND_AGENTIC_SYSTEM_GRAPH_PATH",
  "DELETED_AGENTS_PATH"
];

function project(id, workspaceDir = "") {
  return { id, name: id.replaceAll("-", " "), folderName: id, workspaceDir, port: 5200 };
}

const mediumRequest = {
  taskType: "Medium",
  objective: "Maintain the application.",
  productDecision: { productShape: "existing_product_change", interactionModel: "preserve_existing" }
};

test("equivalent projects share AgentDefinition IDs and keep distinct assignments", () => {
  const first = buildProjectAgentTopology(project("alpha-project"), mediumRequest);
  const second = buildProjectAgentTopology(project("beta-project"), mediumRequest, null, first.agents);

  assert.deepEqual(second.agents.map((agent) => agent.id), first.agents.map((agent) => agent.id));
  assert.ok(first.agents.every((agent) => agent.definitionType === "AgentDefinition" && agent.scope === "global_reusable"));
  assert.ok(first.agents.every((agent) => !agent.id.startsWith("alpha-project-")));
  assert.ok(second.agents.every((agent) => !agent.id.startsWith("beta-project-")));
  assert.ok(first.agentReuseDecisions.every((decision) => decision.decisionType === "create_new_agent"));
  assert.ok(second.agentReuseDecisions.every((decision) => decision.decisionType === "exact_reuse"));
  assert.equal(new Set(first.agentAssignments.map((assignment) => assignment.id)).size, first.agents.length);
  assert.ok(second.agentAssignments.every((assignment) => assignment.id.includes(":beta-project:")));
  assert.ok(second.agentAssignments.every((assignment) => !first.agentAssignments.some((firstAssignment) => firstAssignment.id === assignment.id)));
});

test("small work binds the canonical execution pair and never creates functionality-specific agents", () => {
  const topology = buildProjectAgentTopology(project("small-project"), {
    ...mediumRequest,
    taskType: "Small",
    discoveredFunctionalities: [{ id: "checkout", label: "Checkout", category: "other" }]
  });

  assert.deepEqual(topology.agents.map((agent) => agent.id), ["project-execution-agent", "qagent-controller"]);
  assert.equal(topology.functionalityAssignments[0].agentId, "project-execution-agent");
  assert.equal(topology.functionalityAssignments[0].projectAgentAssignmentId, "project-agent-assignment:small-project:project-execution-agent");
  assert.equal(topology.agents.some((agent) => agent.id.includes("functionality-checkout")), false);
});

test("artifact-specific instructions stay on assignments instead of shared definitions", () => {
  const pdf = buildProjectAgentTopology(project("pdf-project"), {
    ...mediumRequest,
    productDecision: { productShape: "artifact_only", artifactType: "PDF" }
  });
  const workbook = buildProjectAgentTopology(project("workbook-project"), {
    ...mediumRequest,
    productDecision: { productShape: "artifact_only", artifactType: "workbook" }
  }, null, pdf.agents);
  const definition = workbook.agents.find((agent) => agent.id === "artifact-production-agent");
  const assignment = workbook.agentAssignments.find((item) => item.agentId === definition.id);

  assert.doesNotMatch(definition.responsibility, /PDF|workbook/i);
  assert.match(assignment.projectResponsibility, /workbook/i);
  assert.equal(workbook.agentReuseDecisions.find((item) => item.selectedAgent === definition.id).decisionType, "exact_reuse");
});

test("sync archives legacy project-prefixed definitions and persists reuse decisions", async (context) => {
  const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-agent-reuse-"));
  const workspaceDir = path.join(root, "workspace");
  const runtimeRoot = path.join(root, "runtime", "agents", "projects");
  const generatedRoot = path.join(root, "agents", "generated");
  const archiveRoot = path.join(root, "agents", "archived", "legacy-project-scoped");
  const legacyId = "legacy-project-orchestrator-agent";
  await fs.mkdir(path.join(workspaceDir, ".agentic", "agents"), { recursive: true });
  await fs.mkdir(runtimeRoot, { recursive: true });
  await fs.mkdir(generatedRoot, { recursive: true });

  Object.assign(process.env, {
    PLUTONIX_PROJECT_ROOT: root,
    PROJECT_AGENT_RUNTIME_ROOT: runtimeRoot,
    PROJECT_AGENT_MARKDOWN_ROOT: generatedRoot,
    PROJECT_AGENT_ARCHIVE_ROOT: archiveRoot,
    PROJECT_AGENT_REUSE_DECISION_ROOT: path.join(root, "registry", "agent-reuse-decisions"),
    PROJECT_AGENT_REGISTRY_ROOT: path.join(root, "registry", "agents"),
    PROJECT_AGENT_NEO4J_PATH: path.join(root, "graph", "generated-project-agents.cypher"),
    AGENTIC_SYSTEM_GRAPH_PATH: path.join(root, "topology", "agentic-system-graph.json"),
    FRONTEND_AGENTIC_SYSTEM_GRAPH_PATH: path.join(root, "frontend", "agentic-system-graph.json"),
    DELETED_AGENTS_PATH: path.join(root, "runtime", "agents", "deleted-agents.json")
  });
  context.after(async () => {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  const legacyTopology = {
    project: project("legacy-project", workspaceDir),
    instruction: { objective: "Maintain the application.", productDecision: mediumRequest.productDecision },
    agents: [{
      id: legacyId,
      name: "Legacy Project Orchestrator Agent",
      role: "project-orchestrator",
      responsibility: "Legacy project-local definition.",
      projectId: "legacy-project"
    }],
    relationships: []
  };
  await fs.writeFile(path.join(runtimeRoot, "legacy-project.agents.json"), JSON.stringify(legacyTopology));
  await fs.writeFile(path.join(generatedRoot, `${legacyId}.agent.md`), `agent_id: ${legacyId}\nproject_id: legacy-project\n`);
  await fs.writeFile(path.join(workspaceDir, ".agentic", "agents", `${legacyId}.agent.md`), `agent_id: ${legacyId}\nproject_id: legacy-project\n`);

  const topology = await syncProjectAgentTopology(project("legacy-project", workspaceDir), mediumRequest);

  assert.equal(topology.agentModelVersion, "2.0.0");
  assert.equal(topology.agents.some((agent) => agent.id === legacyId), false);
  assert.ok(topology.agentReuseDecisions.length === topology.agents.length);
  await fs.access(path.join(archiveRoot, `${legacyId}.agent.md`));
  await fs.access(path.join(workspaceDir, ".agentic", "agents", "archive", `${legacyId}.agent.md`));
  const decisions = JSON.parse(await fs.readFile(path.join(root, "registry", "agent-reuse-decisions", "legacy-project.agent-reuse-decisions.json"), "utf8"));
  assert.equal(decisions.decisions.length, topology.agents.length);
  const definition = await fs.readFile(path.join(generatedRoot, "project-orchestrator-agent.agent.md"), "utf8");
  assert.match(definition, /scope: "global_reusable"/);
  assert.doesNotMatch(definition, /project_name:/);
  const graph = JSON.parse(await fs.readFile(path.join(root, "topology", "agentic-system-graph.json"), "utf8"));
  assert.ok(graph.nodes.some((node) => node.type === "agent_assignment"));
});
