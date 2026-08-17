import crypto from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import { removeAgentFromProjectTopologies } from "./projectAgents.js";
import { summarizeAgentTokenEconomy } from "./tokenEconomy.js";

let globalAgentsCache = null;
let globalAgentsCacheExpiresAt = 0;
let globalAgentsBuildPromise = null;
const protectedAgentIds = new Set([
  "plutonix-fullstack-agent",
  "plutonix-independent-reviewer",
  "human-controller",
  "project-execution-agent",
  "project-orchestrator-agent",
  "qagent-controller"
]);

export function plutonixRoot() {
  if (process.env.PLUTONIX_PROJECT_ROOT) return process.env.PLUTONIX_PROJECT_ROOT;
  const cwd = process.cwd();
  if (fs.existsSync("/workspace/project/apps/backend") && fs.existsSync("/workspace/project/apps/frontend")) return "/workspace/project";
  if (path.basename(cwd) === "plutonix") return cwd;
  if (fs.existsSync(path.join(cwd, "plutonix", "apps", "backend"))) return path.join(cwd, "plutonix");
  if (fs.existsSync(path.join(cwd, "apps", "backend")) && fs.existsSync(path.join(cwd, "apps", "frontend"))) return cwd;
  return path.resolve(cwd, "../..");
}

export function workspaceRoot() {
  if (process.env.PLUTONIX_WORKSPACE_ROOT) return process.env.PLUTONIX_WORKSPACE_ROOT;
  if (fs.existsSync("/workspace/apps")) return "/workspace";
  return process.env.PLUTONIX_WORKSPACE_ROOT || path.resolve(plutonixRoot(), "..");
}

function uniquePaths(rows) {
  return [...new Set(rows.filter(Boolean).map((row) => path.resolve(row)))];
}

function sourceRootId(projectRoot) {
  return crypto.createHash("sha256").update(path.resolve(projectRoot)).digest("hex").slice(0, 16);
}

function parseEnv(source = "") {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key.trim(), rest.join("=").trim().replace(/^['"]|['"]$/g, "")];
      })
  );
}

async function readEnvFile(filePath) {
  try {
    return parseEnv(await fs.readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

function candidateOpenAiEnvFiles(root) {
  const explicitEnvFile = String(process.env.OPENAI_AGENT_ENV_FILE || "").trim();
  // An explicit path is an override, not merely an additional discovery candidate.
  // This lets callers deliberately opt out of ambient repository credentials.
  if (explicitEnvFile) return uniquePaths([explicitEnvFile]);
  const workspace = workspaceRoot();
  const builder = plutonixRoot();
  return uniquePaths([
    path.join(root, ".env.example"),
    path.join(root, ".env"),
    path.join(workspace, "apps", "geofinderx", ".env.example"),
    path.join(workspace, "apps", "geofinderx", ".env"),
    path.join(builder, "..", "apps", "geofinderx", ".env.example"),
    path.join(builder, "..", "apps", "geofinderx", ".env"),
    path.join(builder, "..", "..", "apps", "geofinderx", ".env.example"),
    path.join(builder, "..", "..", "apps", "geofinderx", ".env"),
    "/workspace/apps/geofinderx/.env.example",
    "/workspace/apps/geofinderx/.env",
    "/workspace/project/.env.example",
    "/workspace/project/.env"
  ]);
}

export async function openAiConfigFor(root) {
  const files = candidateOpenAiEnvFiles(root);
  const merged = {};
  let configSource = "";
  for (const file of files) {
    const values = await readEnvFile(file);
    for (const [key, value] of Object.entries(values)) {
      if (value) merged[key] = value;
    }
    if (values.OPENAI_API_KEY || values.OPENAI_AGENT_VECTOR_STORE_ID) configSource = path.basename(file);
  }
  for (const key of ["OPENAI_API_KEY", "OPENAI_ORG_ID", "OPENAI_PROJECT_ID", "OPENAI_AGENT_VECTOR_STORE_ID", "OPENAI_AGENT_VECTOR_STORE_NAME"]) {
    if (process.env[key]) {
      merged[key] = process.env[key];
      configSource = "process.env";
    }
  }
  return {
    apiKey: merged.OPENAI_API_KEY || "",
    orgId: merged.OPENAI_ORG_ID || "",
    projectId: merged.OPENAI_PROJECT_ID || "",
    vectorStoreId: merged.OPENAI_AGENT_VECTOR_STORE_ID || "",
    vectorStoreName: merged.OPENAI_AGENT_VECTOR_STORE_NAME || "",
    configSource
  };
}

async function api(config, apiPath, options = {}) {
  const headers = { Authorization: `Bearer ${config.apiKey}` };
  if (config.orgId) headers["OpenAI-Organization"] = config.orgId;
  if (config.projectId) headers["OpenAI-Project"] = config.projectId;
  if (options.body) headers["Content-Type"] = "application/json";
  const configuredTimeout = Number(process.env.OPENAI_AGENT_READ_TIMEOUT_MS || 6000);
  const timeoutMs = Math.max(1000, Math.min(15000, Number.isFinite(configuredTimeout) ? configuredTimeout : 6000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://api.openai.com/v1${apiPath}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error?.message || `OpenAI API ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`OpenAI agent-memory read timed out after ${timeoutMs}ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function deleteOpenAiMemoryFile(config, vectorStoreId, fileId) {
  if (!config.apiKey || !vectorStoreId || !fileId) return { fileId, status: "not_applicable" };
  try {
    await api(
      config,
      `/vector_stores/${encodeURIComponent(vectorStoreId)}/files/${encodeURIComponent(fileId)}`,
      { method: "DELETE" }
    );
  } catch (error) {
    if (error.statusCode !== 404) throw error;
  }
  try {
    await api(config, `/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  } catch (error) {
    if (error.statusCode !== 404) throw error;
  }
  return { fileId, status: "deleted" };
}

function redactKnowledgeContent(content = "") {
  return String(content)
    .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_OPENAI_KEY]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s'"`]+/gi, "$1[REDACTED]")
    .replace(/\b([A-Z0-9_]*(?:API_KEY|TOKEN|PASSWORD|SECRET))\s*=\s*[^\s]+/gi, "$1=[REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[REDACTED]@")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
}

function clippedKnowledgeContent(content = "", limit = 12000) {
  const redacted = redactKnowledgeContent(content).trim();
  if (redacted.length <= limit) return redacted;
  return `${redacted.slice(0, limit)}\n\n[Content clipped in PlutoniX after ${limit} characters. Source file remains local.]`;
}

function mdPathCandidates(value = "") {
  return [...String(value).matchAll(/(?:^|[\s,;])([A-Za-z0-9_./@-]+\.md)(?=$|[\s,;])/g)]
    .map((match) => match[1].replace(/^["'`]+|["'`]+$/g, ""))
    .filter(Boolean);
}

async function listOpenAiVectorFiles(config) {
  if (!config.apiKey || !config.vectorStoreId) return { status: "unconfigured", files: [], error: null };
  const files = [];
  let after = "";
  try {
    do {
      const query = new URLSearchParams({ limit: "100", order: "asc" });
      if (after) query.set("after", after);
      const page = await api(config, `/vector_stores/${encodeURIComponent(config.vectorStoreId)}/files?${query}`);
      files.push(...(page.data || []));
      after = page.has_more ? page.last_id : "";
    } while (after);
    return { status: "verified", files, error: null };
  } catch (error) {
    return { status: "unreachable", files: [], error: error.message };
  }
}

function candidateProjectRoots() {
  const root = workspaceRoot();
  const builder = plutonixRoot();
  const explicit = String(process.env.GLOBAL_AGENT_KNOWLEDGE_ROOTS || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return uniquePaths([...explicit, builder, path.join(root, "apps", "geofinderx"), path.join(root, "orchestrator-agent-001")]
    .concat(["/workspace/project", "/workspace/apps/geofinderx"])
    .map((entry) => path.resolve(entry)));
}

function displayProjectName(projectRoot) {
  const name = path.basename(projectRoot);
  if (name === "plutonix") return "PlutoniX";
  if (name.toLowerCase() === "geofinderx") return "GeoFinderX";
  if (name.toLowerCase() === "mapex") return "MapEx";
  if (name === "orchestrator-agent-001") return "Orchestrator Agent";
  return name;
}

function prettyProjectName(value) {
  if (String(value).toLowerCase() === "project" || String(value).toLowerCase() === "plutonix") return "PlutoniX";
  if (String(value).toLowerCase() === "mapex") return "MapEx";
  if (String(value).toLowerCase() === "geofinderx") return "GeoFinderX";
  return value;
}

async function collectFiles(directory, predicate) {
  const rows = [];
  if (!(await fs.pathExists(directory))) return rows;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...(await collectFiles(absolutePath, predicate)));
    if (entry.isFile() && predicate(absolutePath)) rows.push(absolutePath);
  }
  return rows;
}

function section(markdown, title) {
  const pattern = new RegExp(`(^|\\n)##\\s+${title}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i");
  const match = markdown.match(pattern);
  return match?.[2]?.trim() || "";
}

function frontMatter(markdown) {
  const yaml = markdown.match(/^---\n([\s\S]*?)\n---/);
  const head = yaml?.[1] || markdown.split(/\n##\s+/)[0] || "";
  const values = {};
  for (const line of head.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function bullets(value) {
  return String(value || "")
    .split(/\r?\n|,\s*/)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

function fallbackCapabilities({ role, domain, objective }) {
  const haystack = `${role} ${domain} ${objective}`.toLowerCase();
  const capabilities = [];
  if (haystack.includes("orchestrator")) capabilities.push("task routing", "specialist coordination", "workflow handoff");
  if (haystack.includes("ui") || haystack.includes("react") || haystack.includes("composition")) capabilities.push("React UI", "responsive layout", "interaction states");
  if (haystack.includes("content") || haystack.includes("data")) capabilities.push("content modeling", "metadata shaping", "copy structure");
  if (haystack.includes("runtime") || haystack.includes("packaging") || haystack.includes("docker")) capabilities.push("runtime packaging", "Vite handoff", "container readiness");
  if (haystack.includes("commerce") || haystack.includes("catalog")) capabilities.push("catalog modeling", "storefront conversion", "product details");
  if (haystack.includes("execution")) capabilities.push("local execution", "validation reporting", "project maintenance");
  if (haystack.includes("fullstack")) capabilities.push("frontend/backend integration", "Express API", "runtime orchestration");
  return capabilities.length ? capabilities : ["agent task execution", "project context handling", "handoff reporting"];
}

function scoreFromText(content, label) {
  const match = content.match(new RegExp(`${label}[^0-9]{0,24}(\\d{1,3})`, "i"));
  return match ? Math.min(100, Number(match[1])) : null;
}

function inferProfile(agent) {
  const haystack = `${agent.name} ${agent.role} ${agent.domain} ${agent.objective} ${agent.capabilities.join(" ")}`.toLowerCase();
  if (haystack.includes("execution")) return { icon: "🛠️", label: "Execution", color: "#0f766e" };
  if (haystack.includes("orchestrator")) return { icon: "🧭", label: "Orchestrator", color: "#7c3aed" };
  if (haystack.includes("fullstack") || haystack.includes("backend")) return { icon: "🧱", label: "Fullstack", color: "#334155" };
  if (haystack.includes("ui") || haystack.includes("react") || haystack.includes("composition")) return { icon: "🎨", label: "UI / Experience", color: "#2563eb" };
  if (haystack.includes("runtime") || haystack.includes("docker") || haystack.includes("packaging")) return { icon: "⚙️", label: "Runtime", color: "#0f766e" };
  if (haystack.includes("content") || haystack.includes("data")) return { icon: "🗂️", label: "Content / Data", color: "#d97706" };
  if (haystack.includes("commerce") || haystack.includes("catalog")) return { icon: "🛍️", label: "Commerce", color: "#be123c" };
  if (haystack.includes("map") || haystack.includes("geo") || haystack.includes("search")) return { icon: "🗺️", label: "Geo / Search", color: "#0891b2" };
  return { icon: "🤖", label: "Agent", color: "#475569" };
}

function agentRichness(agent) {
  const vectorScore = agent.vector?.status === "completed" ? 1000 : agent.vector?.status === "pending" ? 100 : 0;
  const textScore = [
    agent.objective,
    agent.instructionSummary,
    agent.deliverablePatterns,
    agent.validationResults,
    agent.correctionPatterns,
    agent.lessonsLearned,
    agent.reuseGuidance
  ].filter(Boolean).join(" ").length;
  return vectorScore + textScore + (agent.capabilities?.length || 0) * 20;
}

function relativeFromProject(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

async function resolveSourceReference(projectRoot, sourcePath, fallbackContent = "") {
  const normalized = String(sourcePath || "").replace(/\\/g, "/");
  const absolutePath = path.resolve(projectRoot, normalized);
  const safeInsideProject = absolutePath === projectRoot || absolutePath.startsWith(`${projectRoot}${path.sep}`);
  const exists = safeInsideProject && (await fs.pathExists(absolutePath));
  const content = exists ? await fs.readFile(absolutePath, "utf8") : fallbackContent;
  return {
    path: normalized,
    label: path.basename(normalized),
    content: content ? clippedKnowledgeContent(content, 20000) : "",
    contentSource: exists ? "local_file" : fallbackContent ? "current_record" : "metadata_only"
  };
}

async function usageCountForAgent(projectRoot, agentId, agentName) {
  const knowledgeFiles = await collectFiles(path.join(projectRoot, "memory", "agent-knowledge"), (file) => file.endsWith(".md") || file.endsWith(".txt") || file.endsWith(".json"));
  const needles = [agentId, agentName].filter(Boolean).map((value) => String(value).toLowerCase());
  let count = 0;
  for (const file of knowledgeFiles) {
    const relative = relativeFromProject(projectRoot, file).toLowerCase();
    const content = (await fs.readFile(file, "utf8").catch(() => "")).toLowerCase();
    if (needles.some((needle) => needle && (relative.includes(needle) || content.includes(needle)))) count += 1;
  }
  return count;
}

async function normalizeAgentFromMarkdown({ projectRoot, projectName, filePath, content, vector }) {
  const meta = frontMatter(content);
  const fileBase = path.basename(filePath).replace(/\.agent\.md$|\.md$/g, "");
  const agentId = meta.agent_id || fileBase.replace(/\.v\d+\.\d+\.\d+$/, "");
  const objective = section(content, "Objective") || section(content, "Responsibility") || meta.objective || "";
  const scoresText = section(content, "Capability Score Summary");
  const extractedCapabilities = [
    ...bullets(section(content, "Skills")),
    ...bullets(section(content, "Tools")).slice(0, 3)
  ].slice(0, 12);
  const role = meta.role || meta.domain || "agent";
  const domain = meta.domain || meta.workflow_class || meta.role || "general";
  const capabilities = extractedCapabilities.length
    ? extractedCapabilities
    : fallbackCapabilities({ role, domain, objective }).slice(0, 12);
  const sourcePath = relativeFromProject(projectRoot, filePath);
  const referencePaths = [...new Set([sourcePath, ...mdPathCandidates(content)])];
  const sourceReferences = [];
  for (const referencePath of referencePaths) {
    sourceReferences.push(await resolveSourceReference(projectRoot, referencePath, referencePath === sourcePath ? content : ""));
  }
  const agent = {
    id: agentId,
    name: meta.agent_name || agentId.split(/[-_]/).map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" "),
    project: prettyProjectName(meta.project_name || projectName),
    role,
    domain,
    definitionType: meta.definition_type || "",
    scope: meta.scope || "",
    status: meta.status || vector?.status || "active",
    version: meta.version || "",
    objective,
    instructionSummary: section(content, "Current Instruction Summary") || section(content, "Instruction Context"),
    capabilities,
    deliverablePatterns: section(content, "Deliverable Patterns"),
    validationResults: section(content, "Validation Results"),
    correctionPatterns: section(content, "User Correction Patterns"),
    lessonsLearned: section(content, "Lessons Learned"),
    reuseGuidance: section(content, "Reuse Guidance"),
    vectorMemoryContent: clippedKnowledgeContent(content),
    vectorMemoryContentSource: "local_agent_knowledge_file",
    efficiency: {
      capability: scoreFromText(scoresText, "capability") ?? 60,
      accuracy: scoreFromText(scoresText, "accuracy") ?? scoreFromText(scoresText, "deliverable") ?? 55,
      reliability: scoreFromText(scoresText, "reliability") ?? 55,
      adaptability: scoreFromText(scoresText, "adaptability") ?? 60,
      reuse: scoreFromText(scoresText, "reuse") ?? 50
    },
    sourcePath,
    sourceRootId: sourceRootId(projectRoot),
    sourceReferences,
    usageCount: await usageCountForAgent(projectRoot, agentId, meta.agent_name || agentId),
    vector: vector || { status: "local_only" },
    updatedAt: meta.created_at || vector?.synced_at || ""
  };
  return { ...agent, profile: inferProfile(agent) };
}

async function readVectorIndex(projectRoot) {
  const indexPath = path.join(projectRoot, "registry", "agents", "vector-sync-index.json");
  const index = (await fs.pathExists(indexPath)) ? await fs.readJson(indexPath).catch(() => ({})) : {};
  const files = index.files || {};
  const byPath = new Map();
  for (const [sourcePath, record] of Object.entries(files)) {
    byPath.set(sourcePath, { ...record, source_path: sourcePath, source: "local_sync_index" });
  }
  return { index, byPath };
}

async function readRegistryScores(projectRoot) {
  const registries = await collectFiles(path.join(projectRoot, "registry", "agents"), (file) => file.endsWith(".json"));
  const scores = new Map();
  for (const file of registries) {
    const json = await fs.readJson(file).catch(() => null);
    for (const agent of json?.agents || []) {
      if (agent.agent_id && agent.capability_scores) scores.set(agent.agent_id, agent.capability_scores);
    }
  }
  return scores;
}

function applyRegistryScores(agent, scoreRecord) {
  if (!scoreRecord) return agent;
  return {
    ...agent,
    efficiency: {
      capability: scoreRecord.capabilityScore ?? agent.efficiency.capability,
      accuracy: scoreRecord.deliverableAccuracyScore ?? agent.efficiency.accuracy,
      reliability: scoreRecord.reliabilityScore ?? agent.efficiency.reliability,
      adaptability: scoreRecord.adaptabilityScore ?? agent.efficiency.adaptability,
      reuse: scoreRecord.reuseConfidenceScore ?? agent.efficiency.reuse
    },
    successCount: scoreRecord.successCount ?? 0,
    failureCount: scoreRecord.failureCount ?? 0,
    repeatedCorrectionCount: scoreRecord.repeatedCorrectionCount ?? 0
  };
}

function mergeRemoteVectorStatus(agent, remoteByHash, remoteBySourcePath) {
  const remote = remoteByHash.get(agent.vector?.content_sha256) || remoteBySourcePath.get(agent.vector?.source_path) || remoteBySourcePath.get(agent.sourcePath);
  if (!remote) return agent;
  return {
    ...agent,
    vector: {
      ...agent.vector,
      status: remote.status === "completed" ? "completed" : remote.status || agent.vector.status,
      file_id: remote.id || agent.vector.file_id,
      source: "openai_vector_store",
      attributes: remote.attributes || null
    }
  };
}

function mergeVectorFileIntoAgent(agent, file, vectorStoreId) {
  return {
    ...agent,
    vector: {
      ...agent.vector,
      status: file.status === "completed" ? "completed" : file.status || agent.vector?.status || "unknown",
      file_id: file.id || agent.vector?.file_id,
      vector_store_id: vectorStoreId || agent.vector?.vector_store_id,
      source: "openai_vector_store",
      attributes: file.attributes || agent.vector?.attributes || null
    }
  };
}

const singletonAgentIds = new Set(["project-execution-agent", "project-orchestrator-agent", "qagent-controller", "human-controller"]);

function collapseDisplayDuplicates(agents) {
  const byKey = new Map();
  for (const agent of agents) {
    const isReusableDefinition = singletonAgentIds.has(agent.id)
      || agent.scope === "global_reusable"
      || agent.definitionType === "AgentDefinition";
    const key = isReusableDefinition ? `singleton:${agent.id}` : `${agent.project}:${agent.id}`;
    const candidate = isReusableDefinition
      ? { ...agent, project: "Shared Orchestrator Runtime" }
      : agent;
    const existing = byKey.get(key);
    if (!existing || agentRichness(candidate) > agentRichness(existing)) byKey.set(key, candidate);
  }
  return [...byKey.values()];
}

function isAgentMemoryVectorFile(file) {
  const attrs = file.attributes || {};
  return Boolean(
    attrs.agent_id &&
      (
        attrs.agent_name ||
        String(attrs.record_type || "").includes("agent_memory") ||
        String(attrs.source || "").includes("agent") ||
        String(attrs.instruction_source_paths || "").includes("agents/")
      )
  );
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  return String(value || "").toLowerCase() === "true";
}

function normalizeAgentFromVectorFile(file, vectorStoreId) {
  const attrs = file.attributes || {};
  const agentId = String(attrs.agent_id || file.id).trim();
  const domain = attrs.domain || attrs.workflow_class || "global_vector_memory";
  const role = attrs.role || domain;
  const objective =
    attrs.objective ||
    `${attrs.agent_name || agentId} is a global agent memory record synced to OpenAI Vector Store for ${String(domain).replaceAll("_", " ")} work.`;
  const capabilities = fallbackCapabilities({ role, domain, objective }).slice(0, 12);
  const scoreSeed = normalizeBoolean(attrs.requires_human_review)
    ? { capability: 58, accuracy: 52, reliability: 50, adaptability: 65, reuse: 42 }
    : { capability: 60, accuracy: 55, reliability: 55, adaptability: 60, reuse: 50 };
  const agent = {
    id: agentId,
    name: attrs.agent_name || agentId.split(/[-_]/).map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" "),
    project: prettyProjectName(attrs.project_name || "Global Vector Memory"),
    role,
    domain,
    status: attrs.status || file.status || "active",
    version: attrs.version || "",
    objective,
    instructionSummary:
      attrs.instruction_summary ||
      `Global vector memory agent record from ${attrs.source || "OpenAI Vector Store"}${attrs.instruction_source_paths ? ` with source paths: ${attrs.instruction_source_paths}` : ""}.`,
    capabilities,
    deliverablePatterns: attrs.deliverable_patterns || "",
    validationResults: attrs.validation_status || "",
    correctionPatterns: attrs.correction_summary || "",
    lessonsLearned: attrs.upgrade_notes || attrs.improvement_notes || "",
    reuseGuidance:
      attrs.reuse_guidance ||
      `Use when the objective needs ${String(domain).replaceAll("_", " ")} capability and human review requirements are acceptable.`,
    efficiency: scoreSeed,
    sourcePath: attrs.instruction_source_paths || `openai-vector-store/${file.id}`,
    sourceRootId: "",
    sourceReferences: mdPathCandidates(
      [attrs.instruction_source_paths, attrs.source_path, attrs.source_file].filter(Boolean).join(" ")
    ).map((sourcePath) => ({
      path: sourcePath,
      label: path.basename(sourcePath),
      content: "",
      contentSource: "openai_vector_store_metadata"
    })),
    usageCount: Number(attrs.usage_count || attrs.used_count || attrs.execution_count || 0),
    vector: {
      status: file.status === "completed" ? "completed" : file.status || "unknown",
      file_id: file.id,
      vector_store_id: vectorStoreId,
      source: "openai_vector_store",
      attributes: attrs
    },
    vectorMemoryContent: clippedKnowledgeContent(
      [
        "# OpenAI Vector Memory Metadata",
        "",
        "Raw OpenAI vector-store file content is not always downloadable after upload. PlutoniX is showing the retrievable vector metadata and local source pointers for this memory record.",
        "",
        `Vector file id: ${file.id}`,
        `Vector store id: ${vectorStoreId || ""}`,
        `Indexing status: ${file.status || "unknown"}`,
        "",
        "## Attributes",
        ...Object.entries(attrs)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `- ${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
      ].join("\n")
    ),
    vectorMemoryContentSource: "openai_vector_store_metadata",
    requiresHumanReview: normalizeBoolean(attrs.requires_human_review),
    updatedAt: attrs.updated_at || attrs.created_at || ""
  };
  return { ...agent, profile: inferProfile(agent) };
}

async function buildGlobalAgents() {
  const agentsByKey = new Map();
  const roots = [];
  const builderRoot = plutonixRoot();
  const tokenEconomyByAgent = await summarizeAgentTokenEconomy();
  const openAiConfig = await openAiConfigFor(path.join(workspaceRoot(), "apps", "geofinderx"));
  const remote = await listOpenAiVectorFiles(openAiConfig);
  const remoteByHash = new Map(remote.files.filter((file) => file.attributes?.content_sha256).map((file) => [file.attributes.content_sha256, file]));
  const remoteBySourcePath = new Map(remote.files.filter((file) => file.attributes?.source_path).map((file) => [file.attributes.source_path, file]));

  for (const projectRoot of candidateProjectRoots()) {
    if (!(await fs.pathExists(projectRoot))) continue;
    const projectName = displayProjectName(projectRoot);
    const { byPath } = await readVectorIndex(projectRoot);
    const registryScores = await readRegistryScores(projectRoot);
    const markdownFiles = [
      ...(await collectFiles(path.join(projectRoot, "memory", "agent-knowledge", "agents"), (file) => file.endsWith(".md"))),
      ...(await collectFiles(path.join(projectRoot, "agents", "generated"), (file) => file.endsWith(".agent.md"))),
      ...(await collectFiles(path.join(projectRoot, "agents", "custom"), (file) => file.endsWith(".agent.md"))),
      ...(await collectFiles(path.join(projectRoot, "agents", "human"), (file) => file.endsWith(".agent.md")))
    ];
    roots.push(projectRoot);

    for (const filePath of markdownFiles) {
      const sourcePath = relativeFromProject(projectRoot, filePath);
      const content = await fs.readFile(filePath, "utf8");
      const vector = byPath.get(sourcePath) || byPath.get(sourcePath.replace(/^plutonix\//, "")) || null;
      let agent = await normalizeAgentFromMarkdown({ projectRoot, projectName, filePath, content, vector });
      agent = applyRegistryScores(agent, registryScores.get(agent.id));
      agent = mergeRemoteVectorStatus(agent, remoteByHash, remoteBySourcePath);
      const key = `${agent.project}:${agent.id}`;
      const existing = agentsByKey.get(key);
      if (!existing || agentRichness(agent) > agentRichness(existing)) agentsByKey.set(key, agent);
    }
  }

  const localAgentsById = new Map();
  for (const agent of agentsByKey.values()) {
    const existing = localAgentsById.get(agent.id);
    if (!existing || agentRichness(agent) > agentRichness(existing)) localAgentsById.set(agent.id, agent);
  }

  for (const file of remote.files.filter(isAgentMemoryVectorFile)) {
    const vectorAgent = normalizeAgentFromVectorFile(file, openAiConfig.vectorStoreId);
    const key = `${vectorAgent.project}:${vectorAgent.id}`;
    const existing = agentsByKey.get(key);
    const localAgent = localAgentsById.get(vectorAgent.id);
    if (!existing && localAgent) {
      const localKey = `${localAgent.project}:${localAgent.id}`;
      agentsByKey.set(localKey, mergeVectorFileIntoAgent(localAgent, file, openAiConfig.vectorStoreId));
      continue;
    }
    if (!existing || agentRichness(vectorAgent) > agentRichness(existing)) {
      agentsByKey.set(key, vectorAgent);
    }
  }
  const mergedAgents = collapseDisplayDuplicates([...agentsByKey.values()]).map((agent) => {
    const tokenEconomy = tokenEconomyByAgent[agent.id] || {
      totalRuns: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputCredits: 0,
      outputCredits: 0,
      totalCredits: 0,
      estimatedUsd: 0,
      inputEstimatedUsd: 0,
      outputEstimatedUsd: 0,
      averageTotalTokens: 0,
      averageInputTokens: 0,
      averageOutputTokens: 0,
      averageUsd: 0,
      averageAccuracyValue: 0,
      averageEfficiencyScore: 0,
      averageAbilityScore: 0,
      tokensPerAccuracyPoint: 0,
      usdPerAccuracyPoint: 0,
      lastRunAt: "",
      timeline: []
    };
    return {
      ...agent,
      deletion: protectedAgentIds.has(agent.id)
        ? {
            allowed: false,
            reason: "This is a required PlutoniX system agent and cannot be deleted independently."
          }
        : {
            allowed: true,
            reason: "Deletes this agent definition, local agent memory, topology membership, and linked vector memory."
          },
      efficiency: {
        ...agent.efficiency,
        accuracy: tokenEconomy.averageAccuracyValue || agent.efficiency?.accuracy || 0,
        capability: tokenEconomy.averageAbilityScore || agent.efficiency?.capability || 0,
        economy: tokenEconomy.averageEfficiencyScore || 0
      },
      tokenEconomy
    };
  });
  const vectorOnlyAgentCount = mergedAgents.filter((agent) => agent.project === "Global Vector Memory").length;
  mergedAgents.sort((a, b) => {
    const lastUsedDiff =
      new Date(b.tokenEconomy?.lastRunAt || 0).getTime() - new Date(a.tokenEconomy?.lastRunAt || 0).getTime();
    if (lastUsedDiff) return lastUsedDiff;
    const runDiff = Number(b.tokenEconomy?.totalRuns || 0) - Number(a.tokenEconomy?.totalRuns || 0);
    if (runDiff) return runDiff;
    return `${a.project}:${a.name}`.localeCompare(`${b.project}:${b.name}`);
  });
  return {
    status: "ok",
    source: {
      type: "global-agent-knowledge",
      workspaceRoot: workspaceRoot(),
      scannedRoots: roots,
      openaiVectorStore: {
        status: remote.status,
        id: openAiConfig.vectorStoreId ? `${openAiConfig.vectorStoreId.slice(0, 8)}…${openAiConfig.vectorStoreId.slice(-4)}` : null,
        name: openAiConfig.vectorStoreName || null,
        fileCount: remote.files.length,
        hasApiKey: Boolean(openAiConfig.apiKey),
        hasVectorStoreId: Boolean(openAiConfig.vectorStoreId),
        configSource: openAiConfig.configSource || null,
        agentMemoryFileCount: remote.files.filter(isAgentMemoryVectorFile).length,
        vectorOnlyAgentCount,
        error: remote.error || null
      },
      generatedAt: new Date().toISOString(),
      contentHash: crypto.createHash("sha256").update(JSON.stringify(mergedAgents.map((agent) => [agent.id, agent.sourcePath, agent.vector?.status]))).digest("hex")
    },
    agents: mergedAgents
  };
}

function globalAgentCacheTtlMs() {
  const configuredTtl = Number(process.env.GLOBAL_AGENT_CACHE_TTL_MS || 120000);
  return Math.max(30000, Math.min(600000, Number.isFinite(configuredTtl) ? configuredTtl : 120000));
}

function cacheGlobalAgentResult(result) {
  globalAgentsCache = result;
  globalAgentsCacheExpiresAt = Date.now() + globalAgentCacheTtlMs();
}

function cachedGlobalAgentResult(status) {
  return {
    ...globalAgentsCache,
    source: {
      ...globalAgentsCache.source,
      cache: { status, expiresAt: new Date(globalAgentsCacheExpiresAt).toISOString() }
    }
  };
}

export async function listGlobalAgents() {
  const now = Date.now();
  if (globalAgentsCache && now < globalAgentsCacheExpiresAt) {
    return cachedGlobalAgentResult("fresh");
  }
  if (globalAgentsCache) {
    if (!globalAgentsBuildPromise) {
      globalAgentsBuildPromise = buildGlobalAgents()
        .then((result) => {
          cacheGlobalAgentResult(result);
          return result;
        })
        .catch(() => globalAgentsCache)
        .finally(() => {
          globalAgentsBuildPromise = null;
        });
    }
    return cachedGlobalAgentResult("stale-refreshing");
  }
  if (globalAgentsBuildPromise) {
    return globalAgentsBuildPromise;
  }

  globalAgentsBuildPromise = buildGlobalAgents();
  try {
    const result = await globalAgentsBuildPromise;
    cacheGlobalAgentResult(result);
    return cachedGlobalAgentResult("fresh");
  } finally {
    globalAgentsBuildPromise = null;
  }
}

export function invalidateGlobalAgentsCache() {
  globalAgentsCache = null;
  globalAgentsCacheExpiresAt = 0;
  globalAgentsBuildPromise = null;
}

function isApprovedAgentPath(relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/").replace(/^\/+/, "");
  return [
    "agents/generated/",
    "agents/custom/",
    "agents/human/",
    "memory/agent-knowledge/agents/"
  ].some((prefix) => normalized.startsWith(prefix));
}

function fileOwnedByAgent(filePath, agentId) {
  const name = path.basename(filePath).toLowerCase();
  const id = String(agentId || "").toLowerCase();
  return (
    name === `${id}.md` ||
    name === `${id}.agent.md` ||
    name.startsWith(`${id}.v`) ||
    name.startsWith(`${id}.memory.`)
  );
}

async function pruneAgentRegistries(projectRoot, agentId, removedRelativePaths, remoteFileIds) {
  const registryRoot = path.join(projectRoot, "registry", "agents");
  const registryFiles = await collectFiles(registryRoot, (file) => file.endsWith(".json"));
  const updated = [];
  const removed = [];
  const removedPaths = new Set(removedRelativePaths);
  const remoteIds = new Set(remoteFileIds);

  for (const file of registryFiles) {
    const json = await fs.readJson(file).catch(() => null);
    if (!json) continue;
    if (json.agent_id === agentId) {
      await fs.remove(file);
      removed.push(relativeFromProject(projectRoot, file));
      continue;
    }
    let changed = false;
    if (Array.isArray(json.agents)) {
      const nextAgents = json.agents.filter((agent) => {
        const id = typeof agent === "string" ? agent : agent?.agent_id || agent?.id;
        return id !== agentId;
      });
      changed = nextAgents.length !== json.agents.length;
      json.agents = nextAgents;
    }
    if (json.files && typeof json.files === "object") {
      for (const [sourcePath, record] of Object.entries(json.files)) {
        if (
          removedPaths.has(sourcePath) ||
          remoteIds.has(record?.file_id) ||
          fileOwnedByAgent(sourcePath, agentId)
        ) {
          delete json.files[sourcePath];
          changed = true;
        }
      }
    }
    if (changed) {
      await fs.writeJson(file, json, { spaces: 2 });
      updated.push(relativeFromProject(projectRoot, file));
    }
  }
  return { updated, removed };
}

function selectedAgentRecord(agents, selector) {
  const candidates = agents.filter((agent) => agent.id === selector.agentId);
  if (!candidates.length) return null;
  return (
    candidates.find(
      (agent) =>
        (!selector.sourceRootId || agent.sourceRootId === selector.sourceRootId) &&
        (!selector.sourcePath || agent.sourcePath === selector.sourcePath) &&
        (!selector.project || agent.project === selector.project) &&
        (!selector.vectorFileId || agent.vector?.file_id === selector.vectorFileId)
    ) || null
  );
}

export async function deleteGlobalAgent(selector = {}) {
  const agentId = String(selector.agentId || "").trim();
  if (!agentId) {
    const error = new Error("Agent ID is required.");
    error.statusCode = 400;
    throw error;
  }
  if (protectedAgentIds.has(agentId)) {
    const error = new Error("This required PlutoniX system agent cannot be deleted independently.");
    error.statusCode = 409;
    throw error;
  }

  const snapshot = await listGlobalAgents();
  const agent = selectedAgentRecord(snapshot.agents || [], { ...selector, agentId });
  if (!agent) {
    const error = new Error("Agent was not found or the deletion selector is stale.");
    error.statusCode = 404;
    throw error;
  }

  const roots = candidateProjectRoots().filter((root) => fs.existsSync(root));
  const selectedRoot = agent.sourceRootId
    ? roots.find((root) => sourceRootId(root) === agent.sourceRootId)
    : null;
  const config = await openAiConfigFor(selectedRoot || plutonixRoot());
  const hasLinkedVectorMemory = Boolean(agent.vector?.file_id || selector.vectorFileId);
  if (hasLinkedVectorMemory && (!config.apiKey || !config.vectorStoreId)) {
    const error = new Error("OpenAI Vector Store credentials are required before this agent memory can be deleted.");
    error.statusCode = 409;
    throw error;
  }
  const remote = await listOpenAiVectorFiles(config);
  if (hasLinkedVectorMemory && remote.status === "unreachable") {
    const error = new Error(remote.error || "OpenAI Vector Store could not be reached.");
    error.statusCode = 503;
    throw error;
  }
  const remoteFiles = remote.files.filter((file) => {
    const attributes = file.attributes || {};
    return (
      file.id === agent.vector?.file_id ||
      file.id === selector.vectorFileId ||
      String(attributes.agent_id || "") === agentId
    );
  });
  const remoteFileIds = new Set(remoteFiles.map((file) => file.id));
  for (const fileId of [agent.vector?.file_id, selector.vectorFileId].filter(Boolean)) {
    remoteFileIds.add(fileId);
  }

  const remoteMemory = [];
  for (const fileId of remoteFileIds) {
    remoteMemory.push(await deleteOpenAiMemoryFile(config, config.vectorStoreId, fileId));
  }

  const removedRelativePaths = [];
  if (selectedRoot) {
    const sourcePath = String(agent.sourcePath || "").replaceAll("\\", "/").replace(/^\/+/, "");
    if (isApprovedAgentPath(sourcePath)) {
      const sourceAbsolutePath = path.resolve(selectedRoot, sourcePath);
      if (sourceAbsolutePath.startsWith(`${path.resolve(selectedRoot)}${path.sep}`)) {
        await fs.remove(sourceAbsolutePath);
        removedRelativePaths.push(sourcePath);
      }
    }
    for (const relativeRoot of [
      "agents/generated",
      "agents/custom",
      "agents/human",
      "memory/agent-knowledge/agents"
    ]) {
      const directory = path.join(selectedRoot, relativeRoot);
      const files = await collectFiles(directory, (file) => fileOwnedByAgent(file, agentId));
      for (const file of files) {
        await fs.remove(file);
        removedRelativePaths.push(relativeFromProject(selectedRoot, file));
      }
    }
  }

  const topology = await removeAgentFromProjectTopologies(agentId, {
    project: agent.project,
    sourcePath: agent.sourcePath
  });
  const registries = selectedRoot
    ? await pruneAgentRegistries(
        selectedRoot,
        agentId,
        removedRelativePaths,
        remoteMemory.map((item) => item.fileId)
      )
    : { updated: [], removed: [] };
  invalidateGlobalAgentsCache();
  const refreshed = await listGlobalAgents();
  const stillPresent = Boolean(
    selectedAgentRecord(refreshed.agents || [], {
      agentId,
      sourceRootId: agent.sourceRootId,
      sourcePath: agent.sourcePath,
      project: agent.project,
      vectorFileId: agent.vector?.file_id
    })
  );
  return {
    status: stillPresent ? "partial" : "deleted",
    agent: {
      id: agent.id,
      name: agent.name,
      project: agent.project
    },
    removedLocalPaths: [...new Set(removedRelativePaths)],
    removedProjectLocalPathCount: (topology.removedLocalPaths || []).length,
    updatedTopologies: topology.updatedTopologies,
    registries,
    remoteMemory,
    stillPresent
  };
}
