import { DEFAULT_SELF_IMPROVEMENT_CONFIG } from "./constants.js";
import { fingerprintText, neutralizeLogInstruction } from "./redaction.js";
import { createId, nowIso, stableHash } from "./store.js";

const INVESTIGATOR_AGENT_ID = "plutonix-self-improvement-investigator-agent";

function textForEvent(event = {}) {
  return `${event.type || ""} ${event.status || ""} ${event.message || ""}`.toLowerCase();
}

export function isSelfImprovementRuntimeEvent(event = {}) {
  return /^self-improvement|orchestrator-health-self-heal/i.test(String(event.type || ""));
}

function componentForEvent(event = {}) {
  const text = textForEvent(event);
  if (/auth|google|profile|permission|credential|secret/.test(text)) return "authentication";
  if (/project-instance|project-runtime|preview|vite|docker|port|not become ready/.test(text)) return "managed-project-runtime";
  if (/gotham|generate|codex|claude|model|workflow/.test(text)) return "gotham-generation";
  if (/token|cost|model-call|budget|efficiency/.test(text)) return "token-economy";
  if (/ui|screen|click|select|dropdown|tab|abandon|friction/.test(text)) return "plutonix-ui";
  if (/hosting|deploy|rollback|cloud/.test(text)) return "hosting";
  return "plutonix-runtime";
}

function keyParameters(event = {}) {
  const text = textForEvent(event);
  const failure = /failed|error|rejected|timeout|crash|not become ready|exception/i.test(text);
  const security = /auth|permission|credential|secret|token leak|private key/i.test(text);
  const efficiency = /token|cost|budget|slow|retry|model-call|no output|empty changed files|no changed files/i.test(text);
  const quality = /repair|rollback|incomplete|reopened|correction|did not|missing|wrong|failed validation/i.test(text);
  const uiFriction = /select|dropdown|tab|screen|preview|click|stop|abandon|restart/i.test(text);
  const marketplaceResearch = /competitor|competitive|marketplace|market research|blog|paper|research/i.test(text);
  return { failure, security, efficiency, quality, uiFriction, marketplaceResearch };
}

function baseScoreFor(parameters = {}) {
  let score = 0.05;
  if (parameters.failure) score += 0.42;
  if (parameters.security) score += 0.5;
  if (parameters.quality) score += 0.2;
  if (parameters.efficiency) score += 0.18;
  if (parameters.uiFriction) score += 0.1;
  if (parameters.marketplaceResearch) score += 0.12;
  return Math.min(0.99, score);
}

function severityFor(score, parameters = {}) {
  if (parameters.security || score >= 0.92) return "critical";
  if (score >= 0.78) return "high";
  if (score >= 0.48) return "medium";
  return "low";
}

function recentRelatedCount(recentInvestigations = [], fingerprint = "", windowMs = DEFAULT_SELF_IMPROVEMENT_CONFIG.eventWindowMs) {
  const now = Date.now();
  return recentInvestigations.filter((row) => {
    if (row.fingerprint !== fingerprint) return false;
    const timestamp = new Date(row.timestamp || 0).getTime();
    return Number.isFinite(timestamp) && now - timestamp <= windowMs;
  }).length;
}

function recentlyTriggered(recentInvestigations = [], fingerprint = "", cooldownMs = DEFAULT_SELF_IMPROVEMENT_CONFIG.eventTriggerCooldownMs) {
  const now = Date.now();
  return recentInvestigations.some((row) => {
    if (row.fingerprint !== fingerprint || !row.shouldTrigger) return false;
    const timestamp = new Date(row.timestamp || 0).getTime();
    return Number.isFinite(timestamp) && now - timestamp <= cooldownMs;
  });
}

export function investigateRuntimeEvent({
  event,
  recentInvestigations = [],
  config = DEFAULT_SELF_IMPROVEMENT_CONFIG,
  random = Math.random
} = {}) {
  if (!event || isSelfImprovementRuntimeEvent(event)) {
    return {
      checked: false,
      ignored: true,
      ignoreReason: "self_improvement_event_or_missing_event",
      eventId: event?.id || "",
      eventType: event?.type || ""
    };
  }
  const component = componentForEvent(event);
  const parameters = keyParameters(event);
  const normalized = fingerprintText(`${event.type || ""}:${component}:${event.message || ""}`);
  const fingerprint = stableHash(normalized).slice(0, 24);
  const relatedCount = recentRelatedCount(recentInvestigations, fingerprint, config.eventWindowMs) + 1;
  const randomAuditSelected = Number(config.randomAuditRate || 0) > 0 && random() < Number(config.randomAuditRate || 0);
  const score = Math.min(0.99, baseScoreFor(parameters) + Math.min(0.25, Math.max(0, relatedCount - 1) * 0.08));
  const severity = severityFor(score, parameters);
  const cooldownActive = recentlyTriggered(recentInvestigations, fingerprint, config.eventTriggerCooldownMs);
  const repeatedEnough = relatedCount >= Number(config.eventMinRelatedSignals || DEFAULT_SELF_IMPROVEMENT_CONFIG.eventMinRelatedSignals);
  const triggerMinScore = Number(config.eventTriggerMinScore || DEFAULT_SELF_IMPROVEMENT_CONFIG.eventTriggerMinScore);
  const shouldTrigger = !cooldownActive && (
    parameters.security ||
    score >= triggerMinScore ||
    (repeatedEnough && (parameters.failure || parameters.quality || parameters.efficiency || parameters.uiFriction))
  );
  const problemStatement = shouldTrigger
    ? [
        `Investigator Agent detected a ${severity} ${component} quality or efficiency issue.`,
        `Key parameters: ${Object.entries(parameters).filter(([, value]) => value).map(([key]) => key).join(", ") || "none"}.`,
        `Related occurrences in window: ${relatedCount}.`,
        `Event: ${neutralizeLogInstruction(event.message || event.type || "", { maxLength: 260 })}`
      ].join(" ")
    : "";

  return {
    id: createId("si_investigation"),
    schemaVersion: "1.0.0",
    timestamp: nowIso(),
    checked: true,
    agentId: INVESTIGATOR_AGENT_ID,
    agentRole: "event-quality-efficiency-investigator",
    eventId: event.id || "",
    eventType: event.type || "",
    component,
    fingerprint,
    qualityScore: Number(score.toFixed(2)),
    severity,
    keyParameters: parameters,
    relatedCount,
    randomAuditSelected,
    cooldownActive,
    shouldTrigger,
    problemStatement,
    affectedComponents: [component],
    recommendedAction: shouldTrigger
      ? "Send problem statement to the self-improvement orchestrator pipeline."
      : randomAuditSelected
        ? "Record random audit result without triggering a proposal."
        : "Record lightweight check only.",
    eventExcerpt: neutralizeLogInstruction(event.message || event.type || "", { maxLength: 420 })
  };
}
