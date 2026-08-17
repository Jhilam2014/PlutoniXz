import cors from "cors";
import AdmZip from "adm-zip";
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import multer from "multer";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { classifyGothamWorkflowFailure, isGothamCodexModelCompatibilityError, isGothamWorkspaceSandboxUnavailable, isRecoverableGothamModelsCacheError, probeCodexWorkspaceSandbox, runCodexReviewWorkflow, runCodexWorkflow, runModelRepairWorkflow } from "./codexWorkflow.js";
import { createPlutoniXOrchestrationEnvelope } from "./plutonixAuthority.js";
import { isTransientWorkflowError, selectAdaptiveRoute } from "./adaptiveOrchestration.js";
import { formatGothamModeInstruction, formatProjectOrchestratorInstruction, inferGothamRequestIntent, orchestrateBuilderInstruction } from "./orchestratorAgent.js";
import { classifyProductShape } from "./productShape.js";
import { intelProfileRegistry, intelProfileSummary, selectIntelProfile, validateIntelProfileRegistry } from "./intelProfiles.js";
import { assertIntelWorkspaceWithinRoot, intelRuntimeGraphRecords, prepareIntelWorkflow, recordIntelFailure, recordIntelImplementation, recordIntelVerification } from "./intelOrchestration.js";
import { validateIntelProfileOutput } from "./intelArtifactValidation.js";
import { verifyIntelWithBoundedRepair } from "./intelVerification.js";
import { analyzeRealDataNeed, normalizeRealDataPreflightPayload } from "./realDataPreflight.js";
import { buildFunctionalityGraph } from "./functionalityGraph.js";
import { createOrchestratorHealthMonitor } from "./orchestratorHealthMonitor.js";
import { createSelfImprovementControlPlane, readSelfImprovementConfig } from "./selfImprovement/controlPlane.js";
import { orchestratorRuntimeSelfHealEnabled, selfImprovementRuntimeEventsEnabled, selfImprovementStartupCycleEnabled } from "./selfImprovement/runtimePolicy.js";
import { buildAgenticSystemGraph, syncProjectAgentTopology } from "./projectAgents.js";
import { ANALYSIS_VERSION, analyzeProjectArchitecture, publicArchitectureAnalysis, publishArchitectureBranches, readLatestProjectArchitectureAnalysis, readProjectArchitectureAnalysis, writeProjectArchitectureAnalysis } from "./projectBranchDiscovery.js";
import { createLocalGothamMcpServer } from "./gothamMcpServer.js";
import { createHuggingFaceModelPool, localModelRoutingForTask } from "./huggingFaceModelPool.js";
import {
  createProject,
  deleteProject,
  ensureProjectPreview,
  ensureProjectPreviewWithRuntimeRecovery,
  exportProject,
  getProject,
  importProject,
  listProjects,
  removeProjectMedia,
  rebuildProjectRuntime,
  saveProjectMedia,
  startProjectInstance,
  startRegisteredProjects,
  stopProjectInstance,
  bindProjectDecisionContinuity,
  getProjectDecisionContinuity,
  updateProjectIdentity
} from "./projectManager.js";
import { restartGeneratedRuntime } from "./runtimeRestart.js";
import { runProjectOrchestratorBootstrap } from "./projectBootstrap.js";
import { deleteGlobalAgent, listGlobalAgents } from "./globalAgentKnowledge.js";
import { scheduleAgentMemorySync, syncKnownAgentKnowledgeRoots } from "./vectorMemorySync.js";
import { registerHostingRoutes } from "./hosting/hosting-conversation.controller.js";
import { AuthenticationError, assertProductionIdentityConfiguration, authenticateGooglePayload, restrictedIntent, userFromRequest } from "./auth.js";
import { readAgentEfficiencySummary, summarizeAgentTokenEconomy } from "./tokenEconomy.js";
import { createDecisionContinuityStore, DecisionContinuityError } from "./decisionContinuity.js";
import { buildDecisionContinuityGraph, compareDecisionBranches } from "./decisionContinuityProjection.js";
import { DecisionContinuityWorkflowQueue } from "./decisionContinuityWorkflow.js";
import { DECISION_CONTINUITY_LIFECYCLE_ROUTES, assertDecisionContinuityLifecycleCoverage } from "./decisionContinuityLifecycleRegistry.js";
import { AuthorizationError, DECISION_PERMISSIONS, IdentityAccessStore } from "./identityAccess.js";
import { GovernedPromotionController, GovernedPromotionError, PostgresGovernedPromotionStore } from "./governedPromotion.js";
import { QAgentDecisionContinuityService } from "./qagentDecisionContinuity.js";
import { BrainXModelRegistry } from "./brainxModelRegistry.js";
import { SuggestionIntelGovernance } from "./suggestionIntelGovernance.js";
import { assertProductionOperationalConfiguration, operationalTelemetry } from "./operationalSecurity.js";

export const app = express();
const port = Number(process.env.PORT || 8080);
const clients = new Set();
const runtimeLog = [];
const workflowEventBuffers = new Map();
const activeGothamExecutions = new Map();
let selfImprovementControlPlane = null;
let huggingFaceModelPool = null;
let decisionContinuityStore = null;
let decisionContinuityWorkflow = null;
let identityAccessStore = null;
let governedPromotionController = null;
let qagentDecisionContinuity = null;
let brainxModelRegistry = null;
let suggestionIntelGovernance = null;
let gothamSandboxReadiness = {
  status: "not_checked",
  component: "workspace_sandbox",
  failureClass: "",
  reason: "",
  diagnostic: "",
  remediation: ""
};

function corsMiddleware() {
  if (String(process.env.NODE_ENV || "").toLowerCase() !== "production") return cors();
  const allowedOrigins = new Set(String(process.env.PLUTONIX_CORS_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean));
  return cors({
    origin(origin, callback) {
      // Non-browser clients have no Origin. Browser bearer requests must use
      // an explicitly configured application origin.
      callback(null, !origin || allowedOrigins.has(origin));
    },
    credentials: false,
    allowedHeaders: ["authorization", "content-type", "idempotency-key", "x-plutonix-tenant-id", "x-request-id"],
    exposedHeaders: ["x-request-id"],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
  });
}

// Fail fast during backend startup if a registered profile cannot safely be selected.
validateIntelProfileRegistry();

async function isSystemIdleForVectorSync() {
  if (activeGothamExecutions.size) return false;
  const status = selfImprovementControlPlane?.status
    ? await selfImprovementControlPlane.status().catch(() => null)
    : null;
  const runState = String(status?.runIndicator?.state || "").toLowerCase();
  return !["starting", "running"].includes(runState);
}

function scheduleIdleVectorSync(reason) {
  return scheduleAgentMemorySync({ reason, emit: event, isSystemIdle: isSystemIdleForVectorSync });
}
function selfImprovementAdminUserIds() {
  return String(process.env.SELF_IMPROVEMENT_ADMIN_USER_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isSelfImprovementAdmin(req) {
  const user = userFromRequest(req);
  const allowlist = selfImprovementAdminUserIds();
  if (!allowlist.length) return process.env.NODE_ENV !== "production";
  return allowlist.includes(user.id) || (user.email && allowlist.includes(user.email));
}

function requireSelfImprovementAdmin(req, res) {
  if (isSelfImprovementAdmin(req)) return true;
  res.status(403).json({
    status: "forbidden",
    error: "Self-improvement administrative control requires an allowed PlutoniX user."
  });
  return false;
}

async function decisionContinuityScope(req, res, routeKey) {
  const route = DECISION_CONTINUITY_LIFECYCLE_ROUTES[routeKey];
  if (!route) throw new Error(`Decision-continuity route ${routeKey} is not registered.`);
  const principalTypes = route.principalTypes || (route.trust === "trusted_service" ? ["service"] : ["human"]);
  try {
    const scope = await identityAccessStore.authorizeRequest(req, {
      permission: route.permission,
      principalTypes,
      action: `decision_continuity.${routeKey}`
    });
    res.locals.operationalTenantId = scope.tenantId;
    res.locals.operationalPrincipalType = scope.principal.type;
    return scope;
  } catch (error) {
    respondDecisionContinuityError(res, error);
    return null;
  }
}

function respondDecisionContinuityError(res, error) {
  const status = error instanceof DecisionContinuityError || error instanceof AuthorizationError || error instanceof AuthenticationError ? error.status : error instanceof z.ZodError ? 400 : 500;
  res.status(status).json({
    status: "failed",
    error: error instanceof AuthorizationError || error instanceof AuthenticationError ? "The requested decision-continuity resource is unavailable." : error.message || "Unexpected decision-continuity error",
    code: error.code || "invalid_request",
    details: error instanceof z.ZodError ? error.issues : undefined
  });
}

function decisionProjectUser(req, scope) {
  const legacy = userFromRequest(req);
  const principal = scope.principal || {};
  return {
    ...legacy,
    subject: principal.subject,
    issuer: principal.issuer,
    aliases: [
      legacy.id,
      ...(Array.isArray(legacy.aliases) ? legacy.aliases : []),
      principal.id,
      principal.subject,
      principal.issuer && principal.subject ? `${principal.issuer}:${principal.subject}` : ""
    ].filter(Boolean)
  };
}

async function decisionProject(req, scope, projectId, { bind = false } = {}) {
  try {
    const access = { user: decisionProjectUser(req, scope), tenantId: scope.tenantId };
    const project = bind
      ? await bindProjectDecisionContinuity(projectId, { ...access, principalId: scope.principal.id })
      : await getProjectDecisionContinuity(projectId, access);
    const requestedWorkspace = String(req.query?.workspaceId || req.body?.workspaceId || "").trim();
    if (requestedWorkspace && requestedWorkspace !== project.id) {
      throw new DecisionContinuityError("Architecture discovery uses the managed project ID as its Decision Continuity workspace.", { code: "project_workspace_mismatch", status: 400 });
    }
    return project;
  } catch (error) {
    if (error instanceof DecisionContinuityError) throw error;
    throw new DecisionContinuityError(error.message || "Project access is unavailable.", { code: error.code || "project_access_unavailable", status: error.status || 503 });
  }
}

async function brainxScope(req, res, permission, principalTypes = ["human"]) {
  try {
    const scope = await identityAccessStore.authorizeRequest(req, { permission, principalTypes, action: `brainx.${permission}` });
    res.locals.operationalTenantId = scope.tenantId;
    res.locals.operationalPrincipalType = scope.principal.type;
    return scope;
  } catch (error) {
    respondDecisionContinuityError(res, error);
    return null;
  }
}

function brainxWorkspace(scope, req) {
  return String(req.query?.workspaceId || (scope.workspaceId === "*" ? "default" : scope.workspaceId || "default"));
}

async function suggestionScope(req, res, permission) {
  try {
    const scope = await identityAccessStore.authorizeRequest(req, { permission, principalTypes: ["human"], action: `suggestion.${permission}` });
    res.locals.operationalTenantId = scope.tenantId;
    res.locals.operationalPrincipalType = scope.principal.type;
    return scope;
  } catch (error) { respondDecisionContinuityError(res, error); return null; }
}

function respondGovernedPromotionError(res, error) {
  const status = error instanceof GovernedPromotionError || error instanceof AuthorizationError || error instanceof AuthenticationError ? error.status : error instanceof z.ZodError ? 400 : 500;
  res.status(status).json({
    status: "failed",
    error: error instanceof AuthorizationError || error instanceof AuthenticationError ? "The requested governed-promotion resource is unavailable." : error.message || "Unexpected governed-promotion error",
    code: error.code || "invalid_request",
    details: error instanceof z.ZodError ? error.issues : undefined
  });
}

const runtimeLogPath =
  process.env.WORKFLOW_RUNTIME_LOG_PATH || process.env.MCP_RUNTIME_LOG_PATH || "/workspace/runtime/workflow-runtime-log.jsonl";
const MAX_RUNTIME_LOG_ROWS = 400;
const RUNTIME_LOG_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_INSTRUCTION_CHARS = 50000;
const previewUrl = process.env.GENERATED_SITE_URL || "http://localhost:5174";
const upload = multer({ dest: "/tmp/plutonix-uploads" });
const istTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata"
});

const GenerateSchema = z.object({
  instruction: z.string().min(12).max(MAX_INSTRUCTION_CHARS),
  projectId: z.string().optional(),
  target: z.discriminatedUnion("type", [
    z.object({ type: z.literal("project"), projectId: z.string().optional() }),
    z.object({ type: z.literal("system"), systemId: z.literal("plutonix") })
  ]).optional(),
  taskType: z.enum(["Simple", "Medium", "Large", "Hard", "simple", "medium", "large", "hard", "small", "complex"]).optional(),
  workflowMode: z.enum(["planner", "debugger", "executor"]).optional(),
  intel: z.object({
    enabled: z.boolean().optional(),
    profileId: z.string().regex(/^[a-z][a-z0-9-]{2,80}$/).optional(),
    minExpansionScore: z.number().int().min(0).max(100).optional(),
    maxDepth: z.number().int().min(1).max(8).optional(),
    maxBranchesPerNode: z.number().int().min(1).max(8).optional(),
    appointedAgents: z.array(z.string().min(1).max(120)).max(12).optional()
  }).optional(),
  mediaIds: z.array(z.string()).optional(),
  requiredData: z.array(z.object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(160),
    value: z.string().min(1).max(12000)
  })).max(3).optional()
});
const NewProjectSchema = z.object({
  name: z.string().min(2).max(80),
  instruction: z.string().min(12).max(MAX_INSTRUCTION_CHARS).optional(),
  taskType: z.enum(["Simple", "Medium", "Large", "Hard", "simple", "medium", "large", "small", "hard", "complex"]).optional(),
  mediaIds: z.array(z.string()).optional(),
  stagedMediaIds: z.array(z.string()).optional(),
  stagedDocumentIds: z.array(z.string()).optional(),
  requiredData: z.array(z.object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(160),
    value: z.string().min(1).max(12000)
  })).max(3).optional(),
  brandingPalette: z.object({
    name: z.string().min(1).max(80),
    colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(1).max(8),
    reason: z.string().max(240).optional()
  }).optional()
});
const RealDataPreflightSchema = z.object({
  instruction: z.string().max(MAX_INSTRUCTION_CHARS).optional(),
  projectName: z.string().max(120).optional(),
  mediaIds: z.array(z.string()).optional(),
  stagedMediaIds: z.array(z.string()).optional(),
  stagedDocumentIds: z.array(z.string()).optional(),
  referenceCount: z.number().int().min(0).max(100).optional(),
  suppliedData: z.record(z.string()).optional()
});
const AgentDeleteSelectorSchema = z.object({
  project: z.string().max(160).optional(),
  sourcePath: z.string().max(1000).optional(),
  sourceRootId: z.string().max(80).optional(),
  vectorFileId: z.string().max(160).optional()
});
const ProjectImportSchema = z.object({
  name: z.string().min(2).max(80)
});
const ProjectIdentitySchema = z.object({
  name: z.string().min(2).max(80).optional(),
  workspaceName: z.string().min(2).max(80).optional()
}).refine((value) => value.name !== undefined || value.workspaceName !== undefined, {
  message: "Project name or workspace name is required."
});
const ApifyInvestorPullSchema = z.object({
  query: z.string().min(3).max(240).optional(),
  label: z.string().max(120).optional(),
  country: z.string().max(80).optional(),
  maxItems: z.number().int().min(1).max(50).optional(),
  takePages: z.number().int().min(1).max(3).optional(),
  rotate: z.boolean().optional()
});
const InvestorProposalPrepareSchema = z.object({
  demoVideoUrl: z.string().max(500).optional(),
  productName: z.string().max(120).optional(),
  productSummary: z.string().max(1000).optional()
});
const InvestorProposalApprovalSchema = z.object({
  approved: z.boolean().optional(),
  reviewerNote: z.string().max(1000).optional()
});

app.use(corsMiddleware());
app.use((req, res, next) => {
  const started = Date.now(); const correlationId = String(req.get("x-request-id") || crypto.randomUUID());
  res.setHeader("x-request-id", correlationId);
  res.on("finish", () => console.info(JSON.stringify(operationalTelemetry({ event: "api.request", tenantId: res.locals.operationalTenantId, correlationId, attributes: { "http.request.method": req.method, "url.path": req.path, "http.response.status_code": res.statusCode, "http.server.request.duration_ms": Date.now() - started, "enduser.role": res.locals.operationalPrincipalType || "unauthenticated" } }))));
  next();
});
app.use(express.json({ limit: process.env.PLUTONIX_API_BODY_LIMIT || "256kb" }));

function rejectRestrictedIntent(res, text) {
  const restricted = restrictedIntent(text);
  if (!restricted) return false;
  res.status(403).json({
    status: "restricted",
    error: restricted.reason
  });
  return true;
}

function persistRuntimeLogEvent(payload) {
  fs.mkdirSync(path.dirname(runtimeLogPath), { recursive: true });
  const existingRows = fs.existsSync(runtimeLogPath)
    ? fs
        .readFileSync(runtimeLogPath, "utf8")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
    : [];
  const retentionCutoff = Date.now() - RUNTIME_LOG_RETENTION_MS;
  const rows = [
    ...existingRows
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((row) => row && new Date(row.createdAt || 0).getTime() >= retentionCutoff)
      .slice(-(MAX_RUNTIME_LOG_ROWS - 1))
      .map((row) => JSON.stringify(row)),
    JSON.stringify(payload)
  ];
  fs.writeFileSync(runtimeLogPath, `${rows.join("\n")}\n`);
}

function event(type, message, extra = {}) {
  const payload = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    message,
    createdAt: new Date().toISOString(),
    time: `${istTimeFormatter.format(new Date())} IST`,
    ...extra
  };
  runtimeLog.unshift(payload);
  runtimeLog.splice(MAX_RUNTIME_LOG_ROWS);
  if (payload.type !== "plutonix-complete") {
    for (const key of [payload.parentWorkflowId, payload.buildId].filter(Boolean)) {
      const rows = workflowEventBuffers.get(key) || [];
      rows.push(payload);
      workflowEventBuffers.set(key, rows);
    }
  }
  persistRuntimeLogEvent(payload);
  console.log(`[workflow-runtime] ${payload.type}: ${payload.message}`);
  if (selfImprovementControlPlane && selfImprovementRuntimeEventsEnabled()) {
    Promise.resolve(selfImprovementControlPlane.recordRuntimeEvent(payload)).catch((error) => {
      console.warn(`[self-improvement-investigator] runtime event check failed: ${error.message}`);
    });
  }
  for (const client of clients) {
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

async function refreshGothamSandboxReadiness({ source = "startup", emitAuditEvent = true } = {}) {
  if (process.env.GOTHAM_SANDBOX_PREFLIGHT === "false") {
    gothamSandboxReadiness = {
      status: "disabled",
      component: "workspace_sandbox",
      failureClass: "",
      reason: "disabled_by_configuration",
      diagnostic: "",
      remediation: "Enable GOTHAM_SANDBOX_PREFLIGHT to verify the Codex workspace sandbox before execution.",
      checkedAt: new Date().toISOString()
    };
    return gothamSandboxReadiness;
  }
  gothamSandboxReadiness = {
    ...await probeCodexWorkspaceSandbox(),
    checkedAt: new Date().toISOString()
  };
  if (emitAuditEvent) {
    event(
      gothamSandboxReadiness.status === "ready" ? "sandbox.preflight.succeeded" : "sandbox.preflight.failed",
      gothamSandboxReadiness.status === "ready"
        ? "Gotham startup verified the secure Codex workspace sandbox."
        : "Gotham startup found the secure Codex workspace sandbox unavailable; workflow execution will be blocked.",
      { stage: "preflight", source, sandboxPreflight: gothamSandboxReadiness }
    );
  }
  return gothamSandboxReadiness;
}

function readRuntimeLogRows() {
  if (!fs.existsSync(runtimeLogPath)) return runtimeLog;
  return fs
    .readFileSync(runtimeLogPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((row) => new Date(row.createdAt || 0).getTime() >= Date.now() - RUNTIME_LOG_RETENTION_MS)
    .slice(-MAX_RUNTIME_LOG_ROWS)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
}

function createOrchestrationBuildSnapshot({
  projectId = "",
  projectName = "PlutoniX default workspace",
  instruction = "",
  taskType = "Medium",
  status = "succeeded",
  buildId = "",
  parentWorkflowId = "",
  childExecutionIds = [],
  flowPath = null,
  changedFiles = [],
  error = ""
} = {}) {
  const completedAt = new Date().toISOString();
  const snapshotAgents = flowPath?.activeAgents || [];
  const projectExecutorId = snapshotAgents.find((agent) =>
    agent.id && agent.id !== "plutonix-fullstack-agent" && !String(agent.id).includes("reviewer") && !String(agent.id).includes("qagent")
  )?.id || "project-execution-agent";
  const reviewerId = snapshotAgents.find((agent) => String(agent.id).includes("reviewer") || String(agent.id).includes("qagent"))?.id || "plutonix-independent-reviewer";
  const responsibleAgentForType = (type = "", explicitId = "") => {
    if (explicitId) return explicitId;
    if (/review|qagent/i.test(type)) return reviewerId;
    if (/delegation|generating|codex|files-applied|build-start|codegen/i.test(type)) return projectExecutorId;
    return "plutonix-fullstack-agent";
  };
  const bufferedEvents = [
    ...(workflowEventBuffers.get(parentWorkflowId) || []),
    ...(workflowEventBuffers.get(buildId) || [])
  ];
  const workflowEvents = [...bufferedEvents, ...runtimeLog]
    .filter((row) => {
      if (parentWorkflowId && row.parentWorkflowId === parentWorkflowId) return true;
      if (buildId && row.buildId === buildId) return true;
      return false;
    })
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index)
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  const startedAt = workflowEvents[0]?.createdAt || completedAt;
  const terminalType = status === "succeeded" ? "plutonix-complete" : "plutonix-failed";
  const timeline = workflowEvents.map((row, index) => ({
    id: row.id || `${parentWorkflowId || buildId}-${index + 1}`,
    sequence: index + 1,
    type: row.type,
    message: row.message,
    createdAt: row.createdAt,
    elapsedMs: Math.max(0, new Date(row.createdAt || startedAt).getTime() - new Date(startedAt).getTime()),
    stage: row.stage || "",
    agentId: responsibleAgentForType(row.type, row.agentId || row.reviewerAgentId),
    childExecutionId: row.childExecutionId || "",
    status: row.status || (row.type?.includes("failed") || row.type === "error" ? "failed" : "recorded"),
    decision: row.adaptiveRoute ? {
      kind: "selected",
      value: row.adaptiveRoute.mode,
      reason: row.adaptiveRoute.reasons?.join(" ") || "Selected by adaptive orchestration."
    } : null
  }));
  if (!timeline.some((row) => row.type === terminalType || (status === "succeeded" && row.type === "plutonix-complete"))) {
    timeline.push({
      id: `${parentWorkflowId || buildId || "workflow"}-terminal`,
      sequence: timeline.length + 1,
      type: terminalType,
      message: status === "succeeded" ? "PlutoniX approved workflow completion." : `PlutoniX rejected workflow completion: ${error || "execution failed"}`,
      createdAt: completedAt,
      elapsedMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
      stage: "terminal",
      agentId: "plutonix-fullstack-agent",
      childExecutionId: "",
      status,
      decision: null
    });
  }
  const stableBuildId = buildId || `failed_${String(parentWorkflowId || Date.now()).replace(/^plutonix_/, "").slice(0, 18)}`;
  const generatedFeatures = [
    ...(flowPath?.functionalities || []).map((item) => ({ id: item.id, label: item.label, detail: item.detail, state: item.state })),
    ...(flowPath?.featureActions || []).map((item) => ({ id: item.id, label: item.label, detail: item.reason, state: item.status, target: item.target }))
  ].filter((item, index, rows) => rows.findIndex((candidate) => candidate.id === item.id && candidate.label === item.label) === index);
  const agentWork = snapshotAgents.map((agent) => ({
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    work: [...new Set([
      agent.action,
      ...timeline.filter((item) => item.agentId === agent.id).map((item) => item.message),
      ...generatedFeatures.filter((feature) => agent.id === projectExecutorId).map((feature) => `Generated feature: ${feature.label}`)
    ].filter(Boolean))].slice(0, 12)
  }));
  const routeChoices = flowPath?.decisionTree?.children
    ?.find((node) => node.id === "adaptive-routing")?.children || [];
  const selectedRoute = routeChoices.find((choice) => choice.state === "selected") || {
    id: flowPath?.adaptiveRoute?.mode || "adaptive-route",
    label: `Route: ${flowPath?.adaptiveRoute?.mode || "adaptive"}`,
    state: status === "succeeded" ? "selected" : "failed",
    reason: flowPath?.adaptiveRoute?.reasons?.join(" ") || error
  };
  const executionChoices = snapshotAgents.map((agent) => ({
    id: `agent-choice-${agent.id}`,
    label: agent.name,
    state: agent.status === "failed" ? "failed" : "selected",
    detail: agent.action || agent.role,
    responsibleAgentId: agent.id
  }));
  executionChoices.push({
    id: "unassigned-execution",
    label: "Unassigned execution",
    state: "rejected",
    detail: "Rejected because every execution and review step requires explicit agent ownership.",
    responsibleAgentId: "plutonix-fullstack-agent"
  });
  const scopeChoices = [
    ...generatedFeatures.slice(0, 10).map((item) => ({
      id: item.id,
      label: item.label,
      state: item.state === "failed" ? "failed" : "selected",
      detail: item.detail,
      responsibleAgentId: projectExecutorId
    })),
    ...(flowPath?.rejectedPaths || []).filter((item) => !routeChoices.some((choice) => choice.id === item.id)).slice(0, 4).map((item) => ({
      id: `scope-rejection-${item.id}`,
      label: item.id,
      state: "rejected",
      detail: item.reason,
      responsibleAgentId: item.responsibleAgentId || "plutonix-fullstack-agent"
    }))
  ];
  const completionChoices = status === "succeeded"
    ? [
        { id: "completion-approved", label: "Approve build", state: "selected", detail: "Execution and validation evidence passed.", responsibleAgentId: "plutonix-fullstack-agent" },
        { id: "completion-rejected", label: "Reject completion", state: "rejected", detail: "Not selected because required evidence passed.", responsibleAgentId: "plutonix-fullstack-agent" }
      ]
    : [
        { id: "completion-approved", label: "Approve build", state: "rejected", detail: error || "Validation evidence did not pass.", responsibleAgentId: "plutonix-fullstack-agent" },
        { id: "completion-rejected", label: "Reject completion", state: "selected", detail: error || "PlutoniX rejected completion.", responsibleAgentId: "plutonix-fullstack-agent" }
      ];
  const stages = [
    { id: "route-decision", label: "Select orchestration route", responsibleAgentId: "plutonix-fullstack-agent", choices: routeChoices.length ? routeChoices.map((choice) => ({ ...choice, responsibleAgentId: "plutonix-fullstack-agent", detail: choice.reason })) : [selectedRoute] },
    { id: "agent-decision", label: "Assign responsible agents", responsibleAgentId: "plutonix-fullstack-agent", choices: executionChoices },
    { id: "scope-decision", label: "Generate selected features", responsibleAgentId: projectExecutorId, choices: scopeChoices.length ? scopeChoices : [{ id: "scope-recorded", label: "Execute requested scope", state: status === "succeeded" ? "selected" : "failed", detail: error || "Requested scope executed.", responsibleAgentId: projectExecutorId }] },
    { id: "completion-decision", label: "PlutoniX completion gate", responsibleAgentId: "plutonix-fullstack-agent", choices: completionChoices }
  ];
  const buildDecisionGraph = (stageIndex = 0) => {
    const stage = stages[stageIndex];
    if (!stage) return null;
    const choices = stage.choices.map((choice) => ({
      ...choice,
      type: "choice",
      children: []
    }));
    const continuation = choices.find((choice) => ["selected", "completed", "passed"].includes(choice.state));
    const nextStage = buildDecisionGraph(stageIndex + 1);
    if (continuation && nextStage) continuation.children.push(nextStage);
    return { ...stage, type: "decision", state: "recorded", children: choices };
  };
  const snapshot = {
    schemaVersion: 2,
    id: `${parentWorkflowId || stableBuildId}:snapshot`,
    snapshotBuildId: stableBuildId,
    buildId,
    parentWorkflowId,
    childExecutionIds,
    projectId,
    projectName,
    instruction,
    taskType,
    status,
    startedAt,
    completedAt,
    durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
    route: flowPath?.adaptiveRoute || null,
    agents: snapshotAgents,
    agentWork,
    generatedFeatures,
    selectedDecisions: (flowPath?.executedDecisions || []).map((decision) => ({
      ...decision,
      responsibleAgentId: decision.responsibleAgentId || (/generation|implementation/i.test(decision.id || decision.label) ? projectExecutorId : "plutonix-fullstack-agent")
    })),
    rejectedDecisions: (flowPath?.rejectedPaths || []).map((decision) => ({
      ...decision,
      responsibleAgentId: decision.responsibleAgentId || "plutonix-fullstack-agent"
    })),
    decisionTree: flowPath?.decisionTree || null,
    decisionGraph: {
      id: `${parentWorkflowId || stableBuildId}-start`,
      label: "Build instruction accepted",
      type: "start",
      state: "selected",
      responsibleAgentId: "plutonix-fullstack-agent",
      detail: instruction,
      children: [buildDecisionGraph()].filter(Boolean)
    },
    validation: {
      status: status === "succeeded" ? "passed" : "failed",
      review: flowPath?.adaptiveRoute?.requiresIndependentReview ? "independent" : "plutonix",
      error
    },
    changedFiles,
    timeline
  };
  if (parentWorkflowId) workflowEventBuffers.delete(parentWorkflowId);
  if (buildId) workflowEventBuffers.delete(buildId);
  return snapshot;
}

async function runPlutoniXOwnedWorkflow(orchestratedRequest, options, orchestrationEnvelope, adaptiveRoute) {
  const maxAttempts = Math.max(1, Number(process.env.PLUTONIX_WORKFLOW_MAX_ATTEMPTS || 2));
  let lastError;
  let result;
  let recoverModelsCache = false;
  let fallbackAttempted = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const delegatedAgent = orchestrationEnvelope.delegations[0];
      const executionAgentId = adaptiveRoute.executionAgent === "project-orchestrator" && delegatedAgent
        ? delegatedAgent.agentId
        : "plutonix-fullstack-agent";
      const executionAgentName = executionAgentId === "plutonix-fullstack-agent"
        ? "PlutoniX Fullstack Agent"
        : `${options.projectName || "Project"} Orchestrator Agent`;
      result = await runCodexWorkflow(orchestratedRequest, {
        ...options,
        attempt,
        executionAgentId,
        executionAgentName,
        recoverModelsCache,
        signal: options.signal
      });
      break;
    } catch (error) {
      lastError = error;
      recoverModelsCache = isRecoverableGothamModelsCacheError(error);
      const failureClass = classifyGothamWorkflowFailure(error);
      const fallbackModel = String(process.env.GOTHAM_FALLBACK_MODEL || "").trim();
      if (isGothamCodexModelCompatibilityError(error) && fallbackModel && !fallbackAttempted) {
        fallbackAttempted = true;
        event("gotham-cli-upgrade-required", "The selected Gotham model requires a newer Codex CLI; attempting the configured compatible fallback once.", {
          stage: "runtime",
          parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
          projectId: options.projectId || "",
          failureClass,
          requestedModel: error.requestedModel || "",
          codexVersion: error.codexVersion || "",
          fallbackModel,
          upgradeAction: "Rebuild the backend image with the configured CODEX_VERSION."
        });
        try {
          result = await runCodexWorkflow(orchestratedRequest, {
            ...options,
            attempt,
            executionAgentId: options.executionAgentId || "plutonix-fullstack-agent",
            executionAgentName: options.executionAgentName || "PlutoniX Fullstack Agent",
            model: fallbackModel,
            recoveryStrategy: "fallback_model",
            signal: options.signal
          });
          result.workflowRecovery = {
            failureClass,
            strategy: "fallback_model",
            requestedModel: error.requestedModel || "",
            fallbackModel,
            replayStatus: "succeeded",
            replayParentId: orchestrationEnvelope.parentWorkflowId
          };
          event("gotham-fallback-complete", `Gotham completed the preserved instruction using fallback model ${fallbackModel}.`, {
            stage: "runtime",
            parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
            projectId: options.projectId || "",
            fallbackModel,
            replayStatus: "succeeded"
          });
          break;
        } catch (fallbackError) {
          fallbackError.workflowRecovery = {
            failureClass,
            strategy: "fallback_model",
            requestedModel: error.requestedModel || "",
            fallbackModel,
            replayStatus: "failed",
            replayParentId: orchestrationEnvelope.parentWorkflowId
          };
          lastError = fallbackError;
          event("gotham-fallback-failed", "Configured Gotham fallback failed; preserving the instruction without further replay.", {
            stage: "runtime",
            parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
            projectId: options.projectId || "",
            fallbackModel,
            error: fallbackError.message
          });
          break;
        }
      }
      if (isGothamCodexModelCompatibilityError(error)) {
        event("gotham-cli-upgrade-required", "The selected Gotham model requires a newer Codex CLI. The instruction was preserved; project-code repair was skipped.", {
          stage: "runtime",
          parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
          projectId: options.projectId || "",
          failureClass,
          requestedModel: error.requestedModel || "",
          codexVersion: error.codexVersion || "",
          fallbackModel: fallbackModel || "",
          upgradeAction: "Rebuild the backend image with the configured CODEX_VERSION."
        });
        break;
      }
      if (isGothamWorkspaceSandboxUnavailable(error)) {
        event("execution.blocked", "Gotham preserved the selected route, but secure provider execution was blocked by the workspace sandbox.", {
          stage: "execution",
          parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
          childExecutionIds: orchestrationEnvelope.childExecutionIds,
          projectId: options.projectId || "",
          failureClass,
          sandboxPreflight: error.sandboxPreflight || null
        });
        break;
      }
      if (attempt >= maxAttempts || !isTransientWorkflowError(error)) break;
      event("plutonix-retry", `PlutoniX is retrying failed execution (${attempt + 1}/${maxAttempts})`, {
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        childExecutionIds: orchestrationEnvelope.childExecutionIds,
        attempt,
        nextAttempt: attempt + 1,
        retryReason: recoverModelsCache ? "recoverable_models_cache" : "transient_failure",
        recovery: recoverModelsCache ? "Retrying once after quarantining the incompatible Gotham models-cache file so the CLI can rebuild it." : undefined,
        error: error.message
      });
    }
  }
  if (!result) throw lastError;

  let review = null;
  if (adaptiveRoute.requiresIndependentReview) {
    const reviewAttempts = Math.max(1, Number(process.env.PLUTONIX_REVIEW_MAX_ATTEMPTS || 2));
    for (let attempt = 1; attempt <= reviewAttempts; attempt += 1) {
      try {
        review = await runCodexReviewWorkflow(orchestratedRequest, result, {
          ...options,
          reviewerAgentId: adaptiveRoute.reviewerAgentId
        });
        break;
      } catch (error) {
        if (attempt >= reviewAttempts || !isTransientWorkflowError(error)) throw error;
        event("review-retry", `PlutoniX is retrying transient reviewer failure (${attempt + 1}/${reviewAttempts})`, {
          parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
          reviewerAgentId: adaptiveRoute.reviewerAgentId,
          attempt,
          nextAttempt: attempt + 1,
          error: error.message
        });
      }
    }
  }
  return { ...result, adaptiveRoute, review };
}

async function attemptAutomaticRepairAfterFailure({
  orchestratedRequest,
  project,
  error,
  result = null,
  taskType = "Medium",
  source = "gotham-chat",
  signal = null
} = {}) {
  if (isGothamWorkspaceSandboxUnavailable(error)) {
    event("repair.skipped", "Sandbox unavailable; repair was not attempted because execution was blocked by the runtime environment.", {
      stage: "repair",
      source,
      projectId: project?.id || "",
      projectName: project?.name || "PlutoniX default workspace",
      failureClass: classifyGothamWorkflowFailure(error),
      reason: error?.sandboxPreflight?.reason || "workspace_sandbox_unavailable",
      diagnostic: error?.sandboxPreflight?.diagnostic || "",
      remediation: error?.sandboxPreflight?.remediation || "Verify host user namespaces, AppArmor, and Docker seccomp policy."
    });
    return null;
  }
  if (String(process.env.PLUTONIX_AUTO_REPAIR || "1") === "0") return null;
  if (signal?.aborted) return null;
  if (!orchestratedRequest) return null;
  if (isRecoverableGothamModelsCacheError(error) || isGothamCodexModelCompatibilityError(error) || error?.workflowRecovery?.failureClass === "codex_cli_model_incompatible") {
    event("gotham-model-cache-recovery-failed", "Gotham's model-cache recovery retry did not resolve the runtime error; project-code repair was skipped because the failure is outside the project.", {
      stage: "repair",
      source,
      projectId: project?.id || "",
      failureClass: classifyGothamWorkflowFailure(error),
      upgradeAction: isGothamCodexModelCompatibilityError(error) ? "Upgrade the Codex CLI or configure GOTHAM_FALLBACK_MODEL." : undefined,
      error: error.message
    });
    return null;
  }
  const projectName = project?.name || "PlutoniX default workspace";
  event("plutonix-repair-queued", `Forwarding ${source} failure to AI repair model for ${projectName}`, {
    stage: "repair",
    source,
    projectId: project?.id || "",
    projectName,
    error: error.message
  });
  const repair = await runModelRepairWorkflow(orchestratedRequest, error, {
    emit: event,
    generatedSiteDir: project?.workspaceDir,
    projectId: project?.id || "",
    projectName,
    taskType,
    changedFiles: result?.files || [],
    runtimeLogTail: error.message,
    signal
  });
  event("plutonix-repair-preview-retry", "Automatic repair completed; retrying project preview", {
    stage: "repair",
    source,
    projectId: project?.id || "",
    repairId: repair.repairId,
    changedFiles: repair.files
  });
  const restart = project && !project.isDefault
    ? await ensureProjectPreviewWithRuntimeRecovery(project, { emit: event, source: "automatic-code-repair" }).then((readyProject) => ({
        status: readyProject.runtime?.status || "project-server",
        container: readyProject.containerName,
        reason: `Project container is live on port ${readyProject.port} after automatic repair.`,
        project: readyProject
      }))
    : await restartGeneratedRuntime();
  event("plutonix-repair-preview-ready", "Automatic repair passed preview startup", {
    stage: "repair",
    source,
    projectId: project?.id || "",
    repairId: repair.repairId,
    restart
  });
  return {
    repair,
    restart,
    project: restart.project || project,
    result: {
      ...(result || {}),
      buildId: repair.repairId,
      parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || result?.parentWorkflowId || repair.repairId,
      childExecutionIds: orchestratedRequest.orchestrationEnvelope?.childExecutionIds || result?.childExecutionIds || [],
      files: repair.files,
      fileOperations: repair.fileOperations,
      adaptiveRoute: orchestratedRequest.orchestrationEnvelope?.adaptiveRoute || result?.adaptiveRoute || null,
      repair
    }
  };
}

const localGothamMcpServer = createLocalGothamMcpServer({
  emit: event,
  executeWorkflow: ({ orchestratedRequest, options, orchestrationEnvelope, adaptiveRoute }) =>
    runPlutoniXOwnedWorkflow(orchestratedRequest, options, orchestrationEnvelope, adaptiveRoute)
});

function safeFileBase(value = "document") {
  return String(value || "document")
    .replace(/\.[^.]+$/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "document";
}

function safeExtension(value = "") {
  const ext = path.extname(String(value || "")).toLowerCase().replace(/[^.a-z0-9]/g, "");
  return ext || ".txt";
}

function stagedDocumentRoot(user) {
  const userId = safeFileBase(user?.id || "anonymous");
  return path.join(plutonixProjectRoot(), "runtime", "staged-project-documents", userId);
}

function stagedMediaRoot(user) {
  const userId = safeFileBase(user?.id || "anonymous");
  return path.join(plutonixProjectRoot(), "runtime", "staged-project-media", userId);
}

function stagedDocumentIndexPath(user) {
  return path.join(stagedDocumentRoot(user), "index.json");
}

function stagedMediaIndexPath(user) {
  return path.join(stagedMediaRoot(user), "index.json");
}

function documentPurposeFromName(name = "", mimeType = "") {
  const value = `${name} ${mimeType}`.toLowerCase();
  if (value.includes("requirement") || value.includes("prd") || value.includes("scope")) return "requirements";
  if (value.includes("design") || value.includes("wireframe") || value.includes("figma")) return "design";
  if (value.includes("api") || value.includes("openapi") || value.includes("swagger")) return "api";
  if (value.includes("data") || value.includes("schema")) return "data-model";
  return "project-documentation";
}

function mediaPurposeFromName(name = "", mimeType = "") {
  const value = `${name} ${mimeType}`.toLowerCase();
  if (value.includes("logo") || value.includes("icon")) return "brand-asset";
  if (value.includes("video")) return "video-reference";
  if (value.includes("audio") || value.includes("voice")) return "audio-reference";
  if (value.includes("pdf") || value.includes("presentation")) return "document-reference";
  if (value.includes("csv") || value.includes("json") || value.includes("data")) return "data-reference";
  return "media-reference";
}

async function readStagedDocuments(user) {
  const indexPath = stagedDocumentIndexPath(user);
  if (!fs.existsSync(indexPath)) return [];
  const rows = await fs.promises.readFile(indexPath, "utf8").then((value) => JSON.parse(value)).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function readStagedMedia(user) {
  const indexPath = stagedMediaIndexPath(user);
  if (!fs.existsSync(indexPath)) return [];
  const rows = await fs.promises.readFile(indexPath, "utf8").then((value) => JSON.parse(value)).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function writeStagedDocuments(user, rows) {
  const indexPath = stagedDocumentIndexPath(user);
  await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.promises.writeFile(indexPath, JSON.stringify(rows, null, 2));
}

async function writeStagedMedia(user, rows) {
  const indexPath = stagedMediaIndexPath(user);
  await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.promises.writeFile(indexPath, JSON.stringify(rows, null, 2));
}

async function stageProjectDocuments(user, files = []) {
  const root = stagedDocumentRoot(user);
  await fs.promises.mkdir(root, { recursive: true });
  const existing = await readStagedDocuments(user);
  const staged = [];
  for (const file of files) {
    const purpose = documentPurposeFromName(file.originalname, file.mimetype);
    const storedName = `${purpose}-${Date.now()}-${safeFileBase(file.originalname)}${safeExtension(file.originalname)}`;
    const absolutePath = path.join(root, storedName);
    await fs.promises.copyFile(file.path, absolutePath);
    await fs.promises.rm(file.path, { force: true });
    const record = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      originalName: file.originalname,
      name: storedName,
      purpose,
      mimeType: file.mimetype,
      size: file.size,
      path: absolutePath,
      relativePath: path.relative(plutonixProjectRoot(), absolutePath).split(path.sep).join("/"),
      uploadedAt: new Date().toISOString()
    };
    staged.push(record);
  }
  await writeStagedDocuments(user, [...existing, ...staged]);
  return staged;
}

async function stageProjectMedia(user, files = []) {
  const root = stagedMediaRoot(user);
  await fs.promises.mkdir(root, { recursive: true });
  const existing = await readStagedMedia(user);
  const staged = [];
  for (const file of files) {
    const purpose = mediaPurposeFromName(file.originalname, file.mimetype);
    const storedName = `${purpose}-${Date.now()}-${safeFileBase(file.originalname)}${safeExtension(file.originalname)}`;
    const absolutePath = path.join(root, storedName);
    await fs.promises.copyFile(file.path, absolutePath);
    await fs.promises.rm(file.path, { force: true });
    staged.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      originalName: file.originalname,
      name: storedName,
      purpose,
      mimeType: file.mimetype,
      size: file.size,
      path: absolutePath,
      relativePath: path.relative(plutonixProjectRoot(), absolutePath).split(path.sep).join("/"),
      uploadedAt: new Date().toISOString()
    });
  }
  await writeStagedMedia(user, [...existing, ...staged]);
  return staged;
}

async function attachStagedDocumentsToProject(user, project, selectedIds = []) {
  if (!project?.workspaceDir || !selectedIds.length) return [];
  const staged = await readStagedDocuments(user);
  const selected = staged.filter((row) => selectedIds.includes(row.id));
  if (!selected.length) return [];
  const docsDir = path.join(project.workspaceDir, "docs", "project-input");
  await fs.promises.mkdir(docsDir, { recursive: true });
  const attached = [];
  for (const doc of selected) {
    const targetPath = path.join(docsDir, doc.name);
    await fs.promises.copyFile(doc.path, targetPath);
    attached.push({
      ...doc,
      projectPath: `docs/project-input/${doc.name}`
    });
  }
  await writeStagedDocuments(user, staged.filter((row) => !selectedIds.includes(row.id)));
  return attached;
}

async function attachStagedMediaToProject(user, project, selectedIds = []) {
  if (!project?.workspaceDir || !selectedIds.length) return [];
  const staged = await readStagedMedia(user);
  const selected = staged.filter((row) => selectedIds.includes(row.id));
  if (!selected.length) return [];
  const media = await saveProjectMedia(
    project,
    selected.map((item) => ({
      path: item.path,
      originalname: item.originalName,
      mimetype: item.mimeType,
      size: item.size
    })),
    { purpose: "media" }
  );
  await writeStagedMedia(user, staged.filter((row) => !selectedIds.includes(row.id)));
  return media;
}

function requiredDataValues(items = []) {
  return Object.fromEntries((items || []).map((item) => [item.id, item.value]));
}

function graphNodeId(value) {
  return typeof value === "object" && value ? value.id : value;
}

function normalizeGraphKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function rounded(value, digits = 4) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : 0;
}

function projectNodeLookup(nodes = []) {
  const lookup = new Map();
  for (const node of nodes) {
    if (node?.type !== "project") continue;
    [
      node.id,
      node.label,
      node.metadata?.projectName,
      node.metadata?.name,
      node.metadata?.folderName,
      node.metadata?.projectId
    ]
      .filter(Boolean)
      .forEach((value) => lookup.set(normalizeGraphKey(value), node));
  }
  return lookup;
}

function projectCorrelationForAgent(agent, projectsByKey) {
  const candidates = [
    agent.project,
    agent.vector?.attributes?.project_name,
    agent.vector?.attributes?.project_id,
    agent.vector?.attributes?.source_path ? String(agent.vector.attributes.source_path).split("/")[0] : ""
  ].filter(Boolean);
  for (const candidate of candidates) {
    const match = projectsByKey.get(normalizeGraphKey(candidate));
    if (match) return { node: match, value: candidate };
  }
  return null;
}

function agentAnalysisMetadata(agent, correlation) {
  const tokenEconomy = agent.tokenEconomy || {};
  return {
    modelNodalAnalysis: true,
    correlation: correlation ? "matched_project_node" : "standalone_no_project_correlation",
    correlatedProject: correlation?.node?.label || "",
    project: agent.project || "",
    role: agent.role || "",
    domain: agent.domain || "",
    objective: agent.objective || "",
    instructionSummary: agent.instructionSummary || "",
    capabilities: agent.capabilities || [],
    vectorStatus: agent.vector?.status || "unknown",
    vectorSource: agent.vector?.source || "",
    vectorFileId: agent.vector?.file_id || "",
    totalRuns: Number(tokenEconomy.totalRuns || 0),
    inputTokens: Number(tokenEconomy.inputTokens || 0),
    outputTokens: Number(tokenEconomy.outputTokens || 0),
    totalTokens: Number(tokenEconomy.totalTokens || 0),
    averageInputTokens: rounded(tokenEconomy.averageInputTokens, 2),
    averageOutputTokens: rounded(tokenEconomy.averageOutputTokens, 2),
    inputTokenCostUsd: rounded(tokenEconomy.inputEstimatedUsd, 6),
    outputTokenCostUsd: rounded(tokenEconomy.outputEstimatedUsd, 6),
    totalCostUsd: rounded(tokenEconomy.estimatedUsd, 6),
    averageCostUsd: rounded(tokenEconomy.averageUsd, 6),
    accuracyValue: rounded(tokenEconomy.averageAccuracyValue || agent.efficiency?.accuracy, 2),
    efficiencyScore: rounded(tokenEconomy.averageEfficiencyScore || agent.efficiency?.economy, 2),
    abilityScore: rounded(tokenEconomy.averageAbilityScore || agent.efficiency?.capability, 2),
    tokensPerAccuracyPoint: rounded(tokenEconomy.tokensPerAccuracyPoint, 2),
    usdPerAccuracyPoint: rounded(tokenEconomy.usdPerAccuracyPoint, 6),
    lastRunAt: tokenEconomy.lastRunAt || agent.updatedAt || "",
    sourcePath: agent.sourcePath || "",
    description: agent.objective || agent.instructionSummary || `${agent.name} agent model analysis.`
  };
}

function agentAnalysisNode(agent, correlation) {
  const vectorCompleted = agent.vector?.status === "completed";
  const humanReview = Boolean(agent.requiresHumanReview);
  return {
    id: `agent:${agent.id}`,
    type: "agent",
    label: agent.name || agent.id,
    group: correlation ? "global-agent-analysis" : "standalone-agent-analysis",
    risk_level: humanReview ? "high" : vectorCompleted ? "low" : "medium",
    status: agent.status || agent.vector?.status || "active",
    agent_id: agent.id,
    cluster_id: agent.role || agent.domain || "global-agent",
    metadata: agentAnalysisMetadata(agent, correlation)
  };
}

function mergeAgenticSystemGraph(baseGraph, globalAgentsResult) {
  const nodesById = new Map((baseGraph.nodes || []).filter((node) => node?.id).map((node) => [node.id, node]));
  const linksByKey = new Map(
    (baseGraph.links || []).map((link) => [
      `${graphNodeId(link.source)}->${graphNodeId(link.target)}:${link.type || "related"}`,
      link
    ])
  );
  const projectsByKey = projectNodeLookup(baseGraph.nodes || []);
  let correlatedCount = 0;
  let standaloneCount = 0;

  for (const agent of globalAgentsResult.agents || []) {
    if (!agent?.id) continue;
    const correlation = projectCorrelationForAgent(agent, projectsByKey);
    const node = agentAnalysisNode(agent, correlation);
    const existing = nodesById.get(node.id);
    nodesById.set(node.id, existing ? { ...existing, ...node, metadata: { ...(existing.metadata || {}), ...node.metadata } } : node);
    if (correlation) {
      correlatedCount += 1;
      const key = `${correlation.node.id}->${node.id}:has_agent_model_analysis`;
      if (!linksByKey.has(key)) {
        linksByKey.set(key, {
          source: correlation.node.id,
          target: node.id,
          type: "has_agent_model_analysis",
          weight: 1.5,
          metadata: {
            modelNodalAnalysis: true,
            correlation: "matched_project_node",
            project: correlation.node.label
          }
        });
      }
    } else {
      standaloneCount += 1;
    }
  }

  return {
    ...baseGraph,
    metadata: {
      ...(baseGraph.metadata || {}),
      agent_model_nodal_analysis: true,
      agent_model_nodal_analysis_count: (globalAgentsResult.agents || []).length,
      correlated_agent_analysis_count: correlatedCount,
      standalone_agent_analysis_count: standaloneCount,
      global_agent_source: globalAgentsResult.source || null
    },
    nodes: [...nodesById.values()],
    links: [...linksByKey.values()]
  };
}

function adaptiveFlowEvidence({ projectName, orchestrated, result, error = "" }) {
  // A workflow can fail before `runPlutoniXOwnedWorkflow` returns a result.
  // The route has already been selected and recorded in the orchestration
  // envelope at that point, so retain it instead of presenting the route as
  // "failed" or claiming that none of the choices were taken.
  const route = result?.adaptiveRoute || orchestrated?.structuredRequest?.orchestrationEnvelope?.adaptiveRoute || null;
  const selectedMode = route?.mode || (error ? "failed" : "pending");
  const projectAgentId = `${String(projectName || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-orchestrator-agent`;
  const activeAgents = [
    {
      id: "plutonix-fullstack-agent",
      name: "PlutoniX Fullstack Agent",
      role: "Canonical authority",
      status: "completed",
      action: "Classified the task, selected the route, enforced constraints, and controlled completion."
    }
  ];
  if (["delegated", "delegated_reviewed"].includes(selectedMode)) {
    activeAgents.push({
      id: projectAgentId,
      name: `${projectName || "Project"} Orchestrator Agent`,
      role: "Bounded project executor",
      status: error ? "failed" : "completed",
      action: "Executed the project-scoped change without receiving completion authority."
    });
  }
  if (selectedMode === "delegated_reviewed") {
    activeAgents.push({
      id: "plutonix-independent-reviewer",
      name: "PlutoniX Independent Reviewer",
      role: "Read-only validator",
      status: result?.review?.status || (error ? "skipped" : "pending"),
      action: error
        ? "Not run because execution did not produce the required file-change evidence."
        : "Inspected workspace evidence and returned an independent pass/fail verdict."
    });
  }

  const actions = (result?.fileOperations || []).map((operation, index) => ({
    id: `file-action-${index + 1}`,
    type: operation.action || "modify",
    label: `${String(operation.action || "modify").toUpperCase()} ${operation.path}`,
    target: operation.path,
    reason: operation.reason || "Required by the selected adaptive execution path.",
    status: "completed"
  }));
  const structuredRequest = orchestrated?.structuredRequest || {};
  const requestedFunctionality = structuredRequest.rawTextBoxInstruction || structuredRequest.sourceInstruction || structuredRequest.objective || "";
  const functionalityNames = [
    requestedFunctionality,
    ...(structuredRequest.sections || []).filter((section) => section && section !== "direct-task").map((section) => `Section: ${String(section).replaceAll("_", " ")}`),
    ...(structuredRequest.routePlan || []).map((route) => `Route: ${route.title || route.key || route.path}`)
  ].filter(Boolean);
  const functionalities = [...new Set(functionalityNames)].map((label, index) => ({
    id: `functionality-${index + 1}`,
    label,
    type: "functionality",
    // The requested objective is the major capability. Planned sections and
    // routes are its children, which gives the functionality graph a useful
    // execution hierarchy instead of a flat list from the project root.
    parentFunctionalityId: index === 0 ? "" : "functionality-1",
    state: error ? "failed" : result?.buildId ? "completed" : "selected",
    detail: index === 0 ? "Requested project functionality selected for implementation." : "Included by the PlutoniX feature and route plan."
  }));
  const routeChoices = ["single", "delegated", "delegated_reviewed"].map((mode) => ({
    id: mode,
    label: mode.replaceAll("_", " "),
    state: mode === selectedMode ? "selected" : "rejected",
    reason: mode === selectedMode
      ? (route?.reasons || []).join(" ") || "Selected by the adaptive routing score."
      : mode === "single"
        ? "Rejected because task complexity or managed-project ownership justified delegation."
        : mode === "delegated"
          ? "Rejected when either delegation was unnecessary or independent review was required."
          : "Rejected because risk, complexity, or the model-call budget did not require an independent reviewer."
  }));
  const decisionTree = {
    id: result?.parentWorkflowId || "plutonix-pending",
    label: `${projectName || "PlutoniX"} adaptive workflow`,
    type: "workflow",
    // The workflow can fail after a route has been selected. Keep the tree
    // root selected in that case; the execution and completion nodes carry
    // the failure state and make the actual failure point explicit.
    state: route ? "selected" : error ? "failed" : "pending",
    children: [
      {
        id: "adaptive-routing",
        label: `Adaptive route: ${selectedMode}`,
        type: "decision",
        state: route ? "selected" : error ? "failed" : "pending",
        detail: route ? `Score ${route.routeScore}; risk ${route.riskLevel}; ${route.plannedModelCalls}/${route.modelCallBudget} model calls.` : error || "Route pending.",
        children: routeChoices
      },
      {
        id: "working-agents",
        label: "Working agents",
        type: "agents",
        state: error ? "failed" : "completed",
        children: activeAgents.map((agent) => ({ ...agent, label: agent.name, type: "agent", state: agent.status }))
      },
      {
        id: "selected-functionalities",
        label: "Selected features and functionalities",
        type: "functionalities",
        state: functionalities.length ? (error ? "failed" : "completed") : "pending",
        children: functionalities
      },
      {
        id: "implementation-actions",
        label: "Implementation actions",
        type: "actions",
        state: actions.length ? "completed" : error ? "failed" : "pending",
        children: actions.map((action) => ({ ...action, type: "action", state: action.status, detail: action.reason }))
      },
      {
        id: "rejected-choices",
        label: "Rejected or not selected",
        type: "rejections",
        state: "completed",
        children: routeChoices.filter((choice) => choice.state === "rejected").map((choice) => ({ ...choice, type: "rejection" }))
      },
      {
        id: "completion-gate",
        label: "PlutoniX completion gate",
        type: "validation",
        state: error ? "failed" : result?.buildId ? "completed" : "pending",
        detail: error || (result?.review ? "Independent review passed; PlutoniX approved completion." : "Execution evidence passed; PlutoniX approved completion.")
      }
    ]
  };
  return { route, selectedMode, activeAgents, actions, functionalities, routeChoices, decisionTree };
}

function normalizeIntelExpansionContract(intel = {}, { projectName = "PlutoniX default workspace" } = {}) {
  const enabled = Boolean(intel?.enabled);
  const minExpansionScore = Math.max(0, Math.min(100, Number(intel?.minExpansionScore || 72)));
  return {
    enabled,
    mode: enabled ? "profile_driven_intelligence" : "off",
    scope: "selected_user_application_only",
    projectName,
    minExpansionScore,
    scoringRubric: {
      userObjectiveFit: 30,
      workflowCompleteness: 20,
      userValue: 15,
      technicalFeasibility: 15,
      evidenceQuality: 10,
      scopeRiskFit: 10
    },
    stopRules: [
      `Do not advance a proposal below ${minExpansionScore}/100.`,
      "Stop when profile detection is ambiguous or unsupported.",
      "Stop when required evidence is absent, the work violates the selected profile, or the proposal adds unrelated filler.",
      "Do not run a writer before backend scoring accepts a proposal."
    ],
    requiredOutputs: [
      "Record profile selection, actual agent runs, evidence, backend score decisions, artifacts, validation, verification, and any bounded repair.",
      "Implement only backend-accepted proposals through one workspace writer."
    ]
  };
}

function intelRuntimeFlowEvidence(intelRuntime = null, intelContract = {}) {
  if (!intelRuntime) return { agents: [], actions: [], decisions: [], nodes: [], evidence: [] };
  const actualRuns = Array.isArray(intelRuntime.agentRuns) ? intelRuntime.agentRuns : [];
  const taskNodes = Array.isArray(intelRuntime.taskGraph?.nodes) ? intelRuntime.taskGraph.nodes : [];
  const proposals = Array.isArray(intelRuntime.proposals) ? intelRuntime.proposals : [];
  const selection = intelRuntime.profileSelection || {};
  return {
    agents: actualRuns.map((run) => ({
      id: run.id,
      name: run.name || run.role,
      role: run.role,
      status: run.status,
      action: `${run.permissionMode || "read-only"} execution via ${run.transport || "unknown"}.`
    })),
    actions: taskNodes.map((node) => ({
      id: `intel-${node.id}`,
      type: node.permissions === "workspace-write" ? "implement" : "analyze",
      label: node.role.replaceAll("-", " "),
      target: (node.allowedPaths || []).join(", ") || "Intel control plane",
      reason: node.objective,
      status: node.status
    })),
    decisions: [
      {
        id: "intel-profile-selection",
        label: "Intel profile",
        value: `${intelRuntime.profile?.displayName || intelRuntime.profile?.id || "unknown"} (${intelRuntime.profile?.status || "unknown"})`,
        reason: `Confidence ${selection.confidence || 0}%. ${(selection.reasons || []).join(" ")}`
      },
      ...proposals.map((proposal) => ({
        id: `intel-proposal-${proposal.id}`,
        label: "Intel proposal",
        value: `${proposal.status}: ${proposal.total}/100`,
        reason: (proposal.reasons || []).join(" ")
      }))
    ],
    nodes: taskNodes.map((node) => ({
      id: `intel-${node.id}`,
      label: node.role.replaceAll("-", " "),
      state: node.status,
      detail: node.objective
    })),
    evidence: [
      `Intel profile: ${intelRuntime.profile?.id || "unknown"}.`,
      `Intel phase: ${intelRuntime.phase || "unknown"}.`,
      `Provider: ${intelRuntime.provider?.name || "unknown"} via ${intelRuntime.provider?.transport || "unknown"}.`,
      `Proposals: ${proposals.filter((proposal) => proposal.status === "accepted").length} accepted, ${proposals.filter((proposal) => proposal.status === "rejected").length} rejected, ${proposals.filter((proposal) => proposal.status === "deferred").length} deferred.`
    ]
  };
}

function intelSelectionFlowPath({ projectName, taskType, workflowMode, selection, productDecision }) {
  const profile = intelProfileSummary(selection);
  const clarification = selection.status === "needs_clarification";
  return {
    status: selection.status,
    selectedPath: clarification ? "intel-profile-clarification" : "intel-profile-unsupported",
    projectName,
    taskType,
    workflowMode,
    confidence: selection.confidence || 0,
    summary: clarification
      ? selection.clarification
      : selection.failureReason || `Intel cannot execute ${profile.displayName}.`,
    productDecision,
    activeAgents: [],
    functionalities: [],
    featureActions: [],
    executedDecisions: [{
      id: "intel-profile-selection",
      label: "Intel profile selection",
      value: `${profile.displayName} (${profile.status})`,
      reason: (selection.reasons || []).join(" ")
    }],
    rejectedPaths: (selection.alternatives || []).map((alternative) => ({
      id: alternative.profileId,
      reason: `Alternative profile confidence: ${alternative.confidence}%.`
    })),
    nodes: [
      { id: "intel-profile-detection", label: "Detecting project type", state: "completed", detail: (selection.reasons || []).join(" ") || "Profile signals evaluated." },
      { id: "intel-profile-selection", label: "Profile selection", state: clarification ? "selected" : "failed", detail: clarification ? selection.clarification : selection.failureReason || "No supported profile was selected." },
      { id: "intel-implementation", label: "Implementing or creating artifact", state: "skipped", detail: "No writer was started before a supported profile selection." }
    ],
    intel: {
      profile,
      profileSelection: {
        profileId: selection.profileId,
        confidence: selection.confidence,
        reasons: selection.reasons,
        alternatives: selection.alternatives,
        source: selection.source,
        requiresUserConfirmation: selection.requiresUserConfirmation
      },
      phase: clarification ? "detecting-project-type" : "unsupported",
      status: selection.status,
      provider: { name: "codex", transport: "cli", fallback: false, status: "not_started" },
      agentRuns: [],
      taskGraph: { nodes: [] },
      proposals: [],
      artifacts: [],
      validationResults: [],
      failure: clarification ? null : { reason: selection.failureReason || "Unsupported Intel profile.", retryable: false },
      repairCycles: 0
    }
  };
}

function projectCreationFlowPath({ projectName, taskType, orchestrated, result, status = "succeeded", error = "" }) {
  const adaptive = adaptiveFlowEvidence({ projectName, orchestrated, result, error });
  const intelRuntime = orchestrated?.structuredRequest?.intelRuntime || null;
  const intelEvidence = intelRuntimeFlowEvidence(intelRuntime, orchestrated?.structuredRequest?.intelExpansion);
  const baseFunctionalityGraph = buildFunctionalityGraph({
    projectId: orchestrated?.structuredRequest?.project?.id || "",
    projectName,
    structuredRequest: orchestrated?.structuredRequest || {},
    functionalities: adaptive.functionalities,
    actions: adaptive.actions,
    activeAgents: [...adaptive.activeAgents, ...intelEvidence.agents],
    status
  });
  const intelGraph = intelRuntimeGraphRecords(intelRuntime);
  const functionalityGraph = {
    ...baseFunctionalityGraph,
    nodes: [...baseFunctionalityGraph.nodes, ...intelGraph.nodes],
    links: [...baseFunctionalityGraph.links, ...intelGraph.edges]
  };
  // Recovery is a follow-up choice, not a retroactive replacement for the
  // execution path PlutoniX already selected.
  const selectedPath = "plutonix-global-orchestration";
  const deterministicScore = error
    ? {
        objectiveFit: 10,
        requiredFeatureCoverage: 8,
        relevantFeatureExpansion: 5,
        technicalFeasibility: 4,
        reuseOfExistingAgentsAndPatterns: 7,
        validationAndDeploymentReadiness: 3,
        tokenTimeCostEfficiency: 5
      }
    : {
        objectiveFit: 23,
        requiredFeatureCoverage: 18,
        relevantFeatureExpansion: 13,
        technicalFeasibility: 14,
        reuseOfExistingAgentsAndPatterns: 9,
        validationAndDeploymentReadiness: 8,
        tokenTimeCostEfficiency: 4
      };
  const confidence = Object.values(deterministicScore).reduce((sum, value) => sum + value, 0);
  const hardConstraints = [
    "preserve_user_instruction_objective",
    "bind_reusable_agents_to_project",
    "preserve_standalone_docker_portability",
    "avoid_secret_storage",
    "maintain_graph_vector_memory_and_local_agent_controls",
    "validate_or_report_unavailable_validation"
  ];
  const relevantFeatureExpansion = [
    "responsive_app_shell",
    "empty_loading_error_states",
    "standalone_docker_packaging",
    "project_local_orchestrator",
    "agentic_system_graph_metadata",
    "what_next_path_knowledge"
  ];
  return {
    status,
    selectedPath,
    confidence,
    deterministic: true,
    scoringRubric: deterministicScore,
    hardConstraints,
    relevantFeatureExpansion,
    subObjectives: [
      {
        id: "requirements",
        label: "Requirements",
        state: "completed",
        detail: orchestrated?.structuredRequest?.sections?.length
          ? `${orchestrated.structuredRequest.sections.length} requested sections mapped`
          : "Instruction prompt captured"
      },
      {
        id: "feature-coverage",
        label: "Feature coverage",
        state: error ? "blocked" : "selected",
        detail: "Direct and indirect app capabilities expanded"
      },
      {
        id: "architecture",
        label: "Architecture",
        state: error ? "blocked" : "completed",
        detail: "UI, data, agents, memory, and Docker constraints"
      },
      {
        id: "generation",
        label: "Generation",
        state: result?.buildId ? "completed" : error ? "blocked" : "pending",
        detail: result?.buildId ? `Gotham build ${result.buildId}` : "Awaiting Gotham file work"
      },
      {
        id: "validation",
        label: "Validation",
        state: result?.buildId && !error ? "selected" : "pending",
        detail: "Preview handoff and next development review"
      }
    ],
    projectName,
    taskType,
    summary: error
      ? "Generation failed after PlutoniX selected its execution path. A Human Agent may now choose a recovery action."
      : "PlutoniX retained global authority, delegated bounded project execution, and approved the generated result.",
    activeAgents: [...adaptive.activeAgents, ...intelEvidence.agents],
    intel: intelRuntime
      ? {
          profile: intelRuntime.profile,
          profileSelection: intelRuntime.profileSelection,
          phase: intelRuntime.phase,
          status: intelRuntime.status,
          provider: intelRuntime.provider,
          agentRuns: intelRuntime.agentRuns,
          evidence: intelRuntime.evidence || [],
          taskGraph: intelRuntime.taskGraph,
          proposals: intelRuntime.proposals,
          artifacts: intelRuntime.artifacts,
          validationResults: intelRuntime.validationResults,
          failure: intelRuntime.failure,
          repairCycles: intelRuntime.repairCycles
        }
      : null,
    functionalities: adaptive.functionalities,
    featureActions: [...adaptive.actions, ...intelEvidence.actions],
    functionalityGraph,
    adaptiveRoute: adaptive.route,
    decisionTree: adaptive.decisionTree,
    executedDecisions: [
      ...intelEvidence.decisions,
      {
        id: "adaptive-route",
        label: "Adaptive execution route",
        value: adaptive.selectedMode,
        reason: adaptive.route?.reasons?.join(" ") || error || "Adaptive route evidence is pending."
      },
      {
        id: "selected-path",
        label: "Selected path",
        value: selectedPath,
        reason: error
          ? "PlutoniX selected this execution path before generation failed; no recovery option has been selected yet."
          : "Highest deterministic score while preserving project-local agents, memory, Docker readiness, and Gotham handoff."
      },
      {
        id: "agent-topology",
        label: "Agent topology",
        value: error ? "deferred" : "PlutoniX global authority with project-scoped executors",
        reason: error
          ? "Agent execution is deferred until recovery choice is selected."
          : "The project requires local orchestration, graph/vector memory controls, QAgent support, and validation handoff."
      },
      {
        id: "generation-route",
        label: "Generation route",
        value: result?.buildId ? `Gotham build ${result.buildId}` : error ? "blocked" : "pending",
        reason: result?.files?.length
          ? `${result.files.length} file changes were produced for this project.`
          : error || "Waiting for file generation evidence."
      }
    ],
    humanInLoop: {
      required: Boolean(error),
      reason: error ? "A human choice is needed before retrying or changing the development path." : "",
      choices: error
        ? [
            { id: "retry-same-path", label: "Retry same path", impact: "Use the same project-local orchestrator path again." },
            { id: "simplify-scope", label: "Simplify scope", impact: "Reduce project requirements before retrying." },
            { id: "change-architecture", label: "Change architecture", impact: "Choose a different technical direction before generation." }
          ]
        : []
    },
    nodes: [
      {
        id: "intake",
        label: "Instruction intake",
        state: "completed",
        detail: `Task type ${taskType || "Medium"}`
      },
      {
        id: "path-selection",
        label: "What-next path selection",
        state: "completed",
        detail: `Deterministic constraint score ${confidence}/100 selected the strongest path.`
      },
      ...intelEvidence.nodes,
      {
        id: "plutonix-global-orchestration",
        label: "PlutoniX global orchestration",
        state: selectedPath === "plutonix-global-orchestration" ? "selected" : "disabled",
        detail: "Own the parent task, delegate bounded execution, validate evidence, and approve completion."
      },
      {
        id: "project-local-orchestrator",
        label: "Project-local orchestrator",
        state: selectedPath === "plutonix-global-orchestration" ? "delegated" : "disabled",
        detail: "Provide project-scoped context and execute the bounded PlutoniX delegation."
      },
      {
        id: "template-only",
        label: "Template-only generation",
        state: selectedPath === "template-only" ? "selected" : "disabled",
        detail: "Faster path, skipped because project memory and agents are required."
      },
      {
        id: "human-choice-review",
        label: "Human Agent choice",
        state: error ? "pending" : "disabled",
        detail: error ? "Review retry, scope change, or alternate architecture." : "Available when path confidence is low."
      },
      {
        id: "gotham-generation",
        label: "Gotham generation",
        state: result?.buildId ? "completed" : error ? "blocked" : "pending",
        detail: result?.buildId ? `Build ${result.buildId}` : "Waiting for generation evidence."
      },
      {
        id: "runtime-handoff",
        label: "Runtime handoff",
        state: result?.buildId && !error ? "completed" : "pending",
        detail: "Assign preview port and preserve standalone Docker path."
      }
    ],
    rejectedPaths: [
      ...adaptive.routeChoices.filter((choice) => choice.state === "rejected").map((choice) => ({
        id: choice.id,
        reason: choice.reason,
        constraint: adaptive.route ? `risk=${adaptive.route.riskLevel}; calls=${adaptive.route.plannedModelCalls}/${adaptive.route.modelCallBudget}` : "route unavailable"
      })),
      {
        id: "template-only",
        reason: "Lower required feature coverage and does not capture enough project-local agent, memory, Docker, and graph context."
      },
      {
        id: "human-choice-review",
        reason: error ? "Available after the failure; no recovery option has been selected yet." : "Not selected because path confidence was sufficient."
      }
    ],
    evidence: [
      ...intelEvidence.evidence,
      orchestrated?.structuredRequest?.pageType ? `Page type: ${orchestrated.structuredRequest.pageType}` : "",
      orchestrated?.structuredRequest?.sections?.length ? `Sections: ${orchestrated.structuredRequest.sections.join(", ")}` : "",
      result?.files?.length ? `${result.files.length} generated file changes` : ""
    ].filter(Boolean),
    nextRecommendation: error
      ? "Ask the Human Agent to choose retry, simplify scope, or change architecture."
      : "Review the generated preview, then continue with targeted project-local tasks."
  };
}

export function gothamInstructionFlowPath({ projectName, taskType, workflowMode = "executor", orchestrated, result, status = "succeeded", error = "", useProjectOrchestrator = false }) {
  const flowPath = projectCreationFlowPath({ projectName, taskType, orchestrated, result, status, error });
  const mode = normalizeGothamWorkflowMode(workflowMode);
  const modeLabel = gothamModeLabel(mode);
  const selectedPath = "plutonix-global-orchestration";
  const changedCount = result?.files?.length || 0;
  return {
    ...flowPath,
    workflowMode: mode,
    selectedPath,
    summary: error
      ? "Gotham chat instruction failed. Human Agent review is the next decision point."
      : `Gotham ${modeLabel} instruction executed through the selected deterministic workflow path.`,
    nodes: flowPath.nodes.map((node) => {
      if (node.id === "intake") {
        return { ...node, detail: `Gotham ${modeLabel} instruction captured as ${taskType || "Medium"} task.` };
      }
      if (node.id === "path-selection") {
        return { ...node, detail: `Deterministic path selection executed for ${projectName || "PlutoniX workspace"}.` };
      }
      if (node.id === "project-local-orchestrator") {
        return {
          ...node,
          state: useProjectOrchestrator ? "delegated" : "disabled",
          detail: useProjectOrchestrator
            ? "PlutoniX delegated bounded execution while retaining parent authority."
            : "No project delegation is needed for the PlutoniX default workspace."
        };
      }
      if (node.id === "template-only") {
        return {
          ...node,
          state: selectedPath === "template-only" ? "selected" : "disabled",
          detail: useProjectOrchestrator
            ? "Rejected because project-local orchestration is required for this project."
            : "Selected for the PlutoniX default generated-site workflow."
        };
      }
      return node;
    }),
    executedDecisions: [
      ...(flowPath.executedDecisions || []).filter((decision) => !["selected-path", "generation-route"].includes(decision.id)),
      {
        id: "selected-path",
        label: "Selected path",
        value: selectedPath,
        reason: error
          ? "PlutoniX selected this execution path before generation failed; no recovery option has been selected yet."
          : useProjectOrchestrator
            ? "PlutoniX retained task authority and selected bounded project execution."
            : "No project-local scope was selected, so PlutoniX used its default generated-site workflow."
      },
      {
        id: "generation-route",
        label: "Generation route",
        value: result?.buildId ? `Gotham build ${result.buildId}` : error ? "blocked" : "pending",
        reason: changedCount ? `${changedCount} file changes were produced by this chat instruction.` : error || "Waiting for Gotham file generation evidence."
      }
    ],
    rejectedPaths: [
      ...(flowPath.rejectedPaths || []).filter((pathOption) => !["template-only", "project-local-orchestrator", "human-choice-review"].includes(pathOption.id)),
      {
        id: useProjectOrchestrator ? "template-only" : "project-local-orchestrator",
        reason: useProjectOrchestrator
          ? "Rejected because the active project requires project-local agents, memory, and runtime handoff."
          : "Rejected because no non-default project was selected for this Gotham chat instruction."
      },
      {
        id: "human-choice-review",
        reason: error ? "Available after the failure; no recovery option has been selected yet." : "Not selected because path confidence was sufficient."
      }
    ],
    nextRecommendation: error
      ? "Ask the Human Agent to choose retry, simplify scope, or change architecture."
      : "Review the updated preview, then continue with the next project-specific Gotham chat instruction."
  };
}

function plutonixProjectRoot() {
  if (process.env.PLUTONIX_PROJECT_ROOT) return process.env.PLUTONIX_PROJECT_ROOT;
  if (fs.existsSync(path.join(process.cwd(), "apps", "backend"))) return process.cwd();
  return path.resolve(process.cwd(), "../..");
}

function persistWhatNextKnowledge(flowPath, extra = {}) {
  const projectKey = safeFileBase(extra.projectId || flowPath?.projectName || "plutonix-default");
  const knowledgePath = path.join(plutonixProjectRoot(), "memory", "project-intelligence", "projects", projectKey, "what-next-knowledge.jsonl");
  fs.mkdirSync(path.dirname(knowledgePath), { recursive: true });
  fs.appendFileSync(
    knowledgePath,
    `${JSON.stringify({
      recordedAt: new Date().toISOString(),
      source: "plutonix-project-creation",
      ...extra,
      flowPath
    })}\n`
  );
}

function projectHistoryRoot(projectId = "") {
  return path.join(plutonixProjectRoot(), "memory", "project-intelligence", "projects", safeFileBase(projectId || "plutonix-default"));
}

function projectInstructionLedgerPath(projectId = "") {
  return path.join(projectHistoryRoot(projectId), "project-instructions.jsonl");
}

function projectHistoryFiles(fileName, projectId = "") {
  const legacyPath = path.join(plutonixProjectRoot(), "memory", "project-intelligence", fileName);
  if (projectId) return [path.join(projectHistoryRoot(projectId), fileName), legacyPath];
  const projectsRoot = path.join(plutonixProjectRoot(), "memory", "project-intelligence", "projects");
  const scopedPaths = fs.existsSync(projectsRoot)
    ? fs.readdirSync(projectsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(projectsRoot, entry.name, fileName))
    : [];
  return [legacyPath, ...scopedPaths];
}

function safeJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function appendJsonLine(filePath, record = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function investorResearchDir() {
  return path.join(plutonixProjectRoot(), "runtime", "self-improvement", "research");
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function investorProfilesPath() {
  return path.join(investorResearchDir(), "investor-profiles.json");
}

function investorSearchStatePath() {
  return path.join(investorResearchDir(), "investor-search-state.json");
}

function investorProposalsPath() {
  return path.join(investorResearchDir(), "investor-proposals.json");
}

function investorDispatchesPath() {
  return path.join(investorResearchDir(), "investor-outreach-dispatches.json");
}

function investorOrgEnrichmentPath() {
  return path.join(investorResearchDir(), "investor-org-enrichment.json");
}

function writeInvestorProfiles(profiles = []) {
  writeJsonFile(investorProfilesPath(), profiles);
}

function readInvestorProposals() {
  return readJsonFile(investorProposalsPath(), []);
}

function writeInvestorProposals(proposals = []) {
  writeJsonFile(investorProposalsPath(), proposals);
}

function readInvestorDispatches() {
  return readJsonFile(investorDispatchesPath(), []);
}

function writeInvestorDispatches(dispatches = []) {
  writeJsonFile(investorDispatchesPath(), dispatches);
}

function readInvestorOrgEnrichment() {
  return readJsonFile(investorOrgEnrichmentPath(), {});
}

function writeInvestorOrgEnrichment(enrichment = {}) {
  writeJsonFile(investorOrgEnrichmentPath(), enrichment);
}

function investorRecordKey(record = {}) {
  return String(record.linkedinUrl || record.publicIdentifier || record.id || record.name || "")
    .trim()
    .toLowerCase();
}

const investorCountryOptions = [
  { id: "india", label: "India", aliases: ["india", "mumbai", "bengaluru", "bangalore", "delhi", "new delhi", "gurugram", "gurgaon", "hyderabad", "pune", "chennai", "noida", "ahmedabad", "kolkata", "maharashtra", "karnataka", "haryana", "telangana", "tamil nadu"] },
  { id: "united-states", label: "United States", aliases: ["united states", "usa", "u.s.", "san francisco", "bay area", "new york", "california", "texas", "washington", "boston", "austin", "palo alto", "cupertino", "seattle"] },
  { id: "singapore", label: "Singapore", aliases: ["singapore"] },
  { id: "united-kingdom", label: "United Kingdom", aliases: ["united kingdom", "uk", "england", "london", "cambridge", "oxford"] },
  { id: "germany", label: "Germany", aliases: ["germany", "berlin", "munich", "hamburg"] },
  { id: "canada", label: "Canada", aliases: ["canada", "toronto", "vancouver", "montreal", "ontario"] },
  { id: "israel", label: "Israel", aliases: ["israel", "tel aviv"] },
  { id: "france", label: "France", aliases: ["france", "paris"] },
  { id: "australia", label: "Australia", aliases: ["australia", "sydney", "melbourne"] }
];

function normalizeCountry(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "all") return "";
  const option = investorCountryOptions.find((country) => country.id === normalized || country.label.toLowerCase() === normalized);
  return option?.id || safeFileBase(normalized);
}

function countryOption(country = "") {
  const key = normalizeCountry(country);
  return investorCountryOptions.find((item) => item.id === key) || (key ? { id: key, label: country, aliases: [String(country).toLowerCase()] } : null);
}

function recordMatchesCountry(record = {}, country = "") {
  const option = countryOption(country);
  if (!option) return true;
  const location = String(record.location || "").toLowerCase();
  return option.aliases.some((alias) => location.includes(alias));
}

function countryLabel(country = "") {
  return countryOption(country)?.label || "";
}

function inferRecordCountry(record = {}) {
  const match = investorCountryOptions.find((country) => recordMatchesCountry(record, country.id));
  return match?.label || "";
}

function profileIntro(record = {}) {
  const bits = [];
  if (record.role && record.company) bits.push(`${record.role} at ${record.company}`);
  else if (record.role) bits.push(record.role);
  else if (record.company) bits.push(`Associated with ${record.company}`);
  if (record.headline) bits.push(record.headline);
  if (record.location) bits.push(`Based in ${record.location}`);
  bits.push(`${record.thesisFit || "Needs review"} for PlutoniX based on AI, devtools, SaaS and investor keywords.`);
  return bits.filter(Boolean).join(". ");
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "PlutoniX/1.0 investor-research",
        ...(options.headers || {})
      }
    });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function enrichOrganization(companyName = "") {
  const name = String(companyName || "").trim();
  if (!name) return null;
  const cacheKey = safeFileBase(name);
  const cache = readInvestorOrgEnrichment();
  if (cache[cacheKey] && Date.now() - Date.parse(cache[cacheKey].updatedAt || 0) < 7 * 24 * 60 * 60 * 1000) return cache[cacheKey];
  const enrichment = {
    name,
    businessDetails: "",
    sourceUrl: "",
    finance: {
      status: "not_found",
      symbol: "",
      exchange: "",
      regularMarketPrice: null,
      marketCap: null,
      currency: "",
      source: ""
    },
    updatedAt: new Date().toISOString()
  };
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&origin=*`;
    const searchPayload = await fetchJsonWithTimeout(searchUrl);
    const pageTitle = searchPayload?.query?.search?.[0]?.title;
    if (pageTitle) {
      const summary = await fetchJsonWithTimeout(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`);
      if (summary?.extract) {
        enrichment.name = summary.title || name;
        enrichment.businessDetails = summary.extract;
        enrichment.sourceUrl = summary.content_urls?.desktop?.page || "";
      }
    }
  } catch {
    // Public org enrichment is best-effort and must not block investor discovery.
  }
  try {
    const quoteSearch = await fetchJsonWithTimeout(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=1&newsCount=0`);
    const quote = quoteSearch?.quotes?.find((item) => item.symbol && item.quoteType === "EQUITY") || quoteSearch?.quotes?.[0];
    if (quote?.symbol) {
      const chart = await fetchJsonWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(quote.symbol)}?range=1d&interval=1d`);
      const meta = chart?.chart?.result?.[0]?.meta || {};
      enrichment.finance = {
        status: "found",
        symbol: quote.symbol || "",
        exchange: quote.exchange || quote.exchDisp || "",
        regularMarketPrice: meta.regularMarketPrice ?? quote.regularMarketPrice ?? null,
        marketCap: quote.marketCap ?? null,
        currency: meta.currency || "",
        source: "Yahoo Finance public quote search"
      };
    }
  } catch {
    // Finance enrichment stays optional because many investor orgs are private funds.
  }
  cache[cacheKey] = enrichment;
  writeInvestorOrgEnrichment(cache);
  return enrichment;
}

function shortStableHash(value = "") {
  let hash = 5381;
  for (const char of String(value || "")) {
    hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

function investorStableId(record = {}) {
  const source = record.linkedinUrl || record.publicIdentifier || record.id || record.name || `investor-${Date.now()}`;
  let slugSource = record.publicIdentifier || record.name || source;
  try {
    const url = new URL(source);
    slugSource = url.pathname.split("/").filter(Boolean).pop() || source;
  } catch {
    // Non-URL identifiers are already usable as slug input.
  }
  return `${safeFileBase(slugSource)}-${shortStableHash(source)}`.slice(0, 96);
}

function readInvestorProfiles() {
  const profiles = readJsonFile(investorProfilesPath(), []);
  let repaired = false;
  const seenIds = new Set();
  const normalized = profiles.map((profile) => {
    const stableId = investorStableId(profile);
    let nextProfile = profile;
    if (!profile.id || profile.id === "https-www-linkedin" || seenIds.has(profile.id)) {
      repaired = true;
      nextProfile = { ...nextProfile, id: stableId };
    }
    if (!nextProfile.country) {
      repaired = true;
      nextProfile = { ...nextProfile, country: inferRecordCountry(nextProfile) };
    }
    if (!nextProfile.profileIntro) {
      repaired = true;
      nextProfile = { ...nextProfile, profileIntro: profileIntro(nextProfile) };
    }
    seenIds.add(nextProfile.id);
    return nextProfile;
  });
  if (repaired) writeInvestorProfiles(normalized);
  return normalized;
}

const investorSearchDeck = [
  {
    label: "AI infra seed investors",
    query: "seed investor AI infrastructure autonomous agents developer tools"
  },
  {
    label: "Devtools venture partners",
    query: "venture partner developer tools workflow automation AI coding"
  },
  {
    label: "Enterprise automation angels",
    query: "angel investor enterprise automation AI agents SaaS"
  },
  {
    label: "Open source AI backers",
    query: "investor open source AI developer platform infrastructure"
  },
  {
    label: "Product-led SaaS investors",
    query: "seed investor product led SaaS devtools automation"
  },
  {
    label: "AI workflow founders fund",
    query: "founder investor AI workflow automation engineering productivity"
  },
  {
    label: "Technical operator angels",
    query: "operator angel investor CTO developer tools AI infrastructure"
  },
  {
    label: "Future of work investors",
    query: "investor future of work AI agents productivity software"
  }
];

function nextInvestorSearch(explicit = {}) {
  if (explicit.query) {
    return {
      label: explicit.label || "Manual investor search",
      query: explicit.query,
      cursor: null
    };
  }
  const state = readJsonFile(investorSearchStatePath(), { cursor: 0, history: [] });
  const cursor = Number.isFinite(Number(state.cursor)) ? Number(state.cursor) : 0;
  const search = investorSearchDeck[cursor % investorSearchDeck.length];
  const nextState = {
    cursor: cursor + 1,
    history: [
      ...(Array.isArray(state.history) ? state.history : []),
      {
        at: new Date().toISOString(),
        label: search.label,
        query: search.query
      }
    ].slice(-100)
  };
  writeJsonFile(investorSearchStatePath(), nextState);
  return { ...search, cursor };
}

function scoreInvestorForPlutoniX(record = {}) {
  const haystack = [record.name, record.headline, record.role, record.company, record.location]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const weights = [
    [/ai|artificial intelligence|agent|autonomous/, 24],
    [/developer|devtool|engineering|coding|software infrastructure|platform/, 22],
    [/seed|pre-seed|early stage|angel/, 18],
    [/enterprise|workflow|automation|productivity|saas/, 14],
    [/founder|operator|cto|technical/, 10],
    [/venture|capital|partner|investor/, 8]
  ];
  const score = weights.reduce((total, [pattern, weight]) => total + (pattern.test(haystack) ? weight : 0), 30);
  return Math.min(score, 100);
}

function thesisFitLabel(score) {
  if (score >= 80) return "Top fit";
  if (score >= 64) return "Strong fit";
  if (score >= 48) return "Relevant fit";
  return "Needs review";
}

async function enrichInvestorRecord(record = {}, pull = {}) {
  const score = scoreInvestorForPlutoniX(record);
  const baseRecord = {
    ...record,
    id: investorStableId(record),
    fitScore: score,
    thesisFit: thesisFitLabel(score),
    country: inferRecordCountry(record),
    discoveryQuery: pull.query || record.discoveryQuery || "",
    discoveryLabel: pull.label || record.discoveryLabel || "",
    firstSeenAt: record.firstSeenAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    proposalStatus: record.proposalStatus || "not_prepared",
    outreachStatus: record.outreachStatus || "not_started"
  };
  const organization = baseRecord.company ? await enrichOrganization(baseRecord.company) : record.organization || null;
  return {
    ...baseRecord,
    profileIntro: profileIntro(baseRecord),
    organization
  };
}

async function saveUniqueInvestorProfiles(records = [], pull = {}) {
  const existing = readInvestorProfiles();
  const byKey = new Map(existing.map((record) => [investorRecordKey(record), record]).filter(([key]) => key));
  const added = [];
  const updated = [];
  for (const rawRecord of records) {
    const enriched = await enrichInvestorRecord(rawRecord, pull);
    const key = investorRecordKey(enriched);
    if (!key) continue;
    if (byKey.has(key)) {
      byKey.set(key, {
        ...byKey.get(key),
        ...enriched,
        firstSeenAt: byKey.get(key).firstSeenAt || enriched.firstSeenAt
      });
      updated.push(byKey.get(key));
    } else {
      byKey.set(key, enriched);
      added.push(enriched);
    }
  }
  const profiles = Array.from(byKey.values()).sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0) || String(b.firstSeenAt).localeCompare(String(a.firstSeenAt)));
  writeInvestorProfiles(profiles);
  return { profiles, added, updated };
}

function defaultProductContext(overrides = {}) {
  const marketVisionPath = path.join(plutonixProjectRoot(), "runtime", "self-improvement", "market-vision", "plutonix-market-differentiation.json");
  const marketVision = readJsonFile(marketVisionPath, {});
  return {
    productName: overrides.productName || "PlutoniX",
    productSummary:
      overrides.productSummary ||
      marketVision?.positioning?.oneSentence ||
      "A persistent AI engineering organisation that turns product instructions into runnable software through governed project agents, review, memory, and deployment workflows.",
    category: marketVision?.positioning?.category || "Autonomous software engineering platform",
    moat: marketVision?.positioning?.coreMoat || "Verified delivery, cross-project learning, and controlled continuous evolution",
    demoVideoUrl: overrides.demoVideoUrl || ""
  };
}

function buildInvestorProposal(investor = {}, overrides = {}) {
  const product = defaultProductContext(overrides);
  const evidence = [
    investor.headline,
    investor.role && investor.company ? `${investor.role} at ${investor.company}` : investor.role || investor.company,
    investor.location,
    investor.linkedinUrl
  ].filter(Boolean);
  const fitReasons = [
    `${investor.thesisFit || "Relevant fit"} for ${product.category}`,
    investor.headline ? `Profile signal: ${investor.headline}` : "",
    investor.discoveryQuery ? `Discovered via: ${investor.discoveryQuery}` : "",
    `PlutoniX relevance score: ${investor.fitScore || scoreInvestorForPlutoniX(investor)}/100`
  ].filter(Boolean);
  const inboxSubject = `${product.productName}: persistent AI engineering org for software teams`;
  const inboxBody = [
    `Hi ${investor.name || "there"},`,
    "",
    `I am reaching out because your profile suggests a strong fit with ${product.productName}: ${product.productSummary}`,
    "",
    `Why I think this may be relevant to you: ${fitReasons.join("; ")}.`,
    "",
    `The product combines ${product.moat}. We are preparing a short demo video and would like your review on whether this is compelling for AI infrastructure, developer tooling, and workflow automation investors.`,
    "",
    `Demo video: ${product.demoVideoUrl}`,
    "",
    "Would you be open to reviewing the short proposal and sharing whether this fits your current investment focus?",
    "",
    "Best,"
  ].join("\n");
  const directMessage = [
    `Hi ${investor.name || "there"} - I am building ${product.productName}, ${product.productSummary}`,
    `Your profile looks relevant because ${fitReasons.slice(0, 2).join("; ")}.`,
    `Demo video: ${product.demoVideoUrl}`,
    "Open to reviewing the proposal?"
  ].join(" ");
  return {
    id: `investor_prop_${Date.now()}_${safeFileBase(investor.id || investor.name || "profile")}`,
    investorId: investor.id,
    investorName: investor.name,
    investorProfile: investor,
    product,
    status: "draft_review",
    reviewRequested: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fitReasons,
    profileEvidence: evidence,
    proposal: {
      title: `Proposal for ${investor.name || "investor"}: ${product.productName}`,
      summary: `${product.productName} is positioned for investors focused on AI infrastructure, developer tools, and enterprise workflow automation.`,
      ask: "Review the product proposal and decide whether to approve outreach.",
      demoVideoUrl: product.demoVideoUrl,
      inbox: {
        subject: inboxSubject,
        body: inboxBody
      },
      directMessage
    },
    dispatch: {
      inbox: { status: "pending_approval", sentAt: "" },
      directMessage: { status: "pending_approval", sentAt: "" }
    }
  };
}

function updateInvestorProfile(profileId, patch = {}) {
  const profiles = readInvestorProfiles();
  const updated = profiles.map((profile) => (profile.id === profileId ? { ...profile, ...patch, updatedAt: new Date().toISOString() } : profile));
  writeInvestorProfiles(updated);
  return updated.find((profile) => profile.id === profileId) || null;
}

function normalizeApifyInvestorRecord(item = {}, index = 0) {
  const location = item.location?.linkedinText || item.location?.parsed?.text || item.location || "";
  const fullName = item.fullName || item.name || [item.firstName, item.lastName].filter(Boolean).join(" ").trim();
  const linkedinUrl = item.linkedinUrl || item.profileUrl || item.url || (item.publicIdentifier ? `https://www.linkedin.com/in/${item.publicIdentifier}` : "");
  const currentCompany = item.currentCompany?.name || item.companyName || item.company || item.position?.companyName || "";
  return {
    id: item.id || item.objectUrn || item.publicIdentifier || `apify-investor-${index + 1}`,
    name: fullName || "LinkedIn profile",
    headline: item.headline || item.occupation || item.title || "",
    role: item.jobTitle || item.currentPosition || item.position?.title || "",
    company: currentCompany,
    location: typeof location === "string" ? location : "",
    linkedinUrl,
    publicIdentifier: item.publicIdentifier || "",
    followerCount: item.followerCount || item.followersCount || null,
    connectionsCount: item.connectionsCount || null,
    thesisFit: "Needs manual review",
    source: "apify-linkedin-investor-pull"
  };
}

async function runSingleApifyInvestorPull({ query, label = "", country = "", maxItems, takePages }) {
  const token = process.env.APIFY_API_KEY || "";
  if (!token) {
    const error = new Error("APIFY_API_KEY is not configured.");
    error.statusCode = 400;
    throw error;
  }
  const actorId = process.env.APIFY_LINKEDIN_INVESTOR_ACTOR_ID || "harvestapi/linkedin-profile-search";
  const cappedMaxItems = Math.min(Math.max(Number(maxItems || process.env.APIFY_LINKEDIN_INVESTOR_MAX_ITEMS || 20), 1), 50);
  const cappedTakePages = Math.min(Math.max(Number(takePages || process.env.APIFY_LINKEDIN_INVESTOR_TAKE_PAGES || 1), 1), 3);
  const selectedCountry = countryLabel(country);
  const searchQuery = selectedCountry
    ? `${query || "seed investor AI infrastructure developer tools autonomous agents"} ${selectedCountry}`
    : query || "seed investor AI infrastructure developer tools autonomous agents";
  const input = {
    searchQuery,
    profileScraperMode: "Short",
    takePages: cappedTakePages,
    maxItems: cappedMaxItems
  };
  const actorPath = encodeURIComponent(actorId).replace(/%2F/g, "~");
  const apiBaseUrl = String(process.env.APIFY_API_BASE_URL || "https://api.apify.com").replace(/\/$/, "");
  const response = await fetch(`${apiBaseUrl}/v2/acts/${actorPath}/run-sync-get-dataset-items`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  const responseText = await response.text();
  let payload = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = responseText;
  }
  if (!response.ok) {
    const error = new Error(typeof payload === "object" && payload?.error?.message ? payload.error.message : `Apify investor pull failed with HTTP ${response.status}.`);
    error.statusCode = response.status;
    throw error;
  }
  const rawItems = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
  const normalizedRecords = rawItems.slice(0, cappedMaxItems).map((item, index) => normalizeApifyInvestorRecord(item, index));
  const records = selectedCountry
    ? normalizedRecords.filter((record) => recordMatchesCountry(record, selectedCountry))
    : normalizedRecords;
  const evidence = {
    id: `apify_investor_pull_${Date.now()}`,
    timestamp: new Date().toISOString(),
    source: "apify-linkedin-investor-pull",
    provider: "Apify",
    actorId,
    apifyUserId: process.env.APIFY_USER_ID || "",
    label,
    country: selectedCountry,
    query: searchQuery,
    input,
    count: records.length,
    records
  };
  appendJsonLine(path.join(plutonixProjectRoot(), "runtime", "self-improvement", "research", "apify-investor-pulls.jsonl"), evidence);
  event("self-improvement-investor-pull", `Apify LinkedIn investor pull returned ${records.length} records.`, {
    source: "plutonix-marketplace-research-agent",
    provider: "Apify",
    actorId,
    country: selectedCountry,
    query: searchQuery,
    count: records.length
  });
  return evidence;
}

async function runApifyInvestorPull({ query, label = "", country = "", maxItems, takePages, rotate = true }) {
  const desiredCount = Math.min(Math.max(Number(maxItems || process.env.APIFY_LINKEDIN_INVESTOR_MAX_ITEMS || 20), 1), 50);
  const selectedCountry = countryLabel(country);
  const search = query || rotate
    ? nextInvestorSearch({ query, label })
    : {
        query: "seed investor AI infrastructure developer tools autonomous agents",
        label: label || "Default investor search"
      };
  const baseQuery = selectedCountry
    ? `${search.query} ${selectedCountry} investor`
    : search.query;
  const pull = await runSingleApifyInvestorPull({
    query: baseQuery,
    label: selectedCountry ? `${search.label || label || "Investor search"} · ${selectedCountry}` : search.label || label,
    country: selectedCountry,
    maxItems: desiredCount,
    takePages
  });
  const persisted = await saveUniqueInvestorProfiles(pull.records || [], pull);
  const filteredProfiles = selectedCountry
    ? persisted.profiles.filter((profile) => recordMatchesCountry(profile, selectedCountry))
    : persisted.profiles;
  return {
    ...pull,
    label: pull.label || search.label,
    country: selectedCountry,
    rotationCursor: search.cursor,
    savedCount: persisted.added.length,
    duplicateCount: Math.max(0, (pull.records || []).length - persisted.added.length),
    savedRecords: persisted.added.slice(0, desiredCount),
    topInvestors: filteredProfiles.slice(0, 20)
  };
}

function persistProjectInstruction(record = {}) {
  const ledgerPath = projectInstructionLedgerPath(record.projectId || "plutonix-default");
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(
    ledgerPath,
    `${JSON.stringify({
      recordedAt: new Date().toISOString(),
      source: "plutonix-instruction",
      projectId: record.projectId || "",
      projectName: record.projectName || "PlutoniX default workspace",
      taskType: record.taskType || "Medium",
      instruction: record.instruction || "",
      status: record.status || "received",
      buildId: record.buildId || "",
      parentWorkflowId: record.parentWorkflowId || record.flowPath?.decisionTree?.id || "",
      childExecutionIds: record.childExecutionIds || [],
      adaptiveRoute: record.adaptiveRoute || record.flowPath?.adaptiveRoute || null,
      review: record.review || null,
      startedAt: record.startedAt || "",
      completedAt: record.completedAt || "",
      durationMs: Number.isFinite(record.durationMs) ? record.durationMs : null,
      requiredData: Array.isArray(record.requiredData) ? record.requiredData : [],
      orchestrationSnapshot: record.orchestrationSnapshot || null,
      flowPath: record.flowPath || null,
      changedFiles: record.changedFiles || [],
      error: record.error || "",
      workflowRecovery: record.workflowRecovery || null,
      selectedModel: record.selectedModel || record.workflowRecovery?.fallbackModel || "",
      replayParentId: record.replayParentId || record.workflowRecovery?.replayParentId || "",
      replayStatus: record.replayStatus || record.workflowRecovery?.replayStatus || ""
    })}\n`
  );
}

export function hydratePersistedWorkflowRoute(record = {}) {
  const adaptiveRoute = record.adaptiveRoute;
  if (!adaptiveRoute?.mode || record.flowPath?.adaptiveRoute?.mode === adaptiveRoute.mode) return record;

  // Earlier failed Gotham records retained the selected route at the ledger
  // level but lost it in their derived flow/snapshot. Rebuild that projection
  // on read so history remains accurate without mutating its append-only log.
  const flowPath = gothamInstructionFlowPath({
    projectName: record.projectName || "PlutoniX default workspace",
    taskType: record.taskType || "Medium",
    workflowMode: record.workflowMode || "executor",
    orchestrated: {
      structuredRequest: {
        sourceInstruction: record.instruction || "",
        orchestrationEnvelope: { adaptiveRoute }
      }
    },
    result: record.buildId ? {
      buildId: record.buildId,
      adaptiveRoute,
      files: record.changedFiles || []
    } : undefined,
    status: record.status || "failed",
    error: record.error || "",
    useProjectOrchestrator: Boolean(record.projectId && record.projectId !== "plutonix-default")
  });
  const snapshot = record.orchestrationSnapshot;
  return {
    ...record,
    flowPath,
    orchestrationSnapshot: snapshot ? {
      ...snapshot,
      route: adaptiveRoute,
      agents: flowPath.activeAgents,
      selectedDecisions: flowPath.executedDecisions,
      rejectedDecisions: flowPath.rejectedPaths,
      decisionTree: flowPath.decisionTree,
      validation: {
        ...(snapshot.validation || {}),
        review: adaptiveRoute.requiresIndependentReview ? "independent" : snapshot.validation?.review || "plutonix"
      }
    } : null
  };
}

function readProjectInstructionTimeline({ projectId = "" } = {}) {
  const normalizeInstructionBuild = (value = "") => String(value || "").replace(/^Gotham build\s+/i, "").trim();
  const ledgerRows = projectHistoryFiles("project-instructions.jsonl", projectId).flatMap(safeJsonLines).map((row) => hydratePersistedWorkflowRoute({
    recordedAt: row.recordedAt,
    source: row.source || "plutonix-instruction",
    projectId: row.projectId || "",
    projectName: row.projectName || "PlutoniX default workspace",
    taskType: row.taskType || "Medium",
    instruction: row.instruction || row.instructionSummary || "",
    status: row.status || "received",
    buildId: normalizeInstructionBuild(row.buildId),
    parentWorkflowId: row.parentWorkflowId || row.flowPath?.decisionTree?.id || "",
    childExecutionIds: row.childExecutionIds || [],
    adaptiveRoute: row.adaptiveRoute || row.flowPath?.adaptiveRoute || null,
    review: row.review || null,
    startedAt: row.startedAt || "",
    completedAt: row.completedAt || "",
    durationMs: Number.isFinite(row.durationMs) ? row.durationMs : null,
    requiredData: Array.isArray(row.requiredData) ? row.requiredData : [],
    orchestrationSnapshot: row.orchestrationSnapshot || null,
    flowPath: row.flowPath || null,
    changedFiles: row.changedFiles || [],
    error: row.error || "",
    workflowRecovery: row.workflowRecovery || null,
    selectedModel: row.selectedModel || row.workflowRecovery?.fallbackModel || "",
    replayParentId: row.replayParentId || row.workflowRecovery?.replayParentId || "",
    replayStatus: row.replayStatus || row.workflowRecovery?.replayStatus || ""
  }));
  const knowledgeRows = projectHistoryFiles("what-next-knowledge.jsonl", projectId).flatMap(safeJsonLines).map((row) => ({
    recordedAt: row.recordedAt,
    source: row.source || "plutonix-what-next",
    projectId: row.projectId || "",
    projectName: row.projectName || row.flowPath?.projectName || "PlutoniX default workspace",
    taskType: row.flowPath?.taskType || "Medium",
    instruction: row.instructionSummary || "",
    status: row.flowPath?.status || (row.error ? "failed" : "succeeded"),
    buildId: normalizeInstructionBuild(row.flowPath?.executedDecisions?.find((decision) => decision.id === "generation-route")?.value || ""),
    parentWorkflowId: row.flowPath?.decisionTree?.id || "",
    childExecutionIds: [],
    adaptiveRoute: row.flowPath?.adaptiveRoute || null,
    review: null,
    startedAt: row.startedAt || "",
    completedAt: row.completedAt || row.recordedAt || "",
    durationMs: Number.isFinite(row.durationMs) ? row.durationMs : null,
    requiredData: Array.isArray(row.requiredData) ? row.requiredData : [],
    orchestrationSnapshot: row.orchestrationSnapshot || null,
    flowPath: row.flowPath || null,
    changedFiles: row.changedFiles || [],
    error: row.error || ""
  }));
  const unmatchedKnowledgeRows = knowledgeRows.filter((knowledge) => !ledgerRows.some((ledger) =>
    ledger.projectId === knowledge.projectId &&
    ledger.instruction === knowledge.instruction &&
    ledger.status === knowledge.status &&
    Math.abs(new Date(ledger.recordedAt || 0).getTime() - new Date(knowledge.recordedAt || 0).getTime()) < 10_000
  ));
  const seen = new Set();
  return [...ledgerRows, ...unmatchedKnowledgeRows]
    .filter((row) => row.instruction)
    .filter((row) => !projectId || row.projectId === projectId)
    .filter((row) => {
      const key = row.parentWorkflowId
        ? `${row.projectId}|workflow:${row.parentWorkflowId}`
        : `${row.projectId}|${row.projectName}|${row.instruction}|${row.status}|${row.buildId}|${row.recordedAt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.recordedAt || 0).getTime() - new Date(a.recordedAt || 0).getTime());
}

selfImprovementControlPlane = createSelfImprovementControlPlane({
  root: plutonixProjectRoot(),
  emit: event,
  getRuntimeEvents: readRuntimeLogRows,
  getInstructionTimeline: () => readProjectInstructionTimeline({}),
  getTokenEconomy: summarizeAgentTokenEconomy
});

function assertProductionDecisionContinuityConfiguration() {
  if (process.env.NODE_ENV !== "production") return;
  const adapter = String(process.env.DECISION_CONTINUITY_ADAPTER || "postgres").toLowerCase();
  if (adapter !== "postgres") throw new Error("Production requires DECISION_CONTINUITY_ADAPTER=postgres for authoritative decision-continuity writes.");
  if (!process.env.DECISION_CONTINUITY_DATABASE_URL && !process.env.DATABASE_URL) throw new Error("Production requires DECISION_CONTINUITY_DATABASE_URL for authoritative decision-continuity writes.");
  if (String(process.env.DECISION_CONTINUITY_DURABLE_WORKFLOWS || "true").toLowerCase() !== "true") throw new Error("Production requires DECISION_CONTINUITY_DURABLE_WORKFLOWS=true.");
}

assertProductionDecisionContinuityConfiguration();
assertProductionIdentityConfiguration();
assertProductionOperationalConfiguration();

identityAccessStore = new IdentityAccessStore({
  databaseUrl: process.env.DECISION_CONTINUITY_DATABASE_URL || process.env.DATABASE_URL
});

decisionContinuityStore = createDecisionContinuityStore({
  root: plutonixProjectRoot(),
  adapter: process.env.DECISION_CONTINUITY_ADAPTER,
  environment: process.env.NODE_ENV,
  databaseUrl: process.env.DECISION_CONTINUITY_DATABASE_URL || process.env.DATABASE_URL,
  maxReconsiderationsPerTenantPerDay: Number(process.env.DECISION_CONTINUITY_MAX_RECONSIDERATIONS_PER_TENANT_PER_DAY || 25),
  reconsiderationCooldownMs: Number(process.env.DECISION_CONTINUITY_RECONSIDERATION_COOLDOWN_MS || 30 * 60 * 1000)
});
decisionContinuityWorkflow = new DecisionContinuityWorkflowQueue({
  store: decisionContinuityStore,
  databaseUrl: process.env.DECISION_CONTINUITY_DATABASE_URL || process.env.DATABASE_URL,
  identityAccess: identityAccessStore,
  workerPrincipalId: process.env.DECISION_CONTINUITY_WORKER_PRINCIPAL_ID || "",
  globalConcurrency: Number(process.env.DECISION_CONTINUITY_WORKER_CONCURRENCY || 8),
  perTenantConcurrency: Number(process.env.DECISION_CONTINUITY_WORKER_TENANT_CONCURRENCY || 2),
  perTenantQueueLimit: Number(process.env.DECISION_CONTINUITY_WORKER_TENANT_QUEUE_LIMIT || 100),
  leaseMs: Number(process.env.DECISION_CONTINUITY_WORKER_LEASE_MS || 30000),
  maxAttempts: Number(process.env.DECISION_CONTINUITY_WORKER_MAX_ATTEMPTS || 5),
  maxRedrives: Number(process.env.DECISION_CONTINUITY_WORKER_MAX_REDRIVES || 2),
  pollMs: Number(process.env.DECISION_CONTINUITY_WORKER_POLL_MS || 500),
  shutdownGraceMs: Number(process.env.DECISION_CONTINUITY_WORKER_SHUTDOWN_GRACE_MS || 20000)
});
qagentDecisionContinuity = new QAgentDecisionContinuityService({
  store: decisionContinuityStore,
  env: process.env,
  identityAccess: identityAccessStore
});
brainxModelRegistry = new BrainXModelRegistry({
  store: decisionContinuityStore,
  env: process.env,
  identityAccess: identityAccessStore
});
suggestionIntelGovernance = new SuggestionIntelGovernance({ store: decisionContinuityStore });
governedPromotionController = new GovernedPromotionController({
  store: new PostgresGovernedPromotionStore({ databaseUrl: process.env.DECISION_CONTINUITY_DATABASE_URL || process.env.DATABASE_URL }),
  baseConfig: () => readSelfImprovementConfig()
});
// The promotion overlay is an opt-in production target. When the two explicit
// flags are absent, hydration deliberately does nothing and the legacy
// environment-derived self-improvement configuration remains authoritative.
if (String(process.env.GOVERNED_PROMOTIONS_ENABLED || "").toLowerCase() === "true" && String(process.env.GOVERNED_PROMOTION_SELF_IMPROVEMENT_ENABLED || "").toLowerCase() === "true") {
  await governedPromotionController.hydrateRuntime();
}

function durableDecisionWorkflowsEnabled() {
  return String(process.env.DECISION_CONTINUITY_DURABLE_WORKFLOWS || (process.env.NODE_ENV === "production" ? "true" : "false")).toLowerCase() === "true";
}

async function enqueueDecisionLifecycle({ scope, jobType, payload, workspaceId = "default", idempotencyKey, branchId = null, reconsiderationId = null }) {
  return decisionContinuityWorkflow.submit({
    tenantId: scope.tenantId, workspaceId, jobType,
    payload: { ...(payload || {}), __workflow: { actor: scope.actor, authorization: scope.authorization } },
    branchId, reconsiderationId, idempotencyKey, correlationId: payload?.correlationId || undefined
  });
}

function decisionContinuityIdempotencyKey(req, fallback = "") {
  const supplied = String(req.get("idempotency-key") || "").trim();
  const key = supplied || fallback;
  if (!key || key.length > 240) {
    throw new DecisionContinuityError("A valid Idempotency-Key is required for this lifecycle mutation.", { code: "idempotency_key_required", status: 400 });
  }
  return key;
}

function requireDecisionContinuityJsonBody(req, res, next) {
  if (!req.is("application/json")) {
    res.status(415).json({ status: "invalid_request", error: "Decision-continuity mutations require application/json." });
    return;
  }
  if (!req.body || Array.isArray(req.body) || typeof req.body !== "object" || !Object.keys(req.body).length) {
    res.status(400).json({ status: "invalid_request", error: "Decision-continuity mutations require a non-empty JSON object." });
    return;
  }
  next();
}

async function requireDecisionContinuityResource(req, res, scope, action, readResource) {
  try {
    return await readResource();
  } catch (error) {
    await identityAccessStore.recordAudit({
      principalId: scope?.principal?.id,
      tenantId: scope?.tenantId,
      action,
      outcome: "denied",
      code: error.code || "resource_not_found",
      requestId: req.get("x-request-id"),
      metadata: { path: req.path, method: req.method }
    }).catch(() => {});
    respondDecisionContinuityError(res, error);
    return null;
  }
}

async function requireLifecycleSeparation(req, res, scope, reconsiderationId, action) {
  const reconsideration = await requireDecisionContinuityResource(
    req,
    res,
    scope,
    `decision_continuity.${action}`,
    () => decisionContinuityStore.getReconsideration(reconsiderationId, { tenantId: scope.tenantId })
  );
  if (!reconsideration) return null;
  const branch = await requireDecisionContinuityResource(
    req,
    res,
    scope,
    `decision_continuity.${action}`,
    () => decisionContinuityStore.getBranch(reconsideration.branchId, { tenantId: scope.tenantId })
  );
  if (!branch) return null;
  const origins = [branch.producedBy?.actorId, branch.producedBy?.id, reconsideration.requestedBy?.actorId, reconsideration.requestedBy?.id];
  try {
    await identityAccessStore.assertSeparationOfDuties({ principalId: scope.principal.id, tenantId: scope.tenantId, originatorPrincipalIds: origins, action });
    return reconsideration;
  } catch (error) {
    await identityAccessStore.recordAudit({ principalId: scope.principal.id, tenantId: scope.tenantId, action: `decision_continuity.${action}`, outcome: "denied", code: error.code || "separation_of_duties_denied", metadata: { path: req.path, method: req.method } }).catch(() => {});
    respondDecisionContinuityError(res, error);
    return null;
  }
}

const registeredDecisionContinuityRoutes = [];
function decisionContinuityRoute(key, handler) {
  const route = DECISION_CONTINUITY_LIFECYCLE_ROUTES[key];
  if (!route) throw new Error(`Decision-continuity route ${key} has no lifecycle classification.`);
  registeredDecisionContinuityRoutes.push({ key, method: route.method, path: route.path });
  const authenticate = async (req, res, next) => {
    try {
      req.plutonixPrincipal = await identityAccessStore.authenticateRequest(req);
      next();
    } catch (error) {
      respondDecisionContinuityError(res, error);
    }
  };
  const middleware = [authenticate, ...(route.matrix?.jsonBody ? [requireDecisionContinuityJsonBody] : [])];
  app[route.method](`/api/decision-continuity${route.path}`, ...middleware, handler);
}

huggingFaceModelPool = createHuggingFaceModelPool({
  root: plutonixProjectRoot(),
  emit: event
});

const orchestratorHealthMonitor = createOrchestratorHealthMonitor({
  emit: event,
  getRuntimeEvents: readRuntimeLogRows,
  getInstructionTimeline: () => readProjectInstructionTimeline({}),
  onSelfHeal: async (report) => {
    if (!orchestratorRuntimeSelfHealEnabled()) {
      return { status: "deferred", reason: "runtime_self_heal_disabled" };
    }
    event("orchestrator-health-self-heal-start", "Forwarding orchestrator health findings to the safe self-improvement control plane", {
      source: "plutonix-orchestrator-health",
      status: report.status,
      issueCount: report.issues.length
    });
    const cycle = await selfImprovementControlPlane.recordHealthReport(report);
    event("orchestrator-health-self-heal-complete", "Self-improvement control plane recorded health findings and evaluated proposal gates", {
      source: "plutonix-orchestrator-health",
      cycleId: cycle.id || "",
      status: cycle.status || "recorded"
    });
    return cycle;
  }
});

app.get("/api/status", async (_req, res) => {
  const localMcp = localGothamMcpServer.status();
  const decisionContinuityHealth = await decisionContinuityStore.health();
  res.json({
    status: "ok",
    service: "plutonix-backend",
    codexMcp: "external",
    codexMcpId: process.env.CODEX_MCP_ID || process.env.MCP_SERVER_ID || process.env.HOSTNAME || null,
    localGothamMcp: localMcp.status,
    localGothamMcpId: localMcp.id,
    localGothamMcpTools: localMcp.tools,
    orchestratorAgent: "ready",
    orchestratorHealthMonitor: String(process.env.PLUTONIX_ORCHESTRATOR_HEALTH_MONITOR || "1") === "1" ? "enabled" : "disabled",
    selfImprovement: {
      enabled: readSelfImprovementConfig().enabled,
      mode: readSelfImprovementConfig().mode,
      contract: "observe-detect-diagnose-propose-isolate-validate-review-stage"
    },
    decisionContinuity: {
      enabled: true,
      adapter: decisionContinuityHealth.adapter,
      authoritativeWrites: decisionContinuityHealth.authoritativeWrites || decisionContinuityHealth.status,
      contract: "tenant-scoped-branch-ledger; declarative-constraints; independent-evaluation; explicit-approval; bounded-canary",
      operatorControl: "identity-membership-rbac",
      trustedConditionIngestion: "identity-service-scope"
    },
    governedPromotion: {
      target: "self-improvement-runtime-policy",
      runtimePath: "readSelfImprovementConfig",
      enabled: String(process.env.GOVERNED_PROMOTIONS_ENABLED || "").toLowerCase() === "true" && String(process.env.GOVERNED_PROMOTION_SELF_IMPROVEMENT_ENABLED || "").toLowerCase() === "true",
      contract: "content-addressed candidate; deterministic validation; independent evaluation; versioned policy; expiring human approval; bounded canary; operational rollback"
    },
    generatedSiteDir: process.env.GENERATED_SITE_DIR || "/workspace/generated-site",
    generatedSiteContainer: process.env.GENERATED_SITE_CONTAINER || "plutonix-generated-site",
    restartMode: String(process.env.RESTART_GENERATED_CONTAINER || "false").toLowerCase() === "true" ? "docker-socket" : "vite-hot-reload"
  });
});

async function governedPromotionScope(req, res, permission, { principalTypes = ["human"] } = {}) {
  try {
    return await identityAccessStore.authorizeRequest(req, { permission, principalTypes, action: `governed_promotion.${permission}` });
  } catch (error) {
    respondGovernedPromotionError(res, error);
    return null;
  }
}

function requireGovernedPromotionJson(req, res) {
  if (!req.is("application/json") || !req.body || Array.isArray(req.body) || typeof req.body !== "object") {
    res.status(415).json({ status: "invalid_request", error: "Governed-promotion mutations require an application/json object." });
    return false;
  }
  return true;
}

function governedPromotionRequestScope(scope) {
  return { tenantId: scope.tenantId, workspaceId: scope.workspaceId, targetKey: "self-improvement-runtime-policy" };
}

app.get("/api/governed-promotions/status", async (req, res) => {
  const scope = await governedPromotionScope(req, res, "promotion:read");
  if (!scope) return;
  try { res.json({ status: "ok", promotion: await governedPromotionController.status({ scope: governedPromotionRequestScope(scope), requestId: String(req.query.requestId || "") }) }); } catch (error) { respondGovernedPromotionError(res, error); }
});

app.post("/api/governed-promotions/candidates", async (req, res) => {
  if (!requireGovernedPromotionJson(req, res)) return;
  const scope = await governedPromotionScope(req, res, "promotion:propose");
  if (!scope) return;
  try {
    const request = await governedPromotionController.createCandidate({ scope: governedPromotionRequestScope(scope), candidate: req.body.candidate, baseline: req.body.baseline, fixtureDataset: req.body.fixtureDataset, proposer: { id: scope.principal.id } });
    res.status(201).json({ status: "created", request });
  } catch (error) { respondGovernedPromotionError(res, error); }
});

app.post("/api/governed-promotions/requests/:requestId/amend", async (req, res) => {
  if (!requireGovernedPromotionJson(req, res)) return;
  const scope = await governedPromotionScope(req, res, "promotion:propose");
  if (!scope) return;
  try { res.json({ status: "ok", request: await governedPromotionController.amendCandidate({ scope: governedPromotionRequestScope(scope), requestId: req.params.requestId, candidate: req.body.candidate, baseline: req.body.baseline, fixtureDataset: req.body.fixtureDataset, actor: scope.actor }) }); } catch (error) { respondGovernedPromotionError(res, error); }
});

app.post("/api/governed-promotions/requests/:requestId/evaluation", async (req, res) => {
  if (!requireGovernedPromotionJson(req, res)) return;
  const scope = await governedPromotionScope(req, res, "promotion:evaluate");
  if (!scope) return;
  try { res.json({ status: "ok", request: await governedPromotionController.recordEvaluation({ scope: governedPromotionRequestScope(scope), requestId: req.params.requestId, evaluator: { id: scope.principal.id }, reviewerId: req.body.reviewerId, evaluatorVersion: req.body.evaluatorVersion, fixtureDigest: req.body.fixtureDigest, evaluation: req.body.evaluation }) }); } catch (error) { respondGovernedPromotionError(res, error); }
});

app.post("/api/governed-promotions/requests/:requestId/policy", async (req, res) => {
  if (!requireGovernedPromotionJson(req, res)) return;
  const scope = await governedPromotionScope(req, res, "promotion:policy", { principalTypes: ["human", "service"] });
  if (!scope) return;
  try { res.json({ status: "ok", request: await governedPromotionController.evaluatePolicy({ scope: governedPromotionRequestScope(scope), requestId: req.params.requestId, policy: req.body.policy, actor: scope.actor }) }); } catch (error) { respondGovernedPromotionError(res, error); }
});

app.post("/api/governed-promotions/requests/:requestId/approval", async (req, res) => {
  if (!requireGovernedPromotionJson(req, res)) return;
  const scope = await governedPromotionScope(req, res, "promotion:approve");
  if (!scope) return;
  try { res.json({ status: "ok", request: await governedPromotionController.approve({ scope: governedPromotionRequestScope(scope), requestId: req.params.requestId, actor: scope.actor, candidateDigest: req.body.candidateDigest, policyDigest: req.body.policyDigest, note: req.body.note }) }); } catch (error) { respondGovernedPromotionError(res, error); }
});

app.post("/api/governed-promotions/requests/:requestId/canary", async (req, res) => {
  if (!requireGovernedPromotionJson(req, res)) return;
  const scope = await governedPromotionScope(req, res, "promotion:operate");
  if (!scope) return;
  try { const result = await governedPromotionController.startCanary({ scope: governedPromotionRequestScope(scope), requestId: req.params.requestId, actor: scope.actor, idempotencyKey: req.get("idempotency-key") }); res.status(result.idempotent ? 200 : 202).json({ status: result.idempotent ? "idempotent" : "canary_running", ...result }); } catch (error) { respondGovernedPromotionError(res, error); }
});

app.post("/api/governed-promotions/requests/:requestId/canary/observations", async (req, res) => {
  if (!requireGovernedPromotionJson(req, res)) return;
  const scope = await governedPromotionScope(req, res, "promotion:monitor", { principalTypes: ["service"] });
  if (!scope) return;
  try { res.json({ status: "ok", ...(await governedPromotionController.recordCanaryObservation({ scope: governedPromotionRequestScope(scope), requestId: req.params.requestId, actor: scope.actor, metrics: req.body.metrics, idempotencyKey: req.get("idempotency-key") })) }); } catch (error) { respondGovernedPromotionError(res, error); }
});

app.post("/api/governed-promotions/requests/:requestId/rollback", async (req, res) => {
  if (!requireGovernedPromotionJson(req, res)) return;
  const scope = await governedPromotionScope(req, res, "promotion:operate");
  if (!scope) return;
  try { res.json({ status: "ok", ...(await governedPromotionController.rollback({ scope: governedPromotionRequestScope(scope), requestId: req.params.requestId, actor: scope.actor, reason: req.body.reason, idempotencyKey: req.get("idempotency-key") })) }); } catch (error) { respondGovernedPromotionError(res, error); }
});

app.post("/api/governed-promotions/kill-switch", async (req, res) => {
  if (!requireGovernedPromotionJson(req, res)) return;
  const scope = await governedPromotionScope(req, res, "promotion:operate");
  if (!scope) return;
  try { res.json({ status: "ok", killSwitch: await governedPromotionController.setKillSwitch({ scope: governedPromotionRequestScope(scope), actor: scope.actor, halted: req.body.halted, reason: req.body.reason }) }); } catch (error) { respondGovernedPromotionError(res, error); }
});

decisionContinuityRoute("workflow_status", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "workflow_status");
  if (!scope) return;
  try { res.json({ status: "ok", workflows: await decisionContinuityWorkflow.status({ tenantId: scope.tenantId }) }); } catch (error) { respondDecisionContinuityError(res, error); }
});

decisionContinuityRoute("workflow_redrive", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "workflow_redrive");
  if (!scope) return;
  try {
    const result = await decisionContinuityWorkflow.redrive({ jobId: req.params.jobId, tenantId: scope.tenantId, actor: scope.actor, idempotencyKey: decisionContinuityIdempotencyKey(req, `redrive:${req.params.jobId}`) });
    res.status(result.idempotent ? 200 : 202).json({ status: result.idempotent ? "idempotent" : "accepted", ...result });
  } catch (error) { respondDecisionContinuityError(res, error); }
});

decisionContinuityRoute("workflow_job_status", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "workflow_job_status");
  if (!scope) return;
  try { res.json({ status: "ok", job: await decisionContinuityWorkflow.jobStatus({ jobId: req.params.jobId, tenantId: scope.tenantId }) }); } catch (error) { respondDecisionContinuityError(res, error); }
});

decisionContinuityRoute("readiness", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "readiness");
  if (!scope) return;
  const health = await decisionContinuityStore.health();
  res.status(health.status === "ready" ? 200 : 503).json({
    status: health.status === "ready" ? "ok" : "unavailable",
    component: "decision-continuity",
    ...health
  });
});

decisionContinuityRoute("architecture_branch_discovery", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "architecture_branch_discovery");
  if (!scope) return;
  try {
    const project = await decisionProject(req, scope, req.params.projectId, { bind: true });
    // Fingerprinting uses the same redacted, allowlisted scan as full analysis,
    // but deliberately avoids an external model call when an immutable report
    // for this exact source tree already exists.
    const fingerprint = await analyzeProjectArchitecture({ project, env: process.env, skipModel: true });
    const existing = await readProjectArchitectureAnalysis({
      root: plutonixProjectRoot(),
      projectId: project.id,
      sourceDigest: fingerprint.sourceDigest
    });
    if (existing?.version >= ANALYSIS_VERSION) {
      return res.json({ status: "ok", report: publicArchitectureAnalysis({ ...existing, idempotent: true }) });
    }

    const report = await analyzeProjectArchitecture({ project, env: process.env });
    const topology = await syncProjectAgentTopology(project, {
      objective: `Maintain and improve ${project.name} using code-evidenced architecture ownership.`,
      pageType: "managed_app_project",
      topic: project.name,
      sections: [...new Set(["project", "runtime", "playground", ...report.functionalities.map((item) => item.category)])],
      media: project.media || [],
      discoveredFunctionalities: report.functionalities,
      applicationLinks: report.applicationLinks,
      inferredChains: report.inferredChains,
      analysis: { version: report.version, sourceDigest: report.sourceDigest, analyzedAt: report.analyzedAt, modelAssist: report.modelAssist }
    });
    const branches = await publishArchitectureBranches({
      report,
      store: decisionContinuityStore,
      tenantId: scope.tenantId,
      workspaceId: project.id,
      actor: scope.actor,
      principalId: scope.principal.id
    });
    report.assignments = topology.functionalityAssignments || [];
    report.branches = branches;
    report.agentSummary = {
      reused: report.assignments.filter((assignment) => assignment.assignment === "reused").length,
      created: report.assignments.filter((assignment) => assignment.assignment === "created").length
    };
    await syncProjectAgentTopology(project, {
      objective: `Maintain and improve ${project.name} using code-evidenced architecture ownership.`,
      pageType: "managed_app_project",
      topic: project.name,
      sections: [...new Set(["project", "runtime", "playground", ...report.functionalities.map((item) => item.category)])],
      media: project.media || [],
      discoveredFunctionalities: report.functionalities,
      applicationLinks: report.applicationLinks,
      inferredChains: report.inferredChains,
      architectureBranches: branches,
      analysis: { version: report.version, sourceDigest: report.sourceDigest, analyzedAt: report.analyzedAt, modelAssist: report.modelAssist }
    });
    const saved = await writeProjectArchitectureAnalysis({ root: plutonixProjectRoot(), report });
    res.status(201).json({ status: "created", report: publicArchitectureAnalysis(saved) });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

decisionContinuityRoute("architecture_branch_list", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "architecture_branch_list");
  if (!scope) return;
  try {
    await decisionProject(req, scope, req.params.projectId);
    const report = await readLatestProjectArchitectureAnalysis({ root: plutonixProjectRoot(), projectId: req.params.projectId });
    res.json({ status: "ok", report: publicArchitectureAnalysis(report) });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

decisionContinuityRoute("branch_list", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "branch_list");
  if (!scope) return;
  try {
    const statuses = String(req.query.statuses || "").split(",").map((value) => value.trim()).filter(Boolean);
    const branches = await decisionContinuityStore.listBranches({
      tenantId: scope.tenantId,
      workspaceId: String(req.query.workspaceId || "").trim() || undefined,
      decisionId: String(req.query.decisionId || "").trim() || undefined,
      statuses,
      limit: req.query.limit
    });
    res.json({ status: "ok", branches });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

decisionContinuityRoute("branch_create", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "branch_create");
  if (!scope) return;
  try {
    const input = { ...req.body, producedBy: { ...(req.body?.producedBy || {}), actorId: scope.principal.id } };
    if (durableDecisionWorkflowsEnabled()) {
      const submitted = await enqueueDecisionLifecycle({ scope, jobType: "branch_create", payload: input, workspaceId: String(input.workspaceId || "default"), idempotencyKey: decisionContinuityIdempotencyKey(req) });
      return res.status(submitted.idempotent ? 200 : 202).json({ status: submitted.idempotent ? "idempotent" : "accepted", ...submitted });
    }
    const branch = await decisionContinuityStore.createBranch(input, { tenantId: scope.tenantId, actor: scope.actor });
    res.status(201).json({ status: "created", branch });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

decisionContinuityRoute("graph", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "graph");
  if (!scope) return;
  try {
    const workspaceId = String(req.query.workspaceId || "").trim() || undefined;
    const [branches, events] = await Promise.all([
      decisionContinuityStore.listBranches({ tenantId: scope.tenantId, workspaceId, limit: 250 }),
      decisionContinuityStore.listEvents({ tenantId: scope.tenantId, workspaceId, limit: 500 })
    ]);
    res.json({ status: "ok", graph: buildDecisionContinuityGraph({ branches, events }) });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

decisionContinuityRoute("branch_get", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "branch_get");
  if (!scope) return;
  try {
    const branch = await decisionContinuityStore.getBranch(req.params.branchId, { tenantId: scope.tenantId, workspaceId: String(req.query.workspaceId || "").trim() || undefined });
    res.json({ status: "ok", branch });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

decisionContinuityRoute("branch_events", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "branch_events");
  if (!scope) return;
  try {
    await decisionContinuityStore.getBranch(req.params.branchId, { tenantId: scope.tenantId, workspaceId: String(req.query.workspaceId || "").trim() || undefined });
    const events = await decisionContinuityStore.listEvents({ tenantId: scope.tenantId, branchId: req.params.branchId, limit: req.query.limit });
    res.json({ status: "ok", events });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

decisionContinuityRoute("branch_compare", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "branch_compare");
  if (!scope) return;
  try {
    const workspaceId = String(req.query.workspaceId || "").trim() || undefined;
    const [branch, otherBranch] = await Promise.all([
      decisionContinuityStore.getBranch(req.params.branchId, { tenantId: scope.tenantId, workspaceId }),
      decisionContinuityStore.getBranch(req.params.otherBranchId, { tenantId: scope.tenantId, workspaceId })
    ]);
    res.json({ status: "ok", comparison: compareDecisionBranches(branch, otherBranch) });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

decisionContinuityRoute("disposition", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "disposition");
  if (!scope) return;
  try {
    if (durableDecisionWorkflowsEnabled()) {
      if (!(await requireDecisionContinuityResource(req, res, scope, "decision_continuity.disposition", () => decisionContinuityStore.getBranch(req.params.branchId, { tenantId: scope.tenantId })))) return;
      const payload = { ...(req.body || {}), branchId: req.params.branchId };
      const submitted = await enqueueDecisionLifecycle({ scope, jobType: "disposition", payload, workspaceId: String(req.body?.workspaceId || "default"), branchId: req.params.branchId, idempotencyKey: decisionContinuityIdempotencyKey(req, `disposition:${req.params.branchId}:${payload.expectedRevision || ""}:${payload.status}`) });
      return res.status(submitted.idempotent ? 200 : 202).json({ status: submitted.idempotent ? "idempotent" : "accepted", ...submitted });
    }
    const branch = await decisionContinuityStore.setDisposition({ ...(req.body || {}), branchId: req.params.branchId }, { tenantId: scope.tenantId, actor: scope.actor });
    res.json({ status: "ok", branch });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

decisionContinuityRoute("condition_event", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "condition_event");
  if (!scope) return;
  try {
    const { tenantId: _tenantId, ...input } = req.body || {};
    if (durableDecisionWorkflowsEnabled()) {
      const submitted = await enqueueDecisionLifecycle({ scope, workspaceId: String(input.workspaceId || "default"), jobType: "condition_event", payload: input, idempotencyKey: decisionContinuityIdempotencyKey(req, `condition:${input.workspaceId}:${input.eventId}`) });
      return res.status(submitted.idempotent ? 200 : 202).json({ status: submitted.idempotent ? "idempotent" : "accepted", ...submitted });
    }
    const result = await decisionContinuityStore.ingestConditionEvent(input, scope);
    res.status(result.idempotent ? 200 : 202).json({ status: result.idempotent ? "idempotent" : "accepted", ...result });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

decisionContinuityRoute("reconsideration_list", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "reconsideration_list");
  if (!scope) return;
  try {
    const reconsiderations = await decisionContinuityStore.listReconsiderations({
      tenantId: scope.tenantId,
      workspaceId: String(req.query.workspaceId || "").trim() || undefined,
      branchId: String(req.query.branchId || "").trim() || undefined,
      limit: req.query.limit
    });
    res.json({ status: "ok", reconsiderations });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

decisionContinuityRoute("qagent_run_list", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "qagent_run_list");
  if (!scope) return;
  try {
    const workspaceId = String(req.query.workspaceId || "").trim() || undefined;
    const reconsiderationId = String(req.query.reconsiderationId || "").trim() || undefined;
    const [qagentRuns, qagentMetrics] = await Promise.all([
      qagentDecisionContinuity.listRuns({ tenantId: scope.tenantId, workspaceId, reconsiderationId, limit: req.query.limit }),
      qagentDecisionContinuity.metrics({ tenantId: scope.tenantId, workspaceId })
    ]);
    res.json({ status: "ok", qagentRuns, qagentMetrics, feature: { enabledForTenant: qagentDecisionContinuity.isEnabledForTenant(scope.tenantId), mode: qagentDecisionContinuity.isEnabledForTenant(scope.tenantId) ? "bounded_evidence_planner" : "baseline" } });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

// BrainX is a separate governed registry surface. Browser/API callers can
// administer registrations and inspect evidence, but model execution is never
// exposed here: it requires a separately scoped BrainX service identity.
app.get("/api/suggestions/overview", async (req, res) => {
  const scope = await suggestionScope(req, res, DECISION_PERMISSIONS.SUGGESTION_READ); if (!scope) return;
  try { const workspaceId = brainxWorkspace(scope, req); const [suggestions, intel] = await Promise.all([suggestionIntelGovernance.list({ tenantId: scope.tenantId, workspaceId }), suggestionIntelGovernance.list({ tenantId: scope.tenantId, workspaceId, kind: "intel" })]); res.json({ status: "ok", suggestions, intel, notice: "Viewing and generation are non-executing; Step 4 remains required for promotion." }); } catch (error) { respondDecisionContinuityError(res, error); }
});
app.post("/api/suggestions", requireDecisionContinuityJsonBody, async (req, res) => {
  const scope = await suggestionScope(req, res, DECISION_PERMISSIONS.SUGGESTION_EDIT); if (!scope) return;
  try { const result = await suggestionIntelGovernance.createSuggestion(req.body, { tenantId: scope.tenantId, workspaceId: brainxWorkspace(scope, req), actor: scope.actor }); res.status(result.status === "created" ? 201 : 200).json({ status: result.status, suggestion: result.suggestion }); } catch (error) { respondDecisionContinuityError(res, error); }
});
app.patch("/api/suggestions/:suggestionId", requireDecisionContinuityJsonBody, async (req, res) => {
  const scope = await suggestionScope(req, res, DECISION_PERMISSIONS.SUGGESTION_EDIT); if (!scope) return;
  try { res.json({ status: "ok", suggestion: await suggestionIntelGovernance.editSuggestion({ suggestionId: req.params.suggestionId, patch: req.body.patch, reason: req.body.reason }, { tenantId: scope.tenantId, workspaceId: brainxWorkspace(scope, req), actor: scope.actor }) }); } catch (error) { respondDecisionContinuityError(res, error); }
});
app.post("/api/suggestions/:suggestionId/review", requireDecisionContinuityJsonBody, async (req, res) => {
  const scope = await suggestionScope(req, res, DECISION_PERMISSIONS.SUGGESTION_REVIEW); if (!scope) return;
  try { res.json({ status: "ok", suggestion: await suggestionIntelGovernance.reviewSuggestion({ suggestionId: req.params.suggestionId, ...req.body }, { tenantId: scope.tenantId, workspaceId: brainxWorkspace(scope, req), actor: scope.actor }) }); } catch (error) { respondDecisionContinuityError(res, error); }
});
app.post("/api/suggestions/:suggestionId/governed-promotion", requireDecisionContinuityJsonBody, async (req, res) => {
  const scope = await suggestionScope(req, res, DECISION_PERMISSIONS.SUGGESTION_REVIEW); if (!scope) return;
  try { res.json({ status: "ok", suggestion: await suggestionIntelGovernance.linkGovernedPromotion({ suggestionId: req.params.suggestionId, ...req.body }, { tenantId: scope.tenantId, workspaceId: brainxWorkspace(scope, req), actor: scope.actor }) }); } catch (error) { respondDecisionContinuityError(res, error); }
});
app.post("/api/intel/capability-proposals", requireDecisionContinuityJsonBody, async (req, res) => {
  const scope = await suggestionScope(req, res, DECISION_PERMISSIONS.SUGGESTION_EDIT); if (!scope) return;
  try { const result = await suggestionIntelGovernance.createIntelProposal(req.body, { tenantId: scope.tenantId, workspaceId: brainxWorkspace(scope, req), actor: scope.actor }); res.status(result.status === "created" ? 201 : 200).json({ status: result.status, proposal: result.proposal }); } catch (error) { respondDecisionContinuityError(res, error); }
});
app.get("/api/brainx/overview", async (req, res) => {
  const scope = await brainxScope(req, res, DECISION_PERMISSIONS.BRAINX_READ);
  if (!scope) return;
  try {
    const workspaceId = brainxWorkspace(scope, req);
    const [registrations, routes, controls, metrics, policy] = await Promise.all([
      brainxModelRegistry.listRegistrations({ tenantId: scope.tenantId, workspaceId, limit: 100 }),
      brainxModelRegistry.listRoutes({ tenantId: scope.tenantId, workspaceId, limit: 50 }),
      brainxModelRegistry.listControls({ tenantId: scope.tenantId, workspaceId }),
      brainxModelRegistry.metrics({ tenantId: scope.tenantId, workspaceId }),
      brainxModelRegistry.getPolicy({ tenantId: scope.tenantId, workspaceId })
    ]);
    res.json({ status: "ok", feature: { enabledForTenant: brainxModelRegistry.isEnabledForTenant(scope.tenantId), mode: brainxModelRegistry.isEnabledForTenant(scope.tenantId) ? "fixture_only_governed_registry" : "baseline" }, registrations, routes, controls, metrics, policy });
  } catch (error) { respondDecisionContinuityError(res, error); }
});

app.get("/api/brainx/registrations", async (req, res) => {
  const scope = await brainxScope(req, res, DECISION_PERMISSIONS.BRAINX_READ);
  if (!scope) return;
  try { res.json({ status: "ok", registrations: await brainxModelRegistry.listRegistrations({ tenantId: scope.tenantId, workspaceId: brainxWorkspace(scope, req), limit: req.query.limit }) }); } catch (error) { respondDecisionContinuityError(res, error); }
});

app.get("/api/brainx/routes", async (req, res) => {
  const scope = await brainxScope(req, res, DECISION_PERMISSIONS.BRAINX_READ);
  if (!scope) return;
  try { res.json({ status: "ok", routes: await brainxModelRegistry.listRoutes({ tenantId: scope.tenantId, workspaceId: brainxWorkspace(scope, req), limit: req.query.limit }) }); } catch (error) { respondDecisionContinuityError(res, error); }
});

app.get("/api/brainx/controls", async (req, res) => {
  const scope = await brainxScope(req, res, DECISION_PERMISSIONS.BRAINX_READ);
  if (!scope) return;
  try { res.json({ status: "ok", controls: await brainxModelRegistry.listControls({ tenantId: scope.tenantId, workspaceId: brainxWorkspace(scope, req) }) }); } catch (error) { respondDecisionContinuityError(res, error); }
});

app.post("/api/brainx/registrations", requireDecisionContinuityJsonBody, async (req, res) => {
  const scope = await brainxScope(req, res, DECISION_PERMISSIONS.BRAINX_ADMIN);
  if (!scope) return;
  try { const result = await brainxModelRegistry.register(req.body, { tenantId: scope.tenantId, workspaceId: brainxWorkspace(scope, req), actor: scope.actor }); res.status(result.status === "registered" ? 201 : 200).json({ status: result.status, registration: result.registration }); } catch (error) { respondDecisionContinuityError(res, error); }
});

app.post("/api/brainx/policy", requireDecisionContinuityJsonBody, async (req, res) => {
  const scope = await brainxScope(req, res, DECISION_PERMISSIONS.BRAINX_ADMIN);
  if (!scope) return;
  try { res.json({ status: "ok", policy: await brainxModelRegistry.setPolicy(req.body, { tenantId: scope.tenantId, workspaceId: brainxWorkspace(scope, req), actor: scope.actor }) }); } catch (error) { respondDecisionContinuityError(res, error); }
});

app.post("/api/brainx/controls", requireDecisionContinuityJsonBody, async (req, res) => {
  const scope = await brainxScope(req, res, DECISION_PERMISSIONS.BRAINX_ADMIN);
  if (!scope) return;
  try { res.json({ status: "ok", ...(await brainxModelRegistry.setControl(req.body, { tenantId: scope.tenantId, workspaceId: brainxWorkspace(scope, req), actor: scope.actor })) }); } catch (error) { respondDecisionContinuityError(res, error); }
});

app.post("/api/brainx/registrations/:registrationId/health", requireDecisionContinuityJsonBody, async (req, res) => {
  const scope = await brainxScope(req, res, DECISION_PERMISSIONS.BRAINX_ADMIN);
  if (!scope) return;
  try { res.json({ status: "ok", registration: await brainxModelRegistry.setHealth({ registrationId: req.params.registrationId, ...req.body }, { tenantId: scope.tenantId, workspaceId: brainxWorkspace(scope, req), actor: scope.actor }) }); } catch (error) { respondDecisionContinuityError(res, error); }
});

decisionContinuityRoute("evaluation", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "evaluation");
  if (!scope) return;
  try {
    const { tenantId: _tenantId, ...input } = req.body || {};
    if (!(await requireLifecycleSeparation(req, res, scope, req.params.reconsiderationId, "evaluation"))) return;
    if (input.reviewerId === scope.principal.id) throw new AuthorizationError("An evaluator cannot be its own reviewer.", { code: "separation_of_duties_denied" });
    if (durableDecisionWorkflowsEnabled()) {
      const payload = { ...input, evaluatorId: scope.principal.id, reconsiderationId: req.params.reconsiderationId };
      const submitted = await enqueueDecisionLifecycle({ scope, jobType: "evaluation", payload, workspaceId: String(input.workspaceId || "default"), reconsiderationId: req.params.reconsiderationId, idempotencyKey: decisionContinuityIdempotencyKey(req, `evaluation:${req.params.reconsiderationId}:${input.expectedBranchRevision || ""}`) });
      return res.status(submitted.idempotent ? 200 : 202).json({ status: submitted.idempotent ? "idempotent" : "accepted", ...submitted });
    }
    const reconsideration = await decisionContinuityStore.recordEvaluation({ ...input, reconsiderationId: req.params.reconsiderationId }, scope);
    res.json({ status: "ok", reconsideration });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

decisionContinuityRoute("policy", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "policy");
  if (!scope) return;
  try {
    const { tenantId: _tenantId, ...input } = req.body || {};
    if (durableDecisionWorkflowsEnabled()) {
      if (!(await requireDecisionContinuityResource(req, res, scope, "decision_continuity.policy", () => decisionContinuityStore.getReconsideration(req.params.reconsiderationId, { tenantId: scope.tenantId })))) return;
      const payload = { ...input, reconsiderationId: req.params.reconsiderationId };
      const submitted = await enqueueDecisionLifecycle({ scope, jobType: "policy", payload, workspaceId: String(input.workspaceId || "default"), reconsiderationId: req.params.reconsiderationId, idempotencyKey: decisionContinuityIdempotencyKey(req, `policy:${req.params.reconsiderationId}:${input.expectedBranchRevision || ""}`) });
      return res.status(submitted.idempotent ? 200 : 202).json({ status: submitted.idempotent ? "idempotent" : "accepted", ...submitted });
    }
    const reconsideration = await decisionContinuityStore.recordPolicyDecision({ ...input, reconsiderationId: req.params.reconsiderationId }, scope);
    res.json({ status: "ok", reconsideration });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

decisionContinuityRoute("approval", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "approval");
  if (!scope) return;
  try {
    if (!(await requireLifecycleSeparation(req, res, scope, req.params.reconsiderationId, "approval"))) return;
    if (durableDecisionWorkflowsEnabled()) {
      const payload = { reconsiderationId: req.params.reconsiderationId, decision: req.body?.decision, approverId: scope.principal.id, note: req.body?.note, expectedBranchRevision: req.body?.expectedBranchRevision };
      const submitted = await enqueueDecisionLifecycle({ scope, jobType: "approval", payload, workspaceId: String(req.body?.workspaceId || "default"), reconsiderationId: req.params.reconsiderationId, idempotencyKey: decisionContinuityIdempotencyKey(req, `approval:${req.params.reconsiderationId}:${payload.expectedBranchRevision || ""}`) });
      return res.status(submitted.idempotent ? 200 : 202).json({ status: submitted.idempotent ? "idempotent" : "accepted", ...submitted });
    }
    const approval = await decisionContinuityStore.recordApproval({
      reconsiderationId: req.params.reconsiderationId,
      decision: req.body?.decision,
      approverId: scope.principal.id,
      note: req.body?.note
    }, { tenantId: scope.tenantId, actor: scope.actor });
    res.json({ status: "ok", approval });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

decisionContinuityRoute("canary_start", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "canary_start");
  if (!scope) return;
  try {
    if (durableDecisionWorkflowsEnabled()) {
      if (!(await requireDecisionContinuityResource(req, res, scope, "decision_continuity.canary_start", () => decisionContinuityStore.getReconsideration(req.params.reconsiderationId, { tenantId: scope.tenantId })))) return;
      const payload = { ...(req.body || {}), reconsiderationId: req.params.reconsiderationId };
      const submitted = await enqueueDecisionLifecycle({ scope, jobType: "canary_start", payload, workspaceId: String(payload.workspaceId || "default"), reconsiderationId: req.params.reconsiderationId, idempotencyKey: decisionContinuityIdempotencyKey(req, `canary:${req.params.reconsiderationId}:${payload.expectedBranchRevision || ""}`) });
      return res.status(submitted.idempotent ? 200 : 202).json({ status: submitted.idempotent ? "idempotent" : "accepted", ...submitted });
    }
    const canary = await decisionContinuityStore.startCanary({ ...(req.body || {}), reconsiderationId: req.params.reconsiderationId }, { tenantId: scope.tenantId, actor: scope.actor });
    res.status(202).json({ status: "recorded", canary, note: "The P0 canary record has no direct deployment side effect." });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

decisionContinuityRoute("canary_outcome", async (req, res) => {
  const scope = await decisionContinuityScope(req, res, "canary_outcome");
  if (!scope) return;
  try {
    const { tenantId: _tenantId, ...input } = req.body || {};
    if (durableDecisionWorkflowsEnabled()) {
      if (!(await requireDecisionContinuityResource(req, res, scope, "decision_continuity.canary_outcome", () => decisionContinuityStore.getCanary(req.params.canaryId, { tenantId: scope.tenantId })))) return;
      const payload = { ...input, canaryId: req.params.canaryId };
      const submitted = await enqueueDecisionLifecycle({ scope, jobType: "canary_outcome", payload, workspaceId: String(input.workspaceId || "default"), branchId: req.params.canaryId, idempotencyKey: decisionContinuityIdempotencyKey(req, `canary-outcome:${req.params.canaryId}:${input.expectedBranchRevision || ""}`) });
      return res.status(submitted.idempotent ? 200 : 202).json({ status: submitted.idempotent ? "idempotent" : "accepted", ...submitted });
    }
    const canary = await decisionContinuityStore.recordCanaryOutcome({ ...input, canaryId: req.params.canaryId }, scope);
    res.json({ status: "ok", canary });
  } catch (error) {
    respondDecisionContinuityError(res, error);
  }
});

// Startup fails if a lifecycle route was omitted from the registry or if a
// registry row has no route/test classification. This is intentionally based
// on the registration API rather than a source-code grep.
assertDecisionContinuityLifecycleCoverage(registeredDecisionContinuityRoutes);

app.get("/api/runtime-log", (_req, res) => {
  const fileLogs = fs.existsSync(runtimeLogPath) ? readRuntimeLogRows() : [];
  const logs = (fileLogs.length ? fileLogs : runtimeLog)
    .slice(0, MAX_RUNTIME_LOG_ROWS)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  res.json({
    status: "ok",
    logs,
    source: fileLogs.length ? "file" : "memory"
  });
});

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.write(
    `data: ${JSON.stringify({
      id: `connected-${Date.now()}`,
      type: "connected",
      message: "Event stream connected",
      createdAt: new Date().toISOString(),
      time: `${istTimeFormatter.format(new Date())} IST`
    })}\n\n`
  );
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

app.post("/api/auth/google", async (req, res) => {
  try {
    res.json({ status: "ok", user: await authenticateGooglePayload(req.body || {}) });
  } catch (error) {
    res.status(401).json({ status: "failed", error: error.message });
  }
});

app.get("/api/projects", async (req, res) => {
  res.json({
    status: "ok",
    user: userFromRequest(req),
    projects: await listProjects({ user: userFromRequest(req) })
  });
});

app.get("/api/project-instructions", (req, res) => {
  res.json({
    status: "ok",
    instructions: readProjectInstructionTimeline({ projectId: req.query.projectId || "" })
  });
});

app.get("/api/orchestrator-health", async (req, res) => {
  try {
    const report = await orchestratorHealthMonitor.audit({
      reason: req.query.reason || "manual-api"
    });
    res.json({ status: "ok", report });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

// Lightweight liveness/readiness contract for the PlutoniX backend. This is
// dependency-free so an optional integration cannot hide a service failure.
// Deeper route/runtime concerns remain evidence for orchestrator health and
// the BrainX improvement pipeline.
app.get("/api/health", async (_req, res) => {
  try {
    const selfImprovement = await selfImprovementControlPlane.status();
    res.json({
      status: "ok",
      service: "plutonix-backend",
      timestamp: new Date().toISOString(),
      checks: {
        http: "healthy",
        selfImprovement: selfImprovement.status || "unknown",
        workspaceSandbox: gothamSandboxReadiness.status
      },
      gothamSandbox: gothamSandboxReadiness
    });
  } catch (error) {
    res.status(503).json({
      status: "degraded",
      service: "plutonix-backend",
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

app.get("/api/self-improvement/status", async (_req, res) => {
  try {
    res.json({
      status: "ok",
      selfImprovement: await selfImprovementControlPlane.status(),
      config: readSelfImprovementConfig(),
      huggingFaceModelPool: await huggingFaceModelPool.status()
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.post("/api/self-improvement/system-instruction", async (req, res) => {
  if (!requireSelfImprovementAdmin(req, res)) return;
  try {
    const instruction = String(req.body?.instruction || "").trim();
    if (instruction.length < 12) return res.status(400).json({ status: "failed", error: "System direction must be at least 12 characters." });
    const taskType = req.body?.taskType || "Simple";
    const hfPreparation = await huggingFaceModelPool.prepareFromInstruction({
      instruction,
      autoDownload: String(process.env.PLUTONIX_HF_AUTO_DOWNLOAD || "1") === "1"
    });
    const modelRouting = localModelRoutingForTask({
      taskType,
      target: "self-improvement",
      instruction
    });
    const cycle = await selfImprovementControlPlane.handleSystemInstruction({
      instruction: [
        instruction,
        "",
        "PlutoniX model routing directive:",
        JSON.stringify({ modelRouting, huggingFaceModelPool: hfPreparation }, null, 2)
      ].join("\n"),
      taskType,
      user: userFromRequest(req)
    });
    res.json({ status: "ok", cycle, modelRouting, huggingFaceModelPool: hfPreparation });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/model-pool/huggingface/status", async (_req, res) => {
  try {
    res.json({ status: "ok", modelPool: await huggingFaceModelPool.status() });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/model-pool/huggingface/models", async (req, res) => {
  try {
    res.json({
      status: "ok",
      models: await huggingFaceModelPool.listModels({ limit: Number(req.query.limit || 100) }),
      services: await huggingFaceModelPool.listServices({ limit: Number(req.query.limit || 100) })
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.post("/api/model-pool/huggingface/search", async (req, res) => {
  if (!requireSelfImprovementAdmin(req, res)) return;
  try {
    const models = await huggingFaceModelPool.searchModels({
      query: req.body?.query || "",
      task: req.body?.task || "",
      limit: Number(req.body?.limit || 5)
    });
    res.json({ status: "ok", models });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.post("/api/model-pool/huggingface/download", async (req, res) => {
  if (!requireSelfImprovementAdmin(req, res)) return;
  try {
    const result = await huggingFaceModelPool.downloadModel({
      repoId: req.body?.repoId || "",
      task: req.body?.task || "",
      sourceInstruction: req.body?.sourceInstruction || "",
      dryRun: req.body?.dryRun === true
    });
    res.json({ status: "ok", result });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/self-improvement/proposals", async (req, res) => {
  try {
    res.json({
      status: "ok",
      proposals: await selfImprovementControlPlane.listProposals({ limit: Number(req.query.limit || 50) })
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/self-improvement/signals", async (req, res) => {
  try {
    res.json({
      status: "ok",
      signals: await selfImprovementControlPlane.listSignals({ limit: Number(req.query.limit || 100) })
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/self-improvement/patterns", async (req, res) => {
  try {
    res.json({
      status: "ok",
      patterns: await selfImprovementControlPlane.listPatterns({ limit: Number(req.query.limit || 100) })
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/self-improvement/run-logs", async (req, res) => {
  try {
    res.json({
      status: "ok",
      logs: await selfImprovementControlPlane.listRunLogs({ limit: Number(req.query.limit || 100) })
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/self-improvement/investigations", async (req, res) => {
  try {
    res.json({
      status: "ok",
      investigations: await selfImprovementControlPlane.listInvestigations({ limit: Number(req.query.limit || 100) })
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/self-improvement/research-logs", async (req, res) => {
  try {
    res.json({
      status: "ok",
      logs: await selfImprovementControlPlane.listResearchLogs({ limit: Number(req.query.limit || 100) })
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/self-improvement/tool-plans", async (req, res) => {
  try {
    res.json({
      status: "ok",
      toolPlans: await selfImprovementControlPlane.listToolPlans({ limit: Number(req.query.limit || 100) })
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/self-improvement/monetary-approvals", async (req, res) => {
  try {
    res.json({
      status: "ok",
      approvals: await selfImprovementControlPlane.listMonetaryApprovals({ limit: Number(req.query.limit || 100) })
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.post("/api/self-improvement/monetary-approvals/:approvalId", async (req, res) => {
  if (!requireSelfImprovementAdmin(req, res)) return;
  try {
    const result = await selfImprovementControlPlane.handleMonetaryDecision({
      approvalId: req.params.approvalId,
      decision: req.body?.decision || "cheaper_solution",
      note: req.body?.note || "",
      user: userFromRequest(req)
    });
    res.json({ status: "ok", result });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/self-improvement/feature-inventory", (_req, res) => {
  try {
    const inventoryPath = path.join(plutonixProjectRoot(), "runtime", "self-improvement", "baselines", "feature-inventory.json");
    const inventory = fs.existsSync(inventoryPath) ? JSON.parse(fs.readFileSync(inventoryPath, "utf8")) : { features: [] };
    res.json({ status: "ok", inventory });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/self-improvement/market-vision", (_req, res) => {
  try {
    const root = plutonixProjectRoot();
    const knowledgePath = path.join(root, "runtime", "self-improvement", "market-vision", "plutonix-market-differentiation.json");
    const latestPath = path.join(root, "observability", "self-improvement", "latest-market-vision.json");
    const pdfPath = path.join(root, "docs", "quotes", "PlutoniX_Market_Differentiation_Investor_Quotation.pdf");
    const marketVision = fs.existsSync(knowledgePath) ? JSON.parse(fs.readFileSync(knowledgePath, "utf8")) : null;
    const latest = fs.existsSync(latestPath) ? JSON.parse(fs.readFileSync(latestPath, "utf8")) : null;
    res.json({
      status: "ok",
      marketVision,
      latest,
      pdf: {
        title: "PlutoniX Market Differentiation and Defensibility Report",
        path: path.relative(root, pdfPath).split(path.sep).join("/"),
        url: "/api/self-improvement/market-vision/pdf",
        exists: fs.existsSync(pdfPath)
      }
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/self-improvement/market-vision/pdf", (_req, res) => {
  const pdfPath = path.join(plutonixProjectRoot(), "docs", "quotes", "PlutoniX_Market_Differentiation_Investor_Quotation.pdf");
  if (!fs.existsSync(pdfPath)) return res.status(404).json({ status: "failed", error: "Market vision PDF not found." });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "inline; filename=\"PlutoniX_Market_Differentiation_Investor_Quotation.pdf\"");
  res.sendFile(pdfPath);
});

app.post("/api/self-improvement/investor-discovery/apify-linkedin", async (req, res) => {
  if (!requireSelfImprovementAdmin(req, res)) return;
  try {
    const input = ApifyInvestorPullSchema.parse(req.body || {});
    const pull = await runApifyInvestorPull(input);
    res.json({ status: "ok", pull });
  } catch (error) {
    const statusCode = error.statusCode || (error.name === "ZodError" ? 400 : 500);
    res.status(statusCode).json({ status: "failed", error: error.message });
  }
});

app.get("/api/self-improvement/investor-discovery/profiles", (req, res) => {
  if (!requireSelfImprovementAdmin(req, res)) return;
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 300);
    const selectedCountry = countryLabel(req.query.country || "");
    const profiles = readInvestorProfiles()
      .filter((profile) => recordMatchesCountry(profile, selectedCountry))
      .sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0) || String(b.firstSeenAt || "").localeCompare(String(a.firstSeenAt || "")))
      .slice(0, limit);
    const proposals = readInvestorProposals();
    const dispatches = readInvestorDispatches();
    res.json({
      status: "ok",
      country: selectedCountry,
      countryOptions: investorCountryOptions.map(({ id, label }) => ({ id, label })),
      profiles,
      topInvestors: profiles.slice(0, 20),
      proposals: proposals.slice(-50).reverse(),
      dispatches: dispatches.slice(-50).reverse()
    });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.post("/api/self-improvement/investor-discovery/profiles/:investorId/proposal", (req, res) => {
  if (!requireSelfImprovementAdmin(req, res)) return;
  try {
    const input = InvestorProposalPrepareSchema.parse(req.body || {});
    const profiles = readInvestorProfiles();
    const investor = profiles.find((profile) => profile.id === req.params.investorId);
    if (!investor) return res.status(404).json({ status: "failed", error: "Investor profile not found." });
    const proposal = buildInvestorProposal(investor, input);
    const proposals = readInvestorProposals();
    writeInvestorProposals([...proposals.filter((item) => item.investorId !== investor.id || item.status !== "draft_review"), proposal]);
    updateInvestorProfile(investor.id, {
      proposalStatus: "draft_review",
      latestProposalId: proposal.id,
      outreachStatus: "awaiting_review"
    });
    event("investor-proposal-prepared", `Prepared investor proposal for ${investor.name}.`, {
      investorId: investor.id,
      proposalId: proposal.id,
      fitScore: investor.fitScore
    });
    res.json({ status: "ok", proposal });
  } catch (error) {
    const statusCode = error.name === "ZodError" ? 400 : 500;
    res.status(statusCode).json({ status: "failed", error: error.message });
  }
});

app.post("/api/self-improvement/investor-discovery/proposals/:proposalId/approve", (req, res) => {
  if (!requireSelfImprovementAdmin(req, res)) return;
  try {
    const input = InvestorProposalApprovalSchema.parse(req.body || {});
    const proposals = readInvestorProposals();
    const index = proposals.findIndex((proposal) => proposal.id === req.params.proposalId);
    if (index < 0) return res.status(404).json({ status: "failed", error: "Investor proposal not found." });
    const approved = input.approved !== false;
    const proposal = {
      ...proposals[index],
      status: approved ? "approved" : "revision_requested",
      reviewerNote: input.reviewerNote || "",
      approvedAt: approved ? new Date().toISOString() : "",
      updatedAt: new Date().toISOString(),
      dispatch: {
        inbox: { ...(proposals[index].dispatch?.inbox || {}), status: approved ? "approved_pending_send" : "pending_revision" },
        directMessage: { ...(proposals[index].dispatch?.directMessage || {}), status: approved ? "approved_pending_send" : "pending_revision" }
      }
    };
    proposals[index] = proposal;
    writeInvestorProposals(proposals);
    updateInvestorProfile(proposal.investorId, {
      proposalStatus: proposal.status,
      outreachStatus: approved ? "approved_pending_send" : "revision_requested"
    });
    event("investor-proposal-approved", `${approved ? "Approved" : "Requested revision for"} investor proposal ${proposal.id}.`, {
      investorId: proposal.investorId,
      proposalId: proposal.id
    });
    res.json({ status: "ok", proposal });
  } catch (error) {
    const statusCode = error.name === "ZodError" ? 400 : 500;
    res.status(statusCode).json({ status: "failed", error: error.message });
  }
});

app.post("/api/self-improvement/investor-discovery/proposals/:proposalId/send", (req, res) => {
  if (!requireSelfImprovementAdmin(req, res)) return;
  try {
    const proposals = readInvestorProposals();
    const index = proposals.findIndex((proposal) => proposal.id === req.params.proposalId);
    if (index < 0) return res.status(404).json({ status: "failed", error: "Investor proposal not found." });
    const proposal = proposals[index];
    if (proposal.status !== "approved") {
      return res.status(409).json({ status: "failed", error: "Proposal must be approved before outreach dispatch." });
    }
    const now = new Date().toISOString();
    const dispatch = {
      id: `investor_dispatch_${Date.now()}_${safeFileBase(proposal.investorId || proposal.id)}`,
      proposalId: proposal.id,
      investorId: proposal.investorId,
      investorName: proposal.investorName,
      createdAt: now,
      status: "pending_external_delivery",
      note: "Inbox and direct message content is approved and staged. No live email or LinkedIn sender is configured, so delivery remains pending external/manual send.",
      channels: {
        inbox: {
          status: "pending_external_delivery",
          subject: proposal.proposal?.inbox?.subject || "",
          body: proposal.proposal?.inbox?.body || ""
        },
        directMessage: {
          status: "pending_external_delivery",
          body: proposal.proposal?.directMessage || ""
        }
      }
    };
    proposals[index] = {
      ...proposal,
      status: "outreach_staged",
      updatedAt: now,
      dispatch: {
        inbox: { status: "pending_external_delivery", sentAt: "" },
        directMessage: { status: "pending_external_delivery", sentAt: "" }
      },
      latestDispatchId: dispatch.id
    };
    writeInvestorProposals(proposals);
    writeInvestorDispatches([...readInvestorDispatches(), dispatch]);
    updateInvestorProfile(proposal.investorId, {
      proposalStatus: "outreach_staged",
      outreachStatus: "pending_external_delivery",
      latestDispatchId: dispatch.id
    });
    event("investor-outreach-staged", `Approved inbox and direct message outreach staged for ${proposal.investorName}.`, {
      investorId: proposal.investorId,
      proposalId: proposal.id,
      dispatchId: dispatch.id
    });
    res.json({ status: "ok", proposal: proposals[index], dispatch });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.post("/api/self-improvement/cycle", async (req, res) => {
  if (!requireSelfImprovementAdmin(req, res)) return;
  try {
    const cycle = await selfImprovementControlPlane.runCycle({
      reason: req.body?.reason || "manual-api",
      manual: true
    });
    res.json({ status: "ok", cycle });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.post("/api/self-improvement/control", async (req, res) => {
  if (!requireSelfImprovementAdmin(req, res)) return;
  try {
    const state = await selfImprovementControlPlane.control(req.body?.action || "", req.body || {});
    res.json({ status: "ok", state });
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/agentic-system/graph", async (_req, res) => {
  try {
    const baseGraph = await buildAgenticSystemGraph();
    const globalAgents = await listGlobalAgents();
    res.json(mergeAgenticSystemGraph(baseGraph, globalAgents));
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/agents/global", async (_req, res) => {
  try {
    res.json(await listGlobalAgents());
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.delete("/api/agents/global/:agentId", async (req, res) => {
  const parsed = AgentDeleteSelectorSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ status: "failed", error: "Invalid agent deletion selector." });
  }
  const user = userFromRequest(req);
  try {
    const result = await deleteGlobalAgent({
      agentId: req.params.agentId,
      ...parsed.data
    });
    const receipt = {
      id: `agent_delete_${Date.now()}`,
      deletedAt: new Date().toISOString(),
      userId: user.id,
      userName: user.name,
      agent: result.agent,
      status: result.status,
      removedLocalPathCount: result.removedLocalPaths.length + result.removedProjectLocalPathCount,
      remoteMemoryFileCount: result.remoteMemory.length,
      updatedTopologies: result.updatedTopologies
    };
    appendJsonLine(path.join(plutonixProjectRoot(), "runtime", "agents", "agent-deletions.jsonl"), receipt);
    event("agent-deleted", `Deleted ${result.agent.name} and its linked memory.`, {
      agentId: result.agent.id,
      project: result.agent.project,
      status: result.status,
      removedLocalPathCount: receipt.removedLocalPathCount,
      remoteMemoryFileCount: receipt.remoteMemoryFileCount
    });
    return res.json({ ...result, receipt });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/agents/efficiency", async (_req, res) => {
  try {
    res.json(await readAgentEfficiencySummary());
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

const previewArtifactRoots = new Set(["deliverables", "artifacts", "openapi", "scripts", "outputs"]);
const previewArtifactExtensions = new Set([
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".xls",
  ".csv",
  ".tsv",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".html",
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".py",
  ".js",
  ".ts",
  ".sh"
]);

function artifactMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".html": "text/html",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".json": "application/json",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".py": "text/x-python",
    ".js": "text/javascript",
    ".ts": "text/plain",
    ".sh": "text/x-shellscript"
  }[extension] || "application/octet-stream";
}

function artifactKind(mimeType, filePath = "") {
  const extension = path.extname(filePath).toLowerCase();
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  if ([".xlsx", ".xls", ".csv", ".tsv"].includes(extension)) return "spreadsheet";
  if (extension === ".pptx") return "presentation";
  if ([".docx", ".md", ".txt"].includes(extension)) return "document";
  if (extension === ".html") return "html";
  if ([".json", ".yaml", ".yml", ".py", ".js", ".ts", ".sh"].includes(extension)) return "code";
  return "file";
}

const artifactXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: false
});
const maxArtifactPreviewBytes = 24 * 1024 * 1024;

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function xmlNodeText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(xmlNodeText).join("");
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([key]) => !key.startsWith("@_"))
      .map(([, child]) => xmlNodeText(child))
      .join("");
  }
  return "";
}

function zipXml(zip, entryName) {
  const entry = zip.getEntry(entryName);
  if (!entry) return null;
  return artifactXmlParser.parse(entry.getData().toString("utf8"));
}

function spreadsheetColumnIndex(reference = "") {
  const letters = String(reference).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function spreadsheetColumnLabel(index) {
  let value = Number(index) + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label || "A";
}

function parseDelimitedRows(source, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length && rows.length < 250; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((values, rowIndex) => ({
    index: rowIndex + 1,
    cells: values.slice(0, 60).map((value, columnIndex) => ({
      column: columnIndex,
      reference: `${spreadsheetColumnLabel(columnIndex)}${rowIndex + 1}`,
      value,
      formula: String(value).startsWith("=") ? String(value).slice(1) : ""
    }))
  }));
}

function parseXlsxPreview(filePath) {
  const zip = new AdmZip(filePath);
  const workbook = zipXml(zip, "xl/workbook.xml")?.workbook || {};
  const relationships = zipXml(zip, "xl/_rels/workbook.xml.rels")?.Relationships?.Relationship;
  const relationTargets = new Map(asArray(relationships).map((item) => [item?.["@_Id"], item?.["@_Target"]]));
  const sharedStrings = asArray(zipXml(zip, "xl/sharedStrings.xml")?.sst?.si).map((item) => xmlNodeText(item));
  const sheets = asArray(workbook?.sheets?.sheet).slice(0, 20).map((sheet, sheetIndex) => {
    const relationId = sheet?.["@_r:id"];
    const target = relationTargets.get(relationId) || `worksheets/sheet${sheetIndex + 1}.xml`;
    const normalizedTarget = target.replace(/^\/+/, "").replace(/^xl\//, "");
    const worksheet = zipXml(zip, `xl/${normalizedTarget}`)?.worksheet || {};
    const rows = asArray(worksheet?.sheetData?.row).slice(0, 250).map((row, rowIndex) => ({
      index: Number(row?.["@_r"] || rowIndex + 1),
      cells: asArray(row?.c).slice(0, 60).map((cell, cellIndex) => {
        const reference = cell?.["@_r"] || `A${rowIndex + 1}`;
        const type = cell?.["@_t"] || "number";
        const rawValue = cell?.v == null ? "" : String(cell.v);
        const value = type === "s"
          ? sharedStrings[Number(rawValue)] || ""
          : type === "inlineStr"
            ? xmlNodeText(cell?.is)
            : rawValue;
        return {
          column: spreadsheetColumnIndex(reference),
          reference,
          value,
          formula: cell?.f == null ? "" : xmlNodeText(cell.f),
          type
        };
      })
    }));
    return {
      name: sheet?.["@_name"] || `Sheet ${sheetIndex + 1}`,
      rows,
      rowCount: rows.length,
      columnCount: Math.max(0, ...rows.flatMap((row) => row.cells.map((cell) => cell.column + 1))),
      formulaCount: rows.reduce((total, row) => total + row.cells.filter((cell) => cell.formula).length, 0)
    };
  });
  return { kind: "spreadsheet", sheets };
}

function parseOfficeDocumentPreview(filePath, kind) {
  const zip = new AdmZip(filePath);
  if (kind === "document") {
    const body = zipXml(zip, "word/document.xml")?.["w:document"]?.["w:body"];
    const paragraphs = asArray(body?.["w:p"])
      .map((paragraph) => xmlNodeText(paragraph).replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 500);
    return { kind, title: path.basename(filePath), paragraphs };
  }
  const slides = zip.getEntries()
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName))
    .sort((left, right) => left.entryName.localeCompare(right.entryName, undefined, { numeric: true }))
    .slice(0, 100)
    .map((entry, index) => {
      const parsed = artifactXmlParser.parse(entry.getData().toString("utf8"));
      const text = xmlNodeText(parsed).replace(/\s+/g, " ").trim();
      return { index: index + 1, title: text.split(/(?<=[.!?])\s+/)[0] || `Slide ${index + 1}`, text };
    });
  return { kind: "presentation", slides };
}

async function artifactPreviewPayload(absolutePath) {
  const extension = path.extname(absolutePath).toLowerCase();
  const mimeType = artifactMimeType(absolutePath);
  const kind = artifactKind(mimeType, absolutePath);
  const stat = await fs.promises.stat(absolutePath);
  if (stat.size > maxArtifactPreviewBytes) {
    return { kind, mimeType, truncated: true, message: "Artifact is too large for an inline structured preview." };
  }
  if (extension === ".xlsx") return { ...(parseXlsxPreview(absolutePath)), mimeType };
  if (extension === ".xls") {
    return { kind: "spreadsheet", mimeType, message: "Legacy XLS files can be downloaded; use XLSX or CSV for an inline workbook preview." };
  }
  if ([".csv", ".tsv"].includes(extension)) {
    const source = await fs.promises.readFile(absolutePath, "utf8");
    const rows = parseDelimitedRows(source, extension === ".tsv" ? "\t" : ",");
    return {
      kind: "spreadsheet",
      mimeType,
      sheets: [{
        name: path.basename(absolutePath, extension),
        rows,
        rowCount: rows.length,
        columnCount: Math.max(0, ...rows.map((row) => row.cells.length)),
        formulaCount: rows.reduce((total, row) => total + row.cells.filter((cell) => cell.formula).length, 0)
      }]
    };
  }
  if (extension === ".docx") return { ...parseOfficeDocumentPreview(absolutePath, "document"), mimeType };
  if (extension === ".pptx") return { ...parseOfficeDocumentPreview(absolutePath, "presentation"), mimeType };
  if (["document", "code"].includes(kind)) {
    const content = (await fs.promises.readFile(absolutePath, "utf8")).slice(0, 400000);
    return { kind, mimeType, content, truncated: stat.size > Buffer.byteLength(content) };
  }
  return { kind, mimeType };
}

async function listProjectArtifacts(project) {
  const artifacts = [];
  const visit = async (directory, rootName) => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (artifacts.length >= 100) return;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, rootName);
        continue;
      }
      if (!entry.isFile() || !previewArtifactExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      const stat = await fs.promises.stat(absolutePath);
      const relativePath = path.relative(project.workspaceDir, absolutePath).split(path.sep).join("/");
      const mimeType = artifactMimeType(absolutePath);
      artifacts.push({
        name: entry.name,
        path: relativePath,
        root: rootName,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        mimeType,
        kind: artifactKind(mimeType, absolutePath),
        url: `/api/projects/${encodeURIComponent(project.id)}/artifacts/file?path=${encodeURIComponent(relativePath)}`
      });
    }
  };
  for (const rootName of previewArtifactRoots) {
    await visit(path.join(project.workspaceDir, rootName), rootName);
  }
  return artifacts.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

function resolveProjectArtifactPath(project, relativePath) {
  const cleanPath = String(relativePath || "").replaceAll("\\", "/").replace(/^\/+/, "");
  const rootName = cleanPath.split("/")[0];
  if (!previewArtifactRoots.has(rootName)) throw new Error("Artifact path is outside approved preview roots.");
  const absolutePath = path.resolve(project.workspaceDir, cleanPath);
  const workspaceRoot = path.resolve(project.workspaceDir);
  if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error("Artifact path is outside the selected project.");
  }
  return absolutePath;
}

registerHostingRoutes(app);

app.post("/api/project-documents/stage", upload.array("documents", 12), async (req, res) => {
  const user = userFromRequest(req);
  try {
    const documents = await stageProjectDocuments(user, req.files || []);
    event("project-documents-staged", `Staged ${documents.length} project document${documents.length === 1 ? "" : "s"}`, {
      userId: user.id,
      documents: documents.map((doc) => ({ id: doc.id, name: doc.name, purpose: doc.purpose }))
    });
    res.json({ status: "succeeded", documents });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message });
  }
});

app.post("/api/project-media/stage", upload.array("media", 12), async (req, res) => {
  const user = userFromRequest(req);
  try {
    const media = await stageProjectMedia(user, req.files || []);
    event("project-media-staged", `Staged ${media.length} media reference${media.length === 1 ? "" : "s"}`, {
      userId: user.id,
      media: media.map((item) => ({ id: item.id, name: item.originalName, purpose: item.purpose }))
    });
    res.json({ status: "succeeded", media });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message });
  }
});

app.post("/api/generate/preflight", async (req, res) => {
  const parsed = RealDataPreflightSchema.safeParse(normalizeRealDataPreflightPayload(req.body));
  if (!parsed.success) {
    const invalidFields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "request"))];
    event("real-data-preflight-rejected", `Required-data preflight rejected invalid field${invalidFields.length === 1 ? "" : "s"}: ${invalidFields.join(", ")}`, {
      invalidFields
    });
    return res.status(400).json({
      status: "failed",
      error: `Required-data check could not read: ${invalidFields.join(", ")}. Refresh PlutoniX and retry.`,
      invalidFields
    });
  }
  return res.json(analyzeRealDataNeed(parsed.data));
});

app.get("/api/intel/profiles", (_req, res) => {
  return res.json({
    schemaVersion: "1.0",
    profiles: intelProfileRegistry.map((profile) => ({
      id: profile.id,
      displayName: profile.displayName,
      status: profile.status,
      capabilities: profile.capabilities,
      previewAdapter: profile.previewAdapter,
      executionAdapter: profile.executionAdapter,
      validationPipeline: profile.validationPipeline
    }))
  });
});

app.post("/api/agents/vector-sync", async (req, res) => {
  return res.status(403).json({
    status: "restricted",
    error: "Direct user-triggered vector memory sync/export is restricted."
  });
  /*
  try {
    const summary = await syncKnownAgentKnowledgeRoots({ reason: req.body?.reason || "manual", emit: event });
    res.json(summary);
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
  */
});

app.post("/api/projects/new", async (req, res) => {
  const user = userFromRequest(req);
  const parsed = NewProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: `Project name must be 2-80 characters and optional instruction must be between 12 and ${MAX_INSTRUCTION_CHARS} characters.`
    });
  }

  const projectInstruction =
    parsed.data.instruction ||
    `Create the smallest useful starter for ${parsed.data.name}. Infer artifact intent from the project name only when it is clear; otherwise build a focused app-shaped workspace around one primary task with real-data hooks and explicit empty states. Do not add marketing sections, generic dashboard modules, or invented business data.`;
  const projectPreflight = analyzeRealDataNeed({
    instruction: projectInstruction,
    projectName: parsed.data.name,
    mediaIds: parsed.data.mediaIds,
    stagedMediaIds: parsed.data.stagedMediaIds,
    stagedDocumentIds: parsed.data.stagedDocumentIds,
    suppliedData: requiredDataValues(parsed.data.requiredData)
  });
  if (projectPreflight.status === "needs_input") {
    return res.status(409).json({
      status: "needs_input",
      error: projectPreflight.message,
      ...projectPreflight
    });
  }
  const initialOrchestrated = orchestrateBuilderInstruction(projectInstruction);
  if (rejectRestrictedIntent(res, `${parsed.data.name}\n${projectInstruction}`)) return;
  const projectTaskType = parsed.data.taskType || "Medium";
  initialOrchestrated.structuredRequest.taskType = projectTaskType;
  const projectOrchestratorPrompt = formatProjectOrchestratorInstruction(projectInstruction, projectTaskType);
  event("project-create-start", `Creating project ${parsed.data.name}`, {
    projectName: parsed.data.name,
    container: process.env.GENERATED_SITE_CONTAINER || "plutonix-generated-site"
  });

  let project = null;
  let orchestrationEnvelope = null;
  let orchestrated = null;
  let bootstrap = null;
  let result = null;
  try {
    project = await createProject(parsed.data.name, initialOrchestrated.structuredRequest, {
      emit: event,
      user,
      brandingPalette: parsed.data.brandingPalette || null
    });
    const stagedMedia = await attachStagedMediaToProject(user, project, parsed.data.stagedMediaIds || []);
    if (stagedMedia.length) {
      project = await getProject(project.id, { user }) || project;
    }
    const projectDocuments = await attachStagedDocumentsToProject(user, project, parsed.data.stagedDocumentIds || []);
    bootstrap = await runProjectOrchestratorBootstrap(project, { emit: event });
    event("project-instruction-start", `Reading the UI instruction through ${project.name}'s bootstrapped orchestrator`, {
      projectId: project.id,
      promptPath: bootstrap.promptPath,
      taskType: projectTaskType
    });
    orchestrated = initialOrchestrated;
    event("product-shape-selected", `PlutoniX selected ${orchestrated.structuredRequest.productDecision.productShape} for ${project.name}`, {
      projectId: project.id,
      projectName: project.name,
      productDecision: orchestrated.structuredRequest.productDecision
    });
    const requestedMediaIds = new Set([...(parsed.data.mediaIds || []), ...stagedMedia.map((item) => item.id)]);
    const media = (project.media || []).filter((item) => requestedMediaIds.has(item.id));
    orchestrated.structuredRequest.media = media;
    orchestrated.structuredRequest.projectDocuments = projectDocuments;
    orchestrated.structuredRequest.inputSources = [
      ...(parsed.data.requiredData || []).map((item) => ({ ...item, sourceType: "required_data" })),
      ...media.map((item) => ({ id: item.id, label: item.name, value: item.path, sourceType: "media" })),
      ...projectDocuments.map((item) => ({ id: item.id, label: item.originalName, value: item.projectPath, sourceType: "document" }))
    ];
    const projectAgents = await syncProjectAgentTopology(project, orchestrated.structuredRequest);
    event("project-agents-bound", `Bound ${projectAgents.agents.length} reusable agent definitions to ${project.name}`, {
      projectName: project.name,
      projectId: project.id,
      agents: projectAgents.agents.map((agent) => agent.id),
      assignments: (projectAgents.agentAssignments || []).map((assignment) => assignment.id),
      reuseDecisions: (projectAgents.agentReuseDecisions || []).map((decision) => ({
        agentId: decision.selectedAgent,
        decisionType: decision.decisionType
      }))
    });
    orchestrated.structuredRequest.sourceInstruction = media.length
      ? `${orchestrated.structuredRequest.sourceInstruction}\n\nUploaded media available to use:\n${media
          .map((item) => `- ${item.name}: ${item.path}`)
          .join("\n")}`
      : orchestrated.structuredRequest.sourceInstruction;
    if (projectDocuments.length) {
      orchestrated.structuredRequest.sourceInstruction = [
        orchestrated.structuredRequest.sourceInstruction,
        "Project documentation files staged for this app. Treat these as durable requirements/context sources and infer direct and indirect functionality from them:",
        ...projectDocuments.map((doc) => `- ${doc.originalName} stored as ${doc.projectPath} (${doc.purpose})`)
      ].join("\n");
    }
    orchestrationEnvelope = await createPlutoniXOrchestrationEnvelope({
      instruction: projectInstruction,
      taskType: projectTaskType,
      project,
      structuredRequest: orchestrated.structuredRequest
    });
    const adaptiveRoute = selectAdaptiveRoute({
      instruction: projectInstruction,
      taskType: projectTaskType,
      project,
      productDecision: orchestrated.structuredRequest.productDecision
    });
    if (adaptiveRoute.mode === "single") {
      orchestrationEnvelope.delegations = [];
      orchestrationEnvelope.childExecutionIds = [];
    }
    orchestrationEnvelope.adaptiveRoute = adaptiveRoute;
    orchestrated.structuredRequest.orchestrationEnvelope = orchestrationEnvelope;
    event("plutonix-start", `PlutoniX accepted global authority for ${project.name}`, {
      stage: "2/8",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      projectId: project.id
    });
    event("adaptive-route-selected", `PlutoniX selected ${adaptiveRoute.mode}`, {
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      projectId: project.id,
      projectName: project.name,
      adaptiveRoute
    });
    event("orchestrator-prompt", projectOrchestratorPrompt, {
      stage: "2/8",
      projectId: project.id,
      projectName: project.name,
      taskType: projectTaskType,
      promptTarget: "plutonix-fullstack-agent",
      instructionFormat: "Task Type / Task",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId
    });
    for (const delegation of orchestrationEnvelope.delegations) {
      event("delegation-start", `PlutoniX delegated bounded project execution to ${delegation.agentId}`, {
        stage: "3/8",
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        childExecutionId: delegation.executionId,
        agentId: delegation.agentId,
        projectId: project.id
      });
    }
    result = await runPlutoniXOwnedWorkflow(orchestrated.structuredRequest, {
      emit: event,
      generatedSiteDir: project.workspaceDir,
      agentId: "plutonix-fullstack-agent",
      agentName: "PlutoniX Fullstack Agent",
      projectId: project.id,
      projectName: project.name,
      taskType: projectTaskType
    }, orchestrationEnvelope, adaptiveRoute);
    for (const delegation of orchestrationEnvelope.delegations) {
      event("delegation-complete", `${delegation.agentId} completed its bounded execution`, {
        stage: "6/8",
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        childExecutionId: delegation.executionId,
        agentId: delegation.agentId,
        changedFiles: result.files
      });
    }
    event("plutonix-validation", "PlutoniX accepted generated-file validation evidence", {
      stage: "7/8",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      status: "passed",
      changedFiles: result.files,
      productShapeValidation: result.productShapeValidation,
      inputConsumption: result.inputConsumption
    });
    event("project-runtime-handoff", "Gotham file generation complete; PlutoniX is assigning the playground port", {
      projectId: project.id,
      workspaceDir: project.workspaceDir
    });
    const readyProject = await ensureProjectPreviewWithRuntimeRecovery(project, { emit: event, source: "project-creation" });
    project = readyProject;
    event("project-created", `Project ${parsed.data.name} generated on port ${project.port}`, {
      projectName: parsed.data.name,
      projectId: project.id,
      port: project.port,
      buildId: result.buildId,
    });
    const flowPath = projectCreationFlowPath({ projectName: parsed.data.name, taskType: projectTaskType, orchestrated, result });
    persistWhatNextKnowledge(flowPath, {
      projectId: readyProject.id,
      projectName: parsed.data.name,
      instructionSummary: projectInstruction,
      changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || []
    });
    persistProjectInstruction({
      projectId: readyProject.id,
      projectName: parsed.data.name,
      taskType: projectTaskType,
      instruction: projectInstruction,
      status: "succeeded",
      buildId: result.buildId,
      parentWorkflowId: result.parentWorkflowId,
      childExecutionIds: result.childExecutionIds,
      adaptiveRoute: result.adaptiveRoute,
      review: result.review,
      inputConsumption: result.inputConsumption,
      productDecision: orchestrated.structuredRequest.productDecision,
      requiredData: parsed.data.requiredData || [],
      flowPath,
      orchestrationSnapshot: createOrchestrationBuildSnapshot({
        projectId: readyProject.id,
        projectName: parsed.data.name,
        instruction: projectInstruction,
        taskType: projectTaskType,
        status: "succeeded",
        buildId: result.buildId,
        parentWorkflowId: result.parentWorkflowId,
        childExecutionIds: result.childExecutionIds,
        flowPath,
        changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || []
      }),
      changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || []
    });
    event("plutonix-complete", `PlutoniX approved completion for ${project.name}`, {
      stage: "8/8",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      childExecutionIds: orchestrationEnvelope.childExecutionIds,
      buildId: result.buildId
    });
    return res.json({
      status: "succeeded",
      project: readyProject,
      projectName: parsed.data.name,
      container: `plutonix-project-${project.id}`,
      previewUrl: readyProject.previewUrl,
      buildId: result.buildId,
      parentWorkflowId: result.parentWorkflowId,
      childExecutionIds: result.childExecutionIds,
      adaptiveRoute: result.adaptiveRoute,
      review: result.review,
      inputConsumption: result.inputConsumption,
      productDecision: orchestrated.structuredRequest.productDecision,
      changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || [],
      bootstrap,
      flowPath,
      restart: { status: "project-server", reason: `Project Vite server assigned to port ${project.port}` }
    });
  } catch (error) {
    try {
      const repairOutcome = await attemptAutomaticRepairAfterFailure({
        orchestratedRequest: orchestrated?.structuredRequest,
        project,
        error,
        result,
        taskType: projectTaskType,
        source: "project-create"
      });
      if (repairOutcome) {
        const readyProject = repairOutcome.project;
        const repairedResult = repairOutcome.result;
        const flowPath = projectCreationFlowPath({
          projectName: parsed.data.name,
          taskType: projectTaskType,
          orchestrated,
          result: repairedResult
        });
        persistWhatNextKnowledge(flowPath, {
          projectId: readyProject?.id || project?.id || "",
          projectName: parsed.data.name,
          instructionSummary: projectInstruction,
          changedFiles: repairedResult.files || []
        });
        persistProjectInstruction({
          projectId: readyProject?.id || project?.id || "",
          projectName: parsed.data.name,
          taskType: projectTaskType,
          instruction: projectInstruction,
          status: "succeeded",
          buildId: repairedResult.buildId,
          parentWorkflowId: repairedResult.parentWorkflowId,
          childExecutionIds: repairedResult.childExecutionIds,
          adaptiveRoute: repairedResult.adaptiveRoute,
          repair: repairOutcome.repair,
          requiredData: parsed.data.requiredData || [],
          flowPath,
          orchestrationSnapshot: createOrchestrationBuildSnapshot({
            projectId: readyProject?.id || project?.id || "",
            projectName: parsed.data.name,
            instruction: projectInstruction,
            taskType: projectTaskType,
            status: "succeeded",
            buildId: repairedResult.buildId,
            parentWorkflowId: repairedResult.parentWorkflowId,
            childExecutionIds: repairedResult.childExecutionIds,
            flowPath,
            changedFiles: repairedResult.files || []
          }),
          changedFiles: repairedResult.files || []
        });
        event("plutonix-complete", `PlutoniX approved completion for ${project.name} after automatic repair`, {
          stage: "8/8",
          parentWorkflowId: repairedResult.parentWorkflowId,
          childExecutionIds: repairedResult.childExecutionIds,
          buildId: repairedResult.buildId,
          repairId: repairOutcome.repair.repairId
        });
        return res.json({
          status: "succeeded",
          repaired: true,
          project: readyProject,
          projectName: parsed.data.name,
          container: `plutonix-project-${project.id}`,
          previewUrl: readyProject?.previewUrl || project?.previewUrl,
          buildId: repairedResult.buildId,
          parentWorkflowId: repairedResult.parentWorkflowId,
          childExecutionIds: repairedResult.childExecutionIds,
          adaptiveRoute: repairedResult.adaptiveRoute,
          changedFiles: repairedResult.files || [],
          bootstrap,
          flowPath,
          repair: repairOutcome.repair,
          restart: repairOutcome.restart
        });
      }
    } catch (repairError) {
      event("plutonix-repair-failed", repairError.message, {
        projectId: project?.id || "",
        projectName: parsed.data.name,
        originalError: error.message
      });
    }
    if (orchestrationEnvelope) {
      event("plutonix-validation", "PlutoniX rejected completion because execution or validation failed", {
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        childExecutionIds: orchestrationEnvelope.childExecutionIds,
        status: "failed",
        error: error.message
      });
    }
    if (project?.id) {
      event("project-create-preserved", `Preserved incomplete project ${project.name} after generation failure`, {
        projectId: project.id,
        workspaceDir: project.workspaceDir,
        port: project.port
      });
    }
    event("project-create-failed", error.message, { projectName: parsed.data.name });
    const flowPath = projectCreationFlowPath({ projectName: parsed.data.name, taskType: projectTaskType, status: "failed", error: error.message });
    persistWhatNextKnowledge(flowPath, {
      projectId: project?.id || "",
      projectName: parsed.data.name,
      instructionSummary: projectInstruction,
      error: error.message
    });
    persistProjectInstruction({
      projectId: project?.id || "",
      projectName: parsed.data.name,
      taskType: projectTaskType,
      instruction: projectInstruction,
      status: "failed",
      parentWorkflowId: orchestrationEnvelope?.parentWorkflowId || "",
      childExecutionIds: orchestrationEnvelope?.childExecutionIds || [],
      requiredData: parsed.data.requiredData || [],
      flowPath,
      orchestrationSnapshot: createOrchestrationBuildSnapshot({
        projectId: project?.id || "",
        projectName: parsed.data.name,
        instruction: projectInstruction,
        taskType: projectTaskType,
        status: "failed",
        parentWorkflowId: orchestrationEnvelope?.parentWorkflowId || "",
        childExecutionIds: orchestrationEnvelope?.childExecutionIds || [],
        flowPath,
        error: error.message
      }),
      error: error.message
    });
    return res.status(500).json({
      status: "failed",
      projectName: parsed.data.name,
      project,
      previewUrl: project?.previewUrl || previewUrl,
      error: error.message,
      parentWorkflowId: orchestrationEnvelope?.parentWorkflowId || null,
      childExecutionIds: orchestrationEnvelope?.childExecutionIds || [],
      flowPath
    });
  }
});

app.post("/api/projects/import", upload.single("project"), async (req, res) => {
  const user = userFromRequest(req);
  const parsed = ProjectImportSchema.safeParse(req.body);
  if (!parsed.success || !req.file) {
    return res.status(400).json({ error: "Project name and .zip file are required." });
  }

  try {
    if (rejectRestrictedIntent(res, parsed.data.name)) return;
    const project = await importProject(parsed.data.name, req.file.path, { user });
    const readyProject = await ensureProjectPreviewWithRuntimeRecovery(project, { emit: event, source: "project-import" });
    event("project-imported", `Project ${readyProject.name} imported on port ${readyProject.port}`, {
      projectName: project.name,
      projectId: project.id,
      port: readyProject.port
    });
    return res.json({ status: "succeeded", project: readyProject });
  } catch (error) {
    event("project-import-failed", error.message, { projectName: parsed.data.name });
    return res.status(500).json({ status: "failed", error: error.message });
  } finally {
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
  }
});

app.post("/api/projects/:projectId/select", async (req, res) => {
  const user = userFromRequest(req);
  try {
    const project = await getProject(req.params.projectId, { user });
    const selectedProject = project?.isDefault
      ? await ensureProjectPreview(project, {
          previewTimeoutMs: Number(process.env.PROJECT_SELECT_PREVIEW_TIMEOUT_MS || 15000),
          allowPreviewTimeout: true
        })
      : project;
    if (!selectedProject) throw new Error("Project not found.");
    const selectedRuntimeStatus = selectedProject.runtime?.status || selectedProject.status || "stopped";
    const selectedRuntimeLive = !/stopped|not-found/i.test(selectedRuntimeStatus);
    event("project-selected", selectedRuntimeLive ? `Project ${selectedProject.name} is live in the playground` : `Project ${selectedProject.name} selected; instance remains stopped`, {
      projectId: selectedProject.id,
      port: selectedProject.port,
      previewUrl: selectedProject.previewUrl,
      container: selectedProject.containerName,
      runtimeStatus: selectedRuntimeStatus,
      previewWarning: selectedProject.previewWarning || null
    });
    return res.json({ status: "succeeded", project: selectedProject });
  } catch (error) {
    event("project-select-failed", error.message, { projectId: req.params.projectId });
    return res.status(error.message === "Project not found." ? 404 : 503).json({ status: "failed", error: error.message });
  }
});

app.post("/api/projects/:projectId/instance/start", async (req, res) => {
  const user = userFromRequest(req);
  try {
    const project = await getProject(req.params.projectId, { user });
    const readyProject = await startProjectInstance(project, {
      previewTimeoutMs: Number(process.env.PROJECT_INSTANCE_START_TIMEOUT_MS || 30000),
      allowPreviewTimeout: true,
      emit: event
    });
    event("project-instance-started", `Project ${readyProject.name} instance started`, {
      projectId: readyProject.id,
      port: readyProject.port,
      previewUrl: readyProject.previewUrl,
      container: readyProject.containerName,
      runtimeStatus: readyProject.runtime?.status || "running",
      previewWarning: readyProject.previewWarning || null
    });
    return res.json({ status: "succeeded", project: readyProject });
  } catch (error) {
    event("project-instance-start-failed", error.message, { projectId: req.params.projectId });
    return res.status(error.message === "Project not found." ? 404 : 503).json({ status: "failed", error: error.message });
  }
});

app.post("/api/projects/:projectId/instance/stop", async (req, res) => {
  const user = userFromRequest(req);
  try {
    const project = await getProject(req.params.projectId, { user });
    const stoppedProject = await stopProjectInstance(project);
    event("project-instance-stopped", `Project ${stoppedProject.name} instance stopped`, {
      projectId: stoppedProject.id,
      port: stoppedProject.port,
      previewUrl: stoppedProject.previewUrl,
      container: stoppedProject.containerName,
      runtimeStatus: stoppedProject.runtime?.status || "stopped"
    });
    return res.json({ status: "succeeded", project: stoppedProject });
  } catch (error) {
    event("project-instance-stop-failed", error.message, { projectId: req.params.projectId });
    return res.status(error.message === "Project not found." ? 404 : 503).json({ status: "failed", error: error.message });
  }
});

app.post("/api/projects/:projectId/rebuild", async (req, res) => {
  const user = userFromRequest(req);
  try {
    const project = await getProject(req.params.projectId, { user });
    const readyProject = await rebuildProjectRuntime(project, { emit: event });
    event("project-runtime-rebuilt", `Project ${readyProject.name} was rebuilt for the playground`, {
      projectId: readyProject.id,
      port: readyProject.port,
      previewUrl: readyProject.previewUrl,
      container: readyProject.containerName,
      runtimeStatus: readyProject.runtime?.status || "rebuilt"
    });
    return res.json({ status: "succeeded", project: readyProject });
  } catch (error) {
    event("project-rebuild-failed", error.message, { projectId: req.params.projectId });
    const status = error.message === "Project not found." ? 404 : error.message.includes("cannot be rebuilt") ? 400 : 503;
    return res.status(status).json({ status: "failed", error: error.message });
  }
});

app.patch("/api/projects/:projectId", async (req, res) => {
  const user = userFromRequest(req);
  const parsed = ProjectIdentitySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ status: "failed", error: "Project name and workspace name must be 2-80 characters." });
  }
  try {
    const project = await updateProjectIdentity(req.params.projectId, parsed.data, { user });
    event("project-renamed", `Project ${project.name} identity was updated`, {
      projectId: project.id,
      projectName: project.name,
      workspaceName: project.folderName,
      workspaceDir: project.workspaceDir
    });
    return res.json({ status: "succeeded", project });
  } catch (error) {
    const status = error.message === "Project not found." ? 404 : /cannot|must|already|outside/i.test(error.message) ? 400 : 500;
    return res.status(status).json({ status: "failed", error: error.message });
  }
});

app.delete("/api/projects/:projectId", async (req, res) => {
  const user = userFromRequest(req);
  try {
    const deletedProject = await deleteProject(req.params.projectId, { user });
    event("project-deleted", `Project ${deletedProject.name} and its runtime data were deleted`, {
      projectId: deletedProject.id,
      projectName: deletedProject.name,
      port: deletedProject.port,
      containers: deletedProject.runtimeResources.containers,
      volumes: deletedProject.runtimeResources.volumes,
      networks: deletedProject.runtimeResources.networks
    });
    return res.json({ status: "succeeded", project: deletedProject });
  } catch (error) {
    const status = error.message === "Project not found." ? 404 : error.message.includes("cannot be deleted") ? 400 : 500;
    return res.status(status).json({ status: "failed", error: error.message });
  }
});

app.post("/api/projects/:projectId/media", upload.array("media", 12), async (req, res) => {
  const user = userFromRequest(req);
  try {
    const project = await getProject(req.params.projectId, { user });
    const media = await saveProjectMedia(project, req.files || [], {
      purpose: req.query?.purpose === "app-icon" ? "app-icon" : "media"
    });
    event("media-uploaded", `Uploaded ${media.length} media file${media.length === 1 ? "" : "s"}`, {
      projectId: project?.id,
      media
    });
    return res.json({ status: "succeeded", media, project: await getProject(req.params.projectId, { user }) });
  } catch (error) {
    return res.status(400).json({ status: "failed", error: error.message });
  }
});

app.delete("/api/projects/:projectId/media/:mediaId", async (req, res) => {
  const user = userFromRequest(req);
  try {
    const project = await getProject(req.params.projectId, { user });
    const result = await removeProjectMedia(project, [req.params.mediaId], { allowAppIcon: true });
    event("media-removed", `Removed ${result.removed.length} media file${result.removed.length === 1 ? "" : "s"}`, {
      projectId: project?.id,
      mediaIds: result.removed.map((item) => item.id)
    });
    return res.json({ status: "succeeded", ...result });
  } catch (error) {
    return res.status(400).json({ status: "failed", error: error.message });
  }
});

app.get("/api/projects/:projectId/export", async (req, res) => {
  const user = userFromRequest(req);
  try {
    const project = await getProject(req.params.projectId, { user });
    const exported = await exportProject(project);
    res.download(exported.outputPath, exported.fileName);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.get("/api/projects/:projectId/artifacts", async (req, res) => {
  const user = userFromRequest(req);
  try {
    const project = await getProject(req.params.projectId, { user });
    const artifacts = await listProjectArtifacts(project);
    return res.json({
      status: "succeeded",
      projectId: project.id,
      previewStrategy: project.previewStrategy || project.productDecision?.previewStrategy || "browser",
      artifacts
    });
  } catch (error) {
    return res.status(404).json({ status: "failed", error: error.message });
  }
});

app.get("/api/projects/:projectId/artifacts/file", async (req, res) => {
  const user = userFromRequest(req);
  try {
    const project = await getProject(req.params.projectId, { user });
    const absolutePath = resolveProjectArtifactPath(project, req.query.path);
    const stat = await fs.promises.stat(absolutePath);
    if (!stat.isFile()) throw new Error("Artifact file was not found.");
    res.type(artifactMimeType(absolutePath));
    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(404).json({ status: "failed", error: error.message });
  }
});

app.get("/api/projects/:projectId/artifacts/preview", async (req, res) => {
  const user = userFromRequest(req);
  try {
    const project = await getProject(req.params.projectId, { user });
    const absolutePath = resolveProjectArtifactPath(project, req.query.path);
    const stat = await fs.promises.stat(absolutePath);
    if (!stat.isFile()) throw new Error("Artifact file was not found.");
    return res.json({
      status: "succeeded",
      projectId: project.id,
      path: req.query.path,
      preview: await artifactPreviewPayload(absolutePath)
    });
  } catch (error) {
    return res.status(404).json({ status: "failed", error: error.message });
  }
});

function gothamExecutionKey(user, projectId = "") {
  return `${user?.id || "anonymous"}:${projectId || "plutonix-default"}`;
}

function normalizeGothamWorkflowMode(value = "executor") {
  const mode = String(value || "executor").trim().toLowerCase();
  return ["planner", "debugger", "executor"].includes(mode) ? mode : "executor";
}

function gothamModeLabel(mode = "executor") {
  return {
    planner: "Planner",
    debugger: "Debugger",
    executor: "Executor"
  }[normalizeGothamWorkflowMode(mode)];
}

function createPlannerSuggestion({ instruction = "", taskType = "Medium", project = null, orchestrated = null, useProjectOrchestrator = false } = {}) {
  const text = String(instruction || "").replace(/\s+/g, " ").trim();
  const likelyFiles = useProjectOrchestrator
    ? ["Inspect the selected project files relevant to the request before editing.", "Check generated components, CSS, data modules, routes and project-local backend files as applicable."]
    : (orchestrated?.structuredRequest?.fileOperations || []).map((operation) => `${operation.action.toUpperCase()} ${operation.path}`);
  return {
    summary: `Plan for ${project?.name || "PlutoniX default workspace"}: ${text.slice(0, 180)}`,
    approach: [
      "Clarify the expected user-visible behavior and acceptance criteria.",
      "Inspect only the smallest set of files needed to prove the current implementation state.",
      useProjectOrchestrator
        ? "Use the project-local orchestrator context and preserve unrelated project behavior."
        : "Use the generated-site structure, route plan and metadata conventions.",
      "Identify affected contracts, state, styling, data and runtime validation before any code change.",
      "Hand off to Executor only after the file targets and validation path are clear."
    ],
    debuggingApproach: [
      "If the request reports a bug, reproduce or inspect the failing flow first.",
      "Compare intended behavior against current UI, runtime logs and recent generated files.",
      "Fix the root cause with the narrowest change and run focused validation."
    ],
    likelyFiles,
    risks: [
      "Over-editing generated UI and accidentally regressing existing features.",
      "Changing styling without checking responsive behavior.",
      "Skipping validation because the task appears visually small."
    ],
    validationPlan: [
      "Run the closest available build, test or syntax check.",
      "Inspect the preview path affected by the instruction.",
      "Confirm changed files, residual risk and follow-up work before completion."
    ],
    nextInstruction: `Switch Gotham mode to Executor when ready to implement: ${text}`
  };
}

app.post("/api/generate/stop", async (req, res) => {
  const user = userFromRequest(req);
  const projectId = req.body?.target?.type === "system"
    ? "system:plutonix"
    : String(req.body?.projectId || "");
  const key = gothamExecutionKey(user, projectId);
  const activeExecution = activeGothamExecutions.get(key);
  if (!activeExecution) {
    return res.json({ status: "idle", message: "No active Gotham instruction execution found for this project." });
  }
  activeExecution.controller.abort();
  event("gotham-stop-requested", "Stop requested for ongoing Gotham instruction execution", {
    projectId,
    parentWorkflowId: activeExecution.parentWorkflowId,
    requestedAt: new Date().toISOString()
  });
  return res.json({
    status: "stopping",
    parentWorkflowId: activeExecution.parentWorkflowId,
    message: "Gotham instruction execution is stopping."
  });
});

function systemImprovementFlowPath({ instruction = "", taskType = "Medium", workflowMode = "executor", cycle = null } = {}) {
  const result = cycle?.results?.[0] || {};
  const mode = normalizeGothamWorkflowMode(workflowMode);
  return {
    status: cycle?.status === "completed" ? "succeeded" : cycle?.status || "running",
    selectedPath: "plutonix-system-improvement",
    confidence: 90,
    deterministic: true,
    projectName: "PlutoniX System",
    taskType,
    workflowMode: mode,
    summary: `Gotham ${gothamModeLabel(mode)} is targeting the PlutoniX platform itself. A self-improvement proposal is required before any code modification.`,
    target: {
      type: "system",
      systemId: "plutonix",
      scope: "plutonix repository and orchestration platform"
    },
    riskLevel: "proposal_gated",
    affectedComponents: ["plutonix-platform"],
    instructionPreview: String(instruction || "").replace(/\s+/g, " ").slice(0, 160),
    subObjectives: [
      { id: "observe", label: "Observe", state: "completed", detail: "System instruction captured as a bounded improvement signal." },
      { id: "proposal", label: "Proposal", state: result.proposalId ? "completed" : "pending", detail: result.proposalId || "Waiting for proposal." },
      { id: "candidate", label: "Candidate", state: result.candidateId ? "completed" : "pending", detail: result.candidateId ? "Isolated candidate metadata created." : "No live source change." },
      { id: "review", label: "Review", state: result.reviewDecision ? "completed" : "pending", detail: result.reviewDecision || "Independent review required before promotion." },
      { id: "promotion", label: "Promotion", state: result.promotionDecision ? "completed" : "pending", detail: result.promotionDecision || "Sandbox mode stages changes only." }
    ],
    nodes: [
      { id: "system-target", label: "PlutoniX System", state: "selected", detail: "Platform repository target." },
      { id: "improvement-proposal", label: "ImprovementProposal", state: result.proposalId ? "completed" : "pending", detail: result.proposalId || "" },
      { id: "isolated-candidate", label: "Isolated candidate", state: result.candidateId ? "completed" : "pending", detail: result.candidateId || "" },
      { id: "independent-review", label: "Independent reviewer", state: result.reviewDecision ? "completed" : "pending", detail: result.reviewDecision || "" },
      { id: "promotion-policy", label: "Promotion policy", state: result.promotionDecision ? "completed" : "pending", detail: result.promotionDecision || "No autonomous promotion in sandbox." }
    ],
    executedDecisions: [
      { id: "target-selection", label: "System target selected", value: "plutonix", reason: "The user selected the platform system target instead of a managed project." },
      { id: "proposal-gate", label: "Proposal before implementation", value: result.proposalId || "pending", reason: "Platform source changes require evidence-backed proposal and isolation." }
    ],
    rejectedPaths: [
      { id: "managed-project-target", reason: "Rejected because this instruction targets the PlutoniX platform, not a generated project." },
      { id: "live-source-rewrite", reason: "Rejected because self-improvement must use proposal, isolation, validation, review, and rollback gates." }
    ],
    nextRecommendation: result.proposalId
      ? "Review the proposal, candidate status, validation, and promotion decision in Self-Improvement."
      : "Wait for the self-improvement control plane to finish proposal creation."
  };
}

async function handleSystemImprovementRequest(_req, res, { parsed, executionMode = "direct", user, executionStartedAt } = {}) {
  const workflowMode = normalizeGothamWorkflowMode(parsed.data.workflowMode || "executor");
  const activeExecutionKey = gothamExecutionKey(user, "system:plutonix");
  if (activeGothamExecutions.has(activeExecutionKey)) {
    return res.status(409).json({
      status: "running",
      error: "A system improvement instruction is already running. Stop it before starting another system instruction."
    });
  }
  activeGothamExecutions.set(activeExecutionKey, {
    controller: new AbortController(),
    parentWorkflowId: activeExecutionKey,
    projectId: "system:plutonix",
    executionMode,
    startedAt: executionStartedAt.toISOString()
  });
  try {
    event("gotham-system-target-selected", "Gotham Chat target is PlutoniX System", {
      stage: "1/5",
      executionMode,
      workflowMode,
      target: { type: "system", systemId: "plutonix" }
    });
    event("self-improvement-proposal-required", "System target requires an ImprovementProposal before code changes", {
      stage: "2/5",
      target: { type: "system", systemId: "plutonix" }
    });
    const cycle = await selfImprovementControlPlane.handleSystemInstruction({
      instruction: formatGothamModeInstruction(parsed.data.instruction, parsed.data.taskType || "Medium", workflowMode),
      taskType: parsed.data.taskType || "Medium",
      workflowMode,
      user
    });
    const flowPath = systemImprovementFlowPath({
      instruction: parsed.data.instruction,
      taskType: parsed.data.taskType || "Medium",
      workflowMode,
      cycle
    });
    const proposalId = cycle.results?.[0]?.proposalId || "";
    event("self-improvement-proposal-created", proposalId ? `System improvement proposal ${proposalId} is staged` : "System improvement cycle completed without a proposal", {
      stage: "3/5",
      target: { type: "system", systemId: "plutonix" },
      proposalId,
      cycleId: cycle.id,
      mode: cycle.mode
    });
    return res.json({
      status: cycle.status === "completed" ? "succeeded" : cycle.status,
      buildId: proposalId || cycle.id,
      files: [],
      fileOperations: [],
      target: { type: "system", systemId: "plutonix" },
      flowPath,
      selfImprovement: {
        cycleId: cycle.id,
        mode: cycle.mode,
        summary: cycle.summary,
        results: cycle.results || []
      },
      executionMode
    });
  } catch (error) {
    event("self-improvement-system-target-failed", error.message, {
      stage: "failed",
      target: { type: "system", systemId: "plutonix" }
    });
    return res.status(500).json({
      status: "failed",
      error: error.message,
      target: { type: "system", systemId: "plutonix" },
      flowPath: systemImprovementFlowPath({ instruction: parsed.data.instruction, taskType: parsed.data.taskType || "Medium" })
    });
  } finally {
    activeGothamExecutions.delete(activeExecutionKey);
    scheduleIdleVectorSync("system-workflow-idle");
  }
}

async function handleGenerateRequest(req, res, { executionMode = "direct" } = {}) {
  const user = userFromRequest(req);
  const executionStartedAt = new Date();
  const parsed = GenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: `Instruction must be between 12 and ${MAX_INSTRUCTION_CHARS} characters.`
    });
  }

  if (rejectRestrictedIntent(res, parsed.data.instruction)) return;
  const requestIntent = inferGothamRequestIntent({
    instruction: parsed.data.instruction,
    workflowMode: parsed.data.workflowMode,
    taskType: parsed.data.taskType
  });
  const workflowMode = requestIntent.workflowMode;
  const taskType = requestIntent.taskType;
  const modelRouting = localModelRoutingForTask({
    taskType,
    workflowMode,
    target: parsed.data.target?.type === "system" ? "system" : "project",
    instruction: parsed.data.instruction
  });
  const hfModelPreparation = await huggingFaceModelPool.prepareFromInstruction({
    instruction: parsed.data.instruction,
    autoDownload: String(process.env.PLUTONIX_HF_AUTO_DOWNLOAD || "1") === "1"
  });
  if (parsed.data.target?.type === "system") {
    return handleSystemImprovementRequest(req, res, { parsed, executionMode, user, executionStartedAt });
  }
  const selectedProject = await getProject(parsed.data.target?.projectId || parsed.data.projectId, { user });
  if ((!selectedProject || selectedProject.isDefault) && workflowMode !== "planner") {
    const requestPreflight = analyzeRealDataNeed({
      instruction: parsed.data.instruction,
      projectName: selectedProject?.name || "PlutoniX default workspace",
      mediaIds: parsed.data.mediaIds,
      suppliedData: requiredDataValues(parsed.data.requiredData)
    });
    if (requestPreflight.status === "needs_input") {
      return res.status(409).json({
        status: "needs_input",
        error: requestPreflight.message,
        ...requestPreflight
      });
    }
  }
  const media = (selectedProject?.media || []).filter((item) => !parsed.data.mediaIds?.length || parsed.data.mediaIds.includes(item.id));
  const instructionWithMedia = media.length
    ? `${parsed.data.instruction}\n\nUploaded media available to use:\n${media.map((item) => `- ${item.name}: ${item.path}`).join("\n")}`
    : parsed.data.instruction;
  const useProjectOrchestrator = Boolean(selectedProject && !selectedProject.isDefault);
  const orchestratorInstruction = formatGothamModeInstruction(instructionWithMedia, taskType, workflowMode);
  const orchestrated = useProjectOrchestrator
    ? {
        structuredRequest: {
          orchestrator: "plutonix-fullstack-agent",
          sourceInstruction: orchestratorInstruction,
          rawTextBoxInstruction: parsed.data.instruction,
          executionInstructionFormat: "plutonix-delegated-project-task",
          objective: `Execute the selected project task directly inside ${selectedProject.name}.`,
          pageType: "child_project_direct_task",
          productDecision: classifyProductShape({
            instruction: parsed.data.instruction,
            projectName: selectedProject.name,
            existingProject: true
          }),
          topic: selectedProject.name,
          sections: ["direct-task"],
          constraints: [
            "Use the child project's AGENTS.md, ROOT_WORKSPACE_GENERATION_POLICY.md, and .agentic/orchestrator-agent.md as scoped execution context under PlutoniX authority.",
            "Apply the narrowest complete change requested by the task.",
            "Preserve unrelated existing features, behavior, content, styling, and data.",
            "Use only real integration data, uploaded references, selected UI references, or user-provided content for business records, media details, financials, metrics, profiles, products, orders, messages, and analytics.",
            "When real backend or integration data is unavailable, render explicit empty/loading/placeholder states or TODO configuration hooks instead of invented data.",
            "Do not add visible explanations about how to use the generated app, mobile app, tool, flyer, or media artifact unless the user requested them; keep necessary hints in labels, tooltips, or a compact manual surface."
          ],
          handoff: {
            target: "child-project.orchestrator-agent",
            workspaceDir: selectedProject.workspaceDir,
            restartRequired: true
          },
          fileOperations: []
        },
        codexInstruction: orchestratorInstruction
      }
    : orchestrateBuilderInstruction(instructionWithMedia);
  const intelExpansion = normalizeIntelExpansionContract(parsed.data.intel, {
    projectName: selectedProject?.name || "PlutoniX default workspace"
  });
  if (intelExpansion.enabled && (!selectedProject || selectedProject.isDefault)) {
    const error = "PlutoniX Intel runs only on a selected user project. Select a project before starting an Intel workflow.";
    event("intel-workflow-failed", error, {
      stage: "1/8",
      projectId: selectedProject?.id || null,
      projectName: selectedProject?.name || "PlutoniX default workspace",
      retryable: false
    });
    return res.status(422).json({
      status: "needs_project_selection",
      error,
      executionMode,
      workflowMode
    });
  }
  if (parsed.data.intel?.enabled && !intelExpansion.enabled) {
    event("gotham-intel-disabled", "Intel expansion was requested but did not pass normalization", {
      projectId: selectedProject?.id || null,
      projectName: selectedProject?.name || "PlutoniX default workspace"
    });
  }
  if (requestIntent.inferredBugFix) {
    event("gotham-debugger-inferred", "Gotham recognized a pasted error and switched to Debugger mode", {
      stage: "1/8",
      reason: requestIntent.reason,
      taskType,
      workflowMode,
      projectId: selectedProject?.id || null,
      projectName: selectedProject?.name || "PlutoniX default workspace"
    });
  }
  orchestrated.structuredRequest.media = media;
  orchestrated.structuredRequest.inputSources = [
    ...(parsed.data.requiredData || []).map((item) => ({ ...item, sourceType: "required_data" })),
    ...media.map((item) => ({ id: item.id, label: item.name, value: item.path, sourceType: "media" }))
  ];
  orchestrated.structuredRequest.workflowMode = workflowMode;
  orchestrated.structuredRequest.intelExpansion = intelExpansion;
  orchestrated.structuredRequest.taskType = taskType;
  orchestrated.structuredRequest.modelRouting = modelRouting;
  orchestrated.structuredRequest.huggingFaceModelPool = hfModelPreparation;
  orchestrated.structuredRequest.intentInference = requestIntent.inferredBugFix
    ? { kind: "bug_fix", reason: requestIntent.reason }
    : { kind: "standard", reason: requestIntent.reason };
  orchestrated.structuredRequest.rawTextBoxInstruction = parsed.data.instruction;
  orchestrated.structuredRequest.executionInstructionFormat = useProjectOrchestrator
    ? "plutonix-delegated-project-task"
    : "plutonix-default";
  orchestrated.structuredRequest.project = selectedProject
    ? {
        id: selectedProject.id,
        name: selectedProject.name,
        port: selectedProject.port,
        previewUrl: selectedProject.previewUrl,
        workspaceDir: selectedProject.workspaceDir
      }
    : null;
  const intelProfileSelection = intelExpansion.enabled
    ? selectIntelProfile({
        instruction: parsed.data.instruction,
        productDecision: orchestrated.structuredRequest.productDecision,
        explicitProfileId: parsed.data.intel?.profileId || "",
        existingProjectMetadata: selectedProject
          ? {
              productDecision: selectedProject.productDecision || null,
              artifactType: selectedProject.productDecision?.artifactType || "",
              hasBrowserRuntime: Boolean(selectedProject.previewUrl),
              hasBackendInterface: Boolean(selectedProject.backendInterface?.available)
            }
          : {}
      })
    : null;
  if (intelProfileSelection) {
    orchestrated.structuredRequest.intelProfileSelection = intelProfileSelection;
    orchestrated.structuredRequest.intelProfile = intelProfileSummary(intelProfileSelection);
  }
  event("product-shape-selected", `PlutoniX selected ${orchestrated.structuredRequest.productDecision?.productShape || "existing product change"}`, {
    projectId: selectedProject?.id || null,
    projectName: selectedProject?.name || "PlutoniX default workspace",
    productDecision: orchestrated.structuredRequest.productDecision || null
  });
  if (intelExpansion.enabled) {
    event("intel-profile-detection-started", "Intel is evaluating Product Shape, intent, and project metadata.", {
      stage: "1/8",
      projectId: selectedProject?.id || null,
      projectName: selectedProject?.name || "PlutoniX default workspace",
      intelProfileSelection
    });
    if (intelProfileSelection.status === "selected") {
      event("intel-profile-selected", `Intel selected ${intelProfileSelection.profile.displayName} with ${intelProfileSelection.confidence}% confidence.`, {
        stage: "1/8",
        projectId: selectedProject?.id || null,
        profile: intelProfileSummary(intelProfileSelection),
        intelProfileSelection
      });
    } else {
      event("intel-profile-unsupported", intelProfileSelection.clarification || intelProfileSelection.failureReason || "Intel needs a supported project type profile.", {
        stage: "1/8",
        projectId: selectedProject?.id || null,
        profile: intelProfileSummary(intelProfileSelection),
        intelProfileSelection
      });
      const flowPath = intelSelectionFlowPath({
        projectName: selectedProject?.name || "PlutoniX default workspace",
        taskType,
        workflowMode,
        selection: intelProfileSelection,
        productDecision: orchestrated.structuredRequest.productDecision
      });
      persistProjectInstruction({
        projectId: selectedProject?.id || "",
        projectName: selectedProject?.name || "PlutoniX default workspace",
        taskType,
        workflowMode,
        instruction: parsed.data.instruction,
        status: intelProfileSelection.status,
        startedAt: executionStartedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - executionStartedAt.getTime(),
        flowPath,
        changedFiles: []
      });
      return res.status(422).json({
        status: intelProfileSelection.status,
        error: intelProfileSelection.clarification || intelProfileSelection.failureReason || "Intel profile selection did not produce a supported execution profile.",
        intelProfileSelection,
        orchestrated: orchestrated.structuredRequest,
        flowPath,
        executionMode,
        workflowMode
      });
    }
  }
  if (hfModelPreparation.intent?.requested || modelRouting.enforceLocalHuggingFace) {
    event("huggingface-model-routing-selected", "PlutoniX selected local Hugging Face model-pool routing metadata", {
      stage: "1/8",
      taskType,
      workflowMode,
      modelRouting,
      huggingFaceIntent: hfModelPreparation.intent,
      huggingFaceActions: hfModelPreparation.actions?.map((action) => ({
        repoId: action.repoId,
        status: action.status,
        localDir: action.localDir,
        serviceId: action.serviceId || "",
        sizeGb: action.sizeGb ?? null,
        sizeLabel: action.sizeLabel || "unknown size"
      })) || []
    });
  }
  if (workflowMode === "planner") {
    const plan = createPlannerSuggestion({
      instruction: parsed.data.instruction,
      taskType,
      project: selectedProject,
      orchestrated,
      useProjectOrchestrator
    });
    const plannerAgents = [
      {
        id: "plutonix-fullstack-agent",
        name: "PlutoniX Fullstack Agent",
        role: "Planner",
        status: "completed",
        action: "Prepared the implementation approach without modifying files."
      }
    ];
    const plannerActions = (plan.likelyFiles || []).map((item, index) => ({
      id: `planner-target-${index + 1}`,
      type: "inspect",
      label: String(item),
      target: String(item),
      reason: "Likely file or area to inspect during execution.",
      status: "planned"
    }));
    const flowPath = {
      status: "planned",
      selectedPath: "gotham-planner",
      confidence: 86,
      deterministic: true,
      projectName: selectedProject?.name || "PlutoniX default workspace",
      taskType,
      workflowMode,
      summary: plan.summary,
      activeAgents: plannerAgents,
      featureActions: plannerActions,
      functionalityGraph: buildFunctionalityGraph({
        projectId: selectedProject?.id || "",
        projectName: selectedProject?.name || "PlutoniX default workspace",
        structuredRequest: orchestrated.structuredRequest,
        actions: plannerActions,
        activeAgents: plannerAgents,
        status: "planned"
      }),
      nodes: [
        { id: "planner-intake", label: "Planner intake", state: "completed", detail: "Instruction classified for planning only." },
        { id: "approach", label: "Approach", state: "completed", detail: plan.approach.join(" ") },
        { id: "debug-route", label: "Debug route", state: "planned", detail: plan.debuggingApproach.join(" ") },
        { id: "execution-handoff", label: "Execution handoff", state: "pending", detail: plan.nextInstruction }
      ],
      executedDecisions: [
        { id: "gotham-mode", label: "Gotham mode", value: "planner", reason: "Planner suggests approach and does not modify files." }
      ],
      evidence: ["No file changes performed in Planner mode.", ...plan.validationPlan],
      nextRecommendation: plan.nextInstruction,
      plan
    };
    event("gotham-planner-complete", "Gotham Planner prepared an approach without changing files", {
      stage: "planner",
      executionMode,
      workflowMode,
      projectId: selectedProject?.id || null,
      projectName: selectedProject?.name || "PlutoniX default workspace",
      taskType
    });
    persistProjectInstruction({
      projectId: selectedProject?.id || "",
      projectName: selectedProject?.name || "PlutoniX default workspace",
      taskType,
      workflowMode,
      instruction: parsed.data.instruction,
      status: "planned",
      startedAt: executionStartedAt.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - executionStartedAt.getTime(),
      requiredData: parsed.data.requiredData || [],
      flowPath,
      changedFiles: []
    });
    return res.json({
      status: "planned",
      buildId: `planner_${Date.now()}`,
      files: [],
      fileOperations: [],
      orchestrated: orchestrated.structuredRequest,
      flowPath,
      plan,
      executionMode,
      workflowMode
    });
  }
  const orchestrationEnvelope = await createPlutoniXOrchestrationEnvelope({
    instruction: instructionWithMedia,
    taskType,
    project: selectedProject,
    structuredRequest: orchestrated.structuredRequest
  });
  const adaptiveRoute = selectAdaptiveRoute({
    instruction: instructionWithMedia,
    taskType,
    project: selectedProject,
    productDecision: orchestrated.structuredRequest.productDecision
  });
  if (intelProfileSelection?.status === "selected") {
    // Profile-driven Intel always verifies a successful write independently.
    // Intel invokes this itself so it can perform one profile-bounded repair only
    // after an actionable read-only verifier failure.
    adaptiveRoute.requiresIndependentReview = false;
    adaptiveRoute.reviewerAgentId = "intel-verification-agent";
    adaptiveRoute.mode = adaptiveRoute.mode === "single" ? "delegated_reviewed" : adaptiveRoute.mode;
    adaptiveRoute.plannedModelCalls = Math.max(2, adaptiveRoute.plannedModelCalls || 0);
  }
  if (adaptiveRoute.mode === "single") {
    orchestrationEnvelope.delegations = [];
    orchestrationEnvelope.childExecutionIds = [];
  }
  orchestrationEnvelope.adaptiveRoute = adaptiveRoute;
  orchestrated.structuredRequest.orchestrationEnvelope = orchestrationEnvelope;
  const activeExecutionKey = gothamExecutionKey(user, selectedProject?.id || "");
  if (activeGothamExecutions.has(activeExecutionKey)) {
    return res.status(409).json({
      status: "running",
      error: "A Gotham instruction is already running for this project. Stop it before starting another instruction."
    });
  }
  const activeExecution = {
    controller: new AbortController(),
    parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
    projectId: selectedProject?.id || "",
    executionMode,
    startedAt: executionStartedAt.toISOString()
  };
  activeGothamExecutions.set(activeExecutionKey, activeExecution);
  const cleanupUsedMedia = async (consumedMediaIds = []) => {
    if (!selectedProject || selectedProject.isDefault || !media.length) return null;
    const consumed = new Set(consumedMediaIds);
    const removableMedia = media.filter((item) => item.purpose !== "app-icon" && consumed.has(item.id));
    if (!removableMedia.length) return null;
    const cleanup = await removeProjectMedia(selectedProject, removableMedia.map((item) => item.id));
    event("gotham-reference-files-cleared", `Removed ${cleanup.removed.length} uploaded reference file${cleanup.removed.length === 1 ? "" : "s"} after Gotham execution`, {
      projectId: selectedProject.id,
      removedMedia: cleanup.removed.map((item) => ({ id: item.id, name: item.name, path: item.path }))
    });
    return cleanup;
  };
  event("plutonix-start", "PlutoniX accepted global orchestration authority", {
    stage: "2/8",
    executionMode,
    workflowMode,
    parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
    projectId: selectedProject?.id || null
  });
  event(executionMode === "mcp" ? "gotham-mcp-route-selected" : "gotham-direct-route-selected", executionMode === "mcp" ? "Gotham Chat will execute through the local MCP server" : "Gotham Chat will execute through the direct current workflow", {
    stage: "2/8",
    executionMode,
    workflowMode,
    mcpServer: executionMode === "mcp" ? localGothamMcpServer.status() : null,
    parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
    projectId: selectedProject?.id || null
  });
  event("adaptive-route-selected", `PlutoniX selected ${adaptiveRoute.mode}`, {
    parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
    projectId: selectedProject?.id || null,
    projectName: selectedProject?.name || "PlutoniX default workspace",
    adaptiveRoute
  });
  event("orchestrator-prompt", useProjectOrchestrator ? orchestratorInstruction : formatGothamModeInstruction(instructionWithMedia, taskType, workflowMode), {
    stage: "2/8",
    projectId: selectedProject?.id || null,
    projectName: selectedProject?.name || "PlutoniX default workspace",
    taskType,
    workflowMode,
    promptTarget: "plutonix-fullstack-agent",
    instructionFormat: "Task Type / Gotham Mode / Task"
  });
  if (orchestrationEnvelope.delegations.length) {
    event("delegation-start", `PlutoniX delegated bounded project execution to ${orchestrationEnvelope.delegations[0].agentId}`, {
      stage: "2/8",
      projectId: selectedProject.id,
      taskType,
      workflowMode,
      instructionFormat: "Task type / Gotham mode / task",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      childExecutionId: orchestrationEnvelope.delegations[0].executionId,
      agentId: orchestrationEnvelope.delegations[0].agentId
    });
  }
  event("request-received", "Gotham MCP workflow request received", { stage: "1/8" });
  if (useProjectOrchestrator) {
    event("plutonix-delegation", `${selectedProject.name} is executing a PlutoniX-owned task`, {
      stage: "3/8",
      projectId: selectedProject.id,
      workspaceDir: selectedProject.workspaceDir,
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId
    });
  } else {
    event("orchestrated", `Instruction restructured for ${orchestrated.structuredRequest.pageType}`, {
      stage: "3/8",
      objective: orchestrated.structuredRequest.objective,
      topic: orchestrated.structuredRequest.topic,
      sections: orchestrated.structuredRequest.sections
    });
    event("file-plan", `Orchestrator planned ${orchestrated.structuredRequest.fileOperations.length} file operations`, {
      stage: "4/8",
      fileOperations: orchestrated.structuredRequest.fileOperations
    });
    for (const [index, operation] of orchestrated.structuredRequest.fileOperations.entries()) {
      event("file-plan-item", `${index + 1}. ${operation.action.toUpperCase()} ${operation.path}`, {
        stage: "4/8",
        action: operation.action,
        path: operation.path,
        reason: operation.reason
      });
    }
  }
  const adaptiveExecutionAgentId = adaptiveRoute.executionAgent === "project-orchestrator" && orchestrationEnvelope.delegations[0]
    ? orchestrationEnvelope.delegations[0].agentId
    : "plutonix-fullstack-agent";
  event("generating", "Preparing Gotham CLI execution; secure workspace preflight must pass before the provider starts.", {
    stage: "5/8",
    agentId: adaptiveExecutionAgentId,
    parentWorkflowId: orchestrationEnvelope.parentWorkflowId
  });
  let result = null;
  let intelRuntime = null;
  try {
    if (intelProfileSelection?.status === "selected") {
      const configuredIntelWorkspace = selectedProject?.workspaceDir || process.env.GENERATED_SITE_DIR || path.resolve(process.cwd(), "../generated-site");
      const managedIntelRoot = process.env.PROJECTS_ROOT || path.dirname(configuredIntelWorkspace);
      const intelWorkspaceDir = selectedProject
        ? await assertIntelWorkspaceWithinRoot(configuredIntelWorkspace, managedIntelRoot)
        : configuredIntelWorkspace;
      intelRuntime = await prepareIntelWorkflow({
        profileSelection: intelProfileSelection,
        instruction: instructionWithMedia,
        productDecision: orchestrated.structuredRequest.productDecision,
        projectId: selectedProject?.id || "",
        projectName: selectedProject?.name || "PlutoniX default workspace",
        workspaceDir: intelWorkspaceDir,
        workflowId: orchestrationEnvelope.parentWorkflowId,
        emit: event,
        signal: activeExecution.controller.signal
      });
      orchestrated.structuredRequest.intelRuntime = intelRuntime;
      event("intel-implementation-started", "Intel accepted proposals and is starting the single workspace writer.", {
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        profile: intelRuntime.profile,
        acceptedProposalIds: intelRuntime.acceptedProposals.map((proposal) => proposal.id)
      });
    }
    const workflowOptions = {
      emit: event,
      generatedSiteDir: selectedProject?.workspaceDir,
      agentId: "plutonix-fullstack-agent",
      agentName: "PlutoniX Fullstack Agent",
      projectId: selectedProject?.id || "",
      projectName: selectedProject?.name || "PlutoniX default workspace",
      taskType,
      workflowMode,
      signal: activeExecution.controller.signal
    };
    result = executionMode === "mcp"
      ? await localGothamMcpServer.callTool("gotham.generate", {
          orchestratedRequest: orchestrated.structuredRequest,
          options: workflowOptions,
          orchestrationEnvelope,
          adaptiveRoute
        })
      : await runPlutoniXOwnedWorkflow(orchestrated.structuredRequest, workflowOptions, orchestrationEnvelope, adaptiveRoute);
    if (intelRuntime) {
      recordIntelImplementation(intelRuntime, result);
      const profileOutputValidation = await validateIntelProfileOutput({
        profile: intelProfileSelection.profile,
        workspaceDir: workflowOptions.generatedSiteDir || process.env.GENERATED_SITE_DIR || path.resolve(process.cwd(), "../generated-site"),
        changedFiles: result.files || []
      });
      intelRuntime.validationResults.push(...profileOutputValidation.checks);
      event("intel-artifact-created", `Intel writer changed ${(result.files || []).length} file${(result.files || []).length === 1 ? "" : "s"}.`, {
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        profile: intelRuntime.profile,
        changedFiles: result.files || []
      });
      event("intel-validation-started", "Intel is applying profile-specific output validation.", {
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        validationResults: intelRuntime.validationResults
      });
      const failedProfileValidation = intelRuntime.validationResults.filter((validation) => validation.status === "failed");
      if (failedProfileValidation.length) {
        throw new Error(`Intel ${intelRuntime.profile.displayName} validation failed: ${failedProfileValidation.map((validation) => validation.detail).join(" ")}`);
      }
      const verifiedIntel = await verifyIntelWithBoundedRepair({
        runtime: intelRuntime,
        orchestratedRequest: orchestrated.structuredRequest,
        result,
        profile: intelProfileSelection.profile,
        workspaceDir: workflowOptions.generatedSiteDir || process.env.GENERATED_SITE_DIR || path.resolve(process.cwd(), "../generated-site"),
        projectId: selectedProject?.id || "",
        projectName: selectedProject?.name || "PlutoniX default workspace",
        taskType,
        signal: activeExecution.controller.signal,
        emit: event
      });
      result = { ...verifiedIntel.result, review: verifiedIntel.review };
      recordIntelVerification(intelRuntime, verifiedIntel.review);
      if (intelRuntime.status !== "completed") {
        throw new Error("Intel verification did not produce a complete profile-validated result.");
      }
    }
    const completedAt = new Date();
    for (const delegation of orchestrationEnvelope.delegations) {
      event("delegation-complete", `${delegation.agentId} completed its bounded execution`, {
        stage: "6/8",
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        childExecutionId: delegation.executionId,
        agentId: delegation.agentId,
        changedFiles: result.files
      });
    }
    event("plutonix-validation", "PlutoniX accepted generated-file validation evidence", {
      stage: "7/8",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      status: "passed",
      changedFiles: result.files,
      productShapeValidation: result.productShapeValidation,
      inputConsumption: result.inputConsumption
    });
    event("files-applied", `Gotham changed ${result.files.length} generated app files`, {
      stage: "6/8",
      agentId: result.tokenUsage?.agentId || adaptiveExecutionAgentId,
      fileOperations: result.fileOperations
    });
    event("runtime-refresh-requested", "Refreshing generated-site runtime after file operations", { stage: "7/8" });
    const restart = selectedProject && !selectedProject.isDefault
      ? (event("project-runtime-handoff", "Gotham file generation complete; PlutoniX is assigning the playground port", {
          stage: "7/8",
          projectId: selectedProject.id,
          workspaceDir: selectedProject.workspaceDir
        }),
        await ensureProjectPreviewWithRuntimeRecovery(selectedProject, { emit: event, source: "gotham-workflow" }).then((readyProject) => ({
          status: readyProject.runtime?.status || "project-server",
          container: readyProject.containerName,
          reason: `Project container is live on port ${readyProject.port}.`,
          project: readyProject
        })))
      : await restartGeneratedRuntime();
    event(restart.status === "restarted" ? "restarted" : "hot-reload", restart.reason || `Restarted ${restart.container}`, {
      stage: "7/8",
      restart
    });
    event("generated", `Generated ${result.files.length} files`, {
      stage: "8/8",
      buildId: result.buildId
    });
    const flowPath = gothamInstructionFlowPath({
      projectName: selectedProject?.name || "PlutoniX default workspace",
      taskType,
      workflowMode,
      orchestrated,
      result,
      useProjectOrchestrator
    });
    persistWhatNextKnowledge(flowPath, {
      source: "plutonix-gotham-chat",
      projectId: selectedProject?.id || "",
      projectName: selectedProject?.name || "PlutoniX default workspace",
      instructionSummary: parsed.data.instruction,
      changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || []
    });
    persistProjectInstruction({
      projectId: selectedProject?.id || "",
      projectName: selectedProject?.name || "PlutoniX default workspace",
      taskType,
      workflowMode,
      instruction: parsed.data.instruction,
      status: "succeeded",
      buildId: result.buildId,
      parentWorkflowId: result.parentWorkflowId,
      childExecutionIds: result.childExecutionIds,
      adaptiveRoute: result.adaptiveRoute,
      review: result.review,
      workflowRecovery: result.workflowRecovery || null,
      selectedModel: result.runtime?.selectedModel || result.workflowRecovery?.fallbackModel || "",
      replayParentId: result.workflowRecovery?.replayParentId || "",
      replayStatus: result.workflowRecovery?.replayStatus || "",
      requiredData: parsed.data.requiredData || [],
      startedAt: executionStartedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - executionStartedAt.getTime(),
      flowPath,
      orchestrationSnapshot: createOrchestrationBuildSnapshot({
        projectId: selectedProject?.id || "",
        projectName: selectedProject?.name || "PlutoniX default workspace",
        instruction: parsed.data.instruction,
        taskType,
        status: "succeeded",
        buildId: result.buildId,
        parentWorkflowId: result.parentWorkflowId,
        childExecutionIds: result.childExecutionIds,
        flowPath,
        changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || []
      }),
      changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || []
    });
    event("plutonix-complete", "PlutoniX approved workflow completion", {
      stage: "8/8",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      childExecutionIds: orchestrationEnvelope.childExecutionIds,
      buildId: result.buildId
    });
    if (result.inputConsumption?.status === "retained_for_clarification") {
      event("gotham-required-data-retained", "Required data or media remains available because Gotham did not provide complete consumption evidence", {
        projectId: selectedProject?.id || "",
        unresolvedInputIds: result.inputConsumption.unresolvedInputIds
      });
    }
    const mediaCleanup = await cleanupUsedMedia(result.inputConsumption?.consumedMediaIds || []).catch((cleanupError) => {
      event("gotham-reference-files-clear-failed", cleanupError.message, {
        projectId: selectedProject?.id || ""
      });
      return null;
    });
    return res.json({ ...result, restart, orchestrated: orchestrated.structuredRequest, flowPath, mediaCleanup, executionMode, workflowMode });
  } catch (error) {
    if (intelRuntime) {
      const cancelled = activeExecution.controller.signal.aborted || /stopped by the user|cancelled/i.test(error.message);
      recordIntelFailure(intelRuntime, error, { cancelled, repairStarted: false });
      orchestrated.structuredRequest.intelRuntime = intelRuntime;
      event(cancelled ? "intel-workflow-cancelled" : "intel-workflow-failed", error.message, {
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        profile: intelRuntime.profile,
        retryable: intelRuntime.failure?.retryable || false
      });
    }
    if (!intelRuntime) {
    try {
      const repairOutcome = await attemptAutomaticRepairAfterFailure({
        orchestratedRequest: orchestrated.structuredRequest,
        project: selectedProject,
        error,
        result,
        taskType,
        source: `gotham-chat-${executionMode}`,
        signal: activeExecution.controller.signal
      });
      if (repairOutcome) {
        const completedAt = new Date();
        const repairedResult = repairOutcome.result;
        const flowPath = gothamInstructionFlowPath({
          projectName: selectedProject?.name || "PlutoniX default workspace",
          taskType,
          workflowMode,
          orchestrated,
          result: repairedResult,
          useProjectOrchestrator
        });
        persistWhatNextKnowledge(flowPath, {
          source: "plutonix-gotham-chat",
          projectId: selectedProject?.id || "",
          projectName: selectedProject?.name || "PlutoniX default workspace",
          instructionSummary: parsed.data.instruction,
          changedFiles: repairedResult.files || []
        });
        persistProjectInstruction({
          projectId: selectedProject?.id || "",
          projectName: selectedProject?.name || "PlutoniX default workspace",
          taskType,
          workflowMode,
          instruction: parsed.data.instruction,
          status: "succeeded",
          buildId: repairedResult.buildId,
          parentWorkflowId: repairedResult.parentWorkflowId,
          childExecutionIds: repairedResult.childExecutionIds,
          adaptiveRoute: repairedResult.adaptiveRoute,
          repair: repairOutcome.repair,
          requiredData: parsed.data.requiredData || [],
          startedAt: executionStartedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - executionStartedAt.getTime(),
          flowPath,
          orchestrationSnapshot: createOrchestrationBuildSnapshot({
            projectId: selectedProject?.id || "",
            projectName: selectedProject?.name || "PlutoniX default workspace",
            instruction: parsed.data.instruction,
            taskType,
            status: "succeeded",
            buildId: repairedResult.buildId,
            parentWorkflowId: repairedResult.parentWorkflowId,
            childExecutionIds: repairedResult.childExecutionIds,
            flowPath,
            changedFiles: repairedResult.files || []
          }),
          changedFiles: repairedResult.files || []
        });
        event("plutonix-complete", "PlutoniX approved workflow completion after automatic repair", {
          stage: "8/8",
          parentWorkflowId: repairedResult.parentWorkflowId,
          childExecutionIds: repairedResult.childExecutionIds,
          buildId: repairedResult.buildId,
          repairId: repairOutcome.repair.repairId
        });
        const mediaCleanup = await cleanupUsedMedia().catch((cleanupError) => {
          event("gotham-reference-files-clear-failed", cleanupError.message, {
            projectId: selectedProject?.id || ""
          });
          return null;
        });
        return res.json({
          ...repairedResult,
          repaired: true,
          restart: repairOutcome.restart,
          orchestrated: orchestrated.structuredRequest,
          flowPath,
          mediaCleanup,
          executionMode,
          workflowMode,
          repair: repairOutcome.repair
        });
      }
    } catch (repairError) {
      event("plutonix-repair-failed", repairError.message, {
        projectId: selectedProject?.id || "",
        projectName: selectedProject?.name || "PlutoniX default workspace",
        originalError: error.message
      });
    }
    }
    const completedAt = new Date();
    event("plutonix-validation", "PlutoniX rejected completion because execution or validation failed", {
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      childExecutionIds: orchestrationEnvelope.childExecutionIds,
      status: "failed",
      error: error.message
    });
    event("error", error.message);
    const flowPath = gothamInstructionFlowPath({
      projectName: selectedProject?.name || "PlutoniX default workspace",
      taskType,
      workflowMode,
      orchestrated,
      status: "failed",
      error: error.message,
      useProjectOrchestrator
    });
    persistWhatNextKnowledge(flowPath, {
      source: "plutonix-gotham-chat",
      projectId: selectedProject?.id || "",
      projectName: selectedProject?.name || "PlutoniX default workspace",
      instructionSummary: parsed.data.instruction,
      error: error.message
    });
    persistProjectInstruction({
      projectId: selectedProject?.id || "",
      projectName: selectedProject?.name || "PlutoniX default workspace",
      taskType,
      workflowMode,
      instruction: parsed.data.instruction,
      status: "failed",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      childExecutionIds: orchestrationEnvelope.childExecutionIds,
      adaptiveRoute: orchestrationEnvelope.adaptiveRoute,
      workflowRecovery: error.workflowRecovery || null,
      selectedModel: error.requestedModel || error.workflowRecovery?.fallbackModel || "",
      replayParentId: error.workflowRecovery?.replayParentId || "",
      replayStatus: error.workflowRecovery?.replayStatus || "",
      requiredData: parsed.data.requiredData || [],
      startedAt: executionStartedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - executionStartedAt.getTime(),
      flowPath,
      orchestrationSnapshot: createOrchestrationBuildSnapshot({
        projectId: selectedProject?.id || "",
        projectName: selectedProject?.name || "PlutoniX default workspace",
        instruction: parsed.data.instruction,
        taskType,
        status: "failed",
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        childExecutionIds: orchestrationEnvelope.childExecutionIds,
        flowPath,
        error: error.message
      }),
      error: error.message
    });
    const mediaCleanup = await cleanupUsedMedia().catch((cleanupError) => {
      event("gotham-reference-files-clear-failed", cleanupError.message, {
        projectId: selectedProject?.id || ""
      });
      return null;
    });
    return res.status(500).json({
      error: error.message,
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      childExecutionIds: orchestrationEnvelope.childExecutionIds,
      flowPath,
      mediaCleanup
    });
  } finally {
    activeGothamExecutions.delete(activeExecutionKey);
    scheduleIdleVectorSync("workflow-idle");
  }
}

app.post("/api/generate", (req, res) => handleGenerateRequest(req, res, { executionMode: "direct" }));

app.post("/api/generate/mcp", (req, res) => handleGenerateRequest(req, res, { executionMode: "mcp" }));

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.too.large" || err?.status === 413 || err?.statusCode === 413) {
    res.status(413).json({ status: "payload_too_large", error: "Request body exceeds the configured limit." });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ status: "invalid_request", error: "Malformed JSON request body." });
    return;
  }
  res.status(500).json({ status: "failed", error: "Unexpected server error" });
});

export async function closePlutonixServerResources() {
  if (decisionContinuityWorkflow?.pool) {
    await decisionContinuityWorkflow.pool.end();
    decisionContinuityWorkflow.pool = null;
  }
  if (decisionContinuityStore?.delegate?.pool) {
    await decisionContinuityStore.delegate.pool.end();
    decisionContinuityStore.delegate.pool = null;
  }
  if (identityAccessStore?.pool) {
    await identityAccessStore.pool.end();
    identityAccessStore.pool = null;
  }
}

export function startPlutonixServer({ listenPort = port, host = "0.0.0.0" } = {}) {
  return app.listen(listenPort, host, async () => {
  console.log(`PlutoniX backend listening on ${listenPort}`);
  try {
    await refreshGothamSandboxReadiness({ source: "backend-startup" });
  } catch (error) {
    gothamSandboxReadiness = {
      status: "unavailable",
      component: "workspace_sandbox",
      failureClass: "workspace_sandbox_unavailable",
      reason: "startup_probe_failed",
      diagnostic: error.message,
      remediation: "Verify the Codex workspace sandbox runtime before running Gotham workflows.",
      checkedAt: new Date().toISOString()
    };
    event("sandbox.preflight.failed", "Gotham startup could not verify the secure workspace sandbox; workflow execution will be blocked.", {
      stage: "preflight",
      source: "backend-startup",
      sandboxPreflight: gothamSandboxReadiness
    });
  }
  try {
    await selfImprovementControlPlane.start();
    if (selfImprovementStartupCycleEnabled()) {
      await selfImprovementControlPlane.runCycle({ reason: "service-startup" });
    }
  } catch (error) {
    console.error(`Failed to start self-improvement control plane: ${error.message}`);
  }
  orchestratorHealthMonitor.start();
  try {
    const projects = await startRegisteredProjects();
    const runningProjects = projects.filter((project) => !/stopped|not-found/i.test(project.runtime?.status || project.status || "stopped"));
    if (runningProjects.length) {
      console.log(`Started ${runningProjects.length} managed project preview server${runningProjects.length === 1 ? "" : "s"}.`);
    } else if (projects.length) {
      console.log(`Loaded ${projects.length} managed project${projects.length === 1 ? "" : "s"} in stopped state.`);
    }
  } catch (error) {
    console.error(`Failed to start managed project previews: ${error.message}`);
  }
  const syncIntervalMs = Number(process.env.AGENT_MEMORY_SYNC_INTERVAL_MS || 300000);
  setTimeout(() => scheduleIdleVectorSync("backend-startup"), 8000);
  setInterval(() => scheduleIdleVectorSync("periodic"), Math.max(60000, syncIntervalMs));
  });
}

if (process.env.PLUTONIX_SERVER_AUTOSTART !== "false") startPlutonixServer();
