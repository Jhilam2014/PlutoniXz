import { DEFAULT_SELF_IMPROVEMENT_CONFIG } from "./constants.js";
import { neutralizeLogInstruction } from "./redaction.js";
import { createId, nowIso } from "./store.js";

export const MARKET_RESEARCH_AGENTS = [
  {
    agentId: "plutomix-competitive-tools-research-agent",
    role: "competitive-tool-scout",
    scope: "Compare agentic app builders, coding agents, orchestration dashboards, and deployment products against the PlutoMix market vision: verified delivery, cross-project learning, controlled evolution, customer-owned execution, Gotham Chat clarity and design proof."
  },
  {
    agentId: "plutomix-literature-research-agent",
    role: "research-paper-scout",
    scope: "Track relevant papers and technical writeups on agent reliability, evaluation, cost control, self-improvement safety, evidence reports, rollback, outcome-based agent scoring and Project Intelligence Passport design."
  },
	  {
	    agentId: "plutomix-marketplace-research-agent",
	    role: "marketplace-signal-scout",
	    scope: "Look for marketplace/blog/documentation signals that suggest practical UX, Gotham Chat, buyer-proof, demo, paid-beta, design and workflow improvements aligned with the PlutoMix market differentiation report."
	  },
	  {
	    agentId: "plutomix-design-workshop-research-agent",
	    role: "periodic-design-workshop-scout",
	    scope: "Periodically review PlutoMix UI growth, Gotham Chat ergonomics, command placement, frontend workflow clarity, accessibility, responsive behavior, visual hierarchy, and professional aesthetic quality. Recommend user-friendly design improvements that preserve existing functionality and reduce control/log/panel friction."
	  }
	];

function todayKey(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function usageToday(rows = []) {
  const today = todayKey();
  return rows
    .filter((row) => String(row.timestamp || "").startsWith(today))
    .reduce((totals, row) => ({
      calls: totals.calls + Number(row.usage?.modelCalls || row.estimatedUsage?.modelCalls || row.budget?.estimatedUsage?.modelCalls || 0),
      tokens: totals.tokens + Number(row.usage?.tokens || row.estimatedUsage?.tokens || row.budget?.estimatedUsage?.tokens || 0),
      cost: totals.cost + Number(row.usage?.estimatedUsd || row.estimatedUsage?.estimatedUsd || row.budget?.estimatedUsage?.estimatedUsd || 0)
    }), { calls: 0, tokens: 0, cost: 0 });
}

function sourceList(config = DEFAULT_SELF_IMPROVEMENT_CONFIG) {
  if (Array.isArray(config.researchSources)) return config.researchSources.filter(Boolean).slice(0, 8);
  return String(config.researchSources || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function planMarketResearch({
  topic = "plutomix improvement opportunities",
  reason = "investigator-agent-research-signal",
  config = DEFAULT_SELF_IMPROVEMENT_CONFIG,
  previousResearchLogs = []
} = {}) {
  const sources = sourceList(config);
  const usage = usageToday(previousResearchLogs);
  const estimatedUsage = {
    modelCalls: Math.min(1, Math.max(0, Number(config.researchMaxCallsPerDay || 0) - usage.calls)),
    tokens: Math.min(3000, Math.max(0, Number(config.researchMaxTokensPerDay || 0) - usage.tokens)),
    estimatedUsd: Math.min(0.12, Math.max(0, Number(config.researchMaxCostPerDay || 0) - usage.cost))
  };
  const enabled = Boolean(config.researchEnabled);
  const allowNetwork = Boolean(config.researchAllowNetwork);
  const budgetAllowed = estimatedUsage.modelCalls > 0 &&
    estimatedUsage.tokens > 0 &&
    estimatedUsage.estimatedUsd > 0 &&
    usage.calls < Number(config.researchMaxCallsPerDay || 0) &&
    usage.tokens < Number(config.researchMaxTokensPerDay || 0) &&
    usage.cost < Number(config.researchMaxCostPerDay || 0);
  const status = !enabled
    ? "skipped_disabled"
    : !budgetAllowed
      ? "skipped_budget_exhausted"
      : allowNetwork
        ? "ready_for_bounded_exploration"
        : "ready_without_network";
  return {
    id: createId("si_research"),
    schemaVersion: "1.0.0",
    timestamp: nowIso(),
    orchestratorAgent: "self-improvement-orchestrator",
    agents: MARKET_RESEARCH_AGENTS,
    topic: neutralizeLogInstruction(topic, { maxLength: 260 }),
    reason,
    status,
    enabled,
    allowNetwork,
    budget: {
      dailyMaxCalls: Number(config.researchMaxCallsPerDay || 0),
      dailyMaxTokens: Number(config.researchMaxTokensPerDay || 0),
      dailyMaxCostUsd: Number(config.researchMaxCostPerDay || 0),
      usedToday: usage,
      estimatedUsage,
      remainingAfterEstimate: {
        calls: Math.max(0, Number(config.researchMaxCallsPerDay || 0) - usage.calls - estimatedUsage.modelCalls),
        tokens: Math.max(0, Number(config.researchMaxTokensPerDay || 0) - usage.tokens - estimatedUsage.tokens),
        cost: Math.max(0, Number(config.researchMaxCostPerDay || 0) - usage.cost - estimatedUsage.estimatedUsd)
      }
    },
    sources,
    outputContract: {
      required: [
        "problemStatement",
        "evidenceReferences",
        "competitiveInsight",
        "expectedPlutoMixBenefit",
        "risk",
        "validationPlan",
        "budgetUsed"
      ],
      note: "Research findings can propose improvements only through the same proposal, isolation, validation, review, and rollback pipeline."
    }
  };
}
