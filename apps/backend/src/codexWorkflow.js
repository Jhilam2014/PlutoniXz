import crypto from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { nanoid } from "nanoid";
import { estimateTokens, recordAgentTokenUsage } from "./tokenEconomy.js";
import { productShapePrompt, validateProductShapeOutputs } from "./productShape.js";

const ignoredDirs = new Set(["node_modules", "dist", ".git"]);
const largeArtifactExtensions = new Set([
  ".bin",
  ".ckpt",
  ".gguf",
  ".onnx",
  ".pth",
  ".pt",
  ".safetensors"
]);
const maxHashableFileBytes = Number(process.env.PLUTONIX_MAX_HASH_FILE_BYTES || 100 * 1024 * 1024);
const inspectableTextExtensions = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".json",
  ".md",
  ".html",
  ".css",
  ".scss",
  ".py",
  ".sh",
  ".yaml",
  ".yml",
  ".txt",
  ".csv",
  ".xml"
]);

function codexProcessEnvironment() {
  const nodeDirectory = path.dirname(process.execPath || "");
  const pathEntries = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  if (nodeDirectory && !pathEntries.includes(nodeDirectory)) pathEntries.unshift(nodeDirectory);
  return {
    ...process.env,
    PATH: pathEntries.join(path.delimiter),
    CI: "1",
    NO_COLOR: "1"
  };
}

export function shouldSkipHashFile(relativePath, stat) {
  const normalizedPath = String(relativePath || "").split(path.sep).join("/");
  const extension = path.extname(normalizedPath).toLowerCase();
  return (
    normalizedPath.startsWith("models/huggingface/repositories/") ||
    (normalizedPath.startsWith("models/huggingface/") && largeArtifactExtensions.has(extension)) ||
    Number(stat?.size || 0) > maxHashableFileBytes
  );
}

async function collectFileHashes(rootDir, dir = rootDir, hashes = new Map()) {
  if (!(await fs.pathExists(dir))) return hashes;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFileHashes(rootDir, absolutePath, hashes);
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = path.relative(rootDir, absolutePath);
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat?.isFile() || shouldSkipHashFile(relativePath, stat)) continue;
    const content = await fs.readFile(absolutePath);
    hashes.set(relativePath, crypto.createHash("sha256").update(content).digest("hex"));
  }
  return hashes;
}

function diffHashes(before, after) {
  const changed = [];
  for (const [filePath, hash] of after.entries()) {
    if (before.get(filePath) !== hash) changed.push(filePath);
  }
  for (const filePath of before.keys()) {
    if (!after.has(filePath)) changed.push(filePath);
  }
  return [...new Set(changed)].sort();
}

function receiptIds(metadata = {}) {
  const candidates = [
    metadata.consumedInputIds,
    metadata.consumedSourceIds,
    metadata.consumedMediaIds,
    metadata.inputConsumption?.consumedInputIds,
    metadata.inputConsumption?.consumedSourceIds,
    metadata.generationReceipt?.consumedInputIds,
    metadata.generationReceipt?.consumedSourceIds,
    metadata.generationReceipt?.consumedMediaIds,
    metadata.sources?.filter?.((item) => item?.status === "consumed").map((item) => item.id)
  ];
  return new Set(candidates.flatMap((value) => Array.isArray(value) ? value : []).filter(Boolean).map(String));
}

async function buildInputConsumptionReceipt(generatedSiteDir, changedFiles, orchestratedRequest) {
  const inputSources = Array.isArray(orchestratedRequest.inputSources) ? orchestratedRequest.inputSources : [];
  if (!inputSources.length) {
    return {
      status: "not_applicable",
      consumedInputIds: [],
      unresolvedInputIds: [],
      consumedMediaIds: [],
      evidence: []
    };
  }

  const metadataPath = path.join(generatedSiteDir, "src", "generated", "metadata.json");
  const metadata = (await fs.pathExists(metadataPath)) ? await fs.readJson(metadataPath).catch(() => ({})) : {};
  const declaredIds = receiptIds(metadata);
  const textEvidence = [];
  for (const relativePath of changedFiles) {
    const extension = path.extname(relativePath).toLowerCase();
    if (!inspectableTextExtensions.has(extension)) continue;
    const absolutePath = path.join(generatedSiteDir, relativePath);
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat?.isFile() || stat.size > 1_500_000) continue;
    const content = await fs.readFile(absolutePath, "utf8").catch(() => "");
    if (content) textEvidence.push({ path: relativePath, content });
  }

  const consumedInputIds = [];
  const evidence = [];
  for (const source of inputSources) {
    const sourceId = String(source.id || "");
    if (!sourceId) continue;
    let consumed = declaredIds.has(sourceId);
    let evidencePath = consumed && (await fs.pathExists(metadataPath)) ? "src/generated/metadata.json" : "";
    if (!consumed) {
      const sourceValue = String(source.value || "").trim();
      const fragments = [
        sourceId,
        source.sourceType === "required_data" && sourceValue.length >= 12 ? sourceValue.slice(0, Math.min(100, sourceValue.length)) : "",
        source.sourceType !== "required_data" ? path.basename(sourceValue) : ""
      ].filter((value) => value.length >= 4);
      const match = textEvidence.find((row) => fragments.some((fragment) => row.content.includes(fragment)));
      if (match) {
        consumed = true;
        evidencePath = match.path;
      }
    }
    if (consumed) {
      consumedInputIds.push(sourceId);
      evidence.push({ sourceId, path: evidencePath, sourceType: source.sourceType || "unknown" });
    }
  }

  const consumedSet = new Set(consumedInputIds);
  const unresolvedInputIds = inputSources.map((source) => String(source.id || "")).filter((id) => id && !consumedSet.has(id));
  const consumedMediaIds = inputSources
    .filter((source) => source.sourceType === "media" && consumedSet.has(String(source.id)))
    .map((source) => String(source.id));
  return {
    status: unresolvedInputIds.length ? "retained_for_clarification" : "verified",
    consumedInputIds,
    unresolvedInputIds,
    consumedMediaIds,
    evidence
  };
}

function codexPrompt(instruction, orchestratedRequest, hasProjectOrchestrator) {
  const envelope = orchestratedRequest.orchestrationEnvelope;
  const isDirectChildTask = orchestratedRequest.executionInstructionFormat === "plutonix-delegated-project-task";
  const productDecision = orchestratedRequest.productDecision || envelope?.plan?.productDecision || null;
  const productContract = productDecision
    ? productShapePrompt(productDecision)
    : "No new-product shape decision applies. Preserve the existing product architecture and implement only the requested change.";
  const huggingFaceIntent = orchestratedRequest.huggingFaceModelPool?.intent;
  const huggingFaceRequired = Boolean(huggingFaceIntent?.requested || orchestratedRequest.modelRouting?.enforceLocalHuggingFace);
  const huggingFaceRequirement = huggingFaceRequired
    ? [
        "- Hugging Face model requirement detected: use the project-local `models/huggingface/` workspace.",
        "- Register selected model repositories in `models/huggingface/model-manifest.json`, download the complete repository including all model weight files and shards with `npm run hf:models:download -- <namespace/model>` or `node scripts/huggingface-models.mjs download <namespace/model>`, then run `npm run hf:models:build` to create local service metadata.",
        "- Before implementing against a selected model, inform the user of the estimated repository size in GB and keep that size in the model manifest/service metadata.",
        "- Read the model card from the downloaded repository before writing inference code.",
        "- Prefer local Hugging Face repositories over remote inference-provider calls. Keep `HF_TOKEN` in environment variables only.",
        "- For this Hugging Face task only, project-local model manifests, scripts, backend adapters, package scripts, and Docker/env docs may be updated when necessary."
      ].join("\n")
    : "";
  const hasVisualReference = (orchestratedRequest.inputSources || []).some((source) => {
    const sourceType = String(source?.sourceType || "").toLowerCase();
    const mimeType = String(source?.mimeType || source?.mime || "").toLowerCase();
    const value = String(source?.value || source?.name || source?.path || "").toLowerCase();
    return (
      sourceType === "media" ||
      sourceType === "ui_reference" ||
      sourceType === "screenshot" ||
      mimeType.startsWith("image/") ||
      /\.(png|jpe?g|webp|gif|avif|fig|sketch)$/.test(value)
    );
  });
	  const visualReferenceRequirement = hasVisualReference
	    ? [
	        "- Visual/UI reference detected: treat screenshots, product images, Figma frames, and named-app references as functional product evidence, not only style references.",
        "- Before implementing, enumerate the visible UI nodes: navigation items, controls, buttons, filters, tabs, tables, charts, panels, editors, drawers, status badges, command bars, cards, and empty states.",
        "- Map every prominent UI node to intended behavior, state changes, data/API/client needs, validation criteria, or an explicit fallback such as `needs_credentials`, `out_of_scope`, or `integration_unavailable`.",
        "- Implement the represented workflow end to end within scope. Do not leave prominent visible controls decorative unless the user explicitly requested a static mockup, visual clone, or UI-only preview.",
        "- If the screenshot is from a known tool or product category, use available research/UI-exploration agents or existing product knowledge to infer realistic workflows before coding. When live research is unavailable, record that limitation and use conservative domain inference.",
	        "- Record a `ui_node_to_functionality` map in `src/generated/metadata.json`, a generated data module, or project documentation with each node marked `implemented`, `fallback`, `out_of_scope`, or `needs_credentials`."
	      ].join("\n")
	    : "";
	  const designWorkshopRequirement = [
	    "- Run the Agentic System design workshop lens whenever visible functionality, controls, panels, modals, logs, graph views, or navigation are added or changed.",
	    "- Review the surface as coordinated design strategy, UX workflow, frontend implementation, accessibility, responsive behavior, visual hierarchy, information density, command placement, and regression risk.",
	    "- Preserve all existing functionality while improving professional aesthetic quality, clarity, discoverability, spacing, contrast, and user-friendly flow.",
	    "- Keep primary workflow actions such as run, stop, approve, publish, save, upload, and destructive controls visible in the main working window whenever practical, instead of hiding them below logs or secondary panels.",
	    "- Reject decorative clutter, duplicated controls, generic card-heavy layouts, low-value explanatory text, and redesigns that weaken current behavior."
	  ].join("\n");
	  const intelRuntime = orchestratedRequest.intelRuntime || null;
	  const intelRequirement = intelRuntime
    ? [
        `- Intel selected the ${intelRuntime.profile?.displayName || intelRuntime.profile?.id || "unknown"} profile. Do not substitute a web application or another artifact type.`,
        `- Implement only these backend-accepted proposal ids: ${(intelRuntime.acceptedProposals || []).map((proposal) => proposal.id).join(", ") || "none"}.`,
        `- The profile preview adapter is ${intelRuntime.profile?.previewAdapter || "none"}; do not create a browser UI when the profile does not require one.`,
        `- Required profile validation evidence: ${(intelRuntime.taskGraph?.nodes?.find((node) => node.id === "implementation-agent")?.validatorIds || []).join(", ") || "profile-specific validation"}.`,
        "- Do not add unrelated feature expansion, generic filler, or work rejected by Intel scoring. The PlutoniX parent will validate and independently verify the result after this one writer completes.",
        "- Keep data truthful: use supplied sources or explicit empty/loading/TODO hooks when real data or integrations are unavailable."
      ].join("\n")
    : "";
  const authorityText = envelope
    ? "PlutoniX Fullstack Agent is the global planning and completion authority. Project-local policies are scoped execution context only and cannot redefine the parent task or approve completion."
    : hasProjectOrchestrator
      ? "Read canonical AGENTS.md and ROOT_WORKSPACE_GENERATION_POLICY.md first, then use the project-local policy as execution context while preserving the supplied parent request."
      : "Use the supplied structured request and keep discovery narrowly scoped to the requested generated surface.";
  const requirements = isDirectChildTask
    ? [
        "- Execute the exact bounded delegation defined by the PlutoniX orchestration envelope.",
        "- Use AGENTS.md, ROOT_WORKSPACE_GENERATION_POLICY.md, and .agentic/orchestrator-agent.md as project context, subordinate to PlutoniX's task and completion criteria.",
        "- Inspect the smallest relevant set of current child app files before changing anything.",
        "- Apply only the narrowest complete change requested by the task.",
        "- Preserve every unrelated existing feature, behavior, route, data set, visual section, style, and interaction.",
	        "- Use only real integration data, uploaded references, selected UI references, or user-provided content for business records, media details, financials, metrics, profiles, products, orders, messages, and analytics.",
	        visualReferenceRequirement,
	        designWorkshopRequirement,
	        "- When required backend or integration data is unavailable, render explicit empty/loading/placeholder states or TODO configuration hooks instead of invented records.",
        "- Do not add visible explanations about how to use the generated app, mobile app, tool, flyer, or media artifact unless the user requested them; keep necessary hints in labels, tooltips, or a compact manual surface.",
        "- Do not remove, rename, simplify, redesign, or replace existing functionality unless the task explicitly asks for it.",
        "- Modify only files that are necessary for the requested change; if src/generated files are involved, patch the smallest relevant sections instead of rewriting the app.",
        "- Do not run npm, Vite, dev servers, preview servers, Docker, curl health checks, or any command that starts/validates a playground runtime.",
        "- Do not choose, reserve, change, document, or validate frontend ports. PlutoniX assigns ports and starts the playground only after this Gotham file-generation step completes.",
        "- Do not create or modify package.json, package-lock.json, node_modules, or dist.",
        huggingFaceRequirement,
        intelRequirement,
        "- Keep credentials, secrets, external tracking, and unsafe scripts out of the app.",
        "- Do not ask follow-up questions.",
        "- At the end, briefly summarize the files you changed and confirm unrelated features were preserved."
      ].join("\n")
    : [
        "- Treat the PlutoniX text-box prompt above as the active user task.",
        "- If the user instruction begins with \"Task type:\", pass that exact task block through the project-local orchestrator command rules as the task to execute.",
        "- When project-local orchestration is available, execute the task using AGENTS.md, ROOT_WORKSPACE_GENERATION_POLICY.md, and .agentic/orchestrator-agent.md command rules.",
        "- Apply the binding Product Shape Contract before selecting stack, routes, files, components, agents, or visible UI.",
        "- Create the requested primary artifact in its task-appropriate output path. A webpage is not a substitute for a PDF, image, video, audio, presentation, API, CLI, automation, data workflow, infrastructure output, or mobile application.",
        "- Use src/generated only for browser-facing application code, generation metadata, or an auxiliary artifact preview when the Product Shape Contract justifies it.",
        "- Infer direct and indirect functionality from the instruction and uploaded project documentation; include relevant features needed to satisfy the end objective.",
	        "- Use only real integration data, uploaded references, selected UI references, or user-provided content for business records, media details, financials, metrics, profiles, products, orders, messages, and analytics.",
	        visualReferenceRequirement,
	        designWorkshopRequirement,
	        "- When required backend or integration data is unavailable, render explicit empty/loading/placeholder states or TODO configuration hooks instead of invented records.",
        "- Do not add visible explanations about how to use the generated app, mobile app, tool, flyer, or media artifact unless the user requested them; keep necessary hints in labels, tooltips, or a compact manual surface.",
        "- Match information density, navigation, spatial composition, controls, and visual hierarchy to the Product Shape Contract's interaction model and primary user job.",
        "- A dashboard is justified only for monitoring, comparing, or triaging multiple real signals. Do not use dashboards, metric rows, card grids, sidebars, marketing heroes, About pages, Contact pages, or feature sections as universal defaults.",
        "- Distinct tasks must differ structurally, not only by palette or copy. Use domain-specific controls and composition instead of repeating generic rounded cards and fields.",
        "- Choose route boundaries only for distinct user goals or operational domains. Do not create generic Home, Features, About, and Contact routes by default.",
        "- Update src/generated/metadata.json with the product decision version, artifact type, product shape, interaction model, primary output paths, consumed input/reference identifiers or paths, unresolved placeholders, and validation evidence.",
        "- Do not run npm, Vite, dev servers, preview servers, Docker, curl health checks, or any command that starts/validates a playground runtime.",
        "- Do not choose, reserve, change, document, or validate frontend ports. PlutoniX assigns ports and starts the playground only after this Gotham file-generation step completes.",
        "- You may update project manifests, dependencies, Docker assets, backend files, scripts, service contracts, tests, or artifact-generation sources when the selected product shape requires them. Never edit node_modules or dist.",
        "- Use configured real integrations when requested; keep secrets in environment variables and do not add tracking or invented endpoints.",
        huggingFaceRequirement,
        intelRequirement,
        "- Preserve reusable PlutoniX runtime and preview compatibility, but do not let the existing React/Vite scaffold redefine the primary deliverable.",
        "- Do not ask follow-up questions.",
        "- At the end, briefly summarize the files you changed."
      ].join("\n");
  const workspaceDirective = isDirectChildTask
    ? "Edit the selected child project in this working directory. Use its project-local orchestrator policy and make only the requested scoped change."
    : productDecision?.productShape === "artifact_only"
      ? `Create the requested ${productDecision.artifactType} as the primary deliverable. A browser preview is auxiliary and must not replace the artifact.`
      : productDecision?.productShape === "service_or_automation"
        ? `Create the requested ${productDecision.artifactType} entrypoint or service contract as the primary deliverable. Add UI only when requested.`
        : "Implement the selected product shape in this project workspace and modify the files required for a complete result.";
  return `You are the current Gotham CLI running the PlutoniX workflow.

${workspaceDirective}

Project orchestration authority:
${authorityText}

${productContract}

PlutoniX Fullstack Agent policy and orchestration envelope:
${envelope ? JSON.stringify(envelope, null, 2) : "No PlutoniX envelope supplied."}

User instruction:
${instruction}

${isDirectChildTask ? "Direct child app task request" : "Orchestrated request"}:
${JSON.stringify(orchestratedRequest, null, 2)}

Requirements:
${requirements}`;
}

function emitCodexLine(line, emit, buildId, agentId) {
  const trimmed = line.trim();
  if (!trimmed) return;
  if (isRecoverableCodexCacheWarning(trimmed)) return;
  try {
    const event = JSON.parse(trimmed);
    const eventType = event.type || event.event || "codex-event";
    const message =
      event.message ||
      event.text ||
      event.delta ||
      event.item?.text ||
      event.item?.message ||
      event.result?.message ||
      eventType;
    emit("codex-progress", String(message).slice(0, 600), {
      stage: "5/8",
      buildId,
      agentId,
      codexEventType: eventType
    });
  } catch {
    emit("codex-progress", trimmed.slice(0, 600), {
      stage: "5/8",
      buildId,
      agentId
    });
  }
}

export function isRecoverableGothamModelsCacheError(value) {
  const line = String(value?.message || value || "");
  return (
    /codex_models_manager::(manager|cache)|gotham_models_manager::(manager|cache)/.test(line) &&
    /missing field `supports_reasoning_summaries`/.test(line) &&
    /failed to (renew cache TTL|load models cache)/.test(line)
  );
}

export function isGothamCodexModelCompatibilityError(value) {
  const line = String(value?.message || value || "");
  return /model requires a newer version of Codex|model metadata for .+ not found/i.test(line);
}

export function classifyGothamWorkflowFailure(value) {
  if (isRecoverableGothamModelsCacheError(value)) return "models_cache_incompatible";
  if (isGothamCodexModelCompatibilityError(value)) return "codex_cli_model_incompatible";
  return "workflow_execution_failed";
}

function requestedModelFromFailure(value) {
  const message = String(value?.message || value || "");
  return message.match(/The ['\"]([^'\"]+)['\"] model requires a newer version of Codex/i)?.[1] || "";
}

export async function probeCodexCli(codexBin, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const output = [];
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child;
    try {
      child = spawn(codexBin, ["--version"], {
        env: codexProcessEnvironment(),
        stdio: ["ignore", "pipe", "ignore"]
      });
    } catch (error) {
      finish({ available: false, status: "unavailable", version: "", error: error.message || String(error) });
      return;
    }
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      // The command was successfully started. A slow version response must not
      // be rendered as an unavailable CLI while the actual workflow can run.
      finish({ available: true, status: "version_check_timed_out", version: "" });
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => output.push(chunk));
    child.on("error", (error) => {
      finish({ available: false, status: "unavailable", version: "", error: error.message || String(error) });
    });
    child.on("close", (code) => {
      const version = output.join("").trim();
      finish({
        available: code === 0,
        status: code === 0 ? "available" : "version_check_failed",
        version
      });
    });
  });
}

function codexCliLabel(probe) {
  if (probe.version) return probe.version;
  if (probe.status === "unavailable") return "unavailable";
  if (probe.status === "version_check_timed_out") return "configured (version check timed out)";
  if (probe.status === "version_check_failed") return "configured (version check failed)";
  return "configured";
}

function isRecoverableCodexCacheWarning(line) {
  return isRecoverableGothamModelsCacheError(line);
}

async function quarantineGothamModelCaches() {
  const runtimeHome = process.env.GOTHAM_HOME || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const entries = await fs.readdir(runtimeHome, { withFileTypes: true }).catch(() => []);
  const cacheEntries = entries.filter((entry) => entry.isFile() && (/model.*cache|cache.*model/i.test(entry.name) || entry.name === "models.json"));
  if (!cacheEntries.length) return [];
  const quarantineDir = path.join(runtimeHome, "cache-recovery", `models-${Date.now()}`);
  await fs.ensureDir(quarantineDir);
  const moved = [];
  for (const entry of cacheEntries) {
    const source = path.join(runtimeHome, entry.name);
    const destination = path.join(quarantineDir, entry.name);
    const movedSuccessfully = await fs.move(source, destination, { overwrite: false }).then(() => true).catch(() => false);
    if (movedSuccessfully) moved.push(source);
  }
  return moved;
}

export async function runCodexWorkflow(orchestratedRequest, options = {}) {
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  const signal = options.signal;
  if (signal?.aborted) throw new Error("Gotham workflow was stopped by the user.");
  const generatedSiteDir =
    options.generatedSiteDir || process.env.GENERATED_SITE_DIR || path.resolve(process.cwd(), "../generated-site");
  const codexBin = process.env.CODEX_BIN || "codex";
  const selectedModel = options.model || "";
  const codexProbe = process.env.GOTHAM_RUNTIME_PROBE === "true"
    ? await probeCodexCli(codexBin)
    : { available: null, status: "not_checked", version: "" };
  const codexVersion = codexProbe.version;
  const codexCliStatus = codexCliLabel(codexProbe);
  const timeoutMs = Number(options.timeoutMs ?? process.env.CODEX_WORKFLOW_TIMEOUT_MS ?? 10 * 60 * 1000);
  const inactivityTimeoutMs = Math.max(1000, timeoutMs);
  const sourceInstruction = orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "";
  const executionAgentId = options.executionAgentId || orchestratedRequest.orchestrationEnvelope?.authority?.agentId || options.agentId || orchestratedRequest.orchestrator || "project-execution-agent";
  const buildId = `codex_${nanoid(10)}`;
  const generatedSourceDir = path.join(generatedSiteDir, "src", "generated");
  const projectOrchestratorPath = path.join(generatedSiteDir, ".agentic", "orchestrator-agent.md");
  const hasProjectOrchestrator = await fs.pathExists(projectOrchestratorPath);
  const promptText = codexPrompt(sourceInstruction, orchestratedRequest, hasProjectOrchestrator);
  const quarantinedModelCaches = options.recoverModelsCache ? await quarantineGothamModelCaches() : [];

  await fs.ensureDir(generatedSourceDir);
  const before = await collectFileHashes(generatedSiteDir);
  const startedAt = Date.now();

  emit("codex-start", `Starting current Gotham CLI workflow ${buildId}`, {
    stage: "5/8",
    buildId,
    generatedSiteDir,
    generatedSourceDir,
    codexBin,
    codexVersion: codexCliStatus,
    codexCliStatus: codexProbe.status,
    codexCliError: codexProbe.error || "",
    requestedModel: selectedModel || "Codex configuration default",
    agentInput: sourceInstruction.slice(0, 12000),
    agentPrompt: promptText.slice(0, 12000),
    agentId: executionAgentId,
    orchestrationAuthority: orchestratedRequest.orchestrationEnvelope ? "plutonix-global" : hasProjectOrchestrator ? "project-local-legacy" : "plutonix-default",
    parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
    childExecutionIds: orchestratedRequest.orchestrationEnvelope?.childExecutionIds || [],
    orchestratorPolicyPath: hasProjectOrchestrator ? projectOrchestratorPath : null,
    modelsCacheRecovery: options.recoverModelsCache
      ? { attempted: true, quarantinedFiles: quarantinedModelCaches.map((file) => path.basename(file)) }
      : null
  });
  emit("gotham-runtime-verified", `Gotham CLI ${codexCliStatus}; model ${selectedModel || "from Codex configuration"}`, {
    stage: "runtime",
    buildId,
    codexBin,
    codexVersion: codexCliStatus,
    codexCliStatus: codexProbe.status,
    codexCliError: codexProbe.error || "",
    requestedModel: selectedModel || "",
    fallbackModel: process.env.GOTHAM_FALLBACK_MODEL || ""
  });

  const args = [
    "exec",
    "--json",
    "--cd",
    generatedSiteDir,
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "workspace-write",
    ...(selectedModel ? ["--model", selectedModel] : []),
    promptText
  ];

  const output = [];
  const errors = [];
  await new Promise((resolve, reject) => {
    const child = spawn(codexBin, args, {
      cwd: generatedSiteDir,
      env: codexProcessEnvironment(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let timer;
    let settled = false;
    let childClosed = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const stopChild = () => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!childClosed) child.kill("SIGKILL");
      }, 2500).unref?.();
    };
    const onAbort = () => {
      stopChild();
      rejectOnce(new Error("Gotham workflow was stopped by the user."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const resetInactivityTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stopChild();
        rejectOnce(new Error(`Gotham workflow produced no output for ${Math.round(inactivityTimeoutMs / 1000)} seconds and was stopped.`));
      }, inactivityTimeoutMs);
    };
    resetInactivityTimer();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      resetInactivityTimer();
      output.push(chunk);
      for (const line of chunk.split(/\r?\n/)) emitCodexLine(line, emit, buildId, executionAgentId);
    });
    child.stderr.on("data", (chunk) => {
      resetInactivityTimer();
      errors.push(chunk);
      for (const line of chunk.split(/\r?\n/)) emitCodexLine(line, emit, buildId, executionAgentId);
    });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      rejectOnce(error);
    });
    child.on("close", (code) => {
      childClosed = true;
      signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      if (code === 0) {
        resolveOnce();
        return;
      }
      const error = new Error(`Gotham workflow exited with code ${code}: ${errors.join("").slice(-2000)}`);
      error.workflowFailureClass = classifyGothamWorkflowFailure(error);
      error.requestedModel = selectedModel || requestedModelFromFailure(error);
      error.codexVersion = codexVersion;
      rejectOnce(error);
    });
  });

  const after = await collectFileHashes(generatedSiteDir);
  const changedSourceFiles = diffHashes(before, after);
  const changedFiles = changedSourceFiles.map((filePath) => filePath.split(path.sep).join("/"));
  if (!changedFiles.length) {
    throw new Error("Gotham completed but did not change any meaningful project or requested artifact files.");
  }
  const inputConsumption = await buildInputConsumptionReceipt(generatedSiteDir, changedFiles, orchestratedRequest);
  const productShapeValidation = validateProductShapeOutputs(
    orchestratedRequest.productDecision || orchestratedRequest.orchestrationEnvelope?.plan?.productDecision || {},
    changedFiles
  );
  if (productShapeValidation.status === "failed") {
    throw new Error(`Product Shape validation failed: ${productShapeValidation.failures.join(" ")}`);
  }

  const instructionHash = crypto.createHash("sha256").update(sourceInstruction).digest("hex");
  const outputText = output.join("");
  const durationMs = Date.now() - startedAt;
  const tokenUsage = await recordAgentTokenUsage({
    agentId: executionAgentId,
    agentName: options.executionAgentName || orchestratedRequest.orchestrationEnvelope?.authority?.agentName || options.agentName || "",
    projectId: orchestratedRequest.project?.id || options.projectId || "",
    projectName: orchestratedRequest.project?.name || options.projectName || "",
    workflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
    buildId,
    instructionHash,
    instructionSummary: sourceInstruction,
    taskType: options.taskType || orchestratedRequest.taskType || "",
    inputTokens: estimateTokens(promptText),
    outputTokens: estimateTokens(outputText),
    durationMs,
    changedFiles: changedFiles.length
  });
  emit("codex-complete", `Gotham changed ${changedFiles.length} files`, {
    stage: "6/8",
    buildId,
    changedFiles,
    durationMs,
    tokenUsage,
    agentId: executionAgentId,
    agentInput: sourceInstruction.slice(0, 12000),
    agentResponse: outputText.slice(-12000)
  });

  return {
    buildId,
    parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
    childExecutionIds: orchestratedRequest.orchestrationEnvelope?.childExecutionIds || [],
    title: orchestratedRequest.topic || "Generated Site",
    instructionHash,
    runtime: {
      codexBin,
      codexVersion,
      selectedModel: selectedModel || requestedModelFromFailure("") || ""
    },
    generatedAt: new Date().toISOString(),
    files: changedFiles,
    inputConsumption,
    productShapeValidation,
    fileOperations: changedSourceFiles.map((filePath, index) => ({
      action: before.has(filePath) ? "modify" : "add",
      path: changedFiles[index],
      reason: "Changed by current Gotham CLI workflow."
    })),
    codex: {
      command: codexBin,
      durationMs,
      outputTail: outputText.slice(-4000)
    },
    tokenUsage
  };
}

export async function runCodexReviewWorkflow(orchestratedRequest, executionResult, options = {}) {
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  const generatedSiteDir = options.generatedSiteDir || process.env.GENERATED_SITE_DIR || path.resolve(process.cwd(), "../generated-site");
  const codexBin = process.env.CODEX_BIN || "codex";
  const timeoutMs = Number(options.timeoutMs ?? process.env.CODEX_REVIEW_TIMEOUT_MS ?? 5 * 60 * 1000);
  const reviewId = `review_${nanoid(10)}`;
  const envelope = orchestratedRequest.orchestrationEnvelope || {};
  const productDecision = orchestratedRequest.productDecision || envelope.plan?.productDecision || null;
  const promptText = `You are an independent read-only reviewer for an PlutoniX workflow.

PlutoniX remains the completion authority. Inspect the current workspace and evaluate only the implementation produced for this task.

Task:
${orchestratedRequest.sourceInstruction || orchestratedRequest.objective || ""}

Changed files:
${JSON.stringify(executionResult.files || [], null, 2)}

Validation criteria:
${JSON.stringify(envelope.validationCriteria || [], null, 2)}

Binding Product Shape Contract:
${productDecision ? JSON.stringify(productDecision, null, 2) : "Existing-product change: preserve the established product shape."}

Rules:
- Do not modify, create, delete, or format any file.
- Verify relevant implementation evidence in the workspace.
- Reject a wrong artifact type, wrong product shape, unjustified application depth, underbuilt required workflows, or overbuilt roles/routes/modules.
- Reject generic hero, dashboard, metric, card-grid, form-field, or route patterns when they are not justified by the primary user job and interaction model.
- Reject invented business, profile, financial, product, testimonial, analytics, or metric data unless explicit demo/sample mode was requested.
- Verify that supplied data and media were consumed or retained as unresolved inputs; do not accept silent deletion or false claims of use.
- If screenshots, product images, Figma frames, UI references, or named-app visual references were supplied, verify that prominent visible UI nodes were mapped to behavior in a ui_node_to_functionality record or equivalent documentation.
- Reject screenshot-derived implementations that only look similar while prominent controls, tables, filters, nav items, editors, command bars, or panels remain decorative without implemented behavior, state transitions, data contracts, or explicit unavailable-integration fallbacks.
- Reject visible copy that explains the product's own features, layout, or usage unless the user explicitly requested it.
- Reject missing requested behavior, unrelated destructive changes, unsafe credential handling, or clearly invalid code.
- Do not reject merely for optional polish.
- End with exactly two markers on separate lines:
  PLUTONIX_QUALITY: shape_fit=PASS; depth_fit=PASS; data_fidelity=PASS; input_consumption=PASS; ui_reference_functionality=PASS; no_explainer_copy=PASS; generic_template_check=PASS
  PLUTONIX_REVIEW: PASS
- If any quality dimension fails, mark that dimension FAIL and end with PLUTONIX_REVIEW: FAIL: <concise reason>.`;

  const before = await collectFileHashes(generatedSiteDir);
  const output = [];
  const errors = [];
  const startedAt = Date.now();
  emit("review-start", `Starting independent review ${reviewId}`, {
    parentWorkflowId: envelope.parentWorkflowId,
    reviewId,
    reviewerAgentId: options.reviewerAgentId || "plutonix-independent-reviewer"
  });

  await new Promise((resolve, reject) => {
    const child = spawn(codexBin, [
      "exec", "--json", "--cd", generatedSiteDir, "--skip-git-repo-check", "--ephemeral",
      "--sandbox", "read-only", promptText
    ], {
      cwd: generatedSiteDir,
      env: codexProcessEnvironment(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let timer;
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Independent review produced no output for ${Math.round(timeoutMs / 1000)} seconds and was stopped.`));
      }, timeoutMs);
    };
    resetTimer();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { resetTimer(); output.push(chunk); });
    child.stderr.on("data", (chunk) => { resetTimer(); errors.push(chunk); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Independent review exited with code ${code}: ${errors.join("").slice(-2000)}`));
    });
  });

  const after = await collectFileHashes(generatedSiteDir);
  const reviewerChanges = diffHashes(before, after);
  if (reviewerChanges.length) {
    throw new Error(`Independent reviewer violated read-only mode and changed: ${reviewerChanges.slice(0, 8).join(", ")}`);
  }
  const outputText = output.join("");
  const failed = outputText.match(/PLUTONIX_REVIEW:\s*FAIL:\s*([^\n"}]*)/i);
  const passed = /PLUTONIX_REVIEW:\s*PASS/i.test(outputText);
  const quality = outputText.match(
    /PLUTONIX_QUALITY:\s*shape_fit=(PASS|FAIL);\s*depth_fit=(PASS|FAIL);\s*data_fidelity=(PASS|FAIL);\s*input_consumption=(PASS|FAIL);\s*ui_reference_functionality=(PASS|FAIL);\s*no_explainer_copy=(PASS|FAIL);\s*generic_template_check=(PASS|FAIL)/i
  );
  if (failed) throw new Error(`Independent review failed: ${failed[1].trim() || "acceptance criteria were not met"}`);
  if (!quality) throw new Error("Independent review did not return the required Product Shape quality verdicts.");
  if (quality.slice(1).some((verdict) => verdict.toUpperCase() !== "PASS")) {
    throw new Error("Independent review failed one or more Product Shape quality gates.");
  }
  if (!passed) throw new Error("Independent review did not return the required PASS/FAIL marker.");

  const durationMs = Date.now() - startedAt;
  const tokenUsage = await recordAgentTokenUsage({
    agentId: options.reviewerAgentId || "plutonix-independent-reviewer",
    agentName: "PlutoniX Independent Reviewer",
    projectId: orchestratedRequest.project?.id || options.projectId || "",
    projectName: orchestratedRequest.project?.name || options.projectName || "",
    workflowId: envelope.parentWorkflowId || reviewId,
    buildId: reviewId,
    instructionSummary: orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "",
    taskType: options.taskType || "",
    inputTokens: estimateTokens(promptText),
    outputTokens: estimateTokens(outputText),
    durationMs,
    changedFiles: 0,
    validationStatus: "passed"
  });
  emit("review-complete", `Independent review ${reviewId} passed`, {
    parentWorkflowId: envelope.parentWorkflowId,
    reviewId,
    status: "passed",
    tokenUsage
  });
  return { reviewId, status: "passed", durationMs, tokenUsage };
}

function repairModelCommands() {
  const configuredBin = process.env.PLUTONIX_REPAIR_BIN || "";
  const configuredKind = process.env.PLUTONIX_REPAIR_MODEL || "";
  const candidates = [];
  if (configuredBin) candidates.push({ kind: configuredKind || "custom", bin: configuredBin });
  candidates.push({ kind: "codex", bin: process.env.CODEX_BIN || "codex" });
  if (process.env.CLAUDE_BIN) candidates.push({ kind: "claude", bin: process.env.CLAUDE_BIN });
  candidates.push({ kind: "claude", bin: "claude" });
  return candidates.filter((candidate, index, rows) =>
    candidate.bin && rows.findIndex((row) => row.kind === candidate.kind && row.bin === candidate.bin) === index
  );
}

function repairArgsFor(candidate, promptText, generatedSiteDir) {
  if (candidate.kind === "claude" || /(^|\/)claude(?:$|\.cmd$)/i.test(candidate.bin)) {
    return [
      "-p",
      promptText,
      "--permission-mode",
      "acceptEdits"
    ];
  }
  if (candidate.kind === "custom" && process.env.PLUTONIX_REPAIR_ARGS) {
    return process.env.PLUTONIX_REPAIR_ARGS
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part === "{prompt}" ? promptText : part === "{cwd}" ? generatedSiteDir : part);
  }
  return [
    "exec",
    "--json",
    "--cd",
    generatedSiteDir,
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "workspace-write",
    promptText
  ];
}

function repairPrompt(orchestratedRequest, failure, options = {}) {
  const originalInstruction = orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "";
  const changedFiles = Array.isArray(options.changedFiles) ? options.changedFiles : [];
  const failureMessage = String(failure?.message || failure || "");
  const intelProfile = options.intelProfile || null;
  return `You are the automatic recovery model for PlutoniX.

PlutoniX already ran Gotham/Codex for this project, but execution or preview validation failed. Your job is to fix the project in-place so the app can install, start, and preview successfully.

Original user instruction:
${originalInstruction}

Project:
${JSON.stringify({
  projectId: options.projectId || orchestratedRequest.project?.id || "",
  projectName: options.projectName || orchestratedRequest.project?.name || "",
  taskType: options.taskType || orchestratedRequest.taskType || "",
  workspaceDir: options.generatedSiteDir || "",
  changedFiles
}, null, 2)}

Failure/error to repair:
${failureMessage}

${intelProfile ? `Intel repair contract:
- Selected profile: ${intelProfile.displayName || intelProfile.id} (${intelProfile.id}).
- Repair only the specific independent-verification failure above and preserve the original artifact type.
- Do not substitute a browser UI for an API, document/PDF, or spreadsheet artifact.
- Keep changes inside the selected project workspace and produce profile-appropriate validation evidence.
- Do not add unrelated features, generic filler, or a second implementation track.` : ""}

Runtime/log context:
${String(options.runtimeLogTail || "").slice(-4000) || "No additional runtime log tail was provided."}

Rules:
- Inspect the local workspace before editing.
- Fix the root cause of the failure with the smallest complete change.
- You MAY edit package.json, package-lock.json, run-vite.mjs, Dockerfile, vite config, generated React/CSS files, or other project-local runtime files when needed to fix install/start/preview errors.
- Pin unstable dependencies or add overrides when dependency resolution caused the failure.
- Do not remove unrelated app features or rewrite the design unless the failure requires it.
- Do not start long-running dev servers. Short validation/build commands are allowed only if they terminate.
- Keep secrets out of files.
- End with a concise summary of changed files and why the failure should be fixed.`;
}

export async function runModelRepairWorkflow(orchestratedRequest, failure, options = {}) {
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  const generatedSiteDir = options.generatedSiteDir || process.env.GENERATED_SITE_DIR || path.resolve(process.cwd(), "../generated-site");
  const timeoutMs = Number(options.timeoutMs ?? process.env.PLUTONIX_REPAIR_TIMEOUT_MS ?? 8 * 60 * 1000);
  const repairId = `repair_${nanoid(10)}`;
  const promptText = repairPrompt(orchestratedRequest, failure, { ...options, generatedSiteDir });
  const before = await collectFileHashes(generatedSiteDir);
  const candidates = repairModelCommands();
  const errors = [];
  const startedAt = Date.now();

  emit("plutonix-repair-start", "Sending Gotham failure back to an available AI model for automatic repair", {
    stage: "repair",
    repairId,
    parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || "",
    projectId: options.projectId || "",
    projectName: options.projectName || ""
  });

  for (const candidate of candidates) {
    const output = [];
    const stderr = [];
    const args = repairArgsFor(candidate, promptText, generatedSiteDir);
    emit("plutonix-repair-model-selected", `Trying ${candidate.kind} repair model`, {
      stage: "repair",
      repairId,
      modelKind: candidate.kind,
      modelBin: candidate.bin
    });
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(candidate.bin, args, {
          cwd: generatedSiteDir,
          env: { ...process.env, CI: "1", NO_COLOR: "1" },
          stdio: ["ignore", "pipe", "pipe"]
        });
        let timer;
        let settled = false;
        const rejectOnce = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        };
        const resolveOnce = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        const resetTimer = () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            child.kill("SIGTERM");
            rejectOnce(new Error(`Repair model produced no output for ${Math.round(timeoutMs / 1000)} seconds and was stopped.`));
          }, timeoutMs);
        };
        resetTimer();
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          resetTimer();
          output.push(chunk);
          for (const line of chunk.split(/\r?\n/)) emitCodexLine(line, emit, repairId, "plutonix-auto-repair-agent");
        });
        child.stderr.on("data", (chunk) => {
          resetTimer();
          stderr.push(chunk);
          for (const line of chunk.split(/\r?\n/)) emitCodexLine(line, emit, repairId, "plutonix-auto-repair-agent");
        });
        child.on("error", rejectOnce);
        child.on("close", (code) => {
          code === 0 ? resolveOnce() : rejectOnce(new Error(`${candidate.kind} repair exited with code ${code}: ${stderr.join("").slice(-2000)}`));
        });
      });

      const after = await collectFileHashes(generatedSiteDir);
      const changedFiles = diffHashes(before, after);
      if (!changedFiles.length) throw new Error(`${candidate.kind} repair completed but did not change any files.`);
      const durationMs = Date.now() - startedAt;
      const outputText = output.join("");
      const tokenUsage = await recordAgentTokenUsage({
        agentId: "plutonix-auto-repair-agent",
        agentName: "PlutoniX Auto Repair Agent",
        projectId: options.projectId || orchestratedRequest.project?.id || "",
        projectName: options.projectName || orchestratedRequest.project?.name || "",
        workflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || repairId,
        buildId: repairId,
        instructionSummary: orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "",
        taskType: options.taskType || orchestratedRequest.taskType || "",
        inputTokens: estimateTokens(promptText),
        outputTokens: estimateTokens(outputText),
        durationMs,
        changedFiles: changedFiles.length
      });
      const normalizedFiles = changedFiles.map((filePath) => filePath.split(path.sep).join("/"));
      emit("plutonix-repair-complete", `Automatic repair changed ${normalizedFiles.length} files`, {
        stage: "repair",
        repairId,
        modelKind: candidate.kind,
        changedFiles: normalizedFiles,
        tokenUsage
      });
      return {
        repairId,
        status: "repaired",
        modelKind: candidate.kind,
        modelBin: candidate.bin,
        durationMs,
        files: normalizedFiles,
        fileOperations: normalizedFiles.map((filePath) => ({
          action: before.has(filePath) ? "modify" : "add",
          path: filePath,
          reason: "Changed by automatic PlutoniX repair after Gotham failure."
        })),
        tokenUsage
      };
    } catch (error) {
      errors.push(`${candidate.kind}:${candidate.bin}: ${error.message}`);
      emit("plutonix-repair-model-failed", `${candidate.kind} repair failed: ${error.message}`, {
        stage: "repair",
        repairId,
        modelKind: candidate.kind,
        modelBin: candidate.bin
      });
      if (!/ENOENT|not found|spawn .*ENOENT/i.test(error.message)) break;
    }
  }

  throw new Error(`Automatic repair failed. ${errors.join(" | ")}`);
}
