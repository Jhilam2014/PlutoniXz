import fs from "fs-extra";
import path from "node:path";
import { baselineRoot, SELF_IMPROVEMENT_SCHEMA_VERSION } from "./constants.js";
import { PromotionDecisionSchema, ReviewDecisionSchema, RollbackEventSchema, ValidationRunSchema } from "./contracts.js";
import { canPromote } from "./policy.js";
import { createId, nowIso } from "./store.js";

async function readJsonIfExists(filePath, fallback = null) {
  if (!(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

export async function validateCandidate({ root, proposal, candidate = null } = {}) {
  const featureInventory = await readJsonIfExists(path.join(baselineRoot(root), "feature-inventory.json"), { features: [] });
  const missingCriticalFeatures = [];
  for (const feature of featureInventory.features || []) {
    if (feature.criticality !== "critical") continue;
    if (!feature.featureId || !feature.name) missingCriticalFeatures.push(feature.featureId || "unknown-critical-feature");
  }
  const featurePreservationStatus = missingCriticalFeatures.length ? "failed" : "passed";
  const checks = [
    {
      name: "candidate_isolation",
      status: candidate?.workspacePath ? "passed" : "skipped",
      detail: candidate?.workspacePath ? `Candidate isolated at ${candidate.workspacePath}` : "No candidate workspace was created in this autonomy mode."
    },
    {
      name: "rollback_artifact",
      status: candidate?.rollbackArtifactPath ? "passed" : "skipped",
      detail: candidate?.rollbackArtifactPath || "No rollback artifact exists because no candidate was created."
    },
    {
      name: "no_live_source_mutation",
      status: "passed",
      detail: "This vertical slice does not allow autonomous live-source mutation."
    },
    {
      name: "test_plan_present",
      status: proposal.testPlan?.length ? "passed" : "failed",
      detail: `${proposal.testPlan?.length || 0} planned checks.`
    }
  ];
  const overallStatus = checks.some((check) => check.status === "failed") || featurePreservationStatus === "failed"
    ? "failed"
    : "passed";
  return ValidationRunSchema.parse({
    id: createId("si_validation"),
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    correlationId: proposal.correlationId,
    source: "self-improvement-validation-engine",
    timestamp: nowIso(),
    status: "validated",
    evidenceRefs: [proposal.id, ...(candidate ? [candidate.id] : [])],
    actor: "self-improvement-validation-engine",
    modelProfile: "",
    proposalId: proposal.proposalId,
    candidateId: candidate?.candidateId || "",
    checks,
    featurePreservation: {
      status: featurePreservationStatus,
      missingCriticalFeatures,
      detail: featurePreservationStatus === "passed"
        ? "Baseline critical features are present in the feature inventory."
        : "Critical feature inventory entries are malformed or missing."
    },
    benchmarkComparison: {
      status: "not_computed_without_candidate_patch",
      explanation: "No code patch was applied in this safe vertical slice, so before/after runtime metrics are not computed."
    },
    overallStatus
  });
}

export function reviewCandidate({ proposal, validation, authorAgent = "self-improvement-candidate-worker" } = {}) {
  const reasons = [];
  if (authorAgent === "plutonix-independent-improvement-reviewer") reasons.push("author_cannot_review_own_change");
  if (validation.overallStatus !== "passed") reasons.push("validation_not_passed");
  if (proposal.rejectionReasons?.length) reasons.push(...proposal.rejectionReasons);
  if (["high", "critical"].includes(proposal.riskLevel)) reasons.push("high_risk_requires_human_or_stronger_policy");
  const approved = reasons.length === 0;
  return ReviewDecisionSchema.parse({
    id: createId("si_review"),
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    correlationId: proposal.correlationId,
    source: "self-improvement-independent-reviewer",
    timestamp: nowIso(),
    status: "reviewed",
    evidenceRefs: [proposal.id, validation.id],
    actor: "plutonix-independent-improvement-reviewer",
    modelProfile: "",
    proposalId: proposal.proposalId,
    reviewerAgent: "plutonix-independent-improvement-reviewer",
    authorAgent,
    reviewerIndependent: authorAgent !== "plutonix-independent-improvement-reviewer",
    decision: approved ? "approved" : "needs_revision",
    reasons,
    securityNotes: ["Logs and model outputs are treated as untrusted input.", "No high-risk autonomous promotion is allowed by default."],
    testAdequacy: validation.overallStatus === "passed" ? "adequate" : "inadequate"
  });
}

export function decidePromotion({ proposal, validation, review, mode, config = {} } = {}) {
  const decision = canPromote({
    mode,
    riskLevel: proposal.riskLevel,
    validation,
    review,
    promotionPolicy: config
  });
  return PromotionDecisionSchema.parse({
    id: createId("si_promotion"),
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    correlationId: proposal.correlationId,
    source: "self-improvement-promotion-controller",
    timestamp: nowIso(),
    status: decision.allowed ? "promoted" : "skipped",
    evidenceRefs: [proposal.id, validation.id, review.id],
    actor: "self-improvement-promotion-controller",
    modelProfile: "",
    proposalId: proposal.proposalId,
    decision: decision.allowed ? "promote" : "stage",
    reasons: decision.reasons,
    autonomyMode: mode,
    rollbackArtifactPath: ""
  });
}

export function createRollbackEvent({ proposal, reason, rollbackArtifactPath = "" } = {}) {
  return RollbackEventSchema.parse({
    id: createId("si_rollback"),
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    correlationId: proposal.correlationId,
    source: "self-improvement-rollback-controller",
    timestamp: nowIso(),
    status: "rolled_back",
    evidenceRefs: [proposal.id],
    actor: "self-improvement-rollback-controller",
    modelProfile: "",
    proposalId: proposal.proposalId,
    rollbackReason: reason,
    rollbackArtifactPath,
    statusDetail: "Rollback event recorded. No live-source rollback was needed for candidate-only vertical slice."
  });
}
