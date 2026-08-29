import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";
import { estimateTokens } from "./tokenEconomy.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultPolicyRoot = path.resolve(moduleDir, "../../../policies");
const staticPolicyCache = new Map();

export function resolveGothamPolicyRoot({ policyRoot = "", env = process.env } = {}) {
  const explicitPolicyRoot = String(policyRoot || env.GOTHAM_POLICY_ROOT || "").trim();
  if (explicitPolicyRoot) return path.resolve(explicitPolicyRoot);
  const mountedProjectRoot = String(env.PLUTONIX_PROJECT_ROOT || "").trim();
  if (mountedProjectRoot) {
    const mountedPolicyRoot = path.resolve(mountedProjectRoot, "policies");
    if (fs.existsSync(path.join(mountedPolicyRoot, "manifest.json"))) return mountedPolicyRoot;
  }
  return defaultPolicyRoot;
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function assertManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== "plutonix-policy-manifest/v1" || !manifest.version || !Array.isArray(manifest.packs)) {
    throw new Error("Gotham policy manifest is invalid.");
  }
  const ids = new Set();
  for (const pack of manifest.packs) {
    if (!pack?.id || !pack?.version || !pack?.path || !pack?.contentHash || !Number.isFinite(pack.precedence)) {
      throw new Error(`Gotham policy manifest pack ${pack?.id || "<unknown>"} is incomplete.`);
    }
    if (ids.has(pack.id)) throw new Error(`Gotham policy manifest contains duplicate pack ${pack.id}.`);
    ids.add(pack.id);
  }
  return manifest;
}

function lifecyclePack(projectLifecycle) {
  const value = String(projectLifecycle || "runtime-development").replaceAll("_", "-");
  if (["project-init", "project-import", "bootstrap-repair", "runtime-development"].includes(value)) return `lifecycle.${value}`;
  return "lifecycle.runtime-development";
}

function taskPack(taskType) {
  const normalized = String(taskType || "Medium").toLowerCase();
  return `task-size.${normalized === "simple" ? "simple" : normalized === "hard" || normalized === "large" ? "hard" : "medium"}`;
}

function domainPack(artifactType, affectedBoundaries = []) {
  const normalized = String(artifactType || "web_application").toLowerCase().replaceAll("-", "_");
  const mapping = {
    website: "web-application",
    web_application: "web-application",
    browser_app: "web-application",
    api: "api-service",
    api_service: "api-service",
    mobile: "mobile",
    mobile_app: "mobile",
    document: "document",
    pdf: "pdf",
    presentation: "presentation",
    spreadsheet: "spreadsheet",
    image_media: "image-media",
    image: "image-media",
    audio: "image-media",
    video: "image-media",
    data_pipeline: "data-pipeline",
    ml_ai: "ml-ai",
    rag_vector: "rag-vector",
    infrastructure: "infrastructure"
  };
  if (affectedBoundaries.includes("infrastructure")) return "domain.infrastructure";
  return `domain.${mapping[normalized] || "web-application"}`;
}

function applicable(pack, selector) {
  const includes = (values, value) => !Array.isArray(values) || values.includes("*") || values.includes(value);
  return includes(pack.lifecycle, selector.projectLifecycle) &&
    includes(pack.taskSizes, selector.taskType) &&
    includes(pack.domains, selector.artifactType) &&
    includes(pack.risks, selector.riskLevel);
}

async function readPack(policyRoot, pack) {
  const filePath = path.resolve(policyRoot, pack.path);
  if (!filePath.startsWith(`${path.resolve(policyRoot)}${path.sep}`)) throw new Error(`Unsafe Gotham policy pack path: ${pack.path}`);
  const content = await fs.readFile(filePath, "utf8");
  const actualHash = digest(content);
  const expectedHash = String(pack.contentHash).replace(/^sha256:/, "");
  if (actualHash !== expectedHash) throw new Error(`Gotham policy pack hash mismatch for ${pack.id}.`);
  return { ...pack, content, actualHash };
}

function rejectConflicts(selected) {
  const ids = new Set(selected.map((pack) => pack.id));
  for (const pack of selected) {
    const conflict = (pack.incompatibleWith || []).find((id) => ids.has(id));
    if (conflict) throw new Error(`Mandatory Gotham policy conflict: ${pack.id} is incompatible with ${conflict}.`);
  }
}

export function clearGothamStaticPolicyCache() {
  staticPolicyCache.clear();
}

export async function compileGothamContext(input = {}, options = {}) {
  const policySelectionStartedAt = Date.now();
  const policyRoot = resolveGothamPolicyRoot({ policyRoot: options.policyRoot });
  const manifest = assertManifest(await fs.readJson(path.join(policyRoot, "manifest.json")));
  const selector = {
    workflowMode: input.workflowMode || "executor",
    projectLifecycle: String(input.projectLifecycle || "runtime-development").replaceAll("_", "-"),
    taskType: input.taskType || "Medium",
    artifactType: input.artifactType || "web_application",
    riskLevel: input.riskLevel || "low"
  };
  const requiredIds = new Set([
    "core.authority-and-safety",
    "core.decision-continuity",
    "core.product-shape-and-real-data",
    lifecyclePack(selector.projectLifecycle),
    taskPack(selector.taskType),
    domainPack(selector.artifactType, input.affectedBoundaries || [])
  ]);
  const candidates = manifest.packs
    .filter((pack) => requiredIds.has(pack.id) || (pack.mandatory && applicable(pack, selector)))
    .sort((left, right) => left.precedence - right.precedence || left.id.localeCompare(right.id));
  const selected = await Promise.all(candidates.map((pack) => readPack(policyRoot, pack)));
  rejectConflicts(selected);
  const policySelectionDurationMs = Date.now() - policySelectionStartedAt;

  const staticStartedAt = Date.now();
  const cacheKey = digest(JSON.stringify({
    manifestVersion: manifest.version,
    packs: selected.map((pack) => [pack.id, pack.version, pack.actualHash]),
    ...selector
  }));
  let staticBundle = staticPolicyCache.get(cacheKey);
  let cacheStatus = "hit";
  if (!staticBundle) {
    cacheStatus = "miss";
    staticBundle = selected.map((pack) => `## ${pack.id}@${pack.version}\n${pack.content.trim()}`).join("\n\n");
    staticPolicyCache.set(cacheKey, staticBundle);
  }
  const staticContextCompileDurationMs = Date.now() - staticStartedAt;

  const dynamicStartedAt = Date.now();
  const decisionSnapshot = typeof input.readDecisionSnapshot === "function"
    ? await input.readDecisionSnapshot()
    : input.decisionSnapshot || null;
  const dynamicContext = {
    instruction: String(input.instruction || ""),
    completionCriteria: Array.isArray(input.completionCriteria) ? input.completionCriteria : [],
    decisionSnapshot,
    projectStateDigest: input.projectStateDigest || "",
    selectedAgentDefinitions: Array.isArray(input.selectedAgentDefinitions) ? input.selectedAgentDefinitions : [],
    taskClassificationReasons: Array.isArray(input.taskClassificationReasons) ? input.taskClassificationReasons : [],
    taskMetadata: input.taskMetadata && typeof input.taskMetadata === "object" ? input.taskMetadata : {},
    selectedExecutionAgent: input.selectedExecutionAgent || "project-execution-agent",
    requiredSpecialists: Array.isArray(input.requiredSpecialists) ? input.requiredSpecialists : []
  };
  const dynamicContextCompileDurationMs = Date.now() - dynamicStartedAt;
  const hardLimit = Math.max(1000, Number(options.hardTokenLimit || process.env.GOTHAM_COMPILED_CONTEXT_HARD_TOKENS || 24000));
  const targetLimit = Math.min(hardLimit, Math.max(1000, Number(options.targetTokenLimit || process.env.GOTHAM_COMPILED_CONTEXT_TARGET_TOKENS || 10000)));
  const staticTokens = estimateTokens(staticBundle);
  const dynamicText = JSON.stringify(dynamicContext, null, 2);
  const dynamicTokens = estimateTokens(dynamicText);
  const totalTokens = staticTokens + dynamicTokens;
  if (totalTokens > hardLimit) {
    throw new Error(`Mandatory Gotham context requires ${totalTokens} estimated tokens, exceeding the hard limit of ${hardLimit}.`);
  }
  return {
    schemaVersion: "plutonix-gotham-compiled-context/v1",
    policyVersion: manifest.version,
    policyBundleHash: digest(staticBundle),
    workflowMode: selector.workflowMode,
    projectLifecycle: selector.projectLifecycle,
    taskType: selector.taskType,
    taskClassificationReasons: dynamicContext.taskClassificationReasons,
    artifactType: selector.artifactType,
    riskLevel: selector.riskLevel,
    selectedInstructionPacks: selected.map((pack) => ({ id: pack.id, version: pack.version, contentHash: pack.contentHash, mandatory: pack.mandatory })),
    selectedAgentDefinitions: dynamicContext.selectedAgentDefinitions,
    decisionSnapshot: dynamicContext.decisionSnapshot,
    projectStateDigest: dynamicContext.projectStateDigest,
    completionCriteria: dynamicContext.completionCriteria,
    compiledPolicy: staticBundle,
    dynamicContext,
    provenance: {
      manifestVersion: manifest.version,
      staticCacheKey: cacheKey,
      staticCacheStatus: cacheStatus,
      estimatedTokens: totalTokens,
      staticEstimatedTokens: staticTokens,
      dynamicEstimatedTokens: dynamicTokens,
      targetTokenLimit: targetLimit,
      hardTokenLimit: hardLimit,
      omittedOptionalPacks: manifest.packs.filter((pack) => !pack.mandatory && !selected.some((item) => item.id === pack.id)).map((pack) => pack.id),
      policySelectionDurationMs,
      staticContextCompileDurationMs,
      dynamicContextCompileDurationMs
    }
  };
}
