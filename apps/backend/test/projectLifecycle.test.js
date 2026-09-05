import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyGothamWorkflowFailure, gothamSandboxFeatureArgs, isGothamInfrastructureFailure, isGothamWorkspaceSandboxUnavailable, isProjectRepairEligible, probeCodexWorkspaceSandbox, providerNeutralRuntimeEventType, runCodexReviewWorkflow, runCodexWorkflow, runGothamProviderReviewWorkflow, runGothamProviderWorkflow, runModelRepairWorkflow, shouldSkipHashFile } from "../src/codexWorkflow.js";
import { createPlutoMixOrchestrationEnvelope } from "../src/plutomixAuthority.js";
import { formatProjectOrchestratorInstruction, inferGothamRequestIntent } from "../src/orchestratorAgent.js";
import { runProjectOrchestratorBootstrap } from "../src/projectBootstrap.js";
import { buildProjectAgentTopology, syncProjectAgentTopology } from "../src/projectAgents.js";
import { createProject, deleteProject, getProject, projectPreviewUrl, projectProvenance, shouldSkipProjectArtifact, updateProjectIdentity, updateProjectInitialBuildStatus } from "../src/projectManager.js";

test("provider runtime event aliases cover the complete neutral activity contract", () => {
  assert.equal(providerNeutralRuntimeEventType("claude-started"), "provider-start");
  assert.equal(providerNeutralRuntimeEventType("gotham-runtime-verified"), "provider-runtime-verified");
  assert.equal(providerNeutralRuntimeEventType("claude-progress"), "provider-progress");
  assert.equal(providerNeutralRuntimeEventType("claude-tool"), "provider-command");
  assert.equal(providerNeutralRuntimeEventType("codex-file-change"), "provider-file-change");
  assert.equal(providerNeutralRuntimeEventType("claude-completed"), "provider-complete");
  assert.equal(providerNeutralRuntimeEventType("claude-failed"), "provider-failure");
  assert.equal(providerNeutralRuntimeEventType("future-provider-event"), "");
});

test("project provenance survives runtime status and topology refreshes", () => {
  const created = {
    id: "created-project",
    name: "Created project",
    folderName: "created-project",
    status: "running",
    provenance: { origin: "plutomix_created", recordedAt: "2026-08-20T00:00:00.000Z", source: "plutomix_project_creation" }
  };
  const imported = {
    id: "imported-project",
    name: "Imported project",
    folderName: "imported-project",
    status: "stopped",
    provenance: { origin: "imported", recordedAt: "2026-08-20T00:00:00.000Z", source: "plutomix_project_import" }
  };

  assert.equal(projectProvenance(created).origin, "plutomix_created");
  assert.equal(projectProvenance(imported).origin, "imported");
  assert.equal(projectProvenance({ id: "legacy-project", status: "running" }).origin, "unknown_legacy");
  assert.deepEqual(projectProvenance({
    id: "legacy-created-project",
    status: "stopped",
    createdAt: "2026-01-01T00:00:00.000Z",
    productDecision: { productShape: "web_app" }
  }), {
    origin: "plutomix_created",
    recordedAt: "2026-01-01T00:00:00.000Z",
    source: "legacy_plutomix_product_decision"
  });

  const topology = buildProjectAgentTopology(imported, { objective: "Inspect imported application" });
  assert.equal(topology.project.origin, "imported");
  assert.equal(buildProjectAgentTopology(created, { objective: "Inspect created application" }).project.origin, "plutomix_created");

  const refreshedTopology = buildProjectAgentTopology(
    { ...imported, provenance: undefined, status: "running" },
    { objective: "Refresh imported application" },
    topology
  );
  assert.equal(refreshedTopology.project.origin, "imported");
});

test("renders an externally routable project preview URL from the production template", (context) => {
  const previousTemplate = process.env.PROJECT_PREVIEW_URL_TEMPLATE;
  const previousHost = process.env.PROJECT_HOST_URL;
  context.after(() => {
    if (previousTemplate === undefined) delete process.env.PROJECT_PREVIEW_URL_TEMPLATE;
    else process.env.PROJECT_PREVIEW_URL_TEMPLATE = previousTemplate;
    if (previousHost === undefined) delete process.env.PROJECT_HOST_URL;
    else process.env.PROJECT_HOST_URL = previousHost;
  });

  process.env.PROJECT_PREVIEW_URL_TEMPLATE = "https://p{port}.preview.plutomix.in";
  assert.equal(projectPreviewUrl(5300), "https://p5300.preview.plutomix.in");
  process.env.PROJECT_PREVIEW_URL_TEMPLATE = "https://preview.plutomix.in";
  assert.throws(() => projectPreviewUrl(5300), /must contain the \{port\} placeholder/);
  delete process.env.PROJECT_PREVIEW_URL_TEMPLATE;
  process.env.PROJECT_HOST_URL = "http://localhost/";
  assert.equal(projectPreviewUrl(5300), "http://localhost:5300");
});

test("rejects a directory used as the project ignore registry with an actionable error", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-ignore-registry-"));
  const previousEnv = Object.fromEntries([
    "PROJECTS_ROOT",
    "GENERATED_SITE_DIR",
    "PROJECTS_REGISTRY_PATH",
    "PROJECT_EXPORTS_ROOT",
    "PROJECTS_GITIGNORE_PATH",
    "PROJECT_RUNTIME_MODE",
    "PROJECT_PORT_START",
    "PROJECT_PORT_END",
    "ORCHESTRATOR_INSTALL_ENABLED"
  ].map((key) => [key, process.env[key]]));
  context.after(async () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const projectsRoot = path.join(temporaryRoot, "projects");
  const templateRoot = path.join(temporaryRoot, "template");
  const ignoreDirectory = path.join(temporaryRoot, "project-ignore");
  await fs.mkdir(path.join(templateRoot, "src", "generated"), { recursive: true });
  await fs.mkdir(ignoreDirectory, { recursive: true });
  await fs.writeFile(path.join(templateRoot, "package.json"), JSON.stringify({ name: "template", scripts: { dev: "vite" } }));

  process.env.PROJECTS_ROOT = projectsRoot;
  process.env.GENERATED_SITE_DIR = templateRoot;
  process.env.PROJECTS_REGISTRY_PATH = path.join(temporaryRoot, "runtime", "projects.json");
  process.env.PROJECT_EXPORTS_ROOT = path.join(temporaryRoot, "runtime", "exports");
  process.env.PROJECTS_GITIGNORE_PATH = ignoreDirectory;
  process.env.PROJECT_RUNTIME_MODE = "process";
  process.env.PROJECT_PORT_START = "5360";
  process.env.PROJECT_PORT_END = "5369";
  process.env.ORCHESTRATOR_INSTALL_ENABLED = "false";

  await assert.rejects(
    createProject("Ignore Registry Check"),
    /Project ignore registry must be a regular file.*Set PROJECTS_GITIGNORE_PATH to a writable file path/
  );
  await assert.rejects(fs.access(path.join(projectsRoot, "ignore-registry-check")));
});

test("creates a project-local orchestrator and deletes the complete managed project", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-lifecycle-"));
  const moneyRoot = path.join(temporaryRoot, "money");
  const builderRoot = path.join(moneyRoot, "plutomix");
  const templateRoot = path.join(builderRoot, "template");
  const orchestratorArchive = path.join(temporaryRoot, "orchestrator-agent.zip");
  const socketPath = path.join(temporaryRoot, "docker.sock");
  await fs.mkdir(path.join(templateRoot, "src", "generated"), { recursive: true });
  await fs.writeFile(path.join(templateRoot, "package.json"), JSON.stringify({ name: "template", scripts: { dev: "vite" } }));
  await fs.writeFile(path.join(templateRoot, "src", "generated", "generatedPage.jsx"), "export default function Page() { return <main>VEVogue Elegance</main>; }\n");
  const seedFiles = {
    ".claude/settings.example.json": "{}\n",
    ".codex/prompts/bootstrap-orchestrator.md": "Read AGENTS.md fully and bootstrap the project.\n",
    ".codex/prompts/task-small.md": "Use a small context.\n",
    ".env.example": "OPENAI_API_KEY=\n",
    "AGENTS.md": "canonical-agent-policy\n",
    "CLAUDE.md": "canonical-claude-policy\n",
    "ROOT_WORKSPACE_GENERATION_POLICY.md": "Keep orchestrator artifacts at the project root.\n",
    "docs/USAGE.md": "Use the bootstrap prompt.\n"
  };
  const archive = new AdmZip();
  for (const [relativePath, content] of Object.entries(seedFiles)) {
    archive.addFile(`orchestrator-agent-main/${relativePath}`, Buffer.from(content));
  }
  archive.addFile("orchestrator-agent-main/.env", Buffer.from("SHOULD_NOT_REPLACE_RUNTIME_ENV=true\n"));
  archive.addZipComment("test-archive");
  archive.writeZip(orchestratorArchive);

  process.env.PROJECTS_ROOT = moneyRoot;
  process.env.GENERATED_SITE_DIR = templateRoot;
  process.env.PROJECTS_REGISTRY_PATH = path.join(builderRoot, "runtime", "projects.json");
  process.env.PROJECT_EXPORTS_ROOT = path.join(builderRoot, "runtime", "exports");
  process.env.PROJECTS_GITIGNORE_PATH = path.join(moneyRoot, ".gitignore");
  process.env.PLUTOMIX_PROJECT_ROOT = builderRoot;
  process.env.PROJECT_AGENT_RUNTIME_ROOT = path.join(builderRoot, "runtime", "agents", "projects");
  process.env.PROJECT_AGENT_MARKDOWN_ROOT = path.join(builderRoot, "agents", "generated");
  process.env.PROJECT_AGENT_NEO4J_PATH = path.join(builderRoot, "graph", "generated-project-agents.cypher");
  process.env.AGENTIC_SYSTEM_GRAPH_PATH = path.join(builderRoot, "topology", "agentic-system-graph.json");
  process.env.FRONTEND_AGENTIC_SYSTEM_GRAPH_PATH = path.join(builderRoot, "frontend", "agentic-system-graph.json");
  process.env.PROJECT_RUNTIME_MODE = "process";
  process.env.PROJECT_PORT_START = "5390";
  process.env.PROJECT_PORT_END = "5399";
  process.env.ORCHESTRATOR_ARCHIVE_PATH = orchestratorArchive;
  process.env.ORCHESTRATOR_INSTALL_ENABLED = "true";

  const project = await createProject("Accuracy Lab", {
    objective: "Build a precise analytics workspace.",
    pageType: "dashboard_landing_page",
    topic: "analytics",
    sections: ["hero", "metrics"],
    media: []
  });
  assert.equal(project.initialBuildStatus, "pending");
  const cleanGeneratedSeed = await fs.readFile(path.join(project.workspaceDir, "src", "generated", "generatedPage.jsx"), "utf8");
  assert.match(cleanGeneratedSeed, /Accuracy Lab/);
  assert.doesNotMatch(cleanGeneratedSeed, /VEVogue Elegance/);
  const readyProject = await updateProjectInitialBuildStatus(project.id, "ready");
  assert.equal(readyProject.initialBuildStatus, "ready");
  const policyPath = path.join(project.workspaceDir, ".agentic", "orchestrator-agent.md");
  const policy = await fs.readFile(policyPath, "utf8");
  assert.match(policy, /policy_handoff_version: 2/i);
  assert.match(policy, /backend context compiler supplies the authoritative, task-selected policy packs/i);
  assert.match(policy, /Canonical selected, rejected, and deferred branches/i);
  assert.match(policy, /deterministic backend publisher/i);
  assert.doesNotMatch(policy, /MCP Task Control/);
  const projectAgentsPolicy = await fs.readFile(path.join(project.workspaceDir, "AGENTS.md"), "utf8");
  assert.match(projectAgentsPolicy, /canonical-agent-policy/);
  assert.match(projectAgentsPolicy, /Hugging Face Model Workspace/);
  assert.match(projectAgentsPolicy, /QAgentic Support/);
  assert.equal(await fs.readFile(path.join(project.workspaceDir, "CLAUDE.md"), "utf8"), seedFiles["CLAUDE.md"]);
  const sourceManifest = JSON.parse(
    await fs.readFile(path.join(project.workspaceDir, ".agentic", "orchestrator-source.json"), "utf8")
  );
  assert.equal(sourceManifest.archivePath, orchestratorArchive);
  assert.equal(sourceManifest.archiveComment, "test-archive");
  assert.match(await fs.readFile(path.join(project.workspaceDir, ".env"), "utf8"), /FRONTEND_PORT=5390/);

  await syncProjectAgentTopology(project, {
    objective: "Build a precise analytics workspace.",
    pageType: "dashboard_landing_page",
    topic: "analytics",
    sections: ["hero", "metrics"],
    discoveredFunctionalities: [{
      id: "source-backed-insight",
      label: "Source-backed insight",
      category: "ui",
      entityType: "ui_feature",
      evidence: [{ id: "source-1", reference: "src/App.jsx:1" }]
    }],
    architectureBranches: [{
      id: "branch-source-backed-insight",
      functionalityId: "source-backed-insight",
      status: "candidate",
      inferenceRole: "observed_current",
      evidenceIds: ["source-1"]
    }]
  });

  const enterpriseTaggedProject = await updateProjectIdentity(project.id, {
    enterpriseId: "northwind-platform",
    enterpriseName: "Northwind Platform"
  });
  assert.deepEqual(enterpriseTaggedProject.enterprise, {
    id: "northwind-platform",
    name: "Northwind Platform",
    taggedAt: enterpriseTaggedProject.enterprise.taggedAt,
    taggedByUserId: "anonymous"
  });
  assert.match(enterpriseTaggedProject.enterprise.taggedAt, /^\d{4}-\d{2}-\d{2}T/);
  const persistedProject = JSON.parse(await fs.readFile(process.env.PROJECTS_REGISTRY_PATH, "utf8"))[0];
  assert.equal(persistedProject.enterprise.id, "northwind-platform");
  assert.equal(persistedProject.enterprise.name, "Northwind Platform");
  const preservedTopology = JSON.parse(await fs.readFile(path.join(process.env.PROJECT_AGENT_RUNTIME_ROOT, `${project.id}.agents.json`), "utf8"));
  assert.deepEqual(preservedTopology.functionalities.map((functionality) => functionality.id), ["source-backed-insight"]);
  assert.deepEqual(preservedTopology.architectureBranches.map((branch) => branch.id), ["branch-source-backed-insight"]);
  assert.equal(preservedTopology.project.enterpriseId, "northwind-platform");
  assert.equal(preservedTopology.project.origin, "plutomix_created");

  const sameEnterpriseProject = await updateProjectIdentity(project.id, {
    enterpriseId: "northwind-platform",
    enterpriseName: "Northwind Platform"
  });
  assert.equal(sameEnterpriseProject.enterprise.taggedAt, enterpriseTaggedProject.enterprise.taggedAt, "a repeat assignment keeps the original enterprise-tag record");
  assert.equal(sameEnterpriseProject.provenance.origin, "plutomix_created", "enterprise assignment never reclassifies project provenance");
  const repeatTopology = JSON.parse(await fs.readFile(path.join(process.env.PROJECT_AGENT_RUNTIME_ROOT, `${project.id}.agents.json`), "utf8"));
  assert.equal(repeatTopology.project.enterpriseId, "northwind-platform");
  assert.equal(repeatTopology.project.origin, "plutomix_created");
  assert.deepEqual(repeatTopology.architectureBranches.map((branch) => branch.id), ["branch-source-backed-insight"], "identity refresh preserves the decision branch ledger");

  const idOnlyEnterpriseProject = await updateProjectIdentity(project.id, { enterpriseId: "northwind-platform-v2" });
  assert.deepEqual(
    { id: idOnlyEnterpriseProject.enterprise.id, name: idOnlyEnterpriseProject.enterprise.name },
    { id: "northwind-platform-v2", name: "northwind-platform-v2" },
    "an ID-only PATCH never carries a stale enterprise display name into a new enterprise boundary"
  );
  const nameOnlyEnterpriseProject = await updateProjectIdentity(project.id, { enterpriseName: "Northwind Platform v2" });
  assert.deepEqual(
    { id: nameOnlyEnterpriseProject.enterprise.id, name: nameOnlyEnterpriseProject.enterprise.name },
    { id: "northwind-platform-v2", name: "Northwind Platform v2" },
    "a name-only PATCH updates the label without silently moving the application to another enterprise"
  );
  const partialUpdateTopology = JSON.parse(await fs.readFile(path.join(process.env.PROJECT_AGENT_RUNTIME_ROOT, `${project.id}.agents.json`), "utf8"));
  assert.equal(partialUpdateTopology.project.enterpriseId, "northwind-platform-v2");
  assert.equal(partialUpdateTopology.project.enterpriseName, "Northwind Platform v2");
  assert.equal(partialUpdateTopology.project.origin, "plutomix_created");
  assert.deepEqual(partialUpdateTopology.architectureBranches.map((branch) => branch.id), ["branch-source-backed-insight"]);

  const fakeCodex = path.join(temporaryRoot, "fake-codex");
  await fs.writeFile(
    fakeCodex,
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$@\" > bootstrap-args.txt",
      "mkdir -p agents/generated registry/agents graph/neo4j topology/d3 observability/bootstrap-orchestrator-001",
      "printf '# execution agent\\n' > agents/generated/project-execution-agent.agent.md",
      "printf '{}\\n' > registry/agents/project-execution-agent.registry.json",
      "printf '{}\\n' > topology/d3/agentic-system-graph.json",
      "printf '{}\\n' > observability/bootstrap-orchestrator-001/bootstrap-verification.json",
      "printf '{\"type\":\"item.completed\",\"message\":\"bootstrap complete\"}\\n'",
      ""
    ].join("\n")
  );
  await fs.chmod(fakeCodex, 0o755);
  process.env.CODEX_BIN = fakeCodex;
  process.env.ORCHESTRATOR_BOOTSTRAP_ENABLED = "true";
  const bootstrap = await runProjectOrchestratorBootstrap(project);
  assert.equal(bootstrap.status, "bootstrapped");
  assert.match(
    await fs.readFile(path.join(project.workspaceDir, "bootstrap-args.txt"), "utf8"),
    /Use \.codex\/prompts\/bootstrap-orchestrator\.md and execute the bootstrap\./
  );

  const removedContainers = [];
  const removedVolumes = [];
  const removedNetworks = [];
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(request.url);
    if (request.method === "GET" && requestPath === "/containers/json?all=true") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify([
          { Id: "runtime-container", Labels: { "com.plutomix.project-id": project.id } },
          { Id: "database-container", Labels: { "com.docker.compose.project": project.folderName } }
        ])
      );
      return;
    }
    if (request.method === "GET" && requestPath === "/volumes") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          Volumes: [
            {
              Name: `${project.folderName}_app_database`,
              Labels: { "com.docker.compose.project": project.folderName }
            }
          ]
        })
      );
      return;
    }
    if (request.method === "GET" && requestPath === "/networks") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify([
          {
            Id: "project-network",
            Labels: { "com.docker.compose.project": project.folderName }
          }
        ])
      );
      return;
    }
    if (request.method === "DELETE" && requestPath.startsWith("/containers/")) {
      removedContainers.push(requestPath);
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "DELETE" && requestPath.startsWith("/volumes/")) {
      removedVolumes.push(requestPath);
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "DELETE" && requestPath.startsWith("/networks/")) {
      removedNetworks.push(requestPath);
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(500);
    response.end(`unexpected ${request.method} ${request.url}`);
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  process.env.PROJECT_RUNTIME_MODE = "docker";
  process.env.DOCKER_SOCKET_PATH = socketPath;
  const result = await deleteProject(project.id);

  assert.equal(result.deleted, true);
  await assert.rejects(fs.access(project.workspaceDir));
  assert.deepEqual(JSON.parse(await fs.readFile(process.env.PROJECTS_REGISTRY_PATH, "utf8")), []);
  assert.doesNotMatch(await fs.readFile(process.env.PROJECTS_GITIGNORE_PATH, "utf8"), /accuracy-lab\//);
  assert.ok(removedContainers.some((entry) => entry.includes("database-container")));
  assert.ok(removedVolumes.some((entry) => entry.includes("accuracy-lab_app_database")));
  assert.ok(removedVolumes.some((entry) => entry.includes("node-modules")));
  assert.ok(removedNetworks.some((entry) => entry.includes("project-network")));
});

test("skips local Hugging Face model weights during hashing and project export", () => {
  const largeWeight = { size: 5_676_070_424 };
  const smallManifest = { size: 2_048 };

  assert.equal(shouldSkipHashFile("models/huggingface/wan2.1-t2v-1.3b/diffusion_pytorch_model.safetensors", largeWeight), true);
  assert.equal(shouldSkipHashFile("models/huggingface/model-manifest.json", smallManifest), false);
  assert.equal(shouldSkipHashFile("models/huggingface/services/local-media-service.json", smallManifest), false);

  assert.equal(shouldSkipProjectArtifact("models/huggingface/wan2.1-t2v-1.3b/models_t5_umt5-xxl-enc-bf16.pth", largeWeight), true);
  assert.equal(shouldSkipProjectArtifact("models/huggingface/model-manifest.json", smallManifest), false);
  assert.equal(shouldSkipProjectArtifact("src/App.jsx", { size: 10_000 }), false);
});

test("executes text-box prompt through project-local orchestrator command rules", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-codex-handoff-"));
  context.after(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const projectRoot = path.join(temporaryRoot, "project");
  await fs.mkdir(path.join(projectRoot, "src", "generated"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "src", "generated", "generatedPage.jsx"), "export default function Page() { return null; }\n");
  await fs.writeFile(path.join(projectRoot, "AGENTS.md"), "canonical rules\n");
  await fs.writeFile(path.join(projectRoot, "ROOT_WORKSPACE_GENERATION_POLICY.md"), "root policy\n");
  await fs.mkdir(path.join(projectRoot, ".agentic"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".agentic", "orchestrator-agent.md"), "project command rules\n");

  const fakeCodex = path.join(temporaryRoot, "fake-codex");
  await fs.writeFile(
    fakeCodex,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then printf 'codex-cli test\n'; exit 0; fi",
      "for argument in \"$@\"; do if [ \"$argument\" = \"sandbox\" ]; then exit 0; fi; done",
      "printf '%s\\n' \"$@\" > codex-args.txt",
      "printf 'export default function Page() { return <main>Analytics command center</main>; }\\n' > src/generated/generatedPage.jsx",
      "printf '{\"type\":\"item.completed\",\"message\":\"generation complete\"}\\n'",
      ""
    ].join("\n")
  );
  await fs.chmod(fakeCodex, 0o755);

  process.env.CODEX_BIN = fakeCodex;
  const textBoxPrompt = "Create an analytics command center for finance operators.";
  const result = await runCodexWorkflow(
    {
      sourceInstruction: textBoxPrompt,
      objective: "Generate a dashboard landing page.",
      pageType: "dashboard_landing_page",
      topic: "finance",
      sections: ["hero", "metrics"],
      fileOperations: []
    },
    { generatedSiteDir: projectRoot }
  );

  assert.equal(result.files.includes("src/generated/generatedPage.jsx"), true);
  const args = await fs.readFile(path.join(projectRoot, "codex-args.txt"), "utf8");
  assert.doesNotMatch(args, /use_legacy_landlock/);
  assert.match(args, /bounded implementation executor for a PlutoMix-managed Gotham workflow/);
  assert.match(args, /Compiled mandatory policy/);
  assert.match(args, /Fresh dynamic execution context/);
  assert.doesNotMatch(args, /Read canonical AGENTS\.md/);
  assert.match(args, new RegExp(textBoxPrompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("runs Codex with ignored stdin and gives a zero-change repair its task-completion context", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-repair-context-"));
  const previous = {
    CODEX_BIN: process.env.CODEX_BIN,
    CLAUDE_BIN: process.env.CLAUDE_BIN,
    PLUTOMIX_REPAIR_BIN: process.env.PLUTOMIX_REPAIR_BIN,
    PLUTOMIX_REPAIR_MODEL: process.env.PLUTOMIX_REPAIR_MODEL,
    PLUTOMIX_REPAIR_ARGS: process.env.PLUTOMIX_REPAIR_ARGS,
    PLUTOMIX_PROJECT_ROOT: process.env.PLUTOMIX_PROJECT_ROOT,
    GOTHAM_RUNTIME_PROBE: process.env.GOTHAM_RUNTIME_PROBE
  };
  context.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const projectRoot = path.join(temporaryRoot, "project");
  await fs.mkdir(path.join(projectRoot, "src", "generated"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "src", "generated", "generatedPage.jsx"), "export default function Page() { return null; }\n");
  const fakeCodex = path.join(temporaryRoot, "fake-codex");
  await fs.writeFile(fakeCodex, [
    "#!/bin/sh",
    "if [ -p /dev/stdin ]; then printf 'Reading additional input from stdin...\\n' >&2; exit 1; fi",
    "case \"$*\" in",
    "  *\"automatic recovery model\"*) printf '%s\\n' \"$@\" > \"$0.repair-args.txt\" ;;",
    "  *) printf '%s\\n' \"$@\" > codex-args.txt ;;",
    "esac",
    "printf '{\\\"type\\\":\\\"item.completed\\\",\\\"message\\\":\\\"No file was changed; token=sk_test_123\\\"}\\n'",
    ""
  ].join("\n"));
  await fs.chmod(fakeCodex, 0o755);
  const unexpectedClaudeMarker = path.join(temporaryRoot, "unexpected-claude-repair");
  const fakeClaude = path.join(temporaryRoot, "fake-claude");
  await fs.writeFile(fakeClaude, `#!/bin/sh\ntouch '${unexpectedClaudeMarker}'\nexit 1\n`);
  await fs.chmod(fakeClaude, 0o755);
  process.env.CODEX_BIN = fakeCodex;
  process.env.PLUTOMIX_PROJECT_ROOT = temporaryRoot;
  process.env.GOTHAM_RUNTIME_PROBE = "false";
  process.env.CLAUDE_BIN = fakeClaude;
  delete process.env.PLUTOMIX_REPAIR_BIN;
  delete process.env.PLUTOMIX_REPAIR_MODEL;
  delete process.env.PLUTOMIX_REPAIR_ARGS;

  const request = { sourceInstruction: "Add a SQL database connection.", objective: "Add a SQL database connection.", sections: [] };
  const execution = await runCodexWorkflow(request, { generatedSiteDir: projectRoot });
  assert.equal(execution.files.includes("codex-args.txt"), true);

  await assert.rejects(
    runModelRepairWorkflow(request, new Error("Gotham completed but did not change any meaningful project or requested artifact files."), { generatedSiteDir: projectRoot }),
    (error) => {
      assert.match(error.message, /Model output: .*<redacted>/i);
      return true;
    }
  );
  const repairArgs = await fs.readFile(`${fakeCodex}.repair-args.txt`, "utf8");
  assert.match(repairArgs, /Implement the original user instruction directly/i);
  await assert.rejects(fs.access(unexpectedClaudeMarker));
});

test("exposes backend interface metadata only after project backend routes are generated", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-backend-interface-"));
  const previousEnv = {
    PROJECTS_ROOT: process.env.PROJECTS_ROOT,
    GENERATED_SITE_DIR: process.env.GENERATED_SITE_DIR,
    PROJECTS_REGISTRY_PATH: process.env.PROJECTS_REGISTRY_PATH,
    PROJECT_EXPORTS_ROOT: process.env.PROJECT_EXPORTS_ROOT,
    PROJECTS_GITIGNORE_PATH: process.env.PROJECTS_GITIGNORE_PATH,
    PLUTOMIX_PROJECT_ROOT: process.env.PLUTOMIX_PROJECT_ROOT,
    PROJECT_AGENT_RUNTIME_ROOT: process.env.PROJECT_AGENT_RUNTIME_ROOT,
    PROJECT_AGENT_MARKDOWN_ROOT: process.env.PROJECT_AGENT_MARKDOWN_ROOT,
    PROJECT_AGENT_NEO4J_PATH: process.env.PROJECT_AGENT_NEO4J_PATH,
    AGENTIC_SYSTEM_GRAPH_PATH: process.env.AGENTIC_SYSTEM_GRAPH_PATH,
    FRONTEND_AGENTIC_SYSTEM_GRAPH_PATH: process.env.FRONTEND_AGENTIC_SYSTEM_GRAPH_PATH,
    PROJECT_RUNTIME_MODE: process.env.PROJECT_RUNTIME_MODE,
    PROJECT_PORT_START: process.env.PROJECT_PORT_START,
    PROJECT_PORT_END: process.env.PROJECT_PORT_END,
    ORCHESTRATOR_INSTALL_ENABLED: process.env.ORCHESTRATOR_INSTALL_ENABLED
  };
  context.after(async () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const moneyRoot = path.join(temporaryRoot, "money");
  const builderRoot = path.join(moneyRoot, "plutomix");
  const templateRoot = path.join(builderRoot, "template");
  await fs.mkdir(path.join(templateRoot, "src", "generated"), { recursive: true });
  await fs.writeFile(path.join(templateRoot, "package.json"), JSON.stringify({ name: "template", scripts: { dev: "vite" } }));

  process.env.PROJECTS_ROOT = moneyRoot;
  process.env.GENERATED_SITE_DIR = templateRoot;
  process.env.PROJECTS_REGISTRY_PATH = path.join(builderRoot, "runtime", "projects.json");
  process.env.PROJECT_EXPORTS_ROOT = path.join(builderRoot, "runtime", "exports");
  process.env.PROJECTS_GITIGNORE_PATH = path.join(moneyRoot, ".gitignore");
  process.env.PLUTOMIX_PROJECT_ROOT = builderRoot;
  process.env.PROJECT_AGENT_RUNTIME_ROOT = path.join(builderRoot, "runtime", "agents", "projects");
  process.env.PROJECT_AGENT_MARKDOWN_ROOT = path.join(builderRoot, "agents", "generated");
  process.env.PROJECT_AGENT_NEO4J_PATH = path.join(builderRoot, "graph", "generated-project-agents.cypher");
  process.env.AGENTIC_SYSTEM_GRAPH_PATH = path.join(builderRoot, "topology", "agentic-system-graph.json");
  process.env.FRONTEND_AGENTIC_SYSTEM_GRAPH_PATH = path.join(builderRoot, "frontend", "agentic-system-graph.json");
  process.env.PROJECT_RUNTIME_MODE = "process";
  process.env.PROJECT_PORT_START = "5370";
  process.env.PROJECT_PORT_END = "5379";
  process.env.ORCHESTRATOR_INSTALL_ENABLED = "false";

  const project = await createProject("Backend Interface Lab", {
    objective: "Create an API-backed project.",
    pageType: "managed_app_project",
    topic: "backend",
    sections: ["project", "runtime", "playground"]
  });
  assert.equal((await getProject(project.id))?.backendInterface, null);

  await fs.writeFile(
    path.join(project.workspaceDir, "backend", "src", "server.js"),
    [
      'import express from "express";',
      "const app = express();",
      'app.get("/api/health", (_req, res) => res.json({ status: "ok" }));',
      'app.get("/api/docs", (_req, res) => res.type("html").send("<main>Docs</main>"));',
      'app.get("/api/orders", (_req, res) => res.json([]));',
      ""
    ].join("\n")
  );

  const refreshed = await getProject(project.id);
  assert.equal(refreshed.backendInterface.available, true);
  assert.equal(refreshed.backendInterface.url, "http://localhost:5370/api/docs");
  assert.equal(refreshed.backendInterface.routeCount, 2);
});

test("renews the Codex timeout while the workflow is producing output", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-codex-active-timeout-"));
  context.after(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const projectRoot = path.join(temporaryRoot, "project");
  await fs.mkdir(path.join(projectRoot, "src", "generated"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "src", "generated", "generatedPage.jsx"), "export default function Page() { return null; }\n");

  const fakeCodex = path.join(temporaryRoot, "fake-codex");
  await fs.writeFile(
    fakeCodex,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then printf 'codex-cli test\\n'; exit 0; fi",
      "if [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then printf 'Logged in using ChatGPT\\n'; exit 0; fi",
      "for argument in \"$@\"; do if [ \"$argument\" = \"sandbox\" ]; then exit 0; fi; done",
      "for count in 1 2 3 4 5 6 7 8 9; do",
      "  printf '{\"type\":\"item.completed\",\"message\":\"progress %s\"}\\n' \"$count\"",
      "  sleep 0.25",
      "done",
      "printf 'export default function Page() { return <main>Finished</main>; }\\n' > src/generated/generatedPage.jsx",
      ""
    ].join("\n")
  );
  await fs.chmod(fakeCodex, 0o755);

  process.env.CODEX_BIN = fakeCodex;
  const result = await runCodexWorkflow(
    {
      sourceInstruction: "Complete a workflow that remains active beyond one timeout window.",
      objective: "Verify active workflow timeout renewal.",
      pageType: "test",
      topic: "timeout",
      sections: []
    },
    { generatedSiteDir: projectRoot, timeoutMs: 2000 }
  );

  assert.equal(result.files.includes("src/generated/generatedPage.jsx"), true);
  assert.ok(result.codex.durationMs > 2000);
});

test("suppresses recoverable Codex model cache schema warnings from Gotham progress", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-codex-cache-warning-"));
  context.after(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const projectRoot = path.join(temporaryRoot, "project");
  await fs.mkdir(path.join(projectRoot, "src", "generated"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "src", "generated", "generatedPage.jsx"), "export default function Page() { return null; }\n");

  const fakeCodex = path.join(temporaryRoot, "fake-codex");
  await fs.writeFile(
    fakeCodex,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then printf 'codex-cli test\\n'; exit 0; fi",
      "if [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then printf 'Logged in using ChatGPT\\n'; exit 0; fi",
      "for argument in \"$@\"; do if [ \"$argument\" = \"sandbox\" ]; then exit 0; fi; done",
      "printf '2026-08-03T17:59:07.049142Z ERROR codex_models_manager::manager: failed to renew cache TTL: missing field `supports_reasoning_summaries` at line 86 column 5\\n' >&2",
      "printf '{\"type\":\"item.completed\",\"message\":\"generation complete\"}\\n'",
      "printf 'export default function Page() { return <main>Generated cleanly</main>; }\\n' > src/generated/generatedPage.jsx",
      ""
    ].join("\n")
  );
  await fs.chmod(fakeCodex, 0o755);

  const events = [];
  process.env.CODEX_BIN = fakeCodex;
  const result = await runCodexWorkflow(
    {
      sourceInstruction: "Generate a clean page while Codex emits cache noise.",
      objective: "Verify recoverable warning filtering.",
      pageType: "test",
      topic: "cache",
      sections: []
    },
    {
      generatedSiteDir: projectRoot,
      emit: (type, message) => events.push({ type, message })
    }
  );

  assert.equal(result.files.includes("src/generated/generatedPage.jsx"), true);
  assert.equal(events.some((event) => event.message.includes("supports_reasoning_summaries")), false);
  assert.equal(events.some((event) => event.message.includes("generation complete")), true);
});

test("classifies incompatible Gotham model metadata separately from cache and project failures", () => {
  assert.equal(
    classifyGothamWorkflowFailure(new Error("The 'gpt-5.6-terra' model requires a newer version of Codex.")),
    "codex_cli_model_incompatible"
  );
  assert.equal(
    classifyGothamWorkflowFailure(new Error("The 'gpt-5.6-terra' model requires a newer version of Gotham.")),
    "codex_cli_model_incompatible"
  );
  assert.equal(
    classifyGothamWorkflowFailure(new Error("gotham_models_manager::cache: failed to load models cache: missing field `supports_reasoning_summaries`")),
    "models_cache_incompatible"
  );
  assert.equal(
    classifyGothamWorkflowFailure(new Error("gotham_models_manager::manager: failed to renew cache TTL: missing field `base_instructions`")),
    "models_cache_incompatible"
  );
  assert.equal(classifyGothamWorkflowFailure(new Error("workflow exited with code 1: syntax error")), "project_implementation_failure");
});

test("uses the compatible Codex shell tool in the managed container and classifies unified exec failures as infrastructure", () => {
  assert.deepEqual(gothamSandboxFeatureArgs({}), ["--disable", "unified_exec"]);
  assert.deepEqual(gothamSandboxFeatureArgs({ GOTHAM_UNIFIED_EXEC_ENABLED: "true" }), []);
  const failure = new Error('Failed to create unified exec process: No such file or directory (os error 2)');
  assert.equal(isGothamWorkspaceSandboxUnavailable(failure), true);
  assert.equal(classifyGothamWorkflowFailure(failure), "sandbox_runtime_unavailable");
});

test("classifies a lost Codex command sandbox as infrastructure and skips project repair", () => {
  const failure = new Error([
    "codex_core::exec: exec error: No such file or directory (os error 2)",
    "codex_core::tools::router: error=execution error: Io(Os { code: 2, kind: NotFound, message: 'No such file or directory' })",
    "Failed to write file /tmp/codex-sandbox-check.txt"
  ].join("\n"));
  assert.equal(isGothamWorkspaceSandboxUnavailable(failure), true);
  assert.equal(classifyGothamWorkflowFailure(failure), "sandbox_runtime_unavailable");
  assert.equal(isProjectRepairEligible(failure), false);
  assert.equal(
    classifyGothamWorkflowFailure(new Error("bwrap: execvp codex-linux-sandbox: No such file or directory")),
    "sandbox_runtime_unavailable"
  );
});

test("reports zero-change command ENOENT as infrastructure instead of a project implementation failure", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-zero-change-sandbox-loss-"));
  const previous = {
    CODEX_BIN: process.env.CODEX_BIN,
    GOTHAM_RUNTIME_PROBE: process.env.GOTHAM_RUNTIME_PROBE
  };
  context.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });
  const workspaceDir = path.join(temporaryRoot, "project");
  const fakeCodex = path.join(temporaryRoot, "fake-codex");
  await fs.mkdir(path.join(workspaceDir, "src", "generated"), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, "src", "generated", "generatedPage.jsx"), "export default function Page() { return null; }\n");
  await fs.writeFile(fakeCodex, [
    "#!/bin/sh",
    "printf '%s\\n' 'codex_core::exec: exec error: No such file or directory (os error 2)' >&2",
    "printf '%s\\n' 'Failed to write file /tmp/codex-sandbox-check.txt' >&2",
    "exit 0",
    ""
  ].join("\n"));
  await fs.chmod(fakeCodex, 0o755);
  process.env.CODEX_BIN = fakeCodex;
  process.env.GOTHAM_RUNTIME_PROBE = "false";

  await assert.rejects(
    runCodexWorkflow({ sourceInstruction: "Change the project.", objective: "Change the project." }, { generatedSiteDir: workspaceDir }),
    (error) => {
      assert.equal(error.workflowFailureClass, "sandbox_runtime_unavailable");
      assert.match(error.message, /command sandbox became unavailable/i);
      assert.equal(isProjectRepairEligible(error), false);
      return true;
    }
  );
});

test("proves the selected workspace is readable and writable inside the Codex sandbox", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-workspace-sandbox-probe-"));
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const workspaceDir = path.join(temporaryRoot, "project");
  const fakeCodex = path.join(temporaryRoot, "fake-codex");
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(fakeCodex, [
    "#!/bin/sh",
    "while [ \"$#\" -gt 0 ]; do",
    "  if [ \"$1\" = \"--disable\" ] || [ \"$1\" = \"--enable\" ]; then shift 2; continue; fi",
    "  if [ \"$1\" = \"sandbox\" ]; then shift; break; fi",
    "  shift",
    "done",
    "while [ \"$1\" = \"-c\" ]; do shift 2; done",
    "exec \"$@\"",
    ""
  ].join("\n"));
  await fs.chmod(fakeCodex, 0o755);

  const preflight = await probeCodexWorkspaceSandbox(fakeCodex, 2000, { workspaceDir });
  assert.equal(preflight.status, "ready");
  assert.equal(preflight.workspace, await fs.realpath(workspaceDir));
  assert.deepEqual((await fs.readdir(workspaceDir)).filter((name) => name.startsWith(".plutomix-sandbox-preflight-")), []);
});

test("reports a missing selected workspace before starting the Codex sandbox", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-missing-workspace-probe-"));
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const invocationMarker = path.join(temporaryRoot, "codex-invoked");
  const fakeCodex = path.join(temporaryRoot, "fake-codex");
  await fs.writeFile(fakeCodex, `#!/bin/sh\ntouch '${invocationMarker}'\n`);
  await fs.chmod(fakeCodex, 0o755);

  const preflight = await probeCodexWorkspaceSandbox(fakeCodex, 2000, {
    workspaceDir: path.join(temporaryRoot, "missing-project")
  });
  assert.equal(preflight.status, "unavailable");
  assert.equal(preflight.failureClass, "workspace_cwd_missing");
  assert.equal(await fs.access(invocationMarker).then(() => true).catch(() => false), false);
});

test("blocks known Bubblewrap namespace failures as workspace sandbox infrastructure", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-sandbox-probe-"));
  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  const fakeCodex = path.join(temporaryRoot, "fake-codex");
  await fs.writeFile(fakeCodex, [
    "#!/bin/sh",
    "printf '%s\\n' 'bwrap: No permissions to create a new namespace, likely because the kernel does not allow non-privileged user namespaces.' >&2",
    "exit 1",
    ""
  ].join("\n"));
  await fs.chmod(fakeCodex, 0o755);

  const preflight = await probeCodexWorkspaceSandbox(fakeCodex, 2000);
  assert.equal(preflight.status, "unavailable");
  assert.equal(preflight.failureClass, "sandbox_runtime_unavailable");
  assert.equal(preflight.reason, "user_namespace_denied");
  assert.equal(isGothamWorkspaceSandboxUnavailable(new Error(preflight.diagnostic)), true);
  assert.equal(classifyGothamWorkflowFailure(new Error(preflight.diagnostic)), "sandbox_runtime_unavailable");
  assert.equal(
    classifyGothamWorkflowFailure(new Error("permission profiles requiring direct runtime enforcement are incompatible with --use-legacy-landlock")),
    "sandbox_runtime_unavailable"
  );
  assert.equal(isGothamWorkspaceSandboxUnavailable(new Error("Permission denied writing src/app.jsx")), false);
});

test("does not start Codex execution when workspace sandbox preflight is unavailable", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-sandbox-blocked-"));
  const previous = {
    CODEX_BIN: process.env.CODEX_BIN,
    GOTHAM_RUNTIME_PROBE: process.env.GOTHAM_RUNTIME_PROBE,
    GOTHAM_SANDBOX_PREFLIGHT: process.env.GOTHAM_SANDBOX_PREFLIGHT
  };
  context.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });
  const projectRoot = path.join(temporaryRoot, "project");
  await fs.mkdir(path.join(projectRoot, "src", "generated"), { recursive: true });
  const fakeCodex = path.join(temporaryRoot, "fake-codex");
  const executionMarker = path.join(temporaryRoot, "provider-exec-started");
  await fs.writeFile(fakeCodex, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then printf 'codex-cli 0.147.0\\n'; exit 0; fi",
    "if [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then printf 'Logged in using ChatGPT\\n'; exit 0; fi",
    "if [ \"$1\" = \"sandbox\" ] || [ \"$3\" = \"sandbox\" ]; then printf '%s\\n' 'bwrap: Creating new namespace failed: Operation not permitted' >&2; exit 1; fi",
    `touch '${executionMarker}'`,
    "exit 0",
    ""
  ].join("\n"));
  await fs.chmod(fakeCodex, 0o755);
  process.env.CODEX_BIN = fakeCodex;
  process.env.GOTHAM_RUNTIME_PROBE = "true";
  process.env.GOTHAM_SANDBOX_PREFLIGHT = "true";

  const events = [];
  await assert.rejects(
    runCodexWorkflow({ sourceInstruction: "Change the project.", objective: "Change the project." }, {
      generatedSiteDir: projectRoot,
      emit: (type, message, extra) => events.push({ type, message, ...extra })
    }),
    (error) => classifyGothamWorkflowFailure(error) === "sandbox_runtime_unavailable"
  );
  assert.equal(await fs.access(executionMarker).then(() => true).catch(() => false), false);
  assert.equal(events.some((event) => event.type === "execution.blocked"), true);
});

test("runs the configured Gotham fallback with an explicit model and records runtime verification", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-codex-fallback-model-"));
  const previousCodexBin = process.env.CODEX_BIN;
  const previousProbe = process.env.GOTHAM_RUNTIME_PROBE;
  context.after(async () => {
    if (previousCodexBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = previousCodexBin;
    if (previousProbe === undefined) delete process.env.GOTHAM_RUNTIME_PROBE;
    else process.env.GOTHAM_RUNTIME_PROBE = previousProbe;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });
  const projectRoot = path.join(temporaryRoot, "project");
  await fs.mkdir(path.join(projectRoot, "src", "generated"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "src", "generated", "generatedPage.jsx"), "export default function Page() { return null; }\n");
  const fakeCodex = path.join(temporaryRoot, "fake-codex");
  await fs.writeFile(fakeCodex, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then printf 'codex-cli 0.147.0\\n'; exit 0; fi",
    "if [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then printf 'Logged in using ChatGPT\\n'; exit 0; fi",
    "for argument in \"$@\"; do if [ \"$argument\" = \"sandbox\" ]; then exit 0; fi; done",
    "printf '%s\\n' \"$@\" > codex-args.txt",
    "printf '{\\\"type\\\":\\\"item.completed\\\",\\\"message\\\":\\\"generation complete\\\"}\\n'",
    "printf 'export default function Page() { return <main>Fallback</main>; }\\n' > src/generated/generatedPage.jsx",
    ""
  ].join("\n"));
  await fs.chmod(fakeCodex, 0o755);
  process.env.CODEX_BIN = fakeCodex;
  process.env.GOTHAM_RUNTIME_PROBE = "true";
  const events = [];
  const result = await runCodexWorkflow({ sourceInstruction: "Use the fallback.", objective: "Use fallback.", sections: [] }, {
    generatedSiteDir: projectRoot,
    model: "gpt-5-compatible",
    emit: (type, message) => events.push({ type, message })
  });
  const args = await fs.readFile(path.join(projectRoot, "codex-args.txt"), "utf8");
  assert.match(args, /--model\ngpt-5-compatible/);
  assert.equal(result.runtime.codexVersion, "codex-cli 0.147.0");
  assert.equal(events.some((event) => event.type === "gotham-runtime-verified"), true);
});

test("formats selected project workflow instructions for the project orchestrator agent", () => {
  assert.equal(
    formatProjectOrchestratorInstruction("Add a lead finder dashboard with map filters.", "medium"),
    "Task type: Medium\nGotham mode: executor\ntask : Add a lead finder dashboard with map filters."
  );
  assert.equal(
    formatProjectOrchestratorInstruction("Fix the hero spacing.", "small"),
    "Task type: Simple\nGotham mode: executor\ntask : Fix the hero spacing."
  );
  assert.equal(
    formatProjectOrchestratorInstruction("Build auth, database, and analytics workflows.", "complex"),
    "Task type: Hard\nGotham mode: executor\ntask : Build auth, database, and analytics workflows."
  );
});

test("infers pasted Gotham errors as simple debugger tasks", () => {
  const intent = inferGothamRequestIntent({
    instruction: [
      "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
      ":5316/api/media/jobs:1 Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
      "Provider returned 404: Not Found"
    ].join("\n")
  });

  assert.equal(intent.workflowMode, "debugger");
  assert.equal(intent.taskType, "Auto");
  assert.equal(intent.inferredBugFix, true);
  assert.equal(intent.reason, "pasted-error");

  const explicitPlanner = inferGothamRequestIntent({
    instruction: "TypeError: Cannot read properties of undefined",
    workflowMode: "planner",
    taskType: "Hard"
  });
  assert.equal(explicitPlanner.workflowMode, "planner");
  assert.equal(explicitPlanner.taskType, "Hard");
  assert.equal(explicitPlanner.inferredBugFix, true);
});

test("codex workflow receives the project orchestrator task envelope", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-project-task-envelope-"));
  context.after(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const projectRoot = path.join(temporaryRoot, "GeoFinderX");
  await fs.mkdir(path.join(projectRoot, "src", "generated"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "src", "generated", "generatedPage.jsx"), "export default function Page() { return null; }\n");
  await fs.writeFile(path.join(projectRoot, "AGENTS.md"), "canonical rules\n");
  await fs.writeFile(path.join(projectRoot, "ROOT_WORKSPACE_GENERATION_POLICY.md"), "root policy\n");
  await fs.mkdir(path.join(projectRoot, ".agentic"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".agentic", "orchestrator-agent.md"), "project command rules\n");

  const fakeCodex = path.join(temporaryRoot, "fake-codex-envelope");
  await fs.writeFile(
    fakeCodex,
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$@\" > codex-args.txt",
      "printf 'export default function Page() { return <main>GeoFinder updated</main>; }\\n' > src/generated/generatedPage.jsx",
      "printf '{\"type\":\"item.completed\",\"message\":\"generation complete\"}\\n'",
      ""
    ].join("\n")
  );
  await fs.chmod(fakeCodex, 0o755);

  process.env.CODEX_BIN = fakeCodex;
  const rawPrompt = "Add business search filters and a results map.";
  const projectTask = formatProjectOrchestratorInstruction(rawPrompt, "Medium");
  await runCodexWorkflow(
    {
      sourceInstruction: projectTask,
      rawTextBoxInstruction: rawPrompt,
      executionInstructionFormat: "project-orchestrator-agent-task",
      objective: "Execute selected project workflow through the project orchestrator.",
      pageType: "managed_app_project",
      topic: "GeoFinderX",
      sections: ["project", "runtime"],
      fileOperations: []
    },
    { generatedSiteDir: projectRoot }
  );

  const args = await fs.readFile(path.join(projectRoot, "codex-args.txt"), "utf8");
  assert.match(args, /Current instruction:\nTask type: Medium\nGotham mode: executor\ntask : Add business search filters and a results map\./);
  assert.match(args, /If the current instruction begins with "Task type:"/);
  assert.match(args, /"executionInstructionFormat": "project-orchestrator-agent-task"/);
  assert.match(args, /"rawTextBoxInstruction": "Add business search filters and a results map\."/);
});

test("PlutoMix retains authority while a child project receives bounded execution context", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-child-direct-task-"));
  const previousBuilderRoot = process.env.PLUTOMIX_PROJECT_ROOT;
  process.env.PLUTOMIX_PROJECT_ROOT = temporaryRoot;
  context.after(async () => {
    if (previousBuilderRoot === undefined) delete process.env.PLUTOMIX_PROJECT_ROOT;
    else process.env.PLUTOMIX_PROJECT_ROOT = previousBuilderRoot;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const projectRoot = path.join(temporaryRoot, "GeoFinderX");
  await fs.mkdir(path.join(projectRoot, "src", "generated"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "src", "generated", "generatedPage.jsx"), "export default function Page() { return <main>Existing feature</main>; }\n");
  await fs.writeFile(path.join(projectRoot, "AGENTS.md"), "canonical rules\n");
  await fs.writeFile(path.join(projectRoot, "ROOT_WORKSPACE_GENERATION_POLICY.md"), "root policy\n");
  await fs.mkdir(path.join(projectRoot, ".agentic"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".agentic", "orchestrator-agent.md"), "preserve unrelated behavior\n");

  const fakeCodex = path.join(temporaryRoot, "fake-codex-child-direct");
  await fs.writeFile(
    fakeCodex,
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$@\" > codex-args.txt",
      "printf 'export default function Page() { return <main>Existing feature plus filter</main>; }\\n' > src/generated/generatedPage.jsx",
      "printf '{\"type\":\"item.completed\",\"message\":\"direct child task complete\"}\\n'",
      ""
    ].join("\n")
  );
  await fs.chmod(fakeCodex, 0o755);

  process.env.CODEX_BIN = fakeCodex;
  const structuredRequest = {
      orchestrator: "plutomix-fullstack-agent",
      sourceInstruction: "Task type: Simple\ntask : Add one category filter without changing existing search.",
      rawTextBoxInstruction: "Add one category filter without changing existing search.",
      executionInstructionFormat: "plutomix-delegated-project-task",
      objective: "Execute the selected project task directly inside GeoFinderX.",
      pageType: "child_project_direct_task",
      topic: "GeoFinderX",
      sections: ["direct-task"],
      constraints: ["Apply the narrowest complete change requested by the task."],
      fileOperations: []
    };
  structuredRequest.orchestrationEnvelope = await createPlutoMixOrchestrationEnvelope({
    instruction: structuredRequest.sourceInstruction,
    taskType: "Simple",
    project: { id: "geo-1", name: "GeoFinderX", workspaceDir: projectRoot, isDefault: false },
    structuredRequest
  });
  const result = await runCodexWorkflow(
    structuredRequest,
    { generatedSiteDir: projectRoot }
  );

  const args = await fs.readFile(path.join(projectRoot, "codex-args.txt"), "utf8");
  assert.match(args, /PlutoMix Fullstack Agent is the global planning and completion authority/i);
  assert.match(args, /mayRedefineParentTask.*false/i);
  assert.match(args, /Preserve every unrelated existing feature/i);
  assert.equal(result.parentWorkflowId, structuredRequest.orchestrationEnvelope.parentWorkflowId);
  assert.deepEqual(result.childExecutionIds, structuredRequest.orchestrationEnvelope.childExecutionIds);
  assert.equal(result.tokenUsage.agentId, "plutomix-fullstack-agent");
  assert.doesNotMatch(args, /Modify files under src\/generated\/ to implement the requested page/);
  assert.doesNotMatch(args, /Make the output visibly different when the instruction changes/);
});

test("PlutoMix envelope loads global policy and treats project policy as delegated context", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-authority-envelope-"));
  context.after(async () => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(temporaryRoot, ".agentic"), { recursive: true });
  await fs.writeFile(path.join(temporaryRoot, ".agentic", "orchestrator-agent.md"), "local project guidance\n");

  const envelope = await createPlutoMixOrchestrationEnvelope({
    instruction: "Add a project report without changing existing routes.",
    taskType: "Medium",
    project: { id: "project-1", name: "MediaAnalyser", workspaceDir: temporaryRoot, isDefault: false },
    structuredRequest: {
      objective: "Add a project report.",
      pageType: "child_project_direct_task",
      sections: ["report"],
      constraints: ["Preserve routes."],
      fileOperations: []
    }
  });

  assert.equal(envelope.authority.agentId, "plutomix-fullstack-agent");
  assert.match(envelope.authority.canonicalPolicy.runtimeContract, /Compact Backend Runtime Authority Contract/);
  assert.match(envelope.authority.canonicalPolicy.path, /AGENTS\.md$/);
  assert.equal(envelope.authority.canonicalPolicy.sha256.length, 64);
  assert.match(envelope.authority.agentProfile.path, /plutomix-fullstack-agent\.agent\.md$/);
  assert.equal(envelope.authority.agentProfile.loadMode, "reference");
  assert.equal(envelope.delegations[0].agentId, "mediaanalyser-orchestrator-agent");
  assert.equal(envelope.delegations[0].projectPolicy.loadMode, "workspace-file");
  assert.equal(envelope.delegations[0].projectPolicy.sha256.length, 64);
  assert.equal("policy" in envelope.delegations[0], false);
  assert.equal(envelope.delegations[0].mayRedefineParentTask, false);
  assert.equal(envelope.delegations[0].mayApproveCompletion, false);
});

test("independent adaptive review is read-only and records a linked verdict", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-independent-review-"));
  const previousBuilderRoot = process.env.PLUTOMIX_PROJECT_ROOT;
  const previousCodexBin = process.env.CODEX_BIN;
  process.env.PLUTOMIX_PROJECT_ROOT = temporaryRoot;
  context.after(async () => {
    if (previousBuilderRoot === undefined) delete process.env.PLUTOMIX_PROJECT_ROOT;
    else process.env.PLUTOMIX_PROJECT_ROOT = previousBuilderRoot;
    if (previousCodexBin === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = previousCodexBin;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });
  const projectRoot = path.join(temporaryRoot, "project");
  await fs.mkdir(path.join(projectRoot, "src", "generated"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "src", "generated", "generatedPage.jsx"), "export default function Page() { return <main>Reviewed</main>; }\n");
  const fakeCodex = path.join(temporaryRoot, "fake-review-codex");
  await fs.writeFile(
    fakeCodex,
    [
      "#!/bin/sh",
      "printf '{\"type\":\"item.completed\",\"message\":\"PLUTOMIX_QUALITY: shape_fit=PASS; depth_fit=PASS; data_fidelity=PASS; input_consumption=PASS; ui_reference_functionality=PASS; no_explainer_copy=PASS; generic_template_check=PASS\\\\nPLUTOMIX_REVIEW: PASS\"}\\n'",
      ""
    ].join("\n")
  );
  await fs.chmod(fakeCodex, 0o755);
  process.env.CODEX_BIN = fakeCodex;

  const result = await runCodexReviewWorkflow({
    sourceInstruction: "Review the generated page.",
    project: { id: "project-1", name: "Review Project" },
    orchestrationEnvelope: {
      parentWorkflowId: "plutomix_parent_1",
      validationCriteria: ["The page remains valid." ]
    }
  }, { files: ["src/generated/generatedPage.jsx"] }, {
    generatedSiteDir: projectRoot,
    reviewerAgentId: "plutomix-independent-reviewer"
  });

  assert.equal(result.status, "passed");
  assert.equal(result.tokenUsage.agentId, "plutomix-independent-reviewer");
  assert.equal(result.tokenUsage.workflowId, "plutomix_parent_1");
});

test("bootstrap warning is non-fatal when verification artifact is missing", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-bootstrap-warning-"));
  context.after(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const projectRoot = path.join(temporaryRoot, "GeoFinderX");
  await fs.mkdir(path.join(projectRoot, ".codex", "prompts"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".codex", "prompts", "bootstrap-orchestrator.md"), "bootstrap\n");

  const fakeCodex = path.join(temporaryRoot, "fake-codex-missing-verification");
  await fs.writeFile(
    fakeCodex,
    [
      "#!/bin/sh",
      "mkdir -p agents/generated registry/agents graph/neo4j topology/d3",
      "printf '# execution agent\\n' > agents/generated/project-execution-agent.agent.md",
      "printf '{}\\n' > registry/agents/project-execution-agent.registry.json",
      "printf '{}\\n' > topology/d3/agentic-system-graph.json",
      "printf '{\"type\":\"item.completed\",\"message\":\"bootstrap finished without verification\"}\\n'",
      ""
    ].join("\n")
  );
  await fs.chmod(fakeCodex, 0o755);

  process.env.CODEX_BIN = fakeCodex;
  process.env.ORCHESTRATOR_BOOTSTRAP_ENABLED = "true";
  const events = [];
  const bootstrap = await runProjectOrchestratorBootstrap(
    { id: "geofinderx-test", name: "GeoFinderX", workspaceDir: projectRoot },
    { emit: (type, message, extra) => events.push({ type, message, extra }) }
  );

  assert.equal(bootstrap.status, "bootstrapped-with-warnings");
  assert.deepEqual(bootstrap.missingArtifacts, ["observability/bootstrap-orchestrator-001/bootstrap-verification.json"]);
  assert.equal(events.some((event) => event.type === "orchestrator-bootstrap-warning"), true);
  const fallbackVerification = JSON.parse(
    await fs.readFile(path.join(projectRoot, "observability", "bootstrap-orchestrator-001", "bootstrap-verification.json"), "utf8")
  );
  assert.equal(fallbackVerification.status, "incomplete");
  assert.match(fallbackVerification.message, /project generation can continue/i);
});

test("bootstrap creates local fallbacks when default agent and registry are missing", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-bootstrap-fallbacks-"));
  context.after(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const projectRoot = path.join(temporaryRoot, "GeoFinderX");
  await fs.mkdir(path.join(projectRoot, ".codex", "prompts"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".codex", "prompts", "bootstrap-orchestrator.md"), "bootstrap\n");

  const fakeCodex = path.join(temporaryRoot, "fake-codex-no-agent");
  await fs.writeFile(
    fakeCodex,
    [
      "#!/bin/sh",
      "mkdir -p graph/neo4j topology/d3",
      "printf '{}\\n' > topology/d3/agentic-system-graph.json",
      "printf '{\"type\":\"item.completed\",\"message\":\"bootstrap partial\"}\\n'",
      ""
    ].join("\n")
  );
  await fs.chmod(fakeCodex, 0o755);

  process.env.CODEX_BIN = fakeCodex;
  process.env.ORCHESTRATOR_BOOTSTRAP_ENABLED = "true";
  const bootstrap = await runProjectOrchestratorBootstrap({ id: "geofinderx-test", name: "GeoFinderX", workspaceDir: projectRoot });

  assert.equal(bootstrap.status, "bootstrapped-with-warnings");
  assert.deepEqual(bootstrap.missingArtifacts, [
    "agents/generated/project-execution-agent.agent.md",
    "registry/agents/project-execution-agent.registry.json",
    "observability/bootstrap-orchestrator-001/bootstrap-verification.json"
  ]);
  await fs.access(path.join(projectRoot, "agents", "generated", "project-execution-agent.agent.md"));
  await fs.access(path.join(projectRoot, "registry", "agents", "project-execution-agent.registry.json"));
  await fs.access(path.join(projectRoot, "observability", "bootstrap-orchestrator-001", "bootstrap-verification.json"));
});

test("executes the compiled Gotham workflow through a frozen Claude profile without leaking runtime secrets", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-claude-gotham-"));
  const previous = {
    PATH: process.env.PATH,
    GOTHAM_RUNTIME_PROBE: process.env.GOTHAM_RUNTIME_PROBE,
    GOTHAM_SANDBOX_PREFLIGHT: process.env.GOTHAM_SANDBOX_PREFLIGHT,
    CLAUDE_WORKFLOW_MAX_TURNS: process.env.CLAUDE_WORKFLOW_MAX_TURNS,
    PLUTOMIX_PROJECT_ROOT: process.env.PLUTOMIX_PROJECT_ROOT
  };
  context.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const managedRoot = path.join(temporaryRoot, "projects");
  const projectRoot = path.join(managedRoot, "claude-project");
  const configDir = path.join(temporaryRoot, "profiles", "claude", "work");
  const dependencyDir = path.join(temporaryRoot, "sandbox-bin");
  const fakeClaude = path.join(temporaryRoot, "claude");
  const outsideFile = path.join(temporaryRoot, "outside-workspace.txt");
  await fs.mkdir(path.join(projectRoot, "src", "generated"), { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(dependencyDir, { recursive: true });
  await fs.symlink(process.execPath, path.join(dependencyDir, "bwrap"));
  await fs.symlink(process.execPath, path.join(dependencyDir, "socat"));
  await fs.writeFile(path.join(projectRoot, "src", "generated", "generatedPage.jsx"), "export default function Page() { return null; }\n");
  const canonicalConfigDir = await fs.realpath(configDir);
  await fs.writeFile(fakeClaude, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "if (args[0] === '--version') { process.stdout.write('2.1.251 (Claude Code)\\n'); process.exit(0); }",
    "if (args[0] === 'auth' && args[1] === 'status') { process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'oauth', apiProvider: 'firstParty' })); process.exit(0); }",
    "const settings = JSON.parse(args[args.indexOf('--settings') + 1]);",
    `const outsideFile = ${JSON.stringify(outsideFile)};`,
    `const configDir = ${JSON.stringify(canonicalConfigDir)};`,
    "fs.writeFileSync(path.join(process.cwd(), 'claude-sandbox-evidence.json'), JSON.stringify({",
    "  restricted: args.includes('--restricted'),",
    "  maxTurns: args[args.indexOf('--max-turns') + 1],",
    "  model: args[args.indexOf('--model') + 1],",
    "  allowWrite: settings.sandbox.filesystem.allowWrite,",
    "  denyReadProtectsProfile: settings.sandbox.filesystem.denyRead.includes(configDir),",
    "  outsideAllowed: settings.sandbox.filesystem.allowWrite.includes(outsideFile),",
    "  failClosed: settings.sandbox.enabled && settings.sandbox.failIfUnavailable && settings.sandbox.allowUnsandboxedCommands === false",
    "}));",
    "fs.writeFileSync(path.join(process.cwd(), 'src', 'generated', 'generatedPage.jsx'), 'export default function Page() { return <main>Claude Gotham</main>; }\\n');",
    `process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: ${JSON.stringify(outsideFile)}, content: 'sk-ant-raw-tool-secret' } }] } }) + '\\n');`,
    "process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Claude completed the workspace implementation.', session_id: 'claude-session-1', duration_ms: 42, duration_api_ms: 31, total_cost_usd: 0.001, num_turns: 2, usage: { input_tokens: 17, output_tokens: 9 } }) + '\\n');",
    ""
  ].join("\n"));
  await fs.chmod(fakeClaude, 0o755);
  process.env.PATH = `${dependencyDir}${path.delimiter}${previous.PATH || ""}`;
  process.env.GOTHAM_RUNTIME_PROBE = "true";
  process.env.GOTHAM_SANDBOX_PREFLIGHT = "true";
  process.env.CLAUDE_WORKFLOW_MAX_TURNS = "5";
  process.env.PLUTOMIX_PROJECT_ROOT = temporaryRoot;

  const selection = Object.freeze({
    providerId: "claude",
    profileId: "claude-work",
    workspaceId: "claude-project",
    modelId: "claude-sonnet-4-6",
    selectedAt: "2026-08-31T00:00:00.000Z"
  });
  const runtime = {
    providerId: "claude",
    profileId: "claude-work",
    workspaceId: "claude-project",
    command: fakeClaude,
    env: {
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${dependencyDir}`,
      HOME: temporaryRoot,
      CLAUDE_CONFIG_DIR: configDir,
      ANTHROPIC_API_KEY: "sk-ant-profile-secret"
    }
  };
  const events = [];
  const result = await runGothamProviderWorkflow({
    sourceInstruction: "Replace the generated page with a Claude-backed Gotham implementation.",
    objective: "Generate the requested project change.",
    project: { id: "claude-project", name: "Claude Project", workspaceDir: projectRoot },
    sections: []
  }, {
    generatedSiteDir: projectRoot,
    providerRuntimeSelection: selection,
    providerRuntime: runtime,
    emit: (type, message, extra) => events.push({ type, message, extra })
  });

  assert.ok(result.files.includes("src/generated/generatedPage.jsx"));
  assert.equal(result.providerExecution.providerId, "claude");
  assert.equal(result.providerExecution.profileId, "claude-work");
  assert.equal(result.providerExecution.sessionId, "claude-session-1");
  assert.deepEqual(result.providerExecution.usage, { input_tokens: 17, output_tokens: 9 });
  assert.equal(result.codex, undefined);
  assert.equal(result.runtime.selectedModel, "claude-sonnet-4-6");
  const evidence = JSON.parse(await fs.readFile(path.join(projectRoot, "claude-sandbox-evidence.json"), "utf8"));
  assert.equal(evidence.restricted, true);
  assert.equal(evidence.maxTurns, "5");
  assert.equal(evidence.model, "claude-sonnet-4-6");
  assert.equal(evidence.failClosed, true);
  assert.equal(evidence.denyReadProtectsProfile, true);
  assert.equal(evidence.outsideAllowed, false);
  const canonicalProjectRoot = await fs.realpath(projectRoot);
  assert.equal(evidence.allowWrite.some((entry) => entry === canonicalProjectRoot), true);
  await assert.rejects(fs.access(outsideFile));
  assert.equal(events.every((entry) => entry.extra.providerId === "claude"), true);
  const publicEvidence = JSON.stringify({ result, events });
  assert.doesNotMatch(publicEvidence, /sk-ant-profile-secret|sk-ant-raw-tool-secret|outside-workspace\.txt/);
  assert.equal(publicEvidence.includes(configDir), false);
});

test("Claude execution, review, repair, and completion check retain one frozen profile with provider usage", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutomix-claude-job-lifecycle-"));
  const previous = {
    PATH: process.env.PATH,
    PLUTOMIX_PROJECT_ROOT: process.env.PLUTOMIX_PROJECT_ROOT,
    GOTHAM_RUNTIME_PROBE: process.env.GOTHAM_RUNTIME_PROBE,
    GOTHAM_SANDBOX_PREFLIGHT: process.env.GOTHAM_SANDBOX_PREFLIGHT,
    CLAUDE_WORKFLOW_MAX_TURNS: process.env.CLAUDE_WORKFLOW_MAX_TURNS
  };
  context.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });
  const managedRoot = path.join(temporaryRoot, "projects");
  const projectRoot = path.join(managedRoot, "project-a");
  const configDir = path.join(temporaryRoot, "profiles", "claude", "profile-a");
  const dependencyDir = path.join(temporaryRoot, "sandbox-bin");
  const invocationLog = path.join(temporaryRoot, "provider-invocations.jsonl");
  const fakeClaude = path.join(temporaryRoot, "claude");
  await fs.mkdir(path.join(projectRoot, "src", "generated"), { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(dependencyDir, { recursive: true });
  await fs.symlink(process.execPath, path.join(dependencyDir, "bwrap"));
  await fs.symlink(process.execPath, path.join(dependencyDir, "socat"));
  await fs.writeFile(path.join(projectRoot, "src", "generated", "generatedPage.jsx"), "export default function Page() { return null; }\n");
  await fs.writeFile(fakeClaude, [
    "#!/usr/bin/env node",
    "const crypto = require('node:crypto');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "if (args[0] === '--version') { process.stdout.write('2.1.251 (Claude Code)\\n'); process.exit(0); }",
    "if (args[0] === 'auth' && args[1] === 'status') { process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'oauth', apiProvider: 'firstParty' })); process.exit(0); }",
    "const prompt = args[args.indexOf('-p') + 1];",
    "const settings = JSON.parse(args[args.indexOf('--settings') + 1]);",
    "const workspace = fs.realpathSync(process.cwd());",
    "const workspaceWrite = settings.sandbox.filesystem.allowWrite.includes(workspace);",
    "const profileHash = crypto.createHash('sha256').update(process.env.CLAUDE_CONFIG_DIR || '').digest('hex');",
    `fs.appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify({ profileHash, workspaceWrite, model: args[args.indexOf('--model') + 1] }) + '\\n');`,
    "let result;",
    "if (prompt.includes('independent read-only reviewer')) {",
    "  if (workspaceWrite) fs.writeFileSync(path.join(process.cwd(), 'reviewer-write-violation.txt'), 'unsafe');",
    "  result = 'PLUTOMIX_QUALITY: shape_fit=PASS; depth_fit=PASS; data_fidelity=PASS; input_consumption=PASS; ui_reference_functionality=PASS; no_explainer_copy=PASS; generic_template_check=PASS\\nPLUTOMIX_REVIEW: PASS';",
    "} else if (prompt.includes('PlutoMix completion checker')) {",
    "  result = 'PLUTOMIX_COMPLETION_CHECK: PASS\\nPLUTOMIX_REVIEW: PASS';",
    "} else if (prompt.includes('automatic recovery model')) {",
    "  fs.writeFileSync(path.join(process.cwd(), 'src', 'generated', 'generatedPage.jsx'), 'export default function Page() { return <main>Repaired by frozen Claude</main>; }\\n');",
    "  result = 'Repair completed.';",
    "} else {",
    "  fs.writeFileSync(path.join(process.cwd(), 'src', 'generated', 'generatedPage.jsx'), 'export default function Page() { return <main>Generated by frozen Claude</main>; }\\n');",
    "  result = 'Generation completed.';",
    "}",
    "process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, session_id: 'same-profile-session', duration_ms: 20, duration_api_ms: 15, total_cost_usd: 0.004, num_turns: 1, usage: { input_tokens: 11, cache_creation_input_tokens: 3, cache_read_input_tokens: 5, output_tokens: 7 } }) + '\\n');",
    ""
  ].join("\n"));
  await fs.chmod(fakeClaude, 0o755);
  process.env.PATH = `${dependencyDir}${path.delimiter}${previous.PATH || ""}`;
  process.env.PLUTOMIX_PROJECT_ROOT = temporaryRoot;
  process.env.GOTHAM_RUNTIME_PROBE = "true";
  process.env.GOTHAM_SANDBOX_PREFLIGHT = "true";
  process.env.CLAUDE_WORKFLOW_MAX_TURNS = "6";

  const selection = Object.freeze({
    providerId: "claude",
    profileId: "profile-a",
    workspaceId: "project-a",
    modelId: "claude-sonnet-4-6",
    selectedAt: "2026-09-01T00:00:00.000Z"
  });
  const runtime = {
    providerId: "claude",
    profileId: "profile-a",
    workspaceId: "project-a",
    command: fakeClaude,
    env: {
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${dependencyDir}`,
      HOME: temporaryRoot,
      CLAUDE_CONFIG_DIR: configDir,
      ANTHROPIC_API_KEY: "sk-ant-never-persist"
    }
  };
  const request = {
    sourceInstruction: "Implement and verify the selected project task.",
    objective: "Implement and verify the selected project task.",
    project: { id: "project-a", name: "Frozen Profile Project", workspaceDir: projectRoot },
    sections: [],
    orchestrationEnvelope: { parentWorkflowId: "frozen-profile-job", validationCriteria: ["The project task is implemented."] }
  };
  const sharedOptions = {
    generatedSiteDir: projectRoot,
    providerRuntimeSelection: selection,
    providerRuntime: runtime,
    compiledPolicyContextEnabled: false
  };
  const execution = await runGothamProviderWorkflow(request, sharedOptions);
  const switchedFutureSelection = Object.freeze({ ...selection, profileId: "profile-b" });
  assert.equal(switchedFutureSelection.profileId, "profile-b");
  const beforeReview = await fs.readFile(path.join(projectRoot, "src", "generated", "generatedPage.jsx"), "utf8");
  const review = await runGothamProviderReviewWorkflow(request, execution, sharedOptions);
  assert.equal(await fs.readFile(path.join(projectRoot, "src", "generated", "generatedPage.jsx"), "utf8"), beforeReview);
  await assert.rejects(fs.access(path.join(projectRoot, "reviewer-write-violation.txt")));
  await fs.writeFile(path.join(projectRoot, "src", "generated", "generatedPage.jsx"), "export default function Page() { throw new Error('validation failure'); }\n");
  const repair = await runModelRepairWorkflow(request, new Error("Validation failed for generated page."), sharedOptions);

  assert.equal(review.providerExecution.profileId, "profile-a");
  assert.equal(review.providerExecution.mode, "read-only");
  assert.equal(repair.providerExecution.profileId, "profile-a");
  assert.equal(repair.providerExecution.providerId, "claude");
  assert.equal(repair.tokenUsage.usageSource, "provider");
  assert.equal(repair.tokenUsage.cacheCreationInputTokens, 3);
  assert.equal(repair.tokenUsage.cacheReadInputTokens, 5);
  assert.equal(repair.tokenUsage.totalTokens, 26);
  assert.equal(repair.tokenUsage.providerReportedCostUsd, 0.004);
  assert.equal(repair.completionTokenUsage.providerProfileId, "profile-a");
  const invocations = (await fs.readFile(invocationLog, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(invocations.map((entry) => entry.workspaceWrite), [true, false, true, false]);
  assert.equal(new Set(invocations.map((entry) => entry.profileHash)).size, 1);
  assert.deepEqual(new Set(invocations.map((entry) => entry.model)), new Set(["claude-sonnet-4-6"]));
  assert.doesNotMatch(JSON.stringify({ execution, review, repair }), /sk-ant-never-persist|CLAUDE_CONFIG_DIR|profiles\/claude/);
});

test("Claude infrastructure failures are never eligible for project repair", () => {
  for (const failureClass of [
    "invalid_claude_runtime",
    "unauthenticated_cli",
    "claude_sandbox_unavailable",
    "workflow_timeout",
    "malformed_events",
    "missing_result"
  ]) {
    const classified = classifyGothamWorkflowFailure({ failureClass });
    assert.equal(isProjectRepairEligible(classified), false, failureClass);
    assert.equal(isGothamInfrastructureFailure(classified), true, failureClass);
  }
});

test("provider dispatcher fails closed for account-management-only providers before execution", async () => {
  await assert.rejects(
    runGothamProviderWorkflow({ sourceInstruction: "Do not execute this unsupported provider." }, {
      generatedSiteDir: process.cwd(),
      providerRuntimeSelection: Object.freeze({ providerId: "copilot", profileId: "copilot-profile", selectedAt: new Date().toISOString() }),
      providerRuntime: { command: process.execPath, env: process.env }
    }),
    { code: "provider_execution_unsupported" }
  );
  await assert.rejects(
    runModelRepairWorkflow({ sourceInstruction: "Do not switch providers." }, new Error("Validation failed."), {
      providerRuntimeSelection: Object.freeze({
        providerId: "claude",
        profileId: "claude-profile",
        workspaceId: "workspace-a",
        selectedAt: new Date().toISOString()
      })
    }),
    { code: "provider_runtime_missing" }
  );
});
