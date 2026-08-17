import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyGothamWorkflowFailure, isGothamWorkspaceSandboxUnavailable, probeCodexWorkspaceSandbox, runCodexReviewWorkflow, runCodexWorkflow, runModelRepairWorkflow, shouldSkipHashFile } from "../src/codexWorkflow.js";
import { createPlutoniXOrchestrationEnvelope } from "../src/plutonixAuthority.js";
import { formatProjectOrchestratorInstruction, inferGothamRequestIntent } from "../src/orchestratorAgent.js";
import { runProjectOrchestratorBootstrap } from "../src/projectBootstrap.js";
import { createProject, deleteProject, getProject, shouldSkipProjectArtifact } from "../src/projectManager.js";

test("creates a project-local orchestrator and deletes the complete managed project", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-lifecycle-"));
  const moneyRoot = path.join(temporaryRoot, "money");
  const builderRoot = path.join(moneyRoot, "plutonix");
  const templateRoot = path.join(builderRoot, "template");
  const orchestratorArchive = path.join(temporaryRoot, "orchestrator-agent.zip");
  const socketPath = path.join(temporaryRoot, "docker.sock");
  await fs.mkdir(path.join(templateRoot, "src", "generated"), { recursive: true });
  await fs.writeFile(path.join(templateRoot, "package.json"), JSON.stringify({ name: "template", scripts: { dev: "vite" } }));
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
  process.env.PLUTONIX_PROJECT_ROOT = builderRoot;
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
  const policyPath = path.join(project.workspaceDir, ".agentic", "orchestrator-agent.md");
  const policy = await fs.readFile(policyPath, "utf8");
  assert.match(policy, /highest achievable implementation accuracy with the lowest justified token/i);
  assert.match(policy, /MCP Task Control/);
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
          { Id: "runtime-container", Labels: { "com.plutonix.project-id": project.id } },
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
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-codex-handoff-"));
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
  assert.match(args, /Read canonical AGENTS\.md and ROOT_WORKSPACE_GENERATION_POLICY\.md first/);
  assert.match(args, /Treat the PlutoniX text-box prompt above as the active user task/);
  assert.match(args, /using AGENTS\.md, ROOT_WORKSPACE_GENERATION_POLICY\.md, and \.agentic\/orchestrator-agent\.md command rules/);
  assert.match(args, new RegExp(textBoxPrompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("runs Codex with ignored stdin and gives a zero-change repair its task-completion context", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-repair-context-"));
  const previous = {
    CODEX_BIN: process.env.CODEX_BIN,
    CLAUDE_BIN: process.env.CLAUDE_BIN,
    PLUTONIX_REPAIR_BIN: process.env.PLUTONIX_REPAIR_BIN,
    PLUTONIX_REPAIR_MODEL: process.env.PLUTONIX_REPAIR_MODEL,
    PLUTONIX_REPAIR_ARGS: process.env.PLUTONIX_REPAIR_ARGS,
    PLUTONIX_PROJECT_ROOT: process.env.PLUTONIX_PROJECT_ROOT,
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
  process.env.CODEX_BIN = fakeCodex;
  process.env.PLUTONIX_PROJECT_ROOT = temporaryRoot;
  process.env.GOTHAM_RUNTIME_PROBE = "false";
  delete process.env.CLAUDE_BIN;
  delete process.env.PLUTONIX_REPAIR_BIN;
  delete process.env.PLUTONIX_REPAIR_MODEL;
  delete process.env.PLUTONIX_REPAIR_ARGS;

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
});

test("exposes backend interface metadata only after project backend routes are generated", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-backend-interface-"));
  const previousEnv = {
    PROJECTS_ROOT: process.env.PROJECTS_ROOT,
    GENERATED_SITE_DIR: process.env.GENERATED_SITE_DIR,
    PROJECTS_REGISTRY_PATH: process.env.PROJECTS_REGISTRY_PATH,
    PROJECT_EXPORTS_ROOT: process.env.PROJECT_EXPORTS_ROOT,
    PROJECTS_GITIGNORE_PATH: process.env.PROJECTS_GITIGNORE_PATH,
    PLUTONIX_PROJECT_ROOT: process.env.PLUTONIX_PROJECT_ROOT,
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
  const builderRoot = path.join(moneyRoot, "plutonix");
  const templateRoot = path.join(builderRoot, "template");
  await fs.mkdir(path.join(templateRoot, "src", "generated"), { recursive: true });
  await fs.writeFile(path.join(templateRoot, "package.json"), JSON.stringify({ name: "template", scripts: { dev: "vite" } }));

  process.env.PROJECTS_ROOT = moneyRoot;
  process.env.GENERATED_SITE_DIR = templateRoot;
  process.env.PROJECTS_REGISTRY_PATH = path.join(builderRoot, "runtime", "projects.json");
  process.env.PROJECT_EXPORTS_ROOT = path.join(builderRoot, "runtime", "exports");
  process.env.PROJECTS_GITIGNORE_PATH = path.join(moneyRoot, ".gitignore");
  process.env.PLUTONIX_PROJECT_ROOT = builderRoot;
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
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-codex-active-timeout-"));
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
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-codex-cache-warning-"));
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
  assert.equal(classifyGothamWorkflowFailure(new Error("workflow exited with code 1: syntax error")), "workflow_execution_failed");
});

test("blocks known Bubblewrap namespace failures as workspace sandbox infrastructure", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-sandbox-probe-"));
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
  assert.equal(preflight.failureClass, "workspace_sandbox_unavailable");
  assert.equal(preflight.reason, "user_namespace_denied");
  assert.equal(isGothamWorkspaceSandboxUnavailable(new Error(preflight.diagnostic)), true);
  assert.equal(classifyGothamWorkflowFailure(new Error(preflight.diagnostic)), "workspace_sandbox_unavailable");
  assert.equal(
    classifyGothamWorkflowFailure(new Error("permission profiles requiring direct runtime enforcement are incompatible with --use-legacy-landlock")),
    "workspace_sandbox_unavailable"
  );
  assert.equal(isGothamWorkspaceSandboxUnavailable(new Error("Permission denied writing src/app.jsx")), false);
});

test("does not start Codex execution when workspace sandbox preflight is unavailable", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-sandbox-blocked-"));
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
    (error) => classifyGothamWorkflowFailure(error) === "workspace_sandbox_unavailable"
  );
  assert.equal(await fs.access(executionMarker).then(() => true).catch(() => false), false);
  assert.equal(events.some((event) => event.type === "execution.blocked"), true);
});

test("runs the configured Gotham fallback with an explicit model and records runtime verification", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-codex-fallback-model-"));
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
  assert.equal(intent.taskType, "Simple");
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
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-project-task-envelope-"));
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
  assert.match(args, /User instruction:\nTask type: Medium\nGotham mode: executor\ntask : Add business search filters and a results map\./);
  assert.match(args, /If the user instruction begins with "Task type:"/);
  assert.match(args, /"executionInstructionFormat": "project-orchestrator-agent-task"/);
  assert.match(args, /"rawTextBoxInstruction": "Add business search filters and a results map\."/);
});

test("PlutoniX retains authority while a child project receives bounded execution context", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-child-direct-task-"));
  const previousBuilderRoot = process.env.PLUTONIX_PROJECT_ROOT;
  process.env.PLUTONIX_PROJECT_ROOT = temporaryRoot;
  context.after(async () => {
    if (previousBuilderRoot === undefined) delete process.env.PLUTONIX_PROJECT_ROOT;
    else process.env.PLUTONIX_PROJECT_ROOT = previousBuilderRoot;
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
      orchestrator: "plutonix-fullstack-agent",
      sourceInstruction: "Task type: Simple\ntask : Add one category filter without changing existing search.",
      rawTextBoxInstruction: "Add one category filter without changing existing search.",
      executionInstructionFormat: "plutonix-delegated-project-task",
      objective: "Execute the selected project task directly inside GeoFinderX.",
      pageType: "child_project_direct_task",
      topic: "GeoFinderX",
      sections: ["direct-task"],
      constraints: ["Apply the narrowest complete change requested by the task."],
      fileOperations: []
    };
  structuredRequest.orchestrationEnvelope = await createPlutoniXOrchestrationEnvelope({
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
  assert.match(args, /PlutoniX Fullstack Agent is the global planning and completion authority/i);
  assert.match(args, /mayRedefineParentTask.*false/i);
  assert.match(args, /Preserve every unrelated existing feature/i);
  assert.equal(result.parentWorkflowId, structuredRequest.orchestrationEnvelope.parentWorkflowId);
  assert.deepEqual(result.childExecutionIds, structuredRequest.orchestrationEnvelope.childExecutionIds);
  assert.equal(result.tokenUsage.agentId, "plutonix-fullstack-agent");
  assert.doesNotMatch(args, /Modify files under src\/generated\/ to implement the requested page/);
  assert.doesNotMatch(args, /Make the output visibly different when the instruction changes/);
});

test("PlutoniX envelope loads global policy and treats project policy as delegated context", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-authority-envelope-"));
  context.after(async () => fs.rm(temporaryRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(temporaryRoot, ".agentic"), { recursive: true });
  await fs.writeFile(path.join(temporaryRoot, ".agentic", "orchestrator-agent.md"), "local project guidance\n");

  const envelope = await createPlutoniXOrchestrationEnvelope({
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

  assert.equal(envelope.authority.agentId, "plutonix-fullstack-agent");
  assert.match(envelope.authority.canonicalPolicy.runtimeContract, /Compact Backend Runtime Authority Contract/);
  assert.match(envelope.authority.canonicalPolicy.path, /AGENTS\.md$/);
  assert.equal(envelope.authority.canonicalPolicy.sha256.length, 64);
  assert.match(envelope.authority.agentProfile.path, /plutonix-fullstack-agent\.agent\.md$/);
  assert.equal(envelope.authority.agentProfile.loadMode, "reference");
  assert.equal(envelope.delegations[0].agentId, "mediaanalyser-orchestrator-agent");
  assert.equal(envelope.delegations[0].projectPolicy.loadMode, "workspace-file");
  assert.equal(envelope.delegations[0].projectPolicy.sha256.length, 64);
  assert.equal("policy" in envelope.delegations[0], false);
  assert.equal(envelope.delegations[0].mayRedefineParentTask, false);
  assert.equal(envelope.delegations[0].mayApproveCompletion, false);
});

test("independent adaptive review is read-only and records a linked verdict", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-independent-review-"));
  const previousBuilderRoot = process.env.PLUTONIX_PROJECT_ROOT;
  const previousCodexBin = process.env.CODEX_BIN;
  process.env.PLUTONIX_PROJECT_ROOT = temporaryRoot;
  context.after(async () => {
    if (previousBuilderRoot === undefined) delete process.env.PLUTONIX_PROJECT_ROOT;
    else process.env.PLUTONIX_PROJECT_ROOT = previousBuilderRoot;
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
      "printf '{\"type\":\"item.completed\",\"message\":\"PLUTONIX_QUALITY: shape_fit=PASS; depth_fit=PASS; data_fidelity=PASS; input_consumption=PASS; ui_reference_functionality=PASS; no_explainer_copy=PASS; generic_template_check=PASS\\\\nPLUTONIX_REVIEW: PASS\"}\\n'",
      ""
    ].join("\n")
  );
  await fs.chmod(fakeCodex, 0o755);
  process.env.CODEX_BIN = fakeCodex;

  const result = await runCodexReviewWorkflow({
    sourceInstruction: "Review the generated page.",
    project: { id: "project-1", name: "Review Project" },
    orchestrationEnvelope: {
      parentWorkflowId: "plutonix_parent_1",
      validationCriteria: ["The page remains valid." ]
    }
  }, { files: ["src/generated/generatedPage.jsx"] }, {
    generatedSiteDir: projectRoot,
    reviewerAgentId: "plutonix-independent-reviewer"
  });

  assert.equal(result.status, "passed");
  assert.equal(result.tokenUsage.agentId, "plutonix-independent-reviewer");
  assert.equal(result.tokenUsage.workflowId, "plutonix_parent_1");
});

test("bootstrap warning is non-fatal when verification artifact is missing", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-bootstrap-warning-"));
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
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-bootstrap-fallbacks-"));
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
