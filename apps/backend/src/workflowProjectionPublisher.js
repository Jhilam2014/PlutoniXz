import crypto from "node:crypto";
import fs from "fs-extra";
import { open as openFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publishProjectAgentTopology } from "./projectAgents.js";
import { redactOperational } from "./operationalSecurity.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const WORKFLOW_PUBLICATION_SCHEMA_VERSION = "plutomix-workflow-publication/v1";
export const WORKFLOW_PUBLISHER_VERSION = "workflow-projection-publisher/v1";

function publisherRoot(explicitRoot) {
  return explicitRoot || process.env.WORKFLOW_PUBLICATION_ROOT || process.env.PLUTOMIX_PROJECT_ROOT || repoRoot;
}

function safeFileBase(value) {
  return String(value || "workflow-publication")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180) || "workflow-publication";
}

function digest(value) {
  const content = typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value || {});
  return crypto.createHash("sha256").update(content).digest("hex");
}

function normalizedFiles(files = []) {
  return [...new Set((Array.isArray(files) ? files : []).map((file) => String(typeof file === "string" ? file : file?.path || "").trim()).filter(Boolean))].sort();
}

async function changedFileDigests(files, workspaceDir) {
  const result = {};
  if (!workspaceDir) return result;
  const resolvedWorkspace = path.resolve(workspaceDir);
  const queue = normalizedFiles(files);
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const relativePath = queue[cursor++];
      const absolutePath = path.resolve(resolvedWorkspace, relativePath);
      if (absolutePath !== resolvedWorkspace && !absolutePath.startsWith(`${resolvedWorkspace}${path.sep}`)) {
        result[relativePath] = { status: "outside_workspace", sha256: null };
        continue;
      }
      try {
        const stat = await fs.stat(absolutePath);
        if (!stat.isFile()) {
          result[relativePath] = { status: "not_a_file", sha256: null };
          continue;
        }
        const content = await fs.readFile(absolutePath);
        result[relativePath] = { status: "present", sha256: digest(content), size: stat.size };
      } catch (error) {
        result[relativePath] = { status: error.code === "ENOENT" ? "removed" : "unavailable", sha256: null };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, () => worker()));
  return result;
}

export async function buildWorkflowPublicationReceipt(input = {}) {
  const workflowId = String(input.workflowId || input.parentWorkflowId || input.result?.parentWorkflowId || input.result?.buildId || input.buildId || "").slice(0, 240);
  const changedFiles = normalizedFiles(input.changedFiles || input.result?.files);
  const fileDigests = input.changedFileDigests || await changedFileDigests(changedFiles, input.workspaceDir || input.project?.workspaceDir || "");
  const startedAt = input.startedAt || new Date().toISOString();
  const completedAt = input.completedAt || new Date().toISOString();
  const base = redactOperational({
    schemaVersion: WORKFLOW_PUBLICATION_SCHEMA_VERSION,
    publisherVersion: WORKFLOW_PUBLISHER_VERSION,
    workflowId,
    parentWorkflowId: String(input.parentWorkflowId || input.result?.parentWorkflowId || workflowId).slice(0, 240),
    childExecutionIds: Array.isArray(input.childExecutionIds || input.result?.childExecutionIds) ? (input.childExecutionIds || input.result?.childExecutionIds).slice(0, 100).map(String) : [],
    projectId: String(input.projectId || input.project?.id || "").slice(0, 240),
    projectName: String(input.projectName || input.project?.name || "PlutoMix default workspace").slice(0, 320),
    taskType: String(input.taskType || "Medium").slice(0, 80),
    workflowMode: String(input.workflowMode || "executor").slice(0, 80),
    status: String(input.status || "failed").slice(0, 80),
    startedAt,
    completedAt,
    durationMs: Number.isFinite(input.durationMs) ? input.durationMs : Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
    selectedModel: String(input.selectedModel || input.result?.runtime?.selectedModel || input.workflowRecovery?.fallbackModel || "").slice(0, 320),
    adaptiveRoute: input.adaptiveRoute || input.result?.adaptiveRoute || input.flowPath?.adaptiveRoute || null,
    selectedPath: String(input.selectedPath || input.flowPath?.selectedPath || "").slice(0, 320),
    selectedBranches: Array.isArray(input.selectedBranches) ? input.selectedBranches : [],
    rejectedBranches: Array.isArray(input.rejectedBranches) ? input.rejectedBranches : [],
    deferredBranches: Array.isArray(input.deferredBranches) ? input.deferredBranches : [],
    rejectedPaths: Array.isArray(input.rejectedPaths) ? input.rejectedPaths : [],
    deferredPaths: Array.isArray(input.deferredPaths) ? input.deferredPaths : [],
    reconsiderationState: input.reconsiderationState || { current: "unchanged", automaticActivationAllowed: false },
    agentsUsed: Array.isArray(input.agentsUsed) ? input.agentsUsed.slice(0, 100) : (input.flowPath?.activeAgents || []).slice(0, 100),
    changedFiles,
    changedFileDigests: fileDigests,
    validation: input.validation || input.result?.validation || null,
    productShapeValidation: input.productShapeValidation || input.result?.productShapeValidation || null,
    inputConsumption: input.inputConsumption || input.result?.inputConsumption || null,
    review: input.review || input.result?.review || null,
    workflowRecovery: input.workflowRecovery || input.result?.workflowRecovery || null,
    orchestrationSnapshot: input.orchestrationSnapshot || null,
    flowPath: input.flowPath || null,
    instructionSummary: String(input.instructionSummary || "").replace(/\s+/g, " ").trim().slice(0, 600),
    error: String(input.error || "").replace(/\s+/g, " ").trim().slice(0, 2000),
    timings: {
      preparationDurationMs: Number.isFinite(input.timings?.preparationDurationMs) ? input.timings.preparationDurationMs : null,
      decisionPersistenceDurationMs: Number.isFinite(input.timings?.decisionPersistenceDurationMs) ? input.timings.decisionPersistenceDurationMs : null,
      modelExecutionDurationMs: Number.isFinite(input.timings?.modelExecutionDurationMs) ? input.timings.modelExecutionDurationMs : null,
      validationDurationMs: Number.isFinite(input.timings?.validationDurationMs) ? input.timings.validationDurationMs : null,
      previewDurationMs: Number.isFinite(input.timings?.previewDurationMs) ? input.timings.previewDurationMs : null,
      publicationQueueDurationMs: Number.isFinite(input.timings?.publicationQueueDurationMs) ? input.timings.publicationQueueDurationMs : null,
      publicationDurationMs: null
    }
  });
  const resultDigest = digest({
    workflowId: base.workflowId,
    parentWorkflowId: base.parentWorkflowId,
    childExecutionIds: base.childExecutionIds,
    projectId: base.projectId,
    taskType: base.taskType,
    workflowMode: base.workflowMode,
    status: base.status,
    selectedModel: base.selectedModel,
    adaptiveRoute: base.adaptiveRoute,
    selectedPath: base.selectedPath,
    selectedBranches: base.selectedBranches,
    rejectedBranches: base.rejectedBranches,
    deferredBranches: base.deferredBranches,
    rejectedPaths: base.rejectedPaths,
    deferredPaths: base.deferredPaths,
    reconsiderationState: base.reconsiderationState,
    changedFiles: base.changedFiles,
    changedFileDigests: base.changedFileDigests,
    validation: base.validation,
    productShapeValidation: base.productShapeValidation,
    inputConsumption: base.inputConsumption,
    review: base.review,
    workflowRecovery: base.workflowRecovery,
    error: base.error
  });
  const idempotencyKey = digest(`${workflowId}:${resultDigest}:${WORKFLOW_PUBLISHER_VERSION}`);
  return {
    ...base,
    publicationId: String(input.publicationId || `publication_${idempotencyKey.slice(0, 32)}`),
    idempotencyKey,
    resultDigest
  };
}

async function atomicWriteFile(filePath, content) {
  await fs.ensureDir(path.dirname(filePath));
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await openFile(temporaryPath, "w", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, filePath);
    const directoryHandle = await openFile(path.dirname(filePath), "r").catch(() => null);
    try {
      await directoryHandle?.sync().catch(() => {});
    } finally {
      await directoryHandle?.close().catch(() => {});
    }
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.remove(temporaryPath).catch(() => {});
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function appendUniqueJsonLine(filePath, record, idempotencyKey) {
  await fs.ensureDir(path.dirname(filePath));
  if (await fs.pathExists(filePath)) {
    const exists = (await fs.readFile(filePath, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .some((line) => {
        try {
          const row = JSON.parse(line);
          return row.publicationId === record.publicationId || row.idempotencyKey === idempotencyKey;
        } catch {
          return false;
        }
      });
    if (exists) return false;
  }
  const handle = await openFile(filePath, "a", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return true;
}

function projectionPaths(root, projectId, publicationId) {
  const projectKey = safeFileBase(projectId || "plutomix-default");
  const historyRoot = path.join(root, "memory", "project-intelligence", "projects", projectKey);
  return {
    instructionProjection: path.join(historyRoot, "project-instructions.jsonl"),
    whatNext: path.join(historyRoot, "what-next-knowledge.jsonl"),
    summary: path.join(root, "memory", "agent-knowledge", "projects", `${safeFileBase(publicationId)}.summary.md`),
    agentSummaryRoot: path.join(root, "memory", "agent-knowledge", "agents"),
    observability: path.join(root, "observability", "workflow-publications", `${safeFileBase(publicationId)}.json`)
  };
}

export class WorkflowProjectionPublisher {
  constructor({
    root,
    emit = null,
    isSystemIdle = () => true,
    publishProjectTopology = publishProjectAgentTopology,
    scheduleVectorSync = null,
    maxAttempts = Number(process.env.GOTHAM_PUBLICATION_MAX_ATTEMPTS || 5),
    retryBaseMs = Number(process.env.GOTHAM_PUBLICATION_RETRY_BASE_MS || 1000),
    idleOnly = String(process.env.GOTHAM_PUBLICATION_IDLE_ONLY || "true").toLowerCase() !== "false",
    lockStaleMs = Number(process.env.GOTHAM_PUBLICATION_LOCK_STALE_MS || 15 * 60 * 1000)
  } = {}) {
    this.root = publisherRoot(root);
    this.outboxRoot = process.env.GOTHAM_PUBLICATION_OUTBOX_PATH || path.join(this.root, "runtime", "workflow-publication-outbox");
    this.emit = emit;
    this.isSystemIdle = isSystemIdle;
    this.publishProjectTopology = publishProjectTopology;
    this.scheduleVectorSync = scheduleVectorSync;
    this.maxAttempts = Math.max(1, Math.min(25, Number(maxAttempts) || 5));
    this.retryBaseMs = Math.max(10, Number(retryBaseMs) || 1000);
    this.idleOnly = idleOnly;
    this.lockStaleMs = Math.max(30_000, Number(lockStaleMs) || 15 * 60 * 1000);
    this.drainPromise = null;
  }

  directory(name) {
    return path.join(this.outboxRoot, name);
  }

  jobPath(state, publicationId) {
    return path.join(this.directory(state), `${safeFileBase(publicationId)}.json`);
  }

  async ensure() {
    await Promise.all(["pending", "processing", "published", "failed"].map((name) => fs.ensureDir(this.directory(name))));
  }

  async enqueue(receipt) {
    const startedAt = Date.now();
    await this.ensure();
    const publicationId = receipt?.publicationId;
    if (!publicationId || !receipt?.idempotencyKey) throw new Error("A valid workflow publication receipt is required.");
    for (const state of ["published", "processing", "pending", "failed"]) {
      if (await fs.pathExists(this.jobPath(state, publicationId))) {
        return { id: publicationId, status: state === "published" ? "published" : state === "failed" ? "failed" : "queued", duplicate: true, queueDurationMs: Date.now() - startedAt };
      }
    }
    const job = {
      schemaVersion: WORKFLOW_PUBLICATION_SCHEMA_VERSION,
      receipt: redactOperational(receipt),
      attempts: 0,
      queuedAt: new Date().toISOString(),
      lastFailure: null
    };
    await atomicWriteJson(this.jobPath("pending", publicationId), job);
    const queueDurationMs = Date.now() - startedAt;
    return { id: publicationId, status: "queued", duplicate: false, queueDurationMs };
  }

  async recoverPending() {
    await this.ensure();
    const lockPath = path.join(this.outboxRoot, "publisher.lock");
    const lockStat = await fs.stat(lockPath).catch(() => null);
    if (lockStat && Date.now() - lockStat.mtimeMs <= this.lockStaleMs) {
      return { status: "deferred", reason: "publisher_claimed", count: 0, jobs: [] };
    }
    if (lockStat) await fs.remove(lockPath);
    const recovered = [];
    for (const file of (await fs.readdir(this.directory("processing"))).filter((name) => name.endsWith(".json"))) {
      const source = path.join(this.directory("processing"), file);
      const destination = path.join(this.directory("pending"), file);
      try {
        if (await fs.pathExists(destination) || await fs.pathExists(path.join(this.directory("published"), file))) {
          await fs.remove(source);
        } else {
          await fs.rename(source, destination);
          recovered.push(file);
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return { status: "recovered", count: recovered.length, jobs: recovered };
  }

  async acquireLock() {
    const lockPath = path.join(this.outboxRoot, "publisher.lock");
    try {
      await fs.mkdir(lockPath);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stat = await fs.stat(lockPath).catch(() => null);
      if (!stat || Date.now() - stat.mtimeMs <= this.lockStaleMs) return null;
      await fs.remove(lockPath);
      try {
        await fs.mkdir(lockPath);
      } catch (retryError) {
        if (retryError.code === "EEXIST") return null;
        throw retryError;
      }
    }
    await atomicWriteJson(path.join(lockPath, "owner.json"), { pid: process.pid, claimedAt: new Date().toISOString() });
    return async () => fs.remove(lockPath);
  }

  async publish(receipt) {
    const startedAt = Date.now();
    const paths = projectionPaths(this.root, receipt.projectId, receipt.publicationId);
    const common = {
      publicationId: receipt.publicationId,
      idempotencyKey: receipt.idempotencyKey,
      recordedAt: new Date().toISOString(),
      projectId: receipt.projectId,
      projectName: receipt.projectName,
      workflowId: receipt.workflowId,
      status: receipt.status
    };
    await appendUniqueJsonLine(paths.instructionProjection, {
      ...common,
      source: "plutomix-workflow-publication",
      taskType: receipt.taskType,
      workflowMode: receipt.workflowMode,
      instructionSummary: receipt.instructionSummary,
      selectedPath: receipt.selectedPath,
      adaptiveRoute: receipt.adaptiveRoute,
      selectedBranches: receipt.selectedBranches,
      rejectedBranches: receipt.rejectedBranches,
      deferredBranches: receipt.deferredBranches,
      rejectedPaths: receipt.rejectedPaths,
      deferredPaths: receipt.deferredPaths,
      changedFiles: receipt.changedFiles,
      validation: receipt.validation,
      review: receipt.review,
      error: receipt.error
    }, receipt.idempotencyKey);
    await appendUniqueJsonLine(paths.whatNext, {
      ...common,
      source: "plutomix-workflow-publication",
      instructionSummary: receipt.instructionSummary,
      flowPath: receipt.flowPath,
      selectedBranches: receipt.selectedBranches,
      rejectedBranches: receipt.rejectedBranches,
      deferredBranches: receipt.deferredBranches,
      rejectedPaths: receipt.rejectedPaths,
      deferredPaths: receipt.deferredPaths,
      reconsiderationState: receipt.reconsiderationState,
      changedFiles: receipt.changedFiles,
      error: receipt.error
    }, receipt.idempotencyKey);
    if (!(await fs.pathExists(paths.summary))) {
      await atomicWriteFile(paths.summary, [
        "---",
        `project_execution_id: ${receipt.workflowId}`,
        `project_id: ${receipt.projectId || "plutomix-default"}`,
        `workflow_class: ${receipt.workflowMode || "executor"}`,
        'content_type: "project_summary"',
        `status: ${receipt.status}`,
        `publication_id: ${receipt.publicationId}`,
        `idempotency_key: ${receipt.idempotencyKey}`,
        `created_at: ${receipt.completedAt}`,
        "---",
        "",
        "# Workflow Projection Summary",
        "",
        receipt.instructionSummary || "No instruction summary retained.",
        "",
        `Selected path: ${receipt.selectedPath || "none recorded"}`,
        `Changed files: ${receipt.changedFiles.length}`,
        `Validation: ${receipt.validation?.status || receipt.productShapeValidation?.status || "not recorded"}`,
        receipt.error ? `Error: ${receipt.error}` : "",
        ""
      ].filter((line) => line !== "").join("\n"));
    }
    const agentSummaryPaths = [];
    for (const agent of receipt.agentsUsed || []) {
      const agentId = String(typeof agent === "string" ? agent : agent?.id || agent?.agentId || "").trim();
      if (!agentId) continue;
      const agentSummaryPath = path.join(paths.agentSummaryRoot, `${safeFileBase(agentId)}.executions.jsonl`);
      await appendUniqueJsonLine(agentSummaryPath, {
        ...common,
        source: "plutomix-workflow-publication",
        agentId,
        agent: typeof agent === "object" ? agent : { id: agentId },
        selectedPath: receipt.selectedPath,
        changedFiles: receipt.changedFiles,
        validation: receipt.validation,
        review: receipt.review,
        error: receipt.error
      }, receipt.idempotencyKey);
      agentSummaryPaths.push(agentSummaryPath);
    }
    const topology = await this.publishProjectTopology(receipt);
    const publicationDurationMs = Date.now() - startedAt;
    await atomicWriteJson(paths.observability, {
      ...common,
      publicationDurationMs,
      timings: { ...receipt.timings, publicationDurationMs },
      topology: { status: topology?.status || "published", publicationDurationMs: topology?.publicationDurationMs ?? null },
      localMemory: { status: "published", instructionProjection: paths.instructionProjection, whatNext: paths.whatNext, summary: paths.summary, agentSummaries: agentSummaryPaths },
      vectorSync: { status: "scheduled_after_local_publication" }
    });
    Promise.resolve().then(() => this.scheduleVectorSync?.(`workflow-publication:${receipt.publicationId}`)).catch((error) => {
      this.emit?.("publication.vector_sync_schedule_failed", "Vector synchronization could not be scheduled after local publication.", {
        publicationId: receipt.publicationId,
        error: redactOperational(error.message || String(error))
      });
    });
    return {
      status: "published",
      publicationDurationMs,
      paths,
      agentSummaryPaths,
      topology: { status: topology?.status || "published", publicationDurationMs: topology?.publicationDurationMs ?? null }
    };
  }

  async drain() {
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = this.#drain().finally(() => { this.drainPromise = null; });
    return this.drainPromise;
  }

  async #drain() {
    await this.ensure();
    if (String(process.env.GOTHAM_PUBLICATION_ENABLED || "true").toLowerCase() === "false") {
      this.emit?.("publication.failed", "Workflow projection publishing is operationally degraded; durable jobs remain pending.", { reason: "GOTHAM_PUBLICATION_ENABLED=false", degraded: true });
      return { status: "degraded", reason: "publication_disabled", processed: 0 };
    }
    if (!this.idleOnly) {
      this.emit?.("publication.failed", "Workflow projection publishing requires idle-only operation; durable jobs remain pending.", { reason: "GOTHAM_PUBLICATION_IDLE_ONLY=false", degraded: true });
      return { status: "degraded", reason: "idle_only_required", processed: 0 };
    }
    if (!(await this.isSystemIdle())) return { status: "deferred", reason: "system_busy", processed: 0 };
    const release = await this.acquireLock();
    if (!release) return { status: "deferred", reason: "publisher_claimed", processed: 0 };
    let processed = 0;
    try {
      const files = (await fs.readdir(this.directory("pending"))).filter((name) => name.endsWith(".json")).sort();
      for (const file of files) {
        if (!(await this.isSystemIdle())) break;
        const pendingPath = path.join(this.directory("pending"), file);
        const processingPath = path.join(this.directory("processing"), file);
        try {
          await fs.rename(pendingPath, processingPath);
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        const job = await fs.readJson(processingPath).catch(() => null);
        if (!job?.receipt?.publicationId) {
          await atomicWriteJson(path.join(this.directory("failed"), file), {
            ...(job || {}),
            lastFailure: { at: new Date().toISOString(), error: "Invalid or partial publication job." }
          });
          await fs.remove(processingPath);
          this.emit?.("publication.failed", "Invalid workflow publication job moved to failed.", { file });
          continue;
        }
        if (job.nextAttemptAt && new Date(job.nextAttemptAt).getTime() > Date.now()) {
          await fs.rename(processingPath, path.join(this.directory("pending"), file));
          continue;
        }
        const receipt = job.receipt;
        this.emit?.("publication.started", "Workflow projection publication started.", { publicationId: receipt.publicationId, workflowId: receipt.workflowId });
        try {
          const result = await this.publish(receipt);
          await atomicWriteJson(processingPath, {
            ...job,
            completedAt: new Date().toISOString(),
            result: redactOperational(result)
          });
          await fs.rename(processingPath, path.join(this.directory("published"), file));
          processed += 1;
          this.emit?.("publication.completed", "Workflow projection publication completed.", {
            publicationId: receipt.publicationId,
            workflowId: receipt.workflowId,
            publicationDurationMs: result.publicationDurationMs
          });
        } catch (error) {
          const attempts = Number(job.attempts || 0) + 1;
          const delayMs = Math.min(60_000, this.retryBaseMs * (2 ** (attempts - 1)));
          const failedJob = {
            ...job,
            attempts,
            nextAttemptAt: attempts >= this.maxAttempts ? null : new Date(Date.now() + delayMs).toISOString(),
            lastFailure: { at: new Date().toISOString(), error: redactOperational(error.message || String(error)) }
          };
          await atomicWriteJson(processingPath, failedJob);
          if (attempts >= this.maxAttempts) {
            await fs.rename(processingPath, path.join(this.directory("failed"), file));
            this.emit?.("publication.failed", "Workflow projection publication exhausted bounded retries.", {
              publicationId: receipt.publicationId,
              workflowId: receipt.workflowId,
              attempts,
              error: failedJob.lastFailure.error
            });
          } else {
            await fs.rename(processingPath, path.join(this.directory("pending"), file));
            this.emit?.("publication.retry_scheduled", "Workflow projection publication retry scheduled.", {
              publicationId: receipt.publicationId,
              workflowId: receipt.workflowId,
              attempts,
              delayMs,
              error: failedJob.lastFailure.error
            });
            const timer = setTimeout(() => this.drain().catch(() => {}), delayMs);
            timer.unref?.();
          }
        }
      }
      return { status: "drained", processed };
    } finally {
      await release();
    }
  }
}

let defaultPublisher = null;

export function configureWorkflowProjectionPublisher(options = {}) {
  defaultPublisher = new WorkflowProjectionPublisher(options);
  return defaultPublisher;
}

function currentPublisher() {
  defaultPublisher ||= new WorkflowProjectionPublisher();
  return defaultPublisher;
}

export function enqueueWorkflowPublication(receipt) {
  return currentPublisher().enqueue(receipt);
}

export function drainWorkflowPublications() {
  return currentPublisher().drain();
}

export function publishWorkflowProjection(receipt) {
  return currentPublisher().publish(receipt);
}

export function recoverPendingWorkflowPublications() {
  return currentPublisher().recoverPending();
}
