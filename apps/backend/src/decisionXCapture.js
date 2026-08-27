import crypto from "node:crypto";

/**
 * DecisionX build capture is an observation bridge, not an autonomous
 * decision maker. It writes only decisions that the build workflow actually
 * selected or reported, and never changes a branch disposition.
 */
export const DECISIONX_BUILD_CAPTURE_VERSION = "decisionx-build-capture/v1";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function digest(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value || {})).digest("hex");
}

function boundedText(value, max = 1_800) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function boundedId(value, fallback) {
  const cleaned = String(value || "").replace(/[^A-Za-z0-9._:@/-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (cleaned || fallback).slice(0, 160);
}

function safeArray(value, max = 50) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function observedAlternatives(flowPath) {
  return safeArray(flowPath?.rejectedPaths)
    .map((item) => boundedId(item?.id, ""))
    .filter(Boolean);
}

function observedExecutionDecisions(flowPath) {
  return safeArray(flowPath?.executedDecisions)
    .map((item) => ({
      id: boundedId(item?.id, "observed-decision"),
      label: boundedText(item?.label, 160),
      value: boundedText(item?.value, 320),
      reason: boundedText(item?.reason, 800)
    }))
    .filter((item) => item.label || item.value || item.reason);
}

function publicRoute(routeResult) {
  const route = routeResult?.route || routeResult || null;
  if (!route || typeof route !== "object") return null;
  return {
    receiptId: boundedId(route.receiptId || route.id || "", "") || null,
    status: boundedText(route.status || routeResult?.status, 80),
    selectedRegistrationId: boundedId(route.selectedRegistrationId || route.selectedModelId || "", "") || null,
    selectedProvider: boundedText(route.selectedProvider || route.provider, 120),
    selectedModelId: boundedText(route.selectedModelId || route.modelId, 240),
    policySnapshotId: boundedId(route.policySnapshotId || route.policy?.id || "", "") || null,
    budgetReservationId: boundedId(route.budgetReservationId || route.reservationId || "", "") || null,
    failureCode: boundedText(route.failureCode || routeResult?.failureCode, 120),
    rationale: safeArray(route.rationale || route.reasonCodes, 20).map((item) => boundedText(item, 240)).filter(Boolean),
    excludedCandidates: safeArray(route.excludedCandidates, 50).map((candidate) => ({
      registrationId: boundedId(candidate?.registrationId || candidate?.id, "") || null,
      reasonCodes: safeArray(candidate?.reasonCodes, 20).map((reason) => boundedText(reason, 120)).filter(Boolean)
    }))
  };
}

export function buildDecisionXIdempotencyKey({ buildKey, phase, tenantId, workspaceId }) {
  const stableKey = boundedText(buildKey, 240) || digest({ tenantId, workspaceId, phase });
  return `decisionx:${phase}:${digest({ tenantId, workspaceId, stableKey }).slice(0, 48)}`;
}

export function observedDecisionXBranchInput({
  tenantId,
  workspaceId = "default",
  actor,
  project = null,
  instruction,
  workflow = {},
  routeResult = null,
  enterpriseDecisionContext = null,
  buildKey
} = {}) {
  const decisionId = boundedId(`build-${digest({ tenantId, workspaceId, buildKey, projectId: project?.id || "" }).slice(0, 40)}`, "build-decision");
  const correlationId = boundedId(workflow?.correlationId || workflow?.parentWorkflowId || buildKey || decisionId, decisionId);
  const route = publicRoute(routeResult);
  const observed = observedExecutionDecisions(workflow?.flowPath);
  const selectedPath = boundedText(workflow?.selectedPath || workflow?.flowPath?.selectedPath, 240);
  const proposedPath = boundedText(workflow?.proposedPath, 240);
  const evidence = [
    {
      id: boundedId(`build-request-${digest({ buildKey, instruction }).slice(0, 32)}`, "build-request"),
      type: "artifact",
      source: "plutonix.generate.request",
      observedAt: new Date().toISOString(),
      accessPolicy: "workspace",
      digest: digest({ instruction: boundedText(instruction, 4_000), projectId: project?.id || "", correlationId })
    }
  ];
  if (route?.receiptId) {
    evidence.push({
      id: boundedId(route.receiptId, "route-receipt"),
      type: "artifact",
      source: "brainx.aix.route",
      observedAt: new Date().toISOString(),
      accessPolicy: "workspace"
    });
  }
  const candidate = {
    captureVersion: DECISIONX_BUILD_CAPTURE_VERSION,
    captureKind: "observed_build_request",
    proposedPath: proposedPath || null,
    selectedPath: selectedPath || null,
    selectedRoute: route,
    observedDecisions: observed,
    deferredOrRejectedPaths: safeArray(workflow?.flowPath?.rejectedPaths, 50).map((item) => ({
      id: boundedId(item?.id, "observed-alternative"),
      reason: boundedText(item?.reason, 800),
      constraint: boundedText(item?.constraint, 320)
    }))
  };
  return {
    workspaceId,
    decisionId,
    objective: {
      summary: boundedText(instruction, 4_000),
      successCriteria: []
    },
    branchType: "implementation",
    origin: {
      source: "brainx",
      correlationId,
      requestId: boundedId(workflow?.requestId, "") || undefined,
      idempotencyKey: buildDecisionXIdempotencyKey({ buildKey: buildKey || correlationId, phase: "planned", tenantId, workspaceId })
    },
    candidate,
    assumptions: [],
    evidence,
    constraintSnapshot: route
      ? {
          routeStatus: route.status || null,
          policySnapshotId: route.policySnapshotId || null,
          budgetReservationId: route.budgetReservationId || null,
          failureCode: route.failureCode || null
        }
      : {},
    disposition: { alternativesConsidered: observedAlternatives(workflow?.flowPath) },
    producedBy: {
      agentId: boundedId(workflow?.agentId || "plutonix-fullstack-agent", "plutonix-fullstack-agent"),
      actorId: boundedId(actor?.id, "") || undefined,
      source: "plutonix.generate"
    },
    executionProvenance: {
      provider: route?.selectedProvider || undefined,
      modelId: route?.selectedModelId || undefined,
      modelRevision: boundedText(routeResult?.route?.immutableRevision, 240) || undefined,
      environment: boundedText(process.env.NODE_ENV || "development", 160)
    },
    enterpriseDecisionContext: enterpriseDecisionContext || undefined,
    expectedOutcome: { status: "requested", captureKind: "observed_build_request" },
    realizedOutcome: {}
  };
}

function pickGovernanceWriter(governance) {
  for (const name of ["recordDecisionContext", "recordEnterpriseDecisionContext", "recordBuildDecisionContext"]) {
    if (typeof governance?.[name] === "function") return governance[name].bind(governance);
  }
  return null;
}

/**
 * Calls are deliberately best-effort at the normal generation seam. A missing
 * enterprise configuration must never turn an existing non-governed build into
 * an outage; when a tenant explicitly enables governed AIX, that router blocks
 * before execution instead.
 */
export class DecisionXBuildCapture {
  constructor({ store, governance = null, enabled = true, logger = null } = {}) {
    if (!store) throw new Error("DecisionX build capture requires the existing Decision Continuity store.");
    this.store = store;
    this.governance = governance;
    this.enabled = enabled;
    this.logger = logger;
  }

  async capturePlanned(input = {}) {
    if (!this.enabled) return { status: "disabled", branch: null };
    if (!input.tenantId || !input.actor?.id) return { status: "skipped", reason: "strict_scope_unavailable", branch: null };
    const branchInput = observedDecisionXBranchInput(input);
    const branch = await this.store.createBranch(branchInput, {
      tenantId: input.tenantId,
      actor: input.actor
    });
    const writer = pickGovernanceWriter(this.governance);
    let contextReceipt = null;
    if (writer && branch.enterpriseDecisionContext) {
      contextReceipt = await writer({
        tenantId: input.tenantId,
        workspaceId: branch.workspaceId,
        branchId: branch.id,
        applicationId: branch.enterpriseDecisionContext.applicationId,
        enterpriseId: branch.enterpriseDecisionContext.enterpriseId || null,
        policySnapshotId: branch.enterpriseDecisionContext.policySnapshotId || null,
        budgetScopeId: branch.enterpriseDecisionContext.budgetScopeId || null,
        evidenceRefs: branch.enterpriseDecisionContext.evidenceRefs || [],
        stage: "planned",
        idempotencyKey: buildDecisionXIdempotencyKey({ buildKey: input.buildKey || branch.id, phase: "planned-context", tenantId: input.tenantId, workspaceId: branch.workspaceId })
      }, { tenantId: input.tenantId, workspaceId: branch.workspaceId, actor: input.actor });
    }
    return { status: "recorded", branch, contextReceipt };
  }

  async captureOutcome({ tenantId, workspaceId = "default", actor, branchId, buildKey, status, buildId, changedFiles = [], validation = {}, routeResult = null, error = "" } = {}) {
    if (!this.enabled) return { status: "disabled", branch: null };
    if (!tenantId || !actor?.id || !branchId) return { status: "skipped", reason: "strict_scope_unavailable", branch: null };
    const route = publicRoute(routeResult);
    const outcome = await this.store.recordBranchExecutionOutcome({
      branchId,
      status,
      buildId: boundedText(buildId, 240) || undefined,
      changedFiles: safeArray(changedFiles, 500).map((file) => boundedText(typeof file === "string" ? file : file?.path, 500)).filter(Boolean),
      validation: clone(validation || {}),
      modelRouteReceiptId: route?.receiptId || undefined,
      error: boundedText(error, 2_000) || undefined,
      completedAt: new Date().toISOString()
    }, { tenantId, workspaceId, actor });
    const writer = pickGovernanceWriter(this.governance);
    let contextReceipt = null;
    if (writer && outcome.enterpriseDecisionContext) {
      contextReceipt = await writer({
        tenantId,
        workspaceId,
        branchId,
        applicationId: outcome.enterpriseDecisionContext.applicationId,
        enterpriseId: outcome.enterpriseDecisionContext.enterpriseId || null,
        policySnapshotId: outcome.enterpriseDecisionContext.policySnapshotId || null,
        budgetScopeId: outcome.enterpriseDecisionContext.budgetScopeId || null,
        evidenceRefs: outcome.enterpriseDecisionContext.evidenceRefs || [],
        stage: "outcome",
        outcome: { status, buildId: boundedText(buildId, 240), routeReceiptId: route?.receiptId || null },
        idempotencyKey: buildDecisionXIdempotencyKey({ buildKey: buildKey || branchId, phase: "outcome", tenantId, workspaceId })
      }, { tenantId, workspaceId, actor });
    }
    return { status: "recorded", branch: outcome, contextReceipt };
  }

  async capturePlannedSafely(input) {
    try {
      return await this.capturePlanned(input);
    } catch (error) {
      this.logger?.("decisionx-build-capture-failed", error);
      return { status: "capture_failed", reason: boundedText(error?.code || error?.message, 240), branch: null };
    }
  }

  async captureOutcomeSafely(input) {
    try {
      return await this.captureOutcome(input);
    } catch (error) {
      this.logger?.("decisionx-build-outcome-capture-failed", error);
      return { status: "capture_failed", reason: boundedText(error?.code || error?.message, 240), branch: null };
    }
  }
}
