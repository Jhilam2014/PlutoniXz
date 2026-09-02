import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deleteGlobalAgent,
  invalidateGlobalAgentsCache,
  listGlobalAgents,
  openAiConfigFor
} from "../src/globalAgentKnowledge.js";
import { syncProjectAgentTopology } from "../src/projectAgents.js";

const environmentKeys = [
  "PLUTOMIX_PROJECT_ROOT",
  "PLUTOMIX_WORKSPACE_ROOT",
  "GLOBAL_AGENT_KNOWLEDGE_ROOTS",
  "OPENAI_AGENT_ENV_FILE",
  "OPENAI_API_KEY",
  "OPENAI_AGENT_VECTOR_STORE_ID",
  "PROJECT_AGENT_RUNTIME_ROOT",
  "PROJECT_AGENT_MARKDOWN_ROOT",
  "PROJECT_AGENT_NEO4J_PATH",
  "AGENTIC_SYSTEM_GRAPH_PATH",
  "FRONTEND_AGENTIC_SYSTEM_GRAPH_PATH",
  "DELETED_AGENTS_PATH"
];

test("deletes an agent definition, local memory, registry references, and topology membership", async (context) => {
  const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-agent-delete-"));
  const builderRoot = path.join(temporaryRoot, "plutomix");
  const workspaceDir = path.join(temporaryRoot, "apps", "demo-project");
  const agentId = "demo-project-orchestrator-agent";
  const generatedAgentPath = path.join(builderRoot, "agents", "generated", `${agentId}.agent.md`);
  const memoryPath = path.join(builderRoot, "memory", "agent-knowledge", "agents", `${agentId}.v1.0.0.md`);
  const topologyPath = path.join(builderRoot, "runtime", "agents", "projects", "demo-project.agents.json");
  const localAgentPath = path.join(workspaceDir, ".agentic", "agents", `${agentId}.agent.md`);
  const localOrchestratorPath = path.join(workspaceDir, ".agentic", "orchestrator-agent.md");
  const vectorIndexPath = path.join(builderRoot, "registry", "agents", "vector-sync-index.json");
  const registryPath = path.join(builderRoot, "registry", "agents", "demo-project.registry.json");
  const sharedRegistryPath = path.join(builderRoot, "registry", "agents", "agent-knowledge-registry.json");

  Object.assign(process.env, {
    PLUTOMIX_PROJECT_ROOT: builderRoot,
    PLUTOMIX_WORKSPACE_ROOT: temporaryRoot,
    GLOBAL_AGENT_KNOWLEDGE_ROOTS: builderRoot,
    OPENAI_AGENT_ENV_FILE: path.join(temporaryRoot, "missing.env"),
    PROJECT_AGENT_RUNTIME_ROOT: path.dirname(topologyPath),
    PROJECT_AGENT_MARKDOWN_ROOT: path.dirname(generatedAgentPath),
    PROJECT_AGENT_NEO4J_PATH: path.join(builderRoot, "graph", "neo4j", "generated-project-agents.cypher"),
    AGENTIC_SYSTEM_GRAPH_PATH: path.join(builderRoot, "topology", "d3", "agentic-system-graph.json"),
    FRONTEND_AGENTIC_SYSTEM_GRAPH_PATH: path.join(builderRoot, "frontend", "agentic-system-graph.json"),
    DELETED_AGENTS_PATH: path.join(builderRoot, "runtime", "agents", "deleted-agents.json")
  });
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_AGENT_VECTOR_STORE_ID;
  invalidateGlobalAgentsCache();

  context.after(async () => {
    invalidateGlobalAgentsCache();
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  await fs.mkdir(path.dirname(generatedAgentPath), { recursive: true });
  await fs.mkdir(path.dirname(memoryPath), { recursive: true });
  await fs.mkdir(path.dirname(topologyPath), { recursive: true });
  await fs.mkdir(path.dirname(localAgentPath), { recursive: true });
  await fs.mkdir(path.dirname(vectorIndexPath), { recursive: true });
  const agentMarkdown = [
    "---",
    `agent_id: "${agentId}"`,
    'agent_name: "Demo Project Orchestrator Agent"',
    'project_name: "Demo Project"',
    'role: "project-orchestrator"',
    "---",
    "",
    "## Objective",
    "Coordinate the demo project.",
    ""
  ].join("\n");
  await fs.writeFile(generatedAgentPath, agentMarkdown);
  await fs.writeFile(memoryPath, `${agentMarkdown}\n## Lessons Learned\nUse project evidence.\n`);
  await fs.writeFile(localAgentPath, agentMarkdown);
  await fs.writeFile(localOrchestratorPath, "# Demo local orchestrator\n");
  await fs.writeFile(
    topologyPath,
    JSON.stringify(
      {
        project: {
          id: "demo-project",
          name: "Demo Project",
          folderName: "demo-project",
          workspaceDir,
          port: 6500,
          previewUrl: "http://localhost:6500"
        },
        instruction: { objective: "Maintain Demo Project", sections: [] },
        agents: [
          {
            id: agentId,
            name: "Demo Project Orchestrator Agent",
            role: "project-orchestrator",
            responsibility: "Coordinate the demo project."
          },
          {
            id: "demo-project-runtime-packaging-agent",
            name: "Demo Runtime Packaging Agent",
            role: "runtime-packaging",
            responsibility: "Package the project."
          }
        ],
        relationships: [
          { source: "plutomix-fullstack-agent", target: agentId, type: "RUNTIME_DELEGATES_TO" },
          { source: agentId, target: "demo-project-runtime-packaging-agent", type: "DELEGATES_TO" }
        ]
      },
      null,
      2
    )
  );
  await fs.writeFile(
    vectorIndexPath,
    JSON.stringify({
      files: {
        [`memory/agent-knowledge/agents/${agentId}.v1.0.0.md`]: { status: "local_only" },
        [`agents/generated/${agentId}.agent.md`]: { status: "local_only" },
        "memory/agent-knowledge/projects/keep.md": { status: "local_only" }
      }
    })
  );
  await fs.writeFile(registryPath, JSON.stringify({ agent_id: agentId, status: "active" }));
  await fs.writeFile(sharedRegistryPath, JSON.stringify({ agents: [agentId, "keep-agent"] }));

  const configuredOpenAi = await openAiConfigFor(builderRoot);
  assert.equal(configuredOpenAi.apiKey, "");
  assert.equal(configuredOpenAi.vectorStoreId, "");

  const before = await listGlobalAgents();
  const target = before.agents.find((agent) => agent.id === agentId);
  assert.ok(target);
  assert.equal(target.deletion.allowed, true);

  const result = await deleteGlobalAgent({
    agentId,
    project: target.project,
    sourcePath: target.sourcePath,
    sourceRootId: target.sourceRootId
  });

  assert.equal(result.status, "deleted");
  await assert.rejects(fs.access(generatedAgentPath));
  await assert.rejects(fs.access(memoryPath));
  await assert.rejects(fs.access(localAgentPath));
  await assert.rejects(fs.access(localOrchestratorPath));
  await assert.rejects(fs.access(registryPath));

  const topology = JSON.parse(await fs.readFile(topologyPath, "utf8"));
  assert.equal(topology.agents.some((agent) => agent.id === agentId), false);
  assert.equal(
    topology.relationships.some((relationship) => relationship.source === agentId || relationship.target === agentId),
    false
  );
  const vectorIndex = JSON.parse(await fs.readFile(vectorIndexPath, "utf8"));
  assert.deepEqual(Object.keys(vectorIndex.files), ["memory/agent-knowledge/projects/keep.md"]);
  const sharedRegistry = JSON.parse(await fs.readFile(sharedRegistryPath, "utf8"));
  assert.deepEqual(sharedRegistry.agents, ["keep-agent"]);
  const tombstones = JSON.parse(
    await fs.readFile(path.join(builderRoot, "runtime", "agents", "deleted-agents.json"), "utf8")
  );
  assert.equal(tombstones.some((row) => row.agentId === agentId), true);

  const resynced = await syncProjectAgentTopology(
    {
      id: "demo-project",
      name: "Demo Project",
      folderName: "demo-project",
      workspaceDir,
      port: 6500,
      previewUrl: "http://localhost:6500"
    },
    {
      objective: "Maintain Demo Project",
      pageType: "managed_app_project",
      topic: "Demo Project",
      sections: [],
      productDecision: {
        productShape: "existing_product_change",
        artifactType: "existing_project",
        interactionModel: "preserve_existing"
      }
    }
  );
  assert.equal(resynced.agents.some((agent) => agent.id === agentId), false);
  await assert.rejects(fs.access(generatedAgentPath));
});

test("refuses deletion of required PlutoMix system agents", async () => {
  for (const agentId of ["plutomix-fullstack-agent", "project-execution-agent", "project-orchestrator-agent", "qagent-controller"]) {
    await assert.rejects(
      deleteGlobalAgent({ agentId }),
      /required PlutoMix system agent cannot be deleted/i
    );
  }
});
