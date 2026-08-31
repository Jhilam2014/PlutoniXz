import crypto from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { nanoid } from "nanoid";
import { estimateTokens, recordAgentTokenUsage, resolveWorkflowTokenUsage } from "./tokenEconomy.js";
import { productShapePrompt, validateProductShapeOutputs } from "./productShape.js";
import { redactOperational } from "./operationalSecurity.js";
import { compileGothamContext } from "./gothamContextCompiler.js";
import { readCanonicalWorkflowDecisions } from "./workflowDecisionContinuity.js";
import {
  CODEX_RUNTIME_FAILURES,
  CodexRuntimeError,
  executeCodex,
  probeCodexAuthentication,
  probeCodexVersion,
  redactCodexText
} from "./codexRuntime.js";

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

function codexProcessEnvironment(baseEnv = process.env) {
  const nodeDirectory = path.dirname(process.execPath || "");
  const pathEntries = String(baseEnv.PATH || "").split(path.delimiter).filter(Boolean);
  if (nodeDirectory && !pathEntries.includes(nodeDirectory)) pathEntries.unshift(nodeDirectory);
  return {
    ...baseEnv,
    PATH: pathEntries.join(path.delimiter),
    CI: "1",
    NO_COLOR: "1"
  };
}

export function gothamSandboxFeatureArgs(env = process.env) {
  // Legacy Landlock cannot satisfy every provider permission profile. Keep it
  // opt-in only; the default preflight must prove the normal workspace-write
  // sandbox rather than silently selecting a weaker compatibility backend.
  const args = [];
  // Keep the classic shell tool as the managed-container default. Operators can
  // opt into unified_exec after the same mounted-workspace preflight succeeds.
  if (env.GOTHAM_UNIFIED_EXEC_ENABLED !== "true") args.push("--disable", "unified_exec");
  if (env.GOTHAM_USE_LEGACY_LANDLOCK_FALLBACK === "true") args.push("--enable", "use_legacy_landlock");
  return args;
}

export const GOTHAM_FAILURE_CLASSES = Object.freeze({
  MISSING_CLI: CODEX_RUNTIME_FAILURES.MISSING_CLI,
  AUTHENTICATION_REQUIRED: CODEX_RUNTIME_FAILURES.AUTHENTICATION_REQUIRED,
  MODELS_CACHE_INCOMPATIBLE: "models_cache_incompatible",
  CODEX_CLI_MODEL_INCOMPATIBLE: "codex_cli_model_incompatible",
  WORKSPACE_CWD_MISSING: "workspace_cwd_missing",
  SANDBOX_RUNTIME_UNAVAILABLE: "sandbox_runtime_unavailable",
  WORKSPACE_SANDBOX_UNAVAILABLE: "sandbox_runtime_unavailable",
  CONTAINER_OR_VOLUME_UNAVAILABLE: "container_or_volume_unavailable",
  PROVIDER_TRANSIENT_FAILURE: "provider_transient_failure",
  WORKFLOW_TIMEOUT: "workflow_timeout",
  MALFORMED_EVENTS: CODEX_RUNTIME_FAILURES.MALFORMED_EVENTS,
  NON_ZERO_EXIT: CODEX_RUNTIME_FAILURES.NON_ZERO_EXIT,
  WORKSPACE_INVALID: CODEX_RUNTIME_FAILURES.WORKSPACE_INVALID,
  CONCURRENT_EXECUTION: CODEX_RUNTIME_FAILURES.CONCURRENT_EXECUTION,
  SERVER_SHUTDOWN: CODEX_RUNTIME_FAILURES.SHUTDOWN,
  PROJECT_IMPLEMENTATION_FAILURE: "project_implementation_failure",
  PROJECT_VALIDATION_FAILURE: "project_validation_failure",
  USER_CANCELLED: "user_cancelled"
});

function sandboxFailureReason(value) {
  const text = String(value?.message || value || "").toLowerCase();
  if (/apparmor/.test(text)) return "apparmor_denied";
  if (/seccomp/.test(text)) return "seccomp_denied";
  if (/unshare|new namespace|user namespace/.test(text)) return "user_namespace_denied";
  if (/(?:codex-linux-sandbox|arg0).*(?:enoent|no such file|stale)/.test(text)) return "codex_arg0_helper_missing";
  if (/bwrap|bubblewrap/.test(text)) return "bubblewrap_initialization_failed";
  return "workspace_sandbox_initialization_failed";
}

// Keep this deliberately scoped: a generic "permission denied" can be a
// project error. Only known sandbox/runtime diagnoses become infrastructure
// failures and therefore bypass automatic project-code repair.
export function isGothamWorkspaceSandboxUnavailable(value) {
  if (value?.workflowFailureClass === GOTHAM_FAILURE_CLASSES.WORKSPACE_SANDBOX_UNAVAILABLE ||
      value?.failureClass === GOTHAM_FAILURE_CLASSES.WORKSPACE_SANDBOX_UNAVAILABLE ||
      value?.code === GOTHAM_FAILURE_CLASSES.WORKSPACE_SANDBOX_UNAVAILABLE ||
      value?.workflowFailureClass === "workspace_sandbox_unavailable" ||
      value?.failureClass === "workspace_sandbox_unavailable") return true;
  const text = String(value?.message || value || "").toLowerCase();
  return (
    (/(?:bwrap|bubblewrap)/.test(text) && /(?:namespace|sandbox|operation not permitted|permission denied|denied)/.test(text)) ||
    /(?:creating|create) (?:a )?new namespace.*(?:operation not permitted|permission denied|denied)/.test(text) ||
    /unshare.*(?:failed|operation not permitted|permission denied|denied)/.test(text) ||
    /apparmor.*(?:denied|namespace|sandbox)/.test(text) ||
    /seccomp.*(?:denied|required syscall|sandbox)/.test(text) ||
    /permission profiles?.*direct runtime enforcement.*(?:incompatible with|legacy[- ]landlock)/.test(text) ||
    /legacy[- ]landlock.*(?:incompatible|direct runtime enforcement)/.test(text) ||
    /sandbox (?:could not|cannot|can.t|failed to) (?:initialize|start|create)/.test(text) ||
    /workspace (?:security policy|sandbox).*(?:prevented|denied|unavailable)/.test(text) ||
    /unable to spawn .*codex-linux-sandbox.*(?:doesn.t exist|enoent|no such file)/.test(text) ||
    /(?:bwrap:\s*)?execvp .*codex-linux-sandbox.*(?:enoent|no such file)/.test(text) ||
    /failed to create unified exec process.*(?:enoent|no such file|read-only file system)/.test(text) ||
    /(?:codex_core::exec|codex_core::tools::router).*(?:exec(?:ution)? error|error=execution error).*(?:enoent|no such file|kind:\s*notfound)/s.test(text) ||
    /failed to write file \/tmp\/(?:codex|gotham)-(?:recovery-probe|sandbox-check)(?:\.txt)?/.test(text)
  );
}

export function createGothamWorkspaceSandboxUnavailableError(preflight = {}) {
  const diagnostic = redactedProcessOutputTail(preflight.diagnostic || preflight.error || "");
  const failureClass = preflight.failureClass || GOTHAM_FAILURE_CLASSES.SANDBOX_RUNTIME_UNAVAILABLE;
  const subject = failureClass === GOTHAM_FAILURE_CLASSES.WORKSPACE_CWD_MISSING
    ? "Project workspace unavailable"
    : "Sandbox unavailable";
  const error = new Error(
    `${subject}; Gotham did not start provider execution.${diagnostic ? ` Diagnostic: ${diagnostic}` : ""}`
  );
  error.name = "GothamWorkspaceSandboxUnavailableError";
  error.code = failureClass;
  error.workflowFailureClass = failureClass;
  error.failureClass = failureClass;
  error.sandboxPreflight = preflight;
  return error;
}

// This calls the same Codex sandbox implementation used for execution rather
// than merely checking whether Bubblewrap is installed. When a workspace is
// supplied, it also proves the workspace-write boundary with a temporary marker
// that is removed before the probe returns. It never calls a model.
export async function probeCodexWorkspaceSandbox(
  codexBin = process.env.CODEX_BIN || "codex",
  timeoutMs = Number(process.env.GOTHAM_SANDBOX_PREFLIGHT_TIMEOUT_MS || 8000),
  { workspaceDir = "", env = process.env } = {}
) {
  let resolvedWorkspace = "";
  if (workspaceDir) {
    try {
      resolvedWorkspace = await fs.realpath(workspaceDir);
      const stat = await fs.stat(resolvedWorkspace);
      if (!stat.isDirectory()) throw new Error("The configured project workspace is not a directory.");
      await fs.access(resolvedWorkspace, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
      return {
        status: "unavailable",
        component: "project_workspace",
        failureClass: GOTHAM_FAILURE_CLASSES.WORKSPACE_CWD_MISSING,
        reason: "workspace_cwd_missing",
        diagnostic: redactOperational(error.message || String(error)),
        remediation: "Restore the selected project workspace mount, then retry the original instruction."
      };
    }
  }
  const markerName = `.plutonix-sandbox-preflight-${process.pid}-${nanoid(8)}`;
  const sandboxCommand = resolvedWorkspace
    ? [
        ...gothamSandboxFeatureArgs(env),
        "sandbox",
        "-c",
        'sandbox_mode="workspace-write"',
        "/bin/sh",
        "-lc",
        'set -eu; marker="$1"; expected="$2"; trap \'rm -f -- "$marker"\' EXIT; test "$PWD" = "$expected"; test -r .; : > "$marker"; test -w "$marker"',
        "gotham-workspace-preflight",
        markerName,
        resolvedWorkspace
      ]
    : [...gothamSandboxFeatureArgs(env), "sandbox", "/bin/true"];
  return new Promise((resolve) => {
    const output = [];
    const errors = [];
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child;
    try {
      child = spawn(codexBin, sandboxCommand, {
        cwd: resolvedWorkspace || undefined,
        env: codexProcessEnvironment(env),
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      finish({
        status: "unavailable",
        component: "workspace_sandbox",
        failureClass: GOTHAM_FAILURE_CLASSES.WORKSPACE_SANDBOX_UNAVAILABLE,
        reason: "sandbox_probe_start_failed",
        diagnostic: redactOperational(error.message || String(error)),
        remediation: resolvedWorkspace
          ? "Verify the selected workspace mount and the Codex secure sandbox runtime."
          : "Verify the Codex installation and the secure sandbox runtime."
      });
      return;
    }
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        status: "unavailable",
        component: "workspace_sandbox",
        failureClass: GOTHAM_FAILURE_CLASSES.WORKSPACE_SANDBOX_UNAVAILABLE,
        reason: "sandbox_probe_timed_out",
        diagnostic: `Codex workspace sandbox probe exceeded ${Math.round(timeoutMs / 1000)} seconds.`,
        remediation: "Verify the Codex sandbox runtime and host resource policy."
      });
    }, Math.max(1000, timeoutMs));
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => output.push(chunk));
    child.stderr?.on("data", (chunk) => errors.push(chunk));
    child.on("error", (error) => finish({
      status: "unavailable",
      component: "workspace_sandbox",
      failureClass: GOTHAM_FAILURE_CLASSES.WORKSPACE_SANDBOX_UNAVAILABLE,
      reason: "sandbox_probe_start_failed",
      diagnostic: redactOperational(error.message || String(error)),
      remediation: resolvedWorkspace
        ? "Verify the selected workspace mount and the Codex secure sandbox runtime."
        : "Verify the Codex installation and the secure sandbox runtime."
    }));
    child.on("close", (code) => {
      if (code === 0) {
        finish({
          status: "ready",
          component: "workspace_sandbox",
          failureClass: "",
          reason: "",
          diagnostic: "",
          remediation: "",
          workspace: resolvedWorkspace || ""
        });
        return;
      }
      const diagnostic = redactedProcessOutputTail([...errors, ...output]);
      finish({
        status: "unavailable",
        component: "workspace_sandbox",
        failureClass: GOTHAM_FAILURE_CLASSES.WORKSPACE_SANDBOX_UNAVAILABLE,
        reason: sandboxFailureReason(diagnostic),
        diagnostic,
        remediation: "Verify host user namespaces, the approved AppArmor profile, and Docker seccomp policy. Gotham will not run unsandboxed."
      });
    });
  });
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

function redactedProcessOutputTail(chunks, maxLength = 1200) {
  const text = (Array.isArray(chunks) ? chunks : [chunks]).join("").slice(-maxLength);
  return redactOperational(text).replace(/\s+/g, " ").trim();
}

function childProcessFailureMessage(label, code, stderr, stdout) {
  const stderrTail = redactedProcessOutputTail(stderr);
  const stdoutTail = redactedProcessOutputTail(stdout);
  const details = [
    stderrTail ? `stderr: ${stderrTail}` : "",
    stdoutTail ? `stdout: ${stdoutTail}` : ""
  ].filter(Boolean);
  return `${label} exited with code ${code}${details.length ? `: ${details.join(" | ")}` : "."}`;
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

export function deterministicPublicationOwnershipPrompt() {
  return [
    "Deterministic control-plane publication ownership:",
    "- Do not create or update PlutoniX control-plane Neo4j, D3 topology, global agent-registry, vector-memory, prompt-ledger, workflow-memory, what-next, or observability publication artifacts during this model execution.",
    "- Implement the requested project change and return implementation, changed-file, input-consumption, and validation evidence only.",
    "- PlutoniX's deterministic backend publisher owns mandatory graph and memory projections after model execution.",
    "- Do not report graph or memory publication as completed unless runtime context explicitly contains completed publication evidence.",
    "- This boundary does not prohibit application-owned graph or memory functionality explicitly required by the user's project task."
  ].join("\n");
}

export function codexPrompt(instruction, orchestratedRequest, hasProjectOrchestrator) {
  const compiledContext = orchestratedRequest.compiledGothamContext;
  if (compiledContext) {
    return `You are the bounded implementation executor for a PlutoniX-managed Gotham workflow.

PlutoniX has already selected the route, policy packs, agents, path, and branch dispositions. Do not scan policy directories, the full AGENTS.md operating manual, unrelated agents, graph projections, memory ledgers, or historical logs.

Current instruction:
${instruction}

Compiled mandatory policy:
${compiledContext.compiledPolicy}

Fresh dynamic execution context:
${JSON.stringify(compiledContext.dynamicContext, null, 2)}

Execution contract:
- PlutoniX Fullstack Agent is the global planning and completion authority; this executor may not redefine the parent task or approve completion.
- Preserve every unrelated existing feature and user-owned instruction.
- If the current instruction begins with "Task type:", treat the embedded task value as the active user instruction and the surrounding fields as backend-owned execution metadata.
- Treat the compiled policy and fresh decision snapshot as binding under the current user instruction.
- Inspect only the smallest relevant project files and direct dependencies.
- Apply the narrowest complete change and preserve unrelated behavior and user-owned instructions.
- Validate proportionally to the resolved task type and risk.
- Return implementation evidence only: changed files, input consumption, validation performed, unresolved risk, and any partial-change evidence.
- Do not claim provider usage, review, recovery, graph publication, memory publication, or workflow completion; PlutoniX derives those facts from runtime evidence.

${deterministicPublicationOwnershipPrompt()}`;
  }
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
        "- A Hugging Face candidate was mentioned, but this governed rollout does not permit model downloads, model-card fetches, artifact staging, or local/remote Hugging Face inference from a build prompt.",
        "- Do not create model manifests, download scripts, model-pool services, GPU configuration, or Hugging Face credentials. Treat any candidate as pending a separately approved immutable BrainX registration, licence/provenance/artifact review, hardware verification, and human approval.",
        "- Continue the requested application work without making model acquisition or provider execution a side effect."
      ].join("\n")
    : "";
  const governedKnowledge = Array.isArray(orchestratedRequest.agenticXKnowledge?.knowledge)
    ? orchestratedRequest.agenticXKnowledge.knowledge.slice(0, 10)
    : [];
  const agenticXKnowledgeRequirement = governedKnowledge.length
    ? [
        "- The following are pre-sanitized, tenant-scoped AgenticX summaries. Use them only for the stated application-development purpose; do not try to recover raw source material, secrets, attachments, or cross-tenant context.",
        ...governedKnowledge.map((item) => `  - ${String(item.summary || "").slice(0, 400)}`),
        "- These summaries are advisory context, not approval to change policy, deploy, access data, or promote a decision."
      ].join("\n")
    : "";
  const sharingContext = orchestratedRequest.informationSharingContext || null;
  const authorizedSharingPolicies = Array.isArray(sharingContext?.activePolicies) ? sharingContext.activePolicies.slice(0, 20) : [];
  const informationSharingRequirement = sharingContext
    ? [
        "- Enterprise information sharing is deny-by-default. Do not access, infer, copy, or expose another application's account, client, or application context unless it appears in an active policy below for the application-development purpose.",
        ...(authorizedSharingPolicies.length
          ? authorizedSharingPolicies.map((policy) => [
              `  - Agreement ${String(policy.id || "recorded").slice(0, 160)} · ${policy.direction} · ${String(policy.scope?.level || "application").slice(0, 40)} scope · ${String(policy.information?.classification || "internal").slice(0, 40)}: ${String(policy.information?.summary || "").slice(0, 600)}`,
              ...(policy.information?.dataCategories || []).slice(0, 20).map((category) => `    Data category: ${String(category).slice(0, 240)}`),
              ...(policy.information?.governanceRules || []).slice(0, 20).map((rule) => `    Governance: ${String(rule).slice(0, 500)}`),
              ...(policy.information?.privacyPolicies || []).slice(0, 20).map((rule) => `    Privacy: ${String(rule).slice(0, 500)}`),
              ...(policy.information?.enterpriseConstraints || []).slice(0, 20).map((constraint) => `    Enterprise constraint: ${String(constraint).slice(0, 500)}`)
            ].join("\n"))
          : ["  - No active application-development sharing policy is available for this application; keep all cross-application information unavailable."]),
        "- Treat these policies as binding design and implementation constraints for BrainX/Gotham decisions. They do not authorize deployment, credential access, policy mutation, or broader reuse.",
        "- When an approach conflicts with an enterprise constraint, keep the approach deferred and cite the agreement and constraint in generated decision metadata; do not silently discard or activate it."
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
        agenticXKnowledgeRequirement,
        informationSharingRequirement,
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
        agenticXKnowledgeRequirement,
        informationSharingRequirement,
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
${requirements}

${deterministicPublicationOwnershipPrompt()}`;
}

export function copilotCliArgsForPrompt(promptText, { allowTools = ["shell(git)", "shell(node)"], binary = "copilot" } = {}) {
  const prompt = String(promptText);
  if (binary === "gh" || /(^|\s)gh(?:\s+copilot)?$/i.test(String(binary))) {
    return [
      "copilot",
      "-p",
      prompt,
      ...allowTools.flatMap((tool) => ["--allow-tool", tool])
    ];
  }
  return [
    "-p",
    prompt,
    "--model",
    "auto",
    "--allow-all-tools"
  ];
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
    emit("codex-progress", String(message), {
      stage: "5/8",
      buildId,
      agentId,
      codexEventType: eventType
    });
  } catch {
    emit("codex-progress", trimmed, {
      stage: "5/8",
      buildId,
      agentId
    });
  }
}

export function isRecoverableGothamModelsCacheError(value) {
  const line = String(value?.message || value || "");
  return (
    /(?:codex|gotham)_models_manager::(?:manager|cache)/i.test(line) &&
    /missing field `[^`]+`/i.test(line) &&
    /failed to (?:renew cache TTL|load models cache)/i.test(line)
  );
}

export function isGothamCodexModelCompatibilityError(value) {
  const line = String(value?.message || value || "");
  return /model requires a newer version of (?:Codex|Gotham)|model metadata for .+ not found/i.test(line);
}

export function classifyGothamWorkflowFailure(value, { workspaceDir = "" } = {}) {
  const explicit = value?.workflowFailureClass || value?.failureClass;
  if (explicit && Object.values(GOTHAM_FAILURE_CLASSES).includes(explicit)) return explicit;
  const message = String(value?.message || value || "");
  const lower = message.toLowerCase();
  if (/stopped by the user|user cancelled|user canceled|aborterror/.test(lower)) return GOTHAM_FAILURE_CLASSES.USER_CANCELLED;
  if (isRecoverableGothamModelsCacheError(value)) return GOTHAM_FAILURE_CLASSES.MODELS_CACHE_INCOMPATIBLE;
  if (isGothamCodexModelCompatibilityError(value)) return GOTHAM_FAILURE_CLASSES.CODEX_CLI_MODEL_INCOMPATIBLE;
  if (isGothamWorkspaceSandboxUnavailable(value)) return GOTHAM_FAILURE_CLASSES.SANDBOX_RUNTIME_UNAVAILABLE;
  const workspaceMissing = Boolean(workspaceDir) && !fs.existsSync(workspaceDir);
  if ((value?.code === "ENOENT" && workspaceMissing) ||
      /(?:configured |execution )?(?:cwd|working directory|workspace).*(?:does not exist|missing|unavailable|enoent|no such file)/.test(lower) ||
      /workspace mount (?:disappeared|is unavailable|missing)/.test(lower)) return GOTHAM_FAILURE_CLASSES.WORKSPACE_CWD_MISSING;
  if (/container|volume|mount/.test(lower) && /(?:not found|unavailable|disconnected|enoent|no such file)/.test(lower)) {
    return GOTHAM_FAILURE_CLASSES.CONTAINER_OR_VOLUME_UNAVAILABLE;
  }
  if (/produced no output|timed out|timeout|inactivity/.test(lower)) return GOTHAM_FAILURE_CLASSES.WORKFLOW_TIMEOUT;
  if (/econnreset|econnrefused|eai_again|429|502|503|504|temporar(?:y|ily) unavailable|provider.*(?:overloaded|unavailable)/.test(lower)) {
    return GOTHAM_FAILURE_CLASSES.PROVIDER_TRANSIENT_FAILURE;
  }
  if (/validation failed|review failed|completion check|preview.*failed|build failed|test(?:s)? failed/.test(lower)) {
    return GOTHAM_FAILURE_CLASSES.PROJECT_VALIDATION_FAILURE;
  }
  return GOTHAM_FAILURE_CLASSES.PROJECT_IMPLEMENTATION_FAILURE;
}

export function isGothamInfrastructureFailure(value) {
  return [
    GOTHAM_FAILURE_CLASSES.MISSING_CLI,
    GOTHAM_FAILURE_CLASSES.AUTHENTICATION_REQUIRED,
    GOTHAM_FAILURE_CLASSES.MODELS_CACHE_INCOMPATIBLE,
    GOTHAM_FAILURE_CLASSES.CODEX_CLI_MODEL_INCOMPATIBLE,
    GOTHAM_FAILURE_CLASSES.WORKSPACE_CWD_MISSING,
    GOTHAM_FAILURE_CLASSES.SANDBOX_RUNTIME_UNAVAILABLE,
    GOTHAM_FAILURE_CLASSES.CONTAINER_OR_VOLUME_UNAVAILABLE,
    GOTHAM_FAILURE_CLASSES.PROVIDER_TRANSIENT_FAILURE,
    GOTHAM_FAILURE_CLASSES.WORKFLOW_TIMEOUT,
    GOTHAM_FAILURE_CLASSES.MALFORMED_EVENTS,
    GOTHAM_FAILURE_CLASSES.NON_ZERO_EXIT,
    GOTHAM_FAILURE_CLASSES.WORKSPACE_INVALID,
    GOTHAM_FAILURE_CLASSES.CONCURRENT_EXECUTION,
    GOTHAM_FAILURE_CLASSES.SERVER_SHUTDOWN
  ].includes(typeof value === "string" ? value : classifyGothamWorkflowFailure(value));
}

export function isProjectRepairEligible(value) {
  return [
    GOTHAM_FAILURE_CLASSES.PROJECT_IMPLEMENTATION_FAILURE,
    GOTHAM_FAILURE_CLASSES.PROJECT_VALIDATION_FAILURE
  ].includes(typeof value === "string" ? value : classifyGothamWorkflowFailure(value));
}

function requestedModelFromFailure(value) {
  const message = String(value?.message || value || "");
  return message.match(/The ['\"]([^'\"]+)['\"] model requires a newer version of (?:Codex|Gotham)/i)?.[1] || "";
}

export async function probeCodexCli(codexBin, timeoutMs = 8000, env = process.env) {
  return probeCodexVersion(codexBin, { timeoutMs, env });
}

export async function probeCopilotCli(timeoutMs = 8000) {
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
    const candidates = [
      { command: "copilot", args: ["--help"] },
      { command: "gh", args: ["copilot", "--help"] },
      { command: "github-copilot", args: ["--help"] }
    ].filter(({ command }) => command);
    const tryNext = (index) => {
      const candidate = candidates[index];
      if (!candidate) {
        finish({ available: false, status: "unavailable", version: "", command: "", error: "No Copilot CLI command available on PATH." });
        return;
      }
      let child;
      try {
        child = spawn(candidate.command, candidate.args, {
          env: codexProcessEnvironment(),
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (error) {
        finish({ available: false, status: "unavailable", version: "", command: candidate.command, error: error.message || String(error) });
        return;
      }
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish({ available: true, status: "help_check_timed_out", version: "", command: candidate.command });
      }, timeoutMs);
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => output.push(chunk));
      child.stderr?.on("data", (chunk) => output.push(chunk));
      child.on("error", () => tryNext(index + 1));
      child.on("close", (code) => {
        const versionText = output.join("").trim();
        const versionShape = /GitHub Copilot CLI|gh copilot|Runs the GitHub Copilot CLI|AI-powered coding assistant|Usage: copilot/i.test(versionText);
        if (code === 0 && versionShape) {
          finish({ available: true, status: "available", version: versionText.slice(0, 500), command: candidate.command });
          return;
        }
        if (candidate.command === "github-copilot") {
          finish({ available: false, status: "unavailable", version: "", command: "", error: versionText || "GitHub Copilot CLI not available." });
          return;
        }
        tryNext(index + 1);
      });
    };
    tryNext(0);
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

async function quarantineGothamModelCaches(env = process.env) {
  const runtimeHome = env.GOTHAM_HOME || env.CODEX_HOME || path.join(os.homedir(), ".codex");
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

const startupCachePreparationPromises = new Map();

function cacheLooksIncompatible(value) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.models) ? value.models : Array.isArray(value?.data) ? value.data : [];
  return rows.some((row) => row && typeof row === "object" &&
    ("supports_reasoning_summaries" in row || "base_instructions" in row || "model" in row || "id" in row) &&
    !("supports_parallel_tool_calls" in row));
}

export async function prepareGothamRuntimeCaches({ runtimeHome = process.env.GOTHAM_HOME || process.env.CODEX_HOME || path.join(os.homedir(), ".codex") } = {}) {
  const resolvedRuntimeHome = path.resolve(runtimeHome);
  if (startupCachePreparationPromises.has(resolvedRuntimeHome)) return startupCachePreparationPromises.get(resolvedRuntimeHome);
  const preparation = (async () => {
    await fs.ensureDir(resolvedRuntimeHome);
    const lockPath = path.join(resolvedRuntimeHome, ".plutonix-model-cache-preparation.lock");
    let ownsLock = false;
    try {
      await fs.writeFile(lockPath, `${process.pid}\n`, { flag: "wx" });
      ownsLock = true;
    } catch (error) {
      if (error.code === "EEXIST") return { status: "already_claimed", inspected: [], quarantined: [] };
      throw error;
    }
    try {
      const candidates = [
        path.join(resolvedRuntimeHome, "models.json"),
        path.join(resolvedRuntimeHome, "models-cache.json"),
        path.join(resolvedRuntimeHome, "model-cache.json"),
        path.join(resolvedRuntimeHome, "cache", "models.json")
      ];
      const inspected = [];
      const quarantined = [];
      for (const candidate of candidates) {
        if (!(await fs.pathExists(candidate))) continue;
        inspected.push(path.basename(candidate));
        const raw = await fs.readFile(candidate, "utf8").catch(() => "");
        let incompatible = !raw.trim();
        try {
          incompatible = incompatible || cacheLooksIncompatible(JSON.parse(raw));
        } catch {
          incompatible = true;
        }
        if (!incompatible) continue;
        const quarantineDir = path.join(resolvedRuntimeHome, "cache-recovery", `startup-${Date.now()}`);
        await fs.ensureDir(quarantineDir);
        const destination = path.join(quarantineDir, path.basename(candidate));
        try {
          await fs.move(candidate, destination, { overwrite: false });
          quarantined.push({ source: path.basename(candidate), destination: path.relative(resolvedRuntimeHome, destination) });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      return { status: quarantined.length ? "quarantined" : "ready", inspected, quarantined };
    } finally {
      if (ownsLock) await fs.remove(lockPath).catch(() => {});
    }
  })().catch((error) => {
    startupCachePreparationPromises.delete(resolvedRuntimeHome);
    throw error;
  });
  startupCachePreparationPromises.set(resolvedRuntimeHome, preparation);
  return preparation;
}

export async function verifyGothamInfrastructureHealth({
  workspaceDir,
  codexBin = process.env.CODEX_BIN || "codex",
  prepareCache = true
} = {}) {
  const result = {
    status: "blocked",
    workspace: { status: "unavailable", path: workspaceDir || "" },
    cli: { status: "not_checked" },
    cache: { status: "not_checked" },
    sandbox: { status: "not_checked" }
  };
  try {
    if (!workspaceDir) throw new Error("No project workspace was configured.");
    const realPath = await fs.realpath(workspaceDir);
    await fs.access(realPath, fs.constants.R_OK | fs.constants.W_OK);
    result.workspace = { status: "ready", path: realPath };
  } catch (error) {
    result.failureClass = GOTHAM_FAILURE_CLASSES.WORKSPACE_CWD_MISSING;
    result.reason = redactOperational(error.message || String(error));
    return result;
  }
  result.cache = prepareCache ? await prepareGothamRuntimeCaches() : { status: "not_requested" };
  const cli = await probeCodexCli(codexBin);
  result.cli = cli;
  if (!cli.available) {
    result.failureClass = GOTHAM_FAILURE_CLASSES.CODEX_CLI_MODEL_INCOMPATIBLE;
    result.reason = redactOperational(cli.error || cli.status);
    return result;
  }
  result.sandbox = await probeCodexWorkspaceSandbox(codexBin, undefined, { workspaceDir: result.workspace.path });
  if (result.sandbox.status !== "ready") {
    result.failureClass = result.sandbox.failureClass || GOTHAM_FAILURE_CLASSES.SANDBOX_RUNTIME_UNAVAILABLE;
    result.reason = result.sandbox.reason;
    return result;
  }
  result.status = "ready";
  result.failureClass = "";
  result.reason = "";
  return result;
}

export function resolveGothamRuntime({ codexBin = process.env.CODEX_BIN || "codex", codexProbe = { available: false, status: "not_checked", version: "" }, copilotProbe = { available: false, status: "not_checked", version: "", command: "" } } = {}) {
  if (codexProbe.available) return { kind: "codex", bin: codexBin, probe: codexProbe };
  if (copilotProbe.available) {
    const normalizedCopilotProbe = { ...copilotProbe, command: copilotProbe.command || "copilot" };
    return { kind: "copilot", bin: normalizedCopilotProbe.command || "copilot", probe: normalizedCopilotProbe };
  }
  return { kind: "none", bin: "", probe: codexProbe };
}

export async function runCodexWorkflow(orchestratedRequest, options = {}) {
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  const signal = options.signal;
  if (signal?.aborted) throw new Error("Gotham workflow was stopped by the user.");
  const generatedSiteDir =
    options.generatedSiteDir || process.env.GENERATED_SITE_DIR || path.resolve(process.cwd(), "../generated-site");
  const providerRuntimeSelection = options.providerRuntimeSelection || { providerId: "codex", profileId: "legacy-process-default", selectedAt: new Date().toISOString() };
  if (providerRuntimeSelection.providerId !== "codex") throw new CodexRuntimeError("The selected provider does not have an approved Gotham execution adapter.", { category: CODEX_RUNTIME_FAILURES.MISSING_CLI });
  const providerProcessEnv = options.providerRuntime?.env || process.env;
  const preferredCodexBin = options.providerRuntime?.command || providerProcessEnv.CODEX_BIN || "codex";
  const selectedModel = options.model || "";
  const runtimeProbeEnabled = process.env.GOTHAM_RUNTIME_PROBE !== "false";
  const codexProbe = runtimeProbeEnabled
    ? await probeCodexCli(preferredCodexBin, 8000, providerProcessEnv)
    : { available: true, status: "not_checked", version: "" };
  if (runtimeProbeEnabled && !codexProbe.available) {
    throw new CodexRuntimeError(
      "Codex CLI is unavailable. Install @openai/codex and configure CODEX_BIN to its executable.",
      { category: CODEX_RUNTIME_FAILURES.MISSING_CLI }
    );
  }
  const authenticationProbe = runtimeProbeEnabled
    ? await probeCodexAuthentication(codexProbe.resolvedBin || preferredCodexBin, { env: providerProcessEnv })
    : { authenticated: true, status: "not_checked", mode: "" };
  if (runtimeProbeEnabled && !authenticationProbe.authenticated) {
    throw new CodexRuntimeError(
      authenticationProbe.error || "Codex authentication is required. Run `codex login --device-auth` once on the host.",
      { category: authenticationProbe.status === "authentication_required" ? CODEX_RUNTIME_FAILURES.AUTHENTICATION_REQUIRED : CODEX_RUNTIME_FAILURES.MISSING_CLI }
    );
  }
  const effectiveRuntime = { kind: "codex", bin: codexProbe.resolvedBin || preferredCodexBin, probe: codexProbe };
  const codexVersion = codexProbe.version;
  const codexCliStatus = codexCliLabel(codexProbe);
  const runtimeKind = "codex";
  const runtimeCommand = effectiveRuntime.bin || preferredCodexBin;
  const sandboxPreflightEnabled = runtimeProbeEnabled && process.env.GOTHAM_SANDBOX_PREFLIGHT !== "false";
  const sandboxPreflight = runtimeKind === "codex" && sandboxPreflightEnabled
    ? await probeCodexWorkspaceSandbox(runtimeCommand, undefined, { workspaceDir: generatedSiteDir, env: providerProcessEnv })
    : { status: "not_applicable", component: "workspace_sandbox", failureClass: "", reason: "", diagnostic: "", remediation: "" };
  const timeoutMs = Number(options.timeoutMs ?? process.env.CODEX_WORKFLOW_TIMEOUT_MS ?? 10 * 60 * 1000);
  const inactivityTimeoutMs = Math.max(1000, timeoutMs);
  const sourceInstruction = orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "";
  const executionAgentId = options.executionAgentId || orchestratedRequest.orchestrationEnvelope?.authority?.agentId || options.agentId || orchestratedRequest.orchestrator || "project-execution-agent";
  const buildId = `codex_${nanoid(10)}`;
  const generatedSourceDir = path.join(generatedSiteDir, "src", "generated");
  const projectOrchestratorPath = path.join(generatedSiteDir, ".agentic", "orchestrator-agent.md");
  const hasProjectOrchestrator = await fs.pathExists(projectOrchestratorPath);
  let promptText = "";
  const quarantinedModelCaches = options.recoverModelsCache ? await quarantineGothamModelCaches(providerProcessEnv) : [];

  emit("preflight.started", "Gotham is verifying the selected provider's secure workspace sandbox.", {
    stage: "preflight",
    provider: runtimeKind,
    component: sandboxPreflight.component,
    parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId
  });
  if (sandboxPreflight.status === "unavailable") {
    emit("preflight.failed", "Sandbox unavailable; Gotham did not start provider execution.", {
      stage: "preflight",
      provider: runtimeKind,
      parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
      ...sandboxPreflight
    });
    emit("execution.blocked", "Execution was blocked because the secure workspace sandbox could not be initialized.", {
      stage: "execution",
      provider: runtimeKind,
      parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
      failureClass: sandboxPreflight.failureClass || GOTHAM_FAILURE_CLASSES.SANDBOX_RUNTIME_UNAVAILABLE,
      reason: sandboxPreflight.reason
    });
    throw createGothamWorkspaceSandboxUnavailableError(sandboxPreflight);
  }
  emit("preflight.succeeded", sandboxPreflight.status === "ready"
    ? "Gotham verified the secure workspace sandbox."
    : "Provider sandbox preflight is not applicable to the selected runtime.", {
    stage: "preflight",
    provider: runtimeKind,
    parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
    sandboxPreflight
  });

  await fs.ensureDir(generatedSourceDir);
  const before = await collectFileHashes(generatedSiteDir);
  const projectStateDigest = crypto.createHash("sha256").update(
    JSON.stringify([...before.entries()].sort(([left], [right]) => left.localeCompare(right)))
  ).digest("hex");
  const compiledContextEnabled = options.compiledPolicyContextEnabled !== false && process.env.GOTHAM_COMPILED_POLICY_CONTEXT_ENABLED !== "false";
  if (compiledContextEnabled) {
    const localAgentPath = path.join(generatedSiteDir, ".agentic", "agents", `${executionAgentId}.agent.md`);
    const selectedAgentDefinitions = (await fs.pathExists(localAgentPath))
      ? [{ id: executionAgentId, path: path.relative(generatedSiteDir, localAgentPath), content: (await fs.readFile(localAgentPath, "utf8")).slice(0, 6000) }]
      : [{ id: executionAgentId, path: "runtime-selected", content: `Selected execution agent: ${executionAgentId}` }];
    const classification = orchestratedRequest.taskClassification || {};
    orchestratedRequest.compiledGothamContext = await compileGothamContext({
      instruction: sourceInstruction,
      workflowMode: orchestratedRequest.workflowMode || options.workflowMode || "executor",
      projectLifecycle: classification.projectLifecycle || orchestratedRequest.projectLifecycle || "runtime-development",
      taskType: classification.resolvedTaskType || orchestratedRequest.taskType || options.taskType || "Medium",
      artifactType: classification.artifactType || orchestratedRequest.productDecision?.artifactType || "web_application",
      riskLevel: classification.riskLevel || orchestratedRequest.orchestrationEnvelope?.adaptiveRoute?.riskLevel || "low",
      affectedBoundaries: classification.affectedBoundaries || [],
      taskClassificationReasons: classification.reasonCodes || [],
      taskMetadata: {
        rawTextBoxInstruction: orchestratedRequest.rawTextBoxInstruction || "",
        executionInstructionFormat: orchestratedRequest.executionInstructionFormat || "",
        mayRedefineParentTask: false,
        mayApproveCompletion: false
      },
      selectedExecutionAgent: executionAgentId,
      selectedAgentDefinitions,
      requiredSpecialists: orchestratedRequest.requiredSpecialists || [],
      completionCriteria: orchestratedRequest.orchestrationEnvelope?.validationCriteria || [],
      projectStateDigest,
      readDecisionSnapshot: async () => {
        const rows = readCanonicalWorkflowDecisions({
          projectId: orchestratedRequest.project?.id || options.projectId || "",
          limit: 1,
          terminalOnly: false
        });
        return rows.at(-1) || null;
      }
    });
  }
  promptText = codexPrompt(sourceInstruction, orchestratedRequest, hasProjectOrchestrator);
  const startedAt = Date.now();

  emit("codex-start", `Starting current Gotham CLI workflow ${buildId}`, {
    stage: "5/8",
    buildId,
    generatedSiteDir,
    generatedSourceDir,
    codexBin: runtimeCommand,
    runtimeKind,
    codexVersion: codexCliStatus,
    codexCliStatus: codexProbe.status,
    codexCliError: codexProbe.error || "",
    requestedModel: selectedModel || "Codex configuration default",
    providerRuntimeSelection,
    agentId: executionAgentId,
    orchestrationAuthority: orchestratedRequest.orchestrationEnvelope ? "plutonix-global" : hasProjectOrchestrator ? "project-local-legacy" : "plutonix-default",
    parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
    childExecutionIds: orchestratedRequest.orchestrationEnvelope?.childExecutionIds || [],
    orchestratorPolicyPath: hasProjectOrchestrator ? projectOrchestratorPath : null,
    modelsCacheRecovery: options.recoverModelsCache
      ? { attempted: true, quarantinedFiles: quarantinedModelCaches.map((file) => path.basename(file)) }
      : null,
    sandboxPreflight,
    compiledContext: orchestratedRequest.compiledGothamContext ? {
      policyVersion: orchestratedRequest.compiledGothamContext.policyVersion,
      policyBundleHash: orchestratedRequest.compiledGothamContext.policyBundleHash,
      selectedPackIds: orchestratedRequest.compiledGothamContext.selectedInstructionPacks.map((pack) => pack.id),
      estimatedTokens: orchestratedRequest.compiledGothamContext.provenance.estimatedTokens,
      omittedOptionalPacks: orchestratedRequest.compiledGothamContext.provenance.omittedOptionalPacks
    } : null
  });
  emit("gotham-runtime-verified", `Gotham runtime ${runtimeKind}; model ${selectedModel || (runtimeKind === "copilot" ? "from Copilot CLI" : "from Codex configuration") }`, {
    stage: "runtime",
    buildId,
    codexBin: runtimeCommand,
    runtimeKind,
    codexVersion: codexCliStatus,
    codexCliStatus: codexProbe.status,
    codexCliError: codexProbe.error || "",
    authenticationStatus: authenticationProbe.status,
    providerRuntimeSelection,
    requestedModel: selectedModel || "",
    fallbackModel: process.env.GOTHAM_FALLBACK_MODEL || ""
  });

  const args = [
    ...gothamSandboxFeatureArgs(providerProcessEnv),
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
  let finalAgentResponse = "";
  let codexThreadId = "";
  let malformedEventCount = 0;
  try {
    const execution = await executeCodex({
      command: runtimeCommand,
      args,
      cwd: generatedSiteDir,
      registeredWorkspaceDirs: [
        generatedSiteDir,
        orchestratedRequest.project?.workspaceDir,
        options.registeredWorkspaceDir
      ].filter(Boolean),
      managedRoots: [
        process.env.PROJECTS_ROOT,
        process.env.PLUTONIX_PROJECT_ROOT,
        path.dirname(generatedSiteDir)
      ].filter(Boolean),
      signal,
      env: providerProcessEnv,
      timeoutMs: inactivityTimeoutMs,
      onEvent: (runtimeEvent) => {
        const { type, message, finalResponse: _finalResponse, ...metadata } = runtimeEvent;
        emit(type, message, {
          stage: "5/8",
          buildId,
          agentId: executionAgentId,
          ...metadata
        });
      },
      onMalformed: () => {
        malformedEventCount += 1;
        emit("codex-malformed-event", "Codex emitted a malformed runtime event; Gotham ignored it safely.", {
          stage: "5/8",
          buildId,
          agentId: executionAgentId,
          malformedEventCount
        });
      }
    });
    output.push(execution.stdout);
    errors.push(execution.stderr);
    finalAgentResponse = execution.finalResponse || "";
    codexThreadId = execution.threadId || "";
    malformedEventCount = execution.malformedEvents;
  } catch (error) {
    const partialAfter = (await fs.pathExists(generatedSiteDir)) ? await collectFileHashes(generatedSiteDir).catch(() => new Map()) : new Map();
    error.partialChanges = diffHashes(before, partialAfter).map((filePath) => filePath.split(path.sep).join("/"));
    error.workflowFailureClass = classifyGothamWorkflowFailure(error, { workspaceDir: generatedSiteDir });
    error.requestedModel = error.requestedModel || selectedModel || requestedModelFromFailure(error);
    error.codexVersion = error.codexVersion || codexVersion;
    const eventStream = output.join("");
    const measuredUsage = resolveWorkflowTokenUsage({ eventStream, promptText });
    error.tokenUsage = await recordAgentTokenUsage({
      agentId: executionAgentId,
      agentName: options.executionAgentName || "",
      projectId: orchestratedRequest.project?.id || options.projectId || "",
      projectName: orchestratedRequest.project?.name || options.projectName || "",
      workflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
      parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
      buildId,
      instructionSummary: sourceInstruction,
      taskType: options.taskType || orchestratedRequest.taskType || "",
      provider: runtimeKind,
      executionModel: selectedModel,
      ...measuredUsage,
      durationMs: Date.now() - startedAt,
      changedFiles: error.partialChanges.length,
      attemptNumber: options.attempt || 1,
      attemptType: options.attemptType || "execution",
      attemptStatus: "failed",
      failureClass: error.workflowFailureClass,
      startedAt: new Date(startedAt).toISOString(),
      stdoutEventBytes: Buffer.byteLength(eventStream),
      stderrBytes: Buffer.byteLength(errors.join("")),
      transportBytes: Buffer.byteLength(eventStream) + Buffer.byteLength(errors.join(""))
    }).catch(() => null);
    error.transportEvidence = {
      stdoutEventBytes: Buffer.byteLength(eventStream),
      stderrBytes: Buffer.byteLength(errors.join(""))
    };
    throw error;
  }

  const modelExecutionDurationMs = Date.now() - startedAt;
  const recordTerminalExecutionFailure = async (failureClass, partialChanges = []) => {
    const eventStream = output.join("");
    const stderrText = errors.join("");
    return recordAgentTokenUsage({
      agentId: executionAgentId,
      agentName: options.executionAgentName || "",
      projectId: orchestratedRequest.project?.id || options.projectId || "",
      projectName: orchestratedRequest.project?.name || options.projectName || "",
      workflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
      parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
      buildId,
      instructionSummary: sourceInstruction,
      taskType: options.taskType || orchestratedRequest.taskType || "",
      provider: runtimeKind,
      executionModel: selectedModel,
      ...resolveWorkflowTokenUsage({ eventStream, promptText }),
      durationMs: Date.now() - startedAt,
      changedFiles: partialChanges.length,
      attemptNumber: options.attempt || 1,
      attemptType: options.attemptType || "execution",
      attemptStatus: "failed",
      failureClass,
      startedAt: new Date(startedAt).toISOString(),
      stdoutEventBytes: Buffer.byteLength(eventStream),
      stderrBytes: Buffer.byteLength(stderrText),
      transportBytes: Buffer.byteLength(eventStream) + Buffer.byteLength(stderrText)
    }).catch(() => null);
  };
  const validationStartedAt = Date.now();
  const after = await collectFileHashes(generatedSiteDir);
  const changedSourceFiles = diffHashes(before, after);
  const changedFiles = changedSourceFiles.map((filePath) => filePath.split(path.sep).join("/"));
  if (!changedFiles.length) {
    const transcript = [...errors, ...output].join("");
    const transcriptClass = classifyGothamWorkflowFailure(transcript, { workspaceDir: generatedSiteDir });
    if (isGothamInfrastructureFailure(transcriptClass)) {
      const failureSummary = transcriptClass === GOTHAM_FAILURE_CLASSES.SANDBOX_RUNTIME_UNAVAILABLE
        ? "Gotham's command sandbox became unavailable before a project change could be completed."
        : "Gotham infrastructure failed before a project change could be completed.";
      const diagnostic = redactedProcessOutputTail([...errors, ...output]);
      const error = new Error(`${failureSummary}${diagnostic ? ` ${diagnostic}` : ""}`);
      error.workflowFailureClass = transcriptClass;
      error.partialChanges = [];
      error.tokenUsage = await recordTerminalExecutionFailure(transcriptClass, []);
      throw error;
    }
    const error = new Error("Gotham completed but did not change any meaningful project or requested artifact files.");
    error.workflowFailureClass = GOTHAM_FAILURE_CLASSES.PROJECT_IMPLEMENTATION_FAILURE;
    error.partialChanges = [];
    error.tokenUsage = await recordTerminalExecutionFailure(error.workflowFailureClass, []);
    throw error;
  }
  const inputConsumption = await buildInputConsumptionReceipt(generatedSiteDir, changedFiles, orchestratedRequest);
  const productShapeValidation = validateProductShapeOutputs(
    orchestratedRequest.productDecision || orchestratedRequest.orchestrationEnvelope?.plan?.productDecision || {},
    changedFiles
  );
  if (productShapeValidation.status === "failed") {
    const error = new Error(`Product Shape validation failed: ${productShapeValidation.failures.join(" ")}`);
    error.workflowFailureClass = GOTHAM_FAILURE_CLASSES.PROJECT_VALIDATION_FAILURE;
    error.partialChanges = changedFiles;
    error.tokenUsage = await recordTerminalExecutionFailure(error.workflowFailureClass, changedFiles);
    throw error;
  }
  const validationDurationMs = Date.now() - validationStartedAt;

  const instructionHash = crypto.createHash("sha256").update(sourceInstruction).digest("hex");
  const outputText = output.join("");
  const durationMs = Date.now() - startedAt;
  const measuredUsage = resolveWorkflowTokenUsage({ eventStream: outputText, promptText });
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
    gothamUsageOwnerKey: options.gothamUsageOwnerKey || "",
    provider: runtimeKind,
    executionModel: selectedModel || (runtimeKind === "copilot" ? "Copilot CLI configured model" : "Codex configured model"),
    ...measuredUsage,
    durationMs,
    changedFiles: changedFiles.length,
    attemptNumber: options.attempt || 1,
    attemptType: options.attemptType || "execution",
    attemptStatus: "succeeded",
    parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
    startedAt: new Date(startedAt).toISOString(),
    stdoutEventBytes: Buffer.byteLength(outputText),
    stderrBytes: Buffer.byteLength(errors.join("")),
    transportBytes: Buffer.byteLength(outputText) + Buffer.byteLength(errors.join(""))
  });
  emit("codex-complete", `Gotham changed ${changedFiles.length} files`, {
    stage: "6/8",
    buildId,
    changedFiles,
    durationMs,
    tokenUsage,
    agentId: executionAgentId,
    agentResponse: redactCodexText(finalAgentResponse, 12000),
    threadId: codexThreadId,
    malformedEventCount
  });

  return {
    buildId,
    parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
    childExecutionIds: orchestratedRequest.orchestrationEnvelope?.childExecutionIds || [],
    title: orchestratedRequest.topic || "Generated Site",
    instructionHash,
    runtime: {
      codexBin: runtimeCommand,
      runtimeKind,
      codexVersion,
      selectedModel: selectedModel || "",
      providerRuntimeSelection,
      threadId: codexThreadId
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
      command: runtimeCommand,
      durationMs,
      finalResponse: redactCodexText(finalAgentResponse, 4000),
      malformedEventCount
    },
    timings: {
      policySelectionDurationMs: orchestratedRequest.compiledGothamContext?.provenance.policySelectionDurationMs ?? 0,
      staticContextCompileDurationMs: orchestratedRequest.compiledGothamContext?.provenance.staticContextCompileDurationMs ?? 0,
      dynamicContextCompileDurationMs: orchestratedRequest.compiledGothamContext?.provenance.dynamicContextCompileDurationMs ?? 0,
      modelExecutionDurationMs,
      validationDurationMs
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
  const recordReviewAttempt = (attemptStatus, failureClass = "") => {
    const eventStream = output.join("");
    const stderrText = errors.join("");
    return recordAgentTokenUsage({
      agentId: options.reviewerAgentId || "plutonix-independent-reviewer",
      agentName: "PlutoniX Independent Reviewer",
      projectId: orchestratedRequest.project?.id || options.projectId || "",
      projectName: orchestratedRequest.project?.name || options.projectName || "",
      workflowId: envelope.parentWorkflowId || reviewId,
      parentWorkflowId: envelope.parentWorkflowId || reviewId,
      buildId: reviewId,
      instructionSummary: orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "",
      taskType: options.taskType || "",
      ...resolveWorkflowTokenUsage({ eventStream, promptText }),
      durationMs: Date.now() - startedAt,
      changedFiles: 0,
      validationStatus: attemptStatus === "succeeded" ? "passed" : "failed",
      attemptNumber: options.attempt || 1,
      attemptType: "review",
      attemptStatus,
      failureClass,
      startedAt: new Date(startedAt).toISOString(),
      stdoutEventBytes: Buffer.byteLength(eventStream),
      stderrBytes: Buffer.byteLength(stderrText),
      transportBytes: Buffer.byteLength(eventStream) + Buffer.byteLength(stderrText)
    });
  };
  const reviewFailure = async (error) => {
    error.workflowFailureClass = classifyGothamWorkflowFailure(error, { workspaceDir: generatedSiteDir });
    error.tokenUsage = await recordReviewAttempt("failed", error.workflowFailureClass).catch(() => null);
    return error;
  };
  emit("review-start", `Starting independent review ${reviewId}`, {
    parentWorkflowId: envelope.parentWorkflowId,
    reviewId,
    reviewerAgentId: options.reviewerAgentId || "plutonix-independent-reviewer"
  });

  await new Promise((resolve, reject) => {
    const child = spawn(codexBin, [
      ...gothamSandboxFeatureArgs(),
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
      code === 0 ? resolve() : reject(new Error(childProcessFailureMessage("Independent review", code, errors, output)));
    });
  }).catch(async (error) => { throw await reviewFailure(error); });

  const after = await collectFileHashes(generatedSiteDir);
  const reviewerChanges = diffHashes(before, after);
  if (reviewerChanges.length) {
    throw await reviewFailure(new Error(`Independent reviewer violated read-only mode and changed: ${reviewerChanges.slice(0, 8).join(", ")}`));
  }
  const outputText = output.join("");
  const failed = outputText.match(/PLUTONIX_REVIEW:\s*FAIL:\s*([^\n"}]*)/i);
  const passed = /PLUTONIX_REVIEW:\s*PASS/i.test(outputText);
  const quality = outputText.match(
    /PLUTONIX_QUALITY:\s*shape_fit=(PASS|FAIL);\s*depth_fit=(PASS|FAIL);\s*data_fidelity=(PASS|FAIL);\s*input_consumption=(PASS|FAIL);\s*ui_reference_functionality=(PASS|FAIL);\s*no_explainer_copy=(PASS|FAIL);\s*generic_template_check=(PASS|FAIL)/i
  );
  if (failed) throw await reviewFailure(new Error(`Independent review failed: ${failed[1].trim() || "acceptance criteria were not met"}`));
  if (!quality) throw await reviewFailure(new Error("Independent review did not return the required Product Shape quality verdicts."));
  if (quality.slice(1).some((verdict) => verdict.toUpperCase() !== "PASS")) {
    throw await reviewFailure(new Error("Independent review failed one or more Product Shape quality gates."));
  }
  if (!passed) throw await reviewFailure(new Error("Independent review did not return the required PASS/FAIL marker."));

  const durationMs = Date.now() - startedAt;
  const tokenUsage = await recordReviewAttempt("succeeded");
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
    ...gothamSandboxFeatureArgs(),
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

function completionCheckArgsFor(candidate, promptText, generatedSiteDir) {
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
    ...gothamSandboxFeatureArgs(),
    "exec",
    "--json",
    "--cd",
    generatedSiteDir,
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    promptText
  ];
}

export function parseCompletionCheckResult(text) {
  const normalized = String(text || "");
  const match = normalized.match(/PLUTONIX_COMPLETION_CHECK:\s*(PASS|FAIL)(?::\s*([^\n]+))?/i);
  if (!match) {
    return { pass: false, status: "FAIL", reason: "No completion-check marker was returned." };
  }
  const status = match[1].toUpperCase();
  const reason = String(match[2] || "").trim();
  return {
    pass: status === "PASS",
    status,
    reason
  };
}

function repairPrompt(orchestratedRequest, failure, options = {}) {
  const originalInstruction = orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "";
  const changedFiles = Array.isArray(options.changedFiles) ? options.changedFiles : [];
  const failureMessage = String(failure?.message || failure || "");
  const intelProfile = options.intelProfile || null;
  const zeroChangeExecution = /completed but did not change any (?:meaningful project or requested artifact )?files/i.test(failureMessage);
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

${zeroChangeExecution ? `Repair classification: requested-task completion failure.
- The prior model exited without changing a project file, so the requested feature was not implemented.
- Implement the original user instruction directly; do not treat a healthy preview or an unchanged workspace as success.
- Before you finish, verify that at least one in-scope project file was created or modified for the requested behavior.` : "Repair classification: runtime or validation failure."}

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
${deterministicPublicationOwnershipPrompt()}
- End with a concise summary of changed files and why the failure should be fixed.`;
}

function completionCheckPrompt(orchestratedRequest, options = {}) {
  const originalInstruction = orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "";
  const generatedSiteDir = options.generatedSiteDir || process.env.GENERATED_SITE_DIR || path.resolve(process.cwd(), "../generated-site");
  const changedFiles = Array.isArray(options.changedFiles) ? options.changedFiles : [];
  return `You are the PlutoniX completion checker.

Your job is to decide whether a repaired project now satisfies the original task instruction. You are not allowed to change files. Inspect the workspace and answer strictly using the markers below.

Original user instruction:
${originalInstruction}

Project workspace:
${generatedSiteDir}

Files changed by the repair attempt:
${JSON.stringify(changedFiles, null, 2)}

Rules:
- Determine whether the specific user request is now satisfied with the current project files.
- Use the original instruction as the source of truth, not the earlier error message.
- If the task is still incomplete, missing behavior, broken preview, wrong artifact type, or violates the requested objective, return FAIL.
- If the task is now satisfied, return PASS.
- Keep the answer compact and factual.
- End with exactly these markers on separate lines:
PLUTONIX_COMPLETION_CHECK: PASS or FAIL: <one clause explaining the result>
PLUTONIX_REVIEW: PASS or FAIL: <one clause explaining the result>`;
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
          code === 0 ? resolveOnce() : rejectOnce(new Error(childProcessFailureMessage(`${candidate.kind} repair`, code, stderr, output)));
        });
      });

      const after = await collectFileHashes(generatedSiteDir);
      const changedFiles = diffHashes(before, after);
      if (!changedFiles.length) {
        const outputTail = redactedProcessOutputTail([...output, ...stderr]);
        throw new Error(`${candidate.kind} repair completed but did not change any files.${outputTail ? ` Model output: ${outputTail}` : ""}`);
      }
      const normalizedFiles = changedFiles.map((filePath) => filePath.split(path.sep).join("/"));
      const completionCheckPromptText = completionCheckPrompt(orchestratedRequest, {
        generatedSiteDir,
        changedFiles: normalizedFiles
      });
      const completionOutput = [];
      const completionErrors = [];
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(candidate.bin, completionCheckArgsFor(candidate, completionCheckPromptText, generatedSiteDir), {
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
              rejectOnce(new Error(`Completion check produced no output for ${Math.round(timeoutMs / 1000)} seconds and was stopped.`));
            }, timeoutMs);
          };
          resetTimer();
          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          child.stdout.on("data", (chunk) => {
            resetTimer();
            completionOutput.push(chunk);
          });
          child.stderr.on("data", (chunk) => {
            resetTimer();
            completionErrors.push(chunk);
          });
          child.on("error", rejectOnce);
          child.on("close", (code) => {
            code === 0 ? resolveOnce() : rejectOnce(new Error(childProcessFailureMessage(`${candidate.kind} completion check`, code, completionErrors, completionOutput)));
          });
        });
      } catch (completionError) {
        const completionText = completionOutput.join("");
        completionError.tokenUsage = await recordAgentTokenUsage({
          agentId: "plutonix-completion-checker",
          agentName: "PlutoniX Completion Checker",
          projectId: options.projectId || orchestratedRequest.project?.id || "",
          projectName: options.projectName || orchestratedRequest.project?.name || "",
          workflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || repairId,
          parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || repairId,
          buildId: `${repairId}_completion_${candidate.kind}`,
          instructionSummary: orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "",
          taskType: options.taskType || orchestratedRequest.taskType || "",
          provider: candidate.kind,
          executionModel: candidate.bin,
          ...resolveWorkflowTokenUsage({ eventStream: completionText, promptText: completionCheckPromptText }),
          durationMs: Date.now() - startedAt,
          changedFiles: 0,
          attemptType: "completion_check",
          attemptStatus: "failed",
          failureClass: classifyGothamWorkflowFailure(completionError, { workspaceDir: generatedSiteDir }),
          startedAt: new Date(startedAt).toISOString(),
          stdoutEventBytes: Buffer.byteLength(completionText),
          stderrBytes: Buffer.byteLength(completionErrors.join("")),
          transportBytes: Buffer.byteLength(completionText) + Buffer.byteLength(completionErrors.join(""))
        }).catch(() => null);
        throw new Error(`Repair model succeeded but the completion check failed to run: ${completionError.message}`);
      }
      const completionText = completionOutput.join("");
      const completionCheck = parseCompletionCheckResult(completionText);
      const completionTokenUsage = await recordAgentTokenUsage({
        agentId: "plutonix-completion-checker",
        agentName: "PlutoniX Completion Checker",
        projectId: options.projectId || orchestratedRequest.project?.id || "",
        projectName: options.projectName || orchestratedRequest.project?.name || "",
        workflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || repairId,
        parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || repairId,
        buildId: `${repairId}_completion_${candidate.kind}`,
        instructionSummary: orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "",
        taskType: options.taskType || orchestratedRequest.taskType || "",
        provider: candidate.kind,
        executionModel: candidate.bin,
        ...resolveWorkflowTokenUsage({ eventStream: completionText, promptText: completionCheckPromptText }),
        durationMs: Date.now() - startedAt,
        changedFiles: 0,
        validationStatus: completionCheck.pass ? "passed" : "failed",
        attemptType: "completion_check",
        attemptStatus: completionCheck.pass ? "succeeded" : "failed",
        failureClass: completionCheck.pass ? "" : GOTHAM_FAILURE_CLASSES.PROJECT_VALIDATION_FAILURE,
        startedAt: new Date(startedAt).toISOString(),
        stdoutEventBytes: Buffer.byteLength(completionText),
        stderrBytes: Buffer.byteLength(completionErrors.join("")),
        transportBytes: Buffer.byteLength(completionText) + Buffer.byteLength(completionErrors.join(""))
      });
      if (!completionCheck.pass) {
        throw new Error(`${candidate.kind} repair was not accepted by the completion gate: ${completionCheck.reason || "missing required behavior remained after repair."}`);
      }
      const durationMs = Date.now() - startedAt;
      const outputText = output.join("");
      const measuredUsage = resolveWorkflowTokenUsage({ eventStream: outputText, promptText });
      const tokenUsage = await recordAgentTokenUsage({
        agentId: "plutonix-auto-repair-agent",
        agentName: "PlutoniX Auto Repair Agent",
        projectId: options.projectId || orchestratedRequest.project?.id || "",
        projectName: options.projectName || orchestratedRequest.project?.name || "",
        workflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || repairId,
        buildId: repairId,
        instructionSummary: orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "",
        taskType: options.taskType || orchestratedRequest.taskType || "",
        ...measuredUsage,
        durationMs,
        changedFiles: normalizedFiles.length,
        validationStatus: "passed",
        attemptType: "repair",
        attemptStatus: "succeeded",
        parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || repairId,
        startedAt: new Date(startedAt).toISOString(),
        stdoutEventBytes: Buffer.byteLength(outputText),
        stderrBytes: Buffer.byteLength(errors.join("")),
        transportBytes: Buffer.byteLength(outputText) + Buffer.byteLength(errors.join(""))
      });
      emit("plutonix-repair-complete", `Automatic repair changed ${normalizedFiles.length} files`, {
        stage: "repair",
        repairId,
        modelKind: candidate.kind,
        changedFiles: normalizedFiles,
        tokenUsage,
        completionCheck
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
        completionCheck,
        completionTokenUsage,
        tokenUsage
      };
    } catch (error) {
      if (!error.tokenUsage) {
        const outputText = output.join("");
        error.tokenUsage = await recordAgentTokenUsage({
          agentId: "plutonix-auto-repair-agent",
          agentName: "PlutoniX Auto Repair Agent",
          projectId: options.projectId || orchestratedRequest.project?.id || "",
          projectName: options.projectName || orchestratedRequest.project?.name || "",
          workflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || repairId,
          parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || repairId,
          buildId: `${repairId}_${candidate.kind}`,
          instructionSummary: orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "",
          taskType: options.taskType || orchestratedRequest.taskType || "",
          provider: candidate.kind,
          executionModel: candidate.bin,
          ...resolveWorkflowTokenUsage({ eventStream: outputText, promptText }),
          durationMs: Date.now() - startedAt,
          changedFiles: 0,
          attemptType: "repair",
          attemptStatus: "failed",
          failureClass: classifyGothamWorkflowFailure(error, { workspaceDir: generatedSiteDir }),
          startedAt: new Date(startedAt).toISOString(),
          stdoutEventBytes: Buffer.byteLength(outputText),
          stderrBytes: Buffer.byteLength(stderr.join("")),
          transportBytes: Buffer.byteLength(outputText) + Buffer.byteLength(stderr.join(""))
        }).catch(() => null);
      }
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
