import crypto from "node:crypto";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const canonicalQAgentSchemaPath = path.resolve(moduleDir, "../../../schemas/qagent-next-instruction.schema.json");
const canonicalProductShapeSchemaPath = path.resolve(moduleDir, "../../../schemas/product-shape-decision.schema.json");

const bootstrapCommand =
  "Use .codex/prompts/bootstrap-orchestrator.md and execute the bootstrap. Use only the local orchestrator files already unzipped in this project. Do not clone, download, or fetch an orchestrator-agent from git.";
const seedPaths = [
  ".claude/settings.example.json",
  ".codex/prompts",
  ".env.example",
  "AGENTS.md",
  "CLAUDE.md",
  "ROOT_WORKSPACE_GENERATION_POLICY.md",
  "docs/USAGE.md"
];
const requiredBootstrapArtifacts = [
  "agents/generated/project-execution-agent.agent.md",
  "registry/agents/project-execution-agent.registry.json",
  "graph/neo4j",
  "topology/d3/agentic-system-graph.json",
  "observability/bootstrap-orchestrator-001/bootstrap-verification.json"
];
const bootstrapVerificationPath = "observability/bootstrap-orchestrator-001/bootstrap-verification.json";

const qagentNextInstructionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "QAgent Next Instruction Packet",
  type: "object",
  additionalProperties: false,
  required: [
    "continue",
    "completion_score",
    "stop_reason",
    "gap_summary",
    "missing_items",
    "next_agent_type",
    "next_instruction",
    "validation_required",
    "memory_update",
    "iteration_control"
  ],
  properties: {
    continue: { type: "boolean" },
    completion_score: { type: "integer", minimum: 0, maximum: 100 },
    stop_reason: { type: "string" },
    gap_summary: { type: "string" },
    missing_items: { type: "array", items: { type: "string" } },
    next_agent_type: { type: "string" },
    next_instruction: { type: "string" },
    validation_required: { type: "array", items: { type: "string" } },
    memory_update: {
      type: "object",
      additionalProperties: false,
      required: ["store", "summary", "tags"],
      properties: {
        store: { type: "boolean" },
        summary: { type: "string" },
        tags: { type: "array", items: { type: "string" } }
      }
    },
    iteration_control: {
      type: "object",
      additionalProperties: false,
      required: ["current_iteration", "max_iterations", "stop_if_next_validation_passes"],
      properties: {
        current_iteration: { type: "integer", minimum: 0 },
        max_iterations: { type: "integer", minimum: 1, maximum: 8 },
        stop_if_next_validation_passes: { type: "boolean" }
      }
    }
  }
};

async function appendQAgenticAgentsSection(workspaceDir) {
  const agentsPath = path.join(workspaceDir, "AGENTS.md");
  const existing = (await fs.pathExists(agentsPath)) ? await fs.readFile(agentsPath, "utf8") : "";
  if (existing.includes("<!-- qagentic-support:start -->")) return;
  const block = [
    "",
    "<!-- qagentic-support:start -->",
    "# QAgentic Support",
    "",
    "QAgentic support is additive. It must not replace or weaken existing project orchestrator instructions.",
    "",
    "- QAgent Controller reviews the previous agent response against the original objective.",
    "- It detects missing work, weak validation, incomplete implementation, and unclear next steps.",
    "- It validates Product Shape fidelity, implementation depth, interaction model, data provenance, supplied-input consumption, generic-template drift, and unrequested explainer copy.",
    "- It outputs only a stop decision or a Next Instruction Packet.",
    "- Runtime QAgents are generated only for blocking or important objective gaps.",
    "- Stop when the objective is complete, validation passes, only polish remains, required user information is missing, or the iteration cap is reached.",
    "<!-- qagentic-support:end -->",
    ""
  ].join("\n");
  await fs.ensureDir(path.dirname(agentsPath));
  await fs.writeFile(agentsPath, `${existing.replace(/\s*$/, "")}${existing.trim() ? "\n" : ""}${block}`);
}

async function appendHuggingFaceAgentsSection(workspaceDir) {
  const agentsPath = path.join(workspaceDir, "AGENTS.md");
  const existing = (await fs.pathExists(agentsPath)) ? await fs.readFile(agentsPath, "utf8") : "";
  if (existing.includes("<!-- huggingface-model-workspace:start -->")) return;
  const block = [
    "",
    "<!-- huggingface-model-workspace:start -->",
    "# Hugging Face Model Workspace",
    "",
    "When a task requires a Hugging Face model, use the project-local model workspace instead of one-off downloads.",
    "",
    "- Keep model metadata in `models/huggingface/model-manifest.json`.",
    "- Download complete model repositories, including all model weight files and shards, into `models/huggingface/repositories/` with `npm run hf:models:download -- <repoId>` or `node scripts/huggingface-models.mjs download <repoId>`.",
    "- Before using or downloading a selected model, report its estimated repository size in GB and keep that size in `models/huggingface/model-manifest.json`.",
    "- Read the downloaded model card before writing inference code.",
    "- Run `npm run hf:models:build` after downloads to refresh local service metadata under `models/huggingface/services/`.",
    "- Do not store tokens, credentials, or private Hub URLs in manifests, logs, generated source, or model cards.",
    "<!-- huggingface-model-workspace:end -->",
    ""
  ].join("\n");
  await fs.ensureDir(path.dirname(agentsPath));
  await fs.writeFile(agentsPath, `${existing.replace(/\s*$/, "")}${existing.trim() ? "\n" : ""}${block}`);
}

function huggingFaceModelScript() {
  return `#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const workspaceRoot = path.join(root, "models", "huggingface");
const manifestPath = path.join(workspaceRoot, "model-manifest.json");
const repositoriesRoot = path.join(workspaceRoot, "repositories");
const servicesRoot = path.join(workspaceRoot, "services");

function safeName(value = "model") {
  return String(value || "model").toLowerCase().replace(/[^a-z0-9._/-]+/g, "-").replace(/^-+|-+$/g, "").replace(/\\//g, "__").slice(0, 160) || "model";
}

async function ensureWorkspace() {
  await fs.mkdir(repositoriesRoot, { recursive: true });
  await fs.mkdir(servicesRoot, { recursive: true });
  try {
    await fs.access(manifestPath);
  } catch {
    await writeManifest({ version: 1, models: [], services: [], updatedAt: new Date().toISOString() });
  }
}

async function readManifest() {
  await ensureWorkspace();
  return JSON.parse(await fs.readFile(manifestPath, "utf8"));
}

async function writeManifest(manifest) {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify({ version: 1, models: [], services: [], ...manifest, updatedAt: new Date().toISOString() }, null, 2) + "\\n");
}

function localDirFor(repoId) {
  return path.join(repositoriesRoot, safeName(repoId));
}

function modelApiUrl(repoId) {
  const encodedRepo = String(repoId || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return \`https://huggingface.co/api/models/\${encodedRepo}?blobs=1\`;
}

function formatModelSize(bytes) {
  const numericBytes = Number(bytes);
  if (!Number.isFinite(numericBytes) || numericBytes <= 0) return { sizeBytes: null, sizeGb: null, sizeLabel: "unknown size" };
  const sizeGb = Number((numericBytes / 1_000_000_000).toFixed(2));
  return {
    sizeBytes: Math.round(numericBytes),
    sizeGb,
    sizeLabel: \`\${sizeGb.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB\`
  };
}

function estimateModelSize(model = {}) {
  const siblingSize = Array.isArray(model.siblings)
    ? model.siblings.reduce((sum, item) => sum + (Number.isFinite(Number(item?.size)) ? Number(item.size) : 0), 0)
    : 0;
  return formatModelSize(Number(model.usedStorage) > 0 ? Number(model.usedStorage) : siblingSize);
}

async function fetchModelSize(repoId) {
  try {
    const response = await fetch(modelApiUrl(repoId));
    if (!response.ok) return { ...formatModelSize(null), sizeSource: \`model_api_unavailable_\${response.status}\` };
    return { ...estimateModelSize(await response.json()), sizeSource: "huggingface_model_api" };
  } catch (error) {
    return { ...formatModelSize(null), sizeSource: "model_api_error", sizeError: String(error.message || error).slice(0, 200) };
  }
}

function splitPatterns(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function partialDownloadsEnabled() {
  return /^(1|true|yes)$/i.test(String(process.env.HF_MODEL_PARTIAL_DOWNLOAD || ""));
}

async function addModel(repoId, task = "") {
  if (!repoId || !repoId.includes("/")) throw new Error("Usage: node scripts/huggingface-models.mjs add <namespace/model> [task]");
  const manifest = await readManifest();
  const current = manifest.models || [];
  const existing = current.find((model) => model.repoId === repoId);
  const size = await fetchModelSize(repoId);
  console.error(\`Selected Hugging Face model \${repoId} size: \${size.sizeLabel}\`);
  const entry = {
    repoId,
    task: task || existing?.task || "",
    localDir: path.relative(root, localDirFor(repoId)).split(path.sep).join("/"),
    status: existing?.status || "registered",
    ...size,
    addedAt: existing?.addedAt || new Date().toISOString()
  };
  await writeManifest({ ...manifest, models: [...current.filter((model) => model.repoId !== repoId), entry] });
  console.log(JSON.stringify(entry, null, 2));
}

async function downloadModel(repoId = "") {
  const manifest = await readManifest();
  const targets = repoId
    ? [{ repoId, task: manifest.models?.find((model) => model.repoId === repoId)?.task || "" }]
    : manifest.models || [];
  if (!targets.length) throw new Error("No Hugging Face models registered. Run: npm run hf:models:add -- namespace/model");
  const completed = [];
  for (const target of targets) {
    const localDir = localDirFor(target.repoId);
    await fs.mkdir(localDir, { recursive: true });
    const size = await fetchModelSize(target.repoId);
    console.error(\`Selected Hugging Face model \${target.repoId} size: \${size.sizeLabel}\`);
    const args = ["download", target.repoId, "--local-dir", localDir];
    const allowPartial = partialDownloadsEnabled();
    const downloadMode = allowPartial ? "partial-explicit" : "full-repository-with-weights";
    if (allowPartial) {
      for (const pattern of splitPatterns(process.env.HF_MODEL_INCLUDE)) args.push("--include", pattern);
      for (const pattern of splitPatterns(process.env.HF_MODEL_EXCLUDE)) args.push("--exclude", pattern);
    }
    await execFileAsync("hf", args, { stdio: "inherit", maxBuffer: 1024 * 1024 * 8 });
    completed.push({
      repoId: target.repoId,
      task: target.task || "",
      localDir: path.relative(root, localDir).split(path.sep).join("/"),
      status: "downloaded",
      downloadMode,
      ...size,
      downloadedAt: new Date().toISOString()
    });
  }
  const merged = [
    ...(manifest.models || []).filter((model) => !completed.some((item) => item.repoId === model.repoId)),
    ...completed
  ];
  await writeManifest({ ...manifest, models: merged });
  console.log(JSON.stringify({ downloaded: completed }, null, 2));
}

async function buildServices() {
  const manifest = await readManifest();
  const services = [];
  for (const model of manifest.models || []) {
    const repoId = model.repoId;
    if (!repoId) continue;
    const localDir = localDirFor(repoId);
    let exists = false;
    try {
      const stat = await fs.stat(localDir);
      exists = stat.isDirectory();
    } catch {
      exists = false;
    }
    const service = {
      id: \`hf_\${safeName(repoId)}\`,
      repoId,
      task: model.task || "",
      localDir: path.relative(root, localDir).split(path.sep).join("/"),
      status: exists ? "ready" : "missing-download",
      runtime: "project-local-huggingface",
      downloadMode: model.downloadMode || "full-repository-with-weights",
      sizeBytes: model.sizeBytes ?? null,
      sizeGb: model.sizeGb ?? null,
      sizeLabel: model.sizeLabel || "unknown size",
      instructions: [
        "Read the local model card before adding inference code.",
        "Use this local repository path instead of remote inference provider calls.",
        "Keep credentials in environment variables only."
      ],
      builtAt: new Date().toISOString()
    };
    await fs.mkdir(servicesRoot, { recursive: true });
    await fs.writeFile(path.join(servicesRoot, \`\${safeName(repoId)}.json\`), JSON.stringify(service, null, 2) + "\\n");
    services.push(service);
  }
  await writeManifest({ ...manifest, services });
  console.log(JSON.stringify({ services }, null, 2));
}

async function status() {
  const manifest = await readManifest();
  const rows = [];
  for (const model of manifest.models || []) {
    let exists = false;
    try {
      const stat = await fs.stat(localDirFor(model.repoId));
      exists = stat.isDirectory();
    } catch {
      exists = false;
    }
    rows.push({ ...model, repositoryReady: exists });
  }
  console.log(JSON.stringify({ workspace: path.relative(root, workspaceRoot), models: rows, services: manifest.services || [] }, null, 2));
}

async function main() {
  const [command = "status", repoId = "", task = ""] = process.argv.slice(2);
  if (command === "add") return addModel(repoId, task);
  if (command === "download") return downloadModel(repoId);
  if (command === "build") return buildServices();
  if (command === "status") return status();
  throw new Error(\`Unknown command "\${command}". Use add, download, build, or status.\`);
}

main().catch((error) => {
  const message = error.code === "ENOENT" ? "HF CLI is not installed. Install with: curl -LsSf https://hf.co/cli/install.sh | bash -s" : error.message;
  console.error(message);
  process.exit(1);
});
`;
}

export async function ensureProjectHuggingFaceModelWorkspace(workspaceDir, project = {}, options = {}) {
  const created = [];
  const ensureText = async (relativePath, content, { executable = false } = {}) => {
    const targetPath = path.join(workspaceDir, relativePath);
    if (await fs.pathExists(targetPath)) return;
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, content);
    if (executable) await fs.chmod(targetPath, 0o755);
    created.push(relativePath);
  };
  const ensureJson = async (relativePath, payload) => {
    const targetPath = path.join(workspaceDir, relativePath);
    if (await fs.pathExists(targetPath)) return;
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeJson(targetPath, payload, { spaces: 2 });
    created.push(relativePath);
  };

  await ensureText("models/huggingface/README.md", `# Project Hugging Face Models

This folder is the project-local Hugging Face model workspace.

Use it whenever a PlutoniX or project instruction requires a Hugging Face model:

\`\`\`bash
npm run hf:models:add -- namespace/model task-name
npm run hf:models:download -- namespace/model
npm run hf:models:build
npm run hf:models:status
\`\`\`

Downloaded repositories live under \`models/huggingface/repositories/\`. Local service metadata is generated under \`models/huggingface/services/\`.

\`hf:models:download\` downloads the complete Hugging Face repository by default, including all model weight files and shards. \`HF_MODEL_INCLUDE\` and \`HF_MODEL_EXCLUDE\` are ignored unless \`HF_MODEL_PARTIAL_DOWNLOAD=1\` is explicitly set for a temporary diagnostic run.

When a model is added or downloaded, this project estimates the Hugging Face repository size and records it as \`sizeGb\`/\`sizeLabel\` in the manifest and service metadata.

The scripts use the modern \`hf\` CLI. Install it with:

\`\`\`bash
curl -LsSf https://hf.co/cli/install.sh | bash -s
\`\`\`

Keep Hugging Face tokens in \`HF_TOKEN\`; never write tokens into this repository.
`);
  await ensureJson("models/huggingface/model-manifest.json", {
    version: 1,
    projectId: project.id || "",
    projectName: project.name || "",
    models: [],
    services: [],
    source: options.source || "plutonix-project-huggingface-workspace",
    updatedAt: new Date().toISOString()
  });
  const manifestPath = path.join(workspaceDir, "models", "huggingface", "model-manifest.json");
  const manifest = (await fs.pathExists(manifestPath)) ? await fs.readJson(manifestPath).catch(() => null) : null;
  if (manifest) {
    const nextManifest = {
      ...manifest,
      projectId: manifest.projectId || project.id || "",
      projectName: manifest.projectName || project.name || "",
      source: manifest.source || options.source || "plutonix-project-huggingface-workspace",
      updatedAt: manifest.updatedAt || new Date().toISOString()
    };
    if (JSON.stringify(nextManifest) !== JSON.stringify(manifest)) {
      await fs.writeJson(manifestPath, nextManifest, { spaces: 2 });
    }
  }
  await ensureText("models/huggingface/repositories/.gitkeep", "");
  await ensureText("models/huggingface/services/.gitkeep", "");
  await ensureText("scripts/huggingface-models.mjs", huggingFaceModelScript(), { executable: true });
  await appendHuggingFaceAgentsSection(workspaceDir);
  return { status: created.length ? "created" : "already-present", created };
}

export async function ensureProjectQAgenticFramework(workspaceDir, project = {}, options = {}) {
  const created = [];
  const source = options.source || "plutonix-qagentic-framework";
  const ensureText = async (relativePath, content) => {
    const targetPath = path.join(workspaceDir, relativePath);
    if (await fs.pathExists(targetPath)) return;
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, content);
    created.push(relativePath);
  };
  const ensureJson = async (relativePath, payload) => {
    const targetPath = path.join(workspaceDir, relativePath);
    if (await fs.pathExists(targetPath)) return;
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeJson(targetPath, payload, { spaces: 2 });
    created.push(relativePath);
  };
  const syncJson = async (relativePath, payload) => {
    const targetPath = path.join(workspaceDir, relativePath);
    const current = (await fs.pathExists(targetPath)) ? await fs.readJson(targetPath).catch(() => null) : null;
    if (current && JSON.stringify(current) === JSON.stringify(payload)) return;
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeJson(targetPath, payload, { spaces: 2 });
    created.push(relativePath);
  };

  await ensureText("qagentic-support/README.md", `# QAgentic Support

Base QAgentic support is generated at project onset. Runtime QAgents are generated only when objective gaps are detected.

QAgents produce strict Next Instruction Packets and do not directly implement code.
`);
  await ensureText("qagentic-support/qagent-framework.md", `# QAgent Framework

The QAgent framework turns the end of an agent response into a precise continuation decision.

It compares the original objective, previous response, changed files, validation evidence, and known constraints. It continues only for blocking or important gaps.

Do not pre-generate unlimited specialized QAgents. Runtime QAgents are temporary by default and may be persisted only when a repeated reusable gap pattern is proven.
`);
  await ensureText("qagentic-support/qagent-controller.md", `# QAgent Controller

Compare the previous response with the original objective. Continue only for blocking or important gaps. Prefer existing agents. Emit a Next Instruction Packet matching \`schemas/qagent-next-instruction.schema.json\`.

Validate the binding Product Shape Contract: artifact and shape fidelity, underbuilding/overbuilding, interaction model and density, generic-template drift, real-data provenance, supplied-input consumption, and visible explainer copy.

The controller must not execute code directly.
`);
  await ensureText("qagentic-support/qagent-stop-rules.md", `# QAgent Stop Rules

Stop when the objective is complete, validation passes, only polish remains, human approval is required, required user information is missing, or the iteration cap is reached.

Iteration caps: tiny=1, small=3, medium=5, large=8.
`);
  await ensureText("qagentic-support/runtime-qagent-template.md", `# Runtime QAgent Template

Runtime QAgents are temporary by default. They output only Next Instruction Packets and must not implement code directly.

Required output schema: \`schemas/qagent-next-instruction.schema.json\`.
`);
  await ensureText("qagentic-support/qagent-memory-policy.md", `# QAgent Memory Policy

Store objective gaps, successful next instruction summaries, stop reasons, validation failures, and reusable patterns. Do not store secrets, credentials, raw private data, or speculative gap guesses.
`);
  const canonicalQAgentSchema = (await fs.pathExists(canonicalQAgentSchemaPath))
    ? await fs.readJson(canonicalQAgentSchemaPath)
    : qagentNextInstructionSchema;
  await syncJson("schemas/qagent-next-instruction.schema.json", canonicalQAgentSchema);
  if (await fs.pathExists(canonicalProductShapeSchemaPath)) {
    await syncJson("schemas/product-shape-decision.schema.json", await fs.readJson(canonicalProductShapeSchemaPath));
  }
  await ensureText(".codex/prompts/task-qagentic.md", `Read AGENTS.md, qagentic-support/README.md, qagentic-support/qagent-controller.md, and qagentic-support/qagent-stop-rules.md before acting.

Enable QAgentic continuation review for this task.

Task type: tiny | small | medium | large
Task: <write the user objective here>

Preserve existing features. Reuse existing agents. Runtime QAgents may be generated only for blocking or important objective gaps. QAgents must not execute code directly. Validate Product Shape fidelity, depth, interaction model, generic-template drift, real-data provenance, input consumption, and no-explainer copy. Stop when the objective is complete, validation passes, only polish remains, required user information is missing, or the task iteration cap is reached.
`);
  await ensureText(".codex/prompts/bootstrap-orchestrator-qagentic.md", `Optional new-project bootstrap prompt for QAgentic support.

Use this only when creating or bootstrapping a new project, or when the user explicitly requests QAgentic support for an existing project.

Create missing qagentic-support framework files, schema, task prompt, observability output, and QAgent Controller topology relations without replacing existing project instructions.
`);
  await ensureJson("observability/qagentic/latest-qagentic-bootstrap.json", {
    status: "generated",
    source,
    project_id: project.id || "",
    project_name: project.name || "",
    base_framework: true,
    runtime_qagents: "generate_only_when_objective_gap_detected",
    generated_at: new Date().toISOString()
  });
  const huggingFaceWorkspace = await ensureProjectHuggingFaceModelWorkspace(workspaceDir, project, {
    source: `${source}:huggingface-model-workspace`
  });
  created.push(...huggingFaceWorkspace.created);
  await appendQAgenticAgentsSection(workspaceDir);
  return { status: created.length ? "created" : "already-present", created };
}

async function ensureFallbackBootstrapArtifacts(project, missingArtifacts, bootstrapError) {
  const workspaceDir = project.workspaceDir;
  const fallbackArtifacts = [];
  const ensureJson = async (relativePath, payload) => {
    if (await fs.pathExists(path.join(workspaceDir, relativePath))) return;
    await fs.ensureDir(path.dirname(path.join(workspaceDir, relativePath)));
    await fs.writeJson(path.join(workspaceDir, relativePath), payload, { spaces: 2 });
    fallbackArtifacts.push(relativePath);
  };
  const ensureText = async (relativePath, content) => {
    if (await fs.pathExists(path.join(workspaceDir, relativePath))) return;
    await fs.ensureDir(path.dirname(path.join(workspaceDir, relativePath)));
    await fs.writeFile(path.join(workspaceDir, relativePath), content);
    fallbackArtifacts.push(relativePath);
  };

  await fs.ensureDir(path.join(workspaceDir, "graph", "neo4j"));
  await ensureText(
    "agents/generated/project-execution-agent.agent.md",
    [
      "# Project Execution Agent",
      "",
      `project_id: ${project.id}`,
      `project_name: ${project.name}`,
      'role: "project-execution-agent"',
      "",
      "## Responsibility",
      "Execute PlutoniX project generation tasks using the local AGENTS.md policy and the prompt supplied from the PlutoniX text box.",
      ""
    ].join("\n")
  );
  await ensureJson("registry/agents/project-execution-agent.registry.json", {
    agent_id: "project-execution-agent",
    project_id: project.id,
    role: "project-execution-agent",
    source: "plutonix-fallback-bootstrap",
    created_at: new Date().toISOString()
  });
  await ensureJson("topology/d3/agentic-system-graph.json", {
    metadata: {
      project_name: project.name,
      project_id: project.id,
      source: "plutonix-fallback-bootstrap"
    },
    nodes: [{ id: `project:${project.id}`, label: project.name, type: "project" }],
    links: []
  });
  const qagentic = await ensureProjectQAgenticFramework(workspaceDir, project, { source: "plutonix-fallback-qagentic-bootstrap" });
  fallbackArtifacts.push(...qagentic.created);

  await ensureJson(bootstrapVerificationPath, {
    status: bootstrapError ? "bootstrap-command-failed-continuing" : "incomplete",
    workflow_id: "bootstrap-orchestrator-001",
    project_id: project.id,
    message: bootstrapError
      ? "Bootstrap command failed, but PlutoniX created local fallback artifacts so project generation can continue."
      : "Bootstrap command completed, but required artifacts were missing. PlutoniX created local fallback artifacts so project generation can continue.",
    error: bootstrapError?.message || null,
    missingArtifacts,
    fallbackArtifacts,
    recordedAt: new Date().toISOString()
  });
  return fallbackArtifacts;
}

function enabled(value, defaultValue = true) {
  if (value === undefined) return defaultValue;
  return String(value).toLowerCase() !== "false";
}

function archivePath() {
  return process.env.ORCHESTRATOR_ARCHIVE_PATH || "/workspace/project/orchestrator-temp/orchestrator-agent-001-main.zip";
}

function normalizedArchiveEntries(zip) {
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const names = entries.map((entry) => entry.entryName.replace(/\\/g, "/").replace(/^\/+/, ""));
  const firstSegments = new Set(names.map((name) => name.split("/")[0]).filter(Boolean));
  const rootPrefix = firstSegments.size === 1 ? `${[...firstSegments][0]}/` : "";
  return entries.map((entry, index) => ({
    entry,
    relativePath: rootPrefix && names[index].startsWith(rootPrefix) ? names[index].slice(rootPrefix.length) : names[index]
  }));
}

export async function installProjectOrchestratorSeed(workspaceDir, options = {}) {
  if (!enabled(process.env.ORCHESTRATOR_INSTALL_ENABLED)) {
    return { status: "skipped", reason: "ORCHESTRATOR_INSTALL_ENABLED=false" };
  }
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  const sourceArchive = archivePath();
  if (!(await fs.pathExists(sourceArchive))) throw new Error(`Project orchestrator archive was not found at ${sourceArchive}.`);
  emit("orchestrator-archive-start", `Extracting project orchestrator from ${sourceArchive}`, {
    archivePath: sourceArchive,
    workspaceDir
  });

  const zip = new AdmZip(sourceArchive);
  const extractedFiles = [];
  for (const { entry, relativePath } of normalizedArchiveEntries(zip)) {
    if (!relativePath || relativePath === ".DS_Store" || relativePath === ".env") continue;
    const targetPath = path.resolve(workspaceDir, relativePath);
    const workspaceRoot = path.resolve(workspaceDir);
    if (targetPath !== workspaceRoot && !targetPath.startsWith(`${workspaceRoot}${path.sep}`)) {
      throw new Error(`Orchestrator archive contains an unsafe path: ${entry.entryName}`);
    }
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, entry.getData());
    extractedFiles.push(relativePath);
  }
  for (const relativePath of seedPaths) {
    if (!(await fs.pathExists(path.join(workspaceDir, relativePath)))) {
      throw new Error(`Orchestrator archive is missing ${relativePath}.`);
    }
  }
  const archiveBuffer = await fs.readFile(sourceArchive);
  const manifest = {
    archivePath: sourceArchive,
    archiveName: path.basename(sourceArchive),
    archiveSha256: crypto.createHash("sha256").update(archiveBuffer).digest("hex"),
    archiveComment: zip.getZipComment() || null,
    extractedFiles,
    preservedRuntimeFiles: [".env"],
    installedAt: new Date().toISOString(),
    bootstrapPrompt: ".codex/prompts/bootstrap-orchestrator.md"
  };
  await fs.ensureDir(path.join(workspaceDir, ".agentic"));
  await fs.writeJson(path.join(workspaceDir, ".agentic", "orchestrator-source.json"), manifest, { spaces: 2 });
  emit("orchestrator-archive-installed", `Project orchestrator archive installed (${extractedFiles.length} files)`, manifest);
  return { status: "installed", ...manifest };
}

function emitBootstrapLine(line, emit, buildId) {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const payload = JSON.parse(trimmed);
    const eventType = payload.type || payload.event || "bootstrap-event";
    const message = payload.message || payload.text || payload.item?.text || payload.item?.message || eventType;
    emit("orchestrator-bootstrap-progress", String(message).slice(0, 600), { buildId, codexEventType: eventType });
  } catch {
    emit("orchestrator-bootstrap-progress", trimmed.slice(0, 600), { buildId });
  }
}

export async function runProjectOrchestratorBootstrap(project, options = {}) {
  if (!enabled(process.env.ORCHESTRATOR_BOOTSTRAP_ENABLED)) {
    return { status: "skipped", reason: "ORCHESTRATOR_BOOTSTRAP_ENABLED=false" };
  }
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  const workspaceDir = project.workspaceDir;
  const promptPath = path.join(workspaceDir, ".codex", "prompts", "bootstrap-orchestrator.md");
  if (!(await fs.pathExists(promptPath))) throw new Error("Project bootstrap prompt is not installed.");
  const codexBin = process.env.CODEX_BIN || "codex";
  const timeoutMs = Number(process.env.ORCHESTRATOR_BOOTSTRAP_TIMEOUT_MS || 15 * 60 * 1000);
  const buildId = `bootstrap_${project.id}`;
  emit("orchestrator-bootstrap-start", bootstrapCommand, {
    buildId,
    projectId: project.id,
    workspaceDir,
    promptPath: ".codex/prompts/bootstrap-orchestrator.md"
  });

  const args = [
    "exec",
    "--json",
    "--cd",
    workspaceDir,
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "workspace-write",
    bootstrapCommand
  ];
  const stderr = [];
  let bootstrapError = null;
  await new Promise((resolve, reject) => {
    const child = spawn(codexBin, args, {
      cwd: workspaceDir,
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Project orchestrator bootstrap timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => chunk.split(/\r?\n/).forEach((line) => emitBootstrapLine(line, emit, buildId)));
    child.stderr.on("data", (chunk) => {
      stderr.push(chunk);
      chunk.split(/\r?\n/).forEach((line) => emitBootstrapLine(line, emit, buildId));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Orchestrator bootstrap exited with code ${code}: ${stderr.join("").slice(-2000)}`));
    });
  }).catch((error) => {
    bootstrapError = error;
  });

  const missing = [];
  for (const relativePath of requiredBootstrapArtifacts) {
    if (!(await fs.pathExists(path.join(workspaceDir, relativePath)))) missing.push(relativePath);
  }
  const qagentic = await ensureProjectQAgenticFramework(workspaceDir, project, { source: "plutonix-bootstrap-qagentic-framework" });
  const fallbackArtifacts = missing.length || bootstrapError ? await ensureFallbackBootstrapArtifacts(project, missing, bootstrapError) : qagentic.created;
  const verifiedArtifacts = [];
  for (const relativePath of requiredBootstrapArtifacts) {
    if (await fs.pathExists(path.join(workspaceDir, relativePath))) verifiedArtifacts.push(relativePath);
  }
  const result = {
    status: bootstrapError ? "bootstrap-failed-continuing" : missing.length ? "bootstrapped-with-warnings" : "bootstrapped",
    buildId,
    projectId: project.id,
    promptPath: ".codex/prompts/bootstrap-orchestrator.md",
    verifiedArtifacts,
    missingArtifacts: missing,
    fallbackArtifacts,
    bootstrapError: bootstrapError?.message || null
  };
  await fs.ensureDir(path.join(workspaceDir, ".agentic"));
  await fs.writeJson(path.join(workspaceDir, ".agentic", "bootstrap-status.json"), {
    ...result,
    completedAt: new Date().toISOString()
  }, { spaces: 2 });
  emit(
    bootstrapError || missing.length ? "orchestrator-bootstrap-warning" : "orchestrator-bootstrap-complete",
    bootstrapError || missing.length
      ? `Project orchestrator bootstrap completed with missing artifacts; continuing generation for ${project.name}`
      : `Project orchestrator bootstrap verified for ${project.name}`,
    result
  );
  return result;
}
