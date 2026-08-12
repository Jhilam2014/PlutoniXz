import { DEFAULT_SELF_IMPROVEMENT_CONFIG, riskRank } from "./constants.js";

const HIGH_RISK_FILE_PATTERNS = [
  /(^|\/)AGENTS\.md$/,
  /(^|\/)ROOT_WORKSPACE_GENERATION_POLICY\.md$/,
  /auth\.js$/,
  /secret|credential|vault/i,
  /database\/migrations/i,
  /docker-compose|Dockerfile/i,
  /hosting\/providers/i
];

const REMOVAL_PATTERNS = [
  /\bremove\b/i,
  /\bdelete\b/i,
  /\bdisable\b/i,
  /\breplace\b/i,
  /\bdrop\b/i,
  /\barchive\b/i
];

export function classifyRisk({ affectedFiles = [], affectedInstructions = [], apiSchemaImpact = "none", databaseImpact = "none", securityImpact = "none", proposedSolution = "" } = {}) {
  if (affectedInstructions.includes("AGENTS.md")) return "critical";
  if (affectedFiles.some((file) => HIGH_RISK_FILE_PATTERNS.some((pattern) => pattern.test(file)))) return "high";
  if (/destructive|credential|secret|auth|authorization|billing|deploy|production/i.test(`${apiSchemaImpact} ${databaseImpact} ${securityImpact} ${proposedSolution}`)) return "high";
  if (apiSchemaImpact && apiSchemaImpact !== "none") return "medium";
  if (databaseImpact && databaseImpact !== "none") return "medium";
  return "low";
}

export function proposalRejectionReasons(proposal = {}, existingProposals = []) {
  const reasons = [];
  if (!proposal.measurableObjective) reasons.push("missing_measurable_objective");
  if (!proposal.evidence?.length) reasons.push("inadequate_evidence");
  if (!proposal.rollbackPlan?.length) reasons.push("missing_rollback_strategy");
  if (!proposal.testPlan?.length) reasons.push("missing_test_plan");
  if ((proposal.affectedInstructions || []).includes("AGENTS.md") && proposal.riskLevel !== "critical") {
    reasons.push("root_instruction_change_not_classified_critical");
  }
  if (REMOVAL_PATTERNS.some((pattern) => pattern.test(proposal.proposedSolution || "")) && !proposal.compatibilityImpact?.includes("replacement")) {
    reasons.push("feature_preservation_removal_gate_not_satisfied");
  }
  const duplicate = existingProposals.find((candidate) =>
    candidate.proposalId !== proposal.proposalId &&
    candidate.status !== "rejected" &&
    candidate.title?.toLowerCase() === proposal.title?.toLowerCase()
  );
  if (duplicate) reasons.push(`duplicate_proposal:${duplicate.proposalId}`);
  return reasons;
}

export function canCreateCandidate(mode = DEFAULT_SELF_IMPROVEMENT_CONFIG.mode) {
  return ["sandbox", "controlled_auto", "advanced_auto"].includes(mode);
}

export function canPromote({ mode = DEFAULT_SELF_IMPROVEMENT_CONFIG.mode, riskLevel = "low", validation = {}, review = {}, promotionPolicy = {} } = {}) {
  const maxRisk = promotionPolicy.autoPromoteMaxRisk || DEFAULT_SELF_IMPROVEMENT_CONFIG.autoPromoteMaxRisk;
  if (!["controlled_auto", "advanced_auto"].includes(mode)) {
    return { allowed: false, reasons: [`autonomy_mode_${mode}_does_not_promote`] };
  }
  if (mode === "controlled_auto" && riskRank(riskLevel) > riskRank("low")) {
    return { allowed: false, reasons: ["controlled_auto_only_promotes_low_risk"] };
  }
  if (mode === "advanced_auto" && riskRank(riskLevel) > riskRank(maxRisk)) {
    return { allowed: false, reasons: [`risk_${riskLevel}_exceeds_auto_promote_max_${maxRisk}`] };
  }
  const reasons = [];
  if (validation?.overallStatus !== "passed") reasons.push("validation_not_passed");
  if (validation?.featurePreservation?.status !== "passed") reasons.push("feature_preservation_not_passed");
  if (review?.decision !== "approved") reasons.push("independent_review_not_approved");
  if (!review?.reviewerIndependent) reasons.push("reviewer_not_independent");
  if (riskRank(riskLevel) >= riskRank("high")) reasons.push("high_risk_requires_explicit_policy_or_human_approval");
  return { allowed: reasons.length === 0, reasons };
}

export function shouldAutoRollback({ autoRollback = true, postPromotionMetrics = {}, baselineMetrics = {} } = {}) {
  if (!autoRollback) return { rollback: false, reasons: ["auto_rollback_disabled"] };
  const reasons = [];
  if (postPromotionMetrics.criticalFailures > 0) reasons.push("new_critical_failures");
  if (postPromotionMetrics.featureInventoryMismatch) reasons.push("feature_inventory_mismatch");
  if (
    Number.isFinite(postPromotionMetrics.runtimeErrorRate) &&
    Number.isFinite(baselineMetrics.runtimeErrorRate) &&
    postPromotionMetrics.runtimeErrorRate > baselineMetrics.runtimeErrorRate * 1.25
  ) {
    reasons.push("runtime_error_rate_regression");
  }
  if (
    Number.isFinite(postPromotionMetrics.tokensPerSuccessfulTask) &&
    Number.isFinite(baselineMetrics.tokensPerSuccessfulTask) &&
    postPromotionMetrics.tokensPerSuccessfulTask > baselineMetrics.tokensPerSuccessfulTask * 1.25
  ) {
    reasons.push("token_growth_regression");
  }
  return { rollback: reasons.length > 0, reasons };
}
