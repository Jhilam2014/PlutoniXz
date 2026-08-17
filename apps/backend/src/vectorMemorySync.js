import crypto from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import { plutonixRoot, openAiConfigFor, workspaceRoot } from "./globalAgentKnowledge.js";

const SYNC_FILE_EXTENSIONS = new Set([".md", ".txt", ".json"]);
const DEFAULT_MIN_PENDING_FILES = 5;
let activeSyncPromise = null;
let lastScheduledAt = 0;

function uniquePaths(rows) {
  return [...new Set(rows.filter(Boolean).map((row) => path.resolve(row)))];
}

function redact(content = "") {
  return String(content)
    .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_OPENAI_KEY]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s'"`]+/gi, "$1[REDACTED]")
    .replace(/\b([A-Z0-9_]*(?:API_KEY|TOKEN|PASSWORD|SECRET))\s*=\s*[^\s]+/gi, "$1=[REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[REDACTED]@")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
}

function displayProjectName(projectRoot) {
  const name = path.basename(projectRoot);
  if (name === "plutonix") return "PlutoniX";
  if (name.toLowerCase() === "geofinderx") return "GeoFinderX";
  if (name === "orchestrator-agent-001") return "Orchestrator Agent";
  return name;
}

function syncCandidateRoots() {
  const workspace = workspaceRoot();
  const builder = plutonixRoot();
  const explicit = String(process.env.AGENT_MEMORY_SYNC_ROOTS || process.env.GLOBAL_AGENT_KNOWLEDGE_ROOTS || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return uniquePaths([
    ...explicit,
    builder,
    path.join(workspace, "apps", "geofinderx"),
    path.join(workspace, "orchestrator-agent-001"),
    "/workspace/project",
    "/workspace/apps/geofinderx"
  ]);
}

function categoryFor(relativePath) {
  if (relativePath.includes("/prompts/")) return "agent_prompts";
  if (relativePath.includes("/projects/")) return "project_summaries";
  if (relativePath.includes("/corrections/")) return "correction_patterns";
  if (relativePath.includes("/upgrades/")) return "upgrade_notes";
  return "agent_knowledge";
}

function frontMatter(markdown = "") {
  const yaml = String(markdown).match(/^---\n([\s\S]*?)\n---/);
  const source = yaml?.[1] || String(markdown).split(/\n##\s+|\n#\s+/)[0] || "";
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function attr(value, fallback = "") {
  return String(value || fallback || "").slice(0, 512);
}

async function collectKnowledgeFiles(directory) {
  const files = [];
  if (!(await fs.pathExists(directory))) return files;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectKnowledgeFiles(absolutePath)));
    if (entry.isFile() && SYNC_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(absolutePath);
  }
  return files.sort();
}

async function knowledgeFilesForRoot(projectRoot) {
  return (
    await Promise.all(
      [
        path.join(projectRoot, "memory", "agent-knowledge"),
        path.join(projectRoot, "agents", "generated"),
        path.join(projectRoot, "agents", "custom"),
        path.join(projectRoot, "agents", "human")
      ].map((directory) => collectKnowledgeFiles(directory))
    )
  )
    .flat()
    .sort();
}

export function vectorSyncMinimumPendingFiles(value = process.env.AGENT_MEMORY_SYNC_MIN_PENDING_FILES) {
  const configured = Number(value);
  return Number.isFinite(configured) && configured > 0
    ? Math.max(1, Math.floor(configured))
    : DEFAULT_MIN_PENDING_FILES;
}

export function vectorSyncDecision({ systemIdle = true, pendingSyncCount = 0, minPendingFiles = vectorSyncMinimumPendingFiles() } = {}) {
  if (!systemIdle) {
    return { shouldRun: false, status: "deferred", reason: "system_busy", minPendingFiles };
  }
  if (pendingSyncCount < minPendingFiles) {
    return { shouldRun: false, status: "deferred", reason: "below_pending_threshold", minPendingFiles };
  }
  return { shouldRun: true, status: "ready", reason: "pending_threshold_met", minPendingFiles };
}

async function readJson(filePath, fallback = {}) {
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJson(filePath, value, { spaces: 2 });
}

async function api(config, apiPath, init = {}) {
  const headers = { Authorization: `Bearer ${config.apiKey}`, ...(init.headers || {}) };
  if (config.orgId) headers["OpenAI-Organization"] = config.orgId;
  if (config.projectId) headers["OpenAI-Project"] = config.projectId;
  const response = await fetch(`https://api.openai.com/v1${apiPath}`, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${body.error?.message || "request failed"}`);
  return body;
}

async function listAttachedFiles(config) {
  const rows = [];
  let after = "";
  do {
    const query = new URLSearchParams({ limit: "100", order: "asc" });
    if (after) query.set("after", after);
    const page = await api(config, `/vector_stores/${encodeURIComponent(config.vectorStoreId)}/files?${query}`);
    rows.push(...(page.data || []));
    after = page.has_more ? page.last_id : "";
  } while (after);
  return rows;
}

async function attachKnowledgeFile({ config, filePath, relativePath, projectRoot, contentHash, sanitized }) {
  const projectName = displayProjectName(projectRoot);
  const meta = frontMatter(sanitized);
  const form = new FormData();
  form.set("purpose", "assistants");
  form.set(
    "file",
    new Blob([`Source: ${relativePath}\nProject: ${projectName}\n\n${sanitized}`], { type: "text/markdown" }),
    path.basename(relativePath)
  );
  const uploaded = await api(config, "/files", { method: "POST", body: form });
  const attached = await api(config, `/vector_stores/${encodeURIComponent(config.vectorStoreId)}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_id: uploaded.id,
      attributes: {
        project: projectName,
        project_name: projectName,
        agent_id: attr(meta.agent_id),
        agent_name: attr(meta.agent_name),
        version: attr(meta.version),
        domain: attr(meta.domain),
        workflow_class: attr(meta.workflow_class),
        status: attr(meta.status),
        content_type: attr(meta.content_type, categoryFor(`/${relativePath}`)),
        collection: categoryFor(`/${relativePath}`),
        source: "plutonix-periodic-sync",
        source_path: relativePath.slice(0, 512),
        source_file: path.relative(workspaceRoot(), filePath).split(path.sep).join("/").slice(0, 512),
        content_sha256: contentHash,
        sync_reason: "local_memory_candidate",
        synced_by: "plutonix"
      }
    })
  });
  return attached;
}

async function pendingSyncWork() {
  const roots = [];
  const rows = [];
  for (const projectRoot of syncCandidateRoots()) {
    if (!(await fs.pathExists(path.join(projectRoot, "memory", "agent-knowledge")))) continue;
    const files = await knowledgeFilesForRoot(projectRoot);
    const syncIndexPath = path.join(projectRoot, "registry", "agents", "vector-sync-index.json");
    const index = await readJson(syncIndexPath, { files: {} });
    index.files ||= {};
    let pending = 0;
    for (const filePath of files) {
      const relativePath = path.relative(projectRoot, filePath).split(path.sep).join("/");
      try {
        const contentHash = crypto.createHash("sha256").update(redact(await fs.readFile(filePath, "utf8"))).digest("hex");
        const prior = index.files[relativePath];
        if (prior?.content_sha256 === contentHash && ["completed", "in_progress"].includes(prior?.status)) continue;
      } catch {
        // A file that cannot be read is retained as pending so the sync can
        // record a precise failure when the system is idle.
      }
      pending += 1;
    }
    roots.push(projectRoot);
    rows.push({ projectRoot, projectName: displayProjectName(projectRoot), files, pending });
  }
  return {
    roots,
    rows,
    pendingSyncCount: rows.reduce((sum, row) => sum + row.pending, 0)
  };
}

async function syncRoot({ config, projectRoot, remoteByHash, shouldContinue = () => true }) {
  const files = await knowledgeFilesForRoot(projectRoot);
  const syncIndexPath = path.join(projectRoot, "registry", "agents", "vector-sync-index.json");
  const index = await readJson(syncIndexPath, { provider: "openai", vector_store_id: config.vectorStoreId, files: {} });
  index.provider = "openai";
  index.vector_store_id = config.vectorStoreId;
  index.files ||= {};

  const uploaded = [];
  const skipped = [];
  const failed = [];
  let deferred = false;

  for (const filePath of files) {
    if (!(await shouldContinue())) {
      deferred = true;
      break;
    }
    const relativePath = path.relative(projectRoot, filePath).split(path.sep).join("/");
    try {
      const sanitized = redact(await fs.readFile(filePath, "utf8"));
      const contentHash = crypto.createHash("sha256").update(sanitized).digest("hex");
      const prior = index.files[relativePath];
      const remote = remoteByHash.get(contentHash);

      if ((prior?.content_sha256 === contentHash && ["completed", "in_progress"].includes(prior?.status)) || remote) {
        index.files[relativePath] = {
          content_sha256: contentHash,
          file_id: prior?.file_id || remote?.id || "",
          status: remote?.status || prior?.status || "completed",
          vector_store_id: config.vectorStoreId,
          synced_at: prior?.synced_at || new Date().toISOString()
        };
        skipped.push(relativePath);
        continue;
      }

      const attached = await attachKnowledgeFile({ config, filePath, relativePath, projectRoot, contentHash, sanitized });
      index.files[relativePath] = {
        content_sha256: contentHash,
        file_id: attached.id,
        status: attached.status || "in_progress",
        vector_store_id: config.vectorStoreId,
        synced_at: new Date().toISOString()
      };
      remoteByHash.set(contentHash, attached);
      uploaded.push(relativePath);
      await writeJson(syncIndexPath, index);
    } catch (error) {
      failed.push({ path: relativePath, error: error.message });
    }
  }

  index.last_sync_at = new Date().toISOString();
  await writeJson(syncIndexPath, index);
  return { projectRoot, projectName: displayProjectName(projectRoot), scanned: files.length, uploaded, skipped, failed, deferred };
}

async function writeSyncLogs(summary) {
  const builder = plutonixRoot();
  await writeJson(path.join(builder, "observability", "agent-memory", "latest-sync.json"), summary);
  await writeJson(path.join(builder, "observability", "vector-memory", "latest-vector-write.json"), summary);
  if (summary.status === "failed" || summary.files_failed > 0) {
    await writeJson(path.join(builder, "memory", "pending-sync", `${summary.workflow_id}.vector-sync.json`), summary);
  }
}

function deferredSummary({ workflowId, reason, startedAt, pendingSyncCount, decision } = {}) {
  return {
    workflow_id: workflowId,
    reason,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    status: "deferred",
    deferred_reason: decision.reason,
    min_pending_files: decision.minPendingFiles,
    local_files_scanned: 0,
    files_uploaded: 0,
    files_skipped: 0,
    files_failed: 0,
    pending_sync_count: pendingSyncCount
  };
}

export async function syncKnownAgentKnowledgeRoots({
  reason = "manual",
  emit = null,
  isSystemIdle = () => true,
  minPendingFiles = vectorSyncMinimumPendingFiles()
} = {}) {
  if (String(process.env.AGENT_MEMORY_SYNC_ENABLED || "true").toLowerCase() === "false") {
    const skipped = {
      workflow_id: `plutonix-vector-sync-${Date.now()}`,
      status: "skipped",
      reason: "AGENT_MEMORY_SYNC_ENABLED=false",
      completed_at: new Date().toISOString()
    };
    await writeSyncLogs(skipped);
    return skipped;
  }

  const startedAt = new Date().toISOString();
  const workflowId = `plutonix-vector-sync-${Date.now()}`;
  if (!(await isSystemIdle())) {
    const summary = deferredSummary({
      workflowId,
      reason,
      startedAt,
      pendingSyncCount: 0,
      decision: vectorSyncDecision({ systemIdle: false, minPendingFiles })
    });
    emit?.("vector-sync-deferred", "Vector memory sync deferred until the system is idle.", summary);
    return summary;
  }

  const pendingWork = await pendingSyncWork();
  const decision = vectorSyncDecision({
    systemIdle: await isSystemIdle(),
    pendingSyncCount: pendingWork.pendingSyncCount,
    minPendingFiles
  });
  if (!decision.shouldRun) {
    const summary = deferredSummary({
      workflowId,
      reason,
      startedAt,
      pendingSyncCount: pendingWork.pendingSyncCount,
      decision
    });
    await writeSyncLogs(summary);
    emit?.("vector-sync-deferred", decision.reason === "system_busy"
      ? "Vector memory sync deferred until the system is idle."
      : `Vector memory sync deferred until at least ${decision.minPendingFiles} files are pending.`, summary);
    return summary;
  }

  const config = await openAiConfigFor(path.join(workspaceRoot(), "apps", "geofinderx"));
  if (!config.apiKey || !config.vectorStoreId) {
    const summary = {
      workflow_id: workflowId,
      reason,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: "failed",
      errors: ["Missing OPENAI_API_KEY or OPENAI_AGENT_VECTOR_STORE_ID."],
      vector_store_id: config.vectorStoreId ? `${config.vectorStoreId.slice(0, 8)}…${config.vectorStoreId.slice(-4)}` : null,
      local_files_scanned: 0,
      files_uploaded: 0,
      files_skipped: 0,
      files_failed: 0,
      pending_sync_count: 0
    };
    await writeSyncLogs(summary);
    return summary;
  }

  if (!(await isSystemIdle())) {
    const summary = deferredSummary({
      workflowId,
      reason,
      startedAt,
      pendingSyncCount: pendingWork.pendingSyncCount,
      decision: vectorSyncDecision({ systemIdle: false, pendingSyncCount: pendingWork.pendingSyncCount, minPendingFiles })
    });
    await writeSyncLogs(summary);
    emit?.("vector-sync-deferred", "Vector memory sync deferred until the system is idle.", summary);
    return summary;
  }

  emit?.("vector-sync-started", "Syncing pending VectorDB memory to OpenAI Vector Store while the system is idle", {
    reason,
    pendingSyncCount: pendingWork.pendingSyncCount,
    minPendingFiles
  });
  const roots = [];
  const remote = await listAttachedFiles(config);
  const remoteByHash = new Map(remote.filter((file) => file.attributes?.content_sha256).map((file) => [file.attributes.content_sha256, file]));
  const rootResults = [];
  let interruptedForActiveWork = false;

  for (const projectRoot of pendingWork.roots) {
    if (!(await isSystemIdle())) {
      interruptedForActiveWork = true;
      break;
    }
    if (!(await fs.pathExists(path.join(projectRoot, "memory", "agent-knowledge")))) continue;
    roots.push(projectRoot);
    const rootResult = await syncRoot({ config, projectRoot, remoteByHash, shouldContinue: isSystemIdle });
    rootResults.push(rootResult);
    if (rootResult.deferred) {
      interruptedForActiveWork = true;
      break;
    }
  }

  const filesUploaded = rootResults.reduce((sum, row) => sum + row.uploaded.length, 0);
  const filesSkipped = rootResults.reduce((sum, row) => sum + row.skipped.length, 0);
  const failures = rootResults.flatMap((row) => row.failed.map((failure) => ({ ...failure, project: row.projectName })));
  const summary = {
    workflow_id: workflowId,
    reason,
    provider: "openai",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    vector_store_id: `${config.vectorStoreId.slice(0, 8)}…${config.vectorStoreId.slice(-4)}`,
    config_source: config.configSource || null,
    scanned_roots: roots,
    local_files_scanned: rootResults.reduce((sum, row) => sum + row.scanned, 0),
    files_uploaded: filesUploaded,
    files_skipped: filesSkipped,
    files_failed: failures.length,
    pending_sync_count: interruptedForActiveWork ? Math.max(1, pendingWork.pendingSyncCount - filesUploaded - filesSkipped) : failures.length,
    min_pending_files: minPendingFiles,
    status: interruptedForActiveWork ? "deferred" : failures.length ? "partial" : "success",
    deferred_reason: interruptedForActiveWork ? "system_became_busy" : "",
    errors: failures,
    roots: rootResults.map((row) => ({
      project: row.projectName,
      scanned: row.scanned,
      uploaded: row.uploaded,
      skipped: row.skipped,
      failed: row.failed
    }))
  };
  await writeSyncLogs(summary);
  emit?.(summary.status === "success" ? "vector-sync-complete" : summary.status === "deferred" ? "vector-sync-deferred" : "vector-sync-partial", `Vector memory sync ${summary.status}: ${filesUploaded} uploaded, ${filesSkipped} unchanged`, {
    reason,
    filesUploaded,
    filesSkipped,
    filesFailed: failures.length
  });
  return summary;
}

export function scheduleAgentMemorySync({
  reason = "periodic",
  emit = null,
  minSpacingMs = 60_000,
  isSystemIdle = () => true,
  minPendingFiles = vectorSyncMinimumPendingFiles()
} = {}) {
  if (activeSyncPromise) return activeSyncPromise;
  return Promise.resolve(isSystemIdle()).then((systemIdle) => {
    if (activeSyncPromise) return activeSyncPromise;
    if (!systemIdle) {
      const summary = deferredSummary({
        workflowId: `plutonix-vector-sync-${Date.now()}`,
        reason,
        startedAt: new Date().toISOString(),
        pendingSyncCount: 0,
        decision: vectorSyncDecision({ systemIdle: false, minPendingFiles })
      });
      emit?.("vector-sync-deferred", "Vector memory sync queued until the system is idle.", summary);
      return summary;
    }
    const now = Date.now();
    if (now - lastScheduledAt < minSpacingMs) return null;
    lastScheduledAt = now;
    activeSyncPromise = syncKnownAgentKnowledgeRoots({ reason, emit, isSystemIdle, minPendingFiles })
      .catch(async (error) => {
        const summary = {
          workflow_id: `plutonix-vector-sync-${Date.now()}`,
          reason,
          status: "failed",
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          errors: [error.message],
          local_files_scanned: 0,
          files_uploaded: 0,
          files_skipped: 0,
          files_failed: 1,
          pending_sync_count: 1
        };
        await writeSyncLogs(summary);
        emit?.("vector-sync-failed", error.message, { reason });
        return summary;
      })
      .finally(() => {
        activeSyncPromise = null;
      });
    return activeSyncPromise;
  });
}
