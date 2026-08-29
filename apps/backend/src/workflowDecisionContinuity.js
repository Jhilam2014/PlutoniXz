import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { redactOperational } from "./operationalSecurity.js";

export const WORKFLOW_DECISION_CONTINUITY_SCHEMA_VERSION = "plutonix-workflow-decision-continuity/v1";

function rootPath(root) {
  if (root) return root;
  if (process.env.PLUTONIX_PROJECT_ROOT) return process.env.PLUTONIX_PROJECT_ROOT;
  if (fs.existsSync(path.join(process.cwd(), "apps", "backend"))) return process.cwd();
  return path.resolve(process.cwd(), "../..");
}

function safeFileBase(value) {
  return String(value || "plutonix-default")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "plutonix-default";
}

function stableDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value || {})).digest("hex");
}

function normalizedDisposition(item, disposition, kind = "branch") {
  if (typeof item === "string") return { id: item, disposition, reason: "", kind };
  if (!item || typeof item !== "object") return null;
  return redactOperational({
    id: String(item.id || item.branchId || item.pathId || "").slice(0, 240),
    disposition,
    reason: String(item.reason || item.rationale || item.disposition?.reason || "").slice(0, 2000),
    kind: String(item.kind || kind).slice(0, 120),
    evidenceReferences: Array.isArray(item.evidenceReferences || item.evidence)
      ? (item.evidenceReferences || item.evidence).slice(0, 50)
      : [],
    humanApproved: item.humanApproved === true,
    reconsiderationEligible: item.reconsiderationEligible === true
  });
}

function uniqueDispositions(rows = []) {
  const unique = new Map();
  for (const row of rows.filter(Boolean)) {
    const key = `${row.disposition}:${row.kind}:${row.id}`;
    if (!row.id || unique.has(key)) continue;
    unique.set(key, row);
  }
  return [...unique.values()];
}

export function decisionDispositionsFromFlowPath(flowPath = {}) {
  const selected = Array.isArray(flowPath.selectedBranches) ? flowPath.selectedBranches.map((item) => normalizedDisposition(item, "selected")) : [];
  const rejected = Array.isArray(flowPath.rejectedBranches) ? flowPath.rejectedBranches.map((item) => normalizedDisposition(item, "rejected")) : [];
  const deferred = Array.isArray(flowPath.deferredBranches) ? flowPath.deferredBranches.map((item) => normalizedDisposition(item, "deferred")) : [];
  return {
    selectedBranches: uniqueDispositions(selected),
    rejectedBranches: uniqueDispositions(rejected),
    deferredBranches: uniqueDispositions(deferred),
    rejectedPaths: uniqueDispositions((flowPath.rejectedPaths || []).map((item) => normalizedDisposition(item, "rejected", "execution_path"))),
    deferredPaths: uniqueDispositions((flowPath.deferredPaths || []).map((item) => normalizedDisposition(item, "deferred", "execution_path")))
  };
}

export function workflowDecisionContinuityPath(projectId = "", { root } = {}) {
  return path.join(
    rootPath(root),
    "runtime",
    "workflow-decision-continuity",
    `${safeFileBase(projectId || "plutonix-default")}.jsonl`
  );
}

export function createCanonicalWorkflowDecisionRecord(input = {}) {
  const flowPath = input.flowPath || {};
  const dispositions = input.dispositions || decisionDispositionsFromFlowPath(flowPath);
  const workflowId = String(input.workflowId || input.parentWorkflowId || input.buildId || "").slice(0, 240);
  const stage = input.stage === "prepared" ? "prepared" : "terminal";
  const recordedAt = input.recordedAt || new Date().toISOString();
  const record = {
    schemaVersion: WORKFLOW_DECISION_CONTINUITY_SCHEMA_VERSION,
    recordId: String(input.recordId || `${workflowId || "workflow"}:${stage}`).slice(0, 320),
    idempotencyKey: String(input.idempotencyKey || `workflow-decision:${stableDigest({ workflowId, stage, status: input.status, publicationId: input.publicationId })}`).slice(0, 320),
    stage,
    workflowId,
    parentWorkflowId: String(input.parentWorkflowId || workflowId).slice(0, 240),
    childExecutionIds: Array.isArray(input.childExecutionIds) ? input.childExecutionIds.slice(0, 100).map(String) : [],
    checkpointId: String(input.checkpointId || `${workflowId || "workflow"}:${stage}`).slice(0, 240),
    projectId: String(input.projectId || "").slice(0, 240),
    projectName: String(input.projectName || "PlutoniX default workspace").slice(0, 320),
    taskType: String(input.taskType || "Medium").slice(0, 80),
    workflowMode: String(input.workflowMode || "executor").slice(0, 80),
    status: String(input.status || (stage === "prepared" ? "prepared" : "failed")).slice(0, 80),
    selectedPath: String(input.selectedPath || flowPath.selectedPath || "").slice(0, 320),
    adaptiveRoute: input.adaptiveRoute || flowPath.adaptiveRoute || null,
    selectedBranches: dispositions.selectedBranches || [],
    rejectedBranches: dispositions.rejectedBranches || [],
    deferredBranches: dispositions.deferredBranches || [],
    rejectedPaths: dispositions.rejectedPaths || [],
    deferredPaths: dispositions.deferredPaths || [],
    governingConstraints: Array.isArray(input.governingConstraints) ? input.governingConstraints.slice(0, 100) : [],
    evidenceReferences: Array.isArray(input.evidenceReferences) ? input.evidenceReferences.slice(0, 100) : [],
    humanApprovalRequirements: Array.isArray(input.humanApprovalRequirements) ? input.humanApprovalRequirements.slice(0, 50) : [],
    reconsiderationState: input.reconsiderationState || {
      eligibleBranchIds: dispositions.deferredBranches?.filter((item) => item.reconsiderationEligible).map((item) => item.id) || [],
      current: "unchanged",
      automaticActivationAllowed: false
    },
    outcomes: {
      execution: input.executionOutcome || null,
      validation: input.validation || null,
      review: input.review || null,
      repair: input.repair || null,
      fallback: input.workflowRecovery || null
    },
    changedFiles: Array.isArray(input.changedFiles) ? input.changedFiles.slice(0, 1000).map(String) : [],
    publication: input.publicationId ? {
      id: String(input.publicationId).slice(0, 240),
      idempotencyKey: String(input.publicationIdempotencyKey || "").slice(0, 320),
      status: String(input.publicationStatus || "reserved_for_durable_enqueue").slice(0, 80)
    } : null,
    error: String(input.error || "").slice(0, 2000),
    recordedAt
  };
  return redactOperational(record);
}

export function readCanonicalWorkflowDecisions({ projectId = "", root, limit = 50, terminalOnly = false } = {}) {
  const filePath = workflowDecisionContinuityPath(projectId, { root });
  if (!fs.existsSync(filePath)) return [];
  const rows = fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean)
    .filter((row) => !terminalOnly || row.stage === "terminal");
  return rows.slice(-Math.max(1, Math.min(Number(limit) || 50, 500)));
}

export function persistCanonicalWorkflowDecision(input = {}, { root } = {}) {
  const record = input.schemaVersion === WORKFLOW_DECISION_CONTINUITY_SCHEMA_VERSION
    ? redactOperational(input)
    : createCanonicalWorkflowDecisionRecord(input);
  const filePath = workflowDecisionContinuityPath(record.projectId, { root });
  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean)
    : [];
  const duplicate = existing.find((row) => row.idempotencyKey === record.idempotencyKey);
  if (duplicate) return { record: duplicate, duplicate: true, path: filePath };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const descriptor = fs.openSync(filePath, "a", 0o600);
  try {
    fs.writeSync(descriptor, `${JSON.stringify(record)}\n`, null, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return { record, duplicate: false, path: filePath };
}
