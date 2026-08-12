import { SELF_IMPROVEMENT_SCHEMA_VERSION, severityRank } from "./constants.js";
import { ImprovementTriggerSchema } from "./contracts.js";
import { createId, nowIso } from "./store.js";

function expectedImpactFor(pattern = {}) {
  if (/token|cost/.test(pattern.kind || "")) return "Lower token or model-call cost without reducing output quality.";
  if (/runtime|failure|preview/.test(`${pattern.kind} ${pattern.components?.join(" ")}`)) return "Increase execution success rate and reduce failed project-generation or preview workflows.";
  if (/instruction|outcome/.test(pattern.kind || "")) return "Improve instruction-following accuracy and reduce repeated user correction.";
  if (/health|agent/.test(pattern.kind || "")) return "Improve agent health, quality, and reuse decisions.";
  return "Improve PlutoniX reliability while preserving existing features.";
}

function investigationCostFor(pattern = {}) {
  const severity = pattern.severity || "medium";
  const calls = severity === "critical" ? 2 : severity === "high" ? 1 : 0;
  return {
    modelCalls: calls,
    maxTokens: severity === "critical" ? 8000 : severity === "high" ? 5000 : 2500,
    estimatedUsd: severity === "critical" ? 0.35 : severity === "high" ? 0.18 : 0.05
  };
}

export function createTriggersFromPatterns(patterns = [], {
  correlationId = "",
  minSignalCount = 3,
  minConfidence = 0.65,
  source = "self-improvement-trigger-engine"
} = {}) {
  return patterns
    .filter(Boolean)
    .filter((pattern) => !pattern.duplicateOf)
    .filter((pattern) => pattern.status !== "skipped")
    .filter((pattern) => {
      const severeEnough = severityRank(pattern.severity) >= severityRank("high") && pattern.signalCount >= Math.min(2, minSignalCount);
      return pattern.signalCount >= minSignalCount || severeEnough || pattern.confidence >= minConfidence;
    })
    .filter((pattern) => pattern.confidence >= Math.min(0.45, minConfidence))
    .map((pattern) => ImprovementTriggerSchema.parse({
      id: createId("si_trigger"),
      schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
      correlationId: correlationId || pattern.correlationId || createId("si_cycle"),
      source,
      timestamp: nowIso(),
      status: "triggered",
      evidenceRefs: pattern.signalIds || pattern.evidenceRefs || [],
      actor: "self-improvement-trigger-engine",
      modelProfile: "",
      patternKey: pattern.patternKey,
      triggerReason: pattern.signalCount >= minSignalCount
        ? `Pattern reached frequency threshold with ${pattern.signalCount} related signals.`
        : `Pattern severity ${pattern.severity} and confidence ${pattern.confidence} justify investigation.`,
      severity: pattern.severity,
      affectedComponents: pattern.components || [],
      confidence: pattern.confidence,
      expectedImpact: expectedImpactFor(pattern),
      estimatedInvestigationCost: investigationCostFor(pattern),
      manual: false
    }));
}

export function createManualTrigger({
  reason,
  severity = "medium",
  affectedComponents = ["plutonix-platform"],
  evidenceRefs = [],
  confidence = 0.9,
  correlationId = createId("si_manual")
} = {}) {
  return ImprovementTriggerSchema.parse({
    id: createId("si_trigger"),
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    correlationId,
    source: "manual-or-gotham-system-target",
    timestamp: nowIso(),
    status: "triggered",
    evidenceRefs,
    actor: "self-improvement-trigger-engine",
    modelProfile: "",
    patternKey: "",
    triggerReason: reason || "Manual administrative or Gotham system-target improvement request.",
    severity,
    affectedComponents,
    confidence,
    expectedImpact: "Investigate and propose a bounded platform improvement with explicit preservation gates.",
    estimatedInvestigationCost: {
      modelCalls: severity === "high" || severity === "critical" ? 1 : 0,
      maxTokens: severity === "high" || severity === "critical" ? 6000 : 3000,
      estimatedUsd: severity === "high" || severity === "critical" ? 0.25 : 0.05
    },
    manual: true
  });
}
