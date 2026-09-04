import path from "node:path";

export const SELF_IMPROVEMENT_SCHEMA_VERSION = "1.0.0";

export const IMPROVEMENT_CATEGORIES = [
  "functionality",
  "bug_fix",
  "reliability",
  "agent_quality",
  "instruction_quality",
  "routing",
  "performance",
  "token_efficiency",
  "cost_efficiency",
  "ui_ux",
  "accessibility",
  "security",
  "observability",
  "testing",
  "documentation",
  "developer_experience",
  "generated_project_quality",
  "provider_compatibility",
  "agent_reuse",
  "knowledge_quality",
  "infrastructure"
];

export const AUTONOMY_MODES = [
  "observe_only",
  "recommend",
  "sandbox",
  "controlled_auto",
  "advanced_auto"
];

export const DEFAULT_SELF_IMPROVEMENT_CONFIG = {
  enabled: true,
  mode: "sandbox",
  scheduleMs: 0,
  maxCallsPerCycle: 2,
  maxTokensPerCycle: 12000,
  maxCostPerDay: 1,
  minSignalCount: 3,
  minConfidence: 0.65,
  autoPromoteMaxRisk: "low",
  postPromotionWindowMs: 30 * 60 * 1000,
  autoRollback: true,
  retentionDays: 30,
  storeInstructionSamples: false,
  eventCheckEnabled: true,
  eventTriggerMinScore: 0.78,
  eventWindowMs: 10 * 60 * 1000,
  eventMinRelatedSignals: 3,
  eventTriggerCooldownMs: 15 * 60 * 1000,
  randomAuditRate: 0.01,
  researchEnabled: false,
  researchAllowNetwork: false,
  researchMaxCallsPerDay: 2,
  researchMaxTokensPerDay: 8000,
  researchMaxCostPerDay: 0.5,
  researchSources: [
    "local:self-improvement-market-vision:runtime/self-improvement/market-vision/plutomix-market-differentiation.json",
    "local:market-differentiation-pdf:docs/quotes/PlutoMix_Market_Differentiation_Investor_Quotation.pdf"
  ],
  toolBuildEnabled: true,
  toolPlanAutoTrigger: true,
  toolPlanCooldownMs: 30 * 60 * 1000,
  maxToolBuildsPerDay: 4,
  monetaryApprovalRequired: true,
  monetaryApprovalThresholdUsd: 0
};

export function projectRoot() {
  if (process.env.PLUTOMIX_PROJECT_ROOT) return process.env.PLUTOMIX_PROJECT_ROOT;
  if (process.cwd().endsWith(path.join("plutomix", "apps", "backend"))) return path.resolve(process.cwd(), "../..");
  if (process.cwd().endsWith("plutomix")) return process.cwd();
  return path.resolve(process.cwd(), "../..");
}

export function selfImprovementRoot(root = projectRoot()) {
  if (process.env.PLUTOMIX_RUNTIME_ROOT) return path.join(process.env.PLUTOMIX_RUNTIME_ROOT, "self-improvement");
  return path.join(root, "runtime", "self-improvement");
}

export function observabilityRoot(root = projectRoot()) {
  return path.join(process.env.PLUTOMIX_RUNTIME_ROOT || root, "observability", "self-improvement");
}

export function baselineRoot(root = projectRoot()) {
  return path.join(selfImprovementRoot(root), "baselines");
}

export function severityRank(value = "") {
  return { critical: 4, high: 3, medium: 2, low: 1, info: 0 }[value] ?? 0;
}

export function riskRank(value = "") {
  return { critical: 4, high: 3, medium: 2, low: 1, none: 0 }[value] ?? 0;
}

export function clampScore(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}
