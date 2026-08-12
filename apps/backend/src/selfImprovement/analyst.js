import { IMPROVEMENT_CATEGORIES, SELF_IMPROVEMENT_SCHEMA_VERSION } from "./constants.js";
import { ImprovementAnalysisSchema } from "./contracts.js";
import { classifyRisk } from "./policy.js";
import { createId, nowIso } from "./store.js";

function categoryForEvidence(evidence = {}) {
  const text = `${evidence.problemStatement || ""} ${(evidence.featureDependencies || []).join(" ")} ${(evidence.boundedLogExcerpts || []).map((item) => item.excerpt).join(" ")}`.toLowerCase();
  if (/token|cost|model call/.test(text)) return text.includes("cost") ? "cost_efficiency" : "token_efficiency";
  if (/auth|credential|secret|security/.test(text)) return "security";
  if (/preview|runtime|failed|timeout|crash|repair/.test(text)) return "reliability";
  if (/instruction|agent/.test(text)) return "agent_quality";
  if (/ui|screen|workflow|abandoned/.test(text)) return "ui_ux";
  if (/test|validation/.test(text)) return "testing";
  return "observability";
}

function affectedFilesFor(category, evidence = {}) {
  const deps = evidence.featureDependencies || [];
  if (category === "token_efficiency" || category === "cost_efficiency") {
    return ["apps/backend/src/tokenEconomy.js", "apps/backend/src/adaptiveOrchestration.js", "apps/backend/src/codexWorkflow.js"];
  }
  if (category === "reliability") {
    if (deps.some((item) => /projects|runtime|preview/i.test(item))) return ["apps/backend/src/projectManager.js", "apps/backend/src/server.js"];
    return ["apps/backend/src/server.js", "apps/backend/src/codexWorkflow.js"];
  }
  if (category === "agent_quality") return ["apps/backend/src/plutonixAuthority.js", "apps/backend/src/projectAgents.js"];
  if (category === "ui_ux") return ["apps/frontend/src/App.jsx", "apps/frontend/src/App.css"];
  if (category === "security") return ["apps/backend/src/auth.js", "apps/backend/src/hosting/secret-vault.service.js"];
  return ["apps/backend/src/server.js"];
}

export async function analyzeEvidencePackage(evidencePackage, { modelProfile = "", allowModelCall = false } = {}) {
  const category = categoryForEvidence(evidencePackage);
  const affectedFiles = affectedFilesFor(category, evidencePackage);
  const riskLevel = classifyRisk({
    affectedFiles,
    proposedSolution: evidencePackage.problemStatement,
    securityImpact: category === "security" ? "security_sensitive" : "none"
  });
  const shouldProceed = evidencePackage.boundedLogExcerpts.length > 0 || evidencePackage.evidenceRefs.length > 0;
  const proposedTitle = {
    reliability: "Improve PlutoniX workflow reliability from repeated failure evidence",
    token_efficiency: "Reduce low-yield agent token usage",
    cost_efficiency: "Reduce model-call cost for low-yield workflows",
    agent_quality: "Improve agent quality from repeated outcome evidence",
    ui_ux: "Reduce UI friction in the affected PlutoniX workflow",
    security: "Investigate security-sensitive PlutoniX issue with manual gates",
    observability: "Improve observability for repeated PlutoniX issue"
  }[category] || "Improve PlutoniX from evidence-backed signal pattern";
  return ImprovementAnalysisSchema.parse({
    id: createId("si_analysis"),
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    correlationId: evidencePackage.correlationId,
    source: allowModelCall ? "self-improvement-analyst-model-adapter" : "self-improvement-rule-based-analyst",
    timestamp: nowIso(),
    status: "analyzed",
    evidenceRefs: [evidencePackage.id, ...(evidencePackage.evidenceRefs || [])],
    actor: "self-improvement-analyst",
    modelProfile,
    evidencePackageId: evidencePackage.id,
    rootCauseHypotheses: [
      {
        hypothesis: "The pattern is recurring because an existing workflow lacks a deterministic guard, validation check, or bounded recovery path for the observed component.",
        supportingEvidence: evidencePackage.boundedLogExcerpts.map((item) => item.evidenceRef).slice(0, 6),
        confidence: shouldProceed ? 0.68 : 0.35
      }
    ],
    missingEvidence: shouldProceed ? [] : ["At least one concrete runtime, instruction, token, or health signal is required before implementation."],
    proposedImprovements: shouldProceed ? [
      {
        title: proposedTitle,
        category: IMPROVEMENT_CATEGORIES.includes(category) ? category : "observability",
        affectedFiles,
        expectedBenefit: evidencePackage.compatibilityRequirements?.length
          ? "Resolve the observed issue while preserving inventoried features and API contracts."
          : "Resolve the observed issue with explicit regression checks.",
        riskLevel
      }
    ] : [],
    riskLevel,
    expectedBenefit: "Improve success rate, reliability, and/or efficiency while preserving existing PlutoniX contracts.",
    validationPlan: [
      "Run existing backend tests for affected workflow when Node is available.",
      "Run feature inventory preservation check.",
      "Run API inventory preservation check.",
      "Run targeted smoke test or golden self-improvement fixture for the detected pattern."
    ],
    rollbackPlan: [
      "Keep candidate changes isolated until promotion.",
      "Record changed files and reverse patch or restore artifact before promotion.",
      "Block repeated retry of unchanged failed proposal."
    ],
    shouldProceed,
    confidenceScore: shouldProceed ? 0.72 : 0.25,
    alternativeStrategies: [
      "Observe more signals before implementation.",
      "Ask Human Agent for priority/risk decision if the affected component is security, auth, deployment, or root instructions.",
      "Add observability first when evidence is insufficient."
    ],
    modelCall: {
      status: allowModelCall ? "skipped" : "not_required",
      reason: allowModelCall
        ? "Provider-neutral model analysis adapter is intentionally gated in this vertical slice; bounded evidence package is ready for a future model call."
        : "Rule-based analyst selected because the evidence pattern can be triaged without additional model cost.",
      profile: modelProfile
    }
  });
}
