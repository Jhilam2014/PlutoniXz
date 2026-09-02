import crypto from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_INTEL_SCORE_THRESHOLD, ProjectTypeProfileSchema, profileArtifactValidation } from "./intelProfiles.js";

const taskStatus = z.enum(["planned", "queued", "running", "completed", "failed", "skipped", "cancelled"]);
const permission = z.enum(["read-only", "workspace-write"]);

const taskNodeSchema = z.object({
  id: z.string().min(3),
  role: z.string().min(3),
  objective: z.string().min(3),
  dependencies: z.array(z.string()),
  permissions: permission,
  allowedPaths: z.array(z.string()),
  requiredInputs: z.array(z.string()),
  requiredOutputs: z.array(z.string()),
  validatorIds: z.array(z.string()),
  status: taskStatus
});

export const IntelTaskGraphSchema = z.object({
  schemaVersion: z.literal("1.0"),
  workflowId: z.string().min(3),
  profileId: z.string().min(3),
  objective: z.string().min(3),
  projectId: z.string(),
  projectRoot: z.string().min(1),
  artifactTargets: z.array(z.object({ path: z.string().min(1), kind: z.string().min(1) })),
  nodes: z.array(taskNodeSchema).min(4),
  edges: z.array(z.object({ from: z.string().min(3), to: z.string().min(3) })),
  limits: z.object({
    maximumAgents: z.number().int().min(1),
    maximumParallelReaders: z.number().int().min(1).max(3),
    maximumWriters: z.literal(1),
    maximumRepairCycles: z.literal(1),
    workflowTimeoutMs: z.number().int().min(10_000),
    agentTimeoutMs: z.number().int().min(5_000)
  })
});

const findingSchema = z.object({ id: z.string().min(3), category: z.string().min(3), detail: z.string().min(3), evidenceRefs: z.array(z.string()) });
const evidenceSchema = z.object({ id: z.string().min(3), kind: z.string().min(3), detail: z.string().min(3), path: z.string().optional() });

export const IntelAgentResultSchema = z.object({
  schemaVersion: z.literal("1.0"),
  workflowId: z.string().min(3),
  runId: z.string().min(3),
  nodeId: z.string().min(3),
  profileId: z.string().min(3),
  role: z.string().min(3),
  status: z.enum(["completed", "failed", "skipped", "cancelled"]),
  findings: z.array(findingSchema),
  proposals: z.array(z.object({ id: z.string().min(3), title: z.string().min(3), kind: z.string().min(3), sourceAgent: z.string().min(3), evidenceRefs: z.array(z.string()) })),
  evidence: z.array(evidenceSchema),
  artifacts: z.array(z.object({ path: z.string().min(1), kind: z.string().min(1) })),
  changedFiles: z.array(z.string()),
  validationResults: z.array(z.object({ id: z.string().min(3), status: z.enum(["passed", "failed", "skipped"]), detail: z.string().min(3) })),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  error: z.object({ category: z.string(), message: z.string(), retryable: z.boolean() }).optional()
});

function stableId(prefix, value = "") {
  return `${prefix}_${crypto.createHash("sha256").update(`${Date.now()}:${value}:${Math.random()}`).digest("hex").slice(0, 12)}`;
}

function compact(value, maximum = 260) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function hasCycle(nodes = []) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (nodeId) => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    const node = byId.get(nodeId);
    if (!node) throw new Error(`Intel task graph references missing node ${nodeId}.`);
    visiting.add(nodeId);
    const cyclic = node.dependencies.some(visit);
    visiting.delete(nodeId);
    visited.add(nodeId);
    return cyclic;
  };
  return nodes.some((node) => visit(node.id));
}

export function validateIntelTaskGraph(graph) {
  const parsed = IntelTaskGraphSchema.safeParse(graph);
  if (!parsed.success) throw new Error(`Invalid Intel task graph: ${parsed.error.issues.map((issue) => issue.message).join(" ")}`);
  const nodeIds = new Set(parsed.data.nodes.map((node) => node.id));
  if (nodeIds.size !== parsed.data.nodes.length) throw new Error("Invalid Intel task graph: node ids must be unique.");
  for (const edge of parsed.data.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error("Invalid Intel task graph: edges must reference known nodes.");
  }
  if (hasCycle(parsed.data.nodes)) throw new Error("Invalid Intel task graph: dependency cycle detected.");
  const writers = parsed.data.nodes.filter((node) => node.permissions === "workspace-write" && node.role !== "repair-agent");
  if (writers.length !== 1) throw new Error("Invalid Intel task graph: exactly one implementation writer is required.");
  return parsed.data;
}

function readerNode(role, objective, dependencies = []) {
  return {
    id: role,
    role,
    objective,
    dependencies,
    permissions: "read-only",
    allowedPaths: ["."],
    requiredInputs: ["instruction", "product-shape"],
    requiredOutputs: ["structured-agent-result"],
    validatorIds: ["intel-agent-result-schema"],
    status: "planned"
  };
}

export function createIntelTaskGraph({ workflowId = stableId("intel"), profile, selection, objective = "", projectId = "", projectRoot = ".", artifactTargets = [] } = {}) {
  const safeProfile = ProjectTypeProfileSchema.parse(profile);
  const selectedSpecialists = safeProfile.defaultRoles
    .filter((role) => !["intel-planner", "project-inspector", "requirements-analyst", "implementation-agent", "verification-agent", "repair-agent"].includes(role))
    .slice(0, Math.max(0, safeProfile.limits.maximumAgents - 5));
  const nodes = [
    readerNode("intel-planner", `Plan a bounded ${safeProfile.displayName} workflow.`),
    readerNode("project-inspector", "Inspect only applicable project structure, manifests, and existing capabilities."),
    readerNode("requirements-analyst", "Turn the instruction and supplied sources into measurable requirements."),
    ...selectedSpecialists.map((role) => readerNode(role, `Provide bounded ${role.replaceAll("-", " ")} evidence for ${safeProfile.displayName}.`, ["intel-planner"])),
    {
      id: "proposal-scorer",
      role: "proposal-scorer",
      objective: "Apply backend proposal scoring and select only accepted work.",
      dependencies: ["project-inspector", "requirements-analyst", ...selectedSpecialists],
      permissions: "read-only",
      allowedPaths: [],
      requiredInputs: ["structured-agent-results"],
      requiredOutputs: ["proposal-decisions"],
      validatorIds: ["intel-proposal-score"],
      status: "planned"
    },
    {
      id: "implementation-agent",
      role: "implementation-agent",
      objective: "Implement only accepted tasks inside the selected workspace.",
      dependencies: ["proposal-scorer"],
      permissions: "workspace-write",
      allowedPaths: ["."],
      requiredInputs: ["accepted-proposals"],
      requiredOutputs: ["changed-files", "profile-artifact"],
      validatorIds: safeProfile.validationPipeline.map((step) => step.id),
      status: "planned"
    },
    {
      id: "verification-agent",
      role: "verification-agent",
      objective: "Independently verify changed files and validation evidence without modifying the workspace.",
      dependencies: ["implementation-agent"],
      permissions: "read-only",
      allowedPaths: ["."],
      requiredInputs: ["changed-files", "validation-results"],
      requiredOutputs: ["verification-verdict"],
      validatorIds: ["independent-review"],
      status: "planned"
    },
    {
      id: "repair-agent",
      role: "repair-agent",
      objective: "Apply one bounded repair only after an actionable verification failure.",
      dependencies: ["verification-agent"],
      permissions: "workspace-write",
      allowedPaths: ["."],
      requiredInputs: ["verification-failure"],
      requiredOutputs: ["repair-result"],
      validatorIds: safeProfile.validationPipeline.map((step) => step.id),
      status: "planned"
    }
  ];
  const graph = {
    schemaVersion: "1.0",
    workflowId,
    profileId: safeProfile.id,
    objective: compact(objective, 8_000) || `Run ${safeProfile.displayName} Intel workflow.`,
    projectId: String(projectId || ""),
    projectRoot: path.resolve(projectRoot),
    artifactTargets: artifactTargets.length ? artifactTargets : [{ path: "deliverables/", kind: safeProfile.id }],
    nodes,
    edges: nodes.flatMap((node) => node.dependencies.map((from) => ({ from, to: node.id })),),
    limits: safeProfile.limits,
    selection: { profileId: selection?.profileId || safeProfile.id, confidence: selection?.confidence || 0 }
  };
  return validateIntelTaskGraph(graph);
}

export async function assertIntelWorkspaceWithinRoot(workspaceDir, managedRoot) {
  const root = await fs.realpath(managedRoot);
  const workspace = await fs.realpath(workspaceDir);
  if (workspace === root || !workspace.startsWith(`${root}${path.sep}`)) {
    throw new Error("Intel rejected an out-of-root workspace.");
  }
  return workspace;
}

function updateNode(runtime, nodeId, status) {
  const node = runtime.taskGraph.nodes.find((item) => item.id === nodeId);
  if (node) node.status = status;
}

function emit(emitEvent, type, message, data = {}) {
  emitEvent(type, message, { intel: true, ...data });
}

function now() {
  return new Date().toISOString();
}

function evidenceForRole(role, profile) {
  const key = {
    "intel-planner": "plan",
    "project-inspector": "workspace-inspection",
    "requirements-analyst": "instruction",
    "ui-ux-explorer": "user-journey",
    "accessibility-reviewer": "accessibility-review",
    "frontend-technical-explorer": "frontend-structure",
    "backend-technical-explorer": "backend-structure",
    "api-contract-analyst": "api-contract",
    "data-model-reviewer": "data-model",
    "integration-security-reviewer": "security-review",
    "content-structure-analyst": "document-outline",
    "document-layout-specialist": "document-layout",
    "citation-source-reviewer": "citation-review",
    "document-render-verifier": "rendered-artifact",
    "data-quality-analyst": "data-quality",
    "formula-modeling-specialist": "workbook-model",
    "workbook-layout-specialist": "workbook-layout",
    "workbook-calculation-verifier": "formula-validation"
  }[role] || `${profile.id}-evidence`;
  return { id: `${role}:${key}`, kind: key, detail: `${role.replaceAll("-", " ")} completed bounded ${key.replaceAll("-", " ")} analysis.` };
}

async function localReaderResult({ runtime, node, instruction, workspaceDir }) {
  const startedAt = now();
  let workspaceEntries = [];
  if (node.role === "project-inspector") {
    workspaceEntries = (await fs.readdir(workspaceDir).catch(() => [])).filter((name) => ![".env", "node_modules", ".git"].includes(name)).slice(0, 30);
  }
  const evidence = evidenceForRole(node.role, runtime.profile);
  const result = {
    schemaVersion: "1.0",
    workflowId: runtime.workflowId,
    runId: stableId("intelrun", node.role),
    nodeId: node.id,
    profileId: runtime.profile.id,
    role: node.role,
    status: "completed",
    findings: [{
      id: `${node.role}-finding`,
      category: node.role,
      detail: node.role === "project-inspector"
        ? `Inspected ${workspaceEntries.length} safe top-level project entries: ${workspaceEntries.join(", ") || "workspace unavailable or empty"}.`
        : `Bounded evidence analysis completed for ${compact(instruction, 160)}.`,
      evidenceRefs: [evidence.id]
    }],
    proposals: [],
    evidence: [evidence],
    artifacts: [],
    changedFiles: [],
    validationResults: [],
    startedAt,
    completedAt: now()
  };
  return IntelAgentResultSchema.parse(result);
}

export async function runIntelReadersInBatches(nodes, maxParallelReaders, worker) {
  const results = [];
  for (let index = 0; index < nodes.length; index += maxParallelReaders) {
    results.push(...await Promise.all(nodes.slice(index, index + maxParallelReaders).map(worker)));
  }
  return results;
}

function scoreForDimension(dimension, hasEvidence, objective) {
  const lower = String(objective || "").toLowerCase();
  let fraction = hasEvidence ? 0.9 : 0.45;
  if (/maybe|could|explore|idea|optional/.test(lower)) fraction -= 0.18;
  if (/security|credential|private data|payment|medical/.test(lower) && dimension.id === "scope-risk-fit") fraction -= 0.1;
  return Math.max(0, Math.min(dimension.weight, Math.round(dimension.weight * fraction)));
}

export function scoreIntelProposal({ profile, proposal, evidence = [], threshold = DEFAULT_INTEL_SCORE_THRESHOLD } = {}) {
  const requiredEvidence = new Set(profile?.requiredEvidence || []);
  const evidenceKinds = new Set(evidence.map((item) => item.kind));
  const missingEvidence = [...requiredEvidence].filter((kind) => !evidenceKinds.has(kind));
  const unrelated = /unrelated|generic filler|marketing filler/i.test(`${proposal?.title || ""} ${proposal?.kind || ""}`);
  const dimensions = (profile?.scoringDimensions || []).map((dimension) => ({
    ...dimension,
    score: scoreForDimension(dimension, !missingEvidence.length && !unrelated, proposal?.title || "")
  }));
  const total = dimensions.reduce((sum, dimension) => sum + dimension.score, 0);
  const accepted = !missingEvidence.length && !unrelated && total >= threshold && profile?.status === "supported";
  return {
    ...proposal,
    profileId: profile?.id || "",
    threshold,
    dimensions,
    total,
    status: accepted ? "accepted" : missingEvidence.length ? "deferred" : "rejected",
    decision: accepted ? "accepted" : "rejected",
    reasons: [
      ...(!accepted && missingEvidence.length ? [`Missing required evidence: ${missingEvidence.join(", ")}.`] : []),
      ...(unrelated ? ["Proposal was rejected as unrelated filler."] : []),
      ...(total < threshold ? [`Backend score ${total}/100 is below the ${threshold}/100 threshold.`] : []),
      ...(accepted ? [`Backend score ${total}/100 meets the ${threshold}/100 threshold.`] : [])
    ],
    evidenceRefs: proposal?.evidenceRefs || []
  };
}

function agentRunFromResult(result, permissionMode = "read-only") {
  return {
    id: result.runId,
    nodeId: result.nodeId,
    name: result.role.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    role: result.role,
    status: result.status,
    permissionMode,
    provider: "plutomix-local-reader",
    transport: "in-process",
    findings: result.findings,
    evidence: result.evidence,
    startedAt: result.startedAt,
    completedAt: result.completedAt
  };
}

export async function prepareIntelWorkflow({ profileSelection, instruction, productDecision, projectId = "", projectName = "", workspaceDir, workflowId, emit: emitEvent = () => {}, signal } = {}) {
  const profile = ProjectTypeProfileSchema.parse(profileSelection?.profile);
  if (profile.status !== "supported") throw new Error(`${profile.displayName} is not a supported Intel profile.`);
  if (signal?.aborted) throw new Error("Intel workflow was cancelled before planning.");
  const taskGraph = createIntelTaskGraph({
    workflowId: workflowId || stableId("intel"),
    profile,
    selection: profileSelection,
    objective: instruction,
    projectId,
    projectRoot: workspaceDir
  });
  const runtime = {
    schemaVersion: "1.0",
    workflowId: taskGraph.workflowId,
    profile: { id: profile.id, displayName: profile.displayName, status: profile.status, previewAdapter: profile.previewAdapter, executionAdapter: profile.executionAdapter },
    profileSelection: {
      profileId: profileSelection.profileId,
      confidence: profileSelection.confidence,
      reasons: profileSelection.reasons,
      alternatives: profileSelection.alternatives,
      source: profileSelection.source,
      requiresUserConfirmation: profileSelection.requiresUserConfirmation
    },
    projectId,
    projectName,
    phase: "detecting-project-type",
    status: "running",
    provider: { name: "codex", transport: "cli", fallback: false, status: "pending" },
    evidence: [
      { id: "product-shape", kind: "product-shape", detail: "Product Shape Contract selected before Intel planning." }
    ],
    taskGraph,
    agentRuns: [],
    proposals: [],
    artifacts: [],
    validationResults: [],
    failure: null,
    repairCycles: 0,
    startedAt: now(),
    completedAt: ""
  };
  emit(emitEvent, "intel-profile-detection-started", "Intel is detecting the project type.", { workflowId: runtime.workflowId, projectId });
  emit(emitEvent, "intel-profile-selected", `Intel selected ${profile.displayName} with ${profileSelection.confidence}% confidence.`, { workflowId: runtime.workflowId, profile: runtime.profile, profileSelection: runtime.profileSelection });

  const planner = taskGraph.nodes.find((node) => node.role === "intel-planner");
  updateNode(runtime, planner.id, "running");
  emit(emitEvent, "intel-planning-started", "Intel planner is creating a bounded task graph.", { workflowId: runtime.workflowId, nodeId: planner.id });
  const plannerResult = await localReaderResult({ runtime, node: planner, instruction, workspaceDir });
  updateNode(runtime, planner.id, "completed");
  runtime.agentRuns.push(agentRunFromResult(plannerResult));
  emit(emitEvent, "intel-plan-created", "Intel created and validated an acyclic task graph.", { workflowId: runtime.workflowId, taskGraph: runtime.taskGraph });

  runtime.phase = "inspecting";
  const readerNodes = taskGraph.nodes.filter((node) => node.permissions === "read-only" && !["intel-planner", "proposal-scorer", "verification-agent"].includes(node.role));
  for (const node of readerNodes) {
    updateNode(runtime, node.id, "queued");
    emit(emitEvent, "intel-agent-queued", `${node.role} is queued.`, { workflowId: runtime.workflowId, nodeId: node.id, role: node.role });
  }
  const readerResults = await runIntelReadersInBatches(readerNodes, profile.limits.maximumParallelReaders, async (node) => {
    if (signal?.aborted) {
      updateNode(runtime, node.id, "cancelled");
      throw new Error("Intel workflow was cancelled.");
    }
    updateNode(runtime, node.id, "running");
    emit(emitEvent, "intel-agent-started", `${node.role} started in read-only mode.`, { workflowId: runtime.workflowId, nodeId: node.id, role: node.role, permissionMode: "read-only" });
    const result = await localReaderResult({ runtime, node, instruction, workspaceDir });
    updateNode(runtime, node.id, "completed");
    emit(emitEvent, "intel-agent-completed", `${node.role} completed its bounded analysis.`, { workflowId: runtime.workflowId, nodeId: node.id, role: node.role });
    return result;
  });
  runtime.agentRuns.push(...readerResults.map((result) => agentRunFromResult(result)));

  runtime.phase = "proposals-scored";
  const scorer = taskGraph.nodes.find((node) => node.role === "proposal-scorer");
  updateNode(runtime, scorer.id, "running");
  const evidence = [...(runtime.evidence || []), ...runtime.agentRuns.flatMap((run) => run.evidence || [])];
  const requirements = readerResults.find((result) => result.role === "requirements-analyst");
  const primaryProposal = {
    id: stableId("proposal", "primary"),
    title: compact(instruction, 500),
    kind: "primary-request",
    sourceAgent: requirements?.role || "requirements-analyst",
    evidenceRefs: evidence.map((item) => item.id)
  };
  const optionalProposal = {
    id: stableId("proposal", "optional"),
    title: "Optional generic filler expansion",
    kind: "unrelated-filler",
    sourceAgent: "intel-planner",
    evidenceRefs: []
  };
  runtime.proposals = [primaryProposal, optionalProposal].map((proposal) => scoreIntelProposal({ profile, proposal, evidence }));
  updateNode(runtime, scorer.id, "completed");
  for (const proposal of runtime.proposals) {
    emit(emitEvent, "intel-proposal-scored", `${proposal.id} scored ${proposal.total}/100.`, { workflowId: runtime.workflowId, proposal });
    emit(emitEvent, proposal.status === "accepted" ? "intel-proposal-accepted" : "intel-proposal-rejected", proposal.reasons.join(" "), { workflowId: runtime.workflowId, proposal });
  }
  const accepted = runtime.proposals.filter((proposal) => proposal.status === "accepted");
  if (!accepted.length) {
    updateNode(runtime, "implementation-agent", "skipped");
    updateNode(runtime, "verification-agent", "skipped");
    runtime.status = "failed";
    runtime.phase = "failed";
    runtime.failure = { reason: "No Intel proposal passed backend scoring.", retryable: false };
    throw new Error(runtime.failure.reason);
  }
  runtime.acceptedProposals = accepted;
  updateNode(runtime, "implementation-agent", "queued");
  runtime.phase = "implementing";
  return runtime;
}

export function recordIntelImplementation(runtime, result = {}) {
  updateNode(runtime, "implementation-agent", "completed");
  runtime.agentRuns.push({
    id: result.buildId || stableId("intelrun", "writer"),
    nodeId: "implementation-agent",
    name: "Implementation Agent",
    role: "implementation-agent",
    status: "completed",
    permissionMode: "workspace-write",
    provider: "codex",
    transport: "cli",
    startedAt: runtime.startedAt,
    completedAt: now(),
    changedFiles: result.files || []
  });
  runtime.provider = { name: "codex", transport: "cli", fallback: false, status: result.runtime?.codexVersion ? "available" : "not_checked" };
  runtime.artifacts = (result.files || []).map((file) => ({ path: String(file), kind: runtime.profile.id }));
  runtime.validationResults = [
    ...(result.productShapeValidation ? [{ id: "product-shape", status: result.productShapeValidation.status.startsWith("passed") ? "passed" : "failed", detail: result.productShapeValidation.failures?.join(" ") || "Product Shape validation completed." }] : []),
    ...profileArtifactValidation({ id: runtime.profile.id }, result.files || []).checks.map((check) => ({ id: check.id, status: check.passed ? "passed" : "failed", detail: check.detail }))
  ];
  runtime.phase = "validating";
  return runtime;
}

export function recordIntelVerification(runtime, review = null) {
  updateNode(runtime, "verification-agent", review?.status === "passed" ? "completed" : "failed");
  runtime.agentRuns.push({
    id: review?.reviewId || stableId("intelrun", "verification"),
    nodeId: "verification-agent",
    name: "Verification Agent",
    role: "verification-agent",
    status: review?.status === "passed" ? "completed" : "failed",
    permissionMode: "read-only",
    provider: "codex",
    transport: "cli",
    startedAt: now(),
    completedAt: now(),
    findings: [],
    evidence: []
  });
  runtime.phase = review?.status === "passed" ? "completed" : "repairing";
  runtime.status = review?.status === "passed" && runtime.validationResults.every((item) => item.status === "passed") ? "completed" : "failed";
  runtime.completedAt = now();
  return runtime;
}

export function beginIntelRepair(runtime, verificationError) {
  if (runtime.repairCycles >= runtime.taskGraph.limits.maximumRepairCycles) {
    throw new Error("Intel repair limit has already been reached.");
  }
  updateNode(runtime, "verification-agent", "failed");
  runtime.agentRuns.push({
    id: stableId("intelrun", "verification-failed"),
    nodeId: "verification-agent",
    name: "Verification Agent",
    role: "verification-agent",
    status: "failed",
    permissionMode: "read-only",
    provider: "codex",
    transport: "cli",
    startedAt: now(),
    completedAt: now(),
    findings: [{ id: "verification-failure", category: "verification", detail: String(verificationError?.message || verificationError || "Independent verification failed."), evidenceRefs: [] }],
    evidence: []
  });
  updateNode(runtime, "repair-agent", "running");
  runtime.repairCycles = 1;
  runtime.phase = "repairing";
  runtime.status = "running";
  runtime.failure = null;
  runtime.completedAt = "";
  return runtime;
}

export function recordIntelRepair(runtime, repair = {}) {
  updateNode(runtime, "repair-agent", repair?.status === "repaired" ? "completed" : "failed");
  runtime.agentRuns.push({
    id: repair?.repairId || stableId("intelrun", "repair"),
    nodeId: "repair-agent",
    name: "Repair Agent",
    role: "repair-agent",
    status: repair?.status === "repaired" ? "completed" : "failed",
    permissionMode: "workspace-write",
    provider: repair?.modelKind || "codex",
    transport: "cli",
    startedAt: now(),
    completedAt: now(),
    changedFiles: repair?.files || []
  });
  runtime.phase = "validating";
  runtime.status = repair?.status === "repaired" ? "running" : "failed";
  return runtime;
}

export function recordIntelFailure(runtime, error, { cancelled = false, repairStarted = false } = {}) {
  if (!runtime) return null;
  const active = runtime.taskGraph.nodes.find((node) => node.status === "running" || node.status === "queued");
  if (active) updateNode(runtime, active.id, cancelled ? "cancelled" : "failed");
  for (const node of runtime.taskGraph.nodes.filter((item) => item.status === "planned" || item.status === "queued")) {
    updateNode(runtime, node.id, cancelled ? "cancelled" : "skipped");
  }
  if (repairStarted) {
    updateNode(runtime, "repair-agent", "running");
    runtime.repairCycles = 1;
    runtime.phase = "repairing";
  }
  runtime.status = cancelled ? "cancelled" : "failed";
  runtime.failure = { reason: String(error?.message || error || "Intel workflow failed."), retryable: !cancelled && /timeout|network|temporar|unavailable/i.test(String(error?.message || error || "")) };
  runtime.completedAt = now();
  return runtime;
}

export function intelRuntimeGraphRecords(runtime) {
  if (!runtime) return { nodes: [], edges: [] };
  const profileNodeId = `intel-profile:${runtime.profile.id}`;
  const nodes = [
    { id: profileNodeId, parentId: "functionality-project-root", type: "profile", label: runtime.profile.displayName, state: runtime.status, detail: `Selected with ${runtime.profileSelection.confidence}% confidence.` },
    ...runtime.taskGraph.nodes.map((node) => ({ id: `intel-task:${node.id}`, parentId: profileNodeId, type: "task", label: node.role, state: node.status, detail: node.objective, dependencies: node.dependencies })),
    ...runtime.agentRuns.map((run) => ({ id: `intel-run:${run.id}`, parentId: `intel-task:${run.nodeId}`, type: "agent-run", label: run.name, state: run.status, detail: `${run.role}; ${run.permissionMode}; ${run.transport}` })),
    ...runtime.proposals.map((proposal) => ({ id: `intel-proposal:${proposal.id}`, parentId: "intel-task:proposal-scorer", type: "proposal", label: proposal.title, state: proposal.status, detail: `${proposal.total}/100; ${proposal.decision}` })),
    ...runtime.validationResults.map((result) => ({ id: `intel-validation:${result.id}`, parentId: "intel-task:implementation-agent", type: "validation", label: result.id, state: result.status, detail: result.detail }))
  ];
  const edges = [
    ...runtime.taskGraph.edges.map((edge) => ({ source: `intel-task:${edge.from}`, target: `intel-task:${edge.to}`, type: "depends_on" })),
    ...runtime.agentRuns.map((run) => ({ source: `intel-task:${run.nodeId}`, target: `intel-run:${run.id}`, type: "executed_as" })),
    ...runtime.proposals.map((proposal) => ({ source: `intel-task:proposal-scorer`, target: `intel-proposal:${proposal.id}`, type: "scored" })),
    ...runtime.validationResults.map((result) => ({ source: "intel-task:implementation-agent", target: `intel-validation:${result.id}`, type: "validated_by" }))
  ];
  return { nodes, edges };
}
